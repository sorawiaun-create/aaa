// ฟังก์ชันช่วยเหลือทั่วไป

// แปลงข้อความไทย/อังกฤษให้เป็นชื่อไฟล์/โฟลเดอร์ที่ปลอดภัย
export function slugify(text, max = 40) {
  const s = String(text)
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-') // อักษร/ตัวเลข (รวมไทย) นอกนั้นเป็น -
    .replace(/^-+|-+$/g, '')
    .slice(0, max);
  return s || 'campaign';
}

// escape ข้อความสำหรับใส่ใน HTML / SVG
export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ตัดบรรทัดข้อความยาว ๆ ให้พอดีความกว้าง (ใช้กับ SVG placeholder)
export function wrapLines(text, width = 42, maxLines = 12) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > width) {
      lines.push(cur.trim());
      cur = w;
    } else {
      cur = (cur + ' ' + w).trim();
    }
    if (lines.length >= maxLines) break;
  }
  if (cur && lines.length < maxLines) lines.push(cur.trim());
  return lines;
}

// อัตราส่วนภาพ -> ขนาดพิกเซล (สำหรับ SVG placeholder)
export function aspectToSize(aspectRatio = '1:1', base = 768) {
  const [w, h] = String(aspectRatio).split(':').map(Number);
  if (!w || !h) return { width: base, height: base };
  if (w >= h) return { width: base, height: Math.round((base * h) / w) };
  return { width: Math.round((base * w) / h), height: base };
}
