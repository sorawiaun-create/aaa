import { createClient } from '@supabase/supabase-js';

// Cloud mode activates only when both env vars are provided at build time.
// Without them the app runs in local-only mode (localStorage), exactly as before.
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isCloud = Boolean(url && anonKey);

export const supabase = isCloud
  ? createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null;

// Entity table names, keyed by the store's collection name.
export const TABLES = {
  channels: 'channels',
  employees: 'employees',
  teams: 'teams',
  sales: 'sales',
  workLogs: 'work_logs',
};

export const SETTINGS_TABLE = 'settings';
export const SETTINGS_ROW_ID = 'default';
