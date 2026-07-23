import React, { useState } from 'react';
import {
  Database, Download, Upload, Trash2, Sparkles, CheckCircle, HardDrive,
} from 'lucide-react';
import { SectionCard, Button, Banner } from '../components/ui.jsx';
import { makeSampleData } from '../lib/sampleData.js';
import { formatNumber } from '../lib/format.js';

export default function DataView({ store }) {
  const [msg, setMsg] = useState('');

  const exportJson = () => {
    const snapshot = {
      version: 1,
      exportedAt: new Date().toISOString(),
      products: store.products,
      sales: store.sales,
      fees: store.fees,
      orderFees: store.orderFees,
      expenses: store.expenses,
      mappings: store.mappings,
    };
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `profit-desk-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJson = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const snap = JSON.parse(text);
      store.importAll(snap);
      setMsg('กู้คืนข้อมูลจากไฟล์สำรองเรียบร้อยแล้ว');
    } catch (err) {
      setMsg(`นำเข้าไม่สำเร็จ: ${err.message}`);
    } finally {
      e.target.value = '';
    }
  };

  const loadSample = () => {
    if (
      (store.sales.length || store.products.length) &&
      !window.confirm('การโหลดข้อมูลตัวอย่างจะเขียนทับข้อมูลปัจจุบัน ต้องการดำเนินการต่อ?')
    )
      return;
    const s = makeSampleData();
    store.importAll({ ...s, mappings: {} });
    setMsg('โหลดข้อมูลตัวอย่างเรียบร้อย — ไปที่แดชบอร์ดเพื่อดูผล');
  };

  return (
    <div className="space-y-6">
      {msg && (
        <Banner tone="success">
          <CheckCircle size={16} className="mt-0.5 shrink-0" /> {msg}
        </Banner>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatBox label="สินค้า" value={store.products.length} />
        <StatBox label="รายการขาย" value={store.sales.length} />
        <StatBox label="เอกสารค่าธรรมเนียม" value={store.fees.length} />
      </div>

      <SectionCard title="สำรอง & กู้คืนข้อมูล (JSON)" icon={HardDrive}>
        <div className="p-5 flex flex-wrap gap-3">
          <Button icon={Download} onClick={exportJson}>ส่งออกไฟล์สำรอง</Button>
          <label>
            <input type="file" accept="application/json" className="hidden" onChange={importJson} />
            <span className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 cursor-pointer font-medium">
              <Upload size={16} /> นำเข้าไฟล์สำรอง
            </span>
          </label>
        </div>
      </SectionCard>

      <SectionCard title="ข้อมูลตัวอย่าง" icon={Sparkles}>
        <div className="p-5 space-y-3">
          <p className="text-sm text-slate-500">
            ยังไม่มีไฟล์ของจริง? โหลดชุดข้อมูลตัวอย่าง (สินค้า + ยอดขาย Shopee/TikTok 3 เดือน + ค่าธรรมเนียม)
            เพื่อดูการทำงานของแดชบอร์ดและการกระทบยอดกำไรได้ทันที
          </p>
          <Button variant="success" icon={Sparkles} onClick={loadSample}>โหลดข้อมูลตัวอย่าง</Button>
        </div>
      </SectionCard>

      <SectionCard title="เขตอันตราย" icon={Trash2}>
        <div className="p-5">
          <p className="text-sm text-slate-500 mb-3">ลบข้อมูลทั้งหมดออกจากเบราว์เซอร์ (ไม่สามารถกู้คืนได้ นอกจากมีไฟล์สำรอง)</p>
          <Button
            variant="danger"
            icon={Trash2}
            onClick={() => {
              if (window.confirm('ลบข้อมูลทั้งหมด (สินค้า, ยอดขาย, ค่าธรรมเนียม)?')) {
                store.clearAll();
                setMsg('ล้างข้อมูลทั้งหมดเรียบร้อย');
              }
            }}
          >
            ล้างข้อมูลทั้งหมด
          </Button>
        </div>
      </SectionCard>
    </div>
  );
}

const StatBox = ({ label, value }) => (
  <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 flex items-center gap-3">
    <div className="p-3 rounded-xl bg-blue-50 text-blue-600">
      <Database size={18} />
    </div>
    <div>
      <div className="text-2xl font-bold text-slate-800">{formatNumber(value)}</div>
      <div className="text-xs text-slate-400">{label}</div>
    </div>
  </div>
);
