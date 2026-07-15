import React from 'react'

export function KpiCard({ title, value, sub, icon: Icon, tone = 'blue' }) {
  const tones = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-emerald-50 text-emerald-600',
    orange: 'bg-orange-50 text-orange-600',
    pink: 'bg-pink-50 text-pink-600',
    purple: 'bg-purple-50 text-purple-600',
    slate: 'bg-slate-100 text-slate-600',
  }
  return (
    <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 flex items-start gap-4 hover:-translate-y-0.5 transition-transform">
      {Icon && (
        <div className={`p-3 rounded-xl shrink-0 ${tones[tone]}`}>
          <Icon size={22} />
        </div>
      )}
      <div className="min-w-0">
        <p className="text-slate-500 text-sm font-medium truncate" title={title}>
          {title}
        </p>
        <h3 className="text-xl md:text-2xl font-bold text-slate-800 mt-0.5">{value}</h3>
        {sub && <p className="text-slate-400 text-xs mt-1 truncate">{sub}</p>}
      </div>
    </div>
  )
}

export function SectionCard({ title, icon: Icon, children, right }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200">
      {(title || right) && (
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <h2 className="font-bold text-slate-800 flex items-center gap-2">
            {Icon && <Icon size={18} className="text-slate-400" />} {title}
          </h2>
          {right}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  )
}

export function Badge({ children, tone = 'slate' }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-600',
    green: 'bg-emerald-100 text-emerald-700',
    red: 'bg-red-100 text-red-700',
    amber: 'bg-amber-100 text-amber-700',
    blue: 'bg-blue-100 text-blue-700',
  }
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  )
}

export function EmptyState({ icon: Icon, title, hint }) {
  return (
    <div className="flex flex-col items-center justify-center text-center text-slate-400 py-16">
      {Icon && <Icon size={44} className="mb-4 opacity-30" />}
      <p className="font-medium text-slate-500">{title}</p>
      {hint && <p className="text-sm mt-1 max-w-md">{hint}</p>}
    </div>
  )
}

export function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-600">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  )
}

export const inputClass =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400'
