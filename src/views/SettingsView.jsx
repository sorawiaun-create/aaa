import React, { useRef, useState } from 'react';
import { Save, Download, Upload, Trash2, Sparkles, Building2, Percent, X, Plus } from 'lucide-react';
import { SectionCard, Button, Field, Input, Select, Banner } from '../components/ui.jsx';
import { buildSampleData } from '../lib/sampleData.js';

export default function SettingsView({ store }) {
  const fileRef = useRef(null);
  const [msg, setMsg] = useState(null);
  const [form, setForm] = useState({
    companyName: store.settings.companyName || '',
    workDaysPerMonth: store.settings.workDaysPerMonth ?? 26,
    commission: {
      type: store.settings.defaultCommission?.type || 'flat',
      rate: store.settings.defaultCommission?.rate ?? 3,
      tiers: store.settings.defaultCommission?.tiers || [],
    },
  });

  const flash = (tone, text) => { setMsg({ tone, text }); setTimeout(() => setMsg(null), 3500); };

  const saveSettings = () => {
    store.updateSettings({
      companyName: form.companyName.trim() || 'TikTok Live Aff',
      workDaysPerMonth: Number(form.workDaysPerMonth) || 26,
      defaultCommission: {
        type: form.commission.type,
        rate: Number(form.commission.rate) || 0,
        tiers: (form.commission.tiers || []).map((t) => ({ from: Number(t.from) || 0, rate: Number(t.rate) || 0 })),
      },
    });
    flash('success', 'บันทึกการตั้งค่าแล้ว');
  };

  const backup = () => {
    const snapshot = {
      _app: 'tiktok-live-aff', _version: 1,
      channels: store.channels, employees: store.employees, teams: store.teams,
      sales: store.sales, workLogs: store.workLogs, settings: store.settings,
    };
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tiktok-live-aff-backup.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const restore = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        store.importAll(data);
        flash('success', 'กู้คืนข้อมูลสำเร็จ');
      } catch {
        flash('error', 'ไฟล์ไม่ถูกต้อง — กู้คืนไม่สำเร็จ');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const loadSample = () => {
    if (store.channels.length && !confirm('การโหลดข้อมูลตัวอย่างจะแทนที่ข้อมูลปัจจุบันทั้งหมด ยืนยันหรือไม่?')) return;
    store.loadSample(buildSampleData());
    flash('success', 'โหลดข้อมูลตัวอย่างแล้ว');
  };

  const clearAll = () => {
    if (!confirm('ล้างข้อมูลทั้งหมด? การทำนี้ย้อนกลับไม่ได้ (แนะนำให้สำรองก่อน)')) return;
    store.clearAll();
    flash('success', 'ล้างข้อมูลทั้งหมดแล้ว');
  };

  const setComm = (patch) => setForm((f) => ({ ...f, commission: { ...f.commission, ...patch } }));
  const addTier = () => setComm({ tiers: [...(form.commission.tiers || []), { from: '', rate: '' }] });
  const setTier = (i, patch) => setComm({ tiers: form.commission.tiers.map((t, idx) => (idx === i ? { ...t, ...patch } : t)) });
  const removeTier = (i) => setComm({ tiers: form.commission.tiers.filter((_, idx) => idx !== i) });

  const counts = [
    ['ช่อง', store.channels.length], ['พนักงาน', store.employees.length], ['ทีม', store.teams.length],
    ['รายการขาย', store.sales.length], ['บันทึกงาน', store.workLogs.length],
  ];

  return (
    <div className="space-y-6 max-w-3xl">
      {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}

      <SectionCard title="ข้อมูลกิจการ" icon={Building2}>
        <div className="p-5 space-y-4">
          <Field label="ชื่อกิจการ (แสดงบนแถบเมนู)">
            <Input value={form.companyName} onChange={(e) => setForm((f) => ({ ...f, companyName: e.target.value }))} placeholder="TikTok Live Aff" />
          </Field>
          <Field label="จำนวนวันทำงานมาตรฐาน/เดือน" hint="ใช้อ้างอิงประกอบการคิดค่าจ้าง">
            <Input type="number" value={form.workDaysPerMonth} onChange={(e) => setForm((f) => ({ ...f, workDaysPerMonth: e.target.value }))} className="max-w-[10rem]" />
          </Field>
        </div>
      </SectionCard>

      <SectionCard title="คอมมิชชั่นเริ่มต้น (ใช้กับพนักงานที่ไม่ได้ตั้งค่าเอง)" icon={Percent}>
        <div className="p-5 space-y-4">
          <Field label="รูปแบบ" className="max-w-xs">
            <Select value={form.commission.type} onChange={(e) => setComm({ type: e.target.value })}>
              <option value="none">ไม่มีคอม</option>
              <option value="flat">อัตราเดียว (%)</option>
              <option value="tiered">ขั้นบันไดตามยอด (%)</option>
            </Select>
          </Field>
          {form.commission.type === 'flat' && (
            <Field label="อัตราคอม (%)" className="max-w-xs">
              <Input type="number" step="0.1" value={form.commission.rate} onChange={(e) => setComm({ rate: e.target.value })} />
            </Field>
          )}
          {form.commission.type === 'tiered' && (
            <div className="space-y-2">
              {(form.commission.tiers || []).map((t, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">ตั้งแต่ ฿</span>
                  <Input type="number" value={t.from} onChange={(e) => setTier(i, { from: e.target.value })} className="w-32" />
                  <span className="text-xs text-slate-400">จ่าย</span>
                  <Input type="number" step="0.1" value={t.rate} onChange={(e) => setTier(i, { rate: e.target.value })} className="w-20" />
                  <span className="text-xs text-slate-400">%</span>
                  <button onClick={() => removeTier(i)} className="p-1 text-slate-400 hover:text-red-500"><X size={15} /></button>
                </div>
              ))}
              <Button size="sm" variant="secondary" icon={Plus} onClick={addTier}>เพิ่มขั้น</Button>
            </div>
          )}
          <Button icon={Save} className="bg-pink-600 hover:bg-pink-700" onClick={saveSettings}>บันทึกการตั้งค่า</Button>
        </div>
      </SectionCard>

      <SectionCard title="จัดการข้อมูล">
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center">
            {counts.map(([label, n]) => (
              <div key={label} className="bg-slate-50 rounded-xl py-3">
                <div className="text-lg font-bold text-slate-800">{n}</div>
                <div className="text-[11px] text-slate-400">{label}</div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon={Download} onClick={backup}>สำรองข้อมูล (JSON)</Button>
            <Button variant="secondary" icon={Upload} onClick={() => fileRef.current?.click()}>กู้คืนจากไฟล์</Button>
            <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={restore} />
            <Button variant="secondary" icon={Sparkles} onClick={loadSample}>โหลดข้อมูลตัวอย่าง</Button>
            <Button variant="danger" icon={Trash2} onClick={clearAll}>ล้างข้อมูลทั้งหมด</Button>
          </div>
          <p className="text-[11px] text-slate-400">ข้อมูลทั้งหมดถูกเก็บไว้ในเบราว์เซอร์ของคุณ (localStorage) ไม่ถูกส่งขึ้นเซิร์ฟเวอร์ — แนะนำให้สำรองไฟล์ไว้เป็นระยะ</p>
        </div>
      </SectionCard>
    </div>
  );
}
