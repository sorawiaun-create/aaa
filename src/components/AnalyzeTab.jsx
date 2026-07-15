import React, { useMemo, useRef, useState } from 'react'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import {
  Upload, DollarSign, MousePointerClick, Eye, Target, TrendingUp,
  Percent, Sparkles, FlaskConical, AlertTriangle, CheckCircle2, Info,
  Trash2,
} from 'lucide-react'
import { parseCsvFile } from '../lib/csv'
import { aggregate, groupBy, timeSeries, buildInsights, fmtCurrency, fmtNumber, fmtPercent } from '../lib/metrics'
import { makeSampleRows } from '../lib/sample'
import { KpiCard, SectionCard, EmptyState, Badge } from './ui'

const INSIGHT_STYLE = {
  good: { icon: CheckCircle2, cls: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
  bad: { icon: AlertTriangle, cls: 'border-red-200 bg-red-50 text-red-800' },
  warn: { icon: AlertTriangle, cls: 'border-amber-200 bg-amber-50 text-amber-800' },
}

export default function AnalyzeTab({ rows, setRows }) {
  const [cols, setCols] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const fileRef = useRef(null)

  const onFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setLoading(true)
    setError('')
    try {
      const { rows: parsed, cols } = await parseCsvFile(file)
      if (!parsed.length) {
        setError('ไม่พบข้อมูลที่ใช้ได้ในไฟล์นี้ ลองตรวจสอบว่าเป็นไฟล์ export จาก Ads Manager')
      }
      setRows(parsed)
      setCols(cols)
    } catch (err) {
      setError('อ่านไฟล์ไม่สำเร็จ: ' + err.message)
    } finally {
      setLoading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const loadSample = () => {
    setRows(makeSampleRows())
    setCols(null)
    setError('')
  }

  const total = useMemo(() => aggregate(rows), [rows])
  const byCampaign = useMemo(() => groupBy(rows, 'campaign'), [rows])
  const series = useMemo(() => timeSeries(rows), [rows])
  const insights = useMemo(() => buildInsights(rows), [rows])

  if (!rows.length) {
    return (
      <div className="grid lg:grid-cols-2 gap-6">
        <SectionCard title="อัปโหลดรายงาน Facebook Ads" icon={Upload}>
          <p className="text-sm text-slate-500 mb-4">
            ไปที่ <b>Ads Manager → Reports → Export</b> เลือกเป็น CSV แล้วอัปโหลดที่นี่
            (ระบบตรวจจับคอลัมน์ให้อัตโนมัติ รองรับทั้งภาษาไทยและอังกฤษ)
          </p>
          <div className="flex flex-col gap-3">
            <label className="relative inline-flex items-center justify-center px-6 py-3 text-base font-bold text-white bg-blue-600 rounded-xl cursor-pointer shadow-lg hover:bg-blue-700 transition-colors">
              <Upload size={18} className="mr-2" /> {loading ? 'กำลังอ่าน...' : 'เลือกไฟล์ CSV'}
              <input ref={fileRef} type="file" accept=".csv,text/csv" className="absolute inset-0 opacity-0 cursor-pointer" onChange={onFile} />
            </label>
            <button onClick={loadSample} className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl border border-slate-300 text-slate-700 font-medium hover:bg-slate-50">
              <FlaskConical size={18} /> ลองด้วยข้อมูลตัวอย่าง
            </button>
          </div>
          {error && <p className="text-red-600 text-sm mt-4">{error}</p>}
        </SectionCard>

        <SectionCard title="รองรับข้อมูลอะไรบ้าง" icon={Info}>
          <ul className="text-sm text-slate-600 space-y-2 list-disc pl-5">
            <li>ยอดใช้จ่าย (Amount spent), Impressions, Reach, Link clicks</li>
            <li>ผลลัพธ์/การซื้อ (Results / Purchases) และมูลค่า (Conversion value)</li>
            <li>คำนวณให้อัตโนมัติ: CTR, CPC, CPM, CPA, ROAS, Frequency</li>
            <li>สรุปแยกตามแคมเปญ + แนวโน้มรายวัน + คำแนะนำเชิงกลยุทธ์</li>
          </ul>
          <div className="mt-4 p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-500">
            ข้อมูลทั้งหมดประมวลผลในเบราว์เซอร์ของคุณ ไม่มีการอัปโหลดขึ้นเซิร์ฟเวอร์
          </div>
        </SectionCard>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-slate-500">
          กำลังวิเคราะห์ <b className="text-slate-700">{fmtNumber(rows.length)}</b> แถว
          {cols && (
            <span className="ml-2">
              <Badge tone={cols.spend ? 'green' : 'amber'}>{cols.spend ? 'พบคอลัมน์งบ' : 'ไม่พบคอลัมน์งบ'}</Badge>
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <label className="relative inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium cursor-pointer hover:bg-blue-700">
            <Upload size={16} /> อัปโหลดใหม่
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="absolute inset-0 opacity-0 cursor-pointer" onChange={onFile} />
          </label>
          <button onClick={() => { setRows([]); setCols(null) }} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 text-slate-600 text-sm hover:bg-slate-50">
            <Trash2 size={16} /> ล้าง
          </button>
        </div>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        <KpiCard title="ยอดใช้จ่ายรวม" value={fmtCurrency(total.spend)} sub="Total spend" icon={DollarSign} tone="orange" />
        <KpiCard title="ROAS" value={`${total.roas.toFixed(2)}x`} sub={`รายได้ ${fmtCurrency(total.revenue)}`} icon={TrendingUp} tone="green" />
        <KpiCard title="CTR" value={fmtPercent(total.ctr)} sub={`${fmtNumber(total.clicks)} คลิก`} icon={MousePointerClick} tone="blue" />
        <KpiCard title="CPC" value={fmtCurrency(total.cpc)} sub="ต่อคลิก" icon={Target} tone="purple" />
        <KpiCard title="CPM" value={fmtCurrency(total.cpm)} sub={`${fmtNumber(total.impressions)} imp.`} icon={Eye} tone="pink" />
        <KpiCard title="CPA" value={fmtCurrency(total.cpa)} sub={`${fmtNumber(total.results)} ผลลัพธ์`} icon={Percent} tone="slate" />
      </div>

      {/* Insights */}
      {insights.length > 0 && (
        <SectionCard title="คำแนะนำเชิงกลยุทธ์" icon={Sparkles}>
          <div className="grid md:grid-cols-2 gap-3">
            {insights.map((ins, i) => {
              const s = INSIGHT_STYLE[ins.type] || INSIGHT_STYLE.warn
              const Icon = s.icon
              return (
                <div key={i} className={`flex gap-3 p-3 rounded-xl border ${s.cls}`}>
                  <Icon size={18} className="shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-sm">{ins.title}</p>
                    <p className="text-sm opacity-90">{ins.body}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </SectionCard>
      )}

      {/* Charts */}
      {series.length > 1 && (
        <div className="grid lg:grid-cols-2 gap-6">
          <SectionCard title="แนวโน้มงบ & รายได้รายวัน" icon={TrendingUp}>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={series} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={(v) => `${Math.round(v / 1000)}k`} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(v) => fmtCurrency(v)} contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="spend" name="งบ" fill="#f97316" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="revenue" name="รายได้" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>

          <SectionCard title="แนวโน้ม CTR & CPC" icon={MousePointerClick}>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="l" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line yAxisId="l" type="monotone" dataKey="ctr" name="CTR %" stroke="#3b82f6" strokeWidth={2} dot={false} />
                  <Line yAxisId="r" type="monotone" dataKey="cpc" name="CPC ฿" stroke="#a855f7" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>
        </div>
      )}

      {/* Campaign breakdown */}
      <SectionCard title="สรุปแยกตามแคมเปญ" icon={Target}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-slate-500 text-xs uppercase border-b border-slate-200">
              <tr>
                <th className="px-3 py-3">แคมเปญ</th>
                <th className="px-3 py-3 text-right">งบ</th>
                <th className="px-3 py-3 text-right">Imp.</th>
                <th className="px-3 py-3 text-right">คลิก</th>
                <th className="px-3 py-3 text-right">CTR</th>
                <th className="px-3 py-3 text-right">CPC</th>
                <th className="px-3 py-3 text-right">ผลลัพธ์</th>
                <th className="px-3 py-3 text-right">CPA</th>
                <th className="px-3 py-3 text-right">ROAS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {byCampaign.map((c, i) => (
                <tr key={i} className="hover:bg-slate-50">
                  <td className="px-3 py-3 font-medium text-slate-700 max-w-[220px] truncate" title={c.name}>{c.name}</td>
                  <td className="px-3 py-3 text-right">{fmtCurrency(c.spend)}</td>
                  <td className="px-3 py-3 text-right text-slate-500">{fmtNumber(c.impressions)}</td>
                  <td className="px-3 py-3 text-right text-slate-500">{fmtNumber(c.clicks)}</td>
                  <td className="px-3 py-3 text-right">{fmtPercent(c.ctr)}</td>
                  <td className="px-3 py-3 text-right">{fmtCurrency(c.cpc)}</td>
                  <td className="px-3 py-3 text-right text-slate-500">{fmtNumber(c.results)}</td>
                  <td className="px-3 py-3 text-right">{c.results ? fmtCurrency(c.cpa) : '—'}</td>
                  <td className="px-3 py-3 text-right">
                    {c.revenue > 0 ? (
                      <Badge tone={c.roas >= 1 ? 'green' : 'red'}>{c.roas.toFixed(2)}x</Badge>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  )
}
