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
            'Unauthorized: Invalid Telegram InitData': 'Unauthorized: Invalid Telegram InitData',
            'nickname_taken': 'This nickname is already in use by another user',
            'add_enter_username': 'Please enter a username',
            'add_searching': 'Searching...',
            'add_not_found': 'User @{nick} not found on Threads',
            'error_search_failed': 'Search failed. Try again',
            'add_already_score': 'Score: {score} | Rank: {rank}',
            'add_found': 'Found on Threads!',
            'add_button': 'Add to Nearby',
            'add_success': '@{nick} added!',
            'error_not_on_threads': '@{nick} not found or private',
            'sub_btn_subscribe': 'Follow',
            'sub_btn_unsubscribe': 'Unfollow',
            'sub_subscribed': 'Following!',
            'sub_unsubscribed': 'Unfollowed'
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
            'Unauthorized: Invalid Telegram InitData': 'Ошибка авторизации',
            'nickname_taken': 'Этот никнейм уже используется другим пользователем',
            'add_enter_username': 'Введите никнейм',
            'add_searching': 'Поиск...',
            'add_not_found': 'Пользователь @{nick} не найден в Threads',
            'error_search_failed': 'Ошибка поиска. Попробуйте еще раз',
            'add_already_score': 'Счет: {score} | Ранг: {rank}',
            'add_found': 'Найден в Threads!',
            'add_button': 'Добавить в «Рядом»',
            'add_success': '@{nick} добавлен!',
            'error_not_on_threads': '@{nick} не найден или профиль скрыт',
            'sub_btn_subscribe': 'Подписаться',
            'sub_btn_unsubscribe': 'Отписаться',
            'sub_subscribed': 'Вы подписались!',
            'sub_unsubscribed': 'Вы отписались'
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