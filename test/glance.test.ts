import { env, fetchMock, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { hashPassword, jwtSecret } from '../src/auth';
import type { Bindings } from '../src/types';

declare module 'cloudflare:test' {
  export const fetchMock: {
    activate(): void;
    deactivate(): void;
    disableNetConnect(): void;
    get(origin: string): {
      intercept(opts: { path: string; method: string }): {
        reply(status: number, body?: unknown): unknown;
        reply(callback: (opts: { headers?: unknown; body?: unknown }) => {
          statusCode: number;
          data: string;
          responseOptions: Record<string, unknown>;
        }): unknown;
      };
    };
  };
}
import { birthdayName, cachedFeed, dedupeWorkMirrors, eventIsBirthday, eventsFromIcs, feedSpan, googleEventId, ICS_REFRESH_MS, maskWorkEvents, projectFeed, startFeedParse, takeFeedRaws, titleIsBirthday } from '../src/glance/ics';
import { refreshGlanceBoard } from '../src/glance/routes';
import { verseFor, verseIndex } from '../src/glance/verse';
import verses from '../src/glance/verses.json';
import { partsInZone, phoenixDate, zonedToUtc } from '../src/glance/time';
import { familyPhrase, haversineMeters, matchPlace } from '../src/glance/location';
import { canonicalPath, sha256Hex, signPayload, tuyaSign } from '../src/glance/tuya';
import { eventRange, googleAuthUrl, googleEventBody, googleFailureReason, openSecret, redirectUri, sealSecret } from '../src/glance/google';
import { planLightAutomations, scheduleHint } from '../src/glance/light-automation';
import { runScheduledLights } from '../src/glance/light-cron';
import { plugAlias, plugSortKey } from '../src/glance/plug-names';
import { ensureSchema } from '../src/schema';
import { createGlancePhoto, readGlancePhoto, removeGlancePhoto, resetPhotoStore } from '../src/glance/photos';
import { phoenixSunsetMinutes } from '../src/glance/sunset';
import { shapeWeather } from '../src/glance/weather';

const origin = 'https://maxteeple.test';
const TEST_PASSWORD = 'correct-horse-battery';

/** A Phoenix date a few days ahead, so event posts stay inside the allowed window. */
function soonDate(daysAhead = 3): string {
  const local = new Date(Date.now() + daysAhead * 86400000 - 7 * 3600000);
  const y = local.getUTCFullYear();
  const m = String(local.getUTCMonth() + 1).padStart(2, '0');
  const d = String(local.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

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
    const paths = ['/glance/api/weather', '/glance/api/calendar', '/glance/api/todos', '/glance/api/settings', '/glance/api/session', '/glance/api/lights', '/glance/api/location', '/glance/api/verse', '/glance/api/photos'];
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

    const www = await SELF.fetch('https://www.maxteeple.com/glance/privacy', { redirect: 'manual' });
    expect(www.status).toBe(301);
    expect(www.headers.get('location')).toBe('https://maxteeple.com/glance/privacy');
    expect(www.headers.get('strict-transport-security')).toBe('max-age=31536000');
    const css = await SELF.fetch('https://www.maxteeple.com/glance/app.css?v=1', { redirect: 'manual' });
    expect(css.status).toBe(200);
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
    expect(familyPhrase({ name: 'Max', fix: atHome, places: [home, work], staleHours: 6, now, minutes: 0, driving: false })).toBe('Max is at home');
    const atWork = { lat: 33.5004, lon: -112.1004, acc: 12, vel: 0, regions: [], recordedAt: now - 120000 };
    expect(familyPhrase({ name: 'Max', fix: atWork, places: [home, work], staleHours: 6, now, minutes: 24, driving: false })).toBe('Max is at work');
    const named = { ...work, name: "Max's Work" };
    expect(familyPhrase({ name: 'Max', fix: atWork, places: [home, named], staleHours: 6, now, minutes: 24, driving: false })).toBe('Max is at work');
    const gym = { id: 'gym', name: 'Gym', lat: 33.46, lon: -112.08, radiusM: 120, home: false };
    const atGym = { lat: 33.4601, lon: -112.0801, acc: 10, vel: 0, regions: [], recordedAt: now - 60000 };
    expect(familyPhrase({ name: 'Amy', fix: atGym, places: [home, gym], staleHours: 6, now, minutes: 8, driving: false })).toBe('Amy is at the gym');
    const road = { lat: 33.47, lon: -112.09, acc: 20, vel: 40, regions: [], recordedAt: now - 30000 };
    expect(familyPhrase({ name: 'Max', fix: road, places: [home, work], staleHours: 6, now, minutes: 12, driving: true })).toBe('Max is driving');
    const paused = { ...road, vel: 0 };
    expect(familyPhrase({ name: 'Max', fix: paused, places: [home, work], staleHours: 6, now, minutes: 12, driving: false })).toBe('Max is on the way');
    const stale = { ...atWork, recordedAt: now - 8 * 3600000 };
    expect(familyPhrase({ name: 'Max', fix: stale, places: [home, work], staleHours: 6, now, minutes: null, driving: false })).toBe('Max last seen at work');
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
    expect(homeBody.people[0].phrase).toBe('Ada is at home');

    const driving = await api('/glance/api/location', {
      method: 'POST',
      headers: { Authorization: `Bearer ${setup.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat: 33.47, lon: -112.12, acc: 15 })
    });
    expect(driving.status).toBe(200);
    const away = await withSession('/glance/api/location', session);
    const awayBody = await away.json() as { people: { phrase: string; lat: number }[] };
    expect(awayBody.people[0].phrase).toMatch(/^Ada is (driving|on the way)$/);
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
    const fiveDay = await withSession('/glance/api/settings', session, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ layout: 'fiveday' })
    });
    expect(fiveDay.status).toBe(200);
    expect((await fiveDay.json() as { layout: string }).layout).toBe('fiveday');
    const unknown = await withSession('/glance/api/settings', session, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ layout: 'nope' })
    });
    expect((await unknown.json() as { layout: string }).layout).toBe('fiveday');

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
    expect(masked[0].location || '').toBe('');
    expect(masked[0].description || '').toBe('');
    expect(masked[0].googleId || '').toBe('');
    expect(googleEventId('abc123event@google.com')).toBe('abc123event');
    expect(googleEventId('not-google')).toBe('');
    const onlyMirror = maskWorkEvents([
      { title: '[Work] Planning', start: startMs, end: endMs, allDay: false, feedId: 'p', feedLabel: 'Personal', color: '#7dcea0' }
    ]);
    expect(onlyMirror[0].title).toBe('Max Work Meeting');
    expect(onlyMirror[0].feedLabel).toBe('Work');
    expect(onlyMirror[0].color).toBe('#8eb6ff');
    expect(JSON.stringify(onlyMirror)).not.toContain('Planning');
  });

  it('keeps personal details and strips work details', () => {
    const start = zonedToUtc(2026, 10, 14, 0, 0, 0, 'America/Phoenix');
    const end = zonedToUtc(2026, 10, 16, 0, 0, 0, 'America/Phoenix');
    const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:abc123event@google.com
SUMMARY:Dentist
LOCATION:Main St
DESCRIPTION:Bring notes https://example.com/notes
URL:https://example.com/map
DTSTART;TZID=America/Phoenix:20261014T090000
DTEND;TZID=America/Phoenix:20261014T100000
END:VEVENT
END:VCALENDAR`;
    const personal = eventsFromIcs(ics, { id: 'p', label: 'Personal', color: '#7dcea0' }, start, end)[0];
    expect(personal.location).toBe('Main St');
    expect(personal.description).toContain('Bring notes');
    expect(personal.googleId).toBe('abc123event');
    const work = maskWorkEvents(eventsFromIcs(ics, { id: 'w', label: 'Work', color: '#8eb6ff' }, start, end));
    expect(work[0].title).toBe('Max Work Meeting');
    expect(work[0].location).toBe('');
    expect(work[0].description).toBe('');
    expect(work[0].googleId).toBe('');
  });

  it('jumps a years-old monthly series into the open week and stops at COUNT', () => {
    const monthly = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:long-fourth
SUMMARY:Fourth Tuesday
DTSTART;TZID=America/Phoenix:20150623T150000
DTEND;TZID=America/Phoenix:20150623T160000
RRULE:FREQ=MONTHLY;INTERVAL=1;BYDAY=4TU
END:VEVENT
END:VCALENDAR`;
    const found = eventsFromIcs(
      monthly,
      feed,
      zonedToUtc(2026, 10, 1, 0, 0, 0, 'America/Phoenix'),
      zonedToUtc(2026, 11, 1, 0, 0, 0, 'America/Phoenix')
    );
    expect(found.map((event) => phoenixDate(event.start))).toEqual(['2026-10-27']);
    expect(partsInZone(found[0].start, 'America/Phoenix').h).toBe(15);

    const counted = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:two
SUMMARY:Twice
DTSTART;TZID=America/Phoenix:20260115T090000
DTEND;TZID=America/Phoenix:20260115T100000
RRULE:FREQ=MONTHLY;COUNT=2
END:VEVENT
END:VCALENDAR`;
    const later = eventsFromIcs(
      counted,
      feed,
      zonedToUtc(2026, 10, 1, 0, 0, 0, 'America/Phoenix'),
      zonedToUtc(2026, 11, 1, 0, 0, 0, 'America/Phoenix')
    );
    expect(later).toEqual([]);
    const early = eventsFromIcs(
      counted,
      feed,
      zonedToUtc(2026, 1, 1, 0, 0, 0, 'America/Phoenix'),
      zonedToUtc(2026, 3, 1, 0, 0, 0, 'America/Phoenix')
    );
    expect(early.map((event) => phoenixDate(event.start))).toEqual(['2026-01-15', '2026-02-15']);
  });

  it('ignores a folded base64 attachment and reuses a parsed feed', () => {
    const attach = 'QUJD'.repeat(4000);
    const folded = attach.replace(/(.{72})/g, '$1\r\n ');
    const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:with-attach@google.com
SUMMARY:Bring the laptop
ATTACH;FMTTYPE=text/plain;ENCODING=BASE64;VALUE=BINARY:${folded}
DTSTART;TZID=America/Phoenix:20261016T090000
DTEND;TZID=America/Phoenix:20261016T100000
END:VEVENT
END:VCALENDAR`;
    const windowStart = zonedToUtc(2026, 10, 16, 0, 0, 0, 'America/Phoenix');
    const windowEnd = zonedToUtc(2026, 10, 17, 0, 0, 0, 'America/Phoenix');
    const events = eventsFromIcs(ics, { id: 'p', label: 'Personal', color: '#7dcea0' }, windowStart, windowEnd);
    expect(events).toHaveLength(1);
    expect(events[0].title).toBe('Bring the laptop');
    expect(events[0].googleId).toBe('with-attach');
    const span = feedSpan(Date.parse('2026-10-16T12:00:00-07:00'));
    const first = takeFeedRaws('attach-feed', ics, '', span.start, span.end);
    const second = takeFeedRaws('attach-feed', ics, '"same"', span.start, span.end);
    expect(second).toBe(first);
    const renamed = ics.replace('Bring the laptop', 'Bring the charger');
    const third = takeFeedRaws('attach-feed', renamed, '"next"', span.start, span.end);
    expect(third).not.toBe(first);
    expect(projectFeed(third, { id: 'p', label: 'Personal', color: '#7dcea0' }, windowStart, windowEnd)[0].title).toBe('Bring the charger');
    const summer = partsInZone(Date.parse('2026-07-15T19:00:00Z'), 'America/Phoenix');
    const winter = partsInZone(Date.parse('2026-01-15T19:00:00Z'), 'America/Phoenix');
    expect(summer).toMatchObject({ y: 2026, m: 7, d: 15, h: 12 });
    expect(winter).toMatchObject({ y: 2026, m: 1, d: 15, h: 12 });
  });

  it('keeps a 3MB parse under 8ms per step and ignores DTSTAMP churn for 30 minutes', () => {
    const attach = 'QUJD'.repeat(12000);
    const chunks = ['BEGIN:VCALENDAR', 'X-WR-TIMEZONE:America/Phoenix'];
    for (let i = 0; i < 900; i++) {
      const year = 2023 + (i % 4);
      const month = String(1 + (i % 12)).padStart(2, '0');
      const day = String(1 + (i % 27)).padStart(2, '0');
      const stamp = `${year}${month}${day}T090000`;
      chunks.push(`BEGIN:VEVENT\r\nUID:bulk-${i}@google.com\r\nDTSTAMP:20261022T120000Z\r\nSUMMARY:Bulk ${i}\r\nDTSTART;TZID=America/Phoenix:${stamp}\r\nDTEND;TZID=America/Phoenix:${stamp.slice(0, 9)}100000\r\n${i % 11 === 0 ? `ATTACH;ENCODING=BASE64;VALUE=BINARY:${attach}\r\n` : ''}END:VEVENT`);
    }
    chunks.push('BEGIN:VEVENT\r\nUID:weekly-budget@work.example\r\nDTSTAMP:20261022T120000Z\r\nSUMMARY:Budget standup\r\nDTSTART;TZID=America/Phoenix:20180306T090000\r\nDTEND;TZID=America/Phoenix:20180306T093000\r\nRRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR\r\nEND:VEVENT');
    chunks.push('END:VCALENDAR');
    const ics = chunks.join('\r\n');
    expect(ics.length).toBeGreaterThan(2_000_000);
    const meta = { id: 'work', label: 'Work', color: '#8eb6ff' };
    const start = zonedToUtc(2026, 10, 16, 0, 0, 0, 'America/Phoenix');
    const end = zonedToUtc(2026, 10, 23, 0, 0, 0, 'America/Phoenix');
    const full = eventsFromIcs(ics, meta, start, end).map((event) => `${event.uid}:${event.title}:${phoenixDate(event.start)}`).sort();
    const span = feedSpan(Date.parse('2026-10-16T15:00:00Z'));
    let step = startFeedParse({ id: 'budget-feed', text: ics, etag: '', windowStart: span.start, windowEnd: span.end, now: 1_000, budgetMs: 6 });
    expect(step.reparsed).toBe(true);
    expect(step.parseMs).toBeLessThan(8);
    let guard = 0;
    while (!step.done && guard++ < 30) {
      step = startFeedParse({ id: 'budget-feed', text: ics, etag: '', windowStart: span.start, windowEnd: span.end, now: 1_000, budgetMs: 6 });
      expect(step.parseMs).toBeLessThan(8);
    }
    expect(step.done).toBe(true);
    const raws = cachedFeed('budget-feed')?.raws || [];
    const stepped = projectFeed(raws, meta, start, end).map((event) => `${event.uid}:${event.title}:${phoenixDate(event.start)}`).sort();
    expect(stepped).toEqual(full);
    const churned = ics.replaceAll('DTSTAMP:20261022T120000Z', 'DTSTAMP:19990101T000000Z');
    const skipped = startFeedParse({
      id: 'budget-feed',
      text: churned,
      etag: '',
      windowStart: span.start,
      windowEnd: span.end,
      now: 1_000 + 5 * 60 * 1000,
      budgetMs: 6
    });
    expect(skipped.reparsed).toBe(false);
    expect(skipped.parseMs).toBe(0);
    expect(ICS_REFRESH_MS).toBe(30 * 60 * 1000);
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
    expect(weather.hourly[0].label).toBe('Mostly clear');
    expect(weather.hourly[1].label).toBe('Partly cloudy');
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

describe('Glance ics cron', () => {
  it('records feed stats on the cron and does not parse again when only DTSTAMP changes', async () => {
    const session = await signIn();
    const day = soonDate(2).replaceAll('-', '');
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:cron-board@google.com',
      'SUMMARY:Cron Dentist',
      'DTSTAMP:20261001T000000Z',
      `DTSTART;TZID=America/Phoenix:${day}T090000`,
      `DTEND;TZID=America/Phoenix:${day}T100000`,
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n');
    const churned = ics.replace('DTSTAMP:20261001T000000Z', 'DTSTAMP:20261002T010000Z');
    await withSession('/glance/api/settings', session, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feeds: [{ label: 'Personal', color: '#7dcea0', enabled: true, url: 'https://example.com/cal.ics' }] })
    });
    fetchMock.activate();
    try {
      fetchMock.get('https://example.com').intercept({ path: '/cal.ics', method: 'GET' }).reply(200, ics);
      fetchMock.get('https://example.com').intercept({ path: '/cal.ics', method: 'GET' }).reply(200, churned);
      await refreshGlanceBoard(env as Bindings);
      const first = await env.LIVEVIEW_DB.prepare(`SELECT value FROM glance_cache WHERE id LIKE 'glance:ics-stat:%'`).first<{ value: string }>();
      const stat = JSON.parse(first?.value || '{}') as { reparsed?: boolean; parseMs?: number; bytes?: number; done?: boolean };
      expect(stat.reparsed).toBe(true);
      expect(stat.done).toBe(true);
      expect(stat.bytes).toBe(ics.length);
      expect(stat.parseMs).toBeLessThan(8);
      const board = await withSession('/glance/api/calendar', session);
      expect(board.status).toBe(200);
      expect(JSON.stringify(await board.json())).toContain('Cron Dentist');
      await refreshGlanceBoard(env as Bindings);
      const second = await env.LIVEVIEW_DB.prepare(`SELECT value FROM glance_cache WHERE id LIKE 'glance:ics-stat:%'`).first<{ value: string }>();
      const again = JSON.parse(second?.value || '{}') as { reparsed?: boolean; notModified?: boolean; parseMs?: number };
      expect(again.reparsed).toBe(false);
      expect(again.parseMs).toBe(0);
    } finally {
      fetchMock.deactivate();
    }
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
      body: JSON.stringify({ title: 'Dentist', date: soonDate(), start: '16:00', durationMinutes: 60 })
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

  it('stores an encrypted notify key and posts it when env secrets are unset', async () => {
    const session = await signIn();
    const notifyUrl = 'https://notify.example/hook';
    const notifyKey = 'settings-notify-key-value';
    const saved = await withSession('/glance/api/settings', session, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        googleClientId: '1234567890-glance.apps.googleusercontent.com',
        googleClientSecret: 'GOCSPX-test-secret-value',
        event_notify_url: notifyUrl,
        event_notify_key: notifyKey
      })
    });
    expect(saved.status).toBe(200);
    const body = await saved.json() as { eventNotify: { urlSaved: boolean; keySaved: boolean } };
    expect(body.eventNotify).toEqual({ urlSaved: true, keySaved: true });
    const packed = JSON.stringify(body);
    expect(packed).not.toContain(notifyKey);
    expect(packed).not.toContain(notifyUrl);
    expect(packed).not.toContain('event_notify');

    const row = await env.LIVEVIEW_DB.prepare(
      `SELECT event_notify_url, event_notify_key FROM glance_settings WHERE id = 'default'`
    ).first<{ event_notify_url: string; event_notify_key: string }>();
    expect(row?.event_notify_url).toBe(notifyUrl);
    expect(row?.event_notify_key.startsWith('v1.')).toBe(true);
    expect(row?.event_notify_key).not.toContain(notifyKey);
    expect(await openSecret(row?.event_notify_key || '', await jwtSecret(env as unknown as Bindings))).toBe(notifyKey);

    const kept = await withSession('/glance/api/settings', session, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: 'golf' })
    });
    expect(kept.status).toBe(200);
    expect(JSON.stringify(await kept.json())).not.toContain(notifyKey);
    const still = await env.LIVEVIEW_DB.prepare(
      `SELECT event_notify_url, event_notify_key FROM glance_settings WHERE id = 'default'`
    ).first<{ event_notify_url: string; event_notify_key: string }>();
    expect(still?.event_notify_url).toBe(notifyUrl);
    expect(await openSecret(still?.event_notify_key || '', await jwtSecret(env as unknown as Bindings))).toBe(notifyKey);

    const rejected = await withSession('/glance/api/settings', session, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventNotifyUrl: 'http://notify.example/hook' })
    });
    expect(rejected.status).toBe(400);

    const material = await jwtSecret(env as unknown as Bindings);
    await env.LIVEVIEW_DB.prepare(
      `UPDATE glance_settings SET google_refresh_token = ?, google_account = ? WHERE id = 'default'`
    ).bind(await sealSecret('refresh-token-value', material), 'max.teeple@gmail.com').run();

    const seen = { authorization: '', payload: '', notifies: 0, googleWrites: 0 };
    fetchMock.activate();
    fetchMock.disableNetConnect();
    try {
      fetchMock.get('https://oauth2.googleapis.com').intercept({ path: '/token', method: 'POST' }).reply(200, {
        access_token: 'ya29.test-access',
        expires_in: 3600
      });
      fetchMock.get('https://www.googleapis.com').intercept({
        path: '/calendar/v3/calendars/primary/events?sendUpdates=none',
        method: 'POST'
      }).reply(() => {
        seen.googleWrites += 1;
        return { statusCode: 200, data: '{"id":"testeventid1"}', responseOptions: {} };
      });
      fetchMock.get('https://notify.example').intercept({ path: '/hook', method: 'POST' }).reply((opts: { headers?: unknown; body?: unknown }) => {
        seen.notifies += 1;
        const headerText = JSON.stringify(opts.headers);
        seen.authorization = headerText.match(/Bearer [^"\\]+/)?.[0] || '';
        seen.payload = typeof opts.body === 'string' ? opts.body : new TextDecoder().decode(opts.body as Uint8Array);
        return { statusCode: 200, data: '{"ok":true}', responseOptions: {} };
      });
      const eventDate = soonDate();
      const eventBody = {
        title: 'Glance notify test',
        date: eventDate,
        start: '16:00',
        durationMinutes: 5,
        idempotencyKey: 'submit-key-1'
      };
      const created = await withSession('/glance/api/events', session, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(eventBody)
      });
      expect(created.status).toBe(200);
      const createdBody = await created.json() as {
        event: { title: string; source: string; allDay: boolean };
        googleId: string;
        notify: { attempted: boolean; ok: boolean; status: number };
      };
      expect(createdBody.event.title).toBe('Glance notify test');
      expect(createdBody.event.source).toBe('glance');
      expect(createdBody.event.allDay).toBe(false);
      expect(createdBody.googleId).toBe('testeventid1');
      expect(createdBody.notify).toEqual({ attempted: true, ok: true, status: 200 });
      expect(JSON.stringify(createdBody)).not.toContain(notifyKey);
      expect(JSON.stringify(createdBody)).not.toContain(notifyUrl);
      expect(seen.authorization).toBe('Bearer settings-notify-key-value');
      const payload = JSON.parse(seen.payload || '{}') as { title: string; allDay: boolean; source: string; start: string; end: string };
      expect(payload.title).toBe('Glance notify test');
      expect(payload.allDay).toBe(false);
      expect(payload.source).toBe('glance');
      expect(payload.start.startsWith(`${eventDate}T16:00:00`)).toBe(true);
      expect(payload.end.startsWith(`${eventDate}T16:05:00`)).toBe(true);
      expect(Object.keys(payload).sort()).toEqual(['allDay', 'end', 'source', 'start', 'title']);
      expect(seen.notifies).toBe(1);
      expect(seen.googleWrites).toBe(1);

      const replay = await withSession('/glance/api/events', session, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(eventBody)
      });
      expect(replay.status).toBe(200);
      const replayBody = await replay.json() as { duplicate?: boolean; googleId: string; notify: { attempted: boolean } };
      expect(replayBody.duplicate).toBe(true);
      expect(replayBody.googleId).toBe('testeventid1');
      expect(replayBody.notify.attempted).toBe(true);
      expect(seen.notifies).toBe(1);
      expect(seen.googleWrites).toBe(1);

      const duplicate = await withSession('/glance/api/events', session, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...eventBody, idempotencyKey: 'submit-key-2' })
      });
      expect(duplicate.status).toBe(409);
      expect((await duplicate.json() as { message: string }).message).toBe('That event was just added');
      expect(seen.notifies).toBe(1);
      expect(seen.googleWrites).toBe(1);

      fetchMock.get('https://oauth2.googleapis.com').intercept({ path: '/token', method: 'POST' }).reply(200, {
        access_token: 'ya29.test-access',
        expires_in: 3600
      });
      fetchMock.get('https://www.googleapis.com').intercept({
        path: '/calendar/v3/calendars/primary/events/testeventid1?sendUpdates=none',
        method: 'DELETE'
      }).reply(204);
      const removed = await withSession('/glance/api/events/testeventid1?title=Glance%20notify%20test', session, { method: 'DELETE' });
      expect(removed.status).toBe(200);
      const left = await env.LIVEVIEW_DB.prepare(
        `SELECT COUNT(*) AS n FROM glance_added_events WHERE title = 'Glance notify test'`
      ).first<{ n: number }>();
      expect(left?.n).toBe(0);
    } finally {
      fetchMock.deactivate();
      await env.LIVEVIEW_DB.prepare(
        `UPDATE glance_settings SET google_refresh_token = '', google_account = '', event_notify_url = '', event_notify_key = '' WHERE id = 'default'`
      ).run();
    }
  });
});

describe('Daily verse', () => {
  it('keeps 366 public-domain entries and changes with the Phoenix day', async () => {
    expect(verses).toHaveLength(366);
    for (const row of verses as { reference: string; theme: string; text: string; devotional: string }[]) {
      expect(row.reference).toMatch(/\d+:\d+$/);
      expect(row.theme).toMatch(/^[A-Za-z]+$/);
      expect(row.text.length).toBeGreaterThan(8);
      const words = row.devotional.trim().split(/\s+/).length;
      expect(words).toBeGreaterThanOrEqual(150);
      expect(words).toBeLessThanOrEqual(250);
    }
    expect(verseIndex(Date.parse('2026-01-01T12:00:00-07:00'))).toBe(0);
    expect(verseIndex(Date.parse('2024-02-29T12:00:00-07:00'))).toBe(59);
    expect(verseIndex(Date.parse('2026-03-01T12:00:00-07:00'))).toBe(60);
    const today = verseFor(Date.parse('2026-01-01T12:00:00-07:00'));
    expect(today.date).toBe('2026-01-01');
    expect(today.reference).toBe('Philippians 4:13');
    expect(today.text).toBe('I can do all things through Christ who strengthens me.');
    const session = await signIn();
    const verse = await withSession('/glance/api/verse', session);
    expect(verse.status).toBe(200);
    const body = await verse.json() as { reference: string; theme: string; text?: string; devotional?: string };
    expect(body.reference).toBeTruthy();
    expect(body.theme).toBeTruthy();
    expect(body.text).toBeUndefined();
    expect(body.devotional).toBeUndefined();
    const full = await withSession('/glance/api/verse?full=1', session);
    expect(full.status).toBe(200);
    const detail = await full.json() as { text: string; devotional: string };
    expect(detail.text.length).toBeGreaterThan(8);
    expect(detail.devotional.split(/\s+/).length).toBeGreaterThanOrEqual(150);
  });
});

describe('Glance KV budget', () => {
  it('serves the polling routes without Workers KV', async () => {
    const session = await signIn();
    const paths = [
      '/glance/api/dashboard',
      '/glance/api/dashboard',
      '/glance/api/calendar',
      '/glance/api/weather',
      '/glance/api/lights',
      '/glance/api/location',
      '/glance/api/session'
    ];
    for (const path of paths) {
      const response = await withSession(path, session);
      expect(response.status, path).toBe(200);
    }
    const version = await api('/glance/api/version');
    expect(version.status).toBe(200);
    const listed = await env.LIVEVIEW_MEDIA.list();
    const names = listed.keys.map((key) => key.name);
    expect(names.filter((name) => name.startsWith('glance:') || name.startsWith('login-fail:'))).toEqual([]);
    const table = await env.LIVEVIEW_DB.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'glance_cache'`
    ).first<{ name: string }>();
    expect(table?.name).toBe('glance_cache');
    const script = await api('/glance/app.js');
    expect(script.status).toBe(200);
    const source = await script.text();
    expect(source).toContain('VERSION_POLL_MS = 5 * 60 * 1000');
    expect(source).toContain('DASHBOARD_POLL_MS = 3 * 60 * 1000');
    expect(source).toContain("fetch('/glance/api/version'");
    expect(source).toContain('addSaving');
    expect(source).toContain("button.textContent = busy ? 'Saving' : 'Add'");
    expect(source).toContain('idempotencyKey: crypto.randomUUID()');
    expect(source).toContain('function resetAddForm');
  });
});

describe('plug display names', () => {
  it('returns the three renamed plugs from the status read', async () => {
    const session = await signIn();
    const accessId = 'readlights01';
    const accessSecret = 'readlightssecret01';
    const saved = await withSession('/glance/api/settings', session, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tuyaAccessId: accessId, tuyaAccessSecret: accessSecret })
    });
    expect(saved.status).toBe(200);
    fetchMock.activate();
    fetchMock.disableNetConnect();
    try {
      fetchMock.get('https://openapi.tuyaus.com').intercept({ path: '/v1.0/token?grant_type=1', method: 'GET' }).reply(200, {
        success: true,
        result: { access_token: 'status-read-token', expire_time: 7200, uid: '' }
      });
      fetchMock.get('https://openapi.tuyaus.com').intercept({ path: '/v2.0/cloud/thing/device?page_size=20', method: 'GET' }).reply(200, {
        success: true,
        result: [
          { id: 'plugpatio1', name: 'Smart Plug 3', online: true },
          { id: 'plugrear02', name: 'Smart Plug 2', online: true },
          { id: 'plugleft03', name: 'Smart Plug', online: true }
        ]
      });
      for (const id of ['plugpatio1', 'plugrear02', 'plugleft03']) {
        fetchMock.get('https://openapi.tuyaus.com').intercept({ path: `/v1.0/devices/${id}/status`, method: 'GET' }).reply(200, {
          success: true,
          result: [{ code: 'switch_1', value: false }]
        });
      }
      const response = await withSession('/glance/api/lights', session);
      expect(response.status).toBe(200);
      const body = await response.json() as { ok: boolean; lights: { name: string }[]; message?: string };
      expect(body.ok).toBe(true);
      expect(body.lights.map((light) => light.name)).toEqual(['Patio Lights', 'Living Room Rear', 'Living Room Left']);
      expect(JSON.stringify(body)).not.toContain(accessId);
      expect(JSON.stringify(body)).not.toContain(accessSecret);
    } finally {
      fetchMock.deactivate();
      await env.LIVEVIEW_DB.prepare(
        `UPDATE glance_settings SET tuya_access_id = '', tuya_access_secret = '' WHERE id = 'default'`
      ).run();
    }
  });

  it('renames the three kitchen plugs and keeps Patio Lights first', () => {
    expect(plugAlias('Smart Plug 3')).toEqual({ name: 'Patio Lights', order: 0 });
    expect(plugAlias('Smart Plug 2')).toEqual({ name: 'Living Room Rear', order: 1 });
    expect(plugAlias('Smart Plug')).toEqual({ name: 'Living Room Left', order: 2 });
    expect(plugAlias('Lamp')).toBeNull();
    const names = ['Smart Plug', 'Smart Plug 3', 'Smart Plug 2', 'Hall lamp'];
    const ordered = names
      .map((name, index) => ({ name: plugAlias(name)?.name || name, order: plugSortKey(name, index) }))
      .sort((a, b) => a.order - b.order)
      .map((row) => row.name);
    expect(ordered.slice(0, 3)).toEqual(['Patio Lights', 'Living Room Rear', 'Living Room Left']);
  });
});

