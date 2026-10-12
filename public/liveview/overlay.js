window.LiveViewOverlay = (function () {
    const TEMPLATES = {
        'lower-third': {
            label: 'Broadcast lower-third',
            shows: { logo: true, name: true, hole: true, par: true, yardage: true, sponsor: false, ticker: true },
            positions: {
                logo: { preset: 'bottom-left', x: 3, y: 72 },
                name: { preset: 'bottom-left', x: 16, y: 70 },
                hole: { preset: 'bottom-left', x: 16, y: 82 },
                sponsor: { preset: 'bottom-right', x: 68, y: 72 },
                ticker: { preset: 'bottom-center', x: 3, y: 92 }
            }
        },
        'corner-bug': {
            label: 'Minimal corner bug',
            shows: { logo: true, name: false, hole: true, par: true, yardage: true, sponsor: false, ticker: false },
            positions: {
                logo: { preset: 'top-left', x: 3, y: 4 },
                name: { preset: 'top-left', x: 14, y: 5 },
                hole: { preset: 'top-left', x: 3, y: 16 },
                sponsor: { preset: 'top-right', x: 68, y: 4 },
                ticker: { preset: 'bottom-center', x: 3, y: 90 }
            }
        }
    };

    const PRESETS = {
        'top-left': { x: 3, y: 4 },
        'top-right': { x: 68, y: 4 },
        'bottom-left': { x: 3, y: 72 },
        'bottom-center': { x: 28, y: 76 },
        'bottom-right': { x: 68, y: 72 }
    };

    function text(value) {
        return document.createTextNode(value == null ? '' : String(value));
    }

    function currentHole(overlay) {
        const holes = overlay?.holes || [];
        return holes.find((hole) => Number(hole.hole_number) === Number(overlay.current_hole)) || holes[0] || null;
    }

    function layoutFor(overlay) {
        const hole = currentHole(overlay);
        const templateId = (hole && hole.template) || overlay.template || 'lower-third';
        const template = TEMPLATES[templateId] || TEMPLATES['lower-third'];
        const same = (overlay.template || 'lower-third') === templateId;
        return {
            templateId,
            shows: {
                logo: overlay.show_logo !== false,
                name: overlay.show_name !== false,
                hole: overlay.show_hole !== false,
                par: overlay.show_par !== false,
                yardage: overlay.show_yardage !== false,
                sponsor: Boolean(overlay.show_sponsor),
                ticker: Boolean(overlay.show_ticker)
            },
            positions: same && overlay.positions ? overlay.positions : template.positions,
            theme: overlay.theme || { background: '#111318', text: '#f7f2ea', accent: '#ff4d18' }
        };
    }

    function place(node, position, edge) {
        const gutter = edge || '16px';
        const x = Number(position?.x);
        const y = Number(position?.y);
        const left = Number.isFinite(x) ? x : 3;
        const top = Number.isFinite(y) ? y : 72;
        node.style.left = `max(${gutter}, ${left}%)`;
        if (top >= 55) {
            node.style.top = 'auto';
            node.style.bottom = `max(${gutter}, ${Math.max(0, 100 - top)}%)`;
        } else {
            node.style.bottom = 'auto';
            node.style.top = `max(${gutter}, ${top}%)`;
        }
    }

    function mount(stage, payload, options) {
        const opts = options || {};
        let tee = opts.tee || 'white';
        let overlay = payload;
        let lastHole = null;
        const root = stage.querySelector('.lv-overlay-root') || document.createElement('div');
        root.className = 'lv-overlay-root';
        if (!root.parentElement) stage.appendChild(root);
        ensureBrand(stage, opts.tv);

        function draw() {
            root.replaceChildren();
            if (!overlay || overlay.viewer_enabled === false && !opts.editor) {
                root.hidden = true;
                return;
            }
            root.hidden = false;
            const layout = layoutFor(overlay);
            const hole = currentHole(overlay);
            const yards = hole?.yardage?.[tee];
            const theme = layout.theme;
            root.style.setProperty('--lv-plate', theme.background || '#111318');
            root.style.setProperty('--lv-ink', theme.text || '#f7f2ea');
            root.style.setProperty('--lv-accent', theme.accent || '#ff4d18');
            root.style.opacity = String(overlay.opacity || 0.94);
            root.dataset.template = layout.templateId;

            const plate = document.createElement('div');
            plate.className = layout.templateId === 'corner-bug' ? 'lv-plate lv-bug' : 'lv-plate lv-lower';
            const anchor = layout.templateId === 'corner-bug' ? layout.positions.logo : layout.positions.hole;
            place(plate, anchor || {}, opts.tv ? '4vw' : '16px');
            if (opts.editor) {
                plate.dataset.element = layout.templateId === 'corner-bug' ? 'logo' : 'hole';
                plate.classList.add('is-draggable');
            }

            const row = document.createElement('div');
            row.className = 'lv-plate-row';

            if (layout.shows.logo && (overlay.courseLogo || payload.courseLogo)) {
                const badge = document.createElement('span');
                badge.className = 'lv-logo-badge';
                const logo = document.createElement('img');
                logo.alt = '';
                logo.src = overlay.courseLogo || payload.courseLogo;
                badge.appendChild(logo);
                row.appendChild(badge);
            }

            const copy = document.createElement('div');
            copy.className = 'lv-plate-copy';
            if (layout.shows.name && layout.templateId !== 'corner-bug') {
                const name = document.createElement('p');
                name.className = 'lv-course-name';
                name.appendChild(text(overlay.courseName || ''));
                copy.appendChild(name);
            }
            const meta = document.createElement('p');
            meta.className = 'lv-hole-meta';
            const bits = [];
            if (layout.shows.hole && hole) bits.push(`Hole ${hole.hole_number}`);
            if (layout.shows.par && hole?.par) bits.push(`Par ${hole.par}`);
            if (layout.shows.yardage && yards) bits.push(`${yards} ${tee}`);
            meta.appendChild(text(bits.join('  ·  ')));
            if (lastHole !== null && hole && Number(lastHole) !== Number(hole.hole_number)) {
                meta.classList.add('lv-slide');
            }
            lastHole = hole ? hole.hole_number : null;
            copy.appendChild(meta);
            row.appendChild(copy);

            if (overlay.isLive !== false) {
                const live = document.createElement('span');
                live.className = 'lv-live-pill';
                const dot = document.createElement('span');
                dot.className = 'lv-live-dot';
                live.appendChild(dot);
                live.appendChild(text('LIVE'));
                row.appendChild(live);
            }

            if (layout.shows.sponsor && overlay.sponsor_logo) {
                const sponsor = document.createElement('img');
                sponsor.className = 'lv-sponsor';
                sponsor.alt = 'Sponsor';
                sponsor.src = overlay.sponsor_logo;
                row.appendChild(sponsor);
            }

            plate.appendChild(row);
            if (layout.shows.ticker && overlay.ticker_text && layout.templateId !== 'corner-bug') {
                const ticker = document.createElement('p');
                ticker.className = 'lv-ticker';
                ticker.appendChild(text(overlay.ticker_text));
                plate.appendChild(ticker);
            }
            root.appendChild(plate);
        }

        function onPointerDown(event) {
            const chip = event.target.closest('.is-draggable');
            if (!chip || !opts.editor) return;
            event.preventDefault();
            const rect = stage.getBoundingClientRect();
            function move(ev) {
                const x = Math.min(92, Math.max(0, ((ev.clientX - rect.left) / rect.width) * 100));
                const y = Math.min(92, Math.max(0, ((ev.clientY - rect.top) / rect.height) * 100));
                chip.style.left = `max(16px, ${x}%)`;
                chip.style.top = `max(16px, ${y}%)`;
                chip.style.bottom = 'auto';
                chip.style.right = 'auto';
                if (opts.onMove) opts.onMove(chip.dataset.element, { preset: 'custom', x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
            }
            function up() {
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
            }
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
        }
        if (opts.editor) root.addEventListener('pointerdown', onPointerDown);

        draw();
        return {
            update(next) {
                overlay = next;
                draw();
            },
            setTee(next) {
                tee = next || 'white';
                draw();
            },
            destroy() {
                root.removeEventListener('pointerdown', onPointerDown);
                root.remove();
            }
        };
    }

    function ensureBrand(stage, tv) {
        if (!stage) return;
        let bug = stage.querySelector(':scope > .lv-brand');
        if (!bug) {
            bug = document.createElement('div');
            bug.className = 'lv-brand';
            bug.setAttribute('aria-hidden', 'true');
            const img = document.createElement('img');
            img.src = '/liveview/images/liveview-logo.svg';
            img.alt = '';
            bug.appendChild(img);
            stage.appendChild(bug);
        }
        bug.classList.toggle('lv-brand-tv', Boolean(tv));
    }

    return { TEMPLATES, PRESETS, mount, currentHole, ensureBrand };
})();
