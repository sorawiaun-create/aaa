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

  // การ์ดสินค้าลำดับที่ n: หา "เลขลำดับ" ในกล่องเล็ก ๆ แล้วไต่ขึ้นไปหา element
  // ที่ครอบทั้งการ์ด (ต้องมีปุ่มปักหมุดอยู่ข้างใน)
  function productCard(index) {
    const wanted = String(index);
    const badges = Array.from(document.querySelectorAll('div, span, p'))
      .filter((el) => el.children.length === 0 && textOf(el) === wanted && visible(el));

    for (const badge of badges) {
      let node = badge.parentElement;
      for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
        const hasPin = byLabel(PIN_LABEL, node).length || byLabel(UNPIN_LABEL, node).length;
        // การ์ดสินค้าจริงต้องมีทั้งปุ่มปักหมุดและราคา (฿) อยู่ในกล่องเดียวกัน
        if (hasPin && /฿|บาท/.test(textOf(node))) return node;
      }
    }
    return null;
  }

  // ปุ่ม "ปักหมุด" ของตะกร้าที่ n (ถ้าตั้ง selector เองไว้ ใช้อันนั้นก่อน)
  function pinButton(index, selectorOverride) {
    const manual = bySelector(selectorOverride);
    if (manual) return manual;
    const card = productCard(index);
    if (card) {
      const btn = byLabel(PIN_LABEL, card)[0];
      if (btn) return btn;
    }
    return null;
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

  // ดึงรายชื่อสินค้า+ราคาในไลฟ์ ไว้ให้ AI ใช้เป็นบริบท
  function scrapeProducts(limit) {
    const max = limit || 10;
    const items = [];
    for (let i = 1; i <= max; i += 1) {
      const card = productCard(i);
      if (!card) continue;
      const raw = textOf(card);
      const price = (raw.match(/฿[\d,]+(?:\.\d+)?/) || [])[0] || '';
      const name = raw
        .replace(/^\d+\s*/, '')
        .replace(/฿[\d,]+(?:\.\d+)?/g, ' ')
        .replace(/(ปักหมุดแล้ว|ยกเลิกการปักหมุด|ปักหมุด|ตัวเลือกโปรด|อยู่ในสต็อก.*)/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80);
      if (name) items.push({ index: i, name, price });
    }
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
      textOf, visible, byLabel, bySelector, productCard, pinButton, unpinButton,
      isPinned, extendButton, chatList, chatInput, sendButton,
      typeInto, pressEnter, realClick, scrapeProducts, parseCommentNode,
      cssPath, startPicker,
    },
  });
})(typeof window !== 'undefined' ? window : globalThis);
