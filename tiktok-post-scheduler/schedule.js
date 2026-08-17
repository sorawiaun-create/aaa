// schedule.js — ตรรกะ "กระจายเวลาโพสต์" แบบบริสุทธิ์ (ไม่พึ่ง chrome/DOM)
// แยกออกมาเพื่อทดสอบได้ด้วย node --test
//
// แนวคิด: รับจำนวนคลิป + กติกา (โพสต์กี่ตัว/วัน, ช่วงเวลาที่โพสต์ได้, เว้นระยะขั้นต่ำ,
// สุ่ม jitter) แล้วคืน timestamp (ms) ของแต่ละคลิป โดย "ทยอย" ไม่ยิงรวด

/**
 * สร้างตารางเวลาโพสต์
 * @param {number} count จำนวนคลิปที่จะจัดคิว
 * @param {object} opts
 *   - startMs {number}      เวลาเริ่ม (epoch ms) — ผู้เรียกส่งเข้ามาเพื่อให้ test คุมได้
 *   - perDay {number}       โพสต์กี่คลิปต่อวัน (ต่อช่อง)
 *   - dayStartHour {number} ชั่วโมงเริ่มโพสต์ในแต่ละวัน (0–23, ตามเวลาเครื่อง)
 *   - dayEndHour {number}   ชั่วโมงสุดท้ายที่ยอมให้โพสต์ (0–23)
 *   - minGapMin {number}    เว้นระยะขั้นต่ำระหว่างโพสต์ (นาที)
 *   - jitterMin {number}    สุ่มบวกเวลาได้สูงสุดกี่นาที (ทำให้ดูเป็นธรรมชาติ)
 * @param {() => number} rng ฟังก์ชันสุ่ม 0..1 (ฉีดเข้ามาได้เพื่อ test)
 * @returns {number[]} รายการ epoch ms เรียงจากน้อยไปมาก
 */
export function buildSchedule(count, opts = {}, rng = Math.random) {
  const {
    startMs,
    perDay = 12,
    dayStartHour = 9,
    dayEndHour = 21,
    minGapMin = 25,
    jitterMin = 7,
  } = opts;

  if (!Number.isFinite(startMs)) throw new Error('startMs is required');
  if (count <= 0) return [];
  if (perDay < 1) throw new Error('perDay must be >= 1');
  if (dayEndHour <= dayStartHour) throw new Error('dayEndHour must be > dayStartHour');

  const windowMin = (dayEndHour - dayStartHour) * 60;
  // ระยะห่างฐานต่อโพสต์ในหนึ่งวัน (กระจายให้เต็มหน้าต่างเวลา)
  const baseGapMin = Math.max(minGapMin, Math.floor(windowMin / perDay));

  const out = [];
  let day = startOfDay(startMs);
  let dayIndex = 0;

  while (out.length < count) {
    const slotBase = day + (dayStartHour * 60 + dayIndex * baseGapMin) * 60_000;
    const jitter = Math.floor(rng() * (jitterMin + 1)) * 60_000;
    let t = slotBase + jitter;

    // อย่าให้เลยชั่วโมงสิ้นสุดของวัน และอย่าย้อนอดีตกว่า startMs
    const dayEndMs = day + dayEndHour * 60 * 60_000;
    if (t > dayEndMs || dayIndex >= perDay) {
      day = startOfDay(day + 24 * 60 * 60_000); // ขึ้นวันใหม่
      dayIndex = 0;
      continue;
    }
    if (t < startMs) t = startMs;

    // รักษาเว้นระยะขั้นต่ำจากตัวก่อนหน้า
    const prev = out[out.length - 1];
    if (prev !== undefined && t - prev < minGapMin * 60_000) {
      t = prev + minGapMin * 60_000;
      if (t > dayEndMs) {
        day = startOfDay(day + 24 * 60 * 60_000);
        dayIndex = 0;
        continue;
      }
    }

    out.push(t);
    dayIndex += 1;
  }

  return out;
}

/** ปัดลงไปที่ 00:00 ของวันนั้น (ตามเวลาท้องถิ่นของเครื่อง) */
export function startOfDay(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** ตัวช่วยสรุปว่าแต่ละวันจะโพสต์กี่ตัว (ไว้โชว์ใน UI/ทดสอบ) */
export function countPerDay(schedule) {
  const map = new Map();
  for (const ms of schedule) {
    const key = startOfDay(ms);
    map.set(key, (map.get(key) || 0) + 1);
  }
  return map;
}
