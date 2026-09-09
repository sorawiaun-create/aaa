// แผงควบคุมในหน้า TikTok LIVE Manager — ประกอบ UI + ผูกค่ากับ chrome.storage + สั่งงานเครื่องทั้งสอง
(function boot(root) {
  'use strict';
  const { core, dom, createAutoPin, createAutoReply } = root.TTLH;
  const SETTINGS_KEY = 'ttlh:settings';

  let settings = core.normalizeSettings(null);
  let saveTimer = null;

  function getSettings() { return settings; }

  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      chrome.storage.local.set({ [SETTINGS_KEY]: settings });
    }, 250);
  }

  // ---------- โครง UI ----------
  const panel = document.createElement('div');
  panel.className = 'ttlh-panel';
  panel.innerHTML = `
    <div class="ttlh-head" data-drag>
      <b>ผู้ช่วยไลฟ์ · ปักหมุด + AI ตอบคอมเมนต์</b>
      <button data-act="min" title="ย่อ/ขยาย">–</button>
    </div>
    <div class="ttlh-tabs">
      <button data-tab="pin" class="on">ปักหมุด</button>
      <button data-tab="ai">AI ตอบแชท</button>
      <button data-tab="cfg">ตั้งค่า</button>
      <button data-tab="log">บันทึก</button>
    </div>
    <div class="ttlh-body">
      <div class="ttlh-tab on" data-pane="pin">
        <div class="ttlh-status" data-pin-status>ยังไม่เริ่มทำงาน</div>
        <div class="ttlh-row"><label>ปักหมุดตะกร้าที่</label><input type="number" min="1" max="200" data-k="pin.basket"></div>
        <div class="ttlh-row"><label>ปักซ้ำทุก (วินาที)</label><input type="number" min="15" max="3600" step="5" data-k="pin.intervalSec"></div>
        <div class="ttlh-row">
          <button class="ttlh-btn" data-preset="30">30 วิ</button>
          <button class="ttlh-btn" data-preset="60">1 นาที</button>
          <button class="ttlh-btn" data-preset="120">2 นาที</button>
        </div>
        <label class="ttlh-check"><input type="checkbox" data-k="pin.extendWhenPinned"> ถ้าปักอยู่แล้วให้กดต่อเวลาแทน</label>
        <label class="ttlh-check"><input type="checkbox" data-k="pin.dryRun"> โหมดซ้อม (ไม่คลิกจริง)</label>
        <div class="ttlh-row">
          <button class="ttlh-btn main" data-act="pin-toggle">เริ่มปักหมุดอัตโนมัติ</button>
          <button class="ttlh-btn" data-act="pin-now">ปักเดี๋ยวนี้</button>
        </div>
        <div class="ttlh-row"><button class="ttlh-btn" data-pick="pinButton">จิ้มเลือกปุ่ม "ปักหมุด" เอง</button></div>
        <p class="ttlh-note">ขั้นต่ำ 15 วินาที เพื่อลดความเสี่ยงถูกระบบมองว่าสแปม</p>
      </div>

      <div class="ttlh-tab" data-pane="ai">
        <div class="ttlh-status" data-ai-status>ยังไม่เริ่มทำงาน</div>
        <label class="ttlh-check"><input type="checkbox" data-k="ai.dryRun"> โหมดร่าง (ให้ AI คิดคำตอบแต่ยังไม่ส่ง)</label>
        <label class="ttlh-check"><input type="checkbox" data-k="ai.onlyQuestions"> ตอบเฉพาะคอมเมนต์ที่เป็นคำถาม</label>
        <div class="ttlh-row"><label>ตอบได้ไม่เกิน (ข้อความ/นาที)</label><input type="number" min="1" max="30" data-k="ai.replyPerMin"></div>
        <div class="ttlh-row"><label>คนเดิมเว้น (วินาที)</label><input type="number" min="0" max="3600" step="10" data-k="ai.userCooldownSec"></div>
        <div class="ttlh-row"><label>ความยาวคำตอบไม่เกิน</label><input type="number" min="20" max="100" data-k="ai.maxChars"></div>
        <label>โทนการพูด</label>
        <textarea data-k="ai.tone"></textarea>
        <label>กติกาเพิ่มเติม (โปร ค่าส่ง ของแถม ฯลฯ)</label>
        <textarea data-k="ai.extraRules" placeholder="เช่น ส่งฟรีเมื่อซื้อครบ 300 / เก็บเงินปลายทางได้"></textarea>
        <label>คำที่ถือว่าเป็นข้อความระบบ (คั่นด้วย , )</label>
        <textarea data-k="ai.ignoreWords"></textarea>
        <label>คำต้องห้าม เจอแล้วไม่ตอบ (คั่นด้วย , )</label>
        <textarea data-k="ai.blockWords"></textarea>
        <div class="ttlh-row"><button class="ttlh-btn main" data-act="ai-toggle">เริ่ม AI ตอบคอมเมนต์</button></div>
        <div class="ttlh-row">
          <button class="ttlh-btn" data-pick="chatList">จิ้มเลือกกล่องแชท</button>
          <button class="ttlh-btn" data-pick="chatInput">จิ้มเลือกช่องพิมพ์</button>
        </div>
      </div>

      <div class="ttlh-tab" data-pane="cfg">
        <div class="ttlh-row"><label>Claude API key</label><input type="password" data-k="ai.apiKey" placeholder="sk-ant-..."></div>
        <div class="ttlh-row"><label>โมเดล</label>
          <select data-k="ai.model">
            <option value="claude-opus-5">Opus 5 (ฉลาดสุด)</option>
            <option value="claude-sonnet-5">Sonnet 5 (สมดุล)</option>
            <option value="claude-haiku-4-5">Haiku 4.5 (เร็ว/ถูก)</option>
          </select>
        </div>
        <div class="ttlh-row"><label>ชื่อร้าน</label><input type="text" data-k="ai.shopName"></div>
        <div class="ttlh-row"><label>API base</label><input type="text" data-k="ai.apiBase"></div>
        <div class="ttlh-row">
          <button class="ttlh-btn main" data-act="test">ทดสอบการเชื่อมต่อ</button>
          <button class="ttlh-btn" data-act="reset">ล้างค่าทั้งหมด</button>
        </div>
        <p class="ttlh-note">คีย์ถูกเก็บไว้ในเครื่องคุณ (chrome.storage) และถูกใช้เฉพาะใน service worker ของส่วนขยาย ไม่ถูกส่งให้ TikTok</p>
      </div>

      <div class="ttlh-tab" data-pane="log">
        <div class="ttlh-row"><button class="ttlh-btn" data-act="clear-log">ล้างบันทึก</button></div>
        <ul class="ttlh-log" data-log></ul>
      </div>
    </div>`;

  const $ = (sel) => panel.querySelector(sel);
  const logEl = $('[data-log]');

  function log(level, message) {
    const li = document.createElement('li');
    li.className = level;
    const time = new Date().toLocaleTimeString('th-TH', { hour12: false });
    li.innerHTML = '<time></time><span></span>';
    li.querySelector('time').textContent = time;
    li.querySelector('span').textContent = message;
    logEl.prepend(li);
    while (logEl.children.length > 200) logEl.lastElementChild.remove();
  }

  // ---------- ผูกค่าใน settings กับช่องกรอก ----------
  function readPath(path) {
    return path.split('.').reduce((obj, key) => (obj == null ? obj : obj[key]), settings);
  }
  function writePath(path, value) {
    const keys = path.split('.');
    const last = keys.pop();
    const target = keys.reduce((obj, key) => obj[key], settings);
    target[last] = value;
  }

  function fillFields() {
    panel.querySelectorAll('[data-k]').forEach((el) => {
      const value = readPath(el.dataset.k);
      if (el.type === 'checkbox') el.checked = !!value;
      else if (Array.isArray(value)) el.value = value.join(', ');
      else el.value = value == null ? '' : value;
    });
  }

  function bindFields() {
    panel.querySelectorAll('[data-k]').forEach((el) => {
      const handler = () => {
        const path = el.dataset.k;
        let value;
        if (el.type === 'checkbox') value = el.checked;
        else if (el.type === 'number') value = Number(el.value);
        else if (el.tagName === 'TEXTAREA' && Array.isArray(readPath(path))) value = core.toWordList(el.value);
        else value = el.value;
        writePath(path, value);
        settings = core.normalizeSettings(settings);
        save();
      };
      el.addEventListener('change', handler);
      if (el.tagName === 'TEXTAREA' || el.type === 'text' || el.type === 'password') {
        el.addEventListener('input', handler);
      }
    });
  }

  // ---------- เครื่องทำงาน ----------
  function askAI(payload) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'ttlh:ai', system: payload.system, user: payload.user }, (res) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(res || { ok: false, error: 'ไม่มีคำตอบกลับมาจากส่วนขยาย' });
      });
    });
  }

  const autoPin = createAutoPin({
    getSettings,
    log,
    onStatus(state) {
      const el = $('[data-pin-status]');
      if (!state.running) { el.textContent = 'ปิดอยู่'; return; }
      el.innerHTML = 'กำลังทำงาน · สินค้าที่ <b>' + settings.pin.basket + '</b> · '
        + (state.pinned ? 'ปักหมุดอยู่' : 'ยังไม่ปัก') + ' · รอบถัดไปอีก <b>' + state.nextIn + '</b> วิ';
    },
  });

  const autoReply = createAutoReply({
    getSettings,
    log,
    askAI,
    onStatus(state) {
      const el = $('[data-ai-status]');
      if (!state.running) { el.textContent = 'ปิดอยู่'; return; }
      el.innerHTML = 'กำลังฟังแชท · คิว <b>' + state.queue + '</b> · ตอบแล้ว <b>' + state.replied
        + '</b> · ข้าม <b>' + state.skipped + '</b>' + (settings.ai.dryRun ? ' · โหมดร่าง' : '');
    },
  });

  function syncToggle(selector, running, onText, offText) {
    const btn = $(selector);
    btn.textContent = running ? offText : onText;
    btn.classList.toggle('stop', running);
  }

  // ---------- ปุ่มต่าง ๆ ----------
  panel.addEventListener('click', async (ev) => {
    const target = ev.target.closest('[data-act], [data-tab], [data-preset], [data-pick]');
    if (!target) return;

    if (target.dataset.tab) {
      panel.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b === target));
      panel.querySelectorAll('[data-pane]').forEach((p) => p.classList.toggle('on', p.dataset.pane === target.dataset.tab));
      return;
    }

    if (target.dataset.preset) {
      settings.pin.intervalSec = Number(target.dataset.preset);
      settings = core.normalizeSettings(settings);
      fillFields();
      save();
      log('info', 'ตั้งรอบปักหมุดเป็นทุก ' + settings.pin.intervalSec + ' วินาที');
      return;
    }

    if (target.dataset.pick) {
      const key = target.dataset.pick;
      log('info', 'จิ้มเลือกตำแหน่งบนหน้าจอ (กด Esc เพื่อยกเลิก)');
      panel.style.opacity = '.25';
      dom.startPicker((selector) => {
        panel.style.opacity = '';
        if (!selector) { log('warn', 'ยกเลิกการเลือก'); return; }
        settings.selectors[key] = selector;
        save();
        log('ok', 'จำตำแหน่ง ' + key + ' แล้ว: ' + selector);
      });
      return;
    }

    switch (target.dataset.act) {
      case 'min':
        panel.classList.toggle('min');
        target.textContent = panel.classList.contains('min') ? '+' : '–';
        break;
      case 'pin-toggle':
        if (autoPin.isRunning()) { settings.pin.enabled = false; autoPin.stop(); }
        else { settings.pin.enabled = true; autoPin.start(); }
        save();
        syncToggle('[data-act="pin-toggle"]', autoPin.isRunning(), 'เริ่มปักหมุดอัตโนมัติ', 'หยุดปักหมุด');
        break;
      case 'pin-now':
        autoPin.pinNow();
        break;
      case 'ai-toggle':
        if (autoReply.isRunning()) { settings.ai.enabled = false; autoReply.stop(); }
        else {
          settings.ai.enabled = true;
          if (!settings.ai.apiKey) log('warn', 'ยังไม่ได้ใส่ API key — ไปที่แท็บ "ตั้งค่า" ก่อน');
          autoReply.start();
        }
        save();
        syncToggle('[data-act="ai-toggle"]', autoReply.isRunning(), 'เริ่ม AI ตอบคอมเมนต์', 'หยุด AI ตอบคอมเมนต์');
        break;
      case 'test': {
        log('info', 'กำลังทดสอบการเชื่อมต่อ...');
        const res = await askAI({ system: 'ตอบสั้นที่สุด', user: 'ตอบกลับคำว่า พร้อมใช้งาน เฉย ๆ' });
        if (res.ok) log('ok', 'เชื่อมต่อสำเร็จ: ' + core.sanitizeReply(res.text, 100));
        else log('err', 'เชื่อมต่อไม่สำเร็จ: ' + res.error);
        break;
      }
      case 'reset':
        settings = core.normalizeSettings(null);
        fillFields();
        save();
        log('info', 'ล้างค่าทั้งหมดกลับเป็นค่าเริ่มต้นแล้ว');
        break;
      case 'clear-log':
        logEl.innerHTML = '';
        break;
      default:
        break;
    }
  });

  // ลากย้ายแผงได้
  (function draggable() {
    const head = panel.querySelector('[data-drag]');
    let startX = 0; let startY = 0; let originX = 0; let originY = 0; let dragging = false;
    head.addEventListener('mousedown', (ev) => {
      if (ev.target.tagName === 'BUTTON') return;
      const rect = panel.getBoundingClientRect();
      dragging = true;
      startX = ev.clientX; startY = ev.clientY; originX = rect.left; originY = rect.top;
      ev.preventDefault();
    });
    document.addEventListener('mousemove', (ev) => {
      if (!dragging) return;
      panel.style.left = Math.max(0, originX + ev.clientX - startX) + 'px';
      panel.style.top = Math.max(0, originY + ev.clientY - startY) + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', () => { dragging = false; });
  })();

  // ---------- เริ่มระบบ ----------
  chrome.storage.local.get(SETTINGS_KEY, (stored) => {
    settings = core.normalizeSettings(stored && stored[SETTINGS_KEY]);
    // เปิดหน้าใหม่ทุกครั้งให้เริ่มจาก "ปิด" เสมอ กันเผลอทำงานเองโดยไม่รู้ตัว
    settings.pin.enabled = false;
    settings.ai.enabled = false;
    fillFields();
    bindFields();
    document.body.appendChild(panel);
    log('info', 'พร้อมใช้งาน — เปิดคอนโซล LIVE ค้างไว้ แล้วกดเริ่มได้เลย');
  });
})(typeof window !== 'undefined' ? window : globalThis);
