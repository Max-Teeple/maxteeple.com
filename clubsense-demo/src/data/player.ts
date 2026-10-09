import courseJson from "./torrey-pines-south.json";
import type { Club, Course, Round, RoundHole, Shot } from "./types";
import { summarize, type DemoSummary } from "../lib/stats";

export const course = courseJson as Course;

export const PLAYER = {
  name: "Jordan Hale",
  role: "Demo player",
  home: "La Jolla, California",
};

export const CLUBS: Club[] = [
  { id: "dr", label: "Driver", short: "Dr", group: "Woods", avg: 262, std: 10.5, bias: 6.2, latStd: 15.5, draw: -0.03, trend: 4.6 },
  { id: "3w", label: "3 Wood", short: "3W", group: "Woods", avg: 238, std: 8.4, bias: 2.4, latStd: 11.5, draw: -0.03, trend: 1.6 },
  { id: "5w", label: "5 Wood", short: "5W", group: "Woods", avg: 223, std: 7.4, bias: 1.2, latStd: 9.4, draw: -0.02, trend: 1 },
  { id: "4i", label: "4 Iron", short: "4i", group: "Irons", avg: 206, std: 6.6, bias: -4.6, latStd: 8.6, draw: -0.04, trend: 1.2 },
  { id: "5i", label: "5 Iron", short: "5i", group: "Irons", avg: 194, std: 6, bias: -3.4, latStd: 7.6, draw: -0.03, trend: 0.8 },
  { id: "6i", label: "6 Iron", short: "6i", group: "Irons", avg: 181, std: 5.4, bias: -2.4, latStd: 6.8, draw: -0.03, trend: 0.6 },
  { id: "7i", label: "7 Iron", short: "7i", group: "Irons", avg: 169, std: 5, bias: -1.1, latStd: 6.2, draw: -0.02, trend: 0.4 },
  { id: "8i", label: "8 Iron", short: "8i", group: "Irons", avg: 156, std: 4.6, bias: 0.5, latStd: 5.6, draw: -0.01, trend: 0.2 },
  { id: "9i", label: "9 Iron", short: "9i", group: "Irons", avg: 143, std: 4.4, bias: 1.7, latStd: 5.4, draw: 0.01, trend: 0 },
  { id: "pw", label: "Pitching Wedge", short: "PW", group: "Wedges", avg: 130, std: 4.2, bias: 2.8, latStd: 5.4, draw: 0.02, trend: -0.5 },
  { id: "gw", label: "Gap Wedge", short: "GW", group: "Wedges", avg: 115, std: 4.6, bias: -2.8, latStd: 5.8, draw: 0.02, trend: -0.6 },
  { id: "sw", label: "Sand Wedge", short: "SW", group: "Wedges", avg: 100, std: 5, bias: -1.6, latStd: 6.4, draw: 0.01, trend: -0.3 },
  { id: "lw", label: "Lob Wedge", short: "LW", group: "Wedges", avg: 82, std: 5.4, bias: 1.6, latStd: 6.8, draw: 0, trend: 0 },
  { id: "pu", label: "Putter", short: "Pu", group: "Putter", avg: 0, std: 0, bias: 0, latStd: 0, draw: 0, trend: 0 },
];

const clubById = Object.fromEntries(CLUBS.map((club) => [club.id, club]));

const AVIARA: { par: number; yards: number }[] = [
  { par: 4, yards: 392 },
  { par: 5, yards: 528 },
  { par: 3, yards: 171 },
  { par: 4, yards: 418 },
  { par: 4, yards: 356 },
  { par: 4, yards: 441 },
  { par: 3, yards: 188 },
  { par: 5, yards: 541 },
  { par: 4, yards: 374 },
  { par: 4, yards: 407 },
  { par: 3, yards: 154 },
  { par: 4, yards: 389 },
  { par: 5, yards: 552 },
  { par: 4, yards: 363 },
  { par: 4, yards: 429 },
  { par: 3, yards: 201 },
  { par: 4, yards: 398 },
  { par: 5, yards: 519 },
];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function clubFor(distance: number): Club {
  const usable = CLUBS.filter((club) => club.id !== "pu" && club.id !== "dr");
  let best = usable[0];
  let bestScore = Infinity;
  for (const club of usable) {
    const diff = club.avg - distance;
    let score = Math.abs(diff);
    if (diff > 14) score += (diff - 14) * 1.5;
    if (club.group === "Woods" && distance < 205) score += 36;
    if (score < bestScore) {
      best = club;
      bestScore = score;
    }
  }
  return best;
}

