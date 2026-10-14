export const PHOENIX = 'America/Phoenix';

export type Parts = { y: number; m: number; d: number; h: number; mi: number; s: number };
export type LocalDate = { y: number; m: number; d: number };

const WINDOWS_ZONES: Record<string, string> = {
  'us mountain standard time': 'America/Phoenix',
  'mountain standard time': 'America/Denver',
  'us mountain daylight time': 'America/Denver',
  'pacific standard time': 'America/Los_Angeles',
  'pacific daylight time': 'America/Los_Angeles',
  'central standard time': 'America/Chicago',
  'central daylight time': 'America/Chicago',
  'eastern standard time': 'America/New_York',
  'eastern daylight time': 'America/New_York',
  'alaskan standard time': 'America/Anchorage',
  'hawaiian standard time': 'Pacific/Honolulu',
  'w. europe standard time': 'Europe/Berlin',
  'central european standard time': 'Europe/Warsaw',
  'romance standard time': 'Europe/Paris',
  'e. europe standard time': 'Europe/Bucharest',
  'gtb standard time': 'Europe/Bucharest',
  'gmt standard time': 'Europe/London',
  'greenwich standard time': 'Atlantic/Reykjavik',
  'india standard time': 'Asia/Kolkata',
  'china standard time': 'Asia/Shanghai',
  'tokyo standard time': 'Asia/Tokyo',
  'singapore standard time': 'Asia/Singapore',
  'aus eastern standard time': 'Australia/Sydney',
  'arabian standard time': 'Asia/Dubai',
  utc: 'UTC',
  'coordinated universal time': 'UTC'
};

export function resolveZone(tzid: string | null | undefined, fallback = PHOENIX): string {
  if (!tzid) return fallback;
  const cleaned = tzid.trim().replace(/^"|"$/g, '');
  if (!cleaned) return fallback;
  const mapped = WINDOWS_ZONES[cleaned.toLowerCase()];
  if (mapped) return mapped;
  if (cleaned.toLowerCase() === 'us/arizona' || cleaned.toLowerCase() === 'america/phoenix') return PHOENIX;
  if (cleaned.toUpperCase() === 'UTC' || cleaned.toUpperCase() === 'GMT' || cleaned.toUpperCase() === 'Z') return 'UTC';
  return cleaned;
}

export function partsInZone(ms: number, timeZone: string): Parts {
  let zone = timeZone;
  try {
    return readParts(ms, zone);
  } catch {
    zone = PHOENIX;
    return readParts(ms, zone);
  }
}

function readParts(ms: number, timeZone: string): Parts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  const bag: Record<string, string> = {};
  for (const part of fmt.formatToParts(new Date(ms))) bag[part.type] = part.value;
  let h = Number(bag.hour);
  if (h === 24) h = 0;
  return {
    y: Number(bag.year),
    m: Number(bag.month),
    d: Number(bag.day),
    h,
    mi: Number(bag.minute),
    s: Number(bag.second)
  };
}

export function zonedToUtc(y: number, m: number, d: number, h: number, mi: number, s: number, timeZone: string): number {
  const norm = new Date(Date.UTC(y, m - 1, d, h, mi, s));
  y = norm.getUTCFullYear();
  m = norm.getUTCMonth() + 1;
  d = norm.getUTCDate();
  h = norm.getUTCHours();
  mi = norm.getUTCMinutes();
  s = norm.getUTCSeconds();
  const zone = resolveZone(timeZone);
  if (zone === 'UTC') return Date.UTC(y, m - 1, d, h, mi, s);
  if (zone === PHOENIX) return Date.UTC(y, m - 1, d, h + 7, mi, s);
  try {
    const guess = Date.UTC(y, m - 1, d, h, mi, s);
    const offset = zoneOffset(guess, zone);
    let utc = guess - offset;
    const offset2 = zoneOffset(utc, zone);
    if (offset2 !== offset) utc = guess - offset2;
    return utc;
  } catch {
    return Date.UTC(y, m - 1, d, h + 7, mi, s);
  }
}

function zoneOffset(utcMs: number, timeZone: string): number {
  const p = readParts(utcMs, timeZone);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - utcMs;
}

export function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function dateKey(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function phoenixDate(ms: number): string {
  const p = partsInZone(ms, PHOENIX);
  return dateKey(p.y, p.m, p.d);
}

export function formatPhoenix(ms: number): string {
  const p = partsInZone(ms, PHOENIX);
  return `${dateKey(p.y, p.m, p.d)}T${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}-07:00`;
}

export function addDays(y: number, m: number, d: number, n: number): LocalDate {
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

export function cmpDate(a: LocalDate, b: LocalDate): number {
  return a.y - b.y || a.m - b.m || a.d - b.d;
}

export function weekday(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function daysBetween(a: LocalDate, b: LocalDate): number {
  const am = Date.UTC(a.y, a.m - 1, a.d);
  const bm = Date.UTC(b.y, b.m - 1, b.d);
  return Math.round((bm - am) / 86400000);
}

export function weekStartDayNum(y: number, m: number, d: number, wkst: number): number {
  const dayNum = Math.floor(Date.UTC(y, m - 1, d) / 86400000);
  const wd = weekday(y, m, d);
  const delta = (wd - wkst + 7) % 7;
  return dayNum - delta;
}

export function dateFromWeekStart(weekStartDay: number, day: number, wkst: number): LocalDate {
  const delta = (day - wkst + 7) % 7;
  const dt = new Date((weekStartDay + delta) * 86400000);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

export function phoenixWindow(now: number, days: number): { start: number; end: number; dates: string[] } {
  const p = partsInZone(now, PHOENIX);
  const dates: string[] = [];
  for (let i = 0; i < days; i++) {
    const local = addDays(p.y, p.m, p.d, i);
    dates.push(dateKey(local.y, local.m, local.d));
  }
  const start = zonedToUtc(p.y, p.m, p.d, 0, 0, 0, PHOENIX);
  const endLocal = addDays(p.y, p.m, p.d, days);
  const end = zonedToUtc(endLocal.y, endLocal.m, endLocal.d, 0, 0, 0, PHOENIX);
  return { start, end, dates };
}

export function nthWeekday(y: number, m: number, day: number, n: number): LocalDate | null {
  const dim = daysInMonth(y, m);
  if (n > 0) {
    const first = weekday(y, m, 1);
    const delta = (day - first + 7) % 7;
    const date = 1 + delta + (n - 1) * 7;
    if (date > dim) return null;
    return { y, m, d: date };
  }
  if (n < 0) {
    const last = weekday(y, m, dim);
    const delta = (last - day + 7) % 7;
    const date = dim - delta + (n + 1) * 7;
    if (date < 1) return null;
    return { y, m, d: date };
  }
  return null;
}
