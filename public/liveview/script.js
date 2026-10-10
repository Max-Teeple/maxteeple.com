function getApiBaseUrl() {
    return window.config?.apiBaseUrl || window.location.origin;
}

function getSession() {
    return {
        token: localStorage.getItem('liveviewToken'),
        user: JSON.parse(localStorage.getItem('liveviewUser') || 'null')
    };
}

function logout() {
    localStorage.removeItem('liveviewToken');
    localStorage.removeItem('liveviewUser');
    window.location.href = 'index.html';
}

function escapeHtml(value = '') {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function initials(name = 'LV') {
    return name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0].toUpperCase())
        .join('') || 'LV';
}

function setupMenu() {
    const menuToggle = document.getElementById('menu-toggle');
    const dropdownMenu = document.getElementById('dropdown-menu');
    if (!menuToggle || !dropdownMenu) return;

    menuToggle.addEventListener('click', function (event) {
        event.stopPropagation();
        dropdownMenu.style.display = dropdownMenu.style.display === 'block' ? 'none' : 'block';
    });

    document.addEventListener('click', function (event) {
        if (!menuToggle.contains(event.target) && !dropdownMenu.contains(event.target)) {
            dropdownMenu.style.display = 'none';
        }
    });
}

function setupAccountChrome() {
    const { user } = getSession();
    const profileBarLink = document.getElementById('profileBarLink');
    const profileBarImg = document.getElementById('profileBarImg');
    const profileBarName = document.getElementById('profileBarName');
    const loginBtn = document.querySelector('.login-btn');

    if (user) {
        const profileHref = `profile.html?id=${user.id}`;
        if (profileBarLink && profileBarImg && profileBarName) {
            profileBarLink.style.display = 'inline-flex';
            profileBarLink.href = profileHref;
            profileBarName.textContent = window.LiveViewCore?.displayFirstName(user) || user.name?.split(/\s+/)[0] || user.name;
            const image = window.LiveViewCore?.accountImage(user, 'profile_picture', 'course_logo')
                || user.profile_picture_url
                || user.course_logo_url
                || (user.profile_picture || user.course_logo ? `${getApiBaseUrl()}/${user.profile_picture || user.course_logo}` : '');
            if (image) {
                profileBarImg.src = image;
                profileBarImg.alt = `${user.name} profile`;
            } else {
                profileBarImg.removeAttribute('src');
                profileBarImg.alt = initials(user.name);
                profileBarImg.style.display = 'none';
            }
        }
        if (loginBtn) {
            loginBtn.textContent = 'Logout';
            loginBtn.onclick = logout;
        }
        return;
    }

    if (profileBarLink) profileBarLink.style.display = 'none';
    if (loginBtn) {
        loginBtn.textContent = 'Login';
        loginBtn.onclick = () => {
            window.location.href = 'login.html';
        };
    }
}

async function loadContact() {
    const contactDetails = document.getElementById('contact-details');
    const socialLinks = document.getElementById('social-links');
    if (!contactDetails || !socialLinks) return;

    try {
        const response = await fetch('/liveview/contactInfo.json');
        const data = await response.json();
        contactDetails.innerHTML = `
            <p>Phone: ${escapeHtml(data.phone)}</p>
            <p>Email: <a href="mailto:${escapeHtml(data.email)}">${escapeHtml(data.email)}</a></p>
            <p>Address: ${escapeHtml(data.address)}</p>
        `;

        const socials = [
            ['Instagram', data.instagram],
            ['LinkedIn', data.linkedin],
            ['Twitter', data.twitter],
            ['Email', `mailto:${data.email}`]
        ].filter(([, href]) => href);

        socialLinks.innerHTML = socials
            .map(([label, href]) => `<a href="${escapeHtml(href)}" target="_blank" rel="noopener">${escapeHtml(label)}</a>`)
            .join('');
    } catch (error) {
        contactDetails.innerHTML = '<p>Contact details are loading soon.</p>';
    }
}

async function loadAbout() {
    const aboutDescription = document.getElementById('about-description');
    if (!aboutDescription) return;

    try {
        const response = await fetch('/liveview/about.json');
        const data = await response.json();
        if (data.description) {
            aboutDescription.innerHTML = `
                <h2>Turn every tee time into content.</h2>
                <p>${escapeHtml(data.description)}</p>
            `;
        }
    } catch (error) {
        // Keep the static copy in place.
    }
}

