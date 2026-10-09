import { useState } from "react";
import { PLAYER, flightCount, rounds, summary } from "../data/player";
import { formatWeekday, toParLabel } from "../lib/format";
import { Scorecard } from "../components/Scorecard";

const ordered = [...rounds].sort((a, b) => b.date.localeCompare(a.date));

export function HomeView() {
  const latest = ordered[0];
  const [openId, setOpenId] = useState<string | null>(latest.id);
  const puttsPerRound = summary.putts / rounds.length;

  return (
    <div className="view">
      <section className="player-hero">
        <p className="eyebrow">Demo player</p>
        <h1>{PLAYER.name}</h1>
        <p>
          A made-up golfer from {PLAYER.home}. Sixteen rounds, a 14-club bag, and a real drawing of
          Torrey Pines South. The shots were generated so the charts have a pattern to show. Nothing
          here is a live account.
        </p>
        <div className="cta-row">
          <a className="btn gold" href="#/plan/1">
            Scout Torrey South
          </a>
          <a className="btn" href="#/stats">
            Open stats
          </a>
        </div>
      </section>

      <section className="last-round">
        <p className="eyebrow light">Last round</p>
        <h2>{latest.courseName}</h2>
        <p className="when">{formatWeekday(latest.date)}</p>
        <div className="last-figures">
          <div>
            <b>{latest.score}</b>
            <span>{toParLabel(latest.score - latest.par)}</span>
          </div>
          <div>
            <b>{latest.holes.length}</b>
            <span>holes</span>
          </div>
          <div>
            <b>{flightCount(latest)}</b>
            <span>shots</span>
          </div>
        </div>
      </section>

      <section>
        <h2 className="section-label">Form</h2>
        <div className="tiles">
          <Tile value={summary.avgScore.toFixed(1)} label="Avg score" />
          <Tile value={toParLabel(summary.avgToPar)} label="Avg to par" />
          <Tile value={`${Math.round(summary.longestDrive)}`} label="Longest drive" />
          <Tile value={`${Math.round(summary.fairwayPct ?? 0)}%`} label="Fairways" />
          <Tile value={`${Math.round(summary.girPct)}%`} label="Greens" />
          <Tile value={puttsPerRound.toFixed(0)} label="Putts / round" />
        </div>
        <p className="fine">
          {summary.fullShots} full swings tracked. {rounds.length} rounds, fourteen of them at Torrey
          Pines South and two at Aviara.
        </p>
      </section>

      <section>
        <h2 className="section-label">What the shots say</h2>
        <ul className="insights">
          {summary.insights.map((insight) => (
            <li key={insight}>{insight}</li>
          ))}
        </ul>
        <a className="text-link" href="#/stats/dr">
          See the driver ellipse
        </a>
      </section>

      <section>
        <h2 className="section-label">Recent rounds</h2>
        <ul className="round-list">
          {ordered.map((round) => {
            const open = openId === round.id;
            return (
              <li key={round.id}>
                <button
                  type="button"
                  className={open ? "round open" : "round"}
                  aria-expanded={open}
                  onClick={() => setOpenId(open ? null : round.id)}
                >
                  <span>
                    <strong>{round.courseName}</strong>
                    <em>
                      {formatWeekday(round.date)} · {round.holes.length} holes · {flightCount(round)} shots
                      {round.mapped ? "" : " · away"}
                    </em>
                  </span>
                  <span className="round-score">
                    <b>{round.score}</b>
                    <i>{toParLabel(round.score - round.par)}</i>
                  </span>
                </button>
                {open && <Scorecard round={round} />}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <div className="tile">
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}
