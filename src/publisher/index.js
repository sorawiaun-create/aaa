import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config.js';
import { publishFacebook } from './facebook.js';
import { publishInstagram } from './instagram.js';
import { publishTiktok } from './tiktok.js';

// จับคู่ชื่อแพลตฟอร์ม (ไทย/อังกฤษ) กับตัวเผยแพร่
function pickAdapter(platform) {
  const p = String(platform).toLowerCase();
  if (p.includes('facebook') || p.includes('เฟส') || p.includes('fb')) return publishFacebook;
  if (p.includes('instagram') || p.includes('ig') || p.includes('อิน')) return publishInstagram;
  if (p.includes('tiktok') || p.includes('ติ๊กต๊อก') || p.includes('ทิก')) return publishTiktok;
  return null;
}

// เขียน posts.json ลงโฟลเดอร์แคมเปญ (media เป็น path สัมพัทธ์กับโฟลเดอร์)
export function savePostsManifest(ctx, brief) {
  const posts = (ctx.posts || []).map((p) => ({
    ...p,
    media: (p.media || []).map((m) => path.relative(ctx.dir, m)),
  }));
  const manifest = { brief, createdAt: new Date().toISOString(), posts };
  fs.writeFileSync(path.join(ctx.dir, 'posts.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

// เผยแพร่โพสต์ทั้งหมดของแคมเปญ (อ่านจาก posts.json)
// dir = โฟลเดอร์แคมเปญ; onlyPlatforms = array ชื่อแพลตฟอร์มที่จะโพสต์ (ไม่ใส่ = ทั้งหมด)
export async function publishCampaign(dir, { onlyPlatforms } = {}) {
  const manifestPath = path.join(dir, 'posts.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`ไม่พบ posts.json ในโฟลเดอร์: ${dir}`);
  }
  const { posts } = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const ctx = { dir };
  const results = [];

  for (const post of posts) {
    if (onlyPlatforms && !onlyPlatforms.some((x) => post.platform.toLowerCase().includes(x.toLowerCase()))) continue;
    const adapter = pickAdapter(post.platform);
    if (!adapter) {
      results.push({ platform: post.platform, status: 'skipped', reason: 'ยังไม่มีตัวเผยแพร่สำหรับแพลตฟอร์มนี้' });
      continue;
    }
    const r = await adapter(post, ctx);
    results.push(r);
  }
  return results;
}
