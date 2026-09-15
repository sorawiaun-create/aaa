import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// core.js เป็นสคริปต์ธรรมดา (content script โหลดตรง ๆ ไม่ผ่าน bundler)
// จึงรันในแซนด์บ็อกซ์แล้วดึง TTLH.core ออกมาทดสอบ
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(readFileSync(new URL('../live-helper/src/core.js', import.meta.url), 'utf8'), sandbox);
const core = sandbox.TTLH.core;

const baseAi = () => core.normalizeSettings(null).ai;

// --- normalizeSettings ---
test('normalizeSettings: เติมค่าเริ่มต้นให้ครบ', () => {
  const s = core.normalizeSettings({ pin: { basket: 3 } });
  assert.equal(s.pin.basket, 3);
  assert.equal(s.pin.extendEverySec, 31);
  assert.equal(s.ai.provider, 'claude');
  assert.equal(s.ai.models.claude, 'claude-opus-5');
  assert.equal(s.ai.maxChars, 100);
});


test('normalizeSettings: รับคำต้องห้ามเป็นข้อความคั่นด้วย , หรือขึ้นบรรทัดใหม่', () => {
  const s = core.normalizeSettings({ ai: { blockWords: 'โกง, ห่วย\nแพง' } });
  assert.equal(s.ai.blockWords.join('|'), 'โกง|ห่วย|แพง');
});

test('normalizeSettings: ตัด / ท้าย API base ออก', () => {
  const ai = core.normalizeSettings({ ai: { bases: { openai: 'https://x.dev///' } } }).ai;
  assert.equal(ai.bases.openai, 'https://x.dev');
});

// --- แยกการ์ดสินค้าออกจากคูปอง/การแจกรางวัล (ข้อความจริงจากหน้าคอนโซล) ---
const CARD_PRODUCT = '1 TOPSUN เก้าอี้สนาม รุ่นโซฟา ทรงหลังสูง 90 cm หนานุ่ม รองรับส. '
  + 'ตัวเลือกโปรด ฿245.55 ฿639.00 อยู่ในสต็อก: 30.3K ค่าขอสาธิตสินค้า: 0 ปักหมุด '
  + 'ยอดคลิก 512 จำนวนที่เพิ่มไปที่รถเข็น 25';
const CARD_COUPON = 'ลด 15% ซื้อขั้นต่ำ ฿300.00 ปักหมุด';
const CARD_GIVEAWAY = 'การแจกรางวัล: โบนัส ฿15.00 ผู้ชนะ 15 คน | 5 นาที เผยแพร่ 1/2';
const CARD_STRIP = 'รายการสินค้าใน LIVE นี้ +45 ปักหมุด';

test('isProductCardText: การ์ดสินค้าจริงผ่าน', () => {
  assert.equal(core.isProductCardText(CARD_PRODUCT, true), true);
});

test('isProductCardText: คูปอง/การแจกรางวัล/แถบรายการรวม ต้องไม่ถูกนับเป็นสินค้า', () => {
  assert.equal(core.isProductCardText(CARD_COUPON, true), false);
  assert.equal(core.isProductCardText(CARD_COUPON, false), false);
  assert.equal(core.isProductCardText(CARD_GIVEAWAY, false), false);
  assert.equal(core.isProductCardText(CARD_STRIP, false), false);
});

test('isProductCardText: ไม่มีราคา = ไม่ใช่การ์ดสินค้า', () => {
  assert.equal(core.isProductCardText('ปักหมุด', false), false);
});

test('cardIndexFromText: อ่านเลขตะกร้าจากหัวการ์ด', () => {
  assert.equal(core.cardIndexFromText(CARD_PRODUCT), 1);
  assert.equal(core.cardIndexFromText('2 TOPSUN เก้าอี้กลางแจ้ง ฿139.10'), 2);
  assert.equal(core.cardIndexFromText('TOPSUN ไม่มีเลขนำหน้า ฿139.10'), null);
});

test('cardNameFromText: ตัดเลข ราคา และข้อความปุ่มออก', () => {
  const name = core.cardNameFromText(CARD_PRODUCT);
  assert.ok(name.startsWith('TOPSUN เก้าอี้สนาม'));
  assert.ok(!name.includes('฿'));
  assert.ok(!name.includes('ปักหมุด'));
});

