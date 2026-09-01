// Cross-channel comparison + P&L helpers (framework-agnostic, testable).
import { monthKeyOf, monthLabel } from './format.js';

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// Aggregate saved TikTok imports per channel (optionally for one month).
export function channelCompare(imports, channels = [], month = '') {
  const scoped = month ? imports.filter((i) => i.month === month) : imports;
  const map = new Map();
  for (const im of scoped) {
    const key = im.channelId || 'none';
    const cur = map.get(key) || { channelId: im.channelId || '', files: 0, gmv: 0, est: 0, act: 0, clawback: 0, orders: 0, sold: 0, refund: 0 };
    cur.files += 1;
    cur.gmv += n(im.gmv); cur.est += n(im.estTotal); cur.act += n(im.actTotal);
    cur.clawback += n(im.clawback); cur.orders += n(im.orderCount);
    cur.sold += n(im.sold); cur.refund += n(im.refund);
    map.set(key, cur);
  }
  return [...map.values()]
    .map((c) => ({
      ...c,
      channel: channels.find((ch) => ch.id === c.channelId) || null,
      name: channels.find((ch) => ch.id === c.channelId)?.name || 'ไม่ระบุช่อง',
      clawbackPct: c.est ? (c.clawback / c.est) * 100 : 0,
      returnRatePct: c.sold ? (c.refund / c.sold) * 100 : 0,
      roi: c.gmv ? (c.act / c.gmv) * 100 : 0, // commission yield on GMV
    }))
    .sort((a, b) => b.act - a.act);
}

// Months present across imports + expenses (newest first).
export function financeMonths(imports = [], expenses = []) {
  const set = new Set();
  imports.forEach((i) => i.month && set.add(i.month));
  expenses.forEach((e) => e.month && set.add(e.month));
  return [...set].filter(Boolean).sort().reverse();
}

// P&L: revenue (actual TikTok commission) − wages − ad spend − other expenses.
// adSpend is the daily ค่าแอด logged in Sales, passed in by the view.
export function computeProfit({ imports = [], expenses = [], wages = 0, adSpend = 0, month = '' }) {
  const revenue = (month ? imports.filter((i) => i.month === month) : imports).reduce((a, i) => a + n(i.actTotal), 0);
  const expenseTotal = (month ? expenses.filter((e) => e.month === month) : expenses).reduce((a, e) => a + n(e.amount), 0);
  const w = n(wages);
  const ad = n(adSpend);
  const profit = revenue - w - ad - expenseTotal;
  return {
    revenue,
    wages: w,
    adSpend: ad,
    expenses: expenseTotal,
    cost: w + ad + expenseTotal,
    profit,
    marginPct: revenue ? (profit / revenue) * 100 : 0,
  };
}

// Monthly P&L trend: one row per month with revenue/cost/profit.
// wagesFor(month) is supplied by the caller (payroll lives in payroll.js).
export function monthlyPnl({ sales = [], imports = [], expenses = [], wagesFor = () => 0 }) {
  const months = new Set();
  imports.forEach((i) => i.month && months.add(i.month));
  expenses.forEach((e) => e.month && months.add(e.month));
  sales.forEach((s) => { const m = monthKeyOf(s.date); if (m) months.add(m); });
  return [...months].sort().map((month) => {
    const revenue = imports.filter((i) => i.month === month).reduce((a, i) => a + n(i.actTotal), 0);
    const adSpend = sales.filter((s) => monthKeyOf(s.date) === month).reduce((a, s) => a + n(s.adCost), 0);
    const expenseTotal = expenses.filter((e) => e.month === month).reduce((a, e) => a + n(e.amount), 0);
    const wages = n(wagesFor(month));
    const cost = wages + adSpend + expenseTotal;
    return { month, label: monthLabel(month), revenue, wages, adSpend, expenses: expenseTotal, cost, profit: revenue - cost };
  });
}

// Per-channel contribution: revenue (actual commission) − ad spend − channel-tagged
// expenses. (Company-wide wages are not split per channel.)
export function channelPnl({ imports = [], sales = [], expenses = [], channels = [], month = '' }) {
  const add = (map, key, v) => map.set(key, (map.get(key) || 0) + v);
  const rev = new Map(), ad = new Map(), exp = new Map();
  (month ? imports.filter((i) => i.month === month) : imports).forEach((i) => add(rev, i.channelId, n(i.actTotal)));
  sales.filter((s) => !month || monthKeyOf(s.date) === month).forEach((s) => s.channelId && add(ad, s.channelId, n(s.adCost)));
  (month ? expenses.filter((e) => e.month === month) : expenses).forEach((e) => e.channelId && add(exp, e.channelId, n(e.amount)));
  const ids = [...new Set([...rev.keys(), ...ad.keys(), ...exp.keys()].filter(Boolean))];
  return ids.map((id) => {
    const revenue = rev.get(id) || 0, adSpend = ad.get(id) || 0, expense = exp.get(id) || 0;
    const contribution = revenue - adSpend - expense;
    return {
      channelId: id,
      name: channels.find((c) => c.id === id)?.name || 'ไม่ระบุช่อง',
      revenue, adSpend, expense, contribution,
      roi: adSpend > 0 ? (revenue / adSpend) : null,
    };
  }).sort((a, b) => b.contribution - a.contribution);
}

// Expenses grouped by category (for the P&L breakdown).
export function expensesByCategory(expenses = [], month = '') {
  const scoped = month ? expenses.filter((e) => e.month === month) : expenses;
  const map = new Map();
  for (const e of scoped) {
    const cat = e.category || 'อื่น ๆ';
    map.set(cat, (map.get(cat) || 0) + n(e.amount));
  }
  return [...map.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);
}
