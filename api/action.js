const crypto = require('crypto');
const fetch = require('node-fetch');
const supabase = require('./_lib/supabase');
const { createStarsInvoice, notifySubscribers } = require('./_lib/bot');


// ============================================
// ВСТРОЕННАЯ ПРОВЕРКА TELEGRAM (БЕЗ ИМПОРТОВ)
// ============================================
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

// ============================================
// UTILITIES
// ============================================
function secureRandomInt(min, max) {
    return crypto.randomInt(min, max);
}

function generateVerificationCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'STARS-';
    for (let i = 0; i < 6; i++) code += chars[crypto.randomInt(0, chars.length)];
    return code;
}

function getLocaleFromLanguage(langCode) {
    const map = {
        'ru': 'Russia / CIS', 'uk': 'Ukraine', 'be': 'Belarus',
        'kk': 'Kazakhstan', 'uz': 'Uzbekistan', 'en': 'English Speaking',
        'es': 'Spain / Latin America', 'pt': 'Portugal / Brazil',
        'fr': 'France / French Speaking', 'de': 'Germany / DACH',
        'it': 'Italy', 'tr': 'Turkey', 'ar': 'Arabic Speaking',
        'hi': 'India', 'zh': 'China', 'ja': 'Japan', 'ko': 'Korea',
    };
    return map[langCode] || 'Other';
}

// ============================================
// THREADS: Парсинг профиля
// ============================================
async function fetchFromThreads(username) {
    const url = `https://www.threads.com/@${username}`;
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
            },
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        const html = await response.text();
        if (!html || html.length < 100 || response.status === 404) return { exists: false, username, avatar: null };

        // --- Avatar extraction ---
        let avatar = null;
        let ogMatch = html.match(/property="og:image"\s+content="([^"]+)"/);
        if (!ogMatch) ogMatch = html.match(/content="([^"]+)"\s+property="og:image"/);

        if (ogMatch) {
            const ogImage = ogMatch[1].replace(/&amp;/g, '&');

            // Filter out known placeholder/default avatar patterns:
            // 1. threads-logo images are obviously the brand logo
            // 2. default_avatar / blank profile pictures from Meta CDN
            // 3. 44884218_345707372676790 — this is Meta's universal default avatar asset ID
            const isPlaceholder = (
                ogImage.includes('threads-logo') ||
                ogImage.includes('default_avatar') ||
                ogImage.includes('44884218_345707372676790') ||
                ogImage.includes('instagram_silhouette') ||
                ogImage.includes('static.cdninstagram.com/rsrc') ||
                // Generic Meta CDN path with no user-specific hash (very short path)
                (/\/rsrc\.php\//.test(ogImage))
            );

            if (!isPlaceholder) avatar = ogImage;
        }

        // --- Profile existence confirmation ---
        // Non-existent profiles on Threads still return 200 with a generic page.
        // Real profiles have their username in og:title AND a real avatar.
        let profileConfirmed = false;
        const titleMatch = html.match(/property="og:title"\s+content="([^"]+)"/) ||
            html.match(/content="([^"]+)"\s+property="og:title"/);
        if (titleMatch) {
            const title = titleMatch[1].toLowerCase();
            // Real profile: title contains the username or their display name (not just generic Threads)
            profileConfirmed = title !== 'threads' && !title.includes('log in') && title.length > 3;
        }

        const exists = response.status === 200 && !!avatar && profileConfirmed;
        return { exists, username, avatar };
    } catch (error) {
        return { exists: false, username, avatar: null };
    }
}

// ============================================
// HANDLERS
// ============================================
// --- REUSABLE CORE LOGIC ---
async function getInternalUserData(user) {
    const languageCode = user.language_code || 'en';

    // Fetch app mode from settings
    const { data: settings } = await supabase
        .from('app_settings')
        .select('key, value');

    const getSetting = (key) => settings?.find(s => s.key === key)?.value;

    let appMode = 'active';
    if (getSetting('maintenance_enabled') === true) appMode = 'maintenance';
    else if (getSetting('verification_only_enabled') === true) appMode = 'verify_only';

    const { data: userData, error: userError } = await supabase
        .from('users')
        .upsert({
            id: user.id,
            username: user.username || null,
            first_name: user.first_name || 'User',
            last_name: user.last_name || null,
            language_code: languageCode,
            locale: getLocaleFromLanguage(languageCode),
            is_premium: user.is_premium || false,
            last_active_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        }, { onConflict: 'id' })
        .select()
        .single();

    if (userError) throw userError;

    // Blocked status overrides everything else
    if (userData.is_blocked === true) {
        appMode = 'blocked';
    }
    // If 'open_for_verified' is enabled, verified users get full access regardless of other modes
    else if (getSetting('open_for_verified') === true && userData.threads_verified === true) {
        appMode = 'active';
    }

    const { data: history } = await supabase
        .from('spins')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20);

    return {
        user: {
            id: userData.id,
            first_name: userData.first_name,
            last_name: userData.last_name,
            username: userData.username,
            threads_username: userData.threads_username || null,
            threads_verified: userData.threads_verified || false,
            verification_code: userData.verification_code || null,
            verification_status: userData.verification_status || 'none',
            country: userData.country || null,
            is_blocked: userData.is_blocked || false,
            app_mode: appMode
        },
        history: history || []
    };
}

