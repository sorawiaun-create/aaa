// --- Shopee product scoring engine ---
// คัดกรองสินค้า Shopee ว่า "ตัวไหนคุ้มที่จะจ่ายค่าโฆษณา Facebook ไปหาคนซื้อ"
// คำถามหลักไม่ใช่ "ลดเยอะไหม" แต่คือ "ยิงแล้วเหลือกำไรไหม"
//
// ทุกฟังก์ชันในไฟล์นี้เป็น pure function (ไม่แตะ DOM / เน็ต) เพื่อให้เทสต์ได้ตรง ๆ

// น้ำหนักคะแนนแต่ละปัจจัย รวม 100
export const DEFAULT_WEIGHTS = {
  discount: 30,   // ส่วนลด
  priceBand: 25,  // ช่วงราคา
  rounds: 15,     // จำนวนรอบดีลที่ขึ้น
  category: 12,   // หมวดหมู่
  midnight: 10,   // มีรอบเที่ยงคืน
  commission: 8,  // คอมต่อชิ้น
};

export const FACTOR_LABELS = {
  discount: 'ส่วนลด',
  priceBand: 'ช่วงราคา',
  rounds: 'จำนวนรอบที่ขึ้น',
  category: 'หมวดหมู่',
  midnight: 'รอบเที่ยงคืน',
  commission: 'คอมต่อชิ้น',
};

export const FACTOR_HINTS = {
  discount: 'ตัวหยุดนิ้วคนดู เริ่มนับที่ 30% เต็มที่ 70% ขึ้นไป',
  priceBand: '฿300–999 ได้เต็ม เพราะคอมคุ้มค่าคลิกและตัดสินใจไว',
  rounds: 'ขึ้นหลายรอบ = คลิปตัวเดียวยิงได้หลายวัน ต้นทุนต่อออเดอร์ถูกลง',
  category: 'ของใช้ในบ้าน เครื่องใช้ไฟฟ้า ความงาม สัตว์เลี้ยง มาก่อนเสื้อผ้าที่ยกเลิกสูง',
  midnight: 'มีรอบ 00:00 ได้เปรียบ เพราะออเดอร์เข้าหนาที่สุดชั่วโมงแรก',
  commission: 'ประเมินที่ 5% ถ้าต่ำกว่า ฿7 ต่อออเดอร์แทบไม่เหลือกำไร',
};

// เกณฑ์ตัดเกรด (คะแนนขั้นต่ำของแต่ละเกรด)
export const DEFAULT_GRADE_CUTS = { A: 75, B: 60, C: 40 };

export const GRADE_META = {
  A: { label: 'ยิงได้เลย', hint: 'ส่วนลดแรง ราคาปิดง่าย มีหลายรอบให้ยิง', tone: 'amber' },
  B: { label: 'น่าสนใจ', hint: 'ทดสอบงบเล็กก่อน ดูหน้าร้านและรีวิวประกอบ', tone: 'emerald' },
  C: { label: 'เฝ้าดู', hint: 'ใช้เสริมในคลิปรวมดีล ไม่ตั้งตัวเป็นตัวหลัก', tone: 'blue' },
  D: { label: 'ข้าม', hint: 'ลดไม่จูงใจ ราคาไม่คุ้มคอม หรือข้อมูลไม่ครบ', tone: 'slate' },
};

export const GRADE_ORDER = ['A', 'B', 'C', 'D'];

// พารามิเตอร์ที่ปรับได้จากหน้าตั้งค่า
export const DEFAULT_SCORING = {
  weights: { ...DEFAULT_WEIGHTS },
  gradeCuts: { ...DEFAULT_GRADE_CUTS },
  discountFloor: 30,      // % ที่เริ่มนับคะแนน
  discountFull: 70,       // % ที่ได้คะแนนเต็ม
  priceSweetMin: 300,     // ช่วงราคาที่ดีที่สุด
  priceSweetMax: 999,
  roundsFull: 4,          // ขึ้นกี่รอบถึงได้คะแนนเต็ม
  assumedCommissionRate: 5, // % ที่ใช้ประเมินเมื่อไม่รู้คอมจริง
  commissionFloor: 7,     // บาท/ออเดอร์ ต่ำกว่านี้ = 0 คะแนน
  commissionFull: 60,     // บาท/ออเดอร์ ที่ได้เต็ม
  minRating: 4.0,         // ต่ำกว่านี้ (และมีรีวิวพอ) โดนหักคะแนน
  minRatingCount: 20,     // จำนวนรีวิวขั้นต่ำที่ถือว่าเชื่อถือได้
};

