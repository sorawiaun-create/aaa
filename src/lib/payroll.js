// --- Calculation engine: commission, employee pay, KPI, channel stats ---
// Framework-agnostic and unit-testable (no React / DOM here).
import { monthKeyOf } from './format.js';

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const sumBy = (rows, key) => rows.reduce((acc, r) => acc + num(r[key]), 0);

// A commission plan:
//   { type: 'none' }                              → no commission
//   { type: 'flat',   rate }                      → rate% of the whole amount
//   { type: 'tiered', tiers: [{ from, rate }] }   → progressive brackets
//
// Tiered is PROGRESSIVE (marginal): each tier's rate applies only to the slice
// of sales at or above its `from` threshold, up to the next tier's `from`.
// e.g. tiers [{from:0,rate:3},{from:100000,rate:5}] on ฿150,000:
//   100,000 × 3%  +  50,000 × 5%  =  3,000 + 2,500 = ฿5,500
export function commissionFor(salesAmount, plan) {
  const amt = num(salesAmount);
  if (!plan || plan.type === 'none' || amt <= 0) return 0;

  if (plan.type === 'flat') return (amt * num(plan.rate)) / 100;

  if (plan.type === 'tiered') {
    const tiers = [...(plan.tiers || [])]
      .map((t) => ({ from: num(t.from), rate: num(t.rate) }))
      .sort((a, b) => a.from - b.from);
    if (!tiers.length) return 0;
    let total = 0;
    for (let i = 0; i < tiers.length; i++) {
      const from = tiers[i].from;
      const to = i + 1 < tiers.length ? tiers[i + 1].from : Infinity;
      if (amt > from) total += (Math.min(amt, to) - from) * (tiers[i].rate / 100);
    }
    return total;
  }
  return 0;
}

// Resolve which commission plan applies to an employee (own plan, else the
// company default from settings).
export function planFor(employee, settings) {
  const own = employee?.pay?.commission;
  if (own && own.type && own.type !== 'inherit') return own;
  return settings?.defaultCommission || { type: 'none' };
}

// Base pay for a period:
//   monthly → full base amount (regardless of days)
//   daily   → daily rate × days worked
//   none    → 0
export function basePayFor(employee, daysWorked) {
  const pay = employee?.pay || {};
  const amount = num(pay.baseAmount);
  if (pay.baseType === 'monthly') return amount;
  if (pay.baseType === 'daily') return amount * num(daysWorked);
  return 0;
}

// Distinct worked days for an employee in the (optional) month, excluding
// days explicitly logged as 'absent'.
export function daysWorkedFor(employeeId, workLogs, monthKey) {
  const days = new Set();
  workLogs.forEach((w) => {
    if (w.employeeId !== employeeId) return;
    if (monthKey && monthKeyOf(w.date) !== monthKey) return;
    if (w.status === 'absent') return;
    days.add(w.date);
  });
  return days.size;
}

// Full payroll for a month (monthKey = 'YYYY-MM', or null for all-time).
// Returns one row per employee with the pay breakdown.
export function computePayroll({ employees, sales, workLogs, settings, monthKey }) {
  return employees
    .map((emp) => {
      const empSales = sales.filter(
        (s) => s.employeeId === emp.id && (!monthKey || monthKeyOf(s.date) === monthKey)
      );
      const salesTotal = sumBy(empSales, 'sales');
      const daysWorked = daysWorkedFor(emp.id, workLogs, monthKey);
      const base = basePayFor(emp, daysWorked);
      const plan = planFor(emp, settings);
      const commission = commissionFor(salesTotal, plan);

      const kpiTarget = num(emp.kpiTarget);
      const kpiPct = kpiTarget > 0 ? (salesTotal / kpiTarget) * 100 : null;
      const kpiHit = kpiTarget > 0 && salesTotal >= kpiTarget;
      const kpiBonus = kpiHit ? num(emp.pay?.kpiBonus) : 0;
      const adjust = num(emp.pay?.adjust); // manual +/- (deductions, extras)

      const total = base + commission + kpiBonus + adjust;
      return {
        employee: emp,
        salesTotal,
        records: empSales.length,
        daysWorked,
        base,
        commission,
        plan,
        kpiTarget,
        kpiPct,
        kpiHit,
        kpiBonus,
        adjust,
        total,
      };
    })
    .sort((a, b) => b.total - a.total);
}

// Per-channel stats for a month (or all-time), ranked by sales desc.
export function computeChannelStats({ channels, sales, employees = [], teams = [], monthKey }) {
  return channels
    .map((ch) => {
      const chSales = sales.filter(
        (s) => s.channelId === ch.id && (!monthKey || monthKeyOf(s.date) === monthKey)
      );
      const salesTotal = sumBy(chSales, 'sales');
      const adCost = sumBy(chSales, 'adCost');
      const baseCommission = sumBy(chSales, 'baseCommission');
      const actualReceived = sumBy(chSales, 'actualReceived');
      const roas = adCost > 0 ? salesTotal / adCost : null;
      return {
        channel: ch,
        owner: employees.find((e) => e.id === ch.ownerId) || null,
        team: teams.find((t) => t.id === ch.teamId) || null,
        records: chSales.length,
        salesTotal,
        adCost,
        baseCommission,
        actualReceived,
        roas,
      };
    })
    .sort((a, b) => b.salesTotal - a.salesTotal);
}

// Top-line overview totals.
export function computeOverview({ channels, sales, monthKey }) {
  const scoped = monthKey ? sales.filter((s) => monthKeyOf(s.date) === monthKey) : sales;
  const totalSales = sumBy(scoped, 'sales');
  const totalAd = sumBy(scoped, 'adCost');
  const totalCommission = sumBy(scoped, 'baseCommission');
  const totalReceived = sumBy(scoped, 'actualReceived');
  return {
    totalSales,
    totalAd,
    totalCommission,
    totalReceived,
    roas: totalAd > 0 ? totalSales / totalAd : null,
    activeChannels: channels.filter((c) => c.status === 'active').length,
    totalChannels: channels.length,
    records: scoped.length,
  };
}

// Team progress vs target for a month.
export function computeTeamStats({ teams, channels, sales, employees = [], monthKey }) {
  return teams.map((team) => {
    const teamChannelIds = new Set(channels.filter((c) => c.teamId === team.id).map((c) => c.id));
    const teamSales = sales.filter(
      (s) => teamChannelIds.has(s.channelId) && (!monthKey || monthKeyOf(s.date) === monthKey)
    );
    const salesTotal = sumBy(teamSales, 'sales');
    const target = num(team.targetSales);
    return {
      team,
      leader: employees.find((e) => e.id === team.leaderId) || null,
      memberCount: employees.filter((e) => e.teamId === team.id).length,
      channelCount: teamChannelIds.size,
      salesTotal,
      target,
      pct: target > 0 ? (salesTotal / target) * 100 : null,
    };
  });
}

// Sorted list of 'YYYY-MM' month keys present in the data (newest first).
export function monthOptionsFrom(...recordLists) {
  const set = new Set();
  recordLists.forEach((list) =>
    (list || []).forEach((r) => {
      const mk = monthKeyOf(r.date);
      if (mk) set.add(mk);
    })
  );
  return [...set].sort().reverse();
}
