#!/usr/bin/env node
/**
 * Fit check for Glance on iPadOS 17 and the kitchen laptops.
 *
 * Primary device: 12.9" iPad Pro (2nd gen, 2017) at 1024x1366 and 1366x1024,
 * in the standalone Home Screen and in Safari with toolbars.
 * Secondary: 10.2", 10.9" Air, 11" Pro, plus 1280x800 and 1920x1080.
 *
 * Fails when the page scrolls, a card clips or overflows (except an event list),
 * an Add event control sits outside its card, or visible text is under 14px.
 *
 *   GLANCE_URL=https://maxteeple.com/glance/ GLANCE_PASSWORD=... node scripts/glance-fit-check.mjs
 *
 * Uses Playwright WebKit (Safari 17-class). Install once with:
 *   npx --yes playwright install webkit
 */
import fs from 'fs';
import path from 'path';

const url = process.env.GLANCE_URL || 'https://maxteeple.com/glance/';
const password = process.env.GLANCE_PASSWORD || '';
const fixture = process.env.GLANCE_FIT_FIXTURE === '1';
const outDir = process.env.GLANCE_FIT_OUT || path.join(process.cwd(), 'glance-fit-out');
const assets = process.env.GLANCE_ASSETS || '';
if (!password && !fixture) {
  console.error('Set GLANCE_PASSWORD');
  process.exit(2);
}

const SAFARI_CHROME = { portrait: 140, landscape: 96 };

function device(name, width, height, primary) {
  return [
    { name: name + '-portrait-standalone', width, height, mode: 'standalone', primary },
    { name: name + '-landscape-standalone', width: height, height: width, mode: 'standalone', primary },
    { name: name + '-portrait-safari', width, height: height - SAFARI_CHROME.portrait, mode: 'safari', primary },
    { name: name + '-landscape-safari', width: height, height: width - SAFARI_CHROME.landscape, mode: 'safari', primary }
  ];
}

const viewports = [
  ...device('ipad-12.9', 1024, 1366, true),
  ...device('ipad-11', 834, 1194, false),
  ...device('ipad-10.9', 820, 1180, false),
  ...device('ipad-10.2', 810, 1080, false),
  { name: 'laptop-1280x800', width: 1280, height: 800, mode: 'laptop', primary: false },
  { name: 'laptop-1920x1080', width: 1920, height: 1080, mode: 'laptop', primary: false }
];

const layouts = ['balanced', 'calendar', 'today', 'threeday', 'home'];
const themes = ['aurora', 'desert', 'golf', 'glass', 'auto'];

let webkit;
try {
  ({ webkit } = await import('playwright'));
} catch {
  ({ webkit } = await import('playwright-core'));
}

fs.mkdirSync(outDir, { recursive: true });
const browser = await webkit.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 1366 } });
page.setDefaultTimeout(30000);

function fixtureDashboard() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Phoenix', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const event = (title, feed, extra) => ({
    title,
    allDay: false,
    birthday: false,
    start: today + 'T15:00:00-07:00',
    end: today + 'T16:00:00-07:00',
    feed,
    color: feed === 'Work' ? '#8eb6ff' : '#7dcea0',
    location: '',
    description: '',
    links: [],
    googleId: '',
    deletable: false,
    masked: feed === 'Work',
    ...extra
  });
  const day = { date: today, label: 'Today', weekday: 'Today', day: Number(today.slice(-2)), events: [
    event('Family dinner', 'Personal', { location: 'Home', description: 'Bring dessert', links: ['https://example.com/menu'], googleId: 'abc123event', deletable: true, masked: false }),
    event('Max Work Meeting', 'Work', { masked: true })
  ] };
  return {
    ok: true,
    settings: {
      ok: true,
      locationName: 'Phoenix',
      theme: 'auto',
      layout: 'threeday',
      clock24: false,
      nightStart: 21,
      nightEnd: 6,
      widgets: { countdown: false, sun: false, air: false, summary: false, lights: true, family: true },
      google: { connected: true },
      feeds: []
    },
    weather: {
      ok: true,
      current: { temp: 84, label: 'Clear', icon: 'sun', isDay: true, high: 91, low: 64, feels: 82, wind: 6, windDir: 220, uv: 7, precip: 0, code: 0 },
      daily: [0, 1, 2, 3, 4].map((offset) => ({ date: today, icon: 'sun', high: 90, low: 64, precip: 0 })),
      hourly: [15, 16, 17, 18].map((hour) => ({ time: today + 'T' + hour + ':00:00-07:00', icon: 'sun', isDay: true, temp: 84, precip: 0 }))
    },
    calendar: { ok: true, days: [day, { ...day, label: 'Tomorrow', events: [] }, { ...day, label: 'Wed', events: day.events }] },
    lights: { ok: true, configured: true, lights: [{ id: 'plug1', name: 'Lamp', online: true, on: false, code: 'switch_1', enabled: true }] },
    location: { ok: true, people: [{ id: 'p1', name: 'Max', color: '#f6f3ec', phrase: 'Max is at home', stale: false }] }
  };
}

