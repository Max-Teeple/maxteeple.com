import {
  PHOENIX,
  addDays,
  cmpDate,
  dateFromWeekStart,
  daysBetween,
  daysInMonth,
  nthWeekday,
  partsInZone,
  phoenixDate,
  resolveZone,
  weekStartDayNum,
  weekday,
  zonedToUtc,
  type LocalDate
} from './time';

export type FeedMeta = { id: string; label: string; color: string };

export type AgendaEvent = {
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  birthday?: boolean;
  feedId: string;
  feedLabel: string;
  color: string;
  location?: string;
  description?: string;
  url?: string;
  uid?: string;
  /** Google Calendar event id when this personal event can be deleted. */
  googleId?: string;
  /** True when this came from the Work feed or a "[Work]" mirror. Not sent to the browser. */
  work?: boolean;
};

const PERSON_NAME = /^[\p{L}][\p{L}.'’-]{0,30}(?:\s+[\p{L}][\p{L}.'’-]{0,30}){0,2}$/u;
const NOT_A_NAME = /\b(?:get|buy|pick|call|grab|make|bring|shop|grocer\w*|for|with|about|the|task|todo|remind|meeting)\b/i;

export function isPersonName(title: string): boolean {
  const text = String(title || '').replace(/\s+/g, ' ').trim();
  return PERSON_NAME.test(text) && !NOT_A_NAME.test(text);
}

/** A title that is only a birthday, not a task that mentions one. */
export function titleIsBirthday(title: string): boolean {
  const text = String(title || '').replace(/\s+/g, ' ').trim();
  if (/^(?:happy\s+)?(?:birthdays?|b-?days?)$/i.test(text)) return true;
  return birthdayName(text) !== '';
}

