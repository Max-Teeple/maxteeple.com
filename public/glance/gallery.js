/* Manage Photos grid and viewer. Thumbs stay small and lazy for the iPad. */
(function (global) {
  'use strict';

  var list = [];
  var current = null;
  var stamp = 1;
  var busy = false;
  var onChange = function () {};
  var bound = false;

  function $(id) { return document.getElementById(id); }

  function thumbUrl(id) { return '/glance/api/photos/' + id + '/thumb?v=' + stamp; }
  function fullUrl(id) { return '/glance/api/photos/' + id + '?v=' + stamp; }

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

  function formFor(photo) {
    var form = new FormData();
    form.append('full', photo.full, 'photo.jpg');
    form.append('thumb', photo.thumb, 'thumb.jpg');
    form.append('width', String(photo.width));
    form.append('height', String(photo.height));
    if (photo.original) form.append('original', photo.original, 'original.jpg');
    return form;
  }

  async function sourceFor(id) {
    var original = await fetch('/glance/api/photos/' + id + '/original?v=' + stamp, { credentials: 'same-origin' });
    if (original.ok) return { file: await original.blob(), upgradeOriginal: false };
    var full = await fetch(fullUrl(id), { credentials: 'same-origin' });
    if (!full.ok) throw new Error('Could not load that photo');
    return { file: await full.blob(), upgradeOriginal: true };
  }

  function render() {
    var grid = $('gallery-grid');
    var empty = $('gallery-empty') || $('empty');
    if (!grid) return;
    if (empty) empty.hidden = list.length > 0;
    grid.replaceChildren();
    list.forEach(function (photo) {
      var item = document.createElement('li');
      var button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-label', 'Open photo');
      var img = document.createElement('img');
      img.alt = '';
      img.width = 320;
      img.height = 240;
      img.loading = 'lazy';
      img.decoding = 'async';
      img.src = thumbUrl(photo.id);
      button.appendChild(img);
      button.addEventListener('click', function () { openViewer(photo); });
      item.appendChild(button);
      grid.appendChild(item);
    });
  }

  function setConfirm(open) {
    var box = $('viewer-confirm');
    if (box) box.hidden = !open;
  }

  function openViewer(photo) {
    current = photo;
    var viewer = $('viewer');
    var img = $('viewer-img');
    if (!viewer || !img) return;
    setConfirm(false);
    img.src = fullUrl(photo.id);
    viewer.hidden = false;
  }

  function closeViewer() {
    var viewer = $('viewer');
    if (viewer) viewer.hidden = true;
    current = null;
    setConfirm(false);
  }

  async function reload() {
    var body = await api('/glance/api/photos');
    list = body.photos || [];
    stamp += 1;
    render();
    if (current) {
      var still = list.filter(function (photo) { return photo.id === current.id; })[0];
      if (!still) closeViewer();
      else openViewer(still);
    }
    onChange(list);
  }

  async function saveReplacement(id, photo, upgrade) {
    if (upgrade && !photo.original) photo.original = photo.full;
    await api('/glance/api/photos/' + id, { method: 'PUT', body: formFor(photo) });
    await reload();
  }

  function bind() {
    if (bound) return;
    bound = true;
    var back = $('viewer-back');
    var recrop = $('viewer-recrop');
    var left = $('viewer-left');
    var right = $('viewer-right');
    var remove = $('viewer-delete');
    var yes = $('viewer-yes');
    var no = $('viewer-no');
    var close = $('gallery-close');
    if (back) back.addEventListener('click', closeViewer);
    if (close) close.addEventListener('click', function () {
      closeViewer();
      var root = $('gallery');
      if (root) root.hidden = true;
      onChange(list);
    });
    if (no) no.addEventListener('click', function () { setConfirm(false); });
    if (remove) remove.addEventListener('click', function () { setConfirm(true); });
    if (yes) yes.addEventListener('click', async function () {
      if (!current || busy) return;
      busy = true;
      try {
        await api('/glance/api/photos/' + current.id, { method: 'DELETE' });
        closeViewer();
        await reload();
      } catch (err) {
        var status = $('viewer-status');
        if (status) status.textContent = err.message || 'Could not delete that photo';
      }
      busy = false;
    });
    if (recrop) recrop.addEventListener('click', async function () {
      if (!current || !global.GlanceCrop || busy) return;
      var id = current.id;
      busy = true;
      try {
        setConfirm(false);
        var source = await sourceFor(id);
        GlanceCrop.open([{ file: source.file, replaceId: id, upgradeOriginal: source.upgradeOriginal }], {
          onSave: function (photo) { return saveReplacement(id, photo, source.upgradeOriginal); },
          onDone: function () { busy = false; }
        });
      } catch (err) {
        busy = false;
        var status = $('viewer-status');
        if (status) status.textContent = err.message || 'Could not open that photo';
      }
    });
    function spin(delta) {
      return async function () {
        if (!current || !global.GlanceCrop || busy) return;
        var id = current.id;
        busy = true;
        var status = $('viewer-status');
        if (status) status.textContent = 'Saving';
        try {
          var source = await sourceFor(id);
          var baked = await GlanceCrop.bake(source.file, delta);
          baked.original = baked.original || baked.full;
          await saveReplacement(id, baked, true);
          if (status) status.textContent = 'Saved';
        } catch (err) {
          if (status) status.textContent = err.message || 'Could not rotate that photo';
        }
        busy = false;
      };
    }
    if (left) left.addEventListener('click', spin(-1));
    if (right) right.addEventListener('click', spin(1));
  }

  function show(photos) {
    bind();
    list = photos || [];
    render();
  }

  function open() {
    bind();
    var root = $('gallery');
    if (root) root.hidden = false;
    reload().catch(function () { render(); });
  }

  global.GlanceGallery = {
    show: show,
    open: open,
    refresh: reload,
    bind: function (hooks) {
      bind();
      if (hooks && hooks.onChange) onChange = hooks.onChange;
    }
  };
})(window);
