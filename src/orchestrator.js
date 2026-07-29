import path from 'node:path';
import { CONFIG } from './config.js';
import { DEPARTMENTS } from './departments/index.js';
import { saveText } from './output.js';
import { agent } from './brain.js';

// ----------------------------------------------------------------------------
//  รันแผนกเดียว (อาจมี tool สร้างไฟล์) — คืน { text, assets }
// ----------------------------------------------------------------------------
async function runDepartment(dept, task, brief, ctx) {
  const assetStart = (ctx.assets || []).length;

  const tools = (dept.tools || []).map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.input_schema,
    run: (args) => t.run(args, ctx),
  }));

  const userText =
    `โจทย์รวมของแคมเปญ (บริบท):\n${brief}\n\n` +
    `งานที่ผู้จัดการมอบหมายให้แผนก "${dept.name}":\n${task}`;

  const text = await agent({ system: dept.systemPrompt, userText, tools, maxTurns: CONFIG.maxDeptTurns });
  const assets = (ctx.assets || []).slice(assetStart);
  return { text, assets };
}

const ORCHESTRATOR_SYSTEM = `คุณคือ "ผู้จัดการฝ่ายผลิตคอนเทนต์" (Content Production Manager)
คุณบริหารทีมที่แบ่งเป็นแผนกเฉพาะทางหลายแผนก และทำงานอัตโนมัติผ่านการมอบหมายงาน

วิธีทำงาน:
1. อ่านโจทย์ วางแผนว่าต้องใช้แผนกใดบ้าง ตามลำดับที่สมเหตุสมผล
2. ลำดับที่ดีทั่วไป: วางแผนกลยุทธ์ → วิจัยเทรนด์/แฮชแท็ก → เขียนบท/แคปชั่น → วิดีโอ และ/หรือ ภาพ
   → (ถ้าเกี่ยว) อินฟลูเอนเซอร์ / ยิงแอด → จัดโพสต์ตามแพลตฟอร์ม → ตรวจแบรนด์/คุณภาพ (ด่านสุดท้าย)
3. มอบหมายทีละแผนกด้วย tool ส่ง "คำสั่งงานย่อยที่ชัดเจน" และนำผลแผนกก่อนหน้าเป็นบริบทของแผนกถัดไป
4. คุณไม่ทำงานเฉพาะทางเอง — หน้าที่คือประสานงานและรวบรวม
5. เมื่อครบทุกแผนกที่จำเป็น สรุปเป็น "แพ็กเกจคอนเทนต์พร้อมเผยแพร่" ที่อ่านง่าย ระบุว่าแต่ละแผนกส่งอะไรมาบ้าง และมีไฟล์อะไรถูกสร้าง
ตอบภาษาไทย กระชับ เป็นระบบ`;

// ----------------------------------------------------------------------------
//  รันทั้งแคมเปญ — ผู้จัดการมอบหมายแต่ละแผนกผ่าน tool (delegate_to_<แผนก>)
//  คืน { finalReport, timeline }
// ----------------------------------------------------------------------------
export async function runCampaign(brief, ctx, onEvent = () => {}) {
  ctx.assets = ctx.assets || [];
  const timeline = [];
  let step = 0;

  const tools = DEPARTMENTS.map((dept) => ({
    name: `delegate_to_${dept.key}`,
    description: `มอบหมายงานให้ "${dept.name}" — ${dept.description}`,
    parameters: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'คำสั่งงานย่อยที่ชัดเจน (ระบุสิ่งที่ต้องการ, แพลตฟอร์ม, จำนวนชิ้น ฯลฯ)' },
      },
      required: ['task'],
    },
    run: async ({ task }) => {
      onEvent({ type: 'delegate', key: dept.key, dept: dept.name, task });
      const { text, assets } = await runDepartment(dept, task, brief, ctx);
      onEvent({ type: 'result', key: dept.key, dept: dept.name, result: text, assets });

      step += 1;
      saveText(ctx.dir, `${String(step).padStart(2, '0')}-${dept.key}.md`, text);
      timeline.push({ key: dept.key, dept: dept.name, task, result: text, assets });

      const assetNote = assets.length
        ? `\n\n[ไฟล์ที่สร้าง: ${assets.map((a) => path.relative(ctx.dir, a.path)).join(', ')}]`
        : '';
      return text + assetNote;
    },
  }));

  const finalReport = await agent({ system: ORCHESTRATOR_SYSTEM, userText: brief, tools, maxTurns: CONFIG.maxTurns });
  saveText(ctx.dir, '99-final-summary.md', finalReport);
  onEvent({ type: 'done' });
  return { finalReport, timeline };
}
