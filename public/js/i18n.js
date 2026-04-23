const I18n = {
    currentLang: 'en',
    translations: {
        en: {
            nav_map: 'Map', nav_nearby: 'Nearby', nav_profile: 'Profile',
            nearby_title: 'People Nearby',
            loading_assets: 'Loading assets...',
            no_users_nearby: 'No users nearby',
            profile_title: 'My Profile',
            profile_no_spins: 'No history yet',
            verify_modal_title: 'Verify Threads',
            verify_found_msg: 'Profile found!',
            verify_success: 'Verified!',
            verify_only_success: 'You are all set!',
            maintenance_title: 'Maintenance',
            maintenance_text: 'Station is under construction',
            blocked_title: 'Access Denied',
            blocked_text: 'Your account is restricted'
        },
        ru: {
            nav_map: 'Карта', nav_nearby: 'Рядом', nav_profile: 'Профиль',
            nearby_title: 'Люди рядом',
            loading_assets: 'Загрузка...',
            no_users_nearby: 'Никого рядом нет',
            profile_title: 'Профиль',
            profile_no_spins: 'Истории пока нет',
            verify_modal_title: 'Верификация',
            verify_found_msg: 'Профиль найден!',
            verify_success: 'Верифицировано!',
            verify_only_success: 'Всё готово!',
            maintenance_title: 'Техработы',
            maintenance_text: 'Ведутся технические работы',
            blocked_title: 'Доступ закрыт',
            blocked_text: 'Ваш аккаунт заблокирован'
        }
    },
    init() {
        const tgLang = window.Telegram?.WebApp?.initDataUnsafe?.user?.language_code;
        this.currentLang = (tgLang && this.translations[tgLang]) ? tgLang : 'en';
        this.apply();
    },
    t(key, params = {}) {
        let text = this.translations[this.currentLang]?.[key] || this.translations['en']?.[key] || key;
        Object.keys(params).forEach(p => { text = text.replace(`{${p}}`, params[p]); });
        return text;
    },
    setLanguage(lang) {
        this.currentLang = lang;
        this.apply();
    },
    apply() {
        document.querySelectorAll('[data-i18n]').forEach(el => { el.innerHTML = this.t(el.getAttribute('data-i18n')); });
    }
};
window.I18n = I18n;