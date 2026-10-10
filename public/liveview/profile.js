const params = new URLSearchParams(window.location.search);
const userId = params.get('id');
const apiBaseUrl = window.config?.apiBaseUrl || window.location.origin;

let activeUser = null;
let unsavedChanges = false;

function getToken() {
    return localStorage.getItem('liveviewToken');
}

function authHeaders(extra = {}) {
    const token = getToken();
    return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
}

function requireSession() {
    const localUser = JSON.parse(localStorage.getItem('liveviewUser') || 'null');
    if (!getToken() || !localUser) {
        window.location.href = 'login.html';
        return false;
    }
    if (String(localUser.id) !== String(userId)) {
        window.location.href = localUser.role === 'course_owner' ? `profile.html?id=${localUser.id}` : 'index.html#streams';
        return false;
    }
    return true;
}

function setMessage(message, type = 'info') {
    const messageEl = document.getElementById('message');
    if (!messageEl) return;
    messageEl.textContent = message;
    messageEl.style.color = type === 'error' ? '#ff5f57' : '#ff8a3d';
}

function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
}

function resolveImageSrc(stored) {
    if (!stored) return '';
    if (/^https?:\/\//i.test(stored)) return stored;
    if (window.LiveViewCore) return window.LiveViewCore.mediaUrl(stored);
    return `${apiBaseUrl}/${stored}`;
}

function setImage(id, src) {
    const img = document.getElementById(id);
    if (!img) return;
    if (src) {
        img.src = resolveImageSrc(src);
        img.style.display = 'inline-block';
    } else {
        img.removeAttribute('src');
        img.style.display = 'none';
    }
}

function storeSessionUser(user) {
    localStorage.setItem('liveviewUser', JSON.stringify({
        id: user.id,
        name: user.name,
        first_name: user.first_name || null,
        last_name: user.last_name || null,
        email: user.email,
        role: user.role,
        course_logo: user.course_logo,
        profile_picture: user.profile_picture
    }));
}

function displayFirstName(user) {
    return window.LiveViewCore?.displayFirstName(user) || user?.name?.split(/\s+/)[0] || user?.name || '';
}

function displayFullName(user) {
    return window.LiveViewCore?.displayFullName(user) || user?.name || '';
}

async function requestJson(url, options = {}) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) {
        throw new Error(data.message || 'Request failed');
    }
    return data;
}

function setOwnerVisibility(isCourseOwner) {
    ['currentLogo', 'currentPreview'].forEach((id) => {
        const card = document.getElementById(id)?.closest('.profile-media-card');
        if (card) card.hidden = !isCourseOwner;
    });

    ['description', 'stream_url'].forEach((id) => {
        const label = document.getElementById(`${id}Label`) || document.getElementById(id)?.closest('label');
        if (label) label.hidden = !isCourseOwner;
    });

    const streetLabel = document.getElementById('streetAddressLabel');
    const bioLabel = document.getElementById('bioLabel');
    if (streetLabel) streetLabel.hidden = !isCourseOwner;
    if (bioLabel) bioLabel.hidden = isCourseOwner;

    const streamStudio = document.getElementById('streamStudioPanel');
    const streamPreview = document.getElementById('streamPreviewPanel');
    if (streamStudio) streamStudio.hidden = !isCourseOwner;
    if (streamPreview) streamPreview.hidden = !isCourseOwner;

    const consumerDashboard = document.getElementById('consumerDashboard');
    if (consumerDashboard) consumerDashboard.hidden = isCourseOwner;
}

