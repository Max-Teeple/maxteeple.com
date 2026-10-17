(function () {
  'use strict';

  var login = document.getElementById('login');
  var library = document.getElementById('library');
  var status = document.getElementById('status');
  var empty = document.getElementById('empty');
  var files = document.getElementById('files');

  function say(text) { status.textContent = text || ''; }

  async function api(path, options) {
    var opts = options || {};
    var res = await fetch(path, {
      method: opts.method || 'GET',
      credentials: 'same-origin',
      headers: opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' },
      body: opts.body instanceof FormData ? opts.body : opts.body ? JSON.stringify(opts.body) : undefined
    });
    if (res.status === 401) return null;
    var body = {};
    try { body = await res.json(); } catch (err) { body = {}; }
    if (!res.ok) throw new Error(body.message || 'Request failed');
    return body;
  }

  function formFor(photo) {
    var form = new FormData();
    form.append('full', photo.full, 'photo.jpg');
    form.append('thumb', photo.thumb, 'thumb.jpg');
    form.append('width', String(photo.width));
    form.append('height', String(photo.height));
    if (photo.original) form.append('original', photo.original, 'original.jpg');
    return form;
  }

  async function saveCrop(photo) {
    var replaceId = photo.source && photo.source.replaceId;
    if (replaceId) {
      await api('/glance/api/photos/' + replaceId, { method: 'PUT', body: formFor(photo) });
      return;
    }
    await api('/glance/api/photos', { method: 'POST', body: formFor(photo) });
  }

  function openCrop(items) {
    if (!window.GlanceCrop) {
      say('Crop is unavailable');
      return;
    }
    var saved = false;
    GlanceCrop.open(items, {
      onSave: async function (photo) {
        await saveCrop(photo);
        saved = true;
      },
      onError: function (err) { say(err.message || 'Could not save a photo'); },
      onDone: function () {
        if (saved) say('Saved');
        refresh().catch(function (err) { say(err.message || 'Could not load photos'); });
      }
    });
  }

  async function refresh() {
    var body = await api('/glance/api/photos');
    if (!body) {
      login.hidden = false;
      library.hidden = true;
      return;
    }
    login.hidden = true;
    library.hidden = false;
    if (window.GlanceGallery) GlanceGallery.show(body.photos || []);
    else if (empty) empty.hidden = (body.photos || []).length > 0;
  }

  document.getElementById('login').addEventListener('submit', async function (event) {
    event.preventDefault();
    var error = document.getElementById('login-error');
    var input = document.getElementById('password');
    error.textContent = '';
    try {
      var res = await fetch('/glance/api/login', {
        method: 'POST',
        credentials: 'same-origin',
        redirect: 'manual',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ password: input.value })
      });
      if (res.status === 401 || res.status === 429) {
        var body = {};
        try { body = await res.json(); } catch (err) { body = {}; }
        error.textContent = body.message || 'Wrong password';
        return;
      }
      await refresh();
    } catch (err) {
      error.textContent = 'Could not sign in';
    }
  });

  files.addEventListener('change', function () {
    var chosen = Array.prototype.slice.call(files.files || []);
    files.value = '';
    if (!chosen.length) return;
    openCrop(chosen.map(function (file) { return { file: file }; }));
  });

  refresh().catch(function (err) { say(err.message || 'Could not load photos'); });
})();
