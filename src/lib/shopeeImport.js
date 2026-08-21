// --- นำเข้าข้อมูลสินค้า Shopee จากไฟล์ CSV / TSV / JSON / XLSX ---
// รองรับหัวคอลัมน์ทั้งไทยและอังกฤษ และไฟล์ที่ 1 สินค้ามีหลายแถว (แถวละรอบดีล)
// โดยจะรวมรอบดีลของสินค้าเดียวกันให้อัตโนมัติ
import { parseMoney } from './format.js';
import { categoryKeyOf } from './shopee.js';

export const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `sp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// คีย์มาตรฐาน → คำที่อาจเจอในหัวคอลัมน์ (เทียบแบบ "มีคำนี้อยู่ในหัวคอลัมน์")
const FIELD_ALIASES = {
  itemId: ['item id', 'itemid', 'item_id', 'product id', 'productid', 'รหัสสินค้า', 'ไอดีสินค้า'],
  shopId: ['shop id', 'shopid', 'shop_id', 'seller id', 'รหัสร้าน'],
  name: ['product name', 'item name', 'ชื่อสินค้า', 'ชื่อ', 'สินค้า', 'title', 'name'],
  shopName: ['shop name', 'seller name', 'store name', 'ชื่อร้าน', 'ร้านค้า', 'ร้าน', 'shop'],
  category: ['category', 'หมวดหมู่', 'หมวด', 'ประเภทสินค้า', 'ประเภท'],
  price: ['deal price', 'sale price', 'current price', 'ราคาดีล', 'ราคาขาย', 'ราคาลด', 'ราคา'],
  originalPrice: ['original price', 'list price', 'ราคาเต็ม', 'ราคาปกติ', 'ราคาก่อนลด'],
  discountPct: ['discount rate', 'discount %', 'discount', 'ส่วนลด', 'เปอร์เซ็นต์ลด', '%ลด'],
  commissionRate: ['commission rate', 'comm rate', 'อัตราคอม', 'เรตคอม', '%คอม', 'คอมมิชชั่น %'],
  commissionPerUnit: ['commission per item', 'commission amount', 'commission', 'คอมต่อชิ้น', 'ค่าคอม', 'คอมมิชชั่น'],
  rating: ['rating star', 'rating', 'เรตติ้ง', 'ดาว', 'คะแนนรีวิว'],
  ratingCount: ['rating count', 'review count', 'reviews', 'จำนวนรีวิว', 'รีวิว'],
  sold: ['sold count', 'historical sold', 'units sold', 'sold', 'ยอดขาย', 'ขายแล้ว', 'จำนวนที่ขาย'],
  stock: ['stock', 'สต็อก', 'คงเหลือ'],
  url: ['product link', 'offer link', 'product url', 'link', 'url', 'ลิงก์', 'ลิงค์'],
  image: ['image link', 'image url', 'image', 'รูปภาพ', 'รูป'],
  roundStart: ['round start', 'start time', 'deal start', 'เวลาเริ่ม', 'เริ่มรอบ', 'รอบเริ่ม', 'เวลาเริ่มดีล'],
  roundEnd: ['round end', 'end time', 'deal end', 'เวลาจบ', 'จบรอบ', 'สิ้นสุด'],
  roundCount: ['round count', 'rounds', 'จำนวนรอบ', 'รอบที่ขึ้น', 'จำนวนรอบดีล'],
};

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ');

// จับคู่หัวคอลัมน์ดิบ → คีย์มาตรฐาน (คำที่ยาวกว่าชนะ กัน "ราคา" ไปทับ "ราคาเต็ม")
export function mapHeaders(headers) {
  const map = {};
  (headers || []).forEach((h, i) => {
    const key = norm(h);
    if (!key) return;
    let best = null;
    let bestLen = 0;
    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
      for (const alias of aliases) {
        if (key.includes(alias) && alias.length > bestLen) { best = field; bestLen = alias.length; }
      }
    }
    if (best && map[best] === undefined) map[best] = i;
  });
  return map;
}

// แยก CSV/TSV แบบรองรับเครื่องหมายคำพูดและ newline ในเซลล์
export function parseDelimited(text, delimiter) {
  const src = String(text ?? '').replace(/^﻿/, '');
  const d = delimiter || (src.split('\n')[0].includes('\t') ? '\t' : ',');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i += 1; } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === d) { row.push(cell); cell = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

const pct = (v) => {
  const s = String(v ?? '').trim();
  if (!s) return 0;
  const n = parseFloat(s.replace('%', '').replace(/[^0-9.\-]/g, ''));
  if (!Number.isFinite(n)) return 0;
  // "0.45" ที่มาจากไฟล์ที่เก็บเป็นสัดส่วน → 45%
  return n > 0 && n <= 1 && s.includes('.') ? n * 100 : n;
};
const int = (v) => {
  const s = String(v ?? '').trim().toLowerCase();
  const n = parseFloat(s.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n)) return 0;
  if (/k\b|พัน/.test(s)) return Math.round(n * 1000);
  if (/m\b|ล้าน/.test(s)) return Math.round(n * 1_000_000);
  return Math.round(n);
};

// แถวดิบ (object ที่คีย์เป็นคีย์มาตรฐาน) → สินค้า 1 ตัว
export function normalizeProduct(raw, meta = {}) {
  const name = String(raw.name ?? '').trim();
  const categoryRaw = String(raw.category ?? '').trim();
  const rounds = [];
  if (raw.roundStart) rounds.push({ start: String(raw.roundStart).trim(), end: String(raw.roundEnd ?? '').trim() || null });
  if (Array.isArray(raw.rounds)) {
    raw.rounds.forEach((r) => {
      if (!r) return;
      rounds.push(typeof r === 'object' ? { start: r.start ?? r.time ?? '', end: r.end ?? null } : { start: String(r), end: null });
    });
  }

  return {
    id: uid(),
    itemId: String(raw.itemId ?? '').trim(),
    shopId: String(raw.shopId ?? '').trim(),
    name,
    shopName: String(raw.shopName ?? '').trim(),
    category: categoryKeyOf(categoryRaw, name),
    categoryRaw,
    price: parseMoney(raw.price),
    originalPrice: parseMoney(raw.originalPrice),
    discountPct: pct(raw.discountPct),
    commissionRate: pct(raw.commissionRate),
    commissionPerUnit: parseMoney(raw.commissionPerUnit),
    rating: parseFloat(String(raw.rating ?? '').replace(/[^0-9.]/g, '')) || 0,
    ratingCount: int(raw.ratingCount),
    sold: int(raw.sold),
    stock: int(raw.stock),
    url: String(raw.url ?? '').trim(),
    image: String(raw.image ?? '').trim(),
    rounds,
    roundCount: rounds.length || int(raw.roundCount),
    source: meta.source || 'import',
    importedAt: meta.importedAt || new Date().toISOString(),
  };
}

// คีย์ที่ใช้ตัดสินว่าเป็นสินค้าตัวเดียวกัน
export const productKey = (p) =>
  (p.itemId && p.shopId ? `${p.shopId}:${p.itemId}` : '') ||
  p.itemId ||
  p.url ||
  `${p.shopName}|${p.name}`.toLowerCase();

// รวมสินค้าซ้ำ: เก็บค่าที่มีข้อมูลมากกว่า และรวมรอบดีลเข้าด้วยกัน
export function mergeProducts(list) {
  const map = new Map();
  (list || []).forEach((p) => {
    const key = productKey(p);
    const cur = map.get(key);
    if (!cur) { map.set(key, { ...p }); return; }
    const merged = { ...cur };
    Object.entries(p).forEach(([k, v]) => {
      if (k === 'rounds' || k === 'roundCount' || k === 'id') return;
      const empty = merged[k] === '' || merged[k] === 0 || merged[k] == null;
      if (empty && v !== '' && v !== 0 && v != null) merged[k] = v;
    });
    const rounds = [...(cur.rounds || []), ...(p.rounds || [])];
    const seen = new Set();
    merged.rounds = rounds.filter((r) => {
      const rk = `${r?.start || ''}|${r?.end || ''}`;
      if (!r?.start || seen.has(rk)) return false;
      seen.add(rk);
      return true;
    });
    merged.roundCount = merged.rounds.length || Math.max(cur.roundCount || 0, p.roundCount || 0);
    map.set(key, merged);
  });
  return [...map.values()];
}

// ตาราง (แถวแรก = หัวคอลัมน์) → รายการสินค้าที่รวมซ้ำแล้ว
export function productsFromRows(rows, meta = {}) {
  if (!rows || rows.length < 2) return { products: [], mapped: {}, skipped: 0 };
  const mapped = mapHeaders(rows[0]);
  if (mapped.name === undefined) return { products: [], mapped, skipped: rows.length - 1, error: 'ไม่พบคอลัมน์ชื่อสินค้า' };

  let skipped = 0;
  const raws = rows.slice(1).map((r) => {
    const obj = {};
    Object.entries(mapped).forEach(([field, idx]) => { obj[field] = r[idx]; });
    return obj;
  }).filter((o) => {
    const ok = String(o.name ?? '').trim() !== '';
    if (!ok) skipped += 1;
    return ok;
  });

  return { products: mergeProducts(raws.map((r) => normalizeProduct(r, meta))), mapped, skipped };
}

// JSON: รองรับทั้ง array ตรง ๆ และ { products: [...] } / { data: [...] }
export function productsFromJson(text, meta = {}) {
  const parsed = typeof text === 'string' ? JSON.parse(text) : text;
  const arr = Array.isArray(parsed) ? parsed : parsed?.products || parsed?.data || parsed?.items || [];
  const raws = arr.map((o) => {
    // ยอมรับทั้งคีย์มาตรฐานอยู่แล้ว และคีย์ชื่อแปลก ๆ (map ผ่านหัวคอลัมน์)
    const keys = Object.keys(o);
    const mapped = mapHeaders(keys);
    const out = {};
    Object.entries(mapped).forEach(([field, idx]) => { out[field] = o[keys[idx]]; });
    Object.keys(FIELD_ALIASES).forEach((f) => { if (o[f] !== undefined) out[f] = o[f]; });
    if (Array.isArray(o.rounds)) out.rounds = o.rounds;
    return out;
  });
  return { products: mergeProducts(raws.map((r) => normalizeProduct(r, meta))), skipped: 0 };
}

// ตัวช่วยสำหรับ UI: เดาชนิดไฟล์แล้วแปลงให้เลย (xlsx โหลดแบบ dynamic)
export async function parseProductFile(file) {
  const nameLower = (file?.name || '').toLowerCase();
  const meta = { source: file?.name || 'import', importedAt: new Date().toISOString() };

  if (nameLower.endsWith('.json')) return productsFromJson(await file.text(), meta);
  if (nameLower.endsWith('.xlsx') || nameLower.endsWith('.xls')) {
    const XLSX = await import('xlsx');
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
    return productsFromRows(rows, meta);
  }
  return productsFromRows(parseDelimited(await file.text()), meta);
}

// ส่งออก shortlist ไปยิงแอด (เปิดใน Excel ได้ตรง ๆ ด้วย BOM)
export function shortlistCsv(scoredList) {
  const head = ['เกรด', 'คะแนน', 'ชื่อสินค้า', 'ร้าน', 'หมวดหมู่', 'ราคา', 'ราคาเต็ม', 'ส่วนลด %', 'คอม/ชิ้น', 'รอบ', 'รอบเที่ยงคืน', 'เรตติ้ง', 'ขายแล้ว', 'ลิงก์'];
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = (scoredList || []).map((p) => [
    p.analysis?.grade, p.analysis?.score, p.name, p.shopName, p.categoryRaw || p.category,
    p.price, p.originalPrice, p.analysis?.metrics?.discountPct,
    p.analysis?.metrics?.commissionPerUnit, p.analysis?.metrics?.roundCount,
    p.analysis?.metrics?.hasMidnightRound ? 'มี' : '-', p.rating, p.sold, p.url,
  ].map(esc).join(','));
  return `﻿${[head.join(','), ...lines].join('\n')}`;
}
