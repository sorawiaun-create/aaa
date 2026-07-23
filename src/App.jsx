import React, { useState, useMemo, useEffect } from 'react';
import {
  LayoutDashboard, Upload, Package, Scale, Receipt, Database,
  Filter, ShoppingBag, Video, TrendingUp, Link2,
} from 'lucide-react';
import { useStore } from './lib/store.js';
import { computeReconciliation, computeOrderReconciliation } from './lib/reconcile.js';
import { distinctStatuses } from './lib/salesParser.js';
import { cn, Badge } from './components/ui.jsx';
import DashboardView from './views/DashboardView.jsx';
import SalesImportView from './views/SalesImportView.jsx';
import ProductsView from './views/ProductsView.jsx';
import FeesImportView from './views/FeesImportView.jsx';
import ReconcileView from './views/ReconcileView.jsx';
import OrderProfitView from './views/OrderProfitView.jsx';
import DataView from './views/DataView.jsx';

const NAV = [
  { id: 'dashboard', label: 'แดชบอร์ด', icon: LayoutDashboard },
  { id: 'orders', label: 'กำไรจริง (รายออเดอร์)', icon: Link2 },
  { id: 'reconcile', label: 'กำไรราย SKU', icon: Scale },
  { id: 'products', label: 'สินค้า & ต้นทุน', icon: Package },
  { id: 'sales', label: 'นำเข้ายอดขาย', icon: Upload },
  { id: 'fees', label: 'นำเข้าค่าธรรมเนียม', icon: Receipt },
  { id: 'data', label: 'จัดการข้อมูล', icon: Database },
];

export default function App() {
  const store = useStore();
  const [view, setView] = useState('dashboard');
  const [filters, setFilters] = useState({ platform: 'all', from: '', to: '', statuses: [] });

  // Load pdf.js from CDN once (used by the fee importer).
  useEffect(() => {
    if (window.pdfjsLib) return;
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.async = true;
    script.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    };
    document.body.appendChild(script);
  }, []);

  const statusOptions = useMemo(() => distinctStatuses(store.sales), [store.sales]);

  const recon = useMemo(
    () =>
      computeReconciliation({
        sales: store.sales,
        products: store.products,
        fees: store.fees,
        orderFees: store.orderFees,
        filters: { ...filters, statuses: filters.statuses.length ? filters.statuses : null },
      }),
    [store.sales, store.products, store.fees, store.orderFees, filters]
  );

  const orderRecon = useMemo(
    () =>
      computeOrderReconciliation({
        sales: store.sales,
        products: store.products,
        orderFees: store.orderFees,
        filters: { ...filters, statuses: filters.statuses.length ? filters.statuses : null },
      }),
    [store.sales, store.products, store.orderFees, filters]
  );

  const showFilters = view === 'dashboard' || view === 'reconcile' || view === 'orders';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex">
      {/* Sidebar */}
      <aside className="hidden md:flex md:flex-col w-60 shrink-0 bg-white border-r border-slate-200 p-4 sticky top-0 h-screen">
        <div className="flex items-center gap-2 px-2 py-3 mb-4">
          <span className="bg-gradient-to-br from-pink-500 to-slate-900 text-white p-2 rounded-xl">
            <TrendingUp size={20} />
          </span>
          <div>
            <div className="font-bold text-slate-800 leading-tight">Profit Desk</div>
            <div className="text-[11px] text-slate-400">Shopee · TikTok</div>
          </div>
        </div>
        <nav className="space-y-1">
          {NAV.map((item) => (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors',
                view === item.id
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-slate-600 hover:bg-slate-100'
              )}
            >
              <item.icon size={18} />
              {item.label}
            </button>
          ))}
        </nav>
        <div className="mt-auto pt-4 border-t border-slate-100 text-[11px] text-slate-400 px-2 space-y-1">
          <div className="flex justify-between"><span>สินค้า</span><b>{store.products.length}</b></div>
          <div className="flex justify-between"><span>รายการขาย</span><b>{store.sales.length}</b></div>
          <div className="flex justify-between"><span>เอกสารค่าธรรมเนียม</span><b>{store.fees.length}</b></div>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Mobile nav */}
        <div className="md:hidden bg-white border-b border-slate-200 p-2 flex gap-1 overflow-x-auto">
          {NAV.map((item) => (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap',
                view === item.id ? 'bg-blue-50 text-blue-700' : 'text-slate-500'
              )}
            >
              <item.icon size={15} />
              {item.label}
            </button>
          ))}
        </div>

        <main className="flex-1 p-4 md:p-8 max-w-7xl w-full mx-auto space-y-6">
          {showFilters && (
            <FilterBar
              filters={filters}
              setFilters={setFilters}
              statusOptions={statusOptions}
            />
          )}

          {view === 'dashboard' && <DashboardView recon={recon} store={store} />}
          {view === 'orders' && <OrderProfitView orderRecon={orderRecon} store={store} />}
          {view === 'reconcile' && <ReconcileView recon={recon} store={store} />}
          {view === 'products' && <ProductsView store={store} recon={recon} />}
          {view === 'sales' && <SalesImportView store={store} />}
          {view === 'fees' && <FeesImportView store={store} />}
          {view === 'data' && <DataView store={store} />}
        </main>
      </div>
    </div>
  );
}

