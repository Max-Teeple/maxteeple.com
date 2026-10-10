document.addEventListener('DOMContentLoaded', async () => {
    const apiBaseUrl = window.config?.apiBaseUrl || window.location.origin;
    const { escapeHtml, initials, coursePreviewImage, fetchJson, authHeaders } = window.LiveViewCore;

    const user = await window.LiveViewAuth?.enforceAuthRules?.();
    setupMenu?.();
    setupAccountChrome?.();
    if (user) window.LiveViewSocial?.setupChrome(user);

    const grid = document.getElementById('exploreGrid');
    const search = document.getElementById('exploreSearch');
    const countEl = document.getElementById('exploreCount');
    let activeTab = 'courses';
    let courses = [];
    let golfers = [];

    function courseCard(course) {
        const href = course.slug
            ? `course.html?slug=${encodeURIComponent(course.slug)}`
            : `course.html?id=${course.id}`;
        const image = coursePreviewImage(course);
        return `
            <article class="card ${course.is_live ? 'card-live' : ''}">
                <a href="${href}" class="card-link">
                    <div class="card-media ${image ? '' : 'card-media-fallback'}">
                        ${image
                            ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(course.name)}" loading="lazy" decoding="async">`
                            : `<span>${escapeHtml(initials(course.name))}</span>`}
                        <div class="play-button">▶</div>
                    </div>
                    <div class="card-content">
                        <span class="live-badge">${course.is_live ? 'Live now' : 'Course channel'}</span>
                        <h2>${escapeHtml(course.name)}</h2>
                        <p>${escapeHtml(course.city || '')}${course.state ? `, ${escapeHtml(course.state)}` : ''}</p>
                    </div>
                </a>
            </article>
        `;
    }

    function golferCard(golfer) {
        const image = accountImage(golfer, 'profile_picture');
        return `
            <article class="card explore-golfer-card">
                <a href="bio.html?id=${golfer.id}" class="card-link">
                    <div class="card-media card-media-fallback explore-golfer-media">
                        ${image
                            ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(golfer.name)}" loading="lazy" decoding="async">`
                            : `<span>${escapeHtml(initials(golfer.name))}</span>`}
                    </div>
                    <div class="card-content">
                        <span class="live-badge">Golfer</span>
                        <h2>${escapeHtml(golfer.name)}</h2>
                        <p>${escapeHtml(golfer.city || '')}${golfer.state ? `, ${escapeHtml(golfer.state)}` : ''}</p>
                    </div>
                </a>
            </article>
        `;
    }

    async function loadData() {
        const courseData = await fetchJson(`${apiBaseUrl}/courses?page=1&limit=100`);
        courses = (courseData.courses || [])
            .filter((c) => c.role === 'course_owner' || !c.role)
            .sort((a, b) => {
                if (Boolean(b.is_live) !== Boolean(a.is_live)) return b.is_live ? 1 : -1;
                return (a.name || '').localeCompare(b.name || '');
            });

        if (user?.role === 'consumer') {
            try {
                const browse = await fetchJson(`${apiBaseUrl}/users/browse`, { headers: authHeaders() });
                golfers = (browse.users || []).filter((g) => String(g.id) !== String(user.id));
            } catch (e) {
                golfers = [];
            }
        }
    }

    function renderCourses(list) {
        countEl.textContent = `${list.length} course${list.length === 1 ? '' : 's'}`;
        if (!list.length) {
            grid.innerHTML = '<div class="empty-state explore-empty"><strong>No courses found.</strong><span>Try another search or check back after more courses join LiveView.</span></div>';
            return;
        }
        grid.innerHTML = list.map(courseCard).join('');
    }

    function renderGolfers(list) {
        if (!user) {
            countEl.textContent = '';
            grid.innerHTML = '<div class="empty-state explore-empty"><strong>Sign in to browse golfers.</strong><a class="primary-link" href="login.html">Login</a></div>';
            return;
        }
        countEl.textContent = `${list.length} golfer${list.length === 1 ? '' : 's'}`;
        if (!list.length) {
            grid.innerHTML = '<div class="empty-state explore-empty"><strong>No golfers found.</strong><span>Invite friends from your profile or homepage.</span></div>';
            return;
        }
        grid.innerHTML = list.map(golferCard).join('');
    }

    function applyFilter() {
        const term = search.value.trim().toLowerCase();

        if (activeTab === 'golfers') {
            const list = golfers.filter((g) =>
                !term || `${g.name} ${g.city} ${g.state} ${g.bio || ''}`.toLowerCase().includes(term));
            renderGolfers(list);
            return;
        }

        let list = activeTab === 'live' ? courses.filter((c) => c.is_live) : courses;
        if (term) {
            list = list.filter((c) =>
                `${c.name} ${c.city} ${c.state} ${c.street_address || ''}`.toLowerCase().includes(term));
        }
        renderCourses(list);
    }

    document.querySelectorAll('.explore-tab').forEach((tab) => {
        tab.addEventListener('click', () => {
            activeTab = tab.dataset.tab;
            document.querySelectorAll('.explore-tab').forEach((t) => {
                const active = t.dataset.tab === activeTab;
                t.classList.toggle('active', active);
                t.setAttribute('aria-selected', active ? 'true' : 'false');
            });
            applyFilter();
        });
    });

    search.addEventListener('input', applyFilter);

    try {
        await loadData();
        applyFilter();
    } catch (error) {
        countEl.textContent = '';
        grid.innerHTML = `<div class="empty-state explore-empty"><strong>Could not load explore data.</strong><span>${escapeHtml(error.message)}</span></div>`;
    }
});
