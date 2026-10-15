import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { hashPassword } from '../src/auth';
import { birthdayName, dedupeWorkMirrors, eventIsBirthday, eventsFromIcs, maskWorkEvents, titleIsBirthday } from '../src/glance/ics';
import { partsInZone, phoenixDate, zonedToUtc } from '../src/glance/time';
import { familyPhrase, haversineMeters, matchPlace } from '../src/glance/location';
import { canonicalPath, sha256Hex, signPayload, tuyaSign } from '../src/glance/tuya';
import { eventRange, googleAuthUrl, googleEventBody, googleFailureReason, openSecret, redirectUri, sealSecret } from '../src/glance/google';
import { shapeWeather } from '../src/glance/weather';

const origin = 'https://maxteeple.test';
const TEST_PASSWORD = 'correct-horse-battery';

async function api(path: string, init?: RequestInit) {
  return SELF.fetch(new Request(`${origin}${path}`, init));
}

function setCookies(response: Response): string[] {
  return typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [response.headers.get('set-cookie') || ''];
}

function cookiePair(response: Response): string {
  const raw = setCookies(response).find((cookie) => cookie.startsWith('glance_session=')) || setCookies(response)[0] || '';
  return raw.split(';')[0];
}

async function signIn(password = TEST_PASSWORD): Promise<string> {
  await api('/glance/api/weather');
  const hash = await hashPassword(TEST_PASSWORD);
  await env.LIVEVIEW_DB.prepare(`UPDATE glance_settings SET password_hash = ? WHERE id = 'default'`).bind(hash).run();
  const login = await api('/glance/api/login', {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password })
  });
  expect(login.status).toBe(303);
  expect(new URL(login.headers.get('location') || '', origin).pathname).toBe('/glance/');
  return cookiePair(login);
}

function withSession(path: string, session: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set('cookie', session);
  return api(path, { ...init, headers });
}

