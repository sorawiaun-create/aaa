import React, { useMemo, useState } from 'react';
import { ResponsiveContainer, ComposedChart, BarChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Cell } from 'recharts';
import { Wallet, Users, Banknote, TrendingUp, Plus, Trash2, PiggyBank, Megaphone, LineChart as LineIcon, GitCompareArrows } from 'lucide-react';
import { SectionCard, KpiCard, Button, EmptyState, Modal, Field, Input, Select } from '../components/ui.jsx';
import { computePayroll } from '../lib/payroll.js';
import { computeProfit, expensesByCategory, monthlyPnl, channelPnl } from '../lib/finance.js';
import { formatCurrency, formatCurrency0, formatBahtCompact, formatPercent, compactCurrency, monthLabel, monthKeyOf, todayDMY, dmyToISO, isoToDMY } from '../lib/format.js';

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const INK = { grid: '#e1e0d9', axis: '#898781' };
const tipStyle = { borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12, boxShadow: '0 4px 16px rgba(0,0,0,.08)' };

const CATEGORIES = ['ค่าโฆษณา/ยิงแอด', 'ค่าสินค้า/ตัวอย่าง', 'ค่าเช่าสตูดิโอ', 'อุปกรณ์ไลฟ์', 'ค่าน้ำ-ไฟ-เน็ต', 'ค่าขนส่ง', 'ค่าการตลาด', 'อื่น ๆ'];

const blankExpense = () => ({ date: todayDMY(), category: 'ค่าโฆษณา/ยิงแอด', amount: '', channelId: '', note: '' });

