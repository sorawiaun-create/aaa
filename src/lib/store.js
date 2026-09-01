import { useState, useEffect } from 'react';
import { supabase, isCloud, TABLES, SETTINGS_TABLE, SETTINGS_ROW_ID } from './supabase.js';

// localStorage keys — used in local mode (and as nothing in cloud mode).
const KEYS = {
  channels: 'tla_channels_v1',
  employees: 'tla_employees_v1',
  teams: 'tla_teams_v1',
  sales: 'tla_sales_v1',
  workLogs: 'tla_worklogs_v1',
  imports: 'tla_imports_v1',
  expenses: 'tla_expenses_v1',
  settings: 'tla_settings_v1',
};

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
};

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
export function useStore() {
  const [channels, setChannels] = useState(() => (isCloud ? [] : load(KEYS.channels, [])));
  const [employees, setEmployees] = useState(() => (isCloud ? [] : load(KEYS.employees, [])));
  const [teams, setTeams] = useState(() => (isCloud ? [] : load(KEYS.teams, [])));
  const [sales, setSales] = useState(() => (isCloud ? [] : load(KEYS.sales, [])));
  const [workLogs, setWorkLogs] = useState(() => (isCloud ? [] : load(KEYS.workLogs, [])));
  const [imports, setImports] = useState(() => (isCloud ? [] : load(KEYS.imports, [])));
  const [expenses, setExpenses] = useState(() => (isCloud ? [] : load(KEYS.expenses, [])));
  const [settings, setSettings] = useState(() => ({ ...DEFAULT_SETTINGS, ...(isCloud ? {} : load(KEYS.settings, {})) }));

  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(!isCloud);
  const [loading, setLoading] = useState(isCloud);

  // Persist to localStorage in local mode only.
  useEffect(() => { if (!isCloud) save(KEYS.channels, channels); }, [channels]);
  useEffect(() => { if (!isCloud) save(KEYS.employees, employees); }, [employees]);
  useEffect(() => { if (!isCloud) save(KEYS.teams, teams); }, [teams]);
  useEffect(() => { if (!isCloud) save(KEYS.sales, sales); }, [sales]);
  useEffect(() => { if (!isCloud) save(KEYS.workLogs, workLogs); }, [workLogs]);
  useEffect(() => { if (!isCloud) save(KEYS.imports, imports); }, [imports]);
  useEffect(() => { if (!isCloud) save(KEYS.expenses, expenses); }, [expenses]);
  useEffect(() => { if (!isCloud) save(KEYS.settings, settings); }, [settings]);

  useEffect(() => {
    if (!isCloud) return;
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!isCloud) return;
    if (!session) {
      setChannels([]); setEmployees([]); setTeams([]); setSales([]); setWorkLogs([]); setImports([]); setExpenses([]);
      setSettings({ ...DEFAULT_SETTINGS });
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [ch, emp, tm, sl, wl, im, ex] = await Promise.all([
        fetchTable(TABLES.channels), fetchTable(TABLES.employees), fetchTable(TABLES.teams),
        fetchTable(TABLES.sales), fetchTable(TABLES.workLogs), fetchTable(TABLES.imports), fetchTable(TABLES.expenses),
      ]);
      const st = await supabase.from(SETTINGS_TABLE).select('data').eq('id', SETTINGS_ROW_ID).maybeSingle();
      if (cancelled) return;
      if (ch) setChannels(ch);
      if (emp) setEmployees(emp);
      if (tm) setTeams(tm);
      if (sl) setSales(sl);
      if (wl) setWorkLogs(wl);
      if (im) setImports(im);
      if (ex) setExpenses(ex);
      if (st?.data?.data) setSettings({ ...DEFAULT_SETTINGS, ...st.data.data });
      setLoading(false);
    })();

    const reload = (table, setter) => async () => { const rows = await fetchTable(table); if (rows) setter(rows); };
    const subs = [
      [TABLES.channels, setChannels], [TABLES.employees, setEmployees], [TABLES.teams, setTeams],
      [TABLES.sales, setSales], [TABLES.workLogs, setWorkLogs], [TABLES.imports, setImports], [TABLES.expenses, setExpenses],
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

  // Generic CRUD factory to cut repetition.
  const crud = (table, state, setState, defaults = () => ({})) => ({
    add: (obj) => {
      const rec = { id: uid(), ...defaults(), ...obj };
      setState((prev) => [rec, ...prev]);
      cloudUpsert(table, rec);
      return rec;
    },
    update: (id, patch) => {
      const cur = state.find((x) => x.id === id);
      setState((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)));
      if (cur) cloudUpsert(table, { ...cur, ...patch });
    },
    remove: (id) => {
      setState((prev) => prev.filter((x) => x.id !== id));
      cloudDelete(table, id);
    },
  });

  const chC = crud(TABLES.channels, channels, setChannels, () => ({ status: 'active', createdAt: nowISO() }));
  const empC = crud(TABLES.employees, employees, setEmployees, () => ({ active: true }));
  const tmC = crud(TABLES.teams, teams, setTeams);
  const slC = crud(TABLES.sales, sales, setSales);
  const wlC = crud(TABLES.workLogs, workLogs, setWorkLogs);
  const imC = crud(TABLES.imports, imports, setImports, () => ({ uploadedAt: nowISO() }));
  const exC = crud(TABLES.expenses, expenses, setExpenses);

  const updateSettings = (patch) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    cloudSaveSettings(next);
  };

  const clearAll = () => {
    setChannels([]); setEmployees([]); setTeams([]); setSales([]); setWorkLogs([]); setImports([]); setExpenses([]);
    setSettings({ ...DEFAULT_SETTINGS });
    if (isCloud) {
      Object.values(TABLES).forEach((t) => cloudClear(t));
      cloudSaveSettings(DEFAULT_SETTINGS);
    }
  };

  const replaceAll = async (data) => {
    const next = {
      channels: data.channels || [], employees: data.employees || [], teams: data.teams || [],
      sales: data.sales || [], workLogs: data.workLogs || [], imports: data.imports || [], expenses: data.expenses || [],
      settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) },
    };
    setChannels(next.channels); setEmployees(next.employees); setTeams(next.teams);
    setSales(next.sales); setWorkLogs(next.workLogs); setImports(next.imports); setExpenses(next.expenses);
    setSettings(next.settings);
    if (isCloud) {
      await Promise.all(Object.values(TABLES).map((t) => cloudClear(t)));
      await Promise.all([
        cloudUpsertMany(TABLES.channels, next.channels), cloudUpsertMany(TABLES.employees, next.employees),
        cloudUpsertMany(TABLES.teams, next.teams), cloudUpsertMany(TABLES.sales, next.sales),
        cloudUpsertMany(TABLES.workLogs, next.workLogs), cloudUpsertMany(TABLES.imports, next.imports),
        cloudUpsertMany(TABLES.expenses, next.expenses),
      ]);
      await cloudSaveSettings(next.settings);
    }
  };
  const importAll = (snapshot) => replaceAll(snapshot);
  const loadSample = (sample) => replaceAll(sample);

  const signIn = (email, password) => supabase.auth.signInWithPassword({ email, password });
  const signUp = (email, password) => supabase.auth.signUp({ email, password });
  const signOut = () => supabase.auth.signOut();

  return {
    mode: isCloud ? 'cloud' : 'local',
    authReady, loading, user: session?.user || null,
    signIn, signUp, signOut,
    channels, employees, teams, sales, workLogs, imports, expenses, settings,
    addChannel: chC.add, updateChannel: chC.update, removeChannel: chC.remove,
    addEmployee: empC.add, updateEmployee: empC.update, removeEmployee: empC.remove,
    addTeam: tmC.add, updateTeam: tmC.update, removeTeam: tmC.remove,
    addSale: slC.add, updateSale: slC.update, removeSale: slC.remove,
    addWorkLog: wlC.add, updateWorkLog: wlC.update, removeWorkLog: wlC.remove,
    addImport: imC.add, removeImport: imC.remove,
    addExpense: exC.add, updateExpense: exC.update, removeExpense: exC.remove,
    updateSettings, clearAll, importAll, loadSample,
  };
}
