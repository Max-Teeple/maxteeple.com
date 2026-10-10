(function () {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/liveview/sw.js?v=4', { scope: '/liveview/' }).then((reg) => {
      reg.update();
    }).catch(() => {});
  });
})();
