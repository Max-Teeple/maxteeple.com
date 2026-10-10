window.LiveViewSocial = (function () {
    const { getApiBaseUrl, authHeaders, escapeHtml, fetchJson } = window.LiveViewCore;

    async function loadActivityFeed() {
        const section = document.getElementById('activity-feed');
        const list = document.getElementById('activityFeedList');
        const token = localStorage.getItem('liveviewToken');
        if (!section || !list || !token) return;

        try {
            const data = await fetchJson(`${getApiBaseUrl()}/activity/feed`, { headers: authHeaders() });
            if (!data.success || !data.items?.length) {
                section.hidden = true;
                return;
            }
            section.hidden = false;
            list.innerHTML = data.items.slice(0, 12).map((item) => `
                <article class="activity-item">
                    <strong>${escapeHtml(item.title)}</strong>
                    ${item.body ? `<p>${escapeHtml(item.body)}</p>` : ''}
                    <time>${new Date(item.createdAt).toLocaleString()}</time>
                </article>
            `).join('');
        } catch (e) {
            section.hidden = true;
        }
    }

    async function loadNotifications() {
        const token = localStorage.getItem('liveviewToken');
        if (!token) return [];
        const data = await fetchJson(`${getApiBaseUrl()}/notifications`, { headers: authHeaders() });
        return data.notifications || [];
    }

    function setupNotificationBell() {
        const bell = document.getElementById('notifBell');
        const panel = document.getElementById('notifPanel');
        const list = document.getElementById('notifPanelList');
        const count = document.getElementById('notifCount');
        const closeBtn = document.getElementById('closeNotifPanel');
        const user = JSON.parse(localStorage.getItem('liveviewUser') || 'null');
        if (!user || !bell) return;

        bell.hidden = false;
        document.getElementById('messagesLink')?.removeAttribute('hidden');
        document.getElementById('groupsLink')?.removeAttribute('hidden');

        async function refresh() {
            const rows = await loadNotifications();
            const unread = rows.filter((n) => !n.read_at).length;
            if (unread) {
                count.hidden = false;
                count.textContent = String(unread);
            } else {
                count.hidden = true;
            }
            if (list) {
                list.innerHTML = rows.length
                    ? rows.map((n) => `
                        <article class="notif-item ${n.read_at ? '' : 'unread'}">
                            <strong>${escapeHtml(n.title)}</strong>
                            <p>${escapeHtml(n.body || '')}</p>
                            ${n.link ? `<a href="${escapeHtml(n.link)}">Open</a>` : ''}
                        </article>
                    `).join('')
                    : '<p class="for-you-status">No notifications yet.</p>';
            }
        }

        bell.addEventListener('click', async () => {
            panel.hidden = !panel.hidden;
            if (!panel.hidden) await refresh();
        });
        closeBtn?.addEventListener('click', () => { panel.hidden = true; });
        refresh();
    }

    function setupChrome(user) {
        if (!user) return;
        loadActivityFeed();
        setupNotificationBell();
    }

    return { setupChrome, loadActivityFeed };
})();