// --- คัดข้อความ UI ออกจากคอมเมนต์ ---
test('isUiNoise: ข้อความบนหน้าเว็บไม่ใช่คอมเมนต์', () => {
  assert.equal(core.isUiNoise('ตัวจัดการ LIVE'), true);
  assert.equal(core.isUiNoise('คอนโซล LIVE'), true);
  assert.equal(core.isUiNoise('แชท'), true);
  assert.equal(core.isUiNoise('ทั้งหมด'), true);
  assert.equal(core.isUiNoise('ปักหมุดแล้ว'), true);
  assert.equal(core.isUiNoise('ความคิดเห็นของผู้ชมจะปรากฏที่นี่ระหว่าง LIVE ของคุณ'), true);
  assert.equal(core.isUiNoise(''), true);
});

test('isUiNoise: คอมเมนต์ลูกค้าต้องผ่าน', () => {
  assert.equal(core.isUiNoise('ตัวนี้ราคาเท่าไหร่คะ'), false);
  assert.equal(core.isUiNoise('สวยจัง'), false);
  assert.equal(core.isUiNoise('หมายเลข14 มีสีดำไหม'), false);
});

// --- ตัวกรองคอมเมนต์ ---
test('shouldReply: คอมเมนต์ปกติ = ตอบ', () => {
  const ai = Object.assign(baseAi(), { enabled: true });
  const verdict = core.shouldReply({ user: 'nene', text: 'ตัวนี้ราคาเท่าไหร่คะ' }, {}, ai, 1000);
  assert.equal(verdict.ok, true);
});

test('shouldReply: ข้ามข้อความระบบของ TikTok', () => {
  const ai = Object.assign(baseAi(), { enabled: true });
  assert.equal(core.shouldReply({ user: 'T', text: 'เข้าร่วมแล้ว' }, {}, ai, 1).ok, false);
  assert.equal(core.shouldReply({ user: 'A', text: 'กำลังดูสินค้ารายการนี้ หมายเลข14' }, {}, ai, 1).ok, false);
});

test('shouldReply: ข้ามคอมเมนต์ที่ตอบไปแล้ว', () => {
  const ai = Object.assign(baseAi(), { enabled: true });
  const comment = { user: 'nene', text: 'มีสีดำไหม' };
  const state = { handled: { [core.commentId(comment)]: 1 } };
  assert.equal(core.shouldReply(comment, state, ai, 2000).ok, false);
});

test('shouldReply: แค่ "อ่านเข้าคิวแล้ว" (seen) ต้องไม่บล็อกการตอบ', () => {
  const ai = Object.assign(baseAi(), { enabled: true });
  const comment = { user: 'nene', text: 'มีสีดำไหม' };
  const state = { seen: { [core.commentId(comment)]: 1 } };
  assert.equal(core.shouldReply(comment, state, ai, 2000).ok, true);
});

test('shouldReply: คนเดิมต้องรอครบ cooldown', () => {
  const ai = Object.assign(baseAi(), { enabled: true, userCooldownSec: 90 });
  const state = { lastByUser: { nene: 10000 } };
  assert.equal(core.shouldReply({ user: 'Nene', text: 'ส่งกี่วันคะ' }, state, ai, 20000).ok, false);
  assert.equal(core.shouldReply({ user: 'Nene', text: 'ส่งกี่วันคะ' }, state, ai, 120000).ok, true);
});

test('shouldReply: เกินโควตาต่อนาทีแล้วหยุดตอบ', () => {
  const ai = Object.assign(baseAi(), { enabled: true, replyPerMin: 2 });  // ค่าเริ่มต้นจริงคือ 15
  const now = 100000;
  const state = { replyTimes: [now - 1000, now - 2000] };
  assert.equal(core.shouldReply({ user: 'a', text: 'ราคาเท่าไหร่' }, state, ai, now).ok, false);
  // ของเก่าเกิน 1 นาทีไม่นับ
  const old = { replyTimes: [now - 61000, now - 70000] };
  assert.equal(core.shouldReply({ user: 'a', text: 'ราคาเท่าไหร่' }, old, ai, now).ok, true);
});