if (assets) {
  const html = fs.readFileSync(path.join(assets, 'index.html'), 'utf8').replaceAll('__GLANCE_BUILD__', 'fit');
  const css = fs.readFileSync(path.join(assets, 'app.css'), 'utf8');
  const js = fs.readFileSync(path.join(assets, 'app.js'), 'utf8');
  await page.route('**/*', async (route) => {
    const request = route.request();
    const target = request.url().split('?')[0];
    if (request.resourceType() === 'document' && /\/glance\/?$/.test(target)) {
      return route.fulfill({ status: 200, contentType: 'text/html', body: html });
    }
    if (target.endsWith('/glance/app.css')) return route.fulfill({ status: 200, contentType: 'text/css', body: css });
    if (target.endsWith('/glance/app.js')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: js });
    if (fixture && target.includes('/glance/api/')) {
      if (target.endsWith('/glance/api/login')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
      }
      if (target.endsWith('/glance/api/verse')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            date: '2026-01-01',
            reference: 'Philippians 4:13',
            theme: 'Strength',
            text: 'I can do all things through Christ which strengtheneth me.',
            devotional: 'Before the kitchen gets noisy, this verse is enough for one honest minute. You do not have to solve the whole day. Let one true sentence land, then do the next simple thing with a steadier voice.'
          })
        });
      }
      if (target.endsWith('/glance/api/dashboard') || target.includes('/glance/api/calendar')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixtureDashboard()) });
      }
      if (target.endsWith('/glance/api/settings') && request.method() === 'PUT') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, layout: 'threeday', theme: 'auto', google: { connected: true } }) });
      }
      if (target.endsWith('/glance/api/version')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"version":"fit"}' });
      }
    }
    if (target.endsWith('/glance/api/dashboard') && process.env.GLANCE_DASHBOARD_SHIM === '1') {
      const origin = new URL(request.url()).origin;
      const jar = await page.context().cookies('https://maxteeple.com');
      const cookie = jar.map((item) => item.name + '=' + item.value).join('; ');
      if (!cookie) {
        return route.fulfill({ status: 401, contentType: 'application/json', body: '{"ok":false,"message":"Login required"}' });
      }
      const grab = async (suffix) => {
        const res = await fetch(origin + suffix, {
          headers: { cookie, accept: 'application/json' },
          signal: AbortSignal.timeout(12000)
        });
        if (!res.ok) {
          const error = new Error(suffix + ' ' + res.status);
          error.status = res.status;
          throw error;
        }
        return res.json();
      };
      try {
        const [settings, weather, calendar, lights, location] = await Promise.all([
          grab('/glance/api/session'),
          grab('/glance/api/weather'),
          grab('/glance/api/calendar'),
          grab('/glance/api/lights'),
          grab('/glance/api/location')
        ]);
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, settings, weather, calendar, lights, location })
        });
      } catch (error) {
        return route.fulfill({
          status: error.status === 401 ? 401 : 502,
          contentType: 'application/json',
          body: JSON.stringify({ ok: false, message: error.message || 'Dashboard shim failed' })
        });
      }
    }
    return route.continue();
  });
}

const posts = [];
page.on('request', (request) => {
  if (request.method() === 'POST' && (request.url().includes('/lights') || request.url().includes('/events'))) {
    posts.push(request.url());
  }
});

await page.goto(url, { waitUntil: 'domcontentloaded' });
if (fixture) {
  await page.waitForSelector('#board:not([hidden]) .event-title', { timeout: 20000 });
} else {
  await page.waitForSelector('#login-password');
  await page.fill('#login-password', password);
  await page.click('#login-form button[type="submit"]');
  await page.waitForSelector('#board:not([hidden]) .event-title', { timeout: 20000 });
}
console.error('signed in');

