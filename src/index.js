import fs from 'node:fs';
import path from 'node:path';
import { runCampaign } from './orchestrator.js';
import { createCampaignDir, buildHtmlPreview } from './output.js';

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

const { finalReport, timeline } = await runCampaign(brief, ctx, (ev) => {
  if (ev.type === 'delegate') {
    console.log(`\n➡️  มอบหมายให้ [${ev.dept}]`);
    console.log(`   งาน: ${ev.task}`);
  } else if (ev.type === 'result') {
    const files = (ev.assets || []).map((a) => path.relative(ctx.dir, a.path));
    console.log(`\n✅  [${ev.dept}] ส่งงานแล้ว${files.length ? ` (สร้างไฟล์: ${files.join(', ')})` : ''}`);
    console.log(ev.result);
    console.log('\n' + '─'.repeat(60));
  }
});

const previewPath = buildHtmlPreview({ dir: ctx.dir, brief, timeline, finalReport });

console.log('\n\n══════════════════════════════════════════');
console.log('📦  สรุปแพ็กเกจคอนเทนต์ (จากผู้จัดการ)');
console.log('══════════════════════════════════════════\n');
console.log(finalReport);
console.log('\n🌐  เปิดพรีวิวรวมงานทั้งหมดได้ที่:', previewPath);
console.log('📂  ไฟล์งานทั้งหมดอยู่ใน:', ctx.dir);
