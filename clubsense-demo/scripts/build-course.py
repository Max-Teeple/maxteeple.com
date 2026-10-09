#!/usr/bin/env python3
"""Download Torrey Pines South from OSM and write compact course JSON.

The live demo bundles this file so hole geometry does not depend on Overpass.
"""

from __future__ import annotations

import json
import math
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

BBOX = "-117.2524,32.8900,-117.2429,32.9043"
OUT = Path(__file__).resolve().parents[1] / "src" / "data" / "torrey-pines-south.json"
OSM_URL = f"https://www.openstreetmap.org/api/0.6/map?bbox={BBOX}"
SOUTH_WAY = "35679036"
YARDS_PER_M = 1.0936133


def tags_of(el: ET.Element) -> dict[str, str]:
    return {t.get("k", ""): t.get("v", "") for t in el.findall("tag")}


def haversine_yards(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lon1 = math.radians(a[0]), math.radians(a[1])
    lat2, lon2 = math.radians(b[0]), math.radians(b[1])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(h)) * YARDS_PER_M


def to_xy(p: tuple[float, float], origin: tuple[float, float]) -> tuple[float, float]:
    lat0 = math.radians(origin[0])
    y = (p[0] - origin[0]) * 111320.0
    x = (p[1] - origin[1]) * 111320.0 * math.cos(lat0)
    return x, y


def dist_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    x, y = to_xy(b, a)
    return math.hypot(x, y)


def dist_to_line(p: tuple[float, float], line: list[tuple[float, float]]) -> float:
    if len(line) == 1:
        return dist_m(p, line[0])
    best = 1e18
    for a, b in zip(line, line[1:]):
        ax, ay = 0.0, 0.0
        bx, by = to_xy(b, a)
        px, py = to_xy(p, a)
        ab2 = bx * bx + by * by
        t = 0.0 if ab2 == 0 else max(0.0, min(1.0, (px * bx + py * by) / ab2))
        dx, dy = px - bx * t, py - by * t
        best = min(best, math.hypot(dx, dy))
    return best


def point_in_ring(lat: float, lon: float, ring: list[tuple[float, float]]) -> bool:
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        yi, xi = ring[i]
        yj, xj = ring[j]
        if ((xi > lon) != (xj > lon)) and (lat < (yj - yi) * (lon - xi) / (xj - xi + 1e-15) + yi):
            inside = not inside
        j = i
    return inside


def centroid(pts: list[tuple[float, float]]) -> tuple[float, float]:
    body = pts[:-1] if len(pts) > 1 and pts[0] == pts[-1] else pts
    lat = sum(p[0] for p in body) / len(body)
    lon = sum(p[1] for p in body) / len(body)
    return lat, lon


def close_ring(pts: list[tuple[float, float]]) -> list[tuple[float, float]]:
    if len(pts) >= 3 and pts[0] != pts[-1]:
        return pts + [pts[0]]
    return pts


def round_ring(pts: list[tuple[float, float]]) -> list[list[float]]:
    return [[round(p[0], 6), round(p[1], 6)] for p in pts]


def filter_tees(
    tees: list[list[tuple[float, float]]],
    line: list[tuple[float, float]],
    pin: tuple[float, float],
) -> list[list[tuple[float, float]]]:
    """Keep the tee ladder at the start of the hole and drop stray boxes.

    Sideways polygons tagged as tees can sit just inside the search radius and
    make a par 3 look 300 yards long. A real tee is close to the centerline
    start and not much farther from the pin than that start.
    """
    start = line[0]
    start_pin = dist_m(start, pin)
    axis_end = line[1]
    kept: list[list[tuple[float, float]]] = []
    for ring in tees:
        c = centroid(ring)
        if dist_m(c, start) > 120:
            continue
        if dist_m(c, pin) > start_pin + 35:
            continue
        # Cross-track from the first leg of the hole, in meters.
        ax, ay = to_xy(axis_end, start)
        px, py = to_xy(c, start)
        ab = math.hypot(ax, ay) or 1.0
        cross = abs(px * ay - py * ax) / ab
        if cross > 32:
            continue
        kept.append(ring)
    return kept


def bearing(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lon1 = math.radians(a[0]), math.radians(a[1])
    lat2, lon2 = math.radians(b[0]), math.radians(b[1])
    dlon = lon2 - lon1
    x = math.sin(dlon) * math.cos(lat2)
    y = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlon)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def download() -> ET.Element:
    req = urllib.request.Request(OSM_URL, headers={"User-Agent": "maxteeple-demo/1.0 (course geometry)"})
    with urllib.request.urlopen(req, timeout=90) as res:
        data = res.read()
    return ET.fromstring(data)


