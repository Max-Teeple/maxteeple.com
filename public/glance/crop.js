/* Fixed 4:3 landscape crop. No library. The iPad board is 1366x1024. */
(function (global) {
  'use strict';

  var OUT_W = 1366;
  var OUT_H = 1024;
  var RATIO = OUT_W / OUT_H;
  var MAX_ZOOM = 4;

  var root, stage, view, slider, countEl, saveBtn, statusEl;
  var queue = [];
  var index = 0;
  var hooks = {};
  var base = null;
  var image = null;
  var turns = 0;
  var zoom = 1;
  var ox = 0;
  var oy = 0;
  var points = {};
  var pinch = null;
  var busy = false;
  var drawQueued = false;
  var bound = false;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function els() {
    root = document.getElementById('crop');
    stage = document.getElementById('crop-stage');
    view = document.getElementById('crop-view');
    slider = document.getElementById('crop-zoom');
    countEl = document.getElementById('crop-count');
    saveBtn = document.getElementById('crop-save');
    statusEl = document.getElementById('crop-status');
    return !!(root && stage && view && slider && saveBtn);
  }

  function say(text) {
    if (statusEl) statusEl.textContent = text || '';
  }

  function decode(blob) {
    if (global.createImageBitmap) {
      return createImageBitmap(blob).then(function (bitmap) {
        return {
          source: bitmap,
          width: bitmap.width,
          height: bitmap.height,
          close: function () { if (bitmap.close) bitmap.close(); }
        };
      });
    }
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob);
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

  function cover() {
    if (image.width / image.height > RATIO) return { w: image.height * RATIO, h: image.height };
    return { w: image.width, h: image.width / RATIO };
  }

  function cropRect() {
    var base = cover();
    var w = base.w / zoom;
    var h = base.h / zoom;
    var x = clamp(image.width / 2 + ox - w / 2, 0, Math.max(0, image.width - w));
    var y = clamp(image.height / 2 + oy - h / 2, 0, Math.max(0, image.height - h));
    ox = x + w / 2 - image.width / 2;
    oy = y + h / 2 - image.height / 2;
    return { x: x, y: y, w: w, h: h };
  }

  function layout() {
    var maxW = Math.max(160, Math.min(window.innerWidth - 28, 860));
    var maxH = Math.max(120, Math.min(window.innerHeight - 270, 640));
    var w = maxW;
    var h = w / RATIO;
    if (h > maxH) {
      h = maxH;
      w = h * RATIO;
    }
    w = Math.round(w);
    h = Math.round(h);
    stage.style.width = w + 'px';
    stage.style.height = h + 'px';
    var dpr = Math.min(2, global.devicePixelRatio || 1);
    view.width = Math.round(w * dpr);
    view.height = Math.round(h * dpr);
  }

  function draw() {
    if (!image) return;
    var ctx = view.getContext('2d', { alpha: false });
    var rect = cropRect();
    ctx.drawImage(image.source, rect.x, rect.y, rect.w, rect.h, 0, 0, view.width, view.height);
  }

  function requestDraw() {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(function () {
      drawQueued = false;
      draw();
    });
  }

  function setZoom(next) {
    zoom = clamp(next, 1, MAX_ZOOM);
    slider.value = String(zoom);
    requestDraw();
  }

  function pan(dx, dy) {
    ox += dx;
    oy += dy;
    cropRect();
    requestDraw();
  }

  function toJpeg(source, rect, width, height, quality) {
    var canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    var ctx = canvas.getContext('2d', { alpha: false });
    ctx.drawImage(source, rect.x, rect.y, rect.w, rect.h, 0, 0, width, height);
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (!blob) reject(new Error('That photo could not be prepared'));
        else resolve(blob);
      }, 'image/jpeg', quality);
    });
  }

  function jpeg(width, height, quality) {
    return toJpeg(image.source, cropRect(), width, height, quality);
  }

  function limitEdge(decoded, maxEdge) {
    var edge = Math.max(decoded.width, decoded.height);
    if (edge <= maxEdge) return decoded;
    var scale = maxEdge / edge;
    var w = Math.max(1, Math.round(decoded.width * scale));
    var h = Math.max(1, Math.round(decoded.height * scale));
    var canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d', { alpha: false }).drawImage(decoded.source, 0, 0, w, h);
    decoded.close();
    return { source: canvas, width: w, height: h, close: function () {} };
  }

  function applyTurn() {
    var t = ((turns % 4) + 4) % 4;
    if (!base) {
      image = null;
      return;
    }
    if (t === 0) {
      image = base;
      return;
    }
    var canvas = document.createElement('canvas');
    var w = base.width;
    var h = base.height;
    if (t % 2) {
      canvas.width = h;
      canvas.height = w;
    } else {
      canvas.width = w;
      canvas.height = h;
    }
    var ctx = canvas.getContext('2d', { alpha: false });
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(t * Math.PI / 2);
    ctx.drawImage(base.source, -w / 2, -h / 2);
    image = { source: canvas, width: canvas.width, height: canvas.height, close: function () {} };
  }

  function turn(delta) {
    if (busy || !base) return;
    turns = (turns + delta + 4) % 4;
    zoom = 1;
    ox = 0;
    oy = 0;
    slider.value = '1';
    applyTurn();
    requestDraw();
  }

  function paintChrome() {
    var total = queue.length;
    countEl.textContent = total > 1 ? (index + 1) + ' of ' + total : 'Crop';
    saveBtn.textContent = index < total - 1 ? 'Next' : 'Save';
  }

  function closeImage() {
    if (base) base.close();
    base = null;
    image = null;
    turns = 0;
  }

  async function showCurrent() {
    closeImage();
    busy = true;
    say('Preparing photo');
    zoom = 1;
    ox = 0;
    oy = 0;
    pinch = null;
    points = {};
    slider.value = '1';
    paintChrome();
    layout();
    try {
      base = limitEdge(await decode(queue[index].file), 2400);
      turns = 0;
      applyTurn();
      say('');
      draw();
    } catch (err) {
      say(err.message || 'That photo could not be prepared');
      if (hooks.onError) hooks.onError(err);
    }
    busy = false;
  }

  function hide() {
    closeImage();
    if (root) root.hidden = true;
    queue = [];
  }

  async function commit(center) {
    if (busy || !image) return;
    busy = true;
    saveBtn.disabled = true;
    if (center) {
      zoom = 1;
      ox = 0;
      oy = 0;
      slider.value = '1';
    }
    try {
      var full = await jpeg(OUT_W, OUT_H, 0.82);
      var thumb = await jpeg(320, 240, 0.7);
      var item = queue[index];
      var original = null;
      if (!item.replaceId || turns !== 0 || item.upgradeOriginal) {
        original = await toJpeg(image.source, { x: 0, y: 0, w: image.width, h: image.height }, image.width, image.height, 0.86);
      }
      if (hooks.onSave) {
        await hooks.onSave({
          full: full,
          thumb: thumb,
          original: original,
          width: OUT_W,
          height: OUT_H,
          source: item
        });
      }
      index += 1;
      if (index >= queue.length) {
        hide();
        if (hooks.onDone) hooks.onDone();
        return;
      }
      await showCurrent();
    } catch (err) {
      say(err.message || 'Could not save that photo');
      if (hooks.onError) hooks.onError(err);
    } finally {
      busy = false;
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  function bind() {
    if (bound || !els()) return;
    bound = true;
    slider.addEventListener('input', function () { setZoom(Number(slider.value) || 1); });
    var left = document.getElementById('crop-left');
    var right = document.getElementById('crop-right');
    if (left) left.addEventListener('click', function () { turn(-1); });
    if (right) right.addEventListener('click', function () { turn(1); });
    document.getElementById('crop-skip').addEventListener('click', function () { commit(true); });
    saveBtn.addEventListener('click', function () { commit(false); });
    document.getElementById('crop-cancel').addEventListener('click', function () {
      if (busy) return;
      hide();
      if (hooks.onCancel) hooks.onCancel();
      if (hooks.onDone) hooks.onDone();
    });
    stage.addEventListener('pointerdown', function (event) {
      stage.setPointerCapture(event.pointerId);
      points[event.pointerId] = { x: event.clientX, y: event.clientY };
      pinch = null;
    });
    stage.addEventListener('pointermove', function (event) {
      var prev = points[event.pointerId];
      if (!prev || !image) return;
      points[event.pointerId] = { x: event.clientX, y: event.clientY };
      var ids = Object.keys(points);
      if (ids.length >= 2) {
        var a = points[ids[0]];
        var b = points[ids[1]];
        var dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        if (!pinch) pinch = { dist: dist, zoom: zoom };
        else setZoom(pinch.zoom * dist / pinch.dist);
        return;
      }
      var rect = cropRect();
      var box = stage.getBoundingClientRect();
      pan(-(event.clientX - prev.x) * rect.w / box.width, -(event.clientY - prev.y) * rect.h / box.height);
    });
    function up(event) {
      delete points[event.pointerId];
      if (Object.keys(points).length < 2) pinch = null;
    }
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
    stage.addEventListener('touchmove', function (event) { event.preventDefault(); }, { passive: false });
    window.addEventListener('resize', function () {
      if (!root || root.hidden || !image) return;
      layout();
      draw();
    });
  }

  function open(items, nextHooks) {
    if (!els()) return;
    bind();
    hide();
    queue = (items || []).filter(function (item) { return item && item.file; });
    if (!queue.length) return;
    hooks = nextHooks || {};
    index = 0;
    root.hidden = false;
    showCurrent();
  }

  async function bake(file, delta) {
    var decoded = limitEdge(await decode(file), 2400);
    var t = ((delta % 4) + 4) % 4;
    var frame = decoded;
    if (t !== 0) {
      var canvas = document.createElement('canvas');
      if (t % 2) {
        canvas.width = decoded.height;
        canvas.height = decoded.width;
      } else {
        canvas.width = decoded.width;
        canvas.height = decoded.height;
      }
      var ctx = canvas.getContext('2d', { alpha: false });
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(t * Math.PI / 2);
      ctx.drawImage(decoded.source, -decoded.width / 2, -decoded.height / 2);
      frame = { source: canvas, width: canvas.width, height: canvas.height, close: function () {} };
    }
    var coverW;
    var coverH;
    if (frame.width / frame.height > RATIO) {
      coverH = frame.height;
      coverW = frame.height * RATIO;
    } else {
      coverW = frame.width;
      coverH = frame.width / RATIO;
    }
    var rect = {
      x: (frame.width - coverW) / 2,
      y: (frame.height - coverH) / 2,
      w: coverW,
      h: coverH
    };
    var full = await toJpeg(frame.source, rect, OUT_W, OUT_H, 0.82);
    var thumb = await toJpeg(frame.source, rect, 320, 240, 0.7);
    var original = await toJpeg(frame.source, { x: 0, y: 0, w: frame.width, h: frame.height }, frame.width, frame.height, 0.86);
    decoded.close();
    return { full: full, thumb: thumb, original: original, width: OUT_W, height: OUT_H };
  }

  global.GlanceCrop = { open: open, bake: bake };
})(window);
