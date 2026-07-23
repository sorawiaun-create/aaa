import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeReconciliation } from '../src/lib/reconcile.js';
import { autoDetectMapping, applyMapping, distinctStatuses } from '../src/lib/salesParser.js';
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
