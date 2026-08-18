// ai.js — ให้ ChatGPT (OpenAI) คิดแคปชั่น + แฮชแท็กสำหรับคลิปขายของ
// ใช้ใน 2 บริบท: side panel (ตอนเพิ่มคลิป/กดคิดใหม่) และ background (ตอนจะโพสต์ ถ้ายังไม่มีแคปชั่น)

const ENDPOINT = 'https://api.openai.com/v1/chat/completions';

/**
 * คิดแคปชั่น + แฮชแท็ก 1 ชุด
 * @param {object} o
 *   apiKey, model, product, filename, extra, tone, language, maxHashtags
 * @returns {Promise<{caption:string, hashtags:string[]}>}
 */
export async function generateCaption(o = {}) {
  const {
    apiKey,
    model = 'gpt-4o-mini',
    product = '',
    filename = '',
    extra = '',
    tone = 'สนุก เป็นกันเอง กระตุ้นให้กดตะกร้า',
    language = 'ไทย',
    maxHashtags = 5,
  } = o;

  if (!apiKey) throw new Error('ยังไม่ได้ใส่ OpenAI API key (ไปที่การ์ด AI)');

  const system =
    `คุณเป็นนักเขียนแคปชั่น TikTok สายขายของ เขียนภาษา${language} ` +
    `สั้น กระชับ ดึงดูดใน 1-2 บรรทัด มีอีโมจิพอดี ` +
    `ปิดท้ายชวนกด "ตะกร้า" ด้านล่างคลิป ` +
    `ห้ามสัญญาเกินจริง ห้ามใช้คำต้องห้าม/อวดอ้างสรรพคุณเว่อร์`;

  const user =
    `เขียนแคปชั่น TikTok ให้คลิปขายสินค้านี้\n` +
    `สินค้า/คำค้น: ${product || '(ไม่ระบุ — เดาจากชื่อไฟล์)'}\n` +
    `ชื่อไฟล์คลิป: ${filename}\n` +
    `โทน: ${tone}\n` +
    (extra ? `รายละเอียดเพิ่มเติม: ${extra}\n` : '') +
    `ขอแฮชแท็กที่เกี่ยวข้องไม่เกิน ${maxHashtags} อัน (ไม่ต้องใส่ # ในค่า)\n` +
    `ตอบเป็น JSON เท่านั้น รูปแบบ: {"caption": "...", "hashtags": ["...", "..."]}`;

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.9,
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`OpenAI ${res.status}: ${t.slice(0, 160)}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content || '{}';
  return normalize(content, maxHashtags);
}

/** แปลงผลลัพธ์ให้เป็น {caption, hashtags[]} ที่สะอาด */
export function normalize(content, maxHashtags = 5) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = { caption: String(content).trim(), hashtags: [] };
  }
  let hashtags = parsed.hashtags || [];
  if (typeof hashtags === 'string') hashtags = hashtags.split(/[\s,]+/);
  hashtags = hashtags
    .map((h) => String(h).trim().replace(/^#+/, ''))
    .filter(Boolean)
    .slice(0, maxHashtags);
  return { caption: String(parsed.caption || '').trim(), hashtags };
}

/**
 * คิดเป็นชุดหลายคลิป พร้อมจำกัด concurrency + progress
 * @param {Array} items [{ id, product, filename, extra }]
 * @param {object} base ตัวเลือกร่วม (apiKey, model, tone, language ...)
 * @param {(done:number,total:number,item:object,result?:object,error?:string)=>void} onProgress
 * @param {number} concurrency
 * @returns {Promise<Map<string,{caption,hashtags}>>}
 */
export async function generateBatch(items, base, onProgress = () => {}, concurrency = 3) {
  const results = new Map();
  let done = 0;
  const queue = items.slice();

  async function worker() {
    while (queue.length) {
      const item = queue.shift();
      try {
        const r = await generateCaption({ ...base, ...item });
        results.set(item.id, r);
        onProgress(++done, items.length, item, r);
      } catch (e) {
        onProgress(++done, items.length, item, undefined, String(e?.message || e));
      }
    }
  }

  const n = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: n }, worker));
  return results;
}
