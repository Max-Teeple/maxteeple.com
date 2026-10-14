import { Hono } from 'hono';
import { hashPassword, verifyPassword } from '../auth';
import { ensureSchema } from '../schema';
import type { Bindings } from '../types';
import { HttpError } from '../util';
import {
  DEFAULT_WIDGETS,
  GLANCE_COOKIE,
  GLANCE_FAIL_LIMIT,
  GLANCE_FAIL_WINDOW_MS,
  GLANCE_SESSION_SECONDS,
  LAYOUTS,
  THEMES,
  type GlanceLayout,
  type GlanceTheme
} from './defaults';
import { dedupeWorkMirrors, eventsFromIcs, maskWorkEvents, type AgendaEvent, type FeedMeta } from './ics';
import { PHOENIX, addDays, formatPhoenix, phoenixDate, phoenixWindow, zonedToUtc } from './time';
import {
  familyPhrase,
  geocodeAddress,
  haversineMeters,
  matchPlace,
  minutesFromHome,
  owntracksConfig,
  type Fix,
  type Place
} from './location';
import { clearTuyaToken, friendlyTuyaMessage, listLights, setLight, TuyaError } from './tuya';
import { airUrl, forecastUrl, shapeWeather, type WeatherPayload } from './weather';

type GlanceEnv = { Bindings: Bindings; Variables: { sessionId: string } };

type SettingsRow = {
  location_name: string;
  lat: number;
  lon: number;
  theme: string;
  clock_24h: number;
  night_start: number;
  night_end: number;
  widgets_json: string;
  layout: string;
  password_hash: string;
  tuya_access_id: string;
  tuya_access_secret: string;
};

type FeedRow = {
  id: string;
  label: string;
  color: string;
  url: string;
  enabled: number;
  sort_order: number;
};

type TodoRow = {
  id: string;
  title: string;
  done: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

type Widgets = typeof DEFAULT_WIDGETS;

const memory = new Map<string, { at: number; raw: string }>();

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join('; ');

const glance = new Hono<GlanceEnv>();

glance.use('*', async (c, next) => {
  await ensureSchema(c.env.LIVEVIEW_DB);
  await next();
});

glance.onError((error, c) => {
  const status = error instanceof HttpError ? error.status : 500;
  const message = error instanceof HttpError ? scrub(error.message) : 'Something went wrong';
  if (!(error instanceof HttpError)) {
    const detail = error instanceof Error ? error.message : 'error';
    console.error('[glance]', scrub(detail));
  }
  return c.json({ ok: false, message }, status as 400);
});

function scrub(message: string): string {
  return message.replace(/https?:\/\/\S+/gi, '[link]');
}

glance.post('/login', async (c) => {
  const body = await readJson(c.req.raw);
  const password = typeof body.password === 'string' ? body.password : '';
  if (!password || password.length > 200) throw new HttpError(401, 'Wrong password');
  const ip = clientIp(c.req.raw);
  const db = c.env.LIVEVIEW_DB;
  if (await failureCount(db, ip) >= GLANCE_FAIL_LIMIT) {
    throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
  }
  const settings = await loadSettings(db);
  const check = await verifyPassword(password, settings.password_hash);
  if (!check.ok) {
    await recordFailure(db, ip);
    throw new HttpError(401, 'Wrong password');
  }
  await db.prepare(`DELETE FROM glance_login_attempts WHERE ip = ?`).bind(ip).run();
  const token = await createSession(db);
  c.header('Set-Cookie', sessionCookie(token));
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true });
});

glance.use('*', async (c, next) => {
  const path = c.req.path;
  if (path.endsWith('/login')) return next();
  if (c.req.method === 'POST' && (path.endsWith('/location/owntracks') || path === '/location')) return next();
  const token = readCookie(c.req.header('cookie'), GLANCE_COOKIE);
  if (!token) return c.json({ ok: false, message: 'Login required' }, 401);
  const tokenHash = await sha256Hex(token);
  const row = await c.env.LIVEVIEW_DB.prepare(
    `SELECT id, expires_at FROM glance_sessions WHERE token_hash = ?`
  )
    .bind(tokenHash)
    .first<{ id: string; expires_at: string }>();
  if (!row || Date.parse(row.expires_at) <= Date.now()) {
    return c.json({ ok: false, message: 'Login required' }, 401);
  }
  c.set('sessionId', row.id);
  await next();
});

glance.post('/logout', async (c) => {
  await c.env.LIVEVIEW_DB.prepare(`DELETE FROM glance_sessions WHERE id = ?`).bind(c.get('sessionId')).run();
  c.header('Set-Cookie', sessionCookie('', 0));
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true });
});

glance.get('/session', async (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true, ...(await publicSettings(c.env.LIVEVIEW_DB)) });
});

glance.get('/settings', async (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true, ...(await publicSettings(c.env.LIVEVIEW_DB)) });
});

