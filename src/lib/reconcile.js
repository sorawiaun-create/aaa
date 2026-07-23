import { monthKeyOf } from './format.js';

const skuKey = (sku) => String(sku ?? '').trim().toLowerCase();
const mapPlatform = (p) => (p === 'shopee' ? 'shopee' : 'tiktok');

const emptyFees = () => ({
  total: 0, ads: 0, affiliate: 0, logistics: 0, commission: 0,
  transaction: 0, service: 0, growth: 0, ams: 0, infra: 0, vat: 0, wht: 0,
});

function addFee(acc, f) {
  acc.total += f.total || 0;
  acc.ads += f.ads || 0;
  acc.affiliate += f.affiliate || 0;
  acc.logistics += f.logistics || 0;
  acc.commission += f.comm || 0;
  acc.transaction += f.trans || 0;
  acc.service += f.service || 0;
  acc.growth += f.growth || 0;
  acc.ams += f.ams || 0;
  acc.infra += f.infra || 0;
  acc.vat += f.vat || 0;
  acc.wht += f.wht || 0;
}

/**
 * Core engine. Computes a full profit & loss picture from sales line items,
 * the SKU cost master, and imported platform fee documents.
 *
 * Net Profit = Revenue − COGS − Platform Fees (incl. ads, incl. VAT).
 * WHT is reported separately (a withholding tax credit, not an expense).
 *
 * filters: { platform: 'all'|'shopee'|'tiktok', from, to (YYYY-MM), statuses: string[]|null }
 */
