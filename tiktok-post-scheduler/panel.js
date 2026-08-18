// panel.js — UI ของ side panel
import { addClip, listClipsMeta, updateClip, deleteClip, clearAll, getClip } from './db.js';
import { buildSchedule, countPerDay } from './schedule.js';
import { generateCaption, generateBatch } from './ai.js';
import { sendTelegram } from './telegram.js';

const $ = (id) => document.getElementById(id);
const uid = () => 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
const getS = async (k, d = {}) => ({ ...d, ...((await chrome.storage.local.get(k))[k] || {}) });
const setS = (k, v) => chrome.storage.local.set({ [k]: v });

// ---------- การ์ด AI ----------
async function loadAi() {
  const a = await getS('ai', { model: 'gpt-4o-mini', tone: 'สนุก เป็นกันเอง กระตุ้นให้กดตะกร้า', maxHashtags: 5 });
  $('aiEnabled').checked = !!a.enabled;
  $('aiKey').value = a.apiKey || '';
  $('aiModel').value = a.model || 'gpt-4o-mini';
  $('aiMaxTags').value = a.maxHashtags ?? 5;
  $('aiTone').value = a.tone || '';
  $('aiExtra').value = a.extra || '';
}
function aiSettings() {
  return {
    enabled: $('aiEnabled').checked,
    apiKey: $('aiKey').value.trim(),
    model: $('aiModel').value.trim() || 'gpt-4o-mini',
    maxHashtags: clampInt($('aiMaxTags').value, 0, 15, 5),
    tone: $('aiTone').value.trim(),
    extra: $('aiExtra').value.trim(),
    language: 'ไทย',
  };
}
$('aiSave').addEventListener('click', async () => {
  await setS('ai', aiSettings());
  flash('addInfo', 'บันทึกค่า AI แล้ว');
});

// ---------- เพิ่มคลิปเข้าคิว ----------
$('addBtn').addEventListener('click', async () => {
  const files = Array.from($('files').files || []);
  if (files.length === 0) return alert('เลือกไฟล์วิดีโอก่อน');
  const channel = $('channel').value.trim();
  const productKeyword = $('product').value.trim();
  const productId = $('productId').value.trim();
  const baseCaption = $('caption').value.trim();
  const baseTags = $('hashtags').value.trim().split(/\s+/).filter(Boolean);
  const useAi = $('useAi').checked;
  const ai = aiSettings();

  if (useAi && (!ai.enabled || !ai.apiKey)) return alert('เปิด AI และใส่ API key ในการ์ด 🤖 ก่อน');

  // เตรียม record ทั้งหมด (ใส่แคปชั่นพื้นฐานไปก่อน)
  const records = files.map((f) => ({
    id: uid(),
    name: f.name,
    mime: f.type || 'video/mp4',
    size: f.size,
    blob: f,
    caption: useAi ? '' : baseCaption,
    hashtags: useAi ? [] : baseTags,
    productKeyword,
    productId,
    channel,
    status: 'queued',
    scheduledAt: null,
  }));

  for (const r of records) await addClip(r);
  $('files').value = '';
  await render();

  if (useAi) {
    flash('addInfo', `กำลังให้ AI คิดแคปชั่น 0/${records.length}...`);
    await generateBatch(
      records.map((r) => ({ id: r.id, product: r.productKeyword, filename: r.name })),
      ai,
      async (done, total, item, result, error) => {
        if (result) await updateClip(item.id, { caption: result.caption, hashtags: result.hashtags });
        else if (error) await updateClip(item.id, { lastError: 'AI: ' + error });
        flash('addInfo', `AI คิดแคปชั่น ${done}/${total}${error ? ' (มีบางตัวพลาด)' : ''}`);
        if (done % 3 === 0 || done === total) await render();
      },
      3
    );
    await render();
    flash('addInfo', `เพิ่ม ${records.length} คลิป + AI แคปชั่นเสร็จ — ไปข้อ 2 จัดตารางเวลา`);
  } else {
    flash('addInfo', `เพิ่ม ${records.length} คลิปแล้ว — ไปข้อ 2 จัดตารางเวลา`);
  }
});

