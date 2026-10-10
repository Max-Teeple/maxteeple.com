import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { MiddlewareHandler } from 'hono';
import { adminTokenMatches, hashPassword, jwtSecret, signJwt, verifyJwt, verifyPassword } from './auth';
import { coordsForCity } from './cities';
import {
  accountsByIds,
  appLink,
  attachPendingInvites,
  consumerPreview,
  createNotification,
  findAccountByEmail,
  findAccountById,
  findCourseBySlug,
  findCourseByStreamKey,
  insertAccount,
  isPubliclyLive,
  linkFriends,
  listByRole,
  logActivity,
  logForFollowers,
  playbackUrl,
  publicAccount,
  publicOrigin,
  qAll,
  qOne,
  qRun,
  refreshFollowerCount,
  serializeFriendRequest,
  siteBase,
  updateAccount,
  ensureUniqueSlug,
  type AccountRow,
  type FriendRequestRow
} from './db';
import { geocodeAddress } from './geo';
import { MAX_UPLOAD_BYTES, readImage, saveImage } from './media';
import { enforceAccountPolicy } from './security';
import { ensureSchema } from './schema';
import { seedDemoData } from './seed';
import type { AppEnv } from './types';
import {
  HttpError,
  abbreviateState,
  boolish,
  normalizeEmail,
  normalizePhone,
  nowIso,
  numOrNull,
  parseIdList,
  parseNameParts,
  randomHex,
  slugify,
  stateSearchValues,
  stringifyIdList
} from './util';

const app = new Hono<AppEnv>().basePath('/liveview');

app.use('*', cors({
  origin: '*',
  allowHeaders: ['Authorization', 'Content-Type', 'x-admin-token', 'x-stream-secret'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD']
}));

app.use('*', async (c, next) => {
  await ensureSchema(c.env.LIVEVIEW_DB);
  await enforceAccountPolicy(c.env.LIVEVIEW_DB);
  await next();
});

app.onError((error, c) => {
  if (error instanceof HttpError) {
    return c.json({ success: false, message: error.message }, error.status as 400);
  }
  console.error('[LiveView]', error);
  const message = error instanceof Error ? error.message : 'Server error';
  if (/unique constraint/i.test(message)) {
    return c.json({ success: false, message: 'Email already exists' }, 409);
  }
  return c.json({ success: false, message }, 500);
});

function originOf(c: { env: AppEnv['Bindings']; req: { url: string } }) {
  return publicOrigin(c.env, c.req.url);
}

function baseOf(c: { env: AppEnv['Bindings']; req: { url: string } }) {
  return siteBase(c.env, c.req.url);
}

async function createSession(c: { env: AppEnv['Bindings']; req: { url: string } }, account: AccountRow) {
  const user = publicAccount(account, true, originOf(c));
  const token = await signJwt(
    { id: account.id, role: String(user.role), email: account.email },
    await jwtSecret(c.env)
  );
  return { success: true, token, user };
}

const authenticate: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return c.json({ success: false, message: 'Login required' }, 401);
  const payload = await verifyJwt(token, await jwtSecret(c.env));
  if (!payload) return c.json({ success: false, message: 'Session expired. Please log in again.' }, 401);
  const account = await findAccountById(c.env.LIVEVIEW_DB, Number(payload.id));
  if (!account) return c.json({ success: false, message: 'Account not found' }, 401);
  c.set('account', account);
  await next();
};

const requireSelf: MiddlewareHandler<AppEnv> = async (c, next) => {
  const account = c.get('account');
  if (!account || String(account.id) !== String(c.req.param('id'))) {
    return c.json({ success: false, message: 'You can only update your own account' }, 403);
  }
  await next();
};

const requireConsumer: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.get('account').role !== 'consumer') {
    return c.json({ success: false, message: 'Only consumer accounts can use favorites, follows, and friends' }, 403);
  }
  await next();
};

const requireCourseOwner: MiddlewareHandler<AppEnv> = async (c, next) => {
  if ((c.get('account').role || 'course_owner') !== 'course_owner') {
    return c.json({ success: false, message: 'Only course owner accounts can manage streams' }, 403);
  }
  await next();
};

async function assertAdmin(c: {
  env: AppEnv['Bindings'];
  req: { header: (name: string) => string | undefined };
}) {
  if (await adminTokenMatches(c.env, c.req.header('x-admin-token'))) return;
  throw new HttpError(
    403,
    'Admin approval token required. Set it with: npx wrangler secret put ADMIN_APPROVAL_TOKEN'
  );
}

async function readFields(c: { req: { header: (name: string) => string | undefined; formData: () => Promise<FormData>; json: () => Promise<unknown> } }) {
  const type = c.req.header('content-type') || '';
  if (type.includes('multipart/form-data')) {
    const form = await c.req.formData();
    const body: Record<string, string> = {};
    const files: Record<string, File> = {};
    for (const [key, value] of form.entries()) {
      if (value instanceof File) {
        if (value.size > 0) files[key] = value;
      } else {
        body[key] = value;
      }
    }
    return { body, files };
  }
  const json = await c.req.json().catch(() => ({}));
  return { body: (json && typeof json === 'object' ? json : {}) as Record<string, unknown>, files: {} as Record<string, File> };
}

async function locate(city: string, state: string, street: string | null) {
  if (street) {
    const geocoded = await geocodeAddress({ streetAddress: street, city, state });
    if (geocoded) return geocoded;
  }
  return coordsForCity(city, state);
}

function smsConfigured(env: AppEnv['Bindings']) {
  return Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_PHONE_NUMBER);
}

async function sendSms(env: AppEnv['Bindings'], to: string, body: string) {
  const phone = normalizePhone(to);
  if (!phone) return false;
  if (!smsConfigured(env)) {
    console.log(`[SMS off] Share-link invites are the free default. To ${phone}: ${body}`);
    return false;
  }
  const payload = new URLSearchParams({ To: phone, From: env.TWILIO_PHONE_NUMBER || '', Body: body });
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: payload
    }
  );
  if (!response.ok) {
    console.error('[SMS] Twilio error', response.status);
    return false;
  }
  return true;
}

