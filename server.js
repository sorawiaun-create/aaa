/* =============================================================================
   COD Checker — SPX proxy server  (Node.js, ไม่มี dependency ภายนอก)
   -----------------------------------------------------------------------------
   ทำหน้าที่:
     1) เสิร์ฟหน้าเว็บ cod-checker.html  (เปิดที่ http://localhost:3000)
     2) เป็นตัวกลาง (proxy) ยิงเข้า SPX API ฝั่งเซิร์ฟเวอร์ + เซ็นลายเซ็นด้วย
        Secret Key ที่เก็บใน .env  → เบราว์เซอร์ไม่เห็น secret และไม่ติด CORS
     3) แปลงผลลัพธ์ให้เป็น { data: [...] } ให้หน้าเว็บ auto-map คอลัมน์เอง

   รัน:  node server.js       (อ่านค่าจาก .env)
   โหมดทดสอบ:  ตั้ง SPX_MOCK=1 ใน .env → คืนข้อมูลจำลอง ไม่ยิง SPX จริง
   ============================================================================= */
'use strict';
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// ---------- โหลด .env แบบง่าย (ไม่ต้องพึ่ง dotenv) ----------
function loadEnv() {
  const p = path.join(__dirname, '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv();

const CFG = {
  port: +(process.env.PORT || 3000),
  userId: process.env.SPX_USER_ID || '',
  secret: process.env.SPX_SECRET_KEY || '',
  accountId: process.env.SPX_ACCOUNT_ID || '',
  baseUrl: process.env.SPX_BASE_URL || 'https://openapi.spx.co.th',
  codPath: process.env.SPX_COD_PATH || '/api/v1/cod/order/list',
  signMethod: process.env.SPX_SIGN_METHOD || 'hmac_sha256_hex',
  mock: process.env.SPX_MOCK === '1',
};

// ---------- ลายเซ็น (ปรับให้ตรงกับ "เอกสาร API" ของ SPX) ----------
// รูปแบบทั่วไป: sign = HMAC-SHA256(secret, baseString)
// baseString ตรงนี้เป็น "ค่าเริ่มต้นแบบเดา" — เมื่อได้เอกสารจริงให้แก้บรรทัด baseString
function signSpx(pathname, timestamp, bodyStr) {
  const baseString = `${CFG.userId}${CFG.accountId}${pathname}${timestamp}${bodyStr || ''}`;
  const h = crypto.createHmac('sha256', CFG.secret).update(baseString);
  return CFG.signMethod === 'hmac_sha256_base64' ? h.digest('base64') : h.digest('hex');
}

// ---------- ยิง SPX จริง ----------
async function callSpx(query) {
  const ts = Math.floor(Date.now() / 1000);
  const u = new URL(CFG.baseUrl + CFG.codPath);
  if (query.from) u.searchParams.set('start_time', query.from);
  if (query.to)   u.searchParams.set('end_time', query.to);
  u.searchParams.set('account_id', CFG.accountId);

  const sign = signSpx(u.pathname, ts, '');
  const headers = {
    'Content-Type': 'application/json',
    // ชื่อ header ด้านล่างเป็นค่าเริ่มต้นแบบเดา — ปรับตามเอกสาร SPX
    'user-id': CFG.userId,
    'account-id': CFG.accountId,
    'timestamp': String(ts),
    'sign': sign,
    'Authorization': sign,
  };

  const raw = await httpsGet(u.toString(), headers);
  let json;
  try { json = JSON.parse(raw); }
  catch { throw new Error('SPX ตอบกลับไม่ใช่ JSON: ' + raw.slice(0, 300)); }

  // ดึง array ออกมาจากทุกทรงที่พบบ่อย
  const arr = json.data?.list || json.data?.orders || json.data?.records ||
              (Array.isArray(json.data) ? json.data : null) ||
              json.list || json.orders || (Array.isArray(json) ? json : null);
  if (!Array.isArray(arr)) {
    throw new Error('หา array ของออเดอร์ใน response ไม่เจอ — โครง response: ' + JSON.stringify(json).slice(0, 300));
  }
  return arr;
}

function httpsGet(urlStr, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request(u, { method: 'GET', headers, timeout: 20000 }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        if (res.statusCode >= 400) reject(new Error(`SPX HTTP ${res.statusCode}: ${body.slice(0, 300)}`));
        else resolve(body);
      });
    });
    req.on('timeout', () => req.destroy(new Error('SPX timeout (20s)')));
    req.on('error', reject);
    req.end();
  });
}

