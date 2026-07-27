// การตั้งค่าส่วนกลางของระบบ
export const CONFIG = {
  // โมเดลของ "ผู้จัดการ" (Orchestrator) — ต้องฉลาดเรื่องวางแผน/มอบหมายงาน
  orchestratorModel: 'claude-opus-4-8',

  // โมเดลของแต่ละแผนก — ตัวเดียวกันได้ หรือลดต้นทุนด้วย sonnet/haiku บางแผนก
  departmentModel: 'claude-opus-4-8',

  maxTokens: 8000,

  // effort: low | medium | high | xhigh | max
  effort: 'high',

  // จำนวนรอบสูงสุดของ agentic loop (กันวนไม่จบ)
  maxTurns: 16, // รอบของผู้จัดการ
  maxDeptTurns: 6, // รอบของแต่ละแผนก (เผื่อแผนกเรียก tool สร้างไฟล์หลายชิ้น)

  // โฟลเดอร์เก็บผลงาน
  outputRoot: 'output',

  // เลเยอร์สร้างสื่อ (ภาพ/วิดีโอ)
  // provider = 'placeholder' : สร้างไฟล์ตัวอย่าง (SVG/มานิเฟสต์) ให้ระบบทำงานครบวงจรได้ทันทีโดยไม่ต้องมี key
  // ต่อ API จริง (text-to-image / text-to-video) ได้ที่ src/providers/media.js
  media: {
    imageProvider: process.env.IMAGE_PROVIDER || 'placeholder',
    videoProvider: process.env.VIDEO_PROVIDER || 'placeholder',
  },
};
