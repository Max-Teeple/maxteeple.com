(function () {
    const email = window.LIVEVIEW_HELP_EMAIL || 'max.teeple@gmail.com';

    document.querySelectorAll('[data-help-mail]').forEach((link) => {
        const subject = link.getAttribute('data-subject') || 'LiveView course setup';
        link.href = `mailto:${email}?subject=${encodeURIComponent(subject)}`;
    });

    document.querySelectorAll('.help-tip > button').forEach((button) => {
        button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const tip = button.parentElement;
            const open = tip.classList.contains('is-open');
            document.querySelectorAll('.help-tip.is-open').forEach((el) => el.classList.remove('is-open'));
            if (!open) tip.classList.add('is-open');
        });
    });

    document.addEventListener('click', () => {
        document.querySelectorAll('.help-tip.is-open').forEach((el) => el.classList.remove('is-open'));
    });

    function apiBase() {
        return window.LiveViewAuth?.getApiBaseUrl?.()
            || window.config?.apiBaseUrl
            || window.location.origin;
    }

    async function submitInstallRequest(form) {
        const data = Object.fromEntries(new FormData(form).entries());
        const headers = { 'Content-Type': 'application/json' };
        const token = localStorage.getItem('liveviewToken');
        if (token) headers.Authorization = `Bearer ${token}`;
        const response = await fetch(`${apiBase()}/install-requests`, {
            method: 'POST',
            headers,
            body: JSON.stringify(data)
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok || !body.success) {
            throw new Error(body.message || 'Could not send the install request');
        }
        return body;
    }

    window.LiveViewInstall = { submit: submitInstallRequest, email };
})();
