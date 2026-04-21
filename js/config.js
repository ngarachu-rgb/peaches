import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

export const supabaseUrl = 'https://poepfebjdnhlszflhqzs.supabase.co';
export const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBvZXBmZWJqZG5obHN6ZmxocXpzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1NzU5MDcsImV4cCI6MjA5MDE1MTkwN30.HT9-4TptQZwXewyQfwGHb0EGcZMDDIUSdt1eKlSwSoY';
export const hiddenAuthEmailDomain = 'poepfebjdnhlszflhqzs.supabase.co';
export const legacyHiddenAuthEmailDomain = 'staff.local';

export const supabase = createClient(supabaseUrl, supabaseKey);

export function buildAuthEmailCandidates(username) {
    const normalized = String(username || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

    if (!normalized) {
        throw new Error('Username is required.');
    }

    return [
        `${normalized}@${hiddenAuthEmailDomain}`,
        `${normalized}@${legacyHiddenAuthEmailDomain}`
    ];
}