test('shouldReply: ค่าเริ่มต้นตอบทุกคอมเมนต์ รวมคำชม', () => {
  const ai = Object.assign(baseAi(), { enabled: true });
  assert.equal(ai.replyScope, 'all');
  assert.equal(core.shouldReply({ user: 'a', text: 'สวยมากเลย' }, {}, ai, 1).ok, true);
  assert.equal(core.shouldReply({ user: 'a', text: 'สวัสดีค่ะ' }, {}, ai, 1).ok, true);
});

test('shouldReply: โหมดเฉพาะคำถาม', () => {
  const ai = Object.assign(baseAi(), { enabled: true, replyScope: 'questions' });
  assert.equal(core.shouldReply({ user: 'a', text: 'สวยมากเลย' }, {}, ai, 1).ok, false);
  assert.equal(core.shouldReply({ user: 'a', text: 'มีสีแดงมั้ยคะ' }, {}, ai, 1).ok, true);
});

test('normalizeSettings: ขอบเขตการตอบ ค่าเริ่มต้น all และกันค่ามั่ว', () => {
  assert.equal(core.normalizeSettings(null).ai.replyScope, 'all');
  assert.equal(core.normalizeSettings({ ai: { replyScope: 'xx' } }).ai.replyScope, 'all');
  assert.equal(core.normalizeSettings({ ai: { replyScope: 'questions' } }).ai.replyScope, 'questions');
});

test('shouldReply: ไม่ตอบข้อความของเราเอง และคำต้องห้าม', () => {
  const ai = Object.assign(baseAi(), { enabled: true, blockWords: ['ไลน์'] });
  assert.equal(core.shouldReply({ user: 'x', text: 'ทักไลน์มาได้เลย' }, {}, ai, 1).ok, false);
  const state = { ownTexts: ['ส่งฟรีค่ะ'] };
  assert.equal(core.shouldReply({ user: 'x', text: 'ส่งฟรีค่ะ' }, state, ai, 1).ok, false);
});

test('shouldReply: ปิดระบบอยู่ = ไม่ตอบ', () => {
  assert.equal(core.shouldReply({ user: 'a', text: 'ราคา' }, {}, baseAi(), 1).ok, false);
});

// --- ลูกค้าอ้างสินค้าด้วยเลขตะกร้า ---
test('detectBasket: อ่านเลขจากคำเรียกแบบไทย', () => {
  assert.equal(core.detectBasket('หมายเลข14 ราคาเท่าไหร่'), 14);
  assert.equal(core.detectBasket('เบอร์ 3 มีสีอะไรบ้าง'), 3);
  assert.equal(core.detectBasket('ตัวที่ 2 ค่ะ'), 2);
  assert.equal(core.detectBasket('#40'), 40);
});

test('detectBasket: เลขโดด ๆ = ขอดูสินค้าเบอร์นั้น', () => {
  assert.equal(core.detectBasket('14'), 14);
  assert.equal(core.detectBasket(' 7 '), 7);
});

test('detectBasket: ประโยคที่มีเลขปนแต่ไม่ได้เรียกสินค้า = null', () => {
  assert.equal(core.detectBasket('ตัวนี้ราคาเท่าไหร่'), null);
  assert.equal(core.detectBasket('มี 2 สีไหม'), null);
  assert.equal(core.detectBasket('ส่งกี่วันคะ'), null);
  assert.equal(core.detectBasket('เบอร์ 999'), null);
});

test('resolveProduct: รวมข้อมูลที่ดึงมากับที่กรอกเอง โดยของที่กรอกเองมาก่อน', () => {
  const ctx = {
    scraped: [{ index: 2, name: 'ชื่อจากหน้าเว็บ', price: '฿139' }],
    knowledge: [{ basket: 2, name: 'ชื่อที่กรอกเอง', price: '', info: 'มีสีดำ' }],
  };
  const found = core.resolveProduct(2, ctx);
  assert.equal(found.name, 'ชื่อที่กรอกเอง');
  assert.equal(found.price, '฿139');
  assert.equal(found.info, 'มีสีดำ');
  assert.equal(found.known, true);
});

test('resolveProduct: ตะกร้าที่ไม่มีข้อมูล = known false', () => {
  const found = core.resolveProduct(40, { scraped: [], knowledge: [] });
  assert.equal(found.known, false);
  assert.equal(found.basket, 40);
});

