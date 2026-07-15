import React, { useState } from 'react'
import { BarChart3, Wand2, Send, Facebook } from 'lucide-react'
import AnalyzeTab from './components/AnalyzeTab'
import CreativeTab from './components/CreativeTab'
import PublishTab from './components/PublishTab'

const TABS = [
  { key: 'analyze', label: 'วิเคราะห์ Ads', icon: BarChart3 },
  { key: 'creative', label: 'ทำสื่อ', icon: Wand2 },
  { key: 'publish', label: 'ขึ้น Ads / โพสต์', icon: Send },
]

export default function App() {
  const [tab, setTab] = useState('analyze')
  const [rows, setRows] = useState([])
  const [caption, setCaption] = useState('')

  const useCaption = (text) => {
    setCaption(text)
    setTab('publish')
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-3 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#1877F2] text-white flex items-center justify-center">
              <Facebook size={22} />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-800 leading-tight">FB Ads Studio</h1>
              <p className="text-xs text-slate-400">วิเคราะห์ · ทำสื่อ · ยิงแอด Facebook</p>
            </div>
          </div>

          <nav className="flex bg-slate-100 p-1 rounded-xl">
            {TABS.map((t) => {
              const Icon = t.icon
              const active = tab === t.key
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`px-3 md:px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-all ${
                    active ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <Icon size={16} /> <span className="hidden sm:inline">{t.label}</span>
                </button>
              )
            })}
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 md:px-8 py-6">
        {tab === 'analyze' && <AnalyzeTab rows={rows} setRows={setRows} />}
        {tab === 'creative' && <CreativeTab onUseCaption={useCaption} />}
        {tab === 'publish' && <PublishTab initialCaption={caption} />}
      </main>

      <footer className="max-w-7xl mx-auto px-4 md:px-8 py-8 text-center text-xs text-slate-400">
        ข้อมูลประมวลผลในเบราว์เซอร์ · การโพสต์จริงต้องเชื่อม Meta Graph API และผ่าน App Review
      </footer>
    </div>
  )
}