const rows = [];
let failed = 0;

for (const viewport of viewports) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  const safe = viewport.mode === 'standalone'
    ? { top: '24px', right: '0px', bottom: '20px', left: '0px' }
    : { top: '0px', right: '0px', bottom: '0px', left: '0px' };
  for (const layout of layouts) {
    for (const theme of themes) {
      const result = await page.evaluate(({ layout, theme, safe }) => {
        document.documentElement.style.setProperty('--safe-top', safe.top);
        document.documentElement.style.setProperty('--safe-right', safe.right);
        document.documentElement.style.setProperty('--safe-bottom', safe.bottom);
        document.documentElement.style.setProperty('--safe-left', safe.left);
        window.dispatchEvent(new CustomEvent('glance-fit', { detail: { layout, theme } }));
        const problems = [];
        const visible = (el) => {
          if (!el || el.closest('[hidden]')) return false;
          const style = getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 1 && rect.height > 1;
        };
        const root = document.scrollingElement || document.documentElement;
        if (root.scrollHeight > root.clientHeight + 2 || root.scrollWidth > root.clientWidth + 2) {
          problems.push('document scrolls ' + root.scrollWidth + 'x' + root.scrollHeight + ' in ' + root.clientWidth + 'x' + root.clientHeight);
        }
        if (document.body.scrollHeight > window.innerHeight + 2 || document.body.scrollWidth > window.innerWidth + 2) {
          problems.push('body scrolls');
        }
        const intended = (el) => !!el.closest('.events');
        document.querySelectorAll('.day, .rail-card, .now-card, .fday, .hour, .party, .clock-block, .forecast, .hourly, .top, .lower, .app, .light, .family-line, .add-days, .add-times, .add-foot').forEach((el) => {
          if (!visible(el) || intended(el)) return;
          const extraX = el.scrollWidth - el.clientWidth;
          const extraY = el.scrollHeight - el.clientHeight;
          if (extraX > 2 || extraY > 2) {
            const label = (el.id ? '#' + el.id : el.className.toString().split(' ')[0]) || el.tagName;
            problems.push(label + ' overflow ' + extraX + 'x' + extraY);
          }
        });
        const card = document.querySelector('.add-card');
        if (card && visible(card)) {
          card.querySelectorAll('input, select, button, a, label').forEach((field) => {
            if (!visible(field)) return;
            const rect = field.getBoundingClientRect();
            const box = card.getBoundingClientRect();
            const name = field.getAttribute('aria-label') || field.id || field.textContent.trim().slice(0, 24);
            if (rect.left < box.left - 1 || rect.right > box.right + 1 || rect.top < box.top - 1 || rect.bottom > box.bottom + 1) {
              problems.push('Add field outside card: ' + name);
            }
            if (rect.top < -1 || rect.left < -1 || rect.bottom > window.innerHeight + 1 || rect.right > window.innerWidth + 1) {
              problems.push('Add field outside viewport: ' + name);
            }
            const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
            if (hit && hit !== field && !field.contains(hit) && !hit.contains(field)) {
              problems.push('Add field covered: ' + name);
            }
          });
        }
        function clipRect(rect, host) {
          let box = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
          const hostBox = host.getBoundingClientRect();
          box.left = Math.max(box.left, hostBox.left);
          box.top = Math.max(box.top, hostBox.top);
          box.right = Math.min(box.right, hostBox.right);
          box.bottom = Math.min(box.bottom, hostBox.bottom);
          let el = host;
          while (el && el !== document.body) {
            const style = getComputedStyle(el);
            const clipY = style.overflowY === 'hidden' || style.overflowY === 'auto' || style.overflowY === 'scroll';
            const clipX = style.overflowX === 'hidden' || style.overflowX === 'auto' || style.overflowX === 'scroll';
            if (clipX || clipY) {
              const bounds = el.getBoundingClientRect();
              if (clipX) {
                box.left = Math.max(box.left, bounds.left);
                box.right = Math.min(box.right, bounds.right);
              }
              if (clipY) {
                box.top = Math.max(box.top, bounds.top);
                box.bottom = Math.min(box.bottom, bounds.bottom);
              }
            }
            el = el.parentElement;
          }
          return box;
        }
        const textBoxes = [];
        const rangeWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let textNode = rangeWalker.nextNode();
        while (textNode) {
          const sample = textNode.textContent.replace(/\s+/g, ' ').trim();
          const host = textNode.parentElement;
          if (sample && host && visible(host)) {
            const range = document.createRange();
            range.selectNodeContents(textNode);
            const rect = clipRect(range.getBoundingClientRect(), host);
            if (rect.right - rect.left > 1 && rect.bottom - rect.top > 1 && rect.bottom > 0 && rect.top < window.innerHeight) {
              textBoxes.push({ text: sample.slice(0, 28), rect: rect });
            }
          }
          textNode = rangeWalker.nextNode();
        }
        for (let i = 0; i < textBoxes.length; i++) {
          for (let j = i + 1; j < textBoxes.length; j++) {
            const a = textBoxes[i].rect;
            const b = textBoxes[j].rect;
            const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (overlapX > 2 && overlapY > 2) {
              problems.push('overlap ' + textBoxes[i].text + ' / ' + textBoxes[j].text);
              j = textBoxes.length;
            }
          }
          if (problems.length > 6) break;
        }
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node) {
          const text = node.textContent.replace(/\s+/g, ' ').trim();
          const el = node.parentElement;
          if (text && el && visible(el)) {
            const size = parseFloat(getComputedStyle(el).fontSize);
            if (size < 14) problems.push(size.toFixed(1) + 'px text: ' + text.slice(0, 40));
          }
          node = walker.nextNode();
        }
        return problems.slice(0, 8);
      }, { layout, theme, safe });
      const ok = result.length === 0;
      if (!ok) failed += 1;
      rows.push({ viewport: viewport.name, primary: viewport.primary, layout, theme, ok, problems: result });
      const shot = viewport.primary && layout === 'balanced' && (theme === 'aurora' || theme === 'desert');
      if (shot || (!ok && viewport.primary && failed <= 12)) {
        const file = viewport.name + '-' + layout + '-' + theme + '.png';
        await page.screenshot({ path: path.join(outDir, file) });
      }
    }
  }
}

