import fs from 'node:fs';
import { CONFIG } from './config.js';
import { publishCampaign } from './publisher/index.js';

// โหลด .env แบบง่าย
function loadDotenv() {
  try {
    for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    /* ไม่มี .env ก็ข้าม */
  }
}
loadDotenv();

// ใช้: node src/publish.js <โฟลเดอร์แคมเปญ> [platform,platform]
const dir = process.argv[2];
const only = process.argv[3] ? process.argv[3].split(',').map((s) => s.trim()) : undefined;

if (!dir) {
  console.error('ใช้: node src/publish.js <โฟลเดอร์แคมเปญ> [facebook,instagram,tiktok]');
  console.error('ตัวอย่าง: node src/publish.js output/glowshield-2026-07-29');
  process.exit(1);
}

console.log(CONFIG.publish.live ? '🚀 โหมดโพสต์จริง (LIVE)' : '🧪 โหมดซ้อมโพสต์ (dry-run) — ตั้ง PUBLISH_LIVE=true เพื่อโพสต์จริง');
console.log('📂 แคมเปญ:', dir, only ? `| เฉพาะ: ${only.join(', ')}` : '', '\n');

const results = await publishCampaign(dir, { onlyPlatforms: only });

const icon = { published: '✅', uploaded: '✅', 'dry-run': '🧪', skipped: '⏭️', error: '❌' };
for (const r of results) {
  console.log(`${icon[r.status] || '•'}  [${r.platform}] ${r.status}` + (r.id ? ` id=${r.id}` : '') + (r.reason ? ` — ${r.reason}` : '') + (r.error ? ` — ${r.error}` : '') + (r.note ? ` — ${r.note}` : ''));
}
console.log('\nเสร็จสิ้น', results.length, 'โพสต์');