async function fetchProfile() {
    const data = await requestJson(`${apiBaseUrl}/profile/${userId}`, {
        headers: authHeaders()
    });

    activeUser = data.user;
    const isCourseOwner = activeUser.role === 'course_owner';
    setOwnerVisibility(isCourseOwner);

    document.getElementById('first_name').value = activeUser.first_name || activeUser.name?.split(/\s+/)[0] || '';
    document.getElementById('last_name').value = activeUser.last_name || activeUser.name?.split(/\s+/).slice(1).join(' ') || '';
    document.getElementById('city').value = activeUser.city || '';
    document.getElementById('state').value = activeUser.state || '';
    document.getElementById('description').value = activeUser.description || '';
    document.getElementById('stream_url').value = activeUser.stream_url || '';
    const streetInput = document.getElementById('street_address');
    if (streetInput) streetInput.value = activeUser.street_address || '';
    const bioInput = document.getElementById('bio');
    if (bioInput) bioInput.value = activeUser.bio || '';

    const viewBioLink = document.getElementById('viewBioLink');
    if (viewBioLink) viewBioLink.href = `bio.html?id=${activeUser.id}`;

    const profileBarImg = document.getElementById('profileBarImg');
    const profileBarName = document.getElementById('profileBarName');
    const profileBarLink = document.getElementById('profileBarLink');
    if (profileBarLink) profileBarLink.href = `profile.html?id=${activeUser.id}`;
    if (profileBarName) profileBarName.textContent = displayFirstName(activeUser);

    const pageTitle = document.getElementById('profilePageTitle');
    const pageLead = document.getElementById('profilePageLead');
    if (pageTitle) pageTitle.textContent = isCourseOwner ? 'Course studio' : `${displayFirstName(activeUser)}'s profile`;
    if (pageLead) {
        pageLead.textContent = isCourseOwner
            ? 'Brand your course, manage stream keys, and go live.'
            : 'Update your details, invite friends, and manage your golf circle.';
    }
    if (profileBarImg) {
            const image = window.LiveViewCore?.accountImage(activeUser, 'profile_picture', 'course_logo')
                || resolveImageSrc(activeUser.profile_picture || activeUser.course_logo);
            if (image) {
                profileBarImg.src = image;
            profileBarImg.style.display = 'inline-block';
        } else {
            profileBarImg.style.display = 'none';
        }
    }

    setImage('currentLogo', activeUser.course_logo);
    setImage('currentPreview', activeUser.stream_preview_photo);
    setImage('currentProfilePic', activeUser.profile_picture);
    storeSessionUser(activeUser);

    const handicapLabel = document.getElementById('handicapLabel');
    const homeCourseLabel = document.getElementById('homeCourseLabel');
    const roundsLabel = document.getElementById('roundsLabel');
    [handicapLabel, homeCourseLabel, roundsLabel].forEach((el) => {
        if (el) el.hidden = isCourseOwner;
    });
    if (!isCourseOwner) {
        const handicap = document.getElementById('handicap');
        const homeCourse = document.getElementById('home_course');
        const rounds = document.getElementById('rounds_played');
        if (handicap) handicap.value = activeUser.handicap ?? '';
        if (homeCourse) homeCourse.value = activeUser.home_course || '';
        if (rounds) rounds.value = activeUser.rounds_played ?? '';
    }

    if (isCourseOwner) {
        renderStreamInfo(activeUser);
        renderStreamPreview(activeUser);
    } else {
        await fetchConsumerDashboard();
    }
}

function renderChecklist(user) {
    const checklist = document.getElementById('streamChecklist');
    if (!checklist) return;

    const steps = [
        ['Course profile saved', Boolean(user.name && user.city && user.state)],
        ['Brand assets uploaded', Boolean(user.course_logo || user.stream_preview_photo)],
        ['Playback link added', Boolean(user.stream_url || user.hls_url)],
        ['Approval requested', Boolean(user.stream_approval_requested_at || user.stream_approved)],
        ['Approved by LiveView', Boolean(user.stream_approved)]
    ];

    checklist.innerHTML = steps.map(([label, done]) => `
        <div class="setup-check ${done ? 'done' : ''}">
            <span>${done ? '[x]' : '[ ]'}</span>
            <span>${label}</span>
        </div>
    `).join('');
}

function renderStreamInfo(user) {
    renderChecklist(user);
    const infoDiv = document.getElementById('streamInfo');
    const toggleBtn = document.getElementById('toggleStreamBtn');
    const requestBtn = document.getElementById('requestApprovalBtn');
    if (!infoDiv) return;

    const approvalStatus = user.stream_approved
        ? 'Approved'
        : user.stream_approval_requested_at
            ? 'Approval requested'
            : 'Not approved yet';
    const liveStatus = user.is_live ? 'Live' : 'Offline';
    const playback = user.stream_url || user.hls_url || '';

    infoDiv.innerHTML = `
        <div><b>Approval:</b> ${approvalStatus}</div>
        <div><b>Viewer status:</b> ${liveStatus}</div>
        <div><b>Playback link:</b> ${playback ? `<a href="${playback}" target="_blank" rel="noopener">${playback}</a>` : 'Paste a YouTube, Twitch, Vimeo, or .m3u8 link in Stream link, then save.'}</div>
        ${user.stream_key ? `<div><b>Webhook key:</b> ${user.stream_key}</div>` : '<div>Optional webhook key is not set. Generate one only if an encoder will call the stream-status webhook.</div>'}
    `;

    if (toggleBtn) {
        toggleBtn.textContent = user.stream_enabled ? 'Turn Stream Off' : 'Turn Stream On';
        toggleBtn.disabled = !user.stream_approved || !playback;
    }
    if (requestBtn) {
        requestBtn.disabled = !playback || user.stream_approved;
        requestBtn.textContent = user.stream_approved ? 'Approved' : user.stream_approval_requested_at ? 'Approval Requested' : 'Request Stream Approval';
    }
    setText('streamStatusMessage', user.stream_approved
        ? 'Approved courses can toggle visibility on and off whenever they are ready to broadcast.'
        : 'Add a YouTube, Twitch, Vimeo, or public HLS link, then request approval before going live.');
}

