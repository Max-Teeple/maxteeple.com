export type LatLon = [number, number];

export type Hole = {
  number: number;
  par: 3 | 4 | 5;
  handicap: number;
  yards: number;
  /** Degrees the hole turns. Positive is a dogleg right. */
  turn: number;
  tee: LatLon;
  pin: LatLon;
  centerline: LatLon[];
  green: LatLon[];
  tees: LatLon[][];
  fairways: LatLon[][];
  bunkers: LatLon[][];
  hazards: LatLon[][];
};

export type Course = {
  id: string;
  name: string;
  course: string;
  place: string;
  attribution: string;
  source: string;
  holes: Hole[];
};

export type ClubGroup = "Woods" | "Irons" | "Wedges" | "Putter";

export type Club = {
  id: string;
  label: string;
  short: string;
  group: ClubGroup;
  /** Stock carry in yards. */
  avg: number;
  std: number;
  /** Mean miss in yards. Positive is right of the aim line. */
  bias: number;
  latStd: number;
  /** Extra lateral yards for each yard of carry past the aim. */
  draw: number;
  /** Carry change, in yards, from the first demo round to the last. */
  trend: number;
};

export type ShotKind = "tee" | "layup" | "approach" | "chip" | "putt";

export type Shot = {
  roundId: string;
  roundIndex: number;
  date: string;
  hole: number;
  clubId: string;
  kind: ShotKind;
  /** Full swings feed dispersion, carry charts, and gapping. */
  full: boolean;
  aimCarry: number;
  carry: number;
  /** Yards right of the aim line. Negative is left. */
  lateral: number;
};

export type RoundHole = {
  number: number;
  par: number;
  yards: number;
  strokes: number;
  putts: number;
  clubs: string[];
  gir: boolean;
  /** Null on par 3s. */
  fairway: boolean | null;
};

export type Round = {
  id: string;
  date: string;
  courseId: string;
  courseName: string;
  mapped: boolean;
  par: number;
  score: number;
  holes: RoundHole[];
  shots: Shot[];
};

export type Player = {
  name: string;
  role: string;
  home: string;
};
