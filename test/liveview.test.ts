import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

const origin = 'https://maxteeple.test';

async function api(path: string, init?: RequestInit) {
  return SELF.fetch(new Request(`${origin}${path}`, init));
}

async function json(path: string, init?: RequestInit) {
  const response = await api(path, init);
  const body = await response.json();
  return { response, body: body as Record<string, any> };
}

describe('LiveView on maxteeple.com', () => {
  it('serves the existing site and the LiveView shell', async () => {
    const pages = [
      ['/', 'Max Teeple'],
      ['/projects/', 'Projects'],
      ['/projects/clubsense/', 'ClubSense'],
      ['/projects/clubsense/demo/', 'root'],
      ['/projects/liveview/', 'Open LiveView'],
      ['/projects/liveview/demo/', 'Invented courses'],
      ['/resume/', 'Résumé'],
      ['/liveview/', 'Stream your course in 15 minutes'],
      ['/liveview/setup-guide.html', 'We install it for you'],
      ['/liveview/golive.html', 'Request an install'],
      ['/liveview/explore.html', 'explore'],
      ['/liveview/course.html', 'course'],
      ['/liveview/messages.html', 'message'],
      ['/liveview/groups.html', 'group'],
      ['/liveview/admin.html', 'wrangler secret put ADMIN_APPROVAL_TOKEN']
    ] as const;

    for (const [path, needle] of pages) {
      const response = await api(path);
      expect(response.status, path).toBe(200);
      const text = await response.text();
      expect(text.toLowerCase(), path).toContain(needle.toLowerCase());
    }

    const groupsApi = await api('/liveview/groups');
    expect(groupsApi.status).toBe(401);
    expect(groupsApi.headers.get('content-type') || '').toContain('application/json');
  });

  it('keeps a D1 signing secret private and accepts signup plus login', async () => {
    const health = await json('/liveview/health');
    expect(health.response.status).toBe(200);
    expect(health.body.jwtSecretSource).toBe('d1');
    expect(health.body.jwtSecretConfigured).toBe(true);
    expect(JSON.stringify(health.body)).not.toMatch(/jwt_secret/i);

    const row = await env.LIVEVIEW_DB.prepare(
      `SELECT id, value FROM app_secrets WHERE id = 'jwt_secret'`
    ).first<{ id: string; value: string }>();
    expect(row?.id).toBe('jwt_secret');
    expect(row?.value.length).toBeGreaterThan(20);
    expect(JSON.stringify(health.body)).not.toContain(row!.value);

    const email = `fan-${crypto.randomUUID()}@example.com`;
    const password = 'correct-horse';
    const signup = await json('/liveview/register-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Casey Quinn',
        city: 'Phoenix',
        state: 'AZ',
        email,
        password
      })
    });
    expect(signup.response.status).toBe(201);
    expect(signup.body.token).toBeTruthy();
    expect(signup.body.token).not.toContain(row!.value);

    const login = await json('/liveview/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    expect(login.response.status).toBe(200);
    const me = await json('/liveview/me', {
      headers: { Authorization: `Bearer ${login.body.token}` }
    });
    expect(me.response.status).toBe(200);
    expect(me.body.user.email).toBe(email);
  });

  it('seeds demo data, then directory, messages, watch party, and the admin queue work', async () => {
    const openSeed = await json('/liveview/admin/seed-demo', { method: 'POST' });
    expect(openSeed.response.status).toBe(403);

    const seeded = await json('/liveview/admin/seed-demo', {
      method: 'POST',
      headers: { 'x-admin-token': 'demo-admin' }
    });
    expect(seeded.response.status).toBe(200);
    expect(seeded.body.success).toBe(true);
    expect(seeded.body.courses.total).toBe(50);
    expect(seeded.body.exampleAdminLogin).toBeUndefined();
    expect(seeded.body.password).toBe('demo1234');
    expect(JSON.stringify(seeded.body)).not.toContain('admin_approval_token');

    const courses = await json('/liveview/courses');
    expect(courses.response.status).toBe(200);
    expect(courses.body.total).toBe(50);
    expect(courses.body.courses.length).toBe(50);
    const catalog = JSON.stringify(courses.body).toLowerCase();
    for (const banned of ['bunny', 'mux.dev', 'liveview.demo', 'augusta', 'cypress point', 'east lake', 'baltusrol', 'pebble beach']) {
      expect(catalog, banned).not.toContain(banned);
    }
    expect(courses.body.courses.some((course: { playback_url?: string }) => String(course.playback_url || '').endsWith('.mp4'))).toBe(true);

    const overlay = await json(`/liveview/courses/${courses.body.courses[0].id}/overlay`);
    expect(overlay.response.status).toBe(200);
    expect(overlay.body.overlay.holes.length).toBe(18);
    expect(['lower-third', 'corner-bug']).toContain(overlay.body.overlay.template);
    expect(JSON.stringify(overlay.body)).not.toContain('scoreboard');

    const owner = await json('/liveview/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: seeded.body.exampleCourseLogin, password: 'demo1234' })
    });
    expect(owner.response.status).toBe(200);
    const ownOverlay = await json(`/liveview/courses/${owner.body.user.id}/overlay`);
    const switched = await json(`/liveview/profile/${owner.body.user.id}/overlay`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${owner.body.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ...ownOverlay.body.overlay,
        template: 'corner-bug',
        current_hole: 4
      })
    });
    expect(switched.response.status).toBe(200);
    expect(switched.body.overlay.template).toBe('corner-bug');
    expect(switched.body.overlay.current_hole).toBe(4);
    expect(switched.body.overlay.holes.every((hole: { template: string }) => hole.template === 'lower-third' || hole.template === 'corner-bug')).toBe(true);

    const map = await json('/liveview/courses/map');
    expect(map.body.courses.length).toBeGreaterThan(10);
    expect(map.body.courses.some((course: { latitude: number }) => Number.isFinite(course.latitude))).toBe(true);

    const live = (courses.body.courses as Array<{ id: number; is_live: boolean; slug: string; hls_url?: string; stream_url?: string }>)
      .find((course) => course.is_live && (course.hls_url || course.stream_url));
    expect(live).toBeTruthy();
    const coursePage = await api(`/liveview/course.html?slug=${live!.slug}`);
    expect(coursePage.status).toBe(200);
    const courseHtml = await coursePage.text();
    expect(courseHtml.toLowerCase()).toContain('stream');
    expect(courseHtml).toContain('overlay.js');
    expect(courseHtml).toContain('Hide overlay');

    const user = await json('/liveview/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: seeded.body.exampleUserLogin, password: 'demo1234' })
    });
    expect(user.response.status).toBe(200);
    const other = await json('/liveview/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'demo-user-002@liveview.demo', password: 'demo1234' })
    });
    expect(other.response.status).toBe(200);

    const sent = await json(`/liveview/messages/${other.body.user.id}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${user.body.token}`
      },
      body: JSON.stringify({ body: 'See you on the tee' })
    });
    expect(sent.response.status).toBe(201);

    const thread = await json(`/liveview/messages/${user.body.user.id}`, {
      headers: { Authorization: `Bearer ${other.body.token}` }
    });
    expect(thread.body.messages.some((message: { body: string }) => message.body === 'See you on the tee')).toBe(true);

    const group = await json('/liveview/groups', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${user.body.token}`
      },
      body: JSON.stringify({ name: 'Tuesday skins' })
    });
    expect(group.response.status).toBe(201);
    const party = await json(`/liveview/groups/${group.body.group.id}/watch-party`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${user.body.token}`
      },
      body: JSON.stringify({ courseId: live!.id })
    });
    expect(party.response.status).toBe(200);
    expect(String(party.body.link)).toContain('party=');

    const partyRoom = await json(`/liveview/courses/${live!.id}/watch-party`);
    expect(partyRoom.response.status).toBe(200);
    expect(String(partyRoom.body.shareLink)).toContain('party=');
    const chat = await json(`/liveview/courses/${live!.id}/watch-party/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${user.body.token}`
      },
      body: JSON.stringify({ body: 'Fore from the party' })
    });
    expect(chat.response.status).toBe(201);
    const partyAgain = await json(`/liveview/courses/${live!.id}/watch-party?after=0`);
    expect(partyAgain.body.messages.some((message: { body: string }) => message.body === 'Fore from the party')).toBe(true);

    const fanQueue = await json('/liveview/admin/stream-queue', {
      headers: { Authorization: `Bearer ${user.body.token}` }
    });
    expect(fanQueue.response.status).toBe(403);

    const tokenQueue = await json('/liveview/admin/stream-queue', {
      headers: { 'x-admin-token': 'demo-admin' }
    });
    expect(tokenQueue.response.status).toBe(200);
    expect(tokenQueue.body.success).toBe(true);

    await env.LIVEVIEW_DB.prepare(
      `INSERT INTO courses (name, city, state, email, role, password, is_demo)
       VALUES ('Real Fan', 'Phoenix', 'AZ', 'real.fan@example.com', 'consumer', 'x', 0)`
    ).run();
    const reseed = await json('/liveview/admin/seed-demo', {
      method: 'POST',
      headers: { 'x-admin-token': 'demo-admin' }
    });
    expect(reseed.response.status).toBe(200);
    expect(reseed.body.courses.total).toBe(50);
    const preserved = await env.LIVEVIEW_DB.prepare(
      `SELECT id, role FROM courses WHERE email = 'real.fan@example.com'`
    ).first<{ id: number; role: string }>();
    expect(preserved?.role).toBe('consumer');

    const demoLogin = await json('/liveview/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ demo: true })
    });
    expect(demoLogin.response.status).toBe(200);
    expect(demoLogin.body.user.role).toBe('consumer');

    const clip = await api('/liveview/demo-streams/tee-shot.mp4');
    expect(clip.status).toBe(200);
    expect(clip.headers.get('content-type') || '').toContain('video/mp4');

    const missing = await api('/liveview/this-page-is-missing.html');
    expect(missing.status).toBe(404);
    const missingHtml = (await missing.text()).toLowerCase();
    expect(missingHtml).toContain('maxteeple.com');
    expect(missingHtml).toContain('liveview');

    const badEmail = `locked-${crypto.randomUUID()}@example.com`;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const denied = await json('/liveview/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: badEmail, password: 'not-the-password' })
      });
      expect(denied.response.status).toBe(401);
    }
    const limited = await json('/liveview/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: badEmail, password: 'not-the-password' })
    });
    expect(limited.response.status).toBe(429);

    const reset = await json('/liveview/admin/reset-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${user.body.token}`
      },
      body: JSON.stringify({ email: user.body.user.email, password: 'demo1234' })
    });
    expect(reset.response.status).toBe(403);
  });

  it('strips demo admin rights and deletes the retired test account', async () => {
    expect((await api('/liveview/health')).status).toBe(200);
    await env.LIVEVIEW_DB.prepare(
      `INSERT INTO courses (name, city, state, email, role, password, is_demo)
       VALUES ('Demo Admin', 'Phoenix', 'AZ', 'admin@liveview.demo', 'admin', 'x', 1)`
    ).run();
    const created = await json('/liveview/register-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Casey Check',
        city: 'Phoenix',
        state: 'AZ',
        email: 'casey.prod.check@example.com',
        password: 'prod-check-1'
      })
    });
    expect(created.response.status).toBe(201);
    const createdId = created.body.user.id as number;
    await env.LIVEVIEW_DB.prepare(
      `INSERT INTO messages (from_user_id, to_user_id, body) VALUES (?, ?, 'hello')`
    ).bind(createdId, createdId).run();
    await env.LIVEVIEW_DB.prepare(
      `INSERT INTO friend_requests (from_user_id, invite_email, status) VALUES (?, ?, 'pending')`
    ).bind(createdId, 'casey.prod.check@example.com').run();

    const health = await api('/liveview/health');
    expect(health.status).toBe(200);

    const admin = await env.LIVEVIEW_DB.prepare(
      `SELECT role FROM courses WHERE email = 'admin@liveview.demo'`
    ).first<{ role: string }>();
    expect(admin?.role).toBe('consumer');

    const retired = await env.LIVEVIEW_DB.prepare(
      `SELECT id FROM courses WHERE email = 'casey.prod.check@example.com'`
    ).first();
    expect(retired).toBeNull();
    const messages = await env.LIVEVIEW_DB.prepare(
      `SELECT id FROM messages WHERE from_user_id = ? OR to_user_id = ?`
    ).bind(createdId, createdId).all();
    expect(messages.results?.length ?? 0).toBe(0);
    const invites = await env.LIVEVIEW_DB.prepare(
      `SELECT id FROM friend_requests WHERE from_user_id = ? OR invite_email = ?`
    ).bind(createdId, 'casey.prod.check@example.com').all();
    expect(invites.results?.length ?? 0).toBe(0);

    const login = await json('/liveview/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'casey.prod.check@example.com', password: 'prod-check-1' })
    });
    expect(login.response.status).toBe(401);

    const promoted = await json('/liveview/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@liveview.demo', password: 'demo1234' })
    });
    expect(promoted.response.status).not.toBe(200);
    const queue = await json('/liveview/admin/stream-queue', {
      headers: { 'x-admin-token': 'demo1234' }
    });
    expect(queue.response.status).toBe(403);
  });

  it('stores a managed install request and lets the new course delete itself', async () => {
    const guide = await api('/liveview/setup-guide.html');
    expect(guide.status).toBe(200);
    const guideHtml = await guide.text();
    expect(guideHtml).toContain('Contact for pricing');
    expect(guideHtml).toContain('Prefer to do it yourself');
    expect(guideHtml).not.toMatch(/\$\s?\d/);
    expect(guideHtml.toLowerCase()).not.toContain('scoreboard');

    const email = `install-${crypto.randomUUID()}@example.com`;
    const signup = await json('/liveview/register-golf-course', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Verification Hills',
        city: 'Phoenix',
        email,
        password: 'correct-horse'
      })
    });
    expect(signup.response.status).toBe(201);
    const token = signup.body.token as string;
    const id = signup.body.user.id as number;

    const saved = await json(`/liveview/profile/${id}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        state: 'AZ',
        setup_tier: 'managed',
        golive_step: 'youtube',
        stream_url: 'https://www.youtube.com/@verificationhills/live',
        next_stream_at: '2026-11-01T15:00:00.000Z'
      })
    });
    expect(saved.response.status).toBe(200);
    expect(saved.body.user.setup_tier).toBe('managed');
    expect(saved.body.user.golive_step).toBe('youtube');
    expect(saved.body.user.next_stream_at).toContain('2026-11-01');

    const request = await json('/liveview/install-requests', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        course_name: 'Verification Hills',
        contact_name: 'Case Tester',
        email,
        phone: '555-0100',
        camera_spots: '1st tee',
        power_availability: 'Outlet near the camera spot',
        internet_available: 'Cellular only',
        notes: 'verification only'
      })
    });
    expect(request.response.status).toBe(201);

    const admin = await json('/liveview/admin/install-requests', {
      headers: { 'x-admin-token': 'demo-admin' }
    });
    expect(admin.response.status).toBe(200);
    expect(admin.body.requests.some((row: { email: string }) => row.email === email)).toBe(true);

    const removed = await json(`/liveview/profile/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(removed.response.status).toBe(200);

    const again = await json('/liveview/admin/install-requests', {
      headers: { 'x-admin-token': 'demo-admin' }
    });
    expect(again.body.requests.some((row: { email: string }) => row.email === email)).toBe(false);

    const login = await json('/liveview/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'correct-horse' })
    });
    expect(login.response.status).toBe(401);
  });
});
