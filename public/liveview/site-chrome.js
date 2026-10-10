window.LiveViewChrome = (function () {
    const NAV_ITEMS = [
        { key: 'streams', label: 'Streams', href: 'index.html#streams' },
        { key: 'explore', label: 'Explore', href: 'explore.html' },
        { key: 'profile', label: 'Profile', href: '', loggedInOnly: true },
        { key: 'bio', label: 'My bio', href: '', loggedInOnly: true, consumerOnly: true },
        { key: 'courses', label: 'For courses', href: 'index.html#about' },
        { key: 'contact', label: 'Contact', href: 'index.html#contact' }
    ];

    function getSessionUser() {
        try {
            return JSON.parse(localStorage.getItem('liveviewUser') || 'null');
        } catch (error) {
            return null;
        }
    }

    function detectPage() {
        const path = window.liveviewPage ? window.liveviewPage() : ((window.location.pathname || '').split('/').pop() || 'index.html');
        const hash = window.location.hash || '';
        if (path === 'explore.html') return 'explore';
        if (path === 'profile.html') return 'profile';
        if (path === 'bio.html') return 'bio';
        if (path === 'messages.html') return 'messages';
        if (path === 'groups.html') return 'groups';
        if (path === 'course.html') return 'course';
        if (path === 'index.html' || path === '') {
            if (hash.includes('about')) return 'courses';
            if (hash.includes('contact')) return 'contact';
            if (hash.includes('streams')) return 'streams';
            return 'home';
        }
        return '';
    }

    function resolveHref(item, user) {
        if (item.key === 'profile' && user) return `profile.html?id=${user.id}`;
        if (item.key === 'bio' && user) return `bio.html?id=${user.id}`;
        if (pathIsIndex() && item.key === 'streams') return '#streams';
        if (pathIsIndex() && item.key === 'courses') return '#about';
        if (pathIsIndex() && item.key === 'contact') return '#contact';
        return item.href;
    }

    function pathIsIndex() {
        const path = window.liveviewPage ? window.liveviewPage() : ((window.location.pathname || '').split('/').pop() || 'index.html');
        return path === 'index.html' || path === '';
    }

    function shouldShowNavItem(item, user) {
        if (!item.loggedInOnly) return true;
        if (!user) return false;
        if (item.consumerOnly && user.role === 'course_owner') return false;
        return true;
    }

    function wireNavLinks(activePage) {
        const user = getSessionUser();
        document.querySelectorAll('[data-nav]').forEach((link) => {
            const key = link.dataset.nav;
            const item = NAV_ITEMS.find((entry) => entry.key === key);
            if (!item) return;

            if (!shouldShowNavItem(item, user)) {
                link.hidden = true;
                link.removeAttribute('aria-current');
                link.classList.remove('nav-active');
                return;
            }

            link.hidden = false;
            link.href = resolveHref(item, user);
            link.textContent = item.label;

            const isActive = key === activePage
                || (activePage === 'home' && key === 'streams' && !window.location.hash);
            if (isActive) {
                link.setAttribute('aria-current', 'page');
                link.classList.add('nav-active');
            } else {
                link.removeAttribute('aria-current');
                link.classList.remove('nav-active');
            }
        });
    }

    function ensureMobileNav(activePage) {
        const menu = document.getElementById('dropdown-menu');
        if (!menu || menu.querySelector('[data-nav]')) return;

        const list = menu.querySelector('ul');
        if (!list) return;

        const user = getSessionUser();
        NAV_ITEMS.forEach((item) => {
            if (!shouldShowNavItem(item, user)) return;
            const li = document.createElement('li');
            const a = document.createElement('a');
            a.dataset.nav = item.key;
            a.href = resolveHref(item, user);
            a.textContent = item.label;
            if (item.key === activePage) {
                a.setAttribute('aria-current', 'page');
                a.classList.add('nav-active');
            }
            li.appendChild(a);
            list.appendChild(li);
        });
    }

    function init() {
        const activePage = document.body.dataset.navPage || detectPage();
        ensureMobileNav(activePage);
        wireNavLinks(activePage);
        if (typeof window.setupMenu === 'function') window.setupMenu();
        if (typeof window.setupAccountChrome === 'function') window.setupAccountChrome();
    }

    return { init, detectPage, NAV_ITEMS };
})();

document.addEventListener('DOMContentLoaded', () => {
    window.LiveViewChrome?.init();
});
