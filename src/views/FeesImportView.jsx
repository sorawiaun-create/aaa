import React, { useState, useRef } from 'react';
import {
  Upload, Receipt, CheckCircle, XCircle, Info, StopCircle, Trash2, FileText,
  FileSpreadsheet, Wallet,
} from 'lucide-react';
import { SectionCard, Button, Banner, EmptyState, Badge } from '../components/ui.jsx';
import { parsePdfFee } from '../lib/pdfParser.js';
import { parseSettlementWorkbook } from '../lib/settlementParser.js';
import { formatCurrency, formatNumber, monthLabel } from '../lib/format.js';

export default function FeesImportView({ store }) {
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [statusList, setStatusList] = useState([]);
  const [result, setResult] = useState('');
  const abortRef = useRef(false);

  const onFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    if (!window.pdfjsLib) {
      setResult('ตัวอ่าน PDF ยังโหลดไม่เสร็จ กรุณารอสักครู่แล้วลองใหม่');
      return;
    }
    abortRef.current = false;
    setProcessing(true);
    setResult('');
    setStatusList([]);
    setProgress({ done: 0, total: files.length });

    const collected = [];
    const status = [];
    const BATCH = 8;
    for (let i = 0; i < files.length; i += BATCH) {
      if (abortRef.current) break;
      const batch = files.slice(i, i + BATCH);
      const results = await Promise.all(batch.map((f) => parsePdfFee(window.pdfjsLib, f)));
      results.forEach((res) => {
        status.push(res);
        if (res.status === 'success' && res.data) collected.push(res.data);
      });
      setStatusList([...status]);
      setProgress({ done: Math.min(i + BATCH, files.length), total: files.length });
      await new Promise((r) => setTimeout(r, 30));
    }

    const added = store.addFees(collected);
    setResult(`อ่านสำเร็จ ${formatNumber(collected.length)} เอกสาร · เพิ่มใหม่ ${formatNumber(added)} · ข้ามซ้ำ ${formatNumber(collected.length - added)}`);
    setProcessing(false);
    e.target.value = '';
  };

  const stats = {
    success: statusList.filter((s) => s.status === 'success').length,
    unknown: statusList.filter((s) => s.status === 'unknown').length,
    error: statusList.filter((s) => s.status === 'error').length,
  };

  const [settleMsg, setSettleMsg] = useState('');
  const [settleErr, setSettleErr] = useState('');

  const onSettlement = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setSettleMsg('');
    setSettleErr('');
    try {
      const XLSX = await import('xlsx');
      const records = [];
      const notes = [];
      for (const file of files) {
        const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
        const res = parseSettlementWorkbook(XLSX, wb, file.name);
        if (res.status === 'success' && res.data) {
          records.push(res.data);
          const d = res.data;
          notes.push(
            `${res.platform} · ${monthLabel(d.monthKey)}: รายได้ ${formatCurrency(d.revenue)} · ค่าธรรมเนียม ${formatCurrency(d.total)} · เงินโอน ${formatCurrency(d.payout)}`
          );
        } else {
          notes.push(`${file.name}: ไม่รู้จักรูปแบบไฟล์ settlement`);
        }
      }
      if (records.length) store.upsertFees(records);
      setSettleMsg(notes.join('\n'));
      if (!records.length) setSettleErr('ไม่พบไฟล์ settlement ที่อ่านได้ (รองรับรายงานรายรับ Shopee และ รายงาน TikTok)');
    } catch (err) {
      setSettleErr(`อ่านไฟล์ไม่สำเร็จ: ${err.message}`);
    } finally {
      e.target.value = '';
    }
  };

  const settlementDocs = store.fees.filter((f) => f.source === 'settlement');

  return (
    <div className="space-y-6">
      <SectionCard title="นำเข้าไฟล์ Settlement / รายรับ (Excel)" icon={FileSpreadsheet}>
        <div className="p-5 space-y-4">
          <p className="text-sm text-slate-500">
            อัปโหลด <b>รายงานรายรับ (Shopee)</b> หรือ <b>รายงาน settlement (TikTok)</b> เป็นไฟล์ Excel —
            ระบบจะดึง <b>ค่าธรรมเนียมจริงทั้งเดือน</b> (คอมมิชชั่น, ค่าบริการ, ธุรกรรม, โฆษณา, ขนส่ง ฯลฯ),
            รายได้ และยอดเงินโอนจริง มาใช้หักหากำไรสุทธิให้อัตโนมัติ
          </p>
          <label className="block border-2 border-dashed border-emerald-200 rounded-2xl p-8 text-center cursor-pointer hover:border-emerald-300 hover:bg-emerald-50/40 transition-colors">
            <input type="file" accept=".xlsx,.xls" multiple className="hidden" onChange={onSettlement} />
            <Wallet size={32} className="mx-auto text-emerald-300 mb-2" />
            <p className="text-sm font-medium text-slate-600">คลิกเพื่อเลือกไฟล์ Settlement (.xlsx)</p>
            <p className="text-xs text-slate-400 mt-1">เลือกได้หลายไฟล์/หลายเดือน — อัปซ้ำเดือนเดิมจะเขียนทับ</p>
          </label>
          {settleErr && <Banner tone="error">{settleErr}</Banner>}
          {settleMsg && (
            <Banner tone="success">
              <CheckCircle size={16} className="mt-0.5 shrink-0" />
              <span className="whitespace-pre-line">{settleMsg}</span>
            </Banner>
          )}
        </div>
      </SectionCard>

      {settlementDocs.length > 0 && (
        <SectionCard title={`Settlement ในระบบ (${settlementDocs.length})`} icon={Wallet}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <th className="px-5 py-2.5">แพลตฟอร์ม</th>
                  <th className="px-5 py-2.5">เดือน</th>
                  <th className="px-5 py-2.5 text-right">รายได้</th>
                  <th className="px-5 py-2.5 text-right">ค่าธรรมเนียมรวม</th>
                  <th className="px-5 py-2.5 text-right">เงินโอนจริง</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {settlementDocs.map((f) => (
                  <tr key={f.id} className="hover:bg-slate-50">
                    <td className="px-5 py-2"><Badge color={f.platform === 'shopee' ? 'shopee' : 'tiktok'}>{f.platform === 'shopee' ? 'Shopee' : 'TikTok'}</Badge></td>
                    <td className="px-5 py-2 text-slate-600">{monthLabel(f.monthKey)}</td>
                    <td className="px-5 py-2 text-right text-slate-700">{formatCurrency(f.revenue)}</td>
                    <td className="px-5 py-2 text-right text-red-500">{formatCurrency(f.total)}</td>
                    <td className="px-5 py-2 text-right font-medium text-emerald-600">{formatCurrency(f.payout)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      <SectionCard title="นำเข้าค่าธรรมเนียม (ใบเสร็จ PDF)" icon={Receipt}>
        <div className="p-5 space-y-4">
          <p className="text-sm text-slate-500">
            รองรับใบเสร็จค่าธรรมเนียม/โฆษณา จาก Shopee, TikTok Shop, TikTok Ads, Affiliate และ
            Thai Happy Logistics — ระบบจะดึงยอดค่าธรรมเนียม, VAT และภาษีหัก ณ ที่จ่ายให้อัตโนมัติ
          </p>

          {!processing ? (
            <label className="block border-2 border-dashed border-slate-200 rounded-2xl p-8 text-center cursor-pointer hover:border-blue-300 hover:bg-blue-50/40 transition-colors">
              <input type="file" accept="application/pdf" multiple className="hidden" onChange={onFiles} />
              <Upload size={32} className="mx-auto text-slate-300 mb-2" />
              <p className="text-sm font-medium text-slate-600">คลิกเพื่อเลือกไฟล์ PDF (เลือกหลายไฟล์ได้)</p>
            </label>
          ) : (
            <div className="space-y-3">
              <div className="flex justify-between text-xs text-slate-600 font-medium">
                <span>กำลังประมวลผล... {Math.round((progress.done / progress.total) * 100)}%</span>
                <span>{progress.done}/{progress.total}</span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                <div className="bg-blue-600 h-full rounded-full transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
              </div>
              <Button variant="danger" icon={StopCircle} onClick={() => { abortRef.current = true; setProcessing(false); }}>
                หยุด
              </Button>
            </div>
          )}

          {result && (
            <Banner tone="success">
              <CheckCircle size={16} className="mt-0.5 shrink-0" /> {result}
            </Banner>
          )}
        </div>
      </SectionCard>

      {statusList.length > 0 && (
        <SectionCard
          title="รายงานสถานะไฟล์"
          icon={FileText}
          action={
            <div className="flex gap-2 text-xs">
              <Badge color="green">{stats.success} สำเร็จ</Badge>
              <Badge color="slate">{stats.unknown} ไม่รู้จัก</Badge>
              <Badge color="red">{stats.error} ผิดพลาด</Badge>
            </div>
          }
        >
          <div className="max-h-80 overflow-y-auto custom-scrollbar">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase sticky top-0">
                <tr>
                  <th className="px-5 py-2.5">ไฟล์</th>
                  <th className="px-5 py-2.5">สถานะ</th>
                  <th className="px-5 py-2.5">ประเภท</th>
                  <th className="px-5 py-2.5 text-right">ยอดรวม</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {statusList.map((s, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="px-5 py-2 text-slate-700 truncate max-w-[220px]" title={s.file}>{s.file}</td>
                    <td className="px-5 py-2">
                      {s.status === 'success' && <span className="text-emerald-600 flex items-center gap-1 text-xs"><CheckCircle size={13} /> ผ่าน</span>}
                      {s.status === 'unknown' && <span className="text-slate-400 flex items-center gap-1 text-xs"><Info size={13} /> ไม่รู้จัก</span>}
                      {s.status === 'error' && <span className="text-red-500 flex items-center gap-1 text-xs"><XCircle size={13} /> ผิดพลาด</span>}
                    </td>
                    <td className="px-5 py-2 text-xs text-slate-500">{s.platform || '-'}</td>
                    <td className="px-5 py-2 text-right text-slate-600">{s.data ? formatCurrency(s.data.total) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      <SectionCard
        title={`ค่าธรรมเนียมในระบบ (${formatNumber(store.fees.length)} เอกสาร)`}
        icon={Receipt}
        action={
          store.fees.length > 0 && (
            <Button variant="danger" size="sm" icon={Trash2} onClick={() => window.confirm('ล้างข้อมูลค่าธรรมเนียมทั้งหมด?') && store.setFees([])}>
              ล้างค่าธรรมเนียม
            </Button>
          )
        }
      >
        {store.fees.length === 0 ? (
          <EmptyState icon={Receipt} title="ยังไม่มีเอกสารค่าธรรมเนียม" hint="อัปโหลดใบเสร็จ PDF ด้านบน" />
        ) : (
          <div className="overflow-x-auto max-h-96 overflow-y-auto custom-scrollbar">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase sticky top-0">
                <tr>
                  <th className="px-5 py-2.5">แพลตฟอร์ม</th>
                  <th className="px-5 py-2.5">วันที่</th>
                  <th className="px-5 py-2.5">เลขที่เอกสาร</th>
                  <th className="px-5 py-2.5 text-right">โฆษณา</th>
                  <th className="px-5 py-2.5 text-right">รวม (VAT)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {store.fees.map((f, i) => (
                  <tr key={f.id || i} className="hover:bg-slate-50">
                    <td className="px-5 py-2"><Badge color={f.platform === 'shopee' ? 'shopee' : 'tiktok'}>{f.platform === 'shopee' ? 'Shopee' : 'TikTok'}</Badge></td>
                    <td className="px-5 py-2 text-slate-600">{f.date || '-'}</td>
                    <td className="px-5 py-2 font-mono text-xs text-slate-500 truncate max-w-[180px]">{f.id}</td>
                    <td className="px-5 py-2 text-right text-slate-500">{formatCurrency(f.ads)}</td>
                    <td className="px-5 py-2 text-right font-medium text-slate-800">{formatCurrency(f.total)}</td>
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