test('buildUserPrompt: บอก AI ว่าลูกค้าอ้างถึงตะกร้าไหน', () => {
  const withInfo = core.buildUserPrompt({ user: 'a', text: 'หมายเลข2 ราคา' }, [],
    { basket: 2, name: 'เก้าอี้ยาว', price: '฿139', info: 'พับได้', known: true });
  assert.ok(withInfo.includes('ตะกร้าที่ 2'));
  assert.ok(withInfo.includes('เก้าอี้ยาว'));
  assert.ok(withInfo.includes('พับได้'));

  const unknown = core.buildUserPrompt({ user: 'a', text: '40' }, [],
    { basket: 40, name: '', price: '', info: '', known: false });
  assert.ok(unknown.includes('ห้ามเดา'));
});

test('buildSystemPrompt: สั่งห้ามตอบซ้ำแพทเทิร์นเดิม และตอบทุกคอมเมนต์', () => {
  const prompt = core.buildSystemPrompt(baseAi(), {});
  assert.ok(prompt.includes('ห้ามตอบเป็นประโยคแพทเทิร์นเดิมซ้ำ'));
  assert.ok(prompt.includes('ตอบ "ทุกคอมเมนต์"'));
  assert.ok(prompt.includes('SKIP อย่างเดียว เฉพาะกรณีข้อความหยาบคาย'));
});

test('buildUserPrompt: แนบประโยคที่เพิ่งตอบไป เพื่อกันตอบซ้ำ', () => {
  const prompt = core.buildUserPrompt({ user: 'a', text: 'สวัสดี' }, [], null,
    ['กดดูในตะกร้าได้เลยค่ะ', 'ขอบคุณค่ะ']);
  assert.ok(prompt.includes('ห้ามตอบซ้ำ'));
  assert.ok(prompt.includes('กดดูในตะกร้าได้เลยค่ะ'));
});

test('buildSystemPrompt: ห้ามรับปากว่าจะหยิบสินค้าตัวอื่นมาโชว์', () => {
  const prompt = core.buildSystemPrompt(baseAi(), { focusBasket: 1 });
  assert.ok(prompt.includes('ห้ามพูดว่าจะหยิบสินค้าตัวอื่นมาโชว์'));
  assert.ok(!prompt.includes('เดี๋ยวแม่ค้าหยิบมาโชว์'));

  const brief = core.buildSystemPrompt(Object.assign(baseAi(), { otherBasketMode: 'brief' }), { focusBasket: 1 });
  assert.ok(!brief.includes('เดี๋ยวแม่ค้าโชว์ให้ดู'));
});

test('buildUserPrompt: ตะกร้าที่ไม่มีข้อมูล ต้องไม่สั่งให้รับปากโชว์', () => {
  const prompt = core.buildUserPrompt({ user: 'a', text: '40' }, [],
    { basket: 40, name: '', price: '', info: '', known: false });
  assert.ok(prompt.includes('ห้ามรับปากว่าจะโชว์ให้ดู'));
  assert.ok(!prompt.includes('เดี๋ยวแม่ค้าโชว์ให้ดู'));
});

test('buildSystemPrompt: มีกติกาสำหรับคำถามตะกร้าอื่น และชวนกลับตัวหลัก', () => {
  const answer = core.buildSystemPrompt(baseAi(), { focusBasket: 1 });
  assert.ok(answer.includes('ห้ามเดาราคาหรือสเปกเด็ดขาด'));
  assert.ok(answer.includes('ห้ามลอกทั้งประโยค'));
  assert.ok(answer.includes('ชวนกลับมาที่สินค้าตะกร้าที่ 1'));

  const brief = core.buildSystemPrompt(Object.assign(baseAi(), { otherBasketMode: 'brief', pullBackToMain: false }),
    { focusBasket: 1 });
  assert.ok(brief.includes('ห้ามลงรายละเอียดเอง'));
  assert.ok(!brief.includes('ชวนกลับมาที่สินค้าตะกร้าที่ 1'));
});

test('normalizeSettings: โหมดคำถามตะกร้าอื่น ค่าเริ่มต้น answer และกันค่ามั่ว', () => {
  assert.equal(core.normalizeSettings(null).ai.otherBasketMode, 'answer');
  assert.equal(core.normalizeSettings({ ai: { otherBasketMode: 'xx' } }).ai.otherBasketMode, 'answer');
  assert.equal(core.normalizeSettings({ ai: { otherBasketMode: 'skip' } }).ai.otherBasketMode, 'skip');
  assert.equal(core.normalizeSettings(null).ai.pullBackToMain, true);
});

