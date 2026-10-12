import { parseIdList, stringifyIdList } from './util';

/** Failed logins allowed for one IP + email before the API returns 429. */
export const LOGIN_FAIL_LIMIT = 5;
const LOGIN_FAIL_WINDOW_SEC = 15 * 60;

const localFails = new Map<string, { count: number; resetAt: number }>();

function loginAttemptKey(ip: string, email: string) {
  return `login-fail:${ip}:${email}`;
}

function attemptKeys(ip: string, email: string) {
  return [loginAttemptKey(ip, email), loginAttemptKey('email', email)];
}

function localCount(key: string): number {
  const row = localFails.get(key);
  if (!row || row.resetAt <= Date.now()) return 0;
  return row.count;
}

async function ensureAttemptTable(db: D1Database) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS login_attempt_counts (
        id TEXT PRIMARY KEY,
        attempt_count INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      )`
    )
    .run();
}

/**
 * Count is authoritative in D1 so back-to-back failures still add up.
 * KV is written as a mirror; a KV-only counter stays at 1 under eventual consistency.
 */
async function readAttempt(db: D1Database, kv: KVNamespace, key: string): Promise<number> {
  const row = await db
    .prepare(`SELECT attempt_count, updated_at FROM login_attempt_counts WHERE id = ?`)
    .bind(key)
    .first<{ attempt_count: number; updated_at: string }>();
  let stored = 0;
  if (row?.updated_at) {
    const ageSec = (Date.now() - Date.parse(row.updated_at)) / 1000;
    if (Number.isFinite(ageSec) && ageSec >= 0 && ageSec < LOGIN_FAIL_WINDOW_SEC) stored = Number(row.attempt_count) || 0;
  }
  let mirrored = 0;
  try {
    mirrored = Number(await kv.get(key) || '0') || 0;
  } catch {
    mirrored = 0;
  }
  return Math.max(stored, mirrored, localCount(key));
}

export async function loginAttemptCount(db: D1Database, kv: KVNamespace, ip: string, email: string): Promise<number> {
  await ensureAttemptTable(db);
  const counts = await Promise.all(attemptKeys(ip, email).map((key) => readAttempt(db, kv, key)));
  return Math.max(...counts, 0);
}

async function bumpAttempt(db: D1Database, kv: KVNamespace, key: string, now: string): Promise<number> {
  const existing = await db
    .prepare(`SELECT attempt_count, updated_at FROM login_attempt_counts WHERE id = ?`)
    .bind(key)
    .first<{ attempt_count: number; updated_at: string }>();
  let next = 1;
  if (existing?.updated_at) {
    const ageSec = (Date.now() - Date.parse(existing.updated_at)) / 1000;
    if (!Number.isFinite(ageSec) || (ageSec >= 0 && ageSec < LOGIN_FAIL_WINDOW_SEC)) {
      next = (Number(existing.attempt_count) || 0) + 1;
    }
  }
  await db
    .prepare(
      `INSERT INTO login_attempt_counts (id, attempt_count, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET attempt_count = excluded.attempt_count, updated_at = excluded.updated_at`
    )
    .bind(key, next, now)
    .run();
  localFails.set(key, { count: next, resetAt: Date.now() + LOGIN_FAIL_WINDOW_SEC * 1000 });
  try {
    await kv.put(key, String(next), { expirationTtl: LOGIN_FAIL_WINDOW_SEC });
  } catch {
    /* The D1 row still enforces the limit when KV is briefly unavailable. */
  }
  return next;
}

export async function recordFailedLogin(db: D1Database, kv: KVNamespace, ip: string, email: string): Promise<number> {
  const now = new Date().toISOString();
  await ensureAttemptTable(db);
  const counts = [];
  for (const key of attemptKeys(ip, email)) {
    counts.push(await bumpAttempt(db, kv, key, now));
  }
  return Math.max(...counts, 0);
}

export async function clearFailedLogins(db: D1Database, kv: KVNamespace, ip: string, email: string) {
  await ensureAttemptTable(db);
  for (const key of attemptKeys(ip, email)) {
    localFails.delete(key);
    await db.prepare(`DELETE FROM login_attempt_counts WHERE id = ?`).bind(key).run();
    try {
      await kv.delete(key);
    } catch {
      /* ignore */
    }
  }
}

/** Removed from production. Purged on each boot until the row is gone. */
const RETIRED_TEST_EMAIL = 'casey.prod.check@example.com';

/**
 * Demo accounts stay fans and courses. They never keep role `admin`.
 * Also deletes the one-off production test account and rows that point at it.
 */
export async function enforceAccountPolicy(db: D1Database): Promise<void> {
  await db
    .prepare(
      `UPDATE courses
       SET role = 'consumer', updated_at = ?
       WHERE role = 'admin' AND (is_demo = 1 OR email LIKE '%@liveview.demo')`
    )
    .bind(new Date().toISOString())
    .run();

  const account = await db
    .prepare(`SELECT id FROM courses WHERE email = ?`)
    .bind(RETIRED_TEST_EMAIL)
    .first<{ id: number }>();
  if (!account) return;
  await purgeAccount(db, account.id, RETIRED_TEST_EMAIL);
}

async function purgeAccount(db: D1Database, id: number, email: string): Promise<void> {
  const lists = await db
    .prepare(`SELECT id, friend_ids, favorite_course_ids, followed_course_ids FROM courses WHERE id != ?`)
    .bind(id)
    .all<{ id: number; friend_ids: string; favorite_course_ids: string; followed_course_ids: string }>();
  for (const row of lists.results ?? []) {
    const friends = parseIdList(row.friend_ids);
    const favorites = parseIdList(row.favorite_course_ids);
    const followed = parseIdList(row.followed_course_ids);
    const nextFriends = friends.filter((value) => value !== id);
    const nextFavorites = favorites.filter((value) => value !== id);
    const nextFollowed = followed.filter((value) => value !== id);
    if (
      nextFriends.length === friends.length
      && nextFavorites.length === favorites.length
      && nextFollowed.length === followed.length
    ) continue;
    await db
      .prepare(`UPDATE courses SET friend_ids = ?, favorite_course_ids = ?, followed_course_ids = ? WHERE id = ?`)
      .bind(stringifyIdList(nextFriends), stringifyIdList(nextFavorites), stringifyIdList(nextFollowed), row.id)
      .run();
  }

  const groups = await db
    .prepare(`SELECT id, member_ids, created_by FROM lv_groups`)
    .all<{ id: number; member_ids: string; created_by: number }>();
  for (const group of groups.results ?? []) {
    if (group.created_by === id) {
      await db.prepare(`DELETE FROM lv_groups WHERE id = ?`).bind(group.id).run();
      continue;
    }
    const members = parseIdList(group.member_ids);
    const next = members.filter((value) => value !== id);
    if (next.length === members.length) continue;
    await db
      .prepare(`UPDATE lv_groups SET member_ids = ? WHERE id = ?`)
      .bind(stringifyIdList(next), group.id)
      .run();
  }

  await db.prepare(`DELETE FROM friend_requests WHERE from_user_id = ? OR to_user_id = ? OR invite_email = ?`).bind(id, id, email).run();
  await db.prepare(`DELETE FROM activities WHERE user_id = ?`).bind(id).run();
  await db.prepare(`DELETE FROM notifications WHERE user_id = ?`).bind(id).run();
  await db.prepare(`DELETE FROM messages WHERE from_user_id = ? OR to_user_id = ?`).bind(id, id).run();
  await db.prepare(`DELETE FROM stream_highlights WHERE course_id = ?`).bind(id).run();
  await db.prepare(`DELETE FROM courses WHERE id = ?`).bind(id).run();
}

/** Deletes one non-demo account and rows that point at it, including install requests. */
export async function deleteAccount(db: D1Database, id: number, email: string): Promise<void> {
  await db.prepare(`DELETE FROM install_requests WHERE account_id = ? OR email = ?`).bind(id, email).run();
  await db.prepare(`DELETE FROM course_holes WHERE course_id = ?`).bind(id).run();
  await db.prepare(`DELETE FROM course_overlays WHERE course_id = ?`).bind(id).run();
  await db.prepare(`DELETE FROM watch_party_messages WHERE user_id = ? OR course_id = ?`).bind(id, id).run();
  await db.prepare(`DELETE FROM watch_parties WHERE course_id = ?`).bind(id).run();
  await purgeAccount(db, id, email);
}
