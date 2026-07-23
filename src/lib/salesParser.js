import { parseMoney, normalizeDate, monthKeyOf } from './format.js';

// Target fields we try to map incoming spreadsheet columns onto.
export const SALES_FIELDS = [
  { key: 'orderId', label: 'เลขที่คำสั่งซื้อ (Order ID)', required: false },
  { key: 'date', label: 'วันที่ (Date)', required: false },
  { key: 'sku', label: 'SKU', required: true },
  { key: 'productName', label: 'ชื่อสินค้า (Product)', required: false },
  { key: 'qty', label: 'จำนวน (Qty)', required: true },
  { key: 'unitPrice', label: 'ราคาต่อหน่วย (Unit Price)', required: false },
  { key: 'revenue', label: 'ยอดขาย/ยอดรวมรายการ (Revenue)', required: false },
  { key: 'status', label: 'สถานะ (Status)', required: false },
  // Optional inline platform fees (present in Shopee order exports).
  { key: 'commission', label: 'ค่าคอมมิชชั่น (ในไฟล์)', required: false, group: 'fee' },
  { key: 'transaction', label: 'ค่าธรรมเนียมธุรกรรม (ในไฟล์)', required: false, group: 'fee' },
  { key: 'serviceFee', label: 'ค่าบริการ (ในไฟล์)', required: false, group: 'fee' },
];

// Candidate header names per field (lowercased, matched by "includes").
// Covers common Shopee / TikTok / Lazada English + Thai export columns.
const CANDIDATES = {
  orderId: [
    'order id', 'order no', 'order number', 'order sn', 'ordersn',
    'เลขที่คำสั่งซื้อ', 'หมายเลขคำสั่งซื้อ', 'เลขคำสั่งซื้อ', 'order',
  ],
  date: [
    'order created time', 'created time', 'order date', 'payment time',
    'paid time', 'วันที่สั่งซื้อ', 'วันที่ชำระเงิน', 'วันที่', 'date', 'time',
  ],
  sku: [
    'seller sku', 'variation sku', 'sku reference', 'product sku', 'sku id',
    'sku', 'รหัสอ้างอิง sku', 'เลขอ้างอิง sku', 'รหัสสินค้า', 'รหัส sku', 'รหัส',
  ],
  productName: [
    'product name', 'item name', 'variation name', 'product',
    'ชื่อสินค้า', 'ชื่อรายการ', 'สินค้า', 'name',
  ],
  qty: [
    'quantity', 'qty', 'จำนวนสินค้า', 'จำนวน', 'units', 'ชิ้น',
  ],
  unitPrice: [
    'unit price', 'original price', 'deal price', 'seller discounted price',
    'ราคาต่อหน่วย', 'ราคาขาย', 'ราคา', 'price',
  ],
  // Prefer per-LINE net revenue. Order-level totals (e.g. "Order Amount",
  // "จำนวนเงินทั้งหมด") are deliberately excluded — they repeat across every
  // SKU line of a multi-line order and would overcount. Fall back to
  // qty x unitPrice when no per-line column is present.
  revenue: [
    'sku subtotal after discount', 'subtotal after discount',
    'ราคาขายสุทธิ', 'ยอดขายสุทธิ', 'ยอดรวมค่าสินค้าหลังหักส่วนลด',
    'net sales', 'net amount', 'total settlement amount', 'settlement amount',
  ],
  status: [
    'order status', 'status', 'สถานะคำสั่งซื้อ', 'สถานะการสั่งซื้อ', 'สถานะ',
  ],
  commission: ['ค่าคอมมิชชั่น', 'ค่าคอมมิชชัน', 'commission fee', 'commission'],
  transaction: ['transaction fee', 'ค่าธรรมเนียมการทำธุรกรรม', 'ค่าธุรกรรมการชำระเงิน', 'ค่าธุรกรรม'],
  serviceFee: ['ค่าบริการ', 'service fee'],
};

const norm = (s) => String(s ?? '').trim().toLowerCase();

