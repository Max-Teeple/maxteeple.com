import type { Club, Round, Shot } from "../data/types";
import { biasLabel, mean, median, sampleStd, toParLabel, trimmedMean } from "./format";

/** Chi-square critical value for 90% of a bivariate normal (df = 2). */
export const CHI2_90 = 4.605170185988092;

export type Ellipse = {
  cx: number;
  cy: number;
  /** Semi-axis along `angle`, in yards. */
  rx: number;
  ry: number;
  /** Radians, counter-clockwise from +lateral toward +carry. */
  angle: number;
};

export function ellipseFromCovariance(sxx: number, syy: number, sxy: number): Ellipse | null {
  if (![sxx, syy, sxy].every(Number.isFinite)) return null;
  const trace = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const disc = Math.sqrt(Math.max(0, trace * trace / 4 - det));
  const l1 = trace / 2 + disc;
  const l2 = Math.max(0, trace / 2 - disc);
  if (l1 <= 0) return null;
  let angle: number;
  if (Math.abs(sxy) < 1e-9) {
    angle = sxx >= syy ? 0 : Math.PI / 2;
  } else {
    angle = Math.atan2(l1 - sxx, sxy);
  }
  return {
    cx: 0,
    cy: 0,
    rx: Math.sqrt(l1 * CHI2_90),
    ry: Math.sqrt(l2 * CHI2_90),
    angle,
  };
}

/** 90% dispersion ellipse. x is lateral (right positive), y is carry. */
export function fitEllipse(points: { x: number; y: number }[]): Ellipse | null {
  if (points.length < 8) return null;
  const cx = mean(points.map((point) => point.x));
  const cy = mean(points.map((point) => point.y));
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const point of points) {
    const dx = point.x - cx;
    const dy = point.y - cy;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  const n = points.length - 1;
  const ellipse = ellipseFromCovariance(sxx / n, syy / n, sxy / n);
  if (!ellipse) return null;
  return { ...ellipse, cx, cy };
}

export function ellipsePath(ellipse: Ellipse, steps = 72): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  const cos = Math.cos(ellipse.angle);
  const sin = Math.sin(ellipse.angle);
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const ex = ellipse.rx * Math.cos(t);
    const ey = ellipse.ry * Math.sin(t);
    points.push({
      x: ellipse.cx + ex * cos - ey * sin,
      y: ellipse.cy + ex * sin + ey * cos,
    });
  }
  return points;
}

export type ClubSummary = {
  club: Club;
  shots: Shot[];
  count: number;
  putts: number;
  average: number;
  median: number;
  longest: number;
  stdev: number;
  bias: number;
  trend: number;
  trimmed: number;
  ellipse: Ellipse | null;
};

export type BagGap = {
  longer: Club;
  shorter: Club;
  yards: number;
};

export type DemoSummary = {
  clubStats: ClubSummary[];
  byId: Record<string, ClubSummary>;
  fullShots: number;
  putts: number;
  avgScore: number;
  avgToPar: number;
  longestDrive: number;
  fairwayPct: number | null;
  girPct: number;
  gaps: BagGap[];
  insights: string[];
};

function trendAcrossRounds(shots: Shot[], rounds: Round[]): number {
  const averages: number[] = [];
  for (const round of rounds) {
    const carries = shots.filter((shot) => shot.roundId === round.id).map((shot) => shot.carry);
    if (carries.length > 0) averages.push(mean(carries));
  }
  if (averages.length < 4) return 0;
  const take = Math.min(5, Math.floor(averages.length / 2));
  return mean(averages.slice(-take)) - mean(averages.slice(0, take));
}