// ระดับหมวดหมู่ — tier1 ยิงง่ายสุด, tier3 ยกเลิก/ตีกลับเยอะ
export const CATEGORY_TIERS = {
  home: 1, appliance: 1, kitchen: 1, beauty: 1, pet: 1, gadget: 1,
  baby: 2, health: 2, auto: 2, sports: 2, stationery: 2, food: 2, tools: 2,
  fashion: 3, shoes: 3, bags: 3, accessories: 3, jewelry: 3,
};

const CATEGORY_TIER_SCORE = { 1: 1, 2: 0.7, 3: 0.35 };

export const CATEGORY_LABELS = {
  home: 'ของใช้ในบ้าน', appliance: 'เครื่องใช้ไฟฟ้า', kitchen: 'ครัว/อุปกรณ์ทำอาหาร',
  beauty: 'ความงาม/สกินแคร์', pet: 'สัตว์เลี้ยง', gadget: 'ไอที/แกดเจ็ต',
  baby: 'แม่และเด็ก', health: 'สุขภาพ/อาหารเสริม', auto: 'ยานยนต์', sports: 'กีฬา',
  stationery: 'เครื่องเขียน', food: 'อาหาร/เครื่องดื่ม', tools: 'เครื่องมือช่าง',
  fashion: 'เสื้อผ้า', shoes: 'รองเท้า', bags: 'กระเป๋า', accessories: 'แอคเซสซอรี่',
  jewelry: 'เครื่องประดับ', other: 'อื่น ๆ',
};

// คำใบ้ (ไทย/อังกฤษ) → คีย์หมวดหมู่มาตรฐาน
const CATEGORY_KEYWORDS = [
  ['appliance', ['เครื่องใช้ไฟฟ้า', 'พัดลม', 'หม้อทอด', 'ไมโครเวฟ', 'เครื่องซักผ้า', 'แอร์', 'appliance', 'electric']],
  ['kitchen', ['ครัว', 'หม้อ', 'กระทะ', 'จาน', 'ช้อน', 'kitchen', 'cookware']],
  ['home', ['บ้าน', 'ของใช้ในบ้าน', 'จัดเก็บ', 'ทำความสะอาด', 'เฟอร์นิเจอร์', 'home', 'living', 'storage']],
  ['beauty', ['ความงาม', 'สกินแคร์', 'เครื่องสำอาง', 'ครีม', 'เซรั่ม', 'beauty', 'skincare', 'cosmetic', 'makeup']],
  ['pet', ['สัตว์เลี้ยง', 'แมว', 'สุนัข', 'หมา', 'pet', 'cat', 'dog']],
  ['gadget', ['ไอที', 'มือถือ', 'หูฟัง', 'คอมพิวเตอร์', 'แกดเจ็ต', 'gadget', 'mobile', 'computer', 'electronics']],
  ['baby', ['แม่และเด็ก', 'เด็ก', 'ทารก', 'ของเล่น', 'baby', 'kid', 'toy', 'mom']],
  ['health', ['สุขภาพ', 'อาหารเสริม', 'วิตามิน', 'health', 'supplement', 'vitamin']],
  ['auto', ['ยานยนต์', 'รถยนต์', 'มอเตอร์ไซค์', 'auto', 'car', 'motor']],
  ['sports', ['กีฬา', 'ออกกำลังกาย', 'sport', 'fitness', 'outdoor']],
  ['stationery', ['เครื่องเขียน', 'หนังสือ', 'stationery', 'book', 'office']],
  ['food', ['อาหาร', 'เครื่องดื่ม', 'ขนม', 'food', 'drink', 'snack', 'grocery']],
  ['tools', ['เครื่องมือ', 'ช่าง', 'tool', 'hardware', 'diy']],
  ['shoes', ['รองเท้า', 'shoe', 'sneaker', 'sandal']],
  ['bags', ['กระเป๋า', 'bag', 'backpack', 'luggage']],
  ['jewelry', ['เครื่องประดับ', 'สร้อย', 'แหวน', 'jewel', 'watch', 'นาฬิกา']],
  ['accessories', ['แอคเซสซอรี่', 'accessor']],
  ['fashion', ['เสื้อผ้า', 'แฟชั่น', 'เสื้อ', 'กางเกง', 'กระโปรง', 'ชุด', 'fashion', 'apparel', 'clothing', 'dress']],
];

