import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { computeReconciliation, computeOrderReconciliation } from '../src/lib/reconcile.js';
import { autoDetectMapping, applyMapping, distinctStatuses } from '../src/lib/salesParser.js';
import { parseSettlementWorkbook } from '../src/lib/settlementParser.js';
import { parseOrderFees } from '../src/lib/orderFeeParser.js';
import { parseMoney, normalizeDate, monthKeyOf } from '../src/lib/format.js';

test('parseMoney handles messy formats', () => {
  assert.equal(parseMoney('฿1,234.50'), 1234.5);
  assert.equal(parseMoney('(120.00)'), -120);
  assert.equal(parseMoney('1.234,50'), 1234.5); // comma decimal
  assert.equal(parseMoney(''), 0);
  assert.equal(parseMoney(42), 42);
});

test('normalizeDate + monthKeyOf normalize varied inputs', () => {
  assert.equal(normalizeDate('2025-01-15'), '15/01/2025');
  assert.equal(normalizeDate('Dec 12, 2025'), '12/12/2025');
  assert.equal(normalizeDate('01, December, 2025'), '01/12/2025');
  assert.equal(normalizeDate('5/3/2025'), '05/03/2025');
  assert.equal(monthKeyOf('15/01/2025'), '2025-01');
});

test('autoDetectMapping prefers specific headers', () => {
  const headers = ['Order ID', 'Seller SKU', 'SKU', 'Quantity', 'Unit Price', 'ชื่อสินค้า', 'สถานะ'];
  const m = autoDetectMapping(headers);
  assert.equal(m.sku, 'Seller SKU'); // "seller sku" beats bare "sku"
  assert.equal(m.qty, 'Quantity');
  assert.equal(m.unitPrice, 'Unit Price');
  assert.equal(m.productName, 'ชื่อสินค้า');
  assert.equal(m.status, 'สถานะ');
  assert.equal(m.orderId, 'Order ID');
});

test('applyMapping derives revenue from qty * price when revenue missing', () => {
  const rows = [
    { SKU: 'A1', Qty: '2', Price: '100', ชื่อ: 'ของ A' },
    { SKU: '', Qty: '0' }, // skipped
  ];
  const mapping = { sku: 'SKU', qty: 'Qty', unitPrice: 'Price', productName: 'ชื่อ' };
  const recs = applyMapping(rows, mapping, 'shopee', 'f.csv');
  assert.equal(recs.length, 1);
  assert.equal(recs[0].revenue, 200);
  assert.equal(recs[0].platform, 'shopee');
});

test('revenue maps to per-line column, not order-level totals (TikTok shape)', () => {
  const headers = [
    'Order ID', 'Seller SKU', 'Quantity', 'SKU Unit Original Price',
    'SKU Subtotal After Discount', 'Order Amount', 'Order Status',
  ];
  const m = autoDetectMapping(headers);
  // "Order Amount" repeats per line -> must NOT be chosen; per-line subtotal wins
  assert.equal(m.revenue, 'SKU Subtotal After Discount');
});

test('revenue maps to net line column (Shopee shape)', () => {
  const headers = ['หมายเลขคำสั่งซื้อ', 'เลขอ้างอิง SKU (SKU Reference No.)', 'จำนวน', 'ราคาขาย', 'ราคาขายสุทธิ', 'จำนวนเงินทั้งหมด'];
  const m = autoDetectMapping(headers);
  assert.equal(m.sku, 'เลขอ้างอิง SKU (SKU Reference No.)');
  assert.equal(m.unitPrice, 'ราคาขาย');
  assert.equal(m.revenue, 'ราคาขายสุทธิ');
});

test('applyMapping drops zero-qty zero-revenue description rows', () => {
  const rows = [
    { SKU: 'Seller sku input by the seller.', Qty: 0, Rev: '' }, // junk header-desc row
    { SKU: 'REAL-1', Qty: 2, Rev: 178 },
  ];
  const recs = applyMapping(rows, { sku: 'SKU', qty: 'Qty', revenue: 'Rev' }, 'tiktok', 'f');
  assert.equal(recs.length, 1);
  assert.equal(recs[0].sku, 'REAL-1');
  assert.equal(recs[0].revenue, 178);
});