glance.put('/settings', async (c) => {
  const body = await readJson(c.req.raw);
  const db = c.env.LIVEVIEW_DB;
  const current = await loadSettings(db);
  const locationName = cleanName(body.locationName ?? current.location_name);
  const lat = numberIn(body.lat ?? current.lat, -90, 90, 'Latitude');
  const lon = numberIn(body.lon ?? current.lon, -180, 180, 'Longitude');
  const theme = themeOf(body.theme ?? current.theme);
  const layout = layoutOf(body.layout ?? current.layout);
  const clock24 = boolOf(body.clock24 ?? current.clock_24h) ? 1 : 0;
  const nightStart = hourOf(body.nightStart ?? current.night_start, 'Night start');
  const nightEnd = hourOf(body.nightEnd ?? current.night_end, 'Night end');
  const widgets = widgetsOf(body.widgets ?? JSON.parse(current.widgets_json || '{}'));
  const tuyaAccessId = secretField(body.tuyaAccessId, current.tuya_access_id);
  const tuyaAccessSecret = secretField(body.tuyaAccessSecret, current.tuya_access_secret);
  if (tuyaAccessId !== current.tuya_access_id || tuyaAccessSecret !== current.tuya_access_secret) {
    clearTuyaToken(current.tuya_access_id);
    clearTuyaToken(tuyaAccessId);
  }
  await db
    .prepare(
      `UPDATE glance_settings
       SET location_name = ?, lat = ?, lon = ?, theme = ?, layout = ?, clock_24h = ?, night_start = ?, night_end = ?, widgets_json = ?, tuya_access_id = ?, tuya_access_secret = ?, updated_at = ?
       WHERE id = 'default'`
    )
    .bind(
      locationName,
      lat,
      lon,
      theme,
      layout,
      clock24,
      nightStart,
      nightEnd,
      JSON.stringify(widgets),
      tuyaAccessId,
      tuyaAccessSecret,
      new Date().toISOString()
    )
    .run();
  if (Array.isArray(body.feeds)) await replaceFeeds(db, body.feeds);
  if (Array.isArray(body.lights) && body.lights.length) await saveLightPrefs(db, body.lights);
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true, ...(await publicSettings(db)) });
});

glance.post('/password', async (c) => {
  const body = await readJson(c.req.raw);
  const current = typeof body.current === 'string' ? body.current : '';
  const next = typeof body.next === 'string' ? body.next : '';
  if (next.length < 10 || next.length > 200) throw new HttpError(400, 'Use at least 10 characters');
  const db = c.env.LIVEVIEW_DB;
  const settings = await loadSettings(db);
  const check = await verifyPassword(current, settings.password_hash);
  if (!check.ok) throw new HttpError(401, 'Wrong password');
  const hashed = await hashPassword(next);
  await db
    .prepare(`UPDATE glance_settings SET password_hash = ?, updated_at = ? WHERE id = 'default'`)
    .bind(hashed, new Date().toISOString())
    .run();
  await db.prepare(`DELETE FROM glance_sessions`).run();
  const token = await createSession(db);
  c.header('Set-Cookie', sessionCookie(token));
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true });
});

glance.get('/weather', async (c) => {
  const settings = await loadSettings(c.env.LIVEVIEW_DB);
  const key = `glance:wx:${settings.lat.toFixed(3)}:${settings.lon.toFixed(3)}`;
  try {
    const payload = await remember<WeatherPayload>(c.env.LIVEVIEW_MEDIA, key, 600, () =>
      loadWeather(settings.lat, settings.lon)
    );
    c.header('Cache-Control', 'no-store');
    return c.json(payload);
  } catch (error) {
    console.error('[glance] weather', scrub(error instanceof Error ? error.message : 'error'));
    return c.json({ ok: false, message: 'Weather is unavailable' }, 200);
  }
});

glance.get('/calendar', async (c) => {
  const db = c.env.LIVEVIEW_DB;
  const feeds = (await db
    .prepare(`SELECT id, label, color, url, enabled, sort_order FROM glance_feeds WHERE enabled = 1 ORDER BY sort_order, label`)
    .all<FeedRow>()
  ).results.filter((feed) => feed.url);
  c.header('Cache-Control', 'no-store');
  if (!feeds.length) {
    return c.json(present([], Date.now(), []));
  }
  const key = `glance:cal:v2:${await sha256Hex(feeds.map((feed) => `${feed.id}|${feed.label}|${feed.color}|${feed.url}`).join('\n'))}`;
  const payload = await remember(c.env.LIVEVIEW_MEDIA, key, 180, () => buildCalendar(feeds));
  return c.json(payload);
});

glance.get('/lights', async (c) => {
  c.header('Cache-Control', 'no-store');
  const settings = await loadSettings(c.env.LIVEVIEW_DB);
  if (!settings.tuya_access_id || !settings.tuya_access_secret) {
    return c.json({ ok: true, configured: false, lights: [], message: 'Add the Tuya cloud keys in settings.' });
  }
  try {
    const devices = await listLights(
      { accessId: settings.tuya_access_id, accessSecret: settings.tuya_access_secret },
      c.env.LIVEVIEW_MEDIA
    );
    const prefs = await lightPrefs(c.env.LIVEVIEW_DB);
    return c.json({ ok: true, configured: true, lights: mergeLights(devices, prefs) });
  } catch (error) {
    console.error('[glance] lights', error instanceof TuyaError ? error.code : 0);
    return c.json({ ok: false, configured: true, lights: [], message: friendlyTuyaMessage(error) });
  }
});

glance.post('/lights/:id', async (c) => {
  const id = c.req.param('id');
  if (!/^[A-Za-z0-9]{6,40}$/.test(id)) throw new HttpError(400, 'Unknown plug');
  const body = await readJson(c.req.raw);
  if (typeof body.on !== 'boolean') throw new HttpError(400, 'Say whether the plug should be on');
  const settings = await loadSettings(c.env.LIVEVIEW_DB);
  if (!settings.tuya_access_id || !settings.tuya_access_secret) {
    throw new HttpError(400, 'Add the Tuya cloud keys in settings.');
  }
  try {
    await setLight(
      { accessId: settings.tuya_access_id, accessSecret: settings.tuya_access_secret },
      c.env.LIVEVIEW_MEDIA,
      id,
      body.on
    );
  } catch (error) {
    console.error('[glance] lights', error instanceof TuyaError ? error.code : 0);
    throw new HttpError(502, friendlyTuyaMessage(error));
  }
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true, id, on: body.on });
});

