window.LiveViewDirectory = (function () {
    const { getApiBaseUrl, escapeHtml, initials, fetchJson } = window.LiveViewCore;

    let allCourses = [];
    let page = 1;
    let totalPages = 1;
    let viewMode = 'grid';
    let liveOnly = false;
    let mapInstance = null;
    let clusterLayer = null;
    let debounceTimer = null;

    const { accountImage } = window.LiveViewCore;

    function courseImage(card) {
        return window.LiveViewCore.coursePreviewImage(card);
    }

    function renderSkeletons(grid, count = 6) {
        grid.innerHTML = Array.from({ length: count })
            .map(() => '<article class="card card-skeleton" aria-hidden="true"></article>')
            .join('');
    }

    function renderCard(card, options = {}) {
        const image = courseImage(card);
        const href = card.slug ? `course.html?slug=${encodeURIComponent(card.slug)}` : `course.html?id=${card.id}`;
        const preview = card.is_live && card.hls_url && /\.m3u8/i.test(card.hls_url)
            ? `<video class="card-preview-video" muted loop playsinline preload="none" data-hls="${escapeHtml(card.hls_url)}"></video>`
            : '';
        return `
            <article class="card ${card.is_live ? 'card-live' : ''}" data-course-id="${card.id}">
                <a href="${href}" class="card-link">
                    <div class="card-media ${image ? '' : 'card-media-fallback'}">
                        ${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(card.name)}" loading="lazy" decoding="async">` : `<span>${escapeHtml(initials(card.name))}</span>`}
                        ${preview}
                        <div class="play-button">▶</div>
                    </div>
                    <div class="card-content">
                        <span class="live-badge">${card.is_live ? 'Live now' : 'Course channel'}</span>
                        <h2>${escapeHtml(card.name)}</h2>
                        <p>${escapeHtml(card.city)}, ${escapeHtml(card.state)}</p>
                        <div class="tags">
                            <span>${escapeHtml(card.state)}</span>
                            <span>${card.follower_count || 0} followers</span>
                            ${card.is_demo ? '<span>Demo data</span>' : ''}
                        </div>
                    </div>
                </a>
            </article>
        `;
    }

    function populateCardGrid(grid, cards) {
        if (!cards.length) {
            grid.innerHTML = `<div class="empty-state"><strong>No courses match that search.</strong><span>Try another city, state, or clear filters.</span></div>`;
            return;
        }
        grid.innerHTML = cards.map((c) => renderCard(c)).join('');
        attachCardPreviews(grid);
    }

    function attachCardPreviews(grid) {
        grid.querySelectorAll('.card-preview-video').forEach((video) => {
            const parent = video.closest('.card');
            if (!parent) return;
            parent.addEventListener('mouseenter', () => {
                const url = video.dataset.hls;
                if (!url || video.dataset.loaded) return;
                if (window.Hls && Hls.isSupported()) {
                    const hls = new Hls();
                    hls.loadSource(url);
                    hls.attachMedia(video);
                } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                    video.src = url;
                }
                video.dataset.loaded = '1';
                video.play().catch(() => {});
            });
            parent.addEventListener('mouseleave', () => {
                video.pause();
            });
        });
    }

    function renderLiveLane(courses) {
        const lane = document.getElementById('liveNowLane');
        const track = document.getElementById('liveNowTrack');
        if (!lane || !track) return;
        const live = courses.filter((c) => c.is_live);
        if (!live.length) {
            lane.hidden = true;
            return;
        }
        lane.hidden = false;
        track.innerHTML = live.map((c) => renderCard(c)).join('');
        attachCardPreviews(track);
    }

    async function fetchPage(params) {
        const qs = new URLSearchParams(params);
        const data = await fetchJson(`${getApiBaseUrl()}/courses?${qs}`);
        if (data.notModified) return null;
        return data;
    }

    async function loadAllCoursesForFilters() {
        const data = await fetchPage({ page: 1, limit: 48 });
        let courses = data.courses || [];
        if (data.totalPages > 1) {
            for (let p = 2; p <= Math.min(data.totalPages, 5); p++) {
                const more = await fetchPage({ page: p, limit: 48 });
                courses = courses.concat(more.courses || []);
            }
        }
        const banner = document.getElementById('demoDataBanner');
        if (banner) banner.hidden = !courses.some((course) => course.is_demo);
        return courses;
    }

    function populateStateDropdown(stateFilter, cards) {
        const selected = stateFilter.value;
        const states = Array.from(new Set(cards.map((c) => c.state).filter(Boolean))).sort();
        stateFilter.innerHTML = '<option value="">All states</option>';
        states.forEach((state) => {
            const option = document.createElement('option');
            option.value = state;
            option.textContent = state;
            stateFilter.appendChild(option);
        });
        stateFilter.value = selected;
    }

    function filterLocal(cards, searchBox, stateFilter) {
        const term = searchBox.value.trim().toLowerCase();
        const state = stateFilter.value;
        return cards.filter((card) => {
            const hay = `${card.name} ${card.city} ${card.state} ${card.street_address || ''}`.toLowerCase();
            const matchSearch = !term || hay.includes(term);
            const matchState = !state || card.state === state;
            const matchLive = !liveOnly || card.is_live;
            return matchSearch && matchState && matchLive;
        });
    }

    function clusterSize(count) {
        if (count < 3) return 28;
        if (count < 6) return 36;
        if (count < 12) return 44;
        if (count < 24) return 52;
        return 60;
    }

    function buildCoursePopup(course) {
        const href = course.slug
            ? `course.html?slug=${encodeURIComponent(course.slug)}`
            : `course.html?id=${course.id}`;
        const addressLine = course.street_address
            ? `<br><small>${escapeHtml(course.street_address)}</small>`
            : '';
        const liveLine = course.is_live ? '<br><span style="color:#ff4d18;font-weight:700">● Live now</span>' : '';
        return `<strong>${escapeHtml(course.name)}</strong><br>${escapeHtml(course.city)}, ${escapeHtml(course.state)}${addressLine}${liveLine}<br><a href="${href}">View course</a>`;
    }

    function createCourseMarker(course) {
        const marker = L.circleMarker([course.latitude, course.longitude], {
            radius: 9,
            fillColor: '#ff4d18',
            color: '#ffffff',
            weight: 2,
            opacity: 1,
            fillOpacity: 0.92
        });
        marker.bindPopup(buildCoursePopup(course));
        marker.courseData = course;
        return marker;
    }

    async function initMap(courses) {
        const mapEl = document.getElementById('courseMap');
        if (!mapEl || !window.L) return;

        const mappable = courses.filter((c) => c.latitude != null && c.longitude != null);
        if (mapInstance) {
            mapInstance.remove();
            mapInstance = null;
            clusterLayer = null;
        }

        mapInstance = L.map(mapEl).setView([39.5, -98.35], 4);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap'
        }).addTo(mapInstance);

        if (!mappable.length) {
            return;
        }

        if (window.L.markerClusterGroup) {
            clusterLayer = L.markerClusterGroup({
                maxClusterRadius: 55,
                spiderfyOnMaxZoom: true,
                showCoverageOnHover: false,
                zoomToBoundsOnClick: true,
                iconCreateFunction(cluster) {
                    const count = cluster.getChildCount();
                    const size = clusterSize(count);
                    return L.divIcon({
                        html: `<div class="lv-map-cluster" style="width:${size}px;height:${size}px;line-height:${size}px"><span>${count}</span></div>`,
                        className: 'lv-map-cluster-wrap',
                        iconSize: L.point(size, size)
                    });
                }
            });

            mappable.forEach((course) => {
                clusterLayer.addLayer(createCourseMarker(course));
            });
            mapInstance.addLayer(clusterLayer);

            if (mappable.length === 1) {
                mapInstance.setView([mappable[0].latitude, mappable[0].longitude], 11);
            } else {
                mapInstance.fitBounds(clusterLayer.getBounds().pad(0.12));
            }
        } else {
            mappable.forEach((course) => {
                createCourseMarker(course).addTo(mapInstance);
            });
            const bounds = L.latLngBounds(mappable.map((c) => [c.latitude, c.longitude]));
            mapInstance.fitBounds(bounds.pad(0.12));
        }

        window.setTimeout(() => mapInstance?.invalidateSize(), 120);
    }

    function setView(mode) {
        viewMode = mode;
        document.querySelectorAll('[data-view]').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.view === mode);
        });
        const grid = document.getElementById('card-grid');
        const mapWrap = document.getElementById('mapView');
        if (grid) grid.style.display = mode === 'grid' ? '' : 'none';
        if (mapWrap) mapWrap.hidden = mode !== 'map';
        if (mode === 'map' && mapInstance) {
            window.setTimeout(() => mapInstance.invalidateSize(), 80);
        }
    }

    async function setup(user) {
        const cardGrid = document.getElementById('card-grid');
        const searchBox = document.getElementById('search-box');
        const stateFilter = document.getElementById('state-filter');
        const resetFilters = document.getElementById('reset-filters');
        const loadMoreBtn = document.getElementById('loadMoreCourses');
        if (!cardGrid || !searchBox || !stateFilter) return;

        const params = new URLSearchParams(window.location.search);
        if (params.get('welcome') === '1' && user?.city) searchBox.value = user.city;
        if (user?.state) stateFilter.value = user.state;

        renderSkeletons(cardGrid);

        try {
            allCourses = await loadAllCoursesForFilters();
            populateStateDropdown(stateFilter, allCourses);
            renderLiveLane(allCourses);

            function applyFilters() {
                const filtered = filterLocal(allCourses, searchBox, stateFilter);
                page = 1;
                totalPages = Math.ceil(filtered.length / 24) || 1;
                populateCardGrid(cardGrid, filtered.slice(0, 24));
                if (loadMoreBtn) {
                    loadMoreBtn.style.display = filtered.length > 24 ? '' : 'none';
                    loadMoreBtn.dataset.filtered = '1';
                }
                if (viewMode === 'map') initMap(filtered);
            }

            applyFilters();

            searchBox.addEventListener('input', () => {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(applyFilters, 200);
            });
            stateFilter.addEventListener('change', applyFilters);
            resetFilters?.addEventListener('click', () => {
                searchBox.value = '';
                stateFilter.value = '';
                liveOnly = false;
                document.getElementById('filterLiveOnly')?.classList.remove('active');
                populateCardGrid(cardGrid, allCourses.slice(0, 24));
                renderLiveLane(allCourses);
            });

            document.getElementById('filterLiveOnly')?.addEventListener('click', (e) => {
                liveOnly = !liveOnly;
                e.currentTarget.classList.toggle('active', liveOnly);
                applyFilters();
            });

            document.querySelectorAll('[data-view]').forEach((btn) => {
                btn.addEventListener('click', async () => {
                    setView(btn.dataset.view);
                    if (btn.dataset.view === 'map') {
                        await initMap(filterLocal(allCourses, searchBox, stateFilter));
                    }
                });
            });

            loadMoreBtn?.addEventListener('click', () => {
                const filtered = filterLocal(allCourses, searchBox, stateFilter);
                page += 1;
                const slice = filtered.slice(0, page * 24);
                populateCardGrid(cardGrid, slice);
                if (slice.length >= filtered.length) loadMoreBtn.style.display = 'none';
            });
        } catch (error) {
            cardGrid.innerHTML = `<div class="empty-state"><strong>Unable to load courses.</strong><span>${escapeHtml(error.message)}</span></div>`;
        }
    }

    return { setup, renderLiveLane };
})();
