import { EarthMap } from './earth.js';

const App = {
    userData: null,
    balance: 0,
    freeSpins: 0,
    spinHistory: [],
    verifyState: { step: 1, nickname: '', code: '' },
    earthMap: null,
    locationUpdateInterval: null,
    lastNearby: [],
    nearbyLoaded: false,
    appMode: 'active',
    currentLat: null,
    currentLng: null,

    openThreadsUrl(url) {
        if (!url) return;

        const profileMatch = url.match(/threads\.(?:com|net)\/@([^/?#]+)/);
        const intentMatch = url.match(/threads\.(?:com|net)\/intent/);

        if (profileMatch && !intentMatch) {
            const username = profileMatch[1];
            const webUrl = `https://www.threads.com/@${username}`;
            if (window.Telegram?.WebApp?.openLink) {
                window.Telegram.WebApp.openLink(webUrl);
            } else {
                window.open(webUrl, '_blank');
            }
        } else {
            const finalUrl = url.replace('threads.net', 'threads.com');
            if (window.Telegram?.WebApp?.openLink) {
                window.Telegram.WebApp.openLink(finalUrl);
            } else {
                window.open(finalUrl, '_blank');
            }
        }
    },

    async init() {
        if (this._initialized) return;
        this._initialized = true;

        if (!TelegramApp.init()) console.warn('Telegram not available');
        I18n.init();
        this.updateLangButtons();
        document.documentElement.setAttribute('data-theme', 'dark');

        if (document.getElementById('globe-container')) {
            this.earthMap = new EarthMap('globe-container');
        }

        this.currentTab = 'map';
        this.bindEvents();
        this.setupKeyboardDetection();

        await this.loadInitialData();

        if (this.userData && this.userData.app_mode) {
            this.setAppMode(this.userData.app_mode);
        }

        if (this.appMode === 'active') {
            this.startLocationTracking();
        }

        const startParam = TelegramApp.webapp?.initDataUnsafe?.start_param;
        if (startParam === 'nearby') {
            this.switchTab('nearby');
        }

        setTimeout(() => this.hideSplashScreen(), 500);

        setInterval(() => this.loadNearby(true), 300000);
    },

    hideSplashScreen() {
        const splash = document.getElementById('splash-screen');
        const app = document.getElementById('app');
        if (splash) {
            splash.classList.add('fade-out');
            app?.classList.remove('app-loading');
            setTimeout(() => splash.remove(), 800);
        }
    },

    setAppMode(mode) {
        this.appMode = mode;

        const needsOnboarding = this.userData && !this.userData.threads_verified;

        document.getElementById('maintenance-stub').classList.toggle('hidden', mode !== 'maintenance');
        document.getElementById('verification-stub').classList.toggle('hidden', mode !== 'verify_only');
        document.getElementById('onboarding-stub').classList.toggle('hidden', !needsOnboarding || mode === 'maintenance');

        const blockedStub = document.getElementById('blocked-stub');
        if (blockedStub) blockedStub.classList.toggle('hidden', mode !== 'blocked');

        const showContent = mode === 'active' && !needsOnboarding;
        document.getElementById('main-app-content')?.classList.toggle('hidden', !showContent);

        if (mode === 'maintenance' || mode === 'verify_only' || mode === 'blocked' || needsOnboarding) {
            document.querySelector('.clay-nav')?.classList.add('hidden');
        } else {
            document.querySelector('.clay-nav')?.classList.remove('hidden');
        }
    },

    async submitOnboarding() {
        const input = document.getElementById('onboarding-nick-input');
        const btn = document.getElementById('onboarding-submit-btn');
        const errorEl = document.getElementById('onboarding-error');
        const nickname = input.value.trim();

        if (!nickname || nickname.length < 3) {
            if (errorEl) errorEl.textContent = 'Введите корректный никнейм';
            return;
        }

        btn.disabled = true;
        if (errorEl) errorEl.textContent = '';

        try {
            const data = await this.apiRequest('save-nickname', { nickname });
            if (data.success) {
                this.userData.threads_verified = true;
                this.userData.threads_username = nickname.replace(/^@/, '').toLowerCase();
                this.setAppMode(this.appMode);
                this.startLocationTracking();
                this.showToast('Успешно!', 'success');
            } else {
                if (errorEl) errorEl.textContent = data.error || 'Ошибка сохранения';
                btn.disabled = false;
            }
        } catch (e) {
            if (errorEl) errorEl.textContent = 'Ошибка сети';
            btn.disabled = false;
        }
    },

    showToast(message, type = 'info') {
        message = I18n.t(message);
        let container = document.querySelector('.toast-container');
        if (!container) {
            container = document.createElement('div');
            container.className = 'toast-container';
            document.body.appendChild(container);
        }
        const toast = document.createElement('div');
        toast.className = 'toast';

        const icons = {
            success: '<svg class="clay-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>',
            error: '<svg class="clay-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>',
            warning: '<svg class="clay-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#f59e0b" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="8" y1="12" x2="16" y2="12"></line></svg>',
            info: '<svg class="clay-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#3b82f6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>'
        };

        toast.innerHTML = `<span>${icons[type] || icons.info}</span><span>${message}</span>`;
        container.appendChild(toast);
        requestAnimationFrame(() => toast.classList.add('show'));
        TelegramApp.haptic(type === 'error' ? 'error' : 'success');
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    },

    setupKeyboardDetection() {
        if (window.visualViewport) {
            let initialHeight = window.visualViewport.height;
            window.visualViewport.addEventListener('resize', () => {
                const isKeyboard = initialHeight - window.visualViewport.height > 100;
                document.body.classList.toggle('keyboard-open', isKeyboard);
            });
        }
        const inputs = ['INPUT', 'TEXTAREA'];
        document.addEventListener('focusin', (e) => {
            if (inputs.includes(e.target.tagName)) document.body.classList.add('keyboard-open');
        });
        document.addEventListener('focusout', (e) => {
            if (inputs.includes(e.target.tagName)) document.body.classList.remove('keyboard-open');
        });
    },

    bindEvents() {
        document.querySelectorAll('.nav-item').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                this.switchTab(btn.dataset.tab);
            });
        });

        const searchBtn = document.getElementById('search-btn');
        searchBtn?.addEventListener('click', () => {
            if (searchBtn.textContent === 'X') {
                document.getElementById('search-input').value = '';
                document.getElementById('search-result').classList.add('hidden');
                document.getElementById('search-result').innerHTML = '';
                searchBtn.textContent = 'Go';
            } else {
                this.searchUser();
            }
        });

        document.getElementById('search-input')?.addEventListener('input', (e) => {
            const val = e.target.value.trim();
            if (val === '') {
                document.getElementById('search-result').classList.add('hidden');
                document.getElementById('search-result').innerHTML = '';
            }
            if (searchBtn && searchBtn.textContent === 'X' && val !== '') {
                searchBtn.textContent = 'Go';
            }
        });

        document.getElementById('search-input')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') { e.target.blur(); this.searchUser(); }
        });

        document.getElementById('onboarding-submit-btn')?.addEventListener('click', () => this.submitOnboarding());
        document.getElementById('onboarding-nick-input')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') { e.target.blur(); this.submitOnboarding(); }
        });

        document.querySelectorAll('.lang-option').forEach(opt => {
            opt.addEventListener('click', () => {
                I18n.setLanguage(opt.dataset.lang);
                if (this.userData) this.updateProfileUI(this.userData);
                TelegramApp.haptic('impact');
            });
        });

        // Touch feedback
        document.body.addEventListener('touchstart', (e) => {
            const btn = e.target.closest('button, .clay-btn, .clay-icon-btn, .nav-item, .clay-list-item, .modal-close');
            if (btn && !btn.disabled) btn.classList.add('is-active');
        }, { passive: true });

        document.body.addEventListener('touchend', (e) => {
            const btn = e.target.closest('button, .clay-btn, .clay-icon-btn, .nav-item, .clay-list-item, .modal-close');
            if (btn) btn.classList.remove('is-active');

            const isInput = e.target.closest('input, textarea');
            const isInteractive = e.target.closest('button, .clay-btn, .clay-icon-btn, .nav-item, [onclick], a');
            if (!isInput && !isInteractive && document.activeElement &&
                (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) {
                document.activeElement.blur();
            }
        }, { passive: true });

        document.body.addEventListener('touchcancel', () => {
            document.querySelectorAll('.is-active').forEach(el => el.classList.remove('is-active'));
        }, { passive: true });
    },

    switchTab(tabId) {
        TelegramApp.haptic('impact');
        document.activeElement?.blur();
        document.body.classList.remove('keyboard-open');

        document.querySelectorAll('.nav-item').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabId);
        });

        document.querySelectorAll('.tab-content').forEach(tab => {
            const isActive = tab.id === `${tabId}-tab`;
            tab.classList.toggle('active', isActive);
            if (isActive) {
                tab.style.pointerEvents = tabId === 'map' ? 'none' : 'auto';
            }
        });

        this.currentTab = tabId;

        if (tabId === 'nearby') this.loadNearby(!this.nearbyLoaded ? false : true);

        const globeBg = document.getElementById('globe-background');
        if (globeBg) {
            globeBg.style.pointerEvents = tabId === 'map' ? 'auto' : 'none';
        }
    },

    // ============================================
    // GEOLOCATION — полностью переписано
    // ============================================
    startLocationTracking() {
        if (this._geoStarted) return;
        this._geoStarted = true;

        console.log('[GEO] Starting location tracking...');

        const update = (lat, lng, source) => {
            const parsedLat = Number(lat);
            const parsedLng = Number(lng);

            if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)) {
                console.warn(`[GEO] Invalid coordinates from ${source}:`, lat, lng);
                return;
            }

            if (parsedLat === 0 && parsedLng === 0) {
                console.warn(`[GEO] Zero coordinates from ${source}, skipping`);
                return;
            }

            console.log(`[GEO] Got location via ${source}: ${parsedLat}, ${parsedLng}`);
            this.updateUserLocation(parsedLat, parsedLng);
        };

        const tryBrowser = (reason) => {
            console.log(`[GEO] Browser fallback. Reason: ${reason}`);

            if (!navigator.geolocation) {
                console.warn('[GEO] navigator.geolocation not available');
                const locText = document.getElementById('location-text');
                if (locText) locText.textContent = 'Location not supported';
                return;
            }

            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    console.log('[GEO] Browser position received');
                    update(pos.coords.latitude, pos.coords.longitude, 'Browser');
                },
                (err) => {
                    console.error('[GEO] Browser geolocation error:', err.code, err.message);
                    const locText = document.getElementById('location-text');
                    if (locText) locText.textContent = 'Location denied';
                },
                {
                    enableHighAccuracy: true,
                    timeout: 15000,
                    maximumAge: 0
                }
            );
        };

        // Try Telegram LocationManager first
        const T = window.Telegram?.WebApp;
        const lm = T?.LocationManager;

        if (lm && typeof lm.init === 'function' && typeof lm.getLocation === 'function' && T?.isVersionAtLeast?.('8.0')) {
            console.log('[GEO] Telegram LocationManager detected');

            const doGetLocation = () => {
                try {
                    lm.getLocation((data) => {
                        if (data && data.latitude != null && data.longitude != null) {
                            update(data.latitude, data.longitude, 'Telegram LocationManager');
                        } else {
                            console.warn('[GEO] Telegram returned empty location data:', data);
                            tryBrowser('Telegram returned empty data');
                        }
                    });
                } catch (e) {
                    console.error('[GEO] Telegram getLocation exception:', e);
                    tryBrowser('Telegram getLocation exception');
                }
            };

            try {
                if (!lm.isInited) {
                    console.log('[GEO] Initializing Telegram LocationManager...');
                    lm.init(() => {
                        console.log('[GEO] Telegram LocationManager initialized');
                        doGetLocation();
                    });
                } else {
                    doGetLocation();
                }
            } catch (e) {
                console.error('[GEO] Telegram LocationManager init error:', e);
                tryBrowser('Telegram init exception');
            }
        } else {
            tryBrowser(T ? 'Telegram version < 8.0 or no LocationManager' : 'No Telegram WebApp');
        }
    },

    async updateUserLocation(lat, lng) {
        const parsedLat = Number(lat);
        const parsedLng = Number(lng);

        if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)) {
            console.warn('[updateUserLocation] Invalid coordinates:', lat, lng);
            return;
        }

        if (parsedLat === 0 && parsedLng === 0) {
            console.warn('[updateUserLocation] Rejecting zero coordinates');
            return;
        }

        this.currentLat = parsedLat;
        this.currentLng = parsedLng;

        console.log(`[updateUserLocation] Sending to server: ${parsedLat}, ${parsedLng}`);

        try {
            const data = await this.apiRequest('update-location', {
                lat: parsedLat,
                lng: parsedLng
            });

            console.log('[updateUserLocation] Server response:', data?.success, data?.country);

            if (data.success) {
                const locText = document.getElementById('location-text');
                const profLocText = document.getElementById('profile-location-text');

                if (data.country) {
                    if (locText) locText.textContent = `Location: ${data.country}`;
                    if (profLocText) profLocText.textContent = data.country;
                }

                if (data.nearby) this.renderNearbyList(data.nearby);

                const myId = data.userId || this.userData?.id;
                if (data.points && this.earthMap) {
                    console.log(`[updateUserLocation] Setting ${data.points.length} points on map`);
                    this.earthMap.setPoints(data.points, myId);
                }

                const count = document.getElementById('active-users-count');
                if (count && data.points) {
                    count.textContent = data.points.length;
                }

                // Bind click on location status to focus map
                const statusPanel = document.querySelector('.location-status');
                if (statusPanel && !statusPanel.dataset.bound) {
                    statusPanel.style.cursor = 'pointer';
                    statusPanel.addEventListener('click', () => {
                        if (this.earthMap && this.currentLat) {
                            this.earthMap.focusUser(this.currentLat, this.currentLng);
                        }
                    });
                    statusPanel.dataset.bound = 'true';
                }
            }
        } catch (e) {
            console.error('[updateUserLocation] Failed:', e);
        }
    },

    async loadNearby(silent = false) {
        if (!silent) {
            const list = document.getElementById('nearby-list');
            if (list) list.innerHTML = '<div class="loading-state">Finding people around you...</div>';
        }

        try {
            const hasCoords = (
                Number.isFinite(this.currentLat) &&
                Number.isFinite(this.currentLng) &&
                !(this.currentLat === 0 && this.currentLng === 0)
            );

            const lat = hasCoords ? this.currentLat : null;
            const lng = hasCoords ? this.currentLng : null;

            console.log(`[loadNearby] hasCoords=${hasCoords}, lat=${lat}, lng=${lng}`);

            const data = await this.apiRequest('get-nearby', { lat, lng });

            if (data.success && data.nearby) {
                this.renderNearbyList(data.nearby);
                if (data.points && this.earthMap) {
                    this.earthMap.setPoints(data.points, this.userData?.id);
                }
            }
        } catch (error) {
            console.error('Failed to load nearby:', error);
            if (!silent) {
                const list = document.getElementById('nearby-list');
                if (list) list.innerHTML = '<div class="empty-state">Unable to load people</div>';
            }
        }
    },

    renderNearbyList(nearby) {
        const list = document.getElementById('nearby-list');
        if (!list) return;

        this.lastNearby = nearby;
        this.nearbyLoaded = true;

        if (!Array.isArray(nearby)) {
            list.innerHTML = `<div class="empty-state">${I18n.t('no_users_nearby')}</div>`;
            return;
        }

        if (nearby.length === 0) {
            list.innerHTML = `<div class="empty-state">${I18n.t('no_users_nearby')}</div>`;
            return;
        }

        list.innerHTML = '';
        const fragment = document.createDocumentFragment();

        nearby.forEach(user => {
            const el = document.createElement('div');
            el.className = 'clay-list-item';

            let meters = user.distance_meters;
            if (meters === undefined || meters === null) {
                meters = user.distance || user.dist || user.proximity;
            }
            if ((meters === undefined || meters === null) && user.distance_km !== undefined) {
                meters = user.distance_km * 1000;
            }

            // Client-side distance calculation if server didn't provide it
            const userLat = user.lat || user.latitude;
            const userLng = user.lng || user.longitude;

            if (
                (meters === undefined || meters === null || isNaN(meters)) &&
                Number.isFinite(this.currentLat) &&
                Number.isFinite(this.currentLng) &&
                !(this.currentLat === 0 && this.currentLng === 0) &&
                Number.isFinite(userLat) &&
                Number.isFinite(userLng) &&
                !(userLat === 0 && userLng === 0)
            ) {
                meters = this.getDistance(this.currentLat, this.currentLng, userLat, userLng);
            }

            const dist = this.formatDistance(meters);

            el.innerHTML = `
                <div class="leaderboard-item-link" onclick="App.viewNearbyUser('${user.threads_username || user.id}')">
                    <div class="item-avatar">
                        ${user.threads_avatar_url
                    ? `<img src="${user.threads_avatar_url}" />`
                    : '<svg viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>'
                }
                    </div>
                    <div class="item-info">
                        <div class="item-nick">@${user.threads_username || 'user'}</div>
                        <div class="distance-badge">${dist}</div>
                    </div>
                    <div class="item-rank">
                        <i class="pi pi-chevron-right" style="font-size: 12px; color: var(--text-mutted);"></i>
                    </div>
                </div>
            `;
            fragment.appendChild(el);
        });
        list.appendChild(fragment);
    },

    formatDistance(val) {
        let meters = val;
        if (typeof val === 'object' && val !== null) {
            meters = val.meters ?? val.distance ?? val.dist ?? val.val;
        }
        if (meters === undefined || meters === null || isNaN(meters)) return '—';
        if (meters > 0 && meters < 0.1) return '< 1 m';
        if (meters < 1000) return Math.round(meters) + ' m';
        return (meters / 1000).toFixed(1) + ' km';
    },

    getDistance(lat1, lon1, lat2, lon2) {
        const R = 6371e3;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    },

    viewNearbyUser(username) {
        TelegramApp.haptic('impact');
        this.openThreadsUrl(`https://www.threads.com/@${username}`);
    },

    // ============================================
    // API
    // ============================================
    async apiRequest(action, data = {}, retries = 3) {
        try {
            const response = await fetch('/api/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    initData: TelegramApp.getInitData(),
                    action,
                    ...data
                })
            });

            const result = await response.json();

            if (response.status === 401 && retries > 0) {
                await new Promise(r => setTimeout(r, 1000));
                return this.apiRequest(action, data, retries - 1);
            }

            if (!response.ok) {
                throw new Error(result.error || I18n.t('Request failed'));
            }

            return result;
        } catch (error) {
            const msg = error.message.toLowerCase();
            const isNetworkError = msg.includes('fetch') || msg.includes('load failed') || msg.includes('network');

            if (isNetworkError && retries > 0) {
                await new Promise(r => setTimeout(r, 1500));
                return this.apiRequest(action, data, retries - 1);
            }

            throw error;
        }
    },

    // ============================================
    // INIT DATA
    // ============================================
    async loadInitialData() {
        try {
            const data = await this.apiRequest('init-app');
            console.log('[loadInitialData] Response:', data?.success);

            if (data.success) {
                this.userData = data.user;
                this.updateProfileUI(data.user);

                if (data.nearby && data.nearby.length > 0) {
                    this.renderNearbyList(data.nearby);
                } else {
                    this.loadNearby(true);
                }

                if (data.points && this.earthMap) {
                    this.earthMap.setPoints(data.points, this.userData.id);
                    const count = document.getElementById('active-users-count');
                    if (count) count.textContent = data.points.length;
                }

                if (data.history) {
                    this.spinHistory = data.history;
                }

                this.setAppMode(this.userData.app_mode);
                this.startLocationTracking();
            }
        } catch (error) {
            console.error('Failed to load initial data:', error);
            document.getElementById('app')?.classList.remove('app-loading');
        }
    },

    // ============================================
    // PROFILE UI
    // ============================================
    updateProfileUI(user) {
        if (!user) return;

        const un = document.getElementById('user-name');
        if (un) un.textContent = user.first_name + (user.last_name ? ' ' + user.last_name : '');

        const av = document.getElementById('user-avatar');
        if (av && TelegramApp.user?.photo_url) {
            av.innerHTML = '';
            const img = document.createElement('img');
            img.src = TelegramApp.user.photo_url;
            img.referrerPolicy = 'no-referrer';
            img.onerror = () => {
                av.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>';
            };
            av.appendChild(img);
        }

        const sid = document.getElementById('stat-id');
        if (sid) sid.textContent = user.id;

        this.updateProfileVerificationUI(user);
    },

    updateProfileVerificationUI(userData) {
        const linkBtn = document.getElementById('link-threads-btn');
        const verifiedSection = document.getElementById('threads-verified-section');

        if (userData?.threads_verified && userData?.threads_username) {
            linkBtn?.classList.add('hidden');
            verifiedSection?.classList.remove('hidden');

            const pthreads = document.getElementById('profile-threads-info');
            const pnick = document.getElementById('profile-threads-nick');
            if (pthreads && pnick) {
                pthreads.classList.remove('hidden');
                pnick.textContent = userData.threads_username;
            }
        } else {
            linkBtn?.classList.remove('hidden');
            verifiedSection?.classList.add('hidden');
            document.getElementById('profile-threads-info')?.classList.add('hidden');
        }
    },

    // ============================================
    // SEARCH
    // ============================================
    async searchUser() {
        const input = document.getElementById('search-input');
        const resultEl = document.getElementById('search-result');
        const searchBtn = document.getElementById('search-btn');
        const nickname = input?.value?.trim();

        if (!nickname) {
            this.showToast(I18n.t('add_enter_username'), 'info');
            return;
        }

        input.blur();
        document.body.classList.remove('keyboard-open');
        TelegramApp.haptic('impact');

        resultEl.innerHTML = `<div style="text-align:center;color:var(--text-mutted);padding:20px;">${I18n.t('add_searching')}</div>`;
        resultEl.classList.remove('hidden');

        try {
            const data = await this.apiRequest('search-threads', { nickname });

            if (data.found) {
                if (searchBtn) searchBtn.textContent = 'X';
                this.showSearchFound(data, resultEl);
            } else {
                if (searchBtn) searchBtn.textContent = 'X';
                resultEl.innerHTML = `<div style="text-align:center;color:var(--text-mutted);padding:20px;">${I18n.t('add_not_found', { nick: nickname })}</div>`;
            }
        } catch (error) {
            if (searchBtn) searchBtn.textContent = 'X';
            resultEl.innerHTML = `<div style="text-align:center;color:#ef4444;padding:20px;">${I18n.t('error_search_failed')}</div>`;
        }
    },

    async showSearchFound(data, container) {
        this.lastSearchResult = data;
        container.innerHTML = '';

        let isSubscribed = false;
        if (data.already_exists) {
            try {
                const subData = await this.apiRequest('check-subscription', { username: data.nickname });
                isSubscribed = subData.subscribed;
            } catch (e) { }
        }

        const av = document.createElement('div');
        av.className = 'result-avatar';
        av.style.cssText = 'width:60px;height:60px;flex-shrink:0;';

        if (data.avatar_url) {
            const img = document.createElement('img');
            img.src = data.avatar_url;
            img.referrerPolicy = 'no-referrer';
            img.onerror = () => {
                av.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="1.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>';
            };
            av.appendChild(img);
        } else {
            av.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="1.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>';
        }

        const url = `https://www.threads.com/@${data.nickname}`;
        const nick = document.createElement('div');
        nick.className = 'result-nick';
        nick.innerHTML = `<a href="${url}" target="_blank" rel="noopener noreferrer" class="result-nick-link">@${data.nickname}</a>`;
        nick.style.cssText = 'font-weight:bold;font-size:18px;';
        nick.querySelector('a')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.openThreadsUrl(url);
        });

        const status = document.createElement('div');
        status.style.fontSize = '14px';

        if (data.already_exists) {
            status.innerHTML = I18n.t('add_already_score', { score: data.score || 0, rank: '>50' });
            status.style.color = 'var(--text-mutted)';
        } else {
            status.textContent = I18n.t('add_found');
            status.style.color = 'var(--accent)';
        }

        const btn = document.createElement('button');
        btn.style.marginTop = '10px';

        if (!data.already_exists) {
            btn.className = 'clay-btn clay-primary';
            btn.textContent = I18n.t('add_button');
            btn.onclick = async () => {
                btn.disabled = true;
                btn.textContent = '...';
                try {
                    const res = await this.apiRequest('add-participant', { nickname: data.nickname });
                    if (res.success) {
                        this.showToast(I18n.t('add_success', { nick: data.nickname }), 'success');
                        data.already_exists = true;
                        data.score = 0;
                        this.showSearchFound(data, container);
                    } else if (res.error === 'no_threads_profile') {
                        this.showToast(I18n.t('error_not_on_threads', { nick: data.nickname }), 'error');
                        btn.disabled = false;
                        btn.textContent = I18n.t('add_button');
                    } else {
                        throw new Error(res.error);
                    }
                } catch (e) {
                    this.showToast(e.message, 'error');
                    btn.disabled = false;
                    btn.textContent = I18n.t('add_button');
                }
            };
        } else {
            btn.className = `clay-btn ${isSubscribed ? 'clay-secondary' : 'clay-primary'}`;
            btn.textContent = isSubscribed ? I18n.t('sub_btn_unsubscribe') : I18n.t('sub_btn_subscribe');
            btn.onclick = async () => {
                TelegramApp.haptic('impact');
                btn.disabled = true;
                try {
                    const res = await this.apiRequest('toggle-subscription', { username: data.nickname });
                    if (res.success) {
                        isSubscribed = res.subscribed;
                        btn.className = `clay-btn ${isSubscribed ? 'clay-secondary' : 'clay-primary'}`;
                        btn.textContent = isSubscribed ? I18n.t('sub_btn_unsubscribe') : I18n.t('sub_btn_subscribe');
                        this.showToast(
                            isSubscribed ? I18n.t('sub_subscribed') : I18n.t('sub_unsubscribed'),
                            isSubscribed ? 'success' : 'warning'
                        );
                    }
                } catch (e) { }
                btn.disabled = false;
            };
        }

        container.appendChild(av);
        container.appendChild(nick);
        container.appendChild(status);
        container.appendChild(btn);
        container.classList.remove('hidden');
    },

    // ============================================
    // HELPERS
    // ============================================
    updateLangButtons() {
        // Handled by I18n
    },

    copyToClipboard(text) {
        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(text)
                .then(() => this.showToast(I18n.t('copy_success'), 'success'))
                .catch(() => this.fallbackCopy(text));
        } else {
            this.fallbackCopy(text);
        }
    },

    fallbackCopy(text) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        try {
            document.execCommand('copy');
            this.showToast(I18n.t('copy_success'), 'success');
        } catch (err) {
            this.showToast(I18n.t('copy_error'), 'error');
        }
        document.body.removeChild(ta);
    },
};

window.App = App;
document.addEventListener('DOMContentLoaded', () => App.init());
