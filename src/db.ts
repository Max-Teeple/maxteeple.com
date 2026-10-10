import { coordsForCity } from './cities';
import type { Bindings } from './types';
import { boolish, nowIso, parseIdList, sqlValue, stringifyIdList, withTimestamps } from './util';

export type AccountRow = {
  id: number;
  name: string;
  first_name: string | null;
  last_name: string | null;
  city: string;
  state: string;
  street_address: string | null;
  email: string;
  role: string;
  password: string;
  description: string | null;
  stream_url: string | null;
  course_logo: string | null;
  stream_preview_photo: string | null;
  profile_picture: string | null;
  stream_key: string | null;
  stream_approved: number;
  stream_enabled: number;
  stream_approval_requested_at: string | null;
  stream_approval_note: string | null;
  favorite_course_ids: string;
  followed_course_ids: string;
  friend_ids: string;
  is_live: number;
  hls_url: string | null;
  phone: string | null;
  bio: string | null;
  interests: string | null;
  onboarding_completed: number;
  slug: string | null;
  latitude: number | null;
  longitude: number | null;
  follower_count: number;
  handicap: number | null;
  home_course: string | null;
  rounds_played: number | null;
  profile_visibility: string | null;
  push_subscription: string | null;
  is_demo: number;
  created_at: string;
  updated_at: string;
};

export type FriendRequestRow = {
  id: number;
  from_user_id: number;
  to_user_id: number | null;
  invite_email: string | null;
  invite_phone: string | null;
  status: string;
  message: string | null;
  created_at: string;
  updated_at: string;
};

const ACCOUNT_COLUMNS = [
  'name', 'first_name', 'last_name', 'city', 'state', 'street_address', 'email', 'role', 'password',
  'description', 'stream_url', 'course_logo', 'stream_preview_photo', 'profile_picture', 'stream_key',
  'stream_approved', 'stream_enabled', 'stream_approval_requested_at', 'stream_approval_note',
  'favorite_course_ids', 'followed_course_ids', 'friend_ids', 'is_live', 'hls_url', 'phone', 'bio',
  'interests', 'onboarding_completed', 'slug', 'latitude', 'longitude', 'follower_count', 'handicap',
  'home_course', 'rounds_played', 'profile_visibility', 'push_subscription', 'is_demo'
] as const;

type AccountColumn = typeof ACCOUNT_COLUMNS[number];

export function playbackUrl(row: { hls_url?: string | null; stream_url?: string | null }): string {
  return String(row.hls_url || row.stream_url || '').trim();
}

export function isHlsUrl(url: string): boolean {
  return /\.m3u8(\?|$)/i.test(url);
}

export function isPubliclyLive(row: AccountRow): boolean {
  return (row.role || 'course_owner') === 'course_owner'
    && boolish(row.stream_approved)
    && boolish(row.stream_enabled)
    && Boolean(playbackUrl(row));
}

export async function qOne<T>(db: D1Database, sql: string, ...params: unknown[]): Promise<T | null> {
  const row = await db.prepare(sql).bind(...params.map(sqlValue)).first<T>();
  return row ?? null;
}

export async function qAll<T>(db: D1Database, sql: string, ...params: unknown[]): Promise<T[]> {
  const result = await db.prepare(sql).bind(...params.map(sqlValue)).all<T>();
  return result.results ?? [];
}

export async function qRun(db: D1Database, sql: string, ...params: unknown[]) {
  return db.prepare(sql).bind(...params.map(sqlValue)).run();
}

export async function findAccountById(db: D1Database, id: number): Promise<AccountRow | null> {
  return qOne<AccountRow>(db, 'SELECT * FROM courses WHERE id = ?', id);
}

export async function findAccountByEmail(db: D1Database, email: string): Promise<AccountRow | null> {
  return qOne<AccountRow>(db, 'SELECT * FROM courses WHERE email = ?', email);
}

