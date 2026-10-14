/** Tuya OpenAPI v2 client. Credentials and tokens stay on the server. */

export const TUYA_HOST = 'https://openapi.tuyaus.com';
const EMPTY_BODY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

export type TuyaCreds = { accessId: string; accessSecret: string };

export type LightDevice = {
  id: string;
  name: string;
  online: boolean;
  on: boolean | null;
  code: string | null;
};

type Token = { accessToken: string; uid: string; expireAt: number };

const memoryTokens = new Map<string, Token>();

export class TuyaError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

export function friendlyTuyaMessage(error: unknown): string {
  if (error instanceof TuyaError) {
    if (error.code === 1004) return 'Tuya rejected the cloud keys. Save them again in settings.';
    if (error.code === 1010 || error.code === 1106 || error.code === 28841002 || error.code === 28841105) {
      return 'Tuya declined this project. The cloud trial may have ended, or Smart Life is not linked yet.';
    }
    if (/permission|not subscribed|trial|expired/i.test(error.message)) {
      return 'Tuya declined this project. The cloud trial may have ended, or Smart Life is not linked yet.';
    }
  }
  return 'Lights are unavailable right now.';
}

export function canonicalPath(path: string): string {
  const queryAt = path.indexOf('?');
  if (queryAt < 0) return path;
  const base = path.slice(0, queryAt);
  const parts = path
    .slice(queryAt + 1)
    .split('&')
    .filter(Boolean)
    .sort((a, b) => a.split('=')[0].localeCompare(b.split('=')[0]));
  return `${base}?${parts.join('&')}`;
}

/** Sign string for OpenAPI v2. Nonce may be empty. Access token is omitted for the token call. */
export function signPayload(input: {
  accessId: string;
  accessToken?: string;
  timestamp: string;
  nonce?: string;
  method: string;
  path: string;
  body?: string;
  contentSha256: string;
}): string {
  const path = canonicalPath(input.path);
  const stringToSign = `${input.method.toUpperCase()}\n${input.contentSha256}\n\n${path}`;
  return `${input.accessId}${input.accessToken || ''}${input.timestamp}${input.nonce || ''}${stringToSign}`;
}

export async function sha256Hex(value: string): Promise<string> {
  const bits = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return hex(new Uint8Array(bits));
}

