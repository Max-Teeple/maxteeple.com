/**
 * Precomputed Glance board, minus lights and location.
 * Those two change on their own clocks. The calendar/weather/settings core
 * is rebuilt by the 5-minute cron and read back as a string, so a poll does
 * not parse ICS or stringify the calendar again.
 * Stored in isolate memory and D1 (`glance_cache`). Not Workers KV.
 */

const CORE_ID = 'glance:board:core:v1';
/** D1 keeps the core across isolates. Memory is only a burst cache so a cron in another isolate is visible on the next poll. */
const CORE_TTL_MS = 6 * 60 * 60 * 1000;
const MEMORY_TTL_MS = 60 * 1000;

type Mem = { at: number; raw: string };

const memory = new Map<string, Mem>();

export async function readCore(db: D1Database): Promise<string | null> {
  const hit = memory.get(CORE_ID);
  if (hit && Date.now() - hit.at < MEMORY_TTL_MS) return hit.raw;
  try {
    const row = await db
      .prepare(`SELECT value, expires_at FROM glance_cache WHERE id = ?`)
      .bind(CORE_ID)
      .first<{ value: string; expires_at: number }>();
    if (!row?.value || row.expires_at < Date.now()) return null;
    memory.set(CORE_ID, { at: Date.now(), raw: row.value });
    return row.value;
  } catch {
    return null;
  }
}

export async function writeCore(db: D1Database, raw: string): Promise<void> {
  const prev = memory.get(CORE_ID);
  const at = Date.now();
  memory.set(CORE_ID, { at, raw });
  const expires = at + CORE_TTL_MS;
  try {
    if (prev && prev.raw === raw) {
      const updated = await db
        .prepare(`UPDATE glance_cache SET expires_at = ? WHERE id = ?`)
        .bind(expires, CORE_ID)
        .run();
      if (updated.meta.changes) return;
    }
    await db
      .prepare(
        `INSERT INTO glance_cache (id, value, expires_at) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at`
      )
      .bind(CORE_ID, raw, expires)
      .run();
  } catch {
    /* Isolate memory still serves this worker. */
  }
}

export async function invalidateCore(db: D1Database): Promise<void> {
  memory.delete(CORE_ID);
  try {
    await db.prepare(`DELETE FROM glance_cache WHERE id = ?`).bind(CORE_ID).run();
  } catch {
    /* The next read rebuilds the core. */
  }
}

export function composeBoard(core: string, lightsJson: string, locationJson: string): string {
  return `${core.slice(0, -1)},"lights":${lightsJson},"location":${locationJson}}`;
}
