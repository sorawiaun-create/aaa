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
export function computeReconciliation({ sales = [], products = [], fees = [], orderFees = [], filters = {} }) {
  const costBySku = {};
  products.forEach((p) => {
    const k = skuKey(p.sku);
    if (k) costBySku[k] = p;
  });

  const feeByOrder = {};
  orderFees.forEach((f) => {
    feeByOrder[`${mapPlatform(f.platform)}:${String(f.orderId).trim()}`] = f;
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

  // Revenue per order (for allocating order-level fees down to each line).
  const orderRevenue = {};
  filteredSales.forEach((s) => {
    const k = `${s.platform}:${String(s.orderId).trim()}`;
    orderRevenue[k] = (orderRevenue[k] || 0) + s.revenue;
  });

  // Effective fee for a single sales line: inline fee if the file carries one
  // (Shopee), otherwise this line's revenue-share of its order's joined fee
  // (TikTok, matched on Order ID). Returns 0 if neither is available.
  const lineEffFee = (s) => {
    if ((s.fee || 0) > 0) return s.fee;
    const k = `${s.platform}:${String(s.orderId).trim()}`;
    const jf = feeByOrder[k];
    if (jf && orderRevenue[k] > 0) return (jf.total || 0) * (s.revenue / orderRevenue[k]);
    return 0;
  };

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
    const lineFee = lineEffFee(s);

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
        fees: 0,
        unitCost,
        hasCost: !!prod,
      };
    }
    const m = skuMap[k];
    m.qty += s.qty;
    m.revenue += s.revenue;
    m.cogs += lineCogs;
    m.fees += lineFee;
  });

  const bySku = Object.values(skuMap)
    .map((m) => ({
      ...m,
      grossProfit: m.revenue - m.cogs,
      netProfit: m.revenue - m.cogs - m.fees,
      margin: m.revenue ? ((m.revenue - m.cogs) / m.revenue) * 100 : 0,
      netMargin: m.revenue ? ((m.revenue - m.cogs - m.fees) / m.revenue) * 100 : 0,
    }))
    .sort((a, b) => b.grossProfit - a.grossProfit);

  // --- Fees aggregation (unified, no double counting) ---
  // Priority per platform: effective per-line/per-order fees (from sales +
  // orderFees). Fall back to the monthly settlement/PDF `fees` array only for
  // platforms that have no effective line/order fees.
  const feePass = (f) => {
    const fp = mapPlatform(f.platform);
    if (platformFilter !== 'all' && fp !== platformFilter) return false;
    const mk = f.monthKey || monthKeyOf(f.date);
    if (!monthInRange(mk)) return false;
    return true;
  };

  const feeTotals = emptyFees();
  const effFeeByPlatform = { shopee: 0, tiktok: 0 };

  // (a) inline line fees
  filteredSales.forEach((s) => {
    if ((s.fee || 0) <= 0) return;
    const p = mapPlatform(s.platform);
    feeTotals.total += s.fee;
    feeTotals.commission += s.feeComm || 0;
    feeTotals.transaction += s.feeTrans || 0;
    feeTotals.service += s.feeService || 0;
    effFeeByPlatform[p] += s.fee;
  });
  // (b) joined per-order fees (orders without inline fees), counted once
  const seenOrders = new Set();
  filteredSales.forEach((s) => {
    if ((s.fee || 0) > 0) return;
    const k = `${s.platform}:${String(s.orderId).trim()}`;
    if (seenOrders.has(k)) return;
    const jf = feeByOrder[k];
    if (!jf) return;
    seenOrders.add(k);
    addFee(feeTotals, jf);
    effFeeByPlatform[mapPlatform(s.platform)] += jf.total || 0;
  });
  // (c) monthly settlement/PDF fees for platforms with no effective fees
  fees.filter(feePass).forEach((f) => {
    if (effFeeByPlatform[mapPlatform(f.platform)] > 0) return;
    addFee(feeTotals, f);
  });

  const grossProfit = revenue - cogs;
  const netProfit = grossProfit - feeTotals.total;
  const grossMargin = revenue ? (grossProfit / revenue) * 100 : 0;
  const netMargin = revenue ? (netProfit / revenue) * 100 : 0;

  // --- Per-platform split (uses the same unified effective fees) ---
  const platforms = ['shopee', 'tiktok'];
  const byPlatform = {};
  platforms.forEach((p) => {
    const pSales = filteredSales.filter((s) => mapPlatform(s.platform) === p);
    const pRevenue = pSales.reduce((a, s) => a + s.revenue, 0);
    const pCogs = pSales.reduce((a, s) => {
      const prod = costBySku[skuKey(s.sku)];
      return a + (prod ? (prod.unitCost || 0) * s.qty : 0);
    }, 0);
    let pFees = effFeeByPlatform[p] || 0;
    if (pFees <= 0) {
      fees
        .filter((f) => feePass(f) && mapPlatform(f.platform) === p)
        .forEach((f) => { pFees += f.total || 0; });
    }
    const pNet = pRevenue - pCogs - pFees;
    byPlatform[p] = {
      revenue: pRevenue,
      cogs: pCogs,
      grossProfit: pRevenue - pCogs,
      fees: pFees,
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
    m.fees += lineEffFee(s);
  });
  // Add settlement/PDF fees only for platforms without effective line/order fees.
  fees.filter(feePass).forEach((f) => {
    if (effFeeByPlatform[mapPlatform(f.platform)] > 0) return;
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

/**
 * Per-product monthly analytics: units and revenue per SKU, broken down by
 * month, for best-seller rankings and per-product sales trends.
 */
export function computeProductMonthly({ sales = [], products = [], filters = {} }) {
  const costBySku = {};
  products.forEach((p) => {
    const k = skuKey(p.sku);
    if (k) costBySku[k] = p;
  });

  const platformFilter = filters.platform || 'all';
  const { from, to, statuses } = filters;
  const inRange = (mk) => {
    if (!mk) return !from && !to;
    if (from && mk < from) return false;
    if (to && mk > to) return false;
    return true;
  };
  const pass = (s) =>
    (platformFilter === 'all' || s.platform === platformFilter) &&
    inRange(s.monthKey) &&
    (!(statuses && statuses.length) || !s.status || statuses.includes(s.status));

  const monthsSet = new Set();
  const skuMap = {};
  sales.filter(pass).forEach((s) => {
    const mk = s.monthKey || 'ไม่ระบุ';
    monthsSet.add(mk);
    const k = skuKey(s.sku);
    const prod = costBySku[k];
    if (!skuMap[k]) {
      skuMap[k] = {
        sku: s.sku, name: prod?.name || s.productName || s.sku,
        platform: s.platform, qty: 0, revenue: 0, months: {},
      };
    }
    const m = skuMap[k];
    m.qty += s.qty;
    m.revenue += s.revenue;
    if (!m.months[mk]) m.months[mk] = { qty: 0, revenue: 0 };
    m.months[mk].qty += s.qty;
    m.months[mk].revenue += s.revenue;
  });

  const months = [...monthsSet].filter((x) => x !== 'ไม่ระบุ').sort();
  if (monthsSet.has('ไม่ระบุ')) months.push('ไม่ระบุ');
  const productList = Object.values(skuMap).sort((a, b) => b.revenue - a.revenue);
  return { months, products: productList };
}

/**
 * Order-level TRUE profit by joining sales lines to per-order fees on Order ID.
 * The order/SKU file and the settlement file have no SKU in common, but share
 * the Order ID — so we group sales by order, attach the order's actual fees,
 * and compute: net profit = revenue − COGS − order fees.
 *
 * Orders with no matching settlement row yet are "pending" (fees not released).
 */
export function computeOrderReconciliation({ sales = [], products = [], orderFees = [], filters = {} }) {
  const costBySku = {};
  products.forEach((p) => {
    const k = skuKey(p.sku);
    if (k) costBySku[k] = p;
  });

  const feeByOrder = {};
  orderFees.forEach((f) => {
    feeByOrder[`${mapPlatform(f.platform)}:${String(f.orderId).trim()}`] = f;
  });

  const platformFilter = filters.platform || 'all';
  const { from, to, statuses } = filters;
  const monthInRange = (mk) => {
    if (!mk) return !from && !to;
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

  const orders = {};
  sales.filter(salesPass).forEach((s) => {
    if (!s.orderId) return;
    const key = `${s.platform}:${String(s.orderId).trim()}`;
    if (!orders[key]) {
      orders[key] = {
        key, platform: s.platform, orderId: s.orderId, date: s.date,
        monthKey: s.monthKey, lines: 0, qty: 0, revenue: 0, cogs: 0,
        inlineFee: 0, hasAllCost: true,
      };
    }
    const o = orders[key];
    o.lines += 1;
    o.qty += s.qty;
    o.revenue += s.revenue;
    o.inlineFee += s.fee || 0;
    const prod = costBySku[skuKey(s.sku)];
    o.cogs += prod ? (prod.unitCost || 0) * s.qty : 0;
    if (!prod && skuKey(s.sku)) o.hasAllCost = false;
  });

  const rows = Object.values(orders)
    .map((o) => {
      // Prefer the order file's own inline fees (Shopee), else the fee joined
      // from the settlement file by Order ID (TikTok).
      const joined = feeByOrder[o.key];
      const hasInline = o.inlineFee > 0;
      const matched = hasInline || !!joined;
      const fee = hasInline ? o.inlineFee : joined ? joined.total : 0;
      const feeSource = hasInline ? 'inline' : joined ? 'join' : null;
      const grossProfit = o.revenue - o.cogs;
      const netProfit = grossProfit - fee;
      return {
        ...o, fee, matched, feeSource, grossProfit, netProfit,
        margin: o.revenue ? (netProfit / o.revenue) * 100 : 0,
      };
    })
    .sort((a, b) => (a.monthKey < b.monthKey ? 1 : a.monthKey > b.monthKey ? -1 : b.revenue - a.revenue));

  const matchedRows = rows.filter((r) => r.matched);
  const sum = (arr, k) => arr.reduce((a, r) => a + r[k], 0);
  const totals = {
    orderCount: rows.length,
    matchedCount: matchedRows.length,
    pendingCount: rows.length - matchedRows.length,
    matchRate: rows.length ? (matchedRows.length / rows.length) * 100 : 0,
    revenue: sum(rows, 'revenue'),
    cogs: sum(rows, 'cogs'),
    matchedRevenue: sum(matchedRows, 'revenue'),
    matchedCogs: sum(matchedRows, 'cogs'),
    fees: sum(matchedRows, 'fee'),
  };
  totals.netProfit = totals.matchedRevenue - totals.matchedCogs - totals.fees;
  totals.netMargin = totals.matchedRevenue ? (totals.netProfit / totals.matchedRevenue) * 100 : 0;
  totals.hasOrderFees = orderFees.length > 0;

  return { rows, totals };
}
