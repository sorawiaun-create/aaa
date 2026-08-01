// Demo dataset — realistic Thai TikTok Live affiliate operation.
// Loaded from Settings → "โหลดข้อมูลตัวอย่าง".
import { hoursBetween } from './format.js';

export function buildSampleData() {
  const teams = [
    { id: 'team-a', name: 'ทีม A — บิวตี้', targetSales: 5000000, leaderId: 'emp-1', note: 'ครีม/สกินแคร์' },
    { id: 'team-b', name: 'ทีม B — แฟชั่น', targetSales: 3000000, leaderId: 'emp-3', note: 'เสื้อผ้า/กระเป๋า' },
  ];

  const employees = [
    {
      id: 'emp-1', name: 'สมชาย ใจดี', nickname: 'ชาย', role: 'หัวหน้าไลฟ์', teamId: 'team-a', active: true,
      kpiTarget: 2000000,
      pay: { baseType: 'monthly', baseAmount: 18000, commission: { type: 'tiered', tiers: [{ from: 0, rate: 3 }, { from: 1000000, rate: 5 }] }, kpiBonus: 5000, adjust: 0 },
    },
    {
      id: 'emp-2', name: 'สุดา แสงทอง', nickname: 'ดา', role: 'แม่ค้าไลฟ์', teamId: 'team-a', active: true,
      kpiTarget: 1500000,
      pay: { baseType: 'daily', baseAmount: 500, commission: { type: 'flat', rate: 4 }, kpiBonus: 3000, adjust: 0 },
    },
    {
      id: 'emp-3', name: 'อนุชา พรหมมา', nickname: 'ต้น', role: 'หัวหน้าไลฟ์', teamId: 'team-b', active: true,
      kpiTarget: 1200000,
      pay: { baseType: 'monthly', baseAmount: 16000, commission: { type: 'flat', rate: 3.5 }, kpiBonus: 4000, adjust: 0 },
    },
    {
      id: 'emp-4', name: 'ปนัดดา ศรีสุข', nickname: 'ปุ๊ก', role: 'แม่ค้าไลฟ์', teamId: 'team-b', active: true,
      kpiTarget: 800000,
      pay: { baseType: 'daily', baseAmount: 450, commission: { type: 'flat', rate: 4 }, kpiBonus: 2000, adjust: 0 },
    },
    {
      id: 'emp-5', name: 'กิตติ วงศ์ทอง', nickname: 'กิต', role: 'แอดมิน/ยิงแอด', teamId: 'team-a', active: true,
      kpiTarget: 0,
      pay: { baseType: 'monthly', baseAmount: 15000, commission: { type: 'none' }, kpiBonus: 0, adjust: 0 },
    },
  ];

  const channels = [
    { id: 'ch-1', name: '@beautyglow.official', status: 'active', ownerId: 'emp-1', teamId: 'team-a', note: 'ช่องหลัก' },
    { id: 'ch-2', name: '@sudabeauty', status: 'active', ownerId: 'emp-2', teamId: 'team-a', note: '' },
    { id: 'ch-3', name: '@fashionista.th', status: 'active', ownerId: 'emp-3', teamId: 'team-b', note: '' },
    { id: 'ch-4', name: '@pukshop', status: 'active', ownerId: 'emp-4', teamId: 'team-b', note: '' },
    { id: 'ch-5', name: '@glow.backup', status: 'active', ownerId: 'emp-1', teamId: 'team-a', note: 'ช่องสำรอง' },
    { id: 'ch-6', name: '@dealsdaily.th', status: 'paused', ownerId: 'emp-5', teamId: 'team-a', note: 'พักปรับกลยุทธ์' },
  ];

  // A few days of daily sales entries in July 2026.
  // [channel, employee, date, sales, ad, commission, received, product, start, end]
  const raw = [
    ['ch-1', 'emp-1', '01/07/2026', 320000, 14000, 9600, 305000, 'เซรั่มวิตซี, ครีมกันแดด', '20:00', '23:30'],
    ['ch-1', 'emp-1', '02/07/2026', 410000, 16000, 14300, 392000, 'เซตบำรุงผิว', '20:00', '00:00'],
    ['ch-1', 'emp-1', '03/07/2026', 528000, 18500, 21400, 505000, 'เซรั่ม + มาส์ก', '19:30', '23:30'],
    ['ch-2', 'emp-2', '01/07/2026', 145000, 6200, 5800, 139000, 'ลิปสติก', '18:00', '21:00'],
    ['ch-2', 'emp-2', '02/07/2026', 168000, 7100, 6720, 160000, 'รองพื้น, ลิป', '18:00', '21:30'],
    ['ch-2', 'emp-2', '03/07/2026', 132000, 5800, 5280, 126000, 'พาเลทตา', '18:30', '21:00'],
    ['ch-3', 'emp-3', '01/07/2026', 210000, 9800, 7350, 200000, 'เดรสออกงาน', '19:00', '22:00'],
    ['ch-3', 'emp-3', '02/07/2026', 188000, 8600, 6580, 179000, 'กระเป๋าสะพาย', '19:00', '22:30'],
    ['ch-4', 'emp-4', '01/07/2026', 96000, 4200, 3840, 91000, 'เสื้อยืดโอเวอร์ไซส์', '17:00', '20:00'],
    ['ch-4', 'emp-4', '02/07/2026', 112000, 4900, 4480, 107000, 'กางเกงยีนส์', '17:00', '20:30'],
    ['ch-5', 'emp-1', '02/07/2026', 78000, 3600, 2340, 74000, 'ครีมกันแดด', '13:00', '15:00'],
    ['ch-5', 'emp-1', '03/07/2026', 88000, 4100, 2640, 84000, 'มาส์กหน้า', '13:00', '15:30'],
  ];
  const sales = raw.map(([channelId, employeeId, date, s, ad, comm, recv, product, startTime, endTime], i) => ({
    id: `sale-${i + 1}`,
    channelId,
    employeeId,
    date,
    product,
    startTime,
    endTime,
    hours: hoursBetween(startTime, endTime),
    sales: s,
    adCost: ad,
    baseCommission: comm,
    actualReceived: recv,
    note: '',
  }));

  // Attendance for the same three days (drives daily-rate base pay).
  const workLogs = [];
  let wid = 1;
  // A couple of demo leaves so the deduction column is visible.
  const leaves = { 'emp-3|03/07/2026': 'absent', 'emp-5|02/07/2026': 'half' };
  ['01/07/2026', '02/07/2026', '03/07/2026'].forEach((date) => {
    employees.forEach((emp) => {
      const status = leaves[`${emp.id}|${date}`] || 'present';
      workLogs.push({ id: `wl-${wid++}`, employeeId: emp.id, channelId: '', date, shift: 'บ่าย-ค่ำ', status, note: status === 'absent' ? 'ลากิจ' : '' });
    });
  });

  return { teams, employees, channels, sales, workLogs, settings: {} };
}
