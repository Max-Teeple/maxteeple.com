(function () {
    const LEGACY_TOUR_KEY = 'liveviewSiteTourDone';

    const STEP_DEFS = [
        {
            targets: ['#for-you:not([hidden])', '#for-you'],
            title: 'Recommended for you',
            text: 'Streams and golfers near your city appear here first. Follow courses or add friends with one tap.',
            skipIfHidden: true
        },
        {
            targets: ['#streams > .section-heading', '#streams .section-heading'],
            title: 'Live course directory',
            text: 'Browse every course on LiveView. Cards marked “Live now” are broadcasting right now.'
        },
        {
            targets: ['#streams .filter-section', '.filter-section'],
            title: 'Search & filter',
            text: 'Search by course name or city, pick a state, or reset filters. Your city is pre-filled when you first arrive.'
        },
        {
            targets: ['#card-grid .card:first-child', '#card-grid .card', '#card-grid'],
            title: 'Watch a course',
            text: 'Tap any course card to open its stream page, watch live video, and follow courses you like.'
        },
        {
            targets: ['#messagesLink:not([hidden])', '#messagesLink'],
            title: 'Messages',
            text: 'Open your inbox to read and send direct messages with golfers and courses you connect with.',
            skipIfHidden: true
        },
        {
            targets: ['#notifBell:not([hidden])', '#notifBell'],
            title: 'Notifications',
            text: 'The bell shows friend requests, invites, and activity. Tap to open your notification panel.',
            skipIfHidden: true
        },
        {
            targets: ['#groupsLink:not([hidden])', '#groupsLink'],
            title: 'Friends & groups',
            text: 'Find your friends list, pending requests, and golf groups from the groups tab in the header.',
            skipIfHidden: true
        },
        {
            targets: ['#profileBarLink', '#profile-menu-link', '.header-actions'],
            title: 'Your profile',
            text: 'Open your profile from here to manage favorites, friends, and pending friend requests.'
        },
        {
            targets: ['.desktop-nav', '.menu-button', '.sticky-header .top-bar'],
            title: 'Site navigation',
            text: 'Use the menu to jump between live streams, course info, and contact.'
        }
    ];

    let steps = [];
    let index = 0;
    let cardEl = null;
    let focusedEl = null;
    let repositionTimer = null;
    let activeUserId = null;

    function tourStorageKey(userId) {
        if (!userId) return LEGACY_TOUR_KEY;
        return `liveviewSiteTourDone:${userId}`;
    }

    function isTourDone(userId) {
        if (!userId) {
            return localStorage.getItem(LEGACY_TOUR_KEY) === '1';
        }
        const key = tourStorageKey(userId);
        if (localStorage.getItem(key) === '1') return true;
        if (localStorage.getItem(LEGACY_TOUR_KEY) === '1') {
            localStorage.setItem(key, '1');
            return true;
        }
        return false;
    }

    function markTourDone(userId) {
        if (userId) {
            localStorage.setItem(tourStorageKey(userId), '1');
        }
        localStorage.setItem(LEGACY_TOUR_KEY, '1');
    }

    function clearTourDone(userId) {
        if (userId) {
            localStorage.removeItem(tourStorageKey(userId));
        }
        localStorage.removeItem(LEGACY_TOUR_KEY);
    }

    function stripWelcomeFromUrl() {
        const url = new URL(window.location.href);
        if (!url.searchParams.has('welcome')) return;
        url.searchParams.delete('welcome');
        const next = `${url.pathname}${url.search}${url.hash}`;
        window.history.replaceState({}, '', next);
    }

    function tourDisabled() {
        if (window.self !== window.top) return true;
        const params = new URLSearchParams(window.location.search);
        return params.get('notour') === '1' || params.get('tour') === '0';
    }

    function isElementVisible(el) {
        if (!el) return false;
        if (el.hidden || el.getAttribute('hidden') !== null) return false;
        if (el.offsetParent === null && el.tagName !== 'BODY' && el.tagName !== 'HTML') {
            const style = window.getComputedStyle(el);
            if (style.position !== 'fixed' && style.position !== 'sticky') return false;
        }
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
            return false;
        }
        if (el.style.display === 'none') return false;
        const rect = el.getBoundingClientRect();
        return rect.width >= 2 && rect.height >= 2;
    }

    function resolveTarget(selectors) {
        const list = Array.isArray(selectors) ? selectors : [selectors];
        for (const selector of list) {
            const nodes = document.querySelectorAll(selector);
            for (const el of nodes) {
                if (isElementVisible(el)) return el;
            }
        }
        return null;
    }

    function buildSteps() {
        return STEP_DEFS.filter((step) => {
            if (!step.skipIfHidden) return true;
            return Boolean(resolveTarget(step.targets));
        });
    }

    function clearFocus() {
        if (focusedEl) {
            focusedEl.classList.remove('site-tour-focus');
            focusedEl = null;
        }
    }

    function positionTooltip(targetRect) {
        if (!cardEl) return;

        const margin = 16;
        const cardRect = cardEl.getBoundingClientRect();
        const viewportH = window.innerHeight;
        const viewportW = window.innerWidth;

        let top = targetRect.bottom + margin;
        let left = Math.max(margin, targetRect.left);

        if (top + cardRect.height > viewportH - margin) {
            top = Math.max(margin, targetRect.top - cardRect.height - margin);
        }

        if (left + cardRect.width > viewportW - margin) {
            left = Math.max(margin, viewportW - cardRect.width - margin);
        }

        cardEl.style.top = `${top}px`;
        cardEl.style.left = `${left}px`;
        cardEl.style.bottom = 'auto';
        cardEl.style.right = 'auto';
        cardEl.style.transform = 'none';
    }

    function updatePositions() {
        const step = steps[index];
        if (!step) return;

        const target = resolveTarget(step.targets);
        if (!target) return;

        positionTooltip(target.getBoundingClientRect());
    }

    function positionStep() {
        const step = steps[index];
        const target = resolveTarget(step?.targets);

        clearFocus();

        if (!target) return;

        target.classList.add('site-tour-focus');
        focusedEl = target;

        target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });

        updatePositions();
        window.setTimeout(updatePositions, 120);
        window.setTimeout(updatePositions, 350);
        window.setTimeout(updatePositions, 650);
    }

    function renderStep() {
        const step = steps[index];
        if (!step) return;

        document.getElementById('siteTourStep').textContent = `Step ${index + 1} of ${steps.length}`;
        document.getElementById('siteTourTitle').textContent = step.title;
        document.getElementById('siteTourText').textContent = step.text;
        document.getElementById('siteTourNext').textContent =
            index === steps.length - 1 ? 'Got it!' : 'Next';

        positionStep();
    }

    function scheduleReposition() {
        if (repositionTimer) window.clearTimeout(repositionTimer);
        repositionTimer = window.setTimeout(updatePositions, 60);
    }

    function ensureCard() {
        if (document.getElementById('siteTourCard')) {
            cardEl = document.getElementById('siteTourCard');
            return;
        }

        cardEl = document.createElement('div');
        cardEl.id = 'siteTourCard';
        cardEl.className = 'site-tour-card';
        cardEl.setAttribute('role', 'dialog');
        cardEl.setAttribute('aria-labelledby', 'siteTourTitle');
        cardEl.innerHTML = `
            <p class="site-tour-step" id="siteTourStep"></p>
            <h3 id="siteTourTitle"></h3>
            <p id="siteTourText"></p>
            <div class="site-tour-actions">
                <button type="button" class="btn-tour-ghost" id="siteTourSkip">Skip tour</button>
                <button type="button" class="btn-tour-primary" id="siteTourNext">Next</button>
            </div>
        `;
        document.body.appendChild(cardEl);

        document.getElementById('siteTourSkip').addEventListener('click', endTour);
        document.getElementById('siteTourNext').addEventListener('click', nextStep);

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && document.body.classList.contains('site-tour-active')) {
                endTour();
            }
        });

        window.addEventListener('resize', scheduleReposition);
        window.addEventListener('scroll', scheduleReposition, true);
        if ('onscrollend' in window) {
            window.addEventListener('scrollend', scheduleReposition, true);
        }
    }

    function nextStep() {
        if (index < steps.length - 1) {
            index += 1;
            renderStep();
            return;
        }
        endTour();
    }

    function endTour() {
        markTourDone(activeUserId);
        stripWelcomeFromUrl();
        clearFocus();
        window.removeEventListener('resize', scheduleReposition);
        window.removeEventListener('scroll', scheduleReposition, true);
        if ('onscrollend' in window) {
            window.removeEventListener('scrollend', scheduleReposition, true);
        }
        if (repositionTimer) window.clearTimeout(repositionTimer);
        cardEl?.remove();
        cardEl = null;
        document.body.classList.remove('site-tour-active');
    }

    function shouldStartTour(userId, force = false) {
        if (force) return true;
        if (isTourDone(userId)) {
            stripWelcomeFromUrl();
            return false;
        }
        const params = new URLSearchParams(window.location.search);
        if (params.get('welcome') === '1') return true;
        return false;
    }

    function waitForCards(maxMs = 4000) {
        return new Promise((resolve) => {
            const start = Date.now();
            const check = () => {
                if (document.querySelector('#card-grid .card')) {
                    resolve();
                    return;
                }
                if (Date.now() - start >= maxMs) {
                    resolve();
                    return;
                }
                window.setTimeout(check, 120);
            };
            check();
        });
    }

    async function startSiteTour(options = {}) {
        const force = options === true || options.force === true;
        const userId = options.userId || options.id || null;
        activeUserId = userId;

        if (tourDisabled()) return;
        if (!force && !shouldStartTour(userId, false)) return;

        await waitForCards();

        steps = buildSteps();
        if (!steps.length) return;

        ensureCard();
        document.body.classList.add('site-tour-active');
        index = 0;
        renderStep();
    }

    window.LiveViewSiteTour = {
        startSiteTour,
        endTour,
        clearTourDone,
        isTourDone
    };
})();
