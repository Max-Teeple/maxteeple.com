(function () {
    function getApiBaseUrl() {
        return window.config?.apiBaseUrl || window.location.origin;
    }

    function getSession() {
        return {
            token: localStorage.getItem('liveviewToken'),
            user: JSON.parse(localStorage.getItem('liveviewUser') || 'null')
        };
    }

    function persistUser(user) {
        localStorage.setItem('liveviewUser', JSON.stringify({
            id: user.id,
            name: user.name,
            first_name: user.first_name || null,
            last_name: user.last_name || null,
            email: user.email,
            role: user.role,
            city: user.city,
            state: user.state,
            course_logo: user.course_logo,
            profile_picture: user.profile_picture,
            onboarding_completed: user.onboarding_completed === true || user.onboarding_completed === 1
        }));
    }

    function isOnboardingComplete(user) {
        return Boolean(user && (user.onboarding_completed === true || user.onboarding_completed === 1));
    }

    async function fetchMe() {
        const { token } = getSession();
        if (!token) return null;
        const response = await fetch(`${getApiBaseUrl()}/me`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success) return null;
        persistUser(data.user);
        return data.user;
    }

    async function enforceAuthRules() {
        const path = window.liveviewPage ? window.liveviewPage() : ((window.location.pathname || '').split('/').pop() || 'index.html');
        const onOnboarding = path === 'onboarding.html';
        const onLogin = path === 'login.html';
        const { token, user } = getSession();

        if (onLogin) {
            if (token && user) {
                const fresh = await fetchMe();
                const active = fresh || user;
                if (active && !isOnboardingComplete(active)) {
                    window.location.replace('onboarding.html');
                    return null;
                }
                if (active && isOnboardingComplete(active)) {
                    window.location.replace(active.role === 'course_owner'
                        ? `profile.html?id=${active.id}`
                        : 'index.html#streams');
                    return null;
                }
            }
            return user;
        }

        if (!token || !user) {
            if (onOnboarding) {
                window.location.replace('login.html');
            }
            return null;
        }

        const fresh = await fetchMe();
        const active = fresh || user;

        if (!active) {
            localStorage.removeItem('liveviewToken');
            localStorage.removeItem('liveviewUser');
            window.location.replace('login.html');
            return null;
        }

        if (!isOnboardingComplete(active) && !onOnboarding) {
            window.location.replace('onboarding.html');
            return null;
        }

        if (isOnboardingComplete(active) && onOnboarding) {
            window.location.replace(active.role === 'course_owner'
                ? `profile.html?id=${active.id}`
                : 'index.html?welcome=1#streams');
            return null;
        }

        return active;
    }

    window.LiveViewAuth = {
        getApiBaseUrl,
        getSession,
        persistUser,
        isOnboardingComplete,
        fetchMe,
        enforceAuthRules
    };
})();
