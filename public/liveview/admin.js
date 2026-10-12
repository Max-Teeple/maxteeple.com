const { getApiBaseUrl, escapeHtml } = window.LiveViewCore;

function token() {
    return document.getElementById('adminToken').value.trim();
}

function authHeaders(extra) {
    const headers = Object.assign({}, extra || {});
    if (token()) headers['x-admin-token'] = token();
    return headers;
}

async function loadQueue() {
    const res = await fetch(`${getApiBaseUrl()}/admin/stream-queue`, {
        headers: authHeaders()
    });
    const data = await res.json();
    const el = document.getElementById('adminQueue');
    if (!data.success) {
        el.innerHTML = `<p class="for-you-status">${escapeHtml(data.message)}</p>`;
        return;
    }
    el.innerHTML = (data.queue || []).map((c) => `
        <article class="for-you-card">
            <strong>${escapeHtml(c.name)}</strong>
            <span>${escapeHtml(c.city)}, ${escapeHtml(c.state)}</span>
            <p>Requested: ${c.stream_approval_requested_at ? new Date(c.stream_approval_requested_at).toLocaleString() : '—'}</p>
            <button type="button" data-id="${c.id}" data-action="approve" class="primary-link" style="border:none;cursor:pointer">Approve</button>
            <button type="button" data-id="${c.id}" data-action="deny" class="secondary-link" style="border:none;cursor:pointer">Deny</button>
        </article>
    `).join('') || '<p class="for-you-status">Queue is empty.</p>';

    el.querySelectorAll('button[data-action]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const approved = btn.dataset.action === 'approve';
            await fetch(`${getApiBaseUrl()}/admin/courses/${btn.dataset.id}/approval`, {
                method: 'POST',
                headers: authHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({ approved, note: approved ? 'Approved via admin console' : 'Denied' })
            });
            loadQueue();
        });
    });
}

document.getElementById('loadQueue')?.addEventListener('click', loadQueue);

async function loadInstalls() {
    const res = await fetch(`${getApiBaseUrl()}/admin/install-requests`, { headers: authHeaders() });
    const data = await res.json();
    const el = document.getElementById('installRequests');
    if (!el) return;
    if (!data.success) {
        el.innerHTML = `<p class="for-you-status">${escapeHtml(data.message)}</p>`;
        return;
    }
    el.innerHTML = (data.requests || []).map((row) => `
        <article class="for-you-card">
            <strong>${escapeHtml(row.course_name)}</strong>
            <span>${escapeHtml(row.contact_name)} · ${escapeHtml(row.email)}${row.phone ? ` · ${escapeHtml(row.phone)}` : ''}</span>
            <p>Spots: ${escapeHtml(row.camera_spots || '—')}</p>
            <p>Power: ${escapeHtml(row.power_availability || '—')}</p>
            <p>Internet: ${escapeHtml(row.internet_available || '—')}</p>
            <p>${escapeHtml(row.notes || '')}</p>
        </article>
    `).join('') || '<p class="for-you-status">No install requests yet.</p>';
}

document.getElementById('loadInstalls')?.addEventListener('click', loadInstalls);

document.getElementById('seedDemo')?.addEventListener('click', async () => {
  const status = document.getElementById('seedStatus');
  if (status) status.textContent = 'Loading demo data...';
  const res = await fetch(`${getApiBaseUrl()}/admin/seed-demo`, {
    method: 'POST',
    headers: authHeaders()
  });
  const data = await res.json();
  if (status) {
    status.textContent = data.success
      ? `Demo data ready. ${data.courses?.total || 0} courses, ${data.accounts?.total || 0} accounts. Fan password ${data.password}. Example: ${data.exampleUserLogin}`
      : (data.message || 'Could not load demo data');
  }
});
