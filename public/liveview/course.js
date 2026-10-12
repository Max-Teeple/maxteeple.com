const params = new URLSearchParams(window.location.search);
const courseId = params.get('id');
const courseSlug = params.get('slug');
const apiBaseUrl = window.config?.apiBaseUrl || window.location.origin;

let viewer = null;
let activeCourse = null;

function getToken() {
    return localStorage.getItem('liveviewToken');
}

function authHeaders(extra = {}) {
    const token = getToken();
    return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
}

async function requestJson(url, options = {}) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) {
        throw new Error(data.message || 'Request failed');
    }
    return data;
}

async function loadViewer() {
    if (!getToken()) return null;
    try {
        const data = await requestJson(`${apiBaseUrl}/me`, { headers: authHeaders() });
        viewer = data.user;
        localStorage.setItem('liveviewUser', JSON.stringify(viewer));
        const profileLink = document.getElementById('profileBarLink');
        const profileName = document.getElementById('profileBarName');
        if (profileLink) {
            profileLink.href = `profile.html?id=${viewer.id}`;
            profileLink.onclick = () => {
                window.location.href = `profile.html?id=${viewer.id}`;
            };
        }
        if (profileName) profileName.textContent = window.LiveViewCore?.displayFirstName(viewer) || viewer.name?.split(/\s+/)[0] || viewer.name;
        if (profileLink) profileLink.style.display = 'inline-flex';
        return viewer;
    } catch (error) {
        localStorage.removeItem('liveviewToken');
        localStorage.removeItem('liveviewUser');
        return null;
    }
}

function escapeHtml(value = '') {
    return window.LiveViewCore?.escapeHtml ? window.LiveViewCore.escapeHtml(value) : String(value);
}

function setCourseActions() {
    const actions = document.getElementById('consumerCourseActions');
    const favoriteBtn = document.getElementById('favoriteCourseBtn');
    const followBtn = document.getElementById('followCourseBtn');
    const notifyBtn = document.getElementById('notifyCourseBtn');
    if (!actions || !favoriteBtn || !followBtn) return;
    if (!activeCourse || activeCourse.role === 'consumer') return;
    actions.hidden = false;
    actions.style.display = 'flex';
    if (!viewer || viewer.role !== 'consumer') {
        favoriteBtn.hidden = true;
        followBtn.textContent = 'Follow';
        if (notifyBtn) notifyBtn.textContent = 'Notify me';
        return;
    }
    favoriteBtn.hidden = false;
    const favoriteIds = viewer.favorite_course_ids || [];
    const followedIds = viewer.followed_course_ids || [];
    const cid = activeCourse?.id || courseId;
    const isFavorite = favoriteIds.map(Number).includes(Number(cid));
    const isFollowed = followedIds.map(Number).includes(Number(cid));

    favoriteBtn.textContent = isFavorite ? 'Remove Favorite' : 'Favorite Course';
    favoriteBtn.dataset.enabled = String(!isFavorite);
    followBtn.textContent = isFollowed ? 'Unfollow Course' : 'Follow Course';
    followBtn.dataset.enabled = String(!isFollowed);
}

async function updateCourseList(list, enabled) {
    if (!viewer) return;
    const data = await requestJson(`${apiBaseUrl}/profile/${viewer.id}/course-lists`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ courseId: activeCourse?.id || courseId, list, enabled })
    });
    viewer = data.user;
    localStorage.setItem('liveviewUser', JSON.stringify(viewer));
    setCourseActions();
}

