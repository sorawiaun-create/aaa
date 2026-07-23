import { normalizeDate, monthKeyOf, parseMoney } from './format.js';

// --- Per-ORDER fee extraction ---
// The order/SKU export and the settlement report share no SKU, but they share
// the Order ID. This reads per-order fees from the settlement workbook so each
// order's actual fees can be joined to its sales lines by Order ID.
//   Shopee : "Income" sheet (one row per order, header not on row 0)
//   TikTok : "รายละเอียดคำสั่งซื้อ" sheet (one row per order)

const abs = (v) => Math.abs(parseMoney(v));

function sheetsAOA(XLSX, wb) {
  const out = {};
  wb.SheetNames.forEach((n) => {
    out[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '', raw: true });
  });
  return out;
}

function findHeaderRow(aoa, label) {
  return aoa.findIndex((r) => r.some((c) => String(c).trim() === label));
}

function parseShopeeIncome(aoa) {
  const hRow = findHeaderRow(aoa, 'หมายเลขคำสั่งซื้อ');
  if (hRow < 0) return [];
  const H = aoa[hRow];
  const idx = (name) => H.indexOf(name);
  const c = {
    oid: idx('หมายเลขคำสั่งซื้อ'),
    date: idx('วันที่ทำการสั่งซื้อ'),
    ams: idx('ค่าคอมมิชชั่น AMS'),
    comm: idx('ค่าคอมมิชชั่น'),
    service: idx('ค่าบริการ'),
    infra: idx('ค่าธรรมเนียมโครงสร้างพื้นฐานแพลตฟอร์ม'),
    trans: idx('ค่าธุรกรรมการชำระเงิน'),
    payout: idx('จำนวนเงินทั้งหมดที่โอนแล้ว (฿)'),
  };
  if (c.oid < 0) return [];
  const out = [];
  for (let i = hRow + 1; i < aoa.length; i++) {
    const r = aoa[i];
    const oid = String(r[c.oid] ?? '').trim();
    if (!oid) continue;
    const ams = abs(r[c.ams]);
    const comm = abs(r[c.comm]);
    const service = abs(r[c.service]);
    const infra = abs(r[c.infra]);
    const trans = abs(r[c.trans]);
    const total = ams + comm + service + infra + trans;
    const date = normalizeDate(r[c.date]);
    out.push({
      id: `shopee:${oid}`, platform: 'shopee', orderId: oid, date,
      monthKey: monthKeyOf(date), ams, comm, service, infra, trans,
      affiliate: 0, growth: 0, logistics: 0, total,
      payout: parseMoney(r[c.payout]),
    });
  }
  return out;
}

function parseTikTokDetail(aoa) {
  if (!aoa.length) return [];
  const H = aoa[0];
  const idx = (name) => H.findIndex((c) => String(c).trim() === name);
  const c = {
    oid: idx('หมายเลขคำสั่งซื้อ/การปรับ'),
    type: idx('ประเภทธุรกรรม'),
    date: idx('เวลาที่สร้างคำสั่งซื้อ'),
    total: idx('ค่าธรรมเนียมทั้งหมด'),
    comm: idx('ค่าคอมมิชชั่น TikTok Shop'),
    trans: idx('ค่าธรรมเนียมคำสั่งซื้อ'),
  };
  if (c.oid < 0 || c.total < 0) return [];
  const out = [];
  for (let i = 1; i < aoa.length; i++) {
    const r = aoa[i];
    const oid = String(r[c.oid] ?? '').trim();
    if (!oid) continue;
    const total = abs(r[c.total]);
    const date = normalizeDate(r[c.date]);
    out.push({
      id: `tiktok:${oid}`, platform: 'tiktok', orderId: oid, date,
      monthKey: monthKeyOf(date), comm: abs(r[c.comm]), trans: abs(r[c.trans]),
      service: 0, infra: 0, ams: 0, affiliate: 0, growth: 0, logistics: 0,
      total, payout: 0,
    });
  }
  return out;
}

// Returns { platform, records } — records are per-order fee rows (may be empty
// if the workbook is a summary-only export with no per-order detail).
export function parseOrderFees(XLSX, wb) {
  const sheets = sheetsAOA(XLSX, wb);
  if (sheets['Income']) {
    return { platform: 'shopee', records: parseShopeeIncome(sheets['Income']) };
  }
  if (sheets['รายละเอียดคำสั่งซื้อ']) {
    return { platform: 'tiktok', records: parseTikTokDetail(sheets['รายละเอียดคำสั่งซื้อ']) };
  }
  return { platform: null, records: [] };
}