describe('light schedules', () => {
  const lat = 33.4484;
  const lon = -112.074;
  const lights = [
    { id: 'patioplug1', name: 'Smart Plug 3', online: true, on: false, code: 'switch_1' },
    { id: 'rearplug02', name: 'Smart Plug 2', online: true, on: true, code: 'switch_1' },
    { id: 'leftplug03', name: 'Smart Plug', online: true, on: false, code: 'switch_1' }
  ];
  function phoenix(year: number, month: number, day: number, hour: number, minute: number): number {
    return Date.UTC(year, month - 1, day, hour + 7, minute);
  }

  it('computes an October Phoenix sunset in the late afternoon', () => {
    const minutes = phoenixSunsetMinutes(2026, 10, 16, lat, lon);
    expect(minutes).toBeGreaterThan(17 * 60);
    expect(minutes).toBeLessThan(19 * 60);
    expect(phoenixSunsetMinutes(2026, 6, 21, lat, lon)).toBeGreaterThan(19 * 60);
    expect(phoenixSunsetMinutes(2026, 12, 21, lat, lon)).toBeLessThan(18 * 60);
    expect(scheduleHint('5:54 PM')).toBe('Patio on at sunset 5:54 PM · All off 9 PM ·\u00a0LR\u00a0on\u00a06\u00a0AM');
  });

  it('turns the patio on once after sunset and does not call plugs before sunset', () => {
    const before = planLightAutomations({
      nowMs: phoenix(2026, 10, 16, 16, 0),
      lat,
      lon,
      lights,
      lastPatioDate: null,
      lastEveningDate: '2026-10-16',
      lastMorningDate: '2026-10-16'
    });
    expect(before.runPatio).toBe(false);
    expect(before.patioOn).toEqual([]);
    const after = planLightAutomations({
      nowMs: phoenix(2026, 10, 16, 18, 10),
      lat,
      lon,
      lights,
      lastPatioDate: null,
      lastEveningDate: '2026-10-16',
      lastMorningDate: '2026-10-16'
    });
    expect(after.runPatio).toBe(true);
    expect(after.patioOn).toEqual(['patioplug1']);
    expect(after.eveningOff).toEqual([]);
    const again = planLightAutomations({
      nowMs: phoenix(2026, 10, 16, 18, 15),
      lat,
      lon,
      lights,
      lastPatioDate: after.date,
      lastEveningDate: '2026-10-16',
      lastMorningDate: '2026-10-16'
    });
    expect(again.runPatio).toBe(false);
    expect(again.patioOn).toEqual([]);
    const calls: string[] = [];
    for (const id of after.patioOn) calls.push('on:' + id);
    expect(calls).toEqual(['on:patioplug1']);
  });

  it('turns all three plugs off at 9 PM only when they are on', () => {
    const afternoon = planLightAutomations({
      nowMs: phoenix(2026, 10, 16, 20, 50),
      lat,
      lon,
      lights,
      lastPatioDate: '2026-10-16',
      lastEveningDate: null,
      lastMorningDate: '2026-10-16'
    });
    expect(afternoon.runEvening).toBe(false);
    expect(afternoon.eveningOff).toEqual([]);
    const evening = planLightAutomations({
      nowMs: phoenix(2026, 10, 16, 21, 5),
      lat,
      lon,
      lights: [
        { id: 'patioplug1', name: 'Smart Plug 3', online: true, on: true, code: 'switch_1' },
        { id: 'rearplug02', name: 'Smart Plug 2', online: true, on: true, code: 'switch_1' },
        { id: 'leftplug03', name: 'Smart Plug', online: true, on: false, code: 'switch_1' },
        { id: 'hallplug04', name: 'Hall lamp', online: true, on: true, code: 'switch_1' }
      ],
      lastPatioDate: '2026-10-16',
      lastEveningDate: null,
      lastMorningDate: '2026-10-16'
    });
    expect(evening.runEvening).toBe(true);
    expect(evening.eveningOff).toEqual(['patioplug1', 'rearplug02']);
    const later = planLightAutomations({
      nowMs: phoenix(2026, 10, 16, 21, 10),
      lat,
      lon,
      lights,
      lastPatioDate: '2026-10-16',
      lastEveningDate: evening.date,
      lastMorningDate: '2026-10-16'
    });
    expect(later.runEvening).toBe(false);
  });

  it('turns living-room plugs on at 6 AM only when they are off', () => {
    const night = planLightAutomations({
      nowMs: phoenix(2026, 10, 17, 5, 50),
      lat,
      lon,
      lights,
      lastPatioDate: null,
      lastEveningDate: '2026-10-16',
      lastMorningDate: null
    });
    expect(night.runMorning).toBe(false);
    expect(night.morningOn).toEqual([]);
    const morning = planLightAutomations({
      nowMs: phoenix(2026, 10, 17, 6, 5),
      lat,
      lon,
      lights,
      lastPatioDate: null,
      lastEveningDate: '2026-10-16',
      lastMorningDate: null
    });
    expect(morning.runMorning).toBe(true);
    expect(morning.morningOn).toEqual(['leftplug03']);
    expect(morning.patioOn).toEqual([]);
    const later = planLightAutomations({
      nowMs: phoenix(2026, 10, 17, 6, 10),
      lat,
      lon,
      lights,
      lastPatioDate: null,
      lastEveningDate: '2026-10-16',
      lastMorningDate: morning.date
    });
    expect(later.runMorning).toBe(false);
  });

  it('does not read or command plugs when no schedule is due', async () => {
    const session = await signIn();
    await withSession('/glance/api/settings', session, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tuyaAccessId: 'abc123xyz987', tuyaAccessSecret: 'abcdef0123456789abcd' })
    });
    const calls: string[] = [];
    await runScheduledLights(env as Bindings, Date.UTC(2026, 9, 16, 22, 0), {
      async listLights() {
        calls.push('list');
        return [];
      },
      async setLight() {
        calls.push('set');
      }
    });
    expect(calls).toEqual([]);
  });

  it('commands only the plugs that need a change, and only through the mock', async () => {
    const session = await signIn();
    await withSession('/glance/api/settings', session, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tuyaAccessId: 'abc123xyz987', tuyaAccessSecret: 'abcdef0123456789abcd' })
    });
    const calls: string[] = [];
    const devices = [
      { id: 'patioplug1', name: 'Smart Plug 3', online: true, on: true, code: 'switch_1' },
      { id: 'rearplug02', name: 'Smart Plug 2', online: true, on: true, code: 'switch_1' },
      { id: 'leftplug03', name: 'Smart Plug', online: true, on: false, code: 'switch_1' }
    ];
    await runScheduledLights(env as Bindings, phoenix(2026, 10, 16, 21, 5), {
      async listLights() {
        calls.push('list');
        return devices;
      },
      async setLight(_creds, _db, id, on) {
        calls.push((on ? 'on:' : 'off:') + id);
      }
    });
    expect(calls).toEqual(['list', 'off:patioplug1', 'off:rearplug02']);
    calls.length = 0;
    await runScheduledLights(env as Bindings, phoenix(2026, 10, 17, 6, 5), {
      async listLights() {
        calls.push('list');
        return devices;
      },
      async setLight(_creds, _db, id, on) {
        calls.push((on ? 'on:' : 'off:') + id);
      }
    });
    expect(calls).toEqual(['list', 'on:leftplug03']);
  });
});