// ---------- จัดตารางเวลา (แยกตามช่อง) ----------
$('planBtn').addEventListener('click', async () => {
  const all = await listClipsMeta();
  const pending = all.filter((c) => c.status === 'queued' && c.scheduledAt == null);
  if (pending.length === 0) return alert('ไม่มีคลิปที่รอจัดเวลา');

  const startRaw = $('startAt').value;
  const startMs = startRaw ? new Date(startRaw).getTime() : Date.now() + 60_000;
  const opts = {
    startMs,
    perDay: clampInt($('perDay').value, 1, 200, 12),
    dayStartHour: clampInt($('dayStart').value, 0, 23, 9),
    dayEndHour: clampInt($('dayEnd').value, 1, 23, 21),
    minGapMin: clampInt($('minGap').value, 1, 600, 25),
    jitterMin: clampInt($('jitter').value, 0, 120, 7),
  };
  if (opts.dayEndHour <= opts.dayStartHour) return alert('ชั่วโมงสุดท้ายต้องมากกว่าชั่วโมงเริ่ม');

  // แต่ละช่องได้ตารางของตัวเอง (perDay ต่อช่อง) → หลายช่องโพสต์คู่ขนานได้
  const byChannel = new Map();
  for (const c of pending) {
    const k = c.channel || '(ไม่ระบุช่อง)';
    if (!byChannel.has(k)) byChannel.set(k, []);
    byChannel.get(k).push(c);
  }

  let first = Infinity, last = -Infinity, total = 0;
  for (const [, clips] of byChannel) {
    const times = buildSchedule(clips.length, opts);
    for (let i = 0; i < clips.length; i++) {
      await updateClip(clips[i].id, { scheduledAt: times[i] });
      first = Math.min(first, times[i]);
      last = Math.max(last, times[i]);
      total++;
    }
  }
  $('planInfo').textContent = `จัด ${total} คลิป · ${byChannel.size} ช่อง (${fmt(first)} → ${fmt(last)})`;
  await render();
});

// ---------- โหมดการทำงาน ----------
async function loadSettings() {
  const s = await getS('settings', { enabled: false, autoSubmit: false, dryRun: true, minGapMin: 25 });
  $('enabled').checked = !!s.enabled;
  $('autoSubmit').checked = !!s.autoSubmit;
  $('dryRun').checked = s.dryRun !== false;
}
$('saveBtn').addEventListener('click', async () => {
  const settings = {
    enabled: $('enabled').checked,
    autoSubmit: $('autoSubmit').checked,
    dryRun: $('dryRun').checked,
    minGapMin: clampInt($('minGap').value, 1, 600, 25),
  };
  if (settings.autoSubmit && !settings.dryRun) {
    if (!confirm('เปิด "โพสต์อัตโนมัติ" แบบจริง — แนะนำผ่าน dry-run กับ 1 คลิปก่อน\nยืนยันเปิด?')) return;
  }
  await setS('settings', settings);
  flash('state', 'บันทึกโหมดแล้ว');
});
$('runBtn').addEventListener('click', () => {
  flash('state', 'กำลังลองโพสต์ตัวถัดไป...');
  chrome.runtime.sendMessage({ type: 'RUN_NOW' }, (r) => {
    if (chrome.runtime.lastError) flash('state', 'ผิดพลาด: ' + chrome.runtime.lastError.message);
    else if (!r?.ok) flash('state', 'ผิดพลาด: ' + (r?.error || ''));
    else if (r.ran) flash('state', `กำลังโพสต์: ${r.clip} — ดูหน้า TikTok + Console`);
    else flash('state', 'ยังไม่ทำงาน: ' + (r.reason || 'ไม่ทราบสาเหตุ'));
    setTimeout(render, 2000);
  });
});

// ---------- Telegram ----------
async function loadTg() {
  const t = await getS('telegram', {});
  $('tgEnabled').checked = !!t.enabled;
  $('tgToken').value = t.token || '';
  $('tgChat').value = t.chatId || '';
}
function tgSettings() {
  return { enabled: $('tgEnabled').checked, token: $('tgToken').value.trim(), chatId: $('tgChat').value.trim() };
}
$('tgSave').addEventListener('click', async () => {
  await setS('telegram', tgSettings());
  flash('tgInfo', 'บันทึก Telegram แล้ว');
});
$('tgTest').addEventListener('click', async () => {
  const t = tgSettings();
  flash('tgInfo', 'กำลังส่งทดสอบ...');
  const r = await sendTelegram({ token: t.token, chatId: t.chatId, text: '✅ ทดสอบจาก TikTok Clip Scheduler' });
  flash('tgInfo', r.ok ? 'ส่งสำเร็จ — เช็กใน Telegram' : 'ส่งไม่สำเร็จ: ' + r.error);
});

// ---------- Selector overrides ----------
async function loadSel() {
  const s = await getS('selectors', {});
  $('selCaption').value = s.captionSelector || '';
  $('selSearch').value = s.searchSelector || '';
  $('selProduct').value = (s.productTexts || []).join(', ');
  $('selPost').value = (s.postTexts || []).join(', ');
}
$('selSave').addEventListener('click', async () => {
  const csv = (v) => v.split(',').map((x) => x.trim()).filter(Boolean);
  await setS('selectors', {
    captionSelector: $('selCaption').value.trim(),
    searchSelector: $('selSearch').value.trim(),
    productTexts: csv($('selProduct').value),
    postTexts: csv($('selPost').value),
  });
  flash('selInfo', 'บันทึก selector แล้ว');
});
$('selInspect').addEventListener('click', async () => {
  flash('selInfo', 'กำลังตรวจหน้า TikTok...');
  const tabs = await chrome.tabs.query({ url: 'https://www.tiktok.com/*' });
  const tab = tabs.find((t) => t.url && t.url.includes('/upload'));
  if (!tab) return flash('selInfo', 'เปิดหน้า tiktok.com/tiktokstudio/upload ก่อน');
  chrome.tabs.sendMessage(tab.id, { type: 'INSPECT' }, (r) => {
    if (chrome.runtime.lastError || !r?.ok) return flash('selInfo', 'ตรวจไม่ได้: ' + (chrome.runtime.lastError?.message || ''));
    const c = r.candidates;
    flash('selInfo', `ไฟล์อินพุต: ${c.fileInputs.length}\nช่องแก้ไข: ${c.editables.length}\nปุ่ม (ตัวอย่าง): ` +
      c.buttons.slice(0, 6).map((b) => b.text).filter(Boolean).join(' | '));
  });
});

