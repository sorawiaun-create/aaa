import { parseMoney, normalizeDate, monthKeyOf } from './format.js';

// --- Settlement / income report (Excel) extraction ---
// Shopee "รายงานรายรับ" and TikTok "รายงาน" exports summarize the real
// platform fees for a period. We pull the authoritative monthly figures and
// emit a fee record (same shape the P&L engine consumes) so net profit =
// revenue (from order files) − COGS (SKU cost) − these fees.

const abs = (n) => Math.abs(n || 0);

// Read a whole workbook into { sheetName: AOA }.
export function workbookToSheets(XLSX, wb) {
  const out = {};
  wb.SheetNames.forEach((name) => {
    out[name] = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: true });
  });
  return out;
}

// Rightmost numeric value on the first row whose cell matches `label`.
function numForLabel(aoa, label, { exact = true } = {}) {
  for (const row of aoa) {
    const hit = row.some((cell) => {
      if (cell == null || cell === '') return false;
      const s = String(cell).trim();
      return exact ? s === label : s.includes(label);
    });
    if (!hit) continue;
    let val = null;
    for (const cell of row) {
      if (cell === '' || cell == null) continue;
      if (/\d/.test(String(cell))) {
        const n = parseMoney(cell);
        if (Number.isFinite(n)) val = n;
      }
    }
    if (val != null) return val;
  }
  return null;
}

// Last non-empty cell text on the row that contains `label` (for dates).
function textForLabel(aoa, label) {
  for (const row of aoa) {
    const hit = row.some((c) => c != null && String(c).trim().includes(label));
    if (!hit) continue;
    const cells = row.filter((c) => c != null && String(c).trim() !== '');
    if (cells.length > 1) return String(cells[cells.length - 1]);
  }
  return '';
}

function firstDateInSheets(aoa) {
  for (const row of aoa) {
    for (const cell of row) {
      const m = String(cell ?? '').match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
      if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}`;
    }
  }
  return '';
}

// ---- Shopee ----
function parseShopee(sheets) {
  const s = sheets['Summary'] || Object.values(sheets)[0];
  const revenue = abs(numForLabel(s, 'รายได้ทั้งหมด', { exact: false }));
  const payout = abs(numForLabel(s, 'จำนวนเงินทั้งหมดที่โอนแล้ว', { exact: false }));
  const totalExpense = abs(numForLabel(s, 'ค่าใช้จ่ายทั้งหมด', { exact: false }));

  const ams = abs(numForLabel(s, 'ค่าคอมมิชชั่น AMS'));
  const commission = abs(numForLabel(s, 'ค่าคอมมิชชั่น'));
  const service = abs(numForLabel(s, 'ค่าบริการ'));
  const infra = abs(numForLabel(s, 'ค่าธรรมเนียมโครงสร้างพื้นฐานแพลตฟอร์ม'));
  const transaction = abs(numForLabel(s, 'ค่าธุรกรรมการชำระเงิน'));
  const shipping = abs(numForLabel(s, 'ค่าจัดส่ง'));

  const dateText = textForLabel(s, 'จาก') || textForLabel(s, 'ถึง');
  const mk = monthKeyOf(normalizeDate(dateText)) || firstDateInSheets(s);
  // Total deductions the platform took = revenue − payout (authoritative).
  const total = revenue && payout ? revenue - payout : totalExpense;

  return {
    id: `settlement:shopee:${mk}`,
    platform: 'shopee',
    source: 'settlement',
    monthKey: mk,
    date: normalizeDate(dateText) || '',
    revenue,
    payout,
    comm: commission,
    ams,
    service,
    infra,
    trans: transaction,
    logistics: shipping,
    ads: 0,
    affiliate: 0,
    growth: 0,
    vat: 0,
    wht: 0,
    total,
  };
}

// ---- TikTok ----
function parseTikTok(sheets) {
  const s = sheets['รายงาน'] || Object.values(sheets).find((a) => a.some((r) => r.some((c) => String(c).includes('ค่าธรรมเนียมทั้งหมด')))) || Object.values(sheets)[0];

  const revenue = abs(numForLabel(s, 'รายได้รวม', { exact: false }));
  const payout = abs(numForLabel(s, 'จำนวนเงินที่ชำระทั้งหมด', { exact: false }));

  const orderFee = abs(numForLabel(s, 'ค่าธรรมเนียมคำสั่งซื้อ'));
  const commission = abs(numForLabel(s, 'ค่าคอมมิชชั่น TikTok Shop'));
  const shipping = abs(numForLabel(s, 'ยอดรวมค่าจัดส่งที่ร้านค้าจ่ายจริง'));
  const affiliate = abs(numForLabel(s, 'ค่าคอมมิชชั่นแอฟฟิลิเอต')) + abs(numForLabel(s, 'ค่าคอมมิชชั่นโฆษณาร้านค้าแอฟฟิลิเอต'));
  const growth = abs(numForLabel(s, 'ค่าธรรมเนียมสนับสนุนการเติบโตของร้านค้า'));
  const infra = abs(numForLabel(s, 'ค่าธรรมเนียมโครงสร้างพื้นฐาน'));
  const service = abs(numForLabel(s, 'ค่าบริการแบรนด์ดัง ลดแรง/แฟลชเซล'));
  const ads = abs(numForLabel(s, 'การชำระเงินด้วย GMV สำหรับโฆษณา TikTok'));

  const rangeText = textForLabel(s, 'ช่วงเวลา');
  const mk = firstDateInSheets([[rangeText]]) || firstDateInSheets(s);

  const total = revenue && payout ? revenue - payout : abs(numForLabel(s, 'ค่าธรรมเนียมทั้งหมด', { exact: false }));

  return {
    id: `settlement:tiktok:${mk}`,
    platform: 'tiktok',
    source: 'settlement',
    monthKey: mk,
    date: '',
    revenue,
    payout,
    trans: orderFee,
    comm: commission,
    logistics: shipping,
    affiliate,
    growth,
    infra,
    service,
    ads,
    ams: 0,
    vat: 0,
    wht: 0,
    total,
  };
}

// Detect platform and parse. Returns { status, platform, data } | { status:'unknown' }.
export function parseSettlementWorkbook(XLSX, wb, fileName = '') {
  try {
    const sheets = workbookToSheets(XLSX, wb);
    const names = wb.SheetNames.join(' ');
    const flat = Object.values(sheets)
      .flat()
      .flat()
      .map((c) => String(c ?? ''))
      .join(' ');

    const isTikTok = names.includes('รายงาน') && flat.includes('ค่าธรรมเนียมทั้งหมด');
    const isShopee = names.includes('Summary') || flat.includes('รายงานรายรับของฉัน');

    if (isTikTok) {
      const data = parseTikTok(sheets);
      return { status: 'success', platform: 'TikTok Settlement', file: fileName, data };
    }
    if (isShopee) {
      const data = parseShopee(sheets);
      return { status: 'success', platform: 'Shopee Settlement', file: fileName, data };
    }
    return { status: 'unknown', file: fileName, data: null };
  } catch (err) {
    return { status: 'error', file: fileName, message: err.message, data: null };
  }
}
