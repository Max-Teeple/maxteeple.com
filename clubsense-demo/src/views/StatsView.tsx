import { CLUBS, rounds, summary } from "../data/player";
import { biasLabel, signedYards } from "../lib/format";
import { biasWidth, CarryChart, DispersionPlot, GapChart, TrendChart } from "../components/Charts";

export function StatsView({ clubId }: { clubId: string | null }) {
  const selected = summary.byId[clubId ?? "dr"] ?? summary.byId.dr;
  const roundAxis = rounds.map((round, index) => ({ id: round.id, date: round.date, index }));

  return (
    <div className="view">
      <header className="view-head">
        <p className="eyebrow">Stats</p>
        <h1>How the demo bag actually finishes</h1>
        <p>
          Every dot is a full swing aimed at a number. The gold line is that aim. Left and right are
          measured against it, not against the fairway.
        </p>
      </header>

      <ul className="insights">
        {summary.insights.map((insight) => (
          <li key={insight}>{insight}</li>
        ))}
      </ul>

      <GapChart stats={summary.clubStats} />

      <div className="table-scroll">
        <table className="bag-table">
          <thead>
            <tr>
              <th scope="col">Club</th>
              <th scope="col">Shots</th>
              <th scope="col">Avg</th>
              <th scope="col">Median</th>
              <th scope="col">±</th>
              <th scope="col">L / R</th>
              <th scope="col">Trend</th>
            </tr>
          </thead>
          <tbody>
            {summary.clubStats.map((stat) => {
              const active = stat.club.id === selected.club.id;
              const meter = biasWidth(stat.bias);
              return (
                <tr key={stat.club.id} className={active ? "active" : undefined}>
                  <th scope="row">
                    <a href={`#/stats/${stat.club.id}`} aria-current={active ? "true" : undefined}>
                      <i className="badge">{stat.club.short}</i>
                      {stat.club.label}
                    </a>
                  </th>
                  <td>{stat.club.id === "pu" ? stat.putts : stat.count}</td>
                  <td>{stat.count ? Math.round(stat.average) : "—"}</td>
                  <td>{stat.count ? Math.round(stat.median) : "—"}</td>
                  <td>{stat.count ? stat.stdev.toFixed(1) : "—"}</td>
                  <td>
                    {stat.count ? (
                      <span className="bias-cell">
                        {biasLabel(stat.bias)}
                        <span className="bias-meter" aria-hidden="true">
                          <i style={{ left: meter.left, width: meter.width }} />
                        </span>
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>{stat.count ? signedYards(Math.round(stat.trend)) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <section className="club-detail" id="club">
        <header className="club-head">
          <i className="badge lg">{selected.club.short}</i>
          <div>
            <h2>{selected.club.label}</h2>
            <p>
              {selected.club.id === "pu"
                ? `${selected.putts} putts across ${rounds.length} rounds.`
                : `${selected.count} full swings. Plays like ${Math.round(selected.trimmed)} after dropping the outer 10%.`}
            </p>
          </div>
        </header>

        {selected.club.id === "pu" ? (
          <p className="empty">
            The putter is scored, not sprayed. Dispersion here is for full swings. Jordan Hale
            averages {(selected.putts / rounds.length).toFixed(1)} putts a round.
          </p>
        ) : (
          <>
            <div className="tiles">
              <Mini value={`${Math.round(selected.average)}`} label="Average" />
              <Mini value={`${Math.round(selected.longest)}`} label="Longest" />
              <Mini value={`${Math.round(selected.median)}`} label="Median" />
              <Mini value={`±${selected.stdev.toFixed(1)}`} label="Carry spread" />
              <Mini value={biasLabel(selected.bias)} label="Vs aim" />
              <Mini value={signedYards(Math.round(selected.trend))} label="Five-round trend" />
            </div>
            <DispersionPlot stat={selected} />
            <div className="chart-grid">
              <CarryChart shots={selected.shots} />
              <TrendChart stat={selected} rounds={roundAxis} />
            </div>
          </>
        )}
      </section>
      <p className="fine">Clubs in the bag: {CLUBS.length}. Chips and pitches are kept out of the ellipses.</p>
    </div>
  );
}

function Mini({ value, label }: { value: string; label: string }) {
  return (
    <div className="tile">
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}
