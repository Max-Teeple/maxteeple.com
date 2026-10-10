const apiBaseUrl = getApiBaseUrl();
let currentUser = null;
let discoverData = null;
let allGolfersLoaded = false;
let selectedInterests = new Set();
let tourIndex = 0;
let tourSteps = [];
let stepOrder = [];
let tourMode = 'mock';
let tourLayoutBound = false;

function bindTourLayoutUpdates() {
    if (tourLayoutBound) return;
    tourLayoutBound = true;
    window.addEventListener('resize', () => {
        if (tourMode !== 'mock') return;
        const step = tourSteps[tourIndex];
        if (step?.spot) positionMockHighlight(step.spot);
    });
}

const CONSUMER_STEPS = ['welcome', 'discover', 'friends'];
const OWNER_STEPS = ['welcome', 'stream'];

function showError(message) {
    const el = document.getElementById('onboardingError');
    if (!el) return;
    if (!message) {
        el.hidden = true;
        el.textContent = '';
        return;
    }
    el.hidden = false;
    el.textContent = message;
}

function buildProgressBar() {
    const bar = document.getElementById('progressBar');
    bar.innerHTML = stepOrder.map(() => '<div class="progress-step"></div>').join('');
}

function updateProgress(activeIndex) {
    document.querySelectorAll('.progress-step').forEach((el, i) => {
        el.classList.toggle('active', i === activeIndex);
        el.classList.toggle('done', i < activeIndex);
    });
    const label = document.getElementById('stepProgressLabel');
    if (label) {
        label.textContent = `Step ${activeIndex + 1} of ${stepOrder.length}`;
    }
}

function showStep(stepName) {
    const index = stepOrder.indexOf(stepName);
    if (index < 0) return;

    document.querySelectorAll('.step-panel').forEach((panel) => {
        const inFlow = stepOrder.includes(panel.dataset.step);
        const isActive = panel.dataset.step === stepName;
        panel.classList.toggle('active', isActive);
        panel.style.display = inFlow && isActive ? 'block' : 'none';
    });

    updateProgress(index);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    showError('');

    if (stepName === 'discover') loadDiscover();
    if (stepName === 'friends') renderFriendsQuickAdd();
}

function configureForRole() {
    const isOwner = currentUser.role === 'course_owner';
    stepOrder = isOwner ? OWNER_STEPS : CONSUMER_STEPS;

    if (isOwner) {
        document.getElementById('welcomeTitle').textContent = 'Welcome to your course studio';
        document.getElementById('welcomeLead').textContent =
            'Confirm your course details. Next we will walk you through going live for viewers.';
        const bioLabel = document.getElementById('bioLabel');
        if (bioLabel) {
            bioLabel.childNodes[0].textContent = 'Course story ';
            bioLabel.querySelector('textarea').placeholder =
                'Describe your course, signature holes, and what viewers can expect on stream.';
        }
        document.getElementById('interestsBlock').style.display = 'none';
        document.getElementById('openProfileBtn').href = `profile.html?id=${currentUser.id}`;
    }

    buildProgressBar();
}

function consumerTourSteps() {
    return [
        {
            title: 'Live stream directory',
            text: 'Open Streams in the menu to browse every course broadcasting on LiveView.',
            spot: 'nav',
            mock: renderHomeMock('streams'),
            iframe: 'index.html?notour=1#streams'
        },
        {
            title: 'Search courses',
            text: 'Filter by course name, city, or state to find broadcasts near you.',
            spot: 'search',
            mock: renderHomeMock('search'),
            iframe: 'index.html?notour=1#streams'
        },
        {
            title: 'Your profile',
            text: 'Tap your name in the header for favorites, friends, and pending requests.',
            spot: 'profile',
            mock: renderHomeMock('profile'),
            iframe: `profile.html?id=${currentUser.id}&notour=1`
        },
        {
            title: 'Watch a course',
            text: 'Tap any course card to watch live video, favorite, or follow for updates.',
            spot: 'card',
            mock: renderHomeMock('cards'),
            iframe: 'index.html?notour=1#streams'
        }
    ];
}

function ownerTourSteps() {
    return [
        {
            title: 'Profile studio',
            text: 'Upload logos, preview photos, and your course story.',
            spot: 'studio',
            mock: renderStudioMock('branding'),
            iframe: `profile.html?id=${currentUser.id}&notour=1`
        },
        {
            title: 'Stream keys',
            text: 'Generate your RTMP key and connect your encoder.',
            spot: 'keys',
            mock: renderStudioMock('keys'),
            iframe: `profile.html?id=${currentUser.id}&notour=1`
        },
        {
            title: 'Go live',
            text: 'Request approval, then toggle your stream on for the public directory.',
            spot: 'live',
            mock: renderStudioMock('live'),
            iframe: `profile.html?id=${currentUser.id}&notour=1`
        }
    ];
}

