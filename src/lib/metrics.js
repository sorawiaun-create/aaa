// Derived-metric helpers for Facebook Ads data.

export const fmtCurrency = (n, currency = 'THB') =>
  new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(n || 0)

export const fmtNumber = (n) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n || 0)

export const fmtPercent = (n, digits = 2) =>
  `${(n || 0).toFixed(digits)}%`

const safeDiv = (a, b) => (b ? a / b : 0)

// Aggregate an array of normalized rows into totals + derived KPIs.
export function aggregate(rows) {
  const t = rows.reduce(
    (acc, r) => {
      acc.spend += r.spend
      acc.impressions += r.impressions
      acc.reach += r.reach
      acc.clicks += r.clicks
      acc.results += r.results
      acc.revenue += r.revenue
      return acc
    },
    { spend: 0, impressions: 0, reach: 0, clicks: 0, results: 0, revenue: 0 },
  )

  return {
    ...t,
    ctr: safeDiv(t.clicks, t.impressions) * 100, // %
    cpc: safeDiv(t.spend, t.clicks),
    cpm: safeDiv(t.spend, t.impressions) * 1000,
    cpa: safeDiv(t.spend, t.results),
    roas: safeDiv(t.revenue, t.spend),
    frequency: safeDiv(t.impressions, t.reach),
    convRate: safeDiv(t.results, t.clicks) * 100, // %
  }
}

// Group rows by a key (e.g. campaign) and aggregate each group.
export function groupBy(rows, key) {
  const map = new Map()
  for (const r of rows) {
    const k = r[key] || '—'
    if (!map.has(k)) map.set(k, [])
    map.get(k).push(r)
  }
  return Array.from(map.entries())
    .map(([name, group]) => ({ name, ...aggregate(group), count: group.length }))
    .sort((a, b) => b.spend - a.spend)
}

// Build a time series sorted by date for trend charts.
export function timeSeries(rows) {
  const map = new Map()
  for (const r of rows) {
    if (!r.date) continue
    if (!map.has(r.date)) map.set(r.date, [])
    map.get(r.date).push(r)
  }
  return Array.from(map.entries())
    .map(([date, group]) => ({ date, ...aggregate(group) }))
    .sort((a, b) => new Date(a.date) - new Date(b.date))
}

// Simple heuristic insights for the "recommendations" panel.
export function buildInsights(rows) {
  if (!rows.length) return []
  const total = aggregate(rows)
  const byCampaign = groupBy(rows, 'campaign')
  const insights = []

  // Best & worst ROAS campaigns (only when revenue is present).
  const withRevenue = byCampaign.filter((c) => c.revenue > 0)
  if (withRevenue.length) {
    const best = [...withRevenue].sort((a, b) => b.roas - a.roas)[0]
    const worst = [...withRevenue].sort((a, b) => a.roas - b.roas)[0]
    insights.push({
      type: 'good',
      title: 'แคมเปญ ROAS ดีที่สุด',
      body: `"${best.name}" ทำ ROAS ${best.roas.toFixed(2)}x — พิจารณาเพิ่มงบ`,
    })
    if (worst.name !== best.name && worst.roas < 1) {
      insights.push({
        type: 'bad',
        title: 'แคมเปญขาดทุน (ROAS < 1)',
        body: `"${worst.name}" ROAS เพียง ${worst.roas.toFixed(2)}x — ควรหยุดหรือปรับครีเอทีฟ`,
      })
    }
  }

  // CTR benchmark (~1% is a rough FB feed benchmark).
  if (total.ctr < 1 && total.impressions > 1000) {
    insights.push({
      type: 'bad',
      title: 'CTR ต่ำกว่าเกณฑ์',
      body: `CTR รวม ${total.ctr.toFixed(2)}% (ต่ำกว่า ~1%) — ครีเอทีฟหรือกลุ่มเป้าหมายอาจไม่ตรง`,
    })
  } else if (total.ctr >= 2) {
    insights.push({
      type: 'good',
      title: 'CTR สูง',
      body: `CTR รวม ${total.ctr.toFixed(2)}% — ครีเอทีฟทำงานได้ดี`,
    })
  }

  // Frequency fatigue.
  if (total.frequency > 3) {
    insights.push({
      type: 'warn',
      title: 'ความถี่สูง (Ad fatigue)',
      body: `Frequency ${total.frequency.toFixed(1)} — คนเห็นซ้ำบ่อย ควรเปลี่ยนครีเอทีฟหรือขยายกลุ่ม`,
    })
  }

  // Spend concentration.
  if (byCampaign.length > 1) {
    const topShare = (byCampaign[0].spend / total.spend) * 100
    if (topShare > 60) {
      insights.push({
        type: 'warn',
        title: 'งบกระจุกตัว',
        body: `"${byCampaign[0].name}" ใช้งบ ${topShare.toFixed(0)}% ของทั้งหมด — ระวังความเสี่ยงถ้าแคมเปญนี้ตก`,
      })
    }
  }

  return insights
}
