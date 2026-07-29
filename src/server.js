import http from 'node:http';
import fs from 'node:fs';

// ============================================================================
//  หน้าตั้งค่า API (Settings) — เปิดในเบราว์เซอร์ กรอก key แล้วบันทึกลง .env
//  รัน:  node src/server.js   แล้วเปิด http://localhost:4321
// ============================================================================

const ENV_FILE = '.env';
const PORT = 4321;

// รายการ key ที่กรอกได้ (แบ่งเป็นกลุ่ม)
const FIELDS = [
  { group: '🧠 สมองของระบบ (จำเป็น)', items: [
    { key: 'ANTHROPIC_API_KEY', label: 'Anthropic API Key', hint: 'สมองที่คิด/เขียนคอนเทนต์ (Claude)', link: 'https://console.anthropic.com/settings/keys', secret: true, required: true },
  ]},
  { group: '🎨 สร้างภาพ / วิดีโอ (ไม่ใส่ก็ได้ — จะใช้ไฟล์ตัวอย่างแทน)', items: [
    { key: 'IMAGE_PROVIDER', label: 'เปิดใช้เจนภาพ/วิดีโอจริง (Replicate)', type: 'toggle', on: 'replicate', off: 'placeholder', pair: 'VIDEO_PROVIDER' },
    { key: 'REPLICATE_API_TOKEN', label: 'Replicate API Token', hint: 'ใช้เจนภาพ (FLUX) และวิดีโอ', link: 'https://replicate.com/account/api-tokens', secret: true },
  ]},
  { group: '📤 เผยแพร่อัตโนมัติ (โพสต์ขึ้นแพลตฟอร์ม)', items: [
    { key: 'PUBLISH_LIVE', label: 'โพสต์จริง (ปิด = โหมดซ้อม ไม่โพสต์จริง)', type: 'toggle', on: 'true', off: '' },
    { key: 'AUTO_PUBLISH', label: 'โพสต์ทันทีหลังผลิตคอนเทนต์เสร็จ', type: 'toggle', on: 'true', off: '' },
  ]},
  { group: '📘 Facebook Page', items: [
    { key: 'FB_PAGE_ID', label: 'Page ID', hint: 'ไอดีเพจ', link: 'https://developers.facebook.com/apps' },
    { key: 'FB_PAGE_TOKEN', label: 'Page Access Token', hint: 'สิทธิ์ pages_manage_posts', secret: true },
  ]},
  { group: '📷 Instagram (Business/Creator)', items: [
    { key: 'IG_USER_ID', label: 'IG User ID' },
    { key: 'IG_TOKEN', label: 'Access Token', secret: true },
    { key: 'MEDIA_BASE_URL', label: 'URL สื่อสาธารณะ', hint: 'IG ต้องดึงสื่อจาก URL (เช่น https://โดเมนคุณ/assets)' },
  ]},
  { group: '🎵 TikTok', items: [
    { key: 'TIKTOK_TOKEN', label: 'Access Token', hint: 'scope video.publish · แอปต้องผ่าน app review', link: 'https://developers.tiktok.com/', secret: true },
  ]},
];

const ALL_KEYS = FIELDS.flatMap((g) => g.items.flatMap((i) => (i.pair ? [i.key, i.pair] : [i.key])));

function parseEnv() {
  const env = {};
  try {
    for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    /* ยังไม่มี .env */
  }
  return env;
}

