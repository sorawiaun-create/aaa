import { parseMoney, normalizeDate, monthKeyOf } from './format.js';

// --- Google Sheets → expenses sync (client-side, no backend) ---
// The app runs entirely in the browser, so it can only read a sheet that is
// public. Best: File → Share → Publish to web → (the tab) → CSV, then paste
// that URL. A normal "anyone with the link" URL is converted to the gviz CSV
// endpoint as a fallback (subject to the sheet's CORS/sharing).

export function buildSheetCsvUrl(input) {
  const s = String(input || '').trim();
  if (!s) return '';
  // Already a CSV endpoint (published-to-web, export, or gviz)
  if (/output=csv|tqx=out:csv|format=csv/.test(s)) return s;
  // Published-to-web page URL without an explicit output
  if (s.includes('/pub')) return s + (s.includes('?') ? '&' : '?') + 'output=csv';
  // Standard sheet URL → gviz CSV for the given tab (gid)
  const idM = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (idM) {
    const gidM = s.match(/[#&?]gid=(\d+)/);
    const gid = gidM ? gidM[1] : '0';
    return `https://docs.google.com/spreadsheets/d/${idM[1]}/gviz/tq?tqx=out:csv&gid=${gid}`;
  }
  return s;
}

// Parse CSV text into rows of string fields (handles quotes, commas, newlines).
// We parse ourselves rather than via SheetJS so dates like "05/06/2026" are
// NOT coerced to US-format serial numbers (which corrupts DD/MM/YYYY dates).
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// CSV text -> array of objects keyed by the header row.
export function csvToRows(text) {
  const rows = parseCsv(text).filter((r) => r.some((c) => String(c).trim() !== ''));
  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => String(h).trim());
  return rows.slice(1).map((r) => {
    const o = {};
    headers.forEach((h, i) => { o[h] = r[i] ?? ''; });
    return o;
  });
}

const norm = (s) => String(s ?? '').trim().toLowerCase();

const CAND = {
  month: ['เดือน', 'งวด', 'วันเดือนปี', 'วันที่', 'date', 'month', 'period'],
  category: ['หมวดหมู่', 'หมวด', 'ประเภท', 'ชื่อรายการ', 'รายการ', 'รายละเอียดรายจ่าย', 'category', 'item', 'type'],
  amount: ['จำนวนเงิน', 'เป็นเงิน', 'ยอดเงิน', 'จำนวน', 'ยอด', 'บาท', 'ราคา', 'amount', 'total', 'price', 'cost'],
  note: ['หมายเหตุ', 'รายละเอียด', 'โน้ต', 'note', 'remark', 'description', 'detail'],
};

// header -> field mapping (longest candidate match wins; each header used once)
export function detectExpenseMapping(headers) {
  const mapping = {};
  const used = new Set();
  for (const field of Object.keys(CAND)) {
    let best = null;
    let score = 0;
    for (const h of headers) {
      if (used.has(h)) continue;
      const hn = norm(h);
      for (const c of CAND[field]) {
        if (hn === c && c.length + 100 > score) { score = c.length + 100; best = h; }
        else if (hn.includes(c) && c.length > score) { score = c.length; best = h; }
      }
    }
    if (best) { mapping[field] = best; used.add(best); }
  }
  return mapping;
}

// Normalize a year to a Gregorian 4-digit year, tolerating Thai Buddhist years
// and 2-digit years. Thai sellers commonly write พ.ศ. (BE): "69" = 2569 = 2026,
// "2568" = 2025. So: 2-digit → treat as BE short year; any year > 2400 → −543.
export function normYear(y) {
  let n = parseInt(y, 10);
  if (!Number.isFinite(n)) return NaN;
  if (n < 100) n += 2500;   // 2-digit → Buddhist short year (69 → 2569)
  if (n > 2400) n -= 543;   // Buddhist → Gregorian (2569 → 2026)
  return n;
}

// Parse a messy date cell → { date: "DD/MM/YYYY" (Gregorian), month: "YYYY-MM" }.
// Handles month-only (YYYY-MM, MM/YYYY), ISO, and day-first TH dates whose year
// may be Buddhist and/or 2-digit ("1/7/69" → 2026-07).
export function parseFlexDate(v) {
  if (v == null || v === '') return { date: '', month: '' };
  if (typeof v === 'number') {
    const d = normalizeDate(v); // Excel serial → DD/MM/YYYY
    return { date: d, month: monthKeyOf(d) };
  }
  const s = String(v).trim();
  if (!s) return { date: '', month: '' };

  // Month-only: YYYY-MM
  let m = s.match(/^(\d{4})[-/.](\d{1,2})$/);
  if (m) { const y = normYear(m[1]); return { date: '', month: `${y}-${m[2].padStart(2, '0')}` }; }
  // Month-only: MM/YYYY
  m = s.match(/^(\d{1,2})[-/.](\d{4})$/);
  if (m) { const y = normYear(m[2]); return { date: '', month: `${y}-${m[1].padStart(2, '0')}` }; }

  // ISO full date: YYYY-MM-DD
  m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) {
    const y = normYear(m[1]);
    const mm = m[2].padStart(2, '0');
    return { date: `${m[3].padStart(2, '0')}/${mm}/${y}`, month: `${y}-${mm}` };
  }

  // Day-first: D/M/YY or D/M/YYYY (TH exports). Year may be 2-digit/Buddhist.
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    const y = normYear(m[3]);
    const mm = m[2].padStart(2, '0');
    return { date: `${m[1].padStart(2, '0')}/${mm}/${y}`, month: `${y}-${mm}` };
  }

  // Fallback: named months etc. via normalizeDate, then normalize the year.
  const d = normalizeDate(s);
  if (d) {
    const [dd, mm, yy] = d.split('/');
    const y = normYear(yy);
    return { date: `${dd}/${mm}/${y}`, month: `${y}-${mm}` };
  }
  return { date: '', month: '' };
}

// Normalize a cell to a "YYYY-MM" month key (handles YYYY-MM, MM/YYYY, full dates).
export function toMonthKey(v) {
  return parseFlexDate(v).month;
}

// Rows that are totals/summaries in the sheet — skipped (the app sums itself).
const TOTAL_RE = /(^|[\s(])(รวม|ผลรวม|ยอดรวม|รวมทั้ง|total|sum|grand\s*total)/i;

// Map raw sheet rows (objects keyed by header) → expense records tagged gsheet.
export function mapExpenseRows(rows, mapping) {
  const out = [];
  rows.forEach((row, i) => {
    const get = (f) => (mapping[f] ? row[mapping[f]] : '');
    const amount = parseMoney(get('amount'));
    if (!amount) return;
    const rawDate = get('month');
    const category = String(get('category') ?? '').trim();
    const note = String(get('note') ?? '').trim();
    // Skip total / summary rows (already summed by the app)
    if (TOTAL_RE.test(category) || TOTAL_RE.test(String(rawDate)) || TOTAL_RE.test(note)) return;
    const { date, month } = parseFlexDate(rawDate);
    if (!month && !category) return; // bare total-style row
    out.push({
      id: `gsheet:${i}`,
      source: 'gsheet',
      date: date || String(rawDate ?? '').trim(),
      month,
      category: category || 'ไม่ระบุหมวด',
      amount,
      note,
    });
  });
  return out;
}
