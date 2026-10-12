import { coordsForCity } from './cities';
import {
  findAccountByEmail,
  insertAccount,
  qAll,
  qRun,
  updateAccount,
  type AccountRow
} from './db';
import { nowIso, parseIdList, slugify, stringifyIdList } from './util';
import demoCourses from './demo-courses.json';

/** Precomputed PBKDF2-SHA256 (8000 iterations) of the demo password `demo1234`. */
export const DEMO_PASSWORD = 'demo1234';
export const DEMO_PASSWORD_HASH = 'pbkdf2$8000$EJmhoxmizfCYMqM1ph-bcw$c0Au8749fgt_McShC09QBYfm7gWkAnD-LMCKk5X2uIk';
export const DEMO_FAN_EMAIL = 'demo-user-001@liveview.demo';
/** Bump this when demo courses, clips, or follows should be rebuilt in production. */
export const DEMO_SEED_VERSION = 'fictional-50-mp4-v1';

const CLIPS = [
  '/liveview/demo-streams/tee-shot.mp4',
  '/liveview/demo-streams/fairway.mp4',
  '/liveview/demo-streams/green.mp4',
  '/liveview/demo-streams/swing.mp4',
  '/liveview/demo-streams/lesson.mp4'
];

const FAMOUS_COURSE_NAMES = [
  'pebble beach golf links',
  'augusta national golf club',
  'augusta national',
  'tpc sawgrass',
  'torrey pines golf course',
  'bethpage black course',
  'whistling straits',
  'kiawah island ocean course',
  'bandon dunes golf resort',
  'chambers bay golf course',
  'oakmont country club',
  'winged foot golf club',
  'shinnecock hills golf club',
  'merion golf club',
  'riviera country club',
  'muirfield village golf club',
  'east lake golf club',
  'quail hollow club',
  'congressional country club',
  'hazeltine national golf club',
  'southern hills country club',
  'olympia fields country club',
  'medinah country club',
  'baltusrol golf club',
  'oak hill country club',
  'pinehurst no. 2',
  'harbour town golf links',
  'bay hill club & lodge',
  'waialae country club',
  'kapalua plantation course',
  'desert mountain golf club',
  'tpc scottsdale stadium course',
  'firestone country club',
  'colonial country club',
  'valhalla golf club',
  'erin hills golf course',
  'liberty national golf club',
  'trump national doral',
  'streamsong resort red course',
  'sand valley golf resort',
  'prairie dunes country club',
  'interlachen country club',
  'cherry hills country club',
  'castle pines golf club',
  'shadow creek golf course',
  'wolf creek golf course',
  'pasatiempo golf club',
  'spyglass hill golf course',
  'cypress point club',
  'monterey peninsula country club',
  'seminole golf club'
];

const FIRST_NAMES = [
  'Alex', 'Jordan', 'Taylor', 'Morgan', 'Casey', 'Riley', 'Jamie', 'Quinn', 'Avery', 'Blake',
  'Cameron', 'Drew', 'Elliot', 'Finley', 'Harper', 'Jesse', 'Kai', 'Logan', 'Noah', 'Parker',
  'Reese', 'Sage', 'Skyler', 'Terry', 'Val', 'Wren', 'Chris', 'Dana', 'Eden', 'Frankie'
];

const LAST_NAMES = [
  'Anderson', 'Brooks', 'Carter', 'Diaz', 'Evans', 'Foster', 'Garcia', 'Hayes', 'Irving', 'Johnson',
  'Kim', 'Lopez', 'Martin', 'Nguyen', 'Owens', 'Patel', 'Quinn', 'Reed', 'Singh', 'Turner',
  'Upton', 'Vega', 'Walker', 'Young', 'Zhang', 'Bennett', 'Clark', 'Davis', 'Edwards', 'Fisher'
];

