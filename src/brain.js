import Anthropic from '@anthropic-ai/sdk';
import { CONFIG } from './config.js';

// ============================================================================
//  เลเยอร์ "สมอง" ของระบบ — สลับผู้ให้บริการ LLM ได้ (Anthropic / OpenAI)
//  เปิด agentic loop เดียวใช้ได้ทั้งผู้จัดการและแต่ละแผนก
//    tools: [{ name, description, parameters(JSON Schema), run(args)->string }]
//    คืน: ข้อความสุดท้าย (string)
// ============================================================================

export function brainProvider() {
  const p = process.env.BRAIN_PROVIDER;
  if (p) return p;
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.OPENAI_API_KEY) return 'openai';
  return 'anthropic';
}

// เช็คว่าตั้งค่าสมองพร้อมใช้หรือยัง (ไว้ให้เว็บ/CLI ตัดสินใจ)
export function brainReady() {
  return brainProvider() === 'openai' ? !!process.env.OPENAI_API_KEY : !!process.env.ANTHROPIC_API_KEY;
}

export async function agent(opts) {
  return brainProvider() === 'openai' ? openaiAgent(opts) : anthropicAgent(opts);
}

// -------------------- Anthropic (Claude) --------------------
async function anthropicAgent({ system, userText, tools = [], maxTurns = 12 }) {
  const client = new Anthropic();
  const atools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  const messages = [{ role: 'user', content: userText }];
  let lastText = '';

  for (let i = 0; i < maxTurns; i++) {
    const resp = await client.messages.create({
      model: CONFIG.orchestratorModel,
      max_tokens: CONFIG.maxTokens,
      thinking: { type: 'adaptive' },
      output_config: { effort: CONFIG.effort },
      system,
      ...(atools.length ? { tools: atools } : {}),
      messages,
    });
    const text = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    if (text) lastText = text;
    if (resp.stop_reason !== 'tool_use') break;

    messages.push({ role: 'assistant', content: resp.content });
    const results = [];
    for (const b of resp.content) {
      if (b.type !== 'tool_use') continue;
      const t = tools.find((x) => x.name === b.name);
      let out;
      try { out = t ? await t.run(b.input) : `ไม่พบ tool: ${b.name}`; } catch (e) { out = 'ผิดพลาด: ' + e.message; }
      results.push({ type: 'tool_result', tool_use_id: b.id, content: out });
    }
    messages.push({ role: 'user', content: results });
  }
  return lastText;
}

// -------------------- OpenAI (ChatGPT) --------------------
async function openaiAgent({ system, userText, tools = [], maxTurns = 12 }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('ยังไม่ได้ตั้งค่า OPENAI_API_KEY');
  const model = process.env.OPENAI_MODEL || 'gpt-4o';
  const otools = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
  const messages = [{ role: 'system', content: system }, { role: 'user', content: userText }];
  let lastText = '';

  for (let i = 0; i < maxTurns; i++) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, max_tokens: CONFIG.maxTokens, ...(otools.length ? { tools: otools } : {}) }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error('OpenAI error: ' + (json.error?.message || JSON.stringify(json)));
    const msg = json.choices[0].message;
    if (msg.content) lastText = msg.content;
    messages.push(msg);
    if (!msg.tool_calls || !msg.tool_calls.length) break;

    for (const tc of msg.tool_calls) {
      const t = tools.find((x) => x.name === tc.function.name);
      let args = {};
      try { args = JSON.parse(tc.function.arguments || '{}'); } catch {}
      let out;
      try { out = t ? await t.run(args) : `ไม่พบ tool: ${tc.function.name}`; } catch (e) { out = 'ผิดพลาด: ' + e.message; }
      messages.push({ role: 'tool', tool_call_id: tc.id, content: String(out) });
    }
  }
  return lastText;
}
