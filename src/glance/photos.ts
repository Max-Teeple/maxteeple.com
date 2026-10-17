import type { Bindings } from '../types';
import { HttpError } from '../util';

const MAX_PHOTOS = 120;
const MAX_FULL_BYTES = 2_200_000;
const MAX_THUMB_BYTES = 160_000;

let r2Failed = false;

export function resetPhotoStore(): void {
  r2Failed = false;
}

type PhotoRow = {
  id: string;
  created_at: string;
  bytes: number;
  width: number;
  height: number;
  store: string;
};

function jpegBytes(value: unknown, label: string, max: number): Uint8Array {
  const bytes = value instanceof Uint8Array ? value : value instanceof ArrayBuffer ? new Uint8Array(value) : null;
  if (!bytes || bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    throw new HttpError(400, label + ' must be a JPEG');
  }
  if (bytes.length > max) throw new HttpError(400, label + ' is too large');
  return bytes;
}

function photoKey(id: string, kind: 'full' | 'thumb'): string {
  return kind + '/' + id + '.jpg';
}

function asBytes(data: ArrayBuffer | Uint8Array | string | number[] | null): Uint8Array | null {
  if (!data) return null;
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  if (Array.isArray(data)) return Uint8Array.from(data);
  if (typeof data !== 'string' || !data) return null;
  const bin = atob(data);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function useR2(env: Bindings, full: Uint8Array, thumb: Uint8Array, id: string): Promise<boolean> {
  const bucket = env.GLANCE_PHOTOS;
  if (!bucket || r2Failed) return false;
  try {
    await bucket.put(photoKey(id, 'full'), full, { httpMetadata: { contentType: 'image/jpeg' } });
    await bucket.put(photoKey(id, 'thumb'), thumb, { httpMetadata: { contentType: 'image/jpeg' } });
    return true;
  } catch {
    r2Failed = true;
    console.error('[glance] R2 photos unavailable, storing in D1');
    return false;
  }
}

export async function listGlancePhotos(env: Bindings): Promise<{ id: string; createdAt: string; width: number; height: number }[]> {
  const rows = await env.LIVEVIEW_DB
    .prepare(`SELECT id, created_at, width, height FROM glance_photos ORDER BY created_at DESC LIMIT ?`)
    .bind(MAX_PHOTOS)
    .all<Pick<PhotoRow, 'id' | 'created_at' | 'width' | 'height'>>();
  return (rows.results || []).map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    width: row.width,
    height: row.height
  }));
}

async function photoForm(request: Request) {
  const form = await request.formData();
  const fullFile = form.get('full');
  const thumbFile = form.get('thumb');
  if (!(fullFile instanceof File) || !(thumbFile instanceof File)) throw new HttpError(400, 'Choose a photo');
  const full = jpegBytes(new Uint8Array(await fullFile.arrayBuffer()), 'Photo', MAX_FULL_BYTES);
  const thumb = jpegBytes(new Uint8Array(await thumbFile.arrayBuffer()), 'Thumbnail', MAX_THUMB_BYTES);
  const width = Math.max(0, Math.min(8000, Math.round(Number(form.get('width')) || 0)));
  const height = Math.max(0, Math.min(8000, Math.round(Number(form.get('height')) || 0)));
  return { full, thumb, width, height };
}

async function writePhoto(env: Bindings, id: string, full: Uint8Array, thumb: Uint8Array): Promise<boolean> {
  const stored = await useR2(env, full, thumb, id);
  if (!stored) {
    const db = env.LIVEVIEW_DB;
    await db.prepare(`INSERT INTO glance_photo_blobs (photo_id, kind, data) VALUES (?, 'full', ?)`).bind(id, full).run();
    await db.prepare(`INSERT INTO glance_photo_blobs (photo_id, kind, data) VALUES (?, 'thumb', ?)`).bind(id, thumb).run();
  }
  return stored;
}