describe('Glance kitchen board', () => {
  it('requires a login before any data route', async () => {
    const paths = ['/glance/api/weather', '/glance/api/calendar', '/glance/api/todos', '/glance/api/settings', '/glance/api/session', '/glance/api/lights', '/glance/api/location'];
    for (const path of paths) {
      const response = await api(path);
      expect(response.status, path).toBe(401);
      const body = await response.json();
      expect(JSON.stringify(body)).not.toMatch(/pbkdf2|password_hash|http/i);
    }
    const created = await api('/glance/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Buy milk' })
    });
    expect(created.status).toBe(401);
    const command = await api('/glance/api/lights/abcdefghij', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ on: true })
    });
    expect(command.status).toBe(401);
  });

  it('serves a chromeless login shell and a quiet site link', async () => {
    const page = await api('/glance/');
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('apple-mobile-web-app-capable');
    expect(html).toContain('login-password');
    expect(html).toContain('href="/glance/privacy.html"');
    const privacy = await api('/glance/privacy.html');
    expect(privacy.status).toBe(200);
    const policy = await privacy.text();
    expect(policy).toContain('Privacy policy');
    expect(policy).toContain('max.teeple@gmail.com');
    expect(policy).toContain('Google Calendar API');
    expect(policy).toContain('encrypted');
    const privacyAlias = await api('/glance/privacy');
    expect(privacyAlias.status).toBe(200);
    expect(await privacyAlias.text()).toContain('max.teeple@gmail.com');
    expect(html).not.toMatch(/outlook\.office365|calendar\.google/i);
    const home = await api('/');
    expect(await home.text()).toContain('href="/glance/"');
    const redirect = await api('/glance', { redirect: 'manual' });
    expect(redirect.status).toBe(301);
    expect(redirect.headers.get('location')).toBe(`${origin}/glance/`);
    expect(page.headers.get('strict-transport-security')).toBe('max-age=31536000');
    expect(html).toContain('autocapitalize="off"');
    expect(html).toContain('autocorrect="off"');
    expect(html).toContain('spellcheck="false"');
    expect(html).toContain('apple-touch-icon');
    expect(html).toContain('/glance/apple-touch-icon.png');
    expect(html).toContain('/glance/app.js?v=dev');
    expect(html).toContain('/glance/app.css?v=dev');
    expect(html).toContain('name="glance-build" content="dev"');
    expect(html).not.toContain('__GLANCE_BUILD__');
    expect(page.headers.get('cache-control')).toContain('no-store');
    const version = await api('/glance/api/version');
    expect(version.status).toBe(200);
    expect(version.headers.get('cache-control')).toContain('no-store');
    expect(version.headers.get('cache-control')).toContain('no-cache');
    expect(await version.json()).toEqual({ ok: true, version: 'dev' });
    const asset = await api('/glance/app.js?v=dev');
    expect(asset.status).toBe(200);
    expect(asset.headers.get('cache-control')).toContain('immutable');
    const manifest = await api('/glance/manifest.webmanifest');
    expect(manifest.status).toBe(200);
    const manifestBody = await manifest.json() as { display: string; start_url: string; scope: string };
    expect(manifestBody.display).toBe('standalone');
    expect(manifestBody.start_url).toBe('/glance/');
    expect(manifestBody.scope).toBe('/glance/');
  });

  it('sends http and www glance traffic to the https apex', async () => {
    const insecure = await SELF.fetch('https://maxteeple.com/glance', {
      redirect: 'manual',
      headers: { 'x-forwarded-proto': 'http' }
    });
    expect(insecure.status).toBe(301);
    expect(insecure.headers.get('location')).toBe('https://maxteeple.com/glance/');
    expect(insecure.headers.get('strict-transport-security')).toBeNull();

    const posted = await SELF.fetch('http://maxteeple.com/glance/api/login', {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/json', 'x-forwarded-proto': 'http' },
      body: JSON.stringify({ password: 'ignored' })
    });
    expect(posted.status).toBe(308);
    expect(posted.headers.get('location')).toBe('https://maxteeple.com/glance/api/login');

    const www = await SELF.fetch('https://www.maxteeple.com/glance/app.css?v=1', { redirect: 'manual' });
    expect(www.status).toBe(301);
    expect(www.headers.get('location')).toBe('https://maxteeple.com/glance/app.css?v=1');
    expect(www.headers.get('strict-transport-security')).toBe('max-age=31536000');
  });

  it('signs in with a year-long cookie and keeps to-dos', async () => {
    await api('/glance/api/weather');
    const hash = await hashPassword(TEST_PASSWORD);
    await env.LIVEVIEW_DB.prepare(`UPDATE glance_settings SET password_hash = ? WHERE id = 'default'`).bind(hash).run();
    const wrong = await api('/glance/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'not-the-password' })
    });
    expect(wrong.status).toBe(401);
    expect(wrong.headers.get('set-cookie')).toBeNull();

    const login = await api('/glance/api/login/', {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: `  ${TEST_PASSWORD}\n` })
    });
    expect(login.status).toBe(303);
    expect(new URL(login.headers.get('location') || '', origin).pathname).toBe('/glance/');
    const setCookie = setCookies(login).find((cookie) => cookie.startsWith('glance_session=')) || '';
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).not.toContain('SameSite=Strict');
    expect(setCookie).toContain('Max-Age=31536000');
    expect(setCookie).toContain('Path=/glance');
    expect(setCookie.startsWith('glance_session=')).toBe(true);
    const session = cookiePair(login);
    const token = session.split('=')[1];
    const legacy = await api('/glance/api/session', { headers: { cookie: `__Host-glance_session=${token}` } });
    expect(legacy.status).toBe(200);

    const created = await withSession('/glance/api/todos', session, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Buy milk' })
    });
    expect(created.status).toBe(201);
    const createdBody = await created.json() as { todo: { id: string; title: string; done: boolean } };
    expect(createdBody.todo.title).toBe('Buy milk');
    expect(createdBody.todo.done).toBe(false);

    const second = await withSession('/glance/api/todos', session, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Call the course' })
    });
    const secondBody = await second.json() as { todo: { id: string } };

    const checked = await withSession(`/glance/api/todos/${createdBody.todo.id}`, session, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ done: true })
    });
    expect((await checked.json() as { todo: { done: boolean } }).todo.done).toBe(true);

    const reordered = await withSession('/glance/api/todos/reorder', session, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [secondBody.todo.id, createdBody.todo.id] })
    });
    const order = (await reordered.json() as { todos: { id: string; title: string }[] }).todos.map((todo) => todo.title);
    expect(order).toEqual(['Call the course', 'Buy milk']);

    const again = await withSession('/glance/api/todos', session);
    const titles = (await again.json() as { todos: { title: string; done: boolean }[] }).todos;
    expect(titles.map((todo) => [todo.title, todo.done])).toEqual([
      ['Call the course', false],
      ['Buy milk', true]
    ]);

    const removed = await withSession(`/glance/api/todos/${createdBody.todo.id}`, session, { method: 'DELETE' });
    expect(removed.status).toBe(200);
    const left = await withSession('/glance/api/todos', session);
    expect((await left.json() as { todos: { title: string }[] }).todos.map((todo) => todo.title)).toEqual(['Call the course']);
  });

  it('switches theme and stores a feed without sending the link back', async () => {
    const session = await signIn();
    const secret = 'secret-token-should-not-leak';
    const saved = await withSession('/glance/api/settings', session, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        theme: 'glass',
        clock24: true,
        nightStart: 21,
        nightEnd: 6,
        locationName: 'Phoenix, AZ',
        lat: 33.4484,
        lon: -112.074,
        widgets: { countdown: true, sun: true, air: false, summary: true },
        feeds: [{ label: 'Work', color: '#8eb6ff', enabled: true, url: `https://example.com/${secret}/calendar.ics` }]
      })
    });
    expect(saved.status).toBe(200);
    const body = await saved.json() as { theme: string; clock24: boolean; widgets: { air: boolean }; feeds: { label: string; saved: boolean; url?: string }[] };
    expect(body.theme).toBe('glass');
    expect(body.clock24).toBe(true);
    expect(body.widgets.air).toBe(false);
    expect(body.feeds[0].label).toBe('Work');
    expect(body.feeds[0].saved).toBe(true);
    expect(body.feeds[0].url).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(secret);

    const read = await withSession('/glance/api/settings', session);
    expect(JSON.stringify(await read.json())).not.toContain(secret);

    const calendar = await withSession('/glance/api/calendar', session);
    const calendarBody = await calendar.json();
    expect(calendar.status).toBe(200);
    expect(JSON.stringify(calendarBody)).not.toContain(secret);
    expect(JSON.stringify(calendarBody)).not.toContain('example.com');
  });

  it('loads Phoenix weather', async () => {
    const session = await signIn();
    const response = await withSession('/glance/api/weather', session);
    expect(response.status).toBe(200);
    const body = await response.json() as { ok: boolean; current?: { temp: number; label: string }; daily?: unknown[]; hourly?: unknown[]; air?: { label: string } };
    expect(body.ok).toBe(true);
    expect(typeof body.current?.temp).toBe('number');
    expect(body.current?.label).toBeTruthy();
    expect((body.daily || []).length).toBeGreaterThanOrEqual(5);
    expect((body.hourly || []).length).toBeGreaterThanOrEqual(8);
    expect(body.air?.label).toBeTruthy();
  });

  it('changes the password and signs out', async () => {
    const session = await signIn();
    const next = 'a-newer-kitchen-password';
    const changed = await withSession('/glance/api/password', session, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current: TEST_PASSWORD, next })
    });
    expect(changed.status).toBe(200);
    const nextJar = cookiePair(changed);
    expect(nextJar).not.toBe(session);
    const oldSession = await api('/glance/api/todos', { headers: { cookie: session } });
    expect(oldSession.status).toBe(401);
    const fresh = await api('/glance/api/session', { headers: { cookie: nextJar } });
    expect(fresh.status).toBe(200);
    const out = await api('/glance/api/logout', { method: 'POST', headers: { cookie: nextJar } });
    expect(out.status).toBe(200);
    const after = await api('/glance/api/todos', { headers: { cookie: nextJar } });
    expect(after.status).toBe(401);
  });
});

