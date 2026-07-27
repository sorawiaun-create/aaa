import { runCampaign } from './orchestrator.js';

// ตัวอย่างการรัน: node src/index.js "โจทย์แคมเปญของคุณ"
const brief =
  process.argv.slice(2).join(' ').trim() ||
  'อยากได้แคมเปญเปิดตัวครีมกันแดดตัวใหม่ ทำคอนเทนต์ลง TikTok, Instagram และ Facebook ' +
    'กลุ่มเป้าหมายผู้หญิง 18-30 โทนสนุกสดใส';

console.log('🎬  เริ่มงานผลิตคอนเทนต์');
console.log('📋  โจทย์:', brief, '\n');

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn('⚠️  ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY — ดูวิธีตั้งค่าใน README / .env.example\n');
}

const finalReport = await runCampaign(brief, (ev) => {
  if (ev.type === 'delegate') {
    console.log(`\n➡️  มอบหมายให้ [${ev.dept}]`);
    console.log(`   งาน: ${ev.task}`);
  } else if (ev.type === 'result') {
    console.log(`\n✅  [${ev.dept}] ส่งงานแล้ว:\n`);
    console.log(ev.result);
    console.log('\n' + '─'.repeat(60));
  }
});

console.log('\n\n══════════════════════════════════════════');
console.log('📦  สรุปแพ็กเกจคอนเทนต์ (จากผู้จัดการ)');
console.log('══════════════════════════════════════════\n');
console.log(finalReport);
