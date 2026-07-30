import React, { useState, useMemo } from 'react';
import { Plus, Pencil, Trash2, ClipboardList } from 'lucide-react';
import {
  SectionCard, Button, EmptyState, Modal, Field, Input, Select, Banner,
} from '../components/ui.jsx';
import { formatCurrency0, todayDMY, dmyToISO, isoToDMY } from '../lib/format.js';

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

const blankSale = () => ({
  date: todayDMY(),
  channelId: '',
  employeeId: '',
  sales: '',
  adCost: '',
  baseCommission: '',
  actualReceived: '',
  note: '',
});

export default function SalesView({ store }) {
  const [modal, setModal] = useState(null);

  const rows = useMemo(() => {
    // Newest date first, then by sales value.
    return [...store.sales].sort((a, b) => {
      const da = dmyToISO(a.date), db = dmyToISO(b.date);
      if (da !== db) return db.localeCompare(da);
      return num(b.sales) - num(a.sales);
    });
  }, [store.sales]);

  const set = (patch) => setModal((m) => ({ ...m, data: { ...m.data, ...patch } }));

  // When a channel is picked, default the employee to its owner.
  const onChannel = (channelId) => {
    const ch = store.channels.find((c) => c.id === channelId);
    set({ channelId, employeeId: modal.data.employeeId || ch?.ownerId || '' });
  };

  const save = () => {
    const d = modal.data;
    if (!d.channelId) return;
    const payload = {
      ...d,
      sales: num(d.sales),
      adCost: num(d.adCost),
      baseCommission: num(d.baseCommission),
      actualReceived: num(d.actualReceived),
    };
    if (modal.mode === 'add') store.addSale(payload);
    else store.updateSale(d.id, payload);
    setModal(null);
  };

  const chName = (id) => store.channels.find((c) => c.id === id)?.name || '—';
  const empName = (id) => { const e = store.employees.find((x) => x.id === id); return e ? e.nickname || e.name : '—'; };

  return (
    <div className="space-y-4">
      {store.channels.length === 0 && (
        <Banner tone="warn">ยังไม่มีช่อง — ไปเพิ่มช่องที่เมนู “ช่อง TikTok” ก่อนบันทึกยอดขาย</Banner>
      )}
      <div className="flex justify-end">
        <Button icon={Plus} disabled={store.channels.length === 0} onClick={() => setModal({ mode: 'add', data: blankSale() })} className="bg-pink-600 hover:bg-pink-700">
          บันทึกยอดขาย
        </Button>
      </div>

      <SectionCard title="รายการยอดขายรายวัน">
        {rows.length === 0 ? (
          <EmptyState icon={ClipboardList} title="ยังไม่มีรายการยอดขาย" hint="กด “บันทึกยอดขาย” เพื่อลงยอดของแต่ละช่องต่อวัน" />
        ) : (
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                  <th className="px-5 py-3 font-medium">วันที่</th>
                  <th className="px-4 py-3 font-medium">ช่อง</th>
                  <th className="px-4 py-3 font-medium">พนักงาน</th>
                  <th className="px-4 py-3 font-medium text-right">ยอดขาย</th>
                  <th className="px-4 py-3 font-medium text-right">ค่าแอด</th>
                  <th className="px-4 py-3 font-medium text-right">ค่าคอมฐาน</th>
                  <th className="px-4 py-3 font-medium text-right">รับจริง</th>
                  <th className="px-5 py-3 font-medium text-right">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                    <td className="px-5 py-3 whitespace-nowrap text-slate-600">{s.date}</td>
                    <td className="px-4 py-3 text-slate-800">{chName(s.channelId)}</td>
                    <td className="px-4 py-3 text-slate-600">{empName(s.employeeId)}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-800">{formatCurrency0(s.sales)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-500">{formatCurrency0(s.adCost)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-500">{formatCurrency0(s.baseCommission)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-emerald-600">{formatCurrency0(s.actualReceived)}</td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => setModal({ mode: 'edit', data: { ...blankSale(), ...s, sales: s.sales, adCost: s.adCost, baseCommission: s.baseCommission, actualReceived: s.actualReceived } })} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"><Pencil size={15} /></button>
                        <button onClick={() => { if (confirm('ลบรายการนี้?')) store.removeSale(s.id); }} className="p-1.5 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500"><Trash2 size={15} /></button>
                      </div>
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
        title={modal?.mode === 'add' ? 'บันทึกยอดขาย' : 'แก้ไขยอดขาย'}
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
              <Field label="วันที่">
                <Input type="date" value={dmyToISO(modal.data.date)} onChange={(e) => set({ date: isoToDMY(e.target.value) })} />
              </Field>
              <Field label="ช่อง">
                <Select value={modal.data.channelId} onChange={(e) => onChannel(e.target.value)}>
                  <option value="">— เลือกช่อง —</option>
                  {store.channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
            </div>
            <Field label="พนักงาน (ผู้ทำยอด)">
              <Select value={modal.data.employeeId} onChange={(e) => set({ employeeId: e.target.value })}>
                <option value="">— ไม่ระบุ —</option>
                {store.employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.name}{emp.nickname ? ` (${emp.nickname})` : ''}</option>)}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="ยอดขาย (฿)">
                <Input type="number" inputMode="decimal" value={modal.data.sales} onChange={(e) => set({ sales: e.target.value })} placeholder="0" />
              </Field>
              <Field label="ค่าแอด (฿)">
                <Input type="number" inputMode="decimal" value={modal.data.adCost} onChange={(e) => set({ adCost: e.target.value })} placeholder="0" />
              </Field>
              <Field label="ค่าคอมฐาน (฿)">
                <Input type="number" inputMode="decimal" value={modal.data.baseCommission} onChange={(e) => set({ baseCommission: e.target.value })} placeholder="0" />
              </Field>
              <Field label="รับจริง (฿)">
                <Input type="number" inputMode="decimal" value={modal.data.actualReceived} onChange={(e) => set({ actualReceived: e.target.value })} placeholder="0" />
              </Field>
            </div>
            <Field label="หมายเหตุ">
              <Input value={modal.data.note} onChange={(e) => set({ note: e.target.value })} />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