const CONSUMER_LOCATIONS = [
  { city: 'Phoenix', state: 'AZ' }, { city: 'Scottsdale', state: 'AZ' }, { city: 'Los Angeles', state: 'CA' },
  { city: 'San Diego', state: 'CA' }, { city: 'San Francisco', state: 'CA' }, { city: 'Sacramento', state: 'CA' },
  { city: 'Austin', state: 'TX' }, { city: 'Dallas', state: 'TX' }, { city: 'Houston', state: 'TX' },
  { city: 'Miami', state: 'FL' }, { city: 'Orlando', state: 'FL' }, { city: 'Tampa', state: 'FL' },
  { city: 'Atlanta', state: 'GA' }, { city: 'Charlotte', state: 'NC' }, { city: 'Chicago', state: 'IL' },
  { city: 'Denver', state: 'CO' }, { city: 'Seattle', state: 'WA' }, { city: 'Portland', state: 'OR' },
  { city: 'Las Vegas', state: 'NV' }, { city: 'Boston', state: 'MA' }, { city: 'New York', state: 'NY' },
  { city: 'Philadelphia', state: 'PA' }, { city: 'Nashville', state: 'TN' }, { city: 'Minneapolis', state: 'MN' },
  { city: 'Detroit', state: 'MI' }
];

const INTERESTS = [
  'watching live streams,local courses',
  'tournament golf,casual rounds',
  'local courses,course photography',
  'watching live streams,tournament golf',
  'casual rounds,local courses'
];

type DemoCourse = { name: string; city: string; state: string; logo: string; cover: string };

function clipFor(index: number) {
  return CLIPS[index % CLIPS.length];
}

async function batch(db: D1Database, statements: D1PreparedStatement[]) {
  const size = 20;
  for (let i = 0; i < statements.length; i += size) {
    await db.batch(statements.slice(i, i + size));
  }
}

async function deleteByIds(db: D1Database, table: string, column: string, ids: number[]) {
  if (!ids.length) return;
  const marks = ids.map(() => '?').join(', ');
  await db.prepare(`DELETE FROM ${table} WHERE ${column} IN (${marks})`).bind(...ids).run();
}

