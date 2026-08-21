// --- ชั้น AI วิเคราะห์สินค้า ---
// ทำงานได้ 2 โหมด:
//   1) โหมดออฟไลน์ (ค่าเริ่มต้น) — วิเคราะห์ด้วยกฎจากคะแนน 6 ปัจจัย ไม่ต้องมีคีย์ ไม่มีค่าใช้จ่าย
//   2) โหมด AI — ส่งสรุปสินค้าไปให้โมเดล (OpenAI-compatible) เขียนมุมโฆษณา/แคปชั่นให้
// ฟังก์ชันสร้าง prompt กับตัววิเคราะห์ออฟไลน์เป็น pure function ทั้งหมด เทสต์ได้โดยไม่ต่อเน็ต
import {
  reasonsFor, suggestedDailyBudget, breakEvenCvr, categoryLabel,
  GRADE_META, DEFAULT_SCORING,
} from './shopee.js';

export const DEFAULT_AI = {
  enabled: false,
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  apiKey: '',
  cpc: 1.5,          // ค่าคลิกเฉลี่ยที่ใช้ประเมินจุดคุ้มทุน
  maxProducts: 15,   // ส่งให้ AI ครั้งละกี่ตัว (คุมค่าใช้จ่าย)
};

// มุมโฆษณาตั้งต้นรายหมวด — ใช้ในโหมดออฟไลน์
const ANGLE_BY_CATEGORY = {
  appliance: ['โชว์ก่อน-หลังใน 15 วินาที', 'เทียบราคากับร้านทั่วไป', 'ชี้ค่าไฟ/ค่าใช้จ่ายที่ประหยัดได้'],
  kitchen: ['ทำเมนูจริงให้ดูจนจบ', 'ล้างง่ายแค่ไหน', 'ประหยัดเวลาทำกับข้าวกี่นาที'],
  home: ['ปัญหาในบ้านที่คนเจอทุกวัน', 'จัดบ้านรกให้เป็นระเบียบใน 1 คลิป', 'ของชิ้นเดียวแก้ได้หลายจุด'],
  beauty: ['ผิวก่อน-หลัง พร้อมรีวิวจริง', 'ส่วนผสมเด่นอธิบายสั้น ๆ', 'เทียบราคาต่อวันที่ใช้'],
  pet: ['ปฏิกิริยาน้องหมาน้องแมวตอนใช้', 'แก้ปัญหากลิ่น/ขน/เล็บ', 'ของชิ้นนี้ทาสแมวต้องมี'],
  gadget: ['เดโมฟีเจอร์ที่ว้าวที่สุดก่อน', 'เทียบกับรุ่นแพงกว่า', 'ใช้กับมือถือรุ่นไหนได้บ้าง'],
  baby: ['ปัญหาที่แม่มือใหม่เจอ', 'ความปลอดภัย/วัสดุ', 'ใช้ได้ถึงกี่ขวบ'],
  health: ['ปัญหาสุขภาพที่คนวัยทำงานเจอ', 'วิธีกิน/ใช้ให้เห็นผล', 'รีวิวจากผู้ใช้จริง'],
  fashion: ['มิกซ์แอนด์แมตช์ 3 ลุค', 'โชว์ทรงจริงบนตัวคน', 'บอกไซซ์ให้ชัดกันเปลี่ยนคืน'],
  other: ['เปิดด้วยปัญหาที่คนดูเจอจริง', 'โชว์ของใช้งานจริง 5 วินาทีแรก', 'ปิดด้วยราคาและรอบดีล'],
};

const angleFor = (categoryKey) => ANGLE_BY_CATEGORY[categoryKey] || ANGLE_BY_CATEGORY.other;

