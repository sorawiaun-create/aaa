import React, { useMemo } from 'react';
import { Radio, TrendingUp, Megaphone, Wallet } from 'lucide-react';
import { KpiCard, SectionCard, EmptyState, StatusPill } from '../components/ui.jsx';
import { formatCurrency, formatCurrency0, formatBahtCompact, todayDMY } from '../lib/format.js';

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export default function RealtimeView({ store }) {
  const today = todayDMY();

  const todaySales = useMemo(() => store.sales.filter((s) => s.date === today), [store.sales, today]);

  const perChannel = useMemo(() => {
    const map = new Map();
    todaySales.forEach((s) => {
      const cur = map.get(s.channelId) || { sales: 0, ad: 0, received: 0 };
      cur.sales += num(s.sales); cur.ad += num(s.adCost); cur.received += num(s.actualReceived);
      map.set(s.channelId, cur);
    });
    return store.channels
      .map((ch) => ({ channel: ch, ...(map.get(ch.id) || { sales: 0, ad: 0, received: 0 }) }))
      .filter((r) => r.sales > 0 || ch_isActive(r.channel))
      .sort((a, b) => b.sales - a.sales);
  }, [todaySales, store.channels]);

  const totals = useMemo(() => todaySales.reduce((a, s) => ({
    sales: a.sales + num(s.sales), ad: a.ad + num(s.adCost), received: a.received + num(s.actualReceived),
  }), { sales: 0, ad: 0, received: 0 }), [todaySales]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-500 opacity-60" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500" />
        </span>
        ยอดขายวันนี้ · {today}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard title="ยอดขายวันนี้" value={formatBahtCompact(totals.sales)} valueTitle={formatCurrency(totals.sales)} icon={TrendingUp} accent="pink" />
        <KpiCard title="ค่าแอดวันนี้" value={formatBahtCompact(totals.ad)} valueTitle={formatCurrency(totals.ad)} icon={Megaphone} accent="orange" subtext={totals.ad > 0 ? `ROAS ${(totals.sales / totals.ad).toFixed(2)}` : '—'} />
        <KpiCard title="รับจริงวันนี้" value={formatBahtCompact(totals.received)} valueTitle={formatCurrency(totals.received)} icon={Wallet} accent="emerald" />
      </div>

      <SectionCard title="สถานะไลฟ์รายช่อง (วันนี้)">
        {perChannel.length === 0 ? (
          <EmptyState icon={Radio} title="ยังไม่มีข้อมูลวันนี้" hint="บันทึกยอดขายของวันนี้ที่เมนู “บันทึกยอดขาย” แล้วกลับมาดูสรุปเรียลไทม์ที่นี่" />
        ) : (
          <div className="divide-y divide-slate-50">
            {perChannel.map((r) => (
              <div key={r.channel.id} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-slate-800 truncate">{r.channel.name}</div>
                  <div className="mt-0.5"><StatusPill status={r.channel.status} /></div>
                </div>
                <div className="text-right">
                  <div className="font-bold text-slate-800 tabular-nums">{formatCurrency0(r.sales)}</div>
                  <div className="text-[11px] text-slate-400">แอด {formatCurrency0(r.ad)}{r.ad > 0 ? ` · ROAS ${(r.sales / r.ad).toFixed(1)}` : ''}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

const ch_isActive = (ch) => ch.status === 'active';
