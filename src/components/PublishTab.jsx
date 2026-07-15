import React, { useEffect, useState } from 'react'
import {
  Send, Plug, ShieldAlert, Clock, Trash2, CheckCircle2, Calendar,
  Facebook, TestTube2, Link2,
} from 'lucide-react'
import { SectionCard, Field, inputClass, Badge, EmptyState } from './ui'

const DRAFTS_KEY = 'fbstudio_drafts_v1'
const CONN_KEY = 'fbstudio_conn_v1'
const GRAPH = 'https://graph.facebook.com/v19.0'

function loadJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback } catch { return fallback }
}

export default function PublishTab({ initialCaption }) {
  const [drafts, setDrafts] = useState(() => loadJson(DRAFTS_KEY, []))
  const [conn, setConn] = useState(() => loadJson(CONN_KEY, { pageId: '', token: '', live: false }))
  const [message, setMessage] = useState(initialCaption || '')
  const [link, setLink] = useState('')
  const [scheduleAt, setScheduleAt] = useState('')
  const [status, setStatus] = useState('')
  const [testing, setTesting] = useState(false)

  useEffect(() => { if (initialCaption) setMessage(initialCaption) }, [initialCaption])
  useEffect(() => { localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts)) }, [drafts])
  useEffect(() => { localStorage.setItem(CONN_KEY, JSON.stringify(conn)) }, [conn])

  const setConnField = (k) => (e) => {
    const v = k === 'live' ? e.target.checked : e.target.value
    setConn((c) => ({ ...c, [k]: v }))
  }

  const testConnection = async () => {
    if (!conn.token) { setStatus('กรุณาใส่ Access Token ก่อน'); return }
    setTesting(true)
    setStatus('')
    try {
      const res = await fetch(`${GRAPH}/me?fields=id,name&access_token=${encodeURIComponent(conn.token)}`)
      const data = await res.json()
      if (data.error) setStatus('เชื่อมต่อไม่สำเร็จ: ' + data.error.message)
      else setStatus(`เชื่อมต่อสำเร็จ: ${data.name} (${data.id})`)
    } catch (err) {
      setStatus('เชื่อมต่อไม่สำเร็จ: ' + err.message)
    } finally {
      setTesting(false)
    }
  }

  const addDraft = (state) => {
    const draft = {
      id: `${Date.now()}`,
      message,
      link,
      scheduleAt,
      state, // 'draft' | 'scheduled' | 'published'
      createdAt: new Date().toISOString(),
    }
    setDrafts((d) => [draft, ...d])
  }

  const removeDraft = (id) => setDrafts((d) => d.filter((x) => x.id !== id))

  const publish = async () => {
    if (!message.trim()) { setStatus('กรุณาเขียนข้อความก่อน'); return }
    setStatus('')

    // Demo mode: never touches the network.
    if (!conn.live) {
      addDraft(scheduleAt ? 'scheduled' : 'published')
      setStatus('บันทึกแบบทดสอบแล้ว (โหมดทดสอบ — ยังไม่โพสต์จริง)')
      setMessage(''); setLink(''); setScheduleAt('')
      return
    }

    // Live mode: real Graph API call.
    if (!conn.pageId || !conn.token) { setStatus('โหมดจริงต้องใส่ Page ID และ Access Token'); return }
    try {
      const body = new URLSearchParams()
      body.set('message', message)
      if (link) body.set('link', link)
      if (scheduleAt) {
        body.set('published', 'false')
        body.set('scheduled_publish_time', String(Math.floor(new Date(scheduleAt).getTime() / 1000)))
      }
      body.set('access_token', conn.token)
      const res = await fetch(`${GRAPH}/${conn.pageId}/feed`, { method: 'POST', body })
      const data = await res.json()
      if (data.error) { setStatus('โพสต์ไม่สำเร็จ: ' + data.error.message); return }
      addDraft(scheduleAt ? 'scheduled' : 'published')
      setStatus(`โพสต์สำเร็จ! Post ID: ${data.id}`)
      setMessage(''); setLink(''); setScheduleAt('')
    } catch (err) {
      setStatus('โพสต์ไม่สำเร็จ: ' + err.message)
    }
  }

  return (
    <div className="grid lg:grid-cols-3 gap-6">
      {/* Composer */}
      <div className="lg:col-span-2 space-y-6">
        <SectionCard title="เขียนโพสต์ / โฆษณา" icon={Send}>
          <div className="space-y-4">
            <Field label="ข้อความโพสต์">
              <textarea className={inputClass + ' min-h-[140px] resize-y'} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="เขียนข้อความที่นี่ หรือส่งมาจากหน้า 'ทำสื่อ'" />
            </Field>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="ลิงก์ปลายทาง (ถ้ามี)">
                <input className={inputClass} value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://..." />
              </Field>
              <Field label="ตั้งเวลาโพสต์ (ถ้ามี)">
                <input type="datetime-local" className={inputClass} value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} />
              </Field>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={publish} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700">
                <Send size={18} /> {conn.live ? (scheduleAt ? 'ตั้งเวลาโพสต์จริง' : 'โพสต์จริง') : 'บันทึก (ทดสอบ)'}
              </button>
              <button onClick={() => addDraft('draft')} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50">
                เก็บเป็นฉบับร่าง
              </button>
            </div>
            {status && (
              <p className={`text-sm ${status.includes('สำเร็จ') ? 'text-emerald-600' : 'text-slate-600'}`}>{status}</p>
            )}
          </div>
        </SectionCard>

        {/* Drafts / schedule list */}
        <SectionCard title="คิวโพสต์ & ฉบับร่าง" icon={Clock}>
          {drafts.length === 0 ? (
            <EmptyState icon={Calendar} title="ยังไม่มีโพสต์ในคิว" hint="โพสต์และฉบับร่างจะถูกเก็บไว้ในเบราว์เซอร์นี้" />
          ) : (
            <div className="space-y-2">
              {drafts.map((d) => (
                <div key={d.id} className="flex items-start gap-3 p-3 rounded-xl border border-slate-200">
                  <div className="mt-0.5">
                    {d.state === 'published' && <CheckCircle2 size={18} className="text-emerald-500" />}
                    {d.state === 'scheduled' && <Clock size={18} className="text-amber-500" />}
                    {d.state === 'draft' && <Calendar size={18} className="text-slate-400" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-700 line-clamp-2">{d.message}</p>
                    <div className="flex items-center gap-2 mt-1 text-xs text-slate-400">
                      <Badge tone={d.state === 'published' ? 'green' : d.state === 'scheduled' ? 'amber' : 'slate'}>
                        {d.state === 'published' ? 'โพสต์แล้ว' : d.state === 'scheduled' ? 'ตั้งเวลา' : 'ฉบับร่าง'}
                      </Badge>
                      {d.scheduleAt && <span>{new Date(d.scheduleAt).toLocaleString('th-TH')}</span>}
                    </div>
                  </div>
                  <button onClick={() => removeDraft(d.id)} className="text-slate-400 hover:text-red-500 p-1">
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      {/* Connection panel */}
      <div className="space-y-6">
        <SectionCard title="เชื่อมต่อ Facebook Page" icon={Plug}>
          <div className="space-y-4">
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs">
              <ShieldAlert size={16} className="shrink-0 mt-0.5" />
              <span>
                Access Token เก็บไว้ในเบราว์เซอร์นี้เท่านั้น (localStorage) สำหรับใช้งานส่วนตัว
                หากทำระบบใช้งานจริงหลายคน ควรเก็บ token ที่ฝั่งเซิร์ฟเวอร์ผ่าน OAuth
              </span>
            </div>
            <Field label="Page ID">
              <input className={inputClass} value={conn.pageId} onChange={setConnField('pageId')} placeholder="เช่น 1234567890" />
            </Field>
            <Field label="Page Access Token">
              <input type="password" className={inputClass} value={conn.token} onChange={setConnField('token')} placeholder="EAAB..." />
            </Field>
            <button onClick={testConnection} disabled={testing} className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-slate-300 hover:bg-slate-50 disabled:opacity-50">
              <TestTube2 size={16} /> {testing ? 'กำลังทดสอบ...' : 'ทดสอบการเชื่อมต่อ'}
            </button>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={conn.live} onChange={setConnField('live')} className="w-4 h-4" />
              เปิดโหมดโพสต์จริง (Live)
            </label>
            {conn.live && (
              <p className="text-xs text-red-600">
                ⚠️ โหมดจริงจะโพสต์ลงเพจจริงทันที ตรวจสอบข้อความให้ดีก่อนกดโพสต์
              </p>
            )}
          </div>
        </SectionCard>

        <SectionCard title="วิธีขอ Access Token" icon={Facebook}>
          <ol className="text-sm text-slate-600 space-y-2 list-decimal pl-5">
            <li>สร้างแอปที่ <span className="font-mono text-xs">developers.facebook.com</span></li>
            <li>เพิ่มผลิตภัณฑ์ "Facebook Login" และ "Marketing API"</li>
            <li>ใช้ Graph API Explorer ขอสิทธิ์ <span className="font-mono text-xs">pages_manage_posts, pages_read_engagement</span></li>
            <li>แลกเป็น Long-lived Page Access Token</li>
            <li>โพสต์โฆษณาที่มีค่าใช้จ่ายจริงต้องผ่าน App Review ของ Meta</li>
          </ol>
          <a href="https://developers.facebook.com/docs/pages/getting-started" target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline">
            <Link2 size={14} /> เอกสารทางการของ Meta
          </a>
        </SectionCard>
      </div>
    </div>
  )
}
