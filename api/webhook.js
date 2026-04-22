const crypto = require('crypto');
const fetch = require('node-fetch');
const supabase = require('./_lib/supabase');
const { createStarsInvoice, sendMessage, notifySubscribers } = require('./_lib/bot');


const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map(id => parseInt(id.trim())).filter(Boolean);

async function handler(req, res) {
    if (req.method !== 'POST') return res.status(200).send('OK');

    const secretHeader = req.headers['x-telegram-bot-api-secret-token'];
    if (WEBHOOK_SECRET && secretHeader !== WEBHOOK_SECRET) {
        console.warn('Invalid webhook secret');
        return res.status(403).send('Forbidden');
    }

    try {
        const update = req.body;

        if (update.pre_checkout_query) {
            await answerPreCheckout(update.pre_checkout_query.id, true);
            return res.status(200).json({ ok: true });
        }

        if (update.message?.successful_payment) {
            await handleSuccessfulPayment(update.message);
            return res.status(200).json({ ok: true });
        }

        if (update.message?.text) {
            const chatId = update.message.chat.id;
            const userId = update.message.from.id;
            const text = update.message.text.trim();

            if (text === '/start') {
                const lang = update.message.from?.language_code || 'en';
                await sendStartMessage(chatId, lang);
                return res.status(200).json({ ok: true });
            }

            if (text === '/admin' && isAdmin(userId)) {
                await sendAdminPanel(chatId);
                return res.status(200).json({ ok: true });
            }

            if (text === '/stats' && isAdmin(userId)) {
                await sendStats(chatId);
                return res.status(200).json({ ok: true });
            }

            if (text.startsWith('/broadcast ') && isAdmin(userId)) {
                const broadcastText = text.substring('/broadcast '.length).trim();
                if (broadcastText) await startBroadcast(chatId, broadcastText);
                return res.status(200).json({ ok: true });
            }

            if (text.startsWith('/broadcast_lang ') && isAdmin(userId)) {
                const parts = text.substring('/broadcast_lang '.length).trim();
                const spaceIdx = parts.indexOf(' ');
                if (spaceIdx > 0) {
                    const lang = parts.substring(0, spaceIdx);
                    const broadcastText = parts.substring(spaceIdx + 1).trim();
                    if (broadcastText) await startBroadcast(chatId, broadcastText, lang);
                }
                return res.status(200).json({ ok: true });
            }

            if (text === '/users' && isAdmin(userId)) {
                await sendUsersByLanguage(chatId);
                return res.status(200).json({ ok: true });
            }
        }

        if (update.callback_query) {
            const callbackData = update.callback_query.data;
            const chatId = update.callback_query.message.chat.id;
            const userId = update.callback_query.from.id;

            if (isAdmin(userId)) {
                if (callbackData === 'admin_stats') await sendStats(chatId);
                else if (callbackData === 'admin_users') await sendUsersByLanguage(chatId);
                else if (callbackData === 'admin_recent') await sendRecentActivity(chatId);
            }

            await callTelegram('answerCallbackQuery', {
                callback_query_id: update.callback_query.id
            });

            return res.status(200).json({ ok: true });
        }

        return res.status(200).json({ ok: true });
    } catch (error) {
        console.error('Webhook error:', error);
        return res.status(200).json({ ok: true });
    }
}

function isAdmin(userId) {
    return ADMIN_IDS.includes(userId);
}

async function callTelegram(method, params) {
    try {
        const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params)
        });
        return await response.json();
    } catch (e) {
        console.error(`Telegram API error (${method}):`, e);
        return null;
    }
}

// sendMessage is now imported from _lib/bot


async function answerPreCheckout(queryId, isOk) {
    await callTelegram('answerPreCheckoutQuery', {
        pre_checkout_query_id: queryId,
        ok: isOk
    });
}

