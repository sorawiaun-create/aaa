import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  commissionFor, planFor, basePayFor, daysWorkedFor,
  computePayroll, computeChannelStats, computeOverview, computeTeamStats,
} from '../src/lib/payroll.js';
import { hoursBetween } from '../src/lib/format.js';

// --- hoursBetween (live duration) ---
test('hoursBetween: same-day duration', () => {
  assert.equal(hoursBetween('20:00', '23:30'), 3.5);
  assert.equal(hoursBetween('18:00', '21:00'), 3);
});
test('hoursBetween: crosses midnight', () => {
  assert.equal(hoursBetween('22:00', '01:00'), 3);
  assert.equal(hoursBetween('20:00', '00:00'), 4);
});
test('hoursBetween: blank/invalid → 0', () => {
  assert.equal(hoursBetween('', '23:00'), 0);
  assert.equal(hoursBetween('20:00', ''), 0);
  assert.equal(hoursBetween(null, null), 0);
});

// --- commissionFor ---
test('flat commission = rate% of amount', () => {
  assert.equal(commissionFor(100000, { type: 'flat', rate: 3 }), 3000);
});

test('none / zero / missing plan → 0', () => {
  assert.equal(commissionFor(100000, { type: 'none' }), 0);
  assert.equal(commissionFor(0, { type: 'flat', rate: 5 }), 0);
  assert.equal(commissionFor(100000, null), 0);
});

test('tiered commission is progressive (marginal)', () => {
  const plan = { type: 'tiered', tiers: [{ from: 0, rate: 3 }, { from: 100000, rate: 5 }] };
  // 100,000 * 3% + 50,000 * 5% = 3000 + 2500 = 5500
  assert.equal(commissionFor(150000, plan), 5500);
  // exactly at threshold → only first bracket
  assert.equal(commissionFor(100000, plan), 3000);
  // below first meaningful bracket
  assert.equal(commissionFor(40000, plan), 1200);
});

test('tiered handles unsorted tiers and a non-zero first threshold', () => {
  const plan = { type: 'tiered', tiers: [{ from: 100000, rate: 5 }, { from: 0, rate: 3 }] };
  assert.equal(commissionFor(150000, plan), 5500);
  // first threshold above 0: portion below earns nothing
  const plan2 = { type: 'tiered', tiers: [{ from: 50000, rate: 10 }] };
  assert.equal(commissionFor(80000, plan2), 3000); // (80000-50000)*10%
  assert.equal(commissionFor(30000, plan2), 0);
});

// --- planFor ---
test('planFor uses own plan, falls back to settings default', () => {
  const settings = { defaultCommission: { type: 'flat', rate: 2 } };
  assert.deepEqual(planFor({ pay: { commission: { type: 'flat', rate: 7 } } }, settings), { type: 'flat', rate: 7 });
  assert.deepEqual(planFor({ pay: {} }, settings), { type: 'flat', rate: 2 });
  assert.deepEqual(planFor({}, {}), { type: 'none' });
});

// --- basePayFor ---
test('base pay: monthly is flat, daily scales with days', () => {
  assert.equal(basePayFor({ pay: { baseType: 'monthly', baseAmount: 18000 } }, 20), 18000);
  assert.equal(basePayFor({ pay: { baseType: 'daily', baseAmount: 500 } }, 12), 6000);
  assert.equal(basePayFor({ pay: { baseType: 'none' } }, 30), 0);
});

// --- daysWorkedFor ---
test('daysWorked counts distinct dates, excludes absent', () => {
  const logs = [
    { employeeId: 'e1', date: '01/07/2026', status: 'present' },
    { employeeId: 'e1', date: '01/07/2026', status: 'present' }, // dup date
    { employeeId: 'e1', date: '02/07/2026', status: 'present' },
    { employeeId: 'e1', date: '03/07/2026', status: 'absent' },
    { employeeId: 'e2', date: '02/07/2026', status: 'present' },
  ];
  assert.equal(daysWorkedFor('e1', logs, '2026-07'), 2);
  assert.equal(daysWorkedFor('e1', logs, null), 2);
});