function renderHomeMock(focus) {
    const nav = (label, active) => `<span${active ? ' class="active-nav"' : ''}>${label}</span>`;
    return `
        <div class="tour-mock-header" data-tour-spot="nav">
            <strong>LiveView Golf</strong>
            <div class="tour-mock-nav">
                ${nav('Streams', focus === 'streams')}
                ${nav('For courses', false)}
                <span data-tour-spot="profile">${nav('Profile', focus === 'profile')}</span>
            </div>
        </div>
        <div class="mock-search" data-tour-spot="search" style="${focus === 'search' ? '' : 'visibility:hidden;height:0;margin:0;padding:0;overflow:hidden'}">Search by city or golf course</div>
        <div class="mock-grid">
            <div class="mock-card" data-tour-spot="card">Pebble Beach · LIVE</div>
            <div class="mock-card">Augusta National</div>
        </div>
    `;
}

function renderStudioMock(focus) {
    const blocks = {
        branding: 'Course logo · Preview photo · Description',
        keys: 'Generate stream key · RTMP URL · HLS playback URL',
        live: 'Request approval · Toggle stream ON/OFF'
    };
    const spotMap = { branding: 'studio', keys: 'keys', live: 'live' };
    return `
        <div class="tour-mock-header"><strong>Stream Studio</strong></div>
        <div class="mock-card" data-tour-spot="${spotMap[focus] || 'studio'}" style="margin-top:12px">${blocks[focus]}</div>
    `;
}

function positionMockHighlight(spotName) {
    const viewport = document.getElementById('tourViewport');
    const highlight = document.getElementById('tourHighlight');
    const callout = document.getElementById('tourCallout');
    const spot = viewport?.querySelector(`[data-tour-spot="${spotName}"]`);

    viewport?.querySelectorAll('[data-tour-spot]').forEach((el) => el.classList.remove('tour-spot-active'));

    if (!viewport || !highlight || !callout || !spot) {
        if (highlight) highlight.hidden = true;
        return;
    }

    spot.classList.add('tour-spot-active');
    const pad = 6;
    const vRect = viewport.getBoundingClientRect();
    const sRect = spot.getBoundingClientRect();

    highlight.hidden = false;
    highlight.style.top = `${sRect.top - vRect.top - pad}px`;
    highlight.style.left = `${sRect.left - vRect.left - pad}px`;
    highlight.style.width = `${sRect.width + pad * 2}px`;
    highlight.style.height = `${sRect.height + pad * 2}px`;

    callout.hidden = false;
    const calloutTop = sRect.bottom - vRect.top + 12;
    callout.style.top = `${Math.min(calloutTop, viewport.clientHeight - 120)}px`;
    callout.style.left = `${Math.max(12, sRect.left - vRect.left)}px`;
    callout.style.right = 'auto';
}

function setTourMode(mode) {
    tourMode = mode;
    document.querySelectorAll('.tour-mode').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    const mock = document.getElementById('tourMock');
    const iframe = document.getElementById('tourIframe');
    const highlight = document.getElementById('tourHighlight');
    const callout = document.getElementById('tourCallout');

    if (mode === 'live') {
        mock.style.display = 'none';
        iframe.hidden = false;
        highlight.hidden = true;
        callout.hidden = true;
        const step = tourSteps[tourIndex];
        if (step?.iframe && iframe.src !== step.iframe) {
            iframe.src = step.iframe;
        }
    } else {
        mock.style.display = '';
        iframe.hidden = true;
        renderTourStep(tourIndex);
    }
}

function renderTourStep(index) {
    tourIndex = index;
    const step = tourSteps[index];
    if (!step) return;

    if (tourMode === 'live') {
        const iframe = document.getElementById('tourIframe');
        iframe.hidden = false;
        iframe.src = step.iframe || 'index.html#streams';
        document.getElementById('tourMock').style.display = 'none';
        document.getElementById('tourHighlight').hidden = true;
        document.getElementById('tourCallout').hidden = true;
    } else {
        document.getElementById('tourMock').innerHTML = step.mock;
        document.getElementById('tourMock').style.display = '';
        document.getElementById('tourIframe').hidden = true;

        document.getElementById('tourCalloutTitle').textContent = step.title;
        document.getElementById('tourCalloutText').textContent = step.text;

        requestAnimationFrame(() => {
            requestAnimationFrame(() => positionMockHighlight(step.spot));
        });
    }

    document.getElementById('tourPrevBtn').disabled = index === 0;
    document.getElementById('tourNextBtn').textContent =
        index === tourSteps.length - 1 ? 'Finish & enter LiveView' : 'Next';

    document.getElementById('tourDots').innerHTML = tourSteps
        .map((_, i) => `<button type="button" class="tour-dot ${i === index ? 'active' : ''}" data-tour-index="${i}"></button>`)
        .join('');
}

