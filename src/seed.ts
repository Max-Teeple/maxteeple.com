import {
  ensureUniqueSlug,
  findAccountByEmail,
  insertAccount,
  qAll,
  qRun,
  updateAccount,
  type AccountRow
} from './db';
import { coordsForCity } from './cities';
import { nowIso, slugify } from './util';

/** Precomputed PBKDF2-SHA256 (8000 iterations) of the demo password `demo1234`. */
export const DEMO_PASSWORD = 'demo1234';
export const DEMO_PASSWORD_HASH = 'pbkdf2$8000$EJmhoxmizfCYMqM1ph-bcw$c0Au8749fgt_McShC09QBYfm7gWkAnD-LMCKk5X2uIk';

const YOUTUBE = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ';
const HLS = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';
const VIMEO = 'https://vimeo.com/76979871';

const REAL_GOLF_COURSES = [
  { name: 'Pebble Beach Golf Links', city: 'Pebble Beach', state: 'CA' },
  { name: 'Augusta National Golf Club', city: 'Augusta', state: 'GA' },
  { name: 'TPC Sawgrass', city: 'Ponte Vedra Beach', state: 'FL' },
  { name: 'Torrey Pines Golf Course', city: 'La Jolla', state: 'CA' },
  { name: 'Bethpage Black Course', city: 'Farmingdale', state: 'NY' },
  { name: 'Whistling Straits', city: 'Haven', state: 'WI' },
  { name: 'Kiawah Island Ocean Course', city: 'Kiawah Island', state: 'SC' },
  { name: 'Bandon Dunes Golf Resort', city: 'Bandon', state: 'OR' },
  { name: 'Chambers Bay Golf Course', city: 'University Place', state: 'WA' },
  { name: 'Oakmont Country Club', city: 'Oakmont', state: 'PA' },
  { name: 'Winged Foot Golf Club', city: 'Mamaroneck', state: 'NY' },
  { name: 'Shinnecock Hills Golf Club', city: 'Southampton', state: 'NY' },
  { name: 'Merion Golf Club', city: 'Ardmore', state: 'PA' },
  { name: 'Riviera Country Club', city: 'Pacific Palisades', state: 'CA' },
  { name: 'Muirfield Village Golf Club', city: 'Dublin', state: 'OH' },
  { name: 'East Lake Golf Club', city: 'Atlanta', state: 'GA' },
  { name: 'Quail Hollow Club', city: 'Charlotte', state: 'NC' },
  { name: 'Congressional Country Club', city: 'Bethesda', state: 'MD' },
  { name: 'Hazeltine National Golf Club', city: 'Chaska', state: 'MN' },
  { name: 'Southern Hills Country Club', city: 'Tulsa', state: 'OK' },
  { name: 'Olympia Fields Country Club', city: 'Olympia Fields', state: 'IL' },
  { name: 'Medinah Country Club', city: 'Medinah', state: 'IL' },
  { name: 'Baltusrol Golf Club', city: 'Springfield', state: 'NJ' },
  { name: 'Oak Hill Country Club', city: 'Pittsford', state: 'NY' },
  { name: 'Pinehurst No. 2', city: 'Pinehurst', state: 'NC' },
  { name: 'Harbour Town Golf Links', city: 'Hilton Head Island', state: 'SC' },
  { name: 'Bay Hill Club & Lodge', city: 'Orlando', state: 'FL' },
  { name: 'Waialae Country Club', city: 'Honolulu', state: 'HI' },
  { name: 'Kapalua Plantation Course', city: 'Lahaina', state: 'HI' },
  { name: 'Desert Mountain Golf Club', city: 'Scottsdale', state: 'AZ' },
  { name: 'TPC Scottsdale Stadium Course', city: 'Scottsdale', state: 'AZ' },
  { name: 'Firestone Country Club', city: 'Akron', state: 'OH' },
  { name: 'Colonial Country Club', city: 'Fort Worth', state: 'TX' },
  { name: 'Valhalla Golf Club', city: 'Louisville', state: 'KY' },
  { name: 'Erin Hills Golf Course', city: 'Erin', state: 'WI' },
  { name: 'Liberty National Golf Club', city: 'Jersey City', state: 'NJ' },
  { name: 'Trump National Doral', city: 'Miami', state: 'FL' },
  { name: 'Streamsong Resort Red Course', city: 'Bowling Green', state: 'FL' },
  { name: 'Sand Valley Golf Resort', city: 'Nekoosa', state: 'WI' },
  { name: 'Prairie Dunes Country Club', city: 'Hutchinson', state: 'KS' },
  { name: 'Interlachen Country Club', city: 'Edina', state: 'MN' },
  { name: 'Cherry Hills Country Club', city: 'Cherry Hills Village', state: 'CO' },
  { name: 'Castle Pines Golf Club', city: 'Castle Rock', state: 'CO' },
  { name: 'Shadow Creek Golf Course', city: 'North Las Vegas', state: 'NV' },
  { name: 'Wolf Creek Golf Course', city: 'Mesquite', state: 'NV' },
  { name: 'Pasatiempo Golf Club', city: 'Santa Cruz', state: 'CA' },
  { name: 'Spyglass Hill Golf Course', city: 'Pebble Beach', state: 'CA' },
  { name: 'Cypress Point Club', city: 'Pebble Beach', state: 'CA' },
  { name: 'Monterey Peninsula Country Club', city: 'Pebble Beach', state: 'CA' },
  { name: 'Seminole Golf Club', city: 'Juno Beach', state: 'FL' }
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

function emailSlug(name: string) {
  return slugify(name).slice(0, 40);
}

function demoPlayback(index: number, name: string) {
  if (index % 15 === 0) return { stream_url: YOUTUBE, hls_url: null as string | null, kind: 'youtube' };
  if (index % 15 === 5) return { stream_url: HLS, hls_url: HLS, kind: 'hls' };
  if (index % 15 === 10) return { stream_url: VIMEO, hls_url: null, kind: 'vimeo' };
  return { stream_url: `https://liveview.demo/streams/${emailSlug(name)}`, hls_url: null, kind: 'placeholder' };
}

async function batch(db: D1Database, statements: D1PreparedStatement[]) {
  const size = 20;
  for (let i = 0; i < statements.length; i += size) {
    await db.batch(statements.slice(i, i + size));
  }
}

export async function seedDemoData(db: D1Database) {
  const existing = await qAll<{ email: string }>(db, `SELECT email FROM courses WHERE email LIKE '%@liveview.demo'`);
  const existingEmails = new Set(existing.map((row) => row.email));
  const now = nowIso();
  let coursesCreated = 0;
  let coursesUpdated = 0;
  let accountsCreated = 0;
  let accountsUpdated = 0;
  let highlights = 0;

  const courseStatements: D1PreparedStatement[] = [];
  const liveForHighlights: { email: string; title: string; url: string }[] = [];

  for (let i = 0; i < REAL_GOLF_COURSES.length; i++) {
    const course = REAL_GOLF_COURSES[i];
    const slug = await ensureUniqueSlug(db, slugify(course.name));
    const email = `demo-course-${String(i + 1).padStart(2, '0')}-${emailSlug(course.name)}@liveview.demo`;
    const isLive = i % 5 === 0;
    const approved = i % 3 !== 1;
    const playback = demoPlayback(i, course.name);
    const coords = coordsForCity(course.city, course.state);
    const enabled = isLive && approved;
    if (existingEmails.has(email)) coursesUpdated += 1;
    else coursesCreated += 1;

    courseStatements.push(db.prepare(`
      INSERT INTO courses (
        name, city, state, email, role, password, slug, latitude, longitude, description,
        stream_url, hls_url, is_live, stream_approved, stream_enabled, stream_approval_requested_at,
        onboarding_completed, is_demo, follower_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'course_owner', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 0, ?, ?)
      ON CONFLICT(email) DO UPDATE SET
        name = excluded.name,
        city = excluded.city,
        state = excluded.state,
        description = excluded.description,
        stream_url = excluded.stream_url,
        hls_url = excluded.hls_url,
        is_live = excluded.is_live,
        stream_approved = excluded.stream_approved,
        stream_enabled = excluded.stream_enabled,
        stream_approval_requested_at = excluded.stream_approval_requested_at,
        slug = COALESCE(courses.slug, excluded.slug),
        latitude = COALESCE(courses.latitude, excluded.latitude),
        longitude = COALESCE(courses.longitude, excluded.longitude),
        onboarding_completed = 1,
        is_demo = 1,
        updated_at = excluded.updated_at
    `).bind(
      course.name,
      course.city,
      course.state,
      email,
      DEMO_PASSWORD_HASH,
      slug,
      coords.latitude,
      coords.longitude,
      `${course.name} — Demo data. Sample listing for search, the map, and embedded streams. Not a real broadcast.`,
      playback.stream_url,
      enabled ? playback.hls_url : null,
      enabled ? 1 : 0,
      approved ? 1 : 0,
      enabled ? 1 : 0,
      approved ? null : now,
      now,
      now
    ));

    if (enabled && playback.stream_url && playback.kind !== 'placeholder') {
      liveForHighlights.push({
        email,
        title: `Demo replay — ${course.name}`,
        url: playback.hls_url || playback.stream_url
      });
    }
  }

  await batch(db, courseStatements);

  const userStatements: D1PreparedStatement[] = [];
  for (let i = 0; i < 80; i++) {
    const first = FIRST_NAMES[i % FIRST_NAMES.length];
    const last = LAST_NAMES[Math.floor(i / FIRST_NAMES.length) % LAST_NAMES.length];
    const loc = CONSUMER_LOCATIONS[i % CONSUMER_LOCATIONS.length];
    const email = `demo-user-${String(i + 1).padStart(3, '0')}@liveview.demo`;
    if (existingEmails.has(email)) accountsUpdated += 1;
    else accountsCreated += 1;
    userStatements.push(db.prepare(`
      INSERT INTO courses (
        name, first_name, last_name, city, state, email, role, password, phone, bio, interests,
        onboarding_completed, is_demo, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'consumer', ?, ?, ?, ?, 1, 1, ?, ?)
      ON CONFLICT(email) DO UPDATE SET
        name = excluded.name,
        first_name = excluded.first_name,
        last_name = excluded.last_name,
        city = excluded.city,
        state = excluded.state,
        bio = excluded.bio,
        interests = excluded.interests,
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
      `Demo data. Golf fan from ${loc.city}, ${loc.state}.`,
      INTERESTS[i % INTERESTS.length],
      now,
      now
    ));
  }
  await batch(db, userStatements);

  for (const item of liveForHighlights) {
    const course = await findAccountByEmail(db, item.email);
    if (!course) continue;
    const exists = await qAll<{ id: number }>(
      db,
      'SELECT id FROM stream_highlights WHERE course_id = ? AND title = ? LIMIT 1',
      course.id,
      item.title
    );
    if (exists.length) continue;
    await qRun(
      db,
      `INSERT INTO stream_highlights (course_id, title, hls_url, thumb_url, recorded_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      course.id,
      item.title,
      item.url,
      null,
      new Date(Date.now() - 86400000).toISOString(),
      now,
      now
    );
    highlights += 1;
  }

  const adminEmail = 'admin@liveview.demo';
  if (!existingEmails.has(adminEmail) && !(await findAccountByEmail(db, adminEmail))) {
    await insertAccount(db, {
      name: 'Demo Admin',
      first_name: 'Demo',
      last_name: 'Admin',
      city: 'Phoenix',
      state: 'AZ',
      email: adminEmail,
      role: 'admin',
      password: DEMO_PASSWORD_HASH,
      onboarding_completed: 1,
      is_demo: 1
    });
  }

  return {
    demo: true,
    label: 'Demo data',
    password: DEMO_PASSWORD,
    courses: { created: coursesCreated, updated: coursesUpdated, total: REAL_GOLF_COURSES.length },
    accounts: { created: accountsCreated, updated: accountsUpdated, total: 80 },
    highlights,
    exampleCourseLogin: 'demo-course-01-pebble-beach-golf-links@liveview.demo',
    exampleUserLogin: 'demo-user-001@liveview.demo',
    exampleAdminLogin: adminEmail
  };
}

export async function upsertAccount(db: D1Database, email: string, fields: Partial<AccountRow>) {
  const existing = await findAccountByEmail(db, email);
  if (!existing) return insertAccount(db, { ...fields, email });
  return updateAccount(db, existing.id, fields);
}
