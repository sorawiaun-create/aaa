// content-upload.js — ทำงานในหน้า tiktok.com/upload
// รับคำสั่ง POST_CLIP จาก background แล้วขับ DOM: ใส่ไฟล์ → ใส่แคปชั่น → ปักตะกร้า → (ถ้าเปิด) กดโพสต์
//
// ⚠️ สำคัญ: TikTok เปลี่ยนหน้า/โครงสร้าง DOM บ่อย selector ด้านล่างเป็น "ค่าเริ่มต้นที่พยายามให้ยืดหยุ่น"
// แต่มีโอกาสต้องปรับให้ตรงกับหน้าจริง — ดูวิธีปรับใน README (โหมด dry-run + inspectCandidates)

(() => {
  if (window.__ttSchedulerLoaded) return;
  window.__ttSchedulerLoaded = true;

  const VER = (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || '?';
  console.log('%c[tt-scheduler] content script พร้อมแล้ว v' + VER, 'color:#22c55e;font-weight:bold', 'ที่หน้า', location.pathname);

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    console.log('[tt-scheduler] ได้รับคำสั่ง:', msg?.type);
    if (msg?.type === 'POST_CLIP') {
      runPost(msg.job)
        .then((r) => sendResponse(r))
        .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
      return true; // async
    }
    if (msg?.type === 'INSPECT') {
      sendResponse({ ok: true, candidates: inspectCandidates() });
      return true;
    }
  });

  // selector ค่าเริ่มต้น — ปรับทับได้จากการ์ด "ปรับ selector" ในแผง (job.selectors)
  const DEFAULT_CFG = {
    fileSelector: 'input[type="file"][accept*="video"], input[type="file"]',
    captionSelector:
      'div[contenteditable="true"], div[contenteditable="plaintext-only"], [contenteditable]:not([contenteditable="false"]), .public-DraftEditor-content, .DraftEditor-editorContainer [contenteditable], [data-e2e*="caption"] [contenteditable], textarea',
    searchSelector: 'input[placeholder*="ค้นหา"], input[placeholder*="Search"], input[type="search"]',
    productTexts: ['เพิ่มลิงก์', 'เพิ่มสินค้า', 'สินค้า', 'Add link', 'Add product', 'Products', 'Showcase'],
    addTexts: ['เพิ่ม', 'Add', 'เลือก', 'Select'],
    confirmTexts: ['ยืนยัน', 'เสร็จ', 'Confirm', 'Done', 'ตกลง', 'OK'],
    postTexts: ['โพสต์', 'เผยแพร่', 'Post', 'Publish'],
  };
  function mergeCfg(over) {
    const o = over || {};
    const arr = (k) => (Array.isArray(o[k]) && o[k].length ? o[k] : DEFAULT_CFG[k]);
    return {
      fileSelector: o.fileSelector || DEFAULT_CFG.fileSelector,
      captionSelector: o.captionSelector || DEFAULT_CFG.captionSelector,
      searchSelector: o.searchSelector || DEFAULT_CFG.searchSelector,
      productTexts: arr('productTexts'),
      addTexts: arr('addTexts'),
      confirmTexts: arr('confirmTexts'),
      postTexts: arr('postTexts'),
    };
  }

  async function runPost(job) {
    const log = [];
    const note = (m) => (log.push(m), console.log('[tt-scheduler]', m));
    const cfg = mergeCfg(job.selectors);

    // 1) หา input ไฟล์วิดีโอ แล้วยัดไฟล์เข้าไป
    const input = await waitFor(() => document.querySelector(cfg.fileSelector), 15000);
    if (!input) return { ok: false, error: 'หา input อัปโหลดไฟล์ไม่เจอ (หน้าอาจยังไม่โหลด/เปลี่ยนโครงสร้าง)' };

    const bytes = b64ToUint8(job.bytesB64 || '');
    if (!bytes.length) return { ok: false, error: 'ไฟล์วิดีโอว่าง (ส่งข้อมูลไม่ถึง) — ลองใหม่' };
    const file = new File([bytes], job.name || 'clip.mp4', { type: job.mime || 'video/mp4' });
    note(`เตรียมไฟล์ ${(bytes.length / 1048576).toFixed(1)}MB`);

    // วิธีที่ 1: ใส่เข้า input โดยตรง + ยิง change
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));

    // วิธีที่ 2 (สำรอง): จำลอง drag & drop ลง drop zone เผื่อ TikTok ฟัง event drop
    const dropZone = input.closest('div') || input.parentElement || document.body;
    const dt2 = new DataTransfer();
    dt2.items.add(file);
    for (const type of ['dragenter', 'dragover', 'drop']) {
      dropZone.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt2 }));
    }
    note('ใส่ไฟล์วิดีโอแล้ว (input + drop)');

    // 2) รอ editor (ช่องแคปชั่น) ขึ้น — เลือกอันที่ "มองเห็นได้" ตัวแรก
    const caption = await waitFor(() => pickVisible(cfg.captionSelector), 90000);
    if (!caption) return { ok: false, error: 'อัปโหลดแล้วแต่หาช่องแคปชั่นไม่เจอ (ลองกด 🔍 ตรวจหน้า TikTok ในการ์ด selector ตอนหน้าตัดต่อขึ้นแล้ว ส่งผลมาให้)' };
    note('เจอช่องแคปชั่นแล้ว');

    // 3) ใส่แคปชั่น
    if (job.caption) {
      if (!job.dryRun) setEditableText(caption, job.caption);
      note('ใส่แคปชั่นแล้ว');
    }

    // 4) ปักตะกร้า (best-effort) — บัญชีต้องมีสิทธิ์ Shop/Affiliate อยู่แล้ว
    if (job.productKeyword || job.productId) {
      const r = await tryTagProduct(job, note, cfg);
      if (r === 'skip-notfound')
        return { ok: false, error: 'ไม่เจอสินค้าที่ตรง (กันปักผิด) — เช็กชื่อ/รหัสสินค้า แล้วลองใหม่' };
      if (!r) note('⚠️ ปักตะกร้าไม่สำเร็จอัตโนมัติ — อาจต้องเลือกสินค้าด้วยมือ');
    }

    // 5) โพสต์ (ถ้าเปิด autoSubmit และไม่ใช่ dry-run)
    if (job.autoSubmit && !job.dryRun) {
      const posted = await tryClickPost(note, cfg);
      if (!posted) return { ok: false, error: 'เติมข้อมูลครบแต่กดปุ่มโพสต์ไม่สำเร็จ' };
      return { ok: true, note: 'โพสต์แล้ว | ' + log.join(' · ') };
    }

    return { ok: true, note: (job.dryRun ? '(dry-run) ' : 'เติมข้อมูลครบ รอกดโพสต์ | ') + log.join(' · ') };
  }

  // ---------- ปักตะกร้าสินค้า ----------
  // job: { productKeyword, productId, dryRun }
  // คืน true=ปักแล้ว, false=ทำไม่ได้(หาปุ่ม/ช่องไม่เจอ), 'skip-notfound'=ไม่เจอตัวที่ตรง (กันปักผิด)
  async function tryTagProduct(job, note, cfg) {
    const keyword = job.productKeyword || '';
    const productId = (job.productId || '').trim();

    const addBtn = findByText(cfg.productTexts, ['button', 'div[role="button"]', 'span', 'a']);
    if (!addBtn) return false;
    if (job.dryRun) {
      note('(dry-run) เจอปุ่มเพิ่มสินค้า — จะค้นด้วย: ' + (productId ? 'ID ' + productId : keyword));
      return true;
    }
    addBtn.click();
    await delay(1200);

    // ช่องค้นหาสินค้า → พิมพ์รหัส (แม่นสุด) หรือคำค้น
    const search = await waitFor(() => document.querySelector(cfg.searchSelector), 6000);
    if (!search) return false;
    setInputValue(search, productId || keyword);
    await delay(2200);

    // เลือกแถวผลลัพธ์ที่ "ตรง" เท่านั้น — ไม่กดอันแรกมั่ว
    const row = findProductRow(productId, keyword);
    if (!row) {
      // ปิด dialog แล้วรายงานว่าไม่เจอ (ปลอดภัยกว่าปักผิด)
      note('ไม่เจอสินค้าที่ตรงกับ: ' + (productId ? 'ID ' + productId : keyword));
      return 'skip-notfound';
    }
    // กดปุ่ม เพิ่ม/เลือก ที่อยู่ในแถวนั้น (fallback: ปุ่มที่ใกล้ที่สุด)
    const addInRow = buttonInside(row, cfg.addTexts) || nearestButton(row, cfg.addTexts);
    if (!addInRow) return false;
    addInRow.click();
    await delay(800);

    const confirm = findByText(cfg.confirmTexts, ['button', 'div[role="button"]']);
    if (confirm) confirm.click();
    note('ปักตะกร้าสินค้า: ' + (productId ? 'ID ' + productId : keyword));
    return true;
  }

  // หาแถวสินค้าที่ตรง: ถ้ามี productId ต้องเจอ id นั้นใน text/attribute; ไม่งั้นใช้ชื่อตรง (case-insensitive)
  function findProductRow(productId, keyword) {
    const rows = document.querySelectorAll('li, tr, div[role="listitem"], div[role="option"], div[class*="item"], div[class*="product"]');
    const kw = keyword.trim().toLowerCase();
    let nameMatch = null;
    for (const el of rows) {
      const txt = (el.textContent || '').toLowerCase();
      const html = el.outerHTML || '';
      if (productId) {
        if (txt.includes(productId.toLowerCase()) || html.includes(productId)) return el; // ID ตรง = ชนะทันที
      }
      if (!nameMatch && kw && txt.includes(kw) && txt.length < 400) nameMatch = el;
    }
    return productId ? null : nameMatch; // ถ้ากำหนด ID แต่ไม่เจอ = ไม่ปัก
  }

  function buttonInside(row, texts) {
    for (const b of row.querySelectorAll('button, div[role="button"], a')) {
      const t = (b.textContent || '').trim().toLowerCase();
      if (texts.some((w) => t.includes(w.toLowerCase()))) return b;
    }
    return null;
  }
  function nearestButton(row, texts) {
    let p = row;
    for (let i = 0; i < 4 && p; i++, p = p.parentElement) {
      const b = buttonInside(p, texts);
      if (b) return b;
    }
    return null;
  }

  // ---------- กดปุ่มโพสต์ ----------
  async function tryClickPost(note, cfg) {
    const btn = findByText(cfg.postTexts, ['button', 'div[role="button"]']);
    if (!btn) return false;
    // ข้ามปุ่มที่ยัง disabled
    if (btn.getAttribute('aria-disabled') === 'true' || btn.disabled) {
      await delay(1500);
    }
    btn.click();
    note('กดปุ่มโพสต์');
    await delay(1500);
    return true;
  }

  // ---------- ตัวช่วย DOM ----------
  function setEditableText(el, text) {
    el.focus();
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      setInputValue(el, text);
      return;
    }
    // contenteditable (DraftJS ฯลฯ) — ใช้ execCommand เพื่อให้ event ครบ
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand('insertText', false, text);
  }

  function setInputValue(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    setter ? setter.call(el, value) : (el.value = value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function b64ToUint8(b64) {
    if (!b64) return new Uint8Array(0);
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }

  function pickVisible(selector) {
    for (const el of document.querySelectorAll(selector)) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return el; // มองเห็นได้จริง
    }
    return null;
  }

  function findByText(texts, selectors) {
    const wants = texts.map((t) => t.toLowerCase());
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        const t = (el.textContent || '').trim().toLowerCase();
        if (!t || t.length > 40) continue;
        if (wants.some((w) => t === w || t.includes(w))) return el;
      }
    }
    return null;
  }

  function inspectCandidates() {
    // ไว้ debug: คืน element ที่น่าจะเกี่ยวข้อง เพื่อช่วยปรับ selector
    const desc = (e) => {
      const r = e.getBoundingClientRect();
      return {
        tag: e.tagName.toLowerCase(),
        editable: e.getAttribute('contenteditable') || '',
        placeholder: e.getAttribute('placeholder') || '',
        e2e: e.getAttribute('data-e2e') || '',
        cls: (e.className?.toString?.() || '').slice(0, 60),
        text: (e.textContent || '').trim().slice(0, 25),
        visible: r.width > 0 && r.height > 0,
      };
    };
    const grab = (sel, n = 10) => Array.from(document.querySelectorAll(sel)).slice(0, n).map(desc);
    return {
      fileInputs: grab('input[type="file"]'),
      editables: grab('[contenteditable]:not([contenteditable="false"]), textarea'),
      buttons: grab('button, div[role="button"]', 20).filter((b) => b.text),
    };
  }

  function waitFor(fn, timeoutMs) {
    return new Promise((resolve) => {
      const start = Date.now();
      const iv = setInterval(() => {
        let v = null;
        try {
          v = fn();
        } catch {}
        if (v) {
          clearInterval(iv);
          resolve(v);
        } else if (Date.now() - start > timeoutMs) {
          clearInterval(iv);
          resolve(null);
        }
      }, 400);
    });
  }

  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
})();
