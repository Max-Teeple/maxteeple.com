import type { Bindings } from '../types';
import { safeEqual } from './google';
import { createGlancePhoto } from './photos';
import { HttpError } from '../util';

const SHARE_TTL_MS = 24 * 60 * 60 * 1000;
const SHARE_WINDOW_MS = 10 * 60 * 1000;
const SHARE_WINDOW_MAX = 8;
const SHARE_TOTAL_MAX = 40;

type ShareRow = {
  id: string;
  token_hash: string;
  expires_at: string;
  revoked_at: string | null;
  uploads: number;
  window_start: string;
  window_count: number;
};

export function shareTokenPattern(): RegExp {
  return /^[A-Za-z0-9_-]{20,64}$/;
}

export async function createPhotoShare(db: D1Database, now = Date.now()): Promise<{ token: string; expiresAt: string }> {
  const token = encodeToken(crypto.getRandomValues(new Uint8Array(18)));
  const hash = await sha256Hex(token);
  const expiresAt = new Date(now + SHARE_TTL_MS).toISOString();
  const createdAt = new Date(now).toISOString();
  await db.prepare(`DELETE FROM glance_photo_shares`).run();
  await db
    .prepare(
      `INSERT INTO glance_photo_shares
        (id, token_hash, created_at, expires_at, revoked_at, uploads, window_start, window_count)
       VALUES (?, ?, ?, ?, NULL, 0, ?, 0)`
    )
    .bind(crypto.randomUUID(), hash, createdAt, expiresAt, createdAt)
    .run();
  return { token, expiresAt };
}

export async function revokePhotoShares(db: D1Database): Promise<void> {
  const now = new Date().toISOString();
  await db.prepare(`UPDATE glance_photo_shares SET revoked_at = ? WHERE revoked_at IS NULL`).bind(now).run();
}

export async function shareStatus(db: D1Database, token: string, now = Date.now()): Promise<{ expiresAt: string }> {
  const row = await loadShare(db, token);
  assertUsable(row, now);
  return { expiresAt: row.expiresAt };
}

export async function uploadSharedPhoto(db: D1Database, token: string, request: Request, env: Bindings, now = Date.now()): Promise<{ id: string }> {
  const row = await loadShare(db, token);
  assertUsable(row, now);
  const windowStart = Date.parse(row.windowStart);
  const inWindow = Number.isFinite(windowStart) && now - windowStart < SHARE_WINDOW_MS;
  const windowCount = inWindow ? row.windowCount : 0;
  if (windowCount >= SHARE_WINDOW_MAX || row.uploads >= SHARE_TOTAL_MAX) {
    throw new HttpError(429, 'Too many photos on this link. Wait a few minutes.');
  }
  const nextWindow = inWindow ? row.windowStart : new Date(now).toISOString();
  await db
    .prepare(`UPDATE glance_photo_shares SET uploads = ?, window_start = ?, window_count = ? WHERE id = ?`)
    .bind(row.uploads + 1, nextWindow, windowCount + 1, row.id)
    .run();
  return createGlancePhoto(request, env);
}

async function loadShare(db: D1Database, token: string): Promise<ShareRow & { expiresAt: string; windowStart: string; windowCount: number }> {
  if (!shareTokenPattern().test(token)) throw new HttpError(404, 'This link is not valid');
  const row = await db
    .prepare(
      `SELECT id, token_hash, expires_at, revoked_at, uploads, window_start, window_count
       FROM glance_photo_shares WHERE token_hash = ?`
    )
    .bind(await sha256Hex(token))
    .first<ShareRow>();
  if (!row || !safeEqual(row.token_hash, await sha256Hex(token))) throw new HttpError(404, 'This link is not valid');
  return {
    ...row,
    expiresAt: row.expires_at,
    windowStart: row.window_start,
    windowCount: row.window_count
  };
}

function assertUsable(row: { revoked_at: string | null; expiresAt: string }, now: number): void {
  if (row.revoked_at) throw new HttpError(410, 'This link was stopped');
  if (Date.parse(row.expiresAt) <= now) throw new HttpError(410, 'This link expired');
}

function encodeToken(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function sha256Hex(value: string): Promise<string> {
  const bits = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bits)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