// ---------- คิว ----------
$('clearBtn').addEventListener('click', async () => {
  if (!confirm('ล้างคิวและไฟล์ทั้งหมด?')) return;
  await clearAll();
  await render();
});

async function regenerate(id) {
  const ai = aiSettings();
  if (!ai.enabled || !ai.apiKey) return alert('เปิด AI และใส่ API key ก่อน');
  const clip = await getClip(id);
  if (!clip) return;
  try {
    const g = await generateCaption({ ...ai, product: clip.productKeyword, filename: clip.name });
    await updateClip(id, { caption: g.caption, hashtags: g.hashtags, lastError: '' });
  } catch (e) {
    await updateClip(id, { lastError: 'AI: ' + (e?.message || e) });
  }
  await render();
}

async function editProduct(id) {
  const clip = await getClip(id);
  if (!clip) return;
  const pid = prompt('รหัสสินค้า (Product ID) — เว้นว่างถ้าจะใช้ชื่อแทน', clip.productId || '');
  if (pid === null) return; // กด Cancel
  let patch = { productId: pid.trim() };
  if (!pid.trim()) {
    const kw = prompt('ชื่อสินค้า (ต้องตรง เพื่อกันปักผิด)', clip.productKeyword || '');
    if (kw === null) return;
    patch.productKeyword = kw.trim();
  }
  await updateClip(id, patch);
  await render();
}

async function render() {
  const all = await listClipsMeta();
  $('count').textContent = all.length;
  const list = $('list');
  list.innerHTML = '';
  if (all.length === 0) {
    list.innerHTML = '<div class="muted" style="font-size:11px">ยังไม่มีคลิปในคิว</div>';
    return;
  }
  for (const c of all) {
    const el = document.createElement('div');
    el.className = 'clip';
    const when = c.scheduledAt ? fmt(c.scheduledAt) : '— ยังไม่ตั้งเวลา';
    const tags = (c.hashtags || []).map((h) => '#' + h).join(' ');
    el.innerHTML = `
      <div class="name">${esc(c.name)}</div>
      <div class="meta">
        <span class="tag st-${c.status}">${statusLabel(c.status)}</span>
        &nbsp;🕒 ${when}
        ${c.channel ? '&nbsp;📺 ' + esc(c.channel) : ''}
        ${c.productId ? '&nbsp;🛒 ID ' + esc(c.productId) : c.productKeyword ? '&nbsp;🛒 ' + esc(c.productKeyword) : ''}
        ${c.lastError ? '<br><span style="color:#fca5a5">' + esc(c.lastError) + '</span>' : ''}
      </div>
      ${c.caption || tags ? `<div class="cap">${esc(c.caption)}${tags ? '\n' + esc(tags) : ''}</div>` : ''}`;
    const foot = document.createElement('div');
    foot.className = 'foot';
    const editP = mkBtn('✏️ สินค้า', 'btn-ghost mini', () => editProduct(c.id));
    const regen = mkBtn('🤖 คิดใหม่', 'btn-ghost mini', () => regenerate(c.id));
    const del = mkBtn('ลบ', 'btn-danger mini', async () => { await deleteClip(c.id); render(); });
    foot.append(editP, regen, del);
    el.appendChild(foot);
    list.appendChild(el);
  }
}

// ---------- utils ----------
function mkBtn(text, cls, onclick) {
  const b = document.createElement('button');
  b.className = cls;
  b.textContent = text;
  b.onclick = onclick;
  return b;
}
function clampInt(v, min, max, def) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
}
function fmt(ms) {
  return new Date(ms).toLocaleString('th-TH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function statusLabel(s) {
  return { queued: 'รอคิว', posting: 'กำลังโพสต์', posted: 'โพสต์แล้ว', failed: 'ล้มเหลว', skipped: 'รอกดโพสต์' }[s] || s;
}
function esc(s) {
  return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function flash(id, msg) { $(id).textContent = msg; }

// เริ่มต้น
(function init() {
  const d = new Date(Date.now() + 5 * 60_000);
  d.setSeconds(0, 0);
  const pad = (n) => String(n).padStart(2, '0');
  $('startAt').value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  loadAi();
  loadSettings();
  loadTg();
  loadSel();
  render();
})();