// --- คำตอบจาก AI ---
test('sanitizeReply: ตัด markdown/เครื่องหมายคำพูด/ขึ้นบรรทัดใหม่', () => {
  assert.equal(core.sanitizeReply('**ตอบ:** "มีค่ะ ส่งฟรี"', 100), 'มีค่ะ ส่งฟรี');
  assert.equal(core.sanitizeReply('บรรทัดแรก\nบรรทัดสอง', 100), 'บรรทัดแรก บรรทัดสอง');
});

test('sanitizeReply: ตัดความยาวไม่ให้เกินลิมิตของช่องแชท', () => {
  const long = 'ก'.repeat(150);
  assert.equal(core.sanitizeReply(long, 100).length, 100);
  assert.ok(core.sanitizeReply('a'.repeat(40) + ' ' + 'b'.repeat(40), 50).length <= 50);
});

test('isSkip: รู้ว่าควรข้าม', () => {
  assert.equal(core.isSkip('SKIP'), true);
  assert.equal(core.isSkip('ข้าม'), true);
  assert.equal(core.isSkip('มีค่ะ'), false);
});

test('buildRequestBody (Claude): รุ่นปกติใส่ effort, Haiku ไม่ใส่', () => {
  const opus = core.buildRequestBody('claude', { model: 'claude-opus-5', system: 's', user: 'u' });
  assert.equal(opus.output_config.effort, 'low');
  assert.equal(opus.messages[0].role, 'user');
  assert.equal(opus.system, 's');
  const haiku = core.buildRequestBody('claude', { model: 'claude-haiku-4-5', system: 's', user: 'u' });
  assert.equal(haiku.output_config, undefined);
});

test('buildRequestBody (OpenAI): system ไปอยู่ใน messages ตามรูปแบบ chat completions', () => {
  const body = core.buildRequestBody('openai', { model: 'gpt-4o-mini', system: 's', user: 'u' });
  assert.equal(body.model, 'gpt-4o-mini');
  assert.equal(body.messages.length, 2);
  assert.equal(body.messages[0].role, 'system');
  assert.equal(body.messages[0].content, 's');
  assert.equal(body.messages[1].role, 'user');
  assert.equal(body.system, undefined);
  assert.equal(body.output_config, undefined);
});

test('extractText: อ่านคำตอบได้ทั้งสองค่าย', () => {
  const claude = { content: [{ type: 'thinking', thinking: '...' }, { type: 'text', text: ' มีค่ะ ' }] };
  assert.equal(core.extractText('claude', claude), 'มีค่ะ');
  assert.equal(core.extractText('claude', null), '');

  const openai = { choices: [{ message: { role: 'assistant', content: ' มีค่ะ ' } }] };
  assert.equal(core.extractText('openai', openai), 'มีค่ะ');
  assert.equal(core.extractText('openai', { choices: [] }), '');
});

// --- เลือกค่าย AI ได้ ---
test('activeProvider: คืนคีย์/รุ่น/ปลายทางของค่ายที่เลือกอยู่', () => {
  const ai = core.normalizeSettings({
    ai: { provider: 'openai', keys: { openai: 'sk-test', claude: 'sk-ant-x' } },
  }).ai;
  const p = core.activeProvider(ai);
  assert.equal(p.name, 'openai');
  assert.equal(p.key, 'sk-test');
  assert.equal(p.url, 'https://api.openai.com/v1/chat/completions');
});

test('activeProvider: ค่าย Claude ยิงไปที่ /v1/messages', () => {
  const p = core.activeProvider(core.normalizeSettings(null).ai);
  assert.equal(p.name, 'claude');
  assert.equal(p.url, 'https://api.anthropic.com/v1/messages');
});

test('normalizeSettings: ค่ายที่ไม่รู้จัก ตกกลับมาเป็น claude', () => {
  assert.equal(core.normalizeSettings({ ai: { provider: 'มั่ว' } }).ai.provider, 'claude');
});

test('normalizeSettings: เก็บคีย์แยกกันสองค่าย สลับไปมาไม่ต้องกรอกใหม่', () => {
  const ai = core.normalizeSettings({
    ai: { provider: 'claude', keys: { claude: 'sk-ant-1', openai: 'sk-oa-1' } },
  }).ai;
  assert.equal(ai.keys.claude, 'sk-ant-1');
  assert.equal(ai.keys.openai, 'sk-oa-1');
});

