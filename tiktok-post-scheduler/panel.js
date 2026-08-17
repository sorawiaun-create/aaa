// panel.js — UI ของ side panel
import { addClip, listClipsMeta, updateClip, deleteClip, clearAll } from './db.js';
import { buildSchedule, countPerDay } from './schedule.js';

const $ = (id) => document.getElementById(id);
const uid = () => 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);

// ---------- เพิ่มคลิปเข้าคิว ----------
$('addBtn').addEventListener('click', async () => {
  const files = Array.from($('files').files || []);
  if (files.length === 0) return alert('เลือกไฟล์วิดีโอก่อน');
  const caption = $('caption').value.trim();
  const hashtags = $('hashtags').value.trim().split(/\s+/).filter(Boolean);
  const productKeyword = $('product').value.trim();

  for (const f of files) {
    await addClip({
      id: uid(),
      name: f.name,
      mime: f.type || 'video/mp4',
      size: f.size,
      blob: f,
      caption,
      hashtags,
      productKeyword,
      status: 'queued',
      scheduledAt: null,
    });
  }
  $('files').value = '';
  await render();
  alert(`เพิ่ม ${files.length} คลิปเข้าคิวแล้ว — ไปข้อ 2 เพื่อจัดตารางเวลา`);
});

// ---------- จัดตารางเวลา ----------
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

  const times = buildSchedule(pending.length, opts);
  for (let i = 0; i < pending.length; i++) {
    await updateClip(pending[i].id, { scheduledAt: times[i] });
  }
  const perDay = countPerDay(times);
  const days = perDay.size;
  $('planInfo').textContent = `จัดแล้ว ${pending.length} คลิป กระจาย ${days} วัน (เริ่ม ${fmt(times[0])} → ${fmt(times[times.length - 1])})`;
  await render();
});

// ---------- โหมดการทำงาน ----------
async function loadSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  const s = settings || { enabled: false, autoSubmit: false, dryRun: true, minGapMin: 25 };
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
    if (!confirm('เปิด "โพสต์อัตโนมัติ" แบบโพสต์จริง — แนะนำให้ผ่าน dry-run กับ 1 คลิปมาก่อน\nยืนยันเปิด?')) return;
  }
  await chrome.storage.local.set({ settings });
  flashState('บันทึกโหมดแล้ว');
});
$('runBtn').addEventListener('click', async () => {
  flashState('กำลังลองโพสต์ตัวถัดไป...');
  chrome.runtime.sendMessage({ type: 'RUN_NOW' }, (r) => {
    flashState(r?.ok ? 'สั่งทำงานแล้ว — ดูสถานะในคิว' : 'ผิดพลาด: ' + (r?.error || ''));
    setTimeout(render, 1500);
  });
});

// ---------- คิว ----------
$('clearBtn').addEventListener('click', async () => {
  if (!confirm('ล้างคิวและไฟล์ทั้งหมด?')) return;
  await clearAll();
  await render();
});

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
    el.innerHTML = `
      <div class="name">${escapeHtml(c.name)}</div>
      <div class="meta">
        <span class="tag st-${c.status}">${statusLabel(c.status)}</span>
        &nbsp;🕒 ${when}
        ${c.productKeyword ? '&nbsp;🛒 ' + escapeHtml(c.productKeyword) : ''}
        ${c.lastError ? '<br><span style="color:#fca5a5">' + escapeHtml(c.lastError) + '</span>' : ''}
      </div>`;
    const del = document.createElement('button');
    del.className = 'btn-danger';
    del.textContent = 'ลบ';
    del.style.marginTop = '6px';
    del.style.padding = '3px 8px';
    del.onclick = async () => { await deleteClip(c.id); render(); };
    el.appendChild(del);
    list.appendChild(el);
  }
}

// ---------- utils ----------
function clampInt(v, min, max, def) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}
function fmt(ms) {
  const d = new Date(ms);
  return d.toLocaleString('th-TH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function statusLabel(s) {
  return { queued: 'รอคิว', posting: 'กำลังโพสต์', posted: 'โพสต์แล้ว', failed: 'ล้มเหลว', skipped: 'รอกดโพสต์' }[s] || s;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function flashState(msg) { $('state').textContent = msg; }

// เริ่มต้น: ตั้งค่า default startAt = อีก 5 นาที
(function init() {
  const d = new Date(Date.now() + 5 * 60_000);
  d.setSeconds(0, 0);
  const pad = (n) => String(n).padStart(2, '0');
  $('startAt').value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  loadSettings();
  render();
})();
