const TelegramApp = {
    webapp: null,
    user: null,
    initData: null,

    init() {
        this.webapp = window.Telegram?.WebApp;

        if (!this.webapp) {
            console.warn('Telegram WebApp not available');
            return false;
        }

        this.webapp.expand();

        if (this.webapp.requestFullscreen) {
            this.webapp.requestFullscreen();
        }

        if (this.webapp.disableVerticalSwipes) {
            this.webapp.disableVerticalSwipes();
        }

        if (this.webapp.setHeaderColor) {
            this.webapp.setHeaderColor('#0a0a1a');
        }

        if (this.webapp.setBackgroundColor) {
            this.webapp.setBackgroundColor('#0a0a1a');
        }

        if (this.webapp.BackButton) {
            this.webapp.BackButton.hide();
        }

        // === НОВОЕ: Кнопка Settings в меню (три точки) ===
        if (this.webapp.SettingsButton) {
            this.webapp.SettingsButton.show();
            this.webapp.SettingsButton.onClick(() => {
                if (typeof App !== 'undefined' && App.openSettings) {
                    App.openSettings();
                }
            });
            console.log('SettingsButton: enabled');
        } else {
            console.log('SettingsButton: not available');
        }

        // Fallback для старых версий Telegram
        this.webapp.onEvent('settingsButtonClicked', () => {
            console.log('settingsButtonClicked event fired');
            if (typeof App !== 'undefined' && App.openSettings) {
                App.openSettings();
            }
        });
        // === КОНЕЦ НОВОГО ===

        this.webapp.ready();

        this.user = this.webapp.initDataUnsafe?.user;
        this.initData = this.webapp.initData;

        console.log('TG WebApp init, version:', this.webapp.version);
        return true;
    },

    haptic(type = 'impact') {
        if (this.webapp?.HapticFeedback) {
            switch (type) {
                case 'impact': this.webapp.HapticFeedback.impactOccurred('medium'); break;
                case 'success': this.webapp.HapticFeedback.notificationOccurred('success'); break;
                case 'error': this.webapp.HapticFeedback.notificationOccurred('error'); break;
                case 'warning': this.webapp.HapticFeedback.notificationOccurred('warning'); break;
            }
        }
    },

    showAlert(message) {
        if (this.webapp?.showAlert) {
            this.webapp.showAlert(message);
        } else {
            alert(message);
        }
    },

    showConfirm(message, callback) {
        if (this.webapp?.showConfirm) {
            this.webapp.showConfirm(message, callback);
        } else {
            callback(confirm(message));
        }
    },

    openInvoice(url, callback) {
        if (this.webapp?.openInvoice) {
            this.webapp.openInvoice(url, (status) => {
                if (callback) callback(status);
            });
        } else {
            if (callback) callback('paid');
        }
    },

    // === НОВОЕ: Управление кнопкой "Назад" ===
    showBackButton(callback) {
        if (this.webapp?.BackButton) {
            this.webapp.BackButton.show();
            this.webapp.BackButton.offClick();
            this.webapp.BackButton.onClick(callback);
        }
    },

    hideBackButton() {
        if (this.webapp?.BackButton) {
            this.webapp.BackButton.hide();
            this.webapp.BackButton.offClick();
        }
    },
    // === КОНЕЦ НОВОГО ===

    getInitData() {
        return this.initData || '';
    }
};