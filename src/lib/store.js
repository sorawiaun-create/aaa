import { useState, useEffect } from 'react';
import { supabase, isCloud, TABLES, SETTINGS_TABLE, SETTINGS_ROW_ID } from './supabase.js';
import { DEFAULT_SCORING } from './shopee.js';
import { mergeProducts } from './shopeeImport.js';
import { DEFAULT_AI } from './shopeeAI.js';

// localStorage keys — used in local mode (and as nothing in cloud mode).
const KEYS = {
  channels: 'tla_channels_v1',
  employees: 'tla_employees_v1',
  teams: 'tla_teams_v1',
  sales: 'tla_sales_v1',
  workLogs: 'tla_worklogs_v1',
  settings: 'tla_settings_v1',
  shopeeProducts: 'tla_shopee_products_v1',
};

// ค่าตั้ง AI เก็บในเครื่องเท่านั้น — API key ไม่ถูกซิงก์ขึ้นคลาวด์
const AI_KEY = 'tla_shopee_ai_v1';

export const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const nowISO = () => new Date().toISOString();

const load = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};
const save = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / private mode — ignore */
  }
};

export const DEFAULT_SETTINGS = {
  companyName: 'TikTok Live Aff',
  currency: 'THB',
  defaultCommission: { type: 'flat', rate: 3, tiers: [] },
  workDaysPerMonth: 26,
  shopeeScoring: { ...DEFAULT_SCORING },
};

// --- ค่าตั้ง AI (เก็บใน localStorage เสมอ ไม่ขึ้นคลาวด์) ---
export const loadShopeeAi = () => ({ ...DEFAULT_AI, ...load(AI_KEY, {}) });
export const saveShopeeAi = (cfg) => save(AI_KEY, cfg);

// --- Cloud helpers (no-ops in local mode) ---
async function fetchTable(table) {
  const { data, error } = await supabase.from(table).select('id,data');
  if (error) { console.error('load', table, error.message); return null; }
  return (data || []).map((r) => r.data);
}
async function cloudUpsert(table, obj) {
  if (!isCloud) return;
  const { error } = await supabase.from(table).upsert({ id: obj.id, data: obj });
  if (error) console.error('save', table, error.message);
}
async function cloudDelete(table, id) {
  if (!isCloud) return;
  const { error } = await supabase.from(table).delete().eq('id', id);
  if (error) console.error('delete', table, error.message);
}
async function cloudUpsertMany(table, arr) {
  if (!isCloud || !arr?.length) return;
  const { error } = await supabase.from(table).upsert(arr.map((o) => ({ id: o.id, data: o })));
  if (error) console.error('bulk save', table, error.message);
}
async function cloudClear(table) {
  if (!isCloud) return;
  const { error } = await supabase.from(table).delete().neq('id', '__none__');
  if (error) console.error('clear', table, error.message);
}
async function cloudSaveSettings(s) {
  if (!isCloud) return;
  const { error } = await supabase.from(SETTINGS_TABLE).upsert({ id: SETTINGS_ROW_ID, data: s });
  if (error) console.error('save settings', error.message);
}

