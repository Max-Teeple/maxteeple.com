const STEPS = [
    { id: 'basics', label: 'Basics' },
    { id: 'branding', label: 'Branding' },
    { id: 'tier', label: 'Install' },
    { id: 'youtube', label: 'YouTube' },
    { id: 'link', label: 'Test link' },
    { id: 'schedule', label: 'Schedule' },
    { id: 'approval', label: 'Approval' }
];

const apiBaseUrl = window.LiveViewAuth?.getApiBaseUrl?.() || window.config?.apiBaseUrl || window.location.origin;
let user = null;

function authHeaders(extra = {}) {
    const token = localStorage.getItem('liveviewToken');
    return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
}

function showError(message) {
    const el = document.getElementById('goliveError');
    if (!el) return;
    el.hidden = !message;
    el.textContent = message || '';
}

async function api(path, options = {}) {
    const response = await fetch(`${apiBaseUrl}${path}`, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) {
        throw new Error(data.message || 'Request failed');
    }
    return data;
}

function stepIndex(id) {
    const index = STEPS.findIndex((step) => step.id === id);
    return index < 0 ? 0 : index;
}

function renderProgress(activeId) {
    const list = document.getElementById('goliveProgress');
    const active = stepIndex(activeId);
    list.innerHTML = STEPS.map((step, index) => `
        <li class="${index === active ? 'is-current' : ''} ${index < active ? 'is-done' : ''}">
            <button type="button" data-step="${step.id}">${index + 1}. ${step.label}</button>
        </li>
    `).join('');
    const label = document.getElementById('goliveStepLabel');
    if (label) label.textContent = `Step ${active + 1} of ${STEPS.length}`;
}