export function birthdayName(title: string): string {
  const text = String(title || '').replace(/\s+/g, ' ').trim();
  const patterns = [
    /^(?:happy\s+)?(.+?)['’]s\s+birthdays?$/i,
    /^(?:happy\s+)?(.+?)['’]s\s+b-?days?$/i,
    /^(?:happy\s+)?(.+?)\s+b-?days?$/i,
    /^birthdays?\s*[:\-]\s*(.+)$/i,
    /^b-?days?\s*[:\-]\s*(.+)$/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const name = cleanBirthdayName(match[1] || '');
    if (isPersonName(name)) return name;
  }
  return '';
}

export function eventIsBirthday(input: { title: string; allDay: boolean; birthday?: boolean }): boolean {
  if (titleIsBirthday(input.title)) return true;
  return !!(input.birthday && input.allDay && isPersonName(input.title));
}

function cleanBirthdayName(value: string): string {
  return value.replace(/^happy\s+/i, '').replace(/[!,.]+$/g, '').trim();
}

const WORK_PREFIX = /^\s*\[work\]\s*/i;
const DAY_INDEX: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

type Stamp = {
  allDay: boolean;
  y: number;
  m: number;
  d: number;
  h: number;
  mi: number;
  s: number;
  zone: string;
};

type Until = { kind: 'date'; y: number; m: number; d: number } | { kind: 'instant'; ms: number };

type RRule = {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval: number;
  count: number | null;
  until: Until | null;
  byday: { ord: number | null; day: number }[];
  bymonthday: number[];
  bymonth: number[];
  wkst: number;
};

type RawEvent = {
  uid: string;
  summary: string;
  status: string;
  location: string;
  description: string;
  url: string;
  start: Stamp;
  end: Stamp | null;
  durationMs: number | null;
  rrule: RRule | null;
  exdates: number[];
  recurrenceId: number | null;
  birthday: boolean;
};

type Occ = {
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  birthday: boolean;
  location: string;
  description: string;
  url: string;
  uid: string;
};

export function stripWorkPrefix(title: string): string {
  const stripped = title.replace(WORK_PREFIX, '').trim();
  return stripped || title.trim() || 'Busy';
}

function normTitle(title: string): string {
  return stripWorkPrefix(title)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function similarTitle(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (shorter.length >= 4 && longer.includes(shorter)) return true;
  const left = a.split(' ').filter(Boolean);
  const right = new Set(b.split(' ').filter(Boolean));
  if (!left.length || !right.size) return false;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared++;
  return shared / Math.max(left.length, right.size) >= 0.66;
}

function sameSlot(a: AgendaEvent, b: AgendaEvent): boolean {
  if (a.allDay || b.allDay) {
    return a.allDay && b.allDay && phoenixDate(a.start) === phoenixDate(b.start);
  }
  return Math.abs(a.start - b.start) <= 10 * 60 * 1000;
}

function isWorkFeed(event: AgendaEvent): boolean {
  return event.feedLabel.trim().toLowerCase() === 'work';
}

function isWorkCopy(event: AgendaEvent): boolean {
  return isWorkFeed(event) || event.work === true || WORK_PREFIX.test(event.title);
}

/**
 * Google mirrors the work calendar with a "[Work] " title prefix.
 * When a Work feed is present, drop those mirrors if the start and title match.
 * Matching uses the real titles. Display masking happens afterwards.
 */
export function dedupeWorkMirrors(events: AgendaEvent[]): AgendaEvent[] {
  const work = events.filter((event) => isWorkFeed(event));
  const kept: AgendaEvent[] = [];
  for (const event of events) {
    const mirror = !isWorkFeed(event) && WORK_PREFIX.test(event.title);
    if (mirror) {
      const title = normTitle(event.title);
      const matched = work.some((item) => sameSlot(event, item) && similarTitle(title, normTitle(item.title)));
      if (matched) continue;
    }
    kept.push({ ...event, title: stripWorkPrefix(event.title), work: isWorkCopy(event) });
  }
  return kept;
}

/** Replace every work event before it is sent to the browser. */
export function maskWorkEvents(events: AgendaEvent[]): AgendaEvent[] {
  const color = events.find((event) => isWorkFeed(event))?.color || '#8eb6ff';
  return events.map((event) => {
    if (!isWorkCopy(event)) return event;
    return {
      ...event,
      title: 'Max Work Meeting',
      feedLabel: 'Work',
      color,
      birthday: false,
      work: true,
      location: '',
      description: '',
      url: '',
      googleId: ''
    };
  });
}

type ReadyFeed = {
  at: number;
  raws: RawEvent[];
  etag: string;
  bytes: number;
  parses: number;
  /** Full body only for the synchronous test helper. Cron drops it. */
  textKey: string;
};

type IcsCursor = {
  text: string;
  i: number;
  index: number;
  calendarZone: string;
  events: RawEvent[];
  minDate: number;
  maxDate: number;
  etag: string;
  inEvent: boolean;
  eventStart: number;
  nested: number;
  sawStart: boolean;
  sawRrule: boolean;
  sawException: boolean;
  startNum: number;
  endNum: number;
};

/** Do not start another full parse of a feed sooner than this. */
export const ICS_REFRESH_MS = 30 * 60 * 1000;
/** One cron invocation stays under the free-tier CPU cap. */
export const ICS_PARSE_BUDGET_MS = 6;

export type IcsStep = {
  bytes: number;
  etag: string;
  notModified: boolean;
  reparsed: boolean;
  parseMs: number;
  done: boolean;
  offset: number;
};

const readyFeeds = new Map<string, ReadyFeed>();
const cursors = new Map<string, IcsCursor>();

/** Wide enough for the week pager (±400 days) plus a little slack. */
export function feedSpan(now = Date.now()): { start: number; end: number } {
  const [y, m, d] = phoenixDate(now).split('-').map(Number);
  const start = addDays(y, m, d, -420);
  const end = addDays(y, m, d, 420);
  return {
    start: zonedToUtc(start.y, start.m, start.d, 0, 0, 0, PHOENIX),
    end: zonedToUtc(end.y, end.m, end.d, 0, 0, 0, PHOENIX)
  };
}

export function cachedFeed(id: string): { etag: string; raws: RawEvent[]; bytes: number } | null {
  const row = readyFeeds.get(id);
  if (!row) return null;
  return { etag: row.etag, raws: row.raws, bytes: row.bytes };
}

export function feedIsFresh(id: string, now = Date.now()): boolean {
  const row = readyFeeds.get(id);
  return !!row && !cursors.has(id) && now - row.at < ICS_REFRESH_MS;
}

export function feedParseActive(id: string): boolean {
  return cursors.has(id);
}

export function touchFeed(id: string, now = Date.now()): void {
  const row = readyFeeds.get(id);
  if (row) row.at = now;
}

/** Install events loaded from D1 so a new isolate does not parse on the poll path. */
export function adoptReadyFeed(id: string, raws: RawEvent[], meta: { at: number; etag: string; bytes: number }): void {
  if (readyFeeds.has(id) || cursors.has(id)) return;
  readyFeeds.set(id, { at: meta.at, raws, etag: meta.etag, bytes: meta.bytes, parses: 0, textKey: '' });
}

/** Reuse the last parse when the body or ETag has not changed. */
export function takeFeedRaws(id: string, text: string, etag: string, windowStart: number, windowEnd: number): RawEvent[] {
  const known = readyFeeds.get(id);
  if (known && known.textKey && (known.textKey === text || (etag && etag === known.etag))) {
    if (etag) known.etag = etag;
    return known.raws;
  }
  const cursor = openCursor(text, windowStart, windowEnd);
  advanceIcsCursor(cursor, 1e9);
  const ready: ReadyFeed = {
    at: Date.now(),
    raws: cursor.events,
    etag,
    bytes: text.length,
    parses: (known?.parses || 0) + 1,
    textKey: text
  };
  readyFeeds.set(id, ready);
  return ready.raws;
}

/**
 * Parse at most one budget slice. A fresh feed (parsed within ICS_REFRESH_MS)
 * is returned as-is even if DTSTAMP or line order changed.
 */
export function startFeedParse(input: {
  id: string;
  text: string;
  etag: string;
  windowStart: number;
  windowEnd: number;
  now?: number;
  budgetMs?: number;
}): IcsStep {
  const now = input.now ?? Date.now();
  const budget = input.budgetMs ?? ICS_PARSE_BUDGET_MS;
  const known = readyFeeds.get(input.id);
  if (known && !cursors.has(input.id) && now - known.at < ICS_REFRESH_MS) {
    if (input.etag) known.etag = input.etag;
    return {
      bytes: input.text.length || known.bytes,
      etag: input.etag || known.etag,
      notModified: false,
      reparsed: false,
      parseMs: 0,
      done: true,
      offset: input.text.length || known.bytes
    };
  }
  let cursor = cursors.get(input.id);
  if (!cursor || cursor.text !== input.text) {
    cursor = openCursor(input.text, input.windowStart, input.windowEnd);
    cursor.etag = input.etag;
    cursors.set(input.id, cursor);
  }
  const step = advanceIcsCursor(cursor, budget);
  if (step.done) {
    readyFeeds.set(input.id, {
      at: now,
      raws: cursor.events,
      etag: input.etag,
      bytes: input.text.length,
      parses: (known?.parses || 0) + 1,
      textKey: ''
    });
    cursors.delete(input.id);
  }
  return {
    bytes: input.text.length,
    etag: input.etag,
    notModified: false,
    reparsed: true,
    parseMs: step.ms,
    done: step.done,
    offset: cursor.i
  };
}

export function continueFeedParse(id: string, budgetMs = ICS_PARSE_BUDGET_MS, now = Date.now()): IcsStep | null {
  const cursor = cursors.get(id);
  if (!cursor) return null;
  const known = readyFeeds.get(id);
  const step = advanceIcsCursor(cursor, budgetMs);
  if (step.done) {
    readyFeeds.set(id, {
      at: now,
      raws: cursor.events,
      etag: cursor.etag || known?.etag || '',
      bytes: cursor.text.length,
      parses: (known?.parses || 0) + 1,
      textKey: ''
    });
    cursors.delete(id);
  }
  return {
    bytes: cursor.text.length,
    etag: cursor.etag || known?.etag || '',
    notModified: false,
    reparsed: true,
    parseMs: step.ms,
    done: step.done,
    offset: step.done ? cursor.text.length : cursor.i
  };
}

export function eventsFromIcs(ics: string, feed: FeedMeta, windowStart: number, windowEnd: number): AgendaEvent[] {
  return projectFeed(parseIcs(ics, windowStart, windowEnd), feed, windowStart, windowEnd);
}

export function projectFeed(raws: RawEvent[], feed: FeedMeta, windowStart: number, windowEnd: number): AgendaEvent[] {
  const occs = expandAll(raws, windowStart, windowEnd);
  return occs.map((occ) => {
    const personal = feed.label.trim().toLowerCase() === 'personal';
    return {
      title: occ.title,
      start: occ.start,
      end: occ.end,
      allDay: occ.allDay,
      birthday: eventIsBirthday({ title: occ.title, allDay: occ.allDay, birthday: occ.birthday }),
      feedId: feed.id,
      feedLabel: feed.label,
      color: feed.color,
      location: occ.location,
      description: occ.description,
      url: occ.url,
      uid: occ.uid,
      googleId: personal ? googleEventId(occ.uid) : ''
    };
  });
}

/** Google Calendar ICS uids look like `{eventId}@google.com`. calendar.events may delete that id. */
export function googleEventId(uid: string): string {
  const match = String(uid || '').trim().match(/^([A-Za-z0-9_-]{4,256})@google\.com$/i);
  return match ? match[1] : '';
}

const KEPT_PROPS = new Set([
  'UID',
  'SUMMARY',
  'LOCATION',
  'DESCRIPTION',
  'URL',
  'CATEGORIES',
  'STATUS',
  'DTSTART',
  'DTEND',
  'DURATION',
  'RRULE',
  'EXDATE',
  'RECURRENCE-ID'
]);

function keepProp(name: string): boolean {
  if (KEPT_PROPS.has(name)) return true;
  if (name === 'X-WR-TIMEZONE') return true;
  if (name.startsWith('X-') && /birthday|cake/i.test(name)) return true;
  return false;
}

function propCap(name: string): number {
  if (name === 'DESCRIPTION') return 1800;
  if (name === 'EXDATE') return 12000;
  if (name === 'SUMMARY' || name === 'LOCATION') return 500;
  if (name === 'URL') return 600;
  if (name.startsWith('X-')) return 300;
  return 4000;
}

function nextBreak(text: string, i: number, limit: number): { end: number; next: number } {
  const nl = text.indexOf('\n', i);
  if (nl < 0 || nl >= limit) {
    const end = limit > i && text.charCodeAt(limit - 1) === 13 ? limit - 1 : limit;
    return { end, next: limit };
  }
  const end = nl > i && text.charCodeAt(nl - 1) === 13 ? nl - 1 : nl;
  return { end, next: nl + 1 };
}

function startsWithName(text: string, i: number, end: number, name: string): boolean {
  if (end - i < name.length) return false;
  for (let k = 0; k < name.length; k++) {
    let c = text.charCodeAt(i + k);
    if (c >= 97 && c <= 122) c -= 32;
    if (c !== name.charCodeAt(k)) return false;
  }
  if (i + name.length >= end) return true;
  const sep = text.charCodeAt(i + name.length);
  return sep === 58 || sep === 59;
}

function nameValueIs(text: string, i: number, end: number, name: string, value: string): boolean {
  if (!startsWithName(text, i, end, name)) return false;
  const colon = text.indexOf(':', i);
  if (colon < 0 || colon >= end || end - (colon + 1) < value.length) return false;
  for (let k = 0; k < value.length; k++) {
    if (text.charCodeAt(colon + 1 + k) !== value.charCodeAt(k)) return false;
  }
  return end === colon + 1 + value.length;
}

function readDateNum(text: string, i: number, end: number): number {
  const colon = text.indexOf(':', i);
  if (colon < 0 || colon >= end) return 0;
  let p = colon + 1;
  while (p < end) {
    const c = text.charCodeAt(p);
    if (c >= 48 && c <= 57) break;
    p++;
  }
  if (p + 8 > end) return 0;
  let n = 0;
  for (let k = 0; k < 8; k++) {
    const c = text.charCodeAt(p + k);
    if (c < 48 || c > 57) return 0;
    n = n * 10 + (c - 48);
  }
  return n;
}

/**
 * Unfold only the properties Glance reads, between [from, to).
 * Attachment lines are skipped without being copied.
 */
function logicalLines(text: string, from = 0, to = text.length): string[] {
  const lines: string[] = [];
  let i = from;
  let current = '';
  let keeping = false;
  let cap = 0;
  const flush = () => {
    if (keeping && current) lines.push(current);
    current = '';
    keeping = false;
  };
  while (i < to) {
    const br = nextBreak(text, i, to);
    if (br.next <= i) break;
    const code = text.charCodeAt(i);
    if (code === 32 || code === 9) {
      if (keeping && current.length < cap) {
        const take = Math.min(br.end, i + 1 + (cap - current.length));
        if (take > i + 1) current += text.slice(i + 1, take);
      }
    } else {
      flush();
      let cut = i;
      while (cut < br.end && text.charCodeAt(cut) !== 58 && text.charCodeAt(cut) !== 59) cut++;
      const name = text.slice(i, cut).toUpperCase();
      if (name === 'BEGIN' || name === 'END' || keepProp(name)) {
        keeping = true;
        cap = name === 'BEGIN' || name === 'END' ? 80 : propCap(name);
        current = text.slice(i, Math.min(br.end, i + cap));
      }
    }
    i = br.next;
  }
  flush();
  return lines;
}

function splitProp(line: string): { name: string; params: Record<string, string>; value: string } | null {
  const idx = line.indexOf(':');
  if (idx <= 0) return null;
  const left = line.slice(0, idx);
  const value = line.slice(idx + 1);
  const bits = left.split(';');
  const name = bits[0].toUpperCase();
  const params: Record<string, string> = {};
  for (let i = 1; i < bits.length; i++) {
    const eq = bits[i].indexOf('=');
    if (eq < 0) continue;
    params[bits[i].slice(0, eq).toUpperCase()] = bits[i].slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name, params, value };
}

function clipDetail(value: string, max: number): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length > max ? clean.slice(0, max) : clean;
}

function unescapeText(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '\\' && i + 1 < value.length) {
      const next = value[i + 1];
      if (next === 'n' || next === 'N') out += ' ';
      else if (next === ',' || next === ';' || next === '\\') out += next;
      else out += next;
      i++;
    } else {
      out += value[i];
    }
  }
  return out.replace(/\s+/g, ' ').trim();
}