glance.post('/location/owntracks', async (c) => {
  const secret = basicParts(c.req.header('authorization'));
  const person =
    (await personForToken(c.env.LIVEVIEW_DB, secret.password)) ||
    (await personForToken(c.env.LIVEVIEW_DB, secret.username));
  if (!person) return c.json({ ok: false }, 401);
  const body = await readJson(c.req.raw).catch(() => ({}));
  const point = pointFromOwntracks(body);
  if (point) await storeFix(c.env.LIVEVIEW_DB, person.id, point);
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true });
});

glance.post('/location', async (c) => {
  const header = c.req.header('authorization') || '';
  const secret = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  const person = await personForToken(c.env.LIVEVIEW_DB, secret);
  if (!person) return c.json({ ok: false, message: 'Login required' }, 401);
  const body = await readJson(c.req.raw);
  const lat = Number(body.lat);
  const lon = Number(body.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    throw new HttpError(400, 'Need a latitude and longitude');
  }
  const acc = Number.isFinite(Number(body.acc)) ? Number(body.acc) : null;
  await storeFix(c.env.LIVEVIEW_DB, person.id, { lat, lon, acc, vel: null, regions: [], recordedAt: Date.now() });
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true });
});

glance.get('/location', async (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json(await locationView(c.env, c.req.url));
});

glance.post('/location/people', async (c) => {
  const body = await readJson(c.req.raw);
  const name = cleanName(body.name);
  const color = normalizeColor(body.color);
  const db = c.env.LIVEVIEW_DB;
  const count = await db.prepare(`SELECT COUNT(*) AS n FROM glance_people`).first<{ n: number }>();
  if ((count?.n || 0) >= 8) throw new HttpError(400, 'Eight people is the limit');
  const token = base64url(crypto.getRandomValues(new Uint8Array(18)));
  const id = crypto.randomUUID();
  const max = await db.prepare(`SELECT COALESCE(MAX(sort_order), -1) AS n FROM glance_people`).first<{ n: number }>();
  await db
    .prepare(`INSERT INTO glance_people (id, name, color, token_hash, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(id, name, color, await sha256Hex(token), (max?.n ?? -1) + 1, new Date().toISOString())
    .run();
  const origin = new URL(c.req.url).origin;
  const setup = owntracksConfig({ name, token, origin });
  c.header('Cache-Control', 'no-store');
  return c.json({
    ok: true,
    person: { id, name, color },
    token,
    owntracks: { url: setup.url, username: setup.username, password: token, link: setup.link }
  }, 201);
});

glance.post('/location/people/:id/token', async (c) => {
  const id = c.req.param('id');
  const db = c.env.LIVEVIEW_DB;
  const person = await db.prepare(`SELECT id, name, color FROM glance_people WHERE id = ?`).bind(id).first<{ id: string; name: string; color: string }>();
  if (!person) throw new HttpError(404, 'That person is not on the list');
  const token = base64url(crypto.getRandomValues(new Uint8Array(18)));
  await db.prepare(`UPDATE glance_people SET token_hash = ? WHERE id = ?`).bind(await sha256Hex(token), id).run();
  const setup = owntracksConfig({ name: person.name, token, origin: new URL(c.req.url).origin });
  c.header('Cache-Control', 'no-store');
  return c.json({
    ok: true,
    person,
    token,
    owntracks: { url: setup.url, username: setup.username, password: token, link: setup.link }
  });
});

glance.delete('/location/people/:id', async (c) => {
  const id = c.req.param('id');
  const db = c.env.LIVEVIEW_DB;
  await db.prepare(`DELETE FROM glance_location_points WHERE person_id = ?`).bind(id).run();
  await db.prepare(`DELETE FROM glance_people WHERE id = ?`).bind(id).run();
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true });
});

glance.put('/location/places', async (c) => {
  const body = await readJson(c.req.raw);
  const db = c.env.LIVEVIEW_DB;
  if (body.staleHours !== undefined) {
    const hours = Number(body.staleHours);
    if (!Number.isInteger(hours) || hours < 1 || hours > 72) throw new HttpError(400, 'Stale hours should be between 1 and 72');
    await db.prepare(`UPDATE glance_settings SET location_stale_hours = ? WHERE id = 'default'`).bind(hours).run();
  }
  if (body.home !== undefined) await saveHome(db, body.home);
  if (Array.isArray(body.places)) await savePlaces(db, body.places);
  c.header('Cache-Control', 'no-store');
  return c.json(await locationView(c.env, c.req.url));
});

glance.get('/todos', async (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true, todos: await listTodos(c.env.LIVEVIEW_DB) });
});

glance.post('/todos', async (c) => {
  const body = await readJson(c.req.raw);
  const title = cleanTitle(body.title);
  const db = c.env.LIVEVIEW_DB;
  const count = await db.prepare(`SELECT COUNT(*) AS n FROM glance_todos`).first<{ n: number }>();
  if ((count?.n || 0) >= 200) throw new HttpError(400, 'The list is full');
  const max = await db.prepare(`SELECT COALESCE(MAX(sort_order), -1) AS n FROM glance_todos`).first<{ n: number }>();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO glance_todos (id, title, done, sort_order, created_at, updated_at) VALUES (?, ?, 0, ?, ?, ?)`
    )
    .bind(id, title, (max?.n ?? -1) + 1, now, now)
    .run();
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true, todo: await getTodo(db, id) }, 201);
});

