import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config.js';
import { escapeHtml, wrapLines, aspectToSize, slugify } from '../util.js';

// ============================================================================
//  เลเยอร์ผลิตสื่อ (Media Provider)
//  - โหมด 'placeholder' : สร้างไฟล์ตัวอย่างจริง (SVG/มานิเฟสต์) โดยไม่ต้องมี key
//  - โหมด 'replicate'   : เจนภาพ/วิดีโอจริง ผ่าน Replicate API (ตั้ง REPLICATE_API_TOKEN)
//  เพิ่ม provider อื่น (fal.ai / OpenAI / Google) ได้โดยเพิ่ม branch ในฟังก์ชันด้านล่าง
// ============================================================================

const PALETTE = ['#FF5722', '#2196F3', '#00C853', '#9C27B0', '#FE2C55', '#FFC107'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// -------------------- ภาพ --------------------
export async function generateImage({ prompt, description = '', aspectRatio = '1:1', filename }, ctx) {
  const base = filename || slugify(description || prompt) || 'image';
  const provider = process.env.IMAGE_PROVIDER || CONFIG.media.imageProvider;

  // OpenAI (ChatGPT / gpt-image-1)
  if (provider === 'openai') {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error('ยังไม่ได้ตั้งค่า OPENAI_API_KEY');
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1', prompt, size: openaiSize(aspectRatio), n: 1 }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(`OpenAI error: ${json.error?.message || JSON.stringify(json)}`);
    const b64 = json.data?.[0]?.b64_json;
    if (!b64) throw new Error('OpenAI ไม่ส่งภาพกลับมา');
    const outPath = path.join(ctx.assetsDir, ensureExt(base, '.png'));
    fs.writeFileSync(outPath, Buffer.from(b64, 'base64'));
    return record(ctx, { type: 'image', path: outPath, provider: 'openai', prompt, aspectRatio });
  }

  if (provider === 'replicate') {
    const output = await replicatePredict(CONFIG.media.imageModel, {
      prompt,
      aspect_ratio: aspectRatio,
    });
    const url = firstUrl(output);
    const outPath = path.join(ctx.assetsDir, ensureExt(base, extFromUrl(url, '.png')));
    await download(url, outPath);
    return record(ctx, { type: 'image', path: outPath, provider: 'replicate', prompt, aspectRatio });
  }

  // placeholder (ค่าเริ่มต้น)
  const outPath = path.join(ctx.assetsDir, ensureExt(base, '.svg'));
  fs.writeFileSync(outPath, placeholderImageSVG({ prompt, description, aspectRatio }));
  return record(ctx, { type: 'image', path: outPath, provider: 'placeholder', prompt, aspectRatio });
}

// -------------------- วิดีโอ --------------------
export async function generateVideo({ title, storyboard = '', aspectRatio = '9:16', filename }, ctx) {
  const base = filename || slugify(title) || 'video';

  if ((process.env.VIDEO_PROVIDER || CONFIG.media.videoProvider) === 'replicate') {
    const prompt = `${title}. ${storyboard}`.slice(0, 1500);
    const output = await replicatePredict(CONFIG.media.videoModel, { prompt });
    const url = firstUrl(output);
    const outPath = path.join(ctx.assetsDir, ensureExt(base, extFromUrl(url, '.mp4')));
    await download(url, outPath);
    return record(ctx, { type: 'video', path: outPath, provider: 'replicate', title, aspectRatio });
  }

  // placeholder: บันทึกบรีฟเรนเดอร์เป็นไฟล์
  const outPath = path.join(ctx.assetsDir, ensureExt(base, '.md'));
  const manifest =
    `# 🎬 Render Brief: ${title}\n\n` +
    `- อัตราส่วน: ${aspectRatio}\n` +
    `- provider: placeholder (ยังไม่ได้ต่อ text-to-video จริง)\n\n` +
    `## Storyboard / คำสั่งเรนเดอร์\n\n${storyboard}\n\n` +
    `> ตั้ง VIDEO_PROVIDER=replicate + REPLICATE_API_TOKEN เพื่อเรนเดอร์วิดีโอจริง\n`;
  fs.writeFileSync(outPath, manifest);
  return record(ctx, { type: 'video', path: outPath, provider: 'placeholder', title, aspectRatio });
}

// -------------------- Replicate API --------------------
// สร้าง prediction แล้ว poll จน succeeded (รองรับทั้งภาพเร็ว และวิดีโอที่ใช้เวลานาน)
async function replicatePredict(model, input) {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error('ยังไม่ได้ตั้งค่า REPLICATE_API_TOKEN');
  if (!model) throw new Error('ยังไม่ได้ระบุ model (CONFIG.media.imageModel / videoModel)');

  const res = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'wait', // รอผลในคำขอเดียวถ้าเสร็จเร็ว (ภาพ) มิฉะนั้นค่อย poll ต่อ
    },
    body: JSON.stringify({ input }),
  });
  let pred = await res.json();
  if (!res.ok) throw new Error(`Replicate error: ${pred.detail || JSON.stringify(pred)}`);

  const terminal = ['succeeded', 'failed', 'canceled'];
  let tries = 0;
  while (pred.status && !terminal.includes(pred.status) && tries < 150) {
    await sleep(3000);
    const p = await fetch(pred.urls.get, { headers: { Authorization: `Bearer ${token}` } });
    pred = await p.json();
    tries++;
  }
  if (pred.status !== 'succeeded') {
    throw new Error(`สร้างสื่อไม่สำเร็จ (status: ${pred.status}) ${pred.error || ''}`);
  }
  return pred.output;
}