export async function tuyaSign(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return hex(new Uint8Array(sig)).toUpperCase();
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function clearTuyaToken(accessId: string) {
  memoryTokens.delete(tokenKey(accessId));
}

function tokenKey(accessId: string): string {
  return accessId;
}

export async function listLights(creds: TuyaCreds, kv: KVNamespace): Promise<LightDevice[]> {
  const token = await getToken(creds, kv);
  const devices = await discoverDevices(creds, token);
  const unique = new Map<string, RawDevice>();
  for (const device of devices) {
    if (device.id) unique.set(device.id, device);
  }
  const listed = [...unique.values()].slice(0, 40);
  const withStatus = await Promise.all(
    listed.map(async (device) => {
      try {
        const status = await readStatus(creds, token, device.id, kv);
        return { ...device, ...status };
      } catch {
        return device;
      }
    })
  );
  return withStatus.map((device) => ({
    id: device.id,
    name: device.name || 'Plug',
    online: device.online,
    on: device.on,
    code: device.code
  }));
}

export async function setLight(creds: TuyaCreds, kv: KVNamespace, deviceId: string, on: boolean): Promise<void> {
  if (!/^[A-Za-z0-9]{6,40}$/.test(deviceId)) throw new TuyaError(0, 'Unknown plug');
  const token = await getToken(creds, kv);
  const current = await readStatus(creds, token, deviceId, kv);
  const code = current.code || 'switch_1';
  const body = JSON.stringify({ commands: [{ code, value: on }] });
  await tuyaFetch(creds, token.accessToken, 'POST', `/v1.0/devices/${deviceId}/commands`, body);
}

async function getToken(creds: TuyaCreds, kv: KVNamespace): Promise<Token> {
  const cached = memoryTokens.get(tokenKey(creds.accessId));
  if (cached && cached.expireAt > Date.now() + 30_000) return cached;
  try {
    const stored = await kv.get(`glance:tuya:token:${await sha256Hex(creds.accessId)}`, 'json');
    const row = stored as Token | null;
    if (row?.accessToken && row.expireAt > Date.now() + 30_000) {
      memoryTokens.set(tokenKey(creds.accessId), row);
      return row;
    }
  } catch {
    /* KV is only a cache. */
  }
  const envelope = await tuyaFetch(creds, '', 'GET', '/v1.0/token?grant_type=1', '');
  const result = (envelope.result || {}) as Record<string, unknown>;
  const accessToken = String(result.access_token || '');
  if (!accessToken) throw new TuyaError(Number(envelope.code) || 0, 'token');
  const expireSec = Number(result.expire_time) || 7200;
  const token: Token = {
    accessToken,
    uid: String(result.uid || ''),
    expireAt: Date.now() + Math.max(60, expireSec - 120) * 1000
  };
  memoryTokens.set(tokenKey(creds.accessId), token);
  try {
    const ttl = Math.max(60, Math.floor((token.expireAt - Date.now()) / 1000));
    await kv.put(`glance:tuya:token:${await sha256Hex(creds.accessId)}`, JSON.stringify(token), { expirationTtl: ttl });
  } catch {
    /* Memory cache still covers this isolate. */
  }
  return token;
}

type RawDevice = { id: string; name: string; online: boolean; on: boolean | null; code: string | null };

async function discoverDevices(creds: TuyaCreds, token: Token): Promise<RawDevice[]> {
  const found: RawDevice[] = [];
  const errors: unknown[] = [];
  const pull = async (path: string) => {
    const envelope = await tuyaFetch(creds, token.accessToken, 'GET', path, '');
    found.push(...devicesFrom(envelope.result));
    return envelope;
  };
  try {
    let lastId = '';
    for (let page = 0; page < 5; page++) {
      const path = lastId
        ? `/v2.0/cloud/thing/device?page_size=20&last_id=${encodeURIComponent(lastId)}`
        : '/v2.0/cloud/thing/device?page_size=20';
      const envelope = await pull(path);
      const next = nextCursor(envelope.result);
      if (!next || next === lastId) break;
      lastId = next;
    }
  } catch (error) {
    errors.push(error);
  }
  if (token.uid && /^[A-Za-z0-9_-]{4,64}$/.test(token.uid)) {
    try {
      await pull(`/v1.0/users/${encodeURIComponent(token.uid)}/devices`);
    } catch (error) {
      errors.push(error);
    }
  }
  if (found.length === 0) {
    try {
      await pull('/v1.0/iot-03/devices?page_size=20');
    } catch (error) {
      errors.push(error);
    }
  }
  if (found.length === 0 && errors.length) throw errors[0];
  return found;
}

async function readStatus(
  creds: TuyaCreds,
  token: Token,
  deviceId: string,
  _kv: KVNamespace
): Promise<{ on: boolean | null; code: string | null }> {
  const envelope = await tuyaFetch(creds, token.accessToken, 'GET', `/v1.0/devices/${deviceId}/status`, '');
  const rows = Array.isArray(envelope.result) ? envelope.result : [];
  const codes = rows
    .map((row) => (row && typeof row === 'object' ? (row as Record<string, unknown>) : null))
    .filter((row): row is Record<string, unknown> => !!row && typeof row.code === 'string');
  const preferred = ['switch_1', 'switch', 'switch_led'];
  let chosen = codes.find((row) => preferred.includes(String(row.code)));
  if (!chosen) chosen = codes.find((row) => /^switch(_\d+)?$/.test(String(row.code)));
  if (!chosen) return { on: null, code: null };
  return { code: String(chosen.code), on: truthy(chosen.value) };
}

function devicesFrom(result: unknown): RawDevice[] {
  const list = Array.isArray(result)
    ? result
    : result && typeof result === 'object'
      ? ((result as Record<string, unknown>).devices ||
          (result as Record<string, unknown>).list ||
          (result as Record<string, unknown>).device_list ||
          [])
      : [];
  if (!Array.isArray(list)) return [];
  const out: RawDevice[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const id = String(row.id || row.device_id || '');
    if (!/^[A-Za-z0-9]{6,40}$/.test(id)) continue;
    const name = String(row.name || row.custom_name || row.customName || 'Plug').trim() || 'Plug';
    const online = truthy(row.online ?? row.is_online ?? row.online_status ?? true);
    out.push({ id, name: name.slice(0, 80), online, on: null, code: null });
  }
  return out;
}

function nextCursor(result: unknown): string {
  if (!result || typeof result !== 'object') return '';
  const row = result as Record<string, unknown>;
  return String(row.last_id || row.last_row_key || row.lastId || '');
}

function truthy(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true' || value === 'online';
}

type Envelope = { success?: boolean; code?: number; msg?: string; result?: unknown };

async function tuyaFetch(
  creds: TuyaCreds,
  accessToken: string,
  method: string,
  path: string,
  body: string
): Promise<Envelope> {
  const timestamp = String(Date.now());
  const nonce = crypto.randomUUID().replace(/-/g, '');
  const contentSha256 = body ? await sha256Hex(body) : EMPTY_BODY_SHA256;
  const signedPath = canonicalPath(path);
  const payload = signPayload({
    accessId: creds.accessId,
    accessToken,
    timestamp,
    nonce,
    method,
    path: signedPath,
    contentSha256
  });
  const sign = await tuyaSign(creds.accessSecret, payload);
  const headers: Record<string, string> = {
    client_id: creds.accessId,
    sign,
    sign_method: 'HMAC-SHA256',
    t: timestamp,
    nonce,
    Accept: 'application/json'
  };
  if (accessToken) headers.access_token = accessToken;
  if (body) headers['Content-Type'] = 'application/json';
  let response: Response;
  try {
    response = await fetch(`${TUYA_HOST}${signedPath}`, {
      method,
      headers,
      body: body ? body : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(12000)
    });
  } catch {
    throw new TuyaError(0, 'fetch');
  }
  if (response.status >= 300 && response.status < 400) throw new TuyaError(0, 'redirect');
  const text = await response.text();
  let envelope: Envelope = {};
  try {
    envelope = JSON.parse(text) as Envelope;
  } catch {
    throw new TuyaError(response.status, 'bad response');
  }
  if (!response.ok || envelope.success === false) {
    throw new TuyaError(Number(envelope.code) || response.status, String(envelope.msg || 'declined'));
  }
  return envelope;
}
