window.LiveViewPlayer = (function () {
  function classify(raw) {
    if (!raw) return null;
    let url;
    try {
      url = new URL(String(raw).trim());
    } catch (error) {
      return null;
    }
    const host = url.hostname.replace(/^www\./, '');
    if (host === 'youtu.be' || host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
      let id = url.searchParams.get('v');
      if (host === 'youtu.be') id = url.pathname.replace(/^\//, '').split('/')[0];
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts[0] === 'embed' || parts[0] === 'live') id = parts[1];
      if (!id) return { type: 'link', href: raw };
      return { type: 'iframe', src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?rel=0` };
    }
    if (host === 'player.twitch.tv' || host.endsWith('twitch.tv')) {
      const channel = host === 'player.twitch.tv'
        ? url.searchParams.get('channel')
        : url.pathname.split('/').filter(Boolean)[0];
      if (!channel || channel === 'videos') return { type: 'link', href: raw };
      const parent = window.location.hostname || 'localhost';
      return {
        type: 'iframe',
        src: `https://player.twitch.tv/?channel=${encodeURIComponent(channel)}&parent=${encodeURIComponent(parent)}&autoplay=false`
      };
    }
    if (host === 'player.vimeo.com' || host.endsWith('vimeo.com')) {
      const id = url.pathname.split('/').filter(Boolean).pop();
      if (!id) return { type: 'link', href: raw };
      return { type: 'iframe', src: `https://player.vimeo.com/video/${encodeURIComponent(id)}` };
    }
    if (/\.m3u8(\?|$)/i.test(url.href)) return { type: 'hls', src: url.href };
    return { type: 'link', href: url.href };
  }

  function ensureFrame(video) {
    let frame = video.parentElement?.querySelector('iframe.course-embed');
    if (!frame && video.parentElement) {
      frame = document.createElement('iframe');
      frame.className = 'course-embed';
      frame.setAttribute('allow', 'autoplay; fullscreen; picture-in-picture');
      frame.setAttribute('allowfullscreen', 'true');
      frame.title = 'Course stream';
      video.parentElement.insertBefore(frame, video);
    }
    return frame;
  }

  function show(video, source, onFatal) {
    if (!video) return false;
    const kind = classify(source);
    const frame = ensureFrame(video);
    if (!kind) return false;
    if (kind.type === 'iframe' && frame) {
      video.style.display = 'none';
      try { video.pause(); } catch (error) { /* ignore */ }
      frame.style.display = 'block';
      frame.src = kind.src;
      return true;
    }
    if (frame) {
      frame.style.display = 'none';
      frame.removeAttribute('src');
    }
    if (kind.type === 'hls') {
      video.style.display = 'block';
      if (window.Hls && window.Hls.isSupported()) {
        const hls = new window.Hls();
        hls.loadSource(kind.src);
        hls.attachMedia(video);
        hls.on(window.Hls.Events.ERROR, function (_event, data) {
          if (data.fatal && onFatal) onFatal();
        });
        return true;
      }
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = kind.src;
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