// ---------- ข้อมูลจำลองสำหรับโหมด mock ----------
function mockData() {
  const d = (off) => { const x = new Date(); x.setDate(x.getDate() - off); return x.toISOString().slice(0, 10); };
  return [
    { tracking_no:'SPX250700001', cod_amount:590,  order_status:'ส่งสำเร็จ',   delivered_time:d(12), paid_amount:590,  order_sn:'A-1001' },
    { tracking_no:'SPX250700002', cod_amount:1290, order_status:'ส่งสำเร็จ',   delivered_time:d(10), paid_amount:1000, order_sn:'A-1002' }, // เข้าไม่ครบ
    { tracking_no:'SPX250700003', cod_amount:450,  order_status:'ส่งสำเร็จ',   delivered_time:d(9),  paid_amount:0,    order_sn:'A-1003' }, // รอเงินเกินกำหนด
    { tracking_no:'SPX250700004', cod_amount:880,  order_status:'ส่งสำเร็จ',   delivered_time:d(2),  paid_amount:0,    order_sn:'A-1004' }, // รอเงิน (ยังไม่ครบกำหนด)
    { tracking_no:'SPX250700005', cod_amount:2350, order_status:'ตีกลับ',      delivered_time:'',    paid_amount:2350, order_sn:'A-1005' }, // ตีกลับแต่มีเงินเข้า
    { tracking_no:'SPX250700006', cod_amount:320,  order_status:'กำลังจัดส่ง', delivered_time:'',    paid_amount:0,    order_sn:'A-1006' },
    { tracking_no:'SPX250700007', cod_amount:760,  order_status:'ส่งสำเร็จ',   delivered_time:d(6),  paid_amount:760,  order_sn:'A-1007' },
  ];
}

// ---------- HTTP server ----------
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css', '.json':'application/json' };

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${CFG.port}`);
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type':'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };

  // ---- API: ดึง COD จาก SPX ----
  if (u.pathname === '/api/spx/cod') {
    try {
      const query = { from: u.searchParams.get('from'), to: u.searchParams.get('to') };
      const data = CFG.mock ? mockData() : await callSpx(query);
      return send(200, { ok: true, mock: CFG.mock, count: data.length, data });
    } catch (e) {
      return send(502, { ok: false, error: e.message });
    }
  }

  if (u.pathname === '/api/health') {
    return send(200, { ok:true, mock:CFG.mock, hasCreds: !!(CFG.userId && CFG.secret), baseUrl: CFG.baseUrl, codPath: CFG.codPath });
  }

  // ---- เสิร์ฟไฟล์ static (หน้าเว็บ) ----
  let file = u.pathname === '/' ? '/cod-checker.html' : u.pathname;
  const abs = path.join(__dirname, path.normalize(file).replace(/^(\.\.[\/\\])+/, ''));
  fs.readFile(abs, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(abs)] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(CFG.port, () => {
  console.log('──────────────────────────────────────────────');
  console.log('  COD Checker + SPX proxy');
  console.log('  เปิดที่:  http://localhost:' + CFG.port);
  console.log('  โหมด:    ' + (CFG.mock ? 'MOCK (ข้อมูลจำลอง)' : 'LIVE → ' + CFG.baseUrl + CFG.codPath));
  console.log('  เครดิต:  user=' + (CFG.userId ? CFG.userId.slice(0,4)+'…' : '(ยังไม่ตั้ง)') + '  account=' + (CFG.accountId || '(ยังไม่ตั้ง)'));
  console.log('──────────────────────────────────────────────');
});