async function getInternalLeaderboard(limit = 50, offset = 0) {
    const { data, error } = await supabase.rpc('get_leaderboard', {
        p_limit: limit,
        p_offset: offset
    });

    if (error) throw error;
    return data.leaderboard || data;
}

// --- HANDLERS ---
async function handleInitApp(req, res, user) {
    try {
        const userData = await getInternalUserData(user);

        return res.status(200).json({
            success: true,
            ...userData,
            leaderboard: [] // Return empty list for now
        });
    } catch (error) {
        console.error('Init App Error:', error);
        return res.status(500).json({ success: false, error: 'Failed to initialize app data' });
    }
}

async function initUser(req, res, user) {
    try {
        const data = await getInternalUserData(user);
        return res.status(200).json({ success: true, ...data });
    } catch (error) {
        console.error('User upsert error:', error);
        return res.status(500).json({ success: false, error: 'Database error while saving user' });
    }
}

async function getLeaderboard(req, res) {
    try {
        return res.status(200).json({ success: true, leaderboard: [] });
    } catch (error) {
        console.error('Leaderboard error:', error);
        return res.status(500).json({ success: false, error: 'Database error' });
    }
}

async function spinWheel(req, res, user) {
    try {
        console.log(`[SPIN] User ${user.id} attempting spin...`);
        let { data, error } = await supabase.rpc('process_spin_auto', {
            p_user_id: user.id
        });

        const { data: userCheck, error: checkError } = await supabase
            .from('users')
            .select('balance, threads_star_balance')
            .eq('id', user.id)
            .single();

        console.log(`[DIAGNOSTIC] User ${user.id} balance in DB:`, userCheck);

        // If auto spin (free) says we need payment, it means free spins are exhausted.
        if (data && !data.success && data.need_payment) {
            console.log(`[SPIN] No free spins (Count: ${data.free_spins_left}, Need Payment: ${data.need_payment}) for ${user.id}`);

            if (userCheck && (userCheck.balance > 0 || userCheck.threads_star_balance > 0)) {
                console.log(`[SPIN] User has balance (${userCheck.balance}), trying paid spin...`);
            } else {
                console.log(`[SPIN] User truly has no balance. Internal=${userCheck?.balance}`);
            }
            const { data: balanceData, error: balanceError } = await supabase.rpc('process_paid_spin_from_balance', {
                p_user_id: user.id
            });

            if (balanceError) {
                console.error(`[SPIN] RPC process_paid_spin_from_balance error:`, balanceError);
            }

            if (balanceData && balanceData.success) {
                console.log(`[SPIN] Paid spin from balance successful for ${user.id}`);
                // Notify subscribers for paid spin from balance
                if (balanceData.participant?.nickname) {
                    await notifySubscribers(supabase, balanceData.participant.nickname, user.id);
                }
                return res.status(200).json(balanceData);
            } else {
                const errorDetail = balanceData?.error || 'Internal error';
                console.log(`[SPIN] Internal balance spin failed for ${user.id}: ${errorDetail}`);
                // If it was specifically a balance issue, we return need_payment
                // but if it was something else (like "No participants"), we should show the error.
                if (errorDetail === 'Low balance' || errorDetail === 'No stars') {
                    return res.status(200).json(data);
                }
                return res.status(200).json({ success: false, error: errorDetail });
            }
        }

        if (error) {
            console.error('[SPIN] Auto spin RPC error:', error);
            return res.status(200).json({ success: false, error: 'Cannot spin right now (DB)' });
        }

        // Notify subscribers for free spin
        if (data && data.success && data.participant?.nickname) {
            await notifySubscribers(supabase, data.participant.nickname, user.id);
        }

        return res.status(200).json(data);
    } catch (err) {
        console.error('[SPIN] Unexpected error:', err);
        return res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
}


async function spinPaid(req, res, user) {
    const { count, error: countError } = await supabase
        .from('participants')
        .select('*', { count: 'exact', head: true });

    if (countError || !count || count === 0) {
        return res.status(200).json({ success: false, error: 'No participants available' });
    }

    const randomOffset = secureRandomInt(0, count);
    const { data: participants } = await supabase
        .from('participants')
        .select('id')
        .range(randomOffset, randomOffset)
        .limit(1);

    if (!participants || participants.length === 0) {
        return res.status(500).json({ success: false, error: 'Failed to select participant' });
    }

    // Shorten ID for payload limits (128 chars)
    const transactionId = `s${user.id}_${Date.now()}`;

    const { error: dbError } = await supabase.from('transactions').insert({
        id: transactionId, user_id: user.id, type: 'deposit', amount: 1, status: 'pending'
    });



    if (dbError) return res.status(500).json({ success: false, error: 'Database error' });

    try {
        const invoiceUrl = await createStarsInvoice(user.id, 1, {
            transaction_id: transactionId,
            type: 'paid_spin',
            participant_id: participants[0].id
        });
        return res.status(200).json({ success: true, invoiceUrl: invoiceUrl, transactionId: transactionId });
    } catch (error) {
        return res.status(500).json({ success: false, error: 'Failed to create invoice' });
    }
}

async function createInvoice(req, res, user) {
    const { amount } = req.body;
    if (!amount || amount < 1 || amount > 10000) return res.status(400).json({ success: false, error: 'Invalid amount' });

    const transactionId = `d${user.id}_${Date.now()}`;

    await supabase.from('transactions').insert({
        id: transactionId, user_id: user.id, type: 'deposit', amount: amount, status: 'pending'
    });

    try {
        const invoiceUrl = await createStarsInvoice(user.id, amount, { transaction_id: transactionId, type: 'deposit' });

        return res.status(200).json({ success: true, invoiceUrl, transactionId });
    } catch (error) {
        return res.status(500).json({ success: false, error: 'Failed to create invoice' });
    }
}

async function checkPayment(req, res, user) {
    const { transactionId } = req.body;
    const { data, error } = await supabase.rpc('check_transaction_status', { p_transaction_id: transactionId, p_user_id: user.id });
    if (error) return res.status(500).json({ success: false, error: 'Database error' });
    return res.status(200).json(data);
}

async function searchThreads(req, res, user) {
    const { nickname } = req.body;
    const clean = nickname.replace(/^@/, '').trim().toLowerCase();

    const { data: existing } = await supabase.from('participants').select('id, nickname, avatar_url, score').eq('nickname', clean).single();
    const threadResult = await fetchFromThreads(clean);

    if (existing) {
        if (threadResult.exists && threadResult.avatar && threadResult.avatar !== existing.avatar_url) {
            await supabase.from('participants').update({ avatar_url: threadResult.avatar }).eq('id', existing.id);
        }
        return res.status(200).json({ success: true, found: true, already_exists: true, nickname: clean, avatar_url: threadResult.avatar || existing.avatar_url, score: existing.score });
    }

    if (threadResult.exists) return res.status(200).json({ success: true, found: true, already_exists: false, nickname: clean, avatar_url: threadResult.avatar });
    return res.status(200).json({ success: true, found: false, nickname: clean });
}

async function addParticipant(req, res, user) {
    const { nickname } = req.body;
    const clean = nickname.replace(/^@/, '').trim().toLowerCase();

    // Check if already in the game
    const { data: existing } = await supabase.from('participants').select('id').eq('nickname', clean).single();
    if (existing) return res.status(200).json({ success: false, error: 'already_exists' });

    // Server-side verification: must be a real Threads profile with a real avatar
    const threadResult = await fetchFromThreads(clean);
    if (!threadResult.exists || !threadResult.avatar) {
        return res.status(200).json({ success: false, error: 'no_threads_profile' });
    }

    // Use the freshly fetched avatar (not client-provided, prevents spoofing)
    const { data, error } = await supabase
        .from('participants')
        .insert({ nickname: clean, avatar_url: threadResult.avatar, added_by: user.id })
        .select()
        .single();

    if (error) return res.status(500).json({ success: false, error: 'Database error' });

    return res.status(200).json({ success: true, participant: data });

}

async function toggleSubscription(req, res, user) {
    const { username } = req.body;
    const { data, error } = await supabase.rpc('toggle_subscription', { p_subscriber_id: user.id, p_target_username: username });
    if (error) return res.status(500).json({ success: false, error: 'Database error' });
    return res.status(200).json(data);
}

async function checkSubscription(req, res, user) {
    const { username } = req.body;
    const { data, error } = await supabase.rpc('check_subscription', { p_subscriber_id: user.id, p_target_username: username });
    if (error) return res.status(500).json({ success: false, error: 'Database error' });
    return res.status(200).json({ success: true, subscribed: data });
}

async function startVerification(req, res, user) {
    const { nickname } = req.body;
    if (!nickname) return res.status(400).json({ success: false, error: 'Nickname required' });
    const clean = nickname.replace(/^@/, '').trim().toLowerCase();

    // Check not already claimed by another user
    const { data: existingOwner } = await supabase
        .from('users')
        .select('id')
        .eq('threads_username', clean)
        .neq('id', user.id)
        .single();

    if (existingOwner) {
        return res.status(200).json({ success: false, error: 'already_claimed' });
    }

    // Check Threads profile exists
    const threadResult = await fetchFromThreads(clean);
    if (!threadResult.exists) {
        return res.status(200).json({ success: false, error: 'no_threads_profile' });
    }

    // Generate or reuse existing code
    const { data: existingUser } = await supabase
        .from('users')
        .select('verification_code, threads_username')
        .eq('id', user.id)
        .single();

    // Reuse code if same nickname, else generate new
    let code = existingUser?.verification_code;
    if (!code || existingUser?.threads_username !== clean) {
        code = generateVerificationCode();
    }

    await supabase.from('users').update({
        threads_username: clean,
        verification_code: code,
        verification_status: 'pending'
    }).eq('id', user.id);

    return res.status(200).json({ success: true, code, threads_username: clean });
}

async function checkVerification(req, res, user) {
    // Load user's pending verification data
    const { data: userData } = await supabase
        .from('users')
        .select('threads_username, verification_code, verification_status, threads_verified')
        .eq('id', user.id)
        .single();

    if (!userData?.threads_username || !userData?.verification_code) {
        return res.status(200).json({ success: false, error: 'no_pending_verification' });
    }

    if (userData.threads_verified) {
        return res.status(200).json({ success: true, verified: true, already: true });
    }

    // Fetch Threads profile page and look for the verification code
    const threadResult = await fetchFromThreads(userData.threads_username);
    let codeFound = false;

    if (threadResult.exists) {
        // Also try to fetch the raw HTML to search for the code in posts/bio
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
            const response = await fetch(`https://www.threads.com/@${userData.threads_username}`, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                },
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            const html = await response.text();
            codeFound = html.includes(userData.verification_code);
        } catch (e) {
            codeFound = false;
        }
    }

    if (!codeFound) {
        return res.status(200).json({ success: true, verified: false });
    }

    // Mark as verified
    await supabase.from('users').update({
        threads_verified: true,
        verification_status: 'verified'
    }).eq('id', user.id);

    // Link participant if one exists with this nickname or create new one
    const { data: existingParticipant } = await supabase.from('participants')
        .select('id')
        .eq('nickname', userData.threads_username)
        .single();

    if (existingParticipant) {
        await supabase.from('participants')
            .update({ owner_telegram_id: user.id })
            .eq('id', existingParticipant.id);
    } else if (threadResult.exists && threadResult.avatar) {
        await supabase.from('participants')
            .insert({
                nickname: userData.threads_username,
                avatar_url: threadResult.avatar,
                owner_telegram_id: user.id,
                added_by: user.id
            });
    }

    return res.status(200).json({ success: true, verified: true });
}