describe('Glance photos', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

  function photoForm(bytes: Uint8Array = jpeg) {
    const form = new FormData();
    form.set('full', new File([bytes], 'photo.jpg', { type: 'image/jpeg' }));
    form.set('thumb', new File([bytes], 'thumb.jpg', { type: 'image/jpeg' }));
    form.set('width', '800');
    form.set('height', '600');
    return form;
  }

  it('stores a jpeg, serves it, and deletes it', async () => {
    resetPhotoStore();
    const session = await signIn();
    const page = await api('/glance/photos.html');
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('No photos yet');
    expect(html).toContain('Add photos');
    expect(html).toContain('id="crop-stage"');
    expect(html).toContain('>Skip<');
    expect(html).toContain('Manage photos');
    expect(html).toContain('Rotate left');
    expect(html).toContain('Share photos via QR');
    expect(html).not.toContain('__GLANCE_BUILD__');
    const saved = await withSession('/glance/api/photos', session, { method: 'POST', body: photoForm() });
    expect(saved.status).toBe(201);
    const id = (await saved.json() as { id: string }).id;
    const list = await withSession('/glance/api/photos', session);
    const photos = (await list.json() as { photos: { id: string }[] }).photos;
    expect(photos.some((photo) => photo.id === id)).toBe(true);
    const image = await withSession(`/glance/api/photos/${id}`, session);
    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toContain('image/jpeg');
    expect(image.headers.get('cache-control')).toContain('max-age=86400');
    expect(image.headers.get('cache-control')).not.toContain('no-store');
    expect(new Uint8Array(await image.arrayBuffer())[0]).toBe(0xff);
    const cached = await withSession(`/glance/api/photos/${id}`, session);
    expect(cached.status).toBe(200);
    expect(new Uint8Array(await cached.arrayBuffer())[0]).toBe(0xff);
    const thumb = await withSession(`/glance/api/photos/${id}/thumb`, session);
    expect(thumb.status).toBe(200);
    const cropped = photoForm();
    cropped.set('width', '1366');
    cropped.set('height', '1024');
    const replaced = await withSession(`/glance/api/photos/${id}`, session, { method: 'PUT', body: cropped });
    expect(replaced.status).toBe(200);
    const again = await withSession('/glance/api/photos', session);
    const updated = ((await again.json()) as { photos: { id: string; width: number; height: number }[] }).photos.find((photo) => photo.id === id);
    expect(updated?.width).toBe(1366);
    expect(updated?.height).toBe(1024);
    const removed = await withSession(`/glance/api/photos/${id}`, session, { method: 'DELETE' });
    expect(removed.status).toBe(200);
    const gone = await withSession(`/glance/api/photos/${id}`, session);
    expect(gone.status).toBe(404);
  });

  it('stores an original for re-crop and leaves older photos without one', async () => {
    const session = await signIn();
    const plain = await withSession('/glance/api/photos', session, { method: 'POST', body: photoForm() });
    expect(plain.status).toBe(201);
    const plainId = (await plain.json() as { id: string }).id;
    const missing = await withSession(`/glance/api/photos/${plainId}/original`, session);
    expect(missing.status).toBe(404);
    const still = await withSession(`/glance/api/photos/${plainId}`, session);
    expect(still.status).toBe(200);

    const form = photoForm();
    const original = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xd9]);
    form.set('original', new File([original], 'original.jpg', { type: 'image/jpeg' }));
    const saved = await withSession('/glance/api/photos', session, { method: 'POST', body: form });
    expect(saved.status).toBe(201);
    const id = (await saved.json() as { id: string }).id;
    const got = await withSession(`/glance/api/photos/${id}/original`, session);
    expect(got.status).toBe(200);
    expect(new Uint8Array(await got.arrayBuffer())[3]).toBe(0xe0);
    const cropped = photoForm();
    cropped.set('width', '1366');
    cropped.set('height', '1024');
    const replaced = await withSession(`/glance/api/photos/${id}`, session, { method: 'PUT', body: cropped });
    expect(replaced.status).toBe(200);
    const kept = await withSession(`/glance/api/photos/${id}/original`, session);
    expect(new Uint8Array(await kept.arrayBuffer())[3]).toBe(0xe0);
  });

  it('lets a share link upload without opening the board', async () => {
    const session = await signIn();
    const created = await withSession('/glance/api/photos/share', session, { method: 'POST' });
    expect(created.status).toBe(200);
    const share = await created.json() as { url: string; expiresAt: string };
    expect(share.url).toMatch(/^https:\/\/maxteeple\.test\/glance\/share\/[A-Za-z0-9_-]{20,64}$/);
    const token = share.url.split('/').pop() || '';
    const hashes = await env.LIVEVIEW_DB.prepare(`SELECT token_hash FROM glance_photo_shares`).all<{ token_hash: string }>();
    expect(hashes.results.some((row) => row.token_hash === token)).toBe(false);
    expect(JSON.stringify(hashes.results)).not.toContain(token);

    const locked = await api('/glance/api/photos');
    expect(locked.status).toBe(401);
    const page = await api(share.url.replace('https://maxteeple.test', ''));
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('Rotate left');
    expect(html).toContain('Shared by');
    expect(html).not.toContain('tuya');
    expect(html).not.toContain('calendar');

    const status = await api(`/glance/api/share/${token}`);
    expect(status.status).toBe(200);
    const body = await status.json() as { photos?: unknown; expiresAt?: string };
    expect(body.photos).toBeUndefined();
    expect(body.expiresAt).toBeTruthy();

    const form = photoForm();
    form.set('credit', 'Ada');
    const uploaded = await api(`/glance/api/share/${token}/photos`, { method: 'POST', body: form });
    expect(uploaded.status).toBe(201);
    const listed = await withSession('/glance/api/photos', session);
    const photos = (await listed.json() as { photos: { credit?: string }[] }).photos;
    expect(photos.some((photo) => photo.credit === 'Ada')).toBe(true);
    const peek = await api(`/glance/api/photos/${(await uploaded.json() as { id: string }).id}`);
    expect(peek.status).toBe(401);

    for (let i = 0; i < 7; i++) {
      const again = await api(`/glance/api/share/${token}/photos`, { method: 'POST', body: photoForm() });
      expect(again.status).toBe(201);
    }
    const limited = await api(`/glance/api/share/${token}/photos`, { method: 'POST', body: photoForm() });
    expect(limited.status).toBe(429);

    const stopped = await withSession('/glance/api/photos/share', session, { method: 'DELETE' });
    expect(stopped.status).toBe(200);
    const after = await api(`/glance/api/share/${token}/photos`, { method: 'POST', body: photoForm() });
    expect(after.status).toBe(410);
  });

  it('rejects a file that is not a jpeg', async () => {
    const session = await signIn();
    const saved = await withSession('/glance/api/photos', session, {
      method: 'POST',
      body: photoForm(new Uint8Array([1, 2, 3, 4]))
    });
    expect(saved.status).toBe(400);
  });

  it('stores the jpeg in D1 when R2 is unavailable', async () => {
    await ensureSchema(env.LIVEVIEW_DB);
    resetPhotoStore();
    const form = photoForm();
    const request = new Request(`${origin}/glance/api/photos`, { method: 'POST', body: form });
    const broken = {
      LIVEVIEW_DB: env.LIVEVIEW_DB,
      GLANCE_PHOTOS: {
        async put() { throw new Error('r2 disabled'); },
        async get() { return null; },
        async delete() { return; }
      }
    } as unknown as Bindings;
    const created = await createGlancePhoto(request, broken);
    const bytes = await readGlancePhoto(broken, created.id, 'full');
    expect(bytes?.[0]).toBe(0xff);
    const row = await env.LIVEVIEW_DB
      .prepare(`SELECT store FROM glance_photos WHERE id = ?`)
      .bind(created.id)
      .first<{ store: string }>();
    expect(row?.store).toBe('d1');
    expect(await removeGlancePhoto(broken, created.id)).toBe(true);
    resetPhotoStore();
  });
});