function renderStreamPreview(user) {
    const video = document.getElementById('liveStreamPreview');
    const noStreamMsg = document.getElementById('noStreamMsg');
    if (!video || !noStreamMsg) return;

    const source = window.LiveViewPlayer?.playbackSource(user) || user.hls_url || user.stream_url;
    if (!source || !user.is_live) {
        noStreamMsg.textContent = user.stream_approved ? 'Stream currently not live.' : 'Stream awaiting LiveView approval.';
        noStreamMsg.style.display = 'block';
        video.style.display = 'none';
        return;
    }

    video.style.display = 'block';
    noStreamMsg.style.display = 'none';
    const started = window.LiveViewPlayer?.show(video, source, () => {
        noStreamMsg.textContent = 'Stream currently not live.';
        noStreamMsg.style.display = 'block';
        video.style.display = 'none';
    });
    if (!started) {
        noStreamMsg.textContent = 'This link cannot be embedded. Open it in a new tab.';
        noStreamMsg.style.display = 'block';
    }
}

function courseListItem(course, listName) {
    return `
        <div class="mini-list-item">
            <div>
                <a href="${course.slug ? `course.html?slug=${encodeURIComponent(course.slug)}` : `course.html?id=${course.id}`}">${course.name}</a>
                <span>${course.city || ''}${course.state ? `, ${course.state}` : ''}</span>
            </div>
            <button type="button" data-course-id="${course.id}" data-list="${listName}" class="remove-course-btn">Remove</button>
        </div>
    `;
}

function renderCourseList(id, courses, listName, emptyText) {
    const container = document.getElementById(id);
    if (!container) return;
    container.innerHTML = courses.length
        ? courses.map((course) => courseListItem(course, listName)).join('')
        : `<div class="mini-list-empty">${emptyText}</div>`;
}

function renderFriends(friends) {
    const container = document.getElementById('friendsList');
    if (!container) return;
    container.innerHTML = friends.length
        ? friends.map((friend) => `
            <div class="mini-list-item">
                <div>
                    <strong>${friend.name}</strong>
                    <span>${friend.city || ''}${friend.state ? `, ${friend.state}` : ''}</span>
                </div>
                <button type="button" data-friend-id="${friend.id}" class="remove-friend-btn">Remove</button>
            </div>
        `).join('')
        : '<div class="mini-list-empty">Send friend requests by email or phone to build your golf circle.</div>';
}

function renderFriendRequests(incoming, outgoing) {
    const incomingEl = document.getElementById('incomingRequests');
    const outgoingEl = document.getElementById('outgoingRequests');
    if (!incomingEl || !outgoingEl) return;

    incomingEl.innerHTML = incoming.length
        ? `<h4 style="margin:0 0 8px;color:#ff8a3d">Friend requests</h4>` + incoming.map((req) => `
            <div class="mini-list-item">
                <div>
                    <strong>${req.from?.name || 'Golfer'}</strong>
                    <span>${req.from?.city || ''}${req.from?.state ? `, ${req.from.state}` : ''}</span>
                </div>
                <div style="display:flex;gap:6px">
                    <button type="button" class="accept-request-btn" data-request-id="${req.id}">Accept</button>
                    <button type="button" class="decline-request-btn" data-request-id="${req.id}">Decline</button>
                </div>
            </div>
        `).join('')
        : '';

    outgoingEl.innerHTML = outgoing.length
        ? `<h4 style="margin:12px 0 8px;color:#aaa">Pending invites</h4>` + outgoing.map((req) => `
            <div class="mini-list-item">
                <div>
                    <strong>${req.to?.name || req.invite_email || req.invite_phone || 'Invite sent'}</strong>
                    <span>Waiting for response</span>
                </div>
                <button type="button" class="cancel-request-btn" data-request-id="${req.id}">Cancel</button>
            </div>
        `).join('')
        : '';
}

