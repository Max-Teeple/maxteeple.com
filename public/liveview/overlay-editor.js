(function () {
    const root = document.getElementById('overlayEditor');
    if (!root) return;
    const params = new URLSearchParams(window.location.search);
    const userId = params.get('id');
    const apiBase = window.config?.apiBaseUrl || window.location.origin;
    let state = null;
    let handle = null;
    let tee = 'white';
    let editingHole = 1;

    function headers(extra) {
        const token = localStorage.getItem('liveviewToken');
        return Object.assign(token ? { Authorization: `Bearer ${token}` } : {}, extra || {});
    }

    function holeByNumber(n) {
        return (state.holes || []).find((hole) => Number(hole.hole_number) === Number(n));
    }

    function readHoleForm(number) {
        const n = Number(number || document.getElementById('overlayHole').value);
        const hole = holeByNumber(n) || { hole_number: n, yardage: {}, template: state.template };
        hole.par = Number(document.getElementById('overlayPar').value) || null;
        hole.yardage = hole.yardage || {};
        ['black', 'blue', 'white', 'red'].forEach((name) => {
            const value = Number(document.getElementById(`yards-${name}`).value);
            if (value) hole.yardage[name] = value;
        });
        hole.image_url = document.getElementById('overlayHoleImage').value.trim() || null;
        hole.template = state.template;
        if (!holeByNumber(n)) state.holes.push(hole);
    }

    function writeHoleForm() {
        const hole = holeByNumber(document.getElementById('overlayHole').value) || {};
        document.getElementById('overlayPar').value = hole.par || '';
        ['black', 'blue', 'white', 'red'].forEach((name) => {
            document.getElementById(`yards-${name}`).value = hole.yardage?.[name] || '';
        });
        document.getElementById('overlayHoleImage').value = hole.image_url || '';
    }

    function readForm() {
        readHoleForm();
        const template = document.getElementById('overlayTemplate').value;
        if (template !== state.template && window.LiveViewOverlay.TEMPLATES[template]) {
            state.positions = JSON.parse(JSON.stringify(window.LiveViewOverlay.TEMPLATES[template].positions));
            const shows = window.LiveViewOverlay.TEMPLATES[template].shows;
            Object.keys(shows).forEach((key) => {
                const box = document.querySelector(`[data-show="${key}"]`);
                if (box) box.checked = Boolean(shows[key]);
            });
        }
        state.template = template;
        state.theme = {
            background: document.getElementById('overlayBg').value,
            text: document.getElementById('overlayText').value,
            accent: document.getElementById('overlayAccent').value
        };
        state.opacity = Number(document.getElementById('overlayOpacity').value);
        state.ticker_text = document.getElementById('overlayTicker').value;
        state.sponsor_logo = document.getElementById('overlaySponsor').value.trim() || state.sponsor_logo;
        state.current_hole = Number(document.getElementById('overlayHole').value);
        state.viewer_enabled = document.getElementById('overlayViewers').checked;
        state.show_logo = document.querySelector('[data-show="logo"]').checked;
        state.show_name = document.querySelector('[data-show="name"]').checked;
        state.show_hole = document.querySelector('[data-show="hole"]').checked;
        state.show_par = document.querySelector('[data-show="par"]').checked;
        state.show_yardage = document.querySelector('[data-show="yardage"]').checked;
        state.show_sponsor = document.querySelector('[data-show="sponsor"]').checked;
        state.show_ticker = document.querySelector('[data-show="ticker"]').checked;
        state.holes.forEach((hole) => {
            if (!hole.template) hole.template = state.template;
        });
    }

    function previewPayload() {
        return Object.assign({}, state, {
            courseName: state.courseName,
            courseLogo: state.courseLogo
        });
    }

    function draw() {
        const stage = document.getElementById('overlayStage');
        if (!handle) {
            handle = window.LiveViewOverlay.mount(stage, previewPayload(), {
                editor: true,
                tee,
                onMove(element, position) {
                    state.positions = state.positions || {};
                    state.positions[element] = position;
                    const select = document.querySelector(`[data-pos="${element}"]`);
                    if (select) select.value = 'custom';
                }
            });
            document.getElementById('overlayStage').querySelector('.lv-overlay-root')?.classList.add('is-editor');
        } else {
            handle.update(previewPayload());
            handle.setTee(tee);
        }
    }

    function fill() {
        document.getElementById('overlayTemplate').value = state.template || 'lower-third';
        document.getElementById('overlayBg').value = state.theme?.background || '#111318';
        document.getElementById('overlayText').value = state.theme?.text || '#f7f2ea';
        document.getElementById('overlayAccent').value = state.theme?.accent || '#ff4d18';
        document.getElementById('overlayOpacity').value = state.opacity || 0.94;
        document.getElementById('overlayTicker').value = state.ticker_text || '';
        document.getElementById('overlaySponsor').value = state.sponsor_logo || '';
        document.getElementById('overlayViewers').checked = state.viewer_enabled !== false;
        ['logo', 'name', 'hole', 'par', 'yardage', 'sponsor', 'ticker'].forEach((key) => {
            const box = document.querySelector(`[data-show="${key}"]`);
            if (box) box.checked = state[`show_${key}`] !== false && (key === 'sponsor' || key === 'ticker' ? Boolean(state[`show_${key}`]) : state[`show_${key}`] !== false);
        });
        document.querySelector('[data-show="sponsor"]').checked = Boolean(state.show_sponsor);
        document.querySelector('[data-show="ticker"]').checked = Boolean(state.show_ticker);
        const holeSelect = document.getElementById('overlayHole');
        holeSelect.innerHTML = '';
        for (let n = 1; n <= 18; n++) {
            const option = document.createElement('option');
            option.value = String(n);
            option.textContent = `Hole ${n}`;
            holeSelect.appendChild(option);
        }
        holeSelect.value = String(state.current_hole || 1);
        editingHole = Number(holeSelect.value);
        ['logo', 'name', 'hole', 'sponsor', 'ticker'].forEach((element) => {
            const select = document.querySelector(`[data-pos="${element}"]`);
            if (select) select.value = state.positions?.[element]?.preset || 'custom';
        });
        writeHoleForm();
        const video = document.getElementById('overlayPreviewVideo');
        const source = state.streamUrl || '/liveview/demo-streams/tee-shot.mp4';
        if (window.LiveViewPlayer?.classify(source)?.type !== 'link') {
            window.LiveViewPlayer.show(video, source);
        } else {
            video.src = '/liveview/demo-streams/tee-shot.mp4';
            video.loop = true;
            video.muted = true;
            video.play().catch(() => {});
        }
        draw();
    }

    async function load() {
        const me = await fetch(`${apiBase}/me`, { headers: headers() }).then((res) => res.json());
        if (!me.success || me.user.role !== 'course_owner' || String(me.user.id) !== String(userId)) return;
        root.hidden = false;
        const profile = await fetch(`${apiBase}/profile/${userId}`, { headers: headers() }).then((res) => res.json());
        const data = await fetch(`${apiBase}/courses/${userId}/overlay`).then((res) => res.json());
        const overlay = data.overlay || {
            template: 'lower-third',
            theme: { background: '#111318', text: '#f7f2ea', accent: '#ff4d18' },
            positions: window.LiveViewOverlay.TEMPLATES['lower-third'].positions,
            show_logo: true,
            show_name: true,
            show_hole: true,
            show_par: true,
            show_yardage: true,
            show_sponsor: false,
            show_ticker: true,
            opacity: 0.94,
            ticker_text: '',
            current_hole: 1,
            viewer_enabled: true,
            holes: []
        };
        if (!overlay.holes?.length) {
            overlay.holes = Array.from({ length: 18 }, (_, index) => ({
                hole_number: index + 1,
                par: 4,
                yardage: { black: 410, blue: 390, white: 365, red: 320 },
                template: overlay.template
            }));
        }
        state = Object.assign(overlay, {
            courseName: data.course?.name || profile.user?.name || '',
            courseLogo: data.course?.logo || '',
            streamUrl: profile.user?.stream_url || ''
        });
        fill();
    }

    root.addEventListener('change', (event) => {
        if (event.target.id === 'overlayHole') {
            readHoleForm(editingHole);
            editingHole = Number(event.target.value);
            state.current_hole = editingHole;
            writeHoleForm();
        }
        if (event.target.dataset.pos && window.LiveViewOverlay.PRESETS[event.target.value]) {
            state.positions = state.positions || {};
            state.positions[event.target.dataset.pos] = Object.assign({ preset: event.target.value }, window.LiveViewOverlay.PRESETS[event.target.value]);
        }
        if (event.target.id === 'overlayTee') tee = event.target.value;
        if (event.target.id !== 'overlayHole') readForm();
        draw();
    });

    document.getElementById('applyOverlayTemplate')?.addEventListener('click', () => {
        readForm();
        state.holes.forEach((hole) => { hole.template = state.template; });
        document.getElementById('overlayStatus').textContent = 'Template marked on all 18 holes. Save to keep it.';
        draw();
    });

    document.getElementById('saveOverlay')?.addEventListener('click', async () => {
        const status = document.getElementById('overlayStatus');
        status.textContent = 'Saving overlay…';
        try {
            readForm();
            const response = await fetch(`${apiBase}/profile/${userId}/overlay`, {
                method: 'PUT',
                headers: headers({ 'Content-Type': 'application/json' }),
                body: JSON.stringify(state)
            });
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.message || 'Save failed');
            state = Object.assign(data.overlay, {
                courseName: state.courseName,
                courseLogo: state.courseLogo,
                streamUrl: state.streamUrl
            });
            status.textContent = 'Overlay saved. Viewers on the course page, replays, and the watch party will see it.';
            draw();
        } catch (error) {
            status.textContent = error.message;
        }
    });

    document.getElementById('overlaySponsorFile')?.addEventListener('change', async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        const body = new FormData();
        body.append('sponsor_logo', file);
        const response = await fetch(`${apiBase}/profile/${userId}/images`, { method: 'PUT', headers: headers(), body });
        const data = await response.json();
        if (data.success) {
            const fresh = await fetch(`${apiBase}/courses/${userId}/overlay`).then((res) => res.json());
            state.sponsor_logo = fresh.overlay?.sponsor_logo || state.sponsor_logo;
            state.show_sponsor = true;
            document.getElementById('overlaySponsor').value = state.sponsor_logo || '';
            document.querySelector('[data-show="sponsor"]').checked = true;
            draw();
        }
    });

    load().catch((error) => {
        const status = document.getElementById('overlayStatus');
        if (status) status.textContent = error.message;
    });
})();
