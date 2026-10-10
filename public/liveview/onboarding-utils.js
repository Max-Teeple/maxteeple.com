function getApiBaseUrl() {
    return window.config?.apiBaseUrl || window.location.origin;
}

function getToken() {
    return localStorage.getItem('liveviewToken');
}

function getUser() {
    return JSON.parse(localStorage.getItem('liveviewUser') || 'null');
}

function authHeaders(extra = {}) {
    const token = getToken();
    return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
}

function persistUser(user) {
    localStorage.setItem('liveviewUser', JSON.stringify({
        id: user.id,
        name: user.name,
        first_name: user.first_name || null,
        last_name: user.last_name || null,
        email: user.email,
        role: user.role,
        course_logo: user.course_logo,
        profile_picture: user.profile_picture,
        onboarding_completed: user.onboarding_completed
    }));
}

async function apiRequest(url, options = {}) {
    const response = await fetch(url, options);
    const text = await response.text();
    let data = {};
    try {
        data = text ? JSON.parse(text) : {};
    } catch (error) {
        throw new Error(`Server error (${response.status}). Please try again.`);
    }
    if (!response.ok || data.success === false) {
        throw new Error(
            data.message ||
            data.error ||
            (response.status === 401 ? 'Session expired. Please log in again.' : `Request failed (${response.status})`)
        );
    }
    return data;
}

function escapeHtml(value = '') {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}

function redirectIfNotAuthed() {
    if (!getToken() || !getUser()) {
        window.location.href = 'login.html';
        return false;
    }
    return true;
}

function isOnboardingComplete(user) {
    return user?.onboarding_completed === true || user?.onboarding_completed === 1;
}

function redirectIfOnboardingDone(user) {
    if (isOnboardingComplete(user)) {
        window.location.href = user.role === 'course_owner'
            ? `profile.html?id=${user.id}`
            : 'index.html#streams';
        return true;
    }
    return false;
}