test('normalizeSettings: ย้ายคีย์เวอร์ชันเก่า (ai.apiKey) มาไว้ช่องของ Claude', () => {
  const ai = core.normalizeSettings({ ai: { apiKey: 'sk-ant-เก่า', model: 'claude-sonnet-5' } }).ai;
  assert.equal(ai.keys.claude, 'sk-ant-เก่า');
  assert.equal(ai.models.claude, 'claude-sonnet-5');
  assert.equal(ai.apiKey, undefined);
});

test('buildSystemPrompt: ใส่ลิมิตตัวอักษรและรายการสินค้าที่เห็นในไลฟ์', () => {
  const ai = Object.assign(baseAi(), { shopName: 'ร้านทดสอบ', maxChars: 80 });
  const prompt = core.buildSystemPrompt(ai, {
    scraped: [{ index: 1, name: 'เก้าอี้แคมป์ปิ้ง', price: '฿245.55' }],
  });
  assert.ok(prompt.includes('ไม่เกิน 80 ตัวอักษร'));
  assert.ok(prompt.includes('ร้านทดสอบ'));
  assert.ok(prompt.includes('ตะกร้า 1. เก้าอี้แคมป์ปิ้ง — ฿245.55'));
});

test('buildSystemPrompt: ใส่คลังข้อมูลสินค้าและชี้ว่าตัวไหนกำลังขาย', () => {
  const prompt = core.buildSystemPrompt(baseAi(), {
    scraped: [{ index: 1, name: 'เก้าอี้', price: '฿245' }, { index: 2, name: 'เก้าอี้ยาว', price: '฿139' }],
    knowledge: [{ basket: 1, name: 'เก้าอี้แคมป์ปิ้ง', price: '฿245', info: 'มีสีดำ แดง รับน้ำหนัก 120 กก. ส่งฟรี' }],
    focusBasket: 1,
  });
  assert.ok(prompt.includes('รับน้ำหนัก 120 กก.'));
  assert.ok(prompt.includes('"ตัวนี้"'));
  assert.ok(prompt.includes('← กำลังขายตัวนี้'));
});

test('buildSystemPrompt: ไม่มีข้อมูลสินค้า = สั่งไม่ให้เดา', () => {
  const prompt = core.buildSystemPrompt(baseAi(), {});
  assert.ok(prompt.includes('ยังไม่มีข้อมูลสินค้า'));
});

// --- คลังข้อมูลสินค้า ---
test('normalizeProducts: เรียงตามตะกร้า ตัดซ้ำ และตัดรายการที่ไม่มีเลขตะกร้า', () => {
  const list = core.normalizeSettings({
    products: [
      { basket: 3, name: 'ค', info: 'x' },
      { basket: 1, name: 'ก' },
      { basket: 1, name: 'ซ้ำ' },
      { name: 'ไม่มีตะกร้า' },
    ],
  }).products;
  assert.equal(list.length, 2);
  assert.equal(list[0].basket, 1);
  assert.equal(list[0].name, 'ก');
  assert.equal(list[1].basket, 3);
});

test('normalizeProducts: ค่าเริ่มต้นเป็นลิสต์ว่าง', () => {
  assert.equal(core.normalizeSettings(null).products.length, 0);
});

// --- เพดานคลิกกันระบบรวน ---
test('withinClickBudget: เกินเพดานต่อนาทีแล้วต้องไม่ให้กดต่อ', () => {
  const now = 100000;
  const many = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => now - i * 1000);
  assert.equal(core.withinClickBudget(many, now, 8), false);
  assert.equal(core.withinClickBudget(many.slice(0, 7), now, 8), true);
});

test('withinClickBudget: คลิกที่เก่ากว่า 1 นาทีไม่นับ', () => {
  const now = 100000;
  const old = [61000, 62000, 63000, 64000, 65000, 66000, 67000, 68000].map((d) => now - d);
  assert.equal(core.withinClickBudget(old, now, 8), true);
});

