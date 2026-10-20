import { ensureSchema } from '../schema';
import type { Bindings } from '../types';
import { planLightAutomations, scheduleHint, type AutoLight } from './light-automation';
import { listLights, setLight, type LightDevice, type TuyaCreds } from './tuya';

type LightIo = {
  listLights: (creds: TuyaCreds, db: D1Database) => Promise<LightDevice[]>;
  setLight: (creds: TuyaCreds, db: D1Database, deviceId: string, on: boolean) => Promise<void>;
};

const PHOENIX_LAT = 33.4484;
const PHOENIX_LON = -112.074;

async function lastRun(db: D1Database, id: string): Promise<string | null> {
  const row = await db.prepare(`SELECT last_date FROM glance_light_runs WHERE id = ?`).bind(id).first<{ last_date: string }>();
  return row?.last_date || null;
}

async function markRun(db: D1Database, id: string, date: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO glance_light_runs (id, last_date, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET last_date = excluded.last_date, updated_at = excluded.updated_at`
    )
    .bind(id, date, new Date().toISOString())
    .run();
}

async function logAction(db: D1Database, action: string, detail: string): Promise<void> {
  await db
    .prepare(`INSERT INTO glance_light_log (ran_at, action, detail) VALUES (?, ?, ?)`)
    .bind(new Date().toISOString(), action, detail.slice(0, 180))
    .run();
}

export async function runScheduledLights(env: Bindings, nowMs = Date.now(), io: LightIo = { listLights, setLight }): Promise<void> {
  await ensureSchema(env.LIVEVIEW_DB);
  const db = env.LIVEVIEW_DB;
  const settings = await db
    .prepare(`SELECT lat, lon, tuya_access_id, tuya_access_secret FROM glance_settings WHERE id = 'default'`)
    .first<{ lat: number; lon: number; tuya_access_id: string; tuya_access_secret: string }>();
  if (!settings?.tuya_access_id || !settings.tuya_access_secret) return;
  const lastPatioDate = await lastRun(db, 'patio-sunset');
  const lastEveningDate = await lastRun(db, 'all-off-9pm');
  const lastMorningDate = await lastRun(db, 'lr-on-6am');
  const due = planLightAutomations({
    nowMs,
    lat: Number.isFinite(settings.lat) ? settings.lat : PHOENIX_LAT,
    lon: Number.isFinite(settings.lon) ? settings.lon : PHOENIX_LON,
    lights: [],
    lastPatioDate,
    lastEveningDate,
    lastMorningDate
  });
  // Stay off Tuya unless a schedule is actually due. A 5-minute poll was
  // racing the board's status read and caching a rejected token.
  if (!due.runPatio && !due.runEvening && !due.runMorning) return;
  let lights: AutoLight[] = [];
  try {
    lights = await io.listLights(
      { accessId: settings.tuya_access_id, accessSecret: settings.tuya_access_secret },
      db
    );
  } catch (error) {
    await logAction(db, 'lights-read-failed', error instanceof Error ? error.message : 'error');
    return;
  }
  const plan = planLightAutomations({
    nowMs,
    lat: Number.isFinite(settings.lat) ? settings.lat : PHOENIX_LAT,
    lon: Number.isFinite(settings.lon) ? settings.lon : PHOENIX_LON,
    lights,
    lastPatioDate,
    lastEveningDate,
    lastMorningDate
  });
  if (plan.runPatio) {
    let ok = true;
    if (!plan.patioOn.length) await logAction(db, 'patio-on', 'already on or offline');
    for (const id of plan.patioOn) {
      try {
        await io.setLight({ accessId: settings.tuya_access_id, accessSecret: settings.tuya_access_secret }, db, id, true);
        await logAction(db, 'patio-on', id);
      } catch (error) {
        ok = false;
        await logAction(db, 'patio-on-failed', error instanceof Error ? error.message : 'error');
      }
    }
    if (ok) await markRun(db, 'patio-sunset', plan.date);
  }
  if (plan.runEvening) {
    let ok = true;
    if (!plan.eveningOff.length) await logAction(db, 'all-off', 'already off or offline');
    for (const id of plan.eveningOff) {
      try {
        await io.setLight({ accessId: settings.tuya_access_id, accessSecret: settings.tuya_access_secret }, db, id, false);
        await logAction(db, 'all-off', id);
      } catch (error) {
        ok = false;
        await logAction(db, 'all-off-failed', error instanceof Error ? error.message : 'error');
      }
    }
    if (ok) await markRun(db, 'all-off-9pm', plan.date);
  }
  if (plan.runMorning) {
    let ok = true;
    if (!plan.morningOn.length) await logAction(db, 'lr-on', 'already on or offline');
    for (const id of plan.morningOn) {
      try {
        await io.setLight({ accessId: settings.tuya_access_id, accessSecret: settings.tuya_access_secret }, db, id, true);
        await logAction(db, 'lr-on', id);
      } catch (error) {
        ok = false;
        await logAction(db, 'lr-on-failed', error instanceof Error ? error.message : 'error');
      }
    }
    if (ok) await markRun(db, 'lr-on-6am', plan.date);
  }
}

export { scheduleHint };
