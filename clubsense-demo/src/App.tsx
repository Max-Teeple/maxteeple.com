import { useEffect, useState } from "react";
import { BagView } from "./views/BagView";
import { CoursesView } from "./views/CoursesView";
import { HolePlanView } from "./views/HolePlanView";
import { HomeView } from "./views/HomeView";
import { StatsView } from "./views/StatsView";

type Route =
  | { name: "home" }
  | { name: "stats"; clubId: string | null }
  | { name: "courses" }
  | { name: "plan"; hole: number }
  | { name: "bag" };

function parseHash(): Route {
  const parts = (location.hash.replace(/^#/, "") || "/").split("/").filter(Boolean);
  if (parts[0] === "stats") return { name: "stats", clubId: parts[1] ?? null };
  if (parts[0] === "courses") return { name: "courses" };
  if (parts[0] === "plan") {
    const hole = Number(parts[1] ?? 1);
    return { name: "plan", hole: Number.isFinite(hole) ? Math.min(18, Math.max(1, Math.round(hole))) : 1 };
  }
  if (parts[0] === "bag") return { name: "bag" };
  return { name: "home" };
}

function useRoute(): Route {
  const [route, setRoute] = useState<Route>(parseHash);
  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    const titles: Record<Route["name"], string> = {
      home: "Home",
      stats: "Stats",
      courses: "Courses",
      plan: "Hole plan",
      bag: "Bag",
    };
    document.title = `ClubSense demo · ${titles[route.name]} — Max Teeple`;
    if (route.name !== "plan") window.scrollTo(0, 0);
  }, [route]);
  return route;
}

export function App() {
  const route = useRoute();
  return (
    <div className="app">
      <header className="top">
        <div className="brand-row">
          <a className="brand" href="#/">
            <img src="/projects/clubsense/mark.png" alt="" width={40} height={40} />
            <span>
              <strong>ClubSense</strong>
              <em>Live demo</em>
            </span>
          </a>
          <p className="who">
            <b>Jordan Hale</b>
            <span>Demo player</span>
          </p>
          <a className="site-link" href="/projects/clubsense/">
            maxteeple.com
          </a>
        </div>
        <nav className="tabs" aria-label="Demo">
          <a href="#/" aria-current={route.name === "home" ? "page" : undefined}>
            Home
          </a>
          <a href="#/stats" aria-current={route.name === "stats" ? "page" : undefined}>
            Stats
          </a>
          <a href="#/courses" aria-current={route.name === "courses" ? "page" : undefined}>
            Courses
          </a>
          <a href="#/plan/1" aria-current={route.name === "plan" ? "page" : undefined}>
            <span className="long">Hole plan</span>
            <span className="short">Plan</span>
          </a>
          <a href="#/bag" aria-current={route.name === "bag" ? "page" : undefined}>
            Bag
          </a>
        </nav>
      </header>
      <p className="banner">
        Demo data. Jordan Hale is not a real account. Rounds are fabricated. Torrey Pines South is
        OpenStreetMap geometry saved with this page.
      </p>
      <main>
        {route.name === "home" && <HomeView />}
        {route.name === "stats" && <StatsView clubId={route.clubId} />}
        {route.name === "courses" && <CoursesView />}
        {route.name === "plan" && <HolePlanView holeNumber={route.hole} />}
        {route.name === "bag" && <BagView />}
      </main>
      <footer className="foot">
        <span>Demo data for Jordan Hale.</span>
        <span>Course © OpenStreetMap contributors. Imagery © Esri.</span>
        <a href="/projects/clubsense/">About ClubSense</a>
      </footer>
    </div>
  );
}
