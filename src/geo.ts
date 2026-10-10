import { coordsForCity } from './cities';

export async function geocodeAddress(input: {
  streetAddress?: string | null;
  city?: string | null;
  state?: string | null;
}): Promise<{ latitude: number; longitude: number } | null> {
  const streetAddress = String(input.streetAddress || '').trim();
  const city = String(input.city || '').trim();
  const state = String(input.state || '').trim();
  if (!streetAddress || !city || !state) return null;

  const query = [streetAddress, city, state, 'USA'].join(', ');
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'LiveViewGolf/1.0 (https://maxteeple.com/liveview)'
      }
    });
    if (!response.ok) return coordsForCity(city, state);
    const results = await response.json() as { lat?: string; lon?: string }[];
    const hit = Array.isArray(results) ? results[0] : null;
    const latitude = Number(hit?.lat);
    const longitude = Number(hit?.lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return coordsForCity(city, state);
    return { latitude, longitude };
  } catch {
    return coordsForCity(city, state);
  }
}
