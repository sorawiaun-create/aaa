import React, { useState, useMemo } from 'react';
import {
  ListChecks, Search, Download, Link2, AlertTriangle, TrendingUp, TrendingDown,
  Percent, Wallet, Clock,
} from 'lucide-react';
import { SectionCard, EmptyState, Badge, Button, Banner, KpiCard, PlatformBadge } from '../components/ui.jsx';
import { formatCurrency, formatPercent, formatNumber } from '../lib/format.js';

export default function OrderProfitView({ orderRecon, store }) {
  const { rows, totals } = orderRecon;
  const [query, setQuery] = useState('');
  const [onlyMatched, setOnlyMatched] = useState(false);

  const filtered = useMemo(() => {
    let list = rows;
    if (onlyMatched) list = list.filter((r) => r.matched);
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((r) => String(r.orderId).toLowerCase().includes(q));
    return list;
  }, [rows, query, onlyMatched]);

  const exportCsv = async () => {
    const XLSX = await import('xlsx');
    const data = rows.map((r) => ({
      แพลตฟอร์ม: r.platform,
      หมายเลขคำสั่งซื้อ: r.orderId,
      วันที่: r.date,
      จำนวนรายการ: r.lines,
      ยอดขาย: r.revenue,
      ต้นทุนสินค้า: r.cogs,
      ค่าธรรมเนียม: r.fee,
      กำไรสุทธิ: r.netProfit,
      'Margin%': Number(r.margin.toFixed(2)),
      สถานะ: r.matched ? 'จับคู่แล้ว' : 'รอ settlement',
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'order-profit');
    XLSX.writeFile(wb, 'true-profit-by-order.csv');
  };

  const hasOrderFees = store.orderFees.length > 0;

  return (
    <div className="space-y-6">
      <Banner tone="info">
        <Link2 size={16} className="mt-0.5 shrink-0" />
        <span>
          กำไรจริงคำนวณโดย <b>เชื่อมไฟล์ออเดอร์กับไฟล์ค่าธรรมเนียมด้วยหมายเลขคำสั่งซื้อ (Order ID)</b> —
          ไฟล์ค่าธรรมเนียมไม่มี SKU แต่มี Order ID จึงจับคู่กับยอดขาย/ต้นทุนของแต่ละออเดอร์ได้:
          <b> กำไรสุทธิ = ยอดขาย − ต้นทุนสินค้า − ค่าธรรมเนียมของออเดอร์นั้น</b>
        </span>
      </Banner>

      {!hasOrderFees && (
        <Banner tone="warn">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            ยังไม่มีค่าธรรมเนียมรายออเดอร์ — ไปที่ <b>นำเข้าค่าธรรมเนียม</b> แล้วอัปโหลดไฟล์ settlement
            ที่มีรายละเอียดรายออเดอร์ (Shopee: sheet “Income” · TikTok: sheet “รายละเอียดคำสั่งซื้อ”)
          </span>
        </Banner>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <KpiCard title="กำไรสุทธิจริง (จับคู่แล้ว)" value={formatCurrency(totals.netProfit)} subtext={`${formatNumber(totals.matchedCount)} ออเดอร์`} icon={totals.netProfit >= 0 ? TrendingUp : TrendingDown} accent={totals.netProfit >= 0 ? 'green' : 'red'} />
        <KpiCard title="ยอดขาย (จับคู่แล้ว)" value={formatCurrency(totals.matchedRevenue)} subtext="เฉพาะออเดอร์ที่มีค่าธรรมเนียม" icon={Wallet} accent="emerald" />
        <KpiCard title="ค่าธรรมเนียมจริง" value={formatCurrency(totals.fees)} subtext={totals.matchedRevenue ? formatPercent((totals.fees / totals.matchedRevenue) * 100) + ' ของยอดขาย' : ''} icon={Download} accent="pink" />
        <KpiCard title="อัตรากำไรสุทธิ" value={formatPercent(totals.netMargin)} subtext="Net Margin" icon={Percent} accent="blue" />
        <KpiCard title="จับคู่ Order ID" value={formatPercent(totals.matchRate)} subtext={`${formatNumber(totals.matchedCount)}/${formatNumber(totals.orderCount)} · รอ ${formatNumber(totals.pendingCount)}`} icon={Link2} accent="purple" />
      </div>

      <SectionCard
        title={`กำไรจริงรายออเดอร์ (${formatNumber(rows.length)})`}
        icon={ListChecks}
        action={
          <div className="flex items-center gap-2">
            <button onClick={() => setOnlyMatched((v) => !v)}>
              <Badge color={onlyMatched ? 'blue' : 'slate'}>เฉพาะที่จับคู่แล้ว</Badge>
            </button>
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ค้นหา Order ID" className="pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-200 focus:outline-none" />
            </div>
            <Button variant="secondary" size="sm" icon={Download} onClick={exportCsv} disabled={!rows.length}>ส่งออก</Button>
          </div>
        }
      >
        {rows.length === 0 ? (
          <EmptyState icon={ListChecks} title="ยังไม่มีข้อมูลออเดอร์" hint="นำเข้ายอดขายและค่าธรรมเนียมรายออเดอร์ก่อน" />
        ) : (
          <div className="overflow-x-auto max-h-[600px] overflow-y-auto custom-scrollbar">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase sticky top-0">
                <tr>
                  <th className="px-4 py-3">แพลตฟอร์ม</th>
                  <th className="px-4 py-3">Order ID</th>
                  <th className="px-4 py-3">วันที่</th>
                  <th className="px-4 py-3 text-right">รายการ</th>
                  <th className="px-4 py-3 text-right">ยอดขาย</th>
                  <th className="px-4 py-3 text-right">ต้นทุน</th>
                  <th className="px-4 py-3 text-right">ค่าธรรมเนียม</th>
                  <th className="px-4 py-3 text-right">กำไรสุทธิ</th>
                  <th className="px-4 py-3 text-right">Margin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.slice(0, 500).map((r) => (
                  <tr key={r.key} className={`hover:bg-slate-50 ${!r.matched ? 'bg-amber-50/40' : ''}`}>
                    <td className="px-4 py-2"><PlatformBadge platform={r.platform} /></td>
                    <td className="px-4 py-2 font-mono text-xs text-slate-600">{r.orderId}</td>
                    <td className="px-4 py-2 text-slate-500 whitespace-nowrap">{r.date || '-'}</td>
                    <td className="px-4 py-2 text-right text-slate-500">{r.lines}</td>
                    <td className="px-4 py-2 text-right text-slate-700">{formatCurrency(r.revenue)}</td>
                    <td className="px-4 py-2 text-right text-slate-500">{formatCurrency(r.cogs)}</td>
                    <td className="px-4 py-2 text-right">
                      {r.matched ? (
                        <span className="text-red-500">{formatCurrency(r.fee)}</span>
                      ) : (
                        <span className="text-amber-500 flex items-center gap-1 justify-end text-xs"><Clock size={12} /> รอ</span>
                      )}
                    </td>
                    <td className={`px-4 py-2 text-right font-bold ${!r.matched ? 'text-slate-400' : r.netProfit >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      {r.matched ? formatCurrency(r.netProfit) : '—'}
                    </td>
                    <td className={`px-4 py-2 text-right ${r.matched ? 'text-slate-600' : 'text-slate-300'}`}>
                      {r.matched ? formatPercent(r.margin) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-100 font-bold border-t-2 border-slate-200 sticky bottom-0">
                <tr>
                  <td className="px-4 py-3" colSpan={4}>รวม (เฉพาะจับคู่แล้ว {formatNumber(totals.matchedCount)})</td>
                  <td className="px-4 py-3 text-right">{formatCurrency(totals.matchedRevenue)}</td>
                  <td className="px-4 py-3 text-right">{formatCurrency(totals.matchedCogs)}</td>
                  <td className="px-4 py-3 text-right text-red-600">{formatCurrency(totals.fees)}</td>
                  <td className={`px-4 py-3 text-right ${totals.netProfit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{formatCurrency(totals.netProfit)}</td>
                  <td className="px-4 py-3 text-right">{formatPercent(totals.netMargin)}</td>
                </tr>
              </tfoot>
            </table>
            {filtered.length > 500 && (
              <p className="text-center text-xs text-slate-400 py-3">แสดง 500 แถวแรกจาก {formatNumber(filtered.length)} — ใช้ค้นหาหรือส่งออก CSV เพื่อดูทั้งหมด</p>
            )}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