// วิเคราะห์แบบออฟไลน์ — ได้ผลลัพธ์โครงเดียวกับโหมด AI
export function localAnalysis(scored, cfg = DEFAULT_SCORING, ai = DEFAULT_AI) {
  const a = scored?.analysis;
  const grade = a?.grade || 'D';
  const meta = GRADE_META[grade];
  const { good, bad } = reasonsFor(scored, cfg);
  const m = a?.metrics || {};
  const budget = suggestedDailyBudget(scored, cfg);
  const cvr = breakEvenCvr(scored, ai.cpc ?? DEFAULT_AI.cpc, cfg);

  const verdictBy = {
    A: `ยิงได้เลย — ${good[0] || 'ตัวเลขผ่านทุกด่าน'} เริ่มที่งบ ฿${budget}/วัน`,
    B: `น่าสนใจ — ทดสอบงบเล็กก่อน ฿${budget}/วัน แล้วดูต้นทุนต่อออเดอร์ 2 วันแรก`,
    C: `เฝ้าดู — ใช้เสริมในคลิปรวมดีล อย่าตั้งเป็นตัวหลัก${bad[0] ? ` เพราะ${bad[0]}` : ''}`,
    D: `ข้าม — ${bad[0] || 'ข้อมูลไม่พอให้ตัดสินใจ'}`,
  };

  return {
    source: 'local',
    grade,
    gradeLabel: meta?.label,
    verdict: verdictBy[grade],
    strengths: good,
    risks: bad,
    angles: grade === 'D' ? [] : angleFor(scored?.category),
    hooks: grade === 'D' ? [] : [
      m.discountPct >= 50 ? `ลด ${Math.round(m.discountPct)}% วันนี้วันเดียว` : 'ของที่ใช้ทุกวัน แต่คนส่วนใหญ่ยังไม่มี',
      m.hasMidnightRound ? 'รอบเที่ยงคืนของหมดเร็ว กดก่อนได้ก่อน' : `ราคาเหลือ ฿${Math.round(scored?.price || 0)} ก่อนหมดรอบ`,
    ],
    audience: audienceFor(scored),
    dailyBudget: budget,
    breakEvenCvr: cvr == null ? null : Math.round(cvr * 100) / 100,
  };
}

// กลุ่มเป้าหมายตั้งต้นสำหรับตั้งแคมเปญ
export function audienceFor(scored) {
  const byCat = {
    appliance: 'อายุ 25–50 สนใจของใช้ในบ้าน/เครื่องครัว',
    kitchen: 'อายุ 25–50 ทำอาหารเอง สนใจสูตรอาหาร',
    home: 'อายุ 25–45 เพิ่งย้ายบ้าน/จัดบ้าน',
    beauty: 'ผู้หญิง 18–40 สนใจสกินแคร์/รีวิวความงาม',
    pet: 'อายุ 20–45 เลี้ยงแมว/สุนัข',
    gadget: 'อายุ 18–40 สนใจไอที/แกดเจ็ต',
    baby: 'ผู้หญิง 22–40 แม่ลูกอ่อน',
    health: 'อายุ 30–55 สนใจสุขภาพ/อาหารเสริม',
    fashion: 'อายุ 18–35 สนใจแฟชั่นออนไลน์',
  };
  return byCat[scored?.category] || 'กว้าง (Advantage+) อายุ 20–50 ทั่วประเทศ ให้ระบบหาเอง';
}

// ย่อข้อมูลสินค้าให้เหลือเท่าที่ AI ต้องใช้ (ประหยัด token)
export function compactProduct(p) {
  const m = p.analysis?.metrics || {};
  return {
    id: p.id,
    ชื่อ: p.name,
    ร้าน: p.shopName || undefined,
    หมวด: categoryLabel(p.category),
    ราคา: Math.round(p.price || 0),
    ราคาเต็ม: Math.round(p.originalPrice || 0) || undefined,
    ส่วนลด: `${Math.round(m.discountPct || 0)}%`,
    คอมต่อชิ้น: Math.round((m.commissionPerUnit || 0) * 100) / 100,
    รอบดีล: m.roundCount || 0,
    รอบเที่ยงคืน: !!m.hasMidnightRound,
    เรตติ้ง: p.rating || undefined,
    รีวิว: p.ratingCount || undefined,
    ขายแล้ว: p.sold || undefined,
    คะแนน: p.analysis?.score,
    เกรด: p.analysis?.grade,
  };
}

export const SYSTEM_PROMPT = [
  'คุณเป็นนักวางแผนโฆษณา Facebook สายสินค้าอีคอมเมิร์ซในไทย ที่ทำ Shopee Affiliate มานาน',
  'หน้าที่คือดูข้อมูลสินค้าที่ผ่านการให้คะแนนมาแล้ว แล้วบอกว่า "ตัวไหนควรจ่ายค่าแอดไปหาคนซื้อ" และควรยิงมุมไหน',
  'ตอบเป็นภาษาไทยแบบพูดกับคนทำงานจริง กระชับ อ้างอิงตัวเลขที่ให้มาเท่านั้น ห้ามแต่งตัวเลขเอง',
  'ถ้าข้อมูลไม่พอให้บอกตรง ๆ ว่าไม่พอ อย่าเดา',
].join('\n');