// --- computePayroll (integration) ---
test('payroll: base + commission + KPI bonus, sorted by total', () => {
  const employees = [
    { id: 'e1', name: 'A', teamId: 't1', kpiTarget: 200000, pay: { baseType: 'monthly', baseAmount: 18000, commission: { type: 'flat', rate: 5 }, kpiBonus: 5000, adjust: 0 } },
    { id: 'e2', name: 'B', teamId: 't1', kpiTarget: 0, pay: { baseType: 'daily', baseAmount: 500, commission: { type: 'none' }, kpiBonus: 0, adjust: -200 } },
  ];
  const sales = [
    { employeeId: 'e1', date: '01/07/2026', sales: 150000 },
    { employeeId: 'e1', date: '02/07/2026', sales: 100000 }, // total 250k → beats 200k KPI
    { employeeId: 'e2', date: '01/07/2026', sales: 999999 },
  ];
  const workLogs = [
    { employeeId: 'e2', date: '01/07/2026', status: 'present' },
    { employeeId: 'e2', date: '02/07/2026', status: 'present' },
  ];
  const rows = computePayroll({ employees, sales, workLogs, settings: {}, monthKey: '2026-07' });

  const e1 = rows.find((r) => r.employee.id === 'e1');
  assert.equal(e1.salesTotal, 250000);
  assert.equal(e1.base, 18000);
  assert.equal(e1.commission, 12500); // 250000 * 5%
  assert.equal(e1.kpiHit, true);
  assert.equal(e1.kpiBonus, 5000);
  assert.equal(e1.total, 35500);

  const e2 = rows.find((r) => r.employee.id === 'e2');
  assert.equal(e2.base, 1000); // 500 * 2 days
  assert.equal(e2.commission, 0);
  assert.equal(e2.adjust, -200);
  assert.equal(e2.total, 800);

  // sorted by total desc
  assert.equal(rows[0].employee.id, 'e1');
});

test('payroll month filter isolates a month', () => {
  const employees = [{ id: 'e1', name: 'A', pay: { baseType: 'none', commission: { type: 'flat', rate: 10 } } }];
  const sales = [
    { employeeId: 'e1', date: '15/06/2026', sales: 100000 },
    { employeeId: 'e1', date: '15/07/2026', sales: 50000 },
  ];
  const jul = computePayroll({ employees, sales, workLogs: [], settings: {}, monthKey: '2026-07' });
  assert.equal(jul[0].salesTotal, 50000);
  assert.equal(jul[0].commission, 5000);
  const all = computePayroll({ employees, sales, workLogs: [], settings: {}, monthKey: null });
  assert.equal(all[0].salesTotal, 150000);
});

// --- computeChannelStats ---
test('channel stats aggregate and compute ROAS, sorted by sales', () => {
  const channels = [{ id: 'c1', name: 'C1', status: 'active' }, { id: 'c2', name: 'C2', status: 'paused' }];
  const sales = [
    { channelId: 'c1', date: '01/07/2026', sales: 300000, adCost: 15000, baseCommission: 9000, actualReceived: 290000 },
    { channelId: 'c1', date: '02/07/2026', sales: 100000, adCost: 5000, baseCommission: 3000, actualReceived: 95000 },
    { channelId: 'c2', date: '01/07/2026', sales: 50000, adCost: 0, baseCommission: 1500, actualReceived: 48000 },
  ];
  const stats = computeChannelStats({ channels, sales, monthKey: '2026-07' });
  assert.equal(stats[0].channel.id, 'c1');
  assert.equal(stats[0].salesTotal, 400000);
  assert.equal(stats[0].adCost, 20000);
  assert.equal(stats[0].roas, 20); // 400000 / 20000
  // zero ad → null ROAS (avoid divide-by-zero)
  assert.equal(stats[1].roas, null);
});

// --- computeOverview ---
test('overview totals + active channel count', () => {
  const channels = [{ id: 'c1', status: 'active' }, { id: 'c2', status: 'active' }, { id: 'c3', status: 'closed' }];
  const sales = [
    { channelId: 'c1', date: '01/07/2026', sales: 100000, adCost: 5000, baseCommission: 3000, actualReceived: 96000 },
    { channelId: 'c2', date: '01/06/2026', sales: 999, adCost: 1, baseCommission: 1, actualReceived: 1 },
  ];
  const o = computeOverview({ channels, sales, monthKey: '2026-07' });
  assert.equal(o.totalSales, 100000);
  assert.equal(o.activeChannels, 2);
  assert.equal(o.totalChannels, 3);
  assert.equal(o.roas, 20);
});

// --- computeTeamStats ---
test('team stats sum member channels vs target', () => {
  const teams = [{ id: 't1', name: 'T1', targetSales: 200000 }];
  const channels = [{ id: 'c1', teamId: 't1' }, { id: 'c2', teamId: 't1' }, { id: 'c3', teamId: 't2' }];
  const employees = [{ id: 'e1', teamId: 't1' }, { id: 'e2', teamId: 't1' }];
  const sales = [
    { channelId: 'c1', date: '01/07/2026', sales: 120000 },
    { channelId: 'c2', date: '01/07/2026', sales: 30000 },
    { channelId: 'c3', date: '01/07/2026', sales: 500000 }, // other team, excluded
  ];
  const [s] = computeTeamStats({ teams, channels, sales, employees, monthKey: '2026-07' });
  assert.equal(s.salesTotal, 150000);
  assert.equal(s.channelCount, 2);
  assert.equal(s.memberCount, 2);
  assert.equal(s.pct, 75);
});
