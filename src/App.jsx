import React, { useState, useMemo } from 'react';
import {
  BarChart3, Radio, Video, ClipboardList, Trophy, Target,
  CalendarCheck, Settings, LogOut, Menu, X, Loader2, LineChart,
} from 'lucide-react';
import { useStore } from './lib/store.js';
import { isConfigured, cloudInitError, needsSetup } from './lib/supabase.js';
import { monthOptionsFrom } from './lib/payroll.js';
import { monthLabel } from './lib/format.js';
import { cn } from './components/ui.jsx';
import Login from './components/Login.jsx';
import CloudSetup from './components/CloudSetup.jsx';
import OverviewView from './views/OverviewView.jsx';
import RealtimeView from './views/RealtimeView.jsx';
import ChannelsView from './views/ChannelsView.jsx';
import SalesView from './views/SalesView.jsx';
import EmployeesView from './views/EmployeesView.jsx';
import TeamsView from './views/TeamsView.jsx';
import WorkLogView from './views/WorkLogView.jsx';
import ReportsView from './views/ReportsView.jsx';
import SettingsView from './views/SettingsView.jsx';

const NAV = [
  { id: 'overview', label: 'ภาพรวม', icon: BarChart3 },
  { id: 'reports', label: 'รายงาน & กราฟ', icon: LineChart },
  { id: 'realtime', label: 'Realtime Live', icon: Radio },
  { id: 'channels', label: 'ช่อง TikTok', icon: Video },
  { id: 'sales', label: 'บันทึกยอดขาย', icon: ClipboardList },
  { id: 'employees', label: 'พนักงาน & KPI', icon: Trophy },
  { id: 'teams', label: 'ทีม & เป้าหมาย', icon: Target },
  { id: 'worklog', label: 'บันทึกงานรายวัน', icon: CalendarCheck },
  { id: 'settings', label: 'ตั้งค่าระบบ', icon: Settings },
];

// Views that show the month selector in the top bar.
const MONTH_VIEWS = new Set(['overview', 'reports', 'employees', 'teams', 'worklog']);

