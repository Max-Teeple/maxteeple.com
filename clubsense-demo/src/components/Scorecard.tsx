import type { Round, RoundHole } from "../data/types";
import { toParLabel } from "../lib/format";

function mark(strokes: number, par: number): string {
  const delta = strokes - par;
  if (delta <= -2) return "mark eagle";
  if (delta === -1) return "mark birdie";
  if (delta === 1) return "mark bogey";
  if (delta >= 2) return "mark double";
  return "mark";
}

function Nine({ holes, label }: { holes: RoundHole[]; label: string }) {
  const par = holes.reduce((total, hole) => total + hole.par, 0);
  const score = holes.reduce((total, hole) => total + hole.strokes, 0);
  return (
    <table className="card-table">
      <thead>
        <tr>
          <th scope="col">Hole</th>
          {holes.map((hole) => (
            <th key={hole.number} scope="col">
              {hole.number}
            </th>
          ))}
          <th scope="col">{label}</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <th scope="row">Par</th>
          {holes.map((hole) => (
            <td key={hole.number}>{hole.par}</td>
          ))}
          <td>{par}</td>
        </tr>
        <tr>
          <th scope="row">Score</th>
          {holes.map((hole) => (
            <td key={hole.number}>
              <span className={mark(hole.strokes, hole.par)}>{hole.strokes}</span>
            </td>
          ))}
          <td>{score}</td>
        </tr>
      </tbody>
    </table>
  );
}

export function Scorecard({ round }: { round: Round }) {
  const front = round.holes.slice(0, 9);
  const back = round.holes.slice(9);
  return (
    <div className="scorecard">
      <div className="sc-scroll">
        <Nine holes={front} label="Out" />
      </div>
      <div className="sc-scroll">
        <Nine holes={back} label="In" />
      </div>
      <p className="sc-total">
        {round.score} ({toParLabel(round.score - round.par)}) · par {round.par}
        {round.mapped ? "" : " · away course, not on the map"}
      </p>
    </div>
  );
}
