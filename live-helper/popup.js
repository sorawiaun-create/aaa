// หน้าต่างเล็กที่เด้งขึ้นเมื่อกดไอคอนส่วนขยายบนแถบเครื่องมือ
const statusEl = document.getElementById('status');
try { document.getElementById('ver').textContent = 'v' + chrome.runtime.getManifest().version; } catch (err) { /* ข้าม */ }
const toggleBtn = document.getElementById('toggle');
const rememberBtn = document.getElementById('remember');
const openBtn = document.getElementById('open');
const savedEl = document.getElementById('saved');

const URL_KEY = 'ttlh:consoleUrl';
// ที่อยู่คอนโซล LIVE ต่างกันตามประเทศ/บัญชี อันนี้เป็นแค่ค่าตั้งต้น
// ผู้ใช้กด "จำหน้านี้ไว้" ทับได้เสมอ
const DEFAULT_URL = 'https://seller-th.tiktok.com/livecenter';

function setStatus(text, cls) {
  statusEl.textContent = text;
  statusEl.className = cls || '';
}

function ask(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (res) => {
      resolve(chrome.runtime.lastError ? null : res);
    });
  });
}

async function savedUrl() {
  const stored = await chrome.storage.local.get(URL_KEY);
  return stored[URL_KEY] || DEFAULT_URL;
}

async function showSaved() {
  const url = await savedUrl();
  savedEl.textContent = 'หน้าที่บันทึกไว้: ' + url;
}

(async function init() {
  showSaved();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = (tab && tab.url) || '';
  let host = '';
  try { host = new URL(url).host; } catch (err) { host = ''; }

  if (!/(^|\.)(tiktok\.com|tiktokglobalshop\.com)$/.test(host)) {
    setStatus(host
      ? 'หน้านี้คือ ' + host + ' ซึ่งยังไม่อยู่ในรายการที่ส่วนขยายทำงาน'
      : 'เปิดหน้าคอนโซล LIVE ของ TikTok ก่อนครับ', 'warn');
    return;
  }

  rememberBtn.hidden = false;
  rememberBtn.addEventListener('click', async () => {
    await chrome.storage.local.set({ [URL_KEY]: url });
    showSaved();
    setStatus('บันทึกหน้านี้เป็นคอนโซล LIVE แล้ว', 'ok');
  });

  const res = await ask(tab.id, { type: 'ttlh:ping' });
  if (!res) {
    // แท็บนี้ถูกเปิดค้างไว้ตั้งแต่ก่อนติดตั้ง Chrome จึงยังไม่ฉีดสคริปต์เข้าไป
    setStatus('หน้านี้เปิดค้างอยู่ก่อนติดตั้งส่วนขยาย — กด F5 รีเฟรชหน้าหนึ่งครั้ง', 'warn');
    return;
  }

  toggleBtn.disabled = false;
  toggleBtn.textContent = res.mounted ? 'ซ่อนแผงควบคุม' : 'เปิดแผงควบคุมในหน้านี้';
  setStatus(res.mounted
    ? 'แผงควบคุมเปิดอยู่ที่มุมขวาล่างของหน้า'
    : 'พร้อมใช้งาน — กดปุ่มด้านล่างเพื่อเปิดแผง', 'ok');

  toggleBtn.addEventListener('click', async () => {
    const next = await ask(tab.id, { type: 'ttlh:toggle' });
    if (!next) return;
    toggleBtn.textContent = next.mounted ? 'ซ่อนแผงควบคุม' : 'เปิดแผงควบคุมในหน้านี้';
    setStatus(next.mounted ? 'เปิดแผงควบคุมแล้ว ดูที่มุมขวาล่างของหน้า' : 'ซ่อนแผงควบคุมแล้ว', 'ok');
  });
})();

openBtn.addEventListener('click', async () => {
  chrome.tabs.create({ url: await savedUrl() });
  window.close();
});
