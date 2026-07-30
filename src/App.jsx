import React, { useState, useMemo } from 'react';
import {
  BarChart3, Radio, Video, ClipboardList, Trophy, Target,
  CalendarCheck, Settings, LogOut, Menu, X,
} from 'lucide-react';
import { useStore } from './lib/store.js';
import { monthOptionsFrom } from './lib/payroll.js';
import { monthLabel } from './lib/format.js';
import { cn } from './components/ui.jsx';
import OverviewView from './views/OverviewView.jsx';
import RealtimeView from './views/RealtimeView.jsx';
import ChannelsView from './views/ChannelsView.jsx';
import SalesView from './views/SalesView.jsx';
import EmployeesView from './views/EmployeesView.jsx';
import TeamsView from './views/TeamsView.jsx';
import WorkLogView from './views/WorkLogView.jsx';
import SettingsView from './views/SettingsView.jsx';

const NAV = [
  { id: 'overview', label: 'ภาพรวม', icon: BarChart3 },
  { id: 'realtime', label: 'Realtime Live', icon: Radio },
  { id: 'channels', label: 'ช่อง TikTok', icon: Video },
  { id: 'sales', label: 'บันทึกยอดขาย', icon: ClipboardList },
  { id: 'employees', label: 'พนักงาน & KPI', icon: Trophy },
  { id: 'teams', label: 'ทีม & เป้าหมาย', icon: Target },
  { id: 'worklog', label: 'บันทึกงานรายวัน', icon: CalendarCheck },
  { id: 'settings', label: 'ตั้งค่าระบบ', icon: Settings },
];

// Views that show the month selector in the top bar.
const MONTH_VIEWS = new Set(['overview', 'employees', 'teams', 'worklog']);

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
        <OwnerBox />
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
            <OwnerBox />
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

function OwnerBox() {
  return (
    <div className="mt-auto pt-4 border-t border-white/10">
      <div className="text-[11px] text-slate-400 px-2">เจ้าของกิจการ</div>
      <div className="text-sm text-slate-200 px-2 mb-2">เจ้าของ</div>
      <button className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-300 hover:bg-white/5">
        <LogOut size={16} /> ออกจากระบบ
      </button>
    </div>
  );
}
