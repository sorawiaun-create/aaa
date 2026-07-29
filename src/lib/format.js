// --- Formatting & parsing helpers (framework-agnostic, unit-testable) ---

export const formatCurrency = (amount) =>
  new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0);

// Compact baht for KPI tiles so 7-figure amounts fit (฿1.02M, ฿512K, ฿98.4K).
export const formatBahtCompact = (amount) => {
  const n = Number(amount) || 0;
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}฿${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 100_000) return `${sign}฿${Math.round(abs / 1000)}K`;
  if (abs >= 10_000) return `${sign}฿${(abs / 1000).toFixed(1)}K`;
  return formatCurrency0(n);
};

// Whole-baht currency (no decimals) for compact KPI tiles.
export const formatCurrency0 = (amount) =>
  new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
    maximumFractionDigits: 0,
  }).format(Number.isFinite(amount) ? amount : 0);

export const formatNumber = (n, digits = 0) =>
  new Intl.NumberFormat('th-TH', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number.isFinite(n) ? n : 0);

export const formatPercent = (v, digits = 1) =>
  `${(Number.isFinite(v) ? v : 0).toFixed(digits)}%`;

// Compact currency for chart axis ticks (e.g. ฿12.5k, ฿1.2M)
export const compactCurrency = (v) => {
  const n = Number(v) || 0;
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return `${n}`;
};

// Parse a messy money string ("฿1,234.50", "1.234,50", "(120.00)") into a number.
export const parseMoney = (value) => {
  if (typeof value === 'number') return value;
  if (value == null) return 0;
  let s = String(value).trim();
  if (!s) return 0;
  const negative = /^\(.*\)$/.test(s) || s.includes('-');
  s = s.replace(/[฿$€£B\s]/gi, '').replace(/[()]/g, '');
  // Decide whether "." or "," is the decimal separator, then strip the other as
  // a thousands separator. A single comma with exactly 3 trailing digits (and no
  // dot) is a thousands separator ("1,600" → 1600), NOT a decimal comma.
  const dots = (s.match(/\./g) || []).length;
  const commas = (s.match(/,/g) || []).length;
  if (commas > 0 && dots > 0) {
    // Both present: the right-most one is the decimal separator.
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(/,/g, '.');
    else s = s.replace(/,/g, '');
  } else if (commas > 0) {
    // Only commas: decimal if a single comma with 1–2 trailing digits.
    const decimals = s.length - s.lastIndexOf(',') - 1;
    if (commas === 1 && decimals > 0 && decimals < 3) s = s.replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (dots > 1) {
    // Multiple dots are thousands separators ("1.234.567").
    s = s.replace(/\./g, '');
  }
  s = s.replace(/[^0-9.]/g, '');
  const num = parseFloat(s);
  if (!Number.isFinite(num)) return 0;
  return negative ? -Math.abs(num) : num;
};

const MONTH_MAP = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  january: '01', february: '02', march: '03', april: '04', june: '06',
  july: '07', august: '08', september: '09', october: '10',
  november: '11', december: '12',
};

// Normalize many date shapes to "DD/MM/YYYY". Returns '' if it can't.
export const normalizeDate = (input) => {
  if (input == null || input === '') return '';

  // Excel serial date number
  if (typeof input === 'number' && input > 20000 && input < 90000) {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const d = new Date(epoch.getTime() + input * 86400000);
    return `${String(d.getUTCDate()).padStart(2, '0')}/${String(
      d.getUTCMonth() + 1
    ).padStart(2, '0')}/${d.getUTCFullYear()}`;
  }

  const str = String(input).trim();

  // ISO: 2024-01-15 or 2024/01/15 (optionally with time)
  const iso = str.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) {
    const [, y, m, d] = iso;
    return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;
  }

  // "Dec 12, 2025" / "12, December, 2025"
  const named1 = str.match(/([A-Za-z]{3,})\s+(\d{1,2}),?\s+(\d{4})/);
  if (named1) {
    const [, mo, d, y] = named1;
    const mm = MONTH_MAP[mo.toLowerCase()];
    if (mm) return `${d.padStart(2, '0')}/${mm}/${y}`;
  }
  const named2 = str.match(/(\d{1,2}),?\s+([A-Za-z]{3,}),?\s+(\d{4})/);
  if (named2) {
    const [, d, mo, y] = named2;
    const mm = MONTH_MAP[mo.toLowerCase()];
    if (mm) return `${d.padStart(2, '0')}/${mm}/${y}`;
  }

  // DD/MM/YYYY or D/M/YYYY (assume day-first, common in TH exports)
  const dmy = str.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;
  }

  return '';
};

// "DD/MM/YYYY" -> "YYYY-MM" (sortable month key). '' if invalid.
export const monthKeyOf = (dmy) => {
  if (!dmy) return '';
  const parts = dmy.split('/');
  if (parts.length !== 3) return '';
  return `${parts[2]}-${parts[1]}`;
};

// "YYYY-MM" -> "MM/YYYY" for display
export const monthLabel = (key) => {
  if (!key) return 'ไม่ระบุ';
  const [y, m] = key.split('-');
  return `${m}/${y}`;
};
