// background.js — ตัวตั้งเวลา (scheduler) ของ extension
// ทำงานเป็น service worker: ตื่นทุก 1 นาทีด้วย chrome.alarms เช็กว่ามีคลิปถึงกำหนดไหม
// ถ้ามี → เปิด/หาแท็บหน้าอัปโหลด TikTok แล้วสั่ง content script ให้โพสต์ทีละตัว

import { dueClips, queuedClips, getClip, updateClip } from './db.js';
import { generateCaption } from './ai.js';
import { sendTelegram } from './telegram.js';

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
    tick(true).then((r) => sendResponse({ ok: true, ...r })).catch((e) => sendResponse({ ok: false, error: String(e) }));
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

async function getStore(key, def = {}) {
  const s = await chrome.storage.local.get(key);
  return { ...def, ...(s[key] || {}) };
}

async function tick(force = false) {
  if (busy) return { ran: false, reason: 'กำลังทำงานอยู่ รอสักครู่' };
  const settings = await getSettings();
  if (!settings.enabled && !force) return { ran: false, reason: 'ปิดตัวตั้งเวลาอยู่' };

  const now = Date.now();
  if (!force && now - lastPostAt < settings.minGapMin * 60_000) return { ran: false, reason: 'ยังไม่ถึงเวลาเว้นระยะ' };

  let due = await dueClips(now);
  // กด "ลองโพสต์เดี๋ยวนี้" (force): หยิบคลิปในคิวตัวถัดไปเลย ไม่ต้องรอถึงเวลา
  if (force && due.length === 0) {
    const q = await queuedClips();
    if (q.length) due = [q[0]];
  }
  if (due.length === 0) {
    return { ran: false, reason: 'ไม่มีคลิปพร้อมโพสต์ (ยังไม่ได้เพิ่มคลิป หรือโพสต์/ข้ามไปหมดแล้ว)' };
  }

  busy = true;
  try {
    const job = due[0];
    await postOne(job, settings);
    lastPostAt = Date.now();
    return { ran: true, clip: job.name };
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

  const ai = await getStore('ai', {});
  const selectors = await getStore('selectors', {});
  const ch = clip.channel ? `[${clip.channel}] ` : '';

  let tab;
  try {
    // ถ้ายังไม่มีแคปชั่น และเปิด AI ไว้ → ให้ ChatGPT คิดตอนจะโพสต์
    if (!clip.caption && ai.apiKey && ai.enabled) {
      try {
        const g = await generateCaption({ ...ai, product: clip.productKeyword, filename: clip.name });
        clip.caption = g.caption;
        if ((!clip.hashtags || clip.hashtags.length === 0) && g.hashtags.length) clip.hashtags = g.hashtags;
        await updateClip(meta.id, { caption: clip.caption, hashtags: clip.hashtags });
      } catch (e) {
        console.warn('AI caption fallback failed', e);
      }
    }

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
        productId: clip.productId,
        autoSubmit: settings.autoSubmit,
        dryRun: settings.dryRun,
        selectors,
      },
    });

    if (res?.ok) {
      const label = settings.dryRun ? '(dry-run) ' + (res.note || '') : settings.autoSubmit ? 'โพสต์แล้ว' : 'เติมข้อมูลครบ รอกดโพสต์';
      await updateClip(meta.id, {
        status: settings.dryRun ? 'queued' : settings.autoSubmit ? 'posted' : 'skipped',
        postedAt: settings.autoSubmit && !settings.dryRun ? Date.now() : null,
        lastError: settings.dryRun ? '(dry-run) ' + (res.note || '') : res.note || '',
      });
      notify('โพสต์คลิป', `${ch}${clip.name}: ${label}`);
      if (!settings.dryRun) await tg(`✅ <b>${ch}${esc(clip.name)}</b>\n${esc(label)}`);
    } else {
      await updateClip(meta.id, { status: 'failed', lastError: res?.error || 'ไม่ทราบสาเหตุ' });
      notify('โพสต์ไม่สำเร็จ', `${ch}${clip.name}: ${res?.error || ''}`);
      await tg(`❌ <b>${ch}${esc(clip.name)}</b>\nโพสต์ไม่สำเร็จ: ${esc(res?.error || '')}`);
    }
  } catch (e) {
    await updateClip(meta.id, { status: 'failed', lastError: String(e) });
    notify('โพสต์ผิดพลาด', `${ch}${clip.name}: ${e}`);
    await tg(`⚠️ <b>${ch}${esc(clip.name)}</b>\nผิดพลาด: ${esc(String(e))}`);
  }
}

async function tg(text) {
  const t = await getStore('telegram', {});
  if (!t.enabled || !t.token || !t.chatId) return;
  await sendTelegram({ token: t.token, chatId: t.chatId, text }).catch(() => {});
}

function esc(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
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
