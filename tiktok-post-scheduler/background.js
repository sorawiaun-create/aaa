// background.js — ตัวตั้งเวลา (scheduler) ของ extension
// ทำงานเป็น service worker: ตื่นทุก 1 นาทีด้วย chrome.alarms เช็กว่ามีคลิปถึงกำหนดไหม
// ถ้ามี → เปิด/หาแท็บหน้าอัปโหลด TikTok แล้วสั่ง content script ให้โพสต์ทีละตัว

import { dueClips, getClip, updateClip } from './db.js';

const ALARM = 'tt-scheduler-tick';
const UPLOAD_URL = 'https://www.tiktok.com/tiktokstudio/upload';
const DEFAULTS = {
  enabled: false, // ค่าเริ่มต้น "ปิด" — ให้ผู้ใช้ตั้งค่าและทดสอบก่อนเปิด
  autoSubmit: false, // false = เติมข้อมูลให้ครบแล้วหยุดรอคนกดโพสต์ (ปลอดภัยกว่า)
  dryRun: true, // true = เดินขั้นตอนแต่ไม่กดอะไรจริง (ไว้ลองระบบ)
  minGapMin: 25, // กันไม่ให้ยิงถี่เกิน แม้ตารางเวลาจะซ้อน
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM, { periodInMinutes: 1 });
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(ALARM, { periodInMinutes: 1 });
});

let busy = false;
let lastPostAt = 0;

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) tick().catch((e) => console.warn('tick error', e));
});

// ให้ panel สั่ง "ลองโพสต์ตัวถัดไปเดี๋ยวนี้" ได้
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'RUN_NOW') {
    tick(true).then(() => sendResponse({ ok: true })).catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg?.type === 'GET_STATE') {
    getSettings().then((s) => sendResponse({ busy, lastPostAt, settings: s }));
    return true;
  }
});

async function getSettings() {
  const s = await chrome.storage.local.get('settings');
  return { ...DEFAULTS, ...(s.settings || {}) };
}

async function tick(force = false) {
  if (busy) return;
  const settings = await getSettings();
  if (!settings.enabled && !force) return;

  const now = Date.now();
  if (!force && now - lastPostAt < settings.minGapMin * 60_000) return; // เว้นระยะขั้นต่ำ

  const due = await dueClips(now);
  if (due.length === 0) return;

  busy = true;
  try {
    const job = due[0];
    await postOne(job, settings);
    lastPostAt = Date.now();
  } finally {
    busy = false;
  }
}

async function postOne(meta, settings) {
  const clip = await getClip(meta.id);
  if (!clip || !clip.blob) {
    await updateClip(meta.id, { status: 'failed', lastError: 'ไม่พบไฟล์วิดีโอ' });
    return;
  }
  await updateClip(meta.id, { status: 'posting', attempts: (clip.attempts || 0) + 1 });

  let tab;
  try {
    tab = await openUploadTab();
    const bytes = await blobToArrayBuffer(clip.blob);
    const res = await sendToTab(tab.id, {
      type: 'POST_CLIP',
      job: {
        name: clip.name,
        mime: clip.mime,
        bytes,
        caption: composeCaption(clip),
        productKeyword: clip.productKeyword,
        autoSubmit: settings.autoSubmit,
        dryRun: settings.dryRun,
      },
    });

    if (res?.ok) {
      await updateClip(meta.id, {
        status: settings.dryRun ? 'queued' : settings.autoSubmit ? 'posted' : 'skipped',
        postedAt: settings.autoSubmit && !settings.dryRun ? Date.now() : null,
        lastError: settings.dryRun ? '(dry-run) ' + (res.note || '') : res.note || '',
      });
      notify('โพสต์คลิป', `${clip.name}: ${res.note || (settings.autoSubmit ? 'โพสต์แล้ว' : 'เติมข้อมูลครบ รอกดโพสต์')}`);
    } else {
      await updateClip(meta.id, { status: 'failed', lastError: res?.error || 'ไม่ทราบสาเหตุ' });
      notify('โพสต์ไม่สำเร็จ', `${clip.name}: ${res?.error || ''}`);
    }
  } catch (e) {
    await updateClip(meta.id, { status: 'failed', lastError: String(e) });
    notify('โพสต์ผิดพลาด', `${clip.name}: ${e}`);
  }
}

function composeCaption(clip) {
  const tags = (clip.hashtags || []).map((h) => (h.startsWith('#') ? h : '#' + h)).join(' ');
  return [clip.caption, tags].filter(Boolean).join('\n');
}

async function openUploadTab() {
  const tabs = await chrome.tabs.query({ url: 'https://www.tiktok.com/*' });
  const existing = tabs.find((t) => t.url && t.url.includes('/upload'));
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    return existing;
  }
  const tab = await chrome.tabs.create({ url: UPLOAD_URL, active: true });
  await waitForComplete(tab.id);
  await delay(2500); // เผื่อ SPA โหลด editor
  return tab;
}

function waitForComplete(tabId) {
  return new Promise((resolve) => {
    const listener = (id, info) => {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 20000);
  });
}

function sendToTab(tabId, msg) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, msg, (resp) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(resp);
    });
  });
}

function blobToArrayBuffer(blob) {
  return blob.arrayBuffer();
}

function notify(title, message) {
  try {
    chrome.notifications?.create({ type: 'basic', iconUrl: 'data:image/png;base64,', title, message });
  } catch {}
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