export default function ProfitView({ store, month }) {
  const [modal, setModal] = useState(null);

  const wages = useMemo(() => {
    const rows = computePayroll({ employees: store.employees, sales: store.sales, workLogs: store.workLogs, settings: store.settings, monthKey: month });
    return rows.reduce((a, r) => a + r.total, 0);
  }, [store.employees, store.sales, store.workLogs, store.settings, month]);

  // ค่าแอด ที่กรอกในบันทึกยอดขายรายวัน (ดึงมารวมเป็นต้นทุนอัตโนมัติ)
  const adSpend = useMemo(() => store.sales
    .filter((s) => !month || monthKeyOf(s.date) === month)
    .reduce((a, s) => a + num(s.adCost), 0), [store.sales, month]);

  const pnl = useMemo(() => computeProfit({ imports: store.imports, expenses: store.expenses, wages, adSpend, month }), [store.imports, store.expenses, wages, adSpend, month]);
  const byCat = useMemo(() => expensesByCategory(store.expenses, month), [store.expenses, month]);

  // Monthly P&L trend (all months) — wages recomputed per month from payroll.
  const monthly = useMemo(() => monthlyPnl({
    sales: store.sales, imports: store.imports, expenses: store.expenses,
    wagesFor: (m) => computePayroll({ employees: store.employees, sales: store.sales, workLogs: store.workLogs, settings: store.settings, monthKey: m }).reduce((a, r) => a + r.total, 0),
  }), [store.sales, store.imports, store.expenses, store.employees, store.workLogs, store.settings]);

  const channelRows = useMemo(() => channelPnl({ imports: store.imports, sales: store.sales, expenses: store.expenses, channels: store.channels, month }), [store.imports, store.sales, store.expenses, store.channels, month]);

  const expenseRows = useMemo(() => {
    const list = month ? store.expenses.filter((e) => e.month === month) : store.expenses;
    return [...list].sort((a, b) => dmyToISO(b.date).localeCompare(dmyToISO(a.date)));
  }, [store.expenses, month]);

  const set = (patch) => setModal((m) => ({ ...m, data: { ...m.data, ...patch } }));
  const save = () => {
    const d = modal.data;
    if (!Number(d.amount)) return;
    store.addExpense({ ...d, amount: Number(d.amount), month: monthKeyOf(d.date) });
    setModal(null);
  };
  const chName = (id) => store.channels.find((c) => c.id === id)?.name;

  return (
    <div className="space-y-6">
      {/* P&L KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <KpiCard title="รายรับ (ค่าคอมจริง)" value={formatBahtCompact(pnl.revenue)} valueTitle={formatCurrency(pnl.revenue)} icon={Wallet} accent="emerald" subtext="จากไฟล์ TikTok ที่บันทึก" />
        <KpiCard title="ค่าจ้างพนักงาน" value={formatBahtCompact(pnl.wages)} valueTitle={formatCurrency(pnl.wages)} icon={Users} accent="blue" subtext="จากระบบคิดเงิน" />
        <KpiCard title="ค่าแอด (รายวัน)" value={formatBahtCompact(pnl.adSpend)} valueTitle={formatCurrency(pnl.adSpend)} icon={Megaphone} accent="purple" subtext="จากบันทึกยอดขาย" />
        <KpiCard title="รายจ่ายอื่น" value={formatBahtCompact(pnl.expenses)} valueTitle={formatCurrency(pnl.expenses)} icon={Banknote} accent="orange" />
        <KpiCard title="กำไรสุทธิ" value={formatBahtCompact(pnl.profit)} valueTitle={formatCurrency(pnl.profit)} icon={pnl.profit >= 0 ? TrendingUp : PiggyBank} accent={pnl.profit >= 0 ? 'green' : 'red'} subtext={`มาร์จิ้น ${formatPercent(pnl.marginPct, 1)}`} />
      </div>

      {/* Waterfall breakdown */}
      <SectionCard title={`สรุปกำไร-ขาดทุน${month ? ` — ${monthLabel(month)}` : ' (ทุกเดือน)'}`}>
        <div className="p-5 space-y-3 max-w-2xl">
          <PnlRow label="รายรับ (ค่าคอมจริงจาก TikTok)" value={pnl.revenue} tone="pos" />
          <PnlRow label="หัก ค่าจ้างพนักงาน" value={-pnl.wages} tone="neg" />
          <PnlRow label="หัก ค่าแอด (จากบันทึกยอดขายรายวัน)" value={-pnl.adSpend} tone="neg" />
          <PnlRow label="หัก รายจ่ายอื่น" value={-pnl.expenses} tone="neg" />
          <div className="border-t border-slate-200 pt-3">
            <PnlRow label="กำไรสุทธิ" value={pnl.profit} tone={pnl.profit >= 0 ? 'total' : 'negtotal'} big />
          </div>
        </div>
      </SectionCard>

      {/* Monthly P&L trend */}
      {monthly.length > 0 && (
        <SectionCard title="แนวโน้มกำไรรายเดือน" icon={LineIcon}>
          <div className="p-4 h-80">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={monthly} margin={{ top: 12, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={INK.grid} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: INK.axis }} tickLine={false} axisLine={{ stroke: INK.grid }} />
                <YAxis tickFormatter={compactCurrency} tick={{ fontSize: 11, fill: INK.axis }} width={52} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={tipStyle} formatter={(v, k) => [formatCurrency0(v), k === 'revenue' ? 'รายรับ' : k === 'cost' ? 'ต้นทุนรวม' : 'กำไรสุทธิ']} />
                <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={9} formatter={(k) => (k === 'revenue' ? 'รายรับ' : k === 'cost' ? 'ต้นทุนรวม' : 'กำไรสุทธิ')} />
                <Bar dataKey="revenue" fill="#a7f3d0" radius={[4, 4, 0, 0]} maxBarSize={28} />
                <Bar dataKey="cost" fill="#fed7aa" radius={[4, 4, 0, 0]} maxBarSize={28} />
                <Line type="monotone" dataKey="profit" stroke="#059669" strokeWidth={2.5} dot={{ r: 3, fill: '#059669' }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      )}

      {/* Profit by channel (contribution) */}
      <SectionCard title="กำไรแยกรายช่อง (รายรับ − ค่าแอด − รายจ่ายของช่อง)" icon={GitCompareArrows}>
        {channelRows.length === 0 ? (
          <EmptyState icon={GitCompareArrows} title="ยังไม่มีข้อมูลรายช่อง" hint="ต้องมีไฟล์ที่บันทึกใน “กระทบยอด TikTok” และ/หรือค่าแอดในบันทึกยอดขาย" />
        ) : (
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                  <th className="px-5 py-3 font-medium">ช่อง</th>
                  <th className="px-4 py-3 font-medium text-right">รายรับ (ค่าคอมจริง)</th>
                  <th className="px-4 py-3 font-medium text-right">ค่าแอด</th>
                  <th className="px-4 py-3 font-medium text-right">รายจ่ายช่อง</th>
                  <th className="px-4 py-3 font-medium text-right">ROAS</th>
                  <th className="px-5 py-3 font-medium text-right">กำไรช่อง</th>
                </tr>
              </thead>
              <tbody>
                {channelRows.map((r) => (
                  <tr key={r.channelId} className="border-b border-slate-50 hover:bg-slate-50/60">
                    <td className="px-5 py-3 font-medium text-slate-800">{r.name}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-emerald-600">{formatCurrency0(r.revenue)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-purple-600">{formatCurrency0(r.adSpend)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-500">{r.expense ? formatCurrency0(r.expense) : '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-500">{r.roi != null ? r.roi.toFixed(1) : '—'}</td>
                    <td className={`px-5 py-3 text-right tabular-nums font-bold ${r.contribution >= 0 ? 'text-slate-800' : 'text-red-500'}`}>{r.contribution < 0 ? `−${formatCurrency0(Math.abs(r.contribution))}` : formatCurrency0(r.contribution)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="px-5 py-3 text-[11px] text-slate-400">* “กำไรช่อง” ยังไม่หักค่าจ้างพนักงานส่วนกลาง (เป็นกำไรเฉพาะช่องก่อนค่าใช้จ่ายรวม)</p>
      </SectionCard>

      {/* Expenses management */}
      <SectionCard title="รายจ่ายอื่น (ไม่รวมเงินเดือน)"
        action={<Button size="sm" icon={Plus} onClick={() => setModal({ data: blankExpense() })} className="bg-pink-600 hover:bg-pink-700">เพิ่มรายจ่าย</Button>}>
        {expenseRows.length === 0 ? (
          <EmptyState icon={Banknote} title="ยังไม่มีรายจ่าย" hint="เพิ่มค่าโฆษณา ค่าเช่า อุปกรณ์ ฯลฯ เพื่อคำนวณกำไรสุทธิ (เงินเดือนดึงจากระบบคิดเงินให้อยู่แล้ว)" />
        ) : (
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                  <th className="px-5 py-3 font-medium">วันที่</th>
                  <th className="px-4 py-3 font-medium">หมวด</th>
                  <th className="px-4 py-3 font-medium">ช่อง</th>
                  <th className="px-4 py-3 font-medium">หมายเหตุ</th>
                  <th className="px-4 py-3 font-medium text-right">จำนวนเงิน</th>
                  <th className="px-5 py-3 font-medium text-right">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {expenseRows.map((e) => (
                  <tr key={e.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                    <td className="px-5 py-3 whitespace-nowrap text-slate-600">{e.date}</td>
                    <td className="px-4 py-3 text-slate-700">{e.category}</td>
                    <td className="px-4 py-3 text-slate-500">{chName(e.channelId) || '—'}</td>
                    <td className="px-4 py-3 text-slate-500">{e.note || '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold text-slate-800">{formatCurrency0(e.amount)}</td>
                    <td className="px-5 py-3 text-right">
                      <button onClick={() => { if (confirm('ลบรายจ่ายนี้?')) store.removeExpense(e.id); }} className="p-1.5 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500"><Trash2 size={15} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-100 font-semibold text-slate-700">
                  <td className="px-5 py-3" colSpan={4}>รวมรายจ่าย</td>
                  <td className="px-4 py-3 text-right tabular-nums text-orange-600">{formatCurrency0(pnl.expenses)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </SectionCard>

      {byCat.length > 0 && (
        <SectionCard title="รายจ่ายแยกตามหมวด">
          <div className="p-5 space-y-2 max-w-xl">
            {byCat.map((c) => {
              const pct = pnl.expenses ? (c.amount / pnl.expenses) * 100 : 0;
              return (
                <div key={c.category}>
                  <div className="flex justify-between text-sm mb-1"><span className="text-slate-600">{c.category}</span><span className="tabular-nums font-medium text-slate-700">{formatCurrency0(c.amount)}</span></div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-orange-400 rounded-full" style={{ width: `${pct}%` }} /></div>
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}

      <Modal open={!!modal} onClose={() => setModal(null)} title="เพิ่มรายจ่าย"
        footer={<><Button variant="secondary" onClick={() => setModal(null)}>ยกเลิก</Button><Button className="bg-pink-600 hover:bg-pink-700" onClick={save}>บันทึก</Button></>}>
        {modal && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="วันที่"><Input type="date" value={dmyToISO(modal.data.date)} onChange={(e) => set({ date: isoToDMY(e.target.value) })} /></Field>
              <Field label="จำนวนเงิน (฿)"><Input type="number" value={modal.data.amount} onChange={(e) => set({ amount: e.target.value })} placeholder="0" autoFocus /></Field>
            </div>
            <Field label="หมวดรายจ่าย">
              <Select value={modal.data.category} onChange={(e) => set({ category: e.target.value })}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </Field>
            <Field label="ช่อง (ถ้าเจาะจง)">
              <Select value={modal.data.channelId} onChange={(e) => set({ channelId: e.target.value })}>
                <option value="">— ทั้งกิจการ —</option>
                {store.channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            <Field label="หมายเหตุ"><Input value={modal.data.note} onChange={(e) => set({ note: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
    </div>
  );
}

function PnlRow({ label, value, tone, big }) {
  const color = tone === 'pos' ? 'text-emerald-600' : tone === 'neg' ? 'text-red-500' : tone === 'negtotal' ? 'text-red-600' : tone === 'total' ? 'text-emerald-700' : 'text-slate-700';
  return (
    <div className="flex justify-between items-center">
      <span className={`${big ? 'text-base font-bold text-slate-800' : 'text-sm text-slate-600'}`}>{label}</span>
      <span className={`tabular-nums ${big ? 'text-xl font-bold' : 'font-semibold'} ${color}`}>{value < 0 ? `−${formatCurrency0(Math.abs(value))}` : formatCurrency0(value)}</span>
    </div>
  );
}
