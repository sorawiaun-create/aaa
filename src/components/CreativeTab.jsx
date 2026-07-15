import React, { useRef, useState } from 'react'
import { Sparkles, Copy, Check, Image as ImageIcon, Download, Wand2 } from 'lucide-react'
import { generateLocal, suggestHashtags } from '../lib/creative'
import { SectionCard, Field, inputClass, Badge, EmptyState } from './ui'

const TONES = [
  { key: 'discount', label: 'ลดราคา/โปรโมชั่น' },
  { key: 'new', label: 'สินค้าใหม่' },
  { key: 'trust', label: 'สร้างความน่าเชื่อถือ' },
  { key: 'urgency', label: 'เร่งการตัดสินใจ' },
]

const BG_PRESETS = [
  ['#1877F2', '#0a3d8f'],
  ['#f97316', '#c2410c'],
  ['#ec4899', '#9d174d'],
  ['#10b981', '#065f46'],
  ['#111827', '#374151'],
]

export default function CreativeTab({ onUseCaption }) {
  const [form, setForm] = useState({ product: '', benefit: '', audience: '', tone: 'discount' })
  const [results, setResults] = useState([])
  const [copied, setCopied] = useState(null)
  const [bg, setBg] = useState(0)
  const [headline, setHeadline] = useState('')
  const [subline, setSubline] = useState('')
  const canvasRef = useRef(null)

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const generate = () => {
    if (!form.product.trim()) return
    const out = generateLocal({ ...form, count: 3 })
    setResults(out)
    if (!headline) setHeadline(out[0].headline)
    if (!subline) setSubline(form.benefit || form.product)
  }

  const copy = async (text, id) => {
    await navigator.clipboard.writeText(text)
    setCopied(id)
    setTimeout(() => setCopied(null), 1500)
  }

  const hashtags = form.product ? suggestHashtags(form) : []

  // --- Canvas ad-image generator (1080x1080) -------------------------------
  const drawImage = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const W = 1080
    const [c1, c2] = BG_PRESETS[bg]
    const grad = ctx.createLinearGradient(0, 0, W, W)
    grad.addColorStop(0, c1)
    grad.addColorStop(1, c2)
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, W, W)

    // subtle circle decoration
    ctx.globalAlpha = 0.12
    ctx.fillStyle = '#ffffff'
    ctx.beginPath(); ctx.arc(W - 120, 140, 220, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.arc(120, W - 120, 160, 0, Math.PI * 2); ctx.fill()
    ctx.globalAlpha = 1

    const wrap = (text, x, y, maxWidth, lineHeight, font) => {
      ctx.font = font
      const words = (text || '').split(' ')
      let line = ''
      let yy = y
      for (const w of words) {
        const test = line ? line + ' ' + w : w
        if (ctx.measureText(test).width > maxWidth && line) {
          ctx.fillText(line, x, yy)
          line = w
          yy += lineHeight
        } else {
          line = test
        }
      }
      if (line) ctx.fillText(line, x, yy)
      return yy
    }

    ctx.fillStyle = '#ffffff'
    ctx.textBaseline = 'top'
    const endY = wrap(headline || 'พาดหัวโฆษณา', 90, 340, 900, 96, 'bold 84px Inter, "Noto Sans Thai", sans-serif')
    ctx.globalAlpha = 0.9
    wrap(subline || 'รายละเอียดสั้น ๆ ที่ดึงดูดใจ', 90, endY + 130, 880, 56, '40px Inter, "Noto Sans Thai", sans-serif')
    ctx.globalAlpha = 1

    // CTA pill
    const ctaText = 'สั่งซื้อเลย'
    ctx.font = 'bold 44px Inter, "Noto Sans Thai", sans-serif'
    const tw = ctx.measureText(ctaText).width
    ctx.fillStyle = '#ffffff'
    roundRect(ctx, 90, W - 200, tw + 100, 96, 48)
    ctx.fill()
    ctx.fillStyle = c2
    ctx.fillText(ctaText, 90 + 50, W - 200 + 24)
  }

  const roundRect = (ctx, x, y, w, h, r) => {
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r)
    ctx.arcTo(x, y, x + w, y, r)
    ctx.closePath()
  }

  const download = () => {
    drawImage()
    const canvas = canvasRef.current
    const link = document.createElement('a')
    link.download = `ad-${Date.now()}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
  }

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      {/* Left: caption generator */}
      <div className="space-y-6">
        <SectionCard title="สร้างแคปชั่นโฆษณาอัตโนมัติ" icon={Wand2}>
          <div className="space-y-4">
            <Field label="สินค้า / บริการ *">
              <input className={inputClass} value={form.product} onChange={set('product')} placeholder="เช่น เสื้อยืดคอตตอน 100%" />
            </Field>
            <Field label="จุดเด่น / ข้อเสนอ">
              <input className={inputClass} value={form.benefit} onChange={set('benefit')} placeholder="เช่น ส่งฟรี ลด 50% วันนี้เท่านั้น" />
            </Field>
            <Field label="กลุ่มเป้าหมาย">
              <input className={inputClass} value={form.audience} onChange={set('audience')} placeholder="เช่น วัยรุ่น สายมินิมอล" />
            </Field>
            <Field label="โทนการสื่อสาร">
              <select className={inputClass} value={form.tone} onChange={set('tone')}>
                {TONES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </Field>
            <button onClick={generate} disabled={!form.product.trim()} className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed">
              <Sparkles size={18} /> สร้างแคปชั่น (3 แบบ)
            </button>
          </div>

          {hashtags.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {hashtags.map((h) => <Badge key={h} tone="blue">{h}</Badge>)}
            </div>
          )}
        </SectionCard>

        {results.length > 0 && (
          <div className="space-y-3">
            {results.map((r) => (
              <div key={r.id} className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
                <p className="whitespace-pre-wrap text-sm text-slate-700">{r.primaryText}</p>
                <div className="mt-3 text-xs text-slate-400 space-y-0.5">
                  <p><b className="text-slate-500">หัวข้อ:</b> {r.headline}</p>
                  <p><b className="text-slate-500">คำอธิบาย:</b> {r.description} · <b className="text-slate-500">ปุ่ม:</b> {r.cta}</p>
                </div>
                <div className="mt-3 flex gap-2">
                  <button onClick={() => copy(r.primaryText, r.id)} className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50">
                    {copied === r.id ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />} คัดลอก
                  </button>
                  {onUseCaption && (
                    <button onClick={() => onUseCaption(r.primaryText)} className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-slate-800 text-white hover:bg-slate-900">
                      ใช้ในหน้าโพสต์ →
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Right: image generator */}
      <div className="space-y-6">
        <SectionCard title="สร้างภาพโฆษณา (1080×1080)" icon={ImageIcon}>
          <div className="space-y-4">
            <Field label="พาดหัวบนภาพ">
              <input className={inputClass} value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="เช่น ลดสูงสุด 50%" />
            </Field>
            <Field label="ข้อความรอง">
              <input className={inputClass} value={subline} onChange={(e) => setSubline(e.target.value)} placeholder="เช่น เฉพาะวันนี้เท่านั้น" />
            </Field>
            <div>
              <span className="text-sm font-medium text-slate-600">สีพื้นหลัง</span>
              <div className="mt-2 flex gap-2">
                {BG_PRESETS.map((p, i) => (
                  <button key={i} onClick={() => setBg(i)} className={`w-9 h-9 rounded-full border-2 ${bg === i ? 'border-slate-800' : 'border-transparent'}`} style={{ background: `linear-gradient(135deg, ${p[0]}, ${p[1]})` }} />
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={drawImage} className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-slate-300 hover:bg-slate-50 font-medium">
                <Wand2 size={18} /> พรีวิว
              </button>
              <button onClick={download} className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700">
                <Download size={18} /> ดาวน์โหลด PNG
              </button>
            </div>
          </div>
          <div className="mt-4 rounded-xl overflow-hidden border border-slate-200 bg-slate-50">
            <canvas ref={canvasRef} width={1080} height={1080} className="w-full h-auto block" />
          </div>
          <p className="text-xs text-slate-400 mt-3">
            กด "พรีวิว" เพื่ออัปเดตภาพ · ต้องการภาพจาก AI (เช่น สร้างพื้นหลังจากคำสั่ง) เชื่อม API รูปภาพได้ในหน้า Settings ภายหลัง
          </p>
        </SectionCard>
      </div>
    </div>
  )
}
