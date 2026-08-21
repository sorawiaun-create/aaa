import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreProduct, scoreCatalog, factorScores, priceBandScore, gradeFor,
  discountPercentOf, commissionPerUnitOf, roundStartHour, hasMidnightRound,
  categoryKeyOf, summarize, categoryStats, roundSchedule, reasonsFor,
  breakEvenCvr, suggestedDailyBudget, DEFAULT_SCORING, DEFAULT_WEIGHTS,
} from '../src/lib/shopee.js';
import {
  parseDelimited, mapHeaders, normalizeProduct, mergeProducts,
  productsFromRows, productsFromJson, shortlistCsv,
} from '../src/lib/shopeeImport.js';
import { localAnalysis, buildAnalysisPrompt, extractJson, mergeAiIntoProducts, compactProduct } from '../src/lib/shopeeAI.js';
import { buildShopeeSample } from '../src/lib/shopeeSample.js';

const A_GRADE = {
  id: 'p1', name: 'หม้อทอดไร้น้ำมัน', category: 'appliance',
  price: 590, originalPrice: 1490, rating: 4.8, ratingCount: 900, sold: 3000,
  rounds: [{ start: '2026-08-18T00:00' }, { start: '2026-08-19T00:00' }, { start: '2026-08-20T12:00' }, { start: '2026-08-21T18:00' }],
};

// --- ส่วนลด ---
test('discountPercentOf: ใช้ค่าที่ให้มาก่อน', () => {
  assert.equal(discountPercentOf({ discountPct: 45, price: 100, originalPrice: 200 }), 45);
});
test('discountPercentOf: คำนวณจากราคาเต็มเมื่อไม่มีค่าให้', () => {
  assert.equal(discountPercentOf({ price: 500, originalPrice: 1000 }), 50);
});
test('discountPercentOf: ข้อมูลไม่ครบ → 0', () => {
  assert.equal(discountPercentOf({ price: 500 }), 0);
  assert.equal(discountPercentOf(null), 0);
});

// --- คอมต่อชิ้น ---
test('commissionPerUnitOf: ใช้เรตจริงถ้ามี', () => {
  assert.equal(commissionPerUnitOf({ price: 1000, commissionRate: 8 }), 80);
});
test('commissionPerUnitOf: ไม่มีเรต → ประเมินที่ 5%', () => {
  assert.equal(commissionPerUnitOf({ price: 1000 }), 50);
});

// --- ช่วงราคา ---
test('priceBandScore: ฿300–999 ได้เต็ม', () => {
  assert.equal(priceBandScore(300), 1);
  assert.equal(priceBandScore(650), 1);
  assert.equal(priceBandScore(999), 1);
});
test('priceBandScore: ของถูกมาก/แพงมาก ได้น้อย', () => {
  assert.equal(priceBandScore(59), 0.1);
  assert.equal(priceBandScore(1500), 0.7);
  assert.equal(priceBandScore(2500), 0.4);
  assert.equal(priceBandScore(5000), 0.15);
});
test('priceBandScore: ไม่มีราคา → 0', () => {
  assert.equal(priceBandScore(0), 0);
});

// --- รอบดีล ---
test('roundStartHour: รองรับทั้ง ISO และ HH:MM', () => {
  assert.equal(roundStartHour('2026-08-18T00:00'), 0);
  assert.equal(roundStartHour({ start: '21:00' }), 21);
  assert.equal(roundStartHour(''), null);
  assert.equal(roundStartHour(null), null);
});
test('hasMidnightRound: จับรอบ 00:xx ได้', () => {
  assert.equal(hasMidnightRound({ rounds: [{ start: '2026-08-18T00:30' }] }), true);
  assert.equal(hasMidnightRound({ rounds: [{ start: '2026-08-18T09:00' }] }), false);
  assert.equal(hasMidnightRound({ hasMidnightRound: true }), true);
});

// --- หมวดหมู่ ---
test('categoryKeyOf: เดาจากหมวดไทยและชื่อสินค้า', () => {
  assert.equal(categoryKeyOf('เครื่องใช้ไฟฟ้า'), 'appliance');
  assert.equal(categoryKeyOf('', 'ทรายแมวเต้าหู้'), 'pet');
  assert.equal(categoryKeyOf('Home & Living'), 'home');
  assert.equal(categoryKeyOf('', ''), 'other');
});
test('categoryKeyOf: ไม่รู้จัก → other', () => {
  assert.equal(categoryKeyOf('zzz หมวดแปลก'), 'other');
});