export async function findCourseBySlug(db: D1Database, slug: string): Promise<AccountRow | null> {
  return qOne<AccountRow>(db, `SELECT * FROM courses WHERE slug = ? AND role = 'course_owner'`, slug);
}

export async function findCourseByStreamKey(db: D1Database, streamKey: string): Promise<AccountRow | null> {
  return qOne<AccountRow>(db, `SELECT * FROM courses WHERE stream_key = ? AND role = 'course_owner'`, streamKey);
}

export async function insertAccount(db: D1Database, fields: Partial<AccountRow>): Promise<AccountRow> {
  const now = nowIso();
  const allowed = new Set<string>([...ACCOUNT_COLUMNS, 'created_at', 'updated_at']);
  const data: Record<string, unknown> = { ...fields, created_at: now, updated_at: now };
  const keys = Object.keys(data).filter((key) => allowed.has(key) && data[key] !== undefined);
  const sql = `INSERT INTO courses (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
  const result = await qRun(db, sql, ...keys.map((key) => data[key]));
  const created = await findAccountById(db, Number(result.meta.last_row_id));
  if (!created) throw new Error('Account insert failed');
  return created;
}

export async function updateAccount(db: D1Database, id: number, fields: Partial<AccountRow>): Promise<AccountRow> {
  const entries = Object.entries(fields).filter(([key, value]) =>
    (ACCOUNT_COLUMNS as readonly string[]).includes(key) && value !== undefined
  ) as [AccountColumn, unknown][];
  if (!entries.length) {
    const current = await findAccountById(db, id);
    if (!current) throw new Error('Account not found');
    return current;
  }
  const assignments = entries.map(([key]) => `${key} = ?`);
  assignments.push('updated_at = ?');
  const values = entries.map(([, value]) => value);
  values.push(nowIso());
  await qRun(db, `UPDATE courses SET ${assignments.join(', ')} WHERE id = ?`, ...values, id);
  const updated = await findAccountById(db, id);
  if (!updated) throw new Error('Account not found');
  return updated;
}

export async function ensureUniqueSlug(db: D1Database, base: string, excludeId: number | null = null): Promise<string> {
  let slug = base || 'course';
  let n = 0;
  while (n < 50) {
    const existing = await qOne<{ id: number }>(
      db,
      `SELECT id FROM courses WHERE slug = ? AND role = 'course_owner' AND id != ? LIMIT 1`,
      slug,
      excludeId ?? -1
    );
    if (!existing) return slug;
    n += 1;
    slug = `${base}-${n}`;
  }
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

export async function listByRole(db: D1Database, role: string, limit = 500): Promise<AccountRow[]> {
  return qAll<AccountRow>(
    db,
    'SELECT * FROM courses WHERE role = ? ORDER BY created_at DESC LIMIT ?',
    role,
    limit
  );
}

export async function accountsByIds(db: D1Database, ids: number[], role?: string): Promise<AccountRow[]> {
  const unique = Array.from(new Set(ids.map(Number).filter(Boolean)));
  if (!unique.length) return [];
  const marks = unique.map(() => '?').join(', ');
  const roleSql = role ? ' AND role = ?' : '';
  const rows = await qAll<AccountRow>(
    db,
    `SELECT * FROM courses WHERE id IN (${marks})${roleSql}`,
    ...unique,
    ...(role ? [role] : [])
  );
  const order = new Map(unique.map((id, index) => [id, index]));
  return rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

export async function refreshFollowerCount(db: D1Database, courseId: number): Promise<number> {
  const rows = await qAll<{ followed_course_ids: string }>(
    db,
    `SELECT followed_course_ids FROM courses WHERE role = 'consumer'`
  );
  let count = 0;
  for (const row of rows) {
    if (parseIdList(row.followed_course_ids).includes(Number(courseId))) count += 1;
  }
  await qRun(db, 'UPDATE courses SET follower_count = ?, updated_at = ? WHERE id = ?', count, nowIso(), courseId);
  return count;
}

export async function logActivity(db: D1Database, userId: number, type: string, title: string, body = '', meta: Record<string, unknown> = {}) {
  const now = nowIso();
  await qRun(
    db,
    `INSERT INTO activities (user_id, type, title, body, meta_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    userId, type, title, body, JSON.stringify(meta), now, now
  );
}

