import type { Bindings } from './types';

/** Tuned so a login fits the Workers free-plan CPU budget (10ms). */
export const PBKDF2_ITERATIONS = 8000;

const enc = new TextEncoder();

let storedSecret: string | null = null;
let announcedStoredSecret = false;

/**
 * Signing key for session tokens.
 * `JWT_SECRET` wins when it is set. Otherwise the first request stores one
 * random value in D1 (`app_secrets`, id `jwt_secret`) and every isolate
 * reuses that row, so logins survive restarts and deploys. The value is
 * never returned by the API.
 */
export async function jwtSecret(env: Bindings): Promise<string> {
  const configured = env.JWT_SECRET?.trim();
  if (configured) return configured;
  if (storedSecret) return storedSecret;

  if (!announcedStoredSecret) {
    announcedStoredSecret = true;
    console.info(
      '[LiveView] JWT_SECRET is not set. Sessions use a secret stored in D1. Set JWT_SECRET to override it (free: wrangler secret put JWT_SECRET).'
    );
  }

  const db = env.LIVEVIEW_DB;
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS app_secrets (
        id TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )`
    )
    .run();

  const existing = await db
    .prepare(`SELECT value FROM app_secrets WHERE id = 'jwt_secret'`)
    .first<{ value: string }>();
  if (existing?.value) {
    storedSecret = existing.value;
    return storedSecret;
  }

  const generated = bytesToB64url(crypto.getRandomValues(new Uint8Array(32)));
  await db
    .prepare(`INSERT INTO app_secrets (id, value) VALUES ('jwt_secret', ?) ON CONFLICT(id) DO NOTHING`)
    .bind(generated)
    .run();
  const row = await db
    .prepare(`SELECT value FROM app_secrets WHERE id = 'jwt_secret'`)
    .first<{ value: string }>();
  storedSecret = row?.value || generated;
  return storedSecret;
}

let storedAdminToken: string | null = null;

/**
 * Token for the stream queue, demo seed, and password reset.
 * `ADMIN_APPROVAL_TOKEN` wins when it is set. Otherwise the first check
 * stores one random value in D1 (`app_secrets`, id `admin_approval_token`).
 * The value is never returned by the API. Demo account passwords are not
 * admin credentials.
 */
export async function adminApprovalToken(env: Bindings): Promise<string> {
  const configured = env.ADMIN_APPROVAL_TOKEN?.trim();
  if (configured) return configured;
  if (storedAdminToken) return storedAdminToken;

  const db = env.LIVEVIEW_DB;
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS app_secrets (
        id TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )`
    )
    .run();

  const existing = await db
    .prepare(`SELECT value FROM app_secrets WHERE id = 'admin_approval_token'`)
    .first<{ value: string }>();
  if (existing?.value) {
    storedAdminToken = existing.value;
    return storedAdminToken;
  }

  const generated = bytesToB64url(crypto.getRandomValues(new Uint8Array(32)));
  await db
    .prepare(`INSERT INTO app_secrets (id, value) VALUES ('admin_approval_token', ?) ON CONFLICT(id) DO NOTHING`)
    .bind(generated)
    .run();
  const row = await db
    .prepare(`SELECT value FROM app_secrets WHERE id = 'admin_approval_token'`)
    .first<{ value: string }>();
  storedAdminToken = row?.value || generated;
  return storedAdminToken;
}

export async function adminTokenMatches(env: Bindings, provided: string | undefined): Promise<boolean> {
  const expected = await adminApprovalToken(env);
  const got = provided?.trim() || '';
  if (!got) return false;
  return safeEqual(got, expected);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${bytesToB64url(salt)}$${bytesToB64url(bits)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<{ ok: boolean; legacyBcrypt: boolean }> {
  if (!password || !stored) return { ok: false, legacyBcrypt: false };
  if (stored.startsWith('pbkdf2$')) {
    return { ok: await verifyPbkdf2(password, stored), legacyBcrypt: false };
  }
  if (/^\$2[aby]\$/.test(stored)) {
    const bcrypt = await import('bcryptjs');
    return { ok: bcrypt.compareSync(password, stored), legacyBcrypt: true };
  }
  return { ok: false, legacyBcrypt: false };
}

async function verifyPbkdf2(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number(parts[1]);
  if (!Number.isFinite(iterations) || iterations < 1 || iterations > 200_000) return false;
  const salt = b64urlToBytes(parts[2]);
  const expected = parts[3];
  const actual = bytesToB64url(await pbkdf2(password, salt, iterations));
  return safeEqual(actual, expected);
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    256
  );
  return new Uint8Array(bits);
}

export type JwtPayload = { id: number; role: string; email: string; exp: number };

export async function signJwt(payload: { id: number; role: string; email: string }, secret: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = bytesToB64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = bytesToB64url(enc.encode(JSON.stringify({ ...payload, iat: now, exp: now + 60 * 60 * 24 * 7 })));
  const data = `${header}.${body}`;
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return `${data}.${bytesToB64url(new Uint8Array(sig))}`;
}

export async function verifyJwt(token: string, secret: string): Promise<JwtPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('HMAC', key, b64urlToBytes(parts[2]), enc.encode(`${parts[0]}.${parts[1]}`));
  if (!ok) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1]))) as JwtPayload;
    if (!payload?.id || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function bytesToB64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function b64urlToBytes(value: string): Uint8Array {
  const pad = value.length % 4 === 0 ? '' : '='.repeat(4 - (value.length % 4));
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