export function computeReconciliation({ sales = [], products = [], fees = [], filters = {} }) {
  const costBySku = {};
  products.forEach((p) => {
    const k = skuKey(p.sku);
    if (k) costBySku[k] = p;
  });

  const platformFilter = filters.platform || 'all';
  const { from, to, statuses } = filters;

  const monthInRange = (mk) => {
    if (!mk) return !from && !to; // undated rows only when no range set
    if (from && mk < from) return false;
    if (to && mk > to) return false;
    return true;
  };

  const salesPass = (s) => {
    if (platformFilter !== 'all' && s.platform !== platformFilter) return false;
    if (!monthInRange(s.monthKey)) return false;
    if (statuses && statuses.length && s.status && !statuses.includes(s.status)) return false;
    return true;
  };

  const filteredSales = sales.filter(salesPass);

  // --- SKU-level aggregation ---
  const skuMap = {};
  let revenue = 0;
  let cogs = 0;
  let unitsSold = 0;
  const orderIds = new Set();
  const unmatched = new Set();

  filteredSales.forEach((s) => {
    const k = skuKey(s.sku);
    const prod = costBySku[k];
    const unitCost = prod ? prod.unitCost || 0 : 0;
    const lineCogs = unitCost * s.qty;

    revenue += s.revenue;
    cogs += lineCogs;
    unitsSold += s.qty;
    if (s.orderId) orderIds.add(`${s.platform}:${s.orderId}`);
    if (k && !prod) unmatched.add(s.sku);

    if (!skuMap[k]) {
      skuMap[k] = {
        sku: s.sku,
        name: prod?.name || s.productName || s.sku,
        platform: s.platform,
        qty: 0,
        revenue: 0,
        cogs: 0,
        unitCost,
        hasCost: !!prod,
      };
    }
    const m = skuMap[k];
    m.qty += s.qty;
    m.revenue += s.revenue;
    m.cogs += lineCogs;
  });

  const bySku = Object.values(skuMap)
    .map((m) => ({
      ...m,
      grossProfit: m.revenue - m.cogs,
      margin: m.revenue ? ((m.revenue - m.cogs) / m.revenue) * 100 : 0,
    }))
    .sort((a, b) => b.grossProfit - a.grossProfit);

  // --- Fees aggregation (respecting platform + date range) ---
  const feePass = (f) => {
    const fp = mapPlatform(f.platform);
    if (platformFilter !== 'all' && fp !== platformFilter) return false;
    const mk = f.monthKey || monthKeyOf(f.date);
    if (!monthInRange(mk)) return false;
    return true;
  };
  const feeTotals = emptyFees();
  fees.filter(feePass).forEach((f) => addFee(feeTotals, f));

  const grossProfit = revenue - cogs;
  const netProfit = grossProfit - feeTotals.total;
  const grossMargin = revenue ? (grossProfit / revenue) * 100 : 0;
  const netMargin = revenue ? (netProfit / revenue) * 100 : 0;

  // --- Per-platform split ---
  const platforms = ['shopee', 'tiktok'];
  const byPlatform = {};
  platforms.forEach((p) => {
    const pRevenue = filteredSales
      .filter((s) => s.platform === p)
      .reduce((a, s) => a + s.revenue, 0);
    const pCogs = filteredSales
      .filter((s) => s.platform === p)
      .reduce((a, s) => {
        const prod = costBySku[skuKey(s.sku)];
        return a + (prod ? (prod.unitCost || 0) * s.qty : 0);
      }, 0);
    const pFees = emptyFees();
    fees
      .filter((f) => feePass(f) && mapPlatform(f.platform) === p)
      .forEach((f) => addFee(pFees, f));
    const pNet = pRevenue - pCogs - pFees.total;
    byPlatform[p] = {
      revenue: pRevenue,
      cogs: pCogs,
      grossProfit: pRevenue - pCogs,
      fees: pFees.total,
      netProfit: pNet,
      margin: pRevenue ? (pNet / pRevenue) * 100 : 0,
    };
  });

  // --- Monthly trend (revenue / cost / profit) ---
  const monthMap = {};
  const ensureMonth = (mk) => {
    const key = mk || 'ไม่ระบุ';
    if (!monthMap[key]) {
      monthMap[key] = { monthKey: key, revenue: 0, cogs: 0, fees: 0 };
    }
    return monthMap[key];
  };
  filteredSales.forEach((s) => {
    const m = ensureMonth(s.monthKey);
    m.revenue += s.revenue;
    const prod = costBySku[skuKey(s.sku)];
    m.cogs += prod ? (prod.unitCost || 0) * s.qty : 0;
  });
  fees.filter(feePass).forEach((f) => {
    const m = ensureMonth(f.monthKey || monthKeyOf(f.date));
    m.fees += f.total || 0;
  });
  const byMonth = Object.values(monthMap)
    .map((m) => ({
      ...m,
      cost: m.cogs + m.fees,
      profit: m.revenue - m.cogs - m.fees,
    }))
    .sort((a, b) => (a.monthKey < b.monthKey ? -1 : 1));

  // --- Settlement summary (authoritative platform revenue/fees/payout) ---
  const settlementDocs = fees.filter((f) => f.source === 'settlement' && feePass(f));
  const settlement = {
    hasData: settlementDocs.length > 0,
    revenue: 0,
    payout: 0,
    fees: 0,
    byPlatform: {
      shopee: { revenue: 0, payout: 0, fees: 0 },
      tiktok: { revenue: 0, payout: 0, fees: 0 },
    },
  };
  settlementDocs.forEach((d) => {
    const p = mapPlatform(d.platform);
    settlement.revenue += d.revenue || 0;
    settlement.payout += d.payout || 0;
    settlement.fees += d.total || 0;
    settlement.byPlatform[p].revenue += d.revenue || 0;
    settlement.byPlatform[p].payout += d.payout || 0;
    settlement.byPlatform[p].fees += d.total || 0;
  });
  // Net profit using authoritative settlement payout, minus COGS from sales.
  settlement.cogs = cogs;
  settlement.netProfit = settlement.payout - cogs;
  settlement.netMargin = settlement.revenue ? (settlement.netProfit / settlement.revenue) * 100 : 0;

  return {
    revenue,
    cogs,
    grossProfit,
    grossMargin,
    fees: feeTotals,
    netProfit,
    netMargin,
    settlement,
    unitsSold,
    orderCount: orderIds.size,
    lineCount: filteredSales.length,
    bySku,
    byPlatform,
    byMonth,
    unmatchedSkus: [...unmatched],
    missingCostCount: unmatched.size,
  };
}
