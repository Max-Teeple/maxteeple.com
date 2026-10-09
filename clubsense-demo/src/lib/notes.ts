const KEY = "clubsense-demo-notes-v1";

/** Prefilled caddie notes. Visitors can overwrite them; the browser keeps the edit. */
export const SAMPLE_NOTES: Record<number, string> = {
  1: "The hole moves right. Driver in these demo rounds finishes right of the aim line, so start it up the left-center and let the fade come back.",
  3: "One shot, about 200 to the pin, one bunker. The demo 5-iron is the club. Aim at the middle of the green.",
  7: "Handicap 1, and it bends right. Take one more club than the number. Short is the miss that shows up in the iron plots.",
  12: "Five hundred yards, straight, handicap 2. Driver still leaves a wood. The safe miss is short of the green, not past it.",
  13: "Bends left. The demo plan is driver, then a full iron that leaves a wedge. Don't chase the green in two.",
  18: "Closing par 5, with water on the hole. Lay up to a full wedge and stay short of the trouble.",
};

export function readOverrides(): Record<string, string> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const overrides: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") overrides[key] = value;
    }
    return overrides;
  } catch {
    return {};
  }
}

export function writeOverrides(overrides: Record<string, string>) {
  localStorage.setItem(KEY, JSON.stringify(overrides));
}

export function clearOverrides() {
  localStorage.removeItem(KEY);
}

export function noteFor(hole: number, overrides: Record<string, string>): string {
  const key = String(hole);
  if (Object.prototype.hasOwnProperty.call(overrides, key)) return overrides[key];
  return SAMPLE_NOTES[hole] ?? "";
}

export function noteIsSample(hole: number, overrides: Record<string, string>): boolean {
  return !Object.prototype.hasOwnProperty.call(overrides, String(hole)) && Boolean(SAMPLE_NOTES[hole]);
}
