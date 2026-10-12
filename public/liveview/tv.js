(function () {
    window.LiveViewTv = true;

    const HEAL_MS = 22 * 60 * 1000;
    const POLL_MS = 18000;
    const stage = document.getElementById('tvStage');
    const video = document.getElementById('tvPlayer');
    const slide = document.getElementById('offlineSlide');
    const nameEl = document.getElementById('tvCourseName');
    const nextEl = document.getElementById('tvNext');
    const slug = new URLSearchParams(window.location.search).get('slug') || '';

    let course = null;
    let overlayHandle = null;
    let playingSource = '';
    let wantLive = false;
    let attempt = 0;
    let retryTimer = 0;
    let stallTimer = 0;
    let wakeLock = null;
    let misses = 0;

    function formatWhen(value) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        return date.toLocaleString(undefined, {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        });
    }

    function sourceOf(row) {
        if (!row) return '';
        return window.LiveViewPlayer?.playbackSource(row) || row.playback_url || row.stream_url || '';
    }

    function showOffline(row) {
        wantLive = false;
        window.clearTimeout(retryTimer);
        window.clearTimeout(stallTimer);
        if (nameEl) nameEl.textContent = row?.name || (slug ? 'Course not found' : 'LiveView');
        if (nextEl) {
            const when = row?.next_stream_at ? formatWhen(row.next_stream_at) : '';
            nextEl.textContent = when
                ? `Next stream ${when}`
                : (slug ? 'The next broadcast will start on this screen.' : 'Open this page with a course link from the studio.');
        }
        if (slide) slide.hidden = false;
        window.LiveViewOverlay?.ensureBrand(stage, true);
        const frame = stage.querySelector('iframe.course-embed');
        if (frame) {
            frame.style.display = 'none';
            frame.removeAttribute('src');
        }
        try { video.pause(); } catch (error) { /* ignore */ }
    }

    function showLive() {
        if (slide) slide.hidden = true;
        video.style.visibility = 'visible';
    }

    async function loadOverlay(row) {
        window.LiveViewOverlay?.ensureBrand(stage, true);
        if (!row?.id) return;
        const response = await fetch(`/liveview/courses/${row.id}/overlay`);
        const data = await response.json().catch(() => ({}));
        const enabled = data.success && data.overlay && data.overlay.viewer_enabled !== false;
        if (!enabled) {
            overlayHandle?.destroy();
            overlayHandle = null;
            window.LiveViewOverlay?.ensureBrand(stage, true);
            return;
        }
        const payload = Object.assign({}, data.overlay, {
            courseName: data.course?.name || row.name || '',
            courseLogo: data.course?.logo || '',
            isLive: Boolean(row.is_live)
        });
        if (overlayHandle) overlayHandle.update(payload);
        else overlayHandle = window.LiveViewOverlay.mount(stage, payload, { tee: 'white', tv: true });
    }

    function scheduleRetry() {
        if (!wantLive) return;
        const delay = Math.min(30000, 2000 * (2 ** attempt));
        attempt = Math.min(attempt + 1, 8);
        window.clearTimeout(retryTimer);
        retryTimer = window.setTimeout(function () {
            playingSource = '';
            play();
        }, delay);
    }

    function armStall() {
        if (!wantLive) return;
        window.clearTimeout(stallTimer);
        stallTimer = window.setTimeout(function () {
            if (!wantLive) return;
            if (video.paused || video.readyState < 2) scheduleRetry();
        }, 12000);
    }

    function play() {
        const source = sourceOf(course);
        if (!course || !course.is_live || !source) {
            showOffline(course);
            playingSource = '';
            return;
        }
        wantLive = true;
        showLive();
        if (source === playingSource && !video.paused && video.readyState >= 2) return;
        const started = window.LiveViewPlayer?.show(video, source, scheduleRetry);
        if (!started) {
            scheduleRetry();
            return;
        }
        playingSource = source;
        video.muted = true;
        video.controls = false;
        const pending = video.play();
        if (pending && pending.catch) pending.catch(function () { /* muted autoplay retry is scheduled on stall */ });
    }

    async function refresh() {
        if (!slug) {
            showOffline(null);
            return;
        }
        try {
            const response = await fetch(`/liveview/courses/slug/${encodeURIComponent(slug)}`);
            if (!response.ok) {
                misses += 1;
                if (misses >= 3 || !course) showOffline(null);
                return;
            }
            const data = await response.json();
            misses = 0;
            course = data.course || null;
            if (course?.name) document.title = `${course.name} — Clubhouse TV`;
            await loadOverlay(course);
            play();
        } catch (error) {
            misses += 1;
            if (misses >= 3 && !wantLive) showOffline(course);
        }
    }

    async function requestWakeLock() {
        try {
            if (navigator.wakeLock && navigator.wakeLock.request) {
                wakeLock = await navigator.wakeLock.request('screen');
                wakeLock.addEventListener('release', function () { wakeLock = null; });
                return;
            }
        } catch (error) {
            wakeLock = null;
        }
        const pending = video.play();
        if (pending && pending.catch) pending.catch(function () { /* screensaver fallback is the playing picture */ });
    }

    function requestFullscreen() {
        const el = document.documentElement;
        const req = el.requestFullscreen || el.webkitRequestFullscreen || el.webkitRequestFullScreen;
        if (!req) return;
        try {
            const result = req.call(el);
            if (result && result.catch) result.catch(function () { /* already full screen in a kiosk */ });
        } catch (error) { /* ignore */ }
    }

    video.addEventListener('playing', function () {
        attempt = 0;
        window.clearTimeout(stallTimer);
    });
    video.addEventListener('error', scheduleRetry);
    video.addEventListener('stalled', armStall);
    video.addEventListener('waiting', armStall);
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') {
            requestWakeLock();
            if (wantLive) video.play().catch(function () { /* ignore */ });
        }
    });

    window.setTimeout(function () { window.location.reload(); }, HEAL_MS);
    window.setInterval(requestWakeLock, 60000);
    window.setInterval(refresh, POLL_MS);
    requestFullscreen();
    requestWakeLock();
    refresh();
})();
