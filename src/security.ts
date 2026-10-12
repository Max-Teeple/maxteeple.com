import { parseIdList, stringifyIdList } from './util';

/** Failed logins allowed for one IP + email before the API returns 429. */
export const LOGIN_FAIL_LIMIT = 5;
const LOGIN_FAIL_WINDOW_SEC = 15 * 60;

function loginAttemptKey(ip: string, email: string) {
  return `login-fail:${ip}:${email}`;
}

export async function loginAttemptCount(kv: KVNamespace, ip: string, email: string): Promise<number> {
  const raw = await kv.get(loginAttemptKey(ip, email));
  const count = Number(raw || '0');
  return Number.isFinite(count) && count > 0 ? count : 0;
}

export async function recordFailedLogin(kv: KVNamespace, ip: string, email: string): Promise<number> {
  const next = (await loginAttemptCount(kv, ip, email)) + 1;
  await kv.put(loginAttemptKey(ip, email), String(next), { expirationTtl: LOGIN_FAIL_WINDOW_SEC });
  return next;
}

export async function clearFailedLogins(kv: KVNamespace, ip: string, email: string) {
  await kv.delete(loginAttemptKey(ip, email));
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