// --- คะแนนรายปัจจัย ---
test('factorScores: ส่วนลดต่ำกว่าเกณฑ์เริ่มต้น = 0, เต็มที่ 70%', () => {
  assert.equal(factorScores({ discountPct: 20, price: 500 }).discount, 0);
  assert.equal(factorScores({ discountPct: 50, price: 500 }).discount, 0.5);
  assert.equal(factorScores({ discountPct: 90, price: 500 }).discount, 1);
});
test('factorScores: จำนวนรอบเต็มที่ 4 รอบ', () => {
  assert.equal(factorScores({ roundCount: 2, price: 500 }).rounds, 0.5);
  assert.equal(factorScores({ roundCount: 9, price: 500 }).rounds, 1);
});
test('factorScores: หมวดที่ไม่รู้จักได้กลาง ๆ 0.5', () => {
  assert.equal(factorScores({ category: 'other', price: 500 }).category, 0.5);
  assert.equal(factorScores({ category: 'fashion', price: 500 }).category, 0.35);
  assert.equal(factorScores({ category: 'home', price: 500 }).category, 1);
});

// --- คะแนนรวมและเกรด ---
test('scoreProduct: สินค้าที่ดีทุกด้านได้เกรด A', () => {
  const r = scoreProduct(A_GRADE);
  assert.equal(r.grade, 'A');
  assert.ok(r.score >= 75, `คาดว่า >= 75 แต่ได้ ${r.score}`);
  assert.equal(r.penalties.length, 0);
});
test('scoreProduct: ของถูกลดน้อย ได้เกรด D', () => {
  const r = scoreProduct({ name: 'สายชาร์จ', category: 'gadget', price: 39, originalPrice: 45 });
  assert.equal(r.grade, 'D');
});
test('scoreProduct: คะแนนรวมไม่เกิน 100 และไม่ต่ำกว่า 0', () => {
  const hi = scoreProduct({ price: 700, discountPct: 99, category: 'home', roundCount: 20, rounds: [{ start: '00:00' }], commissionRate: 50, rating: 5, ratingCount: 1000 });
  assert.ok(hi.score <= 100);
  const lo = scoreProduct({ name: 'ไม่มีข้อมูล' });
  assert.ok(lo.score >= 0);
});
test('scoreProduct: น้ำหนักแต่ละปัจจัยตรงกับที่ตั้งไว้', () => {
  const r = scoreProduct(A_GRADE);
  const byKey = Object.fromEntries(r.breakdown.map((f) => [f.key, f.weight]));
  assert.deepEqual(byKey, DEFAULT_WEIGHTS);
});
test('scoreProduct: เรตติ้งต่ำโดนหักคะแนน', () => {
  const good = scoreProduct({ ...A_GRADE, rating: 4.9 });
  const bad = scoreProduct({ ...A_GRADE, rating: 3.2, ratingCount: 500 });
  assert.ok(bad.score < good.score);
  assert.ok(bad.penalties.some((p) => p.reason.includes('เรตติ้ง')));
});
test('scoreProduct: ไม่มีราคาโดนหักหนักและร่วงไปเกรด D', () => {
  const r = scoreProduct({ name: 'ไม่รู้ราคา', category: 'home', discountPct: 70, roundCount: 4 });
  assert.ok(r.penalties.some((p) => p.reason.includes('ราคา')));
  assert.equal(r.grade, 'D');
});
test('gradeFor: ตัดเกรดตามเกณฑ์', () => {
  assert.equal(gradeFor(90), 'A');
  assert.equal(gradeFor(75), 'A');
  assert.equal(gradeFor(74), 'B');
  assert.equal(gradeFor(60), 'B');
  assert.equal(gradeFor(59), 'C');
  assert.equal(gradeFor(39), 'D');
});
test('scoreProduct: ปรับน้ำหนักแล้วคะแนนเปลี่ยนตาม', () => {
  const base = scoreProduct(A_GRADE);
  const noDiscount = scoreProduct(A_GRADE, { ...DEFAULT_SCORING, weights: { ...DEFAULT_WEIGHTS, discount: 0 } });
  assert.ok(noDiscount.score < base.score);
});

// --- รวมทั้งแคตตาล็อก ---
test('scoreCatalog: เรียงจากคะแนนมากไปน้อย', () => {
  const list = scoreCatalog([
    { name: 'ถูกและลดน้อย', price: 39, category: 'fashion' },
    A_GRADE,
  ]);
  assert.equal(list[0].name, A_GRADE.name);
  assert.ok(list[0].analysis.score > list[1].analysis.score);
});
test('summarize: นับเกรดและตัวที่ควรยิง (A+B)', () => {
  const list = scoreCatalog([A_GRADE, { name: 'x', price: 20, category: 'fashion' }]);
  const s = summarize(list);
  assert.equal(s.total, 2);
  assert.equal(s.shouldRun, s.counts.A + s.counts.B);
});
test('categoryStats: รวมรายหมวดและคิดสัดส่วนที่ผ่าน', () => {
  const stats = categoryStats(scoreCatalog([A_GRADE, { ...A_GRADE, id: 'p2', name: 'อีกตัว' }]));
  assert.equal(stats[0].key, 'appliance');
  assert.equal(stats[0].total, 2);
  assert.equal(stats[0].hitRate, 100);
});
test('roundSchedule: จัดกลุ่มตามวัน+ชั่วโมง', () => {
  const slots = roundSchedule(scoreCatalog([A_GRADE]));
  assert.equal(slots.length, 4);
  assert.equal(slots[0].day, '2026-08-18');
  assert.equal(slots[0].hour, 0);
});

