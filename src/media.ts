import { HttpError } from './util';

/** Workers KV values should stay small. Free-plan KV allows 25 MiB; we cap much lower. */
export const MAX_UPLOAD_BYTES = 1_500_000;

export async function saveImage(kv: KVNamespace, file: File): Promise<string> {
  if (!file || file.size <= 0) {
    throw new HttpError(400, 'No image received. Choose a JPG, PNG, or WebP and try again.');
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new HttpError(400, `Image is too large. Keep uploads under ${Math.round(MAX_UPLOAD_BYTES / 1024)} KB.`);
  }
  const type = file.type || '';
  if (!type.startsWith('image/')) {
    throw new HttpError(400, 'Only image files are allowed.');
  }
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new HttpError(400, `Image is too large. Keep uploads under ${Math.round(MAX_UPLOAD_BYTES / 1024)} KB.`);
  }
  const id = crypto.randomUUID();
  const key = `media/${id}`;
  await kv.put(key, bytes, {
    metadata: { contentType: type, name: file.name || 'upload' }
  });
  return key;
}

export async function readImage(kv: KVNamespace, id: string): Promise<{ body: ArrayBuffer; contentType: string } | null> {
  const stored = await kv.getWithMetadata<{ contentType?: string }>(`media/${id}`, 'arrayBuffer');
  if (!stored.value) return null;
  return {
    body: stored.value,
    contentType: stored.metadata?.contentType || 'application/octet-stream'
  };
}