// เดาหมวดหมู่จากข้อความหมวดหมู่ดิบ + ชื่อสินค้า
export function categoryKeyOf(raw, productName = '') {
  const hay = `${raw || ''} ${productName || ''}`.toLowerCase();
  if (!hay.trim()) return 'other';
  for (const [key, words] of CATEGORY_KEYWORDS) {
    if (words.some((w) => hay.includes(w))) return key;
  }
  return 'other';
}

export const categoryLabel = (key) => CATEGORY_LABELS[key] || CATEGORY_LABELS.other;

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);
const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

// ส่วนลด % — ใช้ค่าที่ให้มา ถ้าไม่มีก็คำนวณจากราคาเต็ม/ราคาดีล
export function discountPercentOf(p) {
  const given = num(p?.discountPct);
  if (given > 0) return Math.min(given, 99);
  const original = num(p?.originalPrice);
  const price = num(p?.price);
  if (original > 0 && price > 0 && original > price) {
    return Math.min(((original - price) / original) * 100, 99);
  }
  return 0;
}

// คอมมิชชั่นบาท/ชิ้น — ใช้เรตจริงถ้ามี ไม่งั้นประเมินที่ assumedCommissionRate
export function commissionPerUnitOf(p, cfg = DEFAULT_SCORING) {
  const explicit = num(p?.commissionPerUnit);
  if (explicit > 0) return explicit;
  const rate = num(p?.commissionRate) || num(cfg.assumedCommissionRate);
  return (num(p?.price) * rate) / 100;
}

// ชั่วโมงเริ่มรอบดีล รองรับทั้ง "00:00", "2026-08-18T00:00", และ Date
export function roundStartHour(round) {
  if (round == null) return null;
  const raw = typeof round === 'object' ? (round.start ?? round.time ?? round.startTime) : round;
  if (raw == null) return null;
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw.getHours();
  const s = String(raw).trim();
  if (!s) return null;
  const m = s.match(/(\d{1,2}):(\d{2})/);
  if (m) return Number(m[1]) % 24;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.getHours();
}

export function roundsOf(p) {
  if (Array.isArray(p?.rounds)) return p.rounds;
  const n = num(p?.roundCount);
  return n > 0 ? Array.from({ length: Math.round(n) }, () => null) : [];
}

export const roundCountOf = (p) => {
  const list = roundsOf(p);
  if (list.length) return list.length;
  return num(p?.roundCount);
};

// มีรอบที่เริ่ม 00:00–00:59 ไหม (ชั่วโมงแรกออเดอร์เข้าหนาสุด)
export function hasMidnightRound(p) {
  if (typeof p?.hasMidnightRound === 'boolean') return p.hasMidnightRound;
  return roundsOf(p).some((r) => roundStartHour(r) === 0);
}

