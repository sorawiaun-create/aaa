// content-upload.js — ทำงานในหน้า tiktok.com/upload
// รับคำสั่ง POST_CLIP จาก background แล้วขับ DOM: ใส่ไฟล์ → ใส่แคปชั่น → ปักตะกร้า → (ถ้าเปิด) กดโพสต์
//
// ⚠️ สำคัญ: TikTok เปลี่ยนหน้า/โครงสร้าง DOM บ่อย selector ด้านล่างเป็น "ค่าเริ่มต้นที่พยายามให้ยืดหยุ่น"
// แต่มีโอกาสต้องปรับให้ตรงกับหน้าจริง — ดูวิธีปรับใน README (โหมด dry-run + inspectCandidates)

(() => {
  if (window.__ttSchedulerLoaded) return;
  window.__ttSchedulerLoaded = true;

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
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

  async function runPost(job) {
    const log = [];
    const note = (m) => (log.push(m), console.log('[tt-scheduler]', m));

    // 1) หา input ไฟล์วิดีโอ แล้วยัดไฟล์เข้าไป
    const input = await waitFor(
      () => document.querySelector('input[type="file"][accept*="video"], input[type="file"]'),
      15000
    );
    if (!input) return { ok: false, error: 'หา input อัปโหลดไฟล์ไม่เจอ (หน้าอาจยังไม่โหลด/เปลี่ยนโครงสร้าง)' };

    const file = new File([job.bytes], job.name || 'clip.mp4', { type: job.mime || 'video/mp4' });
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    note('ใส่ไฟล์วิดีโอแล้ว');

    // 2) รอ editor (ช่องแคปชั่น) ขึ้น
    const caption = await waitFor(
      () =>
        document.querySelector(
          'div[contenteditable="true"], textarea[placeholder], [data-e2e="caption"] div[contenteditable="true"]'
        ),
      60000
    );
    if (!caption) return { ok: false, error: 'อัปโหลดแล้วแต่หาช่องแคปชั่นไม่เจอ (รอ editor นานเกินไป)' };

    // 3) ใส่แคปชั่น
    if (job.caption) {
      if (!job.dryRun) setEditableText(caption, job.caption);
      note('ใส่แคปชั่นแล้ว');
    }

    // 4) ปักตะกร้า (best-effort) — บัญชีต้องมีสิทธิ์ Shop/Affiliate อยู่แล้ว
    if (job.productKeyword) {
      const tagged = await tryTagProduct(job.productKeyword, job.dryRun, note);
      if (!tagged) note('⚠️ ปักตะกร้าไม่สำเร็จอัตโนมัติ — อาจต้องเลือกสินค้าด้วยมือ');
    }

    // 5) โพสต์ (ถ้าเปิด autoSubmit และไม่ใช่ dry-run)
    if (job.autoSubmit && !job.dryRun) {
      const posted = await tryClickPost(note);
      if (!posted) return { ok: false, error: 'เติมข้อมูลครบแต่กดปุ่มโพสต์ไม่สำเร็จ' };
      return { ok: true, note: 'โพสต์แล้ว | ' + log.join(' · ') };
    }

    return { ok: true, note: (job.dryRun ? '(dry-run) ' : 'เติมข้อมูลครบ รอกดโพสต์ | ') + log.join(' · ') };
  }

  // ---------- ปักตะกร้าสินค้า ----------
  async function tryTagProduct(keyword, dryRun, note) {
    // หา section/ปุ่มที่เกี่ยวกับสินค้า จากข้อความบนปุ่ม (ไทย/อังกฤษ)
    const addBtn = findByText(
      ['เพิ่มลิงก์', 'เพิ่มสินค้า', 'สินค้า', 'Add link', 'Add product', 'Products', 'Showcase'],
      ['button', 'div[role="button"]', 'span', 'a']
    );
    if (!addBtn) return false;
    if (dryRun) {
      note('(dry-run) เจอปุ่มเพิ่มสินค้า');
      return true;
    }
    addBtn.click();
    await delay(1200);

    // ช่องค้นหาสินค้า
    const search = await waitFor(
      () => document.querySelector('input[placeholder*="ค้นหา"], input[placeholder*="Search"], input[type="search"]'),
      6000
    );
    if (!search) return false;
    setInputValue(search, keyword);
    await delay(2000);

    // เลือกผลลัพธ์แรก
    const first = findByText(['เพิ่ม', 'Add', 'เลือก', 'Select'], ['button', 'div[role="button"]']);
    if (first) {
      first.click();
      await delay(800);
    }
    const confirm = findByText(['ยืนยัน', 'เสร็จ', 'Confirm', 'Done', 'ตกลง', 'OK'], ['button', 'div[role="button"]']);
    if (confirm) confirm.click();
    note('ปักตะกร้าสินค้า: ' + keyword);
    return true;
  }

  // ---------- กดปุ่มโพสต์ ----------
  async function tryClickPost(note) {
    const btn = findByText(['โพสต์', 'เผยแพร่', 'Post', 'Publish'], ['button', 'div[role="button"]']);
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
    const grab = (sel) =>
      Array.from(document.querySelectorAll(sel))
        .slice(0, 8)
        .map((e) => ({ tag: e.tagName, text: (e.textContent || '').trim().slice(0, 30), cls: e.className?.toString?.().slice(0, 40) }));
    return {
      fileInputs: grab('input[type="file"]'),
      editables: grab('div[contenteditable="true"], textarea'),
      buttons: grab('button, div[role="button"]'),
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
