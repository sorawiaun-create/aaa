import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from './config.js';
import { runCampaign } from './orchestrator.js';
import { createCampaignDir, buildHtmlPreview } from './output.js';
import { savePostsManifest, publishCampaign } from './publisher/index.js';

// โหลด .env แบบง่าย (ไม่ต้องพึ่ง dependency)
function loadDotenv() {
  try {
    const raw = fs.readFileSync('.env', 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    /* ไม่มี .env ก็ข้ามไป */
  }
}
loadDotenv();

// โหมดส่ง event แบบ JSON (ให้หน้าเว็บอ่าน progress) เปิดด้วย WEB_EVENTS=1
const EMIT = process.env.WEB_EVENTS === '1';
const emit = (o) => { if (EMIT) process.stdout.write('@@EV@@' + JSON.stringify(o) + '\n'); };

const brief =
  process.argv.slice(2).join(' ').trim() ||
  'อยากได้แคมเปญเปิดตัวครีมกันแดดตัวใหม่ ทำคอนเทนต์ลง TikTok, Instagram และ Facebook ' +
    'กลุ่มเป้าหมายผู้หญิง 18-30 โทนสนุกสดใส';

console.log('🎬  เริ่มงานผลิตคอนเทนต์');
console.log('📋  โจทย์:', brief, '\n');

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('❌  ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY — ดูวิธีตั้งค่าใน README / .env.example');
  process.exit(1);
}

const ctx = createCampaignDir(brief);
console.log('📁  โฟลเดอร์ผลงาน:', ctx.dir, '\n');

emit({ type: 'start', dir: ctx.dir });
const { finalReport, timeline } = await runCampaign(brief, ctx, (ev) => {
  if (ev.type === 'delegate') {
    console.log(`\n➡️  มอบหมายให้ [${ev.dept}]`);
    console.log(`   งาน: ${ev.task}`);
    emit({ type: 'delegate', key: ev.key, dept: ev.dept, task: ev.task });
  } else if (ev.type === 'result') {
    const files = (ev.assets || []).map((a) => path.relative(ctx.dir, a.path));
    console.log(`\n✅  [${ev.dept}] ส่งงานแล้ว${files.length ? ` (สร้างไฟล์: ${files.join(', ')})` : ''}`);
    console.log(ev.result);
    console.log('\n' + '─'.repeat(60));
    emit({ type: 'result', key: ev.key, dept: ev.dept, files });
  }
});

const previewPath = buildHtmlPreview({ dir: ctx.dir, brief, timeline, finalReport });
const manifest = savePostsManifest(ctx, brief);
emit({ type: 'done', dir: ctx.dir, preview: previewPath, posts: manifest.posts.length, finalReport });

console.log('\n\n══════════════════════════════════════════');
console.log('📦  สรุปแพ็กเกจคอนเทนต์ (จากผู้จัดการ)');
console.log('══════════════════════════════════════════\n');
console.log(finalReport);
console.log('\n🌐  เปิดพรีวิวรวมงานทั้งหมดได้ที่:', previewPath);
console.log('📂  ไฟล์งานทั้งหมดอยู่ใน:', ctx.dir);
console.log(`📤  โพสต์ที่พร้อมเผยแพร่: ${manifest.posts.length} โพสต์ (posts.json)`);

// เผยแพร่ต่อ: อัตโนมัติถ้า AUTO_PUBLISH=true, ไม่งั้นแนะนำคำสั่งให้รีวิวก่อน
if (CONFIG.publish.autoAfterRun && manifest.posts.length) {
  console.log('\n🚀  AUTO_PUBLISH เปิดอยู่ — กำลังเผยแพร่...\n');
  const results = await publishCampaign(ctx.dir);
  for (const r of results) console.log(`   [${r.platform}] ${r.status}${r.reason ? ' — ' + r.reason : ''}${r.error ? ' — ' + r.error : ''}`);
} else if (manifest.posts.length) {
  console.log('\n👉  ตรวจงานแล้วสั่งเผยแพร่ด้วย:');
  console.log(`      node src/publish.js "${ctx.dir}"`);
  console.log('   (ค่าเริ่มต้นเป็นโหมดซ้อม — ตั้ง PUBLISH_LIVE=true + ใส่ token เพื่อโพสต์จริง)');
}