async function fetchConsumerDashboard() {
    const data = await requestJson(`${apiBaseUrl}/profile/${userId}/dashboard`, {
        headers: authHeaders()
    });
    renderCourseList('favoriteCoursesList', data.favoriteCourses, 'favorites', 'Tap Favorite on a course page to pin it here.');
    renderCourseList('followedCoursesList', data.followedCourses, 'followed', 'Tap Follow on a course page to track it here.');
    renderFriends(data.friends);
    renderFriendRequests(data.incomingRequests || [], data.outgoingRequests || []);
}

function showImageModal(imgId) {
    const modal = document.getElementById('imageModal');
    const modalImg = document.getElementById('modalImg');
    const img = document.getElementById(imgId);
    if (!modal || !modalImg || !img?.src) return;
    modal.hidden = false;
    modal.style.display = 'block';
    modalImg.src = img.src;
}

function closeImageModal() {
    const modal = document.getElementById('imageModal');
    if (modal) {
        modal.hidden = true;
        modal.style.display = 'none';
    }
}

function autoSaveImage(inputId) {
    const fileInput = document.getElementById(inputId);
    if (!fileInput) return;

    fileInput.addEventListener('change', async function() {
        const file = fileInput.files[0];
        if (!file) return;

        const formData = new FormData();
        formData.append(inputId, file);
        setMessage('Uploading image...');

        try {
            await requestJson(`${apiBaseUrl}/profile/${userId}/images`, {
                method: 'PUT',
                headers: authHeaders(),
                body: formData
            });
            setMessage('Image updated.');
            await fetchProfile();
        } catch (error) {
            setMessage(error.message, 'error');
        }
    });
}

function logout() {
    localStorage.removeItem('liveviewToken');
    localStorage.removeItem('liveviewUser');
    window.location.href = 'login.html';
}