function parseStamp(value: string, params: Record<string, string>, fallbackZone: string): Stamp | null {
  const raw = value.trim();
  if (!raw) return null;
  const allDay = (params.VALUE || '').toUpperCase() === 'DATE' || /^\d{8}$/.test(raw);
  const utc = raw.endsWith('Z');
  const body = raw.replace(/Z$/, '');
  const datePart = body.includes('T') ? body.slice(0, body.indexOf('T')) : body.slice(0, 8);
  if (!/^\d{8}$/.test(datePart)) return null;
  const y = Number(datePart.slice(0, 4));
  const m = Number(datePart.slice(4, 6));
  const d = Number(datePart.slice(6, 8));
  let h = 0;
  let mi = 0;
  let s = 0;
  if (!allDay && body.includes('T')) {
    const time = body.split('T')[1] || '';
    h = Number(time.slice(0, 2) || 0);
    mi = Number(time.slice(2, 4) || 0);
    s = Number(time.slice(4, 6) || 0);
  }
  if (!y || !m || !d) return null;
  const zone = allDay ? PHOENIX : utc ? 'UTC' : resolveZone(params.TZID, fallbackZone);
  return { allDay, y, m, d, h, mi, s, zone };
}

function stampUtc(stamp: Stamp): number {
  if (stamp.allDay) return zonedToUtc(stamp.y, stamp.m, stamp.d, 0, 0, 0, PHOENIX);
  try {
    return zonedToUtc(stamp.y, stamp.m, stamp.d, stamp.h, stamp.mi, stamp.s, stamp.zone);
  } catch {
    return zonedToUtc(stamp.y, stamp.m, stamp.d, stamp.h, stamp.mi, stamp.s, PHOENIX);
  }
}

