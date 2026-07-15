// Template-based creative generator. Works fully offline (no API key).
// If a user provides an AI API key later, `generateWithAI` can replace
// `generateLocal` — see PublishTab / CreativeTab for the hook.

const HOOKS = {
  discount: ['ลดแรงกว่าใคร!', 'ดีลเด็ดห้ามพลาด', 'ราคานี้มีวันเดียว', 'ถูกที่สุดในรอบปี'],
  new: ['เปิดตัวใหม่ล่าสุด', 'มาแล้ว! สินค้าที่รอคอย', 'ของใหม่ป้ายแดง'],
  trust: ['ลูกค้ากว่าหมื่นคนไว้ใจ', 'รีวิวจริงจากผู้ใช้จริง', 'การันตีคุณภาพ'],
  urgency: ['เหลือจำนวนจำกัด', 'หมดแล้วหมดเลย', 'สั่งวันนี้ ส่งพรุ่งนี้'],
}

const CTAS = ['สั่งซื้อเลย', 'ทักแชทรับส่วนลด', 'ดูรายละเอียด', 'กดสั่งก่อนของหมด', 'ช้อปเลย']

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]

// tone: 'discount' | 'new' | 'trust' | 'urgency'
export function generateLocal({ product, benefit, audience, tone = 'discount', count = 3 }) {
  const results = []
  for (let i = 0; i < count; i++) {
    const hook = pick(HOOKS[tone] || HOOKS.discount)
    const cta = pick(CTAS)
    const benefitLine = benefit ? `\n✅ ${benefit}` : ''
    const audienceLine = audience ? ` สำหรับ${audience}โดยเฉพาะ` : ''
    const primary = `${hook} ${product}${audienceLine}${benefitLine}\n\n👉 ${cta}`
    const headline = `${product} — ${hook}`
    const description = benefit || `${product} คุณภาพดี ราคาโดนใจ`
    results.push({
      id: `${Date.now()}-${i}`,
      primaryText: primary,
      headline: headline.slice(0, 40),
      description: description.slice(0, 30),
      cta,
    })
  }
  return results
}

// Hashtag suggestions from the product/audience keywords.
export function suggestHashtags({ product, audience }) {
  const base = [product, audience]
    .filter(Boolean)
    .join(' ')
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .slice(0, 5)
    .map((w) => `#${w.replace(/[^\p{L}\p{N}]/gu, '')}`)
  return Array.from(new Set([...base, '#โปรโมชั่น', '#ของดีบอกต่อ', '#ส่งฟรี'])).slice(0, 8)
}

// Optional: call an LLM. Left as a documented stub — the app never sends the
// key anywhere except the provider the user configures.
export async function generateWithAI(_input, _config) {
  throw new Error('AI generation not configured. Add an API key in Settings to enable.')
}