// --- ย้ายค่าที่บันทึกไว้จากเวอร์ชันก่อน ---
test('normalizeSettings: อัปเกรดแล้วล้างตำแหน่งปุ่มที่จิ้มไว้เอง แต่เก็บค่าอื่นไว้', () => {
  const migrated = core.normalizeSettings({
    pin: { basket: 2 },
    selectors: { pinButton: 'div:nth-of-type(3) > button', chatInput: 'textarea' },
  });
  assert.equal(migrated.selectors.pinButton, '');   // ปุ่มนี้อาจกลายเป็น "ยกเลิกการปักหมุด" ไปแล้ว
  assert.equal(migrated.selectors.chatInput, 'textarea'); // ของแชทไม่เกี่ยว เก็บไว้
  assert.equal(migrated.pin.basket, 2);
  assert.equal(migrated.version, 5);
});






// --- จังหวะปักหมุด: สองงานที่แยกกันเด็ดขาด ---
const PIN = { enabled: true, extendEverySec: 31 };

test('nextPinAction: ปิดอยู่ = off', () => {
  assert.equal(core.nextPinAction({}, { enabled: false, extendEverySec: 31 }, 0), 'off');
});

test('งานที่ 1 — ยังไม่ปัก = ปักครั้งเดียว', () => {
  assert.equal(core.nextPinAction({ pinned: false, lastPinAt: null }, PIN, 0), 'pin');
});

test('งานที่ 1 — เพิ่งกดปักไป ต้องเว้น 20 วินาทีก่อนลองใหม่', () => {
  assert.equal(core.nextPinAction({ pinned: false, lastPinAt: 1000 }, PIN, 15000), 'wait');
  assert.equal(core.nextPinAction({ pinned: false, lastPinAt: 1000 }, PIN, 25000), 'pin');
});

test('งานที่ 1 — ปักอยู่แล้ว ต้องไม่กดอะไรกับสินค้าอีก (ไม่มีคำว่า repin/unpin)', () => {
  const st = { pinned: true, extendAvailable: false, lastExtendAt: 0 };
  const action = core.nextPinAction(st, PIN, 999999);
  assert.equal(action, 'wait');
  assert.notEqual(action, 'pin');
});

test('งานที่ 2 — ปักอยู่ ปุ่ม +30 วิ โผล่ ยังไม่เคยกด = กดเลย', () => {
  assert.equal(core.nextPinAction({ pinned: true, extendAvailable: true, lastExtendAt: null }, PIN, 5000), 'extend');
});

test('งานที่ 2 — ยังไม่ครบรอบที่ตั้งไว้ = ไม่กด', () => {
  const st = { pinned: true, extendAvailable: true, lastExtendAt: 0 };
  assert.equal(core.nextPinAction(st, PIN, 10000), 'wait');
  assert.equal(core.nextPinAction(st, PIN, 30000), 'wait');
  assert.equal(core.nextPinAction(st, PIN, 31000), 'extend');
});

test('งานที่ 2 — ตั้งรอบเองได้ (35 วิ)', () => {
  const pin = { enabled: true, extendEverySec: 35 };
  const st = { pinned: true, extendAvailable: true, lastExtendAt: 0 };
  assert.equal(core.nextPinAction(st, pin, 34000), 'wait');
  assert.equal(core.nextPinAction(st, pin, 35000), 'extend');
});

test('งานที่ 2 — ถึงรอบแล้วแต่ปุ่มยังไม่โผล่ = รอเฉย ๆ ห้ามไปยุ่งกับหมุด', () => {
  const st = { pinned: true, extendAvailable: false, lastExtendAt: 0 };
  assert.equal(core.nextPinAction(st, PIN, 99999), 'wait');
});

// --- โหมดยกเลิกแล้วปักใหม่ ---
test('โหมด repin — ปักอยู่และครบรอบ = ยกเลิกแล้วปักใหม่', () => {
  const pin = { enabled: true, mode: 'repin', repinEverySec: 60, extendEverySec: 31 };
  assert.equal(core.nextPinAction({ pinned: true, lastPinAt: 0 }, pin, 30000), 'wait');
  assert.equal(core.nextPinAction({ pinned: true, lastPinAt: 0 }, pin, 61000), 'repin');
});

test('โหมด repin — นับรอบถัดไปจากครั้งล่าสุดที่ปักใหม่', () => {
  const pin = { enabled: true, mode: 'repin', repinEverySec: 60, extendEverySec: 31 };
  const st = { pinned: true, lastPinAt: 0, lastRepinAt: 60000 };
  assert.equal(core.nextPinAction(st, pin, 90000), 'wait');
  assert.equal(core.nextPinAction(st, pin, 121000), 'repin');
});

