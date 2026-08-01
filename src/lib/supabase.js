import { createClient } from '@supabase/supabase-js';

// Cloud config can come from build-time env (Vercel) OR from the browser
// (entered once in the app, saved to localStorage). This lets the app run in
// cloud mode from a plain HTML file or any host — no env / no Vercel needed.
const LS_CONFIG = 'tla_supabase_cfg';
const LS_FORCE_LOCAL = 'tla_force_local';

function readConfig() {
  const envUrl = import.meta.env.VITE_SUPABASE_URL;
  const envKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (envUrl && envKey) return { url: String(envUrl).trim(), anonKey: String(envKey).trim() };
  try {
    const raw = localStorage.getItem(LS_CONFIG);
    if (raw) {
      const c = JSON.parse(raw);
      if (c?.url && c?.anonKey) return { url: String(c.url).trim(), anonKey: String(c.anonKey).trim() };
    }
  } catch { /* ignore */ }
  return null;
}

export function saveCloudConfig(url, anonKey) {
  try {
    localStorage.setItem(LS_CONFIG, JSON.stringify({ url: String(url).trim(), anonKey: String(anonKey).trim() }));
    localStorage.removeItem(LS_FORCE_LOCAL);
  } catch { /* ignore */ }
}
export function clearCloudConfig() {
  try { localStorage.removeItem(LS_CONFIG); localStorage.removeItem(LS_FORCE_LOCAL); } catch { /* ignore */ }
}
export function chooseLocalMode() {
  try { localStorage.setItem(LS_FORCE_LOCAL, '1'); } catch { /* ignore */ }
}
export function isForcedLocal() {
  try { return localStorage.getItem(LS_FORCE_LOCAL) === '1'; } catch { return false; }
}

const config = readConfig();

// The app needs the user to choose cloud (enter config) or local, unless
// already configured or they've opted into local mode.
export const needsSetup = !config && !isForcedLocal();
export const isConfigured = Boolean(config);

let client = null;
let initError = null;

if (config) {
  if (!/^https:\/\/.+\.supabase\.co\/?$/.test(config.url)) {
    initError = `ค่า Supabase URL ไม่ถูกต้อง: "${config.url}" — ต้องเป็น https://xxxx.supabase.co`;
  } else if (!/^ey[A-Za-z0-9_-]/.test(config.anonKey)) {
    initError = 'ค่า anon key ไม่ถูกต้อง — ต้องขึ้นต้นด้วย "eyJ"';
  } else {
    try {
      client = createClient(config.url.replace(/\/$/, ''), config.anonKey, {
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
};

export const SETTINGS_TABLE = 'settings';
export const SETTINGS_ROW_ID = 'default';