async function disconnectThreads(req, res, user) {
    const { error } = await supabase.from('users').update({
        threads_username: null,
        threads_verified: false,
        verification_code: null,
        verification_status: 'none'
    }).eq('id', user.id);

    if (error) {
        console.error('Disconnect Threads error:', error);
        return res.status(500).json({ success: false, error: 'Database error' });
    }

    return res.status(200).json({ success: true });
}

// ============================================
// CHALLENGES
// ============================================
const CHALLENGE_DURATIONS = {
    gamble: 15 * 24 * 60 * 60 * 1000, // 15 days
    neuroprofiler: 24 * 60 * 60 * 1000, // 24 hours
    vpn: 7 * 24 * 60 * 60 * 1000,       // 7 days
    burn: 0                          // Resolved instantly
};

async function getChallenges(req, res, user) {
    try {
        // 1. Get challenge settings and user info concurrently
        const [
            { data: settings },
            { data: userInfo }
        ] = await Promise.all([
            supabase
                .from('app_settings')
                .select('key, value')
                .in('key', [
                    'challenges_enabled',
                    'challenge_gamble_enabled', 'challenge_gamble_deadline',
                    'challenge_neuroprofiler_enabled',
                    'challenge_vpn_enabled',
                    'challenge_burn_enabled'
                ]),
            supabase
                .from('users')
                .select('threads_username')
                .eq('id', user.id)
                .single()
        ]);

        const getSetting = (key) => settings?.find(s => s.key === key)?.value;
        const getStrSetting = (key) => {
            const val = getSetting(key);
            if (typeof val === 'string') return val.replace(/^"|"$/g, '');
            return val;
        };

        const challengesEnabled = getSetting('challenges_enabled') === true;

        // 2. Resolve expired challenges
        // Hardcoded global deadlines
        const GLOBAL_DEADLINES = {
            neuroprofiler: "2026-04-01T00:00:00Z",
            vpn: "2026-04-01T00:00:00Z"
        };

        const gambleDeadline = getStrSetting('challenge_gamble_deadline');
        const nowIso = new Date().toISOString();

        // Auto-resolve gamble if deadline passed or personal fallback expired
        let shouldResolveGamble = false;
        if (gambleDeadline) {
            const expireTime = new Date(gambleDeadline).getTime();
            if (Date.now() >= expireTime) {
                shouldResolveGamble = true;
            }
        } else {
            // Testing fallback: if no deadline set, check if any active gamble has an expired personal timer
            const { data: expiredGambles } = await supabase
                .from('challenge_participants')
                .select('id')
                .eq('challenge_type', 'gamble')
                .eq('status', 'active')
                .lte('expires_at', nowIso)
                .limit(1);
            if (expiredGambles && expiredGambles.length > 0) {
                shouldResolveGamble = true;
            }
        }

        if (shouldResolveGamble) {
            await internalResolveGamble();
        }

        // Auto-resolve personal challenges for THIS user
        const { error: updateErr } = await supabase
            .from('challenge_participants')
            .update({ status: 'completed', resolved_at: nowIso })
            .eq('user_id', user.id)
            .eq('status', 'active')
            .in('challenge_type', ['neuroprofiler', 'vpn'])
            .lte('expires_at', nowIso);

        if (updateErr) console.error('Auto-resolve neuro/vpn error:', updateErr);

        // 3. Main Data Gathering Concurrently
        const tasks = [
            // [0] Active
            supabase.from('challenge_participants').select('*').eq('user_id', user.id).eq('status', 'active').order('created_at', { ascending: false }),
            // [1] History
            supabase.from('challenge_participants').select('*').eq('user_id', user.id).neq('status', 'active').order('created_at', { ascending: false }).limit(5),
            // [2] Gamble count
            supabase.from('challenge_participants').select('id', { count: 'exact', head: true }).eq('challenge_type', 'gamble').eq('status', 'active'),
            // [3] Neuroprofiler count
            supabase.from('challenge_participants').select('id', { count: 'exact', head: true }).eq('challenge_type', 'neuroprofiler').eq('status', 'active'),
            // [4] VPN count
            supabase.from('challenge_participants').select('id', { count: 'exact', head: true }).eq('challenge_type', 'vpn').eq('status', 'active'),
            // [5] Burn count
            supabase.from('challenge_participants').select('id', { count: 'exact', head: true }).eq('challenge_type', 'burn')
        ];

        // [6] Participant Score
        if (userInfo?.threads_username) {
            tasks.push(
                supabase.from('participants').select('score').eq('nickname', userInfo.threads_username).single()
            );
        }

        const results = await Promise.all(tasks);

        const participations = results[0]?.data || [];
        const history = results[1]?.data || [];
        const gambleCount = results[2]?.count || 0;
        const neuroCount = results[3]?.count || 0;
        const vpnCount = results[4]?.count || 0;
        const burnCount = results[5]?.count || 0;

        let myParticipantScore = 0;
        if (tasks.length === 7 && results[6]?.data) {
            myParticipantScore = results[6].data.score || 0;
        }

        return res.status(200).json({
            success: true,
            challenges_enabled: challengesEnabled,
            challenges: {
                gamble: {
                    enabled: getSetting('challenge_gamble_enabled') === true,
                    deadline: gambleDeadline,
                    active_participants: gambleCount,
                },
                neuroprofiler: {
                    enabled: getSetting('challenge_neuroprofiler_enabled') === true,
                    deadline: GLOBAL_DEADLINES.neuroprofiler,
                    active_participants: neuroCount,
                },
                vpn: {
                    enabled: getSetting('challenge_vpn_enabled') === true,
                    deadline: GLOBAL_DEADLINES.vpn,
                    active_participants: vpnCount,
                },
                burn: {
                    enabled: getSetting('challenge_burn_enabled') === true,
                    deadline: null,
                    active_participants: burnCount,
                }
            },
            my_active: participations,
            my_history: history,
            my_participant_score: myParticipantScore
        });
    } catch (error) {
        console.error('getChallenges error:', error);
        return res.status(500).json({ success: false, error: 'Failed to load challenges' });
    }
}

