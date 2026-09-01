import React, { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { Upload, FileSpreadsheet, TrendingUp, Wallet, RotateCcw, ShoppingBag, AlertCircle } from 'lucide-react';
import { SectionCard, KpiCard, Button, EmptyState, Banner } from '../components/ui.jsx';
import { reconcileTikTok, isTikTokAffiliate, GROUP_LABEL } from '../lib/tiktokReconcile.js';
import { formatCurrency, formatCurrency0, formatBahtCompact, formatNumber, formatPercent } from '../lib/format.js';

export default function ReconcileView() {
  const fileRef = useRef(null);
  const [result, setResult] = useState(null);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(''); setBusy(true); setResult(null); setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      const headers = Object.keys(rows[0] || {});
      if (!isTikTokAffiliate(headers)) {
        setError('ไฟล์นี้ไม่ใช่รายงานออเดอร์ Affiliate ของ TikTok (ไม่พบคอลัมน์ “หมายเลขคำสั่งซื้อ” / “GMV”) — กรุณาใช้ไฟล์ affiliate_orders_*.xlsx จาก TikTok');
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

  return (
    <div className="space-y-6">
      <SectionCard title="กระทบยอด TikTok Affiliate" icon={FileSpreadsheet}
        action={
          <>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onFile} />
            <Button icon={Upload} onClick={() => fileRef.current?.click()} disabled={busy} className="bg-pink-600 hover:bg-pink-700">
              {busy ? 'กำลังอ่าน…' : 'อัปโหลดไฟล์ออเดอร์'}
            </Button>
          </>
        }
      >
        <div className="p-5">
          {error && <Banner tone="error"><AlertCircle size={16} className="mt-0.5 shrink-0" /><span>{error}</span></Banner>}
          {!result && !error && (
            <EmptyState icon={FileSpreadsheet} title="อัปโหลดไฟล์รายงาน Affiliate จาก TikTok"
              hint="ไฟล์ affiliate_orders_*.xlsx (ดาวน์โหลดจาก TikTok Affiliate → รายงานคำสั่งซื้อ) — ระบบจะคำนวณ GMV, % ตีกลับ และค่าคอมจริงให้อัตโนมัติ ข้อมูลอ่านในเครื่องคุณ ไม่ส่งขึ้นเซิร์ฟเวอร์" />
          )}
          {result && <p className="text-xs text-slate-400">ไฟล์: {fileName} · {formatNumber(result.orderCount)} ออเดอร์ ({formatNumber(result.rowCount)} รายการ SKU)</p>}
        </div>
      </SectionCard>

      {result && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard title="GMV รวม" value={formatBahtCompact(result.gmv)} valueTitle={formatCurrency(result.gmv)} icon={TrendingUp} accent="pink" subtext={`${formatNumber(result.orderCount)} ออเดอร์`} />
            <KpiCard title="ค่าคอมจริง (รับจริง)" value={formatBahtCompact(result.actTotal)} valueTitle={formatCurrency(result.actTotal)} icon={Wallet} accent="emerald" subtext={`ได้จริง ${formatPercent(result.payoutPct, 1)}`} />
            <KpiCard title="% ตีกลับ (ค่าคอม)" value={formatPercent(result.clawbackPct, 1)} icon={RotateCcw} accent="red" subtext={`หายไป ${formatCurrency0(result.clawback)}`} />
            <KpiCard title="% คืนสินค้า" value={formatPercent(result.returnRatePct, 2)} icon={ShoppingBag} accent="orange" subtext={`คืน ${formatNumber(result.refund)} / ขาย ${formatNumber(result.sold)} ชิ้น`} />
          </div>

          {/* Estimated vs actual */}
          <SectionCard title="ค่าคอมโดยประมาณ → รับจริง (ตีกลับ)">
            <div className="p-5 space-y-4">
              <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
                <div>
                  <div className="text-xs text-slate-400">ค่าคอมโดยประมาณ</div>
                  <div className="text-xl font-bold text-slate-700 tabular-nums">{formatCurrency0(result.estTotal)}</div>
                </div>
                <div className="text-2xl text-slate-300">→</div>
                <div>
                  <div className="text-xs text-slate-400">รับจริง</div>
                  <div className="text-xl font-bold text-emerald-600 tabular-nums">{formatCurrency0(result.actTotal)}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-400">ตีกลับ (หายไป)</div>
                  <div className="text-xl font-bold text-red-500 tabular-nums">−{formatCurrency0(result.clawback)}</div>
                </div>
              </div>
              <div>
                <div className="h-3 rounded-full bg-red-100 overflow-hidden flex">
                  <div className="h-full bg-emerald-500" style={{ width: `${Math.min(100, result.payoutPct)}%` }} />
                </div>
                <div className="flex justify-between text-[11px] mt-1">
                  <span className="text-emerald-600 font-medium">รับจริง {formatPercent(result.payoutPct, 1)}</span>
                  <span className="text-red-500 font-medium">ตีกลับ {formatPercent(result.clawbackPct, 1)}</span>
                </div>
              </div>
            </div>
          </SectionCard>

          {/* By status group */}
          <SectionCard title="แยกตามสถานะการชำระ">
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
                  {result.byGroup.map((g) => (
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
          </SectionCard>

          {/* Top products by commission */}
          <SectionCard title="สินค้าที่ทำค่าคอมสูงสุด (Top 20)">
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                    <th className="px-5 py-3 font-medium">สินค้า</th>
                    <th className="px-4 py-3 font-medium text-right">ออเดอร์</th>
                    <th className="px-4 py-3 font-medium text-right">GMV</th>
                    <th className="px-4 py-3 font-medium text-right">ค่าคอมประมาณ</th>
                    <th className="px-5 py-3 font-medium text-right">รับจริง</th>
                  </tr>
                </thead>
                <tbody>
                  {result.byProduct.map((p, i) => (
                    <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/60">
                      <td className="px-5 py-3 max-w-[24rem] truncate text-slate-700" title={p.product}>{p.product}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-600">{formatNumber(p.count)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-600">{formatCurrency0(p.gmv)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-500">{formatCurrency0(p.est)}</td>
                      <td className="px-5 py-3 text-right tabular-nums font-semibold text-emerald-600">{formatCurrency0(p.act)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </>
      )}
    </div>
  );
}
