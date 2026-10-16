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

  function decode(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file).then(function (bitmap) {
        return { source: bitmap, width: bitmap.width, height: bitmap.height, close: function () { if (bitmap.close) bitmap.close(); } };
      });
    }
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        resolve({ source: img, width: img.naturalWidth, height: img.naturalHeight, close: function () {} });
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('That photo could not be prepared'));
      };
      img.src = url;
    });
  }

  function blobFrom(source, width, height, quality) {
    var canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    var ctx = canvas.getContext('2d', { alpha: false });
    ctx.drawImage(source, 0, 0, width, height);
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (!blob) reject(new Error('That photo could not be prepared'));
        else resolve(blob);
      }, 'image/jpeg', quality);
    });
  }

  function scaled(width, height, maxEdge) {
    var scale = Math.min(1, maxEdge / Math.max(width, height));
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
  }

  async function prepare(file) {
    var image = await decode(file);
    try {
      var fullSize = scaled(image.width, image.height, 1600);
      var thumbSize = scaled(image.width, image.height, 480);
      var full = await blobFrom(image.source, fullSize.width, fullSize.height, 0.8);
      var thumb = await blobFrom(image.source, thumbSize.width, thumbSize.height, 0.72);
      return { full: full, thumb: thumb, width: fullSize.width, height: fullSize.height };
    } finally {
      image.close();
    }
  }

  function render(list) {
    thumbs.replaceChildren();
    empty.hidden = list.length > 0;
    list.forEach(function (photo) {
      var item = document.createElement('li');
      var img = document.createElement('img');
      img.src = '/glance/api/photos/' + photo.id + '/thumb';
      img.alt = '';
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
      item.append(img, button);
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

  files.addEventListener('change', async function () {
    var chosen = Array.prototype.slice.call(files.files || []);
    files.value = '';
    if (!chosen.length) return;
    for (var i = 0; i < chosen.length; i++) {
      say('Saving ' + (i + 1) + ' of ' + chosen.length);
      try {
        var photo = await prepare(chosen[i]);
        var form = new FormData();
        form.append('full', photo.full, 'photo.jpg');
        form.append('thumb', photo.thumb, 'thumb.jpg');
        form.append('width', String(photo.width));
        form.append('height', String(photo.height));
        await api('/glance/api/photos', { method: 'POST', body: form });
      } catch (err) {
        say(err.message || 'Could not save a photo');
        await refresh();
        return;
      }
    }
    say('Saved');
    await refresh();
  });

  refresh().catch(function (err) { say(err.message || 'Could not load photos'); });
})();
