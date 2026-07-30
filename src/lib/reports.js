// Aggregations for the Reports view (framework-agnostic, testable).
import { monthKeyOf, monthLabel } from './format.js';

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// Daily series for one month: [{ day, dayNum, sales, adCost, received }]
export function salesByDay(sales, monthKey) {
  const scoped = sales.filter((s) => (!monthKey || monthKeyOf(s.date) === monthKey));
  const map = new Map();
  scoped.forEach((s) => {
    const day = String(s.date || '').split('/')[0] || '?';
    const cur = map.get(day) || { day, dayNum: parseInt(day, 10) || 0, sales: 0, adCost: 0, received: 0 };
    cur.sales += num(s.sales);
    cur.adCost += num(s.adCost);
    cur.received += num(s.actualReceived);
    map.set(day, cur);
  });
  return [...map.values()].sort((a, b) => a.dayNum - b.dayNum);
}

// Monthly series across all data: [{ key, label, sales, adCost, growth }]
export function salesByMonth(sales) {
  const map = new Map();
  sales.forEach((s) => {
    const key = monthKeyOf(s.date);
    if (!key) return;
    const cur = map.get(key) || { key, label: monthLabel(key), sales: 0, adCost: 0 };
    cur.sales += num(s.sales);
    cur.adCost += num(s.adCost);
    map.set(key, cur);
  });
  const rows = [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
  rows.forEach((r, i) => {
    const prev = rows[i - 1]?.sales;
    r.growth = prev ? ((r.sales - prev) / prev) * 100 : null;
  });
  return rows;
}

// Share of sales by team: [{ name, value }] (channels with no team → "ไม่มีทีม")
export function salesByTeam(teams, channels, sales, monthKey) {
  const teamOfChannel = new Map(channels.map((c) => [c.id, c.teamId]));
  const nameOfTeam = new Map(teams.map((t) => [t.id, t.name]));
  const totals = new Map();
  sales
    .filter((s) => (!monthKey || monthKeyOf(s.date) === monthKey))
    .forEach((s) => {
      const teamId = teamOfChannel.get(s.channelId);
      const name = nameOfTeam.get(teamId) || 'ไม่มีทีม';
      totals.set(name, (totals.get(name) || 0) + num(s.sales));
    });
  return [...totals.entries()]
    .map(([name, value]) => ({ name, value }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);
}
