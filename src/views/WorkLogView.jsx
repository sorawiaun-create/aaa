import React, { useState, useMemo } from 'react';
import { Plus, Trash2, CalendarCheck, Calculator, Download } from 'lucide-react';
import {
  SectionCard, Button, EmptyState, Modal, Field, Input, Select, Badge, KpiCard,
} from '../components/ui.jsx';
import { computePayroll } from '../lib/payroll.js';
import { formatCurrency, formatCurrency0, formatBahtCompact, formatHours, monthLabel, todayDMY, dmyToISO, isoToDMY } from '../lib/format.js';

const STATUS = {
  present: { label: 'มาทำงาน', color: 'green' },
  half: { label: 'ครึ่งวัน', color: 'amber' },
  absent: { label: 'ขาด', color: 'red' },
};

export default function WorkLogView({ store, month }) {
  const [tab, setTab] = useState('payroll'); // 'payroll' | 'log'
  return (
    <div className="space-y-4">
      <div className="inline-flex bg-white border border-slate-200 rounded-xl p-1 shadow-sm">
        <TabBtn active={tab === 'payroll'} onClick={() => setTab('payroll')} icon={Calculator}>สรุปคิดเงินพนักงาน</TabBtn>
        <TabBtn active={tab === 'log'} onClick={() => setTab('log')} icon={CalendarCheck}>บันทึกงานรายวัน</TabBtn>
      </div>
      {tab === 'payroll' ? <Payroll store={store} month={month} /> : <WorkLog store={store} month={month} />}
    </div>
  );
}

function TabBtn({ active, onClick, icon: Icon, children }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${active ? 'bg-pink-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`}>
      <Icon size={16} /> {children}
    </button>
  );
}

