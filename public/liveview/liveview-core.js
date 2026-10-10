window.LiveViewCore = (function () {
    function getApiBaseUrl() {
        return window.config?.apiBaseUrl || window.location.origin;
    }

    function getSession() {
        return {
            token: localStorage.getItem('liveviewToken'),
            user: JSON.parse(localStorage.getItem('liveviewUser') || 'null')
        };
    }

    function authHeaders(extra = {}) {
        const token = localStorage.getItem('liveviewToken');
        return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
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
        return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || 'LV';
    }

    async function fetchJson(url, options = {}) {
        const response = await fetch(url, options);
        if (response.status === 304) return { notModified: true };
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.message || data.error || `HTTP ${response.status}`);
        return data;
    }

    function mediaUrl(stored) {
        if (!stored) return '';
        if (/^https?:\/\//i.test(stored)) return stored;
        const base = getApiBaseUrl().replace(/\/$/, '');
        const rel = stored.startsWith('/') ? stored : `/${stored}`;
        return `${base}${rel}`;
    }

    /** Prefer API *_url fields when present */
    function accountImage(account, ...fields) {
        if (!account) return '';
        for (const field of fields) {
            const urlKey = `${field}_url`;
            if (account[urlKey]) return account[urlKey];
            if (account[field]) return mediaUrl(account[field]);
        }
        return '';
    }

    function displayFirstName(account) {
        if (!account) return '';
        if (account.first_name) return String(account.first_name).trim();
        const name = String(account.name || '').trim();
        if (!name) return '';
        return name.split(/\s+/)[0];
    }

    function displayFullName(account) {
        if (!account) return '';
        if (account.first_name || account.last_name) {
            return [account.first_name, account.last_name].filter(Boolean).join(' ').trim();
        }
        return String(account.name || '').trim();
    }

    function coursePreviewImage(course) {
        if (!course) return '';
        const stored = accountImage(course, 'stream_preview_photo', 'course_logo');
        if (stored) return stored;
        if (course.slug) return `/liveview/images/courses/${course.slug}.jpg`;
        return '';
    }

    return {
        getApiBaseUrl,
        getSession,
        authHeaders,
        escapeHtml,
        initials,
        fetchJson,
        mediaUrl,
        accountImage,
        displayFirstName,
        displayFullName,
        coursePreviewImage
    };
})();
