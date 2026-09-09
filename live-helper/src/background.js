/* eslint-env serviceworker */
// Service worker: เป็นตัวเดียวที่คุยกับ Claude API
// (คีย์เก็บใน chrome.storage ของส่วนขยาย ไม่ถูกส่งเข้าไปในหน้าเว็บ TikTok)
importScripts('/src/core.js');

const core = self.TTLH.core;
const ANTHROPIC_VERSION = '2023-06-01';
const SETTINGS_KEY = 'ttlh:settings';

async function loadAi() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return core.normalizeSettings(stored[SETTINGS_KEY]).ai;
}

async function callClaude({ system, user }) {
  const ai = await loadAi();
  if (!ai.apiKey) return { ok: false, error: 'ยังไม่ได้ใส่ API key (ไปที่แท็บ "ตั้งค่า")' };

  const body = core.buildRequestBody({ model: ai.model, system, user });
  let res;
  try {
    res = await fetch(ai.apiBase + '/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': ai.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { ok: false, error: 'ต่อเน็ตไม่ได้: ' + (err && err.message ? err.message : String(err)) };
  }

  let data = null;
  try { data = await res.json(); } catch (err) { data = null; }

  if (!res.ok) {
    const detail = (data && data.error && data.error.message) || res.statusText;
    if (res.status === 401) return { ok: false, error: 'API key ไม่ถูกต้อง (401)' };
    if (res.status === 429) return { ok: false, error: 'เรียกถี่เกินโควตา (429) — ลดจำนวนตอบต่อนาที' };
    return { ok: false, error: 'HTTP ' + res.status + ': ' + detail };
  }
  // ระบบความปลอดภัยของโมเดลอาจปฏิเสธคำขอ — ตอบกลับ 200 พร้อม stop_reason = refusal
  if (data && data.stop_reason === 'refusal') return { ok: true, text: 'SKIP' };
  return { ok: true, text: core.extractText(data) };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return false;

  if (message.type === 'ttlh:ai') {
    callClaude({ system: message.system, user: message.user }).then(sendResponse);
    return true; // ตอบแบบ async
  }
  if (message.type === 'ttlh:test') {
    callClaude({
      system: 'ตอบสั้นที่สุด',
      user: 'ตอบกลับคำว่า พร้อมใช้งาน เฉย ๆ',
    }).then(sendResponse);
    return true;
  }
  return false;
});