// สร้าง prompt สำหรับโหมด AI — คืนเป็น messages array
export function buildAnalysisPrompt(scoredList, ctx = {}) {
  const items = (scoredList || []).map(compactProduct);
  const brief = {
    งบต่อวันที่ตั้งไว้: ctx.dailyBudget || undefined,
    ค่าคลิกเฉลี่ยที่ใช้ประเมิน: ctx.cpc ?? DEFAULT_AI.cpc,
    หมายเหตุ: ctx.note || undefined,
    สินค้า: items,
  };
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        'นี่คือสินค้าที่ระบบให้คะแนนไว้แล้ว (คะแนนเต็ม 100 จาก 6 ปัจจัย: ส่วนลด 30, ช่วงราคา 25, จำนวนรอบ 15, หมวดหมู่ 12, รอบเที่ยงคืน 10, คอมต่อชิ้น 8)',
        '```json',
        JSON.stringify(brief, null, 1),
        '```',
        'ตอบกลับเป็น JSON อย่างเดียว ตามโครงนี้:',
        '{"summary":"สรุปภาพรวม 2-3 ประโยค","picks":[{"id":"ไอดีสินค้า","verdict":"RUN|TEST|SKIP","reason":"เหตุผลอ้างตัวเลขจริง","angles":["มุมโฆษณา"],"hooks":["ประโยคเปิดคลิป"],"audience":"กลุ่มเป้าหมาย","dailyBudget":จำนวนบาท}],"warnings":["สิ่งที่ต้องระวัง"]}',
      ].join('\n'),
    },
  ];
}

// ดึง JSON ออกจากคำตอบโมเดล (เผื่อโมเดลห่อด้วย ```json)
export function extractJson(text) {
  const s = String(text ?? '').trim();
  if (!s) return null;
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : s;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

// เรียกโมเดลจริง (OpenAI-compatible: OpenAI, OpenRouter, Together, LM Studio ฯลฯ)
// คีย์เก็บในเครื่องผู้ใช้เท่านั้น และเรียกตรงจากเบราว์เซอร์
export async function runAiAnalysis(scoredList, aiCfg = DEFAULT_AI, ctx = {}) {
  const cfg = { ...DEFAULT_AI, ...(aiCfg || {}) };
  if (!cfg.apiKey) throw new Error('ยังไม่ได้ใส่ API key — ไปที่ตั้งค่า AI ก่อน');
  const items = (scoredList || []).slice(0, cfg.maxProducts);
  if (!items.length) throw new Error('ไม่มีสินค้าให้วิเคราะห์');

  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.4,
      response_format: { type: 'json_object' },
      messages: buildAnalysisPrompt(items, { ...ctx, cpc: cfg.cpc }),
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`เรียก AI ไม่สำเร็จ (${res.status}) ${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content ?? '';
  const parsed = extractJson(text);
  if (!parsed) throw new Error('AI ตอบกลับมาในรูปแบบที่อ่านไม่ได้');
  return { ...parsed, source: 'ai', model: cfg.model, at: new Date().toISOString() };
}

// รวมผล AI กลับเข้ากับสินค้า — ตัวไหน AI ไม่พูดถึงก็ใช้ผลออฟไลน์
export function mergeAiIntoProducts(scoredList, aiResult, cfg = DEFAULT_SCORING, ai = DEFAULT_AI) {
  const byId = new Map((aiResult?.picks || []).map((p) => [String(p.id), p]));
  return (scoredList || []).map((p) => {
    const pick = byId.get(String(p.id));
    const base = localAnalysis(p, cfg, ai);
    if (!pick) return { ...p, ai: base };
    return {
      ...p,
      ai: {
        ...base,
        source: 'ai',
        verdict: pick.reason || base.verdict,
        decision: pick.verdict,
        angles: pick.angles?.length ? pick.angles : base.angles,
        hooks: pick.hooks?.length ? pick.hooks : base.hooks,
        audience: pick.audience || base.audience,
        dailyBudget: Number(pick.dailyBudget) || base.dailyBudget,
      },
    };
  });
}
