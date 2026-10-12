import { qAll, qOne, qRun } from './db';
import { HttpError, nowIso } from './util';

export const OVERLAY_TEMPLATES = ['lower-third', 'corner-bug'] as const;
export type OverlayTemplate = typeof OVERLAY_TEMPLATES[number];

const PRESETS: Record<string, { x: number; y: number }> = {
  'top-left': { x: 3, y: 4 },
  'top-right': { x: 68, y: 4 },
  'bottom-left': { x: 3, y: 72 },
  'bottom-center': { x: 28, y: 76 },
  'bottom-right': { x: 68, y: 72 }
};

export const TEMPLATE_LAYOUTS: Record<OverlayTemplate, {
  label: string;
  shows: Record<string, boolean>;
  positions: Record<string, { preset: string; x: number; y: number }>;
}> = {
  'lower-third': {
    label: 'Broadcast lower-third',
    shows: { logo: true, name: true, hole: true, par: true, yardage: true, sponsor: false, ticker: true },
    positions: {
      logo: { preset: 'bottom-left', ...PRESETS['bottom-left'] },
      name: { preset: 'bottom-left', x: 16, y: 70 },
      hole: { preset: 'bottom-left', x: 16, y: 82 },
      sponsor: { preset: 'bottom-right', ...PRESETS['bottom-right'] },
      ticker: { preset: 'bottom-center', x: 3, y: 92 }
    }
  },
  'corner-bug': {
    label: 'Minimal corner bug',
    shows: { logo: true, name: false, hole: true, par: true, yardage: true, sponsor: false, ticker: false },
    positions: {
      logo: { preset: 'top-left', ...PRESETS['top-left'] },
      name: { preset: 'top-left', x: 14, y: 5 },
      hole: { preset: 'top-left', x: 3, y: 16 },
      sponsor: { preset: 'top-right', ...PRESETS['top-right'] },
      ticker: { preset: 'bottom-center', x: 3, y: 90 }
    }
  }
};

const ELEMENTS = ['logo', 'name', 'hole', 'sponsor', 'ticker'] as const;
const TEES = ['black', 'blue', 'white', 'red'] as const;

type HoleInput = {
  hole_number: number;
  par: number | null;
  yardage: Record<string, number>;
  image_url: string | null;
  template: OverlayTemplate | null;
};

type OverlayRow = {
  course_id: number;
  template: string;
  theme_json: string;
  positions_json: string;
  show_logo: number;
  show_name: number;
  show_hole: number;
  show_par: number;
  show_yardage: number;
  show_sponsor: number;
  show_ticker: number;
  opacity: number;
  sponsor_logo: string | null;
  ticker_text: string | null;
  current_hole: number;
  viewer_enabled: number;
  updated_at: string;
};

function asTemplate(value: unknown): OverlayTemplate {
  const raw = String(value || '').trim();
  if ((OVERLAY_TEMPLATES as readonly string[]).includes(raw)) return raw as OverlayTemplate;
  throw new HttpError(400, 'Overlay template must be the broadcast lower-third or the minimal corner bug');
}

function clampPercent(value: unknown, fallback: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(0, Math.round(n * 10) / 10));
}

function cleanColor(value: unknown, fallback: string) {
  const raw = String(value || '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw;
  return fallback;
}

function cleanUrl(value: unknown) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (raw.length > 300) throw new HttpError(400, 'Image address is too long');
  if (/^(javascript|data):/i.test(raw)) throw new HttpError(400, 'That image address is not allowed');
  return raw;
}

function positionsFrom(input: unknown, template: OverlayTemplate) {
  const defaults = TEMPLATE_LAYOUTS[template].positions;
  const source = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const next: Record<string, { preset: string; x: number; y: number }> = {};
  for (const element of ELEMENTS) {
    const raw = source[element];
    const presetName = raw && typeof raw === 'object' ? String((raw as { preset?: string }).preset || '') : '';
    const preset = PRESETS[presetName];
    const fallback = defaults[element];
    if (preset && presetName !== 'custom') {
      next[element] = { preset: presetName, ...preset };
    } else if (raw && typeof raw === 'object') {
      next[element] = {
        preset: 'custom',
        x: clampPercent((raw as { x?: number }).x, fallback.x),
        y: clampPercent((raw as { y?: number }).y, fallback.y)
      };
    } else {
      next[element] = { ...fallback };
    }
  }
  return next;
}

