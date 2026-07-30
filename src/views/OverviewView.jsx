import React, { useMemo } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell,
} from 'recharts';
import { TrendingUp, Wallet, Megaphone, Video } from 'lucide-react';
import { KpiCard, SectionCard, EmptyState, StatusPill } from '../components/ui.jsx';
import { computeOverview, computeChannelStats } from '../lib/payroll.js';
import { formatCurrency, formatCurrency0, formatBahtCompact, compactCurrency, formatNumber } from '../lib/format.js';

export default function OverviewView({ store, month }) {
  const overview = useMemo(
    () => computeOverview({ channels: store.channels, sales: store.sales, monthKey: month }),
    [store.channels, store.sales, month]
  );

  const ranking = useMemo(
    () =>
      computeChannelStats({
        channels: store.channels,
        sales: store.sales,
        employees: store.employees,
        teams: store.teams,
        monthKey: month,
      }),
    [store.channels, store.sales, store.employees, store.teams, month]
  );

  const chartData = useMemo(
    () => ranking.filter((r) => r.salesTotal > 0).slice(0, 10).map((r) => ({ name: r.channel.name, sales: r.salesTotal, ad: r.adCost })),
    [ranking]
  );

  if (store.channels.length === 0) {
    return (
      <SectionCard>
        <EmptyState
          icon={Video}
          title="ยังไม่มีช่อง TikTok"
          hint="ไปที่เมนู “ช่อง TikTok” เพื่อเพิ่มช่อง หรือไปที่ “ตั้งค่าระบบ → โหลดข้อมูลตัวอย่าง” เพื่อดูตัวอย่าง"
        />
      </SectionCard>
    );
  }

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="ยอดขายรวม" value={formatBahtCompact(overview.totalSales)} valueTitle={formatCurrency(overview.totalSales)} icon={TrendingUp} accent="pink" subtext={`${formatNumber(overview.records)} รายการ`} />
        <KpiCard title="รับจริงรวม" value={formatBahtCompact(overview.totalReceived)} valueTitle={formatCurrency(overview.totalReceived)} icon={Wallet} accent="emerald" />
        <KpiCard title="ค่าแอดรวม" value={formatBahtCompact(overview.totalAd)} valueTitle={formatCurrency(overview.totalAd)} icon={Megaphone} accent="orange" subtext={overview.roas != null ? `ROAS รวม ${overview.roas.toFixed(2)}` : '—'} />
        <KpiCard title="ช่องที่ใช้งาน" value={`${overview.activeChannels} ช่อง`} icon={Video} accent="blue" subtext={`ทั้งหมด ${overview.totalChannels} ช่อง`} />
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Channel comparison chart */}
        <SectionCard title="เปรียบเทียบรายช่อง" className="lg:col-span-2">
          <div className="p-4 h-80">
            {chartData.length === 0 ? (
              <EmptyState title="ยังไม่มียอดขายในช่วงที่เลือก" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} interval={0} angle={-20} textAnchor="end" height={60} />
                  <YAxis tickFormatter={compactCurrency} tick={{ fontSize: 11, fill: '#94a3b8' }} width={52} />
                  <Tooltip
                    formatter={(v, n) => [formatCurrency(v), n === 'sales' ? 'ยอดขาย' : 'ค่าแอด']}
                    contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }}
                  />
                  <Bar dataKey="sales" radius={[6, 6, 0, 0]} maxBarSize={46}>
                    {chartData.map((_, i) => (
                      <Cell key={i} fill="#ec4899" />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </SectionCard>

        {/* Account status */}
        <SectionCard title="สถานะบัญชีช่องทั้งหมด">
          <div className="p-5 space-y-3">
            <StatusRow label="กำลังใช้งาน" pill="active" count={store.channels.filter((c) => c.status === 'active').length} />
            <StatusRow label="พักชั่วคราว" pill="paused" count={store.channels.filter((c) => c.status === 'paused').length} />
            <StatusRow label="ปิดใช้งาน" pill="closed" count={store.channels.filter((c) => c.status === 'closed').length} />
            <div className="pt-3 mt-1 border-t border-slate-100 flex justify-between items-center">
              <span className="text-sm font-semibold text-slate-600">รวมทั้งหมด</span>
              <span className="text-lg font-bold text-slate-800">{store.channels.length} ช่อง</span>
            </div>
          </div>
        </SectionCard>
      </div>

      {/* Channel ranking table */}
      <SectionCard title="อันดับช่อง (ตามยอดขายในช่วงที่เลือก)">
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                <th className="px-5 py-3 font-medium">ช่อง</th>
                <th className="px-4 py-3 font-medium">สถานะ</th>
                <th className="px-4 py-3 font-medium text-right">ยอดขาย</th>
                <th className="px-4 py-3 font-medium text-right">ค่าแอด</th>
                <th className="px-4 py-3 font-medium text-right">ค่าคอมฐาน</th>
                <th className="px-4 py-3 font-medium text-right">รับจริง</th>
                <th className="px-5 py-3 font-medium text-right">ROAS</th>
              </tr>
            </thead>
            <tbody>
              {ranking.map((r) => (
                <tr key={r.channel.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                  <td className="px-5 py-3">
                    <div className="font-medium text-slate-800">{r.channel.name}</div>
                    {r.owner && <div className="text-[11px] text-slate-400">{r.owner.nickname || r.owner.name}</div>}
                  </td>
                  <td className="px-4 py-3"><StatusPill status={r.channel.status} /></td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-800 tabular-nums">{formatCurrency0(r.salesTotal)}</td>
                  <td className="px-4 py-3 text-right text-slate-500 tabular-nums">{formatCurrency0(r.adCost)}</td>
                  <td className="px-4 py-3 text-right text-slate-500 tabular-nums">{formatCurrency0(r.baseCommission)}</td>
                  <td className="px-4 py-3 text-right text-emerald-600 font-medium tabular-nums">{formatCurrency0(r.actualReceived)}</td>
                  <td className="px-5 py-3 text-right tabular-nums font-medium text-slate-700">{r.roas != null ? r.roas.toFixed(1) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}

function StatusRow({ label, pill, count }) {
  return (
    <div className="flex items-center justify-between">
      <StatusPill status={pill} />
      <span className="text-sm font-semibold text-slate-700 tabular-nums">{count} ช่อง</span>
    </div>
  );
}
