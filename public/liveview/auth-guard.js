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

    function setupDestination(user) {
        if (!isOnboardingComplete(user)) {
            return user?.role === 'course_owner' ? 'golive.html' : 'onboarding.html';
        }
        return user?.role === 'course_owner' ? `profile.html?id=${user.id}` : 'index.html#streams';
    }

    async function enforceAuthRules() {
        const path = window.liveviewPage ? window.liveviewPage() : ((window.location.pathname || '').split('/').pop() || 'index.html');
        const onOnboarding = path === 'onboarding.html';
        const onGoLive = path === 'golive.html';
        const onTv = path === 'tv.html';
        const onLogin = path === 'login.html';
        const { token, user } = getSession();

        if (onLogin) {
            if (token && user) {
                const fresh = await fetchMe();
                const active = fresh || user;
                if (active) {
                    window.location.replace(setupDestination(active));
                    return null;
                }
            }
            return user;
        }

        if (!token || !user) {
            if (onOnboarding || onGoLive) window.location.replace('login.html?start=course');
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

        const owner = active.role === 'course_owner';
        if (onGoLive && !owner) {
            window.location.replace(isOnboardingComplete(active) ? 'index.html#streams' : 'onboarding.html');
            return null;
        }
        if (onOnboarding && owner && !isOnboardingComplete(active)) {
            window.location.replace('golive.html');
            return null;
        }
        if (!isOnboardingComplete(active) && !onOnboarding && !onGoLive && !onTv) {
            window.location.replace(setupDestination(active));
            return null;
        }
        if (isOnboardingComplete(active) && onOnboarding) {
            window.location.replace(owner ? `profile.html?id=${active.id}` : 'index.html?welcome=1#streams');
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