glance.post('/todos/reorder', async (c) => {
  const body = await readJson(c.req.raw);
  if (!Array.isArray(body.ids)) throw new HttpError(400, 'Expected a list of ids');
  const db = c.env.LIVEVIEW_DB;
  const existing = await listTodos(db);
  const wanted = body.ids.map((id) => String(id));
  const rank = new Map<string, number>();
  wanted.forEach((id, index) => {
    if (!rank.has(id)) rank.set(id, index);
  });
  const ordered = [
    ...existing.filter((todo) => rank.has(todo.id)).sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0)),
    ...existing.filter((todo) => !rank.has(todo.id))
  ];
  const now = new Date().toISOString();
  if (ordered.length) {
    await db.batch(
      ordered.map((todo, index) =>
        db.prepare(`UPDATE glance_todos SET sort_order = ?, updated_at = ? WHERE id = ?`).bind(index, now, todo.id)
      )
    );
  }
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true, todos: await listTodos(db) });
});

glance.patch('/todos/:id', async (c) => {
  const db = c.env.LIVEVIEW_DB;
  const id = c.req.param('id');
  const current = await getTodo(db, id);
  if (!current) throw new HttpError(404, 'To-do not found');
  const body = await readJson(c.req.raw);
  const title = body.title === undefined ? current.title : cleanTitle(body.title);
  const done = body.done === undefined ? current.done : boolOf(body.done);
  await db
    .prepare(`UPDATE glance_todos SET title = ?, done = ?, updated_at = ? WHERE id = ?`)
    .bind(title, done ? 1 : 0, new Date().toISOString(), id)
    .run();
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true, todo: await getTodo(db, id) });
});

glance.notFound((c) => c.json({ ok: false, message: 'Not found' }, 404));

glance.delete('/todos/:id', async (c) => {
  const id = c.req.param('id');
  await c.env.LIVEVIEW_DB.prepare(`DELETE FROM glance_todos WHERE id = ?`).bind(id).run();
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true });
});

export async function handleGlance(request: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/glance') return Response.redirect(new URL('/glance/', url).toString(), 302);
  if (url.pathname === '/glance/api' || url.pathname.startsWith('/glance/api/')) {
    const routed = new URL(request.url);
    routed.pathname = url.pathname.replace(/^\/glance\/api/, '') || '/';
    const response = await glance.fetch(new Request(routed.toString(), request), env, ctx);
    const headers = new Headers(response.headers);
    headers.set('Referrer-Policy', 'no-referrer');
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Cache-Control', 'no-store');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405 });
  }
  const assetUrl = new URL(request.url);
  if (url.pathname === '/glance/') assetUrl.pathname = '/glance/index.html';
  const asset = await env.ASSETS.fetch(new Request(assetUrl.toString(), request));
  const headers = new Headers(asset.headers);
  headers.set('Cache-Control', 'no-cache');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Content-Type-Options', 'nosniff');
  if (assetUrl.pathname.endsWith('.html')) {
    headers.set('Content-Security-Policy', CSP);
    headers.set('X-Frame-Options', 'DENY');
  }
  return new Response(asset.body, { status: asset.status, statusText: asset.statusText, headers });
}

async function buildCalendar(feeds: FeedRow[]) {
  const now = Date.now();
  const window = phoenixWindow(now, 8);
  const status: { id: string; label: string; color: string; ok: boolean }[] = [];
  const events: AgendaEvent[] = [];
  await Promise.all(
    feeds.map(async (feed) => {
      const meta: FeedMeta = { id: feed.id, label: feed.label, color: feed.color };
      try {
        const ics = await fetchIcs(feed.url);
        events.push(...eventsFromIcs(ics, meta, window.start, window.end));
        status.push({ id: feed.id, label: feed.label, color: feed.color, ok: true });
      } catch (error) {
        console.error('[glance] calendar refresh failed', feed.id, scrub(error instanceof Error ? error.message : 'error'));
        status.push({ id: feed.id, label: feed.label, color: feed.color, ok: false });
      }
    })
  );
  return present(maskWorkEvents(dedupeWorkMirrors(events)), now, status);
}

function present(events: AgendaEvent[], now: number, feeds: { id: string; label: string; color: string; ok: boolean }[]) {
  const window = phoenixWindow(now, 7);
  const today = phoenixDate(now);
  const days = window.dates.map((date, index) => {
    const [y, m, d] = date.split('-').map(Number);
    const noon = zonedToUtc(y, m, d, 12, 0, 0, PHOENIX);
    const weekday = new Intl.DateTimeFormat('en-US', { timeZone: PHOENIX, weekday: 'long' }).format(new Date(noon));
    const short = new Intl.DateTimeFormat('en-US', { timeZone: PHOENIX, weekday: 'short' }).format(new Date(noon));
    const dayStart = zonedToUtc(y, m, d, 0, 0, 0, PHOENIX);
    const next = addDays(y, m, d, 1);
    const dayEnd = zonedToUtc(next.y, next.m, next.d, 0, 0, 0, PHOENIX);
    const items = events
      .filter((event) => {
        if (event.allDay) {
          const startDate = phoenixDate(event.start);
          const endDate = phoenixDate(Math.max(event.end, event.start + 1));
          return date >= startDate && date < endDate;
        }
        return event.start < dayEnd && event.end > dayStart;
      })
      .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start - b.start);
    return {
      date,
      label: date === today ? 'Today' : index === 1 ? 'Tomorrow' : short,
      weekday,
      day: d,
      events: items.map(serializeEvent)
    };
  });
  const upcoming = events
    .filter((event) => !event.allDay && event.end > now)
    .sort((a, b) => a.start - b.start)[0];
  return {
    ok: true,
    timezone: PHOENIX,
    needsSetup: feeds.length === 0,
    generatedAt: new Date(now).toISOString(),
    days,
    upcoming: upcoming ? { ...serializeEvent(upcoming), started: upcoming.start <= now } : null,
    feeds
  };
}

