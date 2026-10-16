import { plugAlias } from './plug-names';
import { phoenixSunsetMinutes } from './sunset';
import { partsInZone, PHOENIX } from './time';

export type AutoLight = {
  id: string;
  name: string;
  online: boolean;
  on: boolean | null;
  code: string | null;
};

export type LightPlan = {
  date: string;
  minutes: number;
  sunsetMinutes: number;
  sunsetLabel: string;
  runPatio: boolean;
  runMidnight: boolean;
  patioOn: string[];
  livingRoomOff: string[];
};

const MIDNIGHT_WINDOW_MINUTES = 15;

function dateKey(parts: { y: number; m: number; d: number }): string {
  return parts.y + '-' + String(parts.m).padStart(2, '0') + '-' + String(parts.d).padStart(2, '0');
}

function isPatio(name: string): boolean {
  const alias = plugAlias(name);
  return alias?.order === 0 || name.trim() === 'Patio Lights';
}

function isLivingRoom(name: string): boolean {
  const alias = plugAlias(name);
  return alias?.order === 1 || alias?.order === 2 || name.trim() === 'Living Room Rear' || name.trim() === 'Living Room Left';
}

export function planLightAutomations(input: {
  nowMs: number;
  lat: number;
  lon: number;
  lights: AutoLight[];
  lastPatioDate: string | null;
  lastMidnightDate: string | null;
}): LightPlan {
  const parts = partsInZone(input.nowMs, PHOENIX);
  const date = dateKey(parts);
  const minutes = parts.h * 60 + parts.mi;
  const sunsetMinutes = phoenixSunsetMinutes(parts.y, parts.m, parts.d, input.lat, input.lon);
  const runPatio = minutes >= sunsetMinutes && input.lastPatioDate !== date;
  const runMidnight = minutes < MIDNIGHT_WINDOW_MINUTES && input.lastMidnightDate !== date;
  const patioOn = runPatio
    ? input.lights.filter((light) => isPatio(light.name) && light.online && light.code && light.on !== true).map((light) => light.id)
    : [];
  const livingRoomOff = runMidnight
    ? input.lights.filter((light) => isLivingRoom(light.name) && light.online && light.code && light.on === true).map((light) => light.id)
    : [];
  return {
    date,
    minutes,
    sunsetMinutes,
    sunsetLabel: formatMinutes(sunsetMinutes),
    runPatio,
    runMidnight,
    patioOn,
    livingRoomOff
  };
}

function formatMinutes(minutes: number): string {
  const hour24 = Math.floor(minutes / 60) % 24;
  const minute = minutes % 60;
  const ap = hour24 >= 12 ? 'PM' : 'AM';
  const hour = hour24 % 12 || 12;
  return hour + ':' + String(minute).padStart(2, '0') + ' ' + ap;
}

export function scheduleHint(sunsetLabel: string): string {
  return 'Patio on at sunset ' + sunsetLabel + ' / LR off at 12 AM';
}