function FilterBar({ filters, setFilters, statusOptions }) {
  const toggleStatus = (s) =>
    setFilters((f) => ({
      ...f,
      statuses: f.statuses.includes(s)
        ? f.statuses.filter((x) => x !== s)
        : [...f.statuses, s],
    }));

  const platformBtn = (id, label, Icon) => (
    <button
      onClick={() => setFilters((f) => ({ ...f, platform: id }))}
      className={cn(
        'px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2 border transition-all',
        filters.platform === id
          ? id === 'shopee'
            ? 'bg-orange-500 text-white border-orange-500'
            : id === 'tiktok'
            ? 'bg-slate-900 text-white border-slate-900'
            : 'bg-slate-800 text-white border-slate-800'
          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
      )}
    >
      <Icon size={15} /> {label}
    </button>
  );

  return (
    <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2">
        {platformBtn('all', 'ทั้งหมด', Filter)}
        {platformBtn('shopee', 'Shopee', ShoppingBag)}
        {platformBtn('tiktok', 'TikTok', Video)}
      </div>
      <div className="h-6 w-px bg-slate-200 hidden sm:block" />
      <div className="flex items-center gap-2 text-sm">
        <span className="text-slate-500">เดือน</span>
        <input
          type="month"
          value={filters.from}
          onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
          className="border border-slate-200 rounded-lg px-2 py-1.5 text-slate-700 focus:ring-2 focus:ring-blue-200 focus:outline-none"
        />
        <span className="text-slate-400">–</span>
        <input
          type="month"
          value={filters.to}
          onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
          className="border border-slate-200 rounded-lg px-2 py-1.5 text-slate-700 focus:ring-2 focus:ring-blue-200 focus:outline-none"
        />
        {(filters.from || filters.to) && (
          <button
            onClick={() => setFilters((f) => ({ ...f, from: '', to: '' }))}
            className="text-xs text-slate-400 hover:text-slate-600 underline"
          >
            ล้าง
          </button>
        )}
      </div>
      {statusOptions.length > 0 && (
        <>
          <div className="h-6 w-px bg-slate-200 hidden sm:block" />
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-slate-500">สถานะ</span>
            {statusOptions.map((s) => {
              const active = filters.statuses.length === 0 || filters.statuses.includes(s);
              return (
                <button key={s} onClick={() => toggleStatus(s)}>
                  <Badge color={active ? 'blue' : 'slate'}>{s}</Badge>
                </button>
              );
            })}
            {filters.statuses.length > 0 && (
              <button
                onClick={() => setFilters((f) => ({ ...f, statuses: [] }))}
                className="text-xs text-slate-400 hover:text-slate-600 underline"
              >
                รีเซ็ต
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
