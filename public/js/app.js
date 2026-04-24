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

        document.getElementById('maintenance-stub')?.classList.toggle('hidden', mode !== 'maintenance');
        document.getElementById('verification-stub')?.classList.toggle('hidden', mode !== 'verify_only');
        document.getElementById('onboarding-stub')?.classList.toggle('hidden', !needsOnboarding || mode === 'maintenance');

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
                if (errorEl) errorEl.textContent = I18n.t(data.error || 'Ошибка сохранения');
                btn.disabled = false;
            }

        } catch (e) {
            if (errorEl) errorEl.textContent = 'Ошибка сети';
            btn.disabled = false;
        }
    },

    showVerificationOnlySuccess() {
        const stub = document.getElementById('verification-stub');
        if (stub) {
            stub.innerHTML = `
                <div class="stub-content clay-card" style="padding-bottom: 30px;">
                    <div class="stub-icon">
                        <svg viewBox="0 0 24 24" width="60" height="60" fill="none" stroke="#10b981" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0 0 15px rgba(16, 185, 129, 0.4));">
                            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                            <polyline points="22 4 12 14.01 9 11.01"></polyline>
                        </svg>
                    </div>
                    <h1 data-i18n="verify_success" style="margin-bottom: 10px;">${I18n.t('verify_success')}</h1>
                    <p style="line-height: 1.4; font-size: 15px;">${I18n.t('verify_only_success')}</p>
                </div>
            `;
            stub.addEventListener('click', (e) => {
                const link = e.target.closest('.threads-link');
                if (link) {
                    e.preventDefault();
                    this.openThreadsUrl('https://www.threads.com/@usemikehelp');
                }
            });
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
        toast.className = `toast`;
        let icon = type === 'success' ?
            '<svg class="clay-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>' :
            type === 'error' ?
                '<svg class="clay-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>' :
                type === 'warning' ?
                    '<svg class="clay-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#f59e0b" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="8" y1="12" x2="16" y2="12"></line></svg>' :
                    '<svg class="clay-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#3b82f6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';
        toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
        container.appendChild(toast);
        requestAnimationFrame(() => toast.classList.add('show'));
        TelegramApp.haptic(type === 'error' ? 'error' : 'success');
        setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 3000);
    },

    setupKeyboardDetection() {
        if (window.visualViewport) {
            let initialHeight = window.visualViewport.height;
            window.visualViewport.addEventListener('resize', () => {
                const isKeyboard = initialHeight - window.visualViewport.height > 100;
                document.body.classList.toggle('keyboard-open', isKeyboard);
                if (this.floatingAvatars) {
                    this.floatingAvatars.setKeyboardVisible(isKeyboard);
                }
            });
        }
        const inputs = ['INPUT', 'TEXTAREA'];
        const update = (visible) => {
            document.body.classList.toggle('keyboard-open', visible);
            if (this.floatingAvatars) this.floatingAvatars.setKeyboardVisible(visible);
        };
        document.addEventListener('focusin', (e) => {
            if (inputs.includes(e.target.tagName)) update(true);
        });
        document.addEventListener('focusout', (e) => {
            if (inputs.includes(e.target.tagName)) update(false);
        });
    },

    bindEvents() {
        document.querySelectorAll('.nav-item').forEach(btn => {
            btn.addEventListener('click', (e) => { e.preventDefault(); this.switchTab(btn.dataset.tab); });
        });

        document.getElementById('spin-btn')?.addEventListener('click', () => this.spin());

        document.querySelector('.clay-header .clay-badge')?.addEventListener('click', () => {
            const star = document.querySelector('.clay-header .clay-star');
            if (star) {
                star.classList.remove('sparkle-active');
                void star.offsetWidth;
                star.classList.add('sparkle-active');
                TelegramApp.haptic('impact');
            }
        });

        document.getElementById('deposit-btn')?.addEventListener('click', () => this.showDepositModal());

        document.querySelectorAll('.deposit-btn').forEach(btn => {
            btn.addEventListener('click', () => this.createDeposit(parseInt(btn.dataset.amount)));
        });

        document.getElementById('custom-deposit-btn')?.addEventListener('click', () => {
            const amount = parseInt(document.getElementById('custom-deposit').value);
            if (amount > 0 && amount <= 10000) this.createDeposit(amount);
            else this.showToast(I18n.t('deposit_amount_error'), 'error');
        });

        const searchBtn = document.getElementById('search-btn');
        searchBtn?.addEventListener('click', () => {
            if (searchBtn.textContent === 'X') {
                const input = document.getElementById('search-input');
                if (input) input.value = '';
                const result = document.getElementById('search-result');
                if (result) {
                    result.classList.add('hidden');
                    result.innerHTML = '';
                }
                searchBtn.textContent = 'Go';
            } else {
                this.searchUser();
            }
        });
        document.getElementById('search-input')?.addEventListener('input', (e) => {
            const val = e.target.value.trim();
            if (val === '') {
                const result = document.getElementById('search-result');
                if (result) {
                    result.classList.add('hidden');
                    result.innerHTML = '';
                }
            }
            if (searchBtn && searchBtn.textContent === 'X' && val !== '') {
                searchBtn.textContent = 'Go';
            }
        });
        document.getElementById('search-input')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') { e.target.blur(); this.searchUser(); }
        });

        document.getElementById('link-threads-btn')?.addEventListener('click', () => this.openVerifyModal());
        document.getElementById('verify-only-start-btn')?.addEventListener('click', () => this.openVerifyModal());
        document.getElementById('verify-modal-close')?.addEventListener('click', () => this.closeVerifyModal());
        document.getElementById('verify-modal-overlay')?.addEventListener('click', () => this.closeVerifyModal());
        document.getElementById('verify-search-btn')?.addEventListener('click', () => this.searchThreadsForVerify());
        document.getElementById('verify-nick-input')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') { e.target.blur(); this.searchThreadsForVerify(); }
        });
        document.getElementById('verify-publish-btn')?.addEventListener('click', () => this.openThreadsPublish());
        document.getElementById('verify-check-btn')?.addEventListener('click', () => this.checkVerification());

        document.getElementById('onboarding-submit-btn')?.addEventListener('click', () => this.submitOnboarding());
        document.getElementById('onboarding-nick-input')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') { e.target.blur(); this.submitOnboarding(); }
        });

        document.getElementById('vo-search-btn')?.addEventListener('click', () => this.searchThreadsForVerify(true));
        document.getElementById('vo-nick-input')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') { e.target.blur(); this.searchThreadsForVerify(true); }
        });
        document.getElementById('vo-copy-btn')?.addEventListener('click', () => {
            const code = this.verifyState.code;
            if (code) {
                const text = I18n.t('verify_post_text', { code });
                this.copyToClipboard(text);
            }
        });
        document.getElementById('vo-publish-btn')?.addEventListener('click', () => this.openThreadsPublish(true));
        document.getElementById('vo-check-btn')?.addEventListener('click', () => this.checkVerification(true));

        document.querySelectorAll('.modal-close').forEach(btn => {
            if (btn.id !== 'verify-modal-close') {
                btn.addEventListener('click', () => this.closeModals());
            }
        });
        document.querySelectorAll('.modal-overlay').forEach(overlay => {
            if (overlay.id !== 'verify-modal-overlay') {
                overlay.addEventListener('click', () => this.closeModals());
            }
        });

        document.querySelectorAll('.lang-option').forEach(opt => {
            opt.addEventListener('click', () => {
                I18n.setLanguage(opt.dataset.lang);
                this.updateSpinButton();
                if (this.userData) this.updateProfileUI(this.userData);
                if (this.lastSearchResult) {
                    const container = document.getElementById('search-result');
                    if (container && !container.classList.contains('hidden')) {
                        this.showSearchFound(this.lastSearchResult, container);
                    }
                }
                TelegramApp.haptic('impact');
            });
        });

        document.getElementById('disconnect-threads-btn')?.addEventListener('click', () => this.disconnectThreads());
        document.getElementById('copy-verify-text-btn')?.addEventListener('click', () => {
            const code = this.verifyState.code;
            if (code) {
                const text = I18n.t('verify_post_text', { code });
                this.copyToClipboard(text);
            }
        });

        document.body.addEventListener('touchstart', (e) => {
            const btn = e.target.closest('button, .clay-btn, .clay-icon-btn, .nav-item, .clay-list-item, .modal-close');
            if (btn && !btn.disabled) {
                btn.classList.add('is-active');
            }
        }, { passive: true });

        document.body.addEventListener('touchend', (e) => {
            const btn = e.target.closest('button, .clay-btn, .clay-icon-btn, .nav-item, .clay-list-item, .modal-close');
            if (btn) {
                btn.classList.remove('is-active');
            }

            const isInput = e.target.closest('input, textarea');
            const isInteractive = e.target.closest('button, .clay-btn, .clay-icon-btn, .nav-item, [onclick], a');

            if (!isInput && !isInteractive && document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) {
                document.activeElement.blur();
            }
        }, { passive: true });

        document.body.addEventListener('touchcancel', (e) => {
            document.querySelectorAll('.is-active').forEach(el => el.classList.remove('is-active'));
        }, { passive: true });
    },

    openSettings() {
        TelegramApp.haptic('impact');
        const page = document.getElementById('settings-page');
        if (page) {
            page.style.display = 'flex';
            setTimeout(() => page.classList.add('active'), 10);
            TelegramApp.showBackButton(() => this.closeSettings());
        }
    },

    closeSettings() {
        const page = document.getElementById('settings-page');
        if (page) {
            page.classList.remove('active');
            setTimeout(() => page.style.display = 'none', 400);
        }
        TelegramApp.hideBackButton();
    },

    switchTab(tabId) {
        TelegramApp.haptic('impact');
        document.activeElement?.blur();
        document.body.classList.remove('keyboard-open');
        document.querySelectorAll('.nav-item').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabId));

        const tabs = document.querySelectorAll('.tab-content');
        tabs.forEach(tab => {
            const isActive = tab.id === `${tabId}-tab`;
            tab.classList.toggle('active', isActive);
            if (isActive) {
                tab.style.pointerEvents = tabId === 'map' ? 'none' : 'auto';
            }
        });

        this.currentTab = tabId;

        if (tabId === 'nearby' && !this.nearbyLoaded) this.loadNearby();
        else if (tabId === 'nearby') this.loadNearby(true);

        const globeBg = document.getElementById('globe-background');
        if (globeBg) {
            globeBg.style.pointerEvents = tabId === 'map' ? 'auto' : 'none';
        }
    },

    // ============================================
    // FIX: startLocationTracking
    // Добавлен requestAccess для Telegram LocationManager
    // и защита от нулевых координат перед отправкой на сервер
    // ============================================
    startLocationTracking() {
        if (this._geoStarted) return;
        this._geoStarted = true;

        if (!navigator.geolocation) {
            this.showToast('Geolocation is not supported', 'warning');
            return;
        }

        const update = () => {
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    this.updateUserLocation(position.coords.latitude, position.coords.longitude);
                    // Let updateUserLocation handle the text update with country name
                },
                (err) => {
                    console.error('Geolocation error:', err);
                    const locText = document.getElementById('location-text');
                    if (locText) locText.textContent = 'Location access denied';
                    this.showToast('Please enable location access', 'warning');
                },
                { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
            );
        };

        update();
        // Updated: location is now updated only once upon bot entry
    },

    async updateUserLocation(lat, lng) {
        this.currentLat = lat;
        this.currentLng = lng;

        // FIX: Дополнительная защита — не отправляем нули на сервер
        if (!lat || !lng || (lat === 0 && lng === 0)) {
            console.warn('[updateUserLocation] Skipping zero/null coordinates');
            return;
        }

        try {
            const data = await this.apiRequest('update-location', { lat, lng });
            console.log('Location update response:', data);
            if (data.success) {
                const locText = document.getElementById('location-text');
                const profLocText = document.getElementById('profile-location-text');

                if (data.country) {
                    if (locText) locText.textContent = `Location: ${data.country}`;
                    if (profLocText) profLocText.textContent = data.country;
                } else if (data.city) {
                    if (locText) locText.textContent = `Location: ${data.city}`;
                    if (profLocText) profLocText.textContent = data.city;
                }

                if (data.nearby) this.renderNearbyList(data.nearby);

                const myId = data.userId || this.userData?.id;
                if (data.points && this.earthMap) {
                    console.log(`Setting ${data.points.length} points, myId=${myId}`);
                    this.earthMap.setPoints(data.points, myId);
                }

                const count = document.getElementById('active-users-count');
                if (count && data.points) {
                    count.textContent = data.points.length;
                }

                const statusPanel = document.querySelector('.location-status');
                if (statusPanel && !statusPanel.dataset.bound) {
                    statusPanel.style.cursor = 'pointer';
                    statusPanel.addEventListener('click', () => {
                        if (this.earthMap && this.currentLat) {
                            this.earthMap.focusUser(this.currentLat, this.currentLng);
                        }
                    });
                    statusPanel.dataset.bound = "true";
                }
            }
        } catch (e) {
            console.error('Failed to update location:', e);
        }
    },

    async loadNearby(silent = false) {
        if (!silent) {
            const list = document.getElementById('nearby-list');
            if (list) list.innerHTML = `<div class="loading-state">Finding people around you...</div>`;
        }

        try {
            // FIX: Передаём null если координаты не определены или нулевые,
            // чтобы сервер не перезаписывал базу нулями
            const lat = (this.currentLat && this.currentLat !== 0) ? this.currentLat : null;
            const lng = (this.currentLng && this.currentLng !== 0) ? this.currentLng : null;

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
                if (list) list.innerHTML = `<div class="empty-state">Unable to load people</div>`;
            }
        }
    },

    renderNearbyList(nearby) {
        const list = document.getElementById('nearby-list');
        if (!list) return;

        this.lastNearby = nearby;
        this.nearbyLoaded = true;

        if (!Array.isArray(nearby)) {
            console.warn('Nearby data is not an array:', nearby);
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
            if (meters === undefined || meters === null) meters = user.distance || user.dist || user.proximity;
            if ((meters === undefined || meters === null) && user.distance_km !== undefined) {
                meters = user.distance_km * 1000;
            }

            // FIX: Клиентский расчёт дистанции только если у обоих пользователей есть ненулевые координаты
            if (
                (meters === undefined || meters === null || isNaN(meters)) &&
                this.currentLat && this.currentLng &&
                this.currentLat !== 0 && this.currentLng !== 0 &&
                (user.lat || user.latitude) &&
                (user.lng || user.longitude) &&
                (user.lat || user.latitude) !== 0 &&
                (user.lng || user.longitude) !== 0
            ) {
                meters = this.getDistance(
                    this.currentLat, this.currentLng,
                    user.lat || user.latitude,
                    user.lng || user.longitude
                );
            }

            const dist = this.formatDistance(meters);
            const locationDisplay = user.country || dist;

            el.innerHTML = `
                <div class="leaderboard-item-link" onclick="App.viewNearbyUser('${user.threads_username || user.id}')">
                    <div class="item-avatar">
                        ${(user.threads_avatar_url) ? `<img src="${user.threads_avatar_url}" />` : '<svg viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>'}
                    </div>
                    <div class="item-info">
                        <div class="item-nick">@${user.threads_username || 'user'}</div>
                        <div class="distance-badge">${locationDisplay}</div>
                    </div>
                    <div class="item-rank">
                        <i class="fa-solid fa-chevron-right" style="font-size: 12px; color: var(--text-mutted); opacity: 0.5;"></i>
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

        // FIX: null означает "дистанция неизвестна" — показываем прочерк, а не 0 m
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
        if (!username) return;
        TelegramApp.haptic('impact');
        this.openThreadsUrl(`https://www.threads.com/@${username}`);
    },


    async apiRequest(action, data = {}, retries = 3) {
        try {
            const response = await fetch('/api/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ initData: TelegramApp.getInitData(), action, ...data })
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

            if (isNetworkError) {
                throw new Error(I18n.t('Request failed'));
            }

            throw error;
        }
    },

    async loadInitialData() {
        try {
            const data = await this.apiRequest('init-app');
            console.log('Init data:', data);

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
                    this.updateHistoryUI();
                }

                // Initialize location text from DB instantly to prevent hanging UI
                if (this.userData?.country) {
                    const locText = document.getElementById('location-text');
                    const profLocText = document.getElementById('profile-location-text');
                    if (locText) locText.textContent = `Location: ${this.userData.country}`;
                    if (profLocText) profLocText.textContent = this.userData.country;
                } else {
                    const locText = document.getElementById('location-text');
                    if (locText) locText.textContent = 'Location pending';
                }

                this.setAppMode(this.userData.app_mode);
                this.startLocationTracking();
            }
        } catch (error) {
            console.error('Failed to load initial data:', error);
            document.getElementById('app').classList.remove('app-loading');
        }
    },

    updateProfileUI(user) {
        if (!user) {
            console.warn('updateProfileUI: user data is missing');
            return;
        }
        const un = document.getElementById('user-name');
        if (un) un.textContent = user.first_name + (user.last_name ? ' ' + user.last_name : '');
        const av = document.getElementById('user-avatar');
        if (av && TelegramApp.user?.photo_url) {
            av.innerHTML = '';
            const img = document.createElement('img');
            img.src = TelegramApp.user.photo_url;
            img.referrerPolicy = "no-referrer";
            img.onerror = () => { av.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>'; };
            av.appendChild(img);
        } else if (av) {
            av.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>';
        }

        const sid = document.getElementById('stat-id');
        if (sid) sid.textContent = user.id;

        this.updateProfileVerificationUI(user);
    },

    updateHistoryUI() {
        const list = document.getElementById('history-list');
        if (!list) return;
        list.innerHTML = '';

        this.spinHistory.slice(0, 15).forEach(spin => {
            const item = document.createElement('div');
            item.className = 'clay-list-item';

            const info = document.createElement('div');
            info.className = 'item-info';
            const nick = document.createElement('div');
            nick.className = 'item-nick';
            nick.textContent = `@${spin.participant_nickname}`;

            info.appendChild(nick);

            const score = document.createElement('div');
            score.className = 'item-score';
            score.style.fontSize = '14px';
            const starSvg = '<svg class="inline-star clay-star" viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';
            score.innerHTML = spin.was_free ? I18n.t('profile_free_label') : `1 ${starSvg}`;

            item.appendChild(info);
            item.appendChild(score);
            list.appendChild(item);
        });

        if (this.spinHistory.length === 0) {
            list.innerHTML = `<div style="text-align:center;color:var(--text-mutted);padding:20px;">${I18n.t('profile_no_spins')}</div>`;
        }
    },

    async spin() {
        if (!this.floatingAvatars || this.floatingAvatars.isRolling) return;
        TelegramApp.haptic('impact');

        const spinBtn = document.getElementById('spin-btn');
        const btnText = document.getElementById('spin-btn-text');
        spinBtn.disabled = true;
        btnText.textContent = I18n.t('spin_spinning');

        const resultEl = document.getElementById('roll-result');
        if (resultEl) resultEl.classList.add('hidden');

        try {
            const data = await this.apiRequest('spin-wheel');
            if (data.success) { this.animateAndShowResult(data, spinBtn, btnText); return; }
            if (data.need_payment) { await this.handlePaidSpin(spinBtn, btnText); return; }
            throw new Error(data.error || 'Spin failed');
        } catch (error) {
            this.showToast(error.message, 'error');
            this.showRetryAlert(error.message, () => {
                spinBtn.disabled = false;
                btnText.textContent = I18n.t('spin_button');
            });
            spinBtn.disabled = false;
            btnText.textContent = I18n.t('spin_button');
        }
    },

    async handlePaidSpin(spinBtn, btnText) {
        try {
            const invoiceData = await this.apiRequest('spin-paid');
            if (!invoiceData.success) throw new Error(invoiceData.error);

            TelegramApp.openInvoice(invoiceData.invoiceUrl, async (status) => {
                if (status === 'paid') {
                    this.showToast('Success!', 'success');
                    btnText.textContent = I18n.t('spin_spinning');
                    await new Promise(r => setTimeout(r, 2000));
                    await this.loadInitialData();

                    if (this.spinHistory.length > 0) {
                        const last = this.spinHistory[0];
                        this.floatingAvatars.roll(() => {
                            this.showSpinResult({ nickname: last.participant_nickname, avatar_url: null, new_score: '?' });
                            spinBtn.disabled = false;
                            btnText.textContent = I18n.t('spin_button');
                        });
                    } else {
                        spinBtn.disabled = false;
                        btnText.textContent = I18n.t('spin_button');
                    }
                } else {
                    spinBtn.disabled = false;
                    btnText.textContent = I18n.t('spin_button');
                }
            });
        } catch (error) {
            this.showToast(error.message, 'error');
            spinBtn.disabled = false;
            btnText.textContent = I18n.t('spin_button');
        }
    },

    animateAndShowResult(data, spinBtn, btnText) {
        this.floatingAvatars.roll(() => {
            this.updateBalance(data.balance, data.free_spins_left);
            this.showSpinResult(data.participant);
            if (this.userData) {
                this.userData.balance = data.balance;
                this.userData.free_spins = data.free_spins_left;
                this.userData.total_spins = data.total_spins;
                if (data.threads_star_balance !== undefined) {
                    this.userData.threads_star_balance = data.threads_star_balance;
                }
                this.updateProfileUI(this.userData);
            }
            spinBtn.disabled = false;
            btnText.textContent = I18n.t('spin_button');
        });
    },

    async showSpinResult(participant) {
        TelegramApp.haptic('success');
        const resultEl = document.getElementById('roll-result');
        const avatarEl = document.getElementById('result-avatar');
        const nickEl = document.getElementById('result-nick');
        const scoreEl = document.getElementById('result-score');

        if (resultEl && avatarEl && nickEl && scoreEl) {
            if (this.resultTimeout) clearTimeout(this.resultTimeout);

            avatarEl.innerHTML = '';
            if (participant.avatar_url) {
                const img = document.createElement('img');
                img.src = participant.avatar_url;
                img.referrerPolicy = "no-referrer";
                img.onerror = () => { avatarEl.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>'; };
                avatarEl.appendChild(img);
            } else {
                avatarEl.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>';
            }

            const url = `https://www.threads.com/@${participant.nickname}`;
            nickEl.innerHTML = `<a href="${url}" target="_blank" rel="noopener noreferrer" class="result-nick-link">@${participant.nickname}</a>`;
            nickEl.querySelector('a')?.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.openThreadsUrl(url);
            });
            scoreEl.textContent = I18n.t('score_plus', { score: 1 });

            let rankEl = document.getElementById('result-rank');
            if (!rankEl) {
                rankEl = document.createElement('div');
                rankEl.id = 'result-rank';
                rankEl.className = 'result-rank';
                document.querySelector('.result-info').appendChild(rankEl);
            }
            rankEl.textContent = `Rank: ...`;
            resultEl.classList.remove('hidden');

            try {
                const lbData = await this.apiRequest('leaderboard');
                let rankText = '?';
                if (lbData.success && lbData.leaderboard) {
                    this.lastLeaderboard = lbData.leaderboard;
                    const lbItem = lbData.leaderboard.find(i => i.nickname === participant.nickname);
                    if (lbItem) {
                        if (lbItem.rank === 1) rankText = '<span class="rank-badge rank-1">#1</span>';
                        else if (lbItem.rank === 2) rankText = '<span class="rank-badge rank-2">#2</span>';
                        else if (lbItem.rank === 3) rankText = '<span class="rank-badge rank-3">#3</span>';
                        else rankText = `#${lbItem.rank}`;
                    } else rankText = '>50';
                }
                rankEl.innerHTML = `Rank: ${rankText}`;
            } catch (e) { }

            this.resultTimeout = setTimeout(() => {
                resultEl.classList.add('hidden');
            }, 5000);
        }
    },

    showRetryAlert(message, onDismiss) {
        message = I18n.t(message);
        if (TelegramApp.webapp?.showPopup) {
            TelegramApp.webapp.showPopup({
                title: I18n.t('error_title'),
                message: message,
                buttons: [{ id: 'close', type: 'cancel' }]
            }, () => { if (onDismiss) onDismiss(); });
        } else {
            if (onDismiss) onDismiss();
        }
    },

    async loadLeaderboard(silent = false) {
        if (!silent && !this.leaderboardLoaded) {
            const list = document.getElementById('leaderboard-list');
            if (list) list.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-mutted);">${I18n.t('leaderboard_loading')}</div>`;
        }

        try {
            const data = await this.apiRequest('leaderboard');
            if (data.success && data.leaderboard) {
                this.renderLeaderboard(data.leaderboard, silent);
            }
        } catch (error) {
            console.error('Failed to load leaderboard:', error);
        }
    },

    renderLeaderboard(leaderboard, silent = false) {
        const list = document.getElementById('leaderboard-list');
        if (!list) return;

        try {
            if (!leaderboard || leaderboard.length === 0) {
                if (!silent || this.lastLeaderboard.length > 0) {
                    list.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-mutted);">${I18n.t('leaderboard_empty')}</div>`;
                }
                this.lastLeaderboard = [];
                this.leaderboardLoaded = true;
                return;
            }

            const newDataStr = JSON.stringify(leaderboard);
            const oldDataStr = JSON.stringify(this.lastLeaderboard);
            const isLoaderVisible = list.innerHTML.includes('loading-state') || list.innerHTML.includes(I18n.t('leaderboard_loading'));
            if (newDataStr === oldDataStr && this.leaderboardLoaded && !isLoaderVisible) return;

            list.innerHTML = '';
            this.lastLeaderboard = leaderboard;
            this.leaderboardLoaded = true;
            const fragment = document.createDocumentFragment();
            leaderboard.forEach(item => {
                const el = document.createElement('div');
                el.className = 'clay-list-item';
                el.style.cursor = 'pointer';
                const url = `https://www.threads.com/@${item.nickname}`;
                el.innerHTML = `<a href="${url}" target="_blank" rel="noopener noreferrer" class="leaderboard-item-link"></a>`;
                const linkWrap = el.querySelector('a');

                linkWrap.onclick = (e) => {
                    e.preventDefault();
                    this.openThreadsUrl(url);
                };

                const rank = document.createElement('div');
                rank.className = 'item-rank';
                if (item.rank === 1) rank.innerHTML = '<span class="rank-badge rank-1">#1</span>';
                else if (item.rank === 2) rank.innerHTML = '<span class="rank-badge rank-2">#2</span>';
                else if (item.rank === 3) rank.innerHTML = '<span class="rank-badge rank-3">#3</span>';
                else rank.textContent = `#${item.rank}`;

                const avatar = document.createElement('div');
                avatar.className = 'item-avatar';
                if (item.avatar_url) {
                    const img = document.createElement('img');
                    img.src = item.avatar_url;
                    img.referrerPolicy = "no-referrer";
                    img.onerror = () => { avatar.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>'; };
                    avatar.appendChild(img);
                } else avatar.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>';

                const info = document.createElement('div');
                info.className = 'item-info';
                const nick = document.createElement('div');
                nick.className = 'item-nick';
                nick.textContent = `@${item.nickname}`;
                info.appendChild(nick);

                const score = document.createElement('div');
                score.className = 'item-score';
                score.innerHTML = `${item.score} <svg class="inline-star clay-star" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`;

                linkWrap.appendChild(rank); linkWrap.appendChild(avatar); linkWrap.appendChild(info); linkWrap.appendChild(score);
                fragment.appendChild(el);
            });
            list.appendChild(fragment);
        } catch (error) {
            console.error('Render leaderboard error:', error);
        }
    },

    async searchUser() {
        const input = document.getElementById('search-input');
        const resultEl = document.getElementById('search-result');
        const searchBtn = document.getElementById('search-btn');
        const nickname = input?.value?.trim();
        if (!nickname) { this.showToast(I18n.t('add_enter_username'), 'info'); return; }

        input.blur();
        document.body.classList.remove('keyboard-open');
        TelegramApp.haptic('impact');

        resultEl.innerHTML = `<div style="text-align:center;color:var(--text-mutted);padding: 20px;">${I18n.t('add_searching')}</div>`;
        resultEl.classList.remove('hidden');

        try {
            const data = await this.apiRequest('search-threads', { nickname });
            if (data.found) {
                if (searchBtn) searchBtn.textContent = 'X';
                this.showSearchFound(data, resultEl);
            } else {
                if (searchBtn) searchBtn.textContent = 'X';
                resultEl.innerHTML = `<div style="text-align:center;color:var(--text-mutted);padding: 20px;">${I18n.t('add_not_found', { nick: nickname })}</div>`;
            }
        } catch (error) {
            if (searchBtn) searchBtn.textContent = 'X';
            resultEl.innerHTML = `<div style="text-align:center;color:#ef4444;padding: 20px;">${I18n.t('error_search_failed')}</div>`;
        }
    },

    async showSearchFound(data, container) {
        this.lastSearchResult = data;
        container.innerHTML = '';
        container.classList.add('search-result-card');

        const av = document.createElement('div');
        av.className = 'result-avatar';
        av.style.width = '60px';
        av.style.height = '60px';
        av.style.flexShrink = '0';

        if (data.avatar_url) {
            const img = document.createElement('img');
            img.src = data.avatar_url;
            img.referrerPolicy = "no-referrer";
            img.onerror = () => { av.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="1.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>'; };
            av.appendChild(img);
        } else av.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="1.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>';

        const info = document.createElement('div');
        info.className = 'result-info';
        info.style.flex = '1';

        const url = `https://www.threads.com/@${data.nickname}`;
        const nick = document.createElement('div');
        nick.className = 'result-nick';
        nick.innerHTML = `<a href="${url}" target="_blank" rel="noopener noreferrer" class="result-nick-link">@${data.nickname}</a>`;
        nick.style.fontWeight = 'bold';
        nick.style.fontSize = '18px';

        nick.querySelector('a')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.openThreadsUrl(url);
        });

        const status = document.createElement('div');
        status.style.fontSize = '14px';

        if (data.already_exists) {
            status.textContent = data.country || 'Location unknown';
            status.style.color = 'var(--text-mutted)';
        } else {
            status.textContent = I18n.t('add_found');
            status.style.color = 'var(--accent)';
        }

        info.appendChild(nick);
        info.appendChild(status);

        container.appendChild(av);
        container.appendChild(info);
    },




    showDepositModal() {
        TelegramApp.haptic('impact');
        const modal = document.getElementById('deposit-modal');
        const input = document.getElementById('custom-deposit');
        if (modal && input) {
            input.value = '';
            modal.classList.add('active');
            document.body.style.overflow = 'hidden';
            input.focus();
            setTimeout(() => input.focus(), 50);
        }
    },

    closeModals() {
        document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));
        document.body.style.overflow = '';
    },

    async createDeposit(amount) {
        TelegramApp.haptic('impact');
        this.closeModals();
        this.showLoading(true);
        try {
            const invoiceData = await this.apiRequest('create-invoice', { amount });
            if (!invoiceData.success) throw new Error(invoiceData.error);
            this.showLoading(false);
            this.pendingPayment = { transactionId: invoiceData.transactionId, amount };
            TelegramApp.openInvoice(invoiceData.invoiceUrl, async (status) => {
                if (status === 'paid') {
                    TelegramApp.haptic('success');
                    await this.checkPaymentAndUpdate();
                } else {
                    this.pendingPayment = null;
                    if (status === 'failed') { this.showToast(I18n.t('deposit_failed'), 'error'); }
                }
            });
        } catch (error) {
            this.showLoading(false);
            this.showToast(error.message, 'error');
        }
    },

    async checkPaymentAndUpdate() {
        if (!this.pendingPayment) return;
        this.showLoading(true);
        await new Promise(r => setTimeout(r, 1500));
        let attempts = 0;
        const poll = async () => {
            attempts++;
            try {
                const result = await this.apiRequest('check-payment', { transactionId: this.pendingPayment.transactionId });
                if (result.success && result.status === 'completed') {
                    this.showLoading(false);
                    this.updateBalance(result.balance);
                    const amt = this.pendingPayment.amount;
                    this.showToast(I18n.t('deposit_success', { amount: amt }), 'success');
                    this.pendingPayment = null;
                    if (this.userData) { this.userData.total_deposited = (this.userData.total_deposited || 0) + amt; this.updateProfileUI(this.userData); }
                    return;
                }
            } catch (e) { }
            if (attempts < 10) setTimeout(poll, 2000);
            else {
                this.showLoading(false);
                this.showToast(I18n.t('deposit_processing'), 'info');
                this.pendingPayment = null;
                setTimeout(() => this.loadInitialData(), 5000);
            }
        };
        poll();
    },

    showLoading(show) {
        const l = document.getElementById('loading');
        if (l) l.classList.toggle('active', show);
    },

    // ============================================
    // THREADS VERIFICATION
    // ============================================
    updateProfileVerificationUI(userData) {
        const linkBtn = document.getElementById('link-threads-btn');
        const verifiedSection = document.getElementById('threads-verified-section');
        const verifiedNick = document.getElementById('verified-threads-nick');
        const starBalance = document.getElementById('threads-star-balance');

        if (userData?.threads_verified && userData?.threads_username) {
            linkBtn?.classList.add('hidden');
            verifiedSection?.classList.remove('hidden');
            if (starBalance) starBalance.textContent = userData.threads_star_balance || 0;

            const pthreads = document.getElementById('profile-threads-info');
            const pnick = document.getElementById('profile-threads-nick');
            if (pthreads && pnick) {
                pthreads.classList.remove('hidden');
                pnick.textContent = userData.threads_username;
            }
            const ssection = document.getElementById('settings-threads-section');
            const sstatus = document.getElementById('settings-threads-status');
            if (ssection && sstatus) {
                ssection.classList.remove('hidden');
                sstatus.textContent = I18n.t('threads_settings_connected', { nick: userData.threads_username });
            }
        } else {
            linkBtn?.classList.remove('hidden');
            verifiedSection?.classList.add('hidden');
            document.getElementById('profile-threads-info')?.classList.add('hidden');
            document.getElementById('settings-threads-section')?.classList.add('hidden');
        }
    },

    updateLangButtons() {
        // Handled by I18n.apply() called within I18n.setLanguage()
    },

    copyToClipboard(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => {
                this.showToast(I18n.t('copy_success'), 'success');
            }).catch(() => {
                this.fallbackCopyTextToClipboard(text);
            });
        } else {
            this.fallbackCopyTextToClipboard(text);
        }
    },

    fallbackCopyTextToClipboard(text) {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
            document.execCommand('copy');
            this.showToast(I18n.t('copy_success'), 'success');
        } catch (err) {
            this.showToast(I18n.t('copy_error'), 'error');
        }
        document.body.removeChild(textArea);
    },

    // ============================================
    // CHALLENGES
    // ============================================
    challengeTimerInterval: null,
    challengeData: null,

    async checkChallengesEnabled() {
        try {
            const data = await this.apiRequest('get-challenges');
            if (data.success && data.challenges_enabled) {
                document.getElementById('gift-btn')?.classList.remove('hidden');
            } else {
                document.getElementById('gift-btn')?.classList.add('hidden');
            }
        } catch (e) {
            // Silently fail
        }
    },

    openChallenges() {
        TelegramApp.haptic('impact');
        const page = document.getElementById('challenges-page');
        if (page) {
            page.style.display = 'flex';
            setTimeout(() => page.classList.add('active'), 10);
            TelegramApp.showBackButton(() => this.closeChallenges());
            this.loadChallenges();
        }
    },

    closeChallenges() {
        const page = document.getElementById('challenges-page');
        if (page) {
            page.classList.remove('active');
            setTimeout(() => page.style.display = 'none', 400);
        }
        TelegramApp.hideBackButton();
        if (this.challengeTimerInterval) {
            clearInterval(this.challengeTimerInterval);
            this.challengeTimerInterval = null;
        }
    },

    async loadChallenges() {
        const list = document.getElementById('challenges-list');
        if (!list) return;
        list.innerHTML = `<div style="text-align:center;color:var(--text-mutted);padding:20px;">Loading...</div>`;

        try {
            const data = await this.apiRequest('get-challenges');
            if (!data.success) {
                list.innerHTML = `<div style="text-align:center;color:#ef4444;padding:20px;">Error loading challenges</div>`;
                return;
            }
            this.challengeData = data;
            this.renderChallenges(data);
        } catch (e) {
            list.innerHTML = `<div style="text-align:center;color:#ef4444;padding:20px;">${e.message}</div>`;
        }
    },

    renderChallenges(data) {
        const list = document.getElementById('challenges-list');
        if (!list) return;
        list.innerHTML = '';

        const challengeConfigs = [
            { type: 'burn', icon: '🔥', config: data.challenges.burn },
            { type: 'neuroprofiler', icon: '🧠', config: data.challenges.neuroprofiler },
            { type: 'vpn', icon: '🔒', config: data.challenges.vpn },
            { type: 'gamble', icon: '🎲', config: data.challenges.gamble }
        ];

        const fragment = document.createDocumentFragment();

        challengeConfigs.forEach(({ type, icon, config }) => {
            const myActive = data.my_active.find(p => p.challenge_type === type);
            const myHistory = data.my_history.filter(p => p.challenge_type === type);
            const card = this.createChallengeCard(type, icon, config, myActive, myHistory);
            fragment.appendChild(card);
        });

        list.appendChild(fragment);

        if (this.challengeTimerInterval) clearInterval(this.challengeTimerInterval);
        this.challengeTimerInterval = setInterval(() => this.updateChallengeTimers(), 1000);
    },

    createChallengeCard(type, icon, config, myActive, myHistory) {
        const card = document.createElement('div');
        card.className = 'challenge-card';

        const header = document.createElement('div');
        header.className = 'challenge-card-header';

        const iconEl = document.createElement('div');
        iconEl.className = `challenge-icon ${type}`;
        iconEl.textContent = icon;

        const title = document.createElement('div');
        title.className = 'challenge-title';
        title.innerHTML = I18n.t(`challenge_${type}_title`);

        header.appendChild(iconEl);
        header.appendChild(title);
        card.appendChild(header);

        const desc = document.createElement('div');
        desc.className = 'challenge-desc';
        desc.innerHTML = I18n.t(`challenge_${type}_desc`);
        card.appendChild(desc);

        if (type === 'burn') {
            const burnedCount = document.createElement('div');
            burnedCount.className = 'challenge-desc';
            burnedCount.style.marginTop = '8px';
            burnedCount.style.color = 'var(--text-light)';
            burnedCount.textContent = I18n.t('challenge_burn_participants', { count: config.active_participants || 0 });
            card.appendChild(burnedCount);
        }

        if (config.deadline && (new Date(config.deadline).getTime() > Date.now() || myActive)) {
            const timer = document.createElement('div');
            timer.className = 'challenge-timer';
            timer.dataset.expiresAt = config.deadline;
            timer.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg><span class="timer-text">${this.formatCountdown(config.deadline)}</span>`;
            card.appendChild(timer);
        }

        if (myActive) {
            const stakedEl = document.createElement('div');
            stakedEl.className = 'challenge-desc';
            stakedEl.style.fontWeight = '700';
            stakedEl.style.color = 'var(--accent-light)';
            stakedEl.textContent = I18n.t('challenge_staked', { stars: myActive.stars_staked, rating: myActive.rating_staked });
            card.appendChild(stakedEl);

            if (!config.deadline && myActive.expires_at) {
                const timer = document.createElement('div');
                timer.className = 'challenge-timer';
                timer.dataset.expiresAt = myActive.expires_at;
                timer.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg><span class="timer-text">${this.formatCountdown(myActive.expires_at)}</span>`;
                card.appendChild(timer);
            }

            const status = document.createElement('div');
            status.className = 'challenge-status';
            status.textContent = I18n.t('challenge_joined');
            card.appendChild(status);
        } else if (myHistory.length > 0) {
            const last = myHistory[0];
            const statusEl = document.createElement('div');
            statusEl.className = `challenge-status ${last.status}`;
            let statusKey = `challenge_status_${last.status}`;
            if (type === 'burn' && last.status === 'completed') {
                statusKey = 'challenge_status_burn_completed';
            }
            statusEl.textContent = I18n.t(statusKey);
            card.appendChild(statusEl);
        } else if (config.enabled) {
            const btn = this.createJoinButton(type);
            card.appendChild(btn);
        } else {
            const disabled = document.createElement('div');
            disabled.className = 'challenge-disabled-label';
            disabled.textContent = I18n.t('challenge_disabled');
            card.appendChild(disabled);
        }

        return card;
    },

    createJoinButton(type) {
        const btn = document.createElement('button');
        btn.className = 'challenge-join-btn';
        btn.textContent = I18n.t('challenge_join_btn');
        btn.onclick = () => this.joinChallenge(type);
        return btn;
    },

    async joinChallenge(type) {
        const stars = this.userData?.balance || 0;
        const rating = this.challengeData?.my_participant_score || 0;

        if (stars === 0 && rating === 0) {
            this.showToast('challenge_nothing_to_stake', 'error');
            return;
        }

        const confirmText = I18n.t('challenge_confirm', { stars, rating });
        if (!confirm(confirmText)) return;

        TelegramApp.haptic('impact');

        try {
            const data = await this.apiRequest('join-challenge', { challenge_type: type });
            if (data.success) {
                TelegramApp.haptic('success');
                this.showToast('challenge_joined_toast', 'success');

                if (this.userData) {
                    this.userData.balance = 0;
                    this.userData.threads_star_balance = 0;
                    this.updateBalance(0);
                    this.updateProfileUI(this.userData);
                }

                await this.loadChallenges();
            } else {
                const errorKey = data.error || 'Error';
                const translatedError = I18n.t(`challenge_${errorKey}`) !== `challenge_${errorKey}`
                    ? `challenge_${errorKey}`
                    : errorKey;
                this.showToast(translatedError, 'error');
            }
        } catch (e) {
            this.showToast(e.message, 'error');
        }
    },

    formatCountdown(expiresAt) {
        const now = Date.now();
        const end = new Date(expiresAt).getTime();
        const diff = end - now;

        if (diff <= 0) return I18n.t('challenge_status_expired');

        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);

        let timeStr = '';
        if (days > 0) timeStr += `${days}д `;
        timeStr += `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

        return I18n.t('challenge_timer_left', { time: timeStr });
    },

    updateChallengeTimers() {
        let expiredFound = false;
        document.querySelectorAll('.challenge-timer').forEach(timer => {
            const expiresAt = timer.dataset.expiresAt;
            if (!expiresAt) return;
            const end = new Date(expiresAt).getTime();

            if (Date.now() >= end) {
                if (!timer.dataset.hasTriggered) {
                    timer.dataset.hasTriggered = 'true';
                    expiredFound = true;
                    const textEl = timer.querySelector('.timer-text');
                    if (textEl) textEl.textContent = I18n.t('challenge_status_expired');
                }
            } else {
                const textEl = timer.querySelector('.timer-text');
                if (textEl) {
                    textEl.textContent = this.formatCountdown(expiresAt);
                }
            }
        });

        if (expiredFound) {
            setTimeout(() => this.loadChallenges(), 2000);
        }
    },
};

window.App = App;
document.addEventListener('DOMContentLoaded', () => App.init());
