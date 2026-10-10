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
      ['/liveview/', 'LiveView Golf'],
      ['/liveview/explore.html', 'explore'],
      ['/liveview/course.html', 'course'],
      ['/liveview/messages.html', 'message'],
      ['/liveview/groups.html', 'group'],
      ['/liveview/admin.html', 'admin@liveview.demo']
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
    const seeded = await json('/liveview/admin/seed-demo', { method: 'POST' });
    expect(seeded.response.status).toBe(200);
    expect(seeded.body.success).toBe(true);
    expect(seeded.body.courses.total).toBeGreaterThan(10);
    expect(seeded.body.exampleAdminLogin).toBe('admin@liveview.demo');
    expect(seeded.body.password).toBe('demo1234');

    const again = await json('/liveview/admin/seed-demo', { method: 'POST' });
    expect(again.response.status).toBe(403);

    const courses = await json('/liveview/courses?limit=48');
    expect(courses.response.status).toBe(200);
    expect(courses.body.total).toBeGreaterThan(10);

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

    const admin = await json('/liveview/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@liveview.demo', password: 'demo1234' })
    });
    expect(admin.body.user.role).toBe('admin');
    const queue = await json('/liveview/admin/stream-queue', {
      headers: { Authorization: `Bearer ${admin.body.token}` }
    });
    expect(queue.response.status).toBe(200);
    expect(queue.body.success).toBe(true);

    const tokenQueue = await json('/liveview/admin/stream-queue', {
      headers: { 'x-admin-token': 'demo-admin' }
    });
    expect(tokenQueue.response.status).toBe(200);

    const reseed = await json('/liveview/admin/seed-demo', {
      method: 'POST',
      headers: { 'x-admin-token': 'demo-admin' }
    });
    expect(reseed.response.status).toBe(200);
  });
});
