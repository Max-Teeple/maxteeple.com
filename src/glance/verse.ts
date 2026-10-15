import verses from './verses.json';
import { remember } from './cache';
import { phoenixDate } from './time';

export type Verse = {
  reference: string;
  theme: string;
  text: string;
  devotional: string;
};

const YEAR = verses as Verse[];

/** Day-of-year index into the 366-entry set. Feb 29 uses its own slot; other years skip it. */
export function verseIndex(now = Date.now()): number {
  const [y, m, d] = phoenixDate(now).split('-').map(Number);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const day = Math.floor((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86400000);
  const index = !leap && day >= 59 ? day + 1 : day;
  return ((index % YEAR.length) + YEAR.length) % YEAR.length;
}

export function verseFor(now = Date.now()): Verse & { date: string } {
  const verse = YEAR[verseIndex(now)];
  return { ...verse, date: phoenixDate(now) };
}

const VERSE_TTL_SEC = 12 * 60 * 60;

/** Reference and theme only. The iPad does not download the other 365 days. */
export function verseSummary(now = Date.now()): Promise<{ date: string; reference: string; theme: string }> {
  const date = phoenixDate(now);
  return remember(`glance:verse:${date}:summary`, VERSE_TTL_SEC, async () => {
    const verse = YEAR[verseIndex(now)];
    return { date, reference: verse.reference, theme: verse.theme };
  });
}

/** Full text and devotional. Fetched when the panel is opened, cached for that Phoenix date. */
export function verseDetail(now = Date.now()): Promise<Verse & { date: string }> {
  const date = phoenixDate(now);
  return remember(`glance:verse:${date}:detail`, VERSE_TTL_SEC, async () => {
    const verse = YEAR[verseIndex(now)];
    return { date, reference: verse.reference, theme: verse.theme, text: verse.text, devotional: verse.devotional };
  });
}
