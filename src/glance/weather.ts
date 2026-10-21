import { PHOENIX, partsInZone, pad } from './time';

export type WeatherIcon = 'clear' | 'mostly' | 'partly' | 'cloud' | 'fog' | 'rain' | 'snow' | 'storm' | 'wind';

export type WeatherPayload = {
  ok: true;
  timezone: typeof PHOENIX;
  current: {
    temp: number;
    feels: number;
    code: number;
    label: string;
    icon: WeatherIcon;
    isDay: boolean;
    wind: number;
    windDir: number;
    humidity: number;
    precip: number;
    uv: number;
    high: number;
    low: number;
  };
  hourly: {
    time: string;
    temp: number;
    precip: number;
    code: number;
    icon: WeatherIcon;
    isDay: boolean;
    label: string;
  }[];
  daily: {
    date: string;
    code: number;
    icon: WeatherIcon;
    high: number;
    low: number;
    precip: number;
    sunrise: string | null;
    sunset: string | null;
    uv: number | null;
  }[];
  sun: { sunrise: string | null; sunset: string | null };
  air: { aqi: number | null; pm25: number | null; label: string };
};

type ForecastJson = {
  current?: {
    temperature_2m?: number;
    apparent_temperature?: number;
    weather_code?: number;
    wind_speed_10m?: number;
    wind_direction_10m?: number;
    is_day?: number;
    relative_humidity_2m?: number;
    time?: string;
  };
  hourly?: {
    time?: string[];
    temperature_2m?: number[];
    precipitation_probability?: number[];
    weather_code?: number[];
    uv_index?: number[];
    is_day?: number[];
  };
  daily?: {
    time?: string[];
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_probability_max?: number[];
    sunrise?: string[];
    sunset?: string[];
    uv_index_max?: number[];
  };
};

type AirJson = { current?: { us_aqi?: number; pm2_5?: number } };

export function weatherInfo(code: number, wind = 0): { label: string; icon: WeatherIcon } {
  if (code <= 1 && wind >= 22) return { label: 'Windy', icon: 'wind' };
  if (code === 0) return { label: 'Clear', icon: 'clear' };
  if (code === 1) return { label: 'Mostly clear', icon: 'mostly' };
  if (code === 2) return { label: 'Partly cloudy', icon: 'partly' };
  if (code === 3) return { label: 'Overcast', icon: 'cloud' };
  if (code === 45 || code === 48) return { label: 'Fog', icon: 'fog' };
  if (code >= 51 && code <= 57) return { label: 'Drizzle', icon: 'rain' };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { label: 'Rain', icon: 'rain' };
  if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return { label: 'Snow', icon: 'snow' };
  if (code >= 95) return { label: 'Thunderstorm', icon: 'storm' };
  return { label: 'Cloudy', icon: 'cloud' };
}

function withPhoenixOffset(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/[zZ]|[+-]\d{2}:\d{2}$/.test(value)) return value;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return `${value}:00-07:00`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)) return `${value}-07:00`;
  return value;
}

export function aqiLabel(aqi: number | null): string {
  if (aqi == null || !Number.isFinite(aqi)) return 'Unavailable';
  if (aqi <= 50) return 'Good';
  if (aqi <= 100) return 'Moderate';
  if (aqi <= 150) return 'Sensitive';
  if (aqi <= 200) return 'Unhealthy';
  if (aqi <= 300) return 'Very unhealthy';
  return 'Hazardous';
}

function round(n: number | undefined | null): number {
  if (n == null || !Number.isFinite(n)) return 0;
  return Math.round(n);
}

