import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';
import {
  Wallet, Coins, TrendingUp, TrendingDown, Percent, Megaphone,
  Receipt, AlertTriangle, ShoppingBag, Video, Package, Award, Info,
} from 'lucide-react';
import { KpiCard, SectionCard, EmptyState, Banner, Badge } from '../components/ui.jsx';
import { formatCurrency, formatBahtCompact, formatPercent, formatNumber, compactCurrency, monthLabel } from '../lib/format.js';

const PIE_COLORS = ['#FF5722', '#FE2C55', '#2196F3', '#00C853', '#FFC107', '#9C27B0', '#00BCD4', '#795548'];

// Month-over-month growth pill (green up / red down / grey n/a).
const Growth = ({ value }) => {
  if (value == null || !Number.isFinite(value)) return <span className="text-slate-300">—</span>;
  const up = value >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${up ? 'text-emerald-600' : 'text-red-500'}`}>
      {up ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
      {up ? '+' : ''}{value.toFixed(1)}%
    </span>
  );
};

export default function DashboardView({ recon, store }) {
  const hasData = store.sales.length > 0 || store.fees.length > 0;
  const profitPositive = recon.netProfit >= 0;

  const topProducts = [...recon.bySku].sort((a, b) => b.revenue - a.revenue).slice(0, 10);

  // Monthly summary with month-over-month growth on revenue and net profit.
  const monthlySummary = recon.byMonth.map((m, i) => {
    const prev = recon.byMonth[i - 1];
    const revGrowth = prev && prev.revenue ? ((m.revenue - prev.revenue) / prev.revenue) * 100 : null;
    const profitGrowth = prev && prev.profit ? ((m.profit - prev.profit) / Math.abs(prev.profit)) * 100 : null;
    return {
      ...m,
      margin: m.revenue ? (m.profit / m.revenue) * 100 : 0,
      revGrowth,
      profitGrowth,
    };
  });

  const identifiedFees =
    recon.fees.ads + recon.fees.affiliate + recon.fees.commission + recon.fees.logistics +
    recon.fees.transaction + recon.fees.service + recon.fees.growth + recon.fees.ams + recon.fees.infra;
  const feeBreakdown = [
    { name: 'โฆษณา (Ads)', value: recon.fees.ads },
    { name: 'Affiliate', value: recon.fees.affiliate },
    { name: 'คอมมิชชั่น', value: recon.fees.commission },
    { name: 'ขนส่ง', value: recon.fees.logistics },
    { name: 'ธุรกรรม', value: recon.fees.transaction },
    { name: 'บริการ', value: recon.fees.service },
    { name: 'Growth', value: recon.fees.growth },
    { name: 'โครงสร้างพื้นฐาน/AMS', value: recon.fees.ams + recon.fees.infra },
    { name: 'อื่นๆ / ปรับยอด', value: Math.max(0, recon.fees.total - identifiedFees) },
  ].filter((x) => x.value > 0);

  const pl = [
    { label: 'รายได้ (ยอดขาย)', value: recon.revenue, strong: true, tone: 'text-slate-800' },
    { label: 'หัก: ต้นทุนสินค้า (COGS)', value: -recon.cogs, tone: 'text-slate-600' },
    { label: 'กำไรขั้นต้น (Gross Profit)', value: recon.grossProfit, strong: true, tone: 'text-blue-700', sub: formatPercent(recon.grossMargin) },
    { label: 'หัก: ค่าธรรมเนียม + โฆษณา (รวม VAT)', value: -recon.fees.total, tone: 'text-slate-600' },
    { label: 'กำไรสุทธิ (Net Profit)', value: recon.netProfit, strong: true, tone: profitPositive ? 'text-emerald-700' : 'text-red-600', sub: formatPercent(recon.netMargin), divider: true },
    ...(recon.opexTotal > 0
      ? [
          { label: 'หัก: รายจ่ายทั่วไป (Operating Exp.)', value: -recon.opexTotal, tone: 'text-slate-600' },
          {
            label: 'กำไร/ขาดทุนสุทธิบริษัท',
            value: recon.companyNetProfit,
            strong: true,
            tone: recon.companyNetProfit >= 0 ? 'text-emerald-700' : 'text-red-600',
            sub: formatPercent(recon.revenue ? (recon.companyNetProfit / recon.revenue) * 100 : 0),
            divider: true,
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-6">
      {!hasData && (
        <Banner tone="info">
          <Package size={16} className="mt-0.5 shrink-0" />
          <span>
            ยังไม่มีข้อมูล — เริ่มด้วยการ <b>นำเข้ายอดขาย</b> และตั้ง <b>ต้นทุนสินค้า</b> หรือกดโหลด
            “ข้อมูลตัวอย่าง” ในหน้า <b>จัดการข้อมูล</b> เพื่อดูตัวอย่างการทำงาน
          </span>
        </Banner>
      )}

      {recon.missingCostCount > 0 && (
        <Banner tone="warn">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            มี <b>{recon.missingCostCount} SKU</b> ที่ยังไม่ได้กำหนดต้นทุน — กำไรอาจสูงเกินจริง
            ไปที่หน้า <b>สินค้า &amp; ต้นทุน</b> เพื่อเติมต้นทุนให้ครบ
          </span>
        </Banner>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard title="รายได้รวม" value={formatBahtCompact(recon.revenue)} valueTitle={formatCurrency(recon.revenue)} subtext={`${formatNumber(recon.orderCount)} ออเดอร์`} icon={Wallet} accent="emerald" />
        <KpiCard title="ต้นทุนสินค้า" value={formatBahtCompact(recon.cogs)} valueTitle={formatCurrency(recon.cogs)} subtext={`${formatNumber(recon.unitsSold)} ชิ้น`} icon={Package} accent="orange" />
        <KpiCard title="กำไรขั้นต้น" value={formatBahtCompact(recon.grossProfit)} valueTitle={formatCurrency(recon.grossProfit)} subtext={formatPercent(recon.grossMargin)} icon={TrendingUp} accent="blue" />
        <KpiCard title="ค่าธรรมเนียม" value={formatBahtCompact(recon.fees.total)} valueTitle={formatCurrency(recon.fees.total)} subtext={`Ads ${formatBahtCompact(recon.fees.ads)}`} icon={Receipt} accent="pink" />
        <KpiCard title="กำไรสุทธิ" value={formatBahtCompact(recon.netProfit)} valueTitle={formatCurrency(recon.netProfit)} subtext={profitPositive ? 'กำไร' : 'ขาดทุน'} icon={profitPositive ? TrendingUp : TrendingDown} accent={profitPositive ? 'green' : 'red'} />
        <KpiCard title="อัตรากำไรสุทธิ" value={formatPercent(recon.netMargin)} subtext="Net Margin" icon={Percent} accent="purple" />
      </div>

      {/* Company bottom line after general expenses */}
      {recon.opexTotal > 0 && (
        <div className={`rounded-2xl p-4 border flex flex-wrap items-center justify-between gap-x-4 gap-y-1 ${recon.companyNetProfit >= 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
          <span className="text-sm text-slate-600">
            กำไรสุทธิ <b>{formatCurrency(recon.netProfit)}</b> − รายจ่ายทั่วไป <b className="text-orange-600">{formatCurrency(recon.opexTotal)}</b> =
          </span>
          <span className={`text-lg font-bold flex items-center gap-2 ${recon.companyNetProfit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
            {recon.companyNetProfit >= 0 ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
            กำไร/ขาดทุนบริษัท {formatCurrency(recon.companyNetProfit)}
          </span>
        </div>
      )}

      {/* Settlement-based P&L (authoritative platform figures) */}
      {recon.settlement.hasData && (() => {
        // Coverage = how much of the settlement revenue the imported order file
        // accounts for. COGS only covers those orders, so low coverage means the
        // reported profit is overstated.
        const coverageOf = (p) => {
          const sr = recon.settlement.byPlatform[p].revenue;
          return sr > 0 ? (recon.byPlatform[p].revenue / sr) * 100 : null;
        };
        const lowCoverage = ['shopee', 'tiktok'].filter((p) => {
          const d = recon.settlement.byPlatform[p];
          const c = coverageOf(p);
          return (d.revenue || d.fees) && c != null && c < 90;
        });
        const covColor = (c) => (c == null ? 'text-slate-400' : c >= 95 ? 'text-emerald-600' : c >= 70 ? 'text-amber-600' : 'text-red-500');
        return (
        <SectionCard title="กระทบยอดจากไฟล์ Settlement (ยอดจริงจากแพลตฟอร์ม)" icon={Wallet}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <th className="px-5 py-3">แพลตฟอร์ม</th>
                  <th className="px-5 py-3 text-right">รายได้ (ยอดขาย)</th>
                  <th className="px-5 py-3 text-right">ค่าธรรมเนียมรวม</th>
                  <th className="px-5 py-3 text-right">เงินโอนจริง</th>
                  <th className="px-5 py-3 text-right">ต้นทุนสินค้า (COGS)</th>
                  <th className="px-5 py-3 text-right">ครอบคลุม COGS</th>
                  <th className="px-5 py-3 text-right">กำไรสุทธิ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {['shopee', 'tiktok'].map((p) => {
                  const d = recon.settlement.byPlatform[p];
                  if (!d.revenue && !d.fees) return null;
                  const cogsP = recon.byPlatform[p].cogs;
                  const net = d.payout - cogsP;
                  const cov = coverageOf(p);
                  return (
                    <tr key={p} className="hover:bg-slate-50">
                      <td className="px-5 py-3">{p === 'shopee' ? <Badge color="shopee">Shopee</Badge> : <Badge color="tiktok">TikTok</Badge>}</td>
                      <td className="px-5 py-3 text-right">{formatCurrency(d.revenue)}</td>
                      <td className="px-5 py-3 text-right text-red-500">{formatCurrency(d.fees)}</td>
                      <td className="px-5 py-3 text-right text-slate-600">{formatCurrency(d.payout)}</td>
                      <td className="px-5 py-3 text-right text-slate-500">{formatCurrency(cogsP)}</td>
                      <td className={`px-5 py-3 text-right font-medium ${covColor(cov)}`}>{cov == null ? '-' : formatPercent(cov)}</td>
                      <td className={`px-5 py-3 text-right font-bold ${net >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{formatCurrency(net)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-slate-100 font-bold border-t-2 border-slate-200">
                <tr>
                  <td className="px-5 py-3">รวม</td>
                  <td className="px-5 py-3 text-right">{formatCurrency(recon.settlement.revenue)}</td>
                  <td className="px-5 py-3 text-right text-red-600">{formatCurrency(recon.settlement.fees)}</td>
                  <td className="px-5 py-3 text-right">{formatCurrency(recon.settlement.payout)}</td>
                  <td className="px-5 py-3 text-right">{formatCurrency(recon.settlement.cogs)}</td>
                  <td className="px-5 py-3 text-right text-slate-500">{recon.settlement.revenue > 0 ? formatPercent((recon.revenue / recon.settlement.revenue) * 100) : '-'}</td>
                  <td className={`px-5 py-3 text-right ${recon.settlement.netProfit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{formatCurrency(recon.settlement.netProfit)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="px-5 pb-4 space-y-2">
            {lowCoverage.length > 0 && (
              <Banner tone="warn">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                <span>
                  ไฟล์ออเดอร์ครอบคลุมยอดขายไม่ครบ ({lowCoverage.map((p) => `${p === 'shopee' ? 'Shopee' : 'TikTok'} ${formatPercent(coverageOf(p))}`).join(', ')}) —
                  ต้นทุนสินค้าจึงคิดไม่ครบ ทำให้ <b>กำไรสุทธิที่แสดงสูงเกินจริง</b> แนะนำให้ export ไฟล์ออเดอร์ให้ครบทั้งเดือนเดียวกับ settlement
                  {recon.missingCostCount > 0 && ` และตั้งต้นทุนให้ครบอีก ${recon.missingCostCount} SKU`}
                </span>
              </Banner>
            )}
            <Banner tone="info">
              <Info size={15} className="mt-0.5 shrink-0" />
              <span>
                รายได้/ค่าธรรมเนียม/เงินโอน = ยอดจริงทั้งเดือนจากไฟล์ settlement · <b>กำไรสุทธิ = เงินโอนจริง − ต้นทุนสินค้า</b>.
                ต้นทุนสินค้าคำนวณจาก <b>ไฟล์ออเดอร์</b> (จำนวนที่ขายราย SKU × ต้นทุนต่อ SKU ที่คุณตั้งเอง) — ไฟล์ settlement ไม่มีต้นทุนสินค้า.
                คอลัมน์ “ครอบคลุม COGS” คือสัดส่วนยอดขายในไฟล์ออเดอร์เทียบกับ settlement (ควรใกล้ 100% จึงจะแม่น)
              </span>
            </Banner>
          </div>
        </SectionCard>
        );
      })()}

      {/* Trend + P&L */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <SectionCard title="รายได้ vs ต้นทุน vs กำไร (รายเดือน)" icon={TrendingUp} className="lg:col-span-2">
          <div className="p-5">
            {recon.byMonth.length > 0 ? (
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={recon.byMonth} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="monthKey" tickFormatter={monthLabel} tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={compactCurrency} tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                    <Tooltip formatter={(v) => formatCurrency(v)} labelFormatter={monthLabel} contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }} />
                    <Legend wrapperStyle={{ paddingTop: 16 }} />
                    <Bar dataKey="revenue" name="รายได้" fill="#00C853" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="cost" name="ต้นทุนรวม" fill="#FF5722" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="profit" name="กำไรสุทธิ" fill="#2196F3" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyState icon={TrendingUp} title="ยังไม่มีข้อมูลกราฟ" hint="นำเข้ายอดขายเพื่อดูแนวโน้ม" />
            )}
          </div>
        </SectionCard>

        {/* P&L statement */}
        <SectionCard title="งบกำไรขาดทุน (P&L)" icon={Coins}>
          <div className="p-5 space-y-1">
            {pl.map((row, i) => (
              <div
                key={i}
                className={`flex items-center justify-between py-2 ${row.divider ? 'border-t-2 border-slate-200 mt-1 pt-3' : 'border-b border-slate-50'}`}
              >
                <span className={`text-sm ${row.strong ? 'font-bold' : ''} ${row.tone}`}>{row.label}</span>
                <div className="text-right">
                  <div className={`text-sm ${row.strong ? 'font-bold' : ''} ${row.tone}`}>
                    {formatCurrency(row.value)}
                  </div>
                  {row.sub && <div className="text-[11px] text-slate-400">{row.sub}</div>}
                </div>
              </div>
            ))}
            {recon.fees.wht > 0 && (
              <div className="flex items-center justify-between pt-3 text-xs text-slate-400">
                <span>ภาษีหัก ณ ที่จ่าย (WHT) — เครดิตภาษี</span>
                <span>{formatCurrency(recon.fees.wht)}</span>
              </div>
            )}
          </div>
        </SectionCard>
      </div>

      {/* Platform split + fee pie */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <SectionCard title="สรุปตามแพลตฟอร์ม" icon={ShoppingBag} className="lg:col-span-2">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <th className="px-5 py-3">แพลตฟอร์ม</th>
                  <th className="px-5 py-3 text-right">รายได้</th>
                  <th className="px-5 py-3 text-right">ต้นทุนสินค้า</th>
                  <th className="px-5 py-3 text-right">ค่าธรรมเนียม</th>
                  <th className="px-5 py-3 text-right">กำไรสุทธิ</th>
                  <th className="px-5 py-3 text-right">Margin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {['shopee', 'tiktok'].map((p) => {
                  const d = recon.byPlatform[p];
                  return (
                    <tr key={p} className="hover:bg-slate-50">
                      <td className="px-5 py-3">
                        <span className="flex items-center gap-2">
                          {p === 'shopee' ? <ShoppingBag size={15} className="text-orange-500" /> : <Video size={15} />}
                          {p === 'shopee' ? 'Shopee' : 'TikTok'}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right">{formatCurrency(d.revenue)}</td>
                      <td className="px-5 py-3 text-right text-slate-500">{formatCurrency(d.cogs)}</td>
                      <td className="px-5 py-3 text-right text-slate-500">{formatCurrency(d.fees)}</td>
                      <td className={`px-5 py-3 text-right font-bold ${d.netProfit >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                        {formatCurrency(d.netProfit)}
                      </td>
                      <td className="px-5 py-3 text-right text-slate-600">{formatPercent(d.margin)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SectionCard>

        <SectionCard title="โครงสร้างค่าใช้จ่าย" icon={Megaphone}>
          <div className="p-5">
            {feeBreakdown.length > 0 ? (
              <>
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={feeBreakdown} cx="50%" cy="50%" innerRadius={50} outerRadius={75} paddingAngle={4} dataKey="value">
                        {feeBreakdown.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} strokeWidth={0} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v) => formatCurrency(v)} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-4 space-y-1.5">
                  {feeBreakdown.sort((a, b) => b.value - a.value).map((item, i) => (
                    <div key={item.name} className="flex justify-between items-center text-sm">
                      <span className="flex items-center gap-2 text-slate-600">
                        <span className="w-3 h-3 rounded-full" style={{ backgroundColor: PIE_COLORS[feeBreakdown.indexOf(item) % PIE_COLORS.length] }} />
                        {item.name}
                      </span>
                      <span className="font-medium text-slate-700">{formatCurrency(item.value)}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <EmptyState icon={Receipt} title="ยังไม่มีค่าธรรมเนียม" hint="นำเข้าใบเสร็จ PDF ในหน้านำเข้าค่าธรรมเนียม" />
            )}
          </div>
        </SectionCard>
      </div>

      {/* Monthly summary + MoM growth */}
      {monthlySummary.length > 0 && (
        <SectionCard title="สรุปรายเดือน & การเติบโต (MoM)" icon={TrendingUp}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <th className="px-5 py-3">เดือน</th>
                  <th className="px-5 py-3 text-right">รายได้</th>
                  <th className="px-5 py-3 text-right">โต MoM</th>
                  <th className="px-5 py-3 text-right">ต้นทุนรวม</th>
                  <th className="px-5 py-3 text-right">กำไรจากการขาย</th>
                  <th className="px-5 py-3 text-right">โต MoM</th>
                  <th className="px-5 py-3 text-right">Margin</th>
                  {recon.opexTotal > 0 && <th className="px-5 py-3 text-right">รายจ่ายทั่วไป</th>}
                  {recon.opexTotal > 0 && <th className="px-5 py-3 text-right">กำไร/ขาดทุนบริษัท</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {monthlySummary.map((m) => (
                  <tr key={m.monthKey} className="hover:bg-slate-50">
                    <td className="px-5 py-2.5 font-medium text-slate-700">{monthLabel(m.monthKey)}</td>
                    <td className="px-5 py-2.5 text-right text-slate-700">{formatCurrency(m.revenue)}</td>
                    <td className="px-5 py-2.5 text-right"><Growth value={m.revGrowth} /></td>
                    <td className="px-5 py-2.5 text-right text-slate-500">{formatCurrency(m.cost)}</td>
                    <td className={`px-5 py-2.5 text-right font-bold ${m.profit >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{formatCurrency(m.profit)}</td>
                    <td className="px-5 py-2.5 text-right"><Growth value={m.profitGrowth} /></td>
                    <td className="px-5 py-2.5 text-right text-slate-600">{formatPercent(m.margin)}</td>
                    {recon.opexTotal > 0 && <td className="px-5 py-2.5 text-right text-orange-600">{m.opex ? formatCurrency(m.opex) : '-'}</td>}
                    {recon.opexTotal > 0 && (
                      <td className={`px-5 py-2.5 text-right font-bold ${m.companyProfit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{formatCurrency(m.companyProfit)}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {/* Top products by sales */}
      <SectionCard title="สินค้าขายดี Top 10 (ตามยอดขาย)" icon={Award}>
        {topProducts.length === 0 ? (
          <EmptyState icon={Package} title="ยังไม่มีข้อมูลสินค้า" hint="นำเข้ายอดขายเพื่อดูสินค้าขายดี" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <th className="px-5 py-3 w-10">#</th>
                  <th className="px-5 py-3">สินค้า (SKU)</th>
                  <th className="px-5 py-3 text-right">ขาย (ชิ้น)</th>
                  <th className="px-5 py-3 text-right">ยอดขาย</th>
                  <th className="px-5 py-3 text-right">กำไรขั้นต้น</th>
                  <th className="px-5 py-3 text-right">กำไรสุทธิ</th>
                  <th className="px-5 py-3 text-right">% กำไรสุทธิ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {topProducts.map((p, i) => (
                  <tr key={p.sku} className="hover:bg-slate-50">
                    <td className="px-5 py-2.5">
                      <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${i < 3 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>{i + 1}</span>
                    </td>
                    <td className="px-5 py-2.5">
                      <div className="font-medium text-slate-700 truncate max-w-[260px]" title={p.name}>{p.name}</div>
                      <div className="font-mono text-[11px] text-slate-400">{p.sku}</div>
                    </td>
                    <td className="px-5 py-2.5 text-right font-medium">{formatNumber(p.qty)}</td>
                    <td className="px-5 py-2.5 text-right text-slate-700">{formatCurrency(p.revenue)}</td>
                    <td className="px-5 py-2.5 text-right text-blue-600">{formatCurrency(p.grossProfit)}</td>
                    <td className={`px-5 py-2.5 text-right font-semibold ${p.fees > 0 ? (p.netProfit >= 0 ? 'text-emerald-600' : 'text-red-500') : 'text-slate-300'}`}>
                      {p.fees > 0 ? formatCurrency(p.netProfit) : '—'}
                    </td>
                    <td className={`px-5 py-2.5 text-right font-semibold ${p.fees > 0 ? (p.netMargin >= 0 ? 'text-emerald-600' : 'text-red-500') : 'text-slate-400'}`}>
                      {p.fees > 0 ? formatPercent(p.netMargin) : formatPercent(p.margin)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-slate-400 px-5 py-3">
              กำไรสุทธิแสดงเมื่อมีค่าธรรมเนียมของสินค้านั้น (Shopee: ในไฟล์ · TikTok: เชื่อม Order ID) — ดูรายตัวเต็มที่หน้า “กำไรราย SKU”
            </p>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
