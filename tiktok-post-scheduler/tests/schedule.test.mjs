import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSchedule, countPerDay, startOfDay } from '../schedule.js';

// rng คงที่ = 0 เพื่อให้ผลลัพธ์ทำนายได้
const zeroRng = () => 0;

test('คืนค่าว่างเมื่อ count <= 0', () => {
  assert.deepEqual(buildSchedule(0, { startMs: Date.parse('2026-08-17T00:00:00') }), []);
});

test('จำนวน timestamp เท่ากับจำนวนคลิป', () => {
  const s = buildSchedule(50, { startMs: Date.parse('2026-08-17T00:00:00'), perDay: 10 }, zeroRng);
  assert.equal(s.length, 50);
});

test('เรียงจากน้อยไปมากเสมอ', () => {
  const s = buildSchedule(40, { startMs: Date.parse('2026-08-17T00:00:00'), perDay: 8 }, zeroRng);
  for (let i = 1; i < s.length; i++) assert.ok(s[i] >= s[i - 1], `index ${i} ไม่เรียง`);
});

test('เคารพเว้นระยะขั้นต่ำระหว่างโพสต์', () => {
  const minGapMin = 30;
  const s = buildSchedule(30, { startMs: Date.parse('2026-08-17T00:00:00'), perDay: 12, minGapMin }, zeroRng);
  for (let i = 1; i < s.length; i++) {
    const sameDay = startOfDay(s[i]) === startOfDay(s[i - 1]);
    if (sameDay) assert.ok(s[i] - s[i - 1] >= minGapMin * 60_000, `ช่องว่างน้อยกว่า ${minGapMin} นาที`);
  }
});

test('ไม่โพสต์เกิน perDay ต่อวัน', () => {
  const perDay = 10;
  const s = buildSchedule(45, { startMs: Date.parse('2026-08-17T00:00:00'), perDay }, zeroRng);
  for (const [, n] of countPerDay(s)) assert.ok(n <= perDay, `วันหนึ่งเกิน ${perDay} ตัว`);
});

test('ทุกโพสต์อยู่ในหน้าต่างเวลาที่กำหนด', () => {
  const dayStartHour = 9, dayEndHour = 21;
  const s = buildSchedule(40, { startMs: Date.parse('2026-08-17T00:00:00'), perDay: 8, dayStartHour, dayEndHour, jitterMin: 0 }, zeroRng);
  for (const ms of s) {
    const h = new Date(ms).getHours();
    assert.ok(h >= dayStartHour && h <= dayEndHour, `ชั่วโมง ${h} อยู่นอกช่วง`);
  }
});
