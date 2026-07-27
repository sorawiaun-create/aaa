import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config.js';
import { escapeHtml, wrapLines, aspectToSize, slugify } from '../util.js';

// ============================================================================
//  เลเยอร์ผลิตสื่อ (Media Provider)
//  - โหมด 'placeholder' : สร้างไฟล์ตัวอย่างจริง (SVG/มานิเฟสต์) ให้ pipeline ครบวงจร
//  - ต่อ API จริงได้โดยเพิ่ม provider ใหม่ในฟังก์ชันด้านล่าง (มีจุด TODO ระบุไว้)
// ============================================================================

const PALETTE = ['#FF5722', '#2196F3', '#00C853', '#9C27B0', '#FE2C55', '#FFC107'];

// -------------------- ภาพ --------------------
export async function generateImage({ prompt, description = '', aspectRatio = '1:1', filename }, ctx) {
  const name = ensureExt(filename || slugify(description || prompt), '.svg', 'placeholder');
  const outPath = path.join(ctx.assetsDir, name);

  if (CONFIG.media.imageProvider === 'placeholder') {
    fs.writeFileSync(outPath, placeholderImageSVG({ prompt, description, aspectRatio }));
    return record(ctx, { type: 'image', path: outPath, provider: 'placeholder', prompt, aspectRatio });
  }

  // TODO: ต่อ API จริง เช่น text-to-image
  //   const bytes = await callImageAPI({ prompt, aspectRatio });
  //   fs.writeFileSync(outPath.replace(/\.svg$/, '.png'), bytes);
  throw new Error(`ยังไม่ได้ตั้งค่า image provider: ${CONFIG.media.imageProvider}`);
}

// -------------------- วิดีโอ --------------------
export async function generateVideo({ title, storyboard = '', aspectRatio = '9:16', filename }, ctx) {
  const name = ensureExt(filename || slugify(title), '.md', 'video-brief');
  const outPath = path.join(ctx.assetsDir, name);

  if (CONFIG.media.videoProvider === 'placeholder') {
    const manifest =
      `# 🎬 Render Brief: ${title}\n\n` +
      `- อัตราส่วน: ${aspectRatio}\n` +
      `- provider: placeholder (ยังไม่ได้ต่อ text-to-video จริง)\n\n` +
      `## Storyboard / คำสั่งเรนเดอร์\n\n${storyboard}\n\n` +
      `> เมื่อต่อ API จริงแล้ว ระบบจะเรนเดอร์ไฟล์วิดีโอไว้ที่โฟลเดอร์นี้แทนไฟล์บรีฟนี้\n`;
    fs.writeFileSync(outPath, manifest);
    return record(ctx, { type: 'video', path: outPath, provider: 'placeholder', title, aspectRatio });
  }

  // TODO: ต่อ API จริง text-to-video
  throw new Error(`ยังไม่ได้ตั้งค่า video provider: ${CONFIG.media.videoProvider}`);
}

// -------------------- helpers --------------------
function record(ctx, asset) {
  ctx.assets = ctx.assets || [];
  ctx.assets.push(asset);
  return asset;
}

function ensureExt(base, ext, fallback) {
  let b = slugify(base) || fallback;
  if (!b.endsWith(ext)) b += ext;
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
