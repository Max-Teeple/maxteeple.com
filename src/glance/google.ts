import { PHOENIX, addDays, formatPhoenix, phoenixDate, zonedToUtc } from './time';

export const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
export const GOOGLE_ACCOUNT = 'max.teeple@gmail.com';
export const GOOGLE_COLOR_BASIL = '10';
export const GOOGLE_REDIRECT_PATH = '/glance/api/google/callback';

export type EventDraft = {
  title: string;
  date: string;
  allDay: boolean;
  start?: string;
  end?: string;
  durationMinutes?: number;
};

export type EventRange = { startMs: number; endMs: number };

const enc = new TextEncoder();
const dec = new TextDecoder();

export function redirectUri(originOrHost: string): string {
  let host = originOrHost;
  try {
    host = new URL(originOrHost).host;
  } catch {
    host = originOrHost;
  }
  const name = host.split(':')[0].toLowerCase();
  if (name === 'maxteeple.com' || name === 'www.maxteeple.com') {
    return `https://maxteeple.com${GOOGLE_REDIRECT_PATH}`;
  }
  const origin = originOrHost.includes('://') ? new URL(originOrHost).origin : `https://${host}`;
  return `${origin}${GOOGLE_REDIRECT_PATH}`;
}

export function googleAuthUrl(input: { clientId: string; redirectUri: string; state: string }): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'false',
    state: input.state
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export function eventRange(input: EventDraft, now = Date.now()): EventRange {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new RangeError('Pick a day');
  const [y, m, d] = input.date.split('-').map(Number);
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) throw new RangeError('Pick a day');
  const probe = zonedToUtc(y, m, d, 12, 0, 0, PHOENIX);
  if (phoenixDate(probe) !== input.date) throw new RangeError('Pick a day');
  const today = phoenixDate(now);
  const [ty, tm, td] = today.split('-').map(Number);
  const min = dateKey(addDays(ty, tm, td, -1));
  const max = dateKey(addDays(ty, tm, td, 400));
  if (input.date < min || input.date > max) throw new RangeError('Pick a day within the next year');
  if (input.allDay) {
    const next = addDays(y, m, d, 1);
    return {
      startMs: zonedToUtc(y, m, d, 0, 0, 0, PHOENIX),
      endMs: zonedToUtc(next.y, next.m, next.d, 0, 0, 0, PHOENIX)
    };
  }
  const start = clock(input.start);
  if (!start) throw new RangeError('Pick a start time');
  const startMs = zonedToUtc(y, m, d, start.h, start.mi, 0, PHOENIX);
  if (input.end) {
    const end = clock(input.end);
    if (!end) throw new RangeError('Pick an end time');
    const endMs = zonedToUtc(y, m, d, end.h, end.mi, 0, PHOENIX);
    if (endMs <= startMs) throw new RangeError('The end time is before the start');
    return { startMs, endMs };
  }
  const minutes = input.durationMinutes == null ? 60 : Number(input.durationMinutes);
  if (!Number.isFinite(minutes) || minutes < 5 || minutes > 720) throw new RangeError('Pick a duration');
  return { startMs, endMs: startMs + minutes * 60_000 };
}

export function googleEventBody(input: { title: string; allDay: boolean; startMs: number; endMs: number }) {
  if (input.allDay) {
    return {
      summary: input.title,
      colorId: GOOGLE_COLOR_BASIL,
      start: { date: phoenixDate(input.startMs) },
      end: { date: phoenixDate(input.endMs) }
    };
  }
  return {
    summary: input.title,
    colorId: GOOGLE_COLOR_BASIL,
    start: { dateTime: formatPhoenix(input.startMs).slice(0, 19), timeZone: PHOENIX },
    end: { dateTime: formatPhoenix(input.endMs).slice(0, 19), timeZone: PHOENIX }
  };
}

export function cleanEventTitle(value: unknown): string {
  const title = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!title) throw new RangeError('Add a title');
  if (title.length > 200) throw new RangeError('That title is too long');
  return title;
}

export async function sealSecret(plain: string, material: string): Promise<string> {
  if (!plain) return '';
  const key = await aesKey(material);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plain));
  return `v1.${b64(iv)}.${b64(new Uint8Array(cipher))}`;
}

export async function openSecret(stored: string, material: string): Promise<string> {
  if (!stored || !stored.startsWith('v1.')) return '';
  const [, ivPart, dataPart] = stored.split('.');
  if (!ivPart || !dataPart) return '';
  try {
    const key = await aesKey(material);
    const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(ivPart) }, key, b64d(dataPart));
    return dec.decode(clear);
  } catch {
    return '';
  }
}

export function safeEqual(a: string, b: string): boolean {
  const left = enc.encode(a);
  const right = enc.encode(b);
  const length = Math.max(left.length, right.length);
  let diff = left.length === right.length ? 0 : 1;
  for (let i = 0; i < length; i++) diff |= (left[i] || 0) ^ (right[i] || 0);
  return diff === 0;
}

function dateKey(value: { y: number; m: number; d: number }): string {
  return `${value.y}-${String(value.m).padStart(2, '0')}-${String(value.d).padStart(2, '0')}`;
}

function clock(value: string | undefined): { h: number; mi: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;
  const h = Number(match[1]);
  const mi = Number(match[2]);
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return { h, mi };
}

async function aesKey(material: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(material));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function b64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function b64d(value: string): Uint8Array {
  const pad = value.length % 4 === 0 ? '' : '='.repeat(4 - (value.length % 4));
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
