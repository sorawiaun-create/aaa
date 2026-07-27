// การตั้งค่าส่วนกลางของระบบ
// โมเดลเริ่มต้น: Claude Opus 4.8 (เก่งภาษาไทย + tool use)
export const CONFIG = {
  // โมเดลของ "ผู้จัดการ" (Orchestrator) — ต้องฉลาดเรื่องการวางแผน/มอบหมายงาน
  orchestratorModel: 'claude-opus-4-8',

  // โมเดลของแต่ละแผนก — ใช้ตัวเดียวกันได้ หรือจะลดต้นทุนด้วย sonnet/haiku ในบางแผนก
  departmentModel: 'claude-opus-4-8',

  maxTokens: 8000,

  // effort: low | medium | high | xhigh | max
  // งานมอบหมายในแผนกใช้ high พอ, ผู้จัดการวางแผนใช้ high
  effort: 'high',

  // จำนวนรอบสูงสุดของ agentic loop กันวนไม่จบ
  maxTurns: 12,
};
