import React, { useMemo } from 'react';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, LabelList,
} from 'recharts';
import { BarChart3, TrendingUp, Users, PieChart as PieIcon, Wallet, Gauge } from 'lucide-react';
import { SectionCard, EmptyState } from '../components/ui.jsx';
import { salesByDay, salesByMonth, salesByTeam } from '../lib/reports.js';
import { computePayroll, computeChannelStats } from '../lib/payroll.js';
import { monthKeyOf, monthLabel, formatCurrency, formatCurrency0, compactCurrency, formatPercent } from '../lib/format.js';

// Brand + CVD-safe categorical palette (validated for the white card surface).
const PINK = '#ec4899';       // "ยอดขาย" — one entity, one colour, used everywhere it appears
const CAT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#4a3aa7', '#008300', '#e34948'];
const INK = { grid: '#e1e0d9', axis: '#898781' };

const axisTick = { fontSize: 11, fill: INK.axis };
const tipStyle = { borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12, boxShadow: '0 4px 16px rgba(0,0,0,.08)' };

const bahtTip = (label) => ({ active, payload }) =>
  active && payload?.length ? (
    <div style={tipStyle} className="bg-white px-3 py-2">
      {label && <div className="text-[11px] text-slate-400 mb-1">{payload[0]?.payload?.[label]}</div>}
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 text-slate-700">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: p.color }} />
          <span className="text-slate-500">{p.name}</span>
          <b className="ml-auto tabular-nums">{formatCurrency0(p.value)}</b>
        </div>
      ))}
    </div>
  ) : null;