test('โหมด repin — ยังไม่ปัก = ปักก่อน ไม่ใช่ยกเลิก', () => {
  const pin = { enabled: true, mode: 'repin', repinEverySec: 60, extendEverySec: 31 };
  assert.equal(core.nextPinAction({ pinned: false, lastPinAt: null }, pin, 0), 'pin');
});

test('โหมด repin — ไม่ยุ่งกับปุ่มต่อเวลา แม้ปุ่มจะโผล่อยู่', () => {
  const pin = { enabled: true, mode: 'repin', repinEverySec: 60, extendEverySec: 31 };
  const st = { pinned: true, lastPinAt: 0, extendAvailable: true };
  assert.equal(core.nextPinAction(st, pin, 10000), 'wait');
});

test('normalizeSettings: โหมดปักหมุด ค่าเริ่มต้น extend และรอบ repin ขั้นต่ำ 30 วินาที', () => {
  assert.equal(core.normalizeSettings(null).pin.mode, 'extend');
  assert.equal(core.normalizeSettings({ pin: { mode: 'มั่ว' } }).pin.mode, 'extend');
  assert.equal(core.normalizeSettings({ pin: { mode: 'repin' } }).pin.mode, 'repin');
  assert.equal(core.normalizeSettings({ pin: { repinEverySec: 5 } }).pin.repinEverySec, 30);
  assert.equal(core.normalizeSettings({ pin: { repinGapMs: 10 } }).pin.repinGapMs, 300);
});

test('normalizeSettings: รอบกดต่อเวลาอยู่ในกรอบ 20-120 วินาที', () => {
  assert.equal(core.normalizeSettings(null).pin.extendEverySec, 31);
  assert.equal(core.normalizeSettings({ pin: { extendEverySec: 5 } }).pin.extendEverySec, 20);
  assert.equal(core.normalizeSettings({ pin: { extendEverySec: 999 } }).pin.extendEverySec, 120);
  assert.equal(core.normalizeSettings({ pin: { basket: 0 } }).pin.basket, 1);
});


// --- โหมดต่อเวลา (+30 วิ) ---









// --- กันพลาดแบบ "ลบฟังก์ชันทิ้งตอนแก้โค้ด" ---
// ไฟล์ในส่วนขยายต้องมี DOM จริงถึงจะรันได้ จึงตรวจแบบอ่านซอร์สว่าฟังก์ชันภายในยังอยู่ครบ
const readSrc = (name) => readFileSync(new URL('../live-helper/src/' + name, import.meta.url), 'utf8');

test('chat.js: ฟังก์ชันภายในที่ถูกเรียกใช้ ต้องถูกประกาศไว้จริง', () => {
  const src = readSrc('chat.js');
  for (const fn of ['send', 'scan', 'collect', 'remember', 'processOne', 'status', 'warn']) {
    assert.ok(src.includes('function ' + fn + '('), 'ไม่พบ function ' + fn + '() ใน chat.js');
  }
});

test('autopin.js: ฟังก์ชันภายในที่ถูกเรียกใช้ ต้องถูกประกาศไว้จริง', () => {
  const src = readSrc('autopin.js');
  for (const fn of ['click', 'doPin', 'doExtend', 'doRepin', 'tick', 'status', 'label', 'warn']) {
    assert.ok(src.includes('function ' + fn + '('), 'ไม่พบ function ' + fn + '() ใน autopin.js');
  }
});

test('dom.js: ฟังก์ชันที่ไฟล์อื่นเรียกใช้ ต้องถูก export ออกมา', () => {
  const src = readSrc('dom.js');
  for (const fn of ['chatList', 'chatInput', 'sendButton', 'commentRows', 'parseCommentNode',
    'pinButton', 'unpinButton', 'extendButton', 'isPinned', 'productCard', 'productCards',
    'targetName', 'flash', 'captchaEl', 'spotlightCaptcha', 'clearSpotlight', 'beep',
    'typeInto', 'pressEnter', 'realClick', 'scrapeProducts', 'cssPath', 'startPicker', 'textOf']) {
    assert.ok(new RegExp('\\b' + fn + '\\b').test(src.split('root.TTLH')[1] || ''),
      'dom.js ไม่ได้ export ' + fn);
  }
});