export function summarize(clubs: Club[], rounds: Round[]): DemoSummary {
  const clubStats: ClubSummary[] = clubs.map((club) => {
    const all = rounds.flatMap((round) => round.shots.filter((shot) => shot.clubId === club.id));
    const shots = all.filter((shot) => shot.full);
    const carries = shots.map((shot) => shot.carry);
    const laterals = shots.map((shot) => shot.lateral);
    return {
      club,
      shots,
      count: shots.length,
      putts: all.filter((shot) => shot.kind === "putt").length,
      average: mean(carries),
      median: median(carries),
      longest: carries.length ? Math.max(...carries) : 0,
      stdev: sampleStd(carries),
      bias: mean(laterals),
      trend: trendAcrossRounds(shots, rounds),
      trimmed: trimmedMean(carries),
      ellipse: fitEllipse(shots.map((shot) => ({ x: shot.lateral, y: shot.carry }))),
    };
  });
  const byId = Object.fromEntries(clubStats.map((stat) => [stat.club.id, stat]));
  const full = clubStats.filter((stat) => stat.club.id !== "pu" && stat.count > 0);
  const gaps: BagGap[] = [];
  for (let i = 0; i < full.length - 1; i++) {
    gaps.push({
      longer: full[i].club,
      shorter: full[i + 1].club,
      yards: full[i].average - full[i + 1].average,
    });
  }

  const scores = rounds.map((round) => round.score);
  const toPars = rounds.map((round) => round.score - round.par);
  const fairwayHoles = rounds.flatMap((round) => round.holes.filter((hole) => hole.fairway !== null));
  const fairwayHits = fairwayHoles.filter((hole) => hole.fairway).length;
  const girHits = rounds.reduce(
    (total, round) => total + round.holes.filter((hole) => hole.gir).length,
    0,
  );
  const girChances = rounds.reduce((total, round) => total + round.holes.length, 0);
  const driver = byId.dr;
  const summary: DemoSummary = {
    clubStats,
    byId,
    fullShots: full.reduce((total, stat) => total + stat.count, 0),
    putts: byId.pu?.putts ?? 0,
    avgScore: mean(scores),
    avgToPar: mean(toPars),
    longestDrive: driver?.longest ?? 0,
    fairwayPct: fairwayHoles.length ? (100 * fairwayHits) / fairwayHoles.length : null,
    girPct: girChances ? (100 * girHits) / girChances : 0,
    gaps,
    insights: [],
  };
  summary.insights = buildInsights(summary, rounds.length);
  return summary;
}

function buildInsights(summary: DemoSummary, rounds: number): string[] {
  const insights: string[] = [];
  const fairway =
    summary.fairwayPct === null ? "" : ` Fairways ${Math.round(summary.fairwayPct)}%.`;
  const puttsPerRound = rounds === 0 ? 0 : summary.putts / rounds;
  insights.push(
    `${rounds} demo rounds average ${summary.avgScore.toFixed(1)} (${toParLabel(summary.avgToPar)}). ${summary.fullShots} full swings.${fairway} Greens in regulation ${Math.round(summary.girPct)}%. Putting averages ${puttsPerRound.toFixed(0)} a round.`,
  );

  const biased = summary.clubStats
    .filter((stat) => stat.count >= 12)
    .sort((a, b) => Math.abs(b.bias) * Math.sqrt(b.count) - Math.abs(a.bias) * Math.sqrt(a.count))[0];
  if (biased) {
    insights.push(
      `${biased.club.label} finishes ${biasLabel(biased.bias)} of the aim line across ${biased.count} full swings. The gold line on the dispersion plot is where those shots were aimed.`,
    );
  }

  const driver = summary.byId.dr;
  if (driver && Math.abs(driver.trend) >= 1.5) {
    const direction = driver.trend > 0 ? "up" : "down";
    insights.push(
      `Driver carry is ${direction} ${Math.abs(driver.trend).toFixed(1)} yards from the first five rounds to the last five.`,
    );
  }

  const tight = summary.clubStats
    .filter((stat) => stat.count >= 12 && (stat.club.group === "Irons" || stat.club.group === "Wedges"))
    .sort((a, b) => a.stdev - b.stdev)[0];
  if (tight) {
    insights.push(
      `${tight.club.label} is the tightest full swing in the bag, ±${tight.stdev.toFixed(1)} yards of carry over ${tight.count} shots.`,
    );
  }

  const gap = [...summary.gaps].sort((a, b) => b.yards - a.yards)[0];
  if (gap && gap.yards >= 14) {
    insights.push(
      `${gap.longer.short} to ${gap.shorter.short} is a ${gap.yards.toFixed(0)} yard gap, the widest step in the demo bag.`,
    );
  }

  return insights.slice(0, 5);
}

export function suggestClub(stats: ClubSummary[], yards: number): ClubSummary | null {
  const candidates = stats.filter((stat) => stat.club.id !== "pu" && stat.count >= 5);
  if (candidates.length === 0 || yards <= 0) return null;
  let best = candidates[0];
  let bestScore = Infinity;
  for (const stat of candidates) {
    const plays = stat.trimmed || stat.club.avg;
    const over = plays - yards;
    let score = Math.abs(plays - yards);
    if (over > 12) score += (over - 12) * 1.5;
    if (stat.club.id === "dr" && yards < 230) score += 80;
    if (score < bestScore) {
      best = stat;
      bestScore = score;
    }
  }
  return best;
}
