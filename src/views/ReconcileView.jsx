import React, { useState, useMemo } from 'react';
import {
  Scale, Search, Download, AlertTriangle, TrendingUp, TrendingDown, Package,
} from 'lucide-react';
import { SectionCard, EmptyState, Badge, Button, Banner, KpiCard } from '../components/ui.jsx';
import { formatCurrency, formatPercent, formatNumber, parseMoney } from '../lib/format.js';

export default function ReconcileView({ recon, store }) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState({ key: 'netProfit', dir: 'desc' });

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = q
      ? recon.bySku.filter(
          (r) =>
            String(r.sku).toLowerCase().includes(q) ||
            String(r.name || '').toLowerCase().includes(q)
        )
      : recon.bySku;
    list = [...list].sort((a, b) => {
      const dir = sort.dir === 'desc' ? -1 : 1;
      const av = a[sort.key];
      const bv = b[sort.key];
      if (typeof av === 'string') return av.localeCompare(bv) * dir;
      return (av - bv) * dir;
    });
    return list;
  }, [recon.bySku, query, sort]);

  const setSortKey = (key) =>
    setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }));

  const updateCost = (row, value) => {
    store.upsertProduct({
      sku: row.sku,
      name: row.name,
      unitCost: parseMoney(value),
    });
  };

  const exportCsv = async () => {
    const XLSX = await import('xlsx');
    const data = recon.bySku.map((r) => ({
      SKU: r.sku,
      ชื่อสินค้า: r.name,
      จำนวนขาย: r.qty,
      รายได้: r.revenue,
      ต้นทุนต่อหน่วย: r.unitCost,
      ต้นทุนรวม: r.cogs,
      กำไรขั้นต้น: r.grossProfit,
      'กำไรขั้นต้น%': Number(r.margin.toFixed(2)),
      ค่าธรรมเนียม: Number(r.fees.toFixed(2)),
      กำไรสุทธิ: Number((r.revenue - r.cogs - r.fees).toFixed(2)),
      'กำไรสุทธิ%': Number(r.netMargin.toFixed(2)),
      สถานะต้นทุน: r.hasCost ? 'มี' : 'ยังไม่ตั้ง',
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'reconcile');
    XLSX.writeFile(wb, 'profit-by-sku.csv');
  };

  const top = recon.bySku[0];
  const bottom = recon.bySku[recon.bySku.length - 1];

  const Arrow = ({ k }) => (sort.key === k ? <span className="text-slate-400">{sort.dir === 'desc' ? '▼' : '▲'}</span> : null);

  return (
    <div className="space-y-6">
      {recon.missingCostCount > 0 && (
        <Banner tone="warn">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            <b>{recon.missingCostCount} SKU</b> ยังไม่ได้ตั้งต้นทุน (แถวไฮไลต์สีเหลือง) — กรอกต้นทุนในตารางด้านล่างได้เลย
            ระบบจะคำนวณกำไรใหม่ทันที
          </span>
        </Banner>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="กำไรขั้นต้นรวม" value={formatCurrency(recon.grossProfit)} subtext={formatPercent(recon.grossMargin)} icon={TrendingUp} accent="blue" />
        <KpiCard title="กำไรสุทธิ (หลังค่าธรรมเนียม)" value={formatCurrency(recon.netProfit)} subtext={formatPercent(recon.netMargin)} icon={recon.netProfit >= 0 ? TrendingUp : TrendingDown} accent={recon.netProfit >= 0 ? 'green' : 'red'} />
        <KpiCard title="SKU ทำกำไรสูงสุด" value={top ? top.sku : '-'} subtext={top ? formatCurrency(top.grossProfit) : ''} icon={TrendingUp} accent="emerald" />
        <KpiCard title="SKU กำไรต่ำสุด" value={bottom ? bottom.sku : '-'} subtext={bottom ? formatCurrency(bottom.grossProfit) : ''} icon={TrendingDown} accent="red" />
      </div>

      <SectionCard
        title={`กำไรราย SKU (${formatNumber(recon.bySku.length)} รายการ)`}
        icon={Scale}
        action={
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ค้นหา SKU/ชื่อ" className="pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-200 focus:outline-none" />
            </div>
            <Button variant="secondary" size="sm" icon={Download} onClick={exportCsv} disabled={!recon.bySku.length}>ส่งออก CSV</Button>
          </div>
        }
      >
        {recon.bySku.length === 0 ? (
          <EmptyState icon={Package} title="ยังไม่มีข้อมูลสำหรับกระทบยอด" hint="นำเข้ายอดขายและตั้งต้นทุนก่อน" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <th className="px-4 py-3 cursor-pointer" onClick={() => setSortKey('sku')}>SKU <Arrow k="sku" /></th>
                  <th className="px-4 py-3">ชื่อสินค้า</th>
                  <th className="px-4 py-3 text-right cursor-pointer" onClick={() => setSortKey('qty')}>ขาย <Arrow k="qty" /></th>
                  <th className="px-4 py-3 text-right cursor-pointer" onClick={() => setSortKey('revenue')}>รายได้ <Arrow k="revenue" /></th>
                  <th className="px-4 py-3 text-right bg-amber-50">ต้นทุน/หน่วย</th>
                  <th className="px-4 py-3 text-right">ต้นทุนรวม</th>
                  <th className="px-4 py-3 text-right">ค่าธรรมเนียม</th>
                  <th className="px-4 py-3 text-right cursor-pointer" onClick={() => setSortKey('netProfit')}>กำไรสุทธิ <Arrow k="netProfit" /></th>
                  <th className="px-4 py-3 text-right cursor-pointer bg-emerald-50/60" onClick={() => setSortKey('netMargin')}>% กำไรสุทธิ <Arrow k="netMargin" /></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.sku} className={`hover:bg-slate-50 ${!r.hasCost ? 'bg-amber-50/50' : ''}`}>
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-700">
                      {r.sku} {!r.hasCost && <Badge color="amber">ไม่มีต้นทุน</Badge>}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600 truncate max-w-[200px]" title={r.name}>{r.name}</td>
                    <td className="px-4 py-2.5 text-right">{formatNumber(r.qty)}</td>
                    <td className="px-4 py-2.5 text-right text-slate-700">{formatCurrency(r.revenue)}</td>
                    <td className="px-2 py-2 text-right bg-amber-50/40">
                      <input
                        type="number"
                        value={r.unitCost || ''}
                        onChange={(e) => updateCost(r, e.target.value)}
                        placeholder="0.00"
                        className={`w-24 text-right px-2 py-1 rounded-lg border focus:ring-2 focus:ring-amber-300 focus:outline-none ${r.hasCost ? 'border-slate-200 bg-white' : 'border-amber-300 bg-white'}`}
                      />
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-500">{formatCurrency(r.cogs)}</td>
                    <td className="px-4 py-2.5 text-right text-red-500">{r.fees > 0 ? formatCurrency(r.fees) : '—'}</td>
                    <td className={`px-4 py-2.5 text-right font-bold ${r.fees > 0 ? (r.netProfit >= 0 ? 'text-emerald-600' : 'text-red-500') : 'text-slate-300'}`}>{r.fees > 0 ? formatCurrency(r.netProfit) : '—'}</td>
                    <td className={`px-4 py-2.5 text-right font-bold bg-emerald-50/40 ${r.fees > 0 ? (r.netMargin >= 0 ? 'text-emerald-600' : 'text-red-500') : 'text-slate-300'}`}>{r.fees > 0 ? formatPercent(r.netMargin) : '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-100 font-bold border-t-2 border-slate-200">
                <tr>
                  <td className="px-4 py-3" colSpan={3}>รวม</td>
                  <td className="px-4 py-3 text-right">{formatCurrency(recon.revenue)}</td>
                  <td className="px-4 py-3"></td>
                  <td className="px-4 py-3 text-right">{formatCurrency(recon.cogs)}</td>
                  <td className="px-4 py-3 text-right text-red-600">{formatCurrency(recon.fees.total)}</td>
                  <td className={`px-4 py-3 text-right ${recon.netProfit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{formatCurrency(recon.netProfit)}</td>
                  <td className={`px-4 py-3 text-right bg-emerald-50/40 ${recon.netMargin >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{formatPercent(recon.netMargin)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
