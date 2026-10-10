(function () {
  var CLIPS = {
    member: {
      src: "clips/member-round.mp4",
      poster: "clips/member-round.jpg",
      title: "Tee shot",
      credit: "Senior female playing golf"
    },
    family: {
      src: "clips/family-skins.mp4",
      poster: "clips/family-skins.jpg",
      title: "Family skins",
      credit: "Father teaching daughter to play golf"
    },
    swing: {
      src: "clips/junior-clinic.mp4",
      poster: "clips/junior-clinic.jpg",
      title: "Fairway swing",
      credit: "Girl hitting a golf ball"
    },
    harborPutt: {
      src: "clips/harbor-putt.mp4",
      poster: "clips/harbor-putt.jpg",
      title: "Putt",
      credit: "Young boy golfing"
    },
    putt: {
      src: "clips/putt.mp4",
      poster: "clips/putt.jpg",
      title: "Putt",
      credit: "Golf Putter Swing"
    },
    approach: {
      src: "clips/approach.mp4",
      poster: "clips/approach.jpg",
      title: "Ball in the air",
      credit: "Golf Ball in Mid-Air Bounce Over the Green"
    }
  };

  var COURSES = [
    {
      slug: "cactus-wash-golf-club",
      name: "Cactus Wash Golf Club",
      city: "Scottsdale",
      state: "AZ",
      holes: 18,
      x: 222.7,
      y: 398.9,
      blurb: "A demo desert course with a stream on the middle holes.",
      live: { title: "Member Saturday skins", hole: "Hole 7 · par 4", viewers: 18, clip: "member" },
      replays: [{ id: "hole-6-putt", clip: "putt", title: "Hole 6 putt", hole: "Par 3" }]
    },
    {
      slug: "salt-river-bend",
      name: "Salt River Bend",
      city: "Phoenix",
      state: "AZ",
      holes: 18,
      x: 207.4,
      y: 400.3,
      blurb: "A demo municipal with a fixed camera on the ninth green.",
      live: { title: "Green camera", hole: "Hole 9 · par 5", viewers: 4, clip: "approach" },
      replays: [{ id: "green-cam", clip: "approach", title: "Green camera, saved", hole: "Hole 9" }]
    },
    {
      slug: "ironwood-municipal",
      name: "Ironwood Municipal",
      city: "Mesa",
      state: "AZ",
      holes: 18,
      x: 222.9,
      y: 409.1,
      blurb: "Quiet in this demo. A sample putt is saved from an earlier round.",
      live: null,
      replays: [{ id: "sample-putt", clip: "putt", title: "Sample putt", hole: "Practice green" }]
    },
    {
      slug: "saguaro-ridge",
      name: "Saguaro Ridge",
      city: "Tucson",
      state: "AZ",
      holes: 18,
      x: 230.0,
      y: 436.1,
      blurb: "No stream and no saved highlight in this demo.",
      live: null,
      replays: []
    },
    {
      slug: "harbor-dunes",
      name: "Harbor Dunes",
      city: "San Diego",
      state: "CA",
      holes: 18,
      x: 116.0,
      y: 399.8,
      blurb: "A demo course streaming a family skins game.",
      live: { title: "Family skins", hole: "Hole 4 · par 4", viewers: 11, clip: "family" },
      replays: [
        { id: "fairway-swing", clip: "swing", title: "Fairway swing", hole: "Hole 4" },
        { id: "putt-on-4", clip: "harborPutt", title: "Putt on 4", hole: "Hole 4" }
      ]
    },
    {
      slug: "olive-grove-links",
      name: "Olive Grove Links",
      city: "Santa Barbara",
      state: "CA",
      holes: 18,
      x: 78.0,
      y: 351.0,
      blurb: "Not streaming in this demo.",
      live: null,
      replays: []
    },
    {
      slug: "redwood-terrace",
      name: "Redwood Terrace",
      city: "San Francisco",
      state: "CA",
      holes: 9,
      x: 52.0,
      y: 267.9,
      blurb: "A nine-hole demo course with nothing on the air.",
      live: null,
      replays: []
    },
    {
      slug: "hill-country-nine",
      name: "Hill Country Nine",
      city: "Austin",
      state: "TX",
      holes: 9,
      x: 476.1,
      y: 499.0,
      blurb: "Nine holes. No clip saved in this demo.",
      live: null,
      replays: []
    },
    {
      slug: "brazos-bend-club",
      name: "Brazos Bend Club",
      city: "Houston",
      state: "TX",
      holes: 18,
      x: 522.7,
      y: 512.7,
      blurb: "Listed so the Texas filter has a second course. Not live.",
      live: null,
      replays: []
    },
    {
      slug: "palmetto-shores",
      name: "Palmetto Shores",
      city: "Naples",
      state: "FL",
      holes: 18,
      x: 797.8,
      y: 570.5,
      blurb: "A Florida demo course. Nothing is scheduled today.",
      live: null,
      replays: []
    },
    {
      slug: "cypress-hammock",
      name: "Cypress Hammock",
      city: "Orlando",
      state: "FL",
      holes: 18,
      x: 798.1,
      y: 516.8,
      blurb: "On the directory, offline in this demo.",
      live: null,
      replays: []
    },
    {
      slug: "front-range-links",
      name: "Front Range Links",
      city: "Denver",
      state: "CO",
      holes: 18,
      x: 356.9,
      y: 279.2,
      blurb: "A demo municipal along the Front Range. No stream today.",
      live: null,
      replays: []
    },
    {
      slug: "red-rock-fairway",
      name: "Red Rock Fairway",
      city: "Colorado Springs",
      state: "CO",
      holes: 18,
      x: 357.9,
      y: 300.7,
      blurb: "South of Denver on the map. Not live.",
      live: null,
      replays: []
    },
    {
      slug: "valley-wash-golf-club",
      name: "Valley Wash Golf Club",
      city: "Las Vegas",
      state: "NV",
      holes: 18,
      x: 168.1,
      y: 332.2,
      blurb: "The only Nevada course in this demo, and it is offline.",
      live: null,
      replays: []
    }
  ];

  var PARTIES = {
    "cactus-wash-golf-club": {
      title: "Saturday skins",
      members: ["Jordan", "Priya", "Sam"],
      chat: [
        { who: "Jordan", text: "Hole 7 has the wash on the right." },
        { who: "Priya", text: "I can see the flag." },
        { who: "Sam", text: "Sample message. This party is not real." }
      ]
    },
    "harbor-dunes": {
      title: "Family skins",
      members: ["Elena", "Noah"],
      chat: [
        { who: "Elena", text: "They are on the fourth green." },
        { who: "Noah", text: "Sample watch party." }
      ]
    },
    "salt-river-bend": {
      title: "Green camera",
      members: ["Chris"],
      chat: [{ who: "Chris", text: "Just the ninth green from a fixed camera." }]
    }
  };

  var FEED = [
    { time: "2m", text: "Cactus Wash went live — Member Saturday skins.", href: "#/c/cactus-wash-golf-club" },
    { time: "6m", text: "Jordan opened a watch party for that skins game.", href: "#/party/cactus-wash-golf-club" },
    { time: "14m", text: "Harbor Dunes is live — family skins on hole 4.", href: "#/c/harbor-dunes" },
    { time: "22m", text: "Harbor Dunes saved a putt from the same round.", href: "#/c/harbor-dunes/putt-on-4" },
    { time: "1h", text: "Salt River Bend turned on the hole 9 camera.", href: "#/c/salt-river-bend" },
    { time: "Yesterday", text: "Ironwood Municipal kept a sample putt. Nothing is live there.", href: "#/c/ironwood-municipal" }
  ];

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var viewEl = document.getElementById("view");
  var navDirectory = document.getElementById("nav-directory");
  var navFeed = document.getElementById("nav-feed");
  var lastName = "";
  var firstPaint = true;
  var CHAT_KEY = "lv-demo-chat";

  function esc(value) {
    return String(value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function courseBySlug(slug) {
    return COURSES.filter(function (course) { return course.slug === slug; })[0] || null;
  }

  function clipOf(id) {
    return CLIPS[id] || CLIPS.member;
  }

  function posterFor(course) {
    if (course.live) return clipOf(course.live.clip).poster;
    if (course.replays.length) return clipOf(course.replays[0].clip).poster;
    return "";
  }

  function parseRoute() {
    var raw = (location.hash || "#/").replace(/^#/, "");
    if (raw.charAt(0) !== "/") raw = "/" + raw;
    var qIndex = raw.indexOf("?");
    var path = qIndex === -1 ? raw : raw.slice(0, qIndex);
    var params = new URLSearchParams(qIndex === -1 ? "" : raw.slice(qIndex + 1));
    var parts = path.split("/").filter(Boolean);
    var head = parts[0] || "";
    if (head === "feed") return { name: "feed" };
    if (head === "c" && parts[1]) {
      return { name: "course", slug: decodeURIComponent(parts[1]), clip: parts[2] ? decodeURIComponent(parts[2]) : "" };
    }
    if (head === "party" && parts[1]) return { name: "party", slug: decodeURIComponent(parts[1]) };
    if (head === "setup" && parts[1]) return { name: "setup", slug: decodeURIComponent(parts[1]) };
    return {
      name: "directory",
      q: params.get("q") || "",
      state: params.get("state") || "",
      city: params.get("city") || "",
      view: params.get("view") || ""
    };
  }

  function loadExtraChat(slug) {
    try {
      var all = JSON.parse(sessionStorage.getItem(CHAT_KEY) || "{}");
      return all[slug] || [];
    } catch (err) {
      return [];
    }
  }

  function saveExtraChat(slug, messages) {
    var all = {};
    try { all = JSON.parse(sessionStorage.getItem(CHAT_KEY) || "{}"); } catch (err) { all = {}; }
    all[slug] = messages;
    sessionStorage.setItem(CHAT_KEY, JSON.stringify(all));
  }

  function statesPresent() {
    var seen = {};
    COURSES.forEach(function (course) { seen[course.state] = true; });
    return Object.keys(seen).sort();
  }

  function matchesQuery(course, q) {
    if (!q) return true;
    var hay = (course.name + " " + course.city + " " + course.state + " " + course.blurb + " " + (course.live ? course.live.title : "")).toLowerCase();
    return hay.indexOf(q.toLowerCase()) !== -1;
  }

  function filtered(route) {
    return COURSES.filter(function (course) {
      if (route.state && course.state !== route.state) return false;
      if (route.city && course.city !== route.city) return false;
      return matchesQuery(course, route.q);
    }).sort(function (a, b) {
      if (!!a.live !== !!b.live) return a.live ? -1 : 1;
      if (a.state !== b.state) return a.state < b.state ? -1 : 1;
      return a.name < b.name ? -1 : 1;
    });
  }

  function cityOptions(route) {
    var seen = {};
    COURSES.forEach(function (course) {
      if (route.state && course.state !== route.state) return;
      if (!matchesQuery(course, route.q)) return;
      seen[course.city] = course.state;
    });
    return Object.keys(seen).sort().map(function (city) {
      return { city: city, state: seen[city] };
    });
  }

  function effectiveView(chosen) {
    if (chosen === "list" || chosen === "map" || chosen === "split") return chosen;
    return window.matchMedia("(min-width: 900px)").matches ? "split" : "list";
  }

  function writeDirectory(next) {
    var params = new URLSearchParams();
    if (next.q) params.set("q", next.q);
    if (next.state) params.set("state", next.state);
    if (next.city) params.set("city", next.city);
    if (next.view) params.set("view", next.view);
    var qs = params.toString();
    history.replaceState(null, "", location.pathname + location.search + "#/" + (qs ? "?" + qs : ""));
    render();
  }

  function fitAspect(box, aspect) {
    var x0 = box[0];
    var y0 = box[1];
    var x1 = box[2];
    var y1 = box[3];
    var w = Math.max(1, x1 - x0);
    var h = Math.max(1, y1 - y0);
    if (w / h < aspect) {
      var nw = h * aspect;
      var cx = (x0 + x1) / 2;
      x0 = cx - nw / 2;
      x1 = cx + nw / 2;
    } else {
      var nh = w / aspect;
      var cy = (y0 + y1) / 2;
      y0 = cy - nh / 2;
      y1 = cy + nh / 2;
    }
    return [x0, y0, x1, y1];
  }

  function viewBoxFor(list, stateId) {
    var map = window.LV_MAP;
    var aspect = map.width / map.height;
    if (list.length && (stateId || list.length < 8)) {
      var minX = Math.min.apply(null, list.map(function (c) { return c.x; }));
      var maxX = Math.max.apply(null, list.map(function (c) { return c.x; }));
      var minY = Math.min.apply(null, list.map(function (c) { return c.y; }));
      var maxY = Math.max.apply(null, list.map(function (c) { return c.y; }));
      var cx = (minX + maxX) / 2;
      var cy = (minY + maxY) / 2;
      var span = Math.max(150, maxX - minX + 72, maxY - minY + 72);
      return fitAspect([cx - span * 0.62, cy - span * 0.5, cx + span * 0.62, cy + span * 0.5], aspect);
    }
    return [0, 0, map.width, map.height];
  }

  function spreadPins(list, vb) {
    var width = vb[2] - vb[0];
    var minDist = width > 500 ? 26 : 0;
    var pts = list.map(function (course) { return { slug: course.slug, x: course.x, y: course.y }; });
    if (!minDist) return pts;
    for (var n = 0; n < 14; n++) {
      for (var i = 0; i < pts.length; i++) {
        for (var j = i + 1; j < pts.length; j++) {
          var dx = pts[j].x - pts[i].x;
          var dy = pts[j].y - pts[i].y;
          var dist = Math.hypot(dx, dy) || 0.01;
          if (dist < minDist) {
            var push = (minDist - dist) / 2;
            pts[i].x -= (dx / dist) * push;
            pts[i].y -= (dy / dist) * push;
            pts[j].x += (dx / dist) * push;
            pts[j].y += (dy / dist) * push;
          }
        }
      }
    }
    return pts;
  }

  function mapMarkup(list, stateId) {
    var map = window.LV_MAP;
    var vb = viewBoxFor(list, stateId);
    var vbW = vb[2] - vb[0];
    var scale = vbW / 1000;
    var pins = spreadPins(list, vb);
    var bySlug = {};
    pins.forEach(function (pin) { bySlug[pin.slug] = pin; });
    var paths = map.states.map(function (state) {
      var on = state.id === stateId ? " is-on" : "";
      return '<path data-state="' + state.id + '" class="' + on.trim() + '" d="' + state.d + '"><title>' + esc(state.name) + "</title></path>";
    }).join("");
    var dots = list.map(function (course) {
      var pin = bySlug[course.slug];
      var label = course.name + ", " + course.city + " " + course.state + (course.live ? ", live" : "");
      return '<a class="pin' + (course.live ? " is-live" : "") + '" href="#/c/' + course.slug + '" transform="translate(' + pin.x.toFixed(1) + "," + pin.y.toFixed(1) + ") scale(" + scale.toFixed(4) + ')" aria-label="' + esc(label) + '">' +
        "<title>" + esc(label) + "</title>" +
        '<circle class="hit" r="34"></circle>' +
        (course.live ? '<circle class="pulse" r="36"></circle>' : "") +
        '<circle class="core" r="16"></circle></a>';
    }).join("");
    return '<svg viewBox="' + vb.map(function (n) { return n.toFixed(1); }).join(" ") + '" role="img" aria-label="Demo map of sample courses. Choose a state to zoom.">' + paths + dots + "</svg>";
  }

  function liveCard(course) {
    var clip = clipOf(course.live.clip);
    return '<a class="lane-card" href="#/c/' + course.slug + '" data-testid="live-card">' +
      '<img src="' + clip.poster + '" alt="" width="86" height="64">' +
      "<span><span class=\"live-tag\"><i></i> Live</span><strong>" + esc(course.name) + "</strong>" +
      '<p class="meta">' + esc(course.live.title) + " · " + course.live.viewers + " watching</p></span></a>";
  }

  function courseCard(course) {
    var status = course.live
      ? '<span class="live-tag"><i></i> Live · ' + esc(course.live.title) + "</span>"
      : '<span class="quiet-tag">' + (course.replays.length ? "Replay saved" : "Offline") + "</span>";
    var poster = posterFor(course);
    var thumb = poster
      ? '<img src="' + poster + '" alt="" width="112" height="74">'
      : '<span class="thumb-empty" aria-hidden="true">No clip</span>';
    return '<a class="course-card" href="#/c/' + course.slug + '" data-testid="course-card">' +
      thumb +
      "<span>" + status + "<strong>" + esc(course.name) + "</strong>" +
      '<p class="meta">' + esc(course.city) + ", " + course.state + " · " + course.holes + " holes · Demo</p></span></a>";
  }

  function credits() {
    return '<details class="credits"><summary>Sample clip sources</summary><p>These clips are stock footage under the <a href="https://mixkit.co/license/#videoFree">Mixkit Stock Video Free License</a>. They were not filmed at the demo courses, and the people in them are not endorsing LiveView.</p><ul>' +
      "<li>Senior female playing golf</li><li>Father teaching daughter to play golf</li>" +
      "<li>Girl hitting a golf ball</li><li>Young boy golfing</li>" +
      "<li>Golf Putter Swing</li><li>Golf Ball in Mid-Air Bounce Over the Green</li>" +
      "</ul></details>";
  }

  function videoTag(clip, label) {
    var auto = reduceMotion ? "" : " autoplay muted loop";
    return '<video id="stage" controls playsinline' + auto + ' poster="' + clip.poster + '" src="' + clip.src + '" aria-label="' + esc(label) + '"></video>';
  }

  function renderDirectory(route) {
    var cities = cityOptions(route);
    if (route.city && !cities.some(function (item) { return item.city === route.city; })) route.city = "";
    var list = filtered(route);
    var live = list.filter(function (course) { return course.live; });
    var view = effectiveView(route.view);
    var stateOptions = ['<option value="">All states</option>'].concat(statesPresent().map(function (id) {
      return '<option value="' + id + '"' + (id === route.state ? " selected" : "") + ">" + id + "</option>";
    })).join("");
    var citySelect = ['<option value="">All cities</option>'].concat(cities.map(function (item) {
      return '<option value="' + esc(item.city) + '"' + (item.city === route.city ? " selected" : "") + ">" + esc(item.city) + ", " + item.state + "</option>";
    })).join("");
    var lane = live.length
      ? '<div class="lane">' + live.map(liveCard).join("") + "</div>"
      : '<p class="empty">Nothing is live in this filter. Sample data only.</p>';
    var cards = list.length
      ? list.map(courseCard).join("")
      : '<p class="empty">No demo courses match.</p>';
    var focusId = document.activeElement && document.activeElement.id;
    var caret = document.activeElement && document.activeElement.selectionStart;
    var scrollY = window.scrollY;
    viewEl.innerHTML =
      '<p class="eyebrow">Directory · demo data</p><h1>Courses near you</h1>' +
      '<p class="lede">Fourteen invented courses. Three of them are “live,” playing license-free stock clips on a loop.</p>' +
      '<section class="live-lane" aria-labelledby="live-heading" data-testid="live-lane"><div class="lane-head"><h2 id="live-heading">Live now</h2><p class="hint">Sample viewers</p></div>' + lane + "</section>" +
      '<form class="filters" id="filters" role="search">' +
      '<label class="field">Search<input id="q" data-testid="search" type="search" placeholder="Course or city" value="' + esc(route.q) + '" autocomplete="off"></label>' +
      '<label class="field">State<select id="state" data-testid="state-filter">' + stateOptions + "</select></label>" +
      '<label class="field">City<select id="city" data-testid="city-filter">' + citySelect + "</select></label>" +
      '<div class="views" role="group" aria-label="Directory layout">' +
      viewButton("list", "List", view) + viewButton("split", "Split", view) + viewButton("map", "Map", view) +
      "</div></form>" +
      '<p class="count" id="count" aria-live="polite">' + list.length + " demo course" + (list.length === 1 ? "" : "s") + "</p>" +
      '<div class="split ' + (view === "list" ? "list-only" : view === "map" ? "map-only" : "") + '">' +
      '<div class="map-frame" data-testid="map">' + mapMarkup(list, route.state) + '<p class="hint" style="padding:0.45rem 0.7rem 0.7rem">Pins are approximate. Click a state to filter. Overlapping pins spread apart until you zoom in.</p></div>' +
      '<div class="course-list">' + cards + "</div></div>" + credits();

    var q = document.getElementById("q");
    var state = document.getElementById("state");
    var city = document.getElementById("city");
    function commit(nextView) {
      var nextCity = city.value;
      if (state.value !== route.state) nextCity = "";
      writeDirectory({ q: q.value.trim(), state: state.value, city: nextCity, view: nextView === undefined ? route.view : nextView });
    }
    q.addEventListener("input", function () { commit(); });
    state.addEventListener("change", function () { commit(); });
    city.addEventListener("change", function () { commit(); });
    document.getElementById("filters").addEventListener("submit", function (event) { event.preventDefault(); commit(); });
    document.querySelectorAll("[data-view]").forEach(function (button) {
      button.addEventListener("click", function () { commit(button.getAttribute("data-view")); });
    });
    var svg = viewEl.querySelector("svg");
    if (svg) {
      svg.addEventListener("click", function (event) {
        var path = event.target.closest("path[data-state]");
        if (!path) return;
        writeDirectory({ q: q.value.trim(), state: path.getAttribute("data-state"), city: "", view: route.view || "split" });
      });
    }
    if (focusId) {
      var el = document.getElementById(focusId);
      if (el) {
        el.focus();
        if (caret != null && el.setSelectionRange) {
          try { el.setSelectionRange(caret, caret); } catch (err) { /* select elements */ }
        }
      }
    }
    if (lastName === "directory") window.scrollTo(0, scrollY);
  }

  function viewButton(id, label, current) {
    return '<button type="button" data-view="' + id + '" data-testid="view-' + id + '" aria-pressed="' + (current === id ? "true" : "false") + '">' + label + "</button>";
  }

  function renderCourse(route) {
    var course = courseBySlug(route.slug);
    if (!course) return renderMissing();
    var selected = course.replays.filter(function (replay) { return replay.id === route.clip; })[0];
    var stageClip = selected ? clipOf(selected.clip) : (course.live ? clipOf(course.live.clip) : (course.replays[0] ? clipOf(course.replays[0].clip) : null));
    var stageLabel = stageClip
      ? "Sample clip, " + stageClip.credit + ". Not filmed at " + course.name + "."
      : "";
    var badge = course.live && !selected
      ? '<span class="badge"><i class="dot-live"></i> Live · ' + course.live.viewers + " watching</span>"
      : "";
    var replays = course.replays.length
      ? '<div class="replays">' + course.replays.map(function (replay) {
        var clip = clipOf(replay.clip);
        var on = selected && selected.id === replay.id;
        return '<button type="button" class="replay" data-testid="replay" data-replay="' + replay.id + '" aria-pressed="' + (on ? "true" : "false") + '">' +
          '<img src="' + clip.poster + '" alt="" width="320" height="180"><span><strong>' + esc(replay.title) + '</strong><p class="meta">' + esc(replay.hole) + " · sample clip</p></span></button>";
      }).join("") + "</div>"
      : '<p class="empty">No highlight saved for this demo course.</p>';
    var status = course.live
      ? esc(course.live.title) + " · " + esc(course.live.hole)
      : "Not streaming in this demo";
    viewEl.innerHTML =
      '<a class="back" href="#/">Directory</a>' +
      '<p class="eyebrow">Demo course · ' + esc(course.city) + ", " + course.state + "</p>" +
      '<div class="course-top"><h1>' + esc(course.name) + "</h1><p class=\"meta\">" + course.holes + " holes</p></div>" +
      "<p class=\"lede\">" + esc(course.blurb) + "</p>" +
      "<p class=\"meta\">" + status + "</p>" +
      (stageClip
        ? '<div class="stage">' + badge + videoTag(stageClip, stageLabel) + "</div>" +
          '<p class="caption" id="stage-caption">' + esc(stageLabel) + "</p>"
        : '<p class="empty">No sample clip on this course.</p>') +
      '<div class="actions"><a class="primary" href="#/party/' + course.slug + '" data-testid="party-link">Watch party</a>' +
      '<a class="ghost" href="#/setup/' + course.slug + '">Stream setup</a></div>' +
      '<section class="block"><h2>Replay highlights</h2>' + replays + "</section>" + credits();
    document.title = course.name + " — LiveView demo";
    viewEl.querySelectorAll("[data-replay]").forEach(function (button) {
      button.addEventListener("click", function () {
        location.hash = "#/c/" + course.slug + "/" + button.getAttribute("data-replay");
      });
    });
  }

  function renderParty(route) {
    var course = courseBySlug(route.slug);
    if (!course) return renderMissing();
    var party = PARTIES[course.slug] || {
      title: "Watch party",
      members: [],
      chat: [{ who: "LiveView", text: "Sample party. Nobody else is here." }]
    };
    var extra = loadExtraChat(course.slug);
    var clip = course.live ? clipOf(course.live.clip) : (course.replays[0] ? clipOf(course.replays[0].clip) : null);
    var messages = party.chat.concat(extra);
    var people = party.members.map(function (name) {
      return "<li>" + esc(name) + " <span class=\"meta\">sample</span></li>";
    }).join("") + '<li class="you">You</li>';
    viewEl.innerHTML =
      '<a class="back" href="#/c/' + course.slug + '">' + esc(course.name) + "</a>" +
      '<p class="eyebrow">Watch party · demo</p><h1>' + esc(party.title) + "</h1>" +
      '<p class="lede">' + esc(course.name) + " · " + esc(course.city) + ", " + course.state + ". Messages stay in this browser.</p>" +
      '<div class="layout-2"><div>' +
      (clip ? '<div class="stage">' + (course.live ? '<span class="badge"><i class="dot-live"></i> Live</span>' : "") + videoTag(clip, "Sample clip in a demo watch party.") + "</div>" : '<p class="empty">This demo course has no clip to share.</p>') +
      '<p class="caption">Sample clip. Not a live broadcast.</p></div>' +
      '<aside class="panel"><h2>In this party</h2><ul class="people">' + people + "</ul>" +
      '<h2 style="margin-top:1rem">Chat</h2><ul class="chat" id="chat-log" data-testid="chat-log" aria-live="polite">' +
      messages.map(chatItem).join("") + "</ul>" +
      '<form class="chat-form" id="chat-form"><label class="skip" for="chat-input" style="position:static;transform:none;background:none;color:inherit;padding:0">Message</label>' +
      '<input id="chat-input" data-testid="chat-input" maxlength="140" placeholder="Say something" autocomplete="off">' +
      '<button class="primary" type="submit" data-testid="chat-send">Send</button></form>' +
      '<p class="meta">Demo only. Nothing is sent to a server.</p></aside></div>' + credits();
    document.title = party.title + " — LiveView demo";
    document.getElementById("chat-form").addEventListener("submit", function (event) {
      event.preventDefault();
      var input = document.getElementById("chat-input");
      var text = input.value.trim();
      if (!text) return;
      extra.push({ who: "You", text: text });
      saveExtraChat(course.slug, extra);
      document.getElementById("chat-log").insertAdjacentHTML("beforeend", chatItem({ who: "You", text: text }));
      input.value = "";
      input.focus();
    });
  }

  function chatItem(message) {
    return "<li><b>" + esc(message.who) + "</b><p>" + esc(message.text) + "</p></li>";
  }

  function renderSetup(route) {
    var course = courseBySlug(route.slug);
    if (!course) return renderMissing();
    var key = "demo_" + course.slug.replace(/-/g, "_") + "_key";
    var status = course.live ? "Marked live in this demo" : "Offline in this demo";
    viewEl.innerHTML =
      '<a class="back" href="#/c/' + course.slug + '">' + esc(course.name) + "</a>" +
      '<p class="eyebrow">Stream setup · demo</p><h1>Course desk</h1>' +
      '<p class="lede">' + esc(course.name) + " is already registered here. The full app would hand a course an RTMP ingest and an HLS playback URL, then hold a new stream for approval. This desk does not connect to an encoder.</p>" +
      '<dl class="stack-rows"><dt>Status</dt><dd>' + status + "</dd>" +
      "<dt>RTMP URL</dt><dd class=\"key-row\"><input class=\"key-field\" id=\"rtmp\" readonly value=\"rtmp://demo.liveview.invalid/live\">" +
      '<button class="ghost" type="button" data-copy="rtmp">Copy</button></dd>' +
      "<dt>Stream key</dt><dd class=\"key-row\"><input class=\"key-field\" id=\"stream-key\" readonly type=\"password\" value=\"" + esc(key) + "\">" +
      '<button class="ghost" type="button" id="reveal" aria-pressed="false">Show</button></dd>' +
      "<dt>Playback</dt><dd>The course page plays a local sample file. There is no ingest on this site.</dd></dl>" + credits();
    document.title = "Stream setup — LiveView demo";
    document.querySelector("[data-copy]").addEventListener("click", function (event) {
      var button = event.currentTarget;
      var value = document.getElementById("rtmp").value;
      copyText(value, button);
    });
    document.getElementById("reveal").addEventListener("click", function (event) {
      var input = document.getElementById("stream-key");
      var show = input.type === "password";
      input.type = show ? "text" : "password";
      event.currentTarget.textContent = show ? "Hide" : "Show";
      event.currentTarget.setAttribute("aria-pressed", show ? "true" : "false");
    });
  }

  function copyText(value, button) {
    var done = function () {
      var original = button.textContent;
      button.textContent = "Copied";
      setTimeout(function () { button.textContent = original; }, 1400);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(done).catch(function () { done(); });
    } else {
      done();
    }
  }

  function renderFeed() {
    viewEl.innerHTML =
      '<p class="eyebrow">Activity · demo accounts</p><h1>Feed</h1>' +
      '<p class="lede">Sample posts about the demo courses. The names are not real members.</p>' +
      '<ul class="feed">' + FEED.map(function (item) {
        return '<li><a href="' + item.href + '"><time>' + esc(item.time) + "</time>" + esc(item.text) + "</a></li>";
      }).join("") + "</ul>" + credits();
    document.title = "Feed — LiveView demo";
  }

  function renderMissing() {
    viewEl.innerHTML = '<p class="eyebrow">Demo</p><h1>That course is not in the demo</h1><p class="lede"><a href="#/">Back to the directory</a></p>';
    document.title = "LiveView demo";
  }

  function markCurrent(el, on) {
    if (on) el.setAttribute("aria-current", "page");
    else el.removeAttribute("aria-current");
  }

  function render() {
    var route = parseRoute();
    var changed = route.name !== lastName && !firstPaint;
    markCurrent(navDirectory, route.name === "directory");
    markCurrent(navFeed, route.name === "feed");
    if (route.name === "directory") {
      document.title = "Directory — LiveView demo";
      renderDirectory(route);
    } else if (route.name === "course") renderCourse(route);
    else if (route.name === "party") renderParty(route);
    else if (route.name === "setup") renderSetup(route);
    else renderFeed();
    if (changed) {
      window.scrollTo(0, 0);
      var heading = viewEl.querySelector("h1");
      if (heading) {
        heading.tabIndex = -1;
        heading.focus();
      }
    }
    lastName = route.name;
    firstPaint = false;
  }

  if (new URLSearchParams(location.search).get("reel") === "1") {
    var cursor = document.createElement("div");
    cursor.id = "reel-cursor";
    cursor.setAttribute("aria-hidden", "true");
    document.body.appendChild(cursor);
    window.addEventListener("mousemove", function (event) {
      cursor.style.transform = "translate(" + event.clientX + "px, " + event.clientY + "px)";
    });
  }

  window.addEventListener("hashchange", render);
  window.addEventListener("popstate", render);
  render();
})();
