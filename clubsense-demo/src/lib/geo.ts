import type { LatLon } from "../data/types";

const YARDS_PER_M = 1.0936133;

export function haversineYards(a: LatLon, b: LatLon): number {
  const lat1 = (a[0] * Math.PI) / 180;
  const lat2 = (b[0] * Math.PI) / 180;
  const dlat = lat2 - lat1;
  const dlon = ((b[1] - a[1]) * Math.PI) / 180;
  const h =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dlon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h))) * YARDS_PER_M;
}

function toLocal(p: LatLon, origin: LatLon): [number, number] {
  const lat0 = (origin[0] * Math.PI) / 180;
  const y = (p[0] - origin[0]) * 111320;
  const x = (p[1] - origin[1]) * 111320 * Math.cos(lat0);
  return [x, y];
}

export type GreenDepths = {
  /** Yards from the player to the near edge of the green along the line to the pin. */
  front: number;
  /** Yards from the player to the pin. */
  middle: number;
  /** Yards from the player to the far edge of the green. */
  back: number;
};

/**
 * Front, middle, and back of the green from a playing position.
 * Middle is the pin. Front and back are the green ring projected onto that line.
 */
export function greenDepths(from: LatLon, pin: LatLon, ring: LatLon[]): GreenDepths {
  const [fx, fy] = toLocal(from, pin);
  let dx = -fx;
  let dy = -fy;
  let len = Math.hypot(dx, dy);
  if (len < 0.5) {
    dx = 0;
    dy = 1;
    len = 1;
  }
  const ux = dx / len;
  const uy = dy / len;
  let min = Infinity;
  let max = -Infinity;
  for (const point of ring) {
    const [x, y] = toLocal(point, pin);
    const along = (x - fx) * ux + (y - fy) * uy;
    if (along < min) min = along;
    if (along > max) max = along;
  }
  return {
    front: min * YARDS_PER_M,
    middle: len * YARDS_PER_M,
    back: max * YARDS_PER_M,
  };
}

/** Walk `yards` from the start of a line and return the point there. */
export function pointAlong(line: LatLon[], yards: number): LatLon {
  if (line.length === 0) return [0, 0];
  if (line.length === 1 || yards <= 0) return line[0];
  let prev = line[0];
  let left = yards;
  for (let i = 1; i < line.length; i++) {
    const step = haversineYards(prev, line[i]);
    if (step >= left) {
      const t = step === 0 ? 0 : left / step;
      return [
        prev[0] + (line[i][0] - prev[0]) * t,
        prev[1] + (line[i][1] - prev[1]) * t,
      ];
    }
    left -= step;
    prev = line[i];
  }
  return line[line.length - 1];
}

export function holeShape(turn: number): string {
  if (Math.abs(turn) < 12) return "straight";
  return turn > 0 ? "dogleg right" : "dogleg left";
}