// Auto-detect a header -> field mapping. Longer candidate matches win to avoid
// e.g. "sku" stealing "seller sku". Each header maps to at most one field.
export function autoDetectMapping(headers) {
  const mapping = {};
  const usedHeaders = new Set();

  for (const field of Object.keys(CANDIDATES)) {
    let best = null;
    let bestScore = 0;
    for (const header of headers) {
      if (usedHeaders.has(header)) continue;
      const h = norm(header);
      for (const cand of CANDIDATES[field]) {
        if (h === cand) {
          if (cand.length + 100 > bestScore) {
            bestScore = cand.length + 100; // exact match strongly preferred
            best = header;
          }
        } else if (h.includes(cand)) {
          if (cand.length > bestScore) {
            bestScore = cand.length;
            best = header;
          }
        }
      }
    }
    if (best) {
      mapping[field] = best;
      usedHeaders.add(best);
    }
  }
  return mapping;
}

// Read a File into a SheetJS workbook, handling Thai encodings.
// CSVs are often exported as TIS-620 / Windows-874 (not UTF-8); reading those
// bytes as Latin-1 produces mojibake like "¡ÃÐ¶Ò§" instead of "กระถาง". We try
// strict UTF-8 first and fall back to Windows-874 when that fails.
export async function readWorkbook(file, XLSX) {
  const buf = await file.arrayBuffer();
  const isCsv = /\.csv$/i.test(file.name || '') || file.type === 'text/csv';
  if (isCsv) {
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch {
      try {
        text = new TextDecoder('windows-874').decode(buf);
      } catch {
        text = new TextDecoder('utf-8').decode(buf);
      }
    }
    return XLSX.read(text, { type: 'string' });
  }
  return XLSX.read(buf, { type: 'array', cellDates: false });
}

// Read a File (csv/xlsx/xls) -> { headers, rows }. Rows are objects keyed by header.
export async function readSpreadsheet(file, XLSX) {
  const wb = await readWorkbook(file, XLSX);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true });
  const headers = rows.length ? Object.keys(rows[0]) : [];
  return { headers, rows };
}

// Apply a mapping to raw rows -> normalized sales line-item records.
export function applyMapping(rows, mapping, platform, fileName = '') {
  const records = [];
  rows.forEach((row, index) => {
    const get = (field) => (mapping[field] ? row[mapping[field]] : undefined);

    const sku = String(get('sku') ?? '').trim();
    const qty = Math.round(parseMoney(get('qty')) || 0) || 0;
    const unitPrice = parseMoney(get('unitPrice'));
    let revenue = mapping.revenue ? parseMoney(get('revenue')) : 0;
    if (!revenue) revenue = unitPrice * qty;

    // Skip description/blank/void rows that carry no sale (e.g. TikTok's
    // second "field description" header row has qty 0 and no revenue).
    if (qty <= 0 && revenue <= 0) return;

    const date = normalizeDate(get('date'));
    const orderId = String(get('orderId') ?? '').trim();
    const status = String(get('status') ?? '').trim();
    const productName = String(get('productName') ?? '').trim();

    // Inline per-line platform fees (Shopee order exports carry these).
    const feeComm = mapping.commission ? Math.abs(parseMoney(get('commission'))) : 0;
    const feeTrans = mapping.transaction ? Math.abs(parseMoney(get('transaction'))) : 0;
    const feeService = mapping.serviceFee ? Math.abs(parseMoney(get('serviceFee'))) : 0;
    const fee = feeComm + feeTrans + feeService;

    records.push({
      id: `${platform}:${orderId || fileName}:${sku}:${index}`,
      platform,
      orderId,
      date,
      monthKey: monthKeyOf(date),
      sku,
      productName,
      qty,
      unitPrice,
      revenue,
      status,
      feeComm,
      feeTrans,
      feeService,
      fee,
    });
  });
  return records;
}

// Distinct order statuses present in a set of records (for status filtering UI).
export function distinctStatuses(records) {
  const set = new Set();
  records.forEach((r) => {
    if (r.status) set.add(r.status);
  });
  return [...set].sort();
}
