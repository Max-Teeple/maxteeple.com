export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function normalizeEmail(email = ''): string {
  return String(email).trim().toLowerCase();
}

export function normalizePhone(phone = ''): string {
  const digits = String(phone).replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (String(phone).trim().startsWith('+')) return String(phone).trim();
  return `+${digits}`;
}

export function parseIdList(value: unknown): number[] {
  if (Array.isArray(value)) return value.map(Number).filter(Boolean);
  try {
    return JSON.parse(String(value || '[]')).map(Number).filter(Boolean);
  } catch {
    return [];
  }
}

export function stringifyIdList(ids: number[]): string {
  return JSON.stringify(Array.from(new Set(ids.map(Number).filter(Boolean))));
}

export function slugify(name = ''): string {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'course';
}

export function parseNameParts(firstName?: unknown, lastName?: unknown, fallbackName?: unknown) {
  const first = String(firstName ?? '').trim();
  const last = String(lastName ?? '').trim();
  if (first || last) {
    return {
      first_name: first || null,
      last_name: last || null,
      name: [first, last].filter(Boolean).join(' ')
    };
  }
  const name = String(fallbackName ?? '').trim();
  const parts = name.split(/\s+/).filter(Boolean);
  return {
    first_name: parts[0] || null,
    last_name: parts.length > 1 ? parts.slice(1).join(' ') : null,
    name
  };
}

const US_STATE_ABBREV: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS',
  missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI',
  wyoming: 'WY'
};

export function stateSearchValues(state = ''): string[] {
  const trimmed = String(state).trim();
  if (!trimmed) return [];
  const values = new Set<string>([trimmed]);
  const lower = trimmed.toLowerCase();
  if (US_STATE_ABBREV[lower]) values.add(US_STATE_ABBREV[lower]);
  if (trimmed.length === 2) values.add(trimmed.toUpperCase());
  return Array.from(values);
}

export function abbreviateState(state = ''): string {
  const raw = String(state).trim();
  const abbrev = stateSearchValues(raw).find((value) => value.length === 2);
  return abbrev || raw;
}

export function randomHex(bytes = 16): string {
  const arr = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function sqlValue(value: unknown): string | number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  return String(value);
}

export function boolish(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

export function numOrNull(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function withTimestamps<T extends { created_at?: string | null; updated_at?: string | null }>(row: T) {
  return { ...row, createdAt: row.created_at, updatedAt: row.updated_at };
}
