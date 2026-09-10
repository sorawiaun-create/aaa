// ตัวช่วยหา element บนหน้า TikTok LIVE Manager
// DOM ของ TikTok เปลี่ยนบ่อยและ class เป็นชื่อสุ่ม จึงหาจาก "ข้อความบนปุ่ม" เป็นหลัก
// แล้วเปิดทางให้ผู้ใช้จิ้มเลือกเองได้ (element picker) เมื่อหาอัตโนมัติไม่เจอ
(function attach(root) {
  'use strict';

  const PIN_LABEL = /^(ปักหมุด|ปักหมุดสินค้า|pin)$/i;
  const UNPIN_LABEL = /^(ยกเลิกการปักหมุด|ยกเลิกปักหมุด|unpin)/i;
  const PINNED_BADGE = /(ปักหมุดแล้ว|pinned)/i;
  const EXTEND_LABEL = /^\+\s*\d+\s*(วินาที|วิ|s|sec)/i;

  function textOf(el) {
    return (el && (el.innerText || el.textContent) || '').replace(/\s+/g, ' ').trim();
  }

  function visible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
  }

  function clickables(scope) {
    const nodes = (scope || document).querySelectorAll(
      'button, [role="button"], a[role="button"], div[class*="btn"], span[class*="btn"]'
    );
    return Array.from(nodes).filter(visible);
  }

  function byLabel(re, scope) {
    return clickables(scope).filter((el) => re.test(textOf(el)));
  }

  function bySelector(selector) {
    if (!selector) return null;
    try {
      const el = document.querySelector(selector);
      return el && visible(el) ? el : null;
    } catch (err) {
      return null;
    }
  }

  // การ์ดในหน้าคอนโซลมีหลายชนิดที่มีปุ่ม "ปักหมุด" เหมือนกันหมด
  // (คูปอง, การแจกรางวัล, แถบรายการสินค้ารวม) ต้องคัดออกให้เหลือแต่การ์ดสินค้าจริง
  const core = root.TTLH.core;

  // ไต่ขึ้นจากปุ่มปักหมุดไปหากล่องที่เป็น "การ์ดสินค้า" จริง ๆ
  function cardOf(button, requireHint) {
    let node = button.parentElement;
    for (let depth = 0; node && depth < 10; depth += 1, node = node.parentElement) {
      const text = textOf(node);
      if (!core.hasPrice(text)) continue;
      if (core.isProductCardText(text, requireHint)) return node;
      // ไต่มาเจอกล่องที่เป็นคูปอง/การแจกรางวัลแล้ว = ปุ่มนี้ไม่ใช่ของสินค้า
      if (!core.isProductCardText(text, false)) return null;
    }
    return null;
  }

  function collectCards(requireHint) {
    const buttons = byLabel(PIN_LABEL, document).concat(byLabel(UNPIN_LABEL, document));
    const cards = [];
    for (const button of buttons) {
      const card = cardOf(button, requireHint);
      if (!card) continue;
      // กันซ้ำ: การ์ดที่ครอบกันอยู่ถือเป็นใบเดียวกัน
      if (cards.some((c) => c === card || c.contains(card) || card.contains(c))) continue;
      cards.push(card);
    }
    return cards.sort((a, b) =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1);
  }

  function productCards() {
    const strict = collectCards(true);
    return strict.length ? strict : collectCards(false);
  }

  function cardIndex(card) {
    return core.cardIndexFromText(textOf(card));
  }

  function cardName(card) {
    return core.cardNameFromText(textOf(card));
  }

  // การ์ดสินค้าของ "ตะกร้าที่ n" — ยึดเลขที่โชว์บนการ์ดก่อน ถ้าไม่มีค่อยนับลำดับ
  function productCard(index) {
    const cards = productCards();
    const byBadge = cards.find((card) => cardIndex(card) === index);
    if (byBadge) return byBadge;
    return cards[index - 1] || null;
  }

  // ปุ่ม "ปักหมุด" ของตะกร้าที่ n (ถ้าตั้ง selector เองไว้ ใช้อันนั้นก่อน)
  function pinButton(index, selectorOverride) {
    const manual = bySelector(selectorOverride);
    if (manual) return manual;
    const card = productCard(index);
    return card ? byLabel(PIN_LABEL, card)[0] || null : null;
  }

  // ชื่อสินค้าที่ "กำลังจะถูกปัก" ไว้โชว์ในบันทึกให้ตรวจสอบได้ก่อนกด
  function targetName(index) {
    const card = productCard(index);
    return card ? cardName(card) : '';
  }

  function unpinButton(index) {
    const card = productCard(index);
    return card ? byLabel(UNPIN_LABEL, card)[0] || null : null;
  }

  // ปักหมุดอยู่หรือยัง — ดูจากป้าย "ปักหมุดแล้ว" หรือปุ่มที่กลายเป็น "ยกเลิกการปักหมุด"
  function isPinned(index) {
    const card = productCard(index);
    if (!card) return false;
    if (byLabel(UNPIN_LABEL, card).length) return true;
    return PINNED_BADGE.test(textOf(card));
  }

  // ปุ่ม "+ 30 วินาที" ที่โผล่บนกล่องวิดีโอตอนหมุดใกล้หมดเวลา
  function extendButton() {
    return byLabel(EXTEND_LABEL, document)[0] || null;
  }

  // กล่องรายการแชท: จับจากข้อความ empty state ก่อน ถ้าไม่เจอค่อยเดาจากช่องพิมพ์
  function chatList(selectorOverride) {
    const manual = bySelector(selectorOverride);
    if (manual) return manual;

    const hint = Array.from(document.querySelectorAll('div, p, span')).find(
      (el) => el.children.length === 0 && /ความคิดเห็นของผู้ชมจะปรากฏ|Viewer comments will appear/i.test(textOf(el))
    );
    if (hint && hint.parentElement) return hint.parentElement;

    const input = chatInput();
    if (input) {
      let node = input.parentElement;
      for (let depth = 0; node && depth < 6; depth += 1, node = node.parentElement) {
        const scroller = Array.from(node.querySelectorAll('div')).find((el) => {
          if (el.contains(input)) return false;
          const style = getComputedStyle(el);
          return /(auto|scroll)/.test(style.overflowY) && el.clientHeight > 120;
        });
        if (scroller) return scroller;
      }
    }
    return null;
  }

  function chatInput(selectorOverride) {
    const manual = bySelector(selectorOverride);
    if (manual) return manual;

    const candidates = Array.from(
      document.querySelectorAll('textarea, input[type="text"], [contenteditable="true"]')
    ).filter(visible);

    const byPlaceholder = candidates.find((el) =>
      /พิมพ์อะไร|พิมพ์ข้อความ|say something|type a message/i.test(
        el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || ''
      )
    );
    if (byPlaceholder) return byPlaceholder;

    // ช่องแชทไลฟ์จำกัด 100 ตัวอักษร ใช้เป็นลายเซ็นได้
    const byLimit = candidates.find((el) => el.getAttribute('maxlength') === '100');
    return byLimit || candidates[0] || null;
  }

  function sendButton(selectorOverride, near) {
    const manual = bySelector(selectorOverride);
    if (manual) return manual;
    const scope = near && near.parentElement ? near.parentElement.parentElement : document;
    return byLabel(/^(ส่ง|send)$/i, scope || document)[0] || null;
  }

  // พิมพ์ข้อความลงช่องแชทของ React ให้ state ของหน้าเว็บรับรู้จริง ๆ
  function typeInto(el, text) {
    if (!el) return false;
    el.focus();
    if (el.isContentEditable) {
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, text);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
      return true;
    }
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value');
    if (setter && setter.set) setter.set.call(el, text);
    else el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function pressEnter(el) {
    if (!el) return false;
    const init = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent('keydown', init));
    el.dispatchEvent(new KeyboardEvent('keypress', init));
    el.dispatchEvent(new KeyboardEvent('keyup', init));
    return true;
  }

  function realClick(el) {
    if (!el) return false;
    const opts = { bubbles: true, cancelable: true, view: window };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.click();
    return true;
  }

  // หน้ายืนยันตัวตนของ TikTok (จิ๊กซอว์) — ถ้าโผล่มาต้องหยุดทุกอย่างให้คนมาแก้เอง
  const CAPTCHA_TEXT = /(verify to continue|drag the puzzle|puzzle piece|ยืนยันเพื่อดำเนินการต่อ|ลากชิ้นส่วน|เลื่อนจิ๊กซอว์|ยืนยันตัวตน|verification)/i;

  function captchaEl() {
    const direct = document.querySelector(
      '#captcha_container, .captcha_verify_container, [class*="captcha_verify"], [id*="captcha-verify"]'
    );
    if (direct && visible(direct)) return direct;

    const dialogs = document.querySelectorAll('[role="dialog"], [class*="modal"], [class*="Modal"], [class*="dialog"]');
    for (const dialog of dialogs) {
      if (visible(dialog) && CAPTCHA_TEXT.test(textOf(dialog))) return dialog;
    }
    return null;
  }

  // เสียงเตือนสั้น ๆ เผื่อกำลังไลฟ์อยู่แล้วไม่ได้จ้องหน้าจอ
  function beep(times) {
    let left = times || 2;
    const play = () => {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        const ctx = new Ctx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 880;
        gain.gain.value = 0.08;
        osc.start();
        setTimeout(() => { osc.stop(); ctx.close(); }, 320);
      } catch (err) { /* บางเบราว์เซอร์ห้ามเล่นเสียงก่อนผู้ใช้คลิก — ข้ามไป */ }
      left -= 1;
      if (left > 0) setTimeout(play, 500);
    };
    play();
  }

  // กะพริบกรอบให้เห็นว่าระบบเล็งการ์ดใบไหนอยู่
  function flash(el) {
    if (!el) return;
    const prev = el.style.outline;
    el.style.outline = '3px solid #fe2c55';
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setTimeout(() => { el.style.outline = prev; }, 2500);
  }

  // ดึงรายชื่อสินค้า+ราคาในไลฟ์ ไว้ให้ AI ใช้เป็นบริบท
  function scrapeProducts(limit) {
    const cards = productCards().slice(0, limit || 10);
    const items = [];
    cards.forEach((card, i) => {
      const raw = textOf(card);
      const price = (raw.match(/฿[\d,]+(?:\.\d+)?/) || [])[0] || '';
      const name = cardName(card);
      if (name) items.push({ index: cardIndex(card) || i + 1, name, price });
    });
    return items;
  }

  // อ่านคอมเมนต์จาก node ที่เพิ่งถูกเพิ่มเข้ามาในกล่องแชท
  function parseCommentNode(node) {
    if (!node || node.nodeType !== 1) return null;
    const raw = textOf(node);
    if (!raw || raw.length > 300) return null;

    let user = '';
    let text = raw;
    const strong = node.querySelector('strong, b, [class*="name"], [class*="nickname"], [class*="user"]');
    if (strong) {
      const candidate = textOf(strong);
      if (candidate && candidate.length < 40 && raw.startsWith(candidate)) {
        user = candidate;
        text = raw.slice(candidate.length).replace(/^[\s:：·]+/, '');
      }
    }
    if (!user) {
      const parts = raw.split(/\s*[:：]\s*/);
      if (parts.length > 1 && parts[0].length <= 30) {
        user = parts[0];
        text = parts.slice(1).join(': ');
      }
    }
    text = text.replace(/\s+/g, ' ').trim();
    if (!text) return null;
    return { user: user || 'ผู้ชม', text, raw };
  }

  // สร้าง CSS selector จาก element ที่ผู้ใช้จิ้มเลือก
  function cssPath(el) {
    if (!el || el.nodeType !== 1) return '';
    if (el.id && /^[A-Za-z][\w-]*$/.test(el.id)) return '#' + el.id;
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 6) {
      let part = node.tagName.toLowerCase();
      if (node.id && /^[A-Za-z][\w-]*$/.test(node.id)) {
        parts.unshift('#' + node.id);
        break;
      }
      const parent = node.parentElement;
      if (parent) {
        const sibs = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
        if (sibs.length > 1) part += ':nth-of-type(' + (sibs.indexOf(node) + 1) + ')';
      }
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(' > ');
  }

  // โหมดจิ้มเลือก element: ไฮไลต์ตามเมาส์ คลิกแล้วคืน selector กลับไป
  function startPicker(onPick) {
    const overlay = document.createElement('div');
    overlay.style.cssText = [
      'position:fixed', 'z-index:2147483646', 'pointer-events:none',
      'border:2px solid #fe2c55', 'background:rgba(254,44,85,.15)', 'border-radius:4px',
      'transition:all .05s linear',
    ].join(';');
    document.body.appendChild(overlay);

    let current = null;
    function move(ev) {
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      if (!el || el === overlay) return;
      current = el;
      const r = el.getBoundingClientRect();
      overlay.style.top = r.top + 'px';
      overlay.style.left = r.left + 'px';
      overlay.style.width = r.width + 'px';
      overlay.style.height = r.height + 'px';
    }
    function stop() {
      document.removeEventListener('mousemove', move, true);
      document.removeEventListener('click', pick, true);
      document.removeEventListener('keydown', esc, true);
      overlay.remove();
    }
    function pick(ev) {
      ev.preventDefault();
      ev.stopPropagation();
      stop();
      onPick(current ? cssPath(current) : '');
    }
    function esc(ev) {
      if (ev.key === 'Escape') { stop(); onPick(''); }
    }
    document.addEventListener('mousemove', move, true);
    document.addEventListener('click', pick, true);
    document.addEventListener('keydown', esc, true);
  }

  root.TTLH = Object.assign(root.TTLH || {}, {
    dom: {
      PIN_LABEL, UNPIN_LABEL, EXTEND_LABEL,
      textOf, visible, byLabel, bySelector, productCards, productCard, cardIndex, cardName,
      targetName, flash, captchaEl, beep, pinButton, unpinButton,
      isPinned, extendButton, chatList, chatInput, sendButton,
      typeInto, pressEnter, realClick, scrapeProducts, parseCommentNode,
      cssPath, startPicker,
    },
  });
})(typeof window !== 'undefined' ? window : globalThis);
