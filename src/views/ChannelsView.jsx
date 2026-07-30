import React, { useState, useMemo } from 'react';
import { Plus, Pencil, Trash2, Video, Search } from 'lucide-react';
import {
  SectionCard, Button, EmptyState, StatusPill, Modal, Field, Input, Select,
} from '../components/ui.jsx';
import { computeChannelStats } from '../lib/payroll.js';
import { formatCurrency0 } from '../lib/format.js';

const BLANK = { name: '', status: 'active', ownerId: '', teamId: '', note: '' };

export default function ChannelsView({ store }) {
  const [modal, setModal] = useState(null); // { mode:'add'|'edit', data }
  const [q, setQ] = useState('');

  const stats = useMemo(
    () => computeChannelStats({ channels: store.channels, sales: store.sales, employees: store.employees, teams: store.teams }),
    [store.channels, store.sales, store.employees, store.teams]
  );
  const byId = useMemo(() => Object.fromEntries(stats.map((s) => [s.channel.id, s])), [stats]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = [...store.channels].sort((a, b) => (byId[b.id]?.salesTotal || 0) - (byId[a.id]?.salesTotal || 0));
    if (!term) return list;
    return list.filter((c) => c.name.toLowerCase().includes(term));
  }, [store.channels, byId, q]);

  const save = () => {
    const d = modal.data;
    if (!d.name.trim()) return;
    if (modal.mode === 'add') store.addChannel(d);
    else store.updateChannel(d.id, d);
    setModal(null);
  };

  const set = (patch) => setModal((m) => ({ ...m, data: { ...m.data, ...patch } }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input placeholder="ค้นหาช่อง…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9 w-64" />
        </div>
        <Button icon={Plus} onClick={() => setModal({ mode: 'add', data: { ...BLANK } })} className="bg-pink-600 hover:bg-pink-700">
          เพิ่มช่อง
        </Button>
      </div>

      <SectionCard>
        {filtered.length === 0 ? (
          <EmptyState icon={Video} title="ยังไม่มีช่อง" hint="กด “เพิ่มช่อง” เพื่อลงทะเบียนช่อง TikTok" />
        ) : (
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                  <th className="px-5 py-3 font-medium">ช่อง</th>
                  <th className="px-4 py-3 font-medium">ผู้ดูแล</th>
                  <th className="px-4 py-3 font-medium">ทีม</th>
                  <th className="px-4 py-3 font-medium">สถานะ</th>
                  <th className="px-4 py-3 font-medium text-right">ยอดขายสะสม</th>
                  <th className="px-5 py-3 font-medium text-right">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => {
                  const owner = store.employees.find((e) => e.id === c.ownerId);
                  const team = store.teams.find((t) => t.id === c.teamId);
                  return (
                    <tr key={c.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                      <td className="px-5 py-3">
                        <div className="font-medium text-slate-800">{c.name}</div>
                        {c.note && <div className="text-[11px] text-slate-400">{c.note}</div>}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{owner ? owner.nickname || owner.name : '—'}</td>
                      <td className="px-4 py-3 text-slate-600">{team ? team.name : '—'}</td>
                      <td className="px-4 py-3"><StatusPill status={c.status} /></td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-700">{formatCurrency0(byId[c.id]?.salesTotal || 0)}</td>
                      <td className="px-5 py-3">
                        <div className="flex justify-end gap-1">
                          <button onClick={() => setModal({ mode: 'edit', data: { ...BLANK, ...c } })} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"><Pencil size={15} /></button>
                          <button onClick={() => { if (confirm(`ลบช่อง ${c.name}?`)) store.removeChannel(c.id); }} className="p-1.5 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500"><Trash2 size={15} /></button>
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

      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        title={modal?.mode === 'add' ? 'เพิ่มช่อง TikTok' : 'แก้ไขช่อง'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModal(null)}>ยกเลิก</Button>
            <Button className="bg-pink-600 hover:bg-pink-700" onClick={save}>บันทึก</Button>
          </>
        }
      >
        {modal && (
          <div className="space-y-4">
            <Field label="ชื่อช่อง / @handle">
              <Input value={modal.data.name} onChange={(e) => set({ name: e.target.value })} placeholder="@beautyglow.official" autoFocus />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="สถานะ">
                <Select value={modal.data.status} onChange={(e) => set({ status: e.target.value })}>
                  <option value="active">กำลังใช้งาน</option>
                  <option value="paused">พักชั่วคราว</option>
                  <option value="closed">ปิดใช้งาน</option>
                </Select>
              </Field>
              <Field label="ทีม">
                <Select value={modal.data.teamId} onChange={(e) => set({ teamId: e.target.value })}>
                  <option value="">— ไม่ระบุ —</option>
                  {store.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </Select>
              </Field>
            </div>
            <Field label="ผู้ดูแล (พนักงาน)">
              <Select value={modal.data.ownerId} onChange={(e) => set({ ownerId: e.target.value })}>
                <option value="">— ไม่ระบุ —</option>
                {store.employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.name}{emp.nickname ? ` (${emp.nickname})` : ''}</option>)}
              </Select>
            </Field>
            <Field label="หมายเหตุ">
              <Input value={modal.data.note} onChange={(e) => set({ note: e.target.value })} placeholder="เช่น ช่องหลัก / ช่องสำรอง" />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