export async function logForFollowers(db: D1Database, course: AccountRow, type: string, title: string, body: string, meta: Record<string, unknown> = {}) {
  const rows = await qAll<{ id: number; followed_course_ids: string }>(
    db,
    `SELECT id, followed_course_ids FROM courses WHERE role = 'consumer' LIMIT 200`
  );
  const followers = rows.filter((row) => parseIdList(row.followed_course_ids).includes(course.id));
  for (const follower of followers) {
    await logActivity(db, follower.id, type, title, body, { ...meta, courseId: course.id });
  }
  return followers.length;
}

export async function createNotification(db: D1Database, input: { user_id: number; type: string; title: string; body?: string; link?: string }) {
  const now = nowIso();
  await qRun(
    db,
    `INSERT INTO notifications (user_id, type, title, body, link, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    input.user_id, input.type, input.title, input.body || '', input.link || '', now, now
  );
}

export function mediaUrl(stored: string | null | undefined, origin: string): string {
  if (!stored) return '';
  if (/^https?:\/\//i.test(stored)) return stored;
  const rel = stored.startsWith('/') ? stored.slice(1) : stored;
  return `${origin}/liveview/${rel}`;
}

const PREVIEW_SLUGS = new Set([
  'troon-north-golf-club', 'tpc-scottsdale-stadium-course', 'desert-mountain-golf-club',
  'grayhawk-golf-club', 'talking-stick-golf-club', 'starfire-golf-club', 'kierland-golf-club',
  'arizona-biltmore-golf-club', 'lookout-mountain-golf-club', 'we-ko-pa-golf-club',
  'encanterra-golf-club', 'phoenician-golf-club', 'cnh-industrial'
]);

export function publicAccount(row: AccountRow, includePrivate: boolean, origin: string) {
  const live = isPubliclyLive(row);
  const safe: Record<string, unknown> = {
    id: row.id,
    name: row.name,
    first_name: row.first_name,
    last_name: row.last_name,
    city: row.city,
    state: row.state,
    role: row.role || 'course_owner',
    description: row.description,
    stream_url: row.stream_url,
    course_logo: row.course_logo,
    stream_preview_photo: row.stream_preview_photo,
    profile_picture: row.profile_picture,
    stream_approved: boolish(row.stream_approved),
    stream_enabled: boolish(row.stream_enabled),
    is_live: live,
    hls_url: live && row.hls_url && isHlsUrl(row.hls_url) ? row.hls_url : null,
    slug: row.slug,
    follower_count: row.follower_count || 0,
    street_address: row.street_address,
    latitude: row.latitude,
    longitude: row.longitude,
    is_demo: boolish(row.is_demo),
    demo_label: boolish(row.is_demo) ? 'Demo data' : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };

  if ((row.role || 'course_owner') === 'course_owner' && !row.stream_preview_photo && !row.course_logo && row.slug) {
    const fallback = PREVIEW_SLUGS.has(row.slug) ? `images/courses/${row.slug}.jpg` : `images/courses/${row.slug}.jpg`;
    safe.stream_preview_photo = fallback;
  }

  for (const field of ['course_logo', 'stream_preview_photo', 'profile_picture'] as const) {
    if (safe[field]) safe[`${field}_url`] = mediaUrl(String(safe[field]), origin);
  }

  if (includePrivate) {
    safe.email = row.email;
    safe.stream_key = row.stream_key;
    safe.hls_url = row.hls_url;
    safe.stream_approval_requested_at = row.stream_approval_requested_at;
    safe.stream_approval_note = row.stream_approval_note;
    safe.favorite_course_ids = parseIdList(row.favorite_course_ids);
    safe.followed_course_ids = parseIdList(row.followed_course_ids);
    safe.friend_ids = parseIdList(row.friend_ids);
    safe.phone = row.phone;
    safe.bio = row.bio;
    safe.interests = row.interests;
    safe.onboarding_completed = boolish(row.onboarding_completed);
    safe.handicap = row.handicap;
    safe.home_course = row.home_course;
    safe.rounds_played = row.rounds_played;
    safe.profile_visibility = row.profile_visibility || 'friends';
  } else if ((row.role || 'course_owner') === 'consumer') {
    safe.bio = row.bio;
    safe.interests = row.interests;
    safe.handicap = row.handicap;
    safe.home_course = row.home_course;
    safe.rounds_played = row.rounds_played;
  }

  return safe;
}

export function consumerPreview(row: AccountRow, origin: string) {
  return {
    id: row.id,
    name: row.name,
    city: row.city,
    state: row.state,
    bio: row.bio,
    interests: row.interests,
    profile_picture: row.profile_picture,
    profile_picture_url: row.profile_picture ? mediaUrl(row.profile_picture, origin) : '',
    is_demo: boolish(row.is_demo)
  };
}

export async function serializeFriendRequest(db: D1Database, request: FriendRequestRow, origin: string) {
  const fromUser = await findAccountById(db, request.from_user_id);
  const toUser = request.to_user_id ? await findAccountById(db, request.to_user_id) : null;
  return {
    id: request.id,
    status: request.status,
    message: request.message,
    invite_email: request.invite_email,
    invite_phone: request.invite_phone,
    createdAt: request.created_at,
    from: fromUser ? consumerPreview(fromUser, origin) : null,
    to: toUser ? consumerPreview(toUser, origin) : null
  };
}

export async function attachPendingInvites(db: D1Database, account: AccountRow) {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (account.email) {
    clauses.push('invite_email = ?');
    params.push(account.email);
  }
  if (account.phone) {
    clauses.push('invite_phone = ?');
    params.push(account.phone);
  }
  if (!clauses.length) return;
  const pending = await qAll<FriendRequestRow>(
    db,
    `SELECT * FROM friend_requests WHERE status = 'pending' AND to_user_id IS NULL AND (${clauses.join(' OR ')})`,
    ...params
  );
  for (const request of pending) {
    await qRun(db, 'UPDATE friend_requests SET to_user_id = ?, updated_at = ? WHERE id = ?', account.id, nowIso(), request.id);
  }
}

export async function linkFriends(db: D1Database, userA: AccountRow, userB: AccountRow) {
  const idsA = parseIdList(userA.friend_ids);
  const idsB = parseIdList(userB.friend_ids);
  if (!idsA.includes(userB.id)) {
    await updateAccount(db, userA.id, { friend_ids: stringifyIdList([...idsA, userB.id]) });
  }
  if (!idsB.includes(userA.id)) {
    await updateAccount(db, userB.id, { friend_ids: stringifyIdList([...idsB, userA.id]) });
  }
}

export function fillMissingCoords(city: string, state: string) {
  return coordsForCity(city, state);
}

export function stamp<T extends { created_at?: string | null; updated_at?: string | null }>(row: T) {
  return withTimestamps(row);
}

export function appLink(path: string): string {
  if (path.startsWith('/liveview/')) return path;
  if (path.startsWith('/')) return `/liveview${path}`;
  return `/liveview/${path}`;
}

export function siteBase(env: Bindings, requestUrl: string): string {
  const configured = env.SITE_URL?.replace(/\/$/, '');
  if (configured) return configured;
  return `${new URL(requestUrl).origin}/liveview`;
}

export function publicOrigin(env: Bindings, requestUrl: string): string {
  const configured = env.SITE_URL;
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      /* use the request origin */
    }
  }
  return new URL(requestUrl).origin;
}
