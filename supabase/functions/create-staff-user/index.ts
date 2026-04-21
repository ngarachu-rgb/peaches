import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const ALLOWED_ROLES = new Set(['developer', 'system_admin']);
const STAFF_ROLES = new Set(['developer', 'system_admin', 'manager', 'cashier', 'chef']);
const HIDDEN_AUTH_EMAIL_DOMAIN = 'poepfebjdnhlszflhqzs.supabase.co';

function jsonResponse(status: number, payload: Record<string, unknown>) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
        }
    });
}

function normalizeUsername(value: unknown) {
    const normalized = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

    if (!normalized) {
        throw new Error('Username is required.');
    }

    return normalized;
}

function normalizeRole(value: unknown) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!STAFF_ROLES.has(normalized)) {
        throw new Error('A valid staff role is required.');
    }
    return normalized;
}

function isMissingColumnError(error: unknown, tableName: string, columnName: string) {
    const message = String((error as { message?: string })?.message || '').toLowerCase();
    return message.includes(`column ${tableName}.${columnName}`) && message.includes('does not exist');
}

async function insertProfileWithFallbacks(
    adminClient: ReturnType<typeof createClient>,
    payloads: Array<Record<string, unknown>>
) {
    let lastError: unknown = null;

    for (const payload of payloads) {
        const { error } = await adminClient.from('profiles').insert([payload]);
        if (!error) {
            return { error: null };
        }

        lastError = error;
        const canRetry =
            isMissingColumnError(error, 'profiles', 'full_name') ||
            isMissingColumnError(error, 'profiles', 'name') ||
            isMissingColumnError(error, 'profiles', 'email') ||
            isMissingColumnError(error, 'profiles', 'username') ||
            isMissingColumnError(error, 'profiles', 'role') ||
            isMissingColumnError(error, 'profiles', 'is_active') ||
            isMissingColumnError(error, 'profiles', 'branch_id');

        if (!canRetry) {
            break;
        }
    }

    return { error: lastError };
}

Deno.serve(async (request) => {
    if (request.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    if (request.method !== 'POST') {
        return jsonResponse(405, { error: 'Method not allowed.' });
    }

    try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
        const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

        if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
            throw new Error('Supabase function environment variables are not configured.');
        }

        const authHeader = request.headers.get('Authorization');
        if (!authHeader) {
            return jsonResponse(401, { error: 'Missing authorization header.' });
        }

        const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
            auth: { persistSession: false, autoRefreshToken: false }
        });

        const token = authHeader.replace(/^Bearer\s+/i, '').trim();
        const { data: authData, error: authError } = await adminClient.auth.getUser(token);
        if (authError || !authData.user) {
            return jsonResponse(401, { error: 'Unable to verify the current session.' });
        }

        const { data: callerProfile, error: callerProfileError } = await adminClient
            .from('profiles')
            .select('*')
            .eq('id', authData.user.id)
            .single();

        if (callerProfileError || !callerProfile) {
            return jsonResponse(403, { error: 'Your profile could not be loaded for staff management.' });
        }

        const callerRole = String(
            callerProfile.role ??
            callerProfile.user_role ??
            callerProfile.access_role ??
            callerProfile.position ??
            ''
        ).trim().toLowerCase();

        if (!ALLOWED_ROLES.has(callerRole)) {
            return jsonResponse(403, { error: 'Only system administrators can create staff users.' });
        }

        const body = await request.json();
        const restaurantId = String(body?.restaurant_id || callerProfile.restaurant_id || '').trim();
        const branchId = body?.branch_id ? String(body.branch_id).trim() : '';
        const username = normalizeUsername(body?.username);
        const fullName = String(body?.full_name || '').trim();
        const role = normalizeRole(body?.role);
        const password = String(body?.password || '');
        const isActive = body?.is_active !== false;

        if (!restaurantId) {
            throw new Error('Restaurant id is required for staff creation.');
        }
        if (!fullName) {
            throw new Error('Full name is required.');
        }
        if (password.length < 6) {
            throw new Error('Initial password must be at least 6 characters.');
        }

        if (callerRole !== 'developer' && String(callerProfile.restaurant_id || '') !== restaurantId) {
            return jsonResponse(403, { error: 'You can only create staff for your own restaurant.' });
        }

        const { data: existingProfile, error: existingProfileError } = await adminClient
            .from('profiles')
            .select('id')
            .eq('username', username)
            .limit(1);

        if (existingProfileError && !isMissingColumnError(existingProfileError, 'profiles', 'username')) {
            return jsonResponse(400, { error: existingProfileError.message });
        }

        if (existingProfile?.length) {
            return jsonResponse(409, { error: 'That username already exists.' });
        }

        const hiddenEmail = `${username}@${HIDDEN_AUTH_EMAIL_DOMAIN}`;
        const { data: newUserData, error: createUserError } = await adminClient.auth.admin.createUser({
            email: hiddenEmail,
            password,
            email_confirm: true,
            user_metadata: {
                username,
                full_name: fullName,
                role,
                restaurant_id: restaurantId,
                branch_id: branchId || null
            },
            app_metadata: {
                role,
                username
            }
        });

        if (createUserError || !newUserData.user?.id) {
            return jsonResponse(400, { error: createUserError?.message || 'Failed to create the auth user.' });
        }

        const profileId = newUserData.user.id;
        const profileInsertAttempts = [
            {
                id: profileId,
                restaurant_id: restaurantId,
                branch_id: branchId || null,
                email: hiddenEmail,
                username,
                full_name: fullName,
                role,
                is_active: isActive
            },
            {
                id: profileId,
                restaurant_id: restaurantId,
                email: hiddenEmail,
                username,
                full_name: fullName,
                role,
                is_active: isActive
            },
            {
                id: profileId,
                restaurant_id: restaurantId,
                username,
                full_name: fullName,
                role,
                is_active: isActive
            },
            {
                id: profileId,
                restaurant_id: restaurantId,
                username,
                role,
                is_active: isActive
            },
            {
                id: profileId,
                restaurant_id: restaurantId,
                role,
                is_active: isActive
            },
            {
                id: profileId,
                restaurant_id: restaurantId
            }
        ];

        const { error: profileInsertError } = await insertProfileWithFallbacks(adminClient, profileInsertAttempts);
        if (profileInsertError) {
            await adminClient.auth.admin.deleteUser(profileId);
            return jsonResponse(400, { error: (profileInsertError as { message?: string })?.message || 'Failed to create the staff profile.' });
        }

        return jsonResponse(200, {
            success: true,
            user_id: profileId,
            username,
            role
        });
    } catch (error) {
        return jsonResponse(400, {
            error: error instanceof Error ? error.message : 'Failed to create the staff user.'
        });
    }
});