function renderEmptyState(cardGrid, message) {
    cardGrid.innerHTML = `
        <div class="empty-state">
            <strong>${escapeHtml(message)}</strong>
            <span>Course owner accounts will appear here as soon as they register.</span>
        </div>
    `;
}

function courseImage(card) {
    if (window.LiveViewCore?.coursePreviewImage) {
        return window.LiveViewCore.coursePreviewImage(card);
    }
    if (card.stream_preview_photo_url) return card.stream_preview_photo_url;
    if (card.course_logo_url) return card.course_logo_url;
    if (card.stream_preview_photo) return `${getApiBaseUrl()}/${card.stream_preview_photo}`;
    if (card.course_logo) return `${getApiBaseUrl()}/${card.course_logo}`;
    if (card.slug) return `/liveview/images/courses/${card.slug}.jpg`;
    return '';
}

function populateCardGrid(cardGrid, cards) {
    cardGrid.innerHTML = '';
    if (!cards.length) {
        renderEmptyState(cardGrid, 'No courses match that search.');
        return;
    }

    const fragment = document.createDocumentFragment();
    cards.forEach((card) => {
        const cardElement = document.createElement('article');
        cardElement.className = 'card';
        const image = courseImage(card);
        cardElement.innerHTML = `
            <a href="course.html?id=${card.id}" class="card-link">
                <div class="card-media ${image ? '' : 'card-media-fallback'}">
                    ${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(card.name)}">` : `<span>${escapeHtml(initials(card.name))}</span>`}
                    <div class="play-button">▶</div>
                </div>
                <div class="card-content">
                    <span class="live-badge">${card.is_live ? 'Live now' : 'Course channel'}</span>
                    <h2>${escapeHtml(card.name)}</h2>
                    <p>${escapeHtml(card.city)}, ${escapeHtml(card.state)}</p>
                    <div class="tags">
                        <span>${escapeHtml(card.state)}</span>
                        <span>Golf stream</span>
                    </div>
                </div>
            </a>
        `;
        fragment.appendChild(cardElement);
    });
    cardGrid.appendChild(fragment);
}

function populateStateDropdown(stateFilter, cards) {
    const selected = stateFilter.value;
    const states = Array.from(new Set(cards.map((card) => card.state).filter(Boolean))).sort();
    stateFilter.innerHTML = '<option value="">All states</option>';
    states.forEach((state) => {
        const option = document.createElement('option');
        option.value = state;
        option.textContent = state;
        stateFilter.appendChild(option);
    });
    stateFilter.value = selected;
}

function openStreamModal(hlsUrl) {
    const modal = document.getElementById('streamModal');
    const player = document.getElementById('modalVideoPlayer');
    if (!modal || !player) return;

    if (window.Hls && Hls.isSupported()) {
        const hls = new Hls();
        hls.loadSource(hlsUrl);
        hls.attachMedia(player);
    } else {
        player.src = hlsUrl;
    }
    modal.style.display = 'block';
}

function closeStreamModal() {
    const modal = document.getElementById('streamModal');
    const player = document.getElementById('modalVideoPlayer');
    if (!modal || !player) return;
    player.pause();
    player.src = '';
    modal.style.display = 'none';
}

async function loadForYou(user) {
    const section = document.getElementById('for-you');
    const streamsEl = document.getElementById('forYouStreams');
    const friendsEl = document.getElementById('forYouFriends');
    const title = document.getElementById('forYouTitle');
    const subtitle = document.getElementById('forYouSubtitle');
    if (!section || !streamsEl || !friendsEl) return;

    const token = localStorage.getItem('liveviewToken');
    if (!token || user.role !== 'consumer') return;

    section.hidden = false;
    const location = [user.city, user.state].filter(Boolean).join(', ');
    if (title) title.textContent = location ? `Near ${location}` : 'Recommended for you';
    if (subtitle) subtitle.textContent = 'Courses and golfers we think you will enjoy';

    try {
        const response = await fetch(`${getApiBaseUrl()}/onboarding/discover`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const data = await response.json();
        if (!data.success) throw new Error(data.message || 'Could not load recommendations');

        const streams = data.recommendedStreams || data.nearbyCourses || [];
        const friends = (data.recommendedFriends || data.nearbyUsers || [])
            .filter((golfer) => String(golfer.id) !== String(user.id));
        const pending = new Set((data.pendingToIds || []).map(Number));

        streamsEl.innerHTML = streams.length
            ? streams.slice(0, 6).map((course) => `
                <article class="for-you-card">
                    <strong>${escapeHtml(course.name)}</strong>
                    <span>${escapeHtml(course.city)}, ${escapeHtml(course.state)}</span>
                    <span class="live-badge">${course.is_live ? 'Live now' : 'Course channel'}</span>
                    <div class="for-you-card-actions">
                        <a class="secondary-link" href="course.html?id=${course.id}">Watch</a>
                    </div>
                </article>
            `).join('')
            : `<p class="for-you-status">No courses in ${escapeHtml(location || 'your area')} yet. Browse the full directory below.</p>`;

        friendsEl.innerHTML = friends.length
            ? friends.slice(0, 8).map((golfer) => `
                <article class="for-you-card">
                    <strong>${escapeHtml(golfer.name)}</strong>
                    <span>${escapeHtml(golfer.city || '')}${golfer.state ? `, ${escapeHtml(golfer.state)}` : ''}</span>
                    <div class="for-you-card-actions">
                        <a class="secondary-link" href="bio.html?id=${golfer.id}">View bio</a>
                        <button type="button" class="login-btn for-you-add-friend" data-user-id="${golfer.id}" ${pending.has(golfer.id) ? 'disabled' : ''}>
                            ${pending.has(golfer.id) ? 'Request sent' : 'Add friend'}
                        </button>
                    </div>
                </article>
            `).join('')
            : '<p class="for-you-status">No other golfers nearby yet — invite a friend below.</p>';
    } catch (error) {
        streamsEl.innerHTML = '';
        friendsEl.innerHTML = `<p class="for-you-status">${escapeHtml(error.message)}</p>`;
    }
}

function setupForYouInvite(user) {
    const btn = document.getElementById('forYouInviteBtn');
    const status = document.getElementById('forYouInviteStatus');
    if (!btn) return;

    btn.addEventListener('click', async () => {
        const email = document.getElementById('forYouInviteEmail')?.value.trim();
        const phone = document.getElementById('forYouInvitePhone')?.value.trim();
        if (!email && !phone) {
            status.textContent = 'Enter an email or phone number.';
            return;
        }
        status.textContent = 'Sending invite...';
        try {
            const response = await fetch(`${getApiBaseUrl()}/friend-requests`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${localStorage.getItem('liveviewToken')}`
                },
                body: JSON.stringify({ email: email || undefined, phone: phone || undefined })
            });
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.message);
            status.textContent = data.message
                + (data.emailSent ? ' Email sent.' : '')
                + (data.smsSent ? ' Text sent.' : '')
                + (!data.emailSent && !data.smsSent && data.shareLink ? ` Share this link: ${data.shareLink}` : '');
            document.getElementById('forYouInviteEmail').value = '';
            document.getElementById('forYouInvitePhone').value = '';
        } catch (error) {
            status.textContent = error.message;
        }
    });

    document.getElementById('forYouFriends')?.addEventListener('click', async (event) => {
        const button = event.target.closest('.for-you-add-friend');
        if (!button || button.disabled) return;
        button.disabled = true;
        button.textContent = 'Sending...';
        try {
            const response = await fetch(`${getApiBaseUrl()}/friend-requests`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${localStorage.getItem('liveviewToken')}`
                },
                body: JSON.stringify({ userId: Number(button.dataset.userId) })
            });
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.message);
            button.textContent = 'Request sent';
        } catch (error) {
            button.disabled = false;
            button.textContent = 'Add friend';
            status.textContent = error.message;
        }
    });
}

async function setupCourseDirectory(user) {
    if (window.LiveViewDirectory) {
        await window.LiveViewDirectory.setup(user);
        return;
    }
}

document.addEventListener('DOMContentLoaded', async function () {
    const path = window.liveviewPage ? window.liveviewPage() : ((window.location.pathname || '').split('/').pop() || 'index.html');
    const isHomePage = path === 'index.html' || path === '';

    const user = await window.LiveViewAuth?.enforceAuthRules?.();

    setupMenu();
    setupAccountChrome();

    if (!isHomePage) return;

    if (user && user.role === 'consumer') {
        await loadForYou(user);
        setupForYouInvite(user);
        window.LiveViewSocial?.setupChrome(user);
    }

    loadContact();
    loadAbout();
    await setupCourseDirectory(user);

    if (user?.role === 'consumer' && window.LiveViewSiteTour) {
        requestAnimationFrame(() => {
            setTimeout(() => {
                window.LiveViewSiteTour.startSiteTour({ userId: user.id });
            }, 500);
        });
    }
});