function writeEnv(next) {
  const existing = parseEnv();
  const merged = { ...existing, ...next };
  let out = '# ตั้งค่าโดยหน้า Settings (http://localhost:' + PORT + ')\n';
  for (const k of ALL_KEYS) if (merged[k] !== undefined) out += `${k}=${merged[k]}\n`;
  // เก็บ key อื่น ๆ ที่มีอยู่เดิมไว้ด้วย
  for (const k of Object.keys(existing)) if (!ALL_KEYS.includes(k)) out += `${k}=${existing[k]}\n`;
  fs.writeFileSync(ENV_FILE, out);
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function renderField(item, env) {
  const val = env[item.key] || '';
  if (item.type === 'toggle') {
    const checked = val && val === item.on ? 'checked' : '';
    return `<label class="row toggle">
      <span class="lab">${item.label}</span>
      <input type="checkbox" name="${item.key}" data-on="${esc(item.on)}" data-off="${esc(item.off)}" data-pair="${item.pair || ''}" ${checked}/>
      <span class="switch"></span>
    </label>`;
  }
  const set = val ? '<span class="ok">● ตั้งแล้ว</span>' : '<span class="no">○ ยังไม่ตั้ง</span>';
  const linkHtml = item.link ? ` · <a href="${item.link}" target="_blank" rel="noopener">ขอ key ที่นี่ ↗</a>` : '';
  return `<div class="row">
    <div class="lab">${item.label}${item.required ? ' <b class="req">*</b>' : ''} ${set}</div>
    <div class="inp">
      <input type="${item.secret ? 'password' : 'text'}" name="${item.key}" value="${esc(val)}" placeholder="${item.secret ? 'วาง token ที่นี่' : ''}" autocomplete="off"/>
      ${item.secret ? '<button type="button" class="eye" aria-label="แสดง/ซ่อน">👁</button>' : ''}
    </div>
    ${item.hint || item.link ? `<div class="hint">${item.hint || ''}${linkHtml}</div>` : ''}
  </div>`;
}

function renderPage(env, saved) {
  const groups = FIELDS.map((g) => `<section class="card"><h2>${g.group}</h2>${g.items.map((i) => renderField(i, env)).join('')}</section>`).join('');
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/><title>ตั้งค่า API · ศูนย์บัญชาการ AI</title>
<style>
:root{--bg:#0B111C;--card:#151E30;--line:#26324A;--ink:#E7EEFA;--muted:#8593AC;--faint:#5A6884;--green:#38E08A;--brand:#FF6B4D;--blue:#4C9AFF;
--font:ui-sans-serif,"Segoe UI","Noto Sans Thai",system-ui,sans-serif;--mono:ui-monospace,"SF Mono",monospace;}
*{box-sizing:border-box;}body{margin:0;font-family:var(--font);color:var(--ink);
background:radial-gradient(1000px 500px at 50% -10%,#14203a,transparent 60%),var(--bg);min-height:100vh;}
.wrap{max-width:680px;margin:0 auto;padding:26px 18px 60px;}
h1{font-size:1.5rem;margin:0 0 2px;}.sub{color:var(--faint);font-size:.85rem;margin-bottom:18px;}
.card{background:linear-gradient(180deg,var(--card),#0f1728);border:1px solid var(--line);border-radius:16px;padding:16px 18px;margin-bottom:14px;box-shadow:0 10px 30px -18px #000;}
.card h2{font-size:.95rem;margin:0 0 12px;}
.row{margin-bottom:14px;}.row:last-child{margin-bottom:0;}
.lab{font-size:.85rem;font-weight:600;margin-bottom:6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.req{color:var(--brand);}
.ok{font-size:.68rem;color:var(--green);font-weight:600;}.no{font-size:.68rem;color:var(--faint);}
.inp{display:flex;gap:6px;}
input[type=text],input[type=password]{flex:1;background:#0b1220;border:1px solid var(--line);color:var(--ink);
border-radius:9px;padding:10px 12px;font-family:var(--mono);font-size:.82rem;}
input:focus{outline:2px solid var(--blue);outline-offset:0;border-color:var(--blue);}
.eye{background:#182238;border:1px solid var(--line);border-radius:9px;color:var(--ink);cursor:pointer;padding:0 12px;}
.hint{font-size:.72rem;color:var(--faint);margin-top:5px;}.hint a{color:var(--blue);}
.toggle{display:flex;align-items:center;gap:12px;cursor:pointer;}
.toggle .lab{flex:1;margin:0;font-weight:500;}
.toggle input{display:none;}
.switch{width:44px;height:24px;border-radius:99px;background:#2a3346;position:relative;transition:.2s;flex:none;}
.switch::after{content:"";position:absolute;top:2px;left:2px;width:20px;height:20px;border-radius:50%;background:#fff;transition:.2s;}
.toggle input:checked + .switch{background:var(--green);}
.toggle input:checked + .switch::after{transform:translateX(20px);}
.bar{position:sticky;bottom:0;display:flex;gap:12px;align-items:center;padding:14px 0;}
.save{background:var(--green);color:#0b111c;border:none;border-radius:11px;padding:12px 22px;font-weight:700;font-size:.92rem;cursor:pointer;font-family:var(--font);}
.save:focus-visible{outline:2px solid #fff;outline-offset:2px;}
.next{color:var(--muted);font-size:.8rem;}.next code{background:#0b1220;border:1px solid var(--line);padding:2px 7px;border-radius:6px;font-size:.76rem;}
.toast{position:fixed;top:16px;left:50%;transform:translateX(-50%);background:var(--green);color:#0b111c;font-weight:700;
padding:10px 18px;border-radius:11px;box-shadow:0 8px 24px -6px var(--green);animation:pop .3s;}
@keyframes pop{from{opacity:0;transform:translate(-50%,-8px)}to{opacity:1;transform:translate(-50%,0)}}
</style></head><body>
${saved ? '<div class="toast" id="toast">✅ บันทึกแล้ว</div>' : ''}
<div class="wrap">
  <h1>⚙️ ตั้งค่า API</h1>
  <div class="sub">กรอก key ของแต่ละ AI และแต่ละแพลตฟอร์ม แล้วกดบันทึก — ระบบจะเซฟลงไฟล์ <code>.env</code> ให้อัตโนมัติ</div>
  <form method="POST" action="/save">
    ${groups}
    <div class="bar">
      <button class="save" type="submit">💾 บันทึกการตั้งค่า</button>
      <span class="next">บันทึกเสร็จแล้วรัน &nbsp;<code>node src/index.js "โจทย์ของคุณ"</code></span>
    </div>
  </form>
</div>
<script>
  // ปุ่มแสดง/ซ่อน token
  document.querySelectorAll('.eye').forEach(function(b){b.addEventListener('click',function(){
    var i=b.parentElement.querySelector('input');i.type=i.type==='password'?'text':'password';});});
  // toggle: เปลี่ยนค่า on/off ตอน submit (และซิงก์ตัวคู่ image/video)
  document.querySelector('form').addEventListener('submit',function(){
    document.querySelectorAll('input[type=checkbox]').forEach(function(c){
      var v=c.checked?c.dataset.on:c.dataset.off;
      addHidden(c.name,v);
      if(c.dataset.pair) addHidden(c.dataset.pair,v);
      c.disabled=true;
    });
  });
  function addHidden(name,val){var h=document.createElement('input');h.type='hidden';h.name=name;h.value=val;document.querySelector('form').appendChild(h);}
  var t=document.getElementById('toast');if(t)setTimeout(function(){t.remove();},2200);
</script>
</body></html>`;
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url.startsWith('/')) {
    const saved = req.url.includes('saved=1');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderPage(parseEnv(), saved));
    return;
  }
  if (req.method === 'POST' && req.url === '/save') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const params = new URLSearchParams(body);
      const next = {};
      for (const k of ALL_KEYS) if (params.has(k)) next[k] = params.get(k).trim();
      writeEnv(next);
      res.writeHead(303, { Location: '/?saved=1' });
      res.end();
    });
    return;
  }
  res.writeHead(404);
  res.end('not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n⚙️  หน้าตั้งค่า API เปิดแล้ว — เปิดเบราว์เซอร์ไปที่:\n`);
  console.log(`      http://localhost:${PORT}\n`);
  console.log('   กรอก key แล้วกดบันทึก · เสร็จแล้วปิดหน้านี้ (Ctrl+C) แล้วรัน node src/index.js\n');
});
