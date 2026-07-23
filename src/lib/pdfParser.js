import { normalizeDate, monthKeyOf } from './format.js';

// --- PDF fee-document extraction (ported & modularized from the v4 tracker) ---
// Reads Shopee / TikTok / Thai Happy Logistics fee receipts and returns a
// normalized fee record. Fees feed the P&L as platform costs (incl. VAT).

const groupItemsByLine = (items) => {
  const sorted = [...items].sort((a, b) => {
    const yDiff = b.transform[5] - a.transform[5];
    if (Math.abs(yDiff) > 5) return yDiff;
    return a.transform[4] - b.transform[4];
  });

  const lines = [];
  let current = null;
  for (const item of sorted) {
    const str = item.str.trim();
    if (!str) continue;
    if (!current || Math.abs(item.transform[5] - current.y) > 5) {
      if (current) lines.push(current);
      current = { y: item.transform[5], text: str };
    } else {
      current.text += ' ' + str;
    }
  }
  if (current) lines.push(current);
  return lines;
};

const extractFromLines = (lines, keywords, strategy = 'right-most') => {
  for (const line of lines) {
    if (keywords.some((k) => line.text.toLowerCase().includes(k.toLowerCase()))) {
      const matches = line.text.matchAll(/B?([\d,]+\.\d{2})/g);
      const numbers = [];
      for (const m of matches) numbers.push(parseFloat(m[1].replace(/,/g, '')));
      if (!numbers.length) continue;
      if (strategy === 'right-most') return numbers[numbers.length - 1];
      if (strategy === 'left-most') return numbers[0];
      if (strategy === 'sum') return numbers.reduce((a, b) => a + b, 0);
    }
  }
  return 0;
};

const finalize = (rec) => ({
  ...rec,
  date: rec.date || '',
  monthKey: monthKeyOf(rec.date || ''),
});

const extractShopee = (lines, fullText, fileName) => {
  const idMatch = fullText.match(/TRSPEMKP\d+-\d+-\d+/);
  const id = idMatch ? idMatch[0] : `SHOPEE-${fileName}`;
  const dateMatch = fullText.match(/(\d{2}\/\d{2}\/\d{4})/);
  const date = dateMatch ? dateMatch[1] : '';

  const ads = extractFromLines(lines, ['Paid ads', 'ค่าโฆษณา'], 'right-most');
  const comm = extractFromLines(lines, ['Commission fee', 'ค่าคอมมิชชั่น'], 'right-most');
  const trans = extractFromLines(lines, ['Transaction fee', 'ค่าธรรมเนียมการทำธุรกรรม'], 'right-most');
  const service = extractFromLines(lines, ['Service fee', 'ค่าบริการ'], 'right-most');
  const ams = extractFromLines(lines, ['AMS Pay-Per-Sales', 'AMS'], 'right-most');
  const infra = extractFromLines(lines, ['Platform Infrastructure', 'ค่าโครงสร้างพื้นฐาน'], 'right-most');

  let vat = extractFromLines(lines, ['ภาษีมูลค่าเพิ่ม 7%', 'VAT 7%'], 'right-most');
  let total = extractFromLines(lines, ['รวมเงินทั้งสิ้น', 'Included VAT'], 'right-most');
  if (!total) {
    const subtotal = ads + comm + trans + service + ams + infra;
    total = subtotal * 1.07;
    if (!vat) vat = subtotal * 0.07;
  }

  const whtMatch = fullText.match(/จำนวนเงิน\s*([\d,]+\.\d{2})\s*บาท\s*แทนผู้จ่ายเงินได้/);
  const wht = whtMatch ? parseFloat(whtMatch[1].replace(/,/g, '')) : 0;

  return finalize({
    id, date, ads, comm, trans, service, ams, infra,
    growth: 0, affiliate: 0, logistics: 0, vat, wht, total, platform: 'shopee',
  });
};

