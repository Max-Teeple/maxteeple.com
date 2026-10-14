import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { hashPassword } from '../src/auth';
import { dedupeWorkMirrors, eventsFromIcs } from '../src/glance/ics';
import { partsInZone, phoenixDate, zonedToUtc } from '../src/glance/time';
import { shapeWeather } from '../src/glance/weather';

const origin = 'https://maxteeple.test';
const TEST_PASSWORD = 'correct-horse-battery';

async function api(path: string, init?: RequestInit) {
  return SELF.fetch(new Request(`${origin}${path}`, init));
}

function cookiePair(response: Response): string {
  const raw = response.headers.get('set-cookie') || '';
  return raw.split(';')[0];
}

async function signIn(): Promise<string> {
  await api('/glance/api/weather');
  const hash = await hashPassword(TEST_PASSWORD);
  await env.LIVEVIEW_DB.prepare(`UPDATE glance_settings SET password_hash = ? WHERE id = 'default'`).bind(hash).run();
  const login = await api('/glance/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: TEST_PASSWORD })
  });
  expect(login.status).toBe(200);
  return (login.headers.get('set-cookie') || '').split(';')[0];
}

function withSession(path: string, session: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set('cookie', session);
  return api(path, { ...init, headers });
}

describe('Glance kitchen board', () => {
  it('requires a login before any data route', async () => {
    const paths = ['/glance/api/weather', '/glance/api/calendar', '/glance/api/todos', '/glance/api/settings', '/glance/api/session'];
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
  });

  it('serves a chromeless login shell and a quiet site link', async () => {
    const page = await api('/glance/');
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('apple-mobile-web-app-capable');
    expect(html).toContain('login-password');
    expect(html).not.toMatch(/outlook\.office365|calendar\.google/i);
    const home = await api('/');
    expect(await home.text()).toContain('href="/glance/"');
    const redirect = await api('/glance', { redirect: 'manual' });
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get('location')).toBe(`${origin}/glance/`);
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

    const login = await api('/glance/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: TEST_PASSWORD })
    });
    expect(login.status).toBe(200);
    const setCookie = login.headers.get('set-cookie') || '';
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Max-Age=31536000');
    expect(setCookie.startsWith('__Host-glance_session=')).toBe(true);
    const session = cookiePair(login);

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
      { title: '[Work] Dentist', start: startMs + 3600000, end: endMs + 3600000, allDay: false, feedId: 'p', feedLabel: 'Personal', color: '#7dcea0' }
    ]);
    expect(kept.map((event) => `${event.feedLabel}:${event.title}`)).toEqual(['Work:Standup', 'Personal:Dentist']);
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
