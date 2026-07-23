import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';
import {
  Wallet, Coins, TrendingUp, TrendingDown, Percent, Megaphone,
  Receipt, AlertTriangle, ShoppingBag, Video, Package,
} from 'lucide-react';
import { KpiCard, SectionCard, EmptyState, Banner, Badge } from '../components/ui.jsx';
import { formatCurrency, formatPercent, formatNumber, compactCurrency, monthLabel } from '../lib/format.js';

const PIE_COLORS = ['#FF5722', '#FE2C55', '#2196F3', '#00C853', '#FFC107', '#9C27B0', '#00BCD4', '#795548'];

export default function DashboardView({ recon, store }) {
  const hasData = store.sales.length > 0 || store.fees.length > 0;
  const profitPositive = recon.netProfit >= 0;

  const feeBreakdown = [
    { name: 'โฆษณา (Ads)', value: recon.fees.ads },
    { name: 'Affiliate', value: recon.fees.affiliate },
    { name: 'คอมมิชชั่น', value: recon.fees.commission },
    { name: 'ขนส่ง', value: recon.fees.logistics },
    { name: 'ธุรกรรม', value: recon.fees.transaction },
    { name: 'บริการ', value: recon.fees.service },
    { name: 'Growth', value: recon.fees.growth },
    { name: 'อื่นๆ', value: recon.fees.ams + recon.fees.infra },
  ].filter((x) => x.value > 0);

  const pl = [
    { label: 'รายได้ (ยอดขาย)', value: recon.revenue, strong: true, tone: 'text-slate-800' },
    { label: 'หัก: ต้นทุนสินค้า (COGS)', value: -recon.cogs, tone: 'text-slate-600' },
    { label: 'กำไรขั้นต้น (Gross Profit)', value: recon.grossProfit, strong: true, tone: 'text-blue-700', sub: formatPercent(recon.grossMargin) },
    { label: 'หัก: ค่าธรรมเนียม + โฆษณา (รวม VAT)', value: -recon.fees.total, tone: 'text-slate-600' },
    { label: 'กำไรสุทธิ (Net Profit)', value: recon.netProfit, strong: true, tone: profitPositive ? 'text-emerald-700' : 'text-red-600', sub: formatPercent(recon.netMargin), divider: true },
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <KpiCard title="รายได้รวม" value={formatCurrency(recon.revenue)} subtext={`${formatNumber(recon.orderCount)} ออเดอร์`} icon={Wallet} accent="emerald" />
        <KpiCard title="ต้นทุนสินค้า (COGS)" value={formatCurrency(recon.cogs)} subtext={`${formatNumber(recon.unitsSold)} ชิ้น`} icon={Package} accent="orange" />
        <KpiCard title="กำไรขั้นต้น" value={formatCurrency(recon.grossProfit)} subtext={formatPercent(recon.grossMargin)} icon={TrendingUp} accent="blue" />
        <KpiCard title="ค่าธรรมเนียม+โฆษณา" value={formatCurrency(recon.fees.total)} subtext={`Ads ${formatCurrency(recon.fees.ads)}`} icon={Receipt} accent="pink" />
        <KpiCard title="กำไรสุทธิ" value={formatCurrency(recon.netProfit)} subtext={profitPositive ? 'กำไร' : 'ขาดทุน'} icon={profitPositive ? TrendingUp : TrendingDown} accent={profitPositive ? 'green' : 'red'} />
        <KpiCard title="อัตรากำไรสุทธิ" value={formatPercent(recon.netMargin)} subtext="Net Margin" icon={Percent} accent="purple" />
      </div>

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
    </div>
  );
}
