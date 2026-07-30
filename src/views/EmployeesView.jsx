import React, { useState, useMemo } from 'react';
import { Plus, Pencil, Trash2, Trophy, X } from 'lucide-react';
import {
  SectionCard, Button, EmptyState, Modal, Field, Input, Select, Badge, Banner,
} from '../components/ui.jsx';
import { computePayroll, planFor } from '../lib/payroll.js';
import { formatCurrency0, formatPercent } from '../lib/format.js';

const blankEmployee = () => ({
  name: '', nickname: '', role: '', teamId: '', active: true, kpiTarget: '',
  pay: { baseType: 'monthly', baseAmount: '', commission: { type: 'flat', rate: '', tiers: [] }, kpiBonus: '', adjust: '' },
});

const planLabel = (plan) => {
  if (!plan || plan.type === 'none') return 'ไม่มีคอม';
  if (plan.type === 'flat') return `คอม ${plan.rate || 0}%`;
  if (plan.type === 'tiered') return `คอมขั้นบันได ${plan.tiers?.length || 0} ขั้น`;
  return '—';
};

export default function EmployeesView({ store, month }) {
  const [modal, setModal] = useState(null);

  const payroll = useMemo(
    () => computePayroll({ employees: store.employees, sales: store.sales, workLogs: store.workLogs, settings: store.settings, monthKey: month }),
    [store.employees, store.sales, store.workLogs, store.settings, month]
  );
  const byId = useMemo(() => Object.fromEntries(payroll.map((p) => [p.employee.id, p])), [payroll]);

  const set = (patch) => setModal((m) => ({ ...m, data: { ...m.data, ...patch } }));
  const setPay = (patch) => setModal((m) => ({ ...m, data: { ...m.data, pay: { ...m.data.pay, ...patch } } }));
  const setCommission = (patch) => setPay({ commission: { ...modal.data.pay.commission, ...patch } });

  const save = () => {
    const d = modal.data;
    if (!d.name.trim()) return;
    const clean = {
      ...d,
      kpiTarget: Number(d.kpiTarget) || 0,
      pay: {
        baseType: d.pay.baseType,
        baseAmount: Number(d.pay.baseAmount) || 0,
        kpiBonus: Number(d.pay.kpiBonus) || 0,
        adjust: Number(d.pay.adjust) || 0,
        commission: {
          type: d.pay.commission.type,
          rate: Number(d.pay.commission.rate) || 0,
          tiers: (d.pay.commission.tiers || []).map((t) => ({ from: Number(t.from) || 0, rate: Number(t.rate) || 0 })),
        },
      },
    };
    if (modal.mode === 'add') store.addEmployee(clean);
    else store.updateEmployee(d.id, clean);
    setModal(null);
  };

  const teamName = (id) => store.teams.find((t) => t.id === id)?.name;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button icon={Plus} onClick={() => setModal({ mode: 'add', data: blankEmployee() })} className="bg-pink-600 hover:bg-pink-700">
          เพิ่มพนักงาน
        </Button>
      </div>

      <SectionCard title={`พนักงาน & KPI${month ? '' : ' (สะสมทั้งหมด)'}`}>
        {store.employees.length === 0 ? (
          <EmptyState icon={Trophy} title="ยังไม่มีพนักงาน" hint="กด “เพิ่มพนักงาน” เพื่อกำหนดฐานเงินเดือน คอมมิชชั่น และเป้า KPI" />
        ) : (
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                  <th className="px-5 py-3 font-medium">พนักงาน</th>
                  <th className="px-4 py-3 font-medium">ทีม</th>
                  <th className="px-4 py-3 font-medium">โครงสร้างค่าตอบแทน</th>
                  <th className="px-4 py-3 font-medium text-right">ยอดขาย</th>
                  <th className="px-4 py-3 font-medium">KPI</th>
                  <th className="px-4 py-3 font-medium text-right">รวมรับ</th>
                  <th className="px-5 py-3 font-medium text-right">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {store.employees.map((emp) => {
                  const p = byId[emp.id];
                  const plan = planFor(emp, store.settings);
                  return (
                    <tr key={emp.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                      <td className="px-5 py-3">
                        <div className="font-medium text-slate-800 flex items-center gap-2">
                          {emp.name}{emp.nickname ? <span className="text-slate-400 font-normal">({emp.nickname})</span> : null}
                          {emp.active === false && <Badge color="slate">ไม่ใช้งาน</Badge>}
                        </div>
                        {emp.role && <div className="text-[11px] text-slate-400">{emp.role}</div>}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{teamName(emp.teamId) || '—'}</td>
                      <td className="px-4 py-3 text-slate-600">
                        <div className="flex flex-wrap gap-1">
                          <Badge color="blue">{emp.pay?.baseType === 'daily' ? `รายวัน ฿${formatCurrency0(emp.pay?.baseAmount).replace('฿', '')}` : emp.pay?.baseType === 'monthly' ? `เดือน ฿${formatCurrency0(emp.pay?.baseAmount).replace('฿', '')}` : 'ไม่มีฐาน'}</Badge>
                          <Badge color="amber">{planLabel(plan)}</Badge>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-700">{formatCurrency0(p?.salesTotal || 0)}</td>
                      <td className="px-4 py-3 w-40">
                        {p?.kpiTarget > 0 ? <KpiBar pct={p.kpiPct} hit={p.kpiHit} /> : <span className="text-slate-300 text-xs">ไม่ตั้งเป้า</span>}
                      </td>
                      <td className="px-4 py-3 text-right font-bold tabular-nums text-slate-800">{formatCurrency0(p?.total || 0)}</td>
                      <td className="px-5 py-3">
                        <div className="flex justify-end gap-1">
                          <button onClick={() => setModal({ mode: 'edit', data: { ...blankEmployee(), ...emp, pay: { ...blankEmployee().pay, ...emp.pay, commission: { ...blankEmployee().pay.commission, ...emp.pay?.commission } } } })} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"><Pencil size={15} /></button>
                          <button onClick={() => { if (confirm(`ลบพนักงาน ${emp.name}?`)) store.removeEmployee(emp.id); }} className="p-1.5 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500"><Trash2 size={15} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <EmployeeModal
        modal={modal} setModal={setModal} store={store}
        set={set} setPay={setPay} setCommission={setCommission} save={save}
      />
    </div>
  );
}

function KpiBar({ pct, hit }) {
  const clamped = Math.min(100, Math.max(0, pct || 0));
  return (
    <div>
      <div className="flex justify-between text-[11px] mb-1">
        <span className={hit ? 'text-emerald-600 font-semibold' : 'text-slate-500'}>{formatPercent(pct || 0, 0)}</span>
        {hit && <span className="text-emerald-600 font-semibold">✓ ถึงเป้า</span>}
      </div>
      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${hit ? 'bg-emerald-500' : 'bg-pink-500'}`} style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}

function EmployeeModal({ modal, setModal, store, set, setPay, setCommission, save }) {
  if (!modal) return null;
  const d = modal.data;
  const comm = d.pay.commission;

  const addTier = () => setCommission({ tiers: [...(comm.tiers || []), { from: '', rate: '' }] });
  const setTier = (i, patch) => setCommission({ tiers: comm.tiers.map((t, idx) => (idx === i ? { ...t, ...patch } : t)) });
  const removeTier = (i) => setCommission({ tiers: comm.tiers.filter((_, idx) => idx !== i) });

  return (
    <Modal
      open wide
      onClose={() => setModal(null)}
      title={modal.mode === 'add' ? 'เพิ่มพนักงาน' : 'แก้ไขพนักงาน'}
      footer={
        <>
          <Button variant="secondary" onClick={() => setModal(null)}>ยกเลิก</Button>
          <Button className="bg-pink-600 hover:bg-pink-700" onClick={save}>บันทึก</Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Field label="ชื่อ-สกุล" className="col-span-2"><Input value={d.name} onChange={(e) => set({ name: e.target.value })} autoFocus /></Field>
          <Field label="ชื่อเล่น"><Input value={d.nickname} onChange={(e) => set({ nickname: e.target.value })} /></Field>
          <Field label="ตำแหน่ง"><Input value={d.role} onChange={(e) => set({ role: e.target.value })} placeholder="แม่ค้าไลฟ์" /></Field>
          <Field label="ทีม" className="col-span-2">
            <Select value={d.teamId} onChange={(e) => set({ teamId: e.target.value })}>
              <option value="">— ไม่ระบุ —</option>
              {store.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
          <Field label="สถานะ">
            <Select value={d.active ? '1' : '0'} onChange={(e) => set({ active: e.target.value === '1' })}>
              <option value="1">ใช้งาน</option>
              <option value="0">ไม่ใช้งาน</option>
            </Select>
          </Field>
          <Field label="เป้า KPI ยอดขาย/เดือน (฿)"><Input type="number" value={d.kpiTarget} onChange={(e) => set({ kpiTarget: e.target.value })} placeholder="0" /></Field>
        </div>

        {/* Base pay */}
        <div className="bg-slate-50 rounded-xl p-4 space-y-3">
          <div className="text-sm font-semibold text-slate-700">ค่าจ้างฐาน</div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="รูปแบบฐาน">
              <Select value={d.pay.baseType} onChange={(e) => setPay({ baseType: e.target.value })}>
                <option value="monthly">เงินเดือน (จ่ายเต็มต่อเดือน)</option>
                <option value="daily">รายวัน (× จำนวนวันทำงาน)</option>
                <option value="none">ไม่มีฐาน</option>
              </Select>
            </Field>
            {d.pay.baseType !== 'none' && (
              <Field label={d.pay.baseType === 'daily' ? 'ค่าจ้างต่อวัน (฿)' : 'เงินเดือน (฿)'}>
                <Input type="number" value={d.pay.baseAmount} onChange={(e) => setPay({ baseAmount: e.target.value })} placeholder="0" />
              </Field>
            )}
          </div>
          {d.pay.baseType === 'daily' && (
            <p className="text-[11px] text-slate-400">* จำนวนวันทำงานนับจากเมนู “บันทึกงานรายวัน” (ไม่รวมวันที่ทำเครื่องหมาย “ขาด”)</p>
          )}
        </div>

        {/* Commission */}
        <div className="bg-slate-50 rounded-xl p-4 space-y-3">
          <div className="text-sm font-semibold text-slate-700">คอมมิชชั่น (คิดจากยอดขายของพนักงาน)</div>
          <Field label="รูปแบบคอม">
            <Select value={comm.type} onChange={(e) => setCommission({ type: e.target.value })}>
              <option value="none">ไม่มีคอม</option>
              <option value="flat">อัตราเดียว (%)</option>
              <option value="tiered">ขั้นบันไดตามยอด (%)</option>
            </Select>
          </Field>

          {comm.type === 'flat' && (
            <Field label="อัตราคอม (%)" className="max-w-xs">
              <Input type="number" step="0.1" value={comm.rate} onChange={(e) => setCommission({ rate: e.target.value })} placeholder="เช่น 3" />
            </Field>
          )}

          {comm.type === 'tiered' && (
            <div className="space-y-2">
              <p className="text-[11px] text-slate-500">คิดแบบขั้นบันได (progressive): แต่ละขั้นคิด % เฉพาะส่วนของยอดที่อยู่ในช่วงนั้น</p>
              <div className="space-y-2">
                {(comm.tiers || []).map((t, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-xs text-slate-400 w-16">ตั้งแต่ ฿</span>
                    <Input type="number" value={t.from} onChange={(e) => setTier(i, { from: e.target.value })} placeholder="0" className="w-32" />
                    <span className="text-xs text-slate-400">ขึ้นไป จ่าย</span>
                    <Input type="number" step="0.1" value={t.rate} onChange={(e) => setTier(i, { rate: e.target.value })} placeholder="%" className="w-20" />
                    <span className="text-xs text-slate-400">%</span>
                    <button onClick={() => removeTier(i)} className="p-1 text-slate-400 hover:text-red-500"><X size={15} /></button>
                  </div>
                ))}
              </div>
              <Button size="sm" variant="secondary" icon={Plus} onClick={addTier}>เพิ่มขั้น</Button>
            </div>
          )}
        </div>

        {/* Bonus / adjust */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="โบนัสเมื่อถึงเป้า KPI (฿)" hint="จ่ายเมื่อยอดขายถึงเป้า KPI">
            <Input type="number" value={d.pay.kpiBonus} onChange={(e) => setPay({ kpiBonus: e.target.value })} placeholder="0" />
          </Field>
          <Field label="ปรับเพิ่ม/หัก (฿)" hint="ใส่ค่าติดลบเพื่อหัก เช่น -500">
            <Input type="number" value={d.pay.adjust} onChange={(e) => setPay({ adjust: e.target.value })} placeholder="0" />
          </Field>
        </div>

        <Banner tone="info">
          ยอดรับจริงต่อเดือนจะถูกคำนวณอัตโนมัติ = ฐาน + คอมมิชชั่น + โบนัส KPI + ปรับเพิ่ม/หัก — ดูสรุปคิดเงินทั้งหมดได้ที่เมนู “บันทึกงานรายวัน”
        </Banner>
      </div>
    </Modal>
  );
}
