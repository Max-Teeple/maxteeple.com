import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { course, summary } from "../data/player";
import type { Hole, LatLon } from "../data/types";
import { greenDepths, haversineYards, holeShape, pointAlong } from "../lib/geo";
import { suggestClub } from "../lib/stats";
import { clearOverrides, noteFor, noteIsSample, readOverrides, writeOverrides } from "../lib/notes";

const ESRI =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

type Readout = {
  aim: number;
  front: number;
  middle: number;
  back: number;
};

function yardText(yards: number): string {
  if (!Number.isFinite(yards)) return "—";
  if (yards < 0) return "past";
  return String(Math.round(yards));
}

function defaultAim(hole: Hole): LatLon {
  if (hole.par === 3) return hole.pin;
  const distance = hole.par === 5 ? Math.min(250, hole.yards * 0.42) : Math.min(245, Math.max(170, hole.yards - 165));
  return pointAlong([hole.tee, ...hole.centerline], distance);
}

export function HolePlanView({ holeNumber }: { holeNumber: number }) {
  const hole = course.holes[holeNumber - 1] ?? course.holes[0];
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const fitRef = useRef<() => void>(() => {});
  const measureRef = useRef<(from: LatLon, aim: LatLon) => void>(() => {});
  const [readout, setReadout] = useState<Readout | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [mapError, setMapError] = useState<string | null>(null);

  useEffect(() => {
    setOverrides(readOverrides());
  }, []);

  measureRef.current = (from, aim) => {
    const depths = greenDepths(from, hole.pin, hole.green);
    setReadout({
      aim: haversineYards(from, aim),
      front: depths.front,
      middle: depths.middle,
      back: depths.back,
    });
  };

  useEffect(() => {
    const el = mapEl.current;
    if (!el) return;
    const map = L.map(el, {
      zoomControl: true,
      keyboard: false,
      scrollWheelZoom: true,
    });
    L.tileLayer(ESRI, {
      maxZoom: 19,
      attribution:
        'Imagery © Esri, Maxar, Earthstar Geographics · Course © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    mapRef.current = map;
    const onResize = () => map.invalidateSize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    setMapError(null);
    const group = L.layerGroup().addTo(map);
    try {
      const draw = (rings: LatLon[][], style: L.PathOptions) => {
        for (const ring of rings) {
          if (ring.length < 3) continue;
          L.polygon(
            ring.map(([lat, lon]) => [lat, lon]),
            style,
          ).addTo(group);
        }
      };
      draw(hole.fairways, { color: "#e7fff0", weight: 1, fillColor: "#5dce86", fillOpacity: 0.32 });
      draw(hole.hazards, { color: "#c5e4ff", weight: 1, fillColor: "#2d6cb5", fillOpacity: 0.55 });
      draw(hole.bunkers, { color: "#fff4d2", weight: 1, fillColor: "#e4c56a", fillOpacity: 0.82 });
      draw([hole.green], { color: "#f3fff6", weight: 2, fillColor: "#3dce6c", fillOpacity: 0.62 });
      draw(hole.tees, { color: "#ffffff", weight: 1, fillColor: "#ffffff", fillOpacity: 0.78 });

      const fromLL = L.latLng(hole.tee[0], hole.tee[1]);
      const aimPoint = defaultAim(hole);
      const aimLL = L.latLng(aimPoint[0], aimPoint[1]);
      const pinLL = L.latLng(hole.pin[0], hole.pin[1]);

      const toPin = L.polyline([fromLL, pinLL], {
        color: "#ffffff",
        weight: 2,
        opacity: 0.75,
        dashArray: "1 8",
      }).addTo(group);
      const toAim = L.polyline([fromLL, aimLL], {
        color: "#e0b44a",
        weight: 3,
        opacity: 0.95,
        dashArray: "2 10",
      }).addTo(group);

      const yard = L.marker(midpoint(fromLL, aimLL), {
        interactive: false,
        icon: yardIcon(haversineYards([fromLL.lat, fromLL.lng], [aimLL.lat, aimLL.lng])),
        zIndexOffset: 600,
      }).addTo(group);

      L.marker(pinLL, { interactive: false, icon: flagIcon(), zIndexOffset: 500 }).addTo(group);

      const fromMarker = L.marker(fromLL, {
        draggable: true,
        icon: tagIcon("from-pin", "From"),
        zIndexOffset: 700,
      }).addTo(group);
      const aimMarker = L.marker(aimLL, {
        draggable: true,
        icon: tagIcon("aim-pin", "Aim"),
        zIndexOffset: 800,
      }).addTo(group);

      const refresh = () => {
        const from = fromMarker.getLatLng();
        const aim = aimMarker.getLatLng();
        toAim.setLatLngs([from, aim]);
        toPin.setLatLngs([from, pinLL]);
        const yards = haversineYards([from.lat, from.lng], [aim.lat, aim.lng]);
        const mid = midpoint(from, aim);
        yard.setLatLng(mid);
        yard.setIcon(yardIcon(yards));
        measureRef.current([from.lat, from.lng], [aim.lat, aim.lng]);
      };
      fromMarker.on("drag", refresh);
      aimMarker.on("drag", refresh);
      refresh();

      const bounds = L.latLngBounds([
        fromLL,
        aimLL,
        pinLL,
        ...hole.green.map(([lat, lon]) => L.latLng(lat, lon)),
        ...hole.fairways.flat().map(([lat, lon]) => L.latLng(lat, lon)),
      ]);
      const fit = () => {
        map.invalidateSize();
        map.fitBounds(bounds.pad(0.18), { animate: false, maxZoom: 18 });
      };
      fitRef.current = fit;
      fit();
      window.setTimeout(fit, 60);
    } catch (error) {
      setMapError(error instanceof Error ? error.message : "The map failed to draw this hole.");
    }
    return () => {
      group.remove();
    };
  }, [hole]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (event.key === "ArrowRight") location.hash = `#/plan/${hole.number === 18 ? 1 : hole.number + 1}`;
      if (event.key === "ArrowLeft") location.hash = `#/plan/${hole.number === 1 ? 18 : hole.number - 1}`;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hole.number]);

  const suggestion = readout ? suggestClub(summary.clubStats, readout.aim) : null;
  const sample = noteIsSample(hole.number, overrides);
  const note = noteFor(hole.number, overrides);
  const prev = hole.number === 1 ? 18 : hole.number - 1;
  const next = hole.number === 18 ? 1 : hole.number + 1;

  return (
    <div className="plan">
      <div className="map-wrap">
        <div ref={mapEl} className="hole-map" />
        <div className="readout-card">
          <div className="readout aim">
            <b>{readout ? yardText(readout.aim) : "—"}</b>
            <span>To aim</span>
          </div>
          <div className="readout">
            <b>{readout ? yardText(readout.front) : "—"}</b>
            <span>Front</span>
          </div>
          <div className="readout mid">
            <b>{readout ? yardText(readout.middle) : "—"}</b>
            <span>Middle</span>
          </div>
          <div className="readout">
            <b>{readout ? yardText(readout.back) : "—"}</b>
            <span>Back</span>
          </div>
        </div>
        <ul className="map-legend">
          <li><i className="swatch tee" /> Tee</li>
          <li><i className="swatch fairway" /> Fairway</li>
          <li><i className="swatch green" /> Green</li>
          <li><i className="swatch bunker" /> Bunker</li>
        </ul>
        {mapError && <p className="map-error">{mapError}</p>}
      </div>

      <div className="hole-switch">
        <a className="btn slim" href={`#/plan/${prev}`}>
          Prev
        </a>
        <p>
          <strong>Hole {hole.number}</strong>
          <span>
            Par {hole.par} · {hole.yards} yds · {holeShape(hole.turn)} · hcp {hole.handicap}
          </span>
        </p>
        <a className="btn slim" href={`#/plan/${next}`}>
          Next
        </a>
      </div>
      <div className="pips" role="navigation" aria-label="Holes">
        {course.holes.map((item) => (
          <a
            key={item.number}
            href={`#/plan/${item.number}`}
            aria-current={item.number === hole.number ? "page" : undefined}
          >
            {item.number}
          </a>
        ))}
      </div>
      <aside className="plan-side">
        <p className="fine">
          Drag the gold aim point. Drag From to measure from anywhere on the hole. Arrow keys change
          holes.
        </p>
        <button type="button" className="btn slim" onClick={() => fitRef.current()}>
          Fit hole
        </button>
        {suggestion && readout && (
          <p className="suggest">
            <span>Demo bag</span>
            {suggestion.club.label} plays {Math.round(suggestion.trimmed || suggestion.average)}. This
            aim is {Math.round(readout.aim)}.
          </p>
        )}
        <label className="notes">
          <span>{sample ? "Sample note" : overrides[String(hole.number)] !== undefined ? "Saved in this browser" : "Hole note"}</span>
          <textarea
            rows={5}
            value={note}
            onChange={(event) => {
              const nextOverrides = { ...overrides, [String(hole.number)]: event.target.value };
              setOverrides(nextOverrides);
              writeOverrides(nextOverrides);
            }}
          />
        </label>
        <button
          type="button"
          className="text-button"
          onClick={() => {
            clearOverrides();
            setOverrides({});
          }}
        >
          Restore sample notes
        </button>
      </aside>
    </div>
  );
}

function midpoint(a: L.LatLng, b: L.LatLng): L.LatLng {
  return L.latLng((a.lat + b.lat) / 2, (a.lng + b.lng) / 2);
}

function tagIcon(className: string, label: string): L.DivIcon {
  return L.divIcon({
    className: `pin ${className}`,
    html: `<span>${label}</span>`,
    iconSize: [58, 58],
    iconAnchor: [29, 29],
  });
}

function flagIcon(): L.DivIcon {
  return L.divIcon({
    className: "pin flag-pin",
    html: "<span></span>",
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

function yardIcon(yards: number): L.DivIcon {
  return L.divIcon({
    className: "pin yard-pin",
    html: `<span>${Math.round(yards)}</span>`,
    iconSize: [56, 26],
    iconAnchor: [28, 13],
  });
}
