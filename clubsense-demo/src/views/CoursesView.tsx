import { useMemo, useState } from "react";
import { course } from "../data/player";
import { holeShape } from "../lib/geo";

export function CoursesView() {
  const [query, setQuery] = useState("");
  const haystack = `${course.name} ${course.course} ${course.place} torrey pines south la jolla san diego`.toLowerCase();
  const match = useMemo(() => {
    const parts = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return parts.every((part) => haystack.includes(part));
  }, [haystack, query]);
  const yards = course.holes.reduce((total, hole) => total + hole.yards, 0);
  const par = course.holes.reduce((total, hole) => total + hole.par, 0);

  return (
    <div className="view">
      <header className="view-head">
        <p className="eyebrow">Courses</p>
        <h1>Scout a course</h1>
        <p>
          Torrey Pines South is bundled with this page, hole shapes and all, so it loads without a
          course API. Satellite photos still come from Esri when you open a hole.
        </p>
      </header>

      <form className="search" role="search" onSubmit={(event) => event.preventDefault()}>
        <label htmlFor="course-search">Search courses</label>
        <input
          id="course-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Torrey, La Jolla, South…"
          autoComplete="off"
        />
      </form>

      {match ? (
        <article className="course-card">
          <div className="course-top">
            <div>
              <p className="eyebrow">Ready offline</p>
              <h2>
                {course.name}
                <span> {course.course}</span>
              </h2>
              <p className="place">{course.place}</p>
            </div>
            <a className="btn gold" href="#/plan/1">
              Open hole plan
            </a>
          </div>
          <dl className="course-facts">
            <div>
              <dt>Holes</dt>
              <dd>18</dd>
            </div>
            <div>
              <dt>Par</dt>
              <dd>{par}</dd>
            </div>
            <div>
              <dt>Tee to pin</dt>
              <dd>{yards.toLocaleString("en-US")} yds</dd>
            </div>
          </dl>
          <div className="table-scroll">
            <table className="hole-table">
              <thead>
                <tr>
                  <th scope="col">Hole</th>
                  <th scope="col">Par</th>
                  <th scope="col">Yards</th>
                  <th scope="col">Handicap</th>
                  <th scope="col">Shape</th>
                  <th scope="col">
                    <span className="sr">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {course.holes.map((hole) => (
                  <tr key={hole.number}>
                    <th scope="row">{hole.number}</th>
                    <td>{hole.par}</td>
                    <td>{hole.yards}</td>
                    <td>{hole.handicap}</td>
                    <td>{holeShape(hole.turn)}</td>
                    <td>
                      <a href={`#/plan/${hole.number}`}>Open</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="fine">
            Yardage is the mapped tee to the pin, not a printed scorecard. {course.attribution}.
          </p>
        </article>
      ) : (
        <div className="empty-card">
          <h2>No other course is bundled</h2>
          <p>
            This demo keeps Torrey Pines South on the page itself. Live search against OpenStreetMap
            would need a server, and this site does not have one.
          </p>
          <button type="button" className="btn" onClick={() => setQuery("")}>
            Show Torrey Pines South
          </button>
        </div>
      )}
    </div>
  );
}
