// หน้าต่างเล็กที่เด้งขึ้นเมื่อกดไอคอนส่วนขยายบนแถบเครื่องมือ
const statusEl = document.getElementById('status');
const toggleBtn = document.getElementById('toggle');
const openBtn = document.getElementById('open');
const LIVE_URL = 'https://livecenter.tiktok.com/live_monitor';

function setStatus(text, cls) {
  statusEl.textContent = text;
  statusEl.className = cls || '';
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function ask(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (res) => {
      if (chrome.runtime.lastError) resolve(null);
      else resolve(res);
    });
  });
}

(async function init() {
  const tab = await activeTab();
  const url = (tab && tab.url) || '';

  if (!/^https:\/\/[^/]*tiktok\.com\//.test(url)) {
    setStatus('หน้านี้ไม่ใช่เว็บ TikTok — กดปุ่มด้านล่างเพื่อเปิดคอนโซล LIVE', 'warn');
    return;
  }

  const res = await ask(tab.id, { type: 'ttlh:ping' });
  if (!res) {
    // ส่วนขยายเพิ่งติดตั้ง แท็บนี้ยังไม่ได้โหลดสคริปต์เข้าไป
    setStatus('หน้านี้เปิดค้างอยู่ก่อนติดตั้งส่วนขยาย — กด F5 รีเฟรชหน้าหนึ่งครั้ง', 'warn');
    return;
  }

  toggleBtn.disabled = false;
  toggleBtn.textContent = res.mounted ? 'ซ่อนแผงควบคุม' : 'เปิดแผงควบคุมในหน้านี้';
  setStatus(res.mounted ? 'แผงควบคุมเปิดอยู่ที่มุมขวาล่างของหน้า' : 'พร้อมใช้งาน — กดปุ่มด้านล่างเพื่อเปิดแผง', 'ok');

  toggleBtn.addEventListener('click', async () => {
    const next = await ask(tab.id, { type: 'ttlh:toggle' });
    if (!next) return;
    toggleBtn.textContent = next.mounted ? 'ซ่อนแผงควบคุม' : 'เปิดแผงควบคุมในหน้านี้';
    setStatus(next.mounted ? 'เปิดแผงควบคุมแล้ว ดูที่มุมขวาล่างของหน้า' : 'ซ่อนแผงควบคุมแล้ว', 'ok');
  });
})();

openBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: LIVE_URL });
  window.close();
});