export async function createGlancePhoto(request: Request, env: Bindings): Promise<{ id: string }> {
  const photo = await photoForm(request);
  const count = await env.LIVEVIEW_DB.prepare(`SELECT COUNT(*) AS n FROM glance_photos`).first<{ n: number }>();
  if ((count?.n || 0) >= MAX_PHOTOS) throw new HttpError(400, 'The photo library is full');
  const id = crypto.randomUUID();
  const stored = await writePhoto(env, id, photo.full, photo.thumb);
  await env.LIVEVIEW_DB
    .prepare(`INSERT INTO glance_photos (id, created_at, bytes, width, height, store) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(id, new Date().toISOString(), photo.full.length, photo.width, photo.height, stored ? 'r2' : 'd1')
    .run();
  return { id };
}

export async function replaceGlancePhoto(request: Request, env: Bindings, id: string): Promise<{ id: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, 'Photo not found');
  const row = await env.LIVEVIEW_DB
    .prepare(`SELECT id, store FROM glance_photos WHERE id = ?`)
    .bind(id)
    .first<{ id: string; store: string }>();
  if (!row) throw new HttpError(404, 'Photo not found');
  const photo = await photoForm(request);
  if (row.store === 'r2' && env.GLANCE_PHOTOS) {
    try {
      await env.GLANCE_PHOTOS.delete([photoKey(id, 'full'), photoKey(id, 'thumb')]);
    } catch {
      console.error('[glance] R2 photo delete failed');
    }
  }
  await env.LIVEVIEW_DB.prepare(`DELETE FROM glance_photo_blobs WHERE photo_id = ?`).bind(id).run();
  const stored = await writePhoto(env, id, photo.full, photo.thumb);
  await env.LIVEVIEW_DB
    .prepare(`UPDATE glance_photos SET bytes = ?, width = ?, height = ?, store = ? WHERE id = ?`)
    .bind(photo.full.length, photo.width, photo.height, stored ? 'r2' : 'd1', id)
    .run();
  return { id };
}

export async function readGlancePhoto(env: Bindings, id: string, kind: 'full' | 'thumb'): Promise<Uint8Array | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const row = await env.LIVEVIEW_DB
    .prepare(`SELECT id, store FROM glance_photos WHERE id = ?`)
    .bind(id)
    .first<{ id: string; store: string }>();
  if (!row) return null;
  if (row.store === 'r2' && env.GLANCE_PHOTOS && !r2Failed) {
    try {
      const object = await env.GLANCE_PHOTOS.get(photoKey(id, kind));
      if (object) return new Uint8Array(await object.arrayBuffer());
    } catch {
      r2Failed = true;
      console.error('[glance] R2 photo read failed');
    }
  }
  const blob = await env.LIVEVIEW_DB
    .prepare(`SELECT data FROM glance_photo_blobs WHERE photo_id = ? AND kind = ?`)
    .bind(id, kind)
    .first<{ data: ArrayBuffer | Uint8Array | string }>();
  return asBytes(blob?.data || null);
}

export async function removeGlancePhoto(env: Bindings, id: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
  const row = await env.LIVEVIEW_DB
    .prepare(`SELECT id, store FROM glance_photos WHERE id = ?`)
    .bind(id)
    .first<{ id: string; store: string }>();
  if (!row) return false;
  if (row.store === 'r2' && env.GLANCE_PHOTOS) {
    try {
      await env.GLANCE_PHOTOS.delete([photoKey(id, 'full'), photoKey(id, 'thumb')]);
    } catch {
      console.error('[glance] R2 photo delete failed');
    }
  }
  await env.LIVEVIEW_DB.prepare(`DELETE FROM glance_photo_blobs WHERE photo_id = ?`).bind(id).run();
  await env.LIVEVIEW_DB.prepare(`DELETE FROM glance_photos WHERE id = ?`).bind(id).run();
  return true;
}