/** A full swing that leaves a wedge, so long irons actually show up in the bag. */
function layupClub(remaining: number, rng: () => number): Club | null {
  const options = CLUBS.filter((club) => {
    if (club.id === "pu" || club.id === "dr") return false;
    const leave = remaining - club.avg;
    return leave >= 72 && leave <= 140;
  });
  if (options.length === 0) return null;
  return options[Math.floor(rng() * options.length)];
}

function neighborClub(club: Club, direction: -1 | 1): Club | null {
  const index = CLUBS.findIndex((item) => item.id === club.id);
  const next = CLUBS[index + direction];
  if (!next || next.id === "pu" || next.id === "dr") return null;
  return next;
}

type Day = { noise: number; carry: number; mishit: number };

const DAY_TILT = [0.3, -0.5, 0.9, -1.2, 0.15, 0.45, -0.25, 1.15, -0.85, 0.35, -0.55, 0.7, -1.35, 0.95, 0.05, 0.4];

function dayPlan(index: number): Day {
  const tilt = DAY_TILT[index] ?? 0;
  return {
    noise: 1 - tilt * 0.14,
    carry: tilt * 2.4,
    mishit: 0.028 + Math.max(0, -tilt) * 0.035,
  };
}

type Playing = {
  along: number;
  off: number;
  pin: number;
};

function distanceToPin(state: Playing): number {
  return Math.hypot(state.pin - state.along, state.off);
}

function applyShot(state: Playing, carry: number, lateral: number) {
  const d = Math.max(1, distanceToPin(state));
  const ux = (state.pin - state.along) / d;
  const uy = (0 - state.off) / d;
  state.along += ux * carry - uy * lateral;
  state.off += uy * carry + ux * lateral;
}

type RoundSpec = {
  index: number;
  id: string;
  date: string;
  courseId: string;
  courseName: string;
  mapped: boolean;
  holes: { par: number; yards: number }[];
};

const ROUND_DATES = [
  "2026-05-09",
  "2026-05-20",
  "2026-05-30",
  "2026-06-10",
  "2026-06-21",
  "2026-07-02",
  "2026-07-12",
  "2026-07-23",
  "2026-08-02",
  "2026-08-13",
  "2026-08-23",
  "2026-09-03",
  "2026-09-13",
  "2026-09-22",
  "2026-09-30",
  "2026-10-04",
];

function buildSchedule(): RoundSpec[] {
  return ROUND_DATES.map((date, index) => {
    const away = index === 4 || index === 11;
    return {
      index,
      id: `r${String(index + 1).padStart(2, "0")}`,
      date,
      courseId: away ? "aviara" : course.id,
      courseName: away ? "Aviara Golf Club" : "Torrey Pines South",
      mapped: !away,
      holes: away
        ? AVIARA
        : course.holes.map((hole) => ({ par: hole.par, yards: hole.yards })),
    };
  });
}

