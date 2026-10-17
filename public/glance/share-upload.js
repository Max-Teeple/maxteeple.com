(function () {
  'use strict';

  var status = document.getElementById('share-status');
  var form = document.getElementById('share-form');
  var files = document.getElementById('files');
  var token = (location.pathname.split('/').pop() || '').split('?')[0];

  function say(text) { status.textContent = text || ''; }

  async function check() {
    var res = await fetch('/glance/api/share/' + encodeURIComponent(token), { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      var body = {};
      try { body = await res.json(); } catch (err) { body = {}; }
      form.hidden = true;
      say(body.message || 'This link is not valid');
      return false;
    }
    say('');
    return true;
  }

  function formFor(photo) {
    var data = new FormData();
    data.append('full', photo.full, 'photo.jpg');
    data.append('thumb', photo.thumb, 'thumb.jpg');
    data.append('width', String(photo.width));
    data.append('height', String(photo.height));
    if (photo.original) data.append('original', photo.original, 'original.jpg');
    var name = document.getElementById('share-name').value.trim();
    if (name) data.append('credit', name);
    return data;
  }

  files.addEventListener('change', function () {
    var chosen = Array.prototype.slice.call(files.files || []);
    files.value = '';
    if (!chosen.length || !window.GlanceCrop) return;
    var saved = 0;
    GlanceCrop.open(chosen.map(function (file) { return { file: file }; }), {
      onSave: async function (photo) {
        var res = await fetch('/glance/api/share/' + encodeURIComponent(token) + '/photos', {
          method: 'POST',
          headers: { Accept: 'application/json' },
          body: formFor(photo)
        });
        var body = {};
        try { body = await res.json(); } catch (err) { body = {}; }
        if (!res.ok) throw new Error(body.message || 'Could not save that photo');
        saved += 1;
      },
      onDone: function () {
        if (saved) say(saved === 1 ? 'Saved. It will show on the kitchen board.' : 'Saved ' + saved + ' photos.');
      },
      onError: function (err) { say(err.message || 'Could not save that photo'); }
    });
  });

  check().catch(function () {
    form.hidden = true;
    say('This link is not valid');
  });
})();