// คะแนนช่วงราคา 0–1 แบบขั้นบันได
export function priceBandScore(price, cfg = DEFAULT_SCORING) {
  const v = num(price);
  const lo = num(cfg.priceSweetMin) || 300;
  const hi = num(cfg.priceSweetMax) || 999;
  if (v <= 0) return 0;
  if (v >= lo && v <= hi) return 1;
  if (v < lo) {
    // ของถูกมาก คอมไม่คุ้มค่าคลิก
    if (v < 100) return 0.1;
    return 0.1 + 0.75 * ((v - 100) / (lo - 100));
  }
  if (v <= 1999) return 0.7;
  if (v <= 3999) return 0.4;
  return 0.15;
}

// คะแนนดิบ 0–1 ของทุกปัจจัย (แยกออกมาเพื่อเทสต์ทีละตัว)
export function factorScores(product, cfg = DEFAULT_SCORING) {
  const discountPct = discountPercentOf(product);
  const floor = num(cfg.discountFloor);
  const full = num(cfg.discountFull);
  const span = Math.max(full - floor, 1);

  const rounds = roundCountOf(product);
  const roundsFull = Math.max(num(cfg.roundsFull) || 4, 1);

  const perUnit = commissionPerUnitOf(product, cfg);
  const cFloor = num(cfg.commissionFloor);
  const cFull = Math.max(num(cfg.commissionFull), cFloor + 1);

  const tier = CATEGORY_TIERS[product?.category] ?? null;

  return {
    discount: clamp01((discountPct - floor) / span),
    priceBand: priceBandScore(product?.price, cfg),
    rounds: clamp01(rounds / roundsFull),
    category: tier ? CATEGORY_TIER_SCORE[tier] : 0.5,
    midnight: hasMidnightRound(product) ? 1 : 0,
    commission: perUnit <= cFloor ? 0 : clamp01((perUnit - cFloor) / (cFull - cFloor)),
  };
}

// หักคะแนนจากสัญญาณเสี่ยง — คืนลิสต์ { points, reason }
export function penaltiesFor(product, cfg = DEFAULT_SCORING) {
  const out = [];
  const rating = num(product?.rating);
  const ratingCount = num(product?.ratingCount);
  const minRating = num(cfg.minRating);

  if (ratingCount >= num(cfg.minRatingCount) && rating > 0 && rating < minRating) {
    out.push({ points: -10, reason: `เรตติ้ง ${rating.toFixed(1)} ต่ำกว่า ${minRating.toFixed(1)} — เสี่ยงตีกลับ` });
  }
  if (rating > 0 && ratingCount > 0 && ratingCount < 5) {
    out.push({ points: -5, reason: 'รีวิวน้อยกว่า 5 ชิ้น ยังตัดสินคุณภาพไม่ได้' });
  }
  if (num(product?.price) <= 0) {
    out.push({ points: -20, reason: 'ไม่มีข้อมูลราคา' });
  }
  if (discountPercentOf(product) <= 0) {
    out.push({ points: -8, reason: 'ไม่มีข้อมูลส่วนลด' });
  }
  if (num(product?.sold) === 0 && num(product?.ratingCount) === 0) {
    out.push({ points: -6, reason: 'ยังไม่มียอดขายและรีวิว' });
  }
  return out;
}

export function gradeFor(score, cuts = DEFAULT_GRADE_CUTS) {
  if (score >= num(cuts.A)) return 'A';
  if (score >= num(cuts.B)) return 'B';
  if (score >= num(cuts.C)) return 'C';
  return 'D';
}

