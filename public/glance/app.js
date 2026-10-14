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
    open: false
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
      headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
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
    (calendar.days || []).forEach(function (day) {
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
    var draft = '';
    var existing = document.getElementById('todo-input');
    if (existing) draft = existing.value;
    rail.replaceChildren();
    var widgets = (state.settings && state.settings.widgets) || { countdown: true, sun: true, air: true, summary: true, lights: true };
    renderLights(rail, widgets);
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
    if (widgets.sun !== false && state.weather && state.weather.sun) {
      var sun = document.createElement('section');
      sun.className = 'rail-card';
      var sh = document.createElement('h3');
      sh.textContent = 'Sun';
      var row = document.createElement('div');
      row.className = 'sun-row';
      row.append(sunBit('Sunrise', state.weather.sun.sunrise), sunBit('Sunset', state.weather.sun.sunset));
      sun.append(sh, row);
      rail.appendChild(sun);
    }
    if (widgets.air !== false && state.weather && state.weather.air) {
      var air = document.createElement('section');
      air.className = 'rail-card';
      var ah = document.createElement('h3');
      ah.textContent = 'Air';
      var arow = document.createElement('div');
      arow.className = 'air-row';
      var value = document.createElement('div');
      var label = document.createElement('span');
      label.textContent = 'US AQI';
      var strong = document.createElement('strong');
      var aqi = state.weather.air.aqi;
      strong.textContent = aqi == null ? '—' : String(aqi);
      strong.className = aqi == null ? '' : aqi <= 50 ? 'aqi-good' : aqi <= 100 ? 'aqi-mid' : 'aqi-bad';
      value.append(label, strong);
      var word = document.createElement('div');
      var wlabel = document.createElement('span');
      wlabel.textContent = 'Now';
      var wstrong = document.createElement('strong');
      wstrong.textContent = state.weather.air.label || '';
      word.append(wlabel, wstrong);
      arow.append(value, word);
      air.append(ah, arow);
      rail.appendChild(air);
    }
    var todos = document.createElement('section');
    todos.className = 'rail-card todos-card';
    var th = document.createElement('h3');
    th.textContent = 'To-dos';
    var list = document.createElement('ul');
    list.className = 'todos';
    if (!state.todos.length) {
      var empty = document.createElement('p');
      empty.className = 'quiet';
      empty.textContent = 'Nothing waiting.';
      todos.append(th, empty);
    } else {
      state.todos.forEach(function (todo, index) {
        var li = document.createElement('li');
        if (todo.done) li.className = 'done';
        var check = document.createElement('button');
        check.type = 'button';
        check.className = 'check';
        check.setAttribute('aria-pressed', todo.done ? 'true' : 'false');
        check.setAttribute('aria-label', todo.done ? 'Mark not done' : 'Mark done');
        check.textContent = todo.done ? '✓' : '';
        check.addEventListener('click', function () { toggleTodo(todo); });
        var title = document.createElement('span');
        title.className = 'todo-title';
        title.textContent = todo.title;
        var up = tiny('Move up', '↑', function () { moveTodo(index, -1); });
        var down = tiny('Move down', '↓', function () { moveTodo(index, 1); });
        var del = tiny('Delete', '×', function () { deleteTodo(todo); });
        li.append(check, title, up, down, del);
        list.appendChild(li);
      });
      todos.append(th, list);
    }
    var form = document.createElement('form');
    form.className = 'todo-form';
    var input = document.createElement('input');
    input.id = 'todo-input';
    input.placeholder = 'Add a to-do';
    input.maxLength = 200;
    input.value = draft;
    input.setAttribute('aria-label', 'New to-do');
    var add = document.createElement('button');
    add.type = 'submit';
    add.textContent = 'Add';
    form.append(input, add);
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      addTodo(input.value);
    });
    todos.appendChild(form);
    rail.appendChild(todos);
  }

  function renderLights(rail, widgets) {
    if (widgets.lights === false) return;
    var card = document.createElement('section');
    card.className = 'rail-card lights-card';
    var heading = document.createElement('h3');
    heading.textContent = 'Lights';
    card.appendChild(heading);
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
    if (!shown.length && !data.message) {
      var empty = document.createElement('p');
      empty.className = 'quiet';
      empty.textContent = 'No plugs selected.';
      card.appendChild(empty);
    }
    if (shown.some(function (light) { return light.on && light.online; })) {
      var all = document.createElement('button');
      all.type = 'button';
      all.className = 'text-btn';
      all.textContent = 'All off';
      all.addEventListener('click', allOff);
      card.appendChild(all);
    }
    rail.appendChild(card);
  }

  function lightControl(light) {
    var row = document.createElement('div');
    row.className = 'light' + (light.online ? '' : ' is-offline');
    var copy = document.createElement('div');
    var name = document.createElement('div');
    name.className = 'light-name';
    name.textContent = light.name;
    var meta = document.createElement('div');
    meta.className = 'light-meta';
    meta.textContent = !light.online ? 'Offline' : light.on ? 'On' : 'Off';
    copy.append(name, meta);
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'switch';
    button.disabled = !light.online || !light.code;
    button.setAttribute('aria-pressed', light.on ? 'true' : 'false');
    button.setAttribute('aria-label', (light.on ? 'Turn off ' : 'Turn on ') + light.name);
    button.appendChild(document.createElement('i'));
    button.addEventListener('click', function () { toggleLight(light); });
    row.append(copy, button);
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

  async function toggleTodo(todo) {
    await api('/glance/api/todos/' + todo.id, { method: 'PATCH', body: { done: !todo.done } });
    await loadTodos();
  }

  async function deleteTodo(todo) {
    await api('/glance/api/todos/' + todo.id, { method: 'DELETE' });
    await loadTodos();
  }

  async function moveTodo(index, delta) {
    var next = index + delta;
    if (next < 0 || next >= state.todos.length) return;
    var ids = state.todos.map(function (todo) { return todo.id; });
    var swap = ids[index];
    ids[index] = ids[next];
    ids[next] = swap;
    var body = await api('/glance/api/todos/reorder', { method: 'POST', body: { ids: ids } });
    state.todos = body.todos || [];
    renderRail();
  }

  async function addTodo(title) {
    var clean = title.trim();
    if (!clean) return;
    await api('/glance/api/todos', { method: 'POST', body: { title: clean } });
    var input = document.getElementById('todo-input');
    if (input) input.value = '';
    await loadTodos();
  }

  async function loadTodos() {
    var body = await api('/glance/api/todos');
    state.todos = body.todos || [];
    renderRail();
  }

  function renderAll() {
    applyChrome();
    renderWeather();
    renderDays();
    renderRail();
  }

  async function refresh() {
    var results = await Promise.all([
      api('/glance/api/weather'),
      api('/glance/api/calendar'),
      api('/glance/api/todos'),
      api('/glance/api/lights')
    ]);
    state.weather = results[0];
    state.calendar = results[1];
    state.todos = results[2].todos || [];
    state.lights = results[3];
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
    var tuya = settings.tuya || {};
    var accessId = document.getElementById('tuya-id');
    var accessSecret = document.getElementById('tuya-secret');
    accessId.value = '';
    accessSecret.value = '';
    accessId.placeholder = tuya.accessIdSaved ? 'Saved on the server' : 'Access ID';
    accessSecret.placeholder = tuya.accessSecretSaved ? 'Saved on the server' : 'Access secret';
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
    error.textContent = '';
    try {
      await api('/glance/api/login', {
        method: 'POST',
        body: { password: document.getElementById('login-password').value }
      });
      document.getElementById('login-password').value = '';
      await bootApp();
    } catch (err) {
      error.textContent = err.message || 'Wrong password';
    }
  });

  document.getElementById('gear').addEventListener('click', openSettings);
  document.getElementById('settings-close').addEventListener('click', closeSettings);
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
            lights: document.getElementById('w-lights').checked
          },
          feeds: collectFeeds(),
          tuyaAccessId: document.getElementById('tuya-id').value,
          tuyaAccessSecret: document.getElementById('tuya-secret').value,
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
          current: document.getElementById('pw-current').value,
          next: document.getElementById('pw-next').value
        }
      });
      document.getElementById('pw-current').value = '';
      document.getElementById('pw-next').value = '';
      msg.textContent = 'Password updated. This screen stays signed in.';
    } catch (err) {
      msg.textContent = err.message || 'Could not change the password';
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

  bootApp().catch(function (error) {
    if (!error || error.status !== 401) showLogin();
  });
})();
