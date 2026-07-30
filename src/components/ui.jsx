import React from 'react';

export const cn = (...parts) => parts.filter(Boolean).join(' ');

// KPI / metric card with an accent icon.
export const KpiCard = ({ title, value, valueTitle, subtext, icon: Icon, accent = 'slate', trend }) => {
  const accents = {
    emerald: 'bg-emerald-50 text-emerald-600',
    orange: 'bg-orange-50 text-orange-600',
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-green-50 text-green-600',
    red: 'bg-red-50 text-red-600',
    purple: 'bg-purple-50 text-purple-600',
    pink: 'bg-pink-50 text-pink-600',
    slate: 'bg-slate-100 text-slate-600',
  };
  return (
    <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 flex items-start gap-3 transition-transform hover:-translate-y-0.5 duration-200">
      {Icon && (
        <div className={cn('p-2.5 rounded-xl shrink-0', accents[accent] || accents.slate)}>
          <Icon className="w-5 h-5" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-slate-500 text-xs font-medium leading-tight" title={title}>
          {title}
        </p>
        <h3 className="text-base sm:text-lg lg:text-xl font-bold text-slate-800 mt-1 tabular-nums tracking-tight break-words" title={valueTitle}>
          {value}
        </h3>
        {subtext && (
          <p className="text-slate-400 text-[11px] mt-0.5 truncate" title={subtext}>
            {subtext}
          </p>
        )}
        {trend}
      </div>
    </div>
  );
};

export const SectionCard = ({ title, icon: Icon, action, children, className }) => (
  <div className={cn('bg-white rounded-2xl shadow-sm border border-slate-200', className)}>
    {(title || action) && (
      <div className="p-5 border-b border-slate-100 flex justify-between items-center flex-wrap gap-3">
        <h2 className="text-base md:text-lg font-bold text-slate-800 flex items-center gap-2">
          {Icon && <Icon className="w-5 h-5 text-slate-400" />}
          {title}
        </h2>
        {action}
      </div>
    )}
    {children}
  </div>
);

export const Button = ({ variant = 'primary', size = 'md', icon: Icon, children, className, ...props }) => {
  const variants = {
    primary: 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm',
    secondary: 'bg-slate-100 hover:bg-slate-200 text-slate-700',
    danger: 'bg-red-50 hover:bg-red-100 text-red-600',
    ghost: 'hover:bg-slate-100 text-slate-600',
    success: 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm',
  };
  const sizes = { sm: 'px-3 py-1.5 text-xs', md: 'px-4 py-2 text-sm', lg: 'px-5 py-2.5 text-base' };
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    >
      {Icon && <Icon size={size === 'sm' ? 14 : 16} />}
      {children}
    </button>
  );
};

export const Badge = ({ children, color = 'slate' }) => {
  const colors = {
    shopee: 'bg-orange-100 text-orange-700',
    tiktok: 'bg-slate-900 text-white',
    green: 'bg-green-100 text-green-700',
    red: 'bg-red-100 text-red-700',
    amber: 'bg-amber-100 text-amber-700',
    slate: 'bg-slate-100 text-slate-600',
    blue: 'bg-blue-100 text-blue-700',
  };
  return (
    <span className={cn('px-2 py-0.5 rounded-md text-xs font-semibold', colors[color] || colors.slate)}>
      {children}
    </span>
  );
};

export const PlatformBadge = ({ platform }) =>
  platform === 'shopee' ? (
    <Badge color="shopee">Shopee</Badge>
  ) : (
    <Badge color="tiktok">TikTok</Badge>
  );

export const EmptyState = ({ icon: Icon, title, hint, children }) => (
  <div className="py-14 flex flex-col items-center justify-center text-center text-slate-400">
    {Icon && <Icon size={44} className="mb-3 opacity-20" />}
    <p className="font-medium text-slate-500">{title}</p>
    {hint && <p className="text-sm mt-1 max-w-md">{hint}</p>}
    {children && <div className="mt-4">{children}</div>}
  </div>
);

export const Banner = ({ tone = 'info', children }) => {
  const tones = {
    info: 'bg-blue-50 text-blue-700 border-blue-100',
    warn: 'bg-amber-50 text-amber-700 border-amber-100',
    success: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    error: 'bg-red-50 text-red-700 border-red-100',
  };
  return (
    <div className={cn('px-4 py-3 rounded-xl border text-sm flex items-start gap-2', tones[tone])}>
      {children}
    </div>
  );
};

// --- Form controls ---
const fieldCls =
  'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white text-slate-800 focus:ring-2 focus:ring-pink-200 focus:border-pink-300 focus:outline-none';

export const Field = ({ label, hint, children, className }) => (
  <label className={cn('block', className)}>
    {label && <span className="block text-xs font-medium text-slate-500 mb-1">{label}</span>}
    {children}
    {hint && <span className="block text-[11px] text-slate-400 mt-1">{hint}</span>}
  </label>
);

export const Input = ({ className, ...props }) => (
  <input className={cn(fieldCls, className)} {...props} />
);

export const Select = ({ className, children, ...props }) => (
  <select className={cn(fieldCls, 'pr-8', className)} {...props}>
    {children}
  </select>
);

export const Textarea = ({ className, ...props }) => (
  <textarea className={cn(fieldCls, 'resize-y', className)} {...props} />
);

// Channel/status pill.
export const StatusPill = ({ status }) => {
  const map = {
    active: { label: 'กำลังใช้งาน', cls: 'bg-emerald-100 text-emerald-700' },
    paused: { label: 'พักชั่วคราว', cls: 'bg-amber-100 text-amber-700' },
    closed: { label: 'ปิดใช้งาน', cls: 'bg-slate-200 text-slate-500' },
  };
  const s = map[status] || map.closed;
  return <span className={cn('px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap', s.cls)}>{s.label}</span>;
};

// Centered modal dialog.
export const Modal = ({ open, onClose, title, children, footer, wide }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className={cn('relative bg-white rounded-2xl shadow-xl border border-slate-200 w-full my-6', wide ? 'max-w-3xl' : 'max-w-lg')}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="font-bold text-slate-800">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none px-1">×</button>
        </div>
        <div className="p-5 max-h-[70vh] overflow-y-auto custom-scrollbar">{children}</div>
        {footer && <div className="px-5 py-4 border-t border-slate-100 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
};
