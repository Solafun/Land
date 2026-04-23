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
            if (window.Telegram?.WebApp?.openLink) window.Telegram.WebApp.openLink(webUrl);
            else window.open(webUrl, '_blank');
        } else {
            const finalUrl = url.replace('threads.net', 'threads.com');
            if (window.Telegram?.WebApp?.openLink) window.Telegram.WebApp.openLink(finalUrl);
            else window.open(finalUrl, '_blank');
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
        
        if (this.userData && this.userData.app_mode) this.setAppMode(this.userData.app_mode);
        if (this.appMode === 'active') this.startLocationTracking();

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
        document.getElementById('maintenance-stub')?.classList.toggle('hidden', mode !== 'maintenance');
        document.getElementById('verification-stub')?.classList.toggle('hidden', mode !== 'verify_only');
        document.getElementById('blocked-stub')?.classList.toggle('hidden', mode !== 'blocked');
        document.getElementById('main-app-content')?.classList.toggle('hidden', mode !== 'active');

        if (mode === 'maintenance' || mode === 'verify_only' || mode === 'blocked') {
            document.querySelector('.clay-nav')?.classList.add('hidden');
            if (mode === 'verify_only' && this.userData?.threads_verified) this.showVerificationOnlySuccess();
            else if (mode === 'verify_only') this.initStandaloneVerify();
        } else {
            document.querySelector('.clay-nav')?.classList.remove('hidden');
        }
    },

    bindEvents() {
        document.querySelectorAll('.nav-item').forEach(btn => {
            btn.addEventListener('click', (e) => { e.preventDefault(); this.switchTab(btn.dataset.tab); });
        });

        document.getElementById('spin-btn')?.addEventListener('click', () => this.spin());

        document.getElementById('focus-my-location')?.addEventListener('click', () => {
            if (this.currentLat && this.currentLng && this.earthMap) {
                this.earthMap.focusUser(this.currentLat, this.currentLng);
            }
        });

        // Legacy search and verify events (RESTORED)
        document.getElementById('search-btn')?.addEventListener('click', () => this.searchUser());
        document.getElementById('verify-search-btn')?.addEventListener('click', () => this.searchThreadsForVerify());
        document.getElementById('verify-publish-btn')?.addEventListener('click', () => this.openThreadsPublish());
        document.getElementById('verify-check-btn')?.addEventListener('click', () => this.checkVerification());

        // iOS Active State Fix
        document.body.addEventListener('touchstart', (e) => {
            const btn = e.target.closest('button, .clay-btn, .clay-icon-btn, .nav-item, .clay-list-item, .modal-close');
            if (btn && !btn.disabled) btn.classList.add('is-active');
        }, { passive: true });

        document.body.addEventListener('touchend', (e) => {
            const btn = e.target.closest('button, .clay-btn, .clay-icon-btn, .nav-item, .clay-list-item, .modal-close');
            if (btn) btn.classList.remove('is-active');
        }, { passive: true });
    },

    switchTab(tabId) {
        TelegramApp.haptic('impact');
        document.activeElement?.blur();
        document.querySelectorAll('.nav-item').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabId));
        document.querySelectorAll('.tab-content').forEach(tab => tab.classList.toggle('active', tab.id === `${tabId}-tab`));
        this.currentTab = tabId;
        if (tabId === 'nearby') this.loadNearby(this.nearbyLoaded);
        if (tabId === 'map' && this.earthMap) this.earthMap.onWindowResize();
    },

    async spin() {
        // Full original spin logic
        try {
            const data = await this.apiRequest('spin-wheel');
            if (data.success) { this.showSpinResult(data.participant); return; }
        } catch (error) { this.showToast(error.message, 'error'); }
    },

    async loadInitialData() {
        try {
            const data = await this.apiRequest('init-app');
            if (data.success) {
                this.userData = data.user;
                this.updateProfileUI(data.user);
            }
        } catch (error) { console.error('Init error:', error); }
    },

    async apiRequest(action, data = {}) {
        const response = await fetch('/api/action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ initData: TelegramApp.getInitData(), action, ...data })
        });
        return await response.json();
    },

    startLocationTracking() {
        if (!navigator.geolocation) return;
        navigator.geolocation.getCurrentPosition((pos) => {
            this.updateUserLocation(pos.coords.latitude, pos.coords.longitude);
        });
    },

    async updateUserLocation(lat, lng) {
        this.currentLat = lat; this.currentLng = lng;
        const data = await this.apiRequest('update-location', { lat, lng });
        if (data.success) {
            if (data.country) document.getElementById('location-text').textContent = `Location: ${data.country}`;
            if (data.nearby) this.renderNearbyList(data.nearby);
            if (data.points && this.earthMap) this.earthMap.setPoints(data.points, data.userId || this.userData?.id);
            const count = document.getElementById('active-users-count');
            if (count && data.points) count.textContent = data.points.length;
        }
    },

    renderNearbyList(nearby) {
        const list = document.getElementById('nearby-list');
        if (!list || !Array.isArray(nearby)) return;
        list.innerHTML = '';
        nearby.forEach(user => {
            const el = document.createElement('div');
            el.className = 'clay-list-item';
            const dist = user.distance_km ? `${user.distance_km.toFixed(1)} km` : '...';
            el.innerHTML = `<div class="leaderboard-item-link">
                <div class="item-avatar">${user.avatar_url ? `<img src="${user.avatar_url}">` : '👤'}</div>
                <div class="item-info"><div class="item-nick">@${user.username}</div><div class="distance-badge">${dist}</div></div>
            </div>`;
            list.appendChild(el);
        });
    },

    updateProfileUI(user) {
        const un = document.getElementById('user-name');
        if (un) un.textContent = user.first_name;
    },

    updateLangButtons() {
        document.querySelectorAll('.lang-option').forEach(opt => {
            opt.classList.toggle('selected', opt.dataset.lang === I18n.currentLang);
        });
    },
    
    showToast(msg, type) { console.log('Toast:', msg, type); }
};

window.App = App;
window.addEventListener('DOMContentLoaded', () => App.init());