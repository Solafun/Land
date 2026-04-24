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

async function reverseGeocode(lat, lng) {
    let country = 'Earth';
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);

        const geoRes = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10&addressdetails=1`, {
            headers: { 'User-Agent': 'LandApp/1.0' },
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (geoRes.ok) {
            const geoData = await geoRes.json();
            const addr = geoData.address;
            const city = addr.city || addr.town || addr.village || addr.suburb || addr.city_district || addr.county;
            const countryName = addr.country;
            if (city && countryName) {
                country = `${city}, ${countryName}`;
            } else {
                country = countryName || addr.state || addr.region || (geoData.display_name ? geoData.display_name.split(',').pop().trim() : 'Earth');
            }
        }
    } catch (e) {
        console.warn('Country lookup failed:', e.message);
    }
    return country;
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

        let avatar = null;
        let ogMatch = html.match(/property="og:image"\s+content="([^"]+)"/);
        if (!ogMatch) ogMatch = html.match(/content="([^"]+)"\s+property="og:image"/);

        if (ogMatch) {
            const ogImage = ogMatch[1].replace(/&amp;/g, '&');
            const isPlaceholder = (
                ogImage.includes('threads-logo') ||
                ogImage.includes('default_avatar') ||
                ogImage.includes('44884218_345707372676790') ||
                ogImage.includes('instagram_silhouette') ||
                ogImage.includes('static.cdninstagram.com/rsrc') ||
                (/\/rsrc\.php\//.test(ogImage))
            );
            if (!isPlaceholder) avatar = ogImage;
        }

        let profileConfirmed = false;
        const titleMatch = html.match(/property="og:title"\s+content="([^"]+)"/) ||
            html.match(/content="([^"]+)"\s+property="og:title"/);
        if (titleMatch) {
            const title = titleMatch[1].toLowerCase();
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
async function getInternalUserData(user) {
    const languageCode = user.language_code || 'en';

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
            updated_at: new Date().toISOString()
        }, { onConflict: 'id' })
        .select()
        .single();

    if (userError) throw userError;

    if (userData.is_blocked === true) {
        appMode = 'blocked';
    } else if (getSetting('open_for_verified') === true && userData.threads_verified === true) {
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
            threads_avatar_url: userData.threads_avatar_url,
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

async function handleInitApp(req, res, user) {
    try {
        const userData = await getInternalUserData(user);

        const { data: pointsRes } = await supabase
            .from('users')
            .select('id, lat, lng, threads_username, threads_avatar_url')
            .not('lat', 'is', null)
            .not('lng', 'is', null)
            // FIX: Exclude zero coordinates from map points
            .neq('lat', 0)
            .neq('lng', 0)
            .limit(200);

        const points = (pointsRes || []).map(u => ({
            id: u.id,
            lat: parseFloat(u.lat),
            lng: parseFloat(u.lng),
            nickname: u.threads_username,
            avatar_url: u.threads_avatar_url
        }));

        return res.status(200).json({
            success: true,
            ...userData,
            nearby: [],
            points: points,
            leaderboard: []
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
                if (balanceData.participant?.nickname) {
                    await notifySubscribers(supabase, balanceData.participant.nickname, user.id);
                }
                return res.status(200).json(balanceData);
            } else {
                const errorDetail = balanceData?.error || 'Internal error';
                console.log(`[SPIN] Internal balance spin failed for ${user.id}: ${errorDetail}`);
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

    // 1. Check users table
    const { data: existingUser } = await supabase
        .from('users')
        .select('id, threads_username, threads_avatar_url, country')
        .eq('threads_username', clean)
        .maybeSingle();

    if (existingUser) {
        return res.status(200).json({
            success: true,
            found: true,
            already_exists: true,
            nickname: existingUser.threads_username,
            avatar_url: existingUser.threads_avatar_url,
            country: existingUser.country
        });
    }

    // 2. Check participants table
    const { data: existingParticipant } = await supabase
        .from('participants')
        .select('id, nickname, avatar_url')
        .eq('nickname', clean)
        .maybeSingle();

    if (existingParticipant) {
        return res.status(200).json({
            success: true,
            found: true,
            already_exists: true,
            nickname: existingParticipant.nickname,
            avatar_url: existingParticipant.avatar_url
        });
    }

    // 3. Fallback to scraping Threads
    const threadResult = await fetchFromThreads(clean);
    if (threadResult.exists) {
        return res.status(200).json({
            success: true,
            found: true,
            already_exists: false,
            nickname: clean,
            avatar_url: threadResult.avatar
        });
    }

    return res.status(200).json({ success: true, found: false, nickname: clean });
}

async function getUserProfile(req, res, user) {
    const { username } = req.body;
    const clean = username.replace(/^@/, '').trim().toLowerCase();

    const { data: userData } = await supabase
        .from('users')
        .select('id, username, threads_username, threads_avatar_url, threads_verified')
        .or(`threads_username.eq.${clean},username.eq.${clean}`)
        .single();

    if (!userData) return res.status(200).json({ success: false, error: 'User not found' });

    return res.status(200).json({
        success: true,
        user: {
            id: userData.id,
            nickname: userData.threads_username || userData.username,
            avatar_url: userData.threads_avatar_url,
            verified: userData.threads_verified
        }
    });
}

async function addParticipant(req, res, user) {
    const { nickname } = req.body;
    const clean = nickname.replace(/^@/, '').trim().toLowerCase();

    const { data: existing } = await supabase.from('participants').select('id').eq('nickname', clean).single();
    if (existing) return res.status(200).json({ success: false, error: 'already_exists' });

    const threadResult = await fetchFromThreads(clean);
    if (!threadResult.exists || !threadResult.avatar) {
        return res.status(200).json({ success: false, error: 'no_threads_profile' });
    }

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

async function saveNickname(req, res, user) {
    const { nickname } = req.body;
    if (!nickname) return res.status(400).json({ success: false, error: 'Nickname required' });
    const clean = nickname.replace(/^@/, '').trim().toLowerCase();

    // Check if nickname is already taken by another user
    const { data: existingUser } = await supabase
        .from('users')
        .select('id')
        .eq('threads_username', clean)
        .neq('id', user.id)
        .maybeSingle();

    if (existingUser) {
        return res.status(200).json({ success: false, error: 'nickname_taken' });
    }

    const threadResult = await fetchFromThreads(clean);
    const avatarUrl = threadResult.exists ? threadResult.avatar : null;

    const { error } = await supabase.from('users').update({
        threads_username: clean,
        threads_avatar_url: avatarUrl,
        threads_verified: true,
        verification_status: 'verified'
    }).eq('id', user.id);

    if (error) {
        console.error('saveNickname error:', error);
        return res.status(500).json({ success: false, error: 'Database error' });
    }

    return res.status(200).json({ success: true, avatar_url: avatarUrl });
}


// ============================================
// CHALLENGES
// ============================================
const CHALLENGE_DURATIONS = {
    gamble: 15 * 24 * 60 * 60 * 1000,
    neuroprofiler: 24 * 60 * 60 * 1000,
    vpn: 7 * 24 * 60 * 60 * 1000,
    burn: 0
};

async function getChallenges(req, res, user) {
    try {
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

        const GLOBAL_DEADLINES = {
            neuroprofiler: "2026-04-01T00:00:00Z",
            vpn: "2026-04-01T00:00:00Z"
        };

        const gambleDeadline = getStrSetting('challenge_gamble_deadline');
        const nowIso = new Date().toISOString();

        let shouldResolveGamble = false;
        if (gambleDeadline) {
            const expireTime = new Date(gambleDeadline).getTime();
            if (Date.now() >= expireTime) {
                shouldResolveGamble = true;
            }
        } else {
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

        const { error: updateErr } = await supabase
            .from('challenge_participants')
            .update({ status: 'completed', resolved_at: nowIso })
            .eq('user_id', user.id)
            .eq('status', 'active')
            .in('challenge_type', ['neuroprofiler', 'vpn'])
            .lte('expires_at', nowIso);

        if (updateErr) console.error('Auto-resolve neuro/vpn error:', updateErr);

        const tasks = [
            supabase.from('challenge_participants').select('*').eq('user_id', user.id).eq('status', 'active').order('created_at', { ascending: false }),
            supabase.from('challenge_participants').select('*').eq('user_id', user.id).neq('status', 'active').order('created_at', { ascending: false }).limit(5),
            supabase.from('challenge_participants').select('id', { count: 'exact', head: true }).eq('challenge_type', 'gamble').eq('status', 'active'),
            supabase.from('challenge_participants').select('id', { count: 'exact', head: true }).eq('challenge_type', 'neuroprofiler').eq('status', 'active'),
            supabase.from('challenge_participants').select('id', { count: 'exact', head: true }).eq('challenge_type', 'vpn').eq('status', 'active'),
            supabase.from('challenge_participants').select('id', { count: 'exact', head: true }).eq('challenge_type', 'burn')
        ];

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

        const { data: userData, error: userError } = await supabase
            .from('users')
            .select('balance, threads_username')
            .eq('id', user.id)
            .single();

        if (userError || !userData) {
            return res.status(500).json({ success: false, error: 'User not found' });
        }

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

        if (challenge_type !== 'burn') {
            if ((userData.balance || 0) < 10 || (ratingToStake || 0) < 10) {
                return res.status(200).json({ success: false, error: 'minimum_10' });
            }
        }

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

        const { error: updateError } = await supabase
            .from('users')
            .update({ balance: 0 })
            .eq('id', user.id);

        if (updateError) {
            console.error('joinChallenge deduct stars error:', updateError);
            return res.status(500).json({ success: false, error: 'Failed to deduct balance' });
        }

        if (participantId) {
            await supabase
                .from('participants')
                .update({ score: 0, stars_earned: 0 })
                .eq('id', participantId);
        }

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
            expiresAt = new Date(Date.now() + (CHALLENGE_DURATIONS[challenge_type] || 0)).toISOString();
        }

        if (expiresAt && new Date(expiresAt).getTime() <= Date.now() && challenge_type !== 'burn') {
            return res.status(200).json({ success: false, error: 'challenge_expired' });
        }

        const status = challenge_type === 'burn' ? 'completed' : 'active';
        const resolvedAt = challenge_type === 'burn' ? new Date().toISOString() : null;

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

    const shuffled = [...participants].sort(() => Math.random() - 0.5);
    const halfIndex = Math.ceil(shuffled.length / 2);
    const winners = shuffled.slice(0, halfIndex);
    const losers = shuffled.slice(halfIndex);

    const now = new Date().toISOString();

    for (const w of winners) {
        const { data: currentUser } = await supabase
            .from('users')
            .select('balance, threads_username')
            .eq('id', w.user_id)
            .single();

        if (currentUser) {
            await supabase.from('users').update({
                balance: (currentUser.balance || 0) + (w.stars_staked * 2)
            }).eq('id', w.user_id);

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

// ============================================
// FIX: updateLocation — защита от нулевых координат
// ============================================
async function updateLocation(req, res, user) {
    const { lat, lng } = req.body;

    // Базовая проверка наличия координат
    if (lat === undefined || lat === null || lng === undefined || lng === null) {
        return res.status(400).json({ success: false, error: 'Coordinates required' });
    }

    const parsedLat = parseFloat(lat);
    const parsedLng = parseFloat(lng);

    // FIX: Отклоняем нулевые и невалидные координаты — они портят данные в БД
    if (isNaN(parsedLat) || isNaN(parsedLng)) {
        return res.status(400).json({ success: false, error: 'Invalid coordinates (NaN)' });
    }
    if (parsedLat === 0 && parsedLng === 0) {
        console.warn(`[updateLocation] Rejected zero coordinates for user ${user.id}`);
        return res.status(400).json({ success: false, error: 'Invalid coordinates (zero)' });
    }
    if (parsedLat < -90 || parsedLat > 90 || parsedLng < -180 || parsedLng > 180) {
        return res.status(400).json({ success: false, error: 'Coordinates out of range' });
    }

    try {
        const country = await reverseGeocode(parsedLat, parsedLng);

        const { data, error } = await supabase.rpc('update_location_and_get_nearby', {
            p_user_id: user.id,
            p_lat: parsedLat,
            p_lng: parsedLng,
            p_country: country
        });

        if (error) {
            console.error('RPC update_location_and_get_nearby error:', error);
            throw error;
        }

        // Backup: обновляем плоские колонки lat/lng
        try {
            await supabase
                .from('users')
                .update({
                    lat: parsedLat,
                    lng: parsedLng,
                    updated_at: new Date().toISOString()
                })
                .eq('id', user.id);
        } catch (e) {
            // Колонки могут не существовать — не критично
        }

        // FIX: Исключаем нулевые координаты из выборки точек для карты
        const { data: pointsRes, error: pointsError } = await supabase
            .from('users')
            .select('id, lat, lng, threads_username, threads_avatar_url')
            .not('lat', 'is', null)
            .not('lng', 'is', null)
            .neq('lat', 0)
            .neq('lng', 0)
            .limit(200);

        if (pointsError) console.error('Points fetch error:', pointsError);
        console.log(`Points raw count: ${(pointsRes || []).length}`);

        const points = (pointsRes || []).map(u => ({
            id: u.id,
            lat: parseFloat(u.lat),
            lng: parseFloat(u.lng),
            nickname: u.threads_username,
            avatar_url: u.threads_avatar_url
        }));

        console.log(`Points count: ${points.length}, user.id: ${user.id}`);

        const nearbyUsersRaw = data || [];
        const nearby = (Array.isArray(nearbyUsersRaw) ? nearbyUsersRaw : []).map(u => ({
            id: u.id,
            threads_username: u.threads_username,
            threads_avatar_url: u.threads_avatar_url,
            distance_meters: u.distance_meters,
            lat: u.lat,
            lng: u.lng,
            country: u.country
        }));

        return res.status(200).json({
            success: true,
            userId: user.id,
            nearby,
            points,
            country: country || 'Unknown'
        });
    } catch (error) {
        console.error('updateLocation CRITICAL error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}

async function getMapPoints(req, res, user) {
    try {
        const { data, error } = await supabase.rpc('get_map_users');
        if (error) throw error;

        // FIX: Исключаем нулевые координаты из выборки
        const { data: pointsRes } = await supabase
            .from('users')
            .select('id, lat, lng, threads_username, threads_avatar_url')
            .not('lat', 'is', null)
            .not('lng', 'is', null)
            .neq('lat', 0)
            .neq('lng', 0)
            .limit(200);

        const points = (pointsRes || []).map(u => ({
            id: u.id,
            lat: parseFloat(u.lat),
            lng: parseFloat(u.lng),
            nickname: u.threads_username,
            avatar_url: u.threads_avatar_url
        }));

        return res.status(200).json({
            success: true,
            userId: user.id,
            nearby: data,
            points
        });
    } catch (error) {
        console.error('getMapPoints error:', error);
        return res.status(500).json({ success: false, error: 'Database error' });
    }
}

// ============================================
// FIX: getNearbyHandler — защита от нулевых координат
// ============================================
async function getNearbyHandler(req, res, user) {
    const { lat, lng } = req.body;

    const parsedLat = lat !== undefined && lat !== null ? parseFloat(lat) : null;
    const parsedLng = lng !== undefined && lng !== null ? parseFloat(lng) : null;

    // FIX: Валидные ненулевые координаты — используем RPC с обновлением позиции
    const hasValidCoords = (
        parsedLat !== null &&
        parsedLng !== null &&
        !isNaN(parsedLat) &&
        !isNaN(parsedLng) &&
        !(parsedLat === 0 && parsedLng === 0)
    );

    try {
        let nearby = [];

        if (hasValidCoords) {
            // Координаты валидные — обновляем позицию и получаем ближайших
            const country = await reverseGeocode(parsedLat, parsedLng);
            const { data, error } = await supabase.rpc('update_location_and_get_nearby', {
                p_user_id: user.id,
                p_lat: parsedLat,
                p_lng: parsedLng,
                p_country: country
            });
            if (!error) nearby = (data || []);
        } else {
            // FIX: Координат нет или они нулевые — НЕ обновляем позицию в БД,
            // просто берём последние известные координаты пользователя из базы
            const { data: userData } = await supabase
                .from('users')
                .select('lat, lng')
                .eq('id', user.id)
                .single();

            const savedLat = userData?.lat ? parseFloat(userData.lat) : null;
            const savedLng = userData?.lng ? parseFloat(userData.lng) : null;

            if (savedLat && savedLng && savedLat !== 0 && savedLng !== 0) {
                // Есть сохранённые координаты — используем их для поиска ближайших
                // Но НЕ вызываем update_location_and_get_nearby чтобы не перезаписать координаты
                const { data: recent } = await supabase
                    .from('users')
                    .select('id, threads_username, threads_avatar_url, lat, lng, country')
                    .not('lat', 'is', null)
                    .not('lng', 'is', null)
                    .neq('lat', 0)
                    .neq('lng', 0)
                    .neq('id', user.id)
                    .limit(20);
                nearby = (recent || []).map(u => ({ ...u, distance_meters: null }));
            } else {
                // Вообще нет координат — возвращаем последних активных пользователей
                const { data: recent } = await supabase
                    .from('users')
                    .select('id, threads_username, threads_avatar_url, lat, lng, country')
                    .not('lat', 'is', null)
                    .not('lng', 'is', null)
                    .neq('lat', 0)
                    .neq('lng', 0)
                    .limit(20);
                nearby = (recent || []).map(u => ({ ...u, distance_meters: null }));
            }
        }

        const nearbyMapped = nearby.map(u => ({
            id: u.id,
            threads_username: u.threads_username,
            threads_avatar_url: u.threads_avatar_url,
            distance_meters: u.distance_meters ?? null,
            lat: u.lat,
            lng: u.lng,
            country: u.country
        }));

        // ADDITION: Include participants who are not in users table yet
        const { data: discovered } = await supabase
            .from('participants')
            .select('id, nickname, avatar_url, created_at')
            .order('created_at', { ascending: false })
            .limit(10);

        const mergedNearby = [...nearbyMapped];
        if (discovered && discovered.length > 0) {
            const userNicks = new Set(nearbyMapped.map(u => u.threads_username));
            discovered.forEach(p => {
                if (!userNicks.has(p.nickname)) {
                    mergedNearby.push({
                        id: `p_${p.id}`,
                        threads_username: p.nickname,
                        threads_avatar_url: p.avatar_url,
                        distance_meters: null,
                        is_participant: true,
                        country: 'Threads'
                    });
                }
            });
        }

        // FIX: Исключаем нулевые координаты из точек карты
        const { data: pointsRes } = await supabase
            .from('users')
            .select('id, lat, lng, threads_username, threads_avatar_url')
            .not('lat', 'is', null)
            .not('lng', 'is', null)
            .neq('lat', 0)
            .neq('lng', 0)
            .limit(200);

        const points = (pointsRes || []).map(u => ({
            id: u.id,
            lat: parseFloat(u.lat),
            lng: parseFloat(u.lng),
            nickname: u.threads_username,
            avatar_url: u.threads_avatar_url
        }));

        return res.status(200).json({ success: true, nearby: mergedNearby, points });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}


module.exports = async function handler(req, res) {
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

        if (action === 'leaderboard') return await getLeaderboard(req, res);

        let user = verifyTelegramData(body.initData);

        const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
        const providedBypass = req.headers['x-vercel-protection-bypass'] || req.query?.['x-vercel-protection-bypass'];

        if (!user && bypassSecret && providedBypass === bypassSecret) {
            console.log('Automation Bypass triggered');
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

        console.log(`[ACTION] ${action} | User: @${user.username || user.id} | At: ${new Date().toISOString()}`);

        switch (action) {
            case 'init-app': return await handleInitApp(req, res, user);
            case 'init-user': return await initUser(req, res, user);
            case 'get-nearby': return await getNearbyHandler(req, res, user);
            case 'search-threads': return await searchThreads(req, res, user);
            case 'add-participant': return await addParticipant(req, res, user);
            case 'toggle-subscription': return await toggleSubscription(req, res, user);
            case 'check-subscription': return await checkSubscription(req, res, user);
            case 'save-nickname': return await saveNickname(req, res, user);
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
