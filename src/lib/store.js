import { useState, useEffect, useCallback } from 'react';

// localStorage keys — versioned so a schema bump can migrate cleanly.
const KEYS = {
  channels: 'tla_channels_v1',
  employees: 'tla_employees_v1',
  teams: 'tla_teams_v1',
  sales: 'tla_sales_v1',
  workLogs: 'tla_worklogs_v1',
  settings: 'tla_settings_v1',
};

export const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

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
  // Fallback commission plan applied to employees with no own plan.
  defaultCommission: { type: 'flat', rate: 3, tiers: [] },
  // Default working days per month, used when a monthly-base employee has no
  // explicit day count (base is paid in full regardless; this is for reference).
  workDaysPerMonth: 26,
};

// Central data store, persisted to localStorage. Every mutation auto-saves.
export function useStore() {
  const [channels, setChannels] = useState(() => load(KEYS.channels, []));
  const [employees, setEmployees] = useState(() => load(KEYS.employees, []));
  const [teams, setTeams] = useState(() => load(KEYS.teams, []));
  const [sales, setSales] = useState(() => load(KEYS.sales, []));
  const [workLogs, setWorkLogs] = useState(() => load(KEYS.workLogs, []));
  const [settings, setSettings] = useState(() => ({
    ...DEFAULT_SETTINGS,
    ...load(KEYS.settings, {}),
  }));

  useEffect(() => save(KEYS.channels, channels), [channels]);
  useEffect(() => save(KEYS.employees, employees), [employees]);
  useEffect(() => save(KEYS.teams, teams), [teams]);
  useEffect(() => save(KEYS.sales, sales), [sales]);
  useEffect(() => save(KEYS.workLogs, workLogs), [workLogs]);
  useEffect(() => save(KEYS.settings, settings), [settings]);

  // --- Channels ---
  const addChannel = useCallback((channel) => {
    setChannels((prev) => [...prev, { id: uid(), status: 'active', createdAt: new Date().toISOString(), ...channel }]);
  }, []);
  const updateChannel = useCallback((id, patch) => {
    setChannels((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }, []);
  const removeChannel = useCallback((id) => {
    setChannels((prev) => prev.filter((c) => c.id !== id));
  }, []);

  // --- Employees ---
  const addEmployee = useCallback((emp) => {
    setEmployees((prev) => [...prev, { id: uid(), active: true, ...emp }]);
  }, []);
  const updateEmployee = useCallback((id, patch) => {
    setEmployees((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }, []);
  const removeEmployee = useCallback((id) => {
    setEmployees((prev) => prev.filter((e) => e.id !== id));
  }, []);

  // --- Teams ---
  const addTeam = useCallback((team) => {
    setTeams((prev) => [...prev, { id: uid(), ...team }]);
  }, []);
  const updateTeam = useCallback((id, patch) => {
    setTeams((prev) => prev.map((tm) => (tm.id === id ? { ...tm, ...patch } : tm)));
  }, []);
  const removeTeam = useCallback((id) => {
    setTeams((prev) => prev.filter((tm) => tm.id !== id));
  }, []);

  // --- Sales (daily per-channel records) ---
  const addSale = useCallback((sale) => {
    setSales((prev) => [{ id: uid(), ...sale }, ...prev]);
  }, []);
  const updateSale = useCallback((id, patch) => {
    setSales((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }, []);
  const removeSale = useCallback((id) => {
    setSales((prev) => prev.filter((s) => s.id !== id));
  }, []);

  // --- Daily work logs (attendance / shifts) ---
  const addWorkLog = useCallback((log) => {
    setWorkLogs((prev) => [{ id: uid(), ...log }, ...prev]);
  }, []);
  const updateWorkLog = useCallback((id, patch) => {
    setWorkLogs((prev) => prev.map((w) => (w.id === id ? { ...w, ...patch } : w)));
  }, []);
  const removeWorkLog = useCallback((id) => {
    setWorkLogs((prev) => prev.filter((w) => w.id !== id));
  }, []);

  // --- Settings ---
  const updateSettings = useCallback((patch) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  // --- Data management ---
  const clearAll = useCallback(() => {
    setChannels([]);
    setEmployees([]);
    setTeams([]);
    setSales([]);
    setWorkLogs([]);
    setSettings(DEFAULT_SETTINGS);
  }, []);

  const importAll = useCallback((snapshot) => {
    if (snapshot.channels) setChannels(snapshot.channels);
    if (snapshot.employees) setEmployees(snapshot.employees);
    if (snapshot.teams) setTeams(snapshot.teams);
    if (snapshot.sales) setSales(snapshot.sales);
    if (snapshot.workLogs) setWorkLogs(snapshot.workLogs);
    if (snapshot.settings) setSettings({ ...DEFAULT_SETTINGS, ...snapshot.settings });
  }, []);

  const loadSample = useCallback((sample) => {
    setChannels(sample.channels);
    setEmployees(sample.employees);
    setTeams(sample.teams);
    setSales(sample.sales);
    setWorkLogs(sample.workLogs);
    setSettings({ ...DEFAULT_SETTINGS, ...(sample.settings || {}) });
  }, []);

  return {
    channels, employees, teams, sales, workLogs, settings,
    addChannel, updateChannel, removeChannel,
    addEmployee, updateEmployee, removeEmployee,
    addTeam, updateTeam, removeTeam,
    addSale, updateSale, removeSale,
    addWorkLog, updateWorkLog, removeWorkLog,
    updateSettings, clearAll, importAll, loadSample,
  };
}
