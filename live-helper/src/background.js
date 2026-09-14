/* eslint-env serviceworker */
// Service worker: เป็นตัวเดียวที่คุยกับ AI (Claude หรือ OpenAI)
// (คีย์เก็บใน chrome.storage ของส่วนขยาย ไม่ถูกส่งเข้าไปในหน้าเว็บ TikTok)
importScripts('/src/core.js');

const core = self.TTLH.core;
const ANTHROPIC_VERSION = '2023-06-01';
const SETTINGS_KEY = 'ttlh:settings';

async function loadAi() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return core.normalizeSettings(stored[SETTINGS_KEY]).ai;
}

function headersFor(provider, key) {
  if (provider.name === 'openai') {
    return { 'content-type': 'application/json', authorization: 'Bearer ' + key };
  }
  return {
    'content-type': 'application/json',
    'x-api-key': key,
    'anthropic-version': ANTHROPIC_VERSION,
    'anthropic-dangerous-direct-browser-access': 'true',
  };
}

function describeError(status, detail, provider) {
  if (status === 401 || status === 403) return 'API key ของ ' + provider.label + ' ไม่ถูกต้อง (' + status + ')';
  if (status === 429) return 'เรียกถี่เกินโควตา (429) — ลดจำนวนตอบต่อนาที หรือเช็กเครดิตคงเหลือ';
  if (status === 404) return 'ไม่พบรุ่น "' + provider.model + '" — เช็กชื่อรุ่นในแท็บตั้งค่า (404)';
  return 'HTTP ' + status + ': ' + detail;
}

async function post(url, headers, body) {
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  let data = null;
  try { data = await res.json(); } catch (err) { data = null; }
  return { res, data };
}

async function askAI({ system, user }) {
  const ai = await loadAi();
  const provider = core.activeProvider(ai);
  if (!provider.key) {
    return { ok: false, error: 'ยังไม่ได้ใส่ API key ของ ' + provider.label + ' (ไปที่แท็บ "ตั้งค่า")' };
  }

  const headers = headersFor(provider, provider.key);
  const body = core.buildRequestBody(provider.name, {
    model: provider.model, system, user,
  });

  let result;
  try {
    result = await post(provider.url, headers, body);
  } catch (err) {
    return { ok: false, error: 'ต่อเน็ตไม่ได้: ' + (err && err.message ? err.message : String(err)) };
  }

  let { res, data } = result;

  // บางรุ่นของ OpenAI เลิกรับ max_tokens แล้วใช้ max_completion_tokens แทน — ลองซ้ำให้อัตโนมัติ
  const detail = (data && data.error && data.error.message) || '';
  if (!res.ok && provider.name === 'openai' && /max_tokens/i.test(detail) && body.max_tokens) {
    const retry = Object.assign({}, body);
    retry.max_completion_tokens = retry.max_tokens;
    delete retry.max_tokens;
    try {
      ({ res, data } = await post(provider.url, headers, retry));
    } catch (err) {
      return { ok: false, error: 'ต่อเน็ตไม่ได้: ' + (err && err.message ? err.message : String(err)) };
    }
  }

  if (!res.ok) {
    const message = (data && data.error && data.error.message) || res.statusText;
    return { ok: false, error: describeError(res.status, message, provider) };
  }
  // ระบบความปลอดภัยของโมเดลอาจปฏิเสธคำขอ — ตอบกลับ 200 พร้อม stop_reason = refusal
  if (data && data.stop_reason === 'refusal') return { ok: true, text: 'SKIP' };
  return { ok: true, text: core.extractText(provider.name, data) };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return false;

  if (message.type === 'ttlh:ai') {
    askAI({ system: message.system, user: message.user }).then(sendResponse);
    return true; // ตอบแบบ async
  }
  if (message.type === 'ttlh:notify') {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: '/icons/icon128.png',
      title: message.title || 'ผู้ช่วยไลฟ์ TikTok',
      message: message.body || '',
      priority: 2,
      requireInteraction: true,
    });
    sendResponse({ ok: true });
    return false;
  }
  if (message.type === 'ttlh:test') {
    askAI({ system: 'ตอบสั้นที่สุด', user: 'ตอบกลับคำว่า พร้อมใช้งาน เฉย ๆ' }).then(sendResponse);
    return true;
  }
  return false;
});