test('computeReconciliation core math', () => {
  const sales = [
    { id: '1', platform: 'shopee', orderId: 'O1', date: '01/01/2025', monthKey: '2025-01', sku: 'A', qty: 2, unitPrice: 100, revenue: 200, status: 'สำเร็จ' },
    { id: '2', platform: 'tiktok', orderId: 'O2', date: '02/01/2025', monthKey: '2025-01', sku: 'B', qty: 1, unitPrice: 300, revenue: 300, status: 'สำเร็จ' },
    { id: '3', platform: 'tiktok', orderId: 'O3', date: '03/01/2025', monthKey: '2025-01', sku: 'NOCOST', qty: 1, unitPrice: 50, revenue: 50, status: 'ยกเลิก' },
  ];
  const products = [
    { sku: 'A', name: 'A', unitCost: 40 },
    { sku: 'B', name: 'B', unitCost: 120 },
  ];
  const fees = [
    { id: 'f1', platform: 'shopee', date: '15/01/2025', monthKey: '2025-01', total: 30, ads: 10, comm: 20 },
    { id: 'f2', platform: 'tiktok', date: '15/01/2025', monthKey: '2025-01', total: 40, ads: 25, affiliate: 15 },
  ];

  const r = computeReconciliation({ sales, products, fees, filters: { platform: 'all', statuses: ['สำเร็จ'] } });
  // revenue = 200 + 300 (cancelled excluded) = 500
  assert.equal(r.revenue, 500);
  // cogs = 2*40 + 1*120 = 200
  assert.equal(r.cogs, 200);
  assert.equal(r.grossProfit, 300);
  // fees total = 70; net = 300 - 70 = 230
  assert.equal(r.fees.total, 70);
  assert.equal(r.netProfit, 230);
  assert.equal(r.unitsSold, 3);
  assert.equal(r.orderCount, 2);
  // NOCOST is cancelled so excluded -> not unmatched
  assert.equal(r.missingCostCount, 0);
});

test('computeReconciliation flags unmatched SKUs and filters platform', () => {
  const sales = [
    { id: '1', platform: 'shopee', orderId: 'O1', date: '01/01/2025', monthKey: '2025-01', sku: 'A', qty: 1, unitPrice: 100, revenue: 100, status: 'สำเร็จ' },
    { id: '2', platform: 'tiktok', orderId: 'O2', date: '01/01/2025', monthKey: '2025-01', sku: 'GHOST', qty: 1, unitPrice: 100, revenue: 100, status: 'สำเร็จ' },
  ];
  const products = [{ sku: 'A', name: 'A', unitCost: 30 }];
  const rAll = computeReconciliation({ sales, products, fees: [], filters: { platform: 'all' } });
  assert.equal(rAll.missingCostCount, 1);
  assert.deepEqual(rAll.unmatchedSkus, ['GHOST']);

  const rShopee = computeReconciliation({ sales, products, fees: [], filters: { platform: 'shopee' } });
  assert.equal(rShopee.revenue, 100);
  assert.equal(rShopee.missingCostCount, 0); // GHOST filtered out
});

test('distinctStatuses returns sorted unique', () => {
  const recs = [{ status: 'b' }, { status: 'a' }, { status: 'b' }, { status: '' }];
  assert.deepEqual(distinctStatuses(recs), ['a', 'b']);
});

const wbFrom = (name, aoa) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  return wb;
};

test('settlement parser reads Shopee income report', () => {
  const wb = wbFrom('Summary', [
    ['รายงานรายรับของฉัน'],
    ['จาก', '2026-05-01'],
    ['1. รายได้ทั้งหมด', '', '', 1000],
    ['ค่าคอมมิชชั่น AMS', '', -50, ''],
    ['ค่าคอมมิชชั่น', '', -200, ''],
    ['ค่าธุรกรรมการชำระเงิน', '', -100, ''],
    ['3. จำนวนเงินทั้งหมดที่โอนแล้ว', '', '', 700],
  ]);
  const res = parseSettlementWorkbook(XLSX, wb, 'shopee.xlsx');
  assert.equal(res.status, 'success');
  assert.equal(res.data.platform, 'shopee');
  assert.equal(res.data.revenue, 1000);
  assert.equal(res.data.payout, 700);
  assert.equal(res.data.total, 300); // revenue - payout
  assert.equal(res.data.comm, 200); // exact match, not stolen by "AMS" row
  assert.equal(res.data.ams, 50);
  assert.equal(res.data.trans, 100);
  assert.equal(res.data.monthKey, '2026-05');
});

