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

// Normalize a cell to a "YYYY-MM" month key (handles YYYY-MM, MM/YYYY, full dates).
export function toMonthKey(v) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  const ym = s.match(/^(\d{4})[-/.](\d{1,2})$/);
  if (ym) return `${ym[1]}-${ym[2].padStart(2, '0')}`;
  const my = s.match(/^(\d{1,2})[-/.](\d{4})$/);
  if (my) return `${my[2]}-${my[1].padStart(2, '0')}`;
  return monthKeyOf(normalizeDate(s)) || '';
}

// Map raw sheet rows (objects keyed by header) → expense records tagged gsheet.
export function mapExpenseRows(rows, mapping) {
  const out = [];
  rows.forEach((row, i) => {
    const get = (f) => (mapping[f] ? row[mapping[f]] : '');
    const amount = parseMoney(get('amount'));
    const category = String(get('category') ?? '').trim();
    if (!amount && !category) return; // skip blank/total rows
    if (!amount) return;
    out.push({
      id: `gsheet:${i}`,
      source: 'gsheet',
      month: toMonthKey(get('month')),
      category: category || 'ไม่ระบุหมวด',
      amount,
      note: String(get('note') ?? '').trim(),
    });
  });
  return out;
}
