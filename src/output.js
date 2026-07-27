import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from './config.js';
import { slugify, escapeHtml } from './util.js';

// สร้างโฟลเดอร์แคมเปญ: output/<slug>-<timestamp>/ (พร้อมโฟลเดอร์ assets/)
export function createCampaignDir(brief) {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const dir = path.join(CONFIG.outputRoot, `${slugify(brief, 30)}-${stamp}`);
  const assetsDir = path.join(dir, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });
  return { dir, assetsDir };
}

// บันทึกไฟล์ข้อความ (เช่นผลงานของแต่ละแผนก)
export function saveText(dir, name, content) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, content ?? '');
  return p;
}

// สร้างหน้าพรีวิว index.html รวมงานทั้งแคมเปญ
export function buildHtmlPreview({ dir, brief, timeline, finalReport }) {
  const sections = timeline
    .map((t) => {
      const assetsHtml = (t.assets || [])
        .map((a) => {
          const rel = path.relative(dir, a.path);
          if (a.type === 'image') {
            return `<figure><img src="${escapeHtml(rel)}" alt="${escapeHtml(a.description || '')}"/><figcaption>${escapeHtml(rel)}</figcaption></figure>`;
          }
          return `<a class="file" href="${escapeHtml(rel)}">📄 ${escapeHtml(rel)}</a>`;
        })
        .join('\n');
      return `<section class="dept">
  <h2>${escapeHtml(t.dept)}</h2>
  ${t.task ? `<p class="task"><b>งาน:</b> ${escapeHtml(t.task)}</p>` : ''}
  <div class="result">${mdToHtml(t.result || '')}</div>
  ${assetsHtml ? `<div class="assets">${assetsHtml}</div>` : ''}
</section>`;
    })
    .join('\n');

  const html = `<!doctype html>
<html lang="th"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>แพ็กเกจคอนเทนต์</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, "Segoe UI", "Noto Sans Thai", sans-serif; max-width: 900px; margin: 0 auto; padding: 24px; line-height: 1.6; }
  h1 { font-size: 1.6rem; } h2 { border-bottom: 2px solid #FF5722; padding-bottom: 4px; }
  .brief { background: #FF572215; border-left: 4px solid #FF5722; padding: 12px 16px; border-radius: 8px; }
  .dept { margin: 28px 0; }
  .task { color: #888; font-size: .9rem; }
  .result { white-space: pre-wrap; }
  .assets { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 12px; }
  figure { margin: 0; max-width: 260px; } img { max-width: 100%; border-radius: 8px; }
  figcaption, .file { font-size: .75rem; color: #888; }
  .file { display: inline-block; padding: 8px 12px; background: #8881; border-radius: 8px; text-decoration: none; }
  .final { background: #00C85315; border-left: 4px solid #00C853; padding: 16px; border-radius: 8px; white-space: pre-wrap; }
</style></head>
<body>
  <h1>📦 แพ็กเกจคอนเทนต์</h1>
  <div class="brief"><b>โจทย์:</b> ${escapeHtml(brief)}</div>
  ${sections}
  <h2>สรุปจากผู้จัดการ</h2>
  <div class="final">${mdToHtml(finalReport || '')}</div>
</body></html>`;

  return saveText(dir, 'index.html', html);
}

// แปลง markdown แบบเบา ๆ เป็น HTML (พอสำหรับพรีวิว)
function mdToHtml(md) {
  return escapeHtml(md)
    .replace(/^### (.*)$/gm, '<h4>$1</h4>')
    .replace(/^## (.*)$/gm, '<h3>$1</h3>')
    .replace(/^# (.*)$/gm, '<h3>$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
}
