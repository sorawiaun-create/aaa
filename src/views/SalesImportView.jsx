import React, { useState } from 'react';
import { Upload, ShoppingBag, Video, CheckCircle, ArrowRight, Trash2, FileSpreadsheet, History } from 'lucide-react';
import { SectionCard, Button, Banner, EmptyState, Badge, PlatformBadge } from '../components/ui.jsx';
import { readSpreadsheet, autoDetectMapping, applyMapping, SALES_FIELDS } from '../lib/salesParser.js';
import { formatCurrency, formatNumber } from '../lib/format.js';

export default function SalesImportView({ store }) {
  const [platform, setPlatform] = useState('shopee');
  const [parsed, setParsed] = useState(null); // { headers, rows, fileName }
  const [mapping, setMapping] = useState({});
  const [error, setError] = useState('');
  const [result, setResult] = useState('');

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setResult('');
    try {
      const XLSX = await import('xlsx');
      const { headers, rows } = await readSpreadsheet(file, XLSX);
      if (!rows.length) {
        setError('ไฟล์ว่างเปล่า หรืออ่านไม่ได้');
        return;
      }
      const auto = autoDetectMapping(headers);
      // Load any saved mapping for this platform on top of auto-detection.
      const saved = store.mappings[platform] || {};
      setParsed({ headers, rows, fileName: file.name });
      setMapping({ ...auto, ...filterValid(saved, headers) });
    } catch (err) {
      setError(`อ่านไฟล์ไม่สำเร็จ: ${err.message}`);
    } finally {
      e.target.value = '';
    }
  };

  const preview = parsed
    ? applyMapping(parsed.rows.slice(0, 5), mapping, platform, parsed.fileName)
    : [];

  const commit = () => {
    if (!parsed) return;
    if (!mapping.sku || !mapping.qty) {
      setError('กรุณาแมปคอลัมน์ SKU และ จำนวน (Qty) อย่างน้อย');
      return;
    }
    const records = applyMapping(parsed.rows, mapping, platform, parsed.fileName);
    const { added } = store.addSalesBatch({ fileName: parsed.fileName, platform }, records);
    store.setMappings({ ...store.mappings, [platform]: mapping });
    setResult(`นำเข้า ${formatNumber(added)} รายการ (จากทั้งหมด ${formatNumber(records.length)} · ข้ามซ้ำ ${formatNumber(records.length - added)})`);
    setParsed(null);
    setMapping({});
  };

  return (
    <div className="space-y-6">
      <SectionCard title="นำเข้ายอดขาย (CSV / Excel)" icon={FileSpreadsheet}>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-sm text-slate-500 block mb-2">แพลตฟอร์มของไฟล์นี้</label>
            <div className="flex gap-2">
              <button onClick={() => setPlatform('shopee')} className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 border ${platform === 'shopee' ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-slate-600 border-slate-200'}`}>
                <ShoppingBag size={15} /> Shopee
              </button>
              <button onClick={() => setPlatform('tiktok')} className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 border ${platform === 'tiktok' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200'}`}>
                <Video size={15} /> TikTok
              </button>
            </div>
          </div>

          <label className="block border-2 border-dashed border-slate-200 rounded-2xl p-8 text-center cursor-pointer hover:border-blue-300 hover:bg-blue-50/40 transition-colors">
            <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={onFile} />
            <Upload size={32} className="mx-auto text-slate-300 mb-2" />
            <p className="text-sm font-medium text-slate-600">คลิกเพื่อเลือกไฟล์ยอดขาย</p>
            <p className="text-xs text-slate-400 mt-1">รองรับ .csv, .xlsx, .xls — ระบบจะจับคอลัมน์ให้อัตโนมัติ</p>
          </label>

          {error && <Banner tone="error">{error}</Banner>}
          {result && (
            <Banner tone="success">
              <CheckCircle size={16} className="mt-0.5 shrink-0" /> {result}
            </Banner>
          )}
        </div>
      </SectionCard>

      {parsed && (
        <SectionCard
          title="ตรวจสอบการจับคู่คอลัมน์"
          icon={ArrowRight}
          action={
            <div className="flex items-center gap-2">
              <PlatformBadge platform={platform} />
              <span className="text-xs text-slate-400">{parsed.fileName} · {formatNumber(parsed.rows.length)} แถว</span>
            </div>
          }
        >
          <div className="p-5 space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {SALES_FIELDS.map((f) => (
                <div key={f.key}>
                  <label className="text-xs font-medium text-slate-600 flex items-center gap-1 mb-1">
                    {f.label} {f.required && <span className="text-red-500">*</span>}
                    {mapping[f.key] && <CheckCircle size={12} className="text-emerald-500" />}
                  </label>
                  <select
                    value={mapping[f.key] || ''}
                    onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value || undefined })}
                    className={`w-full border rounded-lg px-2.5 py-1.5 text-sm bg-white focus:ring-2 focus:ring-blue-200 focus:outline-none ${f.required && !mapping[f.key] ? 'border-red-200' : 'border-slate-200'}`}
                  >
                    <option value="">— ไม่ใช้ —</option>
                    {parsed.headers.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            <div>
              <p className="text-xs font-medium text-slate-500 mb-2">ตัวอย่างข้อมูล (5 แถวแรก)</p>
              <div className="overflow-x-auto border border-slate-100 rounded-xl">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-3 py-2">SKU</th>
                      <th className="px-3 py-2">สินค้า</th>
                      <th className="px-3 py-2 text-right">จำนวน</th>
                      <th className="px-3 py-2 text-right">ราคา/หน่วย</th>
                      <th className="px-3 py-2 text-right">ยอดขาย</th>
                      <th className="px-3 py-2">วันที่</th>
                      <th className="px-3 py-2">สถานะ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {preview.map((r, i) => (
                      <tr key={i}>
                        <td className="px-3 py-2 font-mono">{r.sku || <span className="text-red-400">—</span>}</td>
                        <td className="px-3 py-2 text-slate-600 truncate max-w-[160px]">{r.productName || '-'}</td>
                        <td className="px-3 py-2 text-right">{r.qty}</td>
                        <td className="px-3 py-2 text-right">{formatCurrency(r.unitPrice)}</td>
                        <td className="px-3 py-2 text-right font-medium">{formatCurrency(r.revenue)}</td>
                        <td className="px-3 py-2">{r.date || '-'}</td>
                        <td className="px-3 py-2">{r.status || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="secondary" icon={Trash2} onClick={() => { setParsed(null); setMapping({}); }}>ยกเลิก</Button>
              <Button variant="success" icon={CheckCircle} onClick={commit}>ยืนยันนำเข้า {formatNumber(parsed.rows.length)} แถว</Button>
            </div>
          </div>
        </SectionCard>
      )}

      <ImportBatches store={store} />
      <SalesSummary store={store} />
    </div>
  );
}

function ImportBatches({ store }) {
  const batches = store.salesBatches || [];
  if (batches.length === 0) return null;
  const fmtDate = (iso) => {
    try {
      return new Date(iso).toLocaleString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };
  return (
    <SectionCard title={`ชุดที่นำเข้า (${batches.length})`} icon={History}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="px-5 py-2.5">ไฟล์</th>
              <th className="px-5 py-2.5">แพลตฟอร์ม</th>
              <th className="px-5 py-2.5">เวลานำเข้า</th>
              <th className="px-5 py-2.5 text-right">จำนวนรายการ</th>
              <th className="px-5 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {batches.map((b) => (
              <tr key={b.id} className="hover:bg-slate-50">
                <td className="px-5 py-2.5 text-slate-700 truncate max-w-[240px]" title={b.fileName}>{b.fileName}</td>
                <td className="px-5 py-2.5"><PlatformBadge platform={b.platform} /></td>
                <td className="px-5 py-2.5 text-slate-500 text-xs whitespace-nowrap">{fmtDate(b.date)}</td>
                <td className="px-5 py-2.5 text-right font-medium">{formatNumber(b.count)}</td>
                <td className="px-5 py-2.5 text-right">
                  <button
                    onClick={() => window.confirm(`ลบชุดนำเข้า "${b.fileName}" (${formatNumber(b.count)} รายการ)?`) && store.removeSalesBatch(b.id)}
                    className="inline-flex items-center gap-1 text-xs text-red-500 hover:bg-red-50 px-2.5 py-1.5 rounded-lg"
                  >
                    <Trash2 size={14} /> ลบชุดนี้
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-400 px-5 py-3">ลบเฉพาะชุดที่อัปโหลดผิดได้ โดยไม่กระทบข้อมูลชุดอื่น (ชุดที่นำเข้าก่อนอัปเดตนี้จะไม่แสดงที่นี่ — ใช้ปุ่มลบตามแพลตฟอร์มด้านล่างแทน)</p>
    </SectionCard>
  );
}

function SalesSummary({ store }) {
  const byPlatform = { shopee: 0, tiktok: 0 };
  store.sales.forEach((s) => { byPlatform[s.platform] = (byPlatform[s.platform] || 0) + 1; });

  return (
    <SectionCard
      title={`ยอดขายในระบบ (${formatNumber(store.sales.length)} รายการ)`}
      icon={ShoppingBag}
      action={
        store.sales.length > 0 && (
          <Button
            variant="danger"
            size="sm"
            icon={Trash2}
            onClick={() => window.confirm('ล้างข้อมูลยอดขายทั้งหมด?') && store.setSales([])}
          >
            ล้างยอดขาย
          </Button>
        )
      }
    >
      {store.sales.length === 0 ? (
        <EmptyState icon={ShoppingBag} title="ยังไม่มีข้อมูลยอดขาย" hint="อัปโหลดไฟล์ด้านบนเพื่อเริ่มต้น" />
      ) : (
        <div className="p-5 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2 text-sm">
            <Badge color="shopee">Shopee</Badge>
            <span className="font-bold">{formatNumber(byPlatform.shopee || 0)}</span> รายการ
            {byPlatform.shopee > 0 && (
              <button
                onClick={() => window.confirm('ลบเฉพาะยอดขาย Shopee?') && store.setSales(store.sales.filter((s) => s.platform !== 'shopee'))}
                className="text-xs text-red-500 hover:bg-red-50 px-2 py-1 rounded-lg"
              >
                ลบ Shopee
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Badge color="tiktok">TikTok</Badge>
            <span className="font-bold">{formatNumber(byPlatform.tiktok || 0)}</span> รายการ
            {byPlatform.tiktok > 0 && (
              <button
                onClick={() => window.confirm('ลบเฉพาะยอดขาย TikTok?') && store.setSales(store.sales.filter((s) => s.platform !== 'tiktok'))}
                className="text-xs text-red-500 hover:bg-red-50 px-2 py-1 rounded-lg"
              >
                ลบ TikTok
              </button>
            )}
          </div>
        </div>
      )}
    </SectionCard>
  );
}

function filterValid(mapping, headers) {
  const out = {};
  Object.entries(mapping || {}).forEach(([k, v]) => {
    if (v && headers.includes(v)) out[k] = v;
  });
  return out;
}