async function handleSuccessfulPayment(message) {
    const payment = message.successful_payment;
    const userId = message.from.id;

    try {
        const payload = JSON.parse(payment.invoice_payload);
        const transactionId = payload.transaction_id;

        if (!transactionId) {
            console.error('No transaction_id in payload');
            return;
        }

        // Завершаем транзакцию (начисляем баланс)
        const { data, error } = await supabase.rpc('complete_deposit', {
            p_transaction_id: transactionId,
            p_user_id: userId,
            p_amount: payment.total_amount,
            p_telegram_payment_id: payment.telegram_payment_charge_id,
            p_provider_payment_id: payment.provider_payment_charge_id || 'stars'
        });

        if (error) {
            console.error('DB Payment Error:', error);
            return;
        }

        console.log('Payment processed:', userId, data);

        // Если это paid_spin — сразу выполняем спин
        if (payload.type === 'paid_spin' && payload.participant_id) {
            console.log('[DEBUG] Executing paid spin for user:', userId, 'participant:', payload.participant_id);

            const { data: spinData, error: spinError } = await supabase.rpc('process_paid_spin_simple', {
                p_user_id: userId,
                p_participant_id: parseInt(payload.participant_id)
            });

            if (spinError) {
                console.error('Paid Spin RPC Error:', spinError);
            } else if (spinData?.success) {
                const winnerNick = spinData.winner_nickname;
                console.log('Paid spin successful, winner:', winnerNick);

                // Notify subscribers
                if (winnerNick) {
                    await notifySubscribers(supabase, winnerNick, userId);
                }
            }
        }

        // Уведомляем админов
        for (const adminId of ADMIN_IDS) {
            await sendMessage(adminId,
                `💰 <b>Payment!</b>\n` +
                `👤 User: ${message.from.first_name || ''} (${userId})\n` +
                `⭐ Amount: ${payment.total_amount}\n` +
                `📋 Type: ${payload.type || 'deposit'}`
            );
        }

    } catch (error) {
        console.error('Payment handle error:', error);
    }
}

async function sendStartMessage(chatId, lang = 'en') {
    const APP_URL = process.env.APP_URL || 'https://threadsstars.vercel.app/';
    const isRussian = ['ru', 'uk', 'be', 'kk', 'uz'].includes(lang.toLowerCase());

    const textEn = "⭐️ <b>Threads Stars!</b>\n\n" +
        "Roll and promote your Threads creators! 💅\n\n" +
        "🎯 You have 15 free votes to support them!\n" +
        "🏆 Track your progress on the leaderboard!\n\n" +
        "👇 <b>Tap to play:</b>";

    const textRu = "⭐️ <b>Threads Stars</b>\n\n" +
        "Вращай и продвигай любимых авторов в Threads! 💅\n\n" +
        "🎯 15 бесплатных вращений\n" +
        "🏆 Следи за ростом в таблице лидеров!\n\n" +
        "👇 <b>Жми, чтобы играть:</b>";

    await sendMessage(chatId,
        isRussian ? textRu : textEn,
        {
            reply_markup: {
                inline_keyboard: [[
                    { text: isRussian ? "🎮 Играть" : "🎮 Play Now", web_app: { url: APP_URL } }
                ]]
            }
        }
    );
}

async function sendAdminPanel(chatId) {
    await sendMessage(chatId,
        "🔐 <b>Admin Panel</b>\n\nChoose an action:",
        {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "📊 Statistics", callback_data: "admin_stats" }],
                    [{ text: "👥 Users by Language", callback_data: "admin_users" }],
                    [{ text: "🕐 Recent Activity", callback_data: "admin_recent" }],
                ]
            }
        }
    );

    await sendMessage(chatId,
        "📝 <b>Commands:</b>\n\n" +
        "/stats — Quick statistics\n" +
        "/users — Users by language\n" +
        "/broadcast <i>text</i> — Send to ALL\n" +
        "/broadcast_lang <i>ru text</i> — Send to language\n"
    );
}

async function sendStats(chatId) {
    try {
        const { data, error } = await supabase.rpc('get_admin_stats');
        if (error) {
            await sendMessage(chatId, '❌ Error: ' + error.message);
            return;
        }

        await sendMessage(chatId,
            `📊 <b>Statistics</b>\n\n` +
            `👥 <b>Users</b>\n` +
            `├ Total: <b>${data.total_users}</b>\n` +
            `├ New today: <b>${data.new_users_today}</b>\n` +
            `└ Active today: <b>${data.active_today}</b>\n\n` +
            `🎰 <b>Spins</b>\n` +
            `├ Total: <b>${data.total_spins}</b>\n` +
            `└ Today: <b>${data.spins_today}</b>\n\n` +
            `⭐ <b>Payments</b>\n` +
            `├ Total: <b>${data.total_payments_stars} stars</b>\n` +
            `├ Today: <b>${data.payments_today_stars} stars</b>\n` +
            `└ Count today: <b>${data.payments_today_count}</b>`
        );
    } catch (e) {
        await sendMessage(chatId, '❌ Error: ' + e.message);
    }
}

