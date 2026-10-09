import type { Shot } from "../data/types";
import type { ClubSummary } from "../lib/stats";
import { ellipsePath } from "../lib/stats";
import { biasLabel } from "../lib/format";

type Scale = {
  x: (value: number) => number;
  y: (value: number) => number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  w: number;
  h: number;
  padL: number;
  padR: number;
  padT: number;
  padB: number;
};

function makeScale(
  xs: number[],
  ys: number[],
  w: number,
  h: number,
  padL: number,
  padR: number,
  padT: number,
  padB: number,
): Scale {
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const xSpan = xMax - xMin || 1;
  const ySpan = yMax - yMin || 1;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  return {
    x: (value) => padL + ((value - xMin) / xSpan) * plotW,
    y: (value) => padT + ((yMax - value) / ySpan) * plotH,
    xMin,
    xMax,
    yMin,
    yMax,
    w,
    h,
    padL,
    padR,
    padT,
    padB,
  };
}

function niceStep(span: number): number {
  if (span > 80) return 20;
  if (span > 40) return 10;
  return 5;
}

export function DispersionPlot({ stat }: { stat: ClubSummary }) {
  const shots = stat.shots;
  if (shots.length === 0) {
    return <p className="empty">No full swings with this club.</p>;
  }
  const ring = stat.ellipse ? ellipsePath(stat.ellipse) : [];
  const rawX = shots.map((shot) => shot.lateral).concat(ring.map((point) => point.x), [0]);
  const rawY = shots.map((shot) => shot.carry).concat(ring.map((point) => point.y));
  const xPad = Math.max(18, ...rawX.map((value) => Math.abs(value))) + 4;
  const yLo = Math.min(...rawY) - 8;
  const yHi = Math.max(...rawY) + 8;
  const scale = makeScale([-xPad, xPad], [yLo, yHi], 720, 460, 54, 18, 28, 40);
  const xStep = 10;
  const yStep = niceStep(yHi - yLo);
  const xTicks: number[] = [];
  for (let tick = Math.ceil(-xPad / xStep) * xStep; tick <= xPad; tick += xStep) xTicks.push(tick);
  const yTicks: number[] = [];
  for (let tick = Math.ceil(yLo / yStep) * yStep; tick <= yHi; tick += yStep) yTicks.push(tick);
  const meanX = stat.bias;
  const meanY = stat.average;

  return (
    <figure className="plot plot-dispersion">
      <figcaption>
        <span>
          Dispersion · {shots.length} full swings · {biasLabel(stat.bias)} · {Math.round(stat.average)} yd avg
        </span>
        <span className="legend-aim">Gold = aim</span>
      </figcaption>
      <svg viewBox={`0 0 ${scale.w} ${scale.h}`} role="img" aria-label={`${stat.club.label} dispersion`}>
        {yTicks.map((tick) => (
          <g key={`y${tick}`}>
            <line className="grid" x1={scale.padL} x2={scale.w - scale.padR} y1={scale.y(tick)} y2={scale.y(tick)} />
            <text className="tick" x={scale.padL - 8} y={scale.y(tick) + 4} textAnchor="end">
              {tick}
            </text>
          </g>
        ))}
        {xTicks.map((tick) => (
          <g key={`x${tick}`}>
            <line
              className={tick === 0 ? "aim-line" : "grid"}
              x1={scale.x(tick)}
              x2={scale.x(tick)}
              y1={scale.padT}
              y2={scale.h - scale.padB}
            />
            <text className="tick" x={scale.x(tick)} y={scale.h - 16} textAnchor="middle">
              {tick === 0 ? "0" : tick > 0 ? `${tick}R` : `${Math.abs(tick)}L`}
            </text>
          </g>
        ))}
        <text className="aim-label" x={scale.x(0) + 8} y={scale.padT + 14}>
          AIM
        </text>
        {ring.length > 0 && (
          <polyline className="ellipse" points={ring.map((point) => `${scale.x(point.x)},${scale.y(point.y)}`).join(" ")} />
        )}
        {shots.map((shot, index) => (
          <circle key={index} className="shot-dot" cx={scale.x(shot.lateral)} cy={scale.y(shot.carry)} r={shots.length > 80 ? 3.2 : 4.2} />
        ))}
        <line className="cross" x1={scale.x(meanX) - 7} x2={scale.x(meanX) + 7} y1={scale.y(meanY)} y2={scale.y(meanY)} />
        <line className="cross" x1={scale.x(meanX)} x2={scale.x(meanX)} y1={scale.y(meanY) - 7} y2={scale.y(meanY) + 7} />
      </svg>
      <p className="plot-note">
        {stat.ellipse
          ? "White ring is a 90% ellipse fitted to these shots. The crosshair is the average finish, not the aim."
          : "A 90% ellipse needs at least 8 full swings."}
      </p>
    </figure>
  );
}

