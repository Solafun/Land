const crypto = require('crypto');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const MAX_AUTH_AGE = 86400; // 24 часа

function verifyTelegramData(initData) {
    if (!initData) {
        console.warn('verifyTelegramData: initData is missing');
        return null;
    }

    try {
        const urlParams = new URLSearchParams(initData);
        const hash = urlParams.get('hash');
        urlParams.delete('hash');

        const authDate = parseInt(urlParams.get('auth_date'));
        if (!authDate || (Date.now() / 1000 - authDate) > MAX_AUTH_AGE) {
            console.warn('verifyTelegramData: Auth data expired');
            return null;
        }

        const dataCheckString = Array.from(urlParams.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, value]) => `${key}=${value}`)
            .join('\n');

        if (!BOT_TOKEN) {
            console.error('CRITICAL ERROR: TELEGRAM_BOT_TOKEN is not set in Environment Variables!');
            return null;
        }

        const secretKey = crypto.createHmac('sha256', 'WebAppData')
            .update(BOT_TOKEN)
            .digest();

        const calculatedHash = crypto.createHmac('sha256', secretKey)
            .update(dataCheckString)
            .digest('hex');

        if (calculatedHash !== hash) {
            console.warn('verifyTelegramData: Hash mismatch');
            return null;
        }

        const userStr = urlParams.get('user');
        return userStr ? JSON.parse(userStr) : null;

    } catch (error) {
        console.error('verifyTelegramData: Parsing error:', error);
        return null;
    }
}

// Экспортируем функцию строгим и надежным способом
module.exports = {
    verifyTelegramData
};