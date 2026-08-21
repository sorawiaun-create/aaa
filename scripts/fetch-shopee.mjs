#!/usr/bin/env node
/**
 * ดึงรายการสินค้าจาก Shopee Affiliate Open API แล้วเซฟเป็น JSON
 * ที่หน้า "คัดสินค้ายิงแอด" นำเข้าได้ทันที
 *
 * ต้องมีบัญชี Shopee Affiliate ที่เปิดใช้ Open API แล้ว (App ID + Secret)
 *   ดูที่ https://open-api.affiliate.shopee.co.th → Developer / My Apps
 *
 * วิธีใช้:
 *   export SHOPEE_APP_ID=xxxx
 *   export SHOPEE_APP_SECRET=xxxx
 *   node scripts/fetch-shopee.mjs --pages 20 --out shopee-products.json
 *
 * ตัวเลือก:
 *   --pages N       ดึงกี่หน้า (หน้าละ --limit ตัว, ค่าเริ่มต้น 10)
 *   --limit N       จำนวนต่อหน้า สูงสุดตามที่ API อนุญาต (ค่าเริ่มต้น 50)
 *   --keyword คำ    ค้นด้วยคำค้น (เว้นว่าง = ดึงตามรายการยอดนิยม)
 *   --list-type X   ประเภทรายการของ API เช่น 2 = สินค้าที่กำลังฮิต
 *   --sort-type X   การเรียงของ API เช่น 2 = ยอดขายสูงสุด
 *   --out ไฟล์      ไฟล์ปลายทาง (ค่าเริ่มต้น shopee-products.json)
 *   --region th     โดเมนภูมิภาค (th/sg/my/...) ค่าเริ่มต้น th
 *
 * หมายเหตุ: Shopee ไม่เปิด API ให้ไล่ดู "สินค้าทั้งหมดของทุกร้าน" รวดเดียว
 * วิธีที่ใช้ได้จริงคือดึงเป็นรอบ ๆ ตามคำค้น/หมวด/รายการยอดนิยม แล้วสะสมไว้
 * ระบบจะรวมสินค้าตัวเดียวกัน (shopId + itemId) และรวมรอบดีลให้เองตอนนำเข้า
 */
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const APP_ID = process.env.SHOPEE_APP_ID;
const APP_SECRET = process.env.SHOPEE_APP_SECRET;
const REGION = arg('region', 'th');
const ENDPOINT = process.env.SHOPEE_API_URL || `https://open-api.affiliate.shopee.co.${REGION}/graphql`;

const PAGES = Number(arg('pages', 10));
const LIMIT = Number(arg('limit', 50));
const KEYWORD = arg('keyword', '');
const LIST_TYPE = Number(arg('list-type', 0));
const SORT_TYPE = Number(arg('sort-type', 2));
const OUT = arg('out', 'shopee-products.json');

if (!APP_ID || !APP_SECRET) {
  console.error('ต้องตั้ง SHOPEE_APP_ID และ SHOPEE_APP_SECRET ก่อน (ดูวิธีขอที่ open-api.affiliate.shopee.co.th)');
  process.exit(1);
}

const QUERY = `
query ProductOffer($page: Int, $limit: Int, $keyword: String, $listType: Int, $sortType: Int) {
  productOfferV2(page: $page, limit: $limit, keyword: $keyword, listType: $listType, sortType: $sortType) {
    nodes {
      itemId shopId productName shopName productLink offerLink imageUrl
      price priceMin priceMax priceDiscountRate commissionRate commission
      sales ratingStar productCatIds shopType
    }
    pageInfo { page limit hasNextPage }
  }
}`;

// Shopee เซ็นคำขอด้วย SHA256(appId + timestamp + payload + secret)
function signedHeaders(payload) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHash('sha256').update(`${APP_ID}${timestamp}${payload}${APP_SECRET}`).digest('hex');
  return {
    'Content-Type': 'application/json',
    Authorization: `SHA256 Credential=${APP_ID}, Timestamp=${timestamp}, Signature=${signature}`,
  };
}

async function fetchPage(page) {
  const payload = JSON.stringify({
    query: QUERY,
    variables: { page, limit: LIMIT, keyword: KEYWORD, listType: LIST_TYPE, sortType: SORT_TYPE },
  });
  const res = await fetch(ENDPOINT, { method: 'POST', headers: signedHeaders(payload), body: payload });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text().catch(() => '')}`.slice(0, 300));
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join('; '));
  return json.data?.productOfferV2 || { nodes: [], pageInfo: {} };
}

// แปลงจากรูปแบบ API → รูปแบบที่หน้าเว็บนำเข้าได้ตรง ๆ
function toProduct(n) {
  const price = Number(n.price ?? n.priceMin ?? 0);
  const discountPct = Number(n.priceDiscountRate ?? 0);
  const commissionRate = Number(n.commissionRate ?? 0) * (Number(n.commissionRate) <= 1 ? 100 : 1);
  return {
    itemId: String(n.itemId ?? ''),
    shopId: String(n.shopId ?? ''),
    name: n.productName ?? '',
    shopName: n.shopName ?? '',
    category: '', // API ให้มาเป็นรหัสหมวด — ระบบจะเดาหมวดจากชื่อสินค้าให้เอง
    price,
    // ราคาเต็มคำนวณย้อนจาก % ส่วนลด เพราะ API ให้มาเฉพาะราคาหลังลด
    originalPrice: discountPct > 0 && discountPct < 100 ? Math.round(price / (1 - discountPct / 100)) : 0,
    discountPct,
    commissionRate: Math.round(commissionRate * 100) / 100,
    commissionPerUnit: Number(n.commission ?? 0),
    rating: Number(n.ratingStar ?? 0),
    ratingCount: 0,
    sold: Number(n.sales ?? 0),
    url: n.offerLink || n.productLink || '',
    image: n.imageUrl || '',
    rounds: [],
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const all = new Map();
  for (let page = 1; page <= PAGES; page += 1) {
    try {
      const { nodes, pageInfo } = await fetchPage(page);
      nodes.forEach((n) => {
        const p = toProduct(n);
        const key = `${p.shopId}:${p.itemId}`;
        if (p.name) all.set(key, p);
      });
      console.log(`หน้า ${page}: ได้ ${nodes.length} รายการ (สะสม ${all.size})`);
      if (pageInfo && pageInfo.hasNextPage === false) break;
      await sleep(400); // กันโดน rate limit
    } catch (err) {
      console.error(`หน้า ${page} ล้มเหลว: ${err.message}`);
      break;
    }
  }

  const products = [...all.values()];
  if (!products.length) {
    console.error('ไม่ได้ข้อมูลเลย — ตรวจ App ID/Secret และสิทธิ์ Open API ของบัญชีอีกครั้ง');
    process.exit(2);
  }
  await writeFile(OUT, JSON.stringify({ fetchedAt: new Date().toISOString(), products }, null, 1), 'utf8');
  console.log(`เซฟ ${products.length} รายการลง ${OUT} — เปิดเว็บแล้วกด "นำเข้าไฟล์สินค้า" ได้เลย`);
}

main();
