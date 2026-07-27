import Anthropic from '@anthropic-ai/sdk';
import { CONFIG } from './config.js';
import { DEPARTMENTS, getDepartment } from './departments/index.js';

const client = new Anthropic(); // อ่าน ANTHROPIC_API_KEY จาก environment

// ----------------------------------------------------------------------------
//  รันแผนกเดียว: ให้ agent เฉพาะทางทำงานย่อยที่ผู้จัดการมอบหมาย แล้วคืนผลเป็นข้อความ
// ----------------------------------------------------------------------------
async function runDepartment(dept, task, brief) {
  const response = await client.messages.create({
    model: CONFIG.departmentModel,
    max_tokens: CONFIG.maxTokens,
    thinking: { type: 'adaptive' },
    output_config: { effort: CONFIG.effort },
    system: dept.systemPrompt,
    messages: [
      {
        role: 'user',
        content:
          `โจทย์รวมของแคมเปญ (บริบท):\n${brief}\n\n` +
          `งานที่ผู้จัดการมอบหมายให้แผนก "${dept.name}":\n${task}`,
      },
    ],
  });
  return response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
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
          description: 'คำสั่งงานย่อยที่ชัดเจนสำหรับแผนกนี้ (ระบุสิ่งที่ต้องการ, แพลตฟอร์ม, จำนวนชิ้น ฯลฯ)',
        },
      },
      required: ['task'],
    },
  }));
}

const ORCHESTRATOR_SYSTEM = `คุณคือ "ผู้จัดการฝ่ายผลิตคอนเทนต์" (Content Production Manager)
คุณบริหารทีมที่แบ่งเป็นแผนกเฉพาะทางหลายแผนก และทำงานอัตโนมัติผ่านการมอบหมายงาน

วิธีทำงานของคุณ:
1. อ่านโจทย์จากลูกค้า/เจ้าของแบรนด์ แล้ววางแผนว่าต้องใช้แผนกใดบ้าง ตามลำดับที่สมเหตุสมผล
2. โดยทั่วไปลำดับที่ดีคือ: วางแผนกลยุทธ์ → วิจัยเทรนด์/แฮชแท็ก → เขียนบท/แคปชั่น → วิดีโอ และ/หรือ ภาพ → จัดโพสต์ตามแพลตฟอร์ม → ตรวจแบรนด์/คุณภาพ
3. มอบหมายงานทีละแผนกด้วย tool ที่ให้มา ส่ง "คำสั่งงานย่อยที่ชัดเจน" ให้แต่ละแผนก และนำผลของแผนกก่อนหน้าไปเป็นบริบทของแผนกถัดไป
4. คุณไม่ต้องทำงานเฉพาะทางเอง — หน้าที่คุณคือประสานงานและรวบรวม
5. เมื่อครบทุกแผนกที่จำเป็นแล้ว ให้สรุปผลงานทั้งหมดเป็น "แพ็กเกจคอนเทนต์พร้อมเผยแพร่" ให้ลูกค้าอ่านเข้าใจง่าย พร้อมระบุว่าแต่ละแผนกส่งอะไรมาบ้าง

ตอบเป็นภาษาไทย กระชับ เป็นระบบ`;

// ----------------------------------------------------------------------------
//  วนลูปให้ผู้จัดการสั่งงานแผนกต่าง ๆ จนกว่างานจะเสร็จ (agentic loop)
//  onEvent: callback สำหรับแสดง log ระหว่างทาง (optional)
// ----------------------------------------------------------------------------
export async function runCampaign(brief, onEvent = () => {}) {
  const tools = buildTools();
  const messages = [{ role: 'user', content: brief }];

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
      // ผู้จัดการสรุปงานจบแล้ว
      const finalText = response.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
      onEvent({ type: 'done' });
      return finalText;
    }

    // ประมวลผลทุก tool call ในรอบนี้ แล้วส่งผลกลับ
    const toolResults = [];
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;
      const key = block.name.replace('delegate_to_', '');
      const dept = getDepartment(key);
      if (!dept) {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: `ไม่พบแผนก: ${key}`,
          is_error: true,
        });
        continue;
      }

      onEvent({ type: 'delegate', dept: dept.name, task: block.input.task });
      const result = await runDepartment(dept, block.input.task, brief);
      onEvent({ type: 'result', dept: dept.name, result });

      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: result,
      });
    }

    messages.push({ role: 'user', content: toolResults });
  }

  return 'ถึงจำนวนรอบสูงสุดแล้ว แต่งานยังไม่สรุป — ลองเพิ่ม CONFIG.maxTurns หรือแบ่งโจทย์ให้เล็กลง';
}
