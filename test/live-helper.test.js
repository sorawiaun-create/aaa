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
  assert.equal(s.pin.intervalSec, 30);
  assert.equal(s.ai.model, 'claude-opus-5');
  assert.equal(s.ai.maxChars, 100);
});

test('normalizeSettings: ล็อกรอบปักหมุดขั้นต่ำ 15 วินาที', () => {
  assert.equal(core.normalizeSettings({ pin: { intervalSec: 5 } }).pin.intervalSec, 15);
  assert.equal(core.normalizeSettings({ pin: { intervalSec: 60 } }).pin.intervalSec, 60);
  assert.equal(core.normalizeSettings({ pin: { intervalSec: 'x' } }).pin.intervalSec, 30);
  assert.equal(core.normalizeSettings({ pin: { basket: 0 } }).pin.basket, 1);
});

test('normalizeSettings: รับคำต้องห้ามเป็นข้อความคั่นด้วย , หรือขึ้นบรรทัดใหม่', () => {
  const s = core.normalizeSettings({ ai: { blockWords: 'โกง, ห่วย\nแพง' } });
  assert.equal(s.ai.blockWords.join('|'), 'โกง|ห่วย|แพง');
});

test('normalizeSettings: ตัด / ท้าย API base ออก', () => {
  assert.equal(core.normalizeSettings({ ai: { apiBase: 'https://x.dev///' } }).ai.apiBase, 'https://x.dev');
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

test('shouldReply: ข้ามคอมเมนต์ที่เคยเห็นแล้ว', () => {
  const ai = Object.assign(baseAi(), { enabled: true });
  const comment = { user: 'nene', text: 'มีสีดำไหม' };
  const state = { seen: { [core.commentId(comment)]: 1 } };
  assert.equal(core.shouldReply(comment, state, ai, 2000).ok, false);
});

test('shouldReply: คนเดิมต้องรอครบ cooldown', () => {
  const ai = Object.assign(baseAi(), { enabled: true, userCooldownSec: 90 });
  const state = { lastByUser: { nene: 10000 } };
  assert.equal(core.shouldReply({ user: 'Nene', text: 'ส่งกี่วันคะ' }, state, ai, 20000).ok, false);
  assert.equal(core.shouldReply({ user: 'Nene', text: 'ส่งกี่วันคะ' }, state, ai, 120000).ok, true);
});

test('shouldReply: เกินโควตาต่อนาทีแล้วหยุดตอบ', () => {
  const ai = Object.assign(baseAi(), { enabled: true, replyPerMin: 2 });
  const now = 100000;
  const state = { replyTimes: [now - 1000, now - 2000] };
  assert.equal(core.shouldReply({ user: 'a', text: 'ราคาเท่าไหร่' }, state, ai, now).ok, false);
  // ของเก่าเกิน 1 นาทีไม่นับ
  const old = { replyTimes: [now - 61000, now - 70000] };
  assert.equal(core.shouldReply({ user: 'a', text: 'ราคาเท่าไหร่' }, old, ai, now).ok, true);
});

test('shouldReply: โหมดตอบเฉพาะคำถาม', () => {
  const ai = Object.assign(baseAi(), { enabled: true, onlyQuestions: true });
  assert.equal(core.shouldReply({ user: 'a', text: 'สวยมากเลย' }, {}, ai, 1).ok, false);
  assert.equal(core.shouldReply({ user: 'a', text: 'มีสีแดงมั้ยคะ' }, {}, ai, 1).ok, true);
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

test('buildRequestBody: รุ่นปกติใส่ effort, Haiku ไม่ใส่', () => {
  const opus = core.buildRequestBody({ model: 'claude-opus-5', system: 's', user: 'u' });
  assert.equal(opus.output_config.effort, 'low');
  assert.equal(opus.messages[0].role, 'user');
  const haiku = core.buildRequestBody({ model: 'claude-haiku-4-5', system: 's', user: 'u' });
  assert.equal(haiku.output_config, undefined);
});

test('extractText: รวมเฉพาะบล็อกข้อความ', () => {
  const res = { content: [{ type: 'thinking', thinking: '...' }, { type: 'text', text: ' มีค่ะ ' }] };
  assert.equal(core.extractText(res), 'มีค่ะ');
  assert.equal(core.extractText(null), '');
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

// --- จังหวะปักหมุด ---
test('nextPinAction: ปิดอยู่ = off', () => {
  assert.equal(core.nextPinAction({}, { enabled: false, intervalSec: 30 }, 0), 'off');
});

test('nextPinAction: ยังไม่ครบรอบ = wait', () => {
  const pin = { enabled: true, intervalSec: 30, whenPinned: 'repin' };
  assert.equal(core.nextPinAction({ lastActionAt: 1000, pinned: false }, pin, 10000), 'wait');
});

test('nextPinAction: ครบรอบแล้วยังไม่ปัก = pin', () => {
  const pin = { enabled: true, intervalSec: 30, whenPinned: 'repin' };
  assert.equal(core.nextPinAction({ lastActionAt: null, pinned: false }, pin, 0), 'pin');
  assert.equal(core.nextPinAction({ lastActionAt: 1000, pinned: false }, pin, 40000), 'pin');
});

test('nextPinAction: ครบรอบและปักค้างอยู่ = ยกเลิกแล้วปักใหม่ (ค่าเริ่มต้น)', () => {
  const now = 100000;
  const state = { lastActionAt: now - 40000, pinned: true };
  const at = (mode) => core.nextPinAction(state, { enabled: true, intervalSec: 30, whenPinned: mode }, now);
  assert.equal(at('repin'), 'repin');
  assert.equal(at('extend'), 'extend');
  assert.equal(at('wait'), 'wait');
});

test('normalizeSettings: โหมดเมื่อปักค้างอยู่ ค่าเริ่มต้นคือ repin และกันค่ามั่ว', () => {
  assert.equal(core.normalizeSettings(null).pin.whenPinned, 'repin');
  assert.equal(core.normalizeSettings({ pin: { whenPinned: 'มั่ว' } }).pin.whenPinned, 'repin');
  assert.equal(core.normalizeSettings({ pin: { whenPinned: 'extend' } }).pin.whenPinned, 'extend');
  assert.equal(core.normalizeSettings({ pin: { repinGapMs: 10 } }).pin.repinGapMs, 300);
});