async function loadUser() {
    const data = await apiRequest(`${apiBaseUrl}/me`, { headers: authHeaders() });
    currentUser = data.user;
    persistUser(currentUser);

    document.getElementById('obFirstName').value = currentUser.first_name || currentUser.name?.split(/\s+/)[0] || '';
    document.getElementById('obLastName').value = currentUser.last_name || currentUser.name?.split(/\s+/).slice(1).join(' ') || '';
    document.getElementById('obCity').value = currentUser.city || '';
    document.getElementById('obState').value = currentUser.state || '';
    document.getElementById('obPhone').value = currentUser.phone || '';
    document.getElementById('obBio').value = currentUser.bio || '';

    if (currentUser.interests) {
        currentUser.interests.split(',').map((s) => s.trim()).filter(Boolean).forEach((v) => selectedInterests.add(v));
        document.querySelectorAll('#interestChips .chip').forEach((chip) => {
            if (selectedInterests.has(chip.dataset.value)) chip.classList.add('selected');
        });
    }
}

async function saveProfile() {
    const userId = currentUser?.id;
    if (!userId) {
        throw new Error('Session expired. Please log in again.');
    }

    const payload = {
        first_name: document.getElementById('obFirstName').value.trim(),
        last_name: document.getElementById('obLastName').value.trim(),
        city: document.getElementById('obCity').value.trim(),
        state: document.getElementById('obState').value.trim(),
        phone: document.getElementById('obPhone').value.trim(),
        bio: document.getElementById('obBio').value.trim(),
        interests: Array.from(selectedInterests).join(', ')
    };

    if (!payload.first_name || !payload.city || !payload.state) {
        throw new Error('Please fill in your first name, city, and state.');
    }

    const data = await apiRequest(`${apiBaseUrl}/profile/${userId}/onboarding`, {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload)
    });
    currentUser = data.user;
    persistUser(currentUser);

    const picInput = document.getElementById('obProfilePic');
    const file = picInput?.files?.[0];
    if (file) {
        if (file.size > 8 * 1024 * 1024) {
            showError('Photo is too large (max 8MB). Continuing without photo — you can add one later in Profile.');
            return;
        }
        try {
            const formData = new FormData();
            formData.append('profile_picture', file);
            const imageData = await apiRequest(`${apiBaseUrl}/profile/${userId}/images`, {
                method: 'PUT',
                headers: authHeaders(),
                body: formData
            });
            currentUser = imageData.user;
            persistUser(currentUser);
        } catch (error) {
            showError(`${error.message} Your profile was saved — you can add a photo later in Profile.`);
        }
    }
}

function isPending(userId) {
    return (discoverData?.pendingToIds || []).some((id) => Number(id) === Number(userId));
}

async function loadDiscover() {
    const streamsEl = document.getElementById('recommendedStreams');
    const friendsEl = document.getElementById('recommendedFriends');
    streamsEl.innerHTML = '<div class="loading-state">Loading streams...</div>';
    friendsEl.innerHTML = '<div class="loading-state">Loading golfers...</div>';

    try {
        const data = await apiRequest(`${apiBaseUrl}/onboarding/discover`, { headers: authHeaders() });
        discoverData = data;

        const streams = data.recommendedStreams || data.nearbyCourses || [];
        const friends = data.recommendedFriends || data.nearbyUsers || [];

        streamsEl.innerHTML = streams.length
            ? streams.map((course) => streamCard(course)).join('')
            : '<div class="empty-state">No courses yet. Check back soon or register your course!</div>';

        friendsEl.innerHTML = friends.length
            ? friends.map((user) => userCard(user)).join('')
            : '<div class="empty-state">You are the first golfer here! Invite friends below.</div>';

        const location = data.locationLabel || 'your area';
        document.getElementById('discoverTitle').textContent = `Near ${location}`;
        document.getElementById('discoverLead').textContent =
            'These streams and golfers are matched to your city and state. Follow courses or send friend requests with one tap.';
        document.getElementById('streamsHint').textContent = streams.some((c) => c.is_live)
            ? `Live and on-demand courses in ${location}`
            : `Courses in ${location} and across LiveView`;
    } catch (error) {
        streamsEl.innerHTML = '';
        friendsEl.innerHTML = '';
        showError(error.message);
    }
}