async function joinChallenge(req, res, user) {
    try {
        const { challenge_type } = req.body;
        if (!challenge_type || !['gamble', 'neuroprofiler', 'vpn', 'burn'].includes(challenge_type)) {
            return res.status(400).json({ success: false, error: 'invalid_challenge_type' });
        }

        // Check challenge is enabled and check its deadline
        const { data: settings } = await supabase
            .from('app_settings')
            .select('key, value')
            .in('key', ['challenges_enabled', `challenge_${challenge_type}_enabled`, `challenge_${challenge_type}_deadline`]);

        const getSetting = (key) => settings?.find(s => s.key === key)?.value;
        const getStrSetting = (key) => {
            const val = getSetting(key);
            if (typeof val === 'string') return val.replace(/^"|"$/g, '');
            return val;
        };

        if (getSetting('challenges_enabled') !== true || getSetting(`challenge_${challenge_type}_enabled`) !== true) {
            return res.status(200).json({ success: false, error: 'challenge_disabled' });
        }

        // Get user's current data
        const { data: userData, error: userError } = await supabase
            .from('users')
            .select('balance, threads_username')
            .eq('id', user.id)
            .single();

        if (userError || !userData) {
            return res.status(500).json({ success: false, error: 'User not found' });
        }

        // Get rating from participants table
        let ratingToStake = 0;
        let participantId = null;
        if (userData.threads_username) {
            const { data: participant } = await supabase
                .from('participants')
                .select('id, score')
                .eq('nickname', userData.threads_username)
                .single();
            if (participant) {
                ratingToStake = participant.score || 0;
                participantId = participant.id;
            }
        }

        // 2) Minimum requirement: 10 stars AND 10 rating (except for burn)
        if (challenge_type !== 'burn') {
            if ((userData.balance || 0) < 10 || (ratingToStake || 0) < 10) {
                return res.status(200).json({ success: false, error: 'minimum_10' });
            }
        }

        // Check not already participating in this challenge type (only for non-burn)
        if (challenge_type !== 'burn') {
            const { data: existing } = await supabase
                .from('challenge_participants')
                .select('id')
                .eq('user_id', user.id)
                .eq('challenge_type', challenge_type)
                .eq('status', 'active')
                .limit(1);

            if (existing && existing.length > 0) {
                return res.status(200).json({ success: false, error: 'already_participating' });
            }
        }

        const starsToStake = userData.balance || 0;

        // Deduct stars from user
        const { error: updateError } = await supabase
            .from('users')
            .update({ balance: 0 })
            .eq('id', user.id);

        if (updateError) {
            console.error('joinChallenge deduct stars error:', updateError);
            return res.status(500).json({ success: false, error: 'Failed to deduct balance' });
        }

        // Deduct rating from participants table
        if (participantId) {
            await supabase
                .from('participants')
                .update({ score: 0, stars_earned: 0 })
                .eq('id', participantId);
        }

        // 3) Create participant record
        const GLOBAL_DEADLINES = {
            neuroprofiler: "2026-04-01T00:00:00Z",
            vpn: "2026-04-01T00:00:00Z"
        };

        let expiresAt = null;

        if (GLOBAL_DEADLINES[challenge_type]) {
            expiresAt = GLOBAL_DEADLINES[challenge_type];
        } else if (challenge_type === 'gamble') {
            const rawDeadline = getStrSetting(`challenge_gamble_deadline`);
            expiresAt = rawDeadline ? new Date(rawDeadline).toISOString() : new Date(Date.now() + CHALLENGE_DURATIONS.gamble).toISOString();
        } else {
            // Fallback if deadline not set or personal challenge
            expiresAt = new Date(Date.now() + (CHALLENGE_DURATIONS[challenge_type] || 0)).toISOString();
        }

        // Check if already expired
        if (expiresAt && new Date(expiresAt).getTime() <= Date.now() && challenge_type !== 'burn') {
            return res.status(200).json({ success: false, error: 'challenge_expired' });
        }

        const status = challenge_type === 'burn' ? 'completed' : 'active';
        const resolvedAt = challenge_type === 'burn' ? new Date().toISOString() : null;

        // Insert participation record
        const { data: participation, error: insertError } = await supabase
            .from('challenge_participants')
            .insert({
                user_id: user.id,
                challenge_type,
                stars_staked: starsToStake,
                rating_staked: ratingToStake,
                status: status,
                expires_at: expiresAt,
                resolved_at: resolvedAt
            })
            .select()
            .single();

        if (insertError) {
            // Rollback: restore user balance and participant score
            await supabase.from('users').update({ balance: starsToStake }).eq('id', user.id);
            if (participantId && ratingToStake > 0) {
                await supabase.from('participants').update({ score: ratingToStake }).eq('id', participantId);
            }
            console.error('joinChallenge insert error:', insertError);
            return res.status(500).json({ success: false, error: 'Failed to join challenge' });
        }

        return res.status(200).json({
            success: true,
            participation,
            new_balance: 0,
            new_rating: 0
        });
    } catch (error) {
        console.error('joinChallenge error:', error);
        return res.status(500).json({ success: false, error: 'Internal error' });
    }
}

