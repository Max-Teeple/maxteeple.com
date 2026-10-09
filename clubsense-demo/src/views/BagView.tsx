import { CLUBS, rounds, summary } from "../data/player";
import type { ClubGroup } from "../data/types";
import { biasLabel } from "../lib/format";

const groups: ClubGroup[] = ["Woods", "Irons", "Wedges", "Putter"];

export function BagView() {
  const puttsPerRound = (summary.byId.pu?.putts ?? 0) / rounds.length;

  return (
    <div className="view">
      <header className="view-head">
        <p className="eyebrow">Bag</p>
        <h1>Jordan Hale’s demo bag</h1>
        <p>
          Fourteen clubs, with the carry they actually produced in the sample rounds. This page is
          the bag. The ellipses live on Stats.
        </p>
      </header>

      <div className="tiles slim">
        <div className="tile">
          <b>{CLUBS.length}</b>
          <span>In the bag</span>
        </div>
        <div className="tile">
          <b>{summary.fullShots}</b>
          <span>Full swings</span>
        </div>
        <div className="tile">
          <b>{puttsPerRound.toFixed(0)}</b>
          <span>Putts / round</span>
        </div>
      </div>

      {groups.map((group) => (
        <section key={group} className="bag-group">
          <h2>{group}</h2>
          <ul>
            {summary.clubStats
              .filter((stat) => stat.club.group === group)
              .map((stat) => (
                <li key={stat.club.id}>
                  <a href={`#/stats/${stat.club.id}`}>
                    <i className="badge">{stat.club.short}</i>
                    <span className="bag-copy">
                      <strong>{stat.club.label}</strong>
                      <em>
                        {stat.club.id === "pu"
                          ? `${stat.putts} putts · ${puttsPerRound.toFixed(1)} a round`
                          : `${stat.count} full swings · avg ${Math.round(stat.average)} · ${biasLabel(stat.bias)}`}
                      </em>
                    </span>
                    {stat.club.group === "Woods" && <span className="chip">Tee club</span>}
                  </a>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