// ให้คะแนนสินค้า 1 ตัว → { score, grade, breakdown[], penalties[], metrics }
export function scoreProduct(product, cfg = DEFAULT_SCORING) {
  const conf = { ...DEFAULT_SCORING, ...(cfg || {}) };
  const weights = { ...DEFAULT_WEIGHTS, ...(conf.weights || {}) };
  const raw = factorScores(product, conf);

  const breakdown = Object.keys(DEFAULT_WEIGHTS).map((key) => ({
    key,
    label: FACTOR_LABELS[key],
    hint: FACTOR_HINTS[key],
    weight: num(weights[key]),
    ratio: raw[key],
    points: Math.round(raw[key] * num(weights[key]) * 10) / 10,
  }));

  const base = breakdown.reduce((sum, f) => sum + f.points, 0);
  const penalties = penaltiesFor(product, conf);
  const penaltyPoints = penalties.reduce((sum, p) => sum + p.points, 0);
  const score = Math.max(0, Math.min(100, Math.round(base + penaltyPoints)));

  return {
    score,
    grade: gradeFor(score, { ...DEFAULT_GRADE_CUTS, ...(conf.gradeCuts || {}) }),
    breakdown,
    penalties,
    metrics: {
      discountPct: Math.round(discountPercentOf(product) * 10) / 10,
      commissionPerUnit: Math.round(commissionPerUnitOf(product, conf) * 100) / 100,
      roundCount: roundCountOf(product),
      hasMidnightRound: hasMidnightRound(product),
      priceBandScore: raw.priceBand,
    },
  };
}

// ให้คะแนนทั้งแคตตาล็อก แล้วเรียงจากคะแนนมากไปน้อย
export function scoreCatalog(products, cfg = DEFAULT_SCORING) {
  return (products || [])
    .map((p) => ({ ...p, analysis: scoreProduct(p, cfg) }))
    .sort((a, b) => b.analysis.score - a.analysis.score);
}

// จุดเด่น/จุดอ่อนของสินค้า เป็นประโยคไทยสั้น ๆ (ใช้ได้โดยไม่ต้องมี AI)
export function reasonsFor(scored, cfg = DEFAULT_SCORING) {
  const a = scored?.analysis || scoreProduct(scored, cfg);
  const good = [];
  const bad = [];
  const by = Object.fromEntries(a.breakdown.map((f) => [f.key, f]));
  const m = a.metrics;

  if (by.discount.ratio >= 0.6) good.push(`ลด ${m.discountPct.toFixed(0)}% แรงพอเป็นตัวหยุดนิ้ว`);
  else if (m.discountPct < num(cfg.discountFloor)) bad.push(`ลดแค่ ${m.discountPct.toFixed(0)}% ยังไม่พอดึงคนหยุดดู`);

  if (by.priceBand.ratio >= 1) good.push(`ราคา ฿${Math.round(num(scored.price))} อยู่ในช่วงที่ปิดการขายง่าย`);
  else if (num(scored.price) > 0 && num(scored.price) < num(cfg.priceSweetMin)) bad.push('ราคาถูกไป คอมต่อออเดอร์แทบไม่คุ้มค่าคลิก');
  else if (num(scored.price) >= 2000) bad.push('ราคาสูง คนตัดสินใจนาน ต้องรีมาร์เก็ตติ้ง');

  if (m.roundCount >= 3) good.push(`ขึ้น ${m.roundCount} รอบ คลิปเดียวยิงได้หลายวัน`);
  else if (m.roundCount <= 1) bad.push('ขึ้นรอบเดียว ต้องเร่งยิงในช่วงสั้น ๆ');

  if (m.hasMidnightRound) good.push('มีรอบเที่ยงคืน ชั่วโมงแรกออเดอร์เข้าหนา');
  if (by.category.ratio >= 1) good.push(`หมวด${categoryLabel(scored.category)} ยิงง่าย อัตรายกเลิกต่ำ`);
  else if (by.category.ratio <= 0.35) bad.push(`หมวด${categoryLabel(scored.category)} คืน/ยกเลิกสูง ต้องคุมงบให้ดี`);

  if (m.commissionPerUnit >= 30) good.push(`คอมราว ฿${m.commissionPerUnit.toFixed(0)}/ชิ้น มีที่ว่างให้จ่ายค่าแอด`);
  else if (m.commissionPerUnit < num(cfg.commissionFloor)) bad.push(`คอมราว ฿${m.commissionPerUnit.toFixed(1)}/ชิ้น ต่ำกว่าค่าคลิก`);

  a.penalties.forEach((p) => bad.push(p.reason));
  return { good, bad };
}

