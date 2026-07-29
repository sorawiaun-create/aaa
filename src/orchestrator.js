import Anthropic from '@anthropic-ai/sdk';
import path from 'node:path';
import { CONFIG } from './config.js';
import { DEPARTMENTS, getDepartment } from './departments/index.js';
import { saveText } from './output.js';

const client = new Anthropic(); // อ่าน ANTHROPIC_API_KEY จาก environment

// ----------------------------------------------------------------------------
//  รันแผนกเดียว (อาจมี inner loop ถ้าแผนกนั้นเรียก tool สร้างไฟล์)
//  คืน { text, assets } — assets = ไฟล์ที่แผนกนี้สร้างระหว่างทำงาน
// ----------------------------------------------------------------------------
async function runDepartment(dept, task, brief, ctx) {
  const assetStart = (ctx.assets || []).length;

  const tools = (dept.tools || []).map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));

  const messages = [
    {
      role: 'user',
      content:
        `โจทย์รวมของแคมเปญ (บริบท):\n${brief}\n\n` +
        `งานที่ผู้จัดการมอบหมายให้แผนก "${dept.name}":\n${task}`,
    },
  ];

  let lastText = '';
  for (let turn = 0; turn < CONFIG.maxDeptTurns; turn++) {
    const response = await client.messages.create({
      model: CONFIG.departmentModel,
      max_tokens: CONFIG.maxTokens,
      thinking: { type: 'adaptive' },
      output_config: { effort: CONFIG.effort },
      system: dept.systemPrompt,
      ...(tools.length ? { tools } : {}),
      messages,
    });

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    if (text) lastText = text;

    if (response.stop_reason !== 'tool_use') break;

    messages.push({ role: 'assistant', content: response.content });
    const toolResults = [];
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;
      const def = (dept.tools || []).find((t) => t.name === block.name);
      let result;
      try {
        result = def ? await def.run(block.input, ctx) : `ไม่พบ tool: ${block.name}`;
      } catch (e) {
        result = `เกิดข้อผิดพลาดในการรัน tool: ${e.message}`;
      }
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
    }
    messages.push({ role: 'user', content: toolResults });
  }

  const assets = (ctx.assets || []).slice(assetStart);
  return { text: lastText, assets };
}

// สร้าง tool 1 ตัวต่อ 1 แผนก ให้ผู้จัดการเรียกใช้
function buildTools() {
  return DEPARTMENTS.map((dept) => ({
    name: `delegate_to_${dept.key}`,
    description: `มอบหมายงานให้ "${dept.name}" — ${dept.description}`,
    input_schema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'คำสั่งงานย่อยที่ชัดเจน (ระบุสิ่งที่ต้องการ, แพลตฟอร์ม, จำนวนชิ้น ฯลฯ)',
        },
      },
      required: ['task'],
    },
  }));
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
//  รันทั้งแคมเปญ (agentic loop ของผู้จัดการ)
//  ctx: { dir, assetsDir, assets }  — เลเยอร์ output/สื่อ
//  คืน { finalReport, timeline }
// ----------------------------------------------------------------------------
export async function runCampaign(brief, ctx, onEvent = () => {}) {
  ctx.assets = ctx.assets || [];
  const tools = buildTools();
  const messages = [{ role: 'user', content: brief }];
  const timeline = [];
  let step = 0;

  for (let turn = 0; turn < CONFIG.maxTurns; turn++) {
    const response = await client.messages.create({
      model: CONFIG.orchestratorModel,
      max_tokens: CONFIG.maxTokens,
      thinking: { type: 'adaptive' },
      output_config: { effort: CONFIG.effort },
      system: ORCHESTRATOR_SYSTEM,
      tools,
      messages,
    });

    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason !== 'tool_use') {
      const finalText = response.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
      saveText(ctx.dir, '99-final-summary.md', finalText);
      onEvent({ type: 'done' });
      return { finalReport: finalText, timeline };
    }

    const toolResults = [];
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;
      const key = block.name.replace('delegate_to_', '');
      const dept = getDepartment(key);
      if (!dept) {
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: `ไม่พบแผนก: ${key}`, is_error: true });
        continue;
      }

      onEvent({ type: 'delegate', dept: dept.name, task: block.input.task });
      const { text, assets } = await runDepartment(dept, block.input.task, brief, ctx);
      onEvent({ type: 'result', dept: dept.name, result: text, assets });

      step += 1;
      saveText(ctx.dir, `${String(step).padStart(2, '0')}-${dept.key}.md`, text);
      timeline.push({ key: dept.key, dept: dept.name, task: block.input.task, result: text, assets });

      const assetNote = assets.length
        ? `\n\n[ไฟล์ที่สร้าง: ${assets.map((a) => path.relative(ctx.dir, a.path)).join(', ')}]`
        : '';
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: text + assetNote });
    }

    messages.push({ role: 'user', content: toolResults });
  }

  return { finalReport: 'ถึงจำนวนรอบสูงสุดแล้ว งานยังไม่สรุป — เพิ่ม CONFIG.maxTurns หรือแบ่งโจทย์ให้เล็กลง', timeline };
}
