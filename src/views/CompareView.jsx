import React, { useMemo } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, LabelList } from 'recharts';
import { GitCompareArrows, Wallet, TrendingUp, RotateCcw, Video } from 'lucide-react';
import { SectionCard, KpiCard, EmptyState } from '../components/ui.jsx';
import { channelCompare } from '../lib/finance.js';
import { formatCurrency, formatCurrency0, formatBahtCompact, compactCurrency, formatPercent, formatNumber, monthLabel } from '../lib/format.js';

const PINK = '#ec4899';
const INK = { grid: '#e1e0d9', axis: '#898781' };
const tipStyle = { borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12, boxShadow: '0 4px 16px rgba(0,0,0,.08)' };

export default function CompareView({ store, month }) {
  const rows = useMemo(() => channelCompare(store.imports, store.channels, month), [store.imports, store.channels, month]);

  const totals = useMemo(() => rows.reduce((a, r) => ({
    gmv: a.gmv + r.gmv, act: a.act + r.act, est: a.est + r.est, clawback: a.clawback + r.clawback, orders: a.orders + r.orders,
  }), { gmv: 0, act: 0, est: 0, clawback: 0, orders: 0 }), [rows]);

  const avgClawback = totals.est ? (totals.clawback / totals.est) * 100 : 0;
  const actChart = rows.filter((r) => r.act > 0).slice(0, 12).map((r) => ({ name: r.name, act: Math.round(r.act) }));
  const clawChart = rows.filter((r) => r.est > 0).slice(0, 12).map((r) => ({ name: r.name, pct: Math.round(r.clawbackPct * 10) / 10 }));

  if (store.imports.length === 0) {
    return (
      <SectionCard>
        <EmptyState icon={GitCompareArrows} title="ยังไม่มีข้อมูลให้เปรียบเทียบ"
          hint="ไปที่เมนู “กระทบยอด TikTok” อัปโหลดไฟล์ของแต่ละช่อง แล้วกด “บันทึกขึ้นคลาวด์” — จากนั้นกลับมาที่นี่เพื่อเปรียบเทียบ" />
      </SectionCard>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="รับจริงรวม" value={formatBahtCompact(totals.act)} valueTitle={formatCurrency(totals.act)} icon={Wallet} accent="emerald" subtext={`${formatNumber(totals.orders)} ออเดอร์`} />
        <KpiCard title="GMV รวม" value={formatBahtCompact(totals.gmv)} valueTitle={formatCurrency(totals.gmv)} icon={TrendingUp} accent="pink" />
        <KpiCard title="% ตีกลับเฉลี่ย" value={formatPercent(avgClawback, 1)} icon={RotateCcw} accent="red" subtext={`หายไป ${formatCurrency0(totals.clawback)}`} />
        <KpiCard title="ช่องที่มีข้อมูล" value={`${rows.length} ช่อง`} icon={Video} accent="blue" subtext={month ? monthLabel(month) : 'ทุกเดือน'} />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <SectionCard title="ค่าคอมรับจริง รายช่อง">
          <div className="p-4 h-80">
            {actChart.length === 0 ? <EmptyState title="ยังไม่มีข้อมูล" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={actChart} layout="vertical" margin={{ top: 4, right: 56, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={INK.grid} horizontal={false} />
                  <XAxis type="number" tickFormatter={compactCurrency} tick={{ fontSize: 11, fill: INK.axis }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11, fill: INK.axis }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tipStyle} formatter={(v) => [formatCurrency0(v), 'รับจริง']} />
                  <Bar dataKey="act" fill="#10b981" radius={[0, 4, 4, 0]} maxBarSize={22}>
                    <LabelList dataKey="act" position="right" formatter={(v) => formatCurrency0(v)} style={{ fontSize: 10, fill: INK.axis }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </SectionCard>

        <SectionCard title="% ตีกลับ รายช่อง (ยิ่งต่ำยิ่งดี)">
          <div className="p-4 h-80">
            {clawChart.length === 0 ? <EmptyState title="ยังไม่มีข้อมูล" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={clawChart} layout="vertical" margin={{ top: 4, right: 44, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={INK.grid} horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: INK.axis }} axisLine={false} tickLine={false} unit="%" />
                  <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11, fill: INK.axis }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tipStyle} formatter={(v) => [`${v}%`, '% ตีกลับ']} />
                  <Bar dataKey="pct" radius={[0, 4, 4, 0]} maxBarSize={22}>
                    {clawChart.map((c, i) => <Cell key={i} fill={c.pct >= 30 ? '#e11d48' : c.pct >= 15 ? '#f59e0b' : '#10b981'} />)}
                    <LabelList dataKey="pct" position="right" formatter={(v) => `${v}%`} style={{ fontSize: 10, fill: INK.axis }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </SectionCard>
      </div>

      <SectionCard title={`ตารางเปรียบเทียบช่อง${month ? ` — ${monthLabel(month)}` : ''}`}>
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                <th className="px-5 py-3 font-medium">ช่อง</th>
                <th className="px-4 py-3 font-medium text-right">ออเดอร์</th>
                <th className="px-4 py-3 font-medium text-right">GMV</th>
                <th className="px-4 py-3 font-medium text-right">ค่าคอมประมาณ</th>
                <th className="px-4 py-3 font-medium text-right">รับจริง</th>
                <th className="px-4 py-3 font-medium text-right">% ตีกลับ</th>
                <th className="px-5 py-3 font-medium text-right">% คืนสินค้า</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.channelId || 'none'} className="border-b border-slate-50 hover:bg-slate-50/60">
                  <td className="px-5 py-3 font-medium text-slate-800">{r.name}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-600">{formatNumber(r.orders)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-600">{formatCurrency0(r.gmv)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-500">{formatCurrency0(r.est)}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold text-emerald-600">{formatCurrency0(r.act)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-red-500">{formatPercent(r.clawbackPct, 1)}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-slate-500">{formatPercent(r.returnRatePct, 2)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-100 font-semibold text-slate-700">
                <td className="px-5 py-3">รวม</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatNumber(totals.orders)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatCurrency0(totals.gmv)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatCurrency0(totals.est)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-emerald-600">{formatCurrency0(totals.act)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-red-500">{formatPercent(avgClawback, 1)}</td>
                <td className="px-5 py-3" />
              </tr>
            </tfoot>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