// Central data store. Same API in both modes so views never branch.
//  - local mode: state persisted to localStorage (offline, single device).
//  - cloud mode: state loaded from / written through to Supabase, with
//    realtime updates so every signed-in device shares one dataset.
export function useStore() {
  const [channels, setChannels] = useState(() => (isCloud ? [] : load(KEYS.channels, [])));
  const [employees, setEmployees] = useState(() => (isCloud ? [] : load(KEYS.employees, [])));
  const [teams, setTeams] = useState(() => (isCloud ? [] : load(KEYS.teams, [])));
  const [sales, setSales] = useState(() => (isCloud ? [] : load(KEYS.sales, [])));
  const [workLogs, setWorkLogs] = useState(() => (isCloud ? [] : load(KEYS.workLogs, [])));
  const [shopeeProducts, setShopeeProducts] = useState(() => (isCloud ? [] : load(KEYS.shopeeProducts, [])));
  const [settings, setSettings] = useState(() => ({ ...DEFAULT_SETTINGS, ...(isCloud ? {} : load(KEYS.settings, {})) }));

  // Auth (cloud only). Local mode is always "ready" with no user.
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(!isCloud);
  const [loading, setLoading] = useState(isCloud);

  // Persist to localStorage in local mode only.
  useEffect(() => { if (!isCloud) save(KEYS.channels, channels); }, [channels]);
  useEffect(() => { if (!isCloud) save(KEYS.employees, employees); }, [employees]);
  useEffect(() => { if (!isCloud) save(KEYS.teams, teams); }, [teams]);
  useEffect(() => { if (!isCloud) save(KEYS.sales, sales); }, [sales]);
  useEffect(() => { if (!isCloud) save(KEYS.workLogs, workLogs); }, [workLogs]);
  useEffect(() => { if (!isCloud) save(KEYS.shopeeProducts, shopeeProducts); }, [shopeeProducts]);
  useEffect(() => { if (!isCloud) save(KEYS.settings, settings); }, [settings]);

  // Track the auth session.
  useEffect(() => {
    if (!isCloud) return;
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Load all data + subscribe to realtime when signed in.
  useEffect(() => {
    if (!isCloud) return;
    if (!session) {
      setChannels([]); setEmployees([]); setTeams([]); setSales([]); setWorkLogs([]); setShopeeProducts([]);
      setSettings({ ...DEFAULT_SETTINGS });
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [ch, emp, tm, sl, wl, sp] = await Promise.all([
        fetchTable(TABLES.channels), fetchTable(TABLES.employees), fetchTable(TABLES.teams),
        fetchTable(TABLES.sales), fetchTable(TABLES.workLogs), fetchTable(TABLES.shopeeProducts),
      ]);
      const st = await supabase.from(SETTINGS_TABLE).select('data').eq('id', SETTINGS_ROW_ID).maybeSingle();
      if (cancelled) return;
      if (ch) setChannels(ch);
      if (emp) setEmployees(emp);
      if (tm) setTeams(tm);
      if (sl) setSales(sl);
      if (wl) setWorkLogs(wl);
      if (sp) setShopeeProducts(sp);
      if (st?.data?.data) setSettings({ ...DEFAULT_SETTINGS, ...st.data.data });
      setLoading(false);
    })();

    // Realtime: on any change to a table, reload just that table.
    const reload = (table, setter) => async () => { const rows = await fetchTable(table); if (rows) setter(rows); };
    const subs = [
      [TABLES.channels, setChannels], [TABLES.employees, setEmployees], [TABLES.teams, setTeams],
      [TABLES.sales, setSales], [TABLES.workLogs, setWorkLogs],
      [TABLES.shopeeProducts, setShopeeProducts],
    ].map(([table, setter]) =>
      supabase.channel(`rt-${table}`).on('postgres_changes', { event: '*', schema: 'public', table }, reload(table, setter)).subscribe()
    );
    subs.push(
      supabase.channel('rt-settings').on('postgres_changes', { event: '*', schema: 'public', table: SETTINGS_TABLE }, async () => {
        const st2 = await supabase.from(SETTINGS_TABLE).select('data').eq('id', SETTINGS_ROW_ID).maybeSingle();
        if (st2?.data?.data) setSettings({ ...DEFAULT_SETTINGS, ...st2.data.data });
      }).subscribe()
    );

    return () => { cancelled = true; subs.forEach((s) => supabase.removeChannel(s)); };
  }, [session]);

  // --- Channels ---
  const addChannel = (channel) => {
    const rec = { id: uid(), status: 'active', createdAt: nowISO(), ...channel };
    setChannels((prev) => [...prev, rec]);
    cloudUpsert(TABLES.channels, rec);
  };
  const updateChannel = (id, patch) => {
    const cur = channels.find((c) => c.id === id);
    setChannels((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    if (cur) cloudUpsert(TABLES.channels, { ...cur, ...patch });
  };
  const removeChannel = (id) => {
    setChannels((prev) => prev.filter((c) => c.id !== id));
    cloudDelete(TABLES.channels, id);
  };

  // --- Employees ---
  const addEmployee = (emp) => {
    const rec = { id: uid(), active: true, ...emp };
    setEmployees((prev) => [...prev, rec]);
    cloudUpsert(TABLES.employees, rec);
  };
  const updateEmployee = (id, patch) => {
    const cur = employees.find((e) => e.id === id);
    setEmployees((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
    if (cur) cloudUpsert(TABLES.employees, { ...cur, ...patch });
  };
  const removeEmployee = (id) => {
    setEmployees((prev) => prev.filter((e) => e.id !== id));
    cloudDelete(TABLES.employees, id);
  };

  // --- Teams ---
  const addTeam = (team) => {
    const rec = { id: uid(), ...team };
    setTeams((prev) => [...prev, rec]);
    cloudUpsert(TABLES.teams, rec);
  };
  const updateTeam = (id, patch) => {
    const cur = teams.find((t) => t.id === id);
    setTeams((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    if (cur) cloudUpsert(TABLES.teams, { ...cur, ...patch });
  };
  const removeTeam = (id) => {
    setTeams((prev) => prev.filter((t) => t.id !== id));
    cloudDelete(TABLES.teams, id);
  };

  // --- Sales ---
  const addSale = (sale) => {
    const rec = { id: uid(), ...sale };
    setSales((prev) => [rec, ...prev]);
    cloudUpsert(TABLES.sales, rec);
  };
  const updateSale = (id, patch) => {
    const cur = sales.find((s) => s.id === id);
    setSales((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    if (cur) cloudUpsert(TABLES.sales, { ...cur, ...patch });
  };
  const removeSale = (id) => {
    setSales((prev) => prev.filter((s) => s.id !== id));
    cloudDelete(TABLES.sales, id);
  };

  // --- Work logs ---
  const addWorkLog = (log) => {
    const rec = { id: uid(), ...log };
    setWorkLogs((prev) => [rec, ...prev]);
    cloudUpsert(TABLES.workLogs, rec);
  };
  const updateWorkLog = (id, patch) => {
    const cur = workLogs.find((w) => w.id === id);
    setWorkLogs((prev) => prev.map((w) => (w.id === id ? { ...w, ...patch } : w)));
    if (cur) cloudUpsert(TABLES.workLogs, { ...cur, ...patch });
  };
  const removeWorkLog = (id) => {
    setWorkLogs((prev) => prev.filter((w) => w.id !== id));
    cloudDelete(TABLES.workLogs, id);
  };

  // --- Shopee products (คัดกรองสินค้าสำหรับยิงแอด) ---
  // นำเข้าแบบรวมกับของเดิม: สินค้าตัวเดียวกันจะถูกรวมรอบดีลเข้าด้วยกัน
  const importShopeeProducts = (incoming, { replace = false } = {}) => {
    const next = replace ? mergeProducts(incoming || []) : mergeProducts([...shopeeProducts, ...(incoming || [])]);
    setShopeeProducts(next);
    if (isCloud) {
      (async () => {
        await cloudClear(TABLES.shopeeProducts);
        await cloudUpsertMany(TABLES.shopeeProducts, next);
      })();
    }
    return next;
  };
  const updateShopeeProduct = (id, patch) => {
    const cur = shopeeProducts.find((p) => p.id === id);
    setShopeeProducts((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    if (cur) cloudUpsert(TABLES.shopeeProducts, { ...cur, ...patch });
  };
  const removeShopeeProduct = (id) => {
    setShopeeProducts((prev) => prev.filter((p) => p.id !== id));
    cloudDelete(TABLES.shopeeProducts, id);
  };
  const clearShopeeProducts = () => {
    setShopeeProducts([]);
    cloudClear(TABLES.shopeeProducts);
  };

  // --- Settings ---
  const updateSettings = (patch) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    cloudSaveSettings(next);
  };

  // --- Data management ---
  const clearAll = () => {
    setChannels([]); setEmployees([]); setTeams([]); setSales([]); setWorkLogs([]); setShopeeProducts([]);
    setSettings({ ...DEFAULT_SETTINGS });
    if (isCloud) {
      Object.values(TABLES).forEach((t) => cloudClear(t));
      cloudSaveSettings(DEFAULT_SETTINGS);
    }
  };

  const replaceAll = async (data) => {
    const next = {
      channels: data.channels || [], employees: data.employees || [], teams: data.teams || [],
      sales: data.sales || [], workLogs: data.workLogs || [],
      shopeeProducts: data.shopeeProducts || [],
      settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) },
    };
    setChannels(next.channels); setEmployees(next.employees); setTeams(next.teams);
    setSales(next.sales); setWorkLogs(next.workLogs); setShopeeProducts(next.shopeeProducts);
    setSettings(next.settings);
    if (isCloud) {
      await Promise.all(Object.values(TABLES).map((t) => cloudClear(t)));
      await Promise.all([
        cloudUpsertMany(TABLES.channels, next.channels), cloudUpsertMany(TABLES.employees, next.employees),
        cloudUpsertMany(TABLES.teams, next.teams), cloudUpsertMany(TABLES.sales, next.sales),
        cloudUpsertMany(TABLES.workLogs, next.workLogs),
        cloudUpsertMany(TABLES.shopeeProducts, next.shopeeProducts),
      ]);
      await cloudSaveSettings(next.settings);
    }
  };
  const importAll = (snapshot) => replaceAll(snapshot);
  const loadSample = (sample) => replaceAll(sample);

  // --- Auth (cloud) ---
  const signIn = (email, password) => supabase.auth.signInWithPassword({ email, password });
  const signUp = (email, password) => supabase.auth.signUp({ email, password });
  const signOut = () => supabase.auth.signOut();

  return {
    mode: isCloud ? 'cloud' : 'local',
    authReady, loading, user: session?.user || null,
    signIn, signUp, signOut,
    channels, employees, teams, sales, workLogs, shopeeProducts, settings,
    addChannel, updateChannel, removeChannel,
    addEmployee, updateEmployee, removeEmployee,
    addTeam, updateTeam, removeTeam,
    addSale, updateSale, removeSale,
    addWorkLog, updateWorkLog, removeWorkLog,
    importShopeeProducts, updateShopeeProduct, removeShopeeProduct, clearShopeeProducts,
    updateSettings, clearAll, importAll, loadSample,
  };
}
