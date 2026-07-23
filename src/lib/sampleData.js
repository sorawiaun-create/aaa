import { monthKeyOf } from './format.js';

// Generates a small but realistic demo dataset so the app is usable
// immediately, before the user imports their own files.
export function makeSampleData() {
  const products = [
    { sku: 'TSHIRT-BLK-M', name: 'เสื้อยืดสีดำ ไซส์ M', unitCost: 85, category: 'เสื้อผ้า' },
    { sku: 'TSHIRT-WHT-L', name: 'เสื้อยืดสีขาว ไซส์ L', unitCost: 85, category: 'เสื้อผ้า' },
    { sku: 'MUG-CERAMIC', name: 'แก้วเซรามิก 350ml', unitCost: 45, category: 'ของใช้' },
    { sku: 'BOTTLE-500', name: 'ขวดน้ำสแตนเลส 500ml', unitCost: 120, category: 'ของใช้' },
    { sku: 'CAP-CANVAS', name: 'หมวกแก๊ปผ้าแคนวาส', unitCost: 60, category: 'แฟชั่น' },
    // NOTE: SKU "TOTE-BAG" is intentionally sold but missing here to demo unmatched-cost warnings.
  ];

  const catalog = [
    { sku: 'TSHIRT-BLK-M', name: 'เสื้อยืดสีดำ ไซส์ M', price: 199 },
    { sku: 'TSHIRT-WHT-L', name: 'เสื้อยืดสีขาว ไซส์ L', price: 199 },
    { sku: 'MUG-CERAMIC', name: 'แก้วเซรามิก 350ml', price: 129 },
    { sku: 'BOTTLE-500', name: 'ขวดน้ำสแตนเลส 500ml', price: 259 },
    { sku: 'CAP-CANVAS', name: 'หมวกแก๊ปผ้าแคนวาส', price: 159 },
    { sku: 'TOTE-BAG', name: 'กระเป๋าผ้า Tote', price: 149 },
  ];

  const months = ['2025-10', '2025-11', '2025-12'];
  const platforms = ['shopee', 'tiktok'];
  const statuses = ['สำเร็จ', 'สำเร็จ', 'สำเร็จ', 'ยกเลิก']; // ~75% completed
  const sales = [];
  let seq = 0;

  const rand = (n) => Math.floor(Math.random() * n);

  months.forEach((mk) => {
    const [y, m] = mk.split('-');
    platforms.forEach((platform) => {
      const orders = 18 + rand(10);
      for (let o = 0; o < orders; o++) {
        const day = String(1 + rand(27)).padStart(2, '0');
        const date = `${day}/${m}/${y}`;
        const orderId = `${platform.toUpperCase()}-${mk.replace('-', '')}-${1000 + seq}`;
        const lines = 1 + rand(2);
        for (let l = 0; l < lines; l++) {
          const item = catalog[rand(catalog.length)];
          const qty = 1 + rand(3);
          sales.push({
            id: `${platform}:${orderId}:${item.sku}:${seq}-${l}`,
            platform,
            orderId,
            date,
            monthKey: monthKeyOf(date),
            sku: item.sku,
            productName: item.name,
            qty,
            unitPrice: item.price,
            revenue: item.price * qty,
            status: statuses[rand(statuses.length)],
          });
        }
        seq += 1;
      }
    });
  });

  // Fee documents (one per platform per month) derived roughly from revenue.
  const fees = [];
  months.forEach((mk) => {
    const [y, m] = mk.split('-');
    const date = `15/${m}/${y}`;
    const shopeeRev = sales
      .filter((s) => s.platform === 'shopee' && s.monthKey === mk && s.status === 'สำเร็จ')
      .reduce((a, s) => a + s.revenue, 0);
    const tiktokRev = sales
      .filter((s) => s.platform === 'tiktok' && s.monthKey === mk && s.status === 'สำเร็จ')
      .reduce((a, s) => a + s.revenue, 0);

    const shComm = shopeeRev * 0.08;
    const shAds = shopeeRev * 0.05;
    fees.push({
      id: `sample-shopee-${mk}`, date, monthKey: mk, platform: 'shopee',
      ads: round(shAds), comm: round(shComm), trans: round(shopeeRev * 0.02),
      service: 0, ams: 0, infra: 0, growth: 0, affiliate: 0, logistics: 0,
      vat: round((shComm + shAds) * 0.07), wht: round(shComm * 0.03),
      total: round((shComm + shAds + shopeeRev * 0.02) * 1.07),
    });

    const ttComm = tiktokRev * 0.06;
    const ttAds = tiktokRev * 0.07;
    const ttAff = tiktokRev * 0.04;
    fees.push({
      id: `sample-tiktok-${mk}`, date, monthKey: mk, platform: 'tiktok',
      ads: round(ttAds), comm: round(ttComm), trans: round(tiktokRev * 0.015),
      service: 0, ams: 0, infra: 0, growth: round(tiktokRev * 0.01),
      affiliate: round(ttAff), logistics: 0,
      vat: round((ttComm + ttAds + ttAff) * 0.07), wht: round(ttComm * 0.03),
      total: round((ttComm + ttAds + ttAff + tiktokRev * 0.025) * 1.07),
    });
  });

  return { products, sales, fees };
}

const round = (n) => Math.round(n * 100) / 100;