async function purgeDemoCourses(db: D1Database) {
  const famousMarks = FAMOUS_COURSE_NAMES.map(() => '?').join(', ');
  const rows = await qAll<{ id: number }>(
    db,
    `SELECT id FROM courses
     WHERE role = 'course_owner' AND (
       is_demo = 1
       OR email LIKE '%@liveview.demo'
       OR IFNULL(stream_url, '') LIKE '%liveview.demo%'
       OR IFNULL(stream_url, '') LIKE '%mux.dev%'
       OR IFNULL(hls_url, '') LIKE '%mux.dev%'
       OR IFNULL(stream_url, '') LIKE '%aqz-KE-bpKQ%'
       OR IFNULL(stream_url, '') LIKE '%76979871%'
       OR IFNULL(hls_url, '') LIKE '%aqz-KE-bpKQ%'
       OR LOWER(name) IN (${famousMarks})
     )`,
    ...FAMOUS_COURSE_NAMES
  );
  const ids = rows.map((row) => row.id);
  if (!ids.length) return ids;

  await deleteByIds(db, 'stream_highlights', 'course_id', ids);
  const watchMessages = await db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'watch_party_messages'`)
    .first<{ name: string }>();
  if (watchMessages) {
    await deleteByIds(db, 'watch_party_messages', 'course_id', ids);
    await deleteByIds(db, 'watch_parties', 'course_id', ids);
  }
  await deleteByIds(db, 'courses', 'id', ids);

  const removed = new Set(ids);
  const accounts = await qAll<{ id: number; friend_ids: string; favorite_course_ids: string; followed_course_ids: string }>(
    db,
    `SELECT id, friend_ids, favorite_course_ids, followed_course_ids FROM courses`
  );
  const scrub: D1PreparedStatement[] = [];
  for (const account of accounts) {
    const friends = parseIdList(account.friend_ids).filter((id) => !removed.has(id));
    const favorites = parseIdList(account.favorite_course_ids).filter((id) => !removed.has(id));
    const followed = parseIdList(account.followed_course_ids).filter((id) => !removed.has(id));
    if (
      friends.length === parseIdList(account.friend_ids).length
      && favorites.length === parseIdList(account.favorite_course_ids).length
      && followed.length === parseIdList(account.followed_course_ids).length
    ) continue;
    scrub.push(
      db.prepare(`UPDATE courses SET friend_ids = ?, favorite_course_ids = ?, followed_course_ids = ? WHERE id = ?`).bind(
        stringifyIdList(friends),
        stringifyIdList(favorites),
        stringifyIdList(followed),
        account.id
      )
    );
  }
  await batch(db, scrub);
  return ids;
}

export async function seedDemoData(db: D1Database) {
  await purgeDemoCourses(db);
  const now = nowIso();
  const courses = demoCourses as DemoCourse[];
  const courseStatements: D1PreparedStatement[] = [];
  const liveIndexes = new Set<number>();

  courses.forEach((course, i) => {
    const email = `demo-course-${String(i + 1).padStart(2, '0')}@liveview.demo`;
    const clip = clipFor(i);
    const bucket = i % 5;
    const approved = bucket !== 1;
    const enabled = bucket === 0;
    if (enabled) liveIndexes.add(i);
    const coords = coordsForCity(course.city, course.state);
    const nextStream = enabled
      ? null
      : new Date(Date.now() + (i + 1) * 60 * 60 * 1000).toISOString();
    courseStatements.push(db.prepare(`
      INSERT INTO courses (
        name, city, state, email, role, password, slug, latitude, longitude, description,
        stream_url, hls_url, course_logo, stream_preview_photo, is_live, stream_approved,
        stream_enabled, stream_approval_requested_at, next_stream_at, onboarding_completed,
        is_demo, follower_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'course_owner', ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 1, 1, 0, ?, ?)
    `).bind(
      course.name,
      course.city,
      course.state,
      email,
      DEMO_PASSWORD_HASH,
      slugify(course.name),
      coords.latitude,
      coords.longitude,
      `${course.name} is a fictional sample listing in ${course.city}, ${course.state}. The picture is a free-license golf clip, not a live broadcast.`,
      clip,
      course.logo,
      course.cover,
      enabled ? 1 : 0,
      approved ? 1 : 0,
      enabled ? 1 : 0,
      approved ? null : now,
      nextStream,
      now,
      now
    ));
  });
  await batch(db, courseStatements);

  const courseRows = await qAll<{ id: number; email: string; name: string }>(
    db,
    `SELECT id, email, name FROM courses WHERE email LIKE 'demo-course-%@liveview.demo' AND role = 'course_owner' ORDER BY email`
  );
  if (courseRows.length !== courses.length) {
    throw new Error(`Expected ${courses.length} demo courses, found ${courseRows.length}`);
  }

  const highlightStatements: D1PreparedStatement[] = [];
  courseRows.forEach((course, i) => {
    const replay = clipFor(i + 2);
    const recorded = new Date(Date.now() - (i + 1) * 3600 * 1000).toISOString();
    highlightStatements.push(db.prepare(
      `INSERT INTO stream_highlights (course_id, title, hls_url, thumb_url, recorded_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(course.id, `Replay — ${course.name}`, replay, null, recorded, now, now));
    if (i % 3 === 0) {
      highlightStatements.push(db.prepare(
        `INSERT INTO stream_highlights (course_id, title, hls_url, thumb_url, recorded_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        course.id,
        `Earlier replay — ${course.name}`,
        clipFor(i + 4),
        null,
        new Date(Date.now() - (i + 3) * 86400 * 1000).toISOString(),
        now,
        now
      ));
    }
  });
  await batch(db, highlightStatements);

  const userStatements: D1PreparedStatement[] = [];
  for (let i = 0; i < 80; i++) {
    const first = FIRST_NAMES[i % FIRST_NAMES.length];
    const last = LAST_NAMES[Math.floor(i / FIRST_NAMES.length) % LAST_NAMES.length];
    const loc = CONSUMER_LOCATIONS[i % CONSUMER_LOCATIONS.length];
    const email = `demo-user-${String(i + 1).padStart(3, '0')}@liveview.demo`;
    const followed = [0, 1, 2, 3].map((step) => courseRows[(i + step * 7) % courseRows.length].id);
    const favorites = [courseRows[(i + 2) % courseRows.length].id];
    userStatements.push(db.prepare(`
      INSERT INTO courses (
        name, first_name, last_name, city, state, email, role, password, phone, bio, interests,
        followed_course_ids, favorite_course_ids, onboarding_completed, is_demo, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'consumer', ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)
      ON CONFLICT(email) DO UPDATE SET
        name = excluded.name,
        first_name = excluded.first_name,
        last_name = excluded.last_name,
        city = excluded.city,
        state = excluded.state,
        bio = excluded.bio,
        interests = excluded.interests,
        followed_course_ids = excluded.followed_course_ids,
        favorite_course_ids = excluded.favorite_course_ids,
        onboarding_completed = 1,
        is_demo = 1,
        updated_at = excluded.updated_at
    `).bind(
      `${first} ${last}`,
      first,
      last,
      loc.city,
      loc.state,
      email,
      DEMO_PASSWORD_HASH,
      `555-01${String(i).padStart(2, '0')}`,
      `Golf fan from ${loc.city}, ${loc.state}.`,
      INTERESTS[i % INTERESTS.length],
      stringifyIdList(followed),
      stringifyIdList(favorites),
      now,
      now
    ));
  }
  await batch(db, userStatements);

  const followerCounts = new Map<number, number>();
  for (let i = 0; i < 80; i++) {
    for (const step of [0, 1, 2, 3]) {
      const id = courseRows[(i + step * 7) % courseRows.length].id;
      followerCounts.set(id, (followerCounts.get(id) || 0) + 1);
    }
  }
  const countStatements = courseRows.map((course) => db.prepare(
    `UPDATE courses SET follower_count = ? WHERE id = ?`
  ).bind(followerCounts.get(course.id) || 0, course.id));
  await batch(db, countStatements);

  await db
    .prepare(
      `UPDATE courses
       SET role = 'consumer', updated_at = ?
       WHERE role = 'admin' AND (is_demo = 1 OR email LIKE '%@liveview.demo')`
    )
    .bind(now)
    .run();

  await db
    .prepare(`INSERT INTO app_secrets (id, value) VALUES ('demo_seed_version', ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value`)
    .bind(DEMO_SEED_VERSION)
    .run();

  return {
    demo: true,
    label: 'Demo data',
    password: DEMO_PASSWORD,
    courses: { created: courses.length, updated: 0, total: courses.length, live: liveIndexes.size },
    accounts: { created: 0, updated: 0, total: 80 },
    highlights: highlightStatements.length,
    exampleCourseLogin: 'demo-course-01@liveview.demo',
    exampleUserLogin: DEMO_FAN_EMAIL
  };
}

export async function ensureDemoCatalog(db: D1Database) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS app_secrets (
        id TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )`
    )
    .run();
  const row = await db
    .prepare(`SELECT value FROM app_secrets WHERE id = 'demo_seed_version'`)
    .first<{ value: string }>();
  if (row?.value === DEMO_SEED_VERSION) return;
  await seedDemoData(db);
}

export async function upsertAccount(db: D1Database, email: string, fields: Partial<AccountRow>) {
  const existing = await findAccountByEmail(db, email);
  if (!existing) return insertAccount(db, { ...fields, email });
  return updateAccount(db, existing.id, fields);
}
