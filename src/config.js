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
  // provider = 'placeholder' : สร้างไฟล์ตัวอย่าง (SVG/มานิเฟสต์) โดยไม่ต้องมี key
  // provider = 'replicate'   : เจนภาพ/วิดีโอจริง (ตั้ง REPLICATE_API_TOKEN ด้วย)
  media: {
    imageProvider: process.env.IMAGE_PROVIDER || 'placeholder', // 'placeholder' | 'replicate'
    videoProvider: process.env.VIDEO_PROVIDER || 'placeholder', // 'placeholder' | 'replicate'

    // โมเดลบน Replicate (เปลี่ยนได้ตามต้องการ)
    imageModel: process.env.IMAGE_MODEL || 'black-forest-labs/flux-schnell', // ภาพเร็ว/ถูก
    videoModel: process.env.VIDEO_MODEL || 'minimax/video-01', // วิดีโอ (ใช้เวลาสร้างนานกว่า)
  },

  // เลเยอร์เผยแพร่ (โพสต์ขึ้นแพลตฟอร์มจริง)
  publish: {
    // ค่าเริ่มต้น = ซ้อมโพสต์ (dry-run) ไม่โพสต์จริง; ตั้ง PUBLISH_LIVE=true เพื่อโพสต์จริง
    live: process.env.PUBLISH_LIVE === 'true',
    // โพสต์อัตโนมัติหลังรันแคมเปญเสร็จ (ค่าเริ่มต้น = ไม่ ให้รีวิวก่อนสั่งโพสต์เอง)
    autoAfterRun: process.env.AUTO_PUBLISH === 'true',

    facebook: {
      pageId: process.env.FB_PAGE_ID || '',
      token: process.env.FB_PAGE_TOKEN || '',
      apiVersion: process.env.FB_API_VERSION || 'v21.0',
    },
    instagram: {
      userId: process.env.IG_USER_ID || '',
      token: process.env.IG_TOKEN || '',
      // URL สาธารณะที่ชี้ไปยังโฟลเดอร์ assets ของแคมเปญ (IG ต้องดึงสื่อจาก URL)
      mediaBaseUrl: process.env.MEDIA_BASE_URL || '',
      apiVersion: process.env.FB_API_VERSION || 'v21.0',
    },
    tiktok: {
      token: process.env.TIKTOK_TOKEN || '',
    },
  },
};
