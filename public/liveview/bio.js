document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(window.location.search);
    const userId = params.get('id');
    const apiBaseUrl = window.config?.apiBaseUrl || window.location.origin;
    const { escapeHtml, initials, accountImage } = window.LiveViewCore;

    const loading = document.getElementById('bioLoading');
    const content = document.getElementById('bioContent');

    if (!userId) {
        loading.textContent = 'Missing profile id.';
        return;
    }

    await window.LiveViewAuth?.enforceAuthRules?.();
    setupAccountChrome?.();

    const session = JSON.parse(localStorage.getItem('liveviewUser') || 'null');
    const token = localStorage.getItem('liveviewToken');

    try {
        const response = await fetch(`${apiBaseUrl}/profile/${userId}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.message || 'Profile not found');

        const user = data.user;
        loading.hidden = true;
        content.hidden = false;

        document.title = `${user.name} — LiveView Golf`;
        document.getElementById('bioName').textContent = user.name;
        document.getElementById('bioLocation').textContent = [user.city, user.state].filter(Boolean).join(', ');
        document.getElementById('bioRole').textContent =
            user.role === 'course_owner' ? 'Golf course' : 'Golfer';

        const avatarWrap = document.getElementById('bioAvatarWrap');
        const image = accountImage(user, 'profile_picture', 'course_logo');
        if (image) {
            avatarWrap.innerHTML = `<img class="bio-avatar" src="${escapeHtml(image)}" alt="${escapeHtml(user.name)}">`;
        } else {
            avatarWrap.innerHTML = `<div class="bio-avatar placeholder">${escapeHtml(initials(user.name))}</div>`;
        }

        const meta = [];
        if (user.role === 'consumer') {
            if (user.handicap != null) meta.push(['Handicap', user.handicap]);
            if (user.home_course) meta.push(['Home course', user.home_course]);
            if (user.rounds_played != null) meta.push(['Rounds played', user.rounds_played]);
        } else if (user.street_address) {
            meta.push(['Address', user.street_address]);
        }
        if (user.follower_count) meta.push(['Followers', user.follower_count]);

        document.getElementById('bioMeta').innerHTML = meta.length
            ? meta.map(([label, value]) => `
                <div class="bio-meta-card">
                    <strong>${escapeHtml(label)}</strong>
                    <span>${escapeHtml(String(value))}</span>
                </div>
            `).join('')
            : '';

        const story = user.bio || user.description;
        document.getElementById('bioStory').textContent = story || 'This member has not shared their story yet.';

        if (user.interests) {
            const chips = user.interests.split(',').map((s) => s.trim()).filter(Boolean);
            if (chips.length) {
                document.getElementById('bioInterestsSection').hidden = false;
                document.getElementById('bioInterests').innerHTML = chips
                    .map((chip) => `<span class="chip selected">${escapeHtml(chip)}</span>`)
                    .join('');
            }
        }

        const actions = document.getElementById('bioActions');
        if (user.role === 'course_owner') {
            const href = user.slug
                ? `course.html?slug=${encodeURIComponent(user.slug)}`
                : `course.html?id=${user.id}`;
            actions.innerHTML = `<a class="primary-link" href="${href}">View course page</a>`;
        } else if (session && String(session.id) !== String(user.id)) {
            actions.innerHTML = `<button type="button" class="login-btn" id="bioAddFriend">Add friend</button>`;
            document.getElementById('bioAddFriend')?.addEventListener('click', async () => {
                const btn = document.getElementById('bioAddFriend');
                btn.disabled = true;
                try {
                    const res = await fetch(`${apiBaseUrl}/friend-requests`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            Authorization: `Bearer ${token}`
                        },
                        body: JSON.stringify({ userId: Number(user.id) })
                    });
                    const payload = await res.json();
                    if (!res.ok || !payload.success) throw new Error(payload.message);
                    btn.textContent = 'Request sent';
                } catch (error) {
                    btn.disabled = false;
                    alert(error.message);
                }
            });
        }

        if (session && String(session.id) === String(user.id)) {
            actions.innerHTML += `<a class="secondary-link" href="profile.html?id=${user.id}">Edit profile</a>`;
        }
    } catch (error) {
        loading.textContent = error.message;
    }
});
