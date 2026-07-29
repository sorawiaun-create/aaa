import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createCampaignDir, buildHtmlPreview } from './output.js';
import { savePostsManifest } from './publisher/index.js';
import { generateImage, generateVideo } from './providers/media.js';
import { brainReady } from './brain.js';

// ============================================================================
//  เว็บแอปควบคุมครบจบในที่เดียว (Studio + Settings)
//  รัน:  node src/server.js   แล้วเปิด http://localhost:4321
//   - หน้า Studio: พิมพ์โจทย์ → กดผลิต → เห็นห้องทำงานสด → กดเผยแพร่
//   - หน้า Settings: กรอก API key ของแต่ละ AI และแต่ละแพลตฟอร์ม
// ============================================================================

const ENV_FILE = '.env';
const PORT = Number(process.env.PORT) || 4321;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadDotenv() {
  try {
    for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    /* ยังไม่มี .env */
  }
}
loadDotenv();

// ---------- ข้อมูลแผนก (ไว้วาดห้องในหน้า Studio) ----------
const DEPTS = [
  { key: 'strategy', name: 'วางแผนกลยุทธ์', icon: '🧭', shirt: '#FF6B4D', hair: '#2b2019', skin: '#F4C9A0', say: '💡' },
  { key: 'trend', name: 'เทรนด์ & แฮชแท็ก', icon: '🔥', shirt: '#F5B23D', hair: '#1c2733', skin: '#E8B48C', say: '🔥' },
  { key: 'copywriting', name: 'เขียนบท & แคปชั่น', icon: '✍️', shirt: '#4C9AFF', hair: '#3a2a22', skin: '#F4C9A0', say: '✏️' },
  { key: 'visual', name: 'ภาพ & กราฟิก', icon: '🎨', shirt: '#B76CFF', hair: '#241a2e', skin: '#EFC199', say: '🖼️' },
  { key: 'video', name: 'วิดีโอ', icon: '🎥', shirt: '#FE5A78', hair: '#20262f', skin: '#F4C9A0', say: '🎬' },
  { key: 'influencer', name: 'อินฟลูเอนเซอร์', icon: '🤝', shirt: '#2FD3B8', hair: '#2b2019', skin: '#E8B48C', say: '⭐' },
  { key: 'paid_ads', name: 'ยิงแอด', icon: '📢', shirt: '#FF8A3D', hair: '#1c2733', skin: '#F4C9A0', say: '📈' },
  { key: 'platform', name: 'จัดโพสต์', icon: '📱', shirt: '#5B7CFF', hair: '#3a2a22', skin: '#EFC199', say: '📤' },
  { key: 'brand_qa', name: 'ตรวจแบรนด์ & QA', icon: '✅', shirt: '#38E08A', hair: '#22303f', skin: '#F4C9A0', say: '👍' },
];

