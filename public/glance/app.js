(function () {
  'use strict';

  var PHOENIX = 'America/Phoenix';
  var COLORS = ['#8eb6ff', '#7dcea0', '#e2b15a', '#e39aab', '#c3b1f0'];
  var THEMES = [
    ['auto', 'Auto'],
    ['aurora', 'Aurora'],
    ['desert', 'Desert'],
    ['golf', 'Golf'],
    ['glass', 'Glass']
  ];
  var state = {
    settings: null,
    weather: null,
    calendar: null,
    todos: [],
    lights: null,
    family: null,
    open: false,
    googleNotice: ''
  };

  var login = document.getElementById('login');
  var board = document.getElementById('board');
  var boot = document.getElementById('boot');
  var settingsEl = document.getElementById('settings');

  function phoenixParts(date) {
    var fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: PHOENIX,
      hourCycle: 'h23',
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    var bag = {};
    fmt.formatToParts(date).forEach(function (part) { bag[part.type] = part.value; });
    var hour = Number(bag.hour);
    if (hour === 24) hour = 0;
    return {
      hour: hour,
      minute: Number(bag.minute),
      weekday: bag.weekday,
      month: bag.month,
      day: Number(bag.day)
    };
  }

  function clockText(parts, clock24) {
    var mm = String(parts.minute).padStart(2, '0');
    if (clock24) return { hh: String(parts.hour).padStart(2, '0'), mm: mm, ap: '' };
    var ap = parts.hour >= 12 ? 'PM' : 'AM';
    var h = parts.hour % 12;
    if (h === 0) h = 12;
    return { hh: String(h), mm: mm, ap: ap };
  }

  function formatWhen(iso, clock24) {
    if (!iso) return '';
    return clockText(phoenixParts(new Date(iso)), clock24).hh + ':' + clockText(phoenixParts(new Date(iso)), clock24).mm + (clock24 ? '' : ' ' + clockText(phoenixParts(new Date(iso)), clock24).ap);
  }

  function formatShort(iso, clock24) {
    var parts = phoenixParts(new Date(iso));
    var text = clockText(parts, clock24);
    return text.hh + ':' + text.mm;
  }

  async function api(path, options) {
    var opts = options || {};
    var res = await fetch(path, {
      method: opts.method || 'GET',
      credentials: 'same-origin',
      redirect: 'follow',
      headers: opts.body ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' },
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    var body = {};
    try { body = await res.json(); } catch (err) { body = {}; }
    if (res.status === 401) {
      showLogin();
      var error = new Error(body.message || 'Login required');
      error.status = 401;
      throw error;
    }
    if (!res.ok) {
      var failed = new Error(body.message || 'Request failed');
      failed.status = res.status;
      throw failed;
    }
    return body;
  }

  function showLogin() {
    boot.hidden = true;
    board.hidden = true;
    settingsEl.hidden = true;
    login.hidden = false;
    state.open = false;
    document.body.classList.remove('settings-open');
  }

  function showBoard() {
    boot.hidden = true;
    login.hidden = true;
    board.hidden = false;
  }

  function resolvedTheme() {
    var theme = (state.settings && state.settings.theme) || 'aurora';
    if (theme !== 'auto') return theme;
    var hour = phoenixParts(new Date()).hour;
    var code = state.weather && state.weather.current ? state.weather.current.code : 0;
    var isDay = state.weather && state.weather.current ? state.weather.current.isDay : hour >= 6 && hour < 19;
    if (code >= 45) return 'glass';
    if (!isDay) return 'aurora';
    if (hour >= 5 && hour < 9) return 'golf';
    if (hour >= 16 && hour < 20) return 'desert';
    return 'desert';
  }

  function applyChrome() {
    document.body.dataset.theme = resolvedTheme();
    document.body.dataset.layout = (state.settings && state.settings.layout) || 'balanced';
    var parts = phoenixParts(new Date());
    var start = state.settings ? state.settings.nightStart : 21;
    var end = state.settings ? state.settings.nightEnd : 6;
    var night = false;
    if (start !== end) {
      night = start < end ? parts.hour >= start && parts.hour < end : parts.hour >= start || parts.hour < end;
    }
    document.body.classList.toggle('is-dim', night);
    var clock24 = !!(state.settings && state.settings.clock24);
    var text = clockText(parts, clock24);
    document.getElementById('time').textContent = text.hh + ':' + text.mm;
    document.getElementById('ampm').textContent = text.ap;
    document.getElementById('date').textContent = parts.weekday + ', ' + parts.month + ' ' + parts.day;
    if (state.settings) document.getElementById('place').textContent = state.settings.locationName || 'Phoenix';
    var summary = document.getElementById('summary');
    var widgets = (state.settings && state.settings.widgets) || {};
    summary.hidden = widgets.summary === false;
    if (!summary.hidden) summary.textContent = summaryLine();
    renderCountdown();
  }

  function summaryLine() {
    var bits = [];
    var current = state.weather && state.weather.current;
    if (current) {
      bits.push(current.label + ' · ' + current.temp + '°');
      bits.push('High ' + current.high + '°');
      bits.push('Low ' + current.low + '°');
    }
    var next = state.calendar && state.calendar.upcoming;
    if (next) bits.push('Next, ' + next.title + (next.allDay ? '' : ' at ' + formatShort(next.start, state.settings && state.settings.clock24)));
    return bits.join('  ·  ') || 'A quiet day so far.';
  }

  function icon(name, isDay) {
    var night = isDay === false;
    if (name === 'clear' && night) name = 'moon';
    if (name === 'mostly' && night) name = 'moon';
    var paths = {
      clear: '<svg viewBox="0 0 32 32"><g class="ray" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M16 3.5v3M16 25.5v3M3.5 16h3M25.5 16h3M7 7l2 2M23 23l2 2M25 7l-2 2M9 23l-2 2"/></g><circle cx="16" cy="16" r="5.2" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
      mostly: '<svg viewBox="0 0 32 32"><circle cx="13" cy="13" r="4.2" fill="none" stroke="currentColor" stroke-width="1.4"/><path class="cloud" d="M12 22h10a4 4 0 0 0 .4-8 5 5 0 0 0-9.5 1.2A3.4 3.4 0 0 0 12 22z" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
      partly: '<svg viewBox="0 0 32 32"><g class="ray" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M20 5v2.4M26.5 9.5l-1.8 1.2M28 16h-2.4"/></g><circle cx="18" cy="12" r="3.4" fill="none" stroke="currentColor" stroke-width="1.3"/><path class="cloud" d="M8 23h12.5a4.2 4.2 0 0 0 .3-8.4 5.4 5.4 0 0 0-10.3 1.5A3.5 3.5 0 0 0 8 23z" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
      cloud: '<svg viewBox="0 0 32 32"><path class="cloud" d="M8 22h14a5 5 0 0 0 .4-10 6.2 6.2 0 0 0-11.8 1.6A4 4 0 0 0 8 22z" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
      rain: '<svg viewBox="0 0 32 32"><path class="cloud" d="M8 16h13a4.2 4.2 0 0 0 .2-8.4A5.5 5.5 0 0 0 10 9.2 3.6 3.6 0 0 0 8 16z" fill="none" stroke="currentColor" stroke-width="1.4"/><path class="drop" d="M12 19v5M17 20v5M22 19v4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
      snow: '<svg viewBox="0 0 32 32"><path class="cloud" d="M8 16h13a4.2 4.2 0 0 0 .2-8.4A5.5 5.5 0 0 0 10 9.2 3.6 3.6 0 0 0 8 16z" fill="none" stroke="currentColor" stroke-width="1.4"/><g fill="currentColor"><circle cx="12" cy="21" r="1"/><circle cx="17" cy="23.5" r="1"/><circle cx="22" cy="20.5" r="1"/></g></svg>',
      storm: '<svg viewBox="0 0 32 32"><path class="cloud" d="M7 16h14a4.4 4.4 0 0 0 .2-8.8A5.6 5.6 0 0 0 9.4 8.8 3.6 3.6 0 0 0 7 16z" fill="none" stroke="currentColor" stroke-width="1.4"/><path class="bolt" d="M16 17l-3 6h4l-2 6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>',
      fog: '<svg viewBox="0 0 32 32"><g class="fogline" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M6 12h20M8 17h16M6 22h18"/></g></svg>',
      wind: '<svg viewBox="0 0 32 32"><g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M5 12h14a3 3 0 1 0-3-3"/><path d="M5 17h18a3 3 0 1 1-3 3"/><path d="M5 22h10"/></g></svg>',
      moon: '<svg viewBox="0 0 32 32"><path d="M20 6.5a8.5 8.5 0 1 0 6 14.2A8.2 8.2 0 0 1 20 6.5z" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>'
    };
    return paths[name] || paths.cloud;
  }

  function compass(deg) {
    var dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return dirs[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
  }

  function renderWeather() {
    var now = document.getElementById('now');
    var forecast = document.getElementById('forecast');
    var hourly = document.getElementById('hourly');
    now.replaceChildren();
    forecast.replaceChildren();
    hourly.replaceChildren();
    if (!state.weather || !state.weather.ok) {
      now.textContent = 'Weather is taking a minute.';
      return;
    }
    var current = state.weather.current;
    var clock24 = !!(state.settings && state.settings.clock24);
    var mark = document.createElement('div');
    mark.className = 'wx';
    mark.innerHTML = icon(current.icon, current.isDay);
    var copy = document.createElement('div');
    copy.className = 'now-copy';
    var temp = document.createElement('div');
    temp.className = 'temp';
    temp.textContent = current.temp + '°';
    var cond = document.createElement('div');
    cond.className = 'cond';
    cond.textContent = current.label;
    var stats = document.createElement('div');
    stats.className = 'stats';
    var bits = [
      'H ' + current.high + '°  L ' + current.low + '°',
      'Wind ' + current.wind + ' mph ' + compass(current.windDir),
      'UV ' + current.uv
    ];
    if (current.precip > 0) bits.push('Rain ' + current.precip + '%');
    if (Math.abs(current.feels - current.temp) >= 2) bits.splice(1, 0, 'Feels ' + current.feels + '°');
    bits.forEach(function (bit) {
      var span = document.createElement('span');
      span.textContent = bit;
      stats.appendChild(span);
    });
    copy.append(temp, cond, stats);
    now.append(mark, copy);

    (state.weather.daily || []).forEach(function (day, index) {
      var card = document.createElement('article');
      card.className = 'fday';
      var name = document.createElement('b');
      name.textContent = index === 0 ? 'Today' : new Intl.DateTimeFormat('en-US', { timeZone: PHOENIX, weekday: 'short' }).format(new Date(day.date + 'T12:00:00-07:00'));
      var wx = document.createElement('div');
      wx.className = 'wx';
      wx.innerHTML = icon(day.icon, true);
      var hi = document.createElement('span');
      hi.className = 'hi';
      hi.textContent = day.high + '°';
      var lo = document.createElement('span');
      lo.textContent = day.low + '°';
      card.append(name, wx, hi, lo);
      if (day.precip >= 15) {
        var rain = document.createElement('span');
        rain.textContent = day.precip + '%';
        card.appendChild(rain);
      }
      forecast.appendChild(card);
    });

    (state.weather.hourly || []).forEach(function (hour) {
      var card = document.createElement('article');
      card.className = 'hour';
      var label = document.createElement('span');
      label.textContent = formatShort(hour.time, clock24);
      var wx = document.createElement('div');
      wx.className = 'wx';
      wx.innerHTML = icon(hour.icon, hour.isDay);
      var temp = document.createElement('b');
      temp.textContent = hour.temp + '°';
      card.append(label, wx, temp);
      if (hour.precip >= 15) {
        var rain = document.createElement('em');
        rain.textContent = hour.precip + '%';
        card.appendChild(rain);
      }
      hourly.appendChild(card);
    });
  }

  function renderDays() {
    var root = document.getElementById('days');
    root.replaceChildren();
    var calendar = state.calendar;
    if (!calendar) return;
    if (calendar.needsSetup) {
      var note = document.createElement('article');
      note.className = 'day is-today setup-only';
      var head = document.createElement('div');
      head.className = 'day-head';
      var strong = document.createElement('strong');
      strong.textContent = 'Calendar';
      head.appendChild(strong);
      var copy = document.createElement('p');
      copy.className = 'setup';
      copy.textContent = 'No calendars yet. Open settings and paste a private ICS link. The address stays on the server and is not shown here again.';
      note.append(head, copy);
      root.appendChild(note);
      return;
    }
    var clock24 = !!(state.settings && state.settings.clock24);
    var layout = document.body.dataset.layout || 'balanced';
    var limit = layout === 'today' || layout === 'home' ? 1 : layout === 'threeday' ? 3 : 7;
    (calendar.days || []).slice(0, limit).forEach(function (day) {
      var col = document.createElement('article');
      col.className = 'day' + (day.label === 'Today' ? ' is-today' : '');
      var head = document.createElement('div');
      head.className = 'day-head';
      var name = document.createElement('strong');
      name.textContent = day.label;
      var num = document.createElement('em');
      num.textContent = String(day.day);
      head.append(name, num);
      var list = document.createElement('ol');
      list.className = 'events';
      if (!day.events.length) {
        var quiet = document.createElement('p');
        quiet.className = 'quiet';
        quiet.textContent = 'Open';
        col.append(head, quiet);
      } else {
        day.events.forEach(function (event) {
          var item = document.createElement('li');
          item.className = 'event' + (event.allDay ? ' all-day' : '');
          item.style.setProperty('--feed', event.color || '#f6f3ec');
          if (!event.allDay) {
            var time = document.createElement('span');
            time.className = 'event-time';
            time.textContent = formatShort(event.start, clock24);
            item.appendChild(time);
          }
          var title = document.createElement('span');
          title.className = 'event-title';
          title.textContent = event.title;
          var feed = document.createElement('span');
          feed.className = 'feed-name';
          feed.textContent = event.feed || '';
          item.append(title, feed);
          list.appendChild(item);
        });
        col.append(head, list);
      }
      root.appendChild(col);
    });
    var failed = (calendar.feeds || []).filter(function (feed) { return !feed.ok; });
    if (failed.length) {
      var host = root.querySelector('.day') || root;
      failed.forEach(function (feed) {
        var warn = document.createElement('p');
        warn.className = 'quiet';
        warn.textContent = feed.label + ' did not refresh.';
        host.appendChild(warn);
      });
    }
  }

  function renderCountdown() {
    var card = document.getElementById('next-card');
    if (!card) return;
    var next = state.calendar && state.calendar.upcoming;
    var title = card.querySelector('.count-title');
    var when = card.querySelector('.count-when');
    if (!next) {
      title.textContent = 'Nothing ahead';
      when.textContent = '—';
      return;
    }
    title.textContent = next.title;
    if (next.started) when.textContent = 'Now';
    else {
      var delta = new Date(next.start).getTime() - Date.now();
      var mins = Math.max(0, Math.round(delta / 60000));
      if (mins < 60) when.textContent = (mins <= 1 ? '1' : String(mins)) + 'm';
      else if (mins < 60 * 48) {
        var h = Math.floor(mins / 60);
        var rem = mins % 60;
        when.textContent = rem ? h + 'h ' + rem + 'm' : h + 'h';
      } else when.textContent = Math.round(mins / 1440) + 'd';
    }
  }

  function renderRail() {
    var rail = document.getElementById('rail');
    var draft = readAddDraft();
    rail.replaceChildren();
    var widgets = (state.settings && state.settings.widgets) || { countdown: true, sun: true, air: true, summary: true, lights: true, family: true };
    renderLights(rail, widgets);
    renderFamily(rail, widgets);
    if (widgets.countdown !== false) {
      var next = document.createElement('section');
      next.className = 'rail-card';
      next.id = 'next-card';
      var h = document.createElement('h3');
      h.textContent = 'Up next';
      var title = document.createElement('p');
      title.className = 'count-title';
      var when = document.createElement('p');
      when.className = 'count-when';
      next.append(h, title, when);
      rail.appendChild(next);
      renderCountdown();
    }
    renderDayFacts(rail, widgets);
    renderAdd(rail, draft);
  }

  function renderLights(rail, widgets) {
    if (widgets.lights === false) return;
    var card = document.createElement('section');
    card.className = 'rail-card lights-card';
    var heading = document.createElement('h3');
    heading.textContent = 'Lights';
    var head = document.createElement('div');
    head.className = 'card-head';
    head.appendChild(heading);
    card.appendChild(head);
    var data = state.lights;
    if (!data || data.configured === false) {
      var quiet = document.createElement('p');
      quiet.className = 'quiet';
      quiet.textContent = (data && data.message) || 'Add the Tuya keys in settings.';
      card.appendChild(quiet);
      rail.appendChild(card);
      return;
    }
    if (data.message && !(data.lights || []).length) {
      var note = document.createElement('p');
      note.className = 'quiet';
      note.textContent = data.message;
      card.appendChild(note);
    }
    var shown = (data.lights || []).filter(function (light) { return light.enabled !== false; });
    var list = document.createElement('div');
    list.className = 'lights';
    shown.forEach(function (light) { list.appendChild(lightControl(light)); });
    card.appendChild(list);
    if (shown.length) {
      var all = document.createElement('button');
      all.type = 'button';
      all.className = 'text-btn';
      all.textContent = 'All off';
      all.disabled = !shown.some(function (light) { return light.on && light.online; });
      all.addEventListener('click', allOff);
      head.appendChild(all);
    } else if (!data.message) {
      var empty = document.createElement('p');
      empty.className = 'quiet';
      empty.textContent = 'No plugs selected.';
      card.appendChild(empty);
    }
    rail.appendChild(card);
  }

  function lightControl(light) {
    var row = document.createElement('div');
    row.className = 'light' + (light.online ? '' : ' is-offline');
    var name = document.createElement('span');
    name.className = 'light-name';
    name.textContent = light.name;
    var meta = document.createElement('span');
    meta.className = 'light-meta';
    meta.textContent = !light.online ? 'Offline' : light.on ? 'On' : 'Off';
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'switch';
    button.disabled = !light.online || !light.code;
    button.setAttribute('aria-pressed', light.on ? 'true' : 'false');
    button.setAttribute('aria-label', (light.on ? 'Turn off ' : 'Turn on ') + light.name);
    button.appendChild(document.createElement('i'));
    button.addEventListener('click', function () { toggleLight(light); });
    row.append(name, meta, button);
    return row;
  }

  async function toggleLight(light) {
    if (!light.online || !light.code) return;
    var next = !light.on;
    light.on = next;
    renderRail();
    try {
      await api('/glance/api/lights/' + encodeURIComponent(light.id), { method: 'POST', body: { on: next } });
    } catch (err) {
      light.on = !next;
      if (state.lights) state.lights.message = err.message || 'That plug did not change.';
      renderRail();
    }
  }

  async function allOff() {
    var targets = ((state.lights && state.lights.lights) || []).filter(function (light) {
      return light.enabled !== false && light.on && light.online && light.code;
    });
    targets.forEach(function (light) { light.on = false; });
    renderRail();
    await Promise.all(targets.map(function (light) {
      return api('/glance/api/lights/' + encodeURIComponent(light.id), { method: 'POST', body: { on: false } }).catch(function () {
        light.on = true;
      });
    }));
    renderRail();
  }

  function renderFamily(rail, widgets) {
    if (widgets.family === false) return;
    var card = document.createElement('section');
    card.className = 'rail-card family-card';
    var heading = document.createElement('h3');
    heading.textContent = 'Family';
    card.appendChild(heading);
    var data = state.family;
    var people = (data && data.people) || [];
    if (!people.length) {
      var quiet = document.createElement('p');
      quiet.className = 'quiet';
      quiet.textContent = 'Add your family in settings.';
      card.appendChild(quiet);
      rail.appendChild(card);
      return;
    }
    people.forEach(function (person) {
      var line = document.createElement('div');
      line.className = 'family-line';
      var dot = document.createElement('i');
      dot.style.background = person.color || '#f6f3ec';
      var copy = document.createElement('div');
      var parts = splitPhrase(person.phrase);
      var status = document.createElement('p');
      status.className = 'family-status';
      status.textContent = parts.status;
      var meta = document.createElement('p');
      meta.className = 'family-meta';
      meta.textContent = [parts.detail, person.age].filter(Boolean).join(' · ');
      copy.append(status, meta);
      line.append(dot, copy);
      card.appendChild(line);
    });
    rail.appendChild(card);
  }

  function splitPhrase(phrase) {
    var match = String(phrase || '').match(/^(.*?),\s*(\d+\s+min from home)$/);
    if (match) return { status: match[1], detail: match[2] };
    return { status: phrase || '', detail: '' };
  }

  function renderDayFacts(rail, widgets) {
    var showSun = widgets.sun !== false && state.weather && state.weather.sun;
    var showAir = widgets.air !== false && state.weather && state.weather.air;
    if (!showSun && !showAir) return;
    var card = document.createElement('section');
    card.className = 'rail-card day-facts';
    if (showSun) {
      card.appendChild(factBit('Sunrise', state.weather.sun.sunrise ? formatShort(state.weather.sun.sunrise, state.settings && state.settings.clock24) : '—'));
      card.appendChild(factBit('Sunset', state.weather.sun.sunset ? formatShort(state.weather.sun.sunset, state.settings && state.settings.clock24) : '—'));
    }
    if (showAir) {
      var aqi = state.weather.air.aqi;
      var air = factBit('Air', aqi == null ? '—' : String(aqi));
      air.querySelector('strong').className = aqi == null ? '' : aqi <= 50 ? 'aqi-good' : aqi <= 100 ? 'aqi-mid' : 'aqi-bad';
      if (state.weather.air.label) {
        var note = document.createElement('em');
        note.textContent = state.weather.air.label;
        air.appendChild(note);
      }
      card.appendChild(air);
    }
    rail.appendChild(card);
  }

  function factBit(label, value) {
    var wrap = document.createElement('div');
    wrap.className = 'fact';
    var span = document.createElement('span');
    span.textContent = label;
    var strong = document.createElement('strong');
    strong.textContent = value;
    wrap.append(span, strong);
    return wrap;
  }

  function sunBit(label, iso) {
    var wrap = document.createElement('div');
    var span = document.createElement('span');
    span.textContent = label;
    var strong = document.createElement('strong');
    strong.textContent = iso ? formatShort(iso, state.settings && state.settings.clock24) : '—';
    wrap.append(span, strong);
    return wrap;
  }

  function tiny(label, text, fn) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'tiny';
    button.setAttribute('aria-label', label);
    button.textContent = text;
    button.addEventListener('click', fn);
    return button;
  }

  function phoenixDateKey(date) {
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: PHOENIX,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date);
    var bag = {};
    parts.forEach(function (part) { bag[part.type] = part.value; });
    return bag.year + '-' + bag.month + '-' + bag.day;
  }

  function shiftDateKey(key, days) {
    var bits = key.split('-').map(Number);
    var next = new Date(Date.UTC(bits[0], bits[1] - 1, bits[2] + days));
    return next.toISOString().slice(0, 10);
  }

  function defaultStart() {
    var parts = phoenixParts(new Date());
    var hour = parts.hour;
    var minute = parts.minute < 30 ? 30 : 0;
    if (parts.minute >= 30) hour = (hour + 1) % 24;
    return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
  }

  function readAddDraft() {
    var title = document.getElementById('add-title');
    if (!title) return null;
    var pressed = document.querySelector('.add-day[aria-pressed="true"]');
    return {
      title: title.value,
      day: pressed ? pressed.dataset.day : 'today',
      date: document.getElementById('add-date').value,
      start: document.getElementById('add-start').value,
      duration: document.getElementById('add-duration').value,
      end: document.getElementById('add-end').value,
      allDay: document.getElementById('add-allday').checked
    };
  }

  function renderAdd(rail, draft) {
    var card = document.createElement('section');
    card.className = 'rail-card add-card';
    var heading = document.createElement('h3');
    heading.textContent = 'Add event';
    card.appendChild(heading);
    var google = (state.settings && state.settings.google) || {};
    var note = document.createElement('p');
    note.className = 'add-note';
    note.textContent = state.googleNotice || '';
    if (!google.connected) {
      var quiet = document.createElement('div');
      quiet.className = 'add-quiet';
      var line = document.createElement('p');
      line.className = 'add-note';
      line.textContent = 'Connect Google to add events';
      var link = document.createElement('a');
      link.className = 'add-go';
      link.href = '/glance/api/google/start';
      link.textContent = 'Connect Google Calendar';
      quiet.append(line, link);
      if (state.googleNotice) quiet.appendChild(note);
      card.appendChild(quiet);
      rail.appendChild(card);
      return;
    }
    var today = phoenixDateKey(new Date());
    var saved = draft || {};
    var form = document.createElement('form');
    var title = document.createElement('input');
    title.id = 'add-title';
    title.maxLength = 200;
    title.placeholder = 'Title';
    title.setAttribute('aria-label', 'Event title');
    title.autocapitalize = 'sentences';
    title.value = saved.title || '';
    var days = document.createElement('div');
    days.className = 'add-days';
    var chosen = saved.day || 'today';
    [['today', 'Today'], ['tomorrow', 'Tomorrow']].forEach(function (entry) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'add-day';
      button.dataset.day = entry[0];
      button.textContent = entry[1];
      button.setAttribute('aria-pressed', chosen === entry[0] ? 'true' : 'false');
      button.addEventListener('click', function () {
        days.querySelectorAll('.add-day').forEach(function (item) { item.setAttribute('aria-pressed', 'false'); });
        button.setAttribute('aria-pressed', 'true');
        date.value = entry[0] === 'today' ? today : shiftDateKey(today, 1);
      });
      days.appendChild(button);
    });
    var date = document.createElement('input');
    date.id = 'add-date';
    date.type = 'date';
    date.setAttribute('aria-label', 'Day');
    date.value = saved.date || (chosen === 'tomorrow' ? shiftDateKey(today, 1) : today);
    date.addEventListener('change', function () {
      var mode = date.value === today ? 'today' : date.value === shiftDateKey(today, 1) ? 'tomorrow' : 'date';
      days.querySelectorAll('.add-day').forEach(function (item) {
        item.setAttribute('aria-pressed', item.dataset.day === mode ? 'true' : 'false');
      });
    });
    days.appendChild(date);
    var times = document.createElement('div');
    times.className = 'add-times';
    var start = document.createElement('input');
    start.id = 'add-start';
    start.type = 'time';
    start.setAttribute('aria-label', 'Start time');
    start.value = saved.start || defaultStart();
    var duration = document.createElement('select');
    duration.id = 'add-duration';
    duration.setAttribute('aria-label', 'Duration');
    [['30', '30 min'], ['60', '1 hour'], ['90', '90 min'], ['120', '2 hours'], ['end', 'End time']].forEach(function (entry) {
      var option = document.createElement('option');
      option.value = entry[0];
      option.textContent = entry[1];
      duration.appendChild(option);
    });
    duration.value = saved.duration || '60';
    var end = document.createElement('input');
    end.id = 'add-end';
    end.type = 'time';
    end.setAttribute('aria-label', 'End time');
    end.value = saved.end || '';
    end.hidden = duration.value !== 'end';
    duration.addEventListener('change', function () { end.hidden = duration.value !== 'end'; });
    times.append(start, duration, end);
    var foot = document.createElement('div');
    foot.className = 'add-foot';
    var allday = document.createElement('label');
    allday.className = 'add-allday';
    var box = document.createElement('input');
    box.id = 'add-allday';
    box.type = 'checkbox';
    box.checked = !!saved.allDay;
    allday.append(box, document.createTextNode('All day'));
    var go = document.createElement('button');
    go.className = 'add-go';
    go.type = 'submit';
    go.textContent = 'Add';
    foot.append(allday, go);
    function syncAllDay() { times.hidden = box.checked; }
    box.addEventListener('change', syncAllDay);
    syncAllDay();
    var status = document.createElement('p');
    status.className = 'add-note';
    status.textContent = state.googleNotice || '';
    form.append(title, days, times, foot, status);
    form.addEventListener('submit', function (event) { event.preventDefault(); submitEvent(form); });
    card.appendChild(form);
    rail.appendChild(card);
  }

  function eventOnDay(day, event) {
    if (event.allDay) {
      var endDate = (event.end || '').slice(0, 10);
      return day.date >= event.date && day.date < endDate;
    }
    return day.date === event.date;
  }

  function insertOptimistic(event) {
    if (!state.calendar || !state.calendar.days || !event) return;
    state.calendar.days.forEach(function (day) {
      if (!eventOnDay(day, event)) return;
      var exists = day.events.some(function (item) { return item.title === event.title && item.start === event.start; });
      if (!exists) day.events.push(event);
      day.events.sort(function (a, b) { return Number(b.allDay) - Number(a.allDay) || String(a.start).localeCompare(String(b.start)); });
    });
    if (!event.allDay && state.calendar) {
      var start = new Date(event.start).getTime();
      var current = state.calendar.upcoming ? new Date(state.calendar.upcoming.start).getTime() : Infinity;
      if (start < current) state.calendar.upcoming = Object.assign({ started: start <= Date.now() }, event);
    }
    renderDays();
    renderCountdown();
  }

  function removeOptimistic(event) {
    if (!state.calendar || !event) return;
    state.calendar.days.forEach(function (day) {
      day.events = day.events.filter(function (item) { return !(item.title === event.title && item.start === event.start); });
    });
    renderDays();
    renderCountdown();
  }

  async function submitEvent(form) {
    var title = document.getElementById('add-title').value.trim();
    var status = form.querySelector('.add-note');
    if (!title) {
      status.textContent = 'Add a title';
      return;
    }
    var allDay = document.getElementById('add-allday').checked;
    if (!allDay && !document.getElementById('add-start').value) {
      status.textContent = 'Pick a start time';
      return;
    }
    if (!allDay && document.getElementById('add-duration').value === 'end' && !document.getElementById('add-end').value) {
      status.textContent = 'Pick an end time';
      return;
    }
    var duration = document.getElementById('add-duration').value;
    var payload = {
      title: title,
      date: document.getElementById('add-date').value,
      allDay: allDay,
      start: document.getElementById('add-start').value,
      durationMinutes: duration === 'end' ? undefined : Number(duration),
      end: duration === 'end' ? document.getElementById('add-end').value : ''
    };
    var optimistic = {
      title: title,
      allDay: allDay,
      birthday: false,
      date: payload.date,
      start: payload.date + 'T' + (allDay ? '00:00:00' : payload.start + ':00') + '-07:00',
      end: payload.date + 'T' + (allDay ? '00:00:00' : (payload.end || payload.start) + ':00') + '-07:00',
      feed: 'Personal',
      color: '#7dcea0'
    };
    if (allDay) optimistic.end = shiftDateKey(payload.date, 1) + 'T00:00:00-07:00';
    status.textContent = '';
    insertOptimistic(optimistic);
    form.classList.add('is-busy');
    try {
      var created = await api('/glance/api/events', { method: 'POST', body: payload });
      if (created.event) {
        removeOptimistic(optimistic);
        insertOptimistic(created.event);
      }
      document.getElementById('add-title').value = '';
      state.googleNotice = 'Added';
      await refresh();
      state.googleNotice = '';
    } catch (err) {
      removeOptimistic(optimistic);
      status.textContent = err.message || 'That event was not added';
    }
    var current = document.querySelector('.add-card form');
    if (current) current.classList.remove('is-busy');
  }

  function renderAll() {
    applyChrome();
    renderWeather();
    renderDays();
    renderParty();
    renderRail();
  }

  var LAYOUTS = [
    ['balanced', 'Balanced', 'Clock, weather, week, and the side rail'],
    ['calendar', 'Calendar', 'A large week, with weather kept small'],
    ['today', 'Today', 'One day, large weather, lights, and family'],
    ['threeday', '3-Day', 'Three days and a medium forecast'],
    ['home', 'Home', 'Lights and family first, calendar tucked aside']
  ];

  function renderParty() {
    var banner = document.getElementById('party');
    var board = document.getElementById('board');
    var today = ((state.calendar && state.calendar.days) || []).filter(function (day) { return day.label === 'Today'; })[0];
    var events = (today && today.events) || [];
    var names = birthdayNames(events);
    var untitled = events.some(function (event) { return isBirthdayEvent(event) && !birthdayName(event.title); });
    if (!names.length && !untitled) {
      banner.hidden = true;
      banner.replaceChildren();
      board.classList.remove('has-party');
      return;
    }
    banner.hidden = false;
    board.classList.add('has-party');
    banner.replaceChildren();
    var copy = document.createElement('p');
    copy.className = 'party-copy';
    copy.textContent = names.length ? 'Happy birthday, ' + joinNames(names) : 'Happy birthday';
    var sub = document.createElement('span');
    sub.textContent = names.length > 1 ? 'A few celebrations today' : 'Today on the calendar';
    copy.appendChild(sub);
    ['a', 'b', 'c'].forEach(function (mark) {
      var balloon = document.createElement('i');
      balloon.className = 'balloon ' + mark;
      balloon.setAttribute('aria-hidden', 'true');
      banner.appendChild(balloon);
    });
    var colors = ['#f0b4c8', '#9fd0ff', '#f3d48a', '#b7f0c8', '#e2c2ff'];
    for (var i = 0; i < 14; i++) {
      var bit = document.createElement('i');
      bit.className = 'confetti';
      bit.style.left = (6 + (i * 6.4) % 88) + '%';
      bit.style.background = colors[i % colors.length];
      bit.style.animationDelay = (i * 0.28) + 's';
      bit.setAttribute('aria-hidden', 'true');
      banner.appendChild(bit);
    }
    banner.appendChild(copy);
  }

  function isBirthdayEvent(event) {
    return !!(event && (event.birthday || /\b(?:birthdays?|b-?days?)\b/i.test(event.title || '')));
  }

  function birthdayName(title) {
    var text = String(title || '').replace(/\s+/g, ' ').trim();
    var leading = text.match(/^(.*?)(?:['’]s)?\s+(?:birthday|b-?day)\b/i);
    if (leading && leading[1].replace(/^happy\s+/i, '').trim()) return leading[1].replace(/^happy\s+/i, '').replace(/[!,.]+$/g, '').trim();
    var trailing = text.match(/\b(?:birthday|b-?day)\b[:\-\s]+(.+)/i);
    if (trailing && trailing[1].trim()) return trailing[1].replace(/[!,.]+$/g, '').trim();
    return '';
  }

  function birthdayNames(events) {
    var names = [];
    events.forEach(function (event) {
      if (!isBirthdayEvent(event)) return;
      var name = birthdayName(event.title);
      if (name && names.indexOf(name) < 0) names.push(name);
    });
    return names;
  }

  function birthdayUntitled(events) {
    return events.some(function (event) { return isBirthdayEvent(event) && !birthdayName(event.title); });
  }

  function joinNames(names) {
    if (names.length === 1) return names[0];
    if (names.length === 2) return names[0] + ' and ' + names[1];
    return names.slice(0, -1).join(', ') + ', and ' + names[names.length - 1];
  }

  function cycleLayout(step) {
    if (!state.settings || document.getElementById('board').hidden) return;
    var order = LAYOUTS.map(function (entry) { return entry[0]; });
    var current = document.body.dataset.layout || 'balanced';
    var index = order.indexOf(current);
    if (index < 0) index = 0;
    var next = order[(index + step + order.length) % order.length];
    applyLayout(next, true);
  }

  async function applyLayout(name, persist) {
    if (!state.settings) state.settings = {};
    state.settings.layout = name;
    document.body.dataset.layout = name;
    renderDays();
    renderParty();
    document.querySelectorAll('#layouts .layout-btn').forEach(function (button) {
      button.setAttribute('aria-checked', button.dataset.layout === name ? 'true' : 'false');
    });
    if (!persist) return;
    try {
      var saved = await api('/glance/api/settings', { method: 'PUT', body: { layout: name } });
      state.settings = saved;
      document.body.dataset.layout = saved.layout || name;
    } catch (error) {
      var note = document.getElementById('settings-error');
      if (note) note.textContent = error.message || 'Could not save the layout';
    }
  }

  async function refresh() {
    var results = await Promise.all([
      api('/glance/api/weather'),
      api('/glance/api/calendar'),
      api('/glance/api/lights'),
      api('/glance/api/location')
    ]);
    state.weather = results[0];
    state.calendar = results[1];
    state.lights = results[2];
    state.family = results[3];
    renderAll();
  }

  function hourOptions(select, selected) {
    select.replaceChildren();
    for (var hour = 0; hour < 24; hour++) {
      var option = document.createElement('option');
      option.value = String(hour);
      var labelHour = hour % 12 || 12;
      option.textContent = labelHour + (hour < 12 ? ' AM' : ' PM');
      if (hour === selected) option.selected = true;
      select.appendChild(option);
    }
  }

  function fillSettings() {
    var settings = state.settings;
    if (!settings) return;
    document.getElementById('set-place').value = settings.locationName || '';
    document.getElementById('set-lat').value = settings.lat;
    document.getElementById('set-lon').value = settings.lon;
    document.getElementById('set-24').checked = !!settings.clock24;
    hourOptions(document.getElementById('set-night-start'), settings.nightStart);
    hourOptions(document.getElementById('set-night-end'), settings.nightEnd);
    document.getElementById('w-summary').checked = settings.widgets.summary !== false;
    document.getElementById('w-count').checked = settings.widgets.countdown !== false;
    document.getElementById('w-sun').checked = settings.widgets.sun !== false;
    document.getElementById('w-air').checked = settings.widgets.air !== false;
    document.getElementById('w-lights').checked = settings.widgets.lights !== false;
    document.getElementById('w-family').checked = settings.widgets.family !== false;
    renderLayoutButtons(settings.layout || 'balanced');
    fillFamily();
    var tuya = settings.tuya || {};
    var accessId = document.getElementById('tuya-id');
    var accessSecret = document.getElementById('tuya-secret');
    accessId.value = '';
    accessSecret.value = '';
    accessId.placeholder = tuya.accessIdSaved ? 'Saved on the server' : 'Access ID';
    accessSecret.placeholder = tuya.accessSecretSaved ? 'Saved on the server' : 'Access secret';
    var google = settings.google || {};
    var googleStatus = document.getElementById('google-status');
    var googleConnect = document.getElementById('google-connect');
    var googleDisconnectBtn = document.getElementById('google-disconnect');
    if (googleStatus && googleConnect && googleDisconnectBtn) {
      googleStatus.textContent = google.connected
        ? 'Connected as ' + (google.account || 'your Google account') + '. New events use Basil green.'
        : (state.googleNotice || 'Connect Google to add events');
      googleConnect.hidden = !!google.connected;
      googleDisconnectBtn.hidden = !google.connected;
      var clientId = document.getElementById('google-client-id');
      var clientSecret = document.getElementById('google-client-secret');
      clientId.value = '';
      clientSecret.value = '';
      clientId.placeholder = google.clientIdSaved ? 'Saved on the server' : 'Client ID';
      clientSecret.placeholder = google.clientSecretSaved ? 'Saved on the server' : 'Client secret';
    }
    renderLightPrefs();
    var themes = document.getElementById('themes');
    themes.replaceChildren();
    THEMES.forEach(function (entry) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'theme-btn';
      button.dataset.theme = entry[0];
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-checked', settings.theme === entry[0] ? 'true' : 'false');
      var swatch = document.createElement('span');
      swatch.className = 'swatch ' + entry[0];
      var label = document.createElement('span');
      label.textContent = entry[1];
      button.append(swatch, label);
      button.addEventListener('click', function () { chooseTheme(entry[0]); });
      themes.appendChild(button);
    });
    renderFeeds();
  }

  function renderFeeds() {
    var list = document.getElementById('feed-list');
    list.replaceChildren();
    var feeds = (state.settings && state.settings.feeds) || [];
    feeds.forEach(function (feed) { list.appendChild(feedRow(feed)); });
    if (!feeds.length) list.appendChild(feedRow({ id: '', label: '', color: COLORS[0], enabled: true, saved: false }));
  }

  function feedRow(feed) {
    var row = document.createElement('div');
    row.className = 'feed';
    row.dataset.id = feed.id || '';
    row.dataset.saved = feed.saved ? '1' : '0';
    var label = document.createElement('input');
    label.className = 'feed-label';
    label.placeholder = 'Name, such as Work';
    label.value = feed.label || '';
    label.maxLength = 80;
    var url = document.createElement('input');
    url.className = 'feed-url';
    url.type = 'password';
    url.autocomplete = 'off';
    url.placeholder = feed.saved ? 'Saved on the server — paste to replace' : 'Private ICS link';
    url.spellcheck = false;
    var colors = document.createElement('div');
    colors.className = 'colors';
    var chosen = feed.color || COLORS[0];
    COLORS.forEach(function (color) {
      var dot = document.createElement('button');
      dot.type = 'button';
      dot.style.background = color;
      dot.dataset.color = color;
      dot.setAttribute('aria-label', color);
      dot.setAttribute('aria-pressed', color.toLowerCase() === String(chosen).toLowerCase() ? 'true' : 'false');
      dot.addEventListener('click', function () {
        colors.querySelectorAll('button').forEach(function (button) { button.setAttribute('aria-pressed', 'false'); });
        dot.setAttribute('aria-pressed', 'true');
      });
      colors.appendChild(dot);
    });
    var enabled = document.createElement('label');
    enabled.className = 'check';
    var box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'feed-enabled';
    box.checked = feed.enabled !== false;
    enabled.append(box, document.createTextNode('Show'));
    var remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'text-btn danger';
    remove.textContent = 'Remove';
    remove.addEventListener('click', function () { row.remove(); });
    row.append(label, url, colors, enabled, remove);
    return row;
  }

  function collectFeeds() {
    return Array.prototype.map.call(document.querySelectorAll('#feed-list .feed'), function (row) {
      var pressed = row.querySelector('.colors button[aria-pressed="true"]');
      return {
        id: row.dataset.id || undefined,
        label: row.querySelector('.feed-label').value,
        url: row.querySelector('.feed-url').value,
        color: pressed ? pressed.dataset.color : COLORS[0],
        enabled: row.querySelector('.feed-enabled').checked
      };
    }).filter(function (feed) { return feed.label.trim() || feed.url.trim() || feed.id; });
  }

  async function chooseTheme(theme) {
    state.settings.theme = theme;
    document.querySelectorAll('#themes .theme-btn').forEach(function (button) {
      button.setAttribute('aria-checked', button.dataset.theme === theme ? 'true' : 'false');
    });
    applyChrome();
    try {
      var saved = await api('/glance/api/settings', { method: 'PUT', body: { theme: theme } });
      state.settings.theme = saved.theme;
    } catch (error) {
      document.getElementById('settings-error').textContent = error.message;
    }
  }

  function openSettings() {
    state.open = true;
    settingsEl.hidden = false;
    document.body.classList.add('settings-open');
    document.body.classList.remove('idle');
    fillSettings();
  }

  function closeSettings() {
    state.open = false;
    settingsEl.hidden = true;
    document.body.classList.remove('settings-open');
  }

  async function wake() {
    try {
      if (navigator.wakeLock) await navigator.wakeLock.request('screen');
    } catch (err) { /* The display may still sleep if the browser refuses. */ }
  }

  document.getElementById('login-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    var error = document.getElementById('login-error');
    var input = document.getElementById('login-password');
    input.value = input.value.trim();
    error.textContent = '';
    try {
      await api('/glance/api/login', {
        method: 'POST',
        body: { password: input.value }
      });
      window.location.replace('/glance/');
    } catch (err) {
      error.textContent = err.message || 'Wrong password';
    }
  });

  document.getElementById('layout-next').addEventListener('click', function () { cycleLayout(1); });
  document.getElementById('gear').addEventListener('click', openSettings);
  document.getElementById('settings-close').addEventListener('click', closeSettings);
  document.getElementById('save-home').addEventListener('click', function () { saveHome(); });
  document.getElementById('save-places').addEventListener('click', function () { savePlaces(); });
  document.getElementById('add-place').addEventListener('click', function () { addPlaceRow(); });
  document.getElementById('add-person').addEventListener('click', function () { addPerson(); });
  document.getElementById('add-feed').addEventListener('click', function () {
    document.getElementById('feed-list').appendChild(feedRow({ id: '', label: '', color: COLORS[(state.settings.feeds || []).length % COLORS.length], enabled: true, saved: false }));
  });
  document.getElementById('settings-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    var error = document.getElementById('settings-error');
    error.textContent = '';
    try {
      var saved = await api('/glance/api/settings', {
        method: 'PUT',
        body: {
          locationName: document.getElementById('set-place').value,
          lat: Number(document.getElementById('set-lat').value),
          lon: Number(document.getElementById('set-lon').value),
          theme: state.settings.theme,
          clock24: document.getElementById('set-24').checked,
          nightStart: Number(document.getElementById('set-night-start').value),
          nightEnd: Number(document.getElementById('set-night-end').value),
          widgets: {
            summary: document.getElementById('w-summary').checked,
            countdown: document.getElementById('w-count').checked,
            sun: document.getElementById('w-sun').checked,
            air: document.getElementById('w-air').checked,
            lights: document.getElementById('w-lights').checked,
            family: document.getElementById('w-family').checked
          },
          feeds: collectFeeds(),
          tuyaAccessId: document.getElementById('tuya-id').value,
          tuyaAccessSecret: document.getElementById('tuya-secret').value,
          googleClientId: (document.getElementById('google-client-id') || { value: '' }).value,
          googleClientSecret: (document.getElementById('google-client-secret') || { value: '' }).value,
          lights: collectLightPrefs()
        }
      });
      state.settings = saved;
      closeSettings();
      await refresh();
    } catch (err) {
      error.textContent = err.message || 'Could not save';
    }
  });
  document.getElementById('pw-save').addEventListener('click', async function () {
    var msg = document.getElementById('pw-msg');
    msg.textContent = '';
    try {
      await api('/glance/api/password', {
        method: 'POST',
        body: {
          current: document.getElementById('pw-current').value.trim(),
          next: document.getElementById('pw-next').value.trim()
        }
      });
      document.getElementById('pw-current').value = '';
      document.getElementById('pw-next').value = '';
      msg.textContent = 'Password updated. This screen stays signed in.';
    } catch (err) {
      msg.textContent = err.message || 'Could not change the password';
    }
  });
  var googleDisconnect = document.getElementById('google-disconnect');
  if (googleDisconnect) googleDisconnect.addEventListener('click', async function () {
    var status = document.getElementById('google-status');
    try {
      state.settings = await api('/glance/api/google/disconnect', { method: 'POST', body: {} });
      status.textContent = 'Google Calendar is disconnected.';
      fillSettings();
      renderRail();
    } catch (err) {
      status.textContent = err.message || 'Could not disconnect';
    }
  });
  document.getElementById('sign-out').addEventListener('click', async function () {
    try { await api('/glance/api/logout', { method: 'POST' }); } catch (err) { /* still leave */ }
    showLogin();
  });
  document.getElementById('full').addEventListener('click', function () {
    var root = document.documentElement;
    if (document.fullscreenElement) {
      if (document.exitFullscreen) document.exitFullscreen();
      return;
    }
    var request = root.requestFullscreen || root.webkitRequestFullscreen;
    if (request) request.call(root);
  });

  var swipeX = 0;
  var swipeY = 0;
  document.getElementById('board').addEventListener('pointerdown', function (event) {
    swipeX = 0;
    if (event.target.closest('button, a, input, select, textarea, .events, .lights, .settings')) return;
    swipeX = event.clientX;
    swipeY = event.clientY;
  });
  document.getElementById('board').addEventListener('pointerup', function (event) {
    if (!swipeX) return;
    var dx = event.clientX - swipeX;
    var dy = event.clientY - swipeY;
    swipeX = 0;
    if (Math.abs(dx) < 90 || Math.abs(dx) < Math.abs(dy)) return;
    cycleLayout(dx < 0 ? 1 : -1);
  });
  document.addEventListener('keydown', function (event) {
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    var typing = event.target && /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName);
    if (typing || state.open) return;
    if (event.key === 'ArrowRight') cycleLayout(1);
    if (event.key === 'ArrowLeft') cycleLayout(-1);
  });

  function renderLayoutButtons(current) {
    var root = document.getElementById('layouts');
    if (!root) return;
    root.replaceChildren();
    LAYOUTS.forEach(function (entry) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'layout-btn';
      button.dataset.layout = entry[0];
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-checked', entry[0] === current ? 'true' : 'false');
      var name = document.createElement('strong');
      name.textContent = entry[1];
      var hint = document.createElement('small');
      hint.textContent = entry[2];
      button.append(name, hint);
      button.addEventListener('click', function () { applyLayout(entry[0], true); });
      root.appendChild(button);
    });
  }

  var idleTimer;
  function bump() {
    document.body.classList.remove('idle');
    clearTimeout(idleTimer);
    if (state.open) return;
    var typing = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if (typing) return;
    idleTimer = setTimeout(function () { document.body.classList.add('idle'); }, 4000);
  }
  ['pointermove', 'pointerdown', 'keydown'].forEach(function (name) {
    window.addEventListener(name, bump, { passive: true });
  });

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && !board.hidden) {
      wake();
      refresh().catch(function () {});
    }
  });

  async function bootApp() {
    var session = await api('/glance/api/session');
    state.settings = session;
    showBoard();
    await wake();
    await refresh();
    bump();
  }

  setInterval(function () {
    if (!board.hidden) applyChrome();
  }, 1000);
  setInterval(function () {
    if (!board.hidden) refresh().catch(function () {});
  }, 5 * 60 * 1000);
  setInterval(function () {
    if (board.hidden) return;
    api('/glance/api/lights').then(function (body) {
      state.lights = body;
      renderRail();
    }).catch(function () {});
  }, 30000);

  function fillFamily() {
    var data = state.family || {};
    var home = data.home;
    document.getElementById('home-lat').value = home ? home.lat : '';
    document.getElementById('home-lon').value = home ? home.lon : '';
    document.getElementById('home-radius').value = home ? home.radiusM : 120;
    document.getElementById('stale-hours').value = data.staleHours || 6;
    var list = document.getElementById('place-list');
    list.replaceChildren();
    (data.places || []).forEach(function (place) { list.appendChild(placeRow(place)); });
    var people = document.getElementById('people-list');
    people.replaceChildren();
    (data.people || []).forEach(function (person) {
      var row = document.createElement('div');
      row.className = 'light-pref';
      var swatch = document.createElement('i');
      swatch.style.background = person.color;
      swatch.style.width = '0.7rem';
      swatch.style.height = '0.7rem';
      swatch.style.borderRadius = '50%';
      var name = document.createElement('span');
      name.textContent = person.name;
      var fresh = document.createElement('button');
      fresh.type = 'button';
      fresh.className = 'text-btn';
      fresh.textContent = 'New token';
      fresh.addEventListener('click', function () { rotatePerson(person.id); });
      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'text-btn danger';
      remove.textContent = 'Remove';
      remove.addEventListener('click', function () { removePerson(person.id); });
      row.append(swatch, name, fresh, remove);
      people.appendChild(row);
    });
  }

  function placeRow(place) {
    var row = document.createElement('div');
    row.className = 'feed place-row';
    if (place) {
      row.dataset.lat = place.lat;
      row.dataset.lon = place.lon;
    }
    var name = document.createElement('input');
    name.className = 'feed-label place-name';
    name.placeholder = 'Work';
    name.value = place ? place.name : '';
    var address = document.createElement('input');
    address.className = 'feed-label place-address';
    address.placeholder = 'Address, or leave blank to keep the saved point';
    var radius = document.createElement('input');
    radius.className = 'feed-label place-radius';
    radius.inputMode = 'numeric';
    radius.placeholder = 'Radius in meters';
    radius.value = place ? place.radiusM : 200;
    var remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'text-btn danger';
    remove.textContent = 'Remove';
    remove.addEventListener('click', function () { row.remove(); });
    row.append(name, address, radius, remove);
    return row;
  }

  function addPlaceRow() {
    document.getElementById('place-list').appendChild(placeRow(null));
  }

  function homePayload() {
    var lat = document.getElementById('home-lat').value.trim();
    var lon = document.getElementById('home-lon').value.trim();
    var address = document.getElementById('home-address').value.trim();
    var radius = Number(document.getElementById('home-radius').value);
    if (!address && !lat && !lon) return null;
    var body = { radius: radius };
    if (address) body.address = address;
    else if (lat && lon) {
      body.lat = Number(lat);
      body.lon = Number(lon);
    }
    return body;
  }

  function placePayload() {
    return Array.prototype.map.call(document.querySelectorAll('#place-list .place-row'), function (row) {
      var body = {
        name: row.querySelector('.place-name').value,
        address: row.querySelector('.place-address').value,
        radius: Number(row.querySelector('.place-radius').value)
      };
      if (!body.address && row.dataset.lat) {
        body.lat = Number(row.dataset.lat);
        body.lon = Number(row.dataset.lon);
      }
      return body;
    }).filter(function (place) { return place.name.trim() || place.address.trim(); });
  }

  async function saveHome() {
    var error = document.getElementById('settings-error');
    error.textContent = '';
    try {
      state.family = await api('/glance/api/location/places', {
        method: 'PUT',
        body: { home: homePayload(), staleHours: Number(document.getElementById('stale-hours').value) }
      });
      document.getElementById('home-address').value = '';
      fillFamily();
      renderRail();
    } catch (err) {
      error.textContent = err.message || 'Could not save home';
    }
  }

  async function savePlaces() {
    var error = document.getElementById('settings-error');
    error.textContent = '';
    try {
      state.family = await api('/glance/api/location/places', {
        method: 'PUT',
        body: { places: placePayload(), staleHours: Number(document.getElementById('stale-hours').value) }
      });
      fillFamily();
      renderRail();
    } catch (err) {
      error.textContent = err.message || 'Could not save places';
    }
  }

  async function addPerson() {
    var error = document.getElementById('settings-error');
    error.textContent = '';
    var name = document.getElementById('person-name').value.trim();
    if (!name) {
      error.textContent = 'Name the person first';
      return;
    }
    try {
      var created = await api('/glance/api/location/people', {
        method: 'POST',
        body: { name: name, color: COLORS[((state.family && state.family.people) || []).length % COLORS.length] }
      });
      document.getElementById('person-name').value = '';
      showPersonSetup(created);
      state.family = await api('/glance/api/location');
      fillFamily();
      renderRail();
    } catch (err) {
      error.textContent = err.message || 'Could not add that person';
    }
  }

  async function rotatePerson(id) {
    var error = document.getElementById('settings-error');
    error.textContent = '';
    try {
      showPersonSetup(await api('/glance/api/location/people/' + id + '/token', { method: 'POST', body: {} }));
    } catch (err) {
      error.textContent = err.message || 'Could not replace the token';
    }
  }

  async function removePerson(id) {
    await api('/glance/api/location/people/' + id, { method: 'DELETE' });
    state.family = await api('/glance/api/location');
    fillFamily();
    renderRail();
  }

  function showPersonSetup(created) {
    var box = document.getElementById('person-setup');
    box.hidden = false;
    box.replaceChildren();
    var title = document.createElement('p');
    title.className = 'hint';
    title.textContent = 'Copy this into OwnTracks now. It will not be shown again.';
    var token = document.createElement('p');
    token.textContent = created.token;
    var link = document.createElement('a');
    link.href = created.owntracks.link;
    link.textContent = 'Open in OwnTracks';
    var url = document.createElement('p');
    url.className = 'hint';
    url.textContent = created.owntracks.url;
    var user = document.createElement('p');
    user.className = 'hint';
    user.textContent = 'User ' + created.owntracks.username + ' · password is the token';
    box.append(title, token, user, url, link);
  }

  function renderLightPrefs() {
    var list = document.getElementById('light-list');
    if (!list) return;
    list.replaceChildren();
    var lights = (state.lights && state.lights.lights) || [];
    lights.forEach(function (light, index) {
      var row = document.createElement('div');
      row.className = 'light-pref';
      row.dataset.id = light.id;
      var enabled = document.createElement('input');
      enabled.type = 'checkbox';
      enabled.className = 'light-enabled';
      enabled.checked = light.enabled !== false;
      enabled.setAttribute('aria-label', 'Show ' + light.name);
      var name = document.createElement('input');
      name.className = 'feed-label light-label';
      name.value = light.name || '';
      name.maxLength = 80;
      var up = tiny('Move plug up', '↑', function () { moveLightPref(index, -1); });
      var down = tiny('Move plug down', '↓', function () { moveLightPref(index, 1); });
      row.append(enabled, name, up, down);
      list.appendChild(row);
    });
    if (!lights.length && state.lights && state.lights.message && state.lights.configured) {
      var note = document.createElement('p');
      note.className = 'hint';
      note.textContent = state.lights.message;
      list.appendChild(note);
    }
  }

  function collectLightPrefs() {
    return Array.prototype.map.call(document.querySelectorAll('#light-list .light-pref'), function (row) {
      return {
        id: row.dataset.id,
        label: row.querySelector('.light-label').value,
        enabled: row.querySelector('.light-enabled').checked
      };
    });
  }

  function moveLightPref(index, delta) {
    var lights = (state.lights && state.lights.lights) || [];
    var next = index + delta;
    if (!lights.length || next < 0 || next >= lights.length) return;
    var current = collectLightPrefs();
    var moved = current[index];
    current.splice(index, 1);
    current.splice(next, 0, moved);
    state.lights.lights = current.map(function (row, order) {
      var original = lights.find(function (light) { return light.id === row.id; }) || {};
      return Object.assign({}, original, { name: row.label, enabled: row.enabled, sortOrder: order });
    });
    renderLightPrefs();
  }

  var googleCode = new URLSearchParams(window.location.search).get('google');
  if (googleCode) {
    var googleMessages = {
      connected: 'Google Calendar is connected.',
      denied: 'Google was not connected.',
      expired: 'That connection link expired. Try again from settings.',
      account: 'Connect max.teeple@gmail.com. That was a different Google account.',
      setup: 'Add the Google client ID and secret in settings, or store them as Worker secrets.',
      login: 'Sign in, then connect Google Calendar.',
      error: 'Google could not be connected. Try again from settings.'
    };
    state.googleNotice = googleMessages[googleCode] || googleMessages.error;
    if (googleCode === 'login') document.getElementById('login-error').textContent = state.googleNotice;
    history.replaceState({}, '', '/glance/');
  }

  bootApp().then(function () {
    if (googleCode === 'setup' || googleCode === 'connected' || googleCode === 'account' || googleCode === 'error') openSettings();
  }).catch(function (error) {
    if (!error || error.status !== 401) showLogin();
  });
})();