describe('Tuya signing', () => {
  it('builds the OpenAPI v2 string and keeps cloud keys out of settings', async () => {
    const path = canonicalPath('/v1.0/token?grant_type=1');
    const contentSha256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    const payload = signPayload({
      accessId: 'client-example',
      timestamp: '1583489412345',
      nonce: 'nonce',
      method: 'GET',
      path,
      contentSha256
    });
    expect(payload.startsWith('client-example1583489412345nonceGET\n')).toBe(true);
    expect(payload).toContain(contentSha256);
    expect(payload.endsWith('\n\n/v1.0/token?grant_type=1')).toBe(true);
    const sign = await tuyaSign('example-secret', payload);
    expect(sign).toMatch(/^[A-F0-9]{64}$/);
    expect(sign).toBe(await tuyaSign('example-secret', payload));
    expect(await sha256Hex('')).toBe(contentSha256);

    const session = await signIn();
    const accessId = 'abc123xyz987';
    const accessSecret = 'abcdef0123456789abcd';
    const saved = await withSession('/glance/api/settings', session, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tuyaAccessId: accessId, tuyaAccessSecret: accessSecret })
    });
    const body = await saved.json() as { tuya?: { accessIdSaved?: boolean; accessSecretSaved?: boolean } };
    expect(saved.status).toBe(200);
    expect(body.tuya?.accessIdSaved).toBe(true);
    expect(body.tuya?.accessSecretSaved).toBe(true);
    const text = JSON.stringify(body);
    expect(text).not.toContain(accessId);
    expect(text).not.toContain(accessSecret);
    const lights = await withSession('/glance/api/lights', session);
    const lightsText = await lights.text();
    expect(lightsText).not.toContain(accessId);
    expect(lightsText).not.toContain(accessSecret);
  });
});

