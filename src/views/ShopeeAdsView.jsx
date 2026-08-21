import React, { useMemo, useRef, useState, useEffect } from 'react';
import {
  Upload, Sparkles, Search, Filter, Download, Trash2, ExternalLink, Moon,
  Trophy, Clock, PieChart as PieIcon, Info, Loader2, Star, Tag, RefreshCw, Settings2,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import {
  scoreCatalog, summarize, categoryStats, roundSchedule, reasonsFor,
  categoryLabel, breakEvenCvr, GRADE_META, GRADE_ORDER, DEFAULT_SCORING,
  FACTOR_LABELS, FACTOR_HINTS, DEFAULT_WEIGHTS, CATEGORY_LABELS,
} from '../lib/shopee.js';
import { parseProductFile, shortlistCsv } from '../lib/shopeeImport.js';
import { buildShopeeSample } from '../lib/shopeeSample.js';
import { localAnalysis, runAiAnalysis, mergeAiIntoProducts, DEFAULT_AI } from '../lib/shopeeAI.js';
import { loadShopeeAi, saveShopeeAi } from '../lib/store.js';
import { formatCurrency0, formatNumber } from '../lib/format.js';
import {
  SectionCard, Button, Badge, EmptyState, Banner, Field, Input, Select, Modal, cn,
} from '../components/ui.jsx';

const TABS = [
  { id: 'products', label: 'ตารางสินค้า' },
  { id: 'rubric', label: 'เกณฑ์ให้คะแนน' },
  { id: 'schedule', label: 'ตารางรอบดีล' },
  { id: 'market', label: 'ภาพรวมตลาด' },
  { id: 'daily', label: 'ตัวเด่นรายวัน' },
  { id: 'tips', label: 'ข้อควรรู้' },
];

const GRADE_STYLE = {
  A: { card: 'from-amber-500/20 to-amber-500/5 border-amber-400/40', text: 'text-amber-400', pill: 'bg-amber-100 text-amber-700' },
  B: { card: 'from-emerald-500/20 to-emerald-500/5 border-emerald-400/30', text: 'text-emerald-400', pill: 'bg-emerald-100 text-emerald-700' },
  C: { card: 'from-blue-500/20 to-blue-500/5 border-blue-400/30', text: 'text-blue-400', pill: 'bg-blue-100 text-blue-700' },
  D: { card: 'from-slate-500/20 to-slate-500/5 border-slate-400/20', text: 'text-slate-400', pill: 'bg-slate-100 text-slate-500' },
};

const SORTS = {
  score: { label: 'คะแนนสูงสุด', fn: (a, b) => b.analysis.score - a.analysis.score },
  discount: { label: 'ส่วนลดมากสุด', fn: (a, b) => b.analysis.metrics.discountPct - a.analysis.metrics.discountPct },
  commission: { label: 'คอมต่อชิ้นสูงสุด', fn: (a, b) => b.analysis.metrics.commissionPerUnit - a.analysis.metrics.commissionPerUnit },
  rounds: { label: 'ขึ้นรอบเยอะสุด', fn: (a, b) => b.analysis.metrics.roundCount - a.analysis.metrics.roundCount },
  sold: { label: 'ขายดีที่สุด', fn: (a, b) => (b.sold || 0) - (a.sold || 0) },
  priceAsc: { label: 'ราคาถูก → แพง', fn: (a, b) => (a.price || 0) - (b.price || 0) },
};

export default function ShopeeAdsView({ store }) {
  const products = store.shopeeProducts || [];
  const scoring = { ...DEFAULT_SCORING, ...(store.settings.shopeeScoring || {}) };

  const [tab, setTab] = useState('products');
  const [grade, setGrade] = useState('');        // '' = ทุกเกรด
  const [category, setCategory] = useState('');
  const [query, setQuery] = useState('');
  const [minDiscount, setMinDiscount] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [midnightOnly, setMidnightOnly] = useState(false);
  const [sortKey, setSortKey] = useState('score');
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState(null);
  const [aiCfg, setAiCfg] = useState(() => DEFAULT_AI);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiResult, setAiResult] = useState(null);
  const [aiByProduct, setAiByProduct] = useState({});
  const fileRef = useRef(null);

  useEffect(() => { setAiCfg(loadShopeeAi()); }, []);

  // ให้คะแนนใหม่ทุกครั้งที่ข้อมูลหรือเกณฑ์เปลี่ยน
  const scored = useMemo(() => scoreCatalog(products, scoring), [products, JSON.stringify(scoring)]);
  const stats = useMemo(() => summarize(scored), [scored]);
  const cats = useMemo(() => categoryStats(scored), [scored]);
  const schedule = useMemo(() => roundSchedule(scored), [scored]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const minD = parseFloat(minDiscount) || 0;
    const maxP = parseFloat(maxPrice) || Infinity;
    return scored
      .filter((p) => (!grade || p.analysis.grade === grade))
      .filter((p) => (!category || p.category === category))
      .filter((p) => (!q || `${p.name} ${p.shopName} ${p.categoryRaw}`.toLowerCase().includes(q)))
      .filter((p) => p.analysis.metrics.discountPct >= minD)
      .filter((p) => (p.price || 0) <= maxP)
      .filter((p) => (!midnightOnly || p.analysis.metrics.hasMidnightRound))
      .sort(SORTS[sortKey].fn);
  }, [scored, grade, category, query, minDiscount, maxPrice, midnightOnly, sortKey]);

  const usedCategories = useMemo(
    () => [...new Set(scored.map((p) => p.category))].sort((a, b) => categoryLabel(a).localeCompare(categoryLabel(b), 'th')),
    [scored]
  );

  const flash = (tone, text) => { setNotice({ tone, text }); setTimeout(() => setNotice(null), 6000); };

  const onPickFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy('import');
    try {
      const res = await parseProductFile(file);
      if (res.error) throw new Error(res.error);
      if (!res.products.length) throw new Error('ไม่พบข้อมูลสินค้าในไฟล์นี้');
      const next = store.importShopeeProducts(res.products);
      flash('success', `นำเข้า ${res.products.length} รายการจาก "${file.name}" — รวมกับของเดิมเป็น ${next.length} รายการ${res.skipped ? ` (ข้าม ${res.skipped} แถวที่ไม่มีชื่อสินค้า)` : ''}`);
    } catch (err) {
      flash('error', `นำเข้าไม่สำเร็จ: ${err.message}`);
    } finally {
      setBusy('');
    }
  };

  const onLoadSample = () => {
    const list = buildShopeeSample();
    store.importShopeeProducts(list, { replace: true });
    flash('info', `โหลดข้อมูลตัวอย่าง ${list.length} รายการแล้ว — ลองกดดูรายละเอียดแต่ละตัวได้เลย`);
  };

  const onExport = () => {
    const csv = shortlistCsv(filtered);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `shopee-shortlist-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const onRunAi = async () => {
    setBusy('ai');
    try {
      const targets = filtered.slice(0, aiCfg.maxProducts);
      const result = await runAiAnalysis(targets, aiCfg, { note: 'ยิงแอด Facebook ในไทย' });
      setAiResult(result);
      const merged = mergeAiIntoProducts(targets, result, scoring, aiCfg);
      setAiByProduct((prev) => ({ ...prev, ...Object.fromEntries(merged.map((p) => [p.id, p.ai])) }));
      flash('success', `AI วิเคราะห์ ${targets.length} รายการเรียบร้อย`);
    } catch (err) {
      flash('error', err.message);
    } finally {
      setBusy('');
    }
  };

  const analysisOf = (p) => aiByProduct[p.id] || localAnalysis(p, scoring, aiCfg);

  return (
    <div className="space-y-5">
      {/* Hero — สรุปหัวเรื่องแบบเดียวกับบอร์ดคัดสินค้า */}
      <div className="rounded-3xl bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950 text-white p-5 md:p-7 shadow-lg">
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-xs md:text-sm font-semibold tracking-wide text-orange-400">
              SHOPEE · คัดสินค้าเข้ารอบยิงแอด
            </p>
            <h2 className="text-2xl md:text-3xl font-extrabold mt-1">คัดกรองสินค้าสำหรับยิงแอด</h2>
            <p className="text-slate-300 text-sm mt-2">
              ให้คะแนนทุกสินค้าจาก 6 ปัจจัย แล้วบอกว่าตัวไหนคุ้มที่จะจ่ายค่าโฆษณาไปหาคนซื้อ
            </p>
          </div>
          <div className="flex gap-6 md:gap-8">
            <div className="text-right">
              <div className="text-3xl md:text-4xl font-extrabold text-orange-400 tabular-nums">{formatNumber(stats.shouldRun)}</div>
              <div className="text-[11px] md:text-xs text-slate-400 mt-1">ตัวที่ควรยิง</div>
            </div>
            <div className="text-right">
              <div className="text-3xl md:text-4xl font-extrabold tabular-nums">{formatNumber(stats.total)}</div>
              <div className="text-[11px] md:text-xs text-slate-400 mt-1">สินค้าทั้งหมด</div>
            </div>
          </div>
        </div>

        {/* การ์ดเกรด — กดเพื่อกรอง */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-6">
          {GRADE_ORDER.map((g) => {
            const meta = GRADE_META[g];
            const st = GRADE_STYLE[g];
            const active = grade === g;
            return (
              <button
                key={g}
                onClick={() => { setGrade(active ? '' : g); setTab('products'); }}
                className={cn(
                  'text-left rounded-2xl border bg-gradient-to-b p-4 transition-transform hover:-translate-y-0.5',
                  st.card,
                  active && 'ring-2 ring-white/60'
                )}
              >
                <div className={cn('text-3xl font-extrabold tabular-nums', st.text)}>{formatNumber(stats.counts[g])}</div>
                <div className="text-sm font-bold mt-1">เกรด {g} · {meta.label}</div>
                <div className="text-[11px] text-slate-400 mt-1 leading-snug">{meta.hint}</div>
              </button>
            );
          })}
        </div>
      </div>

      {notice && <Banner tone={notice.tone}>{notice.text}</Banner>}

      {/* แถบเครื่องมือ */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-wrap items-center gap-2">
        <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,.json,.xlsx,.xls" className="hidden" onChange={onPickFile} />
        <Button icon={busy === 'import' ? Loader2 : Upload} onClick={() => fileRef.current?.click()} disabled={!!busy}>
          นำเข้าไฟล์สินค้า
        </Button>
        <Button variant="secondary" icon={RefreshCw} onClick={onLoadSample} disabled={!!busy}>ข้อมูลตัวอย่าง</Button>
        <Button variant="secondary" icon={Sparkles} onClick={() => setAiOpen(true)}>ตั้งค่า AI</Button>
        {aiCfg.apiKey && (
          <Button variant="success" icon={busy === 'ai' ? Loader2 : Sparkles} onClick={onRunAi} disabled={!!busy || !filtered.length}>
            ให้ AI วิเคราะห์ {Math.min(filtered.length, aiCfg.maxProducts)} ตัวแรก
          </Button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button variant="secondary" icon={Download} onClick={onExport} disabled={!filtered.length}>ส่งออก CSV</Button>
          {!!products.length && (
            <Button
              variant="danger"
              icon={Trash2}
              onClick={() => { if (confirm('ล้างข้อมูลสินค้า Shopee ทั้งหมด?')) store.clearShopeeProducts(); }}
            >
              ล้างข้อมูล
            </Button>
          )}
        </div>
      </div>

      {/* แท็บ */}
      <div className="flex gap-2 overflow-x-auto pb-1 custom-scrollbar">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap border transition-colors',
              tab === t.id
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {!products.length ? (
        <SectionCard>
          <EmptyState
            icon={Tag}
            title="ยังไม่มีข้อมูลสินค้า"
            hint="นำเข้าไฟล์ CSV / XLSX / JSON ที่ดึงมาจาก Shopee (หรือกด “ข้อมูลตัวอย่าง” เพื่อลองระบบก่อน) — ระบบอ่านหัวคอลัมน์ภาษาไทยและอังกฤษให้อัตโนมัติ"
          >
            <div className="flex gap-2 justify-center">
              <Button icon={Upload} onClick={() => fileRef.current?.click()}>เลือกไฟล์</Button>
              <Button variant="secondary" icon={RefreshCw} onClick={onLoadSample}>ข้อมูลตัวอย่าง</Button>
            </div>
          </EmptyState>
        </SectionCard>
      ) : (
        <>
          {tab === 'products' && (
            <ProductsTab
              filtered={filtered}
              total={scored.length}
              usedCategories={usedCategories}
              filters={{ grade, setGrade, category, setCategory, query, setQuery, minDiscount, setMinDiscount, maxPrice, setMaxPrice, midnightOnly, setMidnightOnly, sortKey, setSortKey }}
              onOpen={setDetail}
            />
          )}
          {tab === 'rubric' && <RubricTab scoring={scoring} store={store} />}
          {tab === 'schedule' && <ScheduleTab schedule={schedule} onOpen={setDetail} />}
          {tab === 'market' && <MarketTab cats={cats} stats={stats} />}
          {tab === 'daily' && <DailyTab schedule={schedule} onOpen={setDetail} />}
          {tab === 'tips' && <TipsTab aiResult={aiResult} />}
        </>
      )}

      <ProductModal
        product={detail}
        onClose={() => setDetail(null)}
        analysis={detail ? analysisOf(detail) : null}
        cpc={aiCfg.cpc}
        scoring={scoring}
      />

      <AiSettingsModal
        open={aiOpen}
        cfg={aiCfg}
        onClose={() => setAiOpen(false)}
        onSave={(next) => { setAiCfg(next); saveShopeeAi(next); setAiOpen(false); flash('success', 'บันทึกค่าตั้ง AI แล้ว (เก็บในเครื่องนี้เท่านั้น)'); }}
      />
    </div>
  );
}

// --- แท็บตารางสินค้า ---
function ProductsTab({ filtered, total, usedCategories, filters, onOpen }) {
  const f = filters;
  return (
    <SectionCard
      title={`ตารางสินค้า (${formatNumber(filtered.length)} / ${formatNumber(total)})`}
      icon={Filter}
      action={
        <Select value={f.sortKey} onChange={(e) => f.setSortKey(e.target.value)} className="w-44">
          {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select>
      }
    >
      <div className="p-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 border-b border-slate-100">
        <Field label="ค้นหา" className="col-span-2 md:col-span-1">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
            <Input value={f.query} onChange={(e) => f.setQuery(e.target.value)} placeholder="ชื่อสินค้า / ร้าน" className="pl-8" />
          </div>
        </Field>
        <Field label="เกรด">
          <Select value={f.grade} onChange={(e) => f.setGrade(e.target.value)}>
            <option value="">ทุกเกรด</option>
            {GRADE_ORDER.map((g) => <option key={g} value={g}>{g} · {GRADE_META[g].label}</option>)}
          </Select>
        </Field>
        <Field label="หมวดหมู่">
          <Select value={f.category} onChange={(e) => f.setCategory(e.target.value)}>
            <option value="">ทุกหมวด</option>
            {usedCategories.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c] || c}</option>)}
          </Select>
        </Field>
        <Field label="ส่วนลดขั้นต่ำ %">
          <Input type="number" value={f.minDiscount} onChange={(e) => f.setMinDiscount(e.target.value)} placeholder="เช่น 40" />
        </Field>
        <Field label="ราคาไม่เกิน ฿">
          <Input type="number" value={f.maxPrice} onChange={(e) => f.setMaxPrice(e.target.value)} placeholder="เช่น 999" />
        </Field>
        <Field label="เงื่อนไขพิเศษ">
          <label className="flex items-center gap-2 text-sm text-slate-600 h-[38px]">
            <input type="checkbox" checked={f.midnightOnly} onChange={(e) => f.setMidnightOnly(e.target.checked)} className="rounded" />
            เฉพาะที่มีรอบเที่ยงคืน
          </label>
        </Field>
      </div>

      {!filtered.length ? (
        <EmptyState icon={Search} title="ไม่มีสินค้าที่ตรงเงื่อนไข" hint="ลองลดส่วนลดขั้นต่ำ หรือเลือกเกรดอื่นดู" />
      ) : (
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-sm min-w-[900px]">
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">สินค้า</th>
                <th className="text-right px-3 py-3 font-semibold">ราคา</th>
                <th className="text-right px-3 py-3 font-semibold">ส่วนลด</th>
                <th className="text-right px-3 py-3 font-semibold">คอม/ชิ้น</th>
                <th className="text-center px-3 py-3 font-semibold">รอบ</th>
                <th className="text-right px-3 py-3 font-semibold">เรตติ้ง</th>
                <th className="text-right px-3 py-3 font-semibold">ขายแล้ว</th>
                <th className="text-center px-4 py-3 font-semibold">คะแนน</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.slice(0, 300).map((p) => {
                const m = p.analysis.metrics;
                return (
                  <tr key={p.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => onOpen(p)}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800 line-clamp-1" title={p.name}>{p.name}</div>
                      <div className="text-xs text-slate-400 flex items-center gap-2">
                        <span className="truncate max-w-[160px]">{p.shopName || 'ไม่ระบุร้าน'}</span>
                        <Badge color="slate">{categoryLabel(p.category)}</Badge>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      <div className="font-semibold text-slate-800">{formatCurrency0(p.price)}</div>
                      {p.originalPrice > p.price && (
                        <div className="text-[11px] text-slate-400 line-through">{formatCurrency0(p.originalPrice)}</div>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums font-semibold text-rose-600">
                      {m.discountPct ? `${m.discountPct.toFixed(0)}%` : '—'}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-slate-600">
                      {m.commissionPerUnit ? formatCurrency0(m.commissionPerUnit) : '—'}
                    </td>
                    <td className="px-3 py-3 text-center">
                      <span className="tabular-nums text-slate-700">{m.roundCount || '—'}</span>
                      {m.hasMidnightRound && <Moon size={13} className="inline ml-1 text-indigo-500" title="มีรอบเที่ยงคืน" />}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-slate-600">
                      {p.rating ? (
                        <span className="inline-flex items-center gap-1">
                          <Star size={12} className="text-amber-400 fill-amber-400" />{p.rating.toFixed(1)}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-slate-600">{p.sold ? formatNumber(p.sold) : '—'}</td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <span className="font-bold tabular-nums text-slate-800">{p.analysis.score}</span>
                        <span className={cn('px-2 py-0.5 rounded-md text-xs font-bold', GRADE_STYLE[p.analysis.grade].pill)}>
                          {p.analysis.grade}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length > 300 && (
            <p className="px-4 py-3 text-xs text-slate-400">
              แสดง 300 รายการแรกจาก {formatNumber(filtered.length)} รายการ — กรองให้แคบลงหรือส่งออก CSV เพื่อดูทั้งหมด
            </p>
          )}
        </div>
      )}
    </SectionCard>
  );
}

// --- แท็บเกณฑ์ให้คะแนน (ปรับน้ำหนักได้) ---
function RubricTab({ scoring, store }) {
  const weights = { ...DEFAULT_WEIGHTS, ...(scoring.weights || {}) };
  const totalWeight = Object.values(weights).reduce((a, b) => a + Number(b || 0), 0);

  const setWeight = (key, value) => {
    const next = { ...weights, [key]: Math.max(0, Number(value) || 0) };
    store.updateSettings({ shopeeScoring: { ...scoring, weights: next } });
  };
  const setField = (key, value) => {
    store.updateSettings({ shopeeScoring: { ...scoring, [key]: Number(value) || 0 } });
  };
  const setCut = (key, value) => {
    store.updateSettings({
      shopeeScoring: { ...scoring, gradeCuts: { ...scoring.gradeCuts, [key]: Number(value) || 0 } },
    });
  };

  return (
    <div className="space-y-4">
      <SectionCard title="ให้คะแนนจากอะไร" icon={Trophy}>
        <div className="p-5 space-y-4">
          <p className="text-sm text-slate-600">
            คำถามหลักคือ “ดีลนี้คุ้มที่จะจ่ายค่าโฆษณาไปหาคนซื้อไหม” ไม่ใช่ “ลดเยอะไหม” —
            ของลด 80% ราคา ฿15 ลดแรงมากแต่ได้ค่าคอมไม่ถึงบาท
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {Object.keys(DEFAULT_WEIGHTS).map((key) => (
              <div key={key} className="rounded-xl border border-slate-200 p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold text-slate-800">{FACTOR_LABELS[key]}</span>
                  <span className="text-sm font-bold text-orange-500 tabular-nums">{weights[key]} คะแนน</span>
                </div>
                <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">{FACTOR_HINTS[key]}</p>
                <input
                  type="range" min="0" max="40" value={weights[key]}
                  onChange={(e) => setWeight(key, e.target.value)}
                  className="w-full mt-3 accent-orange-500"
                />
              </div>
            ))}
          </div>
          <p className={cn('text-xs', totalWeight === 100 ? 'text-slate-400' : 'text-amber-600')}>
            น้ำหนักรวม {totalWeight} คะแนน {totalWeight !== 100 && '— ปกติควรรวมได้ 100 เพื่อให้เทียบเกรดตรงกับเกณฑ์'}
          </p>
        </div>
      </SectionCard>

      <SectionCard title="ปรับเกณฑ์ละเอียด" icon={Settings2}>
        <div className="p-5 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Field label="ส่วนลดที่เริ่มนับ (%)" hint="ต่ำกว่านี้ได้ 0 คะแนน">
            <Input type="number" value={scoring.discountFloor} onChange={(e) => setField('discountFloor', e.target.value)} />
          </Field>
          <Field label="ส่วนลดที่ได้เต็ม (%)">
            <Input type="number" value={scoring.discountFull} onChange={(e) => setField('discountFull', e.target.value)} />
          </Field>
          <Field label="ช่วงราคาดีที่สุด — ต่ำสุด ฿">
            <Input type="number" value={scoring.priceSweetMin} onChange={(e) => setField('priceSweetMin', e.target.value)} />
          </Field>
          <Field label="ช่วงราคาดีที่สุด — สูงสุด ฿">
            <Input type="number" value={scoring.priceSweetMax} onChange={(e) => setField('priceSweetMax', e.target.value)} />
          </Field>
          <Field label="ขึ้นกี่รอบถึงได้เต็ม">
            <Input type="number" value={scoring.roundsFull} onChange={(e) => setField('roundsFull', e.target.value)} />
          </Field>
          <Field label="เรตคอมที่ใช้ประเมิน (%)" hint="ใช้เมื่อไฟล์ไม่มีคอมจริง">
            <Input type="number" value={scoring.assumedCommissionRate} onChange={(e) => setField('assumedCommissionRate', e.target.value)} />
          </Field>
          <Field label="คอมต่อชิ้นขั้นต่ำ ฿" hint="ต่ำกว่านี้ถือว่าไม่คุ้มค่าคลิก">
            <Input type="number" value={scoring.commissionFloor} onChange={(e) => setField('commissionFloor', e.target.value)} />
          </Field>
          <Field label="คอมต่อชิ้นที่ได้เต็ม ฿">
            <Input type="number" value={scoring.commissionFull} onChange={(e) => setField('commissionFull', e.target.value)} />
          </Field>
          <Field label="คะแนนขั้นต่ำเกรด A">
            <Input type="number" value={scoring.gradeCuts?.A} onChange={(e) => setCut('A', e.target.value)} />
          </Field>
          <Field label="คะแนนขั้นต่ำเกรด B">
            <Input type="number" value={scoring.gradeCuts?.B} onChange={(e) => setCut('B', e.target.value)} />
          </Field>
          <Field label="คะแนนขั้นต่ำเกรด C">
            <Input type="number" value={scoring.gradeCuts?.C} onChange={(e) => setCut('C', e.target.value)} />
          </Field>
          <div className="flex items-end">
            <Button variant="secondary" onClick={() => store.updateSettings({ shopeeScoring: { ...DEFAULT_SCORING } })}>
              คืนค่าเริ่มต้น
            </Button>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}

// --- แท็บตารางรอบดีล ---
function ScheduleTab({ schedule, onOpen }) {
  if (!schedule.length) {
    return (
      <SectionCard>
        <EmptyState icon={Clock} title="ไฟล์นี้ไม่มีข้อมูลเวลารอบดีล" hint="เพิ่มคอลัมน์ “เวลาเริ่ม” (เช่น 2026-08-18T00:00) แล้วนำเข้าใหม่ ระบบจะรวมรอบของสินค้าเดียวกันให้เอง" />
      </SectionCard>
    );
  }
  return (
    <SectionCard title={`ตารางรอบดีล (${schedule.length} ช่วงเวลา)`} icon={Clock}>
      <div className="p-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {schedule.map((slot) => (
          <div key={`${slot.day}-${slot.hour}`} className="rounded-xl border border-slate-200 p-4">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-slate-800 flex items-center gap-2">
                {slot.hour === 0 && <Moon size={14} className="text-indigo-500" />}
                {slot.day} · {String(slot.hour).padStart(2, '0')}:00
              </div>
              <Badge color={slot.shouldRun ? 'green' : 'slate'}>ควรยิง {slot.shouldRun}/{slot.count}</Badge>
            </div>
            <ul className="mt-3 space-y-1.5">
              {slot.top.map((p) => (
                <li key={p.id}>
                  <button onClick={() => onOpen(p)} className="text-left w-full text-sm text-slate-600 hover:text-slate-900 flex items-center gap-2">
                    <span className={cn('px-1.5 rounded text-[11px] font-bold shrink-0', GRADE_STYLE[p.analysis.grade].pill)}>
                      {p.analysis.grade}
                    </span>
                    <span className="line-clamp-1">{p.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

// --- แท็บภาพรวมตลาด ---
function MarketTab({ cats, stats }) {
  const data = cats.slice(0, 12).map((c) => ({ name: c.label, ควรยิง: c.shouldRun, ทั้งหมด: c.total }));
  return (
    <div className="space-y-4">
      <SectionCard title="หมวดไหนมีของให้ยิงเยอะที่สุด" icon={PieIcon}>
        <div className="p-4 h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="name" angle={-30} textAnchor="end" interval={0} tick={{ fontSize: 11, fill: '#64748b' }} height={60} />
              <YAxis tick={{ fontSize: 11, fill: '#64748b' }} allowDecimals={false} />
              <Tooltip formatter={(v, k) => [formatNumber(v), k]} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="ทั้งหมด" fill="#cbd5e1" radius={[6, 6, 0, 0]} />
              <Bar dataKey="ควรยิง" fill="#f97316" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </SectionCard>

      <SectionCard title="สรุปรายหมวด" icon={Trophy}>
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-sm min-w-[600px]">
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">หมวดหมู่</th>
                <th className="text-right px-3 py-3 font-semibold">สินค้า</th>
                <th className="text-right px-3 py-3 font-semibold">ควรยิง</th>
                <th className="text-right px-3 py-3 font-semibold">สัดส่วนที่ผ่าน</th>
                <th className="text-right px-3 py-3 font-semibold">คะแนนเฉลี่ย</th>
                <th className="text-right px-4 py-3 font-semibold">ส่วนลดเฉลี่ย</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cats.map((c) => (
                <tr key={c.key} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-700">{c.label}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-slate-600">{formatNumber(c.total)}</td>
                  <td className="px-3 py-3 text-right tabular-nums font-semibold text-orange-600">{formatNumber(c.shouldRun)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-slate-600">{c.hitRate}%</td>
                  <td className="px-3 py-3 text-right tabular-nums text-slate-600">{c.avgScore}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-600">{c.avgDiscount}%</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-50 text-slate-700 font-semibold">
              <tr>
                <td className="px-4 py-3">รวม</td>
                <td className="px-3 py-3 text-right tabular-nums">{formatNumber(stats.total)}</td>
                <td className="px-3 py-3 text-right tabular-nums text-orange-600">{formatNumber(stats.shouldRun)}</td>
                <td className="px-3 py-3 text-right tabular-nums">
                  {stats.total ? Math.round((stats.shouldRun / stats.total) * 1000) / 10 : 0}%
                </td>
                <td className="px-3 py-3 text-right tabular-nums">{stats.avgScore}</td>
                <td className="px-4 py-3" />
              </tr>
            </tfoot>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}

// --- แท็บตัวเด่นรายวัน ---
function DailyTab({ schedule, onOpen }) {
  const byDay = useMemo(() => {
    const map = new Map();
    schedule.forEach((slot) => {
      const cur = map.get(slot.day) || { day: slot.day, items: [], slots: 0 };
      cur.items.push(...slot.items);
      cur.slots += 1;
      map.set(slot.day, cur);
    });
    return [...map.values()]
      .map((d) => {
        const uniq = [...new Map(d.items.map((p) => [p.id, p])).values()];
        return {
          ...d,
          top: uniq.sort((a, b) => b.analysis.score - a.analysis.score).slice(0, 5),
          shouldRun: uniq.filter((p) => ['A', 'B'].includes(p.analysis.grade)).length,
          total: uniq.length,
        };
      })
      .sort((a, b) => (a.day < b.day ? -1 : 1));
  }, [schedule]);

  if (!byDay.length) {
    return <SectionCard><EmptyState icon={Clock} title="ยังไม่มีข้อมูลรอบดีลรายวัน" hint="ต้องมีคอลัมน์เวลาเริ่มรอบในไฟล์นำเข้า" /></SectionCard>;
  }

  return (
    <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
      {byDay.map((d) => (
        <SectionCard key={d.day} title={d.day} icon={Trophy}>
          <div className="p-4">
            <div className="text-xs text-slate-500 mb-3">
              {d.slots} ช่วงเวลา · ควรยิง {d.shouldRun} จาก {d.total} ตัว
            </div>
            <ol className="space-y-2">
              {d.top.map((p, i) => (
                <li key={p.id}>
                  <button onClick={() => onOpen(p)} className="w-full text-left flex items-start gap-2 hover:bg-slate-50 rounded-lg p-1.5">
                    <span className="text-xs text-slate-400 w-4 pt-0.5 tabular-nums">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-slate-700 line-clamp-1">{p.name}</span>
                      <span className="block text-[11px] text-slate-400">
                        {formatCurrency0(p.price)} · ลด {p.analysis.metrics.discountPct.toFixed(0)}% · คะแนน {p.analysis.score}
                      </span>
                    </span>
                    <span className={cn('px-1.5 py-0.5 rounded text-[11px] font-bold h-fit', GRADE_STYLE[p.analysis.grade].pill)}>
                      {p.analysis.grade}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
        </SectionCard>
      ))}
    </div>
  );
}

// --- แท็บข้อควรรู้ ---
function TipsTab({ aiResult }) {
  const tips = [
    ['ราคาต่ำกว่า ฿300 ระวังขาดทุน', 'คอม 5% ของ ฿200 คือ ฿10 ถ้าค่าคลิก ฿1.5 ต้องปิดการขายได้ 1 ใน 7 คลิก ซึ่งยากมากในทางปฏิบัติ'],
    ['รอบเที่ยงคืนคือรอบทอง', 'คนรอกดของถูกตอนเที่ยงคืน ออเดอร์กระจุกในชั่วโมงแรก ตั้งตารางแอดให้ดันงบช่วง 23:30–01:00'],
    ['ขึ้นหลายรอบ = คลิปเดียวใช้ได้ยาว', 'ต้นทุนทำคอนเทนต์ต่อออเดอร์ถูกลงมาก เลือกตัวที่ขึ้น 3–4 รอบก่อนเสมอ'],
    ['เสื้อผ้า/รองเท้า ยกเลิกสูง', 'ไซซ์ไม่ตรง สีไม่ตรงจอ ทำให้ยอดที่ยิงได้จริงหายไปเยอะ ให้น้ำหนักน้อยกว่าของใช้ในบ้าน'],
    ['เรตติ้งต่ำกว่า 4.0 ให้ข้าม', 'ต่อให้ลดแรงแค่ไหน รีวิวแย่จะทำให้คนกดเข้าไปแล้วไม่ซื้อ เสียค่าคลิกฟรี'],
    ['ทดสอบงบเล็กก่อนเสมอ', 'เกรด B เริ่มที่ ฿150/วัน 2 วัน ถ้าต้นทุนต่อออเดอร์ต่ำกว่าคอมที่ได้ ค่อยเพิ่มงบ'],
  ];
  return (
    <div className="space-y-4">
      {aiResult && (
        <SectionCard title="สรุปจาก AI" icon={Sparkles}>
          <div className="p-5 space-y-3">
            <p className="text-sm text-slate-700 leading-relaxed">{aiResult.summary}</p>
            {!!aiResult.warnings?.length && (
              <ul className="text-sm text-amber-700 bg-amber-50 rounded-xl p-4 space-y-1.5 list-disc list-inside">
                {aiResult.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            )}
            <p className="text-[11px] text-slate-400">โมเดล {aiResult.model} · {new Date(aiResult.at).toLocaleString('th-TH')}</p>
          </div>
        </SectionCard>
      )}
      <SectionCard title="ข้อควรรู้ก่อนยิงแอด" icon={Info}>
        <div className="p-5 grid sm:grid-cols-2 gap-4">
          {tips.map(([title, body]) => (
            <div key={title} className="rounded-xl border border-slate-200 p-4">
              <div className="font-semibold text-slate-800 text-sm">{title}</div>
              <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}

// --- โมดัลรายละเอียดสินค้า ---
function ProductModal({ product, analysis, onClose, cpc, scoring }) {
  if (!product) return null;
  const a = product.analysis;
  const { good, bad } = reasonsFor(product, scoring);
  const cvr = breakEvenCvr(product, cpc, scoring);

  return (
    <Modal open wide onClose={onClose} title="รายละเอียดการวิเคราะห์">
      <div className="space-y-5">
        <div>
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h4 className="font-bold text-slate-800">{product.name}</h4>
              <p className="text-xs text-slate-500 mt-1">
                {product.shopName || 'ไม่ระบุร้าน'} · {categoryLabel(product.category)}
                {product.categoryRaw ? ` (${product.categoryRaw})` : ''}
              </p>
            </div>
            <div className="text-center shrink-0">
              <div className="text-3xl font-extrabold text-slate-800 tabular-nums">{a.score}</div>
              <span className={cn('px-2 py-0.5 rounded-md text-xs font-bold', GRADE_STYLE[a.grade].pill)}>
                เกรด {a.grade} · {GRADE_META[a.grade].label}
              </span>
            </div>
          </div>
          {product.url && (
            <a href={product.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline mt-2">
              เปิดหน้าสินค้าบน Shopee <ExternalLink size={12} />
            </a>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label="ราคาดีล" value={formatCurrency0(product.price)} sub={product.originalPrice > product.price ? `เต็ม ${formatCurrency0(product.originalPrice)}` : null} />
          <Stat label="ส่วนลด" value={`${a.metrics.discountPct.toFixed(0)}%`} />
          <Stat label="คอมต่อชิ้น" value={formatCurrency0(a.metrics.commissionPerUnit)} sub={product.commissionRate ? `เรต ${product.commissionRate}%` : `ประเมินที่ ${scoring.assumedCommissionRate}%`} />
          <Stat label="รอบดีล" value={`${a.metrics.roundCount} รอบ`} sub={a.metrics.hasMidnightRound ? 'มีรอบเที่ยงคืน' : null} />
        </div>

        <div>
          <h5 className="font-semibold text-slate-700 text-sm mb-2">คะแนนแยกตามปัจจัย</h5>
          <div className="space-y-2">
            {a.breakdown.map((f) => (
              <div key={f.key}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-600">{f.label}</span>
                  <span className="tabular-nums text-slate-500">{f.points} / {f.weight}</span>
                </div>
                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-orange-400 to-orange-500 rounded-full" style={{ width: `${Math.round(f.ratio * 100)}%` }} />
                </div>
              </div>
            ))}
            {!!a.penalties.length && (
              <div className="text-xs text-red-600 pt-1 space-y-0.5">
                {a.penalties.map((p, i) => <div key={i}>หัก {Math.abs(p.points)} คะแนน — {p.reason}</div>)}
              </div>
            )}
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <ListBox title="จุดแข็ง" tone="emerald" items={good} empty="ยังไม่มีจุดแข็งที่ชัดเจน" />
          <ListBox title="ความเสี่ยง" tone="amber" items={bad} empty="ไม่พบสัญญาณเสี่ยง" />
        </div>

        {analysis && (
          <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Sparkles size={15} className="text-indigo-500" />
              <span className="font-semibold text-slate-800 text-sm">
                คำแนะนำการยิงแอด {analysis.source === 'ai' ? '(จาก AI)' : '(วิเคราะห์ในเครื่อง)'}
              </span>
            </div>
            <p className="text-sm text-slate-700">{analysis.verdict}</p>
            {!!analysis.angles?.length && (
              <div>
                <div className="text-xs font-semibold text-slate-500 mb-1">มุมโฆษณาที่ควรลอง</div>
                <ul className="text-sm text-slate-700 list-disc list-inside space-y-0.5">
                  {analysis.angles.map((x, i) => <li key={i}>{x}</li>)}
                </ul>
              </div>
            )}
            {!!analysis.hooks?.length && (
              <div>
                <div className="text-xs font-semibold text-slate-500 mb-1">ประโยคเปิดคลิป</div>
                <ul className="text-sm text-slate-700 space-y-0.5">
                  {analysis.hooks.map((x, i) => <li key={i}>“{x}”</li>)}
                </ul>
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1">
              <Stat label="งบทดสอบ/วัน" value={analysis.dailyBudget ? formatCurrency0(analysis.dailyBudget) : '—'} />
              <Stat label={`จุดคุ้มทุน (CPC ฿${cpc})`} value={cvr == null ? '—' : `${cvr.toFixed(1)}%`} sub="อัตราปิดการขายต่อคลิก" />
              <Stat label="กลุ่มเป้าหมาย" value={analysis.audience} small />
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

const Stat = ({ label, value, sub, small }) => (
  <div className="bg-white rounded-xl border border-slate-200 p-3">
    <div className="text-[11px] text-slate-400">{label}</div>
    <div className={cn('font-bold text-slate-800 mt-0.5', small ? 'text-xs leading-snug' : 'text-base tabular-nums')}>{value}</div>
    {sub && <div className="text-[11px] text-slate-400 mt-0.5">{sub}</div>}
  </div>
);

const ListBox = ({ title, tone, items, empty }) => {
  const tones = { emerald: 'border-emerald-100 bg-emerald-50/60', amber: 'border-amber-100 bg-amber-50/60' };
  return (
    <div className={cn('rounded-xl border p-4', tones[tone])}>
      <div className="text-sm font-semibold text-slate-700 mb-2">{title}</div>
      {items.length ? (
        <ul className="text-sm text-slate-600 space-y-1 list-disc list-inside">
          {items.map((x, i) => <li key={i}>{x}</li>)}
        </ul>
      ) : (
        <p className="text-sm text-slate-400">{empty}</p>
      )}
    </div>
  );
};

// --- โมดัลตั้งค่า AI ---
function AiSettingsModal({ open, cfg, onClose, onSave }) {
  const [draft, setDraft] = useState(cfg);
  useEffect(() => { if (open) setDraft(cfg); }, [open, cfg]);
  if (!open) return null;
  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));

  return (
    <Modal
      open
      onClose={onClose}
      title="ตั้งค่า AI วิเคราะห์"
      footer={<>
        <Button variant="secondary" onClick={onClose}>ยกเลิก</Button>
        <Button onClick={() => onSave(draft)}>บันทึก</Button>
      </>}
    >
      <div className="space-y-4">
        <Banner tone="info">
          ไม่ใส่คีย์ก็ใช้งานได้ — ระบบวิเคราะห์ด้วยกฎในเครื่องให้อยู่แล้ว ใส่คีย์เมื่ออยากให้ AI ช่วยเขียนมุมโฆษณาและแคปชั่นเพิ่ม
        </Banner>
        <Field label="API key" hint="เก็บใน localStorage ของเครื่องนี้เท่านั้น ไม่ถูกส่งขึ้นฐานข้อมูลกลาง">
          <Input type="password" value={draft.apiKey} onChange={(e) => set('apiKey', e.target.value)} placeholder="sk-..." />
        </Field>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Base URL" hint="ใช้ได้กับบริการที่รองรับรูปแบบ OpenAI">
            <Input value={draft.baseUrl} onChange={(e) => set('baseUrl', e.target.value)} />
          </Field>
          <Field label="โมเดล">
            <Input value={draft.model} onChange={(e) => set('model', e.target.value)} />
          </Field>
          <Field label="ค่าคลิกเฉลี่ย ฿ (CPC)" hint="ใช้คำนวณจุดคุ้มทุน">
            <Input type="number" step="0.1" value={draft.cpc} onChange={(e) => set('cpc', Number(e.target.value) || 0)} />
          </Field>
          <Field label="วิเคราะห์ครั้งละกี่ตัว" hint="ยิ่งเยอะยิ่งเปลืองโทเคน">
            <Input type="number" value={draft.maxProducts} onChange={(e) => set('maxProducts', Number(e.target.value) || 1)} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