test('settlement parser reads TikTok report', () => {
  const wb = wbFrom('รายงาน', [
    ['', 'ช่วงเวลา', '', '', '', '2026/05/01-2026/05/31'],
    ['', '', 'รายได้รวม', '', '', '2000'],
    ['', '', 'ค่าธรรมเนียมทั้งหมด', '', '', '-500'],
    ['', '', 'ค่าคอมมิชชั่น TikTok Shop', '', '', '-300'],
    ['', 'จำนวนเงินที่ชำระทั้งหมด', '', '', '', '1500'],
  ]);
  const res = parseSettlementWorkbook(XLSX, wb, 'tiktok.xlsx');
  assert.equal(res.status, 'success');
  assert.equal(res.data.platform, 'tiktok');
  assert.equal(res.data.revenue, 2000);
  assert.equal(res.data.payout, 1500);
  assert.equal(res.data.total, 500);
  assert.equal(res.data.comm, 300);
  assert.equal(res.data.monthKey, '2026-05');
});

test('inline line fees drive per-SKU net profit and override settlement (no double count)', () => {
  const sales = [
    { id: '1', platform: 'shopee', orderId: 'O1', monthKey: '2026-05', date: '10/05/2026', sku: 'A', qty: 2, revenue: 200, status: 'ok', fee: 30, feeComm: 20, feeTrans: 6, feeService: 4 },
  ];
  const products = [{ sku: 'A', name: 'A', unitCost: 40 }];
  // A settlement aggregate that must be IGNORED because inline fees exist for shopee.
  const fees = [{ id: 'f', platform: 'shopee', monthKey: '2026-05', total: 999 }];
  const r = computeReconciliation({ sales, products, fees, filters: { platform: 'all' } });
  assert.equal(r.fees.total, 30); // inline wins, 999 ignored
  assert.equal(r.fees.commission, 20);
  assert.equal(r.netProfit, 90); // 200 - 80 - 30
  assert.equal(r.bySku[0].fees, 30);
  assert.equal(r.bySku[0].netProfit, 90);
});

test('joined order fees are allocated to SKU lines by revenue share', () => {
  const sales = [
    { id: '1', platform: 'tiktok', orderId: 'T1', monthKey: '2026-05', date: '10/05/2026', sku: 'A', qty: 1, revenue: 100, status: 'ok', fee: 0 },
    { id: '2', platform: 'tiktok', orderId: 'T1', monthKey: '2026-05', date: '10/05/2026', sku: 'B', qty: 1, revenue: 300, status: 'ok', fee: 0 },
  ];
  const products = [{ sku: 'A', name: 'A', unitCost: 10 }, { sku: 'B', name: 'B', unitCost: 30 }];
  const orderFees = [{ id: 'tiktok:T1', platform: 'tiktok', orderId: 'T1', total: 40 }];
  const r = computeReconciliation({ sales, products, fees: [], orderFees, filters: { platform: 'all' } });
  assert.equal(r.fees.total, 40);
  const A = r.bySku.find((x) => x.sku === 'A');
  const B = r.bySku.find((x) => x.sku === 'B');
  assert.equal(A.fees, 10); // 40 * 100/400
  assert.equal(B.fees, 30); // 40 * 300/400
  assert.equal(r.netProfit, 320); // 400 - 40 cogs - 40 fees
});

test('order profit view matches Shopee via inline fees without a settlement file', () => {
  const sales = [
    { id: '1', platform: 'shopee', orderId: 'O1', monthKey: '2026-05', date: '10/05/2026', sku: 'A', qty: 1, revenue: 100, status: 'ok', fee: 20 },
  ];
  const products = [{ sku: 'A', name: 'A', unitCost: 40 }];
  const { rows, totals } = computeOrderReconciliation({ sales, products, orderFees: [], filters: { platform: 'all' } });
  assert.equal(totals.matchedCount, 1); // matched via inline fee, no settlement needed
  assert.equal(rows[0].feeSource, 'inline');
  assert.equal(rows[0].netProfit, 40); // 100 - 40 - 20
});