function serializeEvent(event: AgendaEvent) {
  return {
    title: event.title,
    allDay: event.allDay,
    birthday: event.birthday || false,
    start: formatPhoenix(event.start),
    end: formatPhoenix(event.end),
    feed: event.feedLabel,
    color: event.color
  };
}

async function loadWeather(lat: number, lon: number): Promise<WeatherPayload> {
  const [forecastRes, airRes] = await Promise.all([
    fetch(forecastUrl(lat, lon), { signal: AbortSignal.timeout(12000) }),
    fetch(airUrl(lat, lon), { signal: AbortSignal.timeout(12000) })
  ]);
  if (!forecastRes.ok) throw new Error('forecast status');
  const forecast = (await forecastRes.json()) as Parameters<typeof shapeWeather>[0];
  const air = airRes.ok ? ((await airRes.json()) as Parameters<typeof shapeWeather>[1]) : null;
  return shapeWeather(forecast, air, Date.now());
}

async function fetchIcs(raw: string): Promise<string> {
  let current = raw;
  for (let hop = 0; hop < 4; hop++) {
    assertPublicHttps(current);
    let response: Response;
    try {
      response = await fetch(current, {
        redirect: 'manual',
        headers: { Accept: 'text/calendar, text/plain, */*', 'User-Agent': 'Glance/1.0' },
        signal: AbortSignal.timeout(12000)
      });
    } catch {
      throw new Error('fetch failed');
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error('redirect');
      current = new URL(location, current).toString();
      continue;
    }
    if (!response.ok) throw new Error('status');
    const text = await response.text();
    if (!text || text.length > 8_000_000) throw new Error('size');
    return text;
  }
  throw new Error('redirect');
}

function assertPublicHttps(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(400, 'Calendar link must be a valid https address');
  }
  if (url.protocol !== 'https:') throw new HttpError(400, 'Calendar link must use https');
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    isPrivateHost(host)
  ) {
    throw new HttpError(400, 'Calendar link must be a public https address');
  }
}

function isPrivateHost(host: string): boolean {
  const v4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  if (host.includes(':')) {
    return host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80');
  }
  return false;
}

