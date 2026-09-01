// TikTok Affiliate orders reconciliation (framework-agnostic, testable).
// Input: rows parsed from the affiliate_orders_*.xlsx (objects keyed by the
// Thai column headers TikTok exports).

const H = {
  orderId: 'หมายเลขคำสั่งซื้อ',
  product: 'ชื่อสินค้า',
  price: 'ราคา',
  sold: 'สินค้าที่ขายได้',
  refunded: 'สินค้าที่มีการคืนเงิน',
  shop: 'ชื่อร้านค้า',
  status: 'สถานะการชำระคำสั่งซื้อ',
  rate: 'มาตรฐาน',
  gmv: 'GMV',
  estComm: 'ค่าคอมมิชชั่นมาตรฐานโดยประมาณ',
  estAd: 'ค่าคอมมิชชั่นโฆษณาร้านค้าโดยประมาณ',
  estBonus: 'โบนัสโดยประมาณ',
  actComm: 'ค่าคอมมิชชั่นมาตรฐาน',
  actAd: 'ค่าคอมมิชชั่นโฆษณาร้านค้า',
  actBonus: 'โบนัส',
  final: 'ยอดรายได้รวมสุดท้าย',
  orderDate: 'วันที่สั่งซื้อ',
};

const num = (v) => {
  if (v == null) return 0;
  const s = String(v).replace(/[,%\s฿]/g, '');
  if (s === '' || s === '/') return 0;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
};

// Group raw statuses into a paid / pending / rejected bucket for a clean summary.
export const STATUS_GROUP = {
  'ชำระแล้ว': 'paid',
  'รอดำเนินการ': 'pending',
  'AwaitingPayment': 'pending',
  'ไม่มีสิทธิ์': 'rejected',
};
export const GROUP_LABEL = {
  paid: 'จ่ายแล้ว (รับจริง)',
  pending: 'รอดำเนินการ',
  rejected: 'ไม่มีสิทธิ์ / ตีกลับ',
  other: 'อื่น ๆ',
};

export function isTikTokAffiliate(headers) {
  return headers.includes(H.orderId) && headers.includes(H.gmv);
}

const round2 = (n) => Math.round(n * 100) / 100;

export function reconcileTikTok(rows) {
  const statusMap = new Map();
  const groupMap = new Map();
  const productMap = new Map();
  const orders = new Set();
  const t = { gmv: 0, sold: 0, refund: 0, estComm: 0, estAd: 0, estBonus: 0, actComm: 0, actAd: 0, actBonus: 0, final: 0 };

  for (const r of rows) {
    orders.add(r[H.orderId]);
    const g = num(r[H.gmv]);
    const est = num(r[H.estComm]) + num(r[H.estAd]) + num(r[H.estBonus]);
    const actParts = num(r[H.actComm]) + num(r[H.actAd]) + num(r[H.actBonus]);
    const fn = num(r[H.final]);
    const act = fn || actParts; // final payout if present, else summed actual parts

    t.gmv += g; t.sold += num(r[H.sold]); t.refund += num(r[H.refunded]);
    t.estComm += num(r[H.estComm]); t.estAd += num(r[H.estAd]); t.estBonus += num(r[H.estBonus]);
    t.actComm += num(r[H.actComm]); t.actAd += num(r[H.actAd]); t.actBonus += num(r[H.actBonus]);
    t.final += fn;

    const st = r[H.status] || 'ไม่ระบุ';
    const bumpMap = (map, key, extra) => {
      const cur = map.get(key) || { key, count: 0, gmv: 0, est: 0, act: 0, ...extra };
      cur.count += 1; cur.gmv += g; cur.est += est; cur.act += act;
      map.set(key, cur);
    };
    bumpMap(statusMap, st, { status: st });
    bumpMap(groupMap, STATUS_GROUP[st] || 'other');
    bumpMap(productMap, r[H.product] || 'ไม่ระบุ', { product: r[H.product] || 'ไม่ระบุ' });
  }

  const estTotal = t.estComm + t.estAd + t.estBonus;
  const actTotal = t.final || (t.actComm + t.actAd + t.actBonus);
  const clawback = estTotal - actTotal;

  const finalize = (arr) => arr.map((x) => ({ ...x, gmv: round2(x.gmv), est: round2(x.est), act: round2(x.act) }));

  return {
    rowCount: rows.length,
    orderCount: orders.size,
    gmv: round2(t.gmv),
    sold: t.sold,
    refund: t.refund,
    returnRatePct: t.sold ? round2((t.refund / t.sold) * 100) : 0,
    estTotal: round2(estTotal),
    actTotal: round2(actTotal),
    clawback: round2(clawback),
    clawbackPct: estTotal ? round2((clawback / estTotal) * 100) : 0,   // % ตีกลับของค่าคอม
    payoutPct: estTotal ? round2((actTotal / estTotal) * 100) : 0,      // % ที่ได้จริง
    parts: {
      estComm: round2(t.estComm), estAd: round2(t.estAd), estBonus: round2(t.estBonus),
      actComm: round2(t.actComm), actAd: round2(t.actAd), actBonus: round2(t.actBonus), final: round2(t.final),
    },
    byGroup: finalize([...groupMap.values()]).sort((a, b) => b.gmv - a.gmv),
    byStatus: finalize([...statusMap.values()]).sort((a, b) => b.gmv - a.gmv),
    byProduct: finalize([...productMap.values()]).sort((a, b) => b.est - a.est).slice(0, 20),
  };
}

export { H as TIKTOK_HEADERS };