export function CarryChart({ shots }: { shots: Shot[] }) {
  if (shots.length === 0) return null;
  const carries = shots.map((shot) => shot.carry);
  const low = Math.floor(Math.min(...carries) / 5) * 5;
  const high = Math.ceil(Math.max(...carries) / 5) * 5;
  const bins: { start: number; count: number }[] = [];
  for (let start = low; start < high; start += 5) {
    bins.push({
      start,
      count: carries.filter((carry) => carry >= start && carry < start + 5).length,
    });
  }
  const width = 720;
  const height = 220;
  const padL = 36;
  const padB = 32;
  const padT = 16;
  const padR = 12;
  const max = Math.max(...bins.map((bin) => bin.count), 1);
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const barW = plotW / bins.length;
  const avg = carries.reduce((sum, value) => sum + value, 0) / carries.length;

  return (
    <figure className="plot plot-light">
      <figcaption>Carry distribution · 5 yard bins</figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Carry distribution">
        {bins.map((bin, index) => {
          const h = (bin.count / max) * plotH;
          return (
            <rect
              key={bin.start}
              className="bar"
              x={padL + index * barW + 2}
              y={padT + plotH - h}
              width={Math.max(1, barW - 4)}
              height={h}
            />
          );
        })}
        <line className="mean-line" x1={padL + ((avg - low) / (high - low || 1)) * plotW} x2={padL + ((avg - low) / (high - low || 1)) * plotW} y1={padT} y2={padT + plotH} />
        <text className="tick dark" x={padL} y={height - 10}>
          {low}
        </text>
        <text className="tick dark" x={width - padR} y={height - 10} textAnchor="end">
          {high} yd
        </text>
        <text className="tick dark" x={padL + ((avg - low) / (high - low || 1)) * plotW + 6} y={padT + 12}>
          avg {Math.round(avg)}
        </text>
      </svg>
    </figure>
  );
}

export function TrendChart({ stat, rounds }: { stat: ClubSummary; rounds: { id: string; date: string; index: number }[] }) {
  const points = rounds
    .map((round) => {
      const carries = stat.shots.filter((shot) => shot.roundId === round.id).map((shot) => shot.carry);
      if (carries.length === 0) return null;
      const avg = carries.reduce((sum, value) => sum + value, 0) / carries.length;
      return { index: round.index, avg, date: round.date };
    })
    .filter((point): point is { index: number; avg: number; date: string } => point !== null);
  if (points.length < 2) return null;
  const ys = points.map((point) => point.avg);
  const pad = Math.max(4, (Math.max(...ys) - Math.min(...ys)) * 0.25);
  const scale = makeScale([0, 15], [Math.min(...ys) - pad, Math.max(...ys) + pad], 720, 200, 48, 16, 16, 32);
  const d = points.map((point, index) => `${index === 0 ? "M" : "L"} ${scale.x(point.index)} ${scale.y(point.avg)}`).join(" ");

  return (
    <figure className="plot plot-light">
      <figcaption>
        Carry by round · {stat.trend >= 0 ? "+" : ""}
        {stat.trend.toFixed(1)} yd from the first five to the last five
      </figcaption>
      <svg viewBox={`0 0 ${scale.w} ${scale.h}`} role="img" aria-label="Carry trend">
        <line className="grid dark" x1={scale.padL} x2={scale.w - scale.padR} y1={scale.y(stat.average)} y2={scale.y(stat.average)} />
        <path className="trend" d={d} />
        {points.map((point) => (
          <circle key={point.index} className="trend-dot" cx={scale.x(point.index)} cy={scale.y(point.avg)} r={4} />
        ))}
        <text className="tick dark" x={scale.x(points[0].index)} y={scale.h - 10} textAnchor="middle">
          {points[0].date.slice(5)}
        </text>
        <text className="tick dark" x={scale.x(points[points.length - 1].index)} y={scale.h - 10} textAnchor="middle">
          {points[points.length - 1].date.slice(5)}
        </text>
      </svg>
    </figure>
  );
}

export function GapChart({ stats }: { stats: ClubSummary[] }) {
  const rows = stats.filter((stat) => stat.club.id !== "pu" && stat.count > 0);
  if (rows.length === 0) return null;
  const max = Math.max(...rows.map((stat) => stat.average));
  return (
    <figure className="gap-chart">
      <figcaption>Bag summary · average carry</figcaption>
      <ul>
        {rows.map((stat, index) => {
          const next = rows[index + 1];
          const gap = next ? stat.average - next.average : null;
          return (
            <li key={stat.club.id}>
              <span className="gap-club">{stat.club.short}</span>
              <span className="gap-track">
                <span style={{ width: `${(stat.average / max) * 100}%` }} />
              </span>
              <span className="gap-yd">{Math.round(stat.average)}</span>
              {gap !== null && (
                <span className={gap >= 16 ? "gap-flag wide" : "gap-flag"}>{gap.toFixed(0)} yd step</span>
              )}
            </li>
          );
        })}
      </ul>
    </figure>
  );
}

export function biasWidth(bias: number): { left: string; width: string } {
  const clamped = Math.max(-1, Math.min(1, bias / 12));
  if (clamped >= 0) return { left: "50%", width: `${clamped * 50}%` };
  return { left: `${50 + clamped * 50}%`, width: `${Math.abs(clamped) * 50}%` };
}