export function shapeWeather(forecast: ForecastJson, air: AirJson | null, now: number): WeatherPayload {
  const parts = partsInZone(now, PHOENIX);
  const today = `${parts.y}-${pad(parts.m)}-${pad(parts.d)}`;
  const hourKey = `${today}T${pad(parts.h)}:00`;
  const times = forecast.hourly?.time || [];
  let start = times.findIndex((time) => time >= hourKey);
  if (start < 0) start = 0;
  const hourly = [];
  for (let i = start; i < Math.min(times.length, start + 12); i++) {
    const code = forecast.hourly?.weather_code?.[i] ?? 0;
    const isDay = (forecast.hourly?.is_day?.[i] ?? 1) === 1;
    const info = weatherInfo(code);
    hourly.push({
      time: withPhoenixOffset(times[i]) || times[i],
      temp: round(forecast.hourly?.temperature_2m?.[i]),
      precip: round(forecast.hourly?.precipitation_probability?.[i]),
      code,
      icon: info.icon,
      isDay,
      label: info.label
    });
  }
  const daily = [];
  const dates = forecast.daily?.time || [];
  for (let i = 0; i < dates.length && i < 7; i++) {
    const code = forecast.daily?.weather_code?.[i] ?? 0;
    const info = weatherInfo(code);
    daily.push({
      date: dates[i],
      code,
      icon: info.icon,
      high: round(forecast.daily?.temperature_2m_max?.[i]),
      low: round(forecast.daily?.temperature_2m_min?.[i]),
      precip: round(forecast.daily?.precipitation_probability_max?.[i]),
      sunrise: withPhoenixOffset(forecast.daily?.sunrise?.[i]),
      sunset: withPhoenixOffset(forecast.daily?.sunset?.[i]),
      uv: forecast.daily?.uv_index_max?.[i] != null ? round(forecast.daily?.uv_index_max?.[i]) : null
    });
  }
  const todayIndex = Math.max(0, dates.indexOf(today));
  const currentCode = forecast.current?.weather_code ?? daily[0]?.code ?? 0;
  const wind = round(forecast.current?.wind_speed_10m);
  const info = weatherInfo(currentCode, wind);
  const hourPrecip = hourly[0]?.precip ?? daily[0]?.precip ?? 0;
  const hourUv = round(forecast.hourly?.uv_index?.[start]);
  const aqi = air?.current?.us_aqi;
  return {
    ok: true,
    timezone: PHOENIX,
    current: {
      temp: round(forecast.current?.temperature_2m),
      feels: round(forecast.current?.apparent_temperature),
      code: currentCode,
      label: info.label,
      icon: info.icon,
      isDay: (forecast.current?.is_day ?? 1) === 1,
      wind,
      windDir: round(forecast.current?.wind_direction_10m),
      humidity: round(forecast.current?.relative_humidity_2m),
      precip: hourPrecip,
      uv: daily[todayIndex]?.uv ?? hourUv,
      high: daily[todayIndex]?.high ?? hourly[0]?.temp ?? 0,
      low: daily[todayIndex]?.low ?? hourly[0]?.temp ?? 0
    },
    hourly,
    daily,
    sun: {
      sunrise: daily[todayIndex]?.sunrise ?? null,
      sunset: daily[todayIndex]?.sunset ?? null
    },
    air: {
      aqi: aqi == null || !Number.isFinite(aqi) ? null : Math.round(aqi),
      pm25: air?.current?.pm2_5 == null ? null : Math.round(air.current.pm2_5 * 10) / 10,
      label: aqiLabel(aqi == null ? null : aqi)
    }
  };
}

export function forecastUrl(lat: number, lon: number): string {
  const q = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,is_day',
    hourly: 'temperature_2m,precipitation_probability,weather_code,wind_speed_10m,uv_index,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,uv_index_max,wind_speed_10m_max',
    timezone: PHOENIX,
    forecast_days: '7',
    wind_speed_unit: 'mph',
    temperature_unit: 'fahrenheit'
  });
  return `https://api.open-meteo.com/v1/forecast?${q}`;
}

export function airUrl(lat: number, lon: number): string {
  const q = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: 'us_aqi,pm2_5',
    timezone: PHOENIX
  });
  return `https://air-quality-api.open-meteo.com/v1/air-quality?${q}`;
}