export default function App() {
  const store = useStore();
  const [view, setView] = useState('overview');
  const [month, setMonth] = useState(''); // '' = all months
  const [mobileNav, setMobileNav] = useState(false);

  const monthOptions = useMemo(
    () => monthOptionsFrom(store.sales, store.workLogs),
    [store.sales, store.workLogs]
  );

  const current = NAV.find((n) => n.id === view) || NAV[0];

  // First run with no cloud config — let the owner connect or pick local.
  if (needsSetup) return <CloudSetup />;

  // Cloud configured but failed to initialise (bad URL/key) — show why.
  if (isConfigured && cloudInitError) return <ConfigError message={cloudInitError} />;

  // Cloud mode: wait for auth, then gate on sign-in.
  if (store.mode === 'cloud') {
    if (!store.authReady) return <FullscreenSpinner label="กำลังเชื่อมต่อ…" />;
    if (!store.user) return <Login store={store} />;
  }

  const NavList = ({ onPick }) => (
    <nav className="space-y-1">
      {NAV.map((item) => (
        <button
          key={item.id}
          onClick={() => { setView(item.id); onPick?.(); }}
          className={cn(
            'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors',
            view === item.id
              ? 'bg-gradient-to-r from-rose-500 to-pink-600 text-white shadow-lg shadow-pink-900/30'
              : 'text-slate-300 hover:bg-white/5 hover:text-white'
          )}
        >
          <item.icon size={18} />
          {item.label}
        </button>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 flex">
      {/* Desktop sidebar (dark) */}
      <aside className="hidden md:flex md:flex-col w-60 shrink-0 bg-slate-950 p-4 sticky top-0 h-screen">
        <Brand name={store.settings.companyName} />
        <div className="mt-4 flex-1"><NavList /></div>
        <OwnerBox store={store} />
      </aside>

      {/* Mobile drawer */}
      {mobileNav && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileNav(false)} />
          <aside className="relative w-64 bg-slate-950 p-4 flex flex-col h-full">
            <div className="flex items-center justify-between">
              <Brand name={store.settings.companyName} />
              <button onClick={() => setMobileNav(false)} className="text-slate-400"><X size={20} /></button>
            </div>
            <div className="mt-4 flex-1"><NavList onPick={() => setMobileNav(false)} /></div>
            <OwnerBox store={store} />
          </aside>
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top bar */}
        <header className="bg-white border-b border-slate-200 px-4 md:px-8 py-3 flex items-center gap-3 sticky top-0 z-30">
          <button className="md:hidden text-slate-500" onClick={() => setMobileNav(true)}><Menu size={22} /></button>
          <h1 className="text-lg md:text-xl font-bold text-slate-800 flex items-center gap-2">
            <current.icon size={20} className="text-pink-500" />
            {current.label}
          </h1>
          <div className="ml-auto flex items-center gap-2">
            {store.mode === 'cloud' && store.loading && (
              <span className="hidden sm:flex items-center gap-1.5 text-xs text-slate-400">
                <Loader2 size={13} className="animate-spin" /> กำลังโหลด…
              </span>
            )}
            {MONTH_VIEWS.has(view) && (
              <select
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white text-slate-700 focus:ring-2 focus:ring-pink-200 focus:outline-none"
              >
                <option value="">ทุกเดือน</option>
                {monthOptions.map((m) => (
                  <option key={m} value={m}>{monthLabel(m)}</option>
                ))}
              </select>
            )}
          </div>
        </header>

        <main className="flex-1 p-4 md:p-8 max-w-7xl w-full mx-auto space-y-6">
          {view === 'overview' && <OverviewView store={store} month={month} />}
          {view === 'reports' && <ReportsView store={store} month={month} />}
          {view === 'realtime' && <RealtimeView store={store} />}
          {view === 'channels' && <ChannelsView store={store} />}
          {view === 'sales' && <SalesView store={store} />}
          {view === 'employees' && <EmployeesView store={store} month={month} />}
          {view === 'teams' && <TeamsView store={store} month={month} />}
          {view === 'worklog' && <WorkLogView store={store} month={month} />}
          {view === 'settings' && <SettingsView store={store} />}
        </main>
      </div>
    </div>
  );
}

function Brand({ name }) {
  return (
    <div className="flex items-center gap-2 px-2">
      <span className="relative flex h-3 w-3">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-500 opacity-60" />
        <span className="relative inline-flex rounded-full h-3 w-3 bg-rose-500" />
      </span>
      <div className="font-bold text-white leading-tight">{name || 'TikTok Live Aff'}</div>
    </div>
  );
}

function OwnerBox({ store }) {
  const cloud = store.mode === 'cloud';
  const label = cloud ? (store.user?.email || 'ผู้ใช้') : 'เจ้าของ';
  return (
    <div className="mt-auto pt-4 border-t border-white/10">
      <div className="text-[11px] text-slate-400 px-2 flex items-center gap-1.5">
        <span className={cn('inline-block w-1.5 h-1.5 rounded-full', cloud ? 'bg-emerald-400' : 'bg-slate-500')} />
        {cloud ? 'ฐานข้อมูลกลาง (ออนไลน์)' : 'เก็บในเครื่องนี้'}
      </div>
      <div className="text-sm text-slate-200 px-2 mb-2 truncate" title={label}>{label}</div>
      {cloud && (
        <button onClick={() => store.signOut()} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-300 hover:bg-white/5">
          <LogOut size={16} /> ออกจากระบบ
        </button>
      )}
    </div>
  );
}

function FullscreenSpinner({ label }) {
  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center gap-3 text-slate-300">
      <Loader2 size={28} className="animate-spin text-pink-500" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

function ConfigError({ message }) {
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-6 space-y-3">
        <div className="flex items-center gap-2 text-rose-600 font-bold">
          <span className="text-xl">⚠️</span> ตั้งค่าคลาวด์ไม่ถูกต้อง
        </div>
        <p className="text-sm text-slate-600 leading-relaxed">{message}</p>
        <div className="text-xs text-slate-500 bg-slate-50 rounded-lg p-3 space-y-1">
          <p>ตรวจ Environment Variables ใน Vercel ให้มีครบ 2 ตัว แล้ว Redeploy:</p>
          <p><code>VITE_SUPABASE_URL</code> = https://xxxx.supabase.co</p>
          <p><code>VITE_SUPABASE_ANON_KEY</code> = eyJ… (anon public)</p>
        </div>
      </div>
    </div>
  );
}
