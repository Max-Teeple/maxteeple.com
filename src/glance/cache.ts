/**
 * Glance response cache.
 * Workers KV free tier is 100k reads and 1k writes per day. Hot Glance keys
 * (dashboard, calendar, weather, lights, drive-time) used to miss and get
 * rewritten on every poll. Those values now live in isolate memory and the
 * Cache API, which are not KV operations.
 */

type Entry = { at: number; raw: string };

const memory = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

const MAX_MEMORY_KEYS = 200;

function cacheStore(): Cache | null {
  try {
    return caches.default;
  } catch {
    return null;
  }
}

function cacheRequest(key: string): Request {
  return new Request(`https://glance-cache.invalid/v1/${encodeURIComponent(key)}`);
}

function rememberEntry(key: string, entry: Entry) {
  memory.set(key, entry);
  if (memory.size <= MAX_MEMORY_KEYS) return;
  const oldest = memory.keys().next().value;
  if (oldest) memory.delete(oldest);
}

async function readEntry(key: string, ttlSec: number): Promise<string | null> {
  const hit = memory.get(key);
  if (hit && Date.now() - hit.at < ttlSec * 1000) return hit.raw;
  const cache = cacheStore();
  if (!cache) return null;
  try {
    const response = await cache.match(cacheRequest(key));
    if (!response) return null;
    const entry = JSON.parse(await response.text()) as Entry;
    if (!entry || typeof entry.raw !== 'string' || Date.now() - entry.at >= ttlSec * 1000) {
      await cache.delete(cacheRequest(key)).catch(() => undefined);
      return null;
    }
    rememberEntry(key, entry);
    return entry.raw;
  } catch {
    return null;
  }
}

async function writeEntry(key: string, raw: string, ttlSec: number): Promise<void> {
  const entry: Entry = { at: Date.now(), raw };
  rememberEntry(key, entry);
  const cache = cacheStore();
  if (!cache) return;
  try {
    await cache.put(
      cacheRequest(key),
      new Response(JSON.stringify(entry), {
        headers: {
          'Cache-Control': `public, max-age=${Math.max(60, ttlSec)}`,
          'Content-Type': 'application/json'
        }
      })
    );
  } catch {
    /* Isolate memory still covers this request. */
  }
}

export async function remember<T>(
  key: string,
  ttlSec: number,
  load: () => Promise<T>,
  options?: { cache?: (value: T) => boolean }
): Promise<T> {
  const cached = await readEntry(key, ttlSec);
  if (cached !== null) return JSON.parse(cached) as T;
  const pending = inflight.get(key) as Promise<T> | undefined;
  if (pending) return pending;
  const promise = (async () => {
    const value = await load();
    if (!options?.cache || options.cache(value)) await writeEntry(key, JSON.stringify(value), ttlSec);
    return value;
  })().finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, promise);
  return promise;
}

export async function forgetPrefix(prefix: string): Promise<void> {
  const keys = [...memory.keys()].filter((key) => key.startsWith(prefix));
  await Promise.all(
    keys.map(async (key) => {
      memory.delete(key);
      inflight.delete(key);
      const cache = cacheStore();
      if (!cache) return;
      try {
        await cache.delete(cacheRequest(key));
      } catch {
        /* The next read rebuilds the cache. */
      }
    })
  );
}