document.addEventListener('DOMContentLoaded', async function () {
    const sessionUser = await window.LiveViewAuth?.enforceAuthRules?.();
    if (!sessionUser) return;
    if (!requireSession()) return;

    document.querySelectorAll('#profileForm input[type="text"], #profileForm textarea').forEach((input) => {
        input.addEventListener('input', () => {
            unsavedChanges = true;
        });
    });

    window.addEventListener('beforeunload', function (event) {
        if (unsavedChanges) {
            event.preventDefault();
            event.returnValue = '';
        }
    });

    document.querySelector('.modal-close')?.addEventListener('click', closeImageModal);

    document.getElementById('restartTourBtn')?.addEventListener('click', () => {
        const user = JSON.parse(localStorage.getItem('liveviewUser') || 'null');
        if (window.LiveViewSiteTour?.clearTourDone) {
            window.LiveViewSiteTour.clearTourDone(user?.id);
        } else if (user?.id) {
            localStorage.removeItem(`liveviewSiteTourDone:${user.id}`);
        }
        localStorage.removeItem('liveviewSiteTourDone');
        window.location.href = 'index.html?welcome=1#streams';
    });

    document.getElementById('logoutBtn')?.addEventListener('click', logout);

    document.getElementById('profileForm').addEventListener('submit', async (event) => {
        event.preventDefault();
        setMessage('Saving profile...');

        try {
            await requestJson(`${apiBaseUrl}/profile/${userId}`, {
                method: 'PUT',
                headers: authHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({
                    first_name: document.getElementById('first_name').value,
                    last_name: document.getElementById('last_name').value,
                    city: document.getElementById('city').value,
                    state: document.getElementById('state').value,
                    description: document.getElementById('description').value,
                    stream_url: document.getElementById('stream_url').value,
                    street_address: document.getElementById('street_address')?.value || undefined,
                    bio: document.getElementById('bio')?.value || undefined,
                    handicap: document.getElementById('handicap')?.value || undefined,
                    home_course: document.getElementById('home_course')?.value || undefined,
                    rounds_played: document.getElementById('rounds_played')?.value || undefined
                })
            });
            unsavedChanges = false;
            setMessage('Profile updated.');
            await fetchProfile();
        } catch (error) {
            setMessage(error.message, 'error');
        }
    });

    document.getElementById('friendForm')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const email = document.getElementById('friendEmail').value.trim();
        const phone = document.getElementById('friendPhone')?.value.trim();
        if (!email && !phone) return;
        setMessage('Sending friend request...');
        try {
            const data = await requestJson(`${apiBaseUrl}/friend-requests`, {
                method: 'POST',
                headers: authHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({ email: email || undefined, phone: phone || undefined })
            });
            document.getElementById('friendEmail').value = '';
            if (document.getElementById('friendPhone')) document.getElementById('friendPhone').value = '';
            setMessage(data.message + (data.emailSent ? ' Email sent.' : '') + (data.smsSent ? ' Text sent.' : '') + (!data.emailSent && !data.smsSent && data.shareLink ? ` Share this link: ${data.shareLink}` : ''));
            await fetchConsumerDashboard();
        } catch (error) {
            setMessage(error.message, 'error');
        }
    });

    document.getElementById('consumerDashboard')?.addEventListener('click', async (event) => {
        const courseButton = event.target.closest('.remove-course-btn');
        const friendButton = event.target.closest('.remove-friend-btn');
        const acceptBtn = event.target.closest('.accept-request-btn');
        const declineBtn = event.target.closest('.decline-request-btn');
        const cancelBtn = event.target.closest('.cancel-request-btn');
        try {
            if (acceptBtn) {
                await requestJson(`${apiBaseUrl}/friend-requests/${acceptBtn.dataset.requestId}/accept`, {
                    method: 'POST',
                    headers: authHeaders()
                });
                setMessage('Friend request accepted.');
                await fetchConsumerDashboard();
            }
            if (declineBtn || cancelBtn) {
                const id = (declineBtn || cancelBtn).dataset.requestId;
                await requestJson(`${apiBaseUrl}/friend-requests/${id}/decline`, {
                    method: 'POST',
                    headers: authHeaders()
                });
                setMessage('Request updated.');
                await fetchConsumerDashboard();
            }
            if (courseButton) {
                await requestJson(`${apiBaseUrl}/profile/${userId}/course-lists`, {
                    method: 'POST',
                    headers: authHeaders({ 'Content-Type': 'application/json' }),
                    body: JSON.stringify({
                        courseId: courseButton.dataset.courseId,
                        list: courseButton.dataset.list,
                        enabled: false
                    })
                });
                await fetchConsumerDashboard();
            }
            if (friendButton) {
                await requestJson(`${apiBaseUrl}/profile/${userId}/friends/${friendButton.dataset.friendId}`, {
                    method: 'DELETE',
                    headers: authHeaders()
                });
                await fetchConsumerDashboard();
            }
        } catch (error) {
            setMessage(error.message, 'error');
        }
    });

    autoSaveImage('course_logo');
    autoSaveImage('stream_preview_photo');
    autoSaveImage('profile_picture');

    document.getElementById('generateStreamKeyBtn')?.addEventListener('click', async function() {
        if (!confirm('Generate a new webhook key? Encoders using the old key will stop updating live status.')) return;
        setMessage('Generating stream key...');

        try {
            const data = await requestJson(`${apiBaseUrl}/profile/${userId}/generate-stream-key`, {
                method: 'POST',
                headers: authHeaders()
            });
            activeUser = { ...activeUser, stream_key: data.stream_key, hls_url: data.hls_url };
            renderStreamInfo(activeUser);
            setMessage('New stream key generated.');
        } catch (error) {
            setMessage(error.message, 'error');
        }
    });

    document.getElementById('requestApprovalBtn')?.addEventListener('click', async function() {
        setMessage('Requesting approval...');
        try {
            const data = await requestJson(`${apiBaseUrl}/profile/${userId}/request-stream-approval`, {
                method: 'POST',
                headers: authHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({ note: 'Course requested approval from the stream studio.' })
            });
            activeUser = data.user;
            renderStreamInfo(activeUser);
            setMessage(data.message);
        } catch (error) {
            setMessage(error.message, 'error');
        }
    });

    document.getElementById('toggleStreamBtn')?.addEventListener('click', async function() {
        const stream_enabled = !activeUser?.stream_enabled;
        setMessage(stream_enabled ? 'Turning stream on...' : 'Turning stream off...');
        try {
            const data = await requestJson(`${apiBaseUrl}/profile/${userId}/stream-status`, {
                method: 'POST',
                headers: authHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({ stream_enabled })
            });
            activeUser = data.user;
            renderStreamInfo(activeUser);
            renderStreamPreview(activeUser);
            setMessage(data.message);
        } catch (error) {
            setMessage(error.message, 'error');
        }
    });

    fetchProfile().catch((error) => {
        setMessage(error.message, 'error');
        if (/login|session|expired/i.test(error.message)) {
            setTimeout(() => window.location.href = 'login.html', 900);
        }
    });
});
