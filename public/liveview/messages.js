const lvMessages = window.LiveViewCore;

let activePartnerId = null;

async function loadConversations() {
    const data = await lvMessages.fetchJson(`${lvMessages.getApiBaseUrl()}/messages/conversations`, { headers: lvMessages.authHeaders() });
    const list = document.getElementById('conversationList');
    const partners = data.partners || [];
    list.innerHTML = partners.map((p) => `
        <button type="button" class="conversation-item" data-id="${p.id}">
            <strong>${lvMessages.escapeHtml(p.name)}</strong>
            <span>${lvMessages.escapeHtml(p.city || '')}${p.state ? `, ${lvMessages.escapeHtml(p.state)}` : ''}</span>
        </button>
    `).join('') || '<p class="for-you-status">No conversations yet.</p>';

    list.querySelectorAll('.conversation-item').forEach((btn) => {
        btn.addEventListener('click', () => openThread(Number(btn.dataset.id), btn.textContent.trim()));
    });

    const params = new URLSearchParams(window.location.search);
    const withId = params.get('with');
    if (withId) openThread(Number(withId));
}

async function openThread(partnerId, label = '') {
    activePartnerId = partnerId;
    document.getElementById('threadHeader').textContent = label || `User #${partnerId}`;
    const data = await lvMessages.fetchJson(`${lvMessages.getApiBaseUrl()}/messages/${partnerId}`, { headers: lvMessages.authHeaders() });
    const { user } = lvMessages.getSession();
    const list = document.getElementById('messageList');
    list.innerHTML = (data.messages || []).map((m) => {
        const mine = m.from_user_id === user.id;
        return `<div class="message-bubble ${mine ? 'mine' : 'theirs'}">${lvMessages.escapeHtml(m.body)}</div>`;
    }).join('');
    list.scrollTop = list.scrollHeight;
}

document.getElementById('messageForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!activePartnerId) return;
    const input = document.getElementById('messageInput');
    const body = input.value.trim();
    if (!body) return;
    await fetch(`${lvMessages.getApiBaseUrl()}/messages/${activePartnerId}`, {
        method: 'POST',
        headers: lvMessages.authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ body })
    });
    input.value = '';
    await openThread(activePartnerId);
});

(async function init() {
    const { token } = lvMessages.getSession();
    if (!token) {
        window.location.href = 'login.html';
        return;
    }
    await loadConversations();
})();
