import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from '../ai.js';

test('แปลง JSON ปกติได้', () => {
  const r = normalize('{"caption":"ลองเลย 👟","hashtags":["รองเท้า","ลดราคา"]}');
  assert.equal(r.caption, 'ลองเลย 👟');
  assert.deepEqual(r.hashtags, ['รองเท้า', 'ลดราคา']);
});

test('ตัด # นำหน้าออก และตัดตามจำนวนสูงสุด', () => {
  const r = normalize('{"caption":"x","hashtags":["#a","#b","c","d"]}', 2);
  assert.deepEqual(r.hashtags, ['a', 'b']);
});

test('รับ hashtags แบบ string ได้', () => {
  const r = normalize('{"caption":"x","hashtags":"#a #b, c"}', 5);
  assert.deepEqual(r.hashtags, ['a', 'b', 'c']);
});

test('ถ้าไม่ใช่ JSON ให้ถือ content เป็น caption', () => {
  const r = normalize('แคปชั่นเฉยๆ');
  assert.equal(r.caption, 'แคปชั่นเฉยๆ');
  assert.deepEqual(r.hashtags, []);
});

test('กันค่า null/ไม่มี field', () => {
  const r = normalize('{}');
  assert.equal(r.caption, '');
  assert.deepEqual(r.hashtags, []);
});
