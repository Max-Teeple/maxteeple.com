const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const OSRM = 'https://router.project-osrm.org/route/v1/driving';
const USER_AGENT = 'Glance/1.0 (https://maxteeple.com/glance/)';

export type Place = { id: string; name: string; lat: number; lon: number; radiusM: number; home: boolean };
export type Fix = { lat: number; lon: number; acc: number | null; vel: number | null; regions: string[]; recordedAt: number };

const etaMemory = new Map<string, { at: number; minutes: number }>();

export function haversineMeters(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const r = 6371000;
  const p1 = (aLat * Math.PI) / 180;
  const p2 = (bLat * Math.PI) / 180;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function matchPlace(fix: Fix, places: Place[]): Place | null {
  const named = places.find((place) =>
    fix.regions.some((region) => region.trim().toLowerCase() === place.name.trim().toLowerCase())
  );
  if (named) return named;
  let best: { place: Place; distance: number } | null = null;
  for (const place of places) {
    const distance = haversineMeters(fix.lat, fix.lon, place.lat, place.lon);
    if (distance <= place.radiusM && (!best || distance < best.distance)) best = { place, distance };
  }
  return best?.place || null;
}

export function formatAge(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Informal place words: Home, Work, Gym, and names like "Max's Work". */
export function shortPlaceLabel(name: string, home = false): string {
  if (home) return 'home';
  const stripped = name.replace(/^(?:the\s+)?(?:\S+['’]s\s+)?/i, '').trim() || name.trim();
  const words = stripped.toLowerCase();
  if (/\bgym\b/.test(words)) return 'the gym';
  if (/\b(work|office)\b/.test(words)) return 'work';
  if (/\bhome\b/.test(words)) return 'home';
  return words;
}

export function familyPhrase(input: {
  name: string;
  fix: Fix | null;
  places: Place[];
  staleHours: number;
  now: number;
  minutes: number | null;
  driving: boolean;
}): string {
  const { name, fix, places, staleHours, now, driving } = input;
  if (!fix) return `${name} has no location yet`;
  const age = now - fix.recordedAt;
  const place = matchPlace(fix, places);
  const where = place ? shortPlaceLabel(place.name, place.home) : '';
  if (age >= staleHours * 3600000) {
    return place ? `${name} last seen at ${where}` : `${name} last seen`;
  }
  if (where === 'home') return `${name} is at home`;
  if (where === 'work') return `${name} is at work`;
  if (where === 'the gym') return `${name} is at the gym`;
  if (where) return `${name} is at ${where}`;
  if (driving) return `${name} is driving`;
  return `${name} is on the way`;
}

export async function geocodeAddress(address: string): Promise<{ lat: number; lon: number; label: string } | null> {
  const query = address.trim();
  if (!query || query.length > 160) return null;
  const url = `${NOMINATIM}?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) return null;
  const rows = (await response.json()) as { lat?: string; lon?: string; display_name?: string }[];
  const row = rows?.[0];
  const lat = Number(row?.lat);
  const lon = Number(row?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon, label: String(row?.display_name || query).slice(0, 160) };
}

export async function minutesFromHome(
  kv: KVNamespace,
  personId: string,
  from: { lat: number; lon: number },
  home: { lat: number; lon: number }
): Promise<number | null> {
  const distance = haversineMeters(from.lat, from.lon, home.lat, home.lon);
  if (distance < 80) return 0;
  const key = `glance:eta:${personId}:${from.lat.toFixed(3)}:${from.lon.toFixed(3)}:${home.lat.toFixed(3)}:${home.lon.toFixed(3)}`;
  const hit = etaMemory.get(key);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.minutes;
  try {
    const stored = await kv.get(key);
    if (stored) {
      const minutes = Number(stored);
      if (Number.isFinite(minutes)) {
        etaMemory.set(key, { at: Date.now(), minutes });
        return minutes;
      }
    }
  } catch {
    /* KV is only a cache. */
  }
  let minutes = estimateMinutes(distance);
  try {
    const url = `${OSRM}/${home.lon},${home.lat};${from.lon},${from.lat}?overview=false`;
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(8000)
    });
    if (response.ok) {
      const body = (await response.json()) as { routes?: { duration?: number }[] };
      const duration = body.routes?.[0]?.duration;
      if (typeof duration === 'number' && duration >= 0) minutes = Math.max(1, Math.round(duration / 60));
    }
  } catch {
    /* Straight-line estimate still gives a number. */
  }
  etaMemory.set(key, { at: Date.now(), minutes });
  try {
    await kv.put(key, String(minutes), { expirationTtl: 300 });
  } catch {
    /* Memory cache still covers this isolate. */
  }
  return minutes;
}

export function estimateMinutes(meters: number): number {
  const kmh = 40;
  return Math.max(1, Math.round(meters / 1000 / kmh * 60));
}

export function owntracksConfig(input: { name: string; token: string; origin: string }): {
  url: string;
  username: string;
  link: string;
  json: string;
} {
  const username = input.name.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 16) || 'phone';
  const url = `${input.origin}/glance/api/location/owntracks`;
  const tid = username.slice(0, 2).toUpperCase();
  const config = {
    _type: 'configuration',
    mode: 3,
    url,
    username,
    password: input.token,
    auth: true,
    usePassword: true,
    deviceId: 'iphone',
    tid,
    monitoring: 1
  };
  const json = JSON.stringify(config);
  const inline = btoa(json);
  const link = `owntracks:///config?inline=${encodeURIComponent(inline)}`;
  return { url, username, link, json };
}