async function replaceFeeds(db: D1Database, incoming: unknown[]) {
  if (incoming.length > 8) throw new HttpError(400, 'Keep it to 8 calendars');
  const existing = (
    await db.prepare(`SELECT id, label, color, url, enabled, sort_order FROM glance_feeds`).all<FeedRow>()
  ).results;
  const keep = new Set<string>();
  let order = 0;
  for (const item of incoming) {
    if (!item || typeof item !== 'object') throw new HttpError(400, 'Each calendar needs a name');
    const row = item as Record<string, unknown>;
    const label = cleanName(row.label);
    const color = normalizeColor(row.color);
    const enabled = row.enabled === undefined ? 1 : boolOf(row.enabled) ? 1 : 0;
    let url = typeof row.url === 'string' ? row.url.trim() : '';
    const id = typeof row.id === 'string' ? row.id : '';
    const prev = existing.find((feed) => feed.id === id);
    if (url) assertPublicHttps(url);
    if (prev) {
      if (!url) url = prev.url;
      if (!url) throw new HttpError(400, 'A calendar needs an ICS link');
      await db
        .prepare(`UPDATE glance_feeds SET label = ?, color = ?, url = ?, enabled = ?, sort_order = ? WHERE id = ?`)
        .bind(label, color, url, enabled, order, prev.id)
        .run();
      keep.add(prev.id);
    } else {
      if (!url) throw new HttpError(400, 'A new calendar needs an ICS link');
      const created = crypto.randomUUID();
      await db
        .prepare(`INSERT INTO glance_feeds (id, label, color, url, enabled, sort_order) VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(created, label, color, url, enabled, order)
        .run();
      keep.add(created);
    }
    order++;
  }
  for (const feed of existing) {
    if (!keep.has(feed.id)) await db.prepare(`DELETE FROM glance_feeds WHERE id = ?`).bind(feed.id).run();
  }
}

function basicParts(header: string | undefined): { username: string; password: string } {
  if (!header || !header.toLowerCase().startsWith('basic ')) return { username: '', password: '' };
  try {
    const decoded = atob(header.slice(6).trim());
    const split = decoded.indexOf(':');
    if (split < 0) return { username: decoded.trim(), password: '' };
    return { username: decoded.slice(0, split).trim(), password: decoded.slice(split + 1).trim() };
  } catch {
    return { username: '', password: '' };
  }
}

async function personForToken(db: D1Database, secret: string): Promise<{ id: string; name: string } | null> {
  if (!secret || secret.length < 8 || secret.length > 200) return null;
  const row = await db
    .prepare(`SELECT id, name FROM glance_people WHERE token_hash = ?`)
    .bind(await sha256Hex(secret))
    .first<{ id: string; name: string }>();
  return row || null;
}

function pointFromOwntracks(body: Record<string, unknown>): Fix | null {
  const type = String(body._type || '');
  if (type !== 'location' && type !== 'transition') return null;
  const lat = Number(body.lat);
  const lon = Number(body.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  const regions = Array.isArray(body.inregions) ? body.inregions.map((item) => String(item)).slice(0, 12) : [];
  if (type === 'transition' && String(body.event || '') === 'enter' && body.desc) regions.push(String(body.desc));
  const tst = Number(body.tst);
  const recordedAt = Number.isFinite(tst) && tst > 1_500_000_000 && tst < 4_000_000_000 ? tst * 1000 : Date.now();
  return {
    lat,
    lon,
    acc: finiteOrNull(body.acc),
    vel: finiteOrNull(body.vel),
    regions,
    recordedAt
  };
}

function finiteOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function storeFix(db: D1Database, personId: string, fix: Fix) {
  if (fix.recordedAt < Date.now() - 48 * 3600000 || fix.recordedAt > Date.now() + 5 * 60000) return;
  await db
    .prepare(
      `INSERT INTO glance_location_points (id, person_id, lat, lon, acc, vel, regions, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      crypto.randomUUID(),
      personId,
      fix.lat,
      fix.lon,
      fix.acc,
      fix.vel,
      JSON.stringify(fix.regions.slice(0, 12)),
      new Date(fix.recordedAt).toISOString()
    )
    .run();
  await purgeLocations(db, personId);
}

async function purgeLocations(db: D1Database, personId?: string) {
  const cutoff = new Date(Date.now() - 48 * 3600000).toISOString();
  await db.prepare(`DELETE FROM glance_location_points WHERE recorded_at < ?`).bind(cutoff).run();
  if (!personId) return;
  await db
    .prepare(
      `DELETE FROM glance_location_points
       WHERE person_id = ?
         AND id NOT IN (
           SELECT id FROM glance_location_points WHERE person_id = ? ORDER BY recorded_at DESC LIMIT 400
         )`
    )
    .bind(personId, personId)
    .run();
}

type PlaceRow = { id: string; name: string; lat: number; lon: number; radius_m: number; is_home: number };

async function locationView(env: Bindings, _requestUrl: string) {
  const db = env.LIVEVIEW_DB;
  await purgeLocations(db);
  const staleRow = await db
    .prepare(`SELECT location_stale_hours AS hours FROM glance_settings WHERE id = 'default'`)
    .first<{ hours: number }>();
  const staleHours = Number(staleRow?.hours) || 6;
  const placeRows = (
    await db
      .prepare(`SELECT id, name, lat, lon, radius_m, is_home FROM glance_places ORDER BY is_home DESC, sort_order, name`)
      .all<PlaceRow>()
  ).results || [];
  const places: Place[] = placeRows.map((row) => ({
    id: row.id,
    name: row.name,
    lat: row.lat,
    lon: row.lon,
    radiusM: row.radius_m,
    home: !!row.is_home
  }));
  const home = places.find((place) => place.home) || null;
  const people = (
    await db.prepare(`SELECT id, name, color FROM glance_people ORDER BY sort_order, name`).all<{ id: string; name: string; color: string }>()
  ).results || [];
  const now = Date.now();
  const cards = [];
  for (const person of people) {
    const points = (
      await db
        .prepare(
          `SELECT lat, lon, acc, vel, regions, recorded_at FROM glance_location_points
           WHERE person_id = ? ORDER BY recorded_at DESC LIMIT 2`
        )
        .bind(person.id)
        .all<{ lat: number; lon: number; acc: number | null; vel: number | null; regions: string; recorded_at: string }>()
    ).results || [];
    const latest = points[0];
    const previous = points[1];
    const fix = latest ? fixFromRow(latest) : null;
    const driving = fix ? moving(fix, previous ? fixFromRow(previous) : null, now) : false;
    const here = fix ? matchPlace(fix, places) : null;
    let minutes: number | null = null;
    if (fix && home && !here?.home && now - fix.recordedAt < staleHours * 3600000) {
      minutes = await minutesFromHome(env.LIVEVIEW_MEDIA, person.id, fix, home);
    }
    cards.push({
      id: person.id,
      name: person.name,
      color: person.color,
      phrase: familyPhrase({ name: person.name, fix, places, staleHours, now, minutes, driving }),
      stale: fix ? now - fix.recordedAt >= staleHours * 3600000 : false,
      age: fix ? formatAgeMs(now - fix.recordedAt) : null,
      lat: fix?.lat ?? null,
      lon: fix?.lon ?? null,
      minutes,
      place: here?.name || null,
      driving,
      atHome: !!here?.home
    });
  }
  return {
    ok: true,
    staleHours,
    home: home ? { name: home.name, lat: home.lat, lon: home.lon, radiusM: home.radiusM } : null,
    places: places.filter((place) => !place.home).map((place) => ({
      id: place.id,
      name: place.name,
      lat: place.lat,
      lon: place.lon,
      radiusM: place.radiusM
    })),
    people: cards
  };
}

function fixFromRow(row: { lat: number; lon: number; acc: number | null; vel: number | null; regions: string; recorded_at: string }): Fix {
  let regions: string[] = [];
  try {
    const parsed = JSON.parse(row.regions || '[]');
    if (Array.isArray(parsed)) regions = parsed.map((item) => String(item));
  } catch {
    regions = [];
  }
  return {
    lat: row.lat,
    lon: row.lon,
    acc: row.acc,
    vel: row.vel,
    regions,
    recordedAt: Date.parse(row.recorded_at)
  };
}

function moving(latest: Fix, previous: Fix | null, now: number): boolean {
  if ((latest.vel || 0) >= 10) return true;
  if (!previous) return false;
  if (now - previous.recordedAt > 15 * 60000) return false;
  return haversineMeters(latest.lat, latest.lon, previous.lat, previous.lon) > 250;
}

function formatAgeMs(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

async function saveHome(db: D1Database, home: unknown) {
  await db.prepare(`DELETE FROM glance_places WHERE is_home = 1`).run();
  if (home == null || home === false) return;
  if (!home || typeof home !== 'object') throw new HttpError(400, 'Home needs a place');
  const place = await resolvePlace(home as Record<string, unknown>, 'Home', true);
  await db
    .prepare(`INSERT INTO glance_places (id, name, lat, lon, radius_m, is_home, sort_order) VALUES ('home', 'Home', ?, ?, ?, 1, 0)`)
    .bind(place.lat, place.lon, place.radius)
    .run();
}

async function savePlaces(db: D1Database, incoming: unknown[]) {
  if (incoming.length > 12) throw new HttpError(400, 'Twelve places is the limit');
  await db.prepare(`DELETE FROM glance_places WHERE is_home = 0`).run();
  let order = 0;
  for (const item of incoming) {
    if (!item || typeof item !== 'object') continue;
    const place = await resolvePlace(item as Record<string, unknown>, 'Place', false);
    await db
      .prepare(`INSERT INTO glance_places (id, name, lat, lon, radius_m, is_home, sort_order) VALUES (?, ?, ?, ?, ?, 0, ?)`)
      .bind(crypto.randomUUID(), place.name, place.lat, place.lon, place.radius, order)
      .run();
    order++;
  }
}

async function resolvePlace(row: Record<string, unknown>, fallback: string, home: boolean) {
  let lat = Number(row.lat);
  let lon = Number(row.lon);
  const address = typeof row.address === 'string' ? row.address.trim() : '';
  if ((!Number.isFinite(lat) || !Number.isFinite(lon)) && address) {
    const found = await geocodeAddress(address);
    if (!found) throw new HttpError(400, "Couldn't find that address");
    lat = found.lat;
    lon = found.lon;
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    throw new HttpError(400, 'Need an address or a map point');
  }
  const name = home ? 'Home' : cleanName(row.name || fallback);
  let radius = Number(row.radius ?? row.radiusM ?? (home ? 120 : 200));
  if (!Number.isFinite(radius)) radius = home ? 120 : 200;
  radius = Math.round(Math.min(5000, Math.max(30, radius)));
  return { name, lat, lon, radius };
}

type LightPref = { device_id: string; label: string; enabled: number; sort_order: number };

async function lightPrefs(db: D1Database): Promise<LightPref[]> {
  const rows = await db
    .prepare(`SELECT device_id, label, enabled, sort_order FROM glance_lights ORDER BY sort_order, device_id`)
    .all<LightPref>();
  return rows.results || [];
}

function mergeLights(
  devices: { id: string; name: string; online: boolean; on: boolean | null; code: string | null }[],
  prefs: LightPref[]
) {
  const byId = new Map(prefs.map((pref) => [pref.device_id, pref]));
  return devices
    .map((device, index) => {
      const pref = byId.get(device.id);
      const renamed = pref?.label?.trim() || '';
      return {
        id: device.id,
        name: renamed || device.name,
        deviceName: device.name,
        enabled: pref ? !!pref.enabled : true,
        sortOrder: pref ? pref.sort_order : index,
        online: device.online,
        on: device.on,
        code: device.code
      };
    })
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

async function saveLightPrefs(db: D1Database, incoming: unknown[]) {
  if (incoming.length > 40) throw new HttpError(400, 'That is too many plugs');
  let order = 0;
  for (const item of incoming) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const id = String(row.id || '');
    if (!/^[A-Za-z0-9]{6,40}$/.test(id)) continue;
    const label = optionalName(row.label ?? row.name);
    const enabled = row.enabled === undefined ? 1 : boolOf(row.enabled) ? 1 : 0;
    await db
      .prepare(
        `INSERT INTO glance_lights (device_id, label, enabled, sort_order) VALUES (?, ?, ?, ?)
         ON CONFLICT(device_id) DO UPDATE SET label = excluded.label, enabled = excluded.enabled, sort_order = excluded.sort_order`
      )
      .bind(id, label, enabled, order)
      .run();
    order++;
  }
}

function secretField(incoming: unknown, current: string): string {
  if (typeof incoming !== 'string') return current || '';
  const value = incoming.trim();
  if (!value) return current || '';
  if (!/^[A-Za-z0-9]{10,64}$/.test(value)) throw new HttpError(400, 'That cloud key does not look right');
  return value;
}

function optionalName(value: unknown): string {
  const name = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (name.length > 80) throw new HttpError(400, 'Use a shorter name');
  return name;
}

async function publicSettings(db: D1Database) {
  const settings = await loadSettings(db);
  const feeds = (
    await db
      .prepare(`SELECT id, label, color, url, enabled, sort_order FROM glance_feeds ORDER BY sort_order, label`)
      .all<FeedRow>()
  ).results;
  let widgets = DEFAULT_WIDGETS;
  try {
    widgets = widgetsOf(JSON.parse(settings.widgets_json || '{}'));
  } catch {
    widgets = DEFAULT_WIDGETS;
  }
  return {
    locationName: settings.location_name,
    lat: settings.lat,
    lon: settings.lon,
    theme: themeOf(settings.theme),
    layout: layoutOf(settings.layout),
    clock24: !!settings.clock_24h,
    nightStart: settings.night_start,
    nightEnd: settings.night_end,
    widgets,
    feeds: feeds.map((feed) => ({
      id: feed.id,
      label: feed.label,
      color: feed.color,
      enabled: !!feed.enabled,
      saved: !!feed.url
    })),
    tuya: {
      accessIdSaved: !!settings.tuya_access_id,
      accessSecretSaved: !!settings.tuya_access_secret
    }
  };
}

async function loadSettings(db: D1Database): Promise<SettingsRow> {
  const row = await db
    .prepare(
      `SELECT location_name, lat, lon, theme, layout, clock_24h, night_start, night_end, widgets_json, password_hash,
              tuya_access_id, tuya_access_secret
       FROM glance_settings WHERE id = 'default'`
    )
    .first<SettingsRow>();
  if (!row) throw new HttpError(500, 'Glance is not ready');
  return row;
}

async function listTodos(db: D1Database) {
  const rows = (
    await db
      .prepare(`SELECT id, title, done, sort_order, created_at, updated_at FROM glance_todos ORDER BY sort_order, created_at`)
      .all<TodoRow>()
  ).results;
  return rows.map(serializeTodo);
}

async function getTodo(db: D1Database, id: string) {
  const row = await db
    .prepare(`SELECT id, title, done, sort_order, created_at, updated_at FROM glance_todos WHERE id = ?`)
    .bind(id)
    .first<TodoRow>();
  return row ? serializeTodo(row) : null;
}

function serializeTodo(row: TodoRow) {
  return {
    id: row.id,
    title: row.title,
    done: !!row.done,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function failureCount(db: D1Database, ip: string): Promise<number> {
  const row = await db
    .prepare(`SELECT attempt_count, window_start FROM glance_login_attempts WHERE ip = ?`)
    .bind(ip)
    .first<{ attempt_count: number; window_start: string }>();
  if (!row) return 0;
  if (Date.now() - Date.parse(row.window_start) > GLANCE_FAIL_WINDOW_MS) return 0;
  return Number(row.attempt_count) || 0;
}

async function recordFailure(db: D1Database, ip: string): Promise<void> {
  const now = new Date().toISOString();
  const row = await db
    .prepare(`SELECT attempt_count, window_start FROM glance_login_attempts WHERE ip = ?`)
    .bind(ip)
    .first<{ attempt_count: number; window_start: string }>();
  let count = 1;
  let start = now;
  if (row && Date.now() - Date.parse(row.window_start) <= GLANCE_FAIL_WINDOW_MS) {
    count = (Number(row.attempt_count) || 0) + 1;
    start = row.window_start;
  }
  await db
    .prepare(
      `INSERT INTO glance_login_attempts (ip, attempt_count, window_start) VALUES (?, ?, ?)
       ON CONFLICT(ip) DO UPDATE SET attempt_count = excluded.attempt_count, window_start = excluded.window_start`
    )
    .bind(ip, count, start)
    .run();
}

async function createSession(db: D1Database): Promise<string> {
  const token = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const now = new Date();
  await db
    .prepare(`INSERT INTO glance_sessions (id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), await sha256Hex(token), new Date(now.getTime() + GLANCE_SESSION_SECONDS * 1000).toISOString(), now.toISOString())
    .run();
  return token;
}

function sessionCookie(token: string, maxAge = GLANCE_SESSION_SECONDS): string {
  return `${GLANCE_COOKIE}=${token}; HttpOnly; Secure; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
}

function readCookie(header: string | undefined, name: string): string {
  if (!header) return '';
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return '';
}

function clientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') || 'local';
}

async function sha256Hex(value: string): Promise<string> {
  const bits = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bits)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > 100_000) throw new HttpError(413, 'Request is too large');
  const text = await request.text();
  if (text.length > 100_000) throw new HttpError(413, 'Request is too large');
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('shape');
    return data as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'Expected JSON');
  }
}

function cleanName(value: unknown): string {
  const name = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!name || name.length > 80) throw new HttpError(400, 'Use a shorter name');
  return name;
}

function cleanTitle(value: unknown): string {
  const title = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!title) throw new HttpError(400, 'Add a few words');
  if (title.length > 200) throw new HttpError(400, 'That to-do is too long');
  return title;
}

