import { course, rounds, summary, CLUBS } from "../src/data/player.ts";
import { ellipseFromCovariance } from "../src/lib/stats.ts";
import { greenDepths, haversineYards } from "../src/lib/geo.ts";
import { toParLabel } from "../src/lib/format.ts";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

const yards = haversineYards([32.9, -117.25], [32.91, -117.25]);
assert(Math.abs(yards - 1217.5) < 5, `latitude yards off: ${yards}`);

const pin: [number, number] = [32.9, -117.25];
const meters = 20 / 111320;
const ring: [number, number][] = [
  [pin[0] + meters, pin[1] + meters],
  [pin[0] + meters, pin[1] - meters],
  [pin[0] - meters, pin[1] - meters],
  [pin[0] - meters, pin[1] + meters],
];
const from: [number, number] = [pin[0] - 100 / 111320, pin[1]];
const depths = greenDepths(from, pin, ring);
assert(Math.abs(depths.middle - 109.4) < 2, `middle ${depths.middle}`);
assert(depths.front < depths.middle && depths.middle < depths.back, "front/mid/back order");
assert(Math.abs(depths.back - depths.front - (40 * 1.0936133)) < 3, `green depth ${depths.back - depths.front}`);

const ellipse = ellipseFromCovariance(4, 1, 0);
assert(ellipse, "ellipse");
assert(ellipse && Math.abs(ellipse.rx - Math.sqrt(4 * 4.605170185988092)) < 1e-6, "rx");
assert(ellipse && Math.abs(ellipse.angle) < 1e-9, "angle");

assert(course.holes.length === 18, "18 holes");
assert(course.holes.reduce((s, h) => s + h.par, 0) === 72, "par 72");
for (const hole of course.holes) {
  assert(hole.green.length >= 4, `hole ${hole.number} green`);
  assert(hole.fairways.length >= 1, `hole ${hole.number} fairway`);
  assert(hole.yards > 140 && hole.yards < 680, `hole ${hole.number} yards ${hole.yards}`);
  assert(hole.par === 3 || hole.par === 4 || hole.par === 5, "par");
}

assert(rounds.length === 16, "16 rounds");
assert(rounds[0].date < rounds[15].date, "dates ascend");
assert(rounds.filter((r) => r.mapped).length === 14, "14 mapped rounds");
assert(rounds.every((r) => r.holes.length === 18), "full rounds");
assert(rounds.every((r) => r.score === r.holes.reduce((s, h) => s + h.strokes, 0)), "score matches");

const scores = rounds.map((r) => r.score);
const avg = scores.reduce((s, n) => s + n, 0) / scores.length;
console.log(
  "rounds",
  rounds.map((r) => `${r.date} ${r.courseName} ${r.score} (${toParLabel(r.score - r.par)})`).join("\n"),
);
console.log("avg", avg.toFixed(2), "to par", summary.avgToPar.toFixed(2));
console.log("fw", summary.fairwayPct?.toFixed(1), "gir", summary.girPct.toFixed(1), "full", summary.fullShots, "putts", summary.putts);
console.log("longest", summary.longestDrive);
for (const stat of summary.clubStats) {
  if (stat.club.id === "pu") {
    console.log("pu putts", stat.putts, "per round", (stat.putts / rounds.length).toFixed(1));
    continue;
  }
  console.log(
    stat.club.short.padEnd(3),
    "n",
    String(stat.count).padStart(3),
    "avg",
    stat.average.toFixed(1).padStart(6),
    "med",
    stat.median.toFixed(1).padStart(6),
    "std",
    stat.stdev.toFixed(1).padStart(4),
    "bias",
    stat.bias.toFixed(1).padStart(5),
    "trend",
    stat.trend.toFixed(1).padStart(5),
    "trim",
    stat.trimmed.toFixed(1).padStart(6),
    stat.ellipse ? `ell ${stat.ellipse.rx.toFixed(1)}x${stat.ellipse.ry.toFixed(1)}` : "no ell",
  );
}
console.log("gaps", summary.gaps.map((g) => `${g.longer.short}->${g.shorter.short} ${g.yards.toFixed(1)}`).join(", "));
console.log("insights:");
for (const line of summary.insights) console.log(" -", line);

assert(rounds[15].date <= "2026-10-08", `last round ${rounds[15].date}`);
assert(avg > 74 && avg < 86, `avg score ${avg}`);
assert(summary.avgToPar > 3 && summary.avgToPar < 12, `to par ${summary.avgToPar}`);
assert(summary.girPct > 30 && summary.girPct < 68, `gir ${summary.girPct}`);
assert(summary.fairwayPct !== null && summary.fairwayPct > 38 && summary.fairwayPct < 70, `fw ${summary.fairwayPct}`);
assert(Math.min(...scores) >= 66 && Math.max(...scores) <= 96, `score range ${Math.min(...scores)}-${Math.max(...scores)}`);
assert(summary.byId.dr.count >= 80, "driver sample");
assert(summary.byId.dr.bias > 2 && summary.byId.dr.bias < 12, `driver bias ${summary.byId.dr.bias}`);
assert(summary.byId["4i"].count >= 12, "4i sample");
assert(summary.byId["4i"].bias < -1, `4i bias ${summary.byId["4i"].bias}`);
assert(summary.byId.dr.trend > 1.5, `driver trend ${summary.byId.dr.trend}`);
assert(summary.byId.dr.ellipse && summary.byId.dr.ellipse.rx > 5, "driver ellipse");
for (const id of ["4i", "5i", "6i", "7i", "8i", "9i", "pw", "gw", "sw", "lw"]) {
  assert(summary.byId[id].count >= 8, `${id} count ${summary.byId[id].count}`);
  assert(summary.byId[id].ellipse, `${id} ellipse`);
}
assert(CLUBS.length === 14, "14 clubs");
assert(summary.insights.length >= 3, "insights");
console.log("ok");
