import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  Banknote, Plus, Trash2, TrendingUp, TrendingDown, Wallet, Coins, Info,
  Sheet, RefreshCw, CheckCircle, XCircle,
} from 'lucide-react';
import { SectionCard, Button, EmptyState, Banner, KpiCard, Badge } from '../components/ui.jsx';
import { formatCurrency, formatNumber, parseMoney, monthLabel } from '../lib/format.js';
import { buildSheetCsvUrl, detectExpenseMapping, mapExpenseRows, csvToRows } from '../lib/sheetSync.js';

const SHEET_SOURCES_KEY = 'ptr_gsheet_sources';
const SHEET_URL_KEY = 'ptr_gsheet_url'; // legacy single-url (migrated)
const SHEET_AUTO_KEY = 'ptr_gsheet_auto';
const SHEET_MAP_KEY = 'ptr_gsheet_mapping'; // manual column overrides
const AUTO_INTERVAL_MS = 3 * 60 * 1000; // poll every 3 minutes when auto-sync is on

// Fields the user can map, in display order.
const MAP_FIELDS = [
  { key: 'month', label: 'วันที่/เดือน' },
  { key: 'category', label: 'หมวด/รายการ' },
  { key: 'amount', label: 'จำนวนเงิน' },
  { key: 'note', label: 'หมายเหตุ' },
];

