// LiveView is mounted at /liveview/ on maxteeple.com.
(function () {
  var base = '/liveview';
  window.LIVEVIEW_BASE = base;
  var origin = window.location.origin;
  window.config = {
    apiBaseUrl: origin + base,
    assetBase: origin + base
  };
  // Change this if the course-setup mailbox moves. Help links read it.
  window.LIVEVIEW_HELP_EMAIL = 'max.teeple@gmail.com';
  window.liveviewPage = function () {
    var last = (window.location.pathname || '').split('/').pop() || '';
    if (!last || last === 'liveview') return 'index.html';
    if (last.indexOf('.') === -1) return last + '.html';
    return last;
  };
})();