function parseDuration(value: string): number | null {
  const match = value.trim().match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i);
  if (!match) return null;
  const sign = match[1] === '-' ? -1 : 1;
  const weeks = Number(match[2] || 0);
  const days = Number(match[3] || 0);
  const hours = Number(match[4] || 0);
  const mins = Number(match[5] || 0);
  const secs = Number(match[6] || 0);
  return sign * ((((weeks * 7 + days) * 24 + hours) * 60 + mins) * 60 + secs) * 1000;
}

function parseByday(value: string): { ord: number | null; day: number }[] {
  if (!value) return [];
  const out: { ord: number | null; day: number }[] = [];
  for (const token of value.split(',')) {
    const match = token.trim().toUpperCase().match(/^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/);
    if (!match) continue;
    out.push({ ord: match[1] ? Number(match[1]) : null, day: DAY_INDEX[match[2]] });
  }
  return out;
}

function parseRrule(value: string, fallbackZone: string): RRule | null {
  const bag: Record<string, string> = {};
  for (const part of value.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    bag[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }
  const freq = bag.FREQ;
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') return null;
  let until: Until | null = null;
  if (bag.UNTIL) {
    const stamp = parseStamp(bag.UNTIL, bag.UNTIL.endsWith('Z') ? { TZID: 'UTC' } : {}, fallbackZone);
    if (stamp?.allDay) until = { kind: 'date', y: stamp.y, m: stamp.m, d: stamp.d };
    else if (stamp) until = { kind: 'instant', ms: stampUtc({ ...stamp, allDay: false, zone: stamp.zone }) };
  }
  const count = bag.COUNT ? Number(bag.COUNT) : null;
  return {
    freq,
    interval: Math.max(1, Number(bag.INTERVAL) || 1),
    count: count && Number.isFinite(count) ? count : null,
    until,
    byday: parseByday(bag.BYDAY || ''),
    bymonthday: (bag.BYMONTHDAY || '').split(',').map(Number).filter((n) => Number.isFinite(n) && n !== 0),
    bymonth: (bag.BYMONTH || '').split(',').map(Number).filter((n) => n >= 1 && n <= 12),
    wkst: bag.WKST && DAY_INDEX[bag.WKST.toUpperCase()] !== undefined ? DAY_INDEX[bag.WKST.toUpperCase()] : 1
  };
}

function parseDateList(value: string, params: Record<string, string>, fallbackZone: string): number[] {
  const out: number[] = [];
  for (const piece of value.split(',')) {
    const stamp = parseStamp(piece, params, fallbackZone);
    if (!stamp) continue;
    out.push(stampUtc(stamp));
  }
  return out;
}

function emptyRaw(index: number): RawEvent {
  return {
    uid: `glance-${index}`,
    summary: '',
    status: '',
    location: '',
    description: '',
    url: '',
    start: { allDay: false, y: 1970, m: 1, d: 1, h: 0, mi: 0, s: 0, zone: PHOENIX },
    end: null,
    durationMs: null,
    rrule: null,
    exdates: [],
    recurrenceId: null,
    birthday: false
  };
}

function dateNum(y: number, m: number, d: number): number {
  return y * 10000 + m * 100 + d;
}

function keepEvent(raw: RawEvent, minDate: number, maxDate: number): boolean {
  if (raw.rrule || raw.recurrenceId != null) return true;
  const start = dateNum(raw.start.y, raw.start.m, raw.start.d);
  const end = raw.end ? dateNum(raw.end.y, raw.end.m, raw.end.d) : start;
  return end >= minDate && start <= maxDate;
}

function applyProp(current: RawEvent, prop: { name: string; params: Record<string, string>; value: string }, calendarZone: string): boolean {
  if (prop.name === 'UID' && prop.value.trim()) current.uid = prop.value.trim();
  else if (prop.name === 'SUMMARY') current.summary = unescapeText(prop.value);
  else if (prop.name === 'LOCATION') current.location = clipDetail(unescapeText(prop.value), 300);
  else if (prop.name === 'DESCRIPTION') current.description = clipDetail(unescapeText(prop.value), 1500);
  else if (prop.name === 'URL') current.url = clipDetail(prop.value.trim(), 500);
  else if (prop.name === 'CATEGORIES' && /birthday/i.test(prop.value)) current.birthday = true;
  else if (/^X-/.test(prop.name) && /birthday|cake\.gif/i.test(`${prop.name} ${prop.value}`)) current.birthday = true;
  else if (prop.name === 'STATUS') current.status = prop.value.trim().toUpperCase();
  else if (prop.name === 'DTSTART') {
    const stamp = parseStamp(prop.value, prop.params, calendarZone);
    if (stamp) {
      current.start = stamp;
      return true;
    }
  } else if (prop.name === 'DTEND') {
    const stamp = parseStamp(prop.value, prop.params, calendarZone);
    if (stamp) current.end = stamp;
  } else if (prop.name === 'DURATION') {
    current.durationMs = parseDuration(prop.value);
  } else if (prop.name === 'RRULE') {
    current.rrule = parseRrule(prop.value, current.start.zone || calendarZone);
  } else if (prop.name === 'EXDATE') {
    current.exdates.push(...parseDateList(prop.value, prop.params, current.start.zone || calendarZone));
  } else if (prop.name === 'RECURRENCE-ID') {
    const stamp = parseStamp(prop.value, prop.params, current.start.zone || calendarZone);
    if (stamp) current.recurrenceId = stampUtc(stamp);
  }
  return false;
}

function eventFromBlock(text: string, start: number, end: number, calendarZone: string, index: number): RawEvent | null {
  let current: RawEvent | null = null;
  let nested = 0;
  let sawStart = false;
  for (const line of logicalLines(text, start, end)) {
    if (line === 'BEGIN:VEVENT') {
      current = emptyRaw(index);
      nested = 0;
      sawStart = false;
      continue;
    }
    if (!current || line.startsWith('END:VEVENT')) continue;
    if (line.startsWith('BEGIN:')) {
      nested++;
      continue;
    }
    if (line.startsWith('END:')) {
      nested = Math.max(0, nested - 1);
      continue;
    }
    if (nested) continue;
    const prop = splitProp(line);
    if (!prop) continue;
    if (applyProp(current, prop, calendarZone)) sawStart = true;
  }
  return current && sawStart ? current : null;
}

function openCursor(text: string, windowStart: number, windowEnd: number): IcsCursor {
  const lead = partsInZone(windowStart - 14 * 86400000, PHOENIX);
  const tail = partsInZone(windowEnd + 14 * 86400000, PHOENIX);
  return {
    text,
    i: 0,
    index: 0,
    etag: '',
    calendarZone: PHOENIX,
    events: [],
    minDate: dateNum(lead.y, lead.m, lead.d),
    maxDate: dateNum(tail.y, tail.m, tail.d),
    inEvent: false,
    eventStart: 0,
    nested: 0,
    sawStart: false,
    sawRrule: false,
    sawException: false,
    startNum: 0,
    endNum: 0
  };
}

function advanceIcsCursor(cursor: IcsCursor, budgetMs: number): { done: boolean; ms: number } {
  const started = performance.now();
  const text = cursor.text;
  const limit = text.length;
  let lines = 0;
  while (cursor.i < limit) {
    if ((lines++ & 63) === 0 && performance.now() - started >= budgetMs) break;
    const br = nextBreak(text, cursor.i, limit);
    if (br.next <= cursor.i) break;
    const i = cursor.i;
    const folded = text.charCodeAt(i) === 32 || text.charCodeAt(i) === 9;
    if (!cursor.inEvent) {
      if (!folded && nameValueIs(text, i, br.end, 'BEGIN', 'VEVENT')) {
        cursor.inEvent = true;
        cursor.eventStart = i;
        cursor.nested = 0;
        cursor.sawStart = false;
        cursor.sawRrule = false;
        cursor.sawException = false;
        cursor.startNum = 0;
        cursor.endNum = 0;
      } else if (!folded && startsWithName(text, i, br.end, 'X-WR-TIMEZONE')) {
        const prop = splitProp(text.slice(i, br.end));
        if (prop?.value) cursor.calendarZone = resolveZone(prop.value, PHOENIX);
      }
    } else if (!folded) {
      if (cursor.nested === 0 && nameValueIs(text, i, br.end, 'END', 'VEVENT')) {
        const endNum = cursor.endNum || cursor.startNum;
        const inWindow = cursor.sawStart && cursor.startNum <= cursor.maxDate && endNum >= cursor.minDate;
        if (cursor.sawRrule || cursor.sawException || inWindow) {
          const raw = eventFromBlock(text, cursor.eventStart, i, cursor.calendarZone, cursor.index++);
          if (raw && keepEvent(raw, cursor.minDate, cursor.maxDate)) cursor.events.push(raw);
        }
        cursor.inEvent = false;
        cursor.i = br.next;
        if (performance.now() - started >= budgetMs) return { done: false, ms: performance.now() - started };
        continue;
      } else if (startsWithName(text, i, br.end, 'BEGIN')) {
        cursor.nested++;
      } else if (startsWithName(text, i, br.end, 'END')) {
        cursor.nested = Math.max(0, cursor.nested - 1);
      } else if (cursor.nested === 0 && startsWithName(text, i, br.end, 'RRULE')) {
        cursor.sawRrule = true;
      } else if (cursor.nested === 0 && startsWithName(text, i, br.end, 'RECURRENCE-ID')) {
        cursor.sawException = true;
      } else if (cursor.nested === 0 && startsWithName(text, i, br.end, 'DTSTART')) {
        cursor.startNum = readDateNum(text, i, br.end);
        cursor.sawStart = cursor.startNum > 0;
      } else if (cursor.nested === 0 && startsWithName(text, i, br.end, 'DTEND')) {
        cursor.endNum = readDateNum(text, i, br.end);
      }
    }
    cursor.i = br.next;
  }
  const done = cursor.i >= limit;
  return { done, ms: performance.now() - started };
}

function parseIcs(ics: string, windowStart = 0, windowEnd = 8640000000000000): RawEvent[] {
  const cursor = openCursor(ics, windowStart, windowEnd);
  advanceIcsCursor(cursor, 1e9);
  return cursor.events;
}

function durationOf(raw: RawEvent): number {
  if (raw.durationMs && raw.durationMs > 0) return raw.durationMs;
  if (raw.end) {
    const delta = stampUtc(raw.end) - stampUtc(raw.start);
    if (delta > 0) return delta;
  }
  return raw.start.allDay ? 86400000 : 60 * 60 * 1000;
}

function exceedsUntil(startMs: number, date: LocalDate, until: Until | null): boolean {
  if (!until) return false;
  if (until.kind === 'date') return cmpDate(date, until) > 0;
  return startMs > until.ms;
}

function overlaps(start: number, end: number, windowStart: number, windowEnd: number): boolean {
  return start < windowEnd && end > windowStart;
}

function singleOcc(raw: RawEvent): Occ | null {
  if (!raw.start || raw.start.y < 1970) return null;
  const start = stampUtc(raw.start);
  const end = start + durationOf(raw);
  return {
    title: raw.summary || 'Busy',
    start,
    end,
    allDay: raw.start.allDay,
    birthday: eventIsBirthday({ title: raw.summary || 'Busy', allDay: raw.start.allDay, birthday: !!raw.birthday }),
    location: raw.location,
    description: raw.description,
    url: raw.url,
    uid: raw.uid
  };
}

function minuteKey(ms: number): number {
  return Math.round(ms / 60000);
}

function expandAll(raws: RawEvent[], windowStart: number, windowEnd: number): Occ[] {
  const groups = new Map<string, RawEvent[]>();
  for (const raw of raws) {
    const list = groups.get(raw.uid) || [];
    list.push(raw);
    groups.set(raw.uid, list);
  }
  const occs: Occ[] = [];
  for (const list of groups.values()) {
    const master = list.find((raw) => raw.rrule && raw.recurrenceId == null) || null;
    const exceptions = list.filter((raw) => raw.recurrenceId != null);
    const singles = list.filter((raw) => raw !== master && raw.recurrenceId == null);
    const skip = new Set<number>();
    for (const ex of exceptions) if (ex.recurrenceId != null) skip.add(minuteKey(ex.recurrenceId));
    for (const exdate of master?.exdates || []) skip.add(minuteKey(exdate));
    if (master && master.status !== 'CANCELLED') {
      for (const occ of expandRule(master, windowStart, windowEnd)) {
        if (skip.has(minuteKey(occ.start))) continue;
        occs.push(occ);
      }
    }
    for (const raw of [...singles, ...exceptions]) {
      if (raw.status === 'CANCELLED') continue;
      const occ = singleOcc(raw);
      if (occ && overlaps(occ.start, occ.end, windowStart, windowEnd)) occs.push(occ);
    }
  }
  return occs;
}

function expandRule(raw: RawEvent, windowStart: number, windowEnd: number): Occ[] {
  if (!raw.rrule) {
    const occ = singleOcc(raw);
    return occ && overlaps(occ.start, occ.end, windowStart, windowEnd) ? [occ] : [];
  }
  const rule = raw.rrule;
  const duration = durationOf(raw);
  const title = raw.summary || 'Busy';
  const allDay = raw.start.allDay;
  const push = (date: LocalDate, out: Occ[], emitted: { n: number }): boolean => {
    if (rule.count != null && emitted.n >= rule.count) return false;
    const start = allDay
      ? zonedToUtc(date.y, date.m, date.d, 0, 0, 0, PHOENIX)
      : zonedToUtc(date.y, date.m, date.d, raw.start.h, raw.start.mi, raw.start.s, raw.start.zone);
    if (exceedsUntil(start, date, rule.until)) return false;
    emitted.n++;
    const end = allDay ? start + duration : start + duration;
    if (overlaps(start, end, windowStart, windowEnd)) {
      out.push({
        title,
        start,
        end,
        allDay,
        birthday: eventIsBirthday({ title, allDay, birthday: !!raw.birthday }),
        location: raw.location,
        description: raw.description,
        url: raw.url,
        uid: raw.uid
      });
    }
    return true;
  };

  if (rule.freq === 'DAILY') return expandDaily(raw, rule, windowStart, windowEnd, push);
  if (rule.freq === 'WEEKLY') return expandWeekly(raw, rule, windowStart, windowEnd, push);
  if (rule.freq === 'MONTHLY') return expandMonthly(raw, rule, windowStart, windowEnd, push);
  return expandYearly(raw, rule, windowStart, windowEnd, push);
}

type Push = (date: LocalDate, out: Occ[], emitted: { n: number }) => boolean;

function expandDaily(raw: RawEvent, rule: RRule, windowStart: number, windowEnd: number, push: Push): Occ[] {
  const out: Occ[] = [];
  const emitted = { n: 0 };
  const interval = rule.interval;
  let cursor = { y: raw.start.y, m: raw.start.m, d: raw.start.d };
  const zone = raw.start.allDay ? PHOENIX : raw.start.zone;
  const lead = partsInZone(windowStart - durationOf(raw) - 86400000, zone);
  const diff = daysBetween(cursor, lead);
  if (diff > interval && !rule.bymonth.length && !rule.bymonthday.length && !rule.byday.length) {
    const steps = Math.floor(diff / interval);
    cursor = addDays(cursor.y, cursor.m, cursor.d, steps * interval);
    emitted.n = steps;
  }
  const limit = rule.count ?? 20000;
  const horizon = partsInZone(windowEnd + 86400000, zone);
  let guard = 0;
  while (emitted.n < limit && guard < 20000) {
    guard++;
    if (rule.bymonth.length && !rule.bymonth.includes(cursor.m)) {
      cursor = addDays(cursor.y, cursor.m, cursor.d, interval);
      continue;
    }
    const startMs = raw.start.allDay
      ? zonedToUtc(cursor.y, cursor.m, cursor.d, 0, 0, 0, PHOENIX)
      : zonedToUtc(cursor.y, cursor.m, cursor.d, raw.start.h, raw.start.mi, raw.start.s, raw.start.zone);
    if (startMs > windowEnd + 2 * 86400000) break;
    if (!push(cursor, out, emitted)) break;
    if (cmpDate(cursor, horizon) > 0) break;
    cursor = addDays(cursor.y, cursor.m, cursor.d, interval);
  }
  return out;
}

function expandWeekly(raw: RawEvent, rule: RRule, windowStart: number, windowEnd: number, push: Push): Occ[] {
  const out: Occ[] = [];
  const emitted = { n: 0 };
  const wkst = rule.wkst;
  const days = rule.byday.length ? [...new Set(rule.byday.map((item) => item.day))] : [weekday(raw.start.y, raw.start.m, raw.start.d)];
  days.sort((a, b) => a - b);
  const interval = rule.interval;
  const startWeek = weekStartDayNum(raw.start.y, raw.start.m, raw.start.d, wkst);
  const zone = raw.start.allDay ? PHOENIX : raw.start.zone;
  const lead = partsInZone(windowStart - durationOf(raw) - 86400000, zone);
  const targetWeek = weekStartDayNum(lead.y, lead.m, lead.d, wkst);
  let week = startWeek;
  if (targetWeek > startWeek) {
    const diffWeeks = Math.floor((targetWeek - startWeek) / 7);
    const aligned = Math.floor(diffWeeks / interval) * interval;
    if (aligned > 0) {
      week = startWeek + aligned * 7;
      const skippedWeeks = aligned / interval;
      const firstCount = countWeek(startWeek, raw.start, days, wkst, true);
      emitted.n = firstCount + (skippedWeeks - 1) * days.length;
    }
  }
  const startDate = { y: raw.start.y, m: raw.start.m, d: raw.start.d };
  const limit = rule.count ?? 20000;
  let guard = 0;
  while (emitted.n < limit && guard < 2600) {
    guard++;
    let past = false;
    for (const day of days) {
      const date = dateFromWeekStart(week, day, wkst);
      if (cmpDate(date, startDate) < 0) continue;
      if (emitted.n >= limit) break;
      const probe = raw.start.allDay
        ? zonedToUtc(date.y, date.m, date.d, 0, 0, 0, PHOENIX)
        : zonedToUtc(date.y, date.m, date.d, raw.start.h, raw.start.mi, raw.start.s, raw.start.zone);
      if (probe > windowEnd + 8 * 86400000) {
        past = true;
        break;
      }
      if (!push(date, out, emitted)) return out;
    }
    if (past) break;
    week += interval * 7;
  }
  return out;
}

function countWeek(week: number, start: Stamp, days: number[], wkst: number, first: boolean): number {
  let n = 0;
  const startDate = { y: start.y, m: start.m, d: start.d };
  for (const day of days) {
    const date = dateFromWeekStart(week, day, wkst);
    if (!first || cmpDate(date, startDate) >= 0) n++;
  }
  return n;
}

function monthDates(y: number, m: number, rule: RRule, start: Stamp): LocalDate[] {
  const dates: LocalDate[] = [];
  if (rule.byday.length && rule.byday.some((item) => item.ord)) {
    for (const item of rule.byday) {
      const found = nthWeekday(y, m, item.day, item.ord || 1);
      if (found) dates.push(found);
    }
  } else if (rule.bymonthday.length) {
    const dim = daysInMonth(y, m);
    for (const day of rule.bymonthday) {
      const date = day > 0 ? day : dim + day + 1;
      if (date >= 1 && date <= dim) dates.push({ y, m, d: date });
    }
  } else if (rule.byday.length) {
    const dim = daysInMonth(y, m);
    for (let d = 1; d <= dim; d++) {
      if (rule.byday.some((item) => item.day === weekday(y, m, d))) dates.push({ y, m, d });
    }
  } else if (start.d <= daysInMonth(y, m)) {
    dates.push({ y, m, d: start.d });
  }
  dates.sort((a, b) => a.d - b.d);
  return dates;
}

function advanceMonth(y: number, m: number, interval: number): { y: number; m: number } {
  let month = m + interval;
  let year = y;
  while (month > 12) {
    month -= 12;
    year++;
  }
  return { y: year, m: month };
}

function monthPastUntil(raw: RawEvent, rule: RRule, date: LocalDate): boolean {
  if (!rule.until) return false;
  if (rule.until.kind === 'date') return cmpDate(date, rule.until) > 0;
  const startMs = raw.start.allDay
    ? zonedToUtc(date.y, date.m, date.d, 0, 0, 0, PHOENIX)
    : zonedToUtc(date.y, date.m, date.d, raw.start.h, raw.start.mi, raw.start.s, raw.start.zone);
  return startMs > rule.until.ms;
}

/** Count occurrences strictly before the month the window loop will start on. */
function countMonthsBefore(raw: RawEvent, rule: RRule, startDate: LocalDate, steps: number): number {
  let n = 0;
  let y = raw.start.y;
  let m = raw.start.m;
  const simple = !rule.bymonth.length && !rule.byday.length && !rule.bymonthday.length;
  for (let walked = 0; walked < steps; walked += rule.interval) {
    if (simple) {
      if (raw.start.d <= daysInMonth(y, m)) {
        const date = { y, m, d: raw.start.d };
        if (cmpDate(date, startDate) >= 0) {
          if (monthPastUntil(raw, rule, date)) return n;
          n++;
        }
      }
    } else if (!rule.bymonth.length || rule.bymonth.includes(m)) {
      for (const date of monthDates(y, m, rule, raw.start)) {
        if (cmpDate(date, startDate) < 0) continue;
        if (monthPastUntil(raw, rule, date)) return n;
        n++;
      }
    }
    const next = advanceMonth(y, m, rule.interval);
    y = next.y;
    m = next.m;
  }
  return n;
}

function expandMonthly(raw: RawEvent, rule: RRule, windowStart: number, windowEnd: number, push: Push): Occ[] {
  const out: Occ[] = [];
  const emitted = { n: 0 };
  let y = raw.start.y;
  let m = raw.start.m;
  const startDate = { y: raw.start.y, m: raw.start.m, d: raw.start.d };
  const zone = raw.start.allDay ? PHOENIX : raw.start.zone;
  const lead = partsInZone(windowStart - durationOf(raw) - 86400000, zone);
  const leadIndex = lead.y * 12 + (lead.m - 1);
  const startIndex = raw.start.y * 12 + (raw.start.m - 1);
  if (leadIndex > startIndex) {
    const steps = Math.floor((leadIndex - startIndex) / rule.interval) * rule.interval;
    if (steps > 0) {
      const jumped = countMonthsBefore(raw, rule, startDate, steps);
      if (rule.count != null && jumped >= rule.count) return [];
      emitted.n = jumped;
      const nextIndex = startIndex + steps;
      y = Math.floor(nextIndex / 12);
      m = (nextIndex % 12) + 1;
    }
  }
  const limit = rule.count ?? 600;
  const endProbe = partsInZone(windowEnd + 40 * 86400000, zone);
  const endMonth = { y: endProbe.y, m: endProbe.m, d: 1 };
  let guard = 0;
  while (emitted.n < limit && guard < 800) {
    guard++;
    if (!rule.bymonth.length || rule.bymonth.includes(m)) {
      for (const date of monthDates(y, m, rule, raw.start)) {
        if (cmpDate(date, startDate) < 0) continue;
        if (!push(date, out, emitted)) return out;
        if (emitted.n >= limit) return out;
      }
    }
    if (cmpDate({ y, m, d: 1 }, endMonth) > 0 && y * 12 + m > startIndex) break;
    const next = advanceMonth(y, m, rule.interval);
    y = next.y;
    m = next.m;
  }
  return out;
}

function expandYearly(raw: RawEvent, rule: RRule, windowStart: number, windowEnd: number, push: Push): Occ[] {
  const out: Occ[] = [];
  const emitted = { n: 0 };
  const months = rule.bymonth.length ? rule.bymonth : [raw.start.m];
  const limit = rule.count ?? 200;
  const endProbe = partsInZone(windowEnd + 400 * 86400000, raw.start.allDay ? PHOENIX : raw.start.zone);
  for (let step = 0; step < 200 && emitted.n < limit; step++) {
    const y = raw.start.y + step * rule.interval;
    if (y > endProbe.y + 1) break;
    for (const m of months) {
      const monthly: RRule = { ...rule, freq: 'MONTHLY', interval: 1, bymonth: [] };
      for (const date of monthDates(y, m, monthly, raw.start)) {
        if (cmpDate(date, raw.start) < 0) continue;
        if (!push(date, out, emitted)) return out;
      }
    }
  }
  return out;
}
