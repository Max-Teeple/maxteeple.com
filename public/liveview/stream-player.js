window.LiveViewPlayer = (function () {
  function classify(raw) {
    if (!raw) return null;
    let url;
    try {
      url = new URL(String(raw).trim(), window.location.origin);
    } catch (error) {
      return null;
    }
    if (/\.(mp4|webm)(\?|$)/i.test(url.pathname)) {
      return { type: 'file', src: url.href, loop: true };
    }
    const host = url.hostname.replace(/^www\./, '');
    if (host === 'youtu.be' || host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
      let id = url.searchParams.get('v');
      if (host === 'youtu.be') id = url.pathname.replace(/^\//, '').split('/')[0];
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts[0] === 'embed' || parts[0] === 'live') id = parts[1];
      if (!id) return { type: 'link', href: raw };
      const youtube = new URLSearchParams({ rel: '0' });
      if (tvOn()) {
        youtube.set('autoplay', '1');
        youtube.set('mute', '1');
        youtube.set('controls', '0');
        youtube.set('modestbranding', '1');
        youtube.set('playsinline', '1');
        youtube.set('disablekb', '1');
        youtube.set('iv_load_policy', '3');
      }
      return { type: 'iframe', src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?${youtube.toString()}` };
    }
    if (host === 'player.twitch.tv' || host.endsWith('twitch.tv')) {
      const channel = host === 'player.twitch.tv'
        ? url.searchParams.get('channel')
        : url.pathname.split('/').filter(Boolean)[0];
      if (!channel || channel === 'videos') return { type: 'link', href: raw };
      const parent = window.location.hostname || 'localhost';
      const twitch = tvOn() ? 'autoplay=true&muted=true' : 'autoplay=false';
      return {
        type: 'iframe',
        src: `https://player.twitch.tv/?channel=${encodeURIComponent(channel)}&parent=${encodeURIComponent(parent)}&${twitch}`
      };
    }
    if (host === 'player.vimeo.com' || host.endsWith('vimeo.com')) {
      const id = url.pathname.split('/').filter(Boolean).pop();
      if (!id) return { type: 'link', href: raw };
      const vimeo = tvOn() ? '?autoplay=1&muted=1&controls=0&playsinline=1' : '';
      return { type: 'iframe', src: `https://player.vimeo.com/video/${encodeURIComponent(id)}${vimeo}` };
    }
    if (/\.m3u8(\?|$)/i.test(url.href)) return { type: 'hls', src: url.href };
    return { type: 'link', href: url.href };
  }

  function tvOn() {
    return Boolean(window.LiveViewTv);
  }

  function ensureFrame(video) {
    let frame = video.parentElement?.querySelector('iframe.course-embed');
    if (!frame && video.parentElement) {
      frame = document.createElement('iframe');
      frame.className = 'course-embed';
      frame.setAttribute('allow', 'autoplay; fullscreen; picture-in-picture');
      frame.setAttribute('allowfullscreen', 'true');
      frame.title = 'Course stream';
      if (tvOn()) frame.setAttribute('tabindex', '-1');
      video.parentElement.insertBefore(frame, video);
    }
    return frame;
  }

  function release(video) {
    if (video._lvHls) {
      try { video._lvHls.destroy(); } catch (error) { /* ignore */ }
      video._lvHls = null;
    }
  }

  function applyTv(video) {
    if (!tvOn()) return;
    video.muted = true;
    video.defaultMuted = true;
    video.setAttribute('muted', '');
    video.autoplay = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.controls = false;
    video.removeAttribute('controls');
    const play = video.play();
    if (play && play.catch) play.catch(function () { /* a kiosk may need a second try */ });
  }

  function brand(video) {
    const stage = video.closest('.stream-stage, .highlight-stage, .hero-stage, .tv-stage, .modal-stage, .broadcast-player');
    if (stage && window.LiveViewOverlay && window.LiveViewOverlay.ensureBrand) {
      window.LiveViewOverlay.ensureBrand(stage, tvOn());
    }
  }

  function show(video, source, onFatal) {
    if (!video) return false;
    const kind = classify(source);
    const frame = ensureFrame(video);
    if (!kind) return false;
    release(video);
    if (kind.type === 'iframe' && frame) {
      video.style.display = 'none';
      try { video.pause(); } catch (error) { /* ignore */ }
      frame.style.display = 'block';
      frame.src = kind.src;
      brand(video);
      return true;
    }
    if (frame) {
      frame.style.display = 'none';
      frame.removeAttribute('src');
    }
    if (kind.type === 'file') {
      video.style.display = 'block';
      video.loop = true;
      video.muted = true;
      video.autoplay = true;
      video.playsInline = true;
      video.src = kind.src;
      const play = video.play();
      if (play && play.catch) play.catch(function () { /* autoplay can wait for a tap */ });
      applyTv(video);
      brand(video);
      return true;
    }
    if (kind.type === 'hls') {
      video.style.display = 'block';
      if (window.Hls && window.Hls.isSupported()) {
        const hls = new window.Hls();
        video._lvHls = hls;
        hls.loadSource(kind.src);
        hls.attachMedia(video);
        hls.on(window.Hls.Events.MANIFEST_PARSED, function () { applyTv(video); });
        hls.on(window.Hls.Events.ERROR, function (_event, data) {
          if (data.fatal && onFatal) onFatal();
        });
        applyTv(video);
        brand(video);
        return true;
      }
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = kind.src;
        applyTv(video);
        brand(video);
        return true;
      }
      return false;
    }
    return false;
  }

  function playbackSource(course) {
    if (!course) return '';
    if (course.hls_url) return course.hls_url;
    return course.stream_url || '';
  }

  return { classify, show, playbackSource };
})();