// ---------- Payroll (employee pay) ----------
function Payroll({ store, month }) {
  const rows = useMemo(
    () => computePayroll({ employees: store.employees, sales: store.sales, workLogs: store.workLogs, settings: store.settings, monthKey: month }),
    [store.employees, store.sales, store.workLogs, store.settings, month]
  );

  const totals = useMemo(() => rows.reduce((a, r) => ({
    base: a.base + r.base, commission: a.commission + r.commission,
    bonus: a.bonus + r.kpiBonus, adjust: a.adjust + r.adjust, total: a.total + r.total,
    sales: a.sales + r.salesTotal, hours: a.hours + r.liveHours,
  }), { base: 0, commission: 0, bonus: 0, adjust: 0, total: 0, sales: 0, hours: 0 }), [rows]);

  const exportCsv = () => {
    const head = ['พนักงาน', 'ทีม', 'ยอดขาย', 'ชม.ไลฟ์', 'บาท/ชม', 'วันทำงาน', 'ฐาน', 'คอมมิชชั่น', 'โบนัสKPI', 'ปรับเพิ่ม/หัก', 'รวมรับ'];
    const lines = rows.map((r) => [
      r.employee.name,
      store.teams.find((t) => t.id === r.employee.teamId)?.name || '',
      r.salesTotal, r.liveHours, r.salesPerHour ? Math.round(r.salesPerHour) : '', r.daysWorked,
      r.base, r.commission.toFixed(2), r.kpiBonus, r.adjust, r.total.toFixed(2),
    ]);
    const csv = [head, ...lines].map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payroll-${month || 'all'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (store.employees.length === 0) {
    return <SectionCard><EmptyState icon={Calculator} title="ยังไม่มีพนักงาน" hint="เพิ่มพนักงานและตั้งค่าค่าตอบแทนที่เมนู “พนักงาน & KPI”" /></SectionCard>;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="ยอดขายรวม" value={formatBahtCompact(totals.sales)} valueTitle={formatCurrency(totals.sales)} accent="pink" />
        <KpiCard title="ฐาน + คอม" value={formatBahtCompact(totals.base + totals.commission)} valueTitle={formatCurrency(totals.base + totals.commission)} accent="blue" subtext={`คอม ${formatCurrency0(totals.commission)}`} />
        <KpiCard title="โบนัส KPI" value={formatBahtCompact(totals.bonus)} valueTitle={formatCurrency(totals.bonus)} accent="emerald" />
        <KpiCard title="รวมจ่ายทั้งหมด" value={formatBahtCompact(totals.total)} valueTitle={formatCurrency(totals.total)} accent="orange" />
      </div>

      <SectionCard
        title={`คิดเงินพนักงาน — ${month ? monthLabel(month) : 'สะสมทั้งหมด'}`}
        action={<Button size="sm" variant="secondary" icon={Download} onClick={exportCsv}>ส่งออก CSV</Button>}
      >
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                <th className="px-5 py-3 font-medium">พนักงาน</th>
                <th className="px-4 py-3 font-medium text-right">ยอดขาย</th>
                <th className="px-4 py-3 font-medium text-right">ชม.ไลฟ์</th>
                <th className="px-4 py-3 font-medium text-right">วันทำงาน</th>
                <th className="px-4 py-3 font-medium text-right">ฐาน</th>
                <th className="px-4 py-3 font-medium text-right">คอมมิชชั่น</th>
                <th className="px-4 py-3 font-medium text-right">โบนัส KPI</th>
                <th className="px-4 py-3 font-medium text-right">ปรับ</th>
                <th className="px-5 py-3 font-medium text-right">รวมรับ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.employee.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                  <td className="px-5 py-3">
                    <div className="font-medium text-slate-800">{r.employee.name}</div>
                    <div className="text-[11px] text-slate-400">{r.employee.role || '—'}{r.kpiHit ? ' · ✓ ถึงเป้า KPI' : ''}</div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-600">{formatCurrency0(r.salesTotal)}</td>
                  <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap">
                    <div className="text-slate-700">{r.liveHours ? formatHours(r.liveHours) : '—'}</div>
                    {r.salesPerHour ? <div className="text-[11px] text-slate-400">{formatCurrency0(r.salesPerHour)}/ชม</div> : null}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-500">{r.daysWorked || '—'}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-600">{formatCurrency0(r.base)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-600">{formatCurrency0(r.commission)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-emerald-600">{r.kpiBonus ? formatCurrency0(r.kpiBonus) : '—'}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-500">{r.adjust ? formatCurrency0(r.adjust) : '—'}</td>
                  <td className="px-5 py-3 text-right tabular-nums font-bold text-slate-800">{formatCurrency0(r.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-100 font-semibold text-slate-700">
                <td className="px-5 py-3">รวม</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatCurrency0(totals.sales)}</td>
                <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap">{totals.hours ? formatHours(totals.hours) : '—'}</td>
                <td className="px-4 py-3" />
                <td className="px-4 py-3 text-right tabular-nums">{formatCurrency0(totals.base)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatCurrency0(totals.commission)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatCurrency0(totals.bonus)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatCurrency0(totals.adjust)}</td>
                <td className="px-5 py-3 text-right tabular-nums text-pink-600">{formatCurrency0(totals.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}

// ---------- Daily work log (attendance) ----------
function WorkLog({ store, month }) {
  const [modal, setModal] = useState(null);

  const rows = useMemo(() => {
    const list = month ? store.workLogs.filter((w) => dmyToISO(w.date).startsWith(month)) : store.workLogs;
    return [...list].sort((a, b) => dmyToISO(b.date).localeCompare(dmyToISO(a.date)));
  }, [store.workLogs, month]);

  const set = (patch) => setModal((m) => ({ ...m, data: { ...m.data, ...patch } }));
  const save = () => {
    const d = modal.data;
    if (!d.employeeId) return;
    store.addWorkLog(d);
    setModal(null);
  };

  const empName = (id) => { const e = store.employees.find((x) => x.id === id); return e ? e.name : '—'; };
  const chName = (id) => store.channels.find((c) => c.id === id)?.name || '';

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button icon={Plus} disabled={store.employees.length === 0} onClick={() => setModal({ data: { date: todayDMY(), employeeId: '', channelId: '', shift: '', status: 'present', note: '' } })} className="bg-pink-600 hover:bg-pink-700">
          บันทึกงาน
        </Button>
      </div>

      <SectionCard title={`บันทึกงานรายวัน${month ? ` — ${monthLabel(month)}` : ''}`}>
        {rows.length === 0 ? (
          <EmptyState icon={CalendarCheck} title="ยังไม่มีบันทึกงาน" hint="บันทึกการมาทำงานรายวัน เพื่อใช้คำนวณค่าจ้างรายวันและติดตามงาน" />
        ) : (
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                  <th className="px-5 py-3 font-medium">วันที่</th>
                  <th className="px-4 py-3 font-medium">พนักงาน</th>
                  <th className="px-4 py-3 font-medium">ช่อง</th>
                  <th className="px-4 py-3 font-medium">กะ</th>
                  <th className="px-4 py-3 font-medium">สถานะ</th>
                  <th className="px-4 py-3 font-medium">หมายเหตุ</th>
                  <th className="px-5 py-3 font-medium text-right">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((w) => (
                  <tr key={w.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                    <td className="px-5 py-3 whitespace-nowrap text-slate-600">{w.date}</td>
                    <td className="px-4 py-3 text-slate-800">{empName(w.employeeId)}</td>
                    <td className="px-4 py-3 text-slate-500">{chName(w.channelId) || '—'}</td>
                    <td className="px-4 py-3 text-slate-500">{w.shift || '—'}</td>
                    <td className="px-4 py-3"><Badge color={STATUS[w.status]?.color || 'slate'}>{STATUS[w.status]?.label || w.status}</Badge></td>
                    <td className="px-4 py-3 text-slate-500">{w.note || '—'}</td>
                    <td className="px-5 py-3 text-right">
                      <button onClick={() => { if (confirm('ลบบันทึกนี้?')) store.removeWorkLog(w.id); }} className="p-1.5 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500"><Trash2 size={15} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        title="บันทึกงานรายวัน"
        footer={
          <>
            <Button variant="secondary" onClick={() => setModal(null)}>ยกเลิก</Button>
            <Button className="bg-pink-600 hover:bg-pink-700" onClick={save}>บันทึก</Button>
          </>
        }
      >
        {modal && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="วันที่"><Input type="date" value={dmyToISO(modal.data.date)} onChange={(e) => set({ date: isoToDMY(e.target.value) })} /></Field>
              <Field label="สถานะ">
                <Select value={modal.data.status} onChange={(e) => set({ status: e.target.value })}>
                  <option value="present">มาทำงาน</option>
                  <option value="half">ครึ่งวัน</option>
                  <option value="absent">ขาด</option>
                </Select>
              </Field>
            </div>
            <Field label="พนักงาน">
              <Select value={modal.data.employeeId} onChange={(e) => set({ employeeId: e.target.value })}>
                <option value="">— เลือกพนักงาน —</option>
                {store.employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="ช่อง (ถ้ามี)">
                <Select value={modal.data.channelId} onChange={(e) => set({ channelId: e.target.value })}>
                  <option value="">— ไม่ระบุ —</option>
                  {store.channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
              <Field label="กะ / ช่วงเวลา"><Input value={modal.data.shift} onChange={(e) => set({ shift: e.target.value })} placeholder="เช่น บ่าย-ค่ำ" /></Field>
            </div>
            <Field label="หมายเหตุ"><Input value={modal.data.note} onChange={(e) => set({ note: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
