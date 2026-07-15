// Generates realistic-looking demo data so the dashboard works before the
// user uploads a real Facebook Ads export.

const CAMPAIGNS = [
  'Conversion - เสื้อยืด Summer',
  'Traffic - โปรลดราคา 11.11',
  'Engagement - รีวิวลูกค้า',
  'Conversion - รองเท้าผ้าใบ',
]

const rand = (min, max) => min + Math.random() * (max - min)

export function makeSampleRows(days = 21) {
  const rows = []
  const today = new Date()
  for (let d = days - 1; d >= 0; d--) {
    const date = new Date(today)
    date.setDate(today.getDate() - d)
    const iso = date.toISOString().slice(0, 10)
    for (const campaign of CAMPAIGNS) {
      const impressions = Math.round(rand(2000, 15000))
      const ctr = rand(0.6, 3.2) / 100
      const clicks = Math.round(impressions * ctr)
      const cpc = rand(3, 12)
      const spend = +(clicks * cpc).toFixed(2)
      const convRate = rand(0.02, 0.09)
      const results = Math.round(clicks * convRate)
      const aov = rand(350, 1200)
      const revenue = +(results * aov).toFixed(2)
      rows.push({
        campaign,
        adset: 'Default',
        ad: 'Creative A',
        date: iso,
        spend,
        impressions,
        reach: Math.round(impressions * rand(0.6, 0.85)),
        clicks,
        results,
        resultType: 'Purchases',
        revenue,
      })
    }
  }
  return rows
}
