import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from './config.js';
import { slugify } from './util.js';

// ข้อมูลหน้าตาของแต่ละแผนก (ไอคอน/สีตัวการ์ตูน/ลูกโป่งไอเดีย) — ใช้วาดห้องในแดชบอร์ด
const DEPT_META = {
  strategy:    { icon: '🧭', shirt: '#FF6B4D', hair: '#2b2019', skin: '#F4C9A0', say: '💡' },
  trend:       { icon: '🔥', shirt: '#F5B23D', hair: '#1c2733', skin: '#E8B48C', say: '🔥' },
  copywriting: { icon: '✍️', shirt: '#4C9AFF', hair: '#3a2a22', skin: '#F4C9A0', say: '✏️' },
  visual:      { icon: '🎨', shirt: '#B76CFF', hair: '#241a2e', skin: '#EFC199', say: '🖼️' },
  video:       { icon: '🎥', shirt: '#FE5A78', hair: '#20262f', skin: '#F4C9A0', say: '🎬' },
  influencer:  { icon: '🤝', shirt: '#2FD3B8', hair: '#2b2019', skin: '#E8B48C', say: '⭐' },
  paid_ads:    { icon: '📢', shirt: '#FF8A3D', hair: '#1c2733', skin: '#F4C9A0', say: '📈' },
  platform:    { icon: '📱', shirt: '#5B7CFF', hair: '#3a2a22', skin: '#EFC199', say: '📤' },
  brand_qa:    { icon: '✅', shirt: '#38E08A', hair: '#22303f', skin: '#F4C9A0', say: '👍' },
};
// ลำดับห้องในผัง (สายพานการผลิต)
const FLOOR_ORDER = ['strategy', 'trend', 'copywriting', 'visual', 'video', 'influencer', 'paid_ads', 'platform', 'brand_qa'];
const DEPT_NAME = {
  strategy: 'วางแผนกลยุทธ์', trend: 'เทรนด์ & แฮชแท็ก', copywriting: 'เขียนบท & แคปชั่น',
  visual: 'ภาพ & กราฟิก', video: 'วิดีโอ', influencer: 'อินฟลูเอนเซอร์',
  paid_ads: 'ยิงแอด', platform: 'จัดโพสต์', brand_qa: 'ตรวจแบรนด์ & QA',
};

// สร้างโฟลเดอร์แคมเปญ: output/<slug>-<timestamp>/ (พร้อมโฟลเดอร์ assets/)
export function createCampaignDir(brief) {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const dir = path.join(CONFIG.outputRoot, `${slugify(brief, 30)}-${stamp}`);
  const assetsDir = path.join(dir, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });
  return { dir, assetsDir };
}

// บันทึกไฟล์ข้อความ (เช่นผลงานของแต่ละแผนก)
export function saveText(dir, name, content) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, content ?? '');
  return p;
}

