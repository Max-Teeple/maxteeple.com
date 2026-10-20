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
  runEvening: boolean;
  runMorning: boolean;
  patioOn: string[];
  eveningOff: string[];
  morningOn: string[];
};

const WINDOW_MINUTES = 15;
const EVENING_MINUTES = 21 * 60;
const MORNING_MINUTES = 6 * 60;

function dateKey(parts: { y: number; m: number; d: number }): string {
  return parts.y + '-' + String(parts.m).padStart(2, '0') + '-' + String(parts.d).padStart(2, '0');
}

function inWindow(minutes: number, start: number): boolean {
  return minutes >= start && minutes < start + WINDOW_MINUTES;
}

function isPatio(name: string): boolean {
  const alias = plugAlias(name);
  return alias?.order === 0 || name.trim() === 'Patio Lights';
}

function isLivingRoom(name: string): boolean {
  const alias = plugAlias(name);
  return alias?.order === 1 || alias?.order === 2 || name.trim() === 'Living Room Rear' || name.trim() === 'Living Room Left';
}

function isKnownPlug(name: string): boolean {
  return isPatio(name) || isLivingRoom(name);
}

export function planLightAutomations(input: {
  nowMs: number;
  lat: number;
  lon: number;
  lights: AutoLight[];
  lastPatioDate: string | null;
  lastEveningDate: string | null;
  lastMorningDate: string | null;
}): LightPlan {
  const parts = partsInZone(input.nowMs, PHOENIX);
  const date = dateKey(parts);
  const minutes = parts.h * 60 + parts.mi;
  const sunsetMinutes = phoenixSunsetMinutes(parts.y, parts.m, parts.d, input.lat, input.lon);
  const runPatio = minutes >= sunsetMinutes && input.lastPatioDate !== date;
  const runEvening = inWindow(minutes, EVENING_MINUTES) && input.lastEveningDate !== date;
  const runMorning = inWindow(minutes, MORNING_MINUTES) && input.lastMorningDate !== date;
  const ready = (light: AutoLight) => light.online && !!light.code;
  const patioOn = runPatio
    ? input.lights.filter((light) => isPatio(light.name) && ready(light) && light.on !== true).map((light) => light.id)
    : [];
  const eveningOff = runEvening
    ? input.lights.filter((light) => isKnownPlug(light.name) && ready(light) && light.on === true).map((light) => light.id)
    : [];
  const morningOn = runMorning
    ? input.lights.filter((light) => isLivingRoom(light.name) && ready(light) && light.on !== true).map((light) => light.id)
    : [];
  return {
    date,
    minutes,
    sunsetMinutes,
    sunsetLabel: formatMinutes(sunsetMinutes),
    runPatio,
    runEvening,
    runMorning,
    patioOn,
    eveningOff,
    morningOn
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
  return 'Patio on at sunset ' + sunsetLabel + ' · All off 9 PM ·\u00a0LR\u00a0on\u00a06\u00a0AM';
}
