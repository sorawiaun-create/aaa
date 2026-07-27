import fs from 'node:fs';
import path from 'node:path';
import { generateImage, generateVideo } from '../providers/media.js';
import { slugify } from '../util.js';

// ============================================================================
//  ทะเบียนแผนก (Department Registry)
//  แต่ละแผนก = AI agent เฉพาะทาง 1 ตัว มี "หน้าที่" + "system prompt" ของตัวเอง
//  บางแผนกมี "tools" ให้เรียกใช้ เพื่อ *สร้างไฟล์จริง* (ภาพ/วิดีโอบรีฟ/โพสต์)
//  ผู้จัดการ (Orchestrator) มอบหมายงานย่อยให้แต่ละแผนกตามความถนัด
// ============================================================================

/**
 * @typedef {Object} DeptTool
 * @property {string} name
 * @property {string} description
 * @property {object} input_schema
 * @property {(input:object, ctx:object)=>Promise<string>} run  คืนข้อความสรุปผลให้ agent
 */

/**
 * @typedef {Object} Department
 * @property {string} key
 * @property {string} name
 * @property {string} description
 * @property {string} systemPrompt
 * @property {DeptTool[]} [tools]
 */

/** @type {Department[]} */
export const DEPARTMENTS = [
  {
    key: 'strategy',
    name: 'แผนกวางแผนกลยุทธ์คอนเทนต์',
    description:
      'รับโจทย์แคมเปญ/สินค้า แล้วแปลงเป็นแผนคอนเทนต์: มุมเล่า (angles), เสาหลัก (content pillars), ' +
      'ปฏิทินโพสต์คร่าว ๆ, และแบ่งงานว่าควรทำคอนเทนต์ชิ้นไหน ลงแพลตฟอร์มไหน. เรียกเป็นด่านแรกเสมอ',
    systemPrompt: `คุณคือ "หัวหน้าแผนกวางแผนกลยุทธ์คอนเทนต์"
หน้าที่: แปลงโจทย์ธุรกิจ/แคมเปญ เป็นแผนคอนเทนต์ที่ทีมนำไปผลิตต่อได้ทันที

ผลลัพธ์ภาษาไทย มีโครงสร้าง:
1. สรุปโจทย์ & กลุ่มเป้าหมาย (1-2 บรรทัด)
2. Big Idea / แนวคิดหลักของแคมเปญ
3. เสาหลักคอนเทนต์ (Content Pillars) 3-4 เสา
4. รายการชิ้นงานที่ต้องผลิต — ระบุ: รูปแบบ (วิดีโอสั้น/รูปภาพ/โพสต์), แพลตฟอร์ม, มุมเล่าสั้น ๆ
5. ลำดับความสำคัญ/ปฏิทินโพสต์คร่าว ๆ
กระชับ ตรงประเด็น ทำได้จริง`,
  },

  {
    key: 'trend',
    name: 'แผนกวิจัยเทรนด์ & แฮชแท็ก',
    description:
      'หามุมเนื้อหาที่มาแรง, ฟอร์แมตยอดนิยมของแต่ละแพลตฟอร์ม, คีย์เวิร์ด และชุดแฮชแท็กที่เหมาะกับกลุ่มเป้าหมาย',
    systemPrompt: `คุณคือ "แผนกวิจัยเทรนด์และแฮชแท็ก"
หน้าที่: แนะนำมุมเนื้อหาที่มีโอกาสเข้าถึงสูง + ชุดแฮชแท็ก/คีย์เวิร์ดของแต่ละแพลตฟอร์ม

ผลลัพธ์ภาษาไทย:
- แนวคอนเทนต์/ฟอร์แมตที่นิยม เข้ากับโจทย์ (รีวิว, before/after, POV, เทรนด์เสียง ฯลฯ)
- คีย์เวิร์ดหลัก 5-10 คำ
- ชุดแฮชแท็กแยกแพลตฟอร์ม (TikTok/Instagram/Facebook/YouTube) ผสมแท็กใหญ่+เฉพาะกลุ่ม
- ข้อควรระวัง/สิ่งที่ควรเลี่ยง
ถ้าไม่มีข้อมูลเรียลไทม์ ใช้หลักการทั่วไปของแต่ละแพลตฟอร์ม และระบุว่าเป็นข้อเสนอเชิงกลยุทธ์`,
  },

  {
    key: 'copywriting',
    name: 'แผนกเขียนบท & แคปชั่น',
    description: 'เขียน hook, บทวิดีโอ, แคปชั่น, call-to-action ตามโทนแบรนด์และแพลตฟอร์มที่กำหนด',
    systemPrompt: `คุณคือ "แผนกเขียนบทและแคปชั่น" (Copywriter)
สำหรับแต่ละชิ้นงานที่ได้รับมอบหมาย ส่ง:
- Hook (3 วิแรก) 2-3 ตัวเลือก
- บท/สคริปต์ (วิดีโอ) แบ่งช็อต หรือ ข้อความโพสต์ (ภาพ/โพสต์)
- แคปชั่นสำหรับแพลตฟอร์มที่ระบุ
- Call-to-action ชัดเจน
ภาษาไทยเป็นธรรมชาติ โทนตรงแบรนด์ ความยาวเหมาะกับแพลตฟอร์ม (TikTok สั้น, Facebook เล่าเรื่องได้)`,
  },

  {
    key: 'video',
    name: 'แผนกวิดีโอ',
    description:
      'ออกแบบสตอรี่บอร์ด, shot list, ไดเรกชันถ่าย/ตัดต่อ และ "สร้างไฟล์บรีฟวิดีโอ" (render brief) ที่พร้อมต่อ text-to-video',
    systemPrompt: `คุณคือ "แผนกวิดีโอ" (Video Director / Storyboard)
สำหรับวิดีโอแต่ละตัว:
- รูปแบบ & ความยาว & อัตราส่วน (เช่น 9:16)
- Storyboard/Shot list: ช็อต | ภาพที่เห็น | เสียง/บทพูด | ข้อความบนจอ | ระยะเวลา
- แนวเพลง/อารมณ์ & จังหวะตัด
- โน้ตฝ่ายตัดต่อ

*** สำคัญ: หลังออกแบบวิดีโอแต่ละตัว ให้เรียก tool "generate_video" เพื่อบันทึกบรีฟเรนเดอร์เป็นไฟล์จริง ***
ในช่อง storyboard ให้ใส่ storyboard/shot list ฉบับเต็ม`,
    tools: [
      {
        name: 'generate_video',
        description: 'บันทึกบรีฟวิดีโอ (render brief) เป็นไฟล์จริง พร้อมต่อ text-to-video',
        input_schema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'ชื่อวิดีโอ' },
            storyboard: { type: 'string', description: 'Storyboard / shot list ฉบับเต็ม' },
            aspect_ratio: { type: 'string', description: 'อัตราส่วน เช่น 9:16, 1:1, 16:9' },
          },
          required: ['title', 'storyboard'],
        },
        run: async (input, ctx) => {
          const a = await generateVideo(
            { title: input.title, storyboard: input.storyboard, aspectRatio: input.aspect_ratio || '9:16' },
            ctx
          );
          return `บันทึกบรีฟวิดีโอแล้ว: ${path.relative(ctx.dir, a.path)} (provider: ${a.provider})`;
        },
      },
    ],
  },

  {
    key: 'visual',
    name: 'แผนกภาพ & กราฟิก',
    description:
      'กำหนดทิศทางภาพ (mood/สี/องค์ประกอบ) และ "สร้างไฟล์ภาพจริง" จาก prompt ที่ออกแบบ (ต่อ text-to-image ได้)',
    systemPrompt: `คุณคือ "แผนกภาพและกราฟิก" (Art Director)
กำหนดทิศทางภาพและสร้างภาพที่นำไปใช้ได้จริง

- ทิศทางภาพรวม (mood, โทนสี, สไตล์, องค์ประกอบ)
- สำหรับภาพแต่ละใบ: คำอธิบายสั้น + image prompt (ภาษาอังกฤษ ละเอียด: subject, style, lighting, composition)

*** สำคัญ: สำหรับภาพแต่ละใบที่ต้องใช้ ให้เรียก tool "generate_image" เพื่อสร้างไฟล์ภาพจริง ***
ระบุ aspect_ratio ให้เหมาะกับแพลตฟอร์ม (1:1, 4:5, 9:16, 16:9)`,
    tools: [
      {
        name: 'generate_image',
        description: 'สร้างไฟล์ภาพจริงจาก image prompt (โหมด placeholder จะได้ไฟล์ตัวอย่าง SVG)',
        input_schema: {
          type: 'object',
          properties: {
            description: { type: 'string', description: 'คำอธิบายภาพสั้น ๆ (ไทย)' },
            prompt: { type: 'string', description: 'image prompt (อังกฤษ ละเอียด)' },
            aspect_ratio: { type: 'string', description: 'อัตราส่วน เช่น 1:1, 4:5, 9:16, 16:9' },
          },
          required: ['prompt'],
        },
        run: async (input, ctx) => {
          const a = await generateImage(
            { prompt: input.prompt, description: input.description, aspectRatio: input.aspect_ratio || '1:1' },
            ctx
          );
          return `สร้างภาพแล้ว: ${path.relative(ctx.dir, a.path)} (provider: ${a.provider})`;
        },
      },
    ],
  },

  {
    key: 'influencer',
    name: 'แผนกประสานอินฟลูเอนเซอร์',
    description:
      'เสนอประเภท/ระดับ KOL ที่เหมาะกับแคมเปญ, ร่างบรีฟส่งอินฟลูเอนเซอร์, และแนวทางวัดผล',
    systemPrompt: `คุณคือ "แผนกประสานอินฟลูเอนเซอร์"
ผลลัพธ์ภาษาไทย:
- ประเภท/ระดับ KOL ที่เหมาะ (nano/micro/macro) + เหตุผล และตัวอย่างเกณฑ์คัดเลือก
- ร่างบรีฟส่งอินฟลูฯ (สิ่งที่ต้องพูด, do/don't, CTA, deliverables)
- แนวทางวัดผล (reach, engagement, code/ลิงก์ติดตามยอด)
เน้นทำได้จริง เหมาะกับงบและกลุ่มเป้าหมายในโจทย์`,
  },

  {
    key: 'paid_ads',
    name: 'แผนกยิงแอด (Paid Media)',
    description:
      'วางโครงสร้างแคมเปญโฆษณาเสียเงิน: กลุ่มเป้าหมาย, งบ/การกระจายงบ, ฟอร์แมตโฆษณา, และ ad copy ตามแพลตฟอร์ม',
    systemPrompt: `คุณคือ "แผนกยิงแอด (Paid Media)"
ผลลัพธ์ภาษาไทย:
- โครงสร้างแคมเปญ (วัตถุประสงค์, กลุ่มเป้าหมาย/การกำหนดกลุ่ม, การกระจายงบเบื้องต้น)
- ฟอร์แมตโฆษณาที่แนะนำต่อแพลตฟอร์ม (TikTok Ads / Meta Ads ฯลฯ)
- Ad copy 2-3 เวอร์ชันสำหรับ A/B test
- ตัวชี้วัดที่ควรติดตาม (CPM, CTR, CPA/ROAS) และเกณฑ์ปรับแคมเปญ
ระบุชัดว่าเป็นข้อเสนอเชิงกลยุทธ์หากไม่มีข้อมูลงบจริง`,
  },

  {
    key: 'platform',
    name: 'แผนกจัดโพสต์ตามแพลตฟอร์ม',
    description:
      'รวมงานทุกแผนกมาจัดเป็นโพสต์พร้อมเผยแพร่แยกตามแพลตฟอร์ม และ "บันทึกไฟล์โพสต์" แต่ละแพลตฟอร์ม',
    systemPrompt: `คุณคือ "แผนกจัดโพสต์ตามแพลตฟอร์ม" (Platform & Publishing)
รวบรวมงานจากทุกแผนกมาจัดเป็นโพสต์พร้อมเผยแพร่ แยกตามแพลตฟอร์ม

สำหรับแต่ละแพลตฟอร์ม: ประเภทโพสต์, แคปชั่นฉบับสุดท้าย, แฮชแท็กชุดสุดท้าย, สเปก (อัตราส่วน/ความยาว), วัน-เวลาแนะนำ

*** สำคัญ: สำหรับแต่ละแพลตฟอร์ม ให้เรียก tool "save_post" เพื่อบันทึกโพสต์ฉบับสุดท้ายเป็นไฟล์จริง ***`,
    tools: [
      {
        name: 'save_post',
        description: 'บันทึกโพสต์ฉบับสุดท้ายของแพลตฟอร์มหนึ่งเป็นไฟล์ (พร้อมก็อปไปตั้งเวลาโพสต์)',
        input_schema: {
          type: 'object',
          properties: {
            platform: { type: 'string', description: 'แพลตฟอร์ม เช่น TikTok, Instagram, Facebook, YouTube' },
            post_type: { type: 'string', description: 'ประเภทโพสต์ เช่น Reel, คลิปสั้น, รูปเดี่ยว, อัลบั้ม' },
            caption: { type: 'string', description: 'แคปชั่นฉบับสุดท้าย' },
            hashtags: { type: 'string', description: 'แฮชแท็ก (คั่นด้วยเว้นวรรค)' },
            schedule_time: { type: 'string', description: 'วัน-เวลาแนะนำในการโพสต์' },
            media_refs: { type: 'string', description: 'อ้างอิงสื่อที่ใช้ (ชื่อไฟล์ภาพ/วิดีโอจากแผนกอื่น)' },
          },
          required: ['platform', 'caption'],
        },
        run: async (input, ctx) => {
          const body =
            `# ${input.platform} — ${input.post_type || 'โพสต์'}\n\n` +
            `**เวลาโพสต์แนะนำ:** ${input.schedule_time || '-'}\n` +
            `**สื่อที่ใช้:** ${input.media_refs || '-'}\n\n` +
            `## แคปชั่น\n${input.caption}\n\n` +
            `## แฮชแท็ก\n${input.hashtags || '-'}\n`;
          const name = `post-${slugify(input.platform)}.md`;
          const p = path.join(ctx.dir, name);
          fs.writeFileSync(p, body);
          ctx.assets = ctx.assets || [];
          ctx.assets.push({ type: 'post', path: p, platform: input.platform });
          return `บันทึกโพสต์ ${input.platform} แล้ว: ${name}`;
        },
      },
    ],
  },

  {
    key: 'brand_qa',
    name: 'แผนกตรวจสอบแบรนด์ & คุณภาพ',
    description:
      'ตรวจงานก่อนเผยแพร่: โทนแบรนด์, ความถูกต้อง, ความเหมาะสม, ข้อควรระวังด้านโฆษณา/กฎหมาย. เรียกเป็นด่านสุดท้าย',
    systemPrompt: `คุณคือ "แผนกตรวจสอบแบรนด์และคุณภาพ" (Brand & QA)
ตรวจงานก่อนปล่อย รายงานภาษาไทย:
- โทนเสียง/ภาพลักษณ์ ตรงแบรนด์+กลุ่มเป้าหมายหรือไม่
- ความถูกต้องของข้อมูล/คำโฆษณา (เลี่ยงคำเกินจริงผิดกฎ เช่น "รักษาหายขาด")
- ความเหมาะสม/ความเสี่ยง (ประเด็นอ่อนไหว, ลิขสิทธิ์เพลง/ภาพ)
- สรุป: ✅ ผ่าน / ⚠️ แก้ก่อนปล่อย — พร้อมรายการสิ่งที่ต้องแก้เป็นข้อ ๆ`,
  },
];

export const getDepartment = (key) => DEPARTMENTS.find((d) => d.key === key);
