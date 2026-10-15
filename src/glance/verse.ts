import verses from './verses.json';
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