function showStep(id) {
    const known = STEPS.some((step) => step.id === id) ? id : 'basics';
    document.querySelectorAll('[data-golive-step]').forEach((panel) => {
        panel.hidden = panel.getAttribute('data-golive-step') !== known;
    });
    renderProgress(known);
    showError('');
    if (known === 'approval') renderChecklist();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function save(fields) {
    const data = await api(`/profile/${user.id}`, {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(fields)
    });
    user = data.user;
    localStorage.setItem('liveviewUser', JSON.stringify({
        ...JSON.parse(localStorage.getItem('liveviewUser') || '{}'),
        ...user
    }));
    return user;
}

function linkIsPlayable(value) {
    const kind = window.LiveViewPlayer?.classify(value);
    return Boolean(kind && kind.type !== 'link');
}

function renderChecklist() {
    const link = document.getElementById('streamUrl').value.trim() || user.stream_url || '';
    const rows = [
        ['Link valid', linkIsPlayable(link)],
        ['Approved', Boolean(user.stream_approved)],
        ['Live', Boolean(user.is_live)]
    ];
    document.getElementById('approvalChecklist').innerHTML = rows.map(([label, done]) => `
        <li class="${done ? 'is-done' : ''}">${done ? 'Done' : 'Waiting'} — ${label}</li>
    `).join('');
    const badge = document.getElementById('pendingBadge');
    const pending = Boolean(user.stream_approval_requested_at) && !user.stream_approved;
    badge.hidden = !pending;
    badge.textContent = pending ? 'Pending approval' : '';
    document.getElementById('requestApprovalBtn').disabled = !linkIsPlayable(link) || Boolean(user.stream_approved);
}

function youtubeCheckKey() {
    return `golive-youtube:${user?.id || 'draft'}`;
}

function persistYoutubeChecks() {
    const values = [...document.querySelectorAll('#youtubeChecks input')].map((box) => box.checked);
    localStorage.setItem(youtubeCheckKey(), JSON.stringify(values));
}

function restoreYoutubeChecks() {
    try {
        const values = JSON.parse(localStorage.getItem(youtubeCheckKey()) || '[]');
        document.querySelectorAll('#youtubeChecks input').forEach((box, index) => {
            box.checked = Boolean(values[index]);
        });
    } catch (error) {
        /* ignore a bad local draft */
    }
}

function fillForm() {
    document.getElementById('courseName').value = user.name || '';
    document.getElementById('courseCity').value = user.city || '';
    document.getElementById('courseState').value = user.state || '';
    document.getElementById('courseDescription').value = user.description || '';
    document.getElementById('streamUrl').value = user.stream_url || '';
    if (user.next_stream_at) {
        const date = new Date(user.next_stream_at);
        if (!Number.isNaN(date.getTime())) {
            const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
            document.getElementById('nextStream').value = local;
        }
    }
    const tier = user.setup_tier || 'managed';
    const radio = document.querySelector(`input[name="setup_tier"][value="${tier}"]`);
    if (radio) radio.checked = true;
    syncTier();
    const install = document.getElementById('wizardInstallForm');
    install.elements.course_name.value = user.name || '';
    install.elements.contact_name.value = user.name || '';
    install.elements.email.value = user.email || '';
    install.elements.phone.value = user.phone || '';
}

function syncTier() {
    const tier = document.querySelector('input[name="setup_tier"]:checked')?.value || 'managed';
    document.getElementById('managedPanel').hidden = tier !== 'managed';
    document.getElementById('diyPanel').hidden = tier === 'managed';
}

async function uploadBranding() {
    const logo = document.getElementById('courseLogo').files[0];
    const cover = document.getElementById('courseCover').files[0];
    if (!logo && !cover) return;
    const body = new FormData();
    if (logo) body.append('course_logo', logo);
    if (cover) body.append('stream_preview_photo', cover);
    const data = await api(`/profile/${user.id}/images`, {
        method: 'PUT',
        headers: authHeaders(),
        body
    });
    user = data.user;
}

document.addEventListener('DOMContentLoaded', async () => {
    const session = await window.LiveViewAuth?.enforceAuthRules?.();
    if (!session) return;
    if (session.role !== 'course_owner') {
        window.location.replace('onboarding.html');
        return;
    }
    user = session;
    fillForm();
    restoreYoutubeChecks();
    showStep(user.golive_step && user.golive_step !== 'done' ? user.golive_step : 'basics');

    document.querySelectorAll('[data-back]').forEach((button) => {
        button.addEventListener('click', async () => {
            showStep(button.dataset.back);
            try {
                await save({ golive_step: button.dataset.back });
            } catch (error) {
                showError(error.message);
            }
        });
    });
    document.querySelectorAll('#youtubeChecks input').forEach((box) => {
        box.addEventListener('change', persistYoutubeChecks);
    });

    document.getElementById('goliveProgress').addEventListener('click', async (event) => {
        const button = event.target.closest('[data-step]');
        if (!button) return;
        showStep(button.dataset.step);
        try {
            await save({ golive_step: button.dataset.step });
        } catch (error) {
            showError(error.message);
        }
    });

    document.getElementById('basicsForm').addEventListener('submit', async (event) => {
        event.preventDefault();
        showError('');
        try {
            await save({
                name: document.getElementById('courseName').value.trim(),
                city: document.getElementById('courseCity').value.trim(),
                state: document.getElementById('courseState').value.trim(),
                description: document.getElementById('courseDescription').value.trim(),
                golive_step: 'branding'
            });
            showStep('branding');
        } catch (error) {
            showError(error.message);
        }
    });

    document.getElementById('brandingNext').addEventListener('click', async () => {
        showError('');
        try {
            await uploadBranding();
            await save({ golive_step: 'tier' });
            showStep('tier');
        } catch (error) {
            showError(error.message);
        }
    });

    document.querySelectorAll('input[name="setup_tier"]').forEach((input) => {
        input.addEventListener('change', syncTier);
    });

    document.getElementById('wizardInstallForm').addEventListener('submit', async (event) => {
        event.preventDefault();
        const status = document.getElementById('installStatus');
        status.textContent = 'Sending…';
        try {
            const result = await window.LiveViewInstall.submit(event.currentTarget);
            status.textContent = result.message;
        } catch (error) {
            status.textContent = error.message;
        }
    });

    document.getElementById('tierNext').addEventListener('click', async () => {
        const tier = document.querySelector('input[name="setup_tier"]:checked')?.value || 'managed';
        showError('');
        try {
            await save({ setup_tier: tier, golive_step: 'youtube' });
            showStep('youtube');
        } catch (error) {
            showError(error.message);
        }
    });

    document.getElementById('youtubeNext').addEventListener('click', async () => {
        const boxes = [...document.querySelectorAll('#youtubeChecks input')];
        if (boxes.some((box) => !box.checked)) {
            showError('Check each YouTube step once it is done. You can leave and come back.');
            return;
        }
        showError('');
        try {
            await save({ golive_step: 'link' });
            showStep('link');
        } catch (error) {
            showError(error.message);
        }
    });

    document.getElementById('testLinkBtn').addEventListener('click', () => {
        const url = document.getElementById('streamUrl').value.trim();
        const status = document.getElementById('linkStatus');
        const video = document.getElementById('linkPreview');
        if (!linkIsPlayable(url)) {
            status.textContent = 'Use a YouTube watch or /live URL, a Twitch channel, a Vimeo link, or a public HLS or MP4 address.';
            video.hidden = true;
            return;
        }
        video.hidden = false;
        const started = window.LiveViewPlayer.show(video, url, () => {
            status.textContent = 'The preview did not start. Check the URL and try again.';
        });
        status.textContent = started
            ? 'Preview is playing. Nothing is saved until you continue.'
            : 'That link could not be previewed.';
    });

    document.getElementById('linkNext').addEventListener('click', async () => {
        const url = document.getElementById('streamUrl').value.trim();
        if (!linkIsPlayable(url)) {
            showError('Test a YouTube, Twitch, Vimeo, HLS, or MP4 link before continuing.');
            return;
        }
        showError('');
        try {
            await save({ stream_url: url, golive_step: 'schedule' });
            showStep('schedule');
        } catch (error) {
            showError(error.message);
        }
    });

    document.getElementById('scheduleForm').addEventListener('submit', async (event) => {
        event.preventDefault();
        const raw = document.getElementById('nextStream').value;
        showError('');
        try {
            await save({
                next_stream_at: raw ? new Date(raw).toISOString() : null,
                golive_step: 'approval'
            });
            showStep('approval');
        } catch (error) {
            showError(error.message);
        }
    });

    document.getElementById('requestApprovalBtn').addEventListener('click', async () => {
        showError('');
        try {
            const data = await api(`/profile/${user.id}/request-stream-approval`, {
                method: 'POST',
                headers: authHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({ note: 'Requested from the Go Live wizard' })
            });
            user = data.user;
            renderChecklist();
            document.getElementById('approvalStatus').textContent = data.message;
        } catch (error) {
            showError(error.message);
        }
    });

    document.getElementById('finishBtn').addEventListener('click', async () => {
        showError('');
        try {
            await save({ golive_step: 'done' });
            const data = await api(`/profile/${user.id}/complete-onboarding`, {
                method: 'POST',
                headers: authHeaders()
            });
            window.location.replace(data.redirect || `profile.html?id=${user.id}`);
        } catch (error) {
            showError(error.message);
        }
    });
});