function numberIn(value: unknown, min: number, max: number, label: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${label} is out of range`);
  return n;
}

function hourOf(value: unknown, label: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 23) throw new HttpError(400, `${label} should be an hour from 0 to 23`);
  return n;
}

function boolOf(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function layoutOf(value: unknown): GlanceLayout {
  const layout = String(value || 'balanced');
  if ((LAYOUTS as readonly string[]).includes(layout)) return layout as GlanceLayout;
  return 'balanced';
}

function themeOf(value: unknown): GlanceTheme {
  const theme = String(value || 'auto');
  if ((THEMES as readonly string[]).includes(theme)) return theme as GlanceTheme;
  throw new HttpError(400, 'Unknown theme');
}

function widgetsOf(value: unknown): Widgets {
  const row = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    countdown: row.countdown === undefined ? true : boolOf(row.countdown),
    sun: row.sun === undefined ? true : boolOf(row.sun),
    air: row.air === undefined ? true : boolOf(row.air),
    summary: row.summary === undefined ? true : boolOf(row.summary),
    lights: row.lights === undefined ? true : boolOf(row.lights),
    family: row.family === undefined ? true : boolOf(row.family)
  };
}

function normalizeColor(value: unknown): string {
  const color = String(value || '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(color)) return color.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(color)) {
    const [r, g, b] = color.slice(1);
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return '#8eb6ff';
}

async function remember<T>(kv: KVNamespace, key: string, ttlSec: number, load: () => Promise<T>): Promise<T> {
  const hit = memory.get(key);
  if (hit && Date.now() - hit.at < ttlSec * 1000) return JSON.parse(hit.raw) as T;
  try {
    const stored = await kv.get(key);
    if (stored) {
      memory.set(key, { at: Date.now(), raw: stored });
      return JSON.parse(stored) as T;
    }
  } catch {
    /* KV is a cache. The live fetch still works. */
  }
  const value = await load();
  const raw = JSON.stringify(value);
  memory.set(key, { at: Date.now(), raw });
  try {
    await kv.put(key, raw, { expirationTtl: Math.max(60, ttlSec) });
  } catch {
    /* Memory cache still covers this isolate. */
  }
  return value;
}