const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map(id => parseInt(id.trim())).filter(Boolean);

async function internalResolveGamble() {
    const { data: participants, error } = await supabase
        .from('challenge_participants')
        .select('*')
        .eq('challenge_type', 'gamble')
        .eq('status', 'active');

    if (error || !participants || participants.length === 0) {
        return { success: true, count: 0 };
    }

    // Shuffle and split 50/50
    const shuffled = [...participants].sort(() => Math.random() - 0.5);
    const halfIndex = Math.ceil(shuffled.length / 2);
    const winners = shuffled.slice(0, halfIndex);
    const losers = shuffled.slice(halfIndex);

    const now = new Date().toISOString();

    for (const w of winners) {
        // Return doubled stars to users.balance
        const { data: currentUser } = await supabase
            .from('users')
            .select('balance, threads_username')
            .eq('id', w.user_id)
            .single();

        if (currentUser) {
            await supabase.from('users').update({
                balance: (currentUser.balance || 0) + (w.stars_staked * 2)
            }).eq('id', w.user_id);

            // Return doubled rating to participants.score
            if (currentUser.threads_username && w.rating_staked > 0) {
                const { data: participant } = await supabase
                    .from('participants')
                    .select('id, score')
                    .eq('nickname', currentUser.threads_username)
                    .single();

                if (participant) {
                    await supabase.from('participants').update({
                        score: (participant.score || 0) + (w.rating_staked * 2)
                    }).eq('id', participant.id);
                }
            }
        }

        await supabase.from('challenge_participants').update({
            status: 'won',
            resolved_at: now
        }).eq('id', w.id);
    }

    for (const l of losers) {
        await supabase.from('challenge_participants').update({
            status: 'lost',
            resolved_at: now
        }).eq('id', l.id);
    }

    return { success: true, count: participants.length };
}