const loadManualMap = () => {
  try {
    const raw = localStorage.getItem(SHEET_MAP_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {};
};

// Combine auto-detected mapping with the user's manual overrides. A manual
// override only applies if that header actually exists in this tab's headers.
const resolveMapping = (headers, manual) => {
  const mapping = detectExpenseMapping(headers);
  for (const f of MAP_FIELDS) {
    const chosen = manual?.[f.key];
    if (chosen && headers.includes(chosen)) mapping[f.key] = chosen;
    else if (chosen === '') delete mapping[f.key]; // explicit "ไม่ใช้"
  }
  return mapping;
};

const uid = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID().slice(0, 8)
    : `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const loadSources = () => {
  try {
    const raw = localStorage.getItem(SHEET_SOURCES_KEY);
    if (raw) return JSON.parse(raw);
    const legacy = localStorage.getItem(SHEET_URL_KEY);
    if (legacy) return [{ id: uid(), url: legacy, label: '' }];
  } catch { /* ignore */ }
  return [];
};

const COMMON_CATEGORIES = [
  'เงินเดือนพนักงาน', 'ค่าเช่า', 'ค่าน้ำ/ค่าไฟ', 'ค่าการตลาด/โฆษณา',
  'ค่าบรรจุภัณฑ์', 'ค่าขนส่ง', 'ค่าอุปกรณ์/เครื่องมือ', 'ภาษี/ค่าธรรมเนียม', 'อื่นๆ',
];

const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export default function ExpensesView({ store, recon }) {
  const { expenses, addExpense, updateExpense, removeExpense, syncSheetExpenses } = store;
  const [draft, setDraft] = useState({ month: thisMonth(), category: '', amount: '', note: '' });

  // --- Google Sheet sync (multiple tabs/links) ---
  const [sources, setSources] = useState(loadSources);
  const [auto, setAuto] = useState(() => localStorage.getItem(SHEET_AUTO_KEY) === '1');
  const [sync, setSync] = useState({ busy: false, lastAt: null, count: 0, errors: [] });
  const [manualMap, setManualMap] = useState(loadManualMap);
  const [sheetHeaders, setSheetHeaders] = useState([]); // union of headers seen in last sync
  const syncSheetRef = useRef(syncSheetExpenses);
  syncSheetRef.current = syncSheetExpenses;
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;
  const manualMapRef = useRef(manualMap);
  manualMapRef.current = manualMap;

  useEffect(() => {
    try { localStorage.setItem(SHEET_SOURCES_KEY, JSON.stringify(sources)); } catch { /* ignore */ }
  }, [sources]);

  useEffect(() => {
    try { localStorage.setItem(SHEET_MAP_KEY, JSON.stringify(manualMap)); } catch { /* ignore */ }
  }, [manualMap]);

  const addSource = () => setSources((s) => [...s, { id: uid(), url: '', label: '' }]);
  const updateSource = (id, patch) => setSources((s) => s.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const removeSource = (id) => setSources((s) => s.filter((x) => x.id !== id));

  const friendly = (err) =>
    /Failed to fetch|NetworkError|CORS/i.test(String(err))
      ? 'ดึงไม่ได้ (ยังไม่เผยแพร่/ปิดสาธารณะ)'
      : err.message;

  const doSyncAll = useCallback(async () => {
    const active = (sourcesRef.current || []).filter((s) => s.url.trim());
    if (!active.length) return;
    setSync((s) => ({ ...s, busy: true }));
    const combined = [];
    const errors = [];
    const headerSet = new Set();
    for (const src of active) {
      try {
        const res = await fetch(buildSheetCsvUrl(src.url.trim()), { redirect: 'follow' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        if (/<html/i.test(text.slice(0, 200))) throw new Error('ยังไม่เปิดสาธารณะ');
        const rows = csvToRows(text);
        const headers = rows.length ? Object.keys(rows[0]) : [];
        headers.forEach((h) => headerSet.add(h));
        const mapping = resolveMapping(headers, manualMapRef.current);
        if (!mapping.amount) throw new Error('ไม่พบคอลัมน์จำนวนเงิน (เลือกเองได้ด้านล่าง)');
        const mapped = mapExpenseRows(rows, mapping).map((e, idx) => ({ ...e, id: `gsheet:${src.id}:${idx}` }));
        combined.push(...mapped);
      } catch (err) {
        errors.push(`${src.label || src.url.slice(0, 28) || 'แท็บ'}: ${friendly(err)}`);
      }
    }
    if (headerSet.size) setSheetHeaders([...headerSet]);
    syncSheetRef.current(combined);
    setSync({ busy: false, lastAt: new Date(), count: combined.length, errors });
  }, []);

  const setFieldMap = (field, header) =>
    setManualMap((m) => ({ ...m, [field]: header }));

  const toggleAuto = () => {
    const next = !auto;
    setAuto(next);
    localStorage.setItem(SHEET_AUTO_KEY, next ? '1' : '0');
    if (next) doSyncAll();
  };

  // Auto-sync: on mount (if enabled) and on an interval.
  useEffect(() => {
    if (!auto) return;
    doSyncAll();
    const id = setInterval(() => doSyncAll(), AUTO_INTERVAL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto]);

  const add = () => {
    if (!draft.month || !draft.category.trim() || !parseMoney(draft.amount)) return;
    addExpense({
      month: draft.month,
      category: draft.category.trim(),
      amount: parseMoney(draft.amount),
      note: draft.note.trim(),
    });
    setDraft({ month: draft.month, category: '', amount: '', note: '' });
  };

  // Group expenses by month (desc), with subtotals.
  const grouped = useMemo(() => {
    const map = {};
    expenses.forEach((e) => {
      const mk = e.month || 'ไม่ระบุ';
      if (!map[mk]) map[mk] = { month: mk, items: [], total: 0 };
      map[mk].items.push(e);
      map[mk].total += Number(e.amount) || 0;
    });
    return Object.values(map).sort((a, b) => (a.month < b.month ? 1 : -1));
  }, [expenses]);

  const companyProfitable = recon.companyNetProfit >= 0;

  return (
    <div className="space-y-6">
      <Banner tone="info">
        <Info size={16} className="mt-0.5 shrink-0" />
        <span>
          กรอกรายจ่ายทั่วไปของบริษัท (เงินเดือน, ค่าเช่า, ค่าน้ำไฟ ฯลฯ) แยกตามเดือน —
          ระบบจะนำไปหักจากกำไรการขาย เพื่อบอกว่า <b>เดือนนั้นบริษัทกำไรหรือขาดทุนจริง</b>
        </span>
      </Banner>

      {/* Company P&L summary (respects the top filter's month range) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard title="กำไรจากการขาย (สุทธิ)" value={formatCurrency(recon.netProfit)} subtext="หลังหักต้นทุน + ค่าธรรมเนียม" icon={Coins} accent="blue" />
        <KpiCard title="รายจ่ายทั่วไปรวม" value={formatCurrency(recon.opexTotal)} subtext={`${formatNumber(expenses.length)} รายการ`} icon={Wallet} accent="orange" />
        <KpiCard
          title="กำไร/ขาดทุนบริษัท"
          value={formatCurrency(recon.companyNetProfit)}
          subtext={companyProfitable ? 'กำไรสุทธิบริษัท' : 'ขาดทุน'}
          icon={companyProfitable ? TrendingUp : TrendingDown}
          accent={companyProfitable ? 'green' : 'red'}
        />
      </div>

      {/* Google Sheet sync (multiple tabs) */}
      <SectionCard
        title="เชื่อม Google Sheet (หลายแท็บ/เดือน)"
        icon={Sheet}
        action={
          <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
            <input type="checkbox" checked={auto} onChange={toggleAuto} />
            ซิงก์อัตโนมัติ (ทุก 3 นาที)
          </label>
        }
      >
        <div className="p-5 space-y-3">
          <p className="text-sm text-slate-500">
            ชีทมีหลายแท็บ (แต่ละเดือน) — เพิ่มลิงก์ของ <b>แต่ละแท็บที่ต้องการดึง</b> (1 บรรทัด = 1 แท็บ)
            เปิดแท็บนั้นในชีท แล้วคัดลอก URL (ลิงก์จะมี <code>gid</code> ของแท็บนั้น)
          </p>

          {sources.length === 0 && (
            <p className="text-sm text-slate-400 border-2 border-dashed border-slate-200 rounded-xl p-4 text-center">ยังไม่มีลิงก์ — กด “เพิ่มแท็บ” เพื่อเริ่ม</p>
          )}
          {sources.map((src) => (
            <div key={src.id} className="flex flex-col sm:flex-row gap-2 items-stretch">
              <input
                value={src.label}
                onChange={(e) => updateSource(src.id, { label: e.target.value })}
                placeholder="ชื่อ (เช่น ก.ค.)"
                className="sm:w-32 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-200 focus:outline-none"
              />
              <input
                value={src.url}
                onChange={(e) => updateSource(src.id, { url: e.target.value })}
                placeholder="วางลิงก์แท็บ Google Sheet"
                className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-200 focus:outline-none"
              />
              <button onClick={() => removeSource(src.id)} className="text-slate-400 hover:text-red-500 px-3 rounded-lg hover:bg-red-50" title="ลบลิงก์นี้">
                <Trash2 size={16} />
              </button>
            </div>
          ))}

          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon={Plus} onClick={addSource}>เพิ่มแท็บ</Button>
            <Button icon={RefreshCw} onClick={doSyncAll} disabled={sync.busy || !sources.some((s) => s.url.trim())}>
              {sync.busy ? 'กำลังซิงก์…' : 'ซิงก์ทั้งหมด'}
            </Button>
          </div>

          {sync.errors?.length > 0 && (
            <Banner tone="error">
              <XCircle size={16} className="mt-0.5 shrink-0" />
              <span className="whitespace-pre-line">ดึงบางแท็บไม่ได้:{'\n'}{sync.errors.join('\n')}</span>
            </Banner>
          )}
          {sync.lastAt && (sync.errors?.length ?? 0) === 0 && (
            <Banner tone="success">
              <CheckCircle size={16} className="mt-0.5 shrink-0" />
              ซิงก์แล้ว {formatNumber(sync.count)} รายการ · ล่าสุด {sync.lastAt.toLocaleTimeString('th-TH')}
            </Banner>
          )}

          {/* Manual column mapping — appears after the first sync reads the headers.
              Use it if the app picked the wrong column (e.g. amount vs. a ratio). */}
          {sheetHeaders.length > 0 && (
            <div className="border border-slate-200 rounded-xl p-4 space-y-3 bg-slate-50/60">
              <p className="text-sm text-slate-600">
                <b>จับคู่คอลัมน์เอง</b> — ถ้าระบบเลือกคอลัมน์ผิด (เช่น จำนวนเงินไปดึงคอลัมน์อื่น)
                เลือกให้ถูกแล้วกด “ซิงก์ทั้งหมด” อีกครั้ง
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {MAP_FIELDS.map((f) => (
                  <label key={f.key} className="flex flex-col gap-1 text-xs text-slate-500">
                    {f.label}
                    <select
                      value={manualMap[f.key] ?? '__auto__'}
                      onChange={(e) =>
                        setFieldMap(f.key, e.target.value === '__auto__' ? undefined : e.target.value)
                      }
                      className="border border-slate-200 rounded-lg px-2 py-2 text-sm bg-white focus:ring-2 focus:ring-blue-200 focus:outline-none"
                    >
                      <option value="__auto__">อัตโนมัติ</option>
                      {f.key !== 'amount' && f.key !== 'category' && <option value="">— ไม่ใช้ —</option>}
                      {sheetHeaders.map((h) => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="text-xs text-slate-500 bg-slate-50 rounded-xl p-3 space-y-1">
            <p className="font-semibold text-slate-600">เปิดชีทให้ดึงได้ (ทำครั้งเดียว):</p>
            <p>ในชีท → <b>ไฟล์</b> → <b>แชร์</b> → <b>เผยแพร่ไปยังเว็บ</b> → เลือก <b>ทั้งเอกสาร</b> (หรือแต่ละแท็บ) รูปแบบ <b>CSV</b> → เผยแพร่</p>
            <p>หัวตารางควรมี: <b>วันที่/เดือน</b> · <b>หมวด/รายการ</b> · <b>จำนวนเงิน</b> (+ <b>หมายเหตุ</b> ถ้ามี) — แถว “รวม/total” จะถูกข้ามให้อัตโนมัติ</p>
          </div>
        </div>
      </SectionCard>

      {/* Add form */}
      <SectionCard title="เพิ่มรายจ่าย" icon={Plus}>
        <div className="p-5 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <input type="month" value={draft.month} onChange={(e) => setDraft({ ...draft, month: e.target.value })} className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-200 focus:outline-none" />
            <input value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} placeholder="หมวดรายจ่าย *" className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-200 focus:outline-none" />
            <input value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} placeholder="จำนวนเงิน *" inputMode="decimal" className="border border-slate-200 rounded-lg px-3 py-2 text-sm text-right focus:ring-2 focus:ring-blue-200 focus:outline-none" />
            <input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder="หมายเหตุ" className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-200 focus:outline-none" />
            <Button icon={Plus} onClick={add} disabled={!draft.month || !draft.category.trim() || !parseMoney(draft.amount)}>เพิ่ม</Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {COMMON_CATEGORIES.map((c) => (
              <button key={c} onClick={() => setDraft({ ...draft, category: c })} className="px-2.5 py-1 rounded-full text-xs border border-slate-200 text-slate-600 hover:bg-slate-50">
                + {c}
              </button>
            ))}
          </div>
        </div>
      </SectionCard>

      {/* List grouped by month */}
      <SectionCard title={`รายการรายจ่าย (${formatNumber(expenses.length)})`} icon={Banknote}>
        {expenses.length === 0 ? (
          <EmptyState icon={Banknote} title="ยังไม่มีรายจ่าย" hint="เพิ่มรายจ่ายทั่วไปด้านบน เช่น เงินเดือน ค่าเช่า" />
        ) : (
          <div className="p-3 space-y-4">
            {grouped.map((g) => (
              <div key={g.month} className="border border-slate-100 rounded-xl overflow-hidden">
                <div className="flex justify-between items-center bg-slate-50 px-4 py-2.5">
                  <span className="font-semibold text-slate-700">{monthLabel(g.month)}</span>
                  <span className="text-sm text-slate-500">รวม <b className="text-slate-800">{formatCurrency(g.total)}</b></span>
                </div>
                <table className="w-full text-sm text-left">
                  <tbody className="divide-y divide-slate-100">
                    {g.items.map((e) => {
                      const fromSheet = e.source === 'gsheet';
                      return (
                      <tr key={e.id} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap w-28">{e.date || monthLabel(e.month)}</td>
                        <td className="px-4 py-2.5">
                          <span className="flex items-center gap-1.5">
                            <Badge color="slate">{e.category}</Badge>
                            {fromSheet && <Badge color="blue">Sheet</Badge>}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-slate-500">{e.note || '-'}</td>
                        <td className="px-4 py-2.5 text-right w-40">
                          {fromSheet ? (
                            <span className="pr-2 font-medium text-slate-700">{formatCurrency(e.amount)}</span>
                          ) : (
                            <input
                              type="number"
                              value={e.amount || ''}
                              onChange={(ev) => updateExpense(e.id, { amount: parseMoney(ev.target.value) })}
                              className="w-32 text-right px-2 py-1 rounded-lg border border-slate-200 focus:ring-2 focus:ring-blue-200 focus:outline-none"
                            />
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right w-12">
                          <button onClick={() => removeExpense(e.id)} className="text-slate-400 hover:text-red-500 p-1.5 rounded-lg hover:bg-red-50" title="ลบ">
                            <Trash2 size={15} />
                          </button>
                        </td>
                      </tr>
                    );})}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
