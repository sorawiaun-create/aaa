import React, { createContext, useContext, useEffect, useState } from 'react';

// Lightweight i18n: a two-language dictionary + a `t(key)` helper. Thai is the
// source language; English is the alternate. Missing keys fall back to Thai,
// then to the key itself, so partial coverage never crashes the UI.
const DICT = {
  th: {
    'app.title': 'Profit Desk',
    'app.subtitle': 'Shopee · TikTok',
    'nav.dashboard': 'แดชบอร์ด',
    'nav.orders': 'กำไรจริง (รายออเดอร์)',
    'nav.reconcile': 'กำไรราย SKU',
    'nav.analytics': 'วิเคราะห์สินค้า',
    'nav.expenses': 'รายจ่ายทั่วไป',
    'nav.products': 'สินค้า & ต้นทุน',
    'nav.sales': 'นำเข้ายอดขาย',
    'nav.fees': 'นำเข้าค่าธรรมเนียม',
    'nav.data': 'จัดการข้อมูล',
    'side.products': 'สินค้า',
    'side.sales': 'รายการขาย',
    'side.fees': 'เอกสารค่าธรรมเนียม',
    'filter.all': 'ทั้งหมด',
    'filter.month': 'เดือน',
    'filter.status': 'สถานะ',
    'filter.clear': 'ล้าง',
    'filter.reset': 'รีเซ็ต',
    'lang.name': 'ภาษา',
  },
  en: {
    'app.title': 'Profit Desk',
    'app.subtitle': 'Shopee · TikTok',
    'nav.dashboard': 'Dashboard',
    'nav.orders': 'True Profit (by order)',
    'nav.reconcile': 'Profit by SKU',
    'nav.analytics': 'Product Analytics',
    'nav.expenses': 'General Expenses',
    'nav.products': 'Products & Cost',
    'nav.sales': 'Import Sales',
    'nav.fees': 'Import Fees',
    'nav.data': 'Data',
    'side.products': 'Products',
    'side.sales': 'Sales lines',
    'side.fees': 'Fee documents',
    'filter.all': 'All',
    'filter.month': 'Month',
    'filter.status': 'Status',
    'filter.clear': 'Clear',
    'filter.reset': 'Reset',
    'lang.name': 'Language',
  },
};

const I18nContext = createContext({ lang: 'th', setLang: () => {}, t: (k) => k });

export function LanguageProvider({ children }) {
  const [lang, setLang] = useState(() => {
    try { return localStorage.getItem('ptr_lang') || 'th'; } catch { return 'th'; }
  });
  useEffect(() => {
    try { localStorage.setItem('ptr_lang', lang); } catch { /* ignore */ }
    document.documentElement.lang = lang;
  }, [lang]);

  const t = (key) => DICT[lang]?.[key] ?? DICT.th[key] ?? key;
  return <I18nContext.Provider value={{ lang, setLang, t }}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);
