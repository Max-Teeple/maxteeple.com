/* QR share modal. The encoder loads only when this opens. */
(function (global) {
  'use strict';

  var KEY = 'glance-share';
  var modal = null;

  function $(id) { return document.getElementById(id); }

  function readSaved() {
    try {
      var saved = JSON.parse(sessionStorage.getItem(KEY) || '');
      if (!saved || !saved.url || !saved.expiresAt) return null;
      if (Date.parse(saved.expiresAt) <= Date.now() + 60000) return null;
      return saved;
    } catch (err) {
      return null;
    }
  }

  function remember(share) {
    try { sessionStorage.setItem(KEY, JSON.stringify(share)); } catch (err) { /* the modal still shows it */ }
  }

  function forget() {
    try { sessionStorage.removeItem(KEY); } catch (err) { /* already gone */ }
  }

  async function api(path, options) {
    var opts = options || {};
    var res = await fetch(path, {
      method: opts.method || 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      body: opts.body
    });
    var body = {};
    try { body = await res.json(); } catch (err) { body = {}; }
    if (!res.ok) throw new Error(body.message || 'Request failed');
    return body;
  }

  function loadEncoder() {
    if (global.qrcode) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      var build = (document.querySelector('meta[name="glance-build"]') || {}).content || '';
      script.src = '/glance/qr.js' + (build ? '?v=' + encodeURIComponent(build) : '');
      script.onload = function () { resolve(); };
      script.onerror = function () { reject(new Error('Could not prepare the code')); };
      document.head.appendChild(script);
    });
  }

  function draw(url) {
    var qr = global.qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    var count = qr.getModuleCount();
    var canvas = $('share-qr');
    var css = Math.min(360, Math.max(220, Math.floor(window.innerWidth * 0.42)));
    var dpr = Math.min(2, global.devicePixelRatio || 1);
    canvas.style.width = css + 'px';
    canvas.style.height = css + 'px';
    canvas.width = Math.round(css * dpr);
    canvas.height = Math.round(css * dpr);
    var cell = Math.floor(canvas.width / (count + 8));
    var quiet = Math.floor((canvas.width - cell * count) / 2);
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#111';
    for (var row = 0; row < count; row++) {
      for (var col = 0; col < count; col++) {
        if (qr.isDark(row, col)) ctx.fillRect(quiet + col * cell, quiet + row * cell, cell, cell);
      }
    }
  }

  function ensure() {
    if (modal) return modal;
    modal = document.createElement('section');
    modal.id = 'share-modal';
    modal.className = 'share-modal';
    modal.hidden = true;
    modal.innerHTML = ''
      + '<div class="share-card" role="dialog" aria-labelledby="share-title">'
      + '<h2 id="share-title">Share photos via QR</h2>'
      + '<canvas id="share-qr" aria-label="QR code"></canvas>'
      + '<p id="share-url" class="share-url"></p>'
      + '<p class="share-note">Anyone with this link can add photos for 24 hours. They cannot open the board or see other photos. A new code replaces the previous one.</p>'
      + '<div class="share-actions">'
      + '<button id="share-revoke" type="button">Stop sharing</button>'
      + '<button id="share-close" type="button">Close</button>'
      + '</div>'
      + '<p id="share-status" class="share-status" role="status"></p>'
      + '</div>';
    document.body.appendChild(modal);
    modal.addEventListener('click', function (event) {
      if (event.target === modal) close();
    });
    $('share-close').addEventListener('click', close);
    $('share-revoke').addEventListener('click', async function () {
      $('share-revoke').disabled = true;
      try {
        await api('/glance/api/photos/share', { method: 'DELETE' });
        forget();
        close();
      } catch (err) {
        $('share-status').textContent = err.message || 'Could not stop sharing';
        $('share-revoke').disabled = false;
      }
    });
    return modal;
  }

  function close() {
    if (!modal) return;
    modal.hidden = true;
  }

  async function open() {
    var menu = document.getElementById('photo-menu');
    if (menu) menu.hidden = true;
    var opener = document.getElementById('photo-open');
    if (opener) opener.setAttribute('aria-expanded', 'false');
    var root = ensure();
    var status = $('share-status');
    status.textContent = 'Preparing a link';
    root.hidden = false;
    try {
      var saved = readSaved();
      if (!saved) {
        saved = await api('/glance/api/photos/share', { method: 'POST' });
        remember(saved);
      }
      await loadEncoder();
      draw(saved.url);
      var link = $('share-url');
      link.textContent = saved.url;
      status.textContent = '';
    } catch (err) {
      status.textContent = err.message || 'Could not make a code';
    }
  }

  document.addEventListener('click', function (event) {
    var button = event.target.closest('[data-share]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    open();
  });

  global.GlanceShare = { open: open, close: close };
})(window);
