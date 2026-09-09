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
      extendWhenPinned: true, // ถ้าปักอยู่แล้วให้กด "+30 วินาที" ต่อเวลาแทน
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
      ignoreWords: DEFAULT_IGNORE.slice(),
      blockWords: [],       // เจอคำเหล่านี้ = ไม่ตอบเด็ดขาด
      dryRun: true,         // เริ่มต้นให้ "ร่างอย่างเดียว ไม่ส่ง" กันพลาด
    },
    selectors: { pinButton: '', chatList: '', chatInput: '', sendButton: '' },
  };

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
    pin.extendWhenPinned = !!pin.extendWhenPinned;
    pin.basket = clampInt(pin.basket, 1, 200, DEFAULT_SETTINGS.pin.basket);
    // ต่ำกว่า 15 วิ เสี่ยงโดนระบบมองว่าสแปม จึงล็อกขั้นต่ำไว้
    pin.intervalSec = clampInt(pin.intervalSec, 15, 3600, DEFAULT_SETTINGS.pin.intervalSec);

    ai.enabled = !!ai.enabled;
    ai.dryRun = !!ai.dryRun;
    ai.onlyQuestions = !!ai.onlyQuestions;
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

    return { pin, ai, selectors };
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
   * state = { seen: {id: ts}, lastByUser: {user: ts}, replyTimes: [ts], ownTexts: [text] }
   */
  function shouldReply(comment, state, ai, now) {
    const text = normText(comment && comment.text);
    const user = normText(comment && comment.user);
    const st = state || {};

    if (!ai.enabled) return { ok: false, reason: 'ปิดระบบ AI อยู่' };
    if (!text) return { ok: false, reason: 'ข้อความว่าง' };
    if (text.length < ai.minCommentChars) return { ok: false, reason: 'ข้อความสั้นเกินไป' };
    if ((st.seen || {})[commentId(comment)]) return { ok: false, reason: 'ตอบ/เห็นคอมเมนต์นี้แล้ว' };
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

  function buildSystemPrompt(ai, products) {
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
    const list = (products || []).filter(Boolean).slice(0, 20);
    if (list.length) {
      lines.push('');
      lines.push('สินค้าในไลฟ์ตอนนี้:');
      list.forEach((p, i) => {
        const price = p.price ? ' — ' + p.price : '';
        lines.push((i + 1) + '. ' + normText(p.name) + price);
      });
    }
    return lines.join('\n');
  }

  function buildUserPrompt(comment, recent) {
    const lines = [];
    const history = (recent || []).slice(-6).filter(Boolean);
    if (history.length) {
      lines.push('คอมเมนต์ก่อนหน้า (ไว้ดูบริบทเฉย ๆ ไม่ต้องตอบ):');
      history.forEach((c) => lines.push('- ' + normText(c.user) + ': ' + normText(c.text)));
      lines.push('');
    }
    lines.push('คอมเมนต์ที่ต้องตอบ:');
    lines.push(normText(comment && comment.user) + ': ' + normText(comment && comment.text));
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
   * คืนค่า 'pin' | 'extend' | 'wait' | 'off'
   */
  function nextPinAction(pinState, pin, now) {
    if (!pin.enabled) return 'off';
    const st = pinState || {};
    const last = st.lastActionAt;
    if (last != null && now - last < pin.intervalSec * 1000) return 'wait';
    if (st.pinned) return pin.extendWhenPinned ? 'extend' : 'wait';
    return 'pin';
  }

  const api = {
    DEFAULT_SETTINGS, DEFAULT_IGNORE,
    clampInt, toWordList, normalizeSettings, normText,
    commentId, containsAny, looksLikeQuestion, pruneTimestamps, shouldReply,
    isSkip, sanitizeReply, buildSystemPrompt, buildUserPrompt,
    supportsEffort, buildRequestBody, extractText, nextPinAction,
  };

  root.TTLH = Object.assign(root.TTLH || {}, { core: api });
})(typeof globalThis !== 'undefined' ? globalThis : this);