function holesFrom(input: unknown, fallbackTemplate: OverlayTemplate): HoleInput[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<number>();
  const holes: HoleInput[] = [];
  for (const item of input.slice(0, 18)) {
    if (!item || typeof item !== 'object') continue;
    const holeNumber = Number((item as { hole_number?: number }).hole_number);
    if (!Number.isInteger(holeNumber) || holeNumber < 1 || holeNumber > 18 || seen.has(holeNumber)) continue;
    seen.add(holeNumber);
    const parRaw = Number((item as { par?: number }).par);
    const par = Number.isInteger(parRaw) && parRaw >= 3 && parRaw <= 6 ? parRaw : null;
    const yardageIn = (item as { yardage?: Record<string, unknown> }).yardage || {};
    const yardage: Record<string, number> = {};
    for (const tee of TEES) {
      const yards = Number(yardageIn[tee]);
      if (Number.isFinite(yards) && yards >= 50 && yards <= 800) yardage[tee] = Math.round(yards);
    }
    let template: OverlayTemplate | null = null;
    const templateRaw = (item as { template?: string }).template;
    if (templateRaw) template = asTemplate(templateRaw);
    holes.push({
      hole_number: holeNumber,
      par,
      yardage,
      image_url: cleanUrl((item as { image_url?: string }).image_url),
      template: template || fallbackTemplate
    });
  }
  return holes.sort((a, b) => a.hole_number - b.hole_number);
}

function flag(value: unknown, fallback: boolean) {
  if (value === undefined || value === null) return fallback ? 1 : 0;
  return value === true || value === 1 || value === '1' ? 1 : 0;
}

export function serializeOverlay(row: OverlayRow, holes: Array<Record<string, unknown>>) {
  const template = (OVERLAY_TEMPLATES as readonly string[]).includes(row.template) ? row.template : 'lower-third';
  let theme: Record<string, string> = {};
  let positions: Record<string, unknown> = {};
  try { theme = JSON.parse(row.theme_json || '{}'); } catch { theme = {}; }
  try { positions = JSON.parse(row.positions_json || '{}'); } catch { positions = {}; }
  return {
    template,
    theme: {
      background: cleanColor(theme.background, '#111318'),
      text: cleanColor(theme.text, '#f7f2ea'),
      accent: cleanColor(theme.accent, '#ff4d18')
    },
    positions,
    show_logo: Boolean(row.show_logo),
    show_name: Boolean(row.show_name),
    show_hole: Boolean(row.show_hole),
    show_par: Boolean(row.show_par),
    show_yardage: Boolean(row.show_yardage),
    show_sponsor: Boolean(row.show_sponsor),
    show_ticker: Boolean(row.show_ticker),
    opacity: Number(row.opacity) || 0.94,
    sponsor_logo: row.sponsor_logo,
    ticker_text: row.ticker_text || '',
    current_hole: row.current_hole || 1,
    viewer_enabled: Boolean(row.viewer_enabled),
    holes: holes.map((hole) => {
      let yardage = {};
      try { yardage = JSON.parse(String(hole.yardage_json || '{}')); } catch { yardage = {}; }
      return {
        hole_number: hole.hole_number,
        par: hole.par,
        yardage,
        image_url: hole.image_url || null,
        template: hole.template || template
      };
    })
  };
}

export async function readOverlay(db: D1Database, courseId: number) {
  const row = await qOne<OverlayRow>(db, 'SELECT * FROM course_overlays WHERE course_id = ?', courseId);
  if (!row) return null;
  const holes = await qAll<Record<string, unknown>>(
    db,
    'SELECT hole_number, par, yardage_json, image_url, template FROM course_holes WHERE course_id = ? ORDER BY hole_number',
    courseId
  );
  return serializeOverlay(row, holes);
}

