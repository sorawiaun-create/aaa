// --- Formatting & parsing helpers (framework-agnostic, unit-testable) ---

export const formatCurrency = (amount) =>
  new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
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
  // Remove thousand separators, keep last dot/comma as decimal
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastComma > lastDot) {
    // comma is the decimal separator
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    s = s.replace(/,/g, '');
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