test('order-fee parser reads Shopee Income sheet by Order ID', () => {
  const wb = XLSX.utils.book_new();
  // Income sheet: junk rows, then a header row, then per-order rows.
  const aoa = [
    ['ชื่อผู้ใช้ (ผู้ขาย)', 'จาก', 'ถึง'],
    ['sorawitata', '2026-05-01', '2026-05-31'],
    [], [], ['ยอดรวม (฿)'],
    ['ลำดับที่', 'หมายเลขคำสั่งซื้อ', 'วันที่ทำการสั่งซื้อ', 'ค่าคอมมิชชั่น AMS', 'ค่าคอมมิชชั่น', 'ค่าบริการ', 'ค่าธรรมเนียมโครงสร้างพื้นฐานแพลตฟอร์ม', 'ค่าธุรกรรมการชำระเงิน', 'จำนวนเงินทั้งหมดที่โอนแล้ว (฿)'],
    [1, 'ORD-1', '2026-05-10', -4, -30, -1, -1, -10, 100],
    [2, 'ORD-2', '2026-05-11', 0, -20, 0, 0, -5, 60],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Income');
  const { platform, records } = parseOrderFees(XLSX, wb);
  assert.equal(platform, 'shopee');
  assert.equal(records.length, 2);
  const o1 = records.find((r) => r.orderId === 'ORD-1');
  assert.equal(o1.total, 46); // 4+30+1+1+10
  assert.equal(o1.monthKey, '2026-05');
});

test('computeOrderReconciliation joins sales to per-order fees by Order ID', () => {
  const sales = [
    // ORD-1: two SKU lines
    { id: 'a', platform: 'shopee', orderId: 'ORD-1', date: '10/05/2026', monthKey: '2026-05', sku: 'A', qty: 2, revenue: 200, status: 'ok' },
    { id: 'b', platform: 'shopee', orderId: 'ORD-1', date: '10/05/2026', monthKey: '2026-05', sku: 'B', qty: 1, revenue: 100, status: 'ok' },
    // ORD-2: settled
    { id: 'c', platform: 'shopee', orderId: 'ORD-2', date: '11/05/2026', monthKey: '2026-05', sku: 'A', qty: 1, revenue: 100, status: 'ok' },
    // ORD-3: no settlement fee yet (pending)
    { id: 'd', platform: 'shopee', orderId: 'ORD-3', date: '12/05/2026', monthKey: '2026-05', sku: 'A', qty: 1, revenue: 100, status: 'ok' },
  ];
  const products = [{ sku: 'A', name: 'A', unitCost: 40 }, { sku: 'B', name: 'B', unitCost: 30 }];
  const orderFees = [
    { id: 'shopee:ORD-1', platform: 'shopee', orderId: 'ORD-1', total: 46 },
    { id: 'shopee:ORD-2', platform: 'shopee', orderId: 'ORD-2', total: 15 },
  ];
  const { rows, totals } = computeOrderReconciliation({ sales, products, orderFees, filters: { platform: 'all' } });
  assert.equal(totals.orderCount, 3);
  assert.equal(totals.matchedCount, 2);
  assert.equal(totals.pendingCount, 1);
  const ord1 = rows.find((r) => r.orderId === 'ORD-1');
  assert.equal(ord1.revenue, 300);
  assert.equal(ord1.cogs, 110); // 2*40 + 1*30
  assert.equal(ord1.fee, 46);
  assert.equal(ord1.netProfit, 144); // 300 - 110 - 46
  // matched totals: rev 400, cogs 150, fees 61 -> net 189
  assert.equal(totals.matchedRevenue, 400);
  assert.equal(totals.fees, 61);
  assert.equal(totals.netProfit, 189);
});

test('settlement feeds engine net profit (payout - COGS)', () => {
  const sales = [
    { id: '1', platform: 'shopee', orderId: 'O1', date: '10/05/2026', monthKey: '2026-05', sku: 'A', qty: 5, unitPrice: 100, revenue: 500, status: 'ok' },
  ];
  const products = [{ sku: 'A', name: 'A', unitCost: 40 }];
  const settlement = {
    id: 'settlement:shopee:2026-05', platform: 'shopee', source: 'settlement',
    monthKey: '2026-05', revenue: 1000, payout: 700, total: 300, comm: 200, trans: 100,
  };
  const r = computeReconciliation({ sales, products, fees: [settlement], filters: { platform: 'all' } });
  assert.equal(r.settlement.hasData, true);
  assert.equal(r.settlement.revenue, 1000);
  assert.equal(r.settlement.payout, 700);
  assert.equal(r.settlement.cogs, 200); // 5 * 40
  assert.equal(r.settlement.netProfit, 500); // payout 700 - cogs 200
});
