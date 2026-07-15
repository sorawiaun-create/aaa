import Papa from 'papaparse'

// --- Column detection -------------------------------------------------------
// Facebook Ads Manager exports use different column labels depending on
// language, currency and the columns the user picked. We fuzzy-match headers
// by keyword so the app works with most export variations.

const norm = (s) => (s || '').toString().toLowerCase().replace(/\s+/g, ' ').trim()

// Find the first header that contains ALL words of any candidate phrase.
function findCol(headers, candidates) {
  const normalized = headers.map((h) => ({ raw: h, n: norm(h) }))
  for (const cand of candidates) {
    const words = norm(cand).split(' ')
    const hit = normalized.find((h) => words.every((w) => h.n.includes(w)))
    if (hit) return hit.raw
  }
  return null
}

const toNumber = (v) => {
  if (v === null || v === undefined || v === '') return 0
  const n = parseFloat(v.toString().replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : 0
}

// Map many possible headers → canonical field name.
const FIELD_MAP = {
  campaign: ['campaign name', 'campaign', 'ชื่อแคมเปญ', 'แคมเปญ'],
  adset: ['ad set name', 'adset name', 'ad set', 'ชื่อชุดโฆษณา', 'ชุดโฆษณา'],
  ad: ['ad name', 'ชื่อโฆษณา'],
  date: ['day', 'reporting starts', 'date', 'วันที่'],
  spend: [
    'amount spent',
    'spend',
    'cost',
    'ยอดที่ใช้จ่าย',
    'จำนวนเงินที่ใช้',
    'ค่าใช้จ่าย',
  ],
  impressions: ['impressions', 'การแสดงผล'],
  reach: ['reach', 'การเข้าถึง'],
  clicks: ['link clicks', 'clicks all', 'clicks', 'คลิกลิงก์', 'คลิก'],
  results: ['results', 'ผลลัพธ์'],
  resultType: ['result indicator', 'result type'],
  revenue: [
    'purchases conversion value',
    'conversion value',
    'purchase value',
    'website purchases conversion value',
    'มูลค่าการซื้อ',
    'มูลค่า Conversion',
  ],
  purchases: ['purchases', 'website purchases', 'การซื้อ'],
}

export function detectColumns(headers) {
  const map = {}
  for (const [field, cands] of Object.entries(FIELD_MAP)) {
    map[field] = findCol(headers, cands)
  }
  return map
}

// --- Normalization ----------------------------------------------------------
export function normalizeRows(rawRows, headers) {
  const cols = detectColumns(headers)

  const rows = rawRows
    .map((r) => {
      const get = (field) => (cols[field] ? r[cols[field]] : undefined)
      const clicks = toNumber(get('clicks'))
      const results = toNumber(get('results')) || toNumber(get('purchases'))
      return {
        campaign: (get('campaign') || '—').toString().trim(),
        adset: (get('adset') || '').toString().trim(),
        ad: (get('ad') || '').toString().trim(),
        date: (get('date') || '').toString().trim(),
        spend: toNumber(get('spend')),
        impressions: toNumber(get('impressions')),
        reach: toNumber(get('reach')),
        clicks,
        results,
        resultType: (get('resultType') || '').toString().trim(),
        revenue: toNumber(get('revenue')),
      }
    })
    // Drop fully-empty / summary rows.
    .filter((r) => r.spend > 0 || r.impressions > 0 || r.clicks > 0)

  return { rows, cols }
}

export function parseCsvFile(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const headers = res.meta.fields || []
        const { rows, cols } = normalizeRows(res.data, headers)
        resolve({ rows, cols, headers })
      },
      error: reject,
    })
  })
}

export function parseCsvText(text) {
  const res = Papa.parse(text, { header: true, skipEmptyLines: true })
  const headers = res.meta.fields || []
  const { rows, cols } = normalizeRows(res.data, headers)
  return { rows, cols, headers }
}
