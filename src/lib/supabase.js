import { createClient } from '@supabase/supabase-js';

// Cloud mode activates only when both env vars are provided at build time.
// Without them the app runs in local-only mode (localStorage), exactly as before.
const rawUrl = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const url = typeof rawUrl === 'string' ? rawUrl.trim() : rawUrl;

// True when the user has attempted to configure cloud mode (both vars present).
export const isConfigured = Boolean(url && anonKey);

// Validate the config up front so a bad value shows a clear message instead of
// crashing the whole app to a blank white screen.
let client = null;
let initError = null;

if (isConfigured) {
  if (!/^https:\/\/.+\.supabase\.co\/?$/.test(url)) {
    initError = `ค่า VITE_SUPABASE_URL ไม่ถูกต้อง: "${url}" — ต้องเป็นรูปแบบ https://xxxx.supabase.co`;
  } else if (!/^ey[A-Za-z0-9_-]/.test(String(anonKey).trim())) {
    initError = 'ค่า VITE_SUPABASE_ANON_KEY ไม่ถูกต้อง — ต้องเป็นคีย์ anon public (ขึ้นต้นด้วย "eyJ")';
  } else {
    try {
      client = createClient(url.replace(/\/$/, ''), String(anonKey).trim(), {
        auth: { persistSession: true, autoRefreshToken: true },
      });
    } catch (e) {
      initError = `เชื่อมต่อ Supabase ไม่สำเร็จ: ${e.message}`;
    }
  }
}

export const supabase = client;
export const isCloud = Boolean(client);
export const cloudInitError = initError;

// Entity table names, keyed by the store's collection name.
export const TABLES = {
  channels: 'channels',
  employees: 'employees',
  teams: 'teams',
  sales: 'sales',
  workLogs: 'work_logs',
  shopeeProducts: 'shopee_products',
};

export const SETTINGS_TABLE = 'settings';
export const SETTINGS_ROW_ID = 'default';
