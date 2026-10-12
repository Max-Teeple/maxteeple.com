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

    function place(node, position) {
        const x = Number(position?.x);
        const y = Number(position?.y);
        node.style.left = `${Number.isFinite(x) ? x : 3}%`;
        node.style.top = `${Number.isFinite(y) ? y : 4}%`;
    }

    function mount(stage, payload, options) {
        const opts = options || {};
        let tee = opts.tee || 'white';
        let overlay = payload;
        const root = stage.querySelector('.lv-overlay-root') || document.createElement('div');
        root.className = 'lv-overlay-root';
        if (!root.parentElement) stage.appendChild(root);

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
            root.style.opacity = String(overlay.opacity || 0.94);
            root.dataset.template = layout.templateId;
            const theme = layout.theme;

            function chip(key, node) {
                if (!layout.shows[key]) return;
                node.classList.add('lv-overlay-chip', `lv-overlay-${key}`);
                node.style.background = theme.background;
                node.style.color = theme.text;
                node.style.borderColor = theme.accent;
                place(node, layout.positions[key] || {});
                if (opts.editor) {
                    node.dataset.element = key;
                    node.classList.add('is-draggable');
                }
                root.appendChild(node);
            }

            if (overlay.courseLogo || payload.courseLogo) {
                const logo = document.createElement('img');
                logo.alt = '';
                logo.src = overlay.courseLogo || payload.courseLogo;
                chip('logo', logo);
            }
            const name = document.createElement('div');
            name.appendChild(text(overlay.courseName || ''));
            chip('name', name);

            const holeLine = document.createElement('div');
            const bits = [];
            if (layout.shows.hole && hole) bits.push(`Hole ${hole.hole_number}`);
            if (layout.shows.par && hole?.par) bits.push(`Par ${hole.par}`);
            if (layout.shows.yardage && yards) bits.push(`${yards} ${tee}`);
            holeLine.appendChild(text(bits.join(' · ') || 'Hole'));
            if (hole?.image_url) {
                const img = document.createElement('img');
                img.alt = '';
                img.src = hole.image_url;
                img.className = 'lv-hole-thumb';
                holeLine.appendChild(img);
            }
            chip('hole', holeLine);

            if (overlay.sponsor_logo) {
                const sponsor = document.createElement('img');
                sponsor.alt = 'Sponsor';
                sponsor.src = overlay.sponsor_logo;
                chip('sponsor', sponsor);
            }
            const ticker = document.createElement('div');
            ticker.appendChild(text(overlay.ticker_text || ''));
            chip('ticker', ticker);
        }

        function onPointerDown(event) {
            const chip = event.target.closest('.is-draggable');
            if (!chip || !opts.editor) return;
            event.preventDefault();
            const rect = stage.getBoundingClientRect();
            function move(ev) {
                const x = Math.min(92, Math.max(0, ((ev.clientX - rect.left) / rect.width) * 100));
                const y = Math.min(92, Math.max(0, ((ev.clientY - rect.top) / rect.height) * 100));
                chip.style.left = `${x}%`;
                chip.style.top = `${y}%`;
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

    return { TEMPLATES, PRESETS, mount, currentHole };
})();
