// ตรรกะล้วน ๆ ของผู้ช่วยไลฟ์ — ไม่แตะ DOM และไม่เรียกเน็ต
// โหลดได้ทั้งใน content script (ผูกกับ window.TTLH) และในเทสต์ (node:vm)
(function attach(root) {
  'use strict';

  // ---------- ค่าตั้งต้น ----------
  const DEFAULT_IGNORE = [
    'เข้าร่วมแล้ว', 'เข้าร่วม LIVE', 'กำลังดูสินค้ารายการนี้',
    'ได้ซื้อสินค้า', 'ได้แชร์ LIVE', 'ถูกใจ LIVE', 'joined', 'shared',
  ];

  const DEFAULT_SETTINGS = {
    pin: {
      enabled: false,
      basket: 1,            // ปักหมุด "ตะกร้าที่เท่าไหร่"
      intervalSec: 30,      // ทุกกี่วินาที (30 / 60 / ตั้งเอง)
      // ถ้าถึงรอบแล้วสินค้ายังปักหมุดค้างอยู่ จะทำอะไรต่อ
      //   repin  = ยกเลิกหมุดแล้วปักใหม่ (การ์ดเด้งขึ้นจอผู้ชมอีกรอบ) ← ค่าเริ่มต้น
      //   extend = กด "+30 วินาที" ต่อเวลา (หมุดค้างไว้เฉย ๆ ไม่เด้งใหม่)
      //   wait   = ปล่อยไว้จนหมุดหมดอายุเอง
      whenPinned: 'repin',
      repinGapMs: 900,      // เว้นระหว่าง "ยกเลิก" กับ "ปักใหม่" ให้หน้าเว็บอัปเดตทัน
      dryRun: false,        // โหมดซ้อม: ไม่คลิกจริง แค่ลงบันทึก
    },
    ai: {
      enabled: false,
      model: 'claude-opus-5',
      apiBase: 'https://api.anthropic.com',
      apiKey: '',
      shopName: '',
      tone: 'เป็นกันเอง สุภาพ กระชับ เหมือนแม่ค้าไลฟ์คนไทย ลงท้ายด้วยค่ะ',
      extraRules: '',
      maxChars: 100,        // ช่องแชทไลฟ์จำกัด 100 ตัวอักษร
      minCommentChars: 2,
      replyPerMin: 6,       // ตอบได้ไม่เกินกี่ข้อความต่อนาที
      userCooldownSec: 90,  // คนเดิมเว้นกี่วินาทีถึงตอบอีกครั้ง
      onlyQuestions: false, // ตอบเฉพาะคอมเมนต์ที่เป็นคำถาม
      // ลูกค้าถามถึงสินค้าตะกร้าอื่นที่ไม่ใช่ตัวหลัก จะเอายังไง
      //   answer = ตอบเท่าที่มีข้อมูล (ค่าเริ่มต้น)
      //   brief  = ตอบสั้น ๆ ให้รอแม่ค้าโชว์ ไม่ลงรายละเอียด
      //   skip   = ไม่ตอบ ปล่อยให้แม่ค้าตอบเอง (ยังขึ้นเตือนในบันทึก)
      otherBasketMode: 'answer',
      pullBackToMain: true, // ปิดท้ายด้วยการชวนกลับมาที่สินค้าหลัก
      ignoreWords: DEFAULT_IGNORE.slice(),
      blockWords: [],       // เจอคำเหล่านี้ = ไม่ตอบเด็ดขาด
      dryRun: true,         // เริ่มต้นให้ "ร่างอย่างเดียว ไม่ส่ง" กันพลาด
    },
    // คลังข้อมูลสินค้าที่เจ้าของร้านกรอกเอง — AI ใช้ตอบลูกค้า
    // [{ basket, name, price, info }]
    products: [],
    selectors: { pinButton: '', chatList: '', chatInput: '', sendButton: '' },
  };

  // คลังข้อมูลสินค้า: เรียงตามเลขตะกร้า ตะกร้าละรายการเดียว
  function normalizeProducts(raw) {
    const list = Array.isArray(raw) ? raw : [];
    const seen = {};
    const out = [];
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const basket = clampInt(item.basket, 1, 200, 0);
      if (!basket || seen[basket]) continue;
      seen[basket] = true;
      out.push({
        basket,
        name: String(item.name || '').trim().slice(0, 120),
        price: String(item.price || '').trim().slice(0, 40),
        info: String(item.info || '').trim().slice(0, 1500),
      });
      if (out.length >= 30) break;
    }
    return out.sort((a, b) => a.basket - b.basket);
  }

  function clampInt(value, min, max, fallback) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function toWordList(value) {
    if (Array.isArray(value)) return value.map((w) => String(w).trim()).filter(Boolean);
    if (typeof value === 'string') {
      return value.split(/[\n,]/).map((w) => w.trim()).filter(Boolean);
    }
    return [];
  }

  // รวมค่าที่ผู้ใช้ตั้งเข้ากับค่าตั้งต้น + กันค่าที่เป็นไปไม่ได้
  function normalizeSettings(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const pin = Object.assign({}, DEFAULT_SETTINGS.pin, src.pin);
    const ai = Object.assign({}, DEFAULT_SETTINGS.ai, src.ai);
    const selectors = Object.assign({}, DEFAULT_SETTINGS.selectors, src.selectors);

    pin.enabled = !!pin.enabled;
    pin.dryRun = !!pin.dryRun;
    if (!['repin', 'extend', 'wait'].includes(pin.whenPinned)) pin.whenPinned = 'repin';
    pin.repinGapMs = clampInt(pin.repinGapMs, 300, 5000, DEFAULT_SETTINGS.pin.repinGapMs);
    pin.basket = clampInt(pin.basket, 1, 200, DEFAULT_SETTINGS.pin.basket);
    // ต่ำกว่า 15 วิ เสี่ยงโดนระบบมองว่าสแปม จึงล็อกขั้นต่ำไว้
    pin.intervalSec = clampInt(pin.intervalSec, 15, 3600, DEFAULT_SETTINGS.pin.intervalSec);

    ai.enabled = !!ai.enabled;
    ai.dryRun = !!ai.dryRun;
    ai.onlyQuestions = !!ai.onlyQuestions;
    ai.pullBackToMain = !!ai.pullBackToMain;
    if (!['answer', 'brief', 'skip'].includes(ai.otherBasketMode)) ai.otherBasketMode = 'answer';
    ai.model = String(ai.model || DEFAULT_SETTINGS.ai.model).trim() || DEFAULT_SETTINGS.ai.model;
    ai.apiBase = String(ai.apiBase || DEFAULT_SETTINGS.ai.apiBase).trim().replace(/\/+$/, '');
    ai.apiKey = String(ai.apiKey || '').trim();
    ai.shopName = String(ai.shopName || '').trim();
    ai.tone = String(ai.tone || DEFAULT_SETTINGS.ai.tone).trim();
    ai.extraRules = String(ai.extraRules || '').trim();
    ai.maxChars = clampInt(ai.maxChars, 20, 100, DEFAULT_SETTINGS.ai.maxChars);
    ai.minCommentChars = clampInt(ai.minCommentChars, 1, 50, DEFAULT_SETTINGS.ai.minCommentChars);
    ai.replyPerMin = clampInt(ai.replyPerMin, 1, 30, DEFAULT_SETTINGS.ai.replyPerMin);
    ai.userCooldownSec = clampInt(ai.userCooldownSec, 0, 3600, DEFAULT_SETTINGS.ai.userCooldownSec);
    ai.ignoreWords = toWordList(ai.ignoreWords);
    ai.blockWords = toWordList(ai.blockWords);

    for (const key of Object.keys(selectors)) selectors[key] = String(selectors[key] || '').trim();

    return { pin, ai, products: normalizeProducts(src.products), selectors };
  }

  // ---------- คอมเมนต์ ----------
  function normText(text) {
    return String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  }

  function commentId(comment) {
    const user = normText(comment && comment.user).toLowerCase();
    const text = normText(comment && comment.text).toLowerCase();
    return user + '|' + text;
  }

  function containsAny(text, words) {
    const hay = normText(text).toLowerCase();
    if (!hay) return false;
    return words.some((w) => {
      const needle = normText(w).toLowerCase();
      return needle && hay.includes(needle);
    });
  }

  // ลูกค้าไทยเรียกสินค้าด้วยเลข: "หมายเลข 14", "เบอร์ 3", "ตัวที่ 2", "#5"
  // หรือพิมพ์เลขมาโดด ๆ ("14") ซึ่งในไลฟ์แปลว่าขอดูสินค้าเบอร์นั้น
  const BASKET_PATTERNS = [
    /(?:หมายเลข|เลขที่|เลข|เบอร์|ตะกร้าที่|ตะกร้า|ตัวที่|อันที่|ชิ้นที่|รายการที่|no\.?|#)\s*(\d{1,3})/i,
    /^\s*(\d{1,3})\s*$/,
  ];

  function detectBasket(text) {
    const hay = normText(text);
    if (!hay) return null;
    for (const re of BASKET_PATTERNS) {
      const match = hay.match(re);
      if (!match) continue;
      const n = Number(match[1]);
      if (n >= 1 && n <= 200) return n;
    }
    return null;
  }

  // รวมข้อมูลตะกร้าหนึ่ง ๆ จากที่ดึงมาจากหน้าเว็บ + ที่เจ้าของร้านกรอกไว้
  function resolveProduct(basket, context) {
    if (!basket) return null;
    const ctx = context || {};
    const scraped = (ctx.scraped || []).find((p) => p.index === basket) || null;
    const known = (ctx.knowledge || []).find((p) => p.basket === basket) || null;
    if (!scraped && !known) return { basket, name: '', price: '', info: '', known: false };
    return {
      basket,
      name: (known && known.name) || (scraped && scraped.name) || '',
      price: (known && known.price) || (scraped && scraped.price) || '',
      info: (known && known.info) || '',
      known: true,
    };
  }

  const QUESTION_HINTS = [
    '?', '？', 'ไหม', 'มั้ย', 'มัย', 'หรอ', 'เหรอ', 'ยังไง', 'อย่างไร', 'เท่าไหร่', 'เท่าไร',
    'กี่', 'ราคา', 'ค่าส่ง', 'ส่งฟรี', 'มีมั้ย', 'มีไหม', 'สั่งยังไง', 'สี', 'ไซส์', 'ขนาด',
    'เมื่อไหร่', 'กี่วัน', 'ของแท้', 'รับประกัน', 'ลดอีก', 'โค้ด', 'เก็บเงินปลายทาง',
  ];

  function looksLikeQuestion(text) {
    return containsAny(text, QUESTION_HINTS);
  }

  // ตัดรายการที่เก่ากว่าหน้าต่างเวลาออก (ใช้กับตัวนับ rate limit)
  function pruneTimestamps(list, now, windowMs) {
    return (Array.isArray(list) ? list : []).filter((t) => now - t < windowMs);
  }

  /**
   * ตัดสินว่าคอมเมนต์นี้ควรให้ AI ตอบไหม
   * state = { handled: {id: ts}, lastByUser: {user: ts}, replyTimes: [ts], ownTexts: [text] }
   */
  function shouldReply(comment, state, ai, now) {
    const text = normText(comment && comment.text);
    const user = normText(comment && comment.user);
    const st = state || {};

    if (!ai.enabled) return { ok: false, reason: 'ปิดระบบ AI อยู่' };
    if (!text) return { ok: false, reason: 'ข้อความว่าง' };
    if (text.length < ai.minCommentChars) return { ok: false, reason: 'ข้อความสั้นเกินไป' };
    // seen = อ่านเข้าคิวแล้ว (กันซ้ำในคิว) ส่วน handled = ตัดสินใจ/ตอบไปแล้ว
    if ((st.handled || {})[commentId(comment)]) return { ok: false, reason: 'ตอบคอมเมนต์นี้ไปแล้ว' };
    if (containsAny(text, st.ownTexts || [])) return { ok: false, reason: 'ข้อความของเราเอง' };
    if (containsAny(text, ai.ignoreWords)) return { ok: false, reason: 'เป็นข้อความระบบ (เข้าร่วม/ซื้อ/แชร์)' };
    if (containsAny(text, ai.blockWords)) return { ok: false, reason: 'ติดคำต้องห้าม' };
    if (ai.onlyQuestions && !looksLikeQuestion(text)) return { ok: false, reason: 'ไม่ใช่คำถาม' };

    const last = (st.lastByUser || {})[user.toLowerCase()];
    if (user && last && now - last < ai.userCooldownSec * 1000) {
      return { ok: false, reason: 'คนเดิมยังอยู่ในช่วงพัก' };
    }

    const recent = pruneTimestamps(st.replyTimes, now, 60000);
    if (recent.length >= ai.replyPerMin) return { ok: false, reason: 'ตอบครบโควตาต่อนาทีแล้ว' };

    return { ok: true, reason: '' };
  }

  // ---------- คำตอบจาก AI ----------
  function isSkip(raw) {
    return /^\s*(skip|ข้าม|ไม่ตอบ)/i.test(String(raw || ''));
  }

  // ทำให้คำตอบพร้อมพิมพ์ลงช่องแชท (บรรทัดเดียว ไม่มี markdown ไม่เกินลิมิต)
  function sanitizeReply(raw, maxChars) {
    let text = String(raw == null ? '' : raw);
    text = text.replace(/```[\s\S]*?```/g, ' ');
    text = text.replace(/\s+/g, ' ').trim();
    text = text.replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim();
    text = text.replace(/^(?:ตอบ|คำตอบ|reply)\s*[:：-]\s*/i, '').trim();
    text = text.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
    const limit = clampInt(maxChars, 20, 100, 100);
    if (text.length > limit) {
      const cut = text.slice(0, limit);
      const space = cut.lastIndexOf(' ');
      text = (space > limit * 0.6 ? cut.slice(0, space) : cut).trim();
    }
    return text;
  }

  function buildSystemPrompt(ai, context) {
    const ctx = context || {};
    const scraped = Array.isArray(ctx.scraped) ? ctx.scraped : [];
    const knowledge = Array.isArray(ctx.knowledge) ? ctx.knowledge : [];
    const focus = ctx.focusBasket || null;
    const lines = [];
    lines.push('คุณคือผู้ช่วยตอบคอมเมนต์ในไลฟ์ขายของบน TikTok Shop แทนแม่ค้า');
    if (ai.shopName) lines.push('ชื่อร้าน: ' + ai.shopName);
    lines.push('โทนการพูด: ' + ai.tone);
    lines.push('');
    lines.push('กติกา:');
    lines.push('- ตอบเป็นภาษาไทย ข้อความเดียว บรรทัดเดียว ไม่เกิน ' + ai.maxChars + ' ตัวอักษร');
    lines.push('- ตอบเฉพาะสิ่งที่ผู้ชมถาม สั้น กระชับ ไม่ทักทายยืดยาว');
    lines.push('- ห้ามแต่งข้อมูลที่ไม่มีในรายการสินค้า (ราคา/โปร/ค่าส่ง/สต็อก) ถ้าไม่รู้ให้บอกว่าเดี๋ยวแม่ค้าตอบในไลฟ์');
    lines.push('- ห้ามใส่ลิงก์ เบอร์โทร ไอดีไลน์ หรือชวนคุยนอกแพลตฟอร์ม');
    lines.push('- ห้ามสัญญาเรื่องการรักษาโรค การลงทุน หรือผลลัพธ์เกินจริง');
    lines.push('- ถ้าเป็นข้อความหยาบคาย ก่อกวน สแปม หรือไม่มีอะไรให้ตอบ ให้ตอบว่า SKIP อย่างเดียว');
    lines.push('- ตอบกลับมาเป็นข้อความที่จะพิมพ์ลงแชทเท่านั้น ห้ามใส่คำอธิบาย เครื่องหมายคำพูด หรือ markdown');
    if (ai.extraRules) {
      lines.push('');
      lines.push('กติกาเพิ่มเติมจากเจ้าของร้าน:');
      lines.push(ai.extraRules);
    }
    if (focus) {
      lines.push('- ถ้าลูกค้าพูดว่า "ตัวนี้" "อันนี้" "ตัวที่ปักหมุด" ให้หมายถึงสินค้าตะกร้าที่ ' + focus
        + ' ซึ่งเป็นสินค้าหลักที่กำลังขายอยู่');
      lines.push('- ลูกค้ามักเรียกสินค้าด้วยเลข เช่น "หมายเลข 14" "เบอร์ 3" หรือพิมพ์เลขมาโดด ๆ'
        + ' ให้เข้าใจว่าหมายถึงสินค้าตะกร้าลำดับนั้น');
      if (ai.otherBasketMode === 'brief') {
        lines.push('- ถ้าถามถึงตะกร้าอื่นที่ไม่ใช่ที่ ' + focus
          + ' ให้ตอบสั้น ๆ ว่ากดดูในตะกร้าได้เลย เดี๋ยวแม่ค้าโชว์ให้ดู ห้ามลงรายละเอียดเอง');
      } else {
        lines.push('- ถ้าถามถึงตะกร้าอื่น ให้ตอบเท่าที่มีข้อมูลจริงในรายการด้านล่างเท่านั้น'
          + ' ถ้าไม่มีข้อมูลให้บอกว่ากดดูในตะกร้าได้เลย เดี๋ยวแม่ค้าโชว์ให้ดู ห้ามเดาราคาหรือสเปก');
      }
      if (ai.pullBackToMain) {
        lines.push('- เมื่อตอบเรื่องตะกร้าอื่นเสร็จ ถ้าความยาวยังพอ ให้ชวนกลับมาที่สินค้าตะกร้าที่ '
          + focus + ' สั้น ๆ หนึ่งวรรค');
      }
    }

    if (scraped.length) {
      lines.push('');
      lines.push('รายการสินค้าที่เห็นในไลฟ์ตอนนี้ (ชื่อ/ราคาจากหน้าคอนโซล):');
      scraped.slice(0, 20).forEach((p) => {
        const price = p.price ? ' — ' + p.price : '';
        const mark = focus && p.index === focus ? '  ← กำลังขายตัวนี้' : '';
        lines.push('ตะกร้า ' + (p.index || '?') + '. ' + normText(p.name) + price + mark);
      });
    }

    if (knowledge.length) {
      lines.push('');
      lines.push('ข้อมูลสินค้าละเอียดที่เจ้าของร้านกรอกไว้ (ใช้ตอบลูกค้าได้เลย):');
      knowledge.slice(0, 30).forEach((p) => {
        const head = 'ตะกร้า ' + p.basket + ': ' + normText(p.name || '(ไม่ระบุชื่อ)')
          + (p.price ? ' — ' + p.price : '')
          + (focus && p.basket === focus ? '  ← กำลังขายตัวนี้' : '');
        lines.push(head);
        if (p.info) lines.push(normText(p.info));
      });
    }

    if (!scraped.length && !knowledge.length) {
      lines.push('');
      lines.push('(ยังไม่มีข้อมูลสินค้า — ถ้าลูกค้าถามรายละเอียดสินค้า ให้บอกว่าเดี๋ยวแม่ค้าตอบในไลฟ์)');
    }
    return lines.join('\n');
  }

  function buildUserPrompt(comment, recent, reference) {
    const lines = [];
    const history = (recent || []).slice(-6).filter(Boolean);
    if (history.length) {
      lines.push('คอมเมนต์ก่อนหน้า (ไว้ดูบริบทเฉย ๆ ไม่ต้องตอบ):');
      history.forEach((c) => lines.push('- ' + normText(c.user) + ': ' + normText(c.text)));
      lines.push('');
    }
    lines.push('คอมเมนต์ที่ต้องตอบ:');
    lines.push(normText(comment && comment.user) + ': ' + normText(comment && comment.text));

    if (reference && reference.basket) {
      lines.push('');
      lines.push('[ระบบตรวจพบ] ลูกค้าน่าจะถามถึงสินค้าตะกร้าที่ ' + reference.basket);
      if (reference.known && (reference.name || reference.price)) {
        lines.push('ข้อมูลที่มี: ' + (normText(reference.name) || '(ไม่มีชื่อ)')
          + (reference.price ? ' ราคา ' + reference.price : ''));
        if (reference.info) lines.push('รายละเอียด: ' + normText(reference.info));
      } else {
        lines.push('ยังไม่มีข้อมูลของตะกร้านี้ — ห้ามเดา ให้บอกลูกค้าว่ากดดูในตะกร้าได้เลย เดี๋ยวแม่ค้าโชว์ให้ดู');
      }
    }
    return lines.join('\n');
  }

  // Haiku ยังใช้ output_config.effort ไม่ได้ จึงต้องแยกรูปแบบ body ตามรุ่น
  function supportsEffort(model) {
    return !/^claude-haiku/i.test(String(model || ''));
  }

  function buildRequestBody({ model, system, user }) {
    const body = {
      model,
      // เผื่อโควตาให้ thinking ด้วย ไม่งั้นคำตอบสั้น ๆ อาจถูกตัดกลางทาง
      max_tokens: 2000,
      system,
      messages: [{ role: 'user', content: user }],
    };
    if (supportsEffort(model)) body.output_config = { effort: 'low' };
    return body;
  }

  // ดึงข้อความจากผลลัพธ์ /v1/messages
  function extractText(response) {
    const blocks = (response && response.content) || [];
    return blocks
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join(' ')
      .trim();
  }

  // ---------- ตัวจับเวลาปักหมุด ----------
  /**
   * pinState = { lastActionAt: number|null, pinned: boolean }
   * คืนค่า 'pin' | 'repin' | 'extend' | 'wait' | 'off'
   */
  function nextPinAction(pinState, pin, now) {
    if (!pin.enabled) return 'off';
    const st = pinState || {};
    const last = st.lastActionAt;
    if (last != null && now - last < pin.intervalSec * 1000) return 'wait';
    if (st.pinned) {
      if (pin.whenPinned === 'repin') return 'repin';
      if (pin.whenPinned === 'extend') return 'extend';
      return 'wait';
    }
    return 'pin';
  }

  const api = {
    DEFAULT_SETTINGS, DEFAULT_IGNORE,
    clampInt, toWordList, normalizeSettings, normalizeProducts, normText,
    commentId, containsAny, looksLikeQuestion, detectBasket, resolveProduct, pruneTimestamps, shouldReply,
    isSkip, sanitizeReply, buildSystemPrompt, buildUserPrompt,
    supportsEffort, buildRequestBody, extractText, nextPinAction,
  };

  root.TTLH = Object.assign(root.TTLH || {}, { core: api });
})(typeof globalThis !== 'undefined' ? globalThis : this);