async function maybeWebhook(env: AppEnv['Bindings'], payload: Record<string, unknown>) {
  if (!env.INVITE_WEBHOOK_URL) return false;
  try {
    const response = await fetch(env.INVITE_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return response.ok;
  } catch (error) {
    console.error('[Invite webhook]', error);
    return false;
  }
}

app.get('/health', async (c) => {
  const fromEnv = Boolean(c.env.JWT_SECRET?.trim());
  if (!fromEnv) await jwtSecret(c.env);
  return c.json({
    ok: true,
    service: 'liveview',
    database: 'd1',
    media: 'kv',
    basePath: '/liveview',
    smsConfigured: smsConfigured(c.env),
    jwtSecretConfigured: true,
    jwtSecretSource: fromEnv ? 'env' : 'd1',
    maxUploadBytes: MAX_UPLOAD_BYTES
  });
});

app.get('/', async (c) => {
  const url = new URL(c.req.url);
  url.pathname = '/liveview/index.html';
  return c.env.ASSETS.fetch(new Request(url.toString(), c.req.raw));
});

app.get('/c/:slug', (c) => {
  return c.redirect(`/liveview/course.html?slug=${encodeURIComponent(c.req.param('slug'))}`, 302);
});

app.get('/media/:id', async (c) => {
  const image = await readImage(c.env.LIVEVIEW_MEDIA, c.req.param('id'));
  if (!image) return c.json({ success: false, message: 'Not found' }, 404);
  return new Response(image.body, {
    headers: {
      'Content-Type': image.contentType,
      'Cache-Control': 'public, max-age=86400'
    }
  });
});

app.post('/register-user', async (c) => {
  const { body } = await readFields(c);
  const email = normalizeEmail(String(body.email || ''));
  const nameParts = parseNameParts(body.first_name, body.last_name, body.name);
  const city = String(body.city || '').trim();
  const state = String(body.state || '').trim();
  const password = String(body.password || '');
  if (!email || !password || !nameParts.name || !city || !state) {
    throw new HttpError(400, 'Name, city, state, email, and password are required');
  }
  if (await findAccountByEmail(c.env.LIVEVIEW_DB, email)) throw new HttpError(409, 'Email already exists');
  const user = await insertAccount(c.env.LIVEVIEW_DB, {
    name: nameParts.name,
    first_name: nameParts.first_name,
    last_name: nameParts.last_name,
    city,
    state,
    email,
    role: 'consumer',
    password: await hashPassword(password),
    phone: normalizePhone(String(body.phone || '')) || null,
    onboarding_completed: 0
  });
  await attachPendingInvites(c.env.LIVEVIEW_DB, user);
  return c.json(await createSession(c, user), 201);
});

app.post('/register-golf-course', async (c) => {
  const { body, files } = await readFields(c);
  const email = normalizeEmail(String(body.email || ''));
  const nameParts = parseNameParts(body.first_name, body.last_name, body.name);
  const city = String(body.city || '').trim();
  const state = String(body.state || '').trim();
  const password = String(body.password || '');
  if (!email || !password || !nameParts.name || !city || !state) {
    throw new HttpError(400, 'Name, city, state, email, and password are required');
  }
  if (await findAccountByEmail(c.env.LIVEVIEW_DB, email)) throw new HttpError(409, 'Email already exists');
  const street = String(body.street_address || body.streetAddress || '').trim() || null;
  const coords = await locate(city, state, street);
  const slug = await ensureUniqueSlug(c.env.LIVEVIEW_DB, slugify(nameParts.name));
  const course = await insertAccount(c.env.LIVEVIEW_DB, {
    name: nameParts.name,
    first_name: nameParts.first_name,
    last_name: nameParts.last_name,
    city,
    state,
    street_address: street,
    email,
    role: 'course_owner',
    password: await hashPassword(password),
    slug,
    latitude: coords.latitude,
    longitude: coords.longitude,
    stream_url: String(body.stream_url || body.streamUrl || '').trim() || null,
    description: String(body.description || '').trim() || null,
    course_logo: files.course_logo ? await saveImage(c.env.LIVEVIEW_MEDIA, files.course_logo) : null,
    stream_preview_photo: files.stream_preview_photo ? await saveImage(c.env.LIVEVIEW_MEDIA, files.stream_preview_photo) : null,
    onboarding_completed: 0
  });
  await attachPendingInvites(c.env.LIVEVIEW_DB, course);
  return c.json(await createSession(c, course), 201);
});

app.post('/login', async (c) => {
  const { body } = await readFields(c);
  const email = normalizeEmail(String(body.email || ''));
  const password = String(body.password || '');
  const user = await findAccountByEmail(c.env.LIVEVIEW_DB, email);
  if (!user) return c.json({ success: false, message: 'Invalid email or password' }, 401);
  const check = await verifyPassword(password, user.password);
  if (!check.ok) return c.json({ success: false, message: 'Invalid email or password' }, 401);
  let account = user;
  if (check.legacyBcrypt) {
    account = await updateAccount(c.env.LIVEVIEW_DB, user.id, { password: await hashPassword(password) });
  }
  await attachPendingInvites(c.env.LIVEVIEW_DB, account);
  return c.json(await createSession(c, account));
});

app.get('/me', authenticate, (c) => {
  return c.json({ success: true, user: publicAccount(c.get('account'), true, originOf(c)) });
});

app.get('/profile/:id', async (c) => {
  const user = await findAccountById(c.env.LIVEVIEW_DB, Number(c.req.param('id')));
  if (!user) return c.json({ success: false, message: 'Not found' }, 404);
  let includePrivate = false;
  const header = c.req.header('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (token) {
    const payload = await verifyJwt(token, await jwtSecret(c.env));
    includePrivate = Boolean(payload && String(payload.id) === String(user.id));
  }
  return c.json({ success: true, user: publicAccount(user, includePrivate, originOf(c)) });
});

app.put('/profile/:id', authenticate, requireSelf, async (c) => {
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const user = c.get('account');
  const updates: Partial<AccountRow> = {};
  if (body.city !== undefined) updates.city = String(body.city || '').trim();
  if (body.state !== undefined) updates.state = String(body.state || '').trim();
  if (body.description !== undefined) updates.description = String(body.description || '') || null;
  if (body.stream_url !== undefined) updates.stream_url = String(body.stream_url || '').trim() || null;
  if (body.bio !== undefined) updates.bio = String(body.bio || '').trim() || null;
  if (body.interests !== undefined) updates.interests = String(body.interests || '').trim() || null;
  if (body.phone !== undefined) updates.phone = normalizePhone(String(body.phone || '')) || null;
  if (body.handicap !== undefined) updates.handicap = numOrNull(body.handicap);
  if (body.home_course !== undefined) updates.home_course = String(body.home_course || '').trim() || null;
  if (body.rounds_played !== undefined) updates.rounds_played = numOrNull(body.rounds_played);
  if (body.profile_visibility !== undefined) updates.profile_visibility = String(body.profile_visibility || 'friends');
  if (body.street_address !== undefined) updates.street_address = String(body.street_address || '').trim() || null;
  if (body.name !== undefined || body.first_name !== undefined || body.last_name !== undefined) {
    const nameParts = parseNameParts(body.first_name, body.last_name, body.name ?? user.name);
    if (nameParts.name) {
      updates.first_name = nameParts.first_name;
      updates.last_name = nameParts.last_name;
      updates.name = nameParts.name;
    }
  }
  const isOwner = (user.role || 'course_owner') === 'course_owner';
  if (!isOwner) {
    delete updates.description;
    delete updates.stream_url;
    delete updates.street_address;
  }
  if (isOwner && (updates.street_address !== undefined || updates.city !== undefined || updates.state !== undefined)) {
    const coords = await locate(
      updates.city || user.city,
      updates.state || user.state,
      updates.street_address !== undefined ? updates.street_address : user.street_address
    );
    updates.latitude = coords.latitude;
    updates.longitude = coords.longitude;
  }
  const saved = await updateAccount(c.env.LIVEVIEW_DB, user.id, updates);
  return c.json({ success: true, user: publicAccount(saved, true, originOf(c)) });
});

app.put('/profile/:id/images', authenticate, requireSelf, async (c) => {
  const { files } = await readFields(c);
  const user = c.get('account');
  const updates: Partial<AccountRow> = {};
  const isOwner = (user.role || 'course_owner') === 'course_owner';
  if (isOwner && files.course_logo) updates.course_logo = await saveImage(c.env.LIVEVIEW_MEDIA, files.course_logo);
  if (isOwner && files.stream_preview_photo) updates.stream_preview_photo = await saveImage(c.env.LIVEVIEW_MEDIA, files.stream_preview_photo);
  if (files.profile_picture) updates.profile_picture = await saveImage(c.env.LIVEVIEW_MEDIA, files.profile_picture);
  if (!Object.keys(updates).length) {
    throw new HttpError(400, 'No image received. Choose a JPG or PNG file and try again.');
  }
  const saved = await updateAccount(c.env.LIVEVIEW_DB, user.id, updates);
  return c.json({ success: true, user: publicAccount(saved, true, originOf(c)) });
});

app.put('/profile/:id/onboarding', authenticate, requireSelf, async (c) => {
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const account = c.get('account');
  const updates: Partial<AccountRow> = {};
  if (body.bio !== undefined) updates.bio = String(body.bio || '').trim() || null;
  if (body.interests !== undefined) updates.interests = String(body.interests || '').trim() || null;
  if (body.phone !== undefined) updates.phone = normalizePhone(String(body.phone || '')) || null;
  if (body.name !== undefined || body.first_name !== undefined || body.last_name !== undefined) {
    const nameParts = parseNameParts(body.first_name, body.last_name, body.name ?? account.name);
    if (!nameParts.name) throw new HttpError(400, 'Name is required');
    updates.first_name = nameParts.first_name;
    updates.last_name = nameParts.last_name;
    updates.name = nameParts.name;
  }
  if (body.city !== undefined) updates.city = String(body.city || '').trim();
  if (body.state !== undefined) updates.state = abbreviateState(String(body.state || ''));
  const effectiveName = updates.name || account.name;
  const effectiveCity = updates.city ?? account.city;
  const effectiveState = updates.state ?? account.state;
  if (!effectiveName || !effectiveCity || !effectiveState) {
    throw new HttpError(400, 'First name, city, and state are required');
  }
  const saved = await updateAccount(c.env.LIVEVIEW_DB, account.id, updates);
  return c.json({ success: true, user: publicAccount(saved, true, originOf(c)) });
});

app.post('/profile/:id/complete-onboarding', authenticate, requireSelf, async (c) => {
  const saved = await updateAccount(c.env.LIVEVIEW_DB, c.get('account').id, { onboarding_completed: 1 });
  return c.json({
    success: true,
    user: publicAccount(saved, true, originOf(c)),
    redirect: saved.role === 'course_owner'
      ? `profile.html?id=${saved.id}`
      : 'index.html?welcome=1#streams'
  });
});

app.get('/profile/:id/dashboard', authenticate, requireSelf, requireConsumer, async (c) => {
  const account = c.get('account');
  const db = c.env.LIVEVIEW_DB;
  const favorites = parseIdList(account.favorite_course_ids);
  const followed = parseIdList(account.followed_course_ids);
  const friends = parseIdList(account.friend_ids);
  const incoming = await qAll<FriendRequestRow>(db, `SELECT * FROM friend_requests WHERE to_user_id = ? AND status = 'pending' ORDER BY created_at DESC`, account.id);
  const outgoing = await qAll<FriendRequestRow>(db, `SELECT * FROM friend_requests WHERE from_user_id = ? AND status = 'pending' ORDER BY created_at DESC`, account.id);
  const origin = originOf(c);
  return c.json({
    success: true,
    user: publicAccount(account, true, origin),
    favoriteCourses: (await accountsByIds(db, favorites, 'course_owner')).map((row) => publicAccount(row, false, origin)),
    followedCourses: (await accountsByIds(db, followed, 'course_owner')).map((row) => publicAccount(row, false, origin)),
    friends: (await accountsByIds(db, friends, 'consumer')).map((row) => ({
      id: row.id, name: row.name, city: row.city, state: row.state, profile_picture: row.profile_picture
    })),
    incomingRequests: await Promise.all(incoming.map((row) => serializeFriendRequest(db, row, origin))),
    outgoingRequests: await Promise.all(outgoing.map((row) => serializeFriendRequest(db, row, origin)))
  });
});

app.post('/profile/:id/course-lists', authenticate, requireSelf, requireConsumer, async (c) => {
  const body = await c.req.json().catch(() => ({})) as { courseId?: number; list?: string; enabled?: boolean };
  const targetField = body.list === 'followed' ? 'followed_course_ids' : body.list === 'favorites' ? 'favorite_course_ids' : null;
  if (!targetField) throw new HttpError(400, 'List must be favorites or followed');
  const course = await findAccountById(c.env.LIVEVIEW_DB, Number(body.courseId));
  if (!course || course.role !== 'course_owner') throw new HttpError(404, 'Course not found');
  const account = c.get('account');
  const ids = parseIdList(account[targetField]);
  const enabled = body.enabled !== false;
  const nextIds = enabled ? [...ids, course.id] : ids.filter((id) => id !== course.id);
  const wasFollowed = parseIdList(account.followed_course_ids).includes(course.id);
  const saved = await updateAccount(c.env.LIVEVIEW_DB, account.id, { [targetField]: stringifyIdList(nextIds) });
  if (targetField === 'followed_course_ids') {
    await refreshFollowerCount(c.env.LIVEVIEW_DB, course.id);
    if (enabled && !wasFollowed) {
      await logActivity(c.env.LIVEVIEW_DB, account.id, 'follow', `Following ${course.name}`, '', { courseId: course.id });
    }
  }
  return c.json({ success: true, user: publicAccount(saved, true, originOf(c)) });
});

app.post('/profile/:id/generate-stream-key', authenticate, requireSelf, requireCourseOwner, async (c) => {
  const streamKey = randomHex(16);
  const saved = await updateAccount(c.env.LIVEVIEW_DB, c.get('account').id, { stream_key: streamKey });
  return c.json({
    success: true,
    stream_key: streamKey,
    hls_url: saved.hls_url,
    message: 'Webhook key saved. Playback uses your YouTube, Twitch, Vimeo, or HLS link — LiveView does not run an RTMP server on the free plan.'
  });
});

app.post('/profile/:id/request-stream-approval', authenticate, requireSelf, requireCourseOwner, async (c) => {
  const user = await findAccountById(c.env.LIVEVIEW_DB, c.get('account').id);
  if (!user) throw new HttpError(404, 'Not found');
  if (!playbackUrl(user) && !user.stream_key) {
    throw new HttpError(400, 'Add a YouTube, Twitch, Vimeo, or HLS link before requesting approval');
  }
  const body = await c.req.json().catch(() => ({})) as { note?: string };
  const saved = await updateAccount(c.env.LIVEVIEW_DB, user.id, {
    stream_approval_requested_at: nowIso(),
    stream_approval_note: body.note || 'Approval requested from course studio'
  });
  return c.json({
    success: true,
    message: 'Approval requested. LiveView will review the course stream before it can go live.',
    user: publicAccount(saved, true, originOf(c))
  });
});

app.post('/profile/:id/stream-status', authenticate, requireSelf, requireCourseOwner, async (c) => {
  const body = await c.req.json().catch(() => ({})) as { stream_enabled?: boolean };
  const user = await findAccountById(c.env.LIVEVIEW_DB, c.get('account').id);
  if (!user) throw new HttpError(404, 'Not found');
  const enabled = Boolean(body.stream_enabled);
  if (enabled && !playbackUrl(user)) {
    throw new HttpError(400, 'Add a YouTube, Twitch, Vimeo, or public HLS link before turning the stream on');
  }
  if (enabled && !boolish(user.stream_approved)) {
    throw new HttpError(403, 'Your stream must be approved by LiveView before it can be turned on');
  }
  const wasLive = isPubliclyLive(user);
  const saved = await updateAccount(c.env.LIVEVIEW_DB, user.id, {
    stream_enabled: enabled ? 1 : 0,
    is_live: enabled && boolish(user.stream_approved) ? 1 : 0
  });
  if (enabled && boolish(user.stream_approved) && !wasLive) {
    await logForFollowers(c.env.LIVEVIEW_DB, saved, 'course_live', `${saved.name} is live`, 'A course you follow started broadcasting.');
  }
  return c.json({
    success: true,
    message: enabled ? 'Stream is marked live.' : 'Stream is marked offline.',
    user: publicAccount(saved, true, originOf(c))
  });
});

app.post('/profile/:id/restart-tour', authenticate, requireSelf, (c) => {
  return c.json({ success: true, message: 'Clear liveviewSiteTourDone in the browser or visit index.html?welcome=1' });
});

async function recommend(db: D1Database, account: AccountRow) {
  const city = (account.city || '').trim().toLowerCase();
  const stateValues = new Set(stateSearchValues(account.state).map((value) => value.toLowerCase()));
  const friendIds = new Set(parseIdList(account.friend_ids));
  const consumers = (await listByRole(db, 'consumer', 200)).filter((row) => row.id !== account.id && !friendIds.has(row.id));
  const rank = (row: AccountRow) => {
    const sameCity = row.city.toLowerCase() === city;
    const sameState = stateValues.has(row.state.toLowerCase());
    if (sameCity && sameState) return 0;
    if (sameState) return 1;
    return 2;
  };
  const recommendedFriends = [...consumers].sort((a, b) => rank(a) - rank(b)).slice(0, 12);
  const courses = await listByRole(db, 'course_owner', 400);
  const live = courses.filter((row) => isPubliclyLive(row)).slice(0, 6);
  const nearby = [...courses].sort((a, b) => rank(a) - rank(b));
  const seen = new Set<number>();
  const recommendedStreams = [];
  for (const course of [...live, ...nearby]) {
    if (seen.has(course.id)) continue;
    seen.add(course.id);
    recommendedStreams.push(course);
    if (recommendedStreams.length >= 12) break;
  }
  return { recommendedFriends, recommendedStreams, city, stateValues };
}

app.get('/onboarding/discover', authenticate, async (c) => {
  const account = c.get('account');
  const db = c.env.LIVEVIEW_DB;
  const { recommendedFriends, recommendedStreams, city, stateValues } = await recommend(db, account);
  const pending = await qAll<{ to_user_id: number | null }>(
    db,
    `SELECT to_user_id FROM friend_requests WHERE from_user_id = ? AND status = 'pending'`,
    account.id
  );
  const origin = originOf(c);
  const locationLabel = account.city && account.state ? `${account.city}, ${account.state}` : account.state || account.city || 'your area';
  return c.json({
    success: true,
    user: publicAccount(account, true, origin),
    locationLabel,
    recommendedFriends: recommendedFriends.map((row) => consumerPreview(row, origin)),
    recommendedStreams: recommendedStreams.map((course) => ({
      ...publicAccount(course, false, origin),
      areaMatch: course.city.toLowerCase() === city && stateValues.has(course.state.toLowerCase())
        ? 'city'
        : stateValues.has(course.state.toLowerCase()) ? 'state' : 'network'
    })),
    nearbyUsers: recommendedFriends.map((row) => consumerPreview(row, origin)),
    nearbyCourses: recommendedStreams.map((course) => publicAccount(course, false, origin)),
    pendingToIds: pending.map((row) => row.to_user_id).filter(Boolean)
  });
});

app.get('/users/browse', authenticate, requireConsumer, async (c) => {
  const account = c.get('account');
  const friendIds = new Set(parseIdList(account.friend_ids));
  const users = (await listByRole(c.env.LIVEVIEW_DB, 'consumer', 80))
    .filter((row) => row.id !== account.id && !friendIds.has(row.id))
    .slice(0, 48);
  const pending = await qAll<{ to_user_id: number | null }>(
    c.env.LIVEVIEW_DB,
    `SELECT to_user_id FROM friend_requests WHERE from_user_id = ? AND status = 'pending'`,
    account.id
  );
  const origin = originOf(c);
  return c.json({
    success: true,
    users: users.map((row) => consumerPreview(row, origin)),
    pendingToIds: pending.map((row) => row.to_user_id).filter(Boolean)
  });
});

async function createFriendRequest(c: { env: AppEnv['Bindings']; req: { url: string }; get: (key: 'account') => AccountRow }, input: {
  email?: string;
  phone?: string;
  userId?: number | null;
  message?: string | null;
}) {
  const account = c.get('account');
  const db = c.env.LIVEVIEW_DB;
  const email = input.email ? normalizeEmail(input.email) : '';
  const phone = input.phone ? normalizePhone(input.phone) : '';
  const userId = input.userId ? Number(input.userId) : null;
  if (!email && !phone && !userId) throw new HttpError(400, 'Email, phone, or user is required');

  let target: AccountRow | null = null;
  if (userId) target = await findAccountById(db, userId);
  else if (email) target = await findAccountByEmail(db, email);
  else if (phone) target = await qOne<AccountRow>(db, `SELECT * FROM courses WHERE phone = ? AND role = 'consumer'`, phone);
  if (target && target.role !== 'consumer') target = null;
  if (target && target.id === account.id) throw new HttpError(400, 'You cannot send a friend request to yourself');
  if (target && parseIdList(account.friend_ids).includes(target.id)) {
    throw new HttpError(400, 'You are already friends with this person');
  }
  if (target) {
    const duplicate = await qOne<{ id: number }>(
      db,
      `SELECT id FROM friend_requests WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending'`,
      account.id,
      target.id
    );
    if (duplicate) throw new HttpError(409, 'Friend request already sent');
  }

  const now = nowIso();
  const inserted = await qRun(
    db,
    `INSERT INTO friend_requests (from_user_id, to_user_id, invite_email, invite_phone, message, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
    account.id,
    target ? target.id : null,
    email || null,
    phone || null,
    input.message || null,
    now,
    now
  );
  const request = await qOne<FriendRequestRow>(db, 'SELECT * FROM friend_requests WHERE id = ?', Number(inserted.meta.last_row_id));
  if (!request) throw new Error('Could not save friend request');

  const shareLink = `${baseOf(c)}/login.html`;
  const inviteText = target
    ? `${account.name} sent you a friend request on LiveView Golf. Sign in to accept: ${shareLink}`
    : `${account.name} wants to connect on LiveView Golf. Create a free account: ${shareLink}`;
  let smsSent = false;
  const smsTarget = phone || (target?.phone && !email ? target.phone : '');
  if (smsTarget) smsSent = await sendSms(c.env, smsTarget, inviteText);
  const emailTo = email || (target?.email && !phone ? target.email : '');
  const emailSent = emailTo
    ? await maybeWebhook(c.env, { to: emailTo, subject: `LiveView Golf — ${account.name} invited you`, text: inviteText, shareLink })
    : false;

  return {
    success: true,
    message: target
      ? 'Friend request sent. They can accept it when they sign in.'
      : 'Invite saved. Share the link — text and email send only when those services are configured.',
    request: await serializeFriendRequest(db, request, originOf(c)),
    smsSent,
    emailSent,
    smsConfigured: smsConfigured(c.env),
    shareLink,
    shareMessage: inviteText
  };
}

app.get('/friend-requests', authenticate, requireConsumer, async (c) => {
  const account = c.get('account');
  const db = c.env.LIVEVIEW_DB;
  const incoming = await qAll<FriendRequestRow>(db, `SELECT * FROM friend_requests WHERE to_user_id = ? AND status = 'pending' ORDER BY created_at DESC`, account.id);
  const outgoing = await qAll<FriendRequestRow>(db, `SELECT * FROM friend_requests WHERE from_user_id = ? AND status = 'pending' ORDER BY created_at DESC`, account.id);
  const origin = originOf(c);
  return c.json({
    success: true,
    incoming: await Promise.all(incoming.map((row) => serializeFriendRequest(db, row, origin))),
    outgoing: await Promise.all(outgoing.map((row) => serializeFriendRequest(db, row, origin)))
  });
});

app.post('/friend-requests', authenticate, requireConsumer, async (c) => {
  const body = await c.req.json().catch(() => ({})) as { email?: string; phone?: string; userId?: number; message?: string };
  const result = await createFriendRequest(c, body);
  return c.json(result, 201);
});

app.post('/profile/:id/friends', authenticate, requireSelf, requireConsumer, async (c) => {
  const body = await c.req.json().catch(() => ({})) as { email?: string; phone?: string; message?: string };
  if (!body.email && !body.phone) throw new HttpError(400, 'Email or phone number is required');
  const result = await createFriendRequest(c, body);
  return c.json({ ...result, message: 'Friend request sent.' });
});

app.post('/friend-requests/:requestId/accept', authenticate, requireConsumer, async (c) => {
  const db = c.env.LIVEVIEW_DB;
  const request = await qOne<FriendRequestRow>(db, 'SELECT * FROM friend_requests WHERE id = ?', Number(c.req.param('requestId')));
  if (!request || request.status !== 'pending') throw new HttpError(404, 'Friend request not found');
  if (String(request.to_user_id) !== String(c.get('account').id)) {
    throw new HttpError(403, 'You can only accept requests sent to you');
  }
  const sender = await findAccountById(db, request.from_user_id);
  if (!sender) throw new HttpError(404, 'Sender account not found');
  await linkFriends(db, c.get('account'), sender);
  await qRun(db, `UPDATE friend_requests SET status = 'accepted', updated_at = ? WHERE id = ?`, nowIso(), request.id);
  const account = await findAccountById(db, c.get('account').id);
  await logActivity(db, account!.id, 'friend_accept', `You and ${sender.name} are friends`, '', { friendId: sender.id });
  await logActivity(db, sender.id, 'friend_accept', `${account!.name} accepted your friend request`, '', { friendId: account!.id });
  await createNotification(db, {
    user_id: sender.id,
    type: 'friend_accept',
    title: `${account!.name} accepted your friend request`,
    body: 'Say hello in Messages.',
    link: appLink(`messages.html?with=${account!.id}`)
  });
  const friends = await accountsByIds(db, parseIdList(account!.friend_ids), 'consumer');
  return c.json({
    success: true,
    message: 'Friend request accepted.',
    friends: friends.map((row) => ({ id: row.id, name: row.name, city: row.city, state: row.state, profile_picture: row.profile_picture }))
  });
});

app.post('/friend-requests/:requestId/decline', authenticate, requireConsumer, async (c) => {
  const db = c.env.LIVEVIEW_DB;
  const request = await qOne<FriendRequestRow>(db, 'SELECT * FROM friend_requests WHERE id = ?', Number(c.req.param('requestId')));
  if (!request || request.status !== 'pending') throw new HttpError(404, 'Friend request not found');
  const account = c.get('account');
  const allowed = String(request.to_user_id) === String(account.id) || String(request.from_user_id) === String(account.id);
  if (!allowed) throw new HttpError(403, 'You cannot update this request');
  await qRun(db, `UPDATE friend_requests SET status = 'declined', updated_at = ? WHERE id = ?`, nowIso(), request.id);
  return c.json({ success: true, message: 'Friend request declined.' });
});

app.delete('/profile/:id/friends/:friendId', authenticate, requireSelf, requireConsumer, async (c) => {
  const db = c.env.LIVEVIEW_DB;
  const friendId = Number(c.req.param('friendId'));
  const current = parseIdList(c.get('account').friend_ids).filter((id) => id !== friendId);
  await updateAccount(db, c.get('account').id, { friend_ids: stringifyIdList(current) });
  const friend = await findAccountById(db, friendId);
  if (friend) {
    const reciprocal = parseIdList(friend.friend_ids).filter((id) => id !== c.get('account').id);
    await updateAccount(db, friend.id, { friend_ids: stringifyIdList(reciprocal) });
  }
  const friends = await accountsByIds(db, current, 'consumer');
  return c.json({
    success: true,
    friends: friends.map((row) => ({ id: row.id, name: row.name, city: row.city, state: row.state, profile_picture: row.profile_picture }))
  });
});

app.get('/courses', async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1);
  const limit = Math.min(48, Math.max(6, parseInt(c.req.query('limit') || '24', 10) || 24));
  const q = String(c.req.query('q') || '').trim().toLowerCase();
  const state = String(c.req.query('state') || '').trim();
  const liveOnly = c.req.query('live') === '1' || c.req.query('live') === 'true';
  let rows = await listByRole(c.env.LIVEVIEW_DB, 'course_owner', 1000);
  if (state) {
    const values = new Set(stateSearchValues(state).map((value) => value.toLowerCase()));
    rows = rows.filter((row) => values.has(row.state.toLowerCase()));
  }
  if (liveOnly) rows = rows.filter((row) => isPubliclyLive(row));
  if (q) {
    rows = rows.filter((row) => `${row.name} ${row.city} ${row.state} ${row.description || ''}`.toLowerCase().includes(q));
  }
  rows.sort((a, b) => {
    const live = Number(isPubliclyLive(b)) - Number(isPubliclyLive(a));
    if (live) return live;
    const followers = (b.follower_count || 0) - (a.follower_count || 0);
    if (followers) return followers;
    return a.name.localeCompare(b.name);
  });
  const total = rows.length;
  const slice = rows.slice((page - 1) * limit, page * limit);
  const origin = originOf(c);
  const payload = {
    courses: slice.map((row) => publicAccount(row, false, origin)),
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit) || 1
  };
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload)));
  const etag = `"${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16)}"`;
  if (c.req.header('if-none-match') === etag) return c.body(null, 304);
  c.header('ETag', etag);
  c.header('Cache-Control', 'public, max-age=15');
  return c.json(payload);
});

app.get('/courses/map', async (c) => {
  const courses = await listByRole(c.env.LIVEVIEW_DB, 'course_owner', 1000);
  return c.json({
    courses: courses.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      city: row.city,
      state: row.state,
      is_live: isPubliclyLive(row),
      latitude: row.latitude,
      longitude: row.longitude,
      is_demo: boolish(row.is_demo)
    }))
  });
});

app.get('/courses/slug/:slug', async (c) => {
  const course = await findCourseBySlug(c.env.LIVEVIEW_DB, c.req.param('slug'));
  if (!course) return c.json({ success: false, message: 'Course not found' }, 404);
  return c.json({ success: true, course: publicAccount(course, false, originOf(c)) });
});

app.get('/courses/:id/highlights', async (c) => {
  const rows = await qAll<Record<string, unknown>>(
    c.env.LIVEVIEW_DB,
    'SELECT * FROM stream_highlights WHERE course_id = ? ORDER BY recorded_at DESC LIMIT 12',
    Number(c.req.param('id'))
  );
  return c.json({
    success: true,
    highlights: rows.map((row) => ({ ...row, demo_label: String(row.title || '').startsWith('Demo replay') ? 'Demo data' : null }))
  });
});

app.post('/webhooks/stream-status', async (c) => {
  const secret = c.env.STREAM_WEBHOOK_SECRET;
  if (secret && c.req.header('x-stream-secret') !== secret) {
    throw new HttpError(403, 'Invalid webhook secret');
  }
  const body = await c.req.json().catch(() => ({})) as { stream_key?: string; live?: boolean; hls_url?: string; playback_url?: string };
  if (!body.stream_key) throw new HttpError(400, 'stream_key required');
  const course = await findCourseByStreamKey(c.env.LIVEVIEW_DB, body.stream_key);
  if (!course) return c.json({ success: false, message: 'Unknown stream key' }, 404);
  const goingLive = Boolean(body.live);
  const updates: Partial<AccountRow> = {
    stream_enabled: goingLive ? 1 : course.stream_enabled,
    is_live: goingLive && boolish(course.stream_approved) ? 1 : 0
  };
  if (body.hls_url) updates.hls_url = body.hls_url;
  if (body.playback_url) updates.stream_url = body.playback_url;
  const wasLive = isPubliclyLive(course);
  const saved = await updateAccount(c.env.LIVEVIEW_DB, course.id, updates);
  if (goingLive && !wasLive && boolish(course.stream_approved)) {
    await logForFollowers(
      c.env.LIVEVIEW_DB,
      saved,
      'course_live',
      `${saved.name} is live`,
      `Watch the broadcast from ${saved.city}, ${saved.state}`,
      { courseId: saved.id, slug: saved.slug }
    );
  }
  return c.json({ success: true, course: publicAccount(saved, true, originOf(c)) });
});

app.get('/admin/stream-queue', async (c) => {
  await assertAdmin(c);
  const pending = await qAll<AccountRow>(
    c.env.LIVEVIEW_DB,
    `SELECT * FROM courses WHERE role = 'course_owner' AND stream_approval_requested_at IS NOT NULL AND stream_approved = 0 ORDER BY stream_approval_requested_at ASC`
  );
  const origin = originOf(c);
  return c.json({ success: true, queue: pending.map((row) => publicAccount(row, true, origin)) });
});

app.post('/admin/courses/:id/approval', async (c) => {
  await assertAdmin(c);
  const body = await c.req.json().catch(() => ({})) as { approved?: boolean; note?: string };
  const course = await findAccountById(c.env.LIVEVIEW_DB, Number(c.req.param('id')));
  if (!course || course.role !== 'course_owner') return c.json({ success: false, message: 'Course not found' }, 404);
  const approved = Boolean(body.approved);
  const saved = await updateAccount(c.env.LIVEVIEW_DB, course.id, {
    stream_approved: approved ? 1 : 0,
    stream_enabled: approved ? course.stream_enabled : 0,
    is_live: approved && boolish(course.stream_enabled) ? 1 : 0,
    stream_approval_note: body.note || null
  });
  return c.json({ success: true, course: publicAccount(saved, true, originOf(c)) });
});

app.post('/admin/seed-demo', async (c) => {
  await assertAdmin(c);
  const result = await seedDemoData(c.env.LIVEVIEW_DB);
  return c.json({ success: true, ...result });
});

app.post('/admin/reset-password', async (c) => {
  await assertAdmin(c);
  const body = await c.req.json().catch(() => ({})) as { email?: string; password?: string };
  const email = normalizeEmail(body.email || '');
  const password = String(body.password || '');
  if (!email || password.length < 8) throw new HttpError(400, 'Email and a password of at least 8 characters are required');
  const user = await findAccountByEmail(c.env.LIVEVIEW_DB, email);
  if (!user) return c.json({ success: false, message: 'Account not found' }, 404);
  await updateAccount(c.env.LIVEVIEW_DB, user.id, { password: await hashPassword(password) });
  return c.json({ success: true, message: 'Password reset. The account can sign in with the new password.' });
});

app.get('/activity/feed', authenticate, async (c) => {
  const limit = Math.min(50, parseInt(c.req.query('limit') || '30', 10) || 30);
  const rows = await qAll<{ id: number; type: string; title: string; body: string | null; meta_json: string; created_at: string; read_at: string | null }>(
    c.env.LIVEVIEW_DB,
    'SELECT * FROM activities WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
    c.get('account').id,
    limit
  );
  return c.json({
    success: true,
    items: rows.map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      body: row.body,
      meta: JSON.parse(row.meta_json || '{}'),
      createdAt: row.created_at,
      read_at: row.read_at
    }))
  });
});

app.get('/notifications', authenticate, async (c) => {
  const rows = await qAll<Record<string, unknown>>(
    c.env.LIVEVIEW_DB,
    'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 40',
    c.get('account').id
  );
  return c.json({
    success: true,
    notifications: rows.map((row) => ({ ...row, createdAt: row.created_at }))
  });
});

app.post('/notifications/:id/read', authenticate, async (c) => {
  const row = await qOne<{ id: number }>(
    c.env.LIVEVIEW_DB,
    'SELECT id FROM notifications WHERE id = ? AND user_id = ?',
    Number(c.req.param('id')),
    c.get('account').id
  );
  if (!row) return c.json({ success: false, message: 'Not found' }, 404);
  await qRun(c.env.LIVEVIEW_DB, 'UPDATE notifications SET read_at = ?, updated_at = ? WHERE id = ?', nowIso(), nowIso(), row.id);
  return c.json({ success: true });
});

app.post('/notifications/push-subscribe', authenticate, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  await updateAccount(c.env.LIVEVIEW_DB, c.get('account').id, { push_subscription: JSON.stringify(body || {}) });
  return c.json({ success: true, message: 'Push preferences saved' });
});

app.get('/messages/conversations', authenticate, async (c) => {
  const db = c.env.LIVEVIEW_DB;
  const id = c.get('account').id;
  const sent = await qAll<{ to_user_id: number }>(db, 'SELECT to_user_id FROM messages WHERE from_user_id = ? LIMIT 100', id);
  const received = await qAll<{ from_user_id: number }>(db, 'SELECT from_user_id FROM messages WHERE to_user_id = ? LIMIT 100', id);
  const partnerIds = new Set<number>();
  sent.forEach((row) => partnerIds.add(row.to_user_id));
  received.forEach((row) => partnerIds.add(row.from_user_id));
  const partners = await accountsByIds(db, Array.from(partnerIds));
  return c.json({
    success: true,
    partners: partners.map((row) => ({ id: row.id, name: row.name, profile_picture: row.profile_picture, city: row.city, state: row.state }))
  });
});

app.get('/messages/:partnerId', authenticate, async (c) => {
  const db = c.env.LIVEVIEW_DB;
  const partnerId = Number(c.req.param('partnerId'));
  const me = c.get('account').id;
  const rows = await qAll<Record<string, unknown>>(
    db,
    `SELECT * FROM messages
     WHERE (from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)
     ORDER BY created_at ASC LIMIT 200`,
    me, partnerId, partnerId, me
  );
  await qRun(
    db,
    'UPDATE messages SET read_at = ? WHERE from_user_id = ? AND to_user_id = ? AND read_at IS NULL',
    nowIso(), partnerId, me
  );
  return c.json({ success: true, messages: rows.map((row) => ({ ...row, createdAt: row.created_at })) });
});

app.post('/messages/:partnerId', authenticate, async (c) => {
  const body = await c.req.json().catch(() => ({})) as { body?: string };
  const text = String(body.body || '').trim();
  if (!text) throw new HttpError(400, 'Message required');
  const partnerId = Number(c.req.param('partnerId'));
  const partner = await findAccountById(c.env.LIVEVIEW_DB, partnerId);
  if (!partner) return c.json({ success: false, message: 'User not found' }, 404);
  const now = nowIso();
  const inserted = await qRun(
    c.env.LIVEVIEW_DB,
    `INSERT INTO messages (from_user_id, to_user_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    c.get('account').id, partnerId, text, now, now
  );
  await createNotification(c.env.LIVEVIEW_DB, {
    user_id: partnerId,
    type: 'message',
    title: `Message from ${c.get('account').name}`,
    body: text.slice(0, 120),
    link: appLink(`messages.html?with=${c.get('account').id}`)
  });
  const message = await qOne<Record<string, unknown>>(c.env.LIVEVIEW_DB, 'SELECT * FROM messages WHERE id = ?', Number(inserted.meta.last_row_id));
  return c.json({ success: true, message: message ? { ...message, createdAt: message.created_at } : null }, 201);
});

app.get('/groups', authenticate, async (c) => {
  const rows = await qAll<{ id: number; name: string; city: string | null; state: string | null; invite_code: string; member_ids: string; created_by: number; created_at: string }>(
    c.env.LIVEVIEW_DB,
    'SELECT * FROM lv_groups ORDER BY created_at DESC LIMIT 50'
  );
  const mine = rows.filter((group) => parseIdList(group.member_ids).includes(c.get('account').id));
  return c.json({ success: true, groups: mine.map((group) => ({ ...group, createdAt: group.created_at })) });
});

app.post('/groups', authenticate, async (c) => {
  const body = await c.req.json().catch(() => ({})) as { name?: string; city?: string; state?: string };
  const name = String(body.name || '').trim();
  if (!name) throw new HttpError(400, 'Group name required');
  const code = randomHex(4);
  const now = nowIso();
  const account = c.get('account');
  const inserted = await qRun(
    c.env.LIVEVIEW_DB,
    `INSERT INTO lv_groups (name, city, state, invite_code, member_ids, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    name,
    body.city || account.city,
    body.state || account.state,
    code,
    JSON.stringify([account.id]),
    account.id,
    now,
    now
  );
  const group = await qOne<Record<string, unknown>>(c.env.LIVEVIEW_DB, 'SELECT * FROM lv_groups WHERE id = ?', Number(inserted.meta.last_row_id));
  return c.json({ success: true, group, inviteLink: `${baseOf(c)}/groups.html?join=${code}` }, 201);
});

app.post('/groups/join', authenticate, async (c) => {
  const body = await c.req.json().catch(() => ({})) as { invite_code?: string; code?: string };
  const code = String(body.invite_code || body.code || '').trim();
  const group = await qOne<{ id: number; member_ids: string }>(c.env.LIVEVIEW_DB, 'SELECT * FROM lv_groups WHERE invite_code = ?', code);
  if (!group) return c.json({ success: false, message: 'Invalid invite code' }, 404);
  const ids = parseIdList(group.member_ids);
  if (!ids.includes(c.get('account').id)) ids.push(c.get('account').id);
  await qRun(c.env.LIVEVIEW_DB, 'UPDATE lv_groups SET member_ids = ?, updated_at = ? WHERE id = ?', JSON.stringify(ids), nowIso(), group.id);
  const fresh = await qOne(c.env.LIVEVIEW_DB, 'SELECT * FROM lv_groups WHERE id = ?', group.id);
  return c.json({ success: true, group: fresh });
});

app.post('/groups/:id/watch-party', authenticate, async (c) => {
  const group = await qOne<{ id: number; invite_code: string; member_ids: string }>(
    c.env.LIVEVIEW_DB,
    'SELECT * FROM lv_groups WHERE id = ?',
    Number(c.req.param('id'))
  );
  if (!group) return c.json({ success: false, message: 'Group not found' }, 404);
  const body = await c.req.json().catch(() => ({})) as { courseId?: number };
  const course = await findAccountById(c.env.LIVEVIEW_DB, Number(body.courseId));
  if (!course || course.role !== 'course_owner') return c.json({ success: false, message: 'Course not found' }, 404);
  const link = `${baseOf(c)}/course.html?id=${course.id}&party=${group.invite_code}`;
  for (const uid of parseIdList(group.member_ids)) {
    if (uid === c.get('account').id) continue;
    await createNotification(c.env.LIVEVIEW_DB, {
      user_id: uid,
      type: 'watch_party',
      title: `${c.get('account').name} started a watch party`,
      body: `Join to watch ${course.name}`,
      link
    });
  }
  return c.json({ success: true, link });
});

app.notFound(async (c) => {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    return c.json({ success: false, message: 'Not found' }, 404);
  }
  const response = await c.env.ASSETS.fetch(c.req.raw);
  const path = new URL(c.req.url).pathname;
  if (path.endsWith('.html') || path === '/liveview' || path === '/liveview/') {
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', 'no-cache');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
  return response;
});

export { app };