async function sendUsersByLanguage(chatId) {
    try {
        const { data, error } = await supabase.rpc('get_admin_stats');
        if (error || !data.users_by_language) {
            await sendMessage(chatId, '❌ Error loading data');
            return;
        }

        let msg = '👥 <b>Users by Language</b>\n\n';
        const flags = {
            'ru': '🇷🇺', 'en': '🇺🇸', 'uk': '🇺🇦', 'es': '🇪🇸',
            'fr': '🇫🇷', 'de': '🇩🇪', 'it': '🇮🇹', 'pt': '🇧🇷',
            'tr': '🇹🇷', 'ar': '🇸🇦', 'zh': '🇨🇳', 'ja': '🇯🇵',
            'ko': '🇰🇷', 'pl': '🇵🇱', 'nl': '🇳🇱', 'th': '🇹🇭',
        };

        if (Array.isArray(data.users_by_language)) {
            data.users_by_language.forEach(item => {
                const flag = flags[item.language_code] || '🏳️';
                msg += `${flag} ${item.language_code}: <b>${item.count}</b>\n`;
            });
        }
        msg += `\n📊 Total: <b>${data.total_users}</b>`;
        await sendMessage(chatId, msg);
    } catch (e) {
        await sendMessage(chatId, '❌ Error: ' + e.message);
    }
}

async function sendRecentActivity(chatId) {
    try {
        const { data: recentSpins } = await supabase
            .from('spins')
            .select('user_id, participant_nickname, was_free, created_at')
            .order('created_at', { ascending: false })
            .limit(10);

        const { data: recentPayments } = await supabase
            .from('transactions')
            .select('user_id, amount, status, created_at')
            .order('created_at', { ascending: false })
            .eq('status', 'completed')
            .limit(5);

        let msg = '🕐 <b>Recent Activity</b>\n\n🎰 <b>Last Spins:</b>\n';

        if (recentSpins?.length > 0) {
            recentSpins.forEach(spin => {
                const time = new Date(spin.created_at).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
                msg += `${spin.was_free ? '🆓' : '⭐'} ${time} — @${spin.participant_nickname}\n`;
            });
        } else {
            msg += 'No spins yet\n';
        }

        msg += '\n💰 <b>Last Payments:</b>\n';
        if (recentPayments?.length > 0) {
            recentPayments.forEach(p => {
                const time = new Date(p.created_at).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
                msg += `⭐ ${time} — ${p.amount} stars (user ${p.user_id})\n`;
            });
        } else {
            msg += 'No payments yet\n';
        }

        await sendMessage(chatId, msg);
    } catch (e) {
        await sendMessage(chatId, '❌ Error: ' + e.message);
    }
}

async function startBroadcast(adminChatId, text, languageCode = null) {
    await sendMessage(adminChatId, '📤 Starting broadcast...');

    let offset = 0;
    let sent = 0;
    let failed = 0;
    let blocked = 0;
    const batchSize = 30;

    while (true) {
        const { data, error } = await supabase.rpc('get_users_for_broadcast', {
            p_language_code: languageCode,
            p_limit: batchSize,
            p_offset: offset
        });

        if (error || !data.users || data.users.length === 0) break;

        for (const user of data.users) {
            try {
                const result = await callTelegram('sendMessage', {
                    chat_id: user.id,
                    text: text,
                    parse_mode: 'HTML'
                });

                if (result?.ok) {
                    sent++;
                } else if (result?.error_code === 403) {
                    blocked++;
                    await supabase.from('users').update({ is_blocked: true }).eq('id', user.id);
                } else {
                    failed++;
                }
            } catch (e) {
                failed++;
            }
            await new Promise(r => setTimeout(r, 35));
        }

        offset += batchSize;
    }

    const langNote = languageCode ? ` (${languageCode})` : ' (all)';
    await sendMessage(adminChatId,
        `✅ <b>Broadcast done${langNote}</b>\n📨 Sent: ${sent}\n❌ Failed: ${failed}\n🚫 Blocked: ${blocked}`
    );
}

module.exports = handler;