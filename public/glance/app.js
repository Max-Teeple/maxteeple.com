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
  var DEFAULT_LAYOUT = 'fiveday';
  var state = {
    settings: null,
    weather: null,
    calendar: null,
    todos: [],
    lights: null,
    family: null,
    open: false,
    googleNotice: '',
    layoutReady: false,
    slides: false
  };
  var photos = [];
  var slideIdle = 0;
  var slideTimer = 0;
  var slideOrder = [];
  var slideIndex = 0;
  var slideSlot = 0;
  var slidePreload = null;

  function savedTheme() {
    try {
      var raw = localStorage.getItem('glance-view') || sessionStorage.getItem('glance-view');
      var saved = JSON.parse(raw || 'null');
      return saved && saved.theme ? saved.theme : '';
    } catch (err) {
      return '';
    }
  }

  function rememberView(theme) {
    var view = { layout: DEFAULT_LAYOUT, theme: theme || 'auto' };
    try {
      var raw = JSON.stringify(view);
      sessionStorage.setItem('glance-view', raw);
      localStorage.setItem('glance-view', raw);
      localStorage.removeItem('glance-layout');
    } catch (err) { /* private mode still shows five-day */ }
  }

  document.body.dataset.layout = DEFAULT_LAYOUT;
  var openingTheme = savedTheme();
  if (openingTheme && openingTheme !== 'auto') document.body.dataset.theme = openingTheme;
  rememberView(openingTheme);

  var login = document.getElementById('login');
  var board = document.getElementById('board');
  var boot = document.getElementById('boot');
  var settingsEl = null;
  var weekEl = null;
  var panelsMounted = false;

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

  function formatShort(iso, clock24) {
    var parts = phoenixParts(new Date(iso));
    var text = clockText(parts, clock24);
    return text.hh + ':' + text.mm;
  }

  function formatHourChip(iso, clock24) {
    var parts = phoenixParts(new Date(iso));
    if (clock24) return String(parts.hour).padStart(2, '0');
    var h = parts.hour % 12;
    if (h === 0) h = 12;
    return h + (parts.hour >= 12 ? 'p' : 'a');
  }

  function hourCondition(hour) {
    if (hour && hour.label) return hour.label;
    var name = hour && hour.icon;
    if (hour && hour.isDay === false && (name === 'clear' || name === 'mostly')) return 'Clear';
    var names = {
      clear: 'Clear',
      mostly: 'Mostly clear',
      partly: 'Partly cloudy',
      cloud: 'Cloudy',
      rain: 'Rain',
      snow: 'Snow',
      storm: 'Thunderstorm',
      fog: 'Fog',
      wind: 'Windy'
    };
    return names[name] || '';
  }

  function hourTitle(hour, clock24) {
    var when = formatNowLabel(new Date(hour.time), clock24);
    var bits = [when];
    var condition = hourCondition(hour);
    if (condition) bits.push(condition);
    bits.push(hour.temp + '°');
    if (hour.precip > 0) bits.push(hour.precip + '% rain');
    return bits.join(' · ');
  }

  function formatNowLabel(date, clock24) {
    var text = clockText(phoenixParts(date), !!clock24);
    return text.hh + ':' + text.mm + (text.ap ? ' ' + text.ap : '');
  }

  function formatRange(event, clock24) {
    if (!event || event.allDay) return 'All day';
    var start = clockText(phoenixParts(new Date(event.start)), !!clock24);
    var end = clockText(phoenixParts(new Date(event.end)), !!clock24);
    var dash = '–';
    if (clock24) return start.hh + ':' + start.mm + dash + end.hh + ':' + end.mm;
    if (start.ap === end.ap) return start.hh + ':' + start.mm + dash + end.hh + ':' + end.mm + ' ' + end.ap;
    return start.hh + ':' + start.mm + ' ' + start.ap + dash + end.hh + ':' + end.mm + ' ' + end.ap;
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
    hideSlideshow();
    boot.hidden = true;
    board.hidden = true;
    if (settingsEl) settingsEl.hidden = true;
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
    document.body.dataset.layout = (state.settings && state.settings.layout) || DEFAULT_LAYOUT;
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
    renderNextLine();
  }

  function summaryLine() {
    var bits = [];
    var current = state.weather && state.weather.current;
    if (current) {
      bits.push(current.label + ' · ' + current.temp + '°');
      bits.push('High ' + current.high + '°');
      bits.push('Low ' + current.low + '°');
    }
    return bits.join('  ·  ') || 'A quiet day so far.';
  }

  function renderNextLine() {
    var line = document.getElementById('next-line');
    if (!line) return;
    var widgets = (state.settings && state.settings.widgets) || {};
    var next = state.calendar && state.calendar.upcoming;
    if (widgets.countdown === false || !next) {
      line.hidden = true;
      line.textContent = '';
      return;
    }
    line.hidden = false;
    line.textContent = 'Next, ' + next.title + (next.allDay ? '' : ', ' + formatRange(next, state.settings && state.settings.clock24));
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
    copy.append(temp, cond);
    var main = document.createElement('div');
    main.className = 'now-main';
    main.append(mark, copy);
    var details = document.createElement('div');
    details.className = 'now-details';
    [
      ['High', current.high + '°'],
      ['Low', current.low + '°'],
      ['Feels', current.feels + '°'],
      ['Wind', current.wind + ' mph ' + compass(current.windDir)],
      ['UV', String(current.uv)]
    ].forEach(function (pair) { details.appendChild(statBit(pair[0], pair[1])); });
    if (current.precip > 0) details.appendChild(statBit('Rain', current.precip + '%'));
    now.append(main, details);
    var facts = weatherFacts(clock24);
    if (facts) now.appendChild(facts);

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
      var detail = hourTitle(hour, clock24);
      card.title = detail;
      card.setAttribute('aria-label', detail);
      var when = document.createElement('span');
      when.className = 'hour-line';
      var label = document.createElement('span');
      label.className = 'hour-time';
      label.textContent = formatHourChip(hour.time, clock24);
      var wx = document.createElement('div');
      wx.className = 'wx';
      wx.setAttribute('aria-hidden', 'true');
      wx.innerHTML = icon(hour.icon, hour.isDay);
      when.append(label, wx);
      var read = document.createElement('span');
      read.className = 'hour-line';
      var temp = document.createElement('b');
      temp.textContent = hour.temp + '°';
      read.appendChild(temp);
      if (hour.precip > 0) {
        var rain = document.createElement('em');
        rain.textContent = hour.precip + '%';
        read.appendChild(rain);
      }
      card.append(when, read);
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
    var layout = document.body.dataset.layout || DEFAULT_LAYOUT;
    var limit = layout === 'today' || layout === 'home' ? 1 : layout === 'threeday' ? 3 : layout === 'fiveday' ? 5 : 7;
    (calendar.days || []).slice(0, limit).forEach(function (day) {
      var col = document.createElement('article');
      col.className = 'day' + (day.label === 'Today' || day.date === phoenixDateKey(new Date()) ? ' is-today' : '');
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
        day.events.forEach(function (event) { list.appendChild(paintEvent(event, clock24)); });
        col.append(head, list);
      }
      root.appendChild(col);
    });
    syncTodayColumns(root);
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

  function renderRail() {
    var rail = document.getElementById('rail');
    var draft = readAddDraft();
    rail.replaceChildren();
    var widgets = (state.settings && state.settings.widgets) || { countdown: true, sun: true, air: true, summary: true, lights: true, family: true };
    renderLights(rail, widgets);
    renderFamily(rail, widgets);
    renderAdd(rail, draft);
    renderVerse(rail);
  }

  function paintEvent(event, clock24) {
    var item = document.createElement('li');
    item.className = 'event' + (event.allDay ? ' all-day' : '');
    item.style.setProperty('--feed', event.color || '#f6f3ec');
    item.dataset.start = event.start || '';
    item.dataset.end = event.end || '';
    if (event.allDay) item.dataset.allDay = '1';
    item.tabIndex = 0;
    item.setAttribute('role', 'button');
    item.setAttribute('aria-label', (event.title || 'Event') + ', details');
    var time = document.createElement('span');
    time.className = 'event-time';
    time.textContent = formatRange(event, clock24);
    var title = document.createElement('span');
    title.className = 'event-title';
    title.textContent = event.title;
    var feed = document.createElement('span');
    feed.className = 'feed-name';
    feed.textContent = event.feed || '';
    item.append(time, title, feed);
    item.addEventListener('click', function () { openEvent(event); });
    item.addEventListener('keydown', function (keyEvent) {
      if (keyEvent.key !== 'Enter' && keyEvent.key !== ' ') return;
      keyEvent.preventDefault();
      openEvent(event);
    });
    return item;
  }

  function renderVerse(rail) {
    rail.appendChild(verseCard());
    var today = phoenixDateKey(new Date());
    if (!state.verse || state.verse.date !== today) ensureVerse();
  }

  function verseCard() {
    var card = document.createElement('section');
    card.className = 'rail-card verse-card';
    var head = document.createElement('div');
    head.className = 'verse-head';
    var heading = document.createElement('h3');
    heading.textContent = "Today's Verse";
    var open = document.createElement('button');
    open.type = 'button';
    open.className = 'verse-open';
    open.setAttribute('aria-label', 'Open verse');
    open.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M10 7h7v7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    head.append(heading, open);
    var ref = document.createElement('p');
    ref.className = 'verse-ref';
    var theme = document.createElement('p');
    theme.className = 'verse-theme';
    var verse = state.verse;
    if (verse && verse.reference) {
      ref.textContent = verse.reference;
      theme.textContent = verse.theme || '';
      card.addEventListener('click', openVerse);
    } else {
      ref.textContent = 'Loading verse';
    }
    card.append(head, ref, theme);
    return card;
  }

  var verseLoad = '';
  async function ensureVerse() {
    var today = phoenixDateKey(new Date());
    if (state.verse && state.verse.date === today) return;
    if (verseLoad === today) return;
    verseLoad = today;
    try {
      var summary = await api('/glance/api/verse');
      state.verse = { date: summary.date, reference: summary.reference, theme: summary.theme };
      var rail = document.getElementById('rail');
      var current = rail && rail.querySelector('.verse-card');
      if (current) current.replaceWith(verseCard());
    } catch (err) {
      verseLoad = '';
    }
  }

  var sheetNode;
  function overlay() {
    if (sheetNode) return sheetNode;
    var root = document.createElement('div');
    root.className = 'sheet';
    root.hidden = true;
    root.addEventListener('click', function (event) {
      if (event.target === root) closeSheet();
    });
    var panel = document.createElement('section');
    panel.className = 'sheet-card';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'sheet-close';
    close.textContent = 'Close';
    close.addEventListener('click', closeSheet);
    var body = document.createElement('div');
    body.className = 'sheet-body';
    panel.append(close, body);
    root.appendChild(panel);
    document.body.appendChild(root);
    sheetNode = { root: root, panel: panel, body: body };
    return sheetNode;
  }

  function openVerse() {
    var verse = state.verse;
    if (!verse || !verse.reference) return;
    paintVerse(verse);
    showSheet();
    if (verse.text) return;
    api('/glance/api/verse?full=1').then(function (full) {
      if (!full || !state.verse || full.date !== state.verse.date) return;
      state.verse = full;
      if (sheetNode && !sheetNode.root.hidden && sheetNode.panel.getAttribute('aria-label') === "Today's Verse") paintVerse(full);
    }).catch(function () { /* the reference stays up */ });
  }

  function paintVerse(verse) {
    var node = overlay();
    node.panel.setAttribute('aria-label', "Today's Verse");
    node.body.replaceChildren();
    var title = document.createElement('h2');
    title.textContent = "Today's Verse";
    var ref = document.createElement('p');
    ref.className = 'sheet-kicker';
    ref.textContent = verse.reference + ' (WEB) · ' + (verse.theme || '');
    node.body.append(title, ref);
    if (!verse.text) return;
    var text = document.createElement('p');
    text.className = 'verse-text';
    text.textContent = verse.text;
    var copy = document.createElement('p');
    copy.className = 'verse-devotional';
    copy.textContent = verse.devotional || '';
    node.body.append(text, copy);
  }

  function openEvent(event) {
    var node = overlay();
    node.panel.setAttribute('aria-label', 'Event');
    var body = node.body;
    body.replaceChildren();
    var title = document.createElement('h2');
    title.textContent = event.title || 'Event';
    var when = document.createElement('p');
    when.className = 'sheet-kicker';
    when.textContent = formatRange(event, !!(state.settings && state.settings.clock24)) + (event.feed ? ' · ' + event.feed : '');
    body.append(title, when);
    if (event.masked) {
      var quiet = document.createElement('p');
      quiet.className = 'verse-devotional';
      quiet.textContent = 'Details stay on the work calendar.';
      body.appendChild(quiet);
    } else {
      if (event.location) body.appendChild(detailLine('Where', event.location));
      if (event.description) body.appendChild(detailLine('Notes', event.description));
      (event.links || []).forEach(function (link) {
        var a = document.createElement('a');
        a.className = 'event-link';
        a.href = link;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = link.replace(/^https:\/\//, '');
        body.appendChild(a);
      });
      if (event.deletable && event.googleId) body.appendChild(deleteControl(event));
    }
    showSheet();
  }

  function detailLine(label, value) {
    var row = document.createElement('p');
    row.className = 'event-detail';
    var name = document.createElement('span');
    name.textContent = label;
    var text = document.createElement('span');
    text.textContent = value;
    row.append(name, text);
    return row;
  }

  function deleteControl(event) {
    var box = document.createElement('div');
    box.className = 'event-delete';
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'danger-btn';
    button.textContent = 'Delete';
    var cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'text-btn';
    cancel.textContent = 'Cancel';
    cancel.hidden = true;
    var note = document.createElement('p');
    note.className = 'add-note';
    button.addEventListener('click', async function () {
      if (!box.classList.contains('is-confirm')) {
        box.classList.add('is-confirm');
        button.textContent = 'Confirm delete';
        cancel.hidden = false;
        note.textContent = 'Delete this event from Google Calendar?';
        return;
      }
      button.disabled = true;
      try {
        await api('/glance/api/events/' + encodeURIComponent(event.googleId) + '?title=' + encodeURIComponent(event.title || ''), { method: 'DELETE' });
        closeSheet();
        await refreshCalendar();
        if (weekEl && !weekEl.hidden) await loadWeek();
      } catch (err) {
        button.disabled = false;
        note.textContent = err.message || 'That event was not deleted';
      }
    });
    cancel.addEventListener('click', function () {
      box.classList.remove('is-confirm');
      button.textContent = 'Delete';
      cancel.hidden = true;
      note.textContent = '';
    });
    box.append(button, cancel, note);
    return box;
  }

  function showSheet() {
    var root = overlay().root;
    root.hidden = false;
    root.classList.add('is-on');
  }

  function closeSheet() {
    if (!sheetNode) return;
    sheetNode.root.classList.remove('is-on');
    sheetNode.root.hidden = true;
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
    if (data.schedule) {
      var schedule = document.createElement('p');
      schedule.className = 'light-schedule';
      schedule.textContent = data.schedule;
      card.appendChild(schedule);
    }
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
      var status = document.createElement('p');
      status.className = 'family-status';
      status.textContent = person.phrase || '';
      var meta = document.createElement('p');
      meta.className = 'family-meta';
      var detail = [];
      if (person.minutes > 0) detail.push(person.minutes + ' min from home');
      if (person.age) detail.push(person.age);
      meta.textContent = detail.join(' · ');
      copy.append(status, meta);
      line.append(dot, copy);
      card.appendChild(line);
    });
    rail.appendChild(card);
  }

  function weatherFacts(clock24) {
    var widgets = (state.settings && state.settings.widgets) || {};
    var showSun = widgets.sun !== false && state.weather && state.weather.sun;
    var showAir = widgets.air !== false && state.weather && state.weather.air;
    if (!showSun && !showAir) return null;
    var row = document.createElement('div');
    row.className = 'now-facts';
    if (showSun) {
      row.appendChild(factBit('Sunrise', state.weather.sun.sunrise ? formatShort(state.weather.sun.sunrise, clock24) : '—'));
      row.appendChild(factBit('Sunset', state.weather.sun.sunset ? formatShort(state.weather.sun.sunset, clock24) : '—'));
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
      row.appendChild(air);
    }
    return row;
  }

  function statBit(label, value) {
    var wrap = document.createElement('div');
    wrap.className = 'stat';
    var span = document.createElement('span');
    span.textContent = label;
    var strong = document.createElement('strong');
    strong.textContent = value;
    wrap.append(span, strong);
    return wrap;
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

  function formatClockInput(value, clock24) {
    var bits = String(value || '').split(':');
    var hour = Number(bits[0]);
    var minute = String(bits[1] || '00').slice(0, 2);
    if (!Number.isFinite(hour)) return '';
    if (clock24) return String(hour).padStart(2, '0') + ':' + minute;
    var ap = hour >= 12 ? 'PM' : 'AM';
    var h = hour % 12 || 12;
    return h + ':' + minute + ' ' + ap;
  }

  function timeField(id, label, value) {
    var wrap = document.createElement('label');
    wrap.className = 'add-time';
    var face = document.createElement('span');
    face.className = 'add-time-face';
    var input = document.createElement('input');
    input.id = id;
    input.type = 'time';
    input.step = '60';
    input.value = value || '';
    input.setAttribute('aria-label', label);
    function paint() {
      face.textContent = formatClockInput(input.value, state.settings && state.settings.clock24);
    }
    input.addEventListener('input', paint);
    input.addEventListener('change', paint);
    paint();
    wrap.append(face, input);
    return wrap;
  }

  function readAddDraft() {
    var title = document.getElementById('add-title');
    if (!title) return null;
    var when = document.getElementById('add-when');
    return {
      title: title.value,
      day: when ? when.value : 'today',
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
    var tomorrowKey = shiftDateKey(today, 1);
    var savedDay = saved.day || 'today';
    var savedDate = saved.date || (savedDay === 'tomorrow' ? tomorrowKey : today);
    var whenWrap = document.createElement('div');
    whenWrap.className = 'add-when';
    var when = document.createElement('select');
    when.id = 'add-when';
    when.setAttribute('aria-label', 'Day');
    function whenOption(value, label) {
      var option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      return option;
    }
    var dateOpt = whenOption('date', 'Choose date');
    when.append(whenOption('today', 'Today'), whenOption('tomorrow', 'Tomorrow'), dateOpt);
    var date = document.createElement('input');
    date.id = 'add-date';
    date.className = 'add-date';
    date.type = 'date';
    date.tabIndex = -1;
    date.setAttribute('aria-hidden', 'true');
    date.value = savedDate;
    function paintWhen() {
      var custom = date.value && date.value !== today && date.value !== tomorrowKey;
      dateOpt.textContent = custom
        ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/Phoenix', month: 'short', day: 'numeric' }).format(new Date(date.value + 'T12:00:00-07:00'))
        : 'Choose date';
      when.value = custom ? 'date' : (date.value === tomorrowKey ? 'tomorrow' : 'today');
    }
    when.addEventListener('change', function () {
      if (when.value === 'today') date.value = today;
      else if (when.value === 'tomorrow') date.value = tomorrowKey;
      else if (date.showPicker) {
        var picker = date.showPicker();
        if (picker && picker.catch) picker.catch(function () {});
        return;
      }
      paintWhen();
    });
    date.addEventListener('change', paintWhen);
    paintWhen();
    whenWrap.append(when, date);
    var row = document.createElement('div');
    row.className = 'add-row';
    var start = timeField('add-start', 'Start time', saved.start || defaultStart());
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
    var end = timeField('add-end', 'End time', saved.end || '');
    end.hidden = duration.value !== 'end';
    duration.addEventListener('change', function () { end.hidden = box.checked || duration.value !== 'end'; });
    row.append(whenWrap, start, duration, end);
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
    function syncAllDay() {
      start.hidden = box.checked;
      duration.hidden = box.checked;
      end.hidden = box.checked || duration.value !== 'end';
    }
    box.addEventListener('change', syncAllDay);
    syncAllDay();
    var status = document.createElement('p');
    status.className = 'add-note';
    status.textContent = state.googleNotice || '';
    form.append(title, row, foot, status);
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
    renderNextLine();
  }

  function removeOptimistic(event) {
    if (!state.calendar || !event) return;
    state.calendar.days.forEach(function (day) {
      day.events = day.events.filter(function (item) { return !(item.title === event.title && item.start === event.start); });
    });
    renderDays();
    renderNextLine();
  }

  var addSaving = false;

  function resetAddForm(form) {
    var today = phoenixDateKey(new Date());
    var title = form.querySelector('#add-title');
    if (title) title.value = '';
    var date = form.querySelector('#add-date');
    if (date) date.value = today;
    var start = form.querySelector('#add-start');
    if (start) {
      start.value = defaultStart();
      start.dispatchEvent(new Event('input'));
    }
    var duration = form.querySelector('#add-duration');
    if (duration) duration.value = '60';
    var end = form.querySelector('#add-end');
    if (end) {
      end.value = '';
      end.dispatchEvent(new Event('input'));
      if (end.parentElement) end.parentElement.hidden = true;
    }
    var box = form.querySelector('#add-allday');
    if (box) box.checked = false;
    var when = form.querySelector('#add-when');
    if (when) when.value = 'today';
    var dateOpt = when && when.querySelector('option[value="date"]');
    if (dateOpt) dateOpt.textContent = 'Choose date';
    var row = form.querySelector('.add-row');
    if (row) row.classList.remove('is-all-day');
    var startWrap = form.querySelector('#add-start');
    if (startWrap && startWrap.parentElement) startWrap.parentElement.hidden = false;
  }

  function setAddBusy(form, busy) {
    var button = form.querySelector('.add-go');
    form.classList.toggle('is-busy', busy);
    if (!button) return;
    button.disabled = busy;
    button.textContent = busy ? 'Saving' : 'Add';
    if (busy) button.setAttribute('aria-busy', 'true');
    else button.removeAttribute('aria-busy');
  }

  async function submitEvent(form) {
    if (addSaving || form.classList.contains('is-busy')) return;
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
      end: duration === 'end' ? document.getElementById('add-end').value : '',
      idempotencyKey: crypto.randomUUID()
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
    addSaving = true;
    setAddBusy(form, true);
    status.textContent = '';
    insertOptimistic(optimistic);
    try {
      var created = await api('/glance/api/events', { method: 'POST', body: payload });
      if (created.event) {
        removeOptimistic(optimistic);
        insertOptimistic(created.event);
      }
      resetAddForm(form);
      status.textContent = '';
      try { await refreshCalendar(); } catch (err) { /* the event is already saved */ }
    } catch (err) {
      removeOptimistic(optimistic);
      status.textContent = err.message || 'That event was not added';
    }
    addSaving = false;
    if (form.isConnected) setAddBusy(form, false);
  }

  function renderAll() {
    applyChrome();
    renderWeather();
    renderDays();
    renderParty();
    renderRail();
  }

  var LAYOUTS = [
    ['fiveday', '5-Day', 'Today and the next four days'],
    ['balanced', 'Balanced', 'Clock, weather, week, and the side rail'],
    ['calendar', 'Calendar', 'A large week, with weather kept small'],
    ['today', 'Today', 'One day, large weather, lights, and family'],
    ['threeday', '3-Day', 'Three days and a medium forecast'],
    ['home', 'Home', 'Lights and family first, calendar tucked aside']
  ];

  function renderParty() {
    var banner = document.getElementById('party');
    var today = ((state.calendar && state.calendar.days) || []).filter(function (day) { return day.label === 'Today'; })[0];
    var events = (today && today.events) || [];
    var names = birthdayNames(events);
    if (!names.length) {
      banner.hidden = true;
      banner.replaceChildren();
      return;
    }
    banner.hidden = false;
    banner.replaceChildren();
    var icon = document.createElement('span');
    icon.className = 'party-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 9c1.2-1.6 2-2.6 2-3.6a2 2 0 0 0-4 0c0 1 0.8 2 2 3.6z" fill="#f3d48a"/><path d="M5 11h14l-1.2 8H6.2L5 11z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 11c.8 1.2 1.6 1.2 2.4 0S12 9.8 12.8 11s1.6 1.2 2.4 0 1.6-1.2 2.4 0" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';
    var copy = document.createElement('p');
    copy.textContent = names.length === 1
      ? "It's " + names[0] + "'s birthday today"
      : "It's " + joinNames(names) + "'s birthday today";
    banner.append(icon, copy);
  }

  function isPersonName(title) {
    var text = String(title || '').replace(/\s+/g, ' ').trim();
    if (/\b(?:get|buy|pick|call|grab|make|bring|shop|grocer\w*|for|with|about|the|task|todo|remind|meeting)\b/i.test(text)) return false;
    return /^[\p{L}][\p{L}.'’-]{0,30}(?:\s+[\p{L}][\p{L}.'’-]{0,30}){0,2}$/u.test(text);
  }

  function isBirthdayEvent(event) {
    if (!event) return false;
    if (birthdayName(event.title)) return true;
    if (/^(?:happy\s+)?(?:birthdays?|b-?days?)$/i.test(String(event.title || '').trim())) return false;
    return !!(event.birthday && event.allDay && isPersonName(event.title));
  }

  function birthdayName(title) {
    var text = String(title || '').replace(/\s+/g, ' ').trim();
    var patterns = [
      /^(?:happy\s+)?(.+?)['’]s\s+birthdays?$/i,
      /^(?:happy\s+)?(.+?)['’]s\s+b-?days?$/i,
      /^(?:happy\s+)?(.+?)\s+b-?days?$/i,
      /^birthdays?\s*[:\-]\s*(.+)$/i,
      /^b-?days?\s*[:\-]\s*(.+)$/i
    ];
    for (var i = 0; i < patterns.length; i++) {
      var match = text.match(patterns[i]);
      if (!match) continue;
      var name = String(match[1] || '').replace(/^happy\s+/i, '').replace(/[!,.]+$/g, '').trim();
      if (isPersonName(name)) return name;
    }
    return '';
  }

  function birthdayNames(events) {
    var names = [];
    events.forEach(function (event) {
      if (!isBirthdayEvent(event)) return;
      var name = birthdayName(event.title) || (isPersonName(event.title) ? String(event.title).trim() : '');
      if (name && names.indexOf(name) < 0) names.push(name);
    });
    return names;
  }

  function joinNames(names) {
    if (names.length === 1) return names[0];
    if (names.length === 2) return names[0] + ' and ' + names[1];
    return names.slice(0, -1).join(', ') + ', and ' + names[names.length - 1];
  }

  function cycleLayout(step) {
    if (!state.settings || document.getElementById('board').hidden) return;
    var order = LAYOUTS.map(function (entry) { return entry[0]; });
    var current = document.body.dataset.layout || DEFAULT_LAYOUT;
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

  async function refreshCalendar() {
    var body = await api('/glance/api/calendar');
    state.calendar = body;
    renderDays();
    renderParty();
    renderNextLine();
    return body;
  }

  async function refresh(forceDefault) {
    var onScreen = document.body.dataset.layout || DEFAULT_LAYOUT;
    var body = await api('/glance/api/dashboard');
    var serverLayout = body.settings && body.settings.layout;
    state.settings = body.settings;
    state.weather = body.weather;
    state.calendar = body.calendar;
    state.lights = body.lights;
    state.family = body.location;
    if (state.settings) {
      if (forceDefault || !state.layoutReady) {
        state.settings.layout = DEFAULT_LAYOUT;
        document.body.dataset.layout = DEFAULT_LAYOUT;
        state.layoutReady = true;
      } else {
        state.settings.layout = onScreen;
        document.body.dataset.layout = onScreen;
      }
    }
    renderAll();
    return { body: body, serverLayout: serverLayout };
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
    renderLayoutButtons(settings.layout || DEFAULT_LAYOUT);
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
    mountPanels();
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
    applyLayout(DEFAULT_LAYOUT, true);
    armSlideshow();
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

  var weekStartKey = '';
  var weekTimer = 0;
  var weekToken = 0;

  function thisSunday() {
    return weekSunday(phoenixDateKey(new Date()));
  }

  function weekSunday(key) {
    var bits = key.split('-').map(Number);
    var weekday = new Date(Date.UTC(bits[0], bits[1] - 1, bits[2])).getUTCDay();
    return shiftDateKey(key, -weekday);
  }

  function weekLabel(days) {
    if (!days || !days.length) return 'Week';
    var first = days[0];
    var last = days[days.length - 1];
    var month = function (date) {
      return new Intl.DateTimeFormat('en-US', { timeZone: PHOENIX, month: 'short' }).format(new Date(date + 'T12:00:00-07:00'));
    };
    var startMonth = month(first.date);
    var endMonth = month(last.date);
    if (startMonth === endMonth) return startMonth + ' ' + first.day + '–' + last.day;
    return startMonth + ' ' + first.day + ' – ' + endMonth + ' ' + last.day;
  }

  function bumpWeek() {
    clearTimeout(weekTimer);
    if (weekEl.hidden) return;
    weekTimer = setTimeout(closeWeek, 2 * 60 * 1000);
  }

  function closeWeek() {
    weekEl.hidden = true;
    clearTimeout(weekTimer);
    applyLayout(DEFAULT_LAYOUT, true);
    armSlideshow();
  }

  function openWeek() {
    mountPanels();
    if (state.open) return;
    weekStartKey = thisSunday();
    weekEl.hidden = false;
    bumpWeek();
    loadWeek();
  }

  async function loadWeek() {
    var token = ++weekToken;
    var root = document.getElementById('week-days');
    var title = document.getElementById('week-title');
    title.textContent = 'Loading…';
    root.replaceChildren();
    try {
      var body = await api('/glance/api/calendar?start=' + encodeURIComponent(weekStartKey));
      if (token !== weekToken) return;
      state.week = body;
      renderWeek();
    } catch (err) {
      if (token !== weekToken) return;
      title.textContent = 'Week';
      var note = document.createElement('p');
      note.className = 'week-status';
      note.textContent = err.message || 'That week did not load.';
      root.appendChild(note);
    }
  }

  function renderWeek() {
    var body = state.week;
    var root = document.getElementById('week-days');
    var title = document.getElementById('week-title');
    if (!body || !body.days) return;
    title.textContent = weekLabel(body.days);
    root.replaceChildren();
    var clock24 = !!(state.settings && state.settings.clock24);
    var today = phoenixDateKey(new Date());
    body.days.forEach(function (day) {
      var col = document.createElement('article');
      col.className = 'day' + (day.date === today ? ' is-today' : '');
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
        day.events.forEach(function (event) { list.appendChild(paintEvent(event, clock24)); });
        col.append(head, list);
      }
      root.appendChild(col);
    });
    syncTodayColumns(root);
  }

  function syncNow(list) {
    var now = Date.now();
    var todayKey = phoenixDateKey(new Date());
    var clock24 = !!(state.settings && state.settings.clock24);
    var items = Array.prototype.filter.call(list.children, function (el) {
      return el.classList.contains('event');
    });
    var rangeStart = Infinity;
    var rangeEnd = -Infinity;
    var anchor = null;
    items.forEach(function (item) {
      var allDay = item.dataset.allDay === '1';
      var start = new Date(item.dataset.start).getTime();
      var end = new Date(item.dataset.end).getTime();
      item.classList.remove('is-past', 'is-now');
      if (allDay) {
        var startKey = (item.dataset.start || '').slice(0, 10);
        if (startKey && startKey < todayKey) item.classList.add('is-past');
        return;
      }
      if (!isNaN(start) && start < rangeStart) rangeStart = start;
      if (!isNaN(end) && end > rangeEnd) rangeEnd = end;
      if (end <= now) item.classList.add('is-past');
      else if (start <= now) {
        item.classList.add('is-now');
        if (!anchor) anchor = item;
      } else if (!anchor) anchor = item;
    });
    var line = list.querySelector('.now-line');
    var show = rangeStart !== Infinity && now >= rangeStart && now < rangeEnd;
    if (!show) {
      if (line) line.remove();
      return;
    }
    if (!line) {
      line = document.createElement('li');
      line.className = 'now-line';
      line.setAttribute('aria-hidden', 'true');
      var label = document.createElement('span');
      var rule = document.createElement('i');
      line.append(label, rule);
    }
    line.querySelector('span').textContent = formatNowLabel(new Date(now), clock24);
    if (anchor) list.insertBefore(line, anchor);
    else list.appendChild(line);
    var lineTop = line.offsetTop;
    var viewBottom = list.scrollTop + list.clientHeight;
    if (lineTop < list.scrollTop + 8 || lineTop > viewBottom - 28) {
      list.scrollTop = Math.max(0, lineTop - 28);
    }
  }

  function syncTodayColumns(root) {
    (root || document).querySelectorAll('.day.is-today .events').forEach(syncNow);
  }

  function moveWeek(delta) {
    weekStartKey = shiftDateKey(weekStartKey || thisSunday(), delta * 7);
    bumpWeek();
    loadWeek();
  }

  function mountPanels() {
    if (panelsMounted) return;
    var weekTemplate = document.getElementById('week-template');
    var settingsTemplate = document.getElementById('settings-template');
    if (weekTemplate) document.body.appendChild(weekTemplate.content.cloneNode(true));
    if (settingsTemplate) document.body.appendChild(settingsTemplate.content.cloneNode(true));
    weekEl = document.getElementById('week');
    settingsEl = document.getElementById('settings');
    document.getElementById('week-back').addEventListener('click', closeWeek);
    document.getElementById('week-prev').addEventListener('click', function () { moveWeek(-1); });
    document.getElementById('week-next').addEventListener('click', function () { moveWeek(1); });
    document.getElementById('week-this').addEventListener('click', function () {
      weekStartKey = thisSunday();
      bumpWeek();
      loadWeek();
    });
    var weekX = 0;
    var weekY = 0;
    weekEl.addEventListener('pointerdown', function (event) {
      bumpWeek();
      weekX = 0;
      if (event.target.closest('button')) return;
      weekX = event.clientX;
      weekY = event.clientY;
    });
    weekEl.addEventListener('pointerup', function (event) {
      if (!weekX) return;
      var dx = event.clientX - weekX;
      var dy = event.clientY - weekY;
      weekX = 0;
      if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy)) return;
      moveWeek(dx < 0 ? 1 : -1);
    });
    bindSettings();
    panelsMounted = true;
  }

  function bindSettings() {
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
  document.getElementById('settings-close').addEventListener('click', closeSettings);
  }

  document.getElementById('week-open').addEventListener('click', openWeek);
  document.getElementById('layout-next').addEventListener('click', function () { cycleLayout(1); });
  document.getElementById('gear').addEventListener('click', openSettings);
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
    if (state.slides) {
      if (event.key === 'Escape') leaveSlideshow();
      return;
    }
    if (weekEl && !weekEl.hidden) {
      if (event.key === 'ArrowRight') { event.preventDefault(); moveWeek(1); }
      if (event.key === 'ArrowLeft') { event.preventDefault(); moveWeek(-1); }
      if (event.key === 'Escape') closeWeek();
      return;
    }
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
  ['pointerdown', 'keydown'].forEach(function (name) {
    window.addEventListener(name, armSlideshow, { passive: true });
  });
  var photoMenu = document.getElementById('photo-menu');
  var photoFiles = document.getElementById('photo-files');
  var photoOpen = document.getElementById('photo-open');

  function setPhotoMenu(open) {
    if (!photoMenu) return;
    photoMenu.hidden = !open;
    if (photoOpen) photoOpen.setAttribute('aria-expanded', open ? 'true' : 'false');
    var start = document.getElementById('photo-start');
    if (start) start.disabled = !photos.length;
  }

  function photoForm(photo) {
    var form = new FormData();
    form.append('full', photo.full, 'photo.jpg');
    form.append('thumb', photo.thumb, 'thumb.jpg');
    form.append('width', String(photo.width));
    form.append('height', String(photo.height));
    if (photo.original) form.append('original', photo.original, 'original.jpg');
    return form;
  }

  async function saveBoardPhoto(photo) {
    var res = await fetch('/glance/api/photos', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      body: photoForm(photo)
    });
    var body = {};
    try { body = await res.json(); } catch (err) { body = {}; }
    if (!res.ok) throw new Error(body.message || 'Could not save that photo');
    if (body.id) photos.push({ id: body.id });
    return body.id;
  }

  function pickPhotos(fromSlides) {
    if (!photoFiles || !window.GlanceCrop) return;
    var resumed = false;
    function resumeSlides() {
      if (resumed || !fromSlides || !state.slides) return;
      var crop = document.getElementById('crop');
      if (crop && !crop.hidden) return;
      resumed = true;
      scheduleSlide();
    }
    photoFiles.onchange = function () {
      resumed = true;
      var chosen = Array.prototype.slice.call(photoFiles.files || []);
      photoFiles.value = '';
      if (!chosen.length) {
        resumeSlides();
        return;
      }
      GlanceCrop.open(chosen.map(function (file) { return { file: file }; }), {
        onSave: saveBoardPhoto,
        onDone: function () {
          loadPhotos().then(function () {
            if (fromSlides && state.slides) {
              var known = {};
              slideOrder.forEach(function (id) { known[id] = true; });
              photos.forEach(function (photo) {
                if (!known[photo.id]) slideOrder.push(photo.id);
              });
              if (slideOrder.length > 1) scheduleSlide();
              else paintSlideChrome();
            } else {
              armSlideshow();
            }
          });
        }
      });
    };
    if (fromSlides) clearTimeout(slideTimer);
    window.addEventListener('focus', function onFocus() {
      window.removeEventListener('focus', onFocus);
      setTimeout(resumeSlides, 400);
    });
    photoFiles.click();
  }

  photoOpen.addEventListener('click', function (event) {
    event.stopPropagation();
    setPhotoMenu(photoMenu.hidden);
  });
  document.getElementById('photo-start').addEventListener('click', function () {
    setPhotoMenu(false);
    startSlideshow();
  });
  document.getElementById('photo-add').addEventListener('click', function () {
    setPhotoMenu(false);
    pickPhotos(false);
  });
  document.getElementById('photo-manage').addEventListener('click', function () {
    setPhotoMenu(false);
    if (window.GlanceGallery) GlanceGallery.open();
  });
  document.getElementById('slide-add').addEventListener('click', function (event) {
    event.stopPropagation();
    pickPhotos(true);
  });
  document.getElementById('slide-manage').addEventListener('click', function (event) {
    event.stopPropagation();
    clearTimeout(slideTimer);
    if (window.GlanceGallery) GlanceGallery.open();
  });
  if (window.GlanceGallery) {
    GlanceGallery.bind({
      onChange: function (next) {
        photoVersion = Date.now();
        var known = {};
        slideOrder.forEach(function (id) { known[id] = true; });
        photos = next || [];
        if (!state.slides) return;
        photos.forEach(function (photo) {
          if (!known[photo.id]) slideOrder.push(photo.id);
        });
        var alive = {};
        photos.forEach(function (photo) { alive[photo.id] = true; });
        slideOrder = slideOrder.filter(function (id) { return alive[id]; });
        if (!slideOrder.length) {
          hideSlideshow();
          return;
        }
        paintSlidePhoto();
        if (slideOrder.length > 1) scheduleSlide();
      }
    });
  }
  document.addEventListener('pointerdown', function (event) {
    if (!photoMenu || photoMenu.hidden) return;
    if (event.target.closest('#photo-menu, #photo-open')) return;
    setPhotoMenu(false);
  });
  document.getElementById('slides').addEventListener('click', function (event) {
    if (event.target.closest('button, a, input, label')) return;
    leaveSlideshow();
  });

  var reloading = false;
  function reloadForDeploy(remote) {
    if (reloading) return;
    reloading = true;
    try {
      var settings = state.settings || {};
      sessionStorage.setItem('glance-reloaded-for', remote);
      rememberView(settings.theme || 'auto');
    } catch (err) { /* reload anyway */ }
    window.location.reload();
  }

  async function checkVersion() {
    if (reloading || state.slides) return;
    try {
      var res = await fetch('/glance/api/version', { cache: 'no-store', credentials: 'same-origin' });
      if (!res.ok) return;
      var body = await res.json();
      var remote = body && body.version;
      var here = (document.querySelector('meta[name="glance-build"]') || {}).content || '';
      if (!remote || !here || remote === here) return;
      if (sessionStorage.getItem('glance-reloaded-for') === remote) return;
      reloadForDeploy(remote);
    } catch (err) { /* stay on this build until the next check */ }
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible' || state.slides) return;
    checkVersion();
    if (!board.hidden) {
      wake();
      refresh().catch(function () {});
    }
  });
  window.addEventListener('focus', function () { checkVersion(); });
  // The board stays open on the iPad. Version still reloads after a deploy,
  // and waking the screen checks immediately. The slower timer avoids a
  // request every minute while the page is already visible.
  var VERSION_POLL_MS = 5 * 60 * 1000;
  var DASHBOARD_POLL_MS = 3 * 60 * 1000;
  setInterval(checkVersion, VERSION_POLL_MS);
  checkVersion();

  function slidesBlocked() {
    var crop = document.getElementById('crop');
    var gallery = document.getElementById('gallery');
    var viewer = document.getElementById('viewer');
    return state.open || board.hidden || (weekEl && !weekEl.hidden) || (crop && !crop.hidden) || (gallery && !gallery.hidden) || (viewer && !viewer.hidden);
  }

  function armSlideshow() {
    clearTimeout(slideIdle);
    if (state.slides || slidesBlocked() || !photos.length) return;
    slideIdle = setTimeout(startSlideshow, 10 * 60 * 1000);
  }

  async function loadPhotos() {
    try {
      var res = await fetch('/glance/api/photos', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      if (!res.ok) { photos = []; return; }
      var body = await res.json();
      photos = (body && body.photos) || [];
    } catch (err) {
      photos = [];
    }
  }

  function shuffleIds(list) {
    var copy = list.slice();
    for (var i = copy.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var swap = copy[i];
      copy[i] = copy[j];
      copy[j] = swap;
    }
    return copy;
  }

  var photoVersion = 0;
  function slideUrl(id) { return '/glance/api/photos/' + id + (photoVersion ? '?v=' + photoVersion : ''); }

  function paintSlidePhoto() {
    if (!state.slides || !slideOrder.length) return;
    if (slideIndex >= slideOrder.length) slideIndex = 0;
    var imgs = document.querySelectorAll('#slides img');
    imgs[slideSlot].src = slideUrl(slideOrder[slideIndex]);
    preloadNextSlide();
  }

  function preloadNextSlide() {
    slidePreload = null;
    if (slideOrder.length < 2) return;
    slidePreload = new Image();
    slidePreload.src = slideUrl(slideOrder[(slideIndex + 1) % slideOrder.length]);
  }

  function paintSlideChrome() {
    var time = document.getElementById('slide-time');
    var date = document.getElementById('slide-date');
    if (!time || !date) return;
    var parts = phoenixParts(new Date());
    var text = clockText(parts, state.settings && state.settings.clock24);
    time.textContent = text.hh + ':' + text.mm + (text.ap ? ' ' + text.ap : '');
    date.textContent = parts.weekday + ', ' + parts.month + ' ' + parts.day;
    var banner = document.getElementById('slide-banner');
    if (!banner) return;
    var bits = [];
    var current = state.weather && state.weather.current;
    if (current && current.temp !== undefined && current.temp !== null) bits.push(current.temp + '° ' + (current.label || ''));
    var next = state.calendar && state.calendar.upcoming;
    if (next && next.title) bits.push(next.title);
    banner.textContent = bits.join(' · ').trim();
    banner.hidden = !banner.textContent;
  }

  function scheduleSlide() {
    clearTimeout(slideTimer);
    if (!state.slides || slideOrder.length < 2) return;
    slideTimer = setTimeout(advanceSlide, 8000);
  }

  function advanceSlide() {
    if (!state.slides || slideOrder.length < 2) return;
    slideIndex = (slideIndex + 1) % slideOrder.length;
    slideSlot = 1 - slideSlot;
    var imgs = document.querySelectorAll('#slides img');
    var incoming = imgs[slideSlot];
    var outgoing = imgs[1 - slideSlot];
    incoming.src = slideUrl(slideOrder[slideIndex]);
    incoming.classList.add('is-show');
    outgoing.classList.remove('is-show');
    preloadNextSlide();
    scheduleSlide();
  }

  function hideSlideshow() {
    state.slides = false;
    clearTimeout(slideTimer);
    slidePreload = null;
    var root = document.getElementById('slides');
    if (!root) return;
    root.hidden = true;
    root.querySelectorAll('img').forEach(function (img) {
      img.classList.remove('is-show');
      img.removeAttribute('src');
    });
  }

  function leaveSlideshow() {
    if (!state.slides) return;
    hideSlideshow();
    refresh().catch(function () {});
    armSlideshow();
  }

  function startSlideshow() {
    if (!photos.length || slidesBlocked()) return;
    clearTimeout(slideIdle);
    state.slides = true;
    slideOrder = shuffleIds(photos.map(function (photo) { return photo.id; }));
    slideIndex = 0;
    slideSlot = 0;
    var root = document.getElementById('slides');
    var imgs = root.querySelectorAll('img');
    imgs[0].classList.remove('is-show');
    imgs[1].classList.remove('is-show');
    imgs[0].src = slideUrl(slideOrder[0]);
    imgs[0].classList.add('is-show');
    preloadNextSlide();
    root.hidden = false;
    paintSlideChrome();
    scheduleSlide();
  }

  async function bootApp() {
    var loaded = await refresh(true);
    rememberView(state.settings && state.settings.theme);
    if (loaded.serverLayout !== DEFAULT_LAYOUT) {
      try {
        var saved = await api('/glance/api/settings', { method: 'PUT', body: { layout: DEFAULT_LAYOUT } });
        state.settings = saved;
        state.settings.layout = DEFAULT_LAYOUT;
        document.body.dataset.layout = DEFAULT_LAYOUT;
      } catch (err) { /* the board still opens on five-day */ }
    }
    try { await loadPhotos(); } catch (err) { photos = []; }
    showBoard();
    wake();
    bump();
    armSlideshow();
  }

  function scheduleClock() {
    if (state.slides) paintSlideChrome();
    else if (!board.hidden) {
      applyChrome();
      syncTodayColumns(document);
      ensureVerse();
    }
    var wait = 60000 - (Date.now() % 60000) + 50;
    setTimeout(scheduleClock, wait);
  }
  scheduleClock();
  setInterval(function () {
    if (state.slides || board.hidden) return;
    refresh().catch(function () {});
  }, DASHBOARD_POLL_MS);
  async function refreshSharedPhotos() {
    var before = {};
    photos.forEach(function (photo) { before[photo.id] = true; });
    var had = photos.length;
    await loadPhotos();
    var gallery = document.getElementById('gallery');
    if (gallery && !gallery.hidden && window.GlanceGallery) GlanceGallery.show(photos);
    if (!state.slides) {
      if (!had && photos.length) armSlideshow();
      return;
    }
    var added = false;
    photos.forEach(function (photo) {
      if (!before[photo.id]) {
        slideOrder.push(photo.id);
        added = true;
      }
    });
    if (!added) return;
    if (slideOrder.length === 1) {
      var imgs = document.querySelectorAll('#slides img');
      imgs[slideSlot].src = slideUrl(slideOrder[0]);
    }
    if (slideOrder.length > 1) scheduleSlide();
  }
  setInterval(function () {
    if (document.visibilityState !== 'visible' || board.hidden) return;
    refreshSharedPhotos().catch(function () {});
  }, 20000);

  window.addEventListener('glance-fit', function (event) {
    var detail = event.detail || {};
    if (!state.settings) state.settings = {};
    if (detail.layout) state.settings.layout = detail.layout;
    if (detail.theme) state.settings.theme = detail.theme;
    document.body.dataset.layout = state.settings.layout || DEFAULT_LAYOUT;
    document.body.dataset.theme = state.settings.theme === 'auto' ? resolvedTheme() : (state.settings.theme || 'aurora');
    renderDays();
    renderParty();
    renderRail();
    renderNextLine();
  });

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

  var googleParams = new URLSearchParams(window.location.search);
  var googleCode = googleParams.get('google');
  if (googleCode) {
    var googleReasons = {
      invalid_client: 'Google rejected the client ID or secret. Re-enter both in settings with no extra spaces, save, and connect again.',
      redirect_uri_mismatch: 'The redirect address did not match. In Google Cloud it must be exactly https://maxteeple.com/glance/api/google/callback.',
      invalid_grant: 'That Google sign-in expired. Connect again from settings.',
      invalid_request: 'Google sent the connection back without a code. Connect again from settings.',
      unauthorized_client: 'The OAuth client must be a Web application. Check the client type in Google Cloud.',
      no_refresh_token: 'Google did not return a refresh token. Connect again and accept the consent screen.',
      insufficient_scope: 'Google did not allow calendar events. Connect again and allow access.',
      calendar_forbidden: 'Google Calendar refused the connection. Connect again from settings.',
      token_exchange_failed: 'Google could not be connected. Try again from settings.'
    };
    var googleMessages = {
      connected: 'Google Calendar is connected.',
      denied: 'Google was not connected.',
      expired: 'That connection link expired. Try again from settings.',
      account: 'Connect while signed in to Google as max.teeple@gmail.com.',
      setup: 'Add the Google client ID and secret in settings, or store them as Worker secrets.',
      login: 'Sign in, then connect Google Calendar.',
      error: googleReasons.token_exchange_failed
    };
    var reason = googleParams.get('reason') || '';
    state.googleNotice = googleCode === 'error'
      ? (googleReasons[reason] || (reason ? googleMessages.error + ' (' + reason.replace(/[^a-z0-9_]/g, '') + ')' : googleMessages.error))
      : (googleMessages[googleCode] || googleMessages.error);
    if (googleCode === 'login') document.getElementById('login-error').textContent = state.googleNotice;
    history.replaceState({}, '', '/glance/');
  }

  bootApp().then(function () {
    if (googleCode === 'setup' || googleCode === 'connected' || googleCode === 'account' || googleCode === 'error') openSettings();
  }).catch(function (error) {
    if (!error || error.status !== 401) showLogin();
  });
})();