// --- เหตุผล / งบ / จุดคุ้มทุน ---
test('reasonsFor: บอกจุดแข็งของสินค้าเกรด A', () => {
  const scored = scoreCatalog([A_GRADE])[0];
  const { good, bad } = reasonsFor(scored);
  assert.ok(good.length >= 3);
  assert.equal(bad.length, 0);
});
test('breakEvenCvr: คิดจาก CPC หารคอมต่อชิ้น', () => {
  // คอม 5% ของ 1000 = 50 บาท, CPC 1.5 → ต้องปิดได้ 3%
  assert.equal(Math.round(breakEvenCvr({ price: 1000 }, 1.5) * 100) / 100, 3);
  assert.equal(breakEvenCvr({ price: 0 }, 1.5), null);
});
test('suggestedDailyBudget: เกรด D ไม่แนะนำให้ยิง', () => {
  const d = scoreCatalog([{ name: 'x', price: 20, category: 'fashion' }])[0];
  assert.equal(suggestedDailyBudget(d), 0);
  assert.ok(suggestedDailyBudget(scoreCatalog([A_GRADE])[0]) > 0);
});

// --- นำเข้าไฟล์ ---
test('parseDelimited: รองรับเครื่องหมายคำพูดและคอมมาในเซลล์', () => {
  const rows = parseDelimited('a,b\n"หนึ่ง, สอง",3');
  assert.deepEqual(rows, [['a', 'b'], ['หนึ่ง, สอง', '3']]);
});
test('parseDelimited: รองรับ TSV อัตโนมัติ', () => {
  assert.deepEqual(parseDelimited('a\tb\n1\t2'), [['a', 'b'], ['1', '2']]);
});
test('mapHeaders: จับคู่หัวคอลัมน์ไทย/อังกฤษ และไม่สับสนราคา/ราคาเต็ม', () => {
  const m = mapHeaders(['ชื่อสินค้า', 'ราคา', 'ราคาเต็ม', 'Commission Rate', 'ยอดขาย']);
  assert.equal(m.name, 0);
  assert.equal(m.price, 1);
  assert.equal(m.originalPrice, 2);
  assert.equal(m.commissionRate, 3);
  assert.equal(m.sold, 4);
});
test('normalizeProduct: ล้างราคาที่มีสัญลักษณ์ และแปลงส่วนลดเป็นตัวเลข', () => {
  const p = normalizeProduct({ name: 'ของ', price: '฿1,290.00', originalPrice: '2,000', discountPct: '35%', sold: '1.2k' });
  assert.equal(p.price, 1290);
  assert.equal(p.originalPrice, 2000);
  assert.equal(p.discountPct, 35);
  assert.equal(p.sold, 1200);
});
test('mergeProducts: สินค้าเดียวกันรวมรอบดีลเข้าด้วยกัน', () => {
  const rows = parseDelimited([
    'ชื่อสินค้า,ร้านค้า,ราคา,เวลาเริ่ม',
    'หม้อทอด,ครัวดี,590,2026-08-18T00:00',
    'หม้อทอด,ครัวดี,590,2026-08-20T12:00',
  ].join('\n'));
  const { products } = productsFromRows(rows);
  assert.equal(products.length, 1);
  assert.equal(products[0].roundCount, 2);
});
test('mergeProducts: รอบซ้ำเป๊ะ ๆ ไม่ถูกนับซ้ำ', () => {
  const merged = mergeProducts([
    normalizeProduct({ name: 'ของ', itemId: '1', shopId: '9', roundStart: '2026-08-18T00:00' }),
    normalizeProduct({ name: 'ของ', itemId: '1', shopId: '9', roundStart: '2026-08-18T00:00' }),
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].roundCount, 1);
});
test('productsFromRows: ไม่มีคอลัมน์ชื่อสินค้า → แจ้ง error', () => {
  const res = productsFromRows(parseDelimited('ราคา,ส่วนลด\n100,20'));
  assert.ok(res.error);
  assert.equal(res.products.length, 0);
});
test('productsFromRows: ข้ามแถวที่ไม่มีชื่อสินค้า', () => {
  const res = productsFromRows(parseDelimited('ชื่อสินค้า,ราคา\nของดี,100\n,200'));
  assert.equal(res.products.length, 1);
  assert.equal(res.skipped, 1);
});
test('productsFromJson: รองรับทั้ง array และ { products: [] }', () => {
  const a = productsFromJson('[{"name":"ของ A","price":300}]');
  const b = productsFromJson(JSON.stringify({ products: [{ name: 'ของ B', price: 400, rounds: ['2026-08-18T00:00'] }] }));
  assert.equal(a.products[0].name, 'ของ A');
  assert.equal(b.products[0].roundCount, 1);
});
test('shortlistCsv: มีหัวตารางและจำนวนบรรทัดตรงกับสินค้า', () => {
  const csv = shortlistCsv(scoreCatalog([A_GRADE]));
  const lines = csv.split('\n');
  assert.ok(lines[0].includes('เกรด'));
  assert.equal(lines.length, 2);
});
test('shortlistCsv: escape ชื่อสินค้าที่มีคอมมา', () => {
  const csv = shortlistCsv(scoreCatalog([{ ...A_GRADE, name: 'ของ, ดี' }]));
  assert.ok(csv.includes('"ของ, ดี"'));
});