export async function saveOverlay(db: D1Database, courseId: number, body: Record<string, unknown>) {
  const template = asTemplate(body.template || 'lower-third');
  const layout = TEMPLATE_LAYOUTS[template];
  const positions = positionsFrom(body.positions, template);
  const theme = {
    background: cleanColor((body.theme as { background?: string } | undefined)?.background, '#111318'),
    text: cleanColor((body.theme as { text?: string } | undefined)?.text, '#f7f2ea'),
    accent: cleanColor((body.theme as { accent?: string } | undefined)?.accent, '#ff4d18')
  };
  const opacityRaw = Number(body.opacity);
  const opacity = Number.isFinite(opacityRaw) ? Math.min(1, Math.max(0.35, opacityRaw)) : 0.94;
  const ticker = String(body.ticker_text || '').trim().slice(0, 180);
  const currentHole = Math.min(18, Math.max(1, parseInt(String(body.current_hole || 1), 10) || 1));
  const now = nowIso();
  await qRun(
    db,
    `INSERT INTO course_overlays (
      course_id, template, theme_json, positions_json, show_logo, show_name, show_hole, show_par,
      show_yardage, show_sponsor, show_ticker, opacity, sponsor_logo, ticker_text, current_hole, viewer_enabled, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(course_id) DO UPDATE SET
      template = excluded.template,
      theme_json = excluded.theme_json,
      positions_json = excluded.positions_json,
      show_logo = excluded.show_logo,
      show_name = excluded.show_name,
      show_hole = excluded.show_hole,
      show_par = excluded.show_par,
      show_yardage = excluded.show_yardage,
      show_sponsor = excluded.show_sponsor,
      show_ticker = excluded.show_ticker,
      opacity = excluded.opacity,
      sponsor_logo = excluded.sponsor_logo,
      ticker_text = excluded.ticker_text,
      current_hole = excluded.current_hole,
      viewer_enabled = excluded.viewer_enabled,
      updated_at = excluded.updated_at`,
    courseId,
    template,
    JSON.stringify(theme),
    JSON.stringify(positions),
    flag(body.show_logo, layout.shows.logo),
    flag(body.show_name, layout.shows.name),
    flag(body.show_hole, layout.shows.hole),
    flag(body.show_par, layout.shows.par),
    flag(body.show_yardage, layout.shows.yardage),
    flag(body.show_sponsor, layout.shows.sponsor),
    flag(body.show_ticker, layout.shows.ticker),
    opacity,
    cleanUrl(body.sponsor_logo),
    ticker,
    currentHole,
    flag(body.viewer_enabled, true),
    now
  );

  const holes = holesFrom(body.holes, template);
  if (holes.length) {
    await qRun(db, 'DELETE FROM course_holes WHERE course_id = ?', courseId);
    for (const hole of holes) {
      await qRun(
        db,
        `INSERT INTO course_holes (course_id, hole_number, par, yardage_json, image_url, template)
         VALUES (?, ?, ?, ?, ?, ?)`,
        courseId,
        hole.hole_number,
        hole.par,
        JSON.stringify(hole.yardage),
        hole.image_url,
        hole.template
      );
    }
  }
  const saved = await readOverlay(db, courseId);
  if (!saved) throw new Error('Overlay save failed');
  return saved;
}

export async function setSponsorLogo(db: D1Database, courseId: number, logo: string) {
  const existing = await readOverlay(db, courseId);
  if (!existing) {
    await saveOverlay(db, courseId, { template: 'lower-third', sponsor_logo: logo, show_sponsor: true });
    return;
  }
  await qRun(
    db,
    'UPDATE course_overlays SET sponsor_logo = ?, show_sponsor = 1, updated_at = ? WHERE course_id = ?',
    logo,
    nowIso(),
    courseId
  );
}
