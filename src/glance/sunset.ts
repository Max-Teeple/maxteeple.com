/** Phoenix sunset in local minutes after midnight. America/Phoenix is UTC-7 all year. */
const PHOENIX_OFFSET_HOURS = -7;
const ZENITH = 90.833;

function norm360(value: number): number {
  const wrapped = value % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

function norm24(value: number): number {
  const wrapped = value % 24;
  return wrapped < 0 ? wrapped + 24 : wrapped;
}

function dayOfYear(year: number, month: number, day: number): number {
  const start = Date.UTC(year, 0, 0);
  const current = Date.UTC(year, month - 1, day);
  return Math.round((current - start) / 86400000);
}

/** Official sunset for a civil date at lat/lon, returned as Phoenix-local minutes. */
export function phoenixSunsetMinutes(year: number, month: number, day: number, lat: number, lon: number): number {
  const rad = Math.PI / 180;
  const deg = 180 / Math.PI;
  const n = dayOfYear(year, month, day);
  const lngHour = lon / 15;
  const t = n + ((18 - lngHour) / 24);
  const mean = (0.9856 * t) - 3.289;
  let longitude = mean + (1.916 * Math.sin(mean * rad)) + (0.020 * Math.sin(2 * mean * rad)) + 282.634;
  longitude = norm360(longitude);
  let rightAsc = Math.atan(0.91764 * Math.tan(longitude * rad)) * deg;
  rightAsc = norm360(rightAsc);
  const lQuad = Math.floor(longitude / 90) * 90;
  const raQuad = Math.floor(rightAsc / 90) * 90;
  rightAsc = (rightAsc + (lQuad - raQuad)) / 15;
  const sinDec = 0.39782 * Math.sin(longitude * rad);
  const cosDec = Math.cos(Math.asin(sinDec));
  const cosH = (Math.cos(ZENITH * rad) - (sinDec * Math.sin(lat * rad))) / (cosDec * Math.cos(lat * rad));
  const hourAngle = Math.acos(Math.min(1, Math.max(-1, cosH))) * deg / 15;
  const localMean = hourAngle + rightAsc - (0.06571 * t) - 6.622;
  const utc = norm24(localMean - lngHour);
  const phoenix = norm24(utc + PHOENIX_OFFSET_HOURS);
  return Math.round(phoenix * 60);
}

export function formatPhoenixClock(minutes: number): string {
  const clamped = ((minutes % 1440) + 1440) % 1440;
  const hour24 = Math.floor(clamped / 60);
  const minute = clamped % 60;
  const ap = hour24 >= 12 ? 'PM' : 'AM';
  const hour = hour24 % 12 || 12;
  return hour + ':' + String(minute).padStart(2, '0') + ' ' + ap;
}