await page.setViewportSize({ width: 1024, height: 1366 });
await page.evaluate(() => {
  document.body.dataset.layout = 'threeday';
  document.body.dataset.theme = 'aurora';
  window.dispatchEvent(new CustomEvent('glance-fit', { detail: { layout: 'threeday', theme: 'aurora' } }));
});
await page.screenshot({ path: path.join(outDir, 'ipad-12.9-collapsed.png') });
const verse = page.locator('.verse-card');
if (await verse.count()) {
  await verse.click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(outDir, 'ipad-12.9-verse-expanded.png') });
  await page.locator('.sheet:not([hidden]) .sheet-close').click();
}
const event = page.locator('#days .event').first();
if (await event.count()) {
  await event.click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(outDir, 'ipad-12.9-event-expanded.png') });
  await page.locator('.sheet:not([hidden]) .sheet-close').click();
}
await page.setViewportSize({ width: 1366, height: 1024 });
await page.evaluate(() => {
  window.dispatchEvent(new CustomEvent('glance-fit', { detail: { layout: 'threeday', theme: 'aurora' } }));
});
await page.screenshot({ path: path.join(outDir, 'ipad-12.9-landscape-collapsed.png') });

await browser.close();
if (posts.length) {
  console.error('Unexpected plug or event requests: ' + posts.join(', '));
  process.exit(2);
}

const header = 'viewport'.padEnd(34) + 'layout'.padEnd(12) + 'theme'.padEnd(10) + 'result';
console.log(header);
console.log('-'.repeat(header.length));
for (const row of rows) {
  const mark = row.primary ? '' : '';
  console.log(
    (row.viewport + mark).padEnd(34) +
    row.layout.padEnd(12) +
    row.theme.padEnd(10) +
    (row.ok ? 'pass' : 'FAIL ' + row.problems.join(' | '))
  );
}
const primary = rows.filter((row) => row.primary);
const secondary = rows.filter((row) => !row.primary);
console.log('');
console.log('Primary ' + primary.filter((row) => row.ok).length + '/' + primary.length + ' pass');
console.log('Secondary ' + secondary.filter((row) => row.ok).length + '/' + secondary.length + ' pass');
console.log('Screenshots in ' + outDir);
fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(rows, null, 2));
process.exit(failed ? 1 : 0);