async function resolveGambleChallenge(req, res, user) {
    // Admin only
    if (!ADMIN_IDS.includes(user.id)) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
    }

    try {
        const result = await internalResolveGamble();
        return res.status(200).json(result);
    } catch (error) {
        console.error('resolveGambleChallenge error:', error);
        return res.status(500).json({ success: false, error: 'Internal error' });
    }
}

async function updateLocation(req, res, user) {
    const { lat, lng } = req.body;
    if (lat === undefined || lng === undefined) return res.status(400).json({ success: false, error: 'Coordinates required' });

    try {
        // Fetch country name via reverse geocoding
        let country = 'Earth';
        try {
            // Using Nominatim as it's more accurate for country/region detection
            const geoRes = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10&addressdetails=1`, {
                headers: { 'User-Agent': 'LandApp/1.0' }
            });
            if (geoRes.ok) {
                const geoData = await geoRes.json();
                const addr = geoData.address;
                const city = addr.city || addr.town || addr.village || addr.suburb || addr.city_district || addr.county;
                const countryName = addr.country;
                if (city && countryName) {
                    country = `${city}, ${countryName}`;
                } else {
                    country = countryName || addr.state || addr.region || geoData.display_name.split(',').pop().trim();
                }
            } else {
                 console.warn('Nominatim error status:', geoRes.status);
            }
        } catch (e) {
            console.warn('Country lookup failed:', e.message);
        }

        const { data, error } = await supabase.rpc('update_location_and_get_nearby', {
            p_user_id: user.id,
            p_lat: parseFloat(lat),
            p_lng: parseFloat(lng),
            p_country: country
        });

        if (error) throw error;

        // Fetch all active users with locations for the globe dots
        const { data: pointsRes } = await supabase
            .from('users')
            .select('id, location')
            .not('location', 'is', null)
            .gte('last_active', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

        const points = (pointsRes || []).map(u => ({
            id: u.id,
            lat: u.location.coordinates[1],
            lng: u.location.coordinates[0]
        }));

        return res.status(200).json({
            success: true,
            nearby: data,
            points,
            country
        });
    } catch (error) {
        console.error('updateLocation error:', error);
        return res.status(500).json({ success: false, error: 'Database error' });
    }
}

async function getMapPoints(req, res, user) {
    try {
        const { data, error } = await supabase.rpc('get_map_users');
        if (error) throw error;

        // Fetch all active users with locations for the globe dots
        const { data: pointsRes } = await supabase
            .from('users')
            .select('id, location')
            .not('location', 'is', null)
            .gte('last_active', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

        const points = (pointsRes || []).map(u => ({
            id: u.id,
            lat: u.location.coordinates[1],
            lng: u.location.coordinates[0]
        }));

        // Return a combined object with success and points
        return res.status(200).json({
            success: true,
            nearby: data, // RPC returns array of nearby users
            points,
            country
        });
    } catch (error) {
        console.error('getMapPoints error:', error);
        return res.status(500).json({ success: false, error: 'Database error' });
    }
}

// ============================================
// MAIN HANDLER
// ============================================
module.exports = async function handler(req, res) {
    // CORS Headers
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method Not Allowed' });

    try {
        const body = req.body || {};
        const action = body.action;

        if (!action) return res.status(400).json({ success: false, error: 'Action required' });

        // Лидерборд - публичный
        if (action === 'leaderboard') return await getLeaderboard(req, res);

        // Авторизация (используем встроенную функцию)
        let user = verifyTelegramData(body.initData);

        // Внедрение Bypass для автоматизации (Vercel Protection Bypass)
        const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
        const providedBypass = req.headers['x-vercel-protection-bypass'] || req.query?.['x-vercel-protection-bypass'];

        if (!user && bypassSecret && providedBypass === bypassSecret) {
            console.log('Automation Bypass triggered');
            // Мок-пользователь для автоматизированных тестов
            user = { 
                id: 1, 
                first_name: 'Automation', 
                last_name: 'Robot', 
                username: 'automation_bot',
                language_code: 'en'
            };
        }

        if (!user) {
            return res.status(401).json({ success: false, error: 'Unauthorized: Invalid Telegram InitData' });
        }

        // Detailed logging for visibility
        console.log(`[ACTION] ${action} | User: @${user.username || user.id} | At: ${new Date().toISOString()}`);

        // Роутинг
        switch (action) {
            case 'init-app': return await handleInitApp(req, res, user);
            case 'init-user': return await initUser(req, res, user);
            case 'search-threads': return await searchThreads(req, res, user);
            case 'add-participant': return await addParticipant(req, res, user);
            case 'toggle-subscription': return await toggleSubscription(req, res, user);
            case 'check-subscription': return await checkSubscription(req, res, user);
            case 'start-verification': return await startVerification(req, res, user);
            case 'check-verification': return await checkVerification(req, res, user);
            case 'disconnect-threads': return await disconnectThreads(req, res, user);
            case 'update-location': return await updateLocation(req, res, user);
            case 'get-map-users': return await getMapPoints(req, res, user);
            default:
                return res.status(400).json({ success: false, error: 'Unknown action' });
        }
    } catch (error) {
        console.error('MAIN HANDLER ERROR:', error);
        return res.status(500).json({ success: false, error: 'Internal Server Error', details: error.message });
    }
};