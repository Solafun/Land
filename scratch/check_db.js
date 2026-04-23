
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
    const { data, error } = await supabase.from('users').select('*').limit(1);
    if (error) {
        console.error('Error fetching user:', error);
    } else {
        console.log('User columns:', Object.keys(data[0] || {}));
    }
}

check();