// จำนวนออเดอร์ที่ต้องได้ต่อ 1 คลิก เพื่อไม่ขาดทุน (ใช้ CPC ที่ตั้งไว้)
export function breakEvenCvr(scored, cpc = 1.5, cfg = DEFAULT_SCORING) {
  const perUnit = commissionPerUnitOf(scored, cfg);
  if (perUnit <= 0) return null;
  return (num(cpc) / perUnit) * 100; // %
}

// งบทดสอบที่แนะนำต่อวัน — อิงคอมต่อชิ้นและเกรด
export function suggestedDailyBudget(scored, cfg = DEFAULT_SCORING) {
  const grade = scored?.analysis?.grade || scoreProduct(scored, cfg).grade;
  const perUnit = commissionPerUnitOf(scored, cfg);
  const base = { A: 300, B: 150, C: 80, D: 0 }[grade] ?? 0;
  if (!base) return 0;
  // ของคอมสูงเติมงบได้เร็วกว่า ของคอมต่ำต้องคุมงบ
  const factor = perUnit >= 60 ? 1.5 : perUnit >= 25 ? 1 : 0.6;
  return Math.round((base * factor) / 10) * 10;
}

// สรุปภาพรวมทั้งแคตตาล็อก สำหรับการ์ดด้านบนของแดชบอร์ด
export function summarize(scoredList) {
  const list = scoredList || [];
  const counts = { A: 0, B: 0, C: 0, D: 0 };
  list.forEach((p) => { counts[p.analysis?.grade || 'D'] += 1; });
  return {
    total: list.length,
    counts,
    shouldRun: counts.A + counts.B,
    avgScore: list.length
      ? Math.round((list.reduce((s, p) => s + (p.analysis?.score || 0), 0) / list.length) * 10) / 10
      : 0,
  };
}

// สถิติรายหมวดหมู่ เรียงตามจำนวนตัวที่ควรยิง
export function categoryStats(scoredList) {
  const map = new Map();
  (scoredList || []).forEach((p) => {
    const key = p.category || 'other';
    const cur = map.get(key) || { key, label: categoryLabel(key), total: 0, shouldRun: 0, scoreSum: 0, discountSum: 0 };
    cur.total += 1;
    if (['A', 'B'].includes(p.analysis?.grade)) cur.shouldRun += 1;
    cur.scoreSum += p.analysis?.score || 0;
    cur.discountSum += p.analysis?.metrics?.discountPct || 0;
    map.set(key, cur);
  });
  return [...map.values()]
    .map((c) => ({
      ...c,
      avgScore: Math.round((c.scoreSum / c.total) * 10) / 10,
      avgDiscount: Math.round((c.discountSum / c.total) * 10) / 10,
      hitRate: Math.round((c.shouldRun / c.total) * 1000) / 10,
    }))
    .sort((a, b) => b.shouldRun - a.shouldRun || b.avgScore - a.avgScore);
}

// ตารางรอบดีลรายวัน — ตัวเด่นของแต่ละวัน/ช่วงเวลา
export function roundSchedule(scoredList) {
  const map = new Map();
  (scoredList || []).forEach((p) => {
    roundsOf(p).forEach((r) => {
      const hour = roundStartHour(r);
      if (hour == null) return;
      const rawStart = typeof r === 'object' ? (r.start ?? r.time ?? '') : r;
      const day = String(rawStart).slice(0, 10);
      const key = `${day}|${hour}`;
      const cur = map.get(key) || { day, hour, items: [] };
      cur.items.push(p);
      map.set(key, cur);
    });
  });
  return [...map.values()]
    .map((slot) => ({
      ...slot,
      count: slot.items.length,
      top: [...slot.items].sort((a, b) => (b.analysis?.score || 0) - (a.analysis?.score || 0)).slice(0, 3),
      shouldRun: slot.items.filter((p) => ['A', 'B'].includes(p.analysis?.grade)).length,
    }))
    .sort((a, b) => (a.day === b.day ? a.hour - b.hour : a.day < b.day ? -1 : 1));
}