export default function ReportsView({ store, month }) {
  const effMonth = useMemo(() => {
    if (month) return month;
    const keys = [...new Set(store.sales.map((s) => monthKeyOf(s.date)).filter(Boolean))].sort();
    return keys[keys.length - 1] || '';
  }, [month, store.sales]);

  const daily = useMemo(() => salesByDay(store.sales, effMonth), [store.sales, effMonth]);
  const monthly = useMemo(() => salesByMonth(store.sales), [store.sales]);
  const teamShare = useMemo(
    () => salesByTeam(store.teams, store.channels, store.sales, month),
    [store.teams, store.channels, store.sales, month]
  );
  const payroll = useMemo(
    () => computePayroll({ employees: store.employees, sales: store.sales, workLogs: store.workLogs, settings: store.settings, monthKey: month }),
    [store.employees, store.sales, store.workLogs, store.settings, month]
  );
  const channels = useMemo(
    () => computeChannelStats({ channels: store.channels, sales: store.sales, monthKey: month }),
    [store.channels, store.sales, month]
  );

  const topEmployees = useMemo(
    () => payroll.filter((p) => p.salesTotal > 0).sort((a, b) => b.salesTotal - a.salesTotal).slice(0, 8)
      .map((p) => ({ name: p.employee.nickname || p.employee.name, sales: p.salesTotal })),
    [payroll]
  );
  const payStacked = useMemo(
    () => payroll.filter((p) => p.total > 0).slice(0, 8)
      .map((p) => ({ name: p.employee.nickname || p.employee.name, 'ฐาน': p.base, 'คอมมิชชั่น': p.commission, 'โบนัส': p.kpiBonus })),
    [payroll]
  );
  const roas = useMemo(
    () => channels.filter((c) => c.roas != null).sort((a, b) => b.roas - a.roas).slice(0, 8)
      .map((c) => ({ name: c.channel.name, roas: Number(c.roas.toFixed(1)) })),
    [channels]
  );

  if (store.sales.length === 0) {
    return (
      <SectionCard>
        <EmptyState icon={BarChart3} title="ยังไม่มีข้อมูลสำหรับทำรายงาน" hint="บันทึกยอดขายก่อน หรือโหลดข้อมูลตัวอย่างที่ “ตั้งค่าระบบ”" />
      </SectionCard>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Daily sales trend (brand pink area) */}
        <SectionCard title={`แนวโน้มยอดขายรายวัน — ${effMonth ? monthLabel(effMonth) : '—'}`} icon={TrendingUp} className="lg:col-span-2">
          <div className="p-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={daily} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gSales" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={PINK} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={PINK} stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={INK.grid} vertical={false} />
                <XAxis dataKey="day" tick={axisTick} tickLine={false} axisLine={{ stroke: INK.grid }} />
                <YAxis tickFormatter={compactCurrency} tick={axisTick} width={52} tickLine={false} axisLine={false} />
                <Tooltip content={bahtTip()} />
                <Area type="monotone" dataKey="sales" name="ยอดขาย" stroke={PINK} strokeWidth={2} fill="url(#gSales)" dot={{ r: 2.5, fill: PINK }} activeDot={{ r: 5 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        {/* Monthly sales + growth */}
        <SectionCard title="ยอดขายรายเดือน" icon={BarChart3}>
          <div className="p-4 h-72">
            {monthly.length === 0 ? <EmptyState title="ยังไม่มีข้อมูล" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthly} margin={{ top: 20, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={INK.grid} vertical={false} />
                  <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: INK.grid }} />
                  <YAxis tickFormatter={compactCurrency} tick={axisTick} width={52} tickLine={false} axisLine={false} />
                  <Tooltip content={bahtTip()} cursor={{ fill: 'rgba(236,72,153,.06)' }} />
                  <Bar dataKey="sales" name="ยอดขาย" fill={PINK} radius={[4, 4, 0, 0]} maxBarSize={44} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </SectionCard>

        {/* Sales share by team (donut) */}
        <SectionCard title="สัดส่วนยอดขายตามทีม" icon={PieIcon}>
          <div className="p-4 h-72">
            {teamShare.length === 0 ? <EmptyState title="ยังไม่มีข้อมูลทีม" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={teamShare} dataKey="value" nameKey="name" innerRadius={52} outerRadius={90} paddingAngle={2} stroke="#fff" strokeWidth={2}
                    label={({ percent }) => `${Math.round(percent * 100)}%`} labelLine={false} fontSize={12}>
                    {teamShare.map((_, i) => <Cell key={i} fill={CAT[i % CAT.length]} />)}
                  </Pie>
                  <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={9} />
                  <Tooltip content={bahtTip()} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </SectionCard>

        {/* Top employees by sales */}
        <SectionCard title="อันดับพนักงานตามยอดขาย" icon={Users}>
          <div className="p-4 h-72">
            {topEmployees.length === 0 ? <EmptyState title="ยังไม่มียอดขายของพนักงาน" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topEmployees} layout="vertical" margin={{ top: 4, right: 40, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={INK.grid} horizontal={false} />
                  <XAxis type="number" tickFormatter={compactCurrency} tick={axisTick} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="name" tick={axisTick} width={70} tickLine={false} axisLine={false} />
                  <Tooltip content={bahtTip()} cursor={{ fill: 'rgba(236,72,153,.06)' }} />
                  <Bar dataKey="sales" name="ยอดขาย" fill={PINK} radius={[0, 4, 4, 0]} maxBarSize={22}>
                    <LabelList dataKey="sales" position="right" formatter={(v) => formatCurrency0(v)} style={{ fontSize: 10, fill: INK.axis }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </SectionCard>

        {/* Pay structure (stacked) */}
        <SectionCard title="โครงสร้างค่าจ้างพนักงาน" icon={Wallet}>
          <div className="p-4 h-72">
            {payStacked.length === 0 ? <EmptyState title="ยังไม่มีข้อมูลค่าจ้าง" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={payStacked} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={INK.grid} horizontal={false} />
                  <XAxis type="number" tickFormatter={compactCurrency} tick={axisTick} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="name" tick={axisTick} width={70} tickLine={false} axisLine={false} />
                  <Tooltip content={bahtTip()} cursor={{ fill: 'rgba(0,0,0,.04)' }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={9} />
                  <Bar dataKey="ฐาน" stackId="p" fill={CAT[0]} maxBarSize={22} />
                  <Bar dataKey="คอมมิชชั่น" stackId="p" fill={CAT[1]} maxBarSize={22} />
                  <Bar dataKey="โบนัส" stackId="p" fill={CAT[2]} radius={[0, 4, 4, 0]} maxBarSize={22} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </SectionCard>

        {/* ROAS by channel */}
        <SectionCard title="ROAS รายช่อง (สูงสุด)" icon={Gauge}>
          <div className="p-4 h-72">
            {roas.length === 0 ? <EmptyState title="ยังไม่มีข้อมูล ROAS (ต้องมีค่าแอด)" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={roas} margin={{ top: 20, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={INK.grid} vertical={false} />
                  <XAxis dataKey="name" tick={{ ...axisTick, fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={54} tickLine={false} axisLine={{ stroke: INK.grid }} />
                  <YAxis tick={axisTick} width={36} tickLine={false} axisLine={false} />
                  <Tooltip
                    cursor={{ fill: 'rgba(37,120,214,.06)' }}
                    contentStyle={tipStyle}
                    formatter={(v) => [v, 'ROAS']}
                  />
                  <Bar dataKey="roas" name="ROAS" fill={CAT[0]} radius={[4, 4, 0, 0]} maxBarSize={40}>
                    <LabelList dataKey="roas" position="top" style={{ fontSize: 10, fill: INK.axis }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </SectionCard>
      </div>

      <p className="text-[11px] text-slate-400 text-center">
        * เลือกเดือนที่แถบด้านบนเพื่อกรองรายงาน (กราฟแนวโน้มรายวันจะใช้เดือนล่าสุดอัตโนมัติเมื่อเลือก “ทุกเดือน”)
      </p>
    </div>
  );
}