describe('family location', () => {
  it('phrases home, a named place, driving, and last seen', () => {
    const now = Date.parse('2026-10-14T20:00:00Z');
    const home = { id: 'home', name: 'Home', lat: 33.45, lon: -112.07, radiusM: 150, home: true };
    const work = { id: 'work', name: 'Work', lat: 33.5, lon: -112.1, radiusM: 200, home: false };
    const atHome = { lat: 33.4502, lon: -112.0702, acc: 10, vel: 0, regions: [], recordedAt: now - 60000 };
    expect(haversineMeters(atHome.lat, atHome.lon, home.lat, home.lon)).toBeLessThan(150);
    expect(matchPlace(atHome, [home, work])?.home).toBe(true);
    expect(familyPhrase({ name: 'Max', fix: atHome, places: [home, work], staleHours: 6, now, minutes: 0, driving: false })).toBe('Max is home');
    const atWork = { lat: 33.5004, lon: -112.1004, acc: 12, vel: 0, regions: [], recordedAt: now - 120000 };
    expect(familyPhrase({ name: 'Max', fix: atWork, places: [home, work], staleHours: 6, now, minutes: 24, driving: false })).toBe('Max is at Work, 24 min from home');
    const road = { lat: 33.47, lon: -112.09, acc: 20, vel: 40, regions: [], recordedAt: now - 30000 };
    expect(familyPhrase({ name: 'Max', fix: road, places: [home, work], staleHours: 6, now, minutes: 12, driving: true })).toBe('Max is driving, 12 min from home');
    const stale = { ...atWork, recordedAt: now - 8 * 3600000 };
    expect(familyPhrase({ name: 'Max', fix: stale, places: [home, work], staleHours: 6, now, minutes: null, driving: false })).toBe('Max last seen at Work, 8h ago');
  });

  it('accepts OwnTracks and Shortcuts posts, then forgets them', async () => {
    const session = await signIn();
    const placed = await withSession('/glance/api/location/places', session, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        staleHours: 6,
        home: { lat: 33.4484, lon: -112.074, radius: 150 },
        places: [{ name: 'Work', lat: 33.5, lon: -112.1, radius: 180 }]
      })
    });
    expect(placed.status).toBe(200);

    const created = await withSession('/glance/api/location/people', session, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Ada', color: '#7dcea0' })
    });
    expect(created.status).toBe(201);
    const setup = await created.json() as { person: { id: string }; token: string; owntracks: { url: string; link: string; username: string } };
    expect(setup.token.length).toBeGreaterThan(16);
    expect(setup.owntracks.url).toContain('/glance/api/location/owntracks');
    expect(setup.owntracks.link.startsWith('owntracks:///config?inline=')).toBe(true);
    const listed = await withSession('/glance/api/location', session);
    expect(JSON.stringify(await listed.json())).not.toContain(setup.token);

    const basic = btoa(`${setup.owntracks.username}:${setup.token}`);
    const homePost = await api('/glance/api/location/owntracks', {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ _type: 'location', lat: 33.4484, lon: -112.074, acc: 8, vel: 0, tst: Math.floor(Date.now() / 1000) })
    });
    expect(homePost.status).toBe(200);
    const atHome = await withSession('/glance/api/location', session);
    const homeBody = await atHome.json() as { people: { phrase: string }[] };
    expect(homeBody.people[0].phrase).toBe('Ada is home');

    const driving = await api('/glance/api/location', {
      method: 'POST',
      headers: { Authorization: `Bearer ${setup.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat: 33.47, lon: -112.12, acc: 15 })
    });
    expect(driving.status).toBe(200);
    const away = await withSession('/glance/api/location', session);
    const awayBody = await away.json() as { people: { phrase: string; lat: number }[] };
    expect(awayBody.people[0].phrase).toMatch(/Ada is (driving|out), \d+ min from home/);
    expect(awayBody.people[0].lat).toBeCloseTo(33.47, 2);

    const rejected = await api('/glance/api/location/owntracks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ _type: 'location', lat: 1, lon: 2 })
    });
    expect(rejected.status).toBe(401);

    const removed = await withSession(`/glance/api/location/people/${setup.person.id}`, session, { method: 'DELETE' });
    expect(removed.status).toBe(200);
    await withSession('/glance/api/location/places', session, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ home: null, places: [] })
    });
    const empty = await withSession('/glance/api/location', session);
    const emptyBody = await empty.json() as { people: unknown[]; home: unknown };
    expect(emptyBody.people).toEqual([]);
    expect(emptyBody.home).toBeNull();
  });
});

describe('layouts and birthdays', () => {
  it('stores a layout preset and recognizes birthday titles', async () => {
    expect(titleIsBirthday("Amy's birthday")).toBe(true);
    expect(titleIsBirthday('Sam b-day')).toBe(true);
    expect(birthdayName("Amy's birthday")).toBe('Amy');
    expect(birthdayName('bday: Nora')).toBe('Nora');
    expect(titleIsBirthday('Daily JIRA Prep')).toBe(false);
    expect(titleIsBirthday("Get groceries for Amy's birthday")).toBe(false);
    expect(birthdayName("Get groceries for Amy's birthday")).toBe('');
    expect(eventIsBirthday({ title: "Get groceries for Amy's birthday", allDay: true, birthday: true })).toBe(false);
    expect(eventIsBirthday({ title: 'Amy', allDay: true, birthday: true })).toBe(true);
    expect(eventIsBirthday({ title: 'Amy', allDay: false, birthday: true })).toBe(false);

    const session = await signIn();
    const saved = await withSession('/glance/api/settings', session, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ layout: 'home' })
    });
    expect(saved.status).toBe(200);
    expect((await saved.json() as { layout: string }).layout).toBe('home');

    const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:cake
SUMMARY:Amy
DTSTART;VALUE=DATE:20261014
DTEND;VALUE=DATE:20261015
CATEGORIES:BIRTHDAY
END:VEVENT
END:VCALENDAR`;
    const start = Date.parse('2026-10-14T00:00:00-07:00');
    const events = eventsFromIcs(ics, { id: 'p', label: 'Personal', color: '#7dcea0' }, start, start + 86400000);
    expect(events[0]?.birthday).toBe(true);
    expect(events[0]?.title).toBe('Amy');

    const task = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:groceries
SUMMARY:Get groceries for Amy's birthday
DESCRIPTION:Birthday cake and candles
DTSTART;VALUE=DATE:20261014
DTEND;VALUE=DATE:20261015
END:VEVENT
END:VCALENDAR`;
    const tasks = eventsFromIcs(task, { id: 'p', label: 'Personal', color: '#7dcea0' }, start, start + 86400000);
    expect(tasks[0]?.birthday).toBe(false);
    expect(tasks[0]?.title).toBe("Get groceries for Amy's birthday");
  });
});

describe('calendar expansion', () => {
  const feed = { id: 'work', label: 'Work', color: '#8eb6ff' };
  const start = zonedToUtc(2026, 10, 14, 0, 0, 0, 'America/Phoenix');
  const end = zonedToUtc(2026, 10, 21, 0, 0, 0, 'America/Phoenix');

  it('expands a weekday standup in US Mountain time and skips an EXDATE', () => {
    const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:standup
SUMMARY:Morning standup
DTSTART;TZID=US Mountain Standard Time:20260914T083000
DTEND;TZID=US Mountain Standard Time:20260914T090000
RRULE:FREQ=WEEKLY;UNTIL=20270101T153000Z;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR;WKST=SU
EXDATE;TZID=US Mountain Standard Time:20261016T083000
END:VEVENT
END:VCALENDAR`;
    const events = eventsFromIcs(ics, feed, start, end);
    const days = events.map((event) => phoenixDate(event.start)).sort();
    expect(days).toEqual(['2026-10-14', '2026-10-15', '2026-10-19', '2026-10-20']);
    const first = events.find((event) => phoenixDate(event.start) === '2026-10-14');
    const parts = partsInZone(first!.start, 'America/Phoenix');
    expect(parts.h).toBe(8);
    expect(parts.mi).toBe(30);
    expect(first?.title).toBe('Morning standup');
  });

  it('places the fourth Tuesday and honors a moved exception', () => {
    const monthly = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:fourth
SUMMARY:Fourth Tuesday
DTSTART;TZID=America/Phoenix:20260922T120000
DTEND;TZID=America/Phoenix:20260922T130000
RRULE:FREQ=MONTHLY;INTERVAL=1;BYDAY=4TU
END:VEVENT
END:VCALENDAR`;
    const found = eventsFromIcs(monthly, feed, zonedToUtc(2026, 10, 1, 0, 0, 0, 'America/Phoenix'), zonedToUtc(2026, 11, 1, 0, 0, 0, 'America/Phoenix'));
    expect(found.map((event) => phoenixDate(event.start))).toEqual(['2026-10-27']);

    const series = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:series
SUMMARY:Block
DTSTART;TZID=America/Phoenix:20261014T090000
DTEND;TZID=America/Phoenix:20261014T100000
RRULE:FREQ=DAILY;COUNT=3
END:VEVENT
BEGIN:VEVENT
UID:series
SUMMARY:Block moved
RECURRENCE-ID;TZID=America/Phoenix:20261015T090000
DTSTART;TZID=America/Phoenix:20261015T110000
DTEND;TZID=America/Phoenix:20261015T120000
END:VEVENT
END:VCALENDAR`;
    const occ = eventsFromIcs(series, feed, start, end).sort((a, b) => a.start - b.start);
    expect(occ.map((event) => [phoenixDate(event.start), partsInZone(event.start, 'America/Phoenix').h, event.title])).toEqual([
      ['2026-10-14', 9, 'Block'],
      ['2026-10-15', 11, 'Block moved'],
      ['2026-10-16', 9, 'Block']
    ]);
  });

  it('keeps every-other-week spacing, all-day spans, and Berlin offsets', () => {
    const biweekly = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:bi
SUMMARY:Every other Wednesday
DTSTART;TZID=America/Phoenix:20260923T133000
DTEND;TZID=America/Phoenix:20260923T140000
RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=WE;WKST=SU
END:VEVENT
END:VCALENDAR`;
    const mid = eventsFromIcs(biweekly, feed, start, end);
    expect(mid).toHaveLength(0);
    const later = eventsFromIcs(biweekly, feed, start, zonedToUtc(2026, 10, 22, 0, 0, 0, 'America/Phoenix'));
    expect(later.map((event) => phoenixDate(event.start))).toEqual(['2026-10-21']);

    const allday = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:trip
SUMMARY:Trip
DTSTART;VALUE=DATE:20261014
DTEND;VALUE=DATE:20261016
END:VEVENT
END:VCALENDAR`;
    const trip = eventsFromIcs(allday, feed, start, end);
    expect(trip).toHaveLength(1);
    expect(trip[0].allDay).toBe(true);
    expect(phoenixDate(trip[0].start)).toBe('2026-10-14');
    expect(phoenixDate(trip[0].end)).toBe('2026-10-16');

    const berlin = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:ber
SUMMARY:Berlin call
DTSTART;TZID=Europe/Berlin:20261014T150000
DTEND;TZID=Europe/Berlin:20261014T160000
END:VEVENT
END:VCALENDAR`;
    const call = eventsFromIcs(berlin, feed, start, end)[0];
    expect(partsInZone(call.start, 'America/Phoenix').h).toBe(6);
  });

  it('drops mirrored [Work] events and strips the prefix', () => {
    const startMs = zonedToUtc(2026, 10, 14, 9, 0, 0, 'America/Phoenix');
    const endMs = startMs + 30 * 60 * 1000;
    const kept = dedupeWorkMirrors([
      { title: 'Standup', start: startMs, end: endMs, allDay: false, feedId: 'w', feedLabel: 'Work', color: '#8eb6ff' },
      { title: '[Work] Standup', start: startMs, end: endMs, allDay: false, feedId: 'p', feedLabel: 'Personal', color: '#7dcea0' },
      { title: '[Work] Dentist', start: startMs + 3600000, end: endMs + 3600000, allDay: false, feedId: 'p', feedLabel: 'Personal', color: '#7dcea0' },
      { title: 'Family picnic', start: startMs + 7200000, end: endMs + 7200000, allDay: false, feedId: 'p', feedLabel: 'Personal', color: '#7dcea0' }
    ]);
    expect(kept.map((event) => `${event.feedLabel}:${event.title}`)).toEqual(['Work:Standup', 'Personal:Dentist', 'Personal:Family picnic']);
    const masked = maskWorkEvents(kept);
    expect(masked.map((event) => `${event.feedLabel}:${event.title}:${event.color}`)).toEqual([
      'Work:Max Work Meeting:#8eb6ff',
      'Work:Max Work Meeting:#8eb6ff',
      'Personal:Family picnic:#7dcea0'
    ]);
    const onlyMirror = maskWorkEvents([
      { title: '[Work] Planning', start: startMs, end: endMs, allDay: false, feedId: 'p', feedLabel: 'Personal', color: '#7dcea0' }
    ]);
    expect(onlyMirror[0].title).toBe('Max Work Meeting');
    expect(onlyMirror[0].feedLabel).toBe('Work');
    expect(onlyMirror[0].color).toBe('#8eb6ff');
    expect(JSON.stringify(onlyMirror)).not.toContain('Planning');
  });

  it('shapes an Open-Meteo payload', () => {
    const weather = shapeWeather(
      {
        current: { temperature_2m: 84.2, apparent_temperature: 82, weather_code: 1, wind_speed_10m: 6, wind_direction_10m: 220, is_day: 1, relative_humidity_2m: 18 },
        hourly: {
          time: ['2026-10-14T13:00', '2026-10-14T14:00'],
          temperature_2m: [84, 85],
          precipitation_probability: [10, 20],
          weather_code: [1, 2],
          uv_index: [6, 5],
          is_day: [1, 1]
        },
        daily: {
          time: ['2026-10-14'],
          weather_code: [1],
          temperature_2m_max: [91],
          temperature_2m_min: [64],
          precipitation_probability_max: [20],
          sunrise: ['2026-10-14T06:42'],
          sunset: ['2026-10-14T18:01'],
          uv_index_max: [7]
        }
      },
      { current: { us_aqi: 42, pm2_5: 8.1 } },
      Date.parse('2026-10-14T13:30:00-07:00')
    );
    expect(weather.current.temp).toBe(84);
    expect(weather.current.high).toBe(91);
    expect(weather.hourly[0].time.endsWith('-07:00')).toBe(true);
    expect(weather.sun.sunrise).toBe('2026-10-14T06:42:00-07:00');
    expect(weather.air.label).toBe('Good');
  });
});

describe('Glance dashboard', () => {
  it('returns weather, calendar, lights, and family in one response', async () => {
    const session = await signIn();
    const response = await withSession('/glance/api/dashboard', session);
    expect(response.status).toBe(200);
    const body = await response.json() as {
      ok: boolean;
      settings: { locationName?: string };
      weather: { ok?: boolean };
      calendar: { days?: unknown[] };
      lights: { ok?: boolean };
      location: { people?: unknown[] };
    };
    expect(body.ok).toBe(true);
    expect(body.settings.locationName).toBeTruthy();
    expect(body.weather.ok).toBe(true);
    expect(Array.isArray(body.calendar.days)).toBe(true);
    expect(body.lights.ok).toBe(true);
    expect(Array.isArray(body.location.people)).toBe(true);
  });
});

describe('Glance week range', () => {
  it('returns seven days for a requested week', async () => {
    const session = await signIn();
    const week = await withSession('/glance/api/calendar?start=2026-10-11', session);
    expect(week.status).toBe(200);
    const body = await week.json() as { days: { date: string; label: string; events: { title: string }[] }[] };
    expect(body.days.map((day) => day.date)).toEqual([
      '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17'
    ]);
    expect(body.days[0].label).toBe('Sun');
    expect(body.days[3].label).toBe('Wed');
    const bad = await withSession('/glance/api/calendar?start=2026-13-40', session);
    expect(bad.status).toBe(400);
  });
});

describe('Google Calendar events', () => {
  it('builds a Basil event and keeps the refresh token off the page', async () => {
    const now = Date.parse('2026-10-15T12:00:00-07:00');
    const timed = eventRange({ title: 'Dentist', date: '2026-10-15', allDay: false, start: '16:00', durationMinutes: 90 }, now);
    expect(googleEventBody({ title: 'Dentist', allDay: false, ...timed })).toEqual({
      summary: 'Dentist',
      colorId: '10',
      start: { dateTime: '2026-10-15T16:00:00', timeZone: 'America/Phoenix' },
      end: { dateTime: '2026-10-15T17:30:00', timeZone: 'America/Phoenix' }
    });
    const day = eventRange({ title: 'Picnic', date: '2026-10-16', allDay: true }, now);
    expect(googleEventBody({ title: 'Picnic', allDay: true, ...day })).toEqual({
      summary: 'Picnic',
      colorId: '10',
      start: { date: '2026-10-16' },
      end: { date: '2026-10-17' }
    });
    expect(() => eventRange({ title: 'Late', date: '2026-10-15', allDay: false, start: '18:00', end: '17:00' }, now)).toThrow(/before the start/);

    const sealed = await sealSecret('refresh-token-value', 'server-key');
    expect(sealed.startsWith('v1.')).toBe(true);
    expect(sealed).not.toContain('refresh-token-value');
    expect(await openSecret(sealed, 'server-key')).toBe('refresh-token-value');
    expect(await openSecret(sealed, 'other-key')).toBe('');

    const session = await signIn();
    const clientId = '1234567890-glance.apps.googleusercontent.com';
    const clientSecret = 'GOCSPX-test-secret-value';
    const saved = await withSession('/glance/api/settings', session, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ googleClientId: clientId, googleClientSecret: clientSecret })
    });
    expect(saved.status).toBe(200);
    const settings = await saved.json() as { google: { connected: boolean; clientConfigured: boolean; account: string } };
    expect(settings.google.connected).toBe(false);
    expect(settings.google.clientConfigured).toBe(true);
    expect(settings.google.account).toBe('');
    expect(JSON.stringify(settings)).not.toContain(clientSecret);
    expect(JSON.stringify(settings)).not.toContain(clientId);
    expect(JSON.stringify(settings)).not.toContain('refresh');

    const start = await withSession('/glance/api/google/start', session, { redirect: 'manual' });
    expect(start.status).toBe(302);
    const location = new URL(start.headers.get('location') || '');
    expect(location.origin).toBe('https://accounts.google.com');
    expect(location.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/calendar.events');
    expect(location.searchParams.get('access_type')).toBe('offline');
    expect(location.searchParams.get('prompt')).toBe('consent');
    expect(location.searchParams.get('redirect_uri')).toBe('https://maxteeple.test/glance/api/google/callback');
    expect(start.headers.get('set-cookie') || '').toContain('glance_google_state=');
    expect(start.headers.get('set-cookie') || '').toContain('SameSite=Lax');

    const blocked = await withSession('/glance/api/events', session, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Dentist', date: '2026-10-15', start: '16:00', durationMinutes: 60 })
    });
    expect(blocked.status).toBe(400);
    const blockedBody = await blocked.json() as { message: string };
    expect(blockedBody.message).toBe('Connect Google to add events');
    expect(JSON.stringify(blockedBody)).not.toContain(clientSecret);

    const authUrl = googleAuthUrl({ clientId, redirectUri: 'https://maxteeple.com/glance/api/google/callback', state: 'abc' });
    expect(authUrl).toContain('prompt=consent');
    expect(authUrl).toContain('access_type=offline');
    expect(redirectUri('https://maxteeple.com/google/callback?code=1')).toBe('https://maxteeple.com/glance/api/google/callback');
    expect(redirectUri('https://www.maxteeple.com/glance/api/google/callback')).toBe('https://maxteeple.com/glance/api/google/callback');
    expect(googleFailureReason('invalid_client')).toBe('invalid_client');
    expect(googleFailureReason('redirect_uri_mismatch')).toBe('redirect_uri_mismatch');
    expect(googleFailureReason('bad secret GOCSPX-nope')).toBe('token_exchange_failed');
  });
});
