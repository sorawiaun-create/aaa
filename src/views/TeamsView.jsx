import React, { useState, useMemo } from 'react';
import { Plus, Pencil, Trash2, Target, Users } from 'lucide-react';
import {
  SectionCard, Button, EmptyState, Modal, Field, Input, Select,
} from '../components/ui.jsx';
import { computeTeamStats } from '../lib/payroll.js';
import { formatCurrency0, formatPercent } from '../lib/format.js';

const BLANK = { name: '', targetSales: '', leaderId: '', note: '' };

export default function TeamsView({ store, month }) {
  const [modal, setModal] = useState(null);

  const stats = useMemo(
    () => computeTeamStats({ teams: store.teams, channels: store.channels, sales: store.sales, employees: store.employees, monthKey: month }),
    [store.teams, store.channels, store.sales, store.employees, month]
  );

  const set = (patch) => setModal((m) => ({ ...m, data: { ...m.data, ...patch } }));
  const save = () => {
    const d = modal.data;
    if (!d.name.trim()) return;
    const clean = { ...d, targetSales: Number(d.targetSales) || 0 };
    if (modal.mode === 'add') store.addTeam(clean);
    else store.updateTeam(d.id, clean);
    setModal(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button icon={Plus} onClick={() => setModal({ mode: 'add', data: { ...BLANK } })} className="bg-pink-600 hover:bg-pink-700">
          เพิ่มทีม
        </Button>
      </div>

      {store.teams.length === 0 ? (
        <SectionCard>
          <EmptyState icon={Target} title="ยังไม่มีทีม" hint="สร้างทีมเพื่อจัดกลุ่มพนักงาน/ช่อง และตั้งเป้ายอดขายรวม" />
        </SectionCard>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {stats.map((s) => (
            <div key={s.team.id} className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-bold text-slate-800">{s.team.name}</h3>
                  <div className="text-xs text-slate-400 mt-0.5 flex items-center gap-3">
                    <span className="flex items-center gap-1"><Users size={12} /> {s.memberCount} คน</span>
                    <span>{s.channelCount} ช่อง</span>
                    {s.leader && <span>หัวหน้า: {s.leader.nickname || s.leader.name}</span>}
                  </div>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => setModal({ mode: 'edit', data: { ...BLANK, ...s.team } })} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"><Pencil size={15} /></button>
                  <button onClick={() => { if (confirm(`ลบทีม ${s.team.name}?`)) store.removeTeam(s.team.id); }} className="p-1.5 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500"><Trash2 size={15} /></button>
                </div>
              </div>

              <div className="mt-4">
                <div className="flex justify-between items-end mb-1">
                  <span className="text-2xl font-bold text-slate-800 tabular-nums">{formatCurrency0(s.salesTotal)}</span>
                  {s.target > 0 && <span className="text-xs text-slate-400">เป้า {formatCurrency0(s.target)}</span>}
                </div>
                {s.target > 0 ? (
                  <>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${s.pct >= 100 ? 'bg-emerald-500' : 'bg-gradient-to-r from-rose-500 to-pink-600'}`} style={{ width: `${Math.min(100, s.pct)}%` }} />
                    </div>
                    <div className="text-xs mt-1 font-medium text-slate-500">{formatPercent(s.pct, 0)} ของเป้า{s.pct >= 100 ? ' 🎉' : ''}</div>
                  </>
                ) : (
                  <div className="text-xs text-slate-300">ยังไม่ได้ตั้งเป้า</div>
                )}
              </div>
              {s.team.note && <p className="text-xs text-slate-400 mt-3">{s.team.note}</p>}
            </div>
          ))}
        </div>
      )}

      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        title={modal?.mode === 'add' ? 'เพิ่มทีม' : 'แก้ไขทีม'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModal(null)}>ยกเลิก</Button>
            <Button className="bg-pink-600 hover:bg-pink-700" onClick={save}>บันทึก</Button>
          </>
        }
      >
        {modal && (
          <div className="space-y-4">
            <Field label="ชื่อทีม"><Input value={modal.data.name} onChange={(e) => set({ name: e.target.value })} autoFocus /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="เป้ายอดขาย/เดือน (฿)"><Input type="number" value={modal.data.targetSales} onChange={(e) => set({ targetSales: e.target.value })} placeholder="0" /></Field>
              <Field label="หัวหน้าทีม">
                <Select value={modal.data.leaderId} onChange={(e) => set({ leaderId: e.target.value })}>
                  <option value="">— ไม่ระบุ —</option>
                  {store.employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
                </Select>
              </Field>
            </div>
            <Field label="หมายเหตุ"><Input value={modal.data.note} onChange={(e) => set({ note: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
