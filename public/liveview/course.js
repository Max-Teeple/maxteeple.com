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

function setCourseActions() {
    const actions = document.getElementById('consumerCourseActions');
    const favoriteBtn = document.getElementById('favoriteCourseBtn');
    const followBtn = document.getElementById('followCourseBtn');
    if (!actions || !favoriteBtn || !followBtn || !viewer || viewer.role !== 'consumer') return;

    actions.style.display = 'flex';
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

function renderOfflineMessage(course) {
    const video = document.getElementById('courseStreamPlayer');
    const noStreamMsg = document.getElementById('noStreamMsg');
    if (!video || !noStreamMsg) return;

    video.style.display = 'none';
    noStreamMsg.style.display = 'block';
    noStreamMsg.textContent = course.stream_approved
        ? 'Stream currently not live. Follow this course to find it quickly when it goes live.'
        : 'This course stream is being set up and is awaiting LiveView approval.';
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
    if (!wrap || !data.success || !data.highlights?.length) return;
    wrap.innerHTML = data.highlights.map((h) => {
        const kind = window.LiveViewPlayer?.classify(h.hls_url);
        const player = kind?.type === 'iframe'
            ? `<iframe class="course-embed" src="${kind.src}" title="${h.title}" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>`
            : (h.hls_url ? `<a href="${h.hls_url}" target="_blank" rel="noopener">Watch replay</a>` : '');
        const label = h.demo_label ? `<span class="live-badge">${h.demo_label}</span>` : '';
        return `
        <article class="for-you-card">
            <strong>${h.title}</strong>
            ${label}
            <time>${new Date(h.recorded_at).toLocaleDateString()}</time>
            ${player}
        </article>`;
    }).join('');
    document.getElementById('highlightsSection')?.removeAttribute('hidden');
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
    const logoSrc = window.LiveViewCore?.coursePreviewImage(activeCourse)
        || (activeCourse.course_logo ? `${apiBaseUrl}/${activeCourse.course_logo}` : '');
    if (logo && logoSrc) {
        logo.src = logoSrc;
        logo.style.display = 'inline-block';
    }

    const video = document.getElementById('courseStreamPlayer');
    const noStreamMsg = document.getElementById('noStreamMsg');
    if (!video || !noStreamMsg) return;

    const source = window.LiveViewPlayer?.playbackSource(activeCourse) || activeCourse.hls_url || activeCourse.stream_url;
    if (!activeCourse.is_live || !source) {
        renderOfflineMessage(activeCourse);
        return;
    }

    video.style.display = 'block';
    noStreamMsg.style.display = 'none';
    const started = window.LiveViewPlayer?.show(video, source, () => renderOfflineMessage(activeCourse));
    if (!started) renderOfflineMessage(activeCourse);

    await loadHighlights(resolvedId);
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
        await updateCourseList('favorites', event.target.dataset.enabled === 'true');
    });
    document.getElementById('followCourseBtn')?.addEventListener('click', async (event) => {
        await updateCourseList('followed', event.target.dataset.enabled === 'true');
    });
});
