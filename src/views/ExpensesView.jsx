import React, { useState, useMemo } from 'react';
import {
  Banknote, Plus, Trash2, TrendingUp, TrendingDown, Wallet, Coins, Info,
} from 'lucide-react';
import { SectionCard, Button, EmptyState, Banner, KpiCard, Badge } from '../components/ui.jsx';
import { formatCurrency, formatNumber, parseMoney, monthLabel } from '../lib/format.js';

const COMMON_CATEGORIES = [
  'เงินเดือนพนักงาน', 'ค่าเช่า', 'ค่าน้ำ/ค่าไฟ', 'ค่าการตลาด/โฆษณา',
  'ค่าบรรจุภัณฑ์', 'ค่าขนส่ง', 'ค่าอุปกรณ์/เครื่องมือ', 'ภาษี/ค่าธรรมเนียม', 'อื่นๆ',
];

const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export default function ExpensesView({ store, recon }) {
  const { expenses, addExpense, updateExpense, removeExpense } = store;
  const [draft, setDraft] = useState({ month: thisMonth(), category: '', amount: '', note: '' });

  const add = () => {
    if (!draft.month || !draft.category.trim() || !parseMoney(draft.amount)) return;
    addExpense({
      month: draft.month,
      category: draft.category.trim(),
      amount: parseMoney(draft.amount),
      note: draft.note.trim(),
    });
    setDraft({ month: draft.month, category: '', amount: '', note: '' });
  };

  // Group expenses by month (desc), with subtotals.
  const grouped = useMemo(() => {
    const map = {};
    expenses.forEach((e) => {
      const mk = e.month || 'ไม่ระบุ';
      if (!map[mk]) map[mk] = { month: mk, items: [], total: 0 };
      map[mk].items.push(e);
      map[mk].total += Number(e.amount) || 0;
    });
    return Object.values(map).sort((a, b) => (a.month < b.month ? 1 : -1));
  }, [expenses]);

  const companyProfitable = recon.companyNetProfit >= 0;

  return (
    <div className="space-y-6">
      <Banner tone="info">
        <Info size={16} className="mt-0.5 shrink-0" />
        <span>
          กรอกรายจ่ายทั่วไปของบริษัท (เงินเดือน, ค่าเช่า, ค่าน้ำไฟ ฯลฯ) แยกตามเดือน —
          ระบบจะนำไปหักจากกำไรการขาย เพื่อบอกว่า <b>เดือนนั้นบริษัทกำไรหรือขาดทุนจริง</b>
        </span>
      </Banner>

      {/* Company P&L summary (respects the top filter's month range) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard title="กำไรจากการขาย (สุทธิ)" value={formatCurrency(recon.netProfit)} subtext="หลังหักต้นทุน + ค่าธรรมเนียม" icon={Coins} accent="blue" />
        <KpiCard title="รายจ่ายทั่วไปรวม" value={formatCurrency(recon.opexTotal)} subtext={`${formatNumber(expenses.length)} รายการ`} icon={Wallet} accent="orange" />
        <KpiCard
          title="กำไร/ขาดทุนบริษัท"
          value={formatCurrency(recon.companyNetProfit)}
          subtext={companyProfitable ? 'กำไรสุทธิบริษัท' : 'ขาดทุน'}
          icon={companyProfitable ? TrendingUp : TrendingDown}
          accent={companyProfitable ? 'green' : 'red'}
        />
      </div>

      {/* Add form */}
      <SectionCard title="เพิ่มรายจ่าย" icon={Plus}>
        <div className="p-5 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <input type="month" value={draft.month} onChange={(e) => setDraft({ ...draft, month: e.target.value })} className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-200 focus:outline-none" />
            <input value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} placeholder="หมวดรายจ่าย *" className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-200 focus:outline-none" />
            <input value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} placeholder="จำนวนเงิน *" inputMode="decimal" className="border border-slate-200 rounded-lg px-3 py-2 text-sm text-right focus:ring-2 focus:ring-blue-200 focus:outline-none" />
            <input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder="หมายเหตุ" className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-200 focus:outline-none" />
            <Button icon={Plus} onClick={add} disabled={!draft.month || !draft.category.trim() || !parseMoney(draft.amount)}>เพิ่ม</Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {COMMON_CATEGORIES.map((c) => (
              <button key={c} onClick={() => setDraft({ ...draft, category: c })} className="px-2.5 py-1 rounded-full text-xs border border-slate-200 text-slate-600 hover:bg-slate-50">
                + {c}
              </button>
            ))}
          </div>
        </div>
      </SectionCard>

      {/* List grouped by month */}
      <SectionCard title={`รายการรายจ่าย (${formatNumber(expenses.length)})`} icon={Banknote}>
        {expenses.length === 0 ? (
          <EmptyState icon={Banknote} title="ยังไม่มีรายจ่าย" hint="เพิ่มรายจ่ายทั่วไปด้านบน เช่น เงินเดือน ค่าเช่า" />
        ) : (
          <div className="p-3 space-y-4">
            {grouped.map((g) => (
              <div key={g.month} className="border border-slate-100 rounded-xl overflow-hidden">
                <div className="flex justify-between items-center bg-slate-50 px-4 py-2.5">
                  <span className="font-semibold text-slate-700">{monthLabel(g.month)}</span>
                  <span className="text-sm text-slate-500">รวม <b className="text-slate-800">{formatCurrency(g.total)}</b></span>
                </div>
                <table className="w-full text-sm text-left">
                  <tbody className="divide-y divide-slate-100">
                    {g.items.map((e) => (
                      <tr key={e.id} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5 w-1/3">
                          <Badge color="slate">{e.category}</Badge>
                        </td>
                        <td className="px-4 py-2.5 text-slate-500">{e.note || '-'}</td>
                        <td className="px-4 py-2.5 text-right w-40">
                          <input
                            type="number"
                            value={e.amount || ''}
                            onChange={(ev) => updateExpense(e.id, { amount: parseMoney(ev.target.value) })}
                            className="w-32 text-right px-2 py-1 rounded-lg border border-slate-200 focus:ring-2 focus:ring-blue-200 focus:outline-none"
                          />
                        </td>
                        <td className="px-4 py-2.5 text-right w-12">
                          <button onClick={() => removeExpense(e.id)} className="text-slate-400 hover:text-red-500 p-1.5 rounded-lg hover:bg-red-50" title="ลบ">
                            <Trash2 size={15} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
