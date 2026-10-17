(function () {
  'use strict';

  var login = document.getElementById('login');
  var library = document.getElementById('library');
  var status = document.getElementById('status');
  var empty = document.getElementById('empty');
  var thumbs = document.getElementById('thumbs');
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

  function render(list) {
    thumbs.replaceChildren();
    empty.hidden = list.length > 0;
    list.forEach(function (photo) {
      var item = document.createElement('li');
      var img = document.createElement('img');
      img.src = '/glance/api/photos/' + photo.id + '/thumb';
      img.alt = '';
      var actions = document.createElement('div');
      actions.className = 'thumb-actions';
      var recrop = document.createElement('button');
      recrop.type = 'button';
      recrop.textContent = 'Recrop';
      recrop.addEventListener('click', async function () {
        recrop.disabled = true;
        say('Loading photo');
        try {
          var res = await fetch('/glance/api/photos/' + photo.id, { credentials: 'same-origin' });
          if (!res.ok) throw new Error('Could not load that photo');
          var blob = await res.blob();
          say('');
          openCrop([{ file: blob, replaceId: photo.id }]);
        } catch (err) {
          say(err.message || 'Could not load that photo');
        }
        recrop.disabled = false;
      });
      var button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Delete';
      button.addEventListener('click', async function () {
        if (!window.confirm('Delete this photo?')) return;
        button.disabled = true;
        try {
          await api('/glance/api/photos/' + photo.id, { method: 'DELETE' });
          await refresh();
        } catch (err) {
          button.disabled = false;
          say(err.message || 'Could not delete that photo');
        }
      });
      actions.append(recrop, button);
      item.append(img, actions);
      thumbs.appendChild(item);
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
    render(body.photos || []);
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