function classifyAsset(dir, a) {
  const href = path.relative(dir, a.path);
  const ext = (href.split('.').pop() || '').toLowerCase();
  let kind = 'file';
  if (['svg', 'png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) kind = 'image';
  else if (['mp4', 'webm', 'mov'].includes(ext)) kind = 'video';
  return { kind, href, name: href.split('/').pop() };
}

// สร้างหน้าแดชบอร์ด "ศูนย์บัญชาการ AI" (index.html) จากข้อมูลแคมเปญจริง
export function buildHtmlPreview({ dir, brief, timeline, finalReport }) {
  const byKey = Object.fromEntries(timeline.map((t) => [t.key, t]));

  const rooms = FLOOR_ORDER.map((key) => {
    const t = byKey[key];
    const meta = DEPT_META[key];
    return {
      key,
      name: DEPT_NAME[key],
      ...meta,
      status: t ? 'done' : 'skip',
      task: t ? t.task : '',
      result: t ? t.result : '',
      assets: t ? (t.assets || []).map((a) => classifyAsset(dir, a)) : [],
    };
  });

  const order = timeline.map((t) => t.key); // ลำดับที่ทำจริง (สำหรับ replay)
  const stats = {
    depts: timeline.length,
    assets: timeline.reduce((n, t) => n + (t.assets || []).length, 0),
    images: timeline.reduce((n, t) => n + (t.assets || []).filter((a) => a.type === 'image').length, 0),
    videos: timeline.reduce((n, t) => n + (t.assets || []).filter((a) => a.type === 'video').length, 0),
    posts: timeline.reduce((n, t) => n + (t.assets || []).filter((a) => a.type === 'post').length, 0),
  };

  const data = { brief, finalReport, rooms, order, stats };
  const json = JSON.stringify(data).replace(/</g, '\\u003c');

  const html = `<!doctype html>
<html lang="th"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>ศูนย์บัญชาการ AI · ${escapeAttr(brief).slice(0, 60)}</title>
<style>${CSS}</style></head>
<body>
<div class="wrap">
  <div class="hud">
    <div class="mgr">${managerChar()}</div>
    <div class="brand-t"><b>ศูนย์บัญชาการ AI</b><span>Content Command Center</span></div>
    <div class="grow"></div>
    <div class="readout"><div class="lab">สถานะ</div><div class="now" id="now"><span class="d"></span><span id="now-t">กำลังโหลด…</span></div></div>
    <div class="prog"><div class="bar"><div class="fill" id="fill"></div></div><div class="pct" id="pct">0%</div></div>
    <button class="btn" id="restart">▶ เล่นซ้ำ</button>
  </div>
  <div class="campaign"><span class="tag">CAMPAIGN</span><span id="brief"></span></div>
  <div class="statrow" id="statrow"></div>
  <div class="floorplan" id="plan"></div>
  <div class="legend">
    <span><i class="dotk" style="background:var(--green)"></i> กำลังทำงาน</span>
    <span><i class="dotk" style="background:var(--blue)"></i> เสร็จแล้ว (คลิกดูผลงาน)</span>
    <span><i class="dotk" style="background:#2a3346"></i> ไม่ได้ใช้ในแคมเปญนี้</span>
  </div>
  <div class="final" id="final"></div>
  <footer>สร้างอัตโนมัติจากระบบ AI ผลิตคอนเทนต์หลายแผนก · คลิกที่ห้องเพื่อดูผลงานจริงของแต่ละแผนก</footer>
</div>
<div class="drawer" id="drawer"><div class="drawer-in">
  <button class="close" id="close">✕</button>
  <div id="drawer-body"></div>
</div></div>
<script>const DATA = ${json};\n${JS}</script>
</body></html>`;

  return saveText(dir, 'index.html', html);
}

function managerChar() {
  return `<span class="char" style="--skin:#F4C9A0;--hair:#22303f;--shirt:#FF6B4D;transform:scale(.92)">
    <span class="hair"></span><span class="head"><i class="eye l"></i><i class="eye r"></i></span>
    <span class="torso"></span><span class="arm l"></span><span class="arm r"></span>
    <span class="leg l"></span><span class="leg r"></span></span>`;
}

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ============================================================================
//  CSS ของหน้าแดชบอร์ด (ธีมห้องคอนโทรลกลางคืน)
// ============================================================================
const CSS = `
:root{--bg:#0B111C;--room-solid:#151E30;--room-line:#26324A;--ink:#E7EEFA;--muted:#8593AC;--faint:#5A6884;
--green:#38E08A;--amber:#F5B23D;--blue:#4C9AFF;--brand:#FF6B4D;
--mono:ui-monospace,"SF Mono","Cascadia Code","Roboto Mono",monospace;--font:ui-sans-serif,"Segoe UI","Noto Sans Thai",system-ui,sans-serif;}
*{box-sizing:border-box;}
body{margin:0;font-family:var(--font);color:var(--ink);min-height:100vh;-webkit-font-smoothing:antialiased;
background:radial-gradient(1200px 600px at 50% -10%,#14203a 0%,transparent 60%),radial-gradient(800px 500px at 90% 10%,#1a1330 0%,transparent 55%),var(--bg);}
.wrap{max-width:1180px;margin:0 auto;padding:18px 18px 56px;}
.hud{display:flex;align-items:center;gap:16px;flex-wrap:wrap;background:linear-gradient(180deg,#141d2fcc,#0f1626cc);
border:1px solid var(--room-line);border-radius:16px;padding:13px 16px;box-shadow:0 12px 40px -16px #000;}
.mgr{position:relative;width:46px;height:46px;flex:none;}
.brand-t b{font-size:1.05rem;display:block;}.brand-t span{font-size:.66rem;color:var(--faint);letter-spacing:.22em;text-transform:uppercase;}
.grow{flex:1;min-width:80px;}
.readout .lab{font-family:var(--mono);font-size:.62rem;letter-spacing:.16em;color:var(--faint);text-transform:uppercase;}
.readout .now{font-family:var(--mono);font-size:.95rem;color:var(--green);font-weight:600;display:flex;align-items:center;gap:8px;margin-top:2px;}
.readout .now .d{width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 10px var(--green);animation:blink 1.1s infinite;}
.prog{width:150px;}.prog .bar{height:7px;border-radius:99px;background:#0c1422;border:1px solid var(--room-line);overflow:hidden;}
.prog .fill{height:100%;width:0;background:linear-gradient(90deg,var(--green),#8effc0);box-shadow:0 0 12px var(--green);transition:width .5s;}
.prog .pct{font-family:var(--mono);font-size:.68rem;color:var(--muted);margin-top:4px;text-align:right;}
.btn{font-family:var(--font);font-size:.82rem;font-weight:600;color:#0b111c;cursor:pointer;background:var(--green);border:none;border-radius:10px;padding:8px 14px;}
.btn:focus-visible{outline:2px solid #fff;outline-offset:2px;}
.campaign{display:flex;align-items:center;gap:10px;margin:14px 2px 6px;font-size:.84rem;color:var(--muted);}
.campaign .tag{font-family:var(--mono);font-size:.72rem;color:var(--brand);background:#ff6b4d1a;border:1px solid #ff6b4d33;padding:3px 9px;border-radius:7px;}
.statrow{display:flex;gap:10px;flex-wrap:wrap;margin:6px 0 10px;}
.stat{font-family:var(--mono);font-size:.74rem;color:var(--muted);background:#0f1826;border:1px solid var(--room-line);border-radius:9px;padding:7px 12px;}
.stat b{color:var(--ink);font-size:.95rem;}
.floorplan{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:6px;}
@media(max-width:820px){.floorplan{grid-template-columns:repeat(2,1fr);}}
@media(max-width:520px){.floorplan{grid-template-columns:1fr;}}
.room{position:relative;border-radius:16px;padding:12px 13px 0;overflow:hidden;min-height:196px;display:flex;flex-direction:column;cursor:default;
background:linear-gradient(180deg,var(--room-solid),#0f1728);border:1px solid var(--room-line);
box-shadow:inset 0 1px 0 #ffffff06,0 10px 30px -18px #000;transition:border-color .3s,box-shadow .3s,transform .2s;}
.room.clickable{cursor:pointer;}
.room.clickable:hover{transform:translateY(-3px);border-color:#4c9aff66;}
.room .top{display:flex;align-items:center;gap:9px;z-index:3;}
.room .ric{width:30px;height:30px;border-radius:8px;display:grid;place-items:center;font-size:15px;background:#0e1727;border:1px solid var(--room-line);}
.room .rname{font-size:.82rem;font-weight:650;line-height:1.2;}
.room .rnum{font-family:var(--mono);font-size:.6rem;color:var(--faint);letter-spacing:.1em;}
.room .light{margin-left:auto;width:12px;height:12px;border-radius:50%;background:#2a3346;border:1px solid #0008;}
.status{font-family:var(--mono);font-size:.6rem;letter-spacing:.12em;text-transform:uppercase;color:var(--faint);margin-top:6px;z-index:3;}
.stage{position:relative;flex:1;margin:8px -13px 0;}
.win{position:absolute;top:6px;right:12px;width:52px;height:34px;border-radius:6px;background:#0a1120;border:1px solid var(--room-line);overflow:hidden;}
.win::before{content:"";position:absolute;inset:0;background:linear-gradient(120deg,transparent 40%,#1b2c49 50%,transparent 60%);}
.desk{position:absolute;bottom:20px;left:14px;width:44px;height:8px;border-radius:3px;background:#1d2942;}
.monitor{position:absolute;bottom:28px;left:24px;width:22px;height:15px;border-radius:2px;background:#0a1322;border:1px solid #26324a;}
.monitor::after{content:"";position:absolute;inset:2px;border-radius:1px;background:#0f2033;}
.floorline{position:absolute;left:0;right:0;bottom:20px;height:1px;background:linear-gradient(90deg,transparent,#26324a,transparent);}
.worker{position:absolute;bottom:18px;left:12px;z-index:2;}
.shadow{position:absolute;bottom:14px;left:8px;width:34px;height:6px;border-radius:50%;background:#0006;filter:blur(2px);z-index:1;}
.pace{display:inline-block;}
.char{position:relative;width:30px;height:44px;display:block;}
.head{position:absolute;top:0;left:4px;width:22px;height:20px;border-radius:50% 50% 46% 46%;background:var(--skin,#F4C9A0);}
.hair{position:absolute;top:-2px;left:3px;width:24px;height:11px;border-radius:12px 12px 4px 4px;background:var(--hair,#3a2a22);}
.eye{position:absolute;top:9px;width:3px;height:3px;border-radius:50%;background:#1b2330;}
.eye.l{left:9px;}.eye.r{left:16px;}
.torso{position:absolute;top:17px;left:5px;width:20px;height:17px;border-radius:9px 9px 7px 7px;background:var(--shirt,#4C9AFF);}
.arm{position:absolute;top:19px;width:5px;height:13px;border-radius:3px;background:var(--shirt,#4C9AFF);transform-origin:top center;}
.arm.l{left:2px;}.arm.r{left:23px;}
.leg{position:absolute;bottom:0;width:6px;height:11px;border-radius:0 0 3px 3px;background:#28324a;transform-origin:top center;}
.leg.l{left:8px;}.leg.r{left:16px;}
.bubble{position:absolute;top:-6px;left:34px;font-size:14px;opacity:0;transform:translateY(4px) scale(.8);transition:.3s;}
.room.working{border-color:#38e08a66;box-shadow:0 0 0 1px #38e08a55,0 0 34px -6px #38e08a55;transform:translateY(-2px);}
.room.working .light{background:var(--green);box-shadow:0 0 12px var(--green),0 0 22px #38e08a80;animation:blink 1.1s infinite;}
.room.working .status{color:var(--green);}
.room.working .monitor::after{background:linear-gradient(#0f2033,#123b2a);animation:screen .8s steps(2) infinite;}
.room.working .win::before{animation:sheen 3s linear infinite;}
.room.working .char{animation:bob .42s ease-in-out infinite alternate;}
.room.working .leg.l{animation:swing .42s ease-in-out infinite alternate;}
.room.working .leg.r{animation:swing .42s ease-in-out infinite alternate-reverse;}
.room.working .arm.l{animation:swing .42s ease-in-out infinite alternate-reverse;}
.room.working .arm.r{animation:swing .42s ease-in-out infinite alternate;}
.room.working .pace{animation:pace 4.4s ease-in-out infinite alternate;}
.room.working .face{display:inline-block;animation:face 8.8s steps(1) infinite;}
.room.working .bubble{opacity:1;transform:none;animation:float 1.6s ease-in-out infinite;}
.room.done{border-color:#4c9aff40;}
.room.done .light{display:none;}
.room.done .status{color:var(--blue);}
.room.done .worker{opacity:.42;}
.room.done .badge{position:absolute;top:11px;right:12px;font-family:var(--mono);font-size:.62rem;color:var(--blue);background:#4c9aff1a;border:1px solid #4c9aff33;padding:2px 7px;border-radius:6px;z-index:4;}
.room.skip{opacity:.5;}
.room.skip .worker{display:none;}
.room.skip .status{color:var(--faint);}
.legend{display:flex;gap:16px;flex-wrap:wrap;margin-top:18px;font-family:var(--mono);font-size:.72rem;color:var(--muted);}
.legend span{display:inline-flex;align-items:center;gap:6px;}.dotk{width:9px;height:9px;border-radius:50%;}
.final{margin-top:16px;background:linear-gradient(180deg,#122033,#0f1826);border:1px solid var(--room-line);border-radius:16px;padding:20px;display:none;}
.final.show{display:block;}
.final h3{margin:0 0 8px;font-size:1rem;}
.final .txt{white-space:pre-wrap;font-size:.9rem;color:var(--muted);line-height:1.6;}
footer{text-align:center;margin-top:24px;font-size:.72rem;color:var(--faint);}
.drawer{position:fixed;inset:0;background:#0009;backdrop-filter:blur(3px);opacity:0;pointer-events:none;transition:opacity .25s;z-index:50;}
.drawer.open{opacity:1;pointer-events:auto;}
.drawer-in{position:absolute;right:0;top:0;bottom:0;width:min(560px,92vw);background:#0f1728;border-left:1px solid var(--room-line);
padding:22px;overflow-y:auto;transform:translateX(20px);transition:transform .25s;}
.drawer.open .drawer-in{transform:none;}
.close{position:absolute;top:14px;right:16px;background:#182238;color:var(--ink);border:1px solid var(--room-line);border-radius:8px;width:32px;height:32px;cursor:pointer;font-size:1rem;}
.drawer h2{font-size:1.15rem;margin:0 0 4px;display:flex;align-items:center;gap:10px;}
.drawer .d-task{font-size:.82rem;color:var(--faint);margin-bottom:14px;}
.drawer .d-result{white-space:pre-wrap;font-size:.9rem;color:var(--ink);line-height:1.65;background:#0b1220;border:1px solid var(--room-line);border-radius:12px;padding:14px 16px;}
.drawer h4{margin:18px 0 8px;font-size:.85rem;color:var(--muted);text-transform:uppercase;letter-spacing:.1em;font-family:var(--mono);}
.gal{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
.gal img,.gal video{width:100%;border-radius:10px;border:1px solid var(--room-line);display:block;}
.gal .fileicon{display:flex;align-items:center;gap:8px;padding:12px;background:#0b1220;border:1px solid var(--room-line);border-radius:10px;color:var(--ink);text-decoration:none;font-size:.82rem;}
.gal figcaption{font-family:var(--mono);font-size:.66rem;color:var(--faint);margin-top:4px;}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.35}}
@keyframes bob{from{transform:translateY(0)}to{transform:translateY(-3.5px)}}
@keyframes swing{from{transform:rotate(30deg)}to{transform:rotate(-30deg)}}
@keyframes pace{0%{transform:translateX(0)}100%{transform:translateX(120px)}}
@keyframes face{0%,49.9%{transform:scaleX(1)}50%,100%{transform:scaleX(-1)}}
@keyframes screen{0%{opacity:.7}100%{opacity:1}}
@keyframes sheen{0%{transform:translateX(-120%)}100%{transform:translateX(220%)}}
@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
@keyframes wave{0%,100%{transform:rotate(-8deg)}50%{transform:rotate(18deg)}}
.mgr .char{animation:bob .5s ease-in-out infinite alternate;}
.mgr .arm.r{animation:wave .7s ease-in-out infinite;}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important;}}
`;

// ============================================================================
//  JS ของหน้าแดชบอร์ด (วาดห้อง + replay + drawer)
// ============================================================================
const JS = `
document.getElementById('brief').innerHTML = escapeHtml(DATA.brief);
(function(){var s=DATA.stats;document.getElementById('statrow').innerHTML=
  '<div class="stat">แผนกที่ทำงาน <b>'+s.depts+'</b></div>'+
  '<div class="stat">ชิ้นงาน <b>'+s.assets+'</b></div>'+
  '<div class="stat">ภาพ <b>'+s.images+'</b></div>'+
  '<div class="stat">วิดีโอ <b>'+s.videos+'</b></div>'+
  '<div class="stat">โพสต์ <b>'+s.posts+'</b></div>';})();

function escapeHtml(t){return String(t==null?'':t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function charHtml(r){return '<span class="pace"><span class="face"><span class="char" style="--skin:'+r.skin+';--hair:'+r.hair+';--shirt:'+r.shirt+'">'+
  '<span class="bubble">'+r.say+'</span><span class="hair"></span><span class="head"><i class="eye l"></i><i class="eye r"></i></span>'+
  '<span class="torso"></span><span class="arm l"></span><span class="arm r"></span><span class="leg l"></span><span class="leg r"></span></span></span></span>';}

var plan=document.getElementById('plan');
DATA.rooms.forEach(function(r,idx){
  var el=document.createElement('div');
  el.className='room '+(r.status==='skip'?'skip':'queued');
  el.dataset.key=r.key;
  el.innerHTML='<div class="top"><div class="ric">'+r.icon+'</div>'+
    '<div><div class="rname">'+r.name+'</div><div class="rnum">ROOM-'+String(idx+1).padStart(2,'0')+'</div></div>'+
    '<div class="light"></div></div>'+
    '<div class="status"><span class="st-t">'+(r.status==='skip'?'ไม่ได้ใช้':'รอคิว')+'</span></div>'+
    '<div class="stage"><div class="win"></div><div class="floorline"></div><div class="desk"></div><div class="monitor"></div>'+
    (r.status==='skip'?'':'<div class="shadow"></div><div class="worker">'+charHtml(r)+'</div>')+'</div>';
  if(r.status!=='skip'){ el.classList.add('clickable'); el.addEventListener('click',function(){openDrawer(r);}); }
  plan.appendChild(el);
});

var roomEls={};[].forEach.call(document.querySelectorAll('.room'),function(el){roomEls[el.dataset.key]=el;});
var fill=document.getElementById('fill'),pct=document.getElementById('pct'),nowT=document.getElementById('now-t'),nowWrap=document.getElementById('now');
var order=DATA.order, i=-1, timer=null;

function setDone(key){var el=roomEls[key];if(!el)return;el.classList.remove('working','queued');el.classList.add('done');
  el.querySelector('.st-t').textContent='เสร็จ';
  if(!el.querySelector('.badge')){var b=document.createElement('div');b.className='badge';b.textContent='✓ เสร็จ';el.appendChild(b);}}
function setWorking(key){var el=roomEls[key];if(!el)return;el.classList.remove('queued','done');el.classList.add('working');el.querySelector('.st-t').textContent='กำลังทำงาน';}

function step(){
  if(i>=0&&i<order.length) setDone(order[i]);
  i++;
  if(i>=order.length){finishAll();return;}
  setWorking(order[i]);
  nowT.textContent=DATA.rooms.filter(function(r){return r.key===order[i];})[0].name;
  var p=Math.round((i/order.length)*100);fill.style.width=p+'%';pct.textContent=p+'%';
  timer=setTimeout(step, 1500);
}
function finishAll(){
  order.forEach(setDone);
  fill.style.width='100%';pct.textContent='100%';
  nowT.textContent='เสร็จทุกห้อง 🎉';nowWrap.style.color='var(--blue)';nowWrap.querySelector('.d').style.background='var(--blue)';
  var f=document.getElementById('final');f.className='final show';
  f.innerHTML='<h3>📦 สรุปจากผู้จัดการ</h3><div class="txt">'+escapeHtml(DATA.finalReport)+'</div>';
}
function play(){clearTimeout(timer);i=-1;
  order.forEach(function(k){var el=roomEls[k];el.classList.remove('working','done');el.classList.add('queued');
    el.querySelector('.st-t').textContent='รอคิว';var b=el.querySelector('.badge');if(b)b.remove();});
  nowWrap.style.color='var(--green)';nowWrap.querySelector('.d').style.background='var(--green)';
  document.getElementById('final').className='final';
  timer=setTimeout(step,600);
}
document.getElementById('restart').addEventListener('click',play);

// ---- drawer ----
var drawer=document.getElementById('drawer'),dbody=document.getElementById('drawer-body');
function assetHtml(a){
  if(a.kind==='image')return '<figure><img src="'+a.href+'" alt="'+a.name+'"/><figcaption>'+a.name+'</figcaption></figure>';
  if(a.kind==='video')return '<figure><video src="'+a.href+'" controls></video><figcaption>'+a.name+'</figcaption></figure>';
  return '<a class="fileicon" href="'+a.href+'">📄 '+a.name+'</a>';
}
function openDrawer(r){
  var assets=r.assets&&r.assets.length?'<h4>ไฟล์ที่สร้าง ('+r.assets.length+')</h4><div class="gal">'+r.assets.map(assetHtml).join('')+'</div>':'';
  dbody.innerHTML='<h2>'+r.icon+' '+r.name+'</h2>'+
    (r.task?'<div class="d-task"><b>งานที่ได้รับมอบหมาย:</b> '+escapeHtml(r.task)+'</div>':'')+
    '<div class="d-result">'+escapeHtml(r.result)+'</div>'+assets;
  drawer.classList.add('open');
}
function closeDrawer(){drawer.classList.remove('open');}
document.getElementById('close').addEventListener('click',closeDrawer);
drawer.addEventListener('click',function(e){if(e.target===drawer)closeDrawer();});
document.addEventListener('keydown',function(e){if(e.key==='Escape')closeDrawer();});

play();
`;