// ---------- Settings fields ----------
const FIELDS = [
  { group: '🧠 สมองของระบบ (เลือก 1 เจ้า)', items: [
    { key: 'BRAIN_PROVIDER', label: 'ใช้สมองของเจ้าไหน', type: 'select', options: [['anthropic', 'Claude (Anthropic)'], ['openai', 'OpenAI / ChatGPT']] },
    { key: 'ANTHROPIC_API_KEY', label: 'Anthropic API Key', hint: 'กรอกถ้าเลือก Claude · เอาจาก console.anthropic.com (ไม่ใช่ claude.ai)', link: 'https://console.anthropic.com/settings/keys', secret: true },
  ]},
  { group: '🎨 สร้างภาพ / วิดีโอ (ไม่ใส่ก็ได้ — จะใช้ไฟล์ตัวอย่างแทน)', items: [
    { key: 'IMAGE_PROVIDER', label: 'ใช้อะไรสร้างภาพ', type: 'select', options: [['placeholder', 'ไฟล์ตัวอย่าง (ฟรี ไม่ต้องมี key)'], ['openai', 'OpenAI / ChatGPT (gpt-image-1)'], ['replicate', 'Replicate (FLUX)']] },
    { key: 'OPENAI_API_KEY', label: 'OpenAI API Key', hint: 'คีย์เดียวใช้ได้ทั้งสร้างภาพ (gpt-image-1) และเป็นสมองระบบ (ถ้าเลือก OpenAI) · จาก platform.openai.com', link: 'https://platform.openai.com/api-keys', secret: true },
    { key: 'VIDEO_PROVIDER', label: 'ใช้อะไรสร้างวิดีโอ', type: 'select', options: [['placeholder', 'บรีฟตัวอย่าง (ฟรี)'], ['replicate', 'Replicate']] },
    { key: 'REPLICATE_API_TOKEN', label: 'Replicate API Token', hint: 'สำหรับ FLUX (ภาพ) และวิดีโอ (เลือก Replicate ด้านบน)', link: 'https://replicate.com/account/api-tokens', secret: true },
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

export function parseEnv() {
  const env = {};
  try {
    for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    /* no .env */
  }
  return env;
}
function writeEnv(next) {
  const existing = parseEnv();
  const merged = { ...existing, ...next };
  let out = '# ตั้งค่าโดยหน้า Settings (http://localhost:' + PORT + ')\n';
  for (const k of ALL_KEYS) if (merged[k] !== undefined) out += `${k}=${merged[k]}\n`;
  for (const k of Object.keys(existing)) if (!ALL_KEYS.includes(k)) out += `${k}=${existing[k]}\n`;
  fs.writeFileSync(ENV_FILE, out);
  for (const [k, v] of Object.entries(next)) process.env[k] = v; // ให้มีผลกับโปรเซสนี้ทันที
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// ============================================================================
//  CSS (ธีมห้องคอนโทรลกลางคืน) ใช้ร่วมกันทั้งสองหน้า
// ============================================================================
const THEME = `
:root{--bg:#0B111C;--card:#151E30;--line:#26324A;--ink:#E7EEFA;--muted:#8593AC;--faint:#5A6884;
--green:#38E08A;--amber:#F5B23D;--blue:#4C9AFF;--brand:#FF6B4D;
--font:ui-sans-serif,"Segoe UI","Noto Sans Thai",system-ui,sans-serif;--mono:ui-monospace,"SF Mono","Cascadia Code",monospace;}
*{box-sizing:border-box;}body{margin:0;font-family:var(--font);color:var(--ink);min-height:100vh;-webkit-font-smoothing:antialiased;
background:radial-gradient(1100px 560px at 50% -10%,#14203a,transparent 60%),radial-gradient(700px 400px at 90% 0,#1a1330,transparent 55%),var(--bg);}
.wrap{max-width:960px;margin:0 auto;padding:16px 18px 60px;}
.nav{display:flex;align-items:center;gap:14px;background:linear-gradient(180deg,#141d2fcc,#0f1626cc);border:1px solid var(--line);
border-radius:14px;padding:11px 16px;margin-bottom:16px;box-shadow:0 10px 30px -18px #000;}
.nav .logo{width:34px;height:34px;border-radius:9px;background:linear-gradient(140deg,var(--brand),var(--blue));display:grid;place-items:center;color:#fff;}
.nav b{font-size:.98rem;}.nav .sp{flex:1;}
.nav a{color:var(--muted);text-decoration:none;font-size:.86rem;padding:7px 12px;border-radius:9px;border:1px solid transparent;}
.nav a.on{color:var(--ink);background:#182238;border-color:var(--line);}
.nav a:hover{color:var(--ink);}
.card{background:linear-gradient(180deg,var(--card),#0f1728);border:1px solid var(--line);border-radius:16px;padding:16px 18px;margin-bottom:14px;box-shadow:0 10px 30px -18px #000;}
.card h2{font-size:.95rem;margin:0 0 12px;}
.btn{font-family:var(--font);font-weight:700;color:#0b111c;cursor:pointer;background:var(--green);border:none;border-radius:11px;padding:11px 20px;font-size:.9rem;}
.btn:disabled{opacity:.5;cursor:not-allowed;}
.btn.ghost{background:#182238;color:var(--ink);border:1px solid var(--line);}
.btn:focus-visible{outline:2px solid #fff;outline-offset:2px;}
`;

const ROOMCSS = `
.rooms{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;}
@media(max-width:760px){.rooms{grid-template-columns:repeat(2,1fr);}}
@media(max-width:480px){.rooms{grid-template-columns:1fr;}}
.room{position:relative;border-radius:14px;padding:10px 11px 0;overflow:hidden;min-height:150px;display:flex;flex-direction:column;
background:linear-gradient(180deg,#151E30,#0f1728);border:1px solid var(--line);transition:.25s;}
.room .top{display:flex;align-items:center;gap:8px;z-index:3;}
.room .ric{width:26px;height:26px;border-radius:7px;display:grid;place-items:center;font-size:13px;background:#0e1727;border:1px solid var(--line);}
.room .rname{font-size:.76rem;font-weight:650;line-height:1.15;}
.room .light{margin-left:auto;width:11px;height:11px;border-radius:50%;background:#2a3346;}
.room .st{font-family:var(--mono);font-size:.58rem;letter-spacing:.1em;text-transform:uppercase;color:var(--faint);margin-top:5px;}
.stage{position:relative;flex:1;margin:6px -11px 0;}
.floorline{position:absolute;left:0;right:0;bottom:16px;height:1px;background:linear-gradient(90deg,transparent,#26324a,transparent);}
.worker{position:absolute;bottom:14px;left:10px;z-index:2;}.pace{display:inline-block;}
.char{position:relative;width:26px;height:38px;display:block;}
.head{position:absolute;top:0;left:3px;width:20px;height:18px;border-radius:50% 50% 46% 46%;background:var(--skin);}
.hair{position:absolute;top:-2px;left:2px;width:22px;height:10px;border-radius:11px 11px 4px 4px;background:var(--hair);}
.eye{position:absolute;top:8px;width:3px;height:3px;border-radius:50%;background:#1b2330;}.eye.l{left:8px;}.eye.r{left:14px;}
.torso{position:absolute;top:15px;left:4px;width:18px;height:15px;border-radius:8px 8px 6px 6px;background:var(--shirt);}
.arm{position:absolute;top:17px;width:5px;height:12px;border-radius:3px;background:var(--shirt);transform-origin:top center;}
.arm.l{left:1px;}.arm.r{left:21px;}
.leg{position:absolute;bottom:0;width:5px;height:10px;border-radius:0 0 3px 3px;background:#28324a;transform-origin:top center;}
.leg.l{left:7px;}.leg.r{left:15px;}
.bubble{position:absolute;top:-4px;left:30px;font-size:13px;opacity:0;transition:.3s;}
.room.idle .worker{opacity:.35;}
.room.working{border-color:#38e08a66;box-shadow:0 0 0 1px #38e08a55,0 0 26px -6px #38e08a55;transform:translateY(-2px);}
.room.working .light{background:var(--green);box-shadow:0 0 10px var(--green);animation:blink 1.1s infinite;}
.room.working .st{color:var(--green);}
.room.working .char{animation:bob .42s ease-in-out infinite alternate;}
.room.working .leg.l{animation:swing .42s ease-in-out infinite alternate;}
.room.working .leg.r{animation:swing .42s ease-in-out infinite alternate-reverse;}
.room.working .arm.l{animation:swing .42s ease-in-out infinite alternate-reverse;}
.room.working .arm.r{animation:swing .42s ease-in-out infinite alternate;}
.room.working .pace{animation:pace 4s ease-in-out infinite alternate;}
.room.working .face{display:inline-block;animation:face 8s steps(1) infinite;}
.room.working .bubble{opacity:1;animation:float 1.6s ease-in-out infinite;}
.room.done{border-color:#4c9aff40;}.room.done .light{background:var(--blue);box-shadow:0 0 8px var(--blue);}
.room.done .st{color:var(--blue);}.room.done .worker{opacity:.42;}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.35}}
@keyframes bob{from{transform:translateY(0)}to{transform:translateY(-3px)}}
@keyframes swing{from{transform:rotate(28deg)}to{transform:rotate(-28deg)}}
@keyframes pace{0%{transform:translateX(0)}100%{transform:translateX(95px)}}
@keyframes face{0%,49.9%{transform:scaleX(1)}50%,100%{transform:scaleX(-1)}}
@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
@media(prefers-reduced-motion:reduce){*{animation:none!important;}}
`;

function nav(active) {
  const link = (href, label, key) => `<a href="${href}" class="${active === key ? 'on' : ''}">${label}</a>`;
  return `<div class="nav"><div class="logo">◆</div><b>ศูนย์บัญชาการ AI</b><div class="sp"></div>
    ${link('/', '🎬 ผลิตคอนเทนต์', 'studio')}${link('/settings', '⚙️ ตั้งค่า API', 'settings')}</div>`;
}

// ============================================================================
//  หน้า Studio
// ============================================================================
function renderStudio(env) {
  const hasKey = brainReady();
  const roomEls = DEPTS.map((d) => `
    <div class="room idle" data-key="${d.key}" style="--skin:${d.skin};--hair:${d.hair};--shirt:${d.shirt}">
      <div class="top"><div class="ric">${d.icon}</div><div class="rname">${d.name}</div><div class="light"></div></div>
      <div class="st">รอเริ่ม</div>
      <div class="stage"><div class="floorline"></div>
        <div class="worker"><span class="pace"><span class="face"><span class="char">
          <span class="bubble">${d.say}</span><span class="hair"></span><span class="head"><i class="eye l"></i><i class="eye r"></i></span>
          <span class="torso"></span><span class="arm l"></span><span class="arm r"></span><span class="leg l"></span><span class="leg r"></span>
        </span></span></span></div>
      </div>
    </div>`).join('');

  return `<!doctype html><html lang="th"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/><title>ผลิตคอนเทนต์ · ศูนย์บัญชาการ AI</title>
<style>${THEME}${ROOMCSS}
textarea{width:100%;min-height:80px;background:#0b1220;border:1px solid var(--line);color:var(--ink);border-radius:11px;padding:12px 14px;font-family:var(--font);font-size:.92rem;resize:vertical;}
textarea:focus{outline:2px solid var(--blue);border-color:var(--blue);}
.runbar{display:flex;gap:12px;align-items:center;margin-top:12px;flex-wrap:wrap;}
.status{font-family:var(--mono);font-size:.82rem;color:var(--muted);}
.warn{background:#f5b23d1a;border:1px solid #f5b23d44;color:#ffd98a;padding:10px 14px;border-radius:11px;font-size:.84rem;margin-bottom:12px;}
.result{display:none;}.result.show{display:block;}
.result .links{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;}
.pubres{font-family:var(--mono);font-size:.82rem;}
.pubres div{padding:6px 0;border-bottom:1px solid var(--line);}
.pill{font-family:var(--mono);font-size:.66rem;padding:2px 8px;border-radius:6px;}
.pill.live{background:#db43351a;color:#ff8a7d;border:1px solid #db433544;}
.pill.dry{background:#4c9aff1a;color:#8fbcff;border:1px solid #4c9aff44;}
</style></head><body>
<div class="wrap">
  ${nav('studio')}
  ${hasKey ? '' : '<div class="warn">⚠️ ยังไม่ได้ตั้งค่าสมอง (Claude หรือ OpenAI) — กดได้เลยเพื่อดู <b>โหมดสาธิต</b> (ใช้ภาพตัวอย่าง) · ไป <a href="/settings" style="color:#ffd98a">⚙️ ตั้งค่า API</a> เพื่อผลิตด้วย AI จริง</div>'}
  <div class="card">
    <h2>🎬 พิมพ์โจทย์แคมเปญ แล้วกดผลิต</h2>
    <textarea id="brief" placeholder="เช่น: เปิดตัวครีมกันแดดตัวใหม่ ลง TikTok, Instagram, Facebook กลุ่มผู้หญิง 18-30 โทนสนุกสดใส">เปิดตัวครีมกันแดด GlowShield SPF50+ ลง TikTok, Instagram และ Facebook กลุ่มผู้หญิง 18-30 โทนสนุกสดใส</textarea>
    <div class="runbar">
      <button class="btn" id="run">🎬 ผลิตคอนเทนต์</button>
      <span class="status" id="status">พร้อมเริ่ม</span>
    </div>
  </div>

  <div class="card"><h2>🏢 ห้องทำงาน (แต่ละแผนก)</h2><div class="rooms" id="rooms">${roomEls}</div></div>

  <div class="card result" id="result">
    <h2>📦 เสร็จแล้ว</h2>
    <div class="links">
      <a class="btn ghost" id="dashLink" target="_blank">🖥️ เปิดแดชบอร์ดแคมเปญ</a>
      <button class="btn" id="pub">📤 เผยแพร่ทุกแพลตฟอร์ม</button>
    </div>
    <div class="pubres" id="pubres"></div>
  </div>
</div>
<script>
const DEPTS=${JSON.stringify(DEPTS.map((d) => ({ key: d.key, name: d.name })))};
const rooms={};document.querySelectorAll('.room').forEach(function(el){rooms[el.dataset.key]=el;});
const statusEl=document.getElementById('status');
const runBtn=document.getElementById('run');
const resultEl=document.getElementById('result');
let currentDir=null;

function setRoom(key,cls,txt){var el=rooms[key];if(!el)return;el.classList.remove('idle','working','done');el.classList.add(cls);
  var s=el.querySelector('.st');if(s)s.textContent=txt;}
function resetRooms(){Object.values(rooms).forEach(function(el){el.classList.remove('working','done');el.classList.add('idle');el.querySelector('.st').textContent='รอเริ่ม';});}

runBtn.addEventListener('click',function(){
  var brief=document.getElementById('brief').value.trim();
  if(!brief){statusEl.textContent='กรุณาพิมพ์โจทย์ก่อน';return;}
  runBtn.disabled=true;resultEl.classList.remove('show');resetRooms();
  statusEl.textContent='กำลังเริ่ม...';
  fetch('/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({brief:brief})})
    .then(function(r){return r.json();}).then(function(j){
      if(j.error){statusEl.textContent='ผิดพลาด: '+j.error;runBtn.disabled=false;return;}
      var es=new EventSource('/events?job='+j.jobId);
      es.onmessage=function(e){var ev=JSON.parse(e.data);handle(ev);};
      es.addEventListener('end',function(){es.close();runBtn.disabled=false;});
    }).catch(function(err){statusEl.textContent='เชื่อมต่อไม่ได้: '+err;runBtn.disabled=false;});
});

function handle(ev){
  if(ev.type==='delegate'){setRoom(ev.key,'working','กำลังทำงาน');statusEl.textContent='กำลังทำงาน: '+ev.dept;}
  else if(ev.type==='result'){setRoom(ev.key,'done','เสร็จ');}
  else if(ev.type==='error'){statusEl.textContent='❌ '+(ev.message||'เกิดข้อผิดพลาด');runBtn.disabled=false;}
  else if(ev.type==='done'){
    statusEl.textContent=(ev.demo?'✅ เสร็จ (โหมดสาธิต)':'✅ เสร็จทุกแผนก')+' · '+(ev.posts||0)+' โพสต์พร้อมเผยแพร่';
    currentDir=ev.dir;
    document.getElementById('dashLink').href='/'+ev.dir+'/index.html';
    resultEl.classList.add('show');
  }
}

document.getElementById('pub').addEventListener('click',function(){
  if(!currentDir)return;var b=this;b.disabled=true;
  var box=document.getElementById('pubres');box.innerHTML='กำลังเผยแพร่...';
  fetch('/publish',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({dir:currentDir})})
    .then(function(r){return r.json();}).then(function(j){
      b.disabled=false;
      if(j.error){box.innerHTML='ผิดพลาด: '+j.error;return;}
      var head='<div style="border:none;margin-bottom:6px">'+(j.live?'<span class=\"pill live\">โพสต์จริง</span>':'<span class=\"pill dry\">โหมดซ้อม (dry-run)</span>')+'</div>';
      var ic={published:'✅',uploaded:'✅','dry-run':'🧪',skipped:'⏭️',error:'❌'};
      box.innerHTML=head+(j.results||[]).map(function(r){
        return '<div>'+(ic[r.status]||'•')+' ['+r.platform+'] '+r.status+(r.reason?' — '+r.reason:'')+(r.error?' — '+r.error:'')+'</div>';
      }).join('');
    }).catch(function(e){b.disabled=false;box.innerHTML='ผิดพลาด: '+e;});
});
</script>
</body></html>`;
}

// ============================================================================
//  หน้า Settings
// ============================================================================
function renderField(item, env) {
  const val = env[item.key] || '';
  if (item.type === 'select') {
    const cur = val || (item.options[0] && item.options[0][0]);
    const opts = item.options.map(([v, l]) => `<option value="${esc(v)}" ${cur === v ? 'selected' : ''}>${l}</option>`).join('');
    return `<div class="row"><div class="lab">${item.label}</div><select class="sel" name="${item.key}">${opts}</select>
      ${item.hint ? `<div class="hint">${item.hint}</div>` : ''}</div>`;
  }
  if (item.type === 'toggle') {
    const checked = val && val === item.on ? 'checked' : '';
    return `<label class="row toggle"><span class="lab">${item.label}</span>
      <input type="checkbox" name="${item.key}" data-on="${esc(item.on)}" data-off="${esc(item.off)}" data-pair="${item.pair || ''}" ${checked}/>
      <span class="switch"></span></label>`;
  }
  const set = val ? '<span class="ok">● ตั้งแล้ว</span>' : '<span class="no">○ ยังไม่ตั้ง</span>';
  const linkHtml = item.link ? ` · <a href="${item.link}" target="_blank" rel="noopener">ขอ key ที่นี่ ↗</a>` : '';
  return `<div class="row"><div class="lab">${item.label}${item.required ? ' <b class="req">*</b>' : ''} ${set}</div>
    <div class="inp"><input type="${item.secret ? 'password' : 'text'}" name="${item.key}" value="${esc(val)}" placeholder="${item.secret ? 'วาง token ที่นี่' : ''}" autocomplete="off"/>
    ${item.secret ? '<button type="button" class="eye">👁</button>' : ''}</div>
    ${item.hint || item.link ? `<div class="hint">${item.hint || ''}${linkHtml}</div>` : ''}</div>`;
}

export function renderSettings(env, saved) {
  const groups = FIELDS.map((g) => `<section class="card"><h2>${g.group}</h2>${g.items.map((i) => renderField(i, env)).join('')}</section>`).join('');
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/><title>ตั้งค่า API · ศูนย์บัญชาการ AI</title>
<style>${THEME}
.row{margin-bottom:14px;}.lab{font-size:.85rem;font-weight:600;margin-bottom:6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.req{color:var(--brand);}.ok{font-size:.68rem;color:var(--green);font-weight:600;}.no{font-size:.68rem;color:var(--faint);}
.inp{display:flex;gap:6px;}input[type=text],input[type=password]{flex:1;background:#0b1220;border:1px solid var(--line);color:var(--ink);border-radius:9px;padding:10px 12px;font-family:var(--mono);font-size:.82rem;}
input:focus{outline:2px solid var(--blue);border-color:var(--blue);}
.eye{background:#182238;border:1px solid var(--line);border-radius:9px;color:var(--ink);cursor:pointer;padding:0 12px;}
.sel{width:100%;background:#0b1220;border:1px solid var(--line);color:var(--ink);border-radius:9px;padding:10px 12px;font-family:var(--font);font-size:.86rem;}
.sel:focus{outline:2px solid var(--blue);border-color:var(--blue);}
.hint{font-size:.72rem;color:var(--faint);margin-top:5px;}.hint a{color:var(--blue);}
.toggle{display:flex;align-items:center;gap:12px;cursor:pointer;}.toggle .lab{flex:1;margin:0;font-weight:500;}
.toggle input{display:none;}.switch{width:44px;height:24px;border-radius:99px;background:#2a3346;position:relative;transition:.2s;flex:none;}
.switch::after{content:"";position:absolute;top:2px;left:2px;width:20px;height:20px;border-radius:50%;background:#fff;transition:.2s;}
.toggle input:checked + .switch{background:var(--green);}.toggle input:checked + .switch::after{transform:translateX(20px);}
.bar{display:flex;gap:12px;align-items:center;padding:6px 0;}.next{color:var(--muted);font-size:.8rem;}
.toast{position:fixed;top:16px;left:50%;transform:translateX(-50%);background:var(--green);color:#0b111c;font-weight:700;padding:10px 18px;border-radius:11px;}
</style></head><body>
${saved ? '<div class="toast" id="toast">✅ บันทึกแล้ว</div>' : ''}
<div class="wrap">
  ${nav('settings')}
  <p style="color:var(--muted);font-size:.85rem;margin:0 0 14px">กรอก key ของแต่ละ AI และแต่ละแพลตฟอร์ม แล้วกดบันทึก — ระบบเซฟลง <code>.env</code> ให้อัตโนมัติ (มีผลทันที)</p>
  <form method="POST" action="/save">
    ${groups}
    <div class="bar"><button class="btn" type="submit">💾 บันทึกการตั้งค่า</button>
      <span class="next">บันทึกแล้วกลับไป <a href="/" style="color:var(--blue)">🎬 ผลิตคอนเทนต์</a></span></div>
  </form>
</div>
<script>
document.querySelectorAll('.eye').forEach(function(b){b.addEventListener('click',function(){var i=b.parentElement.querySelector('input');i.type=i.type==='password'?'text':'password';});});
document.querySelector('form').addEventListener('submit',function(){
  document.querySelectorAll('input[type=checkbox]').forEach(function(c){var v=c.checked?c.dataset.on:c.dataset.off;addHidden(c.name,v);if(c.dataset.pair)addHidden(c.dataset.pair,v);c.disabled=true;});});
function addHidden(n,v){var h=document.createElement('input');h.type='hidden';h.name=n;h.value=v;document.querySelector('form').appendChild(h);}
var t=document.getElementById('toast');if(t)setTimeout(function(){t.remove();},2200);
</script>
</body></html>`;
}

export const DEMO_ENV = {
  ANTHROPIC_API_KEY: 'sk-ant-api03-demo-xxxxxxxxxxxx', IMAGE_PROVIDER: 'replicate', VIDEO_PROVIDER: 'replicate',
  REPLICATE_API_TOKEN: 'r8_demo_xxxxxxxxxxxx', FB_PAGE_ID: '104857623901', FB_PAGE_TOKEN: 'EAAGm0demoxxxxxxxx',
};

// ============================================================================
//  Job + SSE (สตรีม progress ไปหน้าเว็บ)
// ============================================================================
const jobs = new Map();
function newJob() {
  const id = Math.random().toString(36).slice(2, 10);
  const job = { id, events: [], clients: new Set(), done: false };
  jobs.set(id, job);
  return job;
}
function pushEv(job, ev) {
  job.events.push(ev);
  const line = `data: ${JSON.stringify(ev)}\n\n`;
  for (const res of job.clients) res.write(line);
}
function endJob(job) {
  job.done = true;
  for (const res of job.clients) { res.write('event: end\ndata: {}\n\n'); res.end(); }
  job.clients.clear();
  setTimeout(() => jobs.delete(job.id), 5 * 60 * 1000);
}

// รันจริง: spawn โปรเซสใหม่ (โหลด .env ล่าสุด) แล้วอ่าน event ที่ขึ้นต้นด้วย @@EV@@
function runReal(job, brief) {
  const child = spawn(process.execPath, ['src/index.js', brief], { env: { ...process.env, WEB_EVENTS: '1' } });
  let buf = '', err = '', sawDone = false;
  child.stdout.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (line.startsWith('@@EV@@')) {
        try { const ev = JSON.parse(line.slice(6)); if (ev.type === 'done') sawDone = true; pushEv(job, ev); } catch {}
      }
    }
  });
  child.stderr.on('data', (d) => { err += d.toString(); });
  child.on('close', (code) => {
    if (!sawDone) pushEv(job, { type: 'error', message: err.trim().split('\n').pop() || `จบด้วยรหัส ${code}` });
    endJob(job);
  });
}

// โหมดสาธิต: ใช้โมดูลจริงสร้างแคมเปญตัวอย่าง (ไม่เรียก Claude)
async function runDemo(job, brief) {
  const ctx = createCampaignDir(brief);
  ctx.assets = []; ctx.posts = [];
  const P = 'A cheerful young Thai woman applying sunscreen on a bright sunny beach, vibrant colors, product photography';
  const steps = [
    { key: 'strategy', task: 'วางแผนแคมเปญ', result: 'Big Idea: แดดแรงแค่ไหนก็ไม่กลัว — เปลี่ยนกันแดดให้เป็นไอเทมสนุกประจำวัน\nเสาหลัก: รีวิวเนื้อครีม, before/after, POV กิจกรรมกลางแดด' },
    { key: 'trend', task: 'หาเทรนด์และแฮชแท็ก', result: 'ฟอร์แมตมาแรง: texture ASMR, GRWM\nแฮชแท็ก: #กันแดด #GlowShield #รีวิวกันแดด #ผิวโกลว์' },
    { key: 'copywriting', task: 'เขียนบทและแคปชั่น', result: 'Hook: "ทากันแดดตัวนี้แล้วหน้าไม่วอก!"\nCTA: แตะลิงก์รับส่วนลดเปิดตัว 20%' },
    { key: 'visual', task: 'สร้างภาพหลัก', result: 'ทิศทางภาพโทนสว่างสดใส แสงธรรมชาติ' },
    { key: 'video', task: 'ทำวิดีโอรีวิว', result: 'วิดีโอ 9:16 · 15 วินาที · 4 ช็อต จังหวะสนุก' },
    { key: 'platform', task: 'จัดโพสต์ 3 แพลตฟอร์ม', result: 'ปรับแคปชั่น/แฮชแท็กตามแต่ละแพลตฟอร์ม' },
    { key: 'brand_qa', task: 'ตรวจแบรนด์และคุณภาพ', result: '✅ ผ่าน — ไม่มีคำโฆษณาเกินจริง พร้อมเผยแพร่' },
  ];
  const timeline = [];
  pushEv(job, { type: 'start', dir: ctx.dir });
  for (const s of steps) {
    pushEv(job, { type: 'delegate', key: s.key, dept: DEPTS.find((d) => d.key === s.key).name, task: s.task });
    await sleep(950);
    let assets = [];
    try {
      if (s.key === 'visual') {
        assets = [
          await generateImage({ prompt: P, description: 'ภาพหลักโฆษณา', aspectRatio: '4:5' }, ctx),
          await generateImage({ prompt: 'Before and after glowing skin comparison, cosmetic ad', description: 'ภาพ before/after', aspectRatio: '1:1' }, ctx),
        ];
      } else if (s.key === 'video') {
        assets = [await generateVideo({ title: 'วิดีโอรีวิว GlowShield 15 วินาที', storyboard: 'ช็อต1 โคลสอัพเนื้อครีม · ช็อต2 ปาดลงผิว · ช็อต3 เดินกลางแดด · ช็อต4 ผิวโกลว์ + โปร', aspectRatio: '9:16' }, ctx)];
      } else if (s.key === 'platform') {
        demoPosts(ctx);
      }
    } catch (e) {
      pushEv(job, { type: 'error', message: 'สร้างสื่อไม่สำเร็จ: ' + e.message });
    }
    timeline.push({ key: s.key, dept: DEPTS.find((d) => d.key === s.key).name, task: s.task, result: s.result, assets });
    pushEv(job, { type: 'result', key: s.key, dept: DEPTS.find((d) => d.key === s.key).name, files: assets.map((a) => path.relative(ctx.dir, a.path)) });
    await sleep(450);
  }
  buildHtmlPreview({ dir: ctx.dir, brief, timeline, finalReport: 'สรุป (โหมดสาธิต): แคมเปญพร้อมเผยแพร่ ✅ — ใส่ Anthropic API Key ในหน้าตั้งค่าเพื่อผลิตด้วย AI จริง' });
  savePostsManifest(ctx, brief);
  pushEv(job, { type: 'done', dir: ctx.dir, posts: ctx.posts.length, demo: true });
  endJob(job);
}

function demoPosts(ctx) {
  const img = (ctx.assets.find((a) => a.type === 'image') || {}).path;
  const vid = (ctx.assets.find((a) => a.type === 'video') || {}).path;
  const posts = [
    { platform: 'TikTok', postType: 'คลิปสั้น', caption: 'ทากันแดดตัวนี้แล้วหน้าไม่วอกจริง! ☀️ เนื้อบางเบา ซึมไว', hashtags: '#กันแดด #GlowShield #รีวิวกันแดด', scheduleTime: 'พฤ. 19:00', media: vid ? [vid] : [] },
    { platform: 'Instagram', postType: 'Reel', caption: 'ซัมเมอร์นี้ผิวต้องโกลว์ ✨ GlowShield SPF50+ PA++++', hashtags: '#สกินแคร์ #ผิวโกลว์ #กันแดด', scheduleTime: 'ศ. 12:00', media: img ? [img] : [] },
    { platform: 'Facebook', postType: 'รูปเดี่ยว', caption: 'เปิดตัวครีมกันแดด GlowShield SPF50+ พร้อมโปรลด 20% ถึงสิ้นเดือน', hashtags: '#GlowShield #โปรโมชั่น', scheduleTime: 'ส. 10:00', media: img ? [img] : [] },
  ];
  for (const p of posts) {
    ctx.posts.push(p);
    fs.writeFileSync(path.join(ctx.dir, `post-${p.platform.toLowerCase()}.md`), `# ${p.platform}\n\n${p.caption}\n\n${p.hashtags}\n`);
  }
}

// เผยแพร่: spawn โปรเซส publish (โหลด .env ล่าสุด) อ่านผลจาก @@EV@@
function runPublish(dir) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['src/publish.js', dir], { env: { ...process.env, WEB_EVENTS: '1' } });
    let buf = '', out = null;
    child.stdout.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (line.startsWith('@@EV@@')) { try { out = JSON.parse(line.slice(6)); } catch {} }
      }
    });
    child.on('close', () => resolve(out || { live: false, results: [{ platform: '-', status: 'error', error: 'ไม่มีผลลัพธ์' }] }));
  });
}

// เสิร์ฟไฟล์ในโฟลเดอร์ output/ (ให้แดชบอร์ด+ภาพโหลดได้)
const MIME = { html: 'text/html; charset=utf-8', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4', md: 'text/plain; charset=utf-8', json: 'application/json', txt: 'text/plain; charset=utf-8' };
function serveOutput(url, res) {
  const rel = decodeURIComponent(url.split('?')[0]);
  const fp = path.resolve('.' + rel);
  const root = path.resolve('output');
  if (!fp.startsWith(root) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
  const ext = fp.split('.').pop().toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
}

function readBody(req) {
  return new Promise((resolve) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => resolve(b)); });
}

// ============================================================================
//  Server + routing
// ============================================================================
const server = http.createServer(async (req, res) => {
  const u = req.url;
  if (req.method === 'GET' && (u === '/' || u.startsWith('/?'))) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(renderStudio(parseEnv())); return;
  }
  if (req.method === 'GET' && u.startsWith('/settings')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(renderSettings(parseEnv(), u.includes('saved=1'))); return;
  }
  if (req.method === 'POST' && u === '/save') {
    const params = new URLSearchParams(await readBody(req));
    const next = {}; for (const k of ALL_KEYS) if (params.has(k)) next[k] = params.get(k).trim();
    writeEnv(next);
    res.writeHead(303, { Location: '/settings?saved=1' }); res.end(); return;
  }
  if (req.method === 'POST' && u === '/run') {
    let brief = '';
    try { brief = (JSON.parse(await readBody(req)).brief || '').trim(); } catch {}
    if (!brief) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end('{"error":"กรุณาพิมพ์โจทย์"}'); return; }
    const job = newJob();
    if (brainReady()) runReal(job, brief);
    else runDemo(job, brief).catch((e) => { pushEv(job, { type: 'error', message: e.message }); endJob(job); });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jobId: job.id, demo: !brainReady() })); return;
  }
  if (req.method === 'GET' && u.startsWith('/events')) {
    const id = new URLSearchParams(u.split('?')[1] || '').get('job');
    const job = jobs.get(id);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    if (!job) { res.write('event: end\ndata: {}\n\n'); res.end(); return; }
    for (const ev of job.events) res.write(`data: ${JSON.stringify(ev)}\n\n`);
    if (job.done) { res.write('event: end\ndata: {}\n\n'); res.end(); return; }
    job.clients.add(res);
    req.on('close', () => job.clients.delete(res));
    return;
  }
  if (req.method === 'POST' && u === '/publish') {
    let dir = '';
    try { dir = (JSON.parse(await readBody(req)).dir || '').trim(); } catch {}
    const root = path.resolve('output');
    if (!dir || !path.resolve(dir).startsWith(root)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end('{"error":"โฟลเดอร์ไม่ถูกต้อง"}'); return; }
    const result = await runPublish(dir);
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(result)); return;
  }
  if (req.method === 'GET' && u.startsWith('/output/')) { serveOutput(u, res); return; }
  res.writeHead(404); res.end('not found');
});

const isMain = process.argv[1] && process.argv[1].endsWith('server.js');
if (isMain) {
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`\n🎬  ศูนย์บัญชาการ AI เปิดแล้ว — เปิดเบราว์เซอร์ไปที่:\n`);
    console.log(`      http://localhost:${PORT}\n`);
    console.log('   หน้า Studio: พิมพ์โจทย์ → กดผลิต → กดเผยแพร่ · หน้า Settings: กรอก API key\n');
  });
}