// -------------------- helpers --------------------
function firstUrl(output) {
  const url = Array.isArray(output) ? output[0] : output;
  if (typeof url !== 'string') throw new Error('รูปแบบผลลัพธ์จาก provider ไม่ใช่ URL');
  return url;
}

async function download(url, outPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ดาวน์โหลดไฟล์ไม่สำเร็จ: ${res.status}`);
  fs.writeFileSync(outPath, Buffer.from(await res.arrayBuffer()));
}

// อัตราส่วนภาพ -> ขนาดที่ gpt-image-1 รองรับ
function openaiSize(aspectRatio = '1:1') {
  const [w, h] = String(aspectRatio).split(':').map(Number);
  if (w && h && h > w) return '1024x1536'; // แนวตั้ง (4:5, 9:16)
  if (w && h && w > h) return '1536x1024'; // แนวนอน (16:9)
  return '1024x1024'; // จตุรัส
}

function extFromUrl(url, fallback) {
  const m = String(url).split('?')[0].match(/\.([a-z0-9]{2,4})$/i);
  return m ? '.' + m[1].toLowerCase() : fallback;
}

function record(ctx, asset) {
  ctx.assets = ctx.assets || [];
  ctx.assets.push(asset);
  return asset;
}

function ensureExt(base, ext) {
  let b = slugify(base) || 'file';
  if (!b.toLowerCase().endsWith(ext.toLowerCase())) b += ext;
  return b;
}

function placeholderImageSVG({ prompt, description, aspectRatio }) {
  const { width, height } = aspectToSize(aspectRatio);
  const color = PALETTE[Math.abs(hash(prompt)) % PALETTE.length];
  const lines = wrapLines(prompt, Math.max(24, Math.floor(width / 16)), 14);
  const startY = height / 2 - (lines.length * 22) / 2;
  const textEls = lines
    .map((ln, i) => `<text x="50%" y="${startY + i * 22}" fill="#fff" font-size="16" font-family="sans-serif" text-anchor="middle">${escapeHtml(ln)}</text>`)
    .join('\n  ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="${color}"/>
  <rect x="8" y="8" width="${width - 16}" height="${height - 16}" fill="none" stroke="#ffffff55" stroke-width="2" rx="12"/>
  <text x="50%" y="40" fill="#ffffffcc" font-size="14" font-family="sans-serif" text-anchor="middle">🖼️ IMAGE PLACEHOLDER · ${escapeHtml(aspectRatio)}</text>
  ${textEls}
  <text x="50%" y="${height - 20}" fill="#ffffffaa" font-size="12" font-family="sans-serif" text-anchor="middle">${escapeHtml(description).slice(0, 60)}</text>
</svg>`;
}

function hash(s) {
  let h = 0;
  for (let i = 0; i < String(s).length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