// --- ชั้น AI ---
test('localAnalysis: เกรด A แนะนำให้ยิงพร้อมงบและมุมโฆษณา', () => {
  const scored = scoreCatalog([A_GRADE])[0];
  const r = localAnalysis(scored);
  assert.equal(r.source, 'local');
  assert.equal(r.grade, 'A');
  assert.ok(r.dailyBudget > 0);
  assert.ok(r.angles.length > 0);
  assert.ok(r.hooks.length > 0);
});
test('localAnalysis: เกรด D ไม่เสนอมุมโฆษณา', () => {
  const scored = scoreCatalog([{ name: 'x', price: 20, category: 'fashion' }])[0];
  const r = localAnalysis(scored);
  assert.equal(r.grade, 'D');
  assert.equal(r.angles.length, 0);
  assert.equal(r.dailyBudget, 0);
});
test('compactProduct: ส่งเฉพาะฟิลด์ที่จำเป็นให้ AI', () => {
  const c = compactProduct(scoreCatalog([A_GRADE])[0]);
  assert.equal(c.เกรด, 'A');
  assert.equal(c.ราคา, 590);
  assert.equal(c.รอบเที่ยงคืน, true);
});
test('buildAnalysisPrompt: มี system + user และแนบข้อมูลสินค้า', () => {
  const msgs = buildAnalysisPrompt(scoreCatalog([A_GRADE]));
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].role, 'system');
  assert.ok(msgs[1].content.includes('หม้อทอดไร้น้ำมัน'));
});
test('extractJson: อ่าน JSON ที่ห่อด้วย code fence ได้', () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('พูดนำหน้า {"a":2} ตามหลัง'), { a: 2 });
  assert.equal(extractJson('ไม่มี json'), null);
  assert.equal(extractJson(''), null);
});
test('mergeAiIntoProducts: ตัวที่ AI ไม่พูดถึงใช้ผลออฟไลน์', () => {
  const list = scoreCatalog([A_GRADE, { id: 'p9', name: 'อีกตัว', price: 450, category: 'home', discountPct: 40 }]);
  const merged = mergeAiIntoProducts(list, { picks: [{ id: list[0].id, verdict: 'RUN', reason: 'ตัวเลขดี', angles: ['มุม AI'] }] });
  const first = merged.find((p) => p.id === list[0].id);
  const second = merged.find((p) => p.id !== list[0].id);
  assert.equal(first.ai.source, 'ai');
  assert.deepEqual(first.ai.angles, ['มุม AI']);
  assert.equal(second.ai.source, 'local');
});

// --- ข้อมูลตัวอย่าง ---
test('buildShopeeSample: ได้ผลเหมือนเดิมทุกครั้ง (seed คงที่)', () => {
  const a = buildShopeeSample();
  const b = buildShopeeSample();
  assert.equal(a.length, b.length);
  assert.deepEqual(a.map((p) => [p.name, p.price, p.roundCount]), b.map((p) => [p.name, p.price, p.roundCount]));
});
test('buildShopeeSample: ทุกตัวให้คะแนนได้และมีเกรดครบทุกระดับ', () => {
  const list = scoreCatalog(buildShopeeSample());
  assert.ok(list.every((p) => Number.isFinite(p.analysis.score)));
  const grades = new Set(list.map((p) => p.analysis.grade));
  assert.ok(grades.size >= 3, `พบเกรด ${[...grades].join(',')}`);
});
