const I18n = {
    currentLang: 'en',
    translations: {
        en: {
            nav_map: 'Map', nav_nearby: 'Nearby', nav_profile: 'Profile',
            nearby_title: 'People Nearby',
            loading_assets: "Loading assets...",
            no_users_nearby: "No users nearby yet",
            location_access_denied: "Location access denied",
            profile_title: 'My Profile',
            profile_location: 'Location',
            profile_joined: 'Joined',
            settings_title: 'Settings', 
            settings_language_title: 'Language', 
            settings_theme_title: 'Theme', 
            theme_light: 'Light', 
            theme_auto: 'Auto', 
            theme_dark: 'Dark',
            copy_success: 'Copied!', 
            copy_error: 'Copy failed',
            error_title: 'Error',
            'Success!': 'Success!',
            'Request failed': 'Request failed',
            'Database error': 'Database error',
            'Failed to initialize app data': 'Failed to initialize app data',
            'Unauthorized: Invalid Telegram InitData': 'Unauthorized: Invalid Telegram InitData',
            'nickname_taken': 'This nickname is already in use by another user'
        },
        ru: {
            nav_map: 'Карта', nav_nearby: 'Рядом', nav_profile: 'Профиль',
            nearby_title: 'Люди рядом',
            loading_assets: "Загрузка ресурсов...",
            no_users_nearby: "Поблизости пока никого нет",
            location_access_denied: "Доступ к геопозиции запрещен",
            profile_title: 'Мой профиль',
            profile_location: 'Местоположение',
            profile_joined: 'Регистрация',
            settings_title: 'Настройки', 
            settings_language_title: 'Язык', 
            settings_theme_title: 'Тема', 
            theme_light: 'Светлая', 
            theme_auto: 'Авто', 
            theme_dark: 'Темная',
            copy_success: 'Скопировано!', 
            copy_error: 'Ошибка копирования',
            error_title: 'Ошибка',
            'Success!': 'Успешно!',
            'Request failed': 'Ошибка запроса',
            'Database error': 'Ошибка базы данных',
            'Failed to initialize app data': 'Ошибка инициализации приложения',
            'Unauthorized: Invalid Telegram InitData': 'Ошибка авторизации',
            'nickname_taken': 'Этот никнейм уже используется другим пользователем'
        }
    },

    init() {
        const saved = localStorage.getItem('app_language');
        if (saved && this.translations[saved]) this.currentLang = saved;
        else {
            const tgLang = window.Telegram?.WebApp?.initDataUnsafe?.user?.language_code;
            if (tgLang && this.translations[tgLang]) this.currentLang = tgLang;
        }
        this.apply();
    },

    t(key, params = {}) {
        let text = this.translations[this.currentLang]?.[key] || this.translations['en']?.[key] || key;
        Object.keys(params).forEach(p => { text = text.replace(`{${p}}`, params[p]); });
        return text;
    },

    setLanguage(lang) {
        if (!this.translations[lang]) return;
        this.currentLang = lang;
        localStorage.setItem('app_language', lang);
        this.apply();
    },

    apply() {
        document.querySelectorAll('[data-i18n]').forEach(el => { el.innerHTML = this.t(el.getAttribute('data-i18n')); });
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            el.placeholder = this.t(el.getAttribute('data-i18n-placeholder'));
        });
        document.querySelectorAll('.lang-option').forEach(opt => {
            const isSelected = opt.dataset.lang === this.currentLang;
            opt.classList.toggle('selected', isSelected);
            const check = opt.querySelector('.lang-check');
            if (check) check.style.display = isSelected ? 'inline' : 'none';
        });
    }
};

window.I18n = I18n;