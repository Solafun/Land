const crypto = require('crypto');
const fetch = require('node-fetch');
const supabase = require('./_lib/supabase');

// ============================================
// TELEGRAM VERIFICATION
// ============================================
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const MAX_AUTH_AGE = 86400;

function verifyTelegramData(initData) {
    if (!initData) return null;

    try {
        const urlParams = new URLSearchParams(initData);
        const hash = urlParams.get('hash');
        urlParams.delete('hash');

        const authDate = parseInt(urlParams.get('auth_date'));
        if (!authDate || (Date.now() / 1000 - authDate) > MAX_AUTH_AGE) return null;

        const dataCheckString = Array.from(urlParams.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, value]) => `${key}=${value}`)
            .join('\n');

        if (!BOT_TOKEN) {
            console.error('CRITICAL: TELEGRAM_BOT_TOKEN is not set');
            return null;
        }

        const secretKey = crypto.createHmac('sha256', 'WebAppData')
            .update(BOT_TOKEN)
            .digest();

        const calculatedHash = crypto.createHmac('sha256', secretKey)
            .update(dataCheckString)
            .digest('hex');

        if (calculatedHash !== hash) return null;

        const userStr = urlParams.get('user');
        return userStr ? JSON.parse(userStr) : null;
    } catch (error) {
        console.error('verifyTelegramData error:', error);
        return null;
    }
}

// ============================================
// UTILITIES
// ============================================
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
// THREADS: Profile check
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
        if (!html || html.length < 100 || response.status === 404) {
            return { exists: false, username, avatar: null };
        }

        let avatar = null;
        let ogMatch = html.match(/property="og:image"\s+content="([^"]+)"/) ||
            html.match(/content="([^"]+)"\s+property="og:image"/);

        if (ogMatch) {
            const ogImage = ogMatch[1].replace(/&amp;/g, '&');
            const isPlaceholder = (
                ogImage.includes('threads-logo') ||
                ogImage.includes('default_avatar') ||
                ogImage.includes('44884218_345707372676790') ||
                ogImage.includes('instagram_silhouette') ||
                ogImage.includes('static.cdninstagram.com/rsrc') ||
                /\/rsrc\.php\//.test(ogImage)
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
// INIT & USER DATA
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

// ============================================
// Helper: get map points (no zeros)
// ============================================
async function getMapPoints() {
    const { data, error } = await supabase
        .from('users')
        .select('id, lat, lng, threads_username, threads_avatar_url')
        .not('lat', 'is', null)
        .not('lng', 'is', null)
        .neq('lat', 0)
        .neq('lng', 0)
        .limit(200);

    if (error) {
        console.error('getMapPoints error:', error);
        return [];
    }

    return (data || []).map(u => ({
        id: u.id,
        lat: parseFloat(u.lat),
        lng: parseFloat(u.lng),
        nickname: u.threads_username,
        avatar_url: u.threads_avatar_url
    }));
}

// ============================================
// HANDLERS
// ============================================
async function handleInitApp(req, res, user) {
    try {
        const userData = await getInternalUserData(user);
        const points = await getMapPoints();

        return res.status(200).json({
            success: true,
            ...userData,
            nearby: [],
            points,
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

async function searchThreads(req, res, user) {
    const { nickname } = req.body;
    const clean = nickname.replace(/^@/, '').trim().toLowerCase();

    const { data: existing } = await supabase
        .from('users')
        .select('id, threads_username, threads_avatar_url')
        .eq('threads_username', clean)
        .single();

    const threadResult = await fetchFromThreads(clean);

    if (existing) {
        return res.status(200).json({
            success: true,
            found: true,
            already_exists: true,
            nickname: existing.threads_username,
            avatar_url: existing.threads_avatar_url || threadResult.avatar
        });
    }

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

async function addParticipant(req, res, user) {
    const { nickname } = req.body;
    const clean = nickname.replace(/^@/, '').trim().toLowerCase();

    const { data: existing } = await supabase
        .from('participants')
        .select('id')
        .eq('nickname', clean)
        .single();

    if (existing) {
        return res.status(200).json({ success: false, error: 'already_exists' });
    }

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
    const { data, error } = await supabase.rpc('toggle_subscription', {
        p_subscriber_id: user.id,
        p_target_username: username
    });
    if (error) return res.status(500).json({ success: false, error: 'Database error' });
    return res.status(200).json(data);
}

async function checkSubscription(req, res, user) {
    const { username } = req.body;
    const { data, error } = await supabase.rpc('check_subscription', {
        p_subscriber_id: user.id,
        p_target_username: username
    });
    if (error) return res.status(500).json({ success: false, error: 'Database error' });
    return res.status(200).json({ success: true, subscribed: data });
}

async function saveNickname(req, res, user) {
    const { nickname } = req.body;
    if (!nickname) return res.status(400).json({ success: false, error: 'Nickname required' });
    const clean = nickname.replace(/^@/, '').trim().toLowerCase();

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
// LOCATION
// ============================================
async function updateLocation(req, res, user) {
    const { lat, lng } = req.body;

    console.log(`[updateLocation] Raw input: lat=${lat}, lng=${lng}, user=${user.id}`);

    if (lat === undefined || lat === null || lng === undefined || lng === null) {
        return res.status(400).json({ success: false, error: 'Coordinates required' });
    }

    const parsedLat = parseFloat(lat);
    const parsedLng = parseFloat(lng);

    if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)) {
        console.warn(`[updateLocation] NaN coordinates for user ${user.id}`);
        return res.status(400).json({ success: false, error: 'Invalid coordinates (NaN)' });
    }

    if (parsedLat === 0 && parsedLng === 0) {
        console.warn(`[updateLocation] Rejected zero coordinates for user ${user.id}`);
        return res.status(400).json({ success: false, error: 'Invalid coordinates (zero)' });
    }

    if (parsedLat < -90 || parsedLat > 90 || parsedLng < -180 || parsedLng > 180) {
        return res.status(400).json({ success: false, error: 'Coordinates out of range' });
    }

    console.log(`[updateLocation] Valid coords: ${parsedLat}, ${parsedLng} for user ${user.id}`);

    try {
        // Reverse geocoding
        let country = 'Earth';
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000);

            const geoRes = await fetch(
                `https://nominatim.openstreetmap.org/reverse?format=json&lat=${parsedLat}&lon=${parsedLng}&zoom=10&addressdetails=1`,
                {
                    headers: { 'User-Agent': 'LandApp/1.0' },
                    signal: controller.signal
                }
            );
            clearTimeout(timeoutId);

            if (geoRes.ok) {
                const geoData = await geoRes.json();
                const addr = geoData.address;
                const city = addr.city || addr.town || addr.village || addr.suburb || addr.city_district || addr.county;
                const countryName = addr.country;
                if (city && countryName) {
                    country = `${city}, ${countryName}`;
                } else {
                    country = countryName || addr.state || addr.region ||
                        geoData.display_name?.split(',').pop().trim() || 'Earth';
                }
            }
        } catch (e) {
            console.warn('Country lookup failed:', e.message);
        }

        // Update location via RPC (4-argument version)
        const { data, error } = await supabase.rpc('update_location_and_get_nearby', {
            p_user_id: user.id,
            p_lat: parsedLat,
            p_lng: parsedLng,
            p_country: country
        });

        if (error) {
            console.error('RPC update_location error:', error);
            throw error;
        }

        // Get map points
        const points = await getMapPoints();

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

        console.log(`[updateLocation] Success. Points: ${points.length}, Nearby: ${nearby.length}`);

        return res.status(200).json({
            success: true,
            userId: user.id,
            nearby,
            points,
            country
        });
    } catch (error) {
        console.error('updateLocation CRITICAL error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}

async function handleGetMapPoints(req, res, user) {
    try {
        const points = await getMapPoints();

        return res.status(200).json({
            success: true,
            userId: user.id,
            nearby: [],
            points
        });
    } catch (error) {
        console.error('getMapPoints error:', error);
        return res.status(500).json({ success: false, error: 'Database error' });
    }
}

async function getNearbyHandler(req, res, user) {
    const { lat, lng } = req.body;

    const parsedLat = (lat !== undefined && lat !== null) ? parseFloat(lat) : null;
    const parsedLng = (lng !== undefined && lng !== null) ? parseFloat(lng) : null;

    const hasValidCoords = (
        Number.isFinite(parsedLat) &&
        Number.isFinite(parsedLng) &&
        !(parsedLat === 0 && parsedLng === 0) &&
        parsedLat >= -90 && parsedLat <= 90 &&
        parsedLng >= -180 && parsedLng <= 180
    );

    console.log(`[getNearby] user=${user.id}, hasValidCoords=${hasValidCoords}, lat=${parsedLat}, lng=${parsedLng}`);

    try {
        let nearby = [];

        if (hasValidCoords) {
            const { data, error } = await supabase.rpc('update_location_and_get_nearby', {
                p_user_id: user.id,
                p_lat: parsedLat,
                p_lng: parsedLng,
                p_country: 'Earth'
            });
            if (!error) nearby = data || [];
        } else {
            // No valid coords — get users from DB without updating position
            const { data: userData } = await supabase
                .from('users')
                .select('lat, lng')
                .eq('id', user.id)
                .single();

            const savedLat = userData?.lat ? parseFloat(userData.lat) : null;
            const savedLng = userData?.lng ? parseFloat(userData.lng) : null;
            const hasSavedCoords = (
                Number.isFinite(savedLat) &&
                Number.isFinite(savedLng) &&
                !(savedLat === 0 && savedLng === 0)
            );

            if (hasSavedCoords) {
                console.log(`[getNearby] Using saved coords for user ${user.id}: ${savedLat}, ${savedLng}`);
            }

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

        const points = await getMapPoints();

        return res.status(200).json({ success: true, nearby: nearbyMapped, points });
    } catch (error) {
        console.error('getNearby error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}

// ============================================
// MAIN HANDLER
// ============================================
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

        let user = verifyTelegramData(body.initData);

        // Automation bypass for testing
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
            case 'init-app':
                return await handleInitApp(req, res, user);
            case 'init-user':
                return await initUser(req, res, user);
            case 'update-location':
                return await updateLocation(req, res, user);
            case 'get-nearby':
                return await getNearbyHandler(req, res, user);
            case 'get-map-users':
                return await handleGetMapPoints(req, res, user);
            case 'search-threads':
                return await searchThreads(req, res, user);
            case 'add-participant':
                return await addParticipant(req, res, user);
            case 'toggle-subscription':
                return await toggleSubscription(req, res, user);
            case 'check-subscription':
                return await checkSubscription(req, res, user);
            case 'save-nickname':
                return await saveNickname(req, res, user);
            default:
                return res.status(400).json({ success: false, error: 'Unknown action' });
        }
    } catch (error) {
        console.error('MAIN HANDLER ERROR:', error);
        return res.status(500).json({ success: false, error: 'Internal Server Error', details: error.message });
    }
};