def main() -> None:
    root = download()
    nodes: dict[str, tuple[float, float]] = {}
    for n in root.findall("node"):
        nodes[n.get("id", "")] = (float(n.get("lat", "0")), float(n.get("lon", "0")))

    ways: dict[str, list[tuple[float, float]]] = {}
    way_tags: dict[str, dict[str, str]] = {}
    for w in root.findall("way"):
        pts = [nodes[nd.get("ref", "")] for nd in w.findall("nd") if nd.get("ref") in nodes]
        ways[w.get("id", "")] = pts
        way_tags[w.get("id", "")] = tags_of(w)

    south = ways[SOUTH_WAY]

    holes = []
    for wid, tags in way_tags.items():
        if tags.get("golf") != "hole":
            continue
        line = ways[wid]
        if len(line) < 2:
            continue
        mid = line[len(line) // 2]
        if not point_in_ring(mid[0], mid[1], south):
            continue
        holes.append(
            {
                "id": wid,
                "number": int(tags.get("ref", "0")),
                "par": int(tags.get("par", "4")),
                "handicap": int(tags.get("handicap", "0")),
                "line": line,
            }
        )
    holes.sort(key=lambda h: h["number"])
    if len(holes) != 18:
        raise SystemExit(f"expected 18 south holes, found {len(holes)}")

    def nearest_hole(pt: tuple[float, float]) -> tuple[dict, float]:
        best = holes[0]
        best_d = 1e18
        for h in holes:
            d = dist_to_line(pt, h["line"])
            if d < best_d:
                best, best_d = h, d
        return best, best_d

    greens_by_hole: dict[int, list[list[tuple[float, float]]]] = {h["number"]: [] for h in holes}
    for wid, tags in way_tags.items():
        if tags.get("golf") != "green":
            continue
        ring = close_ring(ways[wid])
        if len(ring) < 4:
            continue
        c = centroid(ring)
        if not point_in_ring(c[0], c[1], south):
            continue
        # Prefer the hole whose centerline ends inside this green.
        owner = None
        for h in holes:
            if point_in_ring(h["line"][-1][0], h["line"][-1][1], ring):
                owner = h
                break
        if owner is None:
            owner, dist = nearest_hole(c)
            end_d = min(dist_m(h["line"][-1], c) for h in holes)
            owner = min(holes, key=lambda h: dist_m(h["line"][-1], c))
            if end_d > 80:
                continue
        greens_by_hole[owner["number"]].append(ring)

    fairways_by_hole: dict[int, list[list[tuple[float, float]]]] = {h["number"]: [] for h in holes}
    for rel in root.findall("relation"):
        tags = tags_of(rel)
        if tags.get("golf") != "fairway":
            continue
        for m in rel.findall("member"):
            if m.get("role") != "outer":
                continue
            ring = close_ring(ways.get(m.get("ref", ""), []))
            if len(ring) < 4:
                continue
            c = centroid(ring)
            if not point_in_ring(c[0], c[1], south):
                continue
            # Hole with the most centerline vertices inside the fairway.
            best_h = None
            best_n = 0
            for h in holes:
                n = sum(1 for p in h["line"] if point_in_ring(p[0], p[1], ring))
                if n > best_n:
                    best_n = n
                    best_h = h
            if best_h is None:
                best_h, dist = nearest_hole(c)
                if dist > 140:
                    continue
            fairways_by_hole[best_h["number"]].append(ring)

    for wid, tags in way_tags.items():
        if tags.get("golf") != "fairway":
            continue
        ring = close_ring(ways[wid])
        if len(ring) < 4:
            continue
        c = centroid(ring)
        if not point_in_ring(c[0], c[1], south):
            continue
        owner, dist = nearest_hole(c)
        if dist <= 140:
            fairways_by_hole[owner["number"]].append(ring)

    bunkers_by_hole: dict[int, list[list[tuple[float, float]]]] = {h["number"]: [] for h in holes}
    for wid, tags in way_tags.items():
        if tags.get("golf") != "bunker":
            continue
        ring = close_ring(ways[wid])
        if len(ring) < 4:
            continue
        c = centroid(ring)
        if not point_in_ring(c[0], c[1], south):
            continue
        owner, dist = nearest_hole(c)
        if dist <= 55:
            bunkers_by_hole[owner["number"]].append(ring)

    tees_by_hole: dict[int, list[list[tuple[float, float]]]] = {h["number"]: [] for h in holes}
    for wid, tags in way_tags.items():
        if tags.get("golf") != "tee":
            continue
        ring = close_ring(ways[wid])
        if len(ring) < 4:
            continue
        c = centroid(ring)
        if not point_in_ring(c[0], c[1], south):
            continue
        owner = min(holes, key=lambda h: dist_m(h["line"][0], c))
        if dist_m(owner["line"][0], c) <= 110:
            tees_by_hole[owner["number"]].append(ring)

    hazards_by_hole: dict[int, list[list[tuple[float, float]]]] = {h["number"]: [] for h in holes}
    for wid, tags in way_tags.items():
        if tags.get("golf") not in {"water_hazard", "lateral_water_hazard"} and tags.get("natural") != "water":
            continue
        if tags.get("golf") not in {"water_hazard", "lateral_water_hazard"}:
            continue
        ring = close_ring(ways[wid])
        if len(ring) < 4:
            continue
        c = centroid(ring)
        if not point_in_ring(c[0], c[1], south):
            continue
        owner, dist = nearest_hole(c)
        if dist <= 80:
            hazards_by_hole[owner["number"]].append(ring)

    pins: list[tuple[float, float]] = []
    for n in root.findall("node"):
        tags = tags_of(n)
        if tags.get("golf") == "pin":
            pins.append((float(n.get("lat", "0")), float(n.get("lon", "0"))))

    out_holes = []
    for h in holes:
        greens = greens_by_hole[h["number"]]
        if not greens:
            raise SystemExit(f"hole {h['number']} has no green")
        green = min(greens, key=lambda g: dist_m(h["line"][-1], centroid(g)))
        pin = centroid(green)
        near_pins = [p for p in pins if point_in_ring(p[0], p[1], green) or dist_m(p, centroid(green)) < 30]
        if near_pins:
            pin = min(near_pins, key=lambda p: dist_m(p, centroid(green)))
        tees = filter_tees(tees_by_hole[h["number"]], h["line"], pin)
        if not tees:
            tee_pt = h["line"][0]
        else:
            # The mapped centerline starts on the tee the hole was drawn from.
            tee_pt = min((centroid(t) for t in tees), key=lambda c: dist_m(c, h["line"][0]))
        start_b = bearing(h["line"][0], h["line"][1])
        end_b = bearing(h["line"][-2], h["line"][-1])
        turn = (end_b - start_b + 540) % 360 - 180
        yards = round(haversine_yards(tee_pt, pin))
        out_holes.append(
            {
                "number": h["number"],
                "par": h["par"],
                "handicap": h["handicap"],
                "yards": yards,
                "turn": round(turn, 1),
                "tee": [round(tee_pt[0], 6), round(tee_pt[1], 6)],
                "pin": [round(pin[0], 6), round(pin[1], 6)],
                "centerline": round_ring(h["line"]),
                "green": round_ring(green),
                "tees": [round_ring(t) for t in tees],
                "fairways": [round_ring(f) for f in fairways_by_hole[h["number"]]],
                "bunkers": [round_ring(b) for b in bunkers_by_hole[h["number"]]],
                "hazards": [round_ring(w) for w in hazards_by_hole[h["number"]]],
            }
        )

    course = {
        "id": "torrey-pines-south",
        "name": "Torrey Pines Golf Course",
        "course": "South",
        "place": "North Torrey Pines Road, La Jolla, California",
        "attribution": "© OpenStreetMap contributors",
        "source": "OpenStreetMap way 35679036 and golf features in that course polygon",
        "holes": out_holes,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(course, separators=(",", ":")) + "\n", encoding="utf-8")

    total = sum(h["yards"] for h in out_holes)
    par = sum(h["par"] for h in out_holes)
    print(f"wrote {OUT} par {par} yards {total}")
    for h in out_holes:
        shape = "straight" if abs(h["turn"]) < 12 else ("dogleg right" if h["turn"] > 0 else "dogleg left")
        print(
            f"  {h['number']:2} par {h['par']} hcp {h['handicap']:2} {h['yards']:3}y {shape:14} "
            f"tees {len(h['tees'])} fw {len(h['fairways'])} bunkers {len(h['bunkers'])} water {len(h['hazards'])}"
        )


if __name__ == "__main__":
    main()