function formatWhen(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function renderOfflineMessage(course, replayPlaying) {
    const video = document.getElementById('courseStreamPlayer');
    const noStreamMsg = document.getElementById('noStreamMsg');
    const nextLine = document.getElementById('nextStreamLine');
    if (!video || !noStreamMsg) return;

    const when = course.next_stream_at ? formatWhen(course.next_stream_at) : '';
    if (nextLine) {
        nextLine.hidden = !when;
        nextLine.textContent = when ? `Next stream ${when}` : '';
    }
    if (replayPlaying) {
        video.style.display = 'block';
        noStreamMsg.style.display = 'block';
        noStreamMsg.textContent = 'Latest replay is playing. Follow this course to catch the next broadcast.';
        return;
    }
    video.style.display = 'none';
    noStreamMsg.style.display = 'block';
    noStreamMsg.textContent = course.stream_approved
        ? 'This course is offline right now. Follow it and we will surface it when the next broadcast starts.'
        : 'This course is getting ready to broadcast.';
}

function setPageMeta(course) {
    document.title = `${course.name} — LiveView Golf`;
    const desc = course.description || `Watch ${course.name} on LiveView Golf.`;
    let meta = document.querySelector('meta[name="description"]');
    if (!meta) {
        meta = document.createElement('meta');
        meta.name = 'description';
        document.head.appendChild(meta);
    }
    meta.content = desc.slice(0, 160);
    const og = (prop, val) => {
        let el = document.querySelector(`meta[property="${prop}"]`);
        if (!el) {
            el = document.createElement('meta');
            el.setAttribute('property', prop);
            document.head.appendChild(el);
        }
        el.content = val;
    };
    og('og:title', course.name);
    og('og:description', desc.slice(0, 200));
    const ogImg = window.LiveViewCore?.coursePreviewImage(course);
    if (ogImg) {
        og('og:image', ogImg);
    }
}

async function loadHighlights(id) {
    const res = await fetch(`${apiBaseUrl}/courses/${id}/highlights`);
    const data = await res.json();
    const wrap = document.getElementById('highlightsList');
    if (!wrap || !data.success || !data.highlights?.length) return data.highlights || [];
    wrap.innerHTML = data.highlights.map((h) => {
        const label = h.demo_label ? `<span class="live-badge">${escapeHtml(h.demo_label)}</span>` : '';
        const when = h.recorded_at ? escapeHtml(new Date(h.recorded_at).toLocaleDateString()) : '';
        return `
        <article class="for-you-card">
            <strong>${escapeHtml(h.title || 'Replay')}</strong>
            ${label}
            <time>${when}</time>
            ${h.hls_url ? `<div class="stream-stage highlight-stage"><video class="highlight-video" data-src="${escapeHtml(h.hls_url)}" controls muted playsinline preload="metadata"></video><div class="lv-overlay-root" hidden></div></div>` : ''}
        </article>`;
    }).join('');
    document.getElementById('highlightsSection')?.removeAttribute('hidden');
    return data.highlights;
}

async function fetchCourse() {
    const url = courseSlug
        ? `${apiBaseUrl}/courses/slug/${encodeURIComponent(courseSlug)}`
        : `${apiBaseUrl}/profile/${courseId}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok || !data.success) {
        document.getElementById('courseName').textContent = 'Course unavailable';
        document.getElementById('courseDescription').textContent = data.message || 'We could not load this course.';
        return;
    }

    activeCourse = data.user || data.course;
    const resolvedId = activeCourse.id;
    setPageMeta(activeCourse);
    document.getElementById('courseName').textContent = activeCourse.name || 'Course';
    document.getElementById('courseDescription').textContent = activeCourse.description || 'This course has not added a description yet.';
    document.getElementById('courseLocation').textContent = [activeCourse.city, activeCourse.state].filter(Boolean).join(', ');
    document.getElementById('courseStreamStatus').textContent = activeCourse.is_live ? 'Live now' : 'Stream currently not live';

    const logo = document.getElementById('courseLogo');
    const logoSrc = window.LiveViewCore?.accountImage?.(activeCourse, 'course_logo')
        || (activeCourse.course_logo ? `${apiBaseUrl}/${activeCourse.course_logo}` : '');
    if (logo && logoSrc) {
        logo.src = logoSrc;
        logo.hidden = false;
    }

    const video = document.getElementById('courseStreamPlayer');
    const noStreamMsg = document.getElementById('noStreamMsg');
    if (!video || !noStreamMsg) return;

    const highlights = await loadHighlights(resolvedId);
    const source = window.LiveViewPlayer?.playbackSource(activeCourse) || activeCourse.playback_url || activeCourse.hls_url || activeCourse.stream_url;
    if (!activeCourse.is_live || !source) {
        const replay = highlights?.find((item) => item.hls_url);
        const started = replay ? window.LiveViewPlayer?.show(video, replay.hls_url, () => renderOfflineMessage(activeCourse, false)) : false;
        renderOfflineMessage(activeCourse, Boolean(started));
        await mountCourseOverlay(resolvedId);
        return;
    }

    const nextLine = document.getElementById('nextStreamLine');
    if (nextLine) nextLine.hidden = true;
    video.style.display = 'block';
    noStreamMsg.style.display = 'none';
    const started = window.LiveViewPlayer?.show(video, source, () => renderOfflineMessage(activeCourse, false));
    if (!started) renderOfflineMessage(activeCourse, false);
    await mountCourseOverlay(resolvedId);
}

async function mountCourseOverlay(courseId) {
    const response = await fetch(`${apiBaseUrl}/courses/${courseId}/overlay`);
    const data = await response.json().catch(() => ({}));
    const stages = [document.getElementById('streamStage'), ...document.querySelectorAll('.highlight-stage')];
    stages.forEach((stage) => window.LiveViewOverlay?.ensureBrand(stage, false));
    if (!data.success || !data.overlay || data.overlay.viewer_enabled === false) return;
    const payload = Object.assign({}, data.overlay, {
        courseName: data.course?.name || activeCourse?.name || '',
        courseLogo: data.course?.logo || '',
        isLive: Boolean(activeCourse?.is_live)
    });
    const hiddenKey = `lv-overlay-off:${courseId}`;
    let hidden = localStorage.getItem(hiddenKey) === '1';
    const handles = [];
    stages.forEach((stage) => {
        if (!stage) return;
        const video = stage.querySelector('video');
        const src = video?.dataset.src;
        if (src && window.LiveViewPlayer) window.LiveViewPlayer.show(video, src);
        handles.push(window.LiveViewOverlay.mount(stage, payload, { tee: 'white' }));
    });
    const toggle = document.getElementById('overlayToggle');
    const teeLabel = document.getElementById('overlayTeeLabel');
    function applyHidden() {
        stages.forEach((stage) => stage?.querySelector('.lv-overlay-root')?.classList.toggle('is-off', hidden));
        if (toggle) toggle.textContent = hidden ? 'Show overlay' : 'Hide overlay';
    }
    if (toggle) {
        toggle.hidden = false;
        toggle.onclick = () => {
            hidden = !hidden;
            localStorage.setItem(hiddenKey, hidden ? '1' : '0');
            applyHidden();
        };
    }
    if (teeLabel) {
        teeLabel.hidden = false;
        teeLabel.querySelectorAll('[data-tee]').forEach((button) => {
            button.addEventListener('click', () => {
                teeLabel.querySelectorAll('[data-tee]').forEach((peer) => {
                    peer.setAttribute('aria-checked', peer === button ? 'true' : 'false');
                });
                handles.forEach((item) => item.setTee(button.dataset.tee));
            });
        });
    }
    applyHidden();
    window.setInterval(async () => {
        const fresh = await fetch(`${apiBaseUrl}/courses/${courseId}/overlay`).then((res) => res.json()).catch(() => null);
        if (!fresh?.overlay) return;
        const next = Object.assign({}, fresh.overlay, { courseName: payload.courseName, courseLogo: payload.courseLogo });
        handles.forEach((item) => item.update(next));
    }, 15000);
}

document.addEventListener('DOMContentLoaded', async function () {
    await loadViewer();
    await fetchCourse();
    setCourseActions();

    const logoutBtn = document.getElementById('courseLogoutBtn');
    if (logoutBtn) {
        if (viewer) {
            logoutBtn.textContent = 'Logout';
            logoutBtn.onclick = () => {
                localStorage.removeItem('liveviewToken');
                localStorage.removeItem('liveviewUser');
                window.location.href = 'index.html';
            };
        } else {
            logoutBtn.textContent = 'Login';
            logoutBtn.onclick = () => { window.location.href = 'login.html'; };
        }
    }

    document.getElementById('favoriteCourseBtn')?.addEventListener('click', async (event) => {
        if (!viewer || viewer.role !== 'consumer') {
            window.location.href = 'login.html';
            return;
        }
        await updateCourseList('favorites', event.target.dataset.enabled === 'true');
    });
    document.getElementById('followCourseBtn')?.addEventListener('click', async (event) => {
        if (!viewer || viewer.role !== 'consumer') {
            window.location.href = 'login.html';
            return;
        }
        await updateCourseList('followed', event.target.dataset.enabled === 'true');
    });
    document.getElementById('notifyCourseBtn')?.addEventListener('click', async () => {
        if (!viewer || viewer.role !== 'consumer') {
            window.location.href = 'login.html';
            return;
        }
        await updateCourseList('followed', true);
        const note = document.getElementById('noStreamMsg');
        if (note) {
            note.style.display = 'block';
            note.textContent = 'Notifications are on. This course will show up for you when it goes live.';
        }
    });
    startWatchParty();
});

let watchAfter = 0;

function appendWatchMessages(messages) {
    const list = document.getElementById('watchMessages');
    if (!list) return;
    messages.forEach((message) => {
        const row = document.createElement('p');
        const who = document.createElement('strong');
        who.textContent = message.author || 'Fan';
        row.appendChild(who);
        row.appendChild(document.createTextNode(` ${message.body || ''}`));
        list.appendChild(row);
        if (Number(message.id) > watchAfter) watchAfter = Number(message.id);
    });
}

async function refreshWatchParty() {
    if (!activeCourse?.id) return null;
    const response = await fetch(`${apiBaseUrl}/courses/${activeCourse.id}/watch-party?after=${watchAfter}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) return null;
    appendWatchMessages(data.messages || []);
    const copy = document.getElementById('copyWatchLink');
    if (copy && data.shareLink) copy.dataset.link = data.shareLink;
    return data;
}

function startWatchParty() {
    const panel = document.getElementById('watchParty');
    if (!panel || !activeCourse?.id) return;
    panel.hidden = false;
    if (!viewer) {
        const hint = document.getElementById('watchHint');
        if (hint) hint.textContent = 'Log in to send a message. Anyone with the invite link can follow the chat.';
        const form = document.getElementById('watchForm');
        if (form) form.hidden = true;
    }
    refreshWatchParty();
    window.setInterval(refreshWatchParty, 4000);
    document.getElementById('copyWatchLink')?.addEventListener('click', async (event) => {
        const link = event.currentTarget.dataset.link || window.location.href;
        try {
            await navigator.clipboard.writeText(link);
            event.currentTarget.textContent = 'Link copied';
        } catch (error) {
            window.prompt('Copy this invite link', link);
        }
    });
    document.getElementById('watchForm')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!viewer) {
            window.location.href = 'login.html';
            return;
        }
        const input = document.getElementById('watchInput');
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        await requestJson(`${apiBaseUrl}/courses/${activeCourse.id}/watch-party/messages`, {
            method: 'POST',
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ body: text })
        });
        await refreshWatchParty();
    });
}
