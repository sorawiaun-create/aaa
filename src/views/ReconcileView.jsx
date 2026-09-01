import React, { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { Upload, FileSpreadsheet, TrendingUp, Wallet, RotateCcw, ShoppingBag, AlertCircle, Save, Trash2, CheckCircle2 } from 'lucide-react';
import { SectionCard, KpiCard, Button, EmptyState, Banner, Field, Select, Input } from '../components/ui.jsx';
import { reconcileTikTok, isTikTokAffiliate, GROUP_LABEL } from '../lib/tiktokReconcile.js';
import { formatCurrency, formatCurrency0, formatBahtCompact, formatNumber, formatPercent, monthLabel } from '../lib/format.js';

const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export default function ReconcileView({ store }) {
  const fileRef = useRef(null);
  const [result, setResult] = useState(null);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [channelId, setChannelId] = useState('');
  const [month, setMonth] = useState(thisMonth());
  const [saved, setSaved] = useState(false);

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(''); setBusy(true); setResult(null); setSaved(false); setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      if (!isTikTokAffiliate(Object.keys(rows[0] || {}))) {
        setError('ไฟล์นี้ไม่ใช่รายงานออเดอร์ Affiliate ของ TikTok (ไม่พบคอลัมน์ “หมายเลขคำสั่งซื้อ” / “GMV”)');
        setBusy(false); return;
      }
      setResult(reconcileTikTok(rows));
    } catch (err) {
      setError('อ่านไฟล์ไม่สำเร็จ: ' + (err?.message || err));
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  };

  const saveToCloud = () => {
    if (!result || !channelId || !month) return;
    store.addImport({
      channelId, month, fileName,
      gmv: result.gmv, orderCount: result.orderCount, sold: result.sold, refund: result.refund,
      estTotal: result.estTotal, actTotal: result.actTotal, clawback: result.clawback,
      clawbackPct: result.clawbackPct, returnRatePct: result.returnRatePct, byGroup: result.byGroup,
    });
    setSaved(true);
    setResult(null); setFileName('');
  };

  const chName = (id) => store.channels.find((c) => c.id === id)?.name || 'ไม่ระบุช่อง';
  const imports = [...store.imports].sort((a, b) => (b.month || '').localeCompare(a.month || '') || (b.uploadedAt || '').localeCompare(a.uploadedAt || ''));

  return (
    <div className="space-y-6">
      <SectionCard title="อัปโหลดไฟล์ Affiliate จาก TikTok" icon={FileSpreadsheet}>
        <div className="p-5 space-y-4">
          {store.channels.length === 0 && <Banner tone="warn">ยังไม่มีช่อง — เพิ่มช่องที่เมนู “ช่อง TikTok” ก่อน เพื่อเลือกว่าไฟล์นี้เป็นของช่องไหน</Banner>}
          <div className="grid sm:grid-cols-3 gap-3">
            <Field label="ช่อง (ไฟล์นี้ของช่องไหน)">
              <Select value={channelId} onChange={(e) => setChannelId(e.target.value)}>
                <option value="">— เลือกช่อง —</option>
                {store.channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            <Field label="เดือนของข้อมูล">
              <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            </Field>
            <div className="flex items-end">
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onFile} />
              <Button icon={Upload} onClick={() => fileRef.current?.click()} disabled={busy} className="w-full bg-pink-600 hover:bg-pink-700">
                {busy ? 'กำลังอ่าน…' : 'เลือกไฟล์ออเดอร์'}
              </Button>
            </div>
          </div>
          {error && <Banner tone="error"><AlertCircle size={16} className="mt-0.5 shrink-0" /><span>{error}</span></Banner>}
          {saved && <Banner tone="success"><CheckCircle2 size={16} className="mt-0.5 shrink-0" /><span>บันทึกขึ้นคลาวด์แล้ว — ดูเปรียบเทียบช่องได้ที่เมนู “เปรียบเทียบช่อง” และกำไรที่ “กำไร-ขาดทุน”</span></Banner>}
          <p className="text-[11px] text-slate-400">ไฟล์ affiliate_orders_*.xlsx จาก TikTok Affiliate — อ่านในเครื่องคุณ ไม่ส่งขึ้นเซิร์ฟเวอร์ (บันทึกเฉพาะยอดสรุปขึ้นคลาวด์)</p>
        </div>
      </SectionCard>

      {result && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard title="GMV รวม" value={formatBahtCompact(result.gmv)} valueTitle={formatCurrency(result.gmv)} icon={TrendingUp} accent="pink" subtext={`${formatNumber(result.orderCount)} ออเดอร์`} />
            <KpiCard title="ค่าคอมจริง (รับจริง)" value={formatBahtCompact(result.actTotal)} valueTitle={formatCurrency(result.actTotal)} icon={Wallet} accent="emerald" subtext={`ได้จริง ${formatPercent(result.payoutPct, 1)}`} />
            <KpiCard title="% ตีกลับ (ค่าคอม)" value={formatPercent(result.clawbackPct, 1)} icon={RotateCcw} accent="red" subtext={`หายไป ${formatCurrency0(result.clawback)}`} />
            <KpiCard title="% คืนสินค้า" value={formatPercent(result.returnRatePct, 2)} icon={ShoppingBag} accent="orange" subtext={`คืน ${formatNumber(result.refund)} / ขาย ${formatNumber(result.sold)}`} />
          </div>

          <SectionCard title="ตรวจทานก่อนบันทึก"
            action={<Button icon={Save} onClick={saveToCloud} disabled={!channelId || !month} className="bg-emerald-600 hover:bg-emerald-700">บันทึกขึ้นคลาวด์</Button>}>
            <div className="p-5 text-sm text-slate-600 space-y-2">
              <div>ช่อง: <b className="text-slate-800">{channelId ? chName(channelId) : '— ยังไม่เลือกช่อง —'}</b> · เดือน: <b className="text-slate-800">{monthLabel(month)}</b> · ไฟล์: {fileName}</div>
              <div className="flex flex-wrap gap-x-6 gap-y-1">
                <span>ค่าคอมประมาณ <b className="tabular-nums">{formatCurrency0(result.estTotal)}</b></span>
                <span>→ รับจริง <b className="tabular-nums text-emerald-600">{formatCurrency0(result.actTotal)}</b></span>
                <span>ตีกลับ <b className="tabular-nums text-red-500">−{formatCurrency0(result.clawback)}</b> ({formatPercent(result.clawbackPct, 1)})</span>
              </div>
              {!channelId && <p className="text-amber-600 text-xs">* เลือกช่องก่อนจึงจะบันทึกได้</p>}
            </div>
          </SectionCard>

          <SectionCard title="แยกตามสถานะการชำระ">
            <StatusTable byGroup={result.byGroup} />
          </SectionCard>
        </>
      )}

      {/* Saved imports */}
      <SectionCard title={`ไฟล์ที่บันทึกไว้ (${imports.length})`}>
        {imports.length === 0 ? (
          <EmptyState icon={FileSpreadsheet} title="ยังไม่มีไฟล์ที่บันทึก" hint="อัปโหลดไฟล์ เลือกช่อง+เดือน แล้วกด “บันทึกขึ้นคลาวด์” เพื่อนำไปเปรียบเทียบและคิดกำไร" />
        ) : (
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                  <th className="px-5 py-3 font-medium">ช่อง</th>
                  <th className="px-4 py-3 font-medium">เดือน</th>
                  <th className="px-4 py-3 font-medium text-right">GMV</th>
                  <th className="px-4 py-3 font-medium text-right">รับจริง</th>
                  <th className="px-4 py-3 font-medium text-right">% ตีกลับ</th>
                  <th className="px-5 py-3 font-medium text-right">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {imports.map((im) => (
                  <tr key={im.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                    <td className="px-5 py-3 text-slate-800">{chName(im.channelId)}</td>
                    <td className="px-4 py-3 text-slate-600">{monthLabel(im.month)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-600">{formatCurrency0(im.gmv)}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold text-emerald-600">{formatCurrency0(im.actTotal)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-red-500">{formatPercent(im.clawbackPct, 1)}</td>
                    <td className="px-5 py-3 text-right">
                      <button onClick={() => { if (confirm('ลบไฟล์ที่บันทึกนี้?')) store.removeImport(im.id); }} className="p-1.5 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500"><Trash2 size={15} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

function StatusTable({ byGroup }) {
  return (
    <div className="overflow-x-auto custom-scrollbar">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
            <th className="px-5 py-3 font-medium">สถานะ</th>
            <th className="px-4 py-3 font-medium text-right">ออเดอร์</th>
            <th className="px-4 py-3 font-medium text-right">GMV</th>
            <th className="px-4 py-3 font-medium text-right">ค่าคอมประมาณ</th>
            <th className="px-5 py-3 font-medium text-right">รับจริง</th>
          </tr>
        </thead>
        <tbody>
          {byGroup.map((g) => (
            <tr key={g.key} className="border-b border-slate-50 hover:bg-slate-50/60">
              <td className="px-5 py-3">
                <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${g.key === 'paid' ? 'bg-emerald-100 text-emerald-700' : g.key === 'rejected' ? 'bg-red-100 text-red-600' : g.key === 'pending' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
                  {GROUP_LABEL[g.key] || g.key}
                </span>
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-slate-600">{formatNumber(g.count)}</td>
              <td className="px-4 py-3 text-right tabular-nums text-slate-600">{formatCurrency0(g.gmv)}</td>
              <td className="px-4 py-3 text-right tabular-nums text-slate-500">{formatCurrency0(g.est)}</td>
              <td className="px-5 py-3 text-right tabular-nums font-semibold text-emerald-600">{formatCurrency0(g.act)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
