function getApiBaseUrl() {
    return window.LiveViewAuth?.getApiBaseUrl?.() || window.config?.apiBaseUrl || window.location.origin;
}

function showStatus(message, type = 'info') {
    const status = document.getElementById('authStatus');
    status.textContent = message;
    status.className = `auth-status ${type}`;
    status.hidden = false;
}

function setBusy(form, isBusy) {
    const button = form.querySelector('button[type="submit"]');
    if (!button) return;
    button.disabled = isBusy;
    button.dataset.originalText = button.dataset.originalText || button.textContent;
    button.textContent = isBusy ? 'Working...' : button.dataset.originalText;
}

function persistSession(payload) {
    localStorage.setItem('liveviewToken', payload.token);
    if (window.LiveViewAuth?.persistUser) {
        window.LiveViewAuth.persistUser(payload.user);
    } else {
        localStorage.setItem('liveviewUser', JSON.stringify(payload.user));
    }
}

function isOnboardingComplete(user) {
    return window.LiveViewAuth?.isOnboardingComplete?.(user) ||
        user?.onboarding_completed === true || user?.onboarding_completed === 1;
}

async function redirectForRole(user) {
    if (window.LiveViewAuth?.fetchMe) {
        const fresh = await window.LiveViewAuth.fetchMe();
        if (fresh) user = fresh;
    }

    if (!isOnboardingComplete(user)) {
        window.location.replace('onboarding.html');
        return;
    }
    if (user.role === 'course_owner') {
        window.location.replace(`profile.html?id=${user.id}`);
        return;
    }
    window.location.replace('index.html#streams');
}

async function parseResponse(response) {
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) {
        throw new Error(data.message || 'Something went wrong. Please try again.');
    }
    return data;
}

function showPanel(targetId) {
    const panelByTarget = {
        loginForm: 'loginPanel',
        signupOptions: 'signupOptions',
        golfCourseForm: 'golfCourseForm',
        singleUserForm: 'singleUserForm'
    };

    Object.values(panelByTarget).forEach((id) => {
        document.getElementById(id)?.classList.add('hidden');
    });
    document.getElementById(panelByTarget[targetId])?.classList.remove('hidden');

    document.querySelectorAll('.mode-tab').forEach((tab) => {
        tab.classList.toggle('active', tab.dataset.target === targetId);
    });
}

async function login(email, password) {
    const response = await fetch(`${getApiBaseUrl()}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
    });
    return parseResponse(response);
}

async function registerConsumer(form) {
    const formData = new FormData(form);
    const response = await fetch(`${getApiBaseUrl()}/register-user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(formData.entries()))
    });
    return parseResponse(response);
}

async function registerCourse(form) {
    const response = await fetch(`${getApiBaseUrl()}/register-golf-course`, {
        method: 'POST',
        body: new FormData(form)
    });
    return parseResponse(response);
}

document.addEventListener('DOMContentLoaded', async function () {
    const existingToken = localStorage.getItem('liveviewToken');
    const existingUser = JSON.parse(localStorage.getItem('liveviewUser') || 'null');
    if (existingToken && existingUser) {
        showStatus(`Signed in as ${existingUser.name}. Redirecting...`, 'success');
        await redirectForRole(existingUser);
        return;
    }

    document.querySelectorAll('[data-target]').forEach((trigger) => {
        trigger.addEventListener('click', (event) => {
            event.preventDefault();
            showPanel(trigger.dataset.target);
        });
    });

    document.getElementById('showSignupOptions').addEventListener('click', function (event) {
        event.preventDefault();
        showPanel('signupOptions');
    });

    document.getElementById('golfCourseBtn').addEventListener('click', function () {
        showPanel('golfCourseForm');
    });

    document.getElementById('singleUserBtn').addEventListener('click', function () {
        showPanel('singleUserForm');
    });

    document.getElementById('loginForm').addEventListener('submit', async function (event) {
        event.preventDefault();
        setBusy(this, true);
        showStatus('Checking your credentials...', 'info');

        try {
            const payload = await login(
                document.getElementById('login-email').value,
                document.getElementById('login-password').value
            );
            persistSession(payload);
            showStatus('Login successful. Taking you in...', 'success');
            await redirectForRole(payload.user);
        } catch (error) {
            showStatus(error.message, 'error');
        } finally {
            setBusy(this, false);
        }
    });

    document.getElementById('golfCourseSignupForm').addEventListener('submit', async function (event) {
        event.preventDefault();
        setBusy(this, true);
        showStatus('Creating your owner account...', 'info');

        try {
            const payload = await registerCourse(this);
            persistSession(payload);
            showStatus('Course account created. Starting setup...', 'success');
            await redirectForRole(payload.user);
        } catch (error) {
            showStatus(error.message, 'error');
        } finally {
            setBusy(this, false);
        }
    });

    document.getElementById('singleUserSignupForm').addEventListener('submit', async function (event) {
        event.preventDefault();
        setBusy(this, true);
        showStatus('Creating your viewer account...', 'info');

        try {
            const payload = await registerConsumer(this);
            persistSession(payload);
            showStatus('Welcome! Starting your setup tour...', 'success');
            await redirectForRole(payload.user);
        } catch (error) {
            showStatus(error.message, 'error');
        } finally {
            setBusy(this, false);
        }
    });
});
