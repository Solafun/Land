const fetch = require('node-fetch');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

async function callTelegramAPI(method, params = {}) {
    const response = await fetch(`${TELEGRAM_API}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
    });

    const data = await response.json();

    if (!data.ok) {
        console.error('Telegram API error:', data);
        throw new Error(data.description || 'Telegram API error');
    }

    return data.result;
}

async function createStarsInvoice(userId, amount, payload) {
    return await callTelegramAPI('createInvoiceLink', {
        title: `${amount} ⭐ Stars`,
        description: `Top up balance with ${amount} stars`,
        payload: JSON.stringify({
            ...payload
        }),

        provider_token: '',
        currency: 'XTR',
        prices: [{ label: `${amount} Stars`, amount: amount }]
    });
}

async function sendMessage(chatId, text, extra = {}) {
    return await callTelegramAPI('sendMessage', {
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML',
        ...extra
    });
}

async function notifySubscribers(supabase, winnerNick, excludingUserId) {
    try {
        const { data: subscribers } = await supabase.rpc('get_subscribers_to_notify', {
            p_username: winnerNick
        });

        if (subscribers && subscribers.length > 0) {
            for (const sub of subscribers) {
                if (sub.subscriber_id !== excludingUserId) {
                    const lang = sub.language_code || 'en';
                    const isRussian = ['ru', 'uk', 'be', 'kk', 'uz'].includes(lang.toLowerCase());

                    // Construct deep link to leaderboard
                    const botLink = `https://t.me/ThreadsStarsBot/app?startapp=leaderboard`;

                    const text = isRussian
                        ? `🔔 Кто-то сделал спин. <a href="${botLink}">@${winnerNick}</a> +1 звезда!`
                        : `🔔 Someone made a spin. <a href="${botLink}">@${winnerNick}</a> +1 star!`;

                    await sendMessage(sub.subscriber_id, text);
                }
            }
        }
    } catch (e) {
        console.error('Notify error:', e);
    }
}

module.exports = { callTelegramAPI, createStarsInvoice, sendMessage, notifySubscribers };