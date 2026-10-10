const lvGroups = window.LiveViewCore;

async function loadGroups() {
    const data = await lvGroups.fetchJson(`${lvGroups.getApiBaseUrl()}/groups`, { headers: lvGroups.authHeaders() });
    const el = document.getElementById('groupsList');
    const groups = data.groups || [];
    el.innerHTML = groups.map((g) => `
        <article class="for-you-card">
            <strong>${lvGroups.escapeHtml(g.name)}</strong>
            <span>${lvGroups.escapeHtml(g.city || '')}${g.state ? `, ${lvGroups.escapeHtml(g.state)}` : ''}</span>
            <p>Invite: <code>${lvGroups.escapeHtml(g.invite_code)}</code></p>
            <button type="button" class="login-btn watch-party-btn" data-id="${g.id}">Share watch party link</button>
        </article>
    `).join('') || '<p class="for-you-status">No groups yet — create one above.</p>';

    el.querySelectorAll('.watch-party-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const courseId = document.getElementById('watchPartyCourseId')?.value;
            if (!courseId) return;
            const res = await lvGroups.fetchJson(`${lvGroups.getApiBaseUrl()}/groups/${btn.dataset.id}/watch-party`, {
                method: 'POST',
                headers: lvGroups.authHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({ courseId: Number(courseId) })
            });
            document.getElementById('groupStatus').textContent = `Party link: ${res.link}`;
        });
    });
}

document.getElementById('createGroupForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('groupName').value.trim();
    const res = await fetch(`${lvGroups.getApiBaseUrl()}/groups`, {
        method: 'POST',
        headers: lvGroups.authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ name })
    });
    const data = await res.json();
    document.getElementById('groupStatus').textContent = data.inviteLink || data.message || 'Group created';
    await loadGroups();
});

document.getElementById('joinGroupForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = document.getElementById('inviteCode').value.trim();
    await fetch(`${lvGroups.getApiBaseUrl()}/groups/join`, {
        method: 'POST',
        headers: lvGroups.authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ invite_code: code })
    });
    await loadGroups();
});

(async function init() {
    if (!localStorage.getItem('liveviewToken')) {
        window.location.href = 'login.html';
        return;
    }
    const params = new URLSearchParams(window.location.search);
    if (params.get('join')) document.getElementById('inviteCode').value = params.get('join');
    await loadGroups();
})();
