import React, { useState, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
  LineChart, Line, Legend, PieChart, Pie,
} from 'recharts';
import { BarChart3, Package, Search, Download, Coins, Boxes, GitCompareArrows, Tags } from 'lucide-react';
import { SectionCard, EmptyState, Button, PlatformBadge, Badge, cn } from '../components/ui.jsx';
import { formatCurrency, formatNumber, formatPercent, compactCurrency, monthLabel } from '../lib/format.js';

const BAR_COLORS = ['#2563eb', '#0ea5e9', '#14b8a6', '#22c55e', '#84cc16', '#eab308', '#f97316', '#ef4444', '#ec4899', '#8b5cf6'];
const LINE_COLORS = ['#2563eb', '#f97316', '#14b8a6', '#ec4899', '#8b5cf6'];

export default function ProductAnalyticsView({ analytics }) {
  const { months, products } = analytics;
  const [metric, setMetric] = useState('revenue'); // 'revenue' | 'qty'
  const [query, setQuery] = useState('');
  const [selectedSku, setSelectedSku] = useState(products[0]?.sku || '');
  const [compareSkus, setCompareSkus] = useState(() => products.slice(0, 3).map((p) => p.sku));

  const metricLabel = metric === 'revenue' ? 'ยอดขาย' : 'จำนวน (ชิ้น)';
  const fmt = (v) => (metric === 'revenue' ? formatCurrency(v) : formatNumber(v));

  const topBar = useMemo(
    () => products.slice(0, 10).map((p) => ({ sku: p.sku, name: p.name, value: p[metric] })),
    [products, metric]
  );

  const selected = useMemo(() => products.find((p) => p.sku === selectedSku) || products[0], [products, selectedSku]);
  const trend = useMemo(
    () => months.map((mk) => ({ month: mk, value: selected?.months[mk]?.[metric] || 0 })),
    [selected, months, metric]
  );

  // Multi-product comparison: one row per month, one series per selected SKU.
  const compareData = useMemo(
    () =>
      months.map((mk) => {
        const row = { month: mk };
        compareSkus.forEach((sku) => {
          const p = products.find((x) => x.sku === sku);
          row[sku] = p?.months[mk]?.[metric] || 0;
        });
        return row;
      }),
    [months, compareSkus, products, metric]
  );

  const toggleCompare = (sku) =>
    setCompareSkus((prev) => {
      if (prev.includes(sku)) return prev.filter((s) => s !== sku);
      if (prev.length >= 5) return prev; // cap at 5 series
      return [...prev, sku];
    });

  // Sales by category (from the SKU cost master's category field).
  const categoryData = useMemo(() => {
    const map = {};
    products.forEach((p) => {
      const cat = p.category || 'ไม่ระบุหมวด';
      if (!map[cat]) map[cat] = { name: cat, revenue: 0, qty: 0 };
      map[cat].revenue += p.revenue;
      map[cat].qty += p.qty;
    });
    return Object.values(map).sort((a, b) => b[metric] - a[metric]);
  }, [products, metric]);
  const categoryTotal = categoryData.reduce((a, c) => a + c[metric], 0);

  const tableRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? products.filter((p) => String(p.sku).toLowerCase().includes(q) || String(p.name || '').toLowerCase().includes(q))
      : products;
    return list.slice(0, 40);
  }, [products, query]);

  const exportCsv = async () => {
    const XLSX = await import('xlsx');
    const data = products.map((p) => {
      const row = { SKU: p.sku, ชื่อสินค้า: p.name, รวมจำนวน: p.qty, รวมยอดขาย: p.revenue };
      months.forEach((mk) => { row[monthLabel(mk)] = p.months[mk]?.[metric] || 0; });
      return row;
    });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'product-monthly');
    XLSX.writeFile(wb, 'product-analytics.csv');
  };

  if (!products.length) {
    return (
      <SectionCard title="วิเคราะห์สินค้า" icon={BarChart3}>
        <EmptyState icon={Package} title="ยังไม่มีข้อมูลสินค้า" hint="นำเข้ายอดขายเพื่อดูการวิเคราะห์รายสินค้า" />
      </SectionCard>
    );
  }

  const MetricToggle = () => (
    <div className="flex bg-slate-100 p-1 rounded-lg">
      <button onClick={() => setMetric('revenue')} className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 ${metric === 'revenue' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}>
        <Coins size={13} /> ยอดขาย
      </button>
      <button onClick={() => setMetric('qty')} className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 ${metric === 'qty' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}>
        <Boxes size={13} /> จำนวน
      </button>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Top sellers bar */}
      <SectionCard title={`สินค้าขายดี Top 10 (ตาม${metricLabel})`} icon={BarChart3} action={<MetricToggle />}>
        <div className="p-5">
          <div style={{ height: Math.max(240, topBar.length * 38) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topBar} layout="vertical" margin={{ top: 4, right: 40, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                <XAxis type="number" tickFormatter={metric === 'revenue' ? compactCurrency : formatNumber} tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="sku" width={130} tick={{ fontSize: 11, fill: '#475569' }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(v) => fmt(v)} labelFormatter={(l) => topBar.find((b) => b.sku === l)?.name || l} contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                  {topBar.map((_, i) => (
                    <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </SectionCard>

      {/* Per-product monthly trend */}
      <SectionCard
        title="แนวโน้มรายเดือนของสินค้า"
        icon={BarChart3}
        action={
          <div className="flex items-center gap-2">
            <MetricToggle />
            <select
              value={selected?.sku || ''}
              onChange={(e) => setSelectedSku(e.target.value)}
              className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm bg-white max-w-[220px] focus:ring-2 focus:ring-blue-200 focus:outline-none"
            >
              {products.map((p) => (
                <option key={p.sku} value={p.sku}>{p.sku} — {p.name}</option>
              ))}
            </select>
          </div>
        }
      >
        <div className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <PlatformBadge platform={selected?.platform} />
            <span className="text-sm text-slate-500">{selected?.name}</span>
            <span className="ml-auto text-sm text-slate-500">รวม: <b className="text-slate-700">{fmt(selected?.[metric] || 0)}</b></span>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="month" tickFormatter={monthLabel} tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={metric === 'revenue' ? compactCurrency : formatNumber} tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(v) => fmt(v)} labelFormatter={monthLabel} contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }} />
                <Line type="monotone" dataKey="value" name={metricLabel} stroke="#2563eb" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </SectionCard>

      {/* Multi-product comparison */}
      <SectionCard title="เปรียบเทียบสินค้า (หลายตัวในกราฟเดียว)" icon={GitCompareArrows} action={<MetricToggle />}>
        <div className="p-5">
          <div className="flex flex-wrap gap-1.5 mb-4">
            {products.slice(0, 12).map((p) => {
              const active = compareSkus.includes(p.sku);
              const colorIdx = compareSkus.indexOf(p.sku);
              return (
                <button
                  key={p.sku}
                  onClick={() => toggleCompare(p.sku)}
                  className={cn(
                    'px-2.5 py-1 rounded-full text-xs font-medium border transition-colors',
                    active ? 'text-white border-transparent' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                  )}
                  style={active ? { backgroundColor: LINE_COLORS[colorIdx % LINE_COLORS.length] } : undefined}
                >
                  {p.sku}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-slate-400 mb-3">เลือกได้สูงสุด 5 สินค้า · แตะชิปเพื่อเพิ่ม/เอาออก</p>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={compareData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="month" tickFormatter={monthLabel} tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={metric === 'revenue' ? compactCurrency : formatNumber} tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(v) => fmt(v)} labelFormatter={monthLabel} contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }} />
                <Legend wrapperStyle={{ paddingTop: 12 }} />
                {compareSkus.map((sku, i) => (
                  <Line key={sku} type="monotone" dataKey={sku} stroke={LINE_COLORS[i % LINE_COLORS.length]} strokeWidth={2.5} dot={{ r: 3 }} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </SectionCard>

      {/* Sales by category */}
      <SectionCard title={`สัดส่วนตามหมวดหมู่ (${metricLabel})`} icon={Tags} action={<MetricToggle />}>
        <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-6 items-center">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={categoryData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3} dataKey={metric}>
                  {categoryData.map((_, i) => (
                    <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} strokeWidth={0} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => fmt(v)} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-2">
            {categoryData.map((c, i) => (
              <div key={c.name} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-slate-600">
                  <span className="w-3 h-3 rounded-full" style={{ backgroundColor: BAR_COLORS[i % BAR_COLORS.length] }} />
                  {c.name}
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-medium text-slate-700">{fmt(c[metric])}</span>
                  <Badge color="slate">{categoryTotal ? formatPercent((c[metric] / categoryTotal) * 100) : '0%'}</Badge>
                </span>
              </div>
            ))}
          </div>
        </div>
      </SectionCard>

      {/* Pivot table: product x month */}
      <SectionCard
        title={`ตารางสินค้า × เดือน (${metricLabel})`}
        icon={Package}
        action={
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ค้นหา SKU/ชื่อ" className="pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-200 focus:outline-none" />
            </div>
            <Button variant="secondary" size="sm" icon={Download} onClick={exportCsv}>ส่งออก CSV</Button>
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 sticky left-0 bg-slate-50">สินค้า</th>
                {months.map((mk) => (
                  <th key={mk} className="px-4 py-3 text-right whitespace-nowrap">{monthLabel(mk)}</th>
                ))}
                <th className="px-4 py-3 text-right font-bold">รวม</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tableRows.map((p) => (
                <tr key={p.sku} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 sticky left-0 bg-white">
                    <div className="font-mono text-xs text-slate-700">{p.sku}</div>
                    <div className="text-[11px] text-slate-400 truncate max-w-[180px]">{p.name}</div>
                  </td>
                  {months.map((mk) => (
                    <td key={mk} className="px-4 py-2.5 text-right text-slate-600">
                      {p.months[mk] ? fmt(p.months[mk][metric]) : <span className="text-slate-300">—</span>}
                    </td>
                  ))}
                  <td className="px-4 py-2.5 text-right font-semibold text-slate-800">{fmt(p[metric])}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {products.length > 40 && (
            <p className="text-center text-xs text-slate-400 py-3">แสดง 40 สินค้าแรก — ใช้ค้นหาหรือส่งออก CSV เพื่อดูทั้งหมด ({formatNumber(products.length)} SKU)</p>
          )}
        </div>
      </SectionCard>
    </div>
  );
}