function streamCard(course) {
    const img = course.stream_preview_photo || course.course_logo;
    const thumb = img ? `<img class="card-thumb" src="${apiBaseUrl}/${img}" alt="">` : '<div class="card-thumb placeholder">⛳</div>';
    const matchLabel = course.areaMatch === 'city' ? 'In your city' : course.areaMatch === 'state' ? 'In your state' : '';
    return `
        <article class="discover-card stream-card">
            ${thumb}
            <strong>${escapeHtml(course.name)}</strong>
            <span>${escapeHtml(course.city || '')}${course.state ? `, ${escapeHtml(course.state)}` : ''}</span>
            ${matchLabel ? `<span class="area-badge">${matchLabel}</span>` : ''}
            ${course.is_live ? '<span class="live-badge">LIVE</span>' : ''}
            <div class="card-actions">
                <a class="btn btn-secondary" href="course.html?id=${course.id}" target="_blank" rel="noopener">Watch</a>
                <button type="button" class="btn btn-primary follow-stream-btn" data-course-id="${course.id}">Follow</button>
            </div>
        </article>
    `;
}

function userCard(user) {
    const sent = isPending(user.id);
    const pic = user.profile_picture
        ? `<img class="avatar" src="${apiBaseUrl}/${user.profile_picture}" alt="">`
        : `<div class="avatar placeholder">${escapeHtml((user.name || '?')[0])}</div>`;
    return `
        <article class="discover-card user-card">
            ${pic}
            <strong>${escapeHtml(user.name)}</strong>
            <span>${escapeHtml(user.city || '')}${user.state ? `, ${escapeHtml(user.state)}` : ''}</span>
            ${user.bio ? `<span class="bio-snippet">${escapeHtml(user.bio)}</span>` : ''}
            <div class="card-actions">
                <button type="button" class="btn btn-primary add-friend-btn" data-user-id="${user.id}" ${sent ? 'disabled' : ''}>
                    ${sent ? 'Request sent' : '+ Add friend'}
                </button>
            </div>
        </article>
    `;
}

function renderFriendsQuickAdd() {
    const container = document.getElementById('friendsQuickAdd');
    if (!container || !discoverData) {
        if (container) container.innerHTML = '<div class="empty-state">Go back to see recommendations, or invite someone new above.</div>';
        return;
    }
    const friends = discoverData.recommendedFriends || discoverData.nearbyUsers || [];
    container.innerHTML = friends.length
        ? friends.map((user) => userCard(user)).join('')
        : '<div class="empty-state">No golfers to show yet. Use email or phone above to invite someone.</div>';
}

async function loadAllGolfers() {
    const container = document.getElementById('allGolfers');
    container.hidden = false;
    container.innerHTML = '<div class="loading-state">Loading all golfers...</div>';

    try {
        const data = await apiRequest(`${apiBaseUrl}/users/browse`, { headers: authHeaders() });
        discoverData = { ...discoverData, pendingToIds: data.pendingToIds };
        container.innerHTML = data.users.length
            ? data.users.map((user) => userCard(user)).join('')
            : '<div class="empty-state">No other golfers on LiveView yet.</div>';
        allGolfersLoaded = true;
        document.getElementById('browseAllBtn').textContent = 'Hide all golfers';
    } catch (error) {
        container.innerHTML = '';
        showError(error.message);
    }
}

async function sendFriendRequest(body) {
    return apiRequest(`${apiBaseUrl}/friend-requests`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body)
    });
}

async function followCourse(courseId, button) {
    button.disabled = true;
    button.textContent = 'Following...';
    try {
        await apiRequest(`${apiBaseUrl}/profile/${currentUser.id}/course-lists`, {
            method: 'POST',
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ courseId: Number(courseId), list: 'followed', enabled: true })
        });
        button.textContent = 'Following';
    } catch (error) {
        button.disabled = false;
        button.textContent = 'Follow';
        showError(error.message);
    }
}

async function handleAddFriend(button) {
    if (!button || button.disabled) return;
    button.disabled = true;
    button.textContent = 'Sending...';
    try {
        await sendFriendRequest({ userId: Number(button.dataset.userId) });
        if (!discoverData.pendingToIds) discoverData.pendingToIds = [];
        discoverData.pendingToIds.push(Number(button.dataset.userId));
        button.textContent = 'Request sent';
    } catch (error) {
        button.disabled = false;
        button.textContent = '+ Add friend';
        showError(error.message);
    }
}