function playRound(spec: RoundSpec, rng: () => number): Round {
  const day = dayPlan(spec.index);
  const form = spec.index / 15;
  const holes: RoundHole[] = [];
  const shots: Shot[] = [];

  spec.holes.forEach((layout, holeIndex) => {
    const number = holeIndex + 1;
    const state: Playing = { along: 0, off: 0, pin: layout.yards };
    const holeShots: Shot[] = [];
    const clubs: string[] = [];
    let distAfterReg = Infinity;

    const launch = (
      club: Club,
      aimCarry: number,
      kind: Shot["kind"],
      full: boolean,
    ) => {
      let carry = aimCarry + (full ? club.trend * form + day.carry : 0);
      carry += gaussian(rng) * club.std * day.noise * (full ? 1 : 0.65);
      let lateral =
        (full ? club.bias : club.bias * 0.35) +
        gaussian(rng) * club.latStd * day.noise * (full ? 1 : 0.7) +
        (carry - aimCarry) * club.draw;
      if (full && rng() < day.mishit) {
        carry = club.avg * (0.86 + rng() * 0.04);
        lateral += (rng() < 0.5 ? -1 : 1) * (8 + rng() * 10);
      }
      const floor = full ? club.avg * 0.66 : 4;
      const cap = full ? club.avg * 1.12 + 4 : Math.max(aimCarry * 1.25, 30);
      carry = Math.max(floor, Math.min(cap, carry));
      lateral = Math.max(-40, Math.min(40, lateral));
      applyShot(state, carry, lateral);
      const shot: Shot = {
        roundId: spec.id,
        roundIndex: spec.index,
        date: spec.date,
        hole: number,
        clubId: club.id,
        kind,
        full,
        aimCarry: Math.round(aimCarry * 10) / 10,
        carry: Math.round(carry * 10) / 10,
        lateral: Math.round(lateral * 10) / 10,
      };
      holeShots.push(shot);
      shots.push(shot);
      clubs.push(club.short);
      if (holeShots.filter((item) => item.kind !== "putt").length === layout.par - 2) {
        distAfterReg = distanceToPin(state);
      }
    };

    if (layout.par === 3) {
      const club = clubFor(layout.yards);
      const full = layout.yards >= club.avg * 0.88;
      launch(club, layout.yards, "approach", full);
    } else {
      let tee = clubById.dr;
      if (layout.yards < 330) tee = rng() < 0.65 ? clubById["5w"] : clubById["3w"];
      else if (layout.yards < 370 && rng() < 0.35) tee = clubById["3w"];
      launch(tee, tee.avg, "tee", true);
    }

    let recoveryUsed = false;
    let guard = 0;
    while (distanceToPin(state) > 20 && guard < 5) {
      guard += 1;
      const remaining = distanceToPin(state);
      if (!recoveryUsed && Math.abs(state.off) > 32 && remaining > 40) {
        recoveryUsed = true;
        const club = clubById["8i"];
        launch(club, Math.min(90, remaining), "layup", false);
        continue;
      }
      if (layout.par >= 5 && holeShots.length === 1 && remaining > 250) {
        const club = layupClub(remaining, rng) ?? clubFor(remaining - 110);
        launch(club, club.avg, "layup", true);
        continue;
      }
      if (remaining < 38) {
        const club = remaining < 20 ? clubById.lw : remaining < 30 ? clubById.sw : clubById.gw;
        launch(club, remaining, "chip", false);
        break;
      }
      let club = clubFor(remaining);
      let aim = Math.min(remaining, club.avg + 1);
      let full = aim >= club.avg * 0.88;
      if (rng() < 0.2) {
        const wrong = neighborClub(club, rng() < 0.5 ? -1 : 1);
        if (wrong) {
          club = wrong;
          aim = wrong.avg;
          full = true;
        }
      }
      launch(club, aim, "approach", full);
    }

    if (layout.par > 3 && distAfterReg === Infinity) {
      distAfterReg = distanceToPin(state);
    }
    if (layout.par === 3 && distAfterReg === Infinity) {
      distAfterReg = distanceToPin(state);
    }

    const proximity = distanceToPin(state);
    let putts = 2;
    if (proximity < 1.5) putts = 0;
    else if (proximity < 3.5) putts = rng() < 0.35 ? 1 : 2;
    else if (proximity < 8) putts = rng() < 0.08 ? 1 : rng() < 0.72 ? 2 : 3;
    else if (proximity < 20) putts = rng() < 0.5 ? 2 : 3;
    else {
      if (holeShots[holeShots.length - 1]?.kind !== "chip") {
        launch(clubById.sw, Math.min(proximity, 28), "chip", false);
      }
      putts = rng() < 0.7 ? 2 : 3;
    }
    for (let i = 0; i < putts; i++) {
      const shot: Shot = {
        roundId: spec.id,
        roundIndex: spec.index,
        date: spec.date,
        hole: number,
        clubId: "pu",
        kind: "putt",
        full: false,
        aimCarry: 0,
        carry: 0,
        lateral: 0,
      };
      holeShots.push(shot);
      shots.push(shot);
      clubs.push("Pu");
    }

    const tee = holeShots.find((shot) => shot.kind === "tee");
    const fairway =
      layout.par === 3 || !tee ? null : Math.abs(tee.lateral) <= 12 && tee.carry > 150;
    const gir = distAfterReg <= 12;

    holes.push({
      number,
      par: layout.par,
      yards: layout.yards,
      strokes: holeShots.length,
      putts,
      clubs,
      gir,
      fairway,
    });
  });

  const par = holes.reduce((total, hole) => total + hole.par, 0);
  const score = holes.reduce((total, hole) => total + hole.strokes, 0);
  return {
    id: spec.id,
    date: spec.date,
    courseId: spec.courseId,
    courseName: spec.courseName,
    mapped: spec.mapped,
    par,
    score,
    holes,
    shots,
  };
}

function buildRounds(): Round[] {
  const rng = mulberry32(0x5eedc1b5);
  return buildSchedule().map((spec) => playRound(spec, rng));
}

export const rounds: Round[] = buildRounds();

export const summary: DemoSummary = summarize(CLUBS, rounds);

export function flightCount(round: Round): number {
  return round.shots.filter((shot) => shot.kind !== "putt").length;
}