const extractTikTok = (lines, fullText, isCreditNote) => {
  let date = '';
  const dateMatch = fullText.match(
    /(?:Receipt Date:|Invoice Date:|Invoice date:|Credit note date:)\s*([A-Za-z0-9,\s]+20\d{2})/
  );
  if (dateMatch) date = normalizeDate(dateMatch[1]);

  let id = 'Unknown';
  const idMatch = fullText.match(
    /(?:Receipt Number:|Invoice number:|Invoice No\.|Credit note number:)\s*([A-Z0-9]+)/
  );
  if (idMatch) id = idMatch[1];

  const mult = isCreditNote ? -1 : 1;
  const ads = extractFromLines(lines, ['Advertising Fees'], 'right-most');
  const affiliate = extractFromLines(lines, ['Creator commission'], 'right-most');
  const comm = extractFromLines(lines, ['Tik Tok Shop commission fee', 'Commission fee'], 'left-most');
  const trans = extractFromLines(lines, ['Transaction fee'], 'left-most');
  const growth = extractFromLines(lines, ['Commerce Growth Fee'], 'left-most');
  const infra = extractFromLines(lines, ['Infrastructure Fee'], 'left-most');
  const vat = extractFromLines(lines, ['Total VAT 7%', 'Tax Amount (VAT)', 'Total VAT @'], 'right-most');
  const total = extractFromLines(
    lines,
    ['Total Amount', 'Total amount (including VAT)', 'Net payable amount', 'Total Amount Due'],
    'right-most'
  );

  let wht = 0;
  const whtMatch = fullText.match(/withheld tax.*?amounting to B?([0-9,]+\.[0-9]{2})/);
  if (whtMatch) wht = parseFloat(whtMatch[1].replace(/,/g, ''));

  let subPlatform = 'tiktok';
  if (ads > 0) subPlatform = 'tiktok_ads';
  if (affiliate > 0) subPlatform = 'tiktok_affiliate';

  return finalize({
    id, date,
    ads: ads * mult, comm: comm * mult, trans: trans * mult,
    service: 0, ams: 0, infra: infra * mult, growth: growth * mult,
    affiliate: affiliate * mult, logistics: 0,
    vat: vat * mult, wht: wht * mult, total: total * mult,
    platform: 'tiktok', subPlatform,
  });
};

const extractThaiHappy = (lines, fullText) => {
  let date = '';
  const dateMatch = fullText.match(/Receipt date:\s*([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})/);
  if (dateMatch) date = normalizeDate(dateMatch[1]);

  let id = 'Unknown';
  const idMatch = fullText.match(/Receipt number:\s*(THJV\d+)/);
  if (idMatch) id = idMatch[1];

  const logistics = extractFromLines(lines, ['Logistics fee'], 'right-most');
  const total = extractFromLines(lines, ['Total Amount'], 'right-most');
  const vat = extractFromLines(lines, ['VAT 7%'], 'right-most');

  let wht = 0;
  const whtMatch = fullText.match(/withheld tax.*?amounting to B?([0-9,]+\.[0-9]{2})/);
  if (whtMatch) wht = parseFloat(whtMatch[1].replace(/,/g, ''));

  return finalize({
    id, date, ads: 0, comm: 0, trans: 0, service: 0, ams: 0, infra: 0,
    growth: 0, affiliate: 0, logistics, vat, wht, total,
    platform: 'tiktok', subPlatform: 'thai_happy',
  });
};

// Read one PDF File with a loaded pdf.js instance. Returns a status envelope.
export async function parsePdfFee(pdfjsLib, file) {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    let fullText = '';
    let allItems = [];
    const maxPages = Math.min(pdf.numPages, 2);
    for (let p = 1; p <= maxPages; p++) {
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      allItems = allItems.concat(tc.items);
      fullText += tc.items.map((it) => it.str).join(' ') + '\n';
      page.cleanup();
    }
    pdf.destroy();

    const lines = groupItemsByLine(allItems);
    let data = null;
    let label = '';

    if (
      fullText.includes('TikTok Shop') ||
      file.name.startsWith('TTSTH') ||
      file.name.startsWith('Prod_V2') ||
      file.name.includes('THTT') ||
      fullText.includes('Advertising Fees')
    ) {
      const isCreditNote = fullText.includes('CREDIT NOTE') || fullText.includes('Credit note');
      data = extractTikTok(lines, fullText, isCreditNote);
      label =
        data.subPlatform === 'tiktok_ads'
          ? 'TikTok Ads'
          : data.subPlatform === 'tiktok_affiliate'
          ? 'TikTok Aff'
          : 'TikTok Shop';
    } else if (fullText.includes('Shopee') || file.name.startsWith('Shopee')) {
      data = extractShopee(lines, fullText, file.name);
      label = 'Shopee';
    } else if (fullText.includes('Thai Happy Logistics') || file.name.startsWith('THJV')) {
      data = extractThaiHappy(lines, fullText);
      label = 'TikTok Log';
    } else {
      return { status: 'unknown', file: file.name, data: null };
    }

    return { status: 'success', file: file.name, platform: label, data };
  } catch (err) {
    return { status: 'error', file: file.name, message: err.message, data: null };
  }
}