async function completeOnboarding() {
    const data = await apiRequest(`${apiBaseUrl}/profile/${currentUser.id}/complete-onboarding`, {
        method: 'POST',
        headers: authHeaders()
    });
    persistUser(data.user);
    window.location.replace(data.redirect || 'index.html?welcome=1#streams');
}

document.addEventListener('DOMContentLoaded', async () => {
    const user = await window.LiveViewAuth?.enforceAuthRules?.();
    if (!user) return;

    try {
        await loadUser();
        configureForRole();
        showStep(stepOrder[0]);
    } catch (error) {
        showError(error.message || 'Could not load your account. Please log in again.');
        setTimeout(() => { window.location.replace('login.html'); }, 2500);
        return;
    }

    document.querySelectorAll('#interestChips .chip').forEach((chip) => {
        chip.addEventListener('click', () => {
            chip.classList.toggle('selected');
            const value = chip.dataset.value;
            if (selectedInterests.has(value)) selectedInterests.delete(value);
            else selectedInterests.add(value);
        });
    });

    document.getElementById('welcomeNextBtn').addEventListener('click', async () => {
        const btn = document.getElementById('welcomeNextBtn');
        btn.disabled = true;
        showError('');
        try {
            await saveProfile();
            showError('');
            showStep(currentUser.role === 'course_owner' ? 'stream' : 'discover');
        } catch (error) {
            showError(error.message);
        } finally {
            btn.disabled = false;
        }
    });

    document.querySelectorAll('[data-next]').forEach((btn) => {
        btn.addEventListener('click', () => showStep(btn.dataset.next));
    });

    document.querySelectorAll('[data-back]').forEach((btn) => {
        btn.addEventListener('click', () => showStep(btn.dataset.back));
    });

    document.getElementById('sendInviteBtn').addEventListener('click', async () => {
        const status = document.getElementById('inviteStatus');
        const email = document.getElementById('inviteEmail').value.trim();
        const phone = document.getElementById('invitePhone').value.trim();
        if (!email && !phone) {
            status.textContent = 'Enter an email or phone number.';
            status.className = 'status-msg error';
            return;
        }
        status.textContent = 'Sending invite...';
        status.className = 'status-msg';
        try {
            const data = await sendFriendRequest({ email: email || undefined, phone: phone || undefined });
            status.textContent = data.message + (data.emailSent ? ' Email sent.' : '') + (data.smsSent ? ' Text sent.' : '') + (!data.emailSent && !data.smsSent && data.shareLink ? ` Share this link: ${data.shareLink}` : '');
            status.className = 'status-msg success';
            document.getElementById('inviteEmail').value = '';
            document.getElementById('invitePhone').value = '';
        } catch (error) {
            status.textContent = error.message;
            status.className = 'status-msg error';
        }
    });

    document.getElementById('browseAllBtn')?.addEventListener('click', async () => {
        if (allGolfersLoaded) {
            document.getElementById('allGolfers').hidden = true;
            allGolfersLoaded = false;
            document.getElementById('browseAllBtn').textContent = 'Browse all golfers';
            return;
        }
        await loadAllGolfers();
    });

    document.getElementById('recommendedStreams')?.addEventListener('click', async (event) => {
        const followBtn = event.target.closest('.follow-stream-btn');
        if (followBtn) {
            await followCourse(followBtn.dataset.courseId, followBtn);
            return;
        }
    });

    document.body.addEventListener('click', async (event) => {
        const friendBtn = event.target.closest('.add-friend-btn');
        if (friendBtn) await handleAddFriend(friendBtn);
    });

    async function finishOnboardingFromStep(button) {
        if (button) button.disabled = true;
        try {
            await completeOnboarding();
        } catch (error) {
            showError(error.message);
            if (button) button.disabled = false;
        }
    }

    document.getElementById('finishOnboardingBtn')?.addEventListener('click', (event) => {
        finishOnboardingFromStep(event.currentTarget);
    });
    document.getElementById('finishOnboardingSkipBtn')?.addEventListener('click', (event) => {
        finishOnboardingFromStep(event.currentTarget);
    });
    document.getElementById('ownerFinishOnboardingBtn')?.addEventListener('click', (event) => {
        finishOnboardingFromStep(event.currentTarget);
    });

    document.getElementById('skipAllBtn').addEventListener('click', async () => {
        if (!confirm('Skip setup? You can finish your profile anytime.')) return;
        try {
            await completeOnboarding();
        } catch (error) {
            showError(error.message);
        }
    });
});
