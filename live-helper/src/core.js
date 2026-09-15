// ตรรกะล้วน ๆ ของผู้ช่วยไลฟ์ — ไม่แตะ DOM และไม่เรียกเน็ต
// โหลดได้ทั้งใน content script (ผูกกับ window.TTLH) และในเทสต์ (node:vm)
(function attach(root) {
  'use strict';

  // ---------- ค่าตั้งต้น ----------
  const DEFAULT_IGNORE = [
    'เข้าร่วมแล้ว', 'เข้าร่วม LIVE', 'กำลังดูสินค้ารายการนี้',
    'ได้ซื้อสินค้า', 'ได้แชร์ LIVE', 'ถูกใจ LIVE', 'joined', 'shared',
  ];

  const SETTINGS_VERSION = 5;

  // ผู้ให้บริการ AI ที่รองรับ — เก็บคีย์/รุ่น/ปลายทางแยกกัน จะได้สลับไปมาได้โดยไม่ต้องกรอกใหม่
  const PROVIDERS = {
    claude: {
      label: 'Claude (Anthropic)',
      base: 'https://api.anthropic.com',
      path: '/v1/messages',
      model: 'claude-opus-5',
      keyHint: 'sk-ant-...',
    },
    openai: {
      label: 'GPT (OpenAI)',
      base: 'https://api.openai.com',
      path: '/v1/chat/completions',
      model: 'gpt-4o-mini',
      keyHint: 'sk-...',
    },
  };

  const DEFAULT_SETTINGS = {
    version: SETTINGS_VERSION,
    pin: {
      enabled: false,
      basket: 1,            // ปักหมุด "ตะกร้าที่เท่าไหร่"
      // วิธีคงหมุดไว้
      //   extend = ปักครั้งเดียว แล้วกด "+30 วินาที" ทุกรอบ (คลิกน้อยสุด) ← ค่าเริ่มต้น
      //   repin  = ยกเลิกหมุดแล้วปักใหม่ทุกรอบ (การ์ดเด้งขึ้นจอผู้ชมอีกครั้ง แต่คลิกมากกว่า)
      mode: 'extend',
      extendEverySec: 31,   // กดปุ่ม "+30 วินาที" ทุกกี่วินาที (หมุดนับถอยหลัง 30 วิ)
      repinEverySec: 60,    // โหมด repin: ยกเลิกแล้วปักใหม่ทุกกี่วินาที
      repinGapMs: 900,      // เว้นระหว่าง "ยกเลิก" กับ "ปักใหม่" ให้หน้าเว็บอัปเดตทัน
      maxClicksPerMin: 8,   // เพดานกันระบบรวน ถ้าเกินนี้ให้หยุดตัวเองทันที
      dryRun: false,        // โหมดซ้อม: ไม่คลิกจริง แค่ลงบันทึก
    },
    ai: {
      enabled: false,
      provider: 'claude',   // claude | openai
      models: { claude: PROVIDERS.claude.model, openai: PROVIDERS.openai.model },
      keys: { claude: '', openai: '' },
      bases: { claude: PROVIDERS.claude.base, openai: PROVIDERS.openai.base },
      shopName: '',
      tone: 'เป็นกันเอง สุภาพ กระชับ เหมือนแม่ค้าไลฟ์คนไทย ลงท้ายด้วยค่ะ',
      extraRules: '',
      maxChars: 100,        // ช่องแชทไลฟ์จำกัด 100 ตัวอักษร
      minCommentChars: 2,
      replyPerMin: 15,      // ตอบได้ไม่เกินกี่ข้อความต่อนาที
      userCooldownSec: 20,  // คนเดิมเว้นกี่วินาทีถึงตอบอีกครั้ง
      // ขอบเขตการตอบ: all = ตอบทุกคอมเมนต์ (รวมทักทาย/คำชม) · questions = เฉพาะคำถาม
      replyScope: 'all',
      // ลูกค้าถามถึงสินค้าตะกร้าอื่นที่ไม่ใช่ตัวหลัก จะเอายังไง
      //   answer = ตอบเท่าที่มีข้อมูล (ค่าเริ่มต้น)
      //   brief  = ตอบสั้น ๆ ชี้ไปที่ตะกร้า ไม่ลงรายละเอียด
      //   skip   = ไม่ตอบ ปล่อยให้แม่ค้าตอบเอง (ยังขึ้นเตือนในบันทึก)
      otherBasketMode: 'answer',
      pullBackToMain: true, // ปิดท้ายด้วยการชวนกลับมาที่สินค้าหลัก
      ignoreWords: DEFAULT_IGNORE.slice(),
      blockWords: [],       // เจอคำเหล่านี้ = ไม่ตอบเด็ดขาด
      dryRun: true,         // เริ่มต้นให้ "ร่างอย่างเดียว ไม่ส่ง" กันพลาด
      debug: false,         // บันทึกละเอียด: บอกทุกรอบว่ากวาดแชทแล้วเห็นอะไร
    },
    // คลังข้อมูลสินค้าที่เจ้าของร้านกรอกเอง — AI ใช้ตอบลูกค้า
    // [{ basket, name, price, info }]
    products: [],
    selectors: { pinButton: '', extendButton: '', chatList: '', chatInput: '', sendButton: '' },
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
    // ค่าที่บันทึกไว้ตั้งแต่เวอร์ชันก่อน: ย้ายมาใช้วิธีกดปุ่ม "+30 วินาที" ซึ่งปลอดภัยกว่า
    const migrating = src.version !== SETTINGS_VERSION && !!src.pin;
    const ai = Object.assign({}, DEFAULT_SETTINGS.ai, src.ai);
    const selectors = Object.assign({}, DEFAULT_SETTINGS.selectors, src.selectors);

    pin.enabled = !!pin.enabled;
    pin.dryRun = !!pin.dryRun;
    pin.basket = clampInt(pin.basket, 1, 200, DEFAULT_SETTINGS.pin.basket);
    if (!['extend', 'repin'].includes(pin.mode)) pin.mode = 'extend';
    pin.extendEverySec = clampInt(pin.extendEverySec, 20, 120, DEFAULT_SETTINGS.pin.extendEverySec);
    // ต่ำกว่า 30 วิ = ยกเลิก+ปัก 4 คลิก/นาที ถี่เกินไป
    pin.repinEverySec = clampInt(pin.repinEverySec, 30, 600, DEFAULT_SETTINGS.pin.repinEverySec);
    pin.repinGapMs = clampInt(pin.repinGapMs, 300, 5000, DEFAULT_SETTINGS.pin.repinGapMs);
    pin.maxClicksPerMin = clampInt(pin.maxClicksPerMin, 2, 30, DEFAULT_SETTINGS.pin.maxClicksPerMin);

    ai.enabled = !!ai.enabled;
    ai.dryRun = !!ai.dryRun;
    ai.pullBackToMain = !!ai.pullBackToMain;
    ai.debug = !!ai.debug;
    if (!['all', 'questions'].includes(ai.replyScope)) ai.replyScope = 'all';
    if (!['answer', 'brief', 'skip'].includes(ai.otherBasketMode)) ai.otherBasketMode = 'answer';
    if (!PROVIDERS[ai.provider]) ai.provider = 'claude';
    ai.models = Object.assign({}, DEFAULT_SETTINGS.ai.models, ai.models);
    ai.keys = Object.assign({}, DEFAULT_SETTINGS.ai.keys, ai.keys);
    ai.bases = Object.assign({}, DEFAULT_SETTINGS.ai.bases, ai.bases);
    // ค่าเวอร์ชันเก่าเก็บคีย์/รุ่นไว้แบบเดี่ยว ๆ ย้ายมาไว้ช่องของ Claude
    if (src.ai && src.ai.apiKey && !ai.keys.claude) ai.keys.claude = String(src.ai.apiKey).trim();
    if (src.ai && src.ai.model && src.ai.model.startsWith('claude')) ai.models.claude = src.ai.model;
    delete ai.apiKey; delete ai.model; delete ai.apiBase;
    for (const name of Object.keys(PROVIDERS)) {
      ai.models[name] = String(ai.models[name] || PROVIDERS[name].model).trim() || PROVIDERS[name].model;
      ai.keys[name] = String(ai.keys[name] || '').trim();
      ai.bases[name] = String(ai.bases[name] || PROVIDERS[name].base).trim().replace(/\/+$/, '')
        || PROVIDERS[name].base;
    }
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
    // ตำแหน่งปุ่มที่จิ้มไว้เองอาจชี้ไปที่ปุ่มที่ตอนนี้กลายเป็น "ยกเลิกการปักหมุด" — ล้างทิ้งตอนอัปเกรด
    if (migrating) { selectors.pinButton = ''; selectors.extendButton = ''; }

    return { version: SETTINGS_VERSION, pin, ai, products: normalizeProducts(src.products), selectors };
  }

  // ---------- แยกแยะการ์ดในหน้าคอนโซล ----------
  // คูปอง / การแจกรางวัล / แถบรายการสินค้ารวม ก็มีปุ่ม "ปักหมุด" เหมือนกัน
  // ถ้าไม่คัดออก ระบบจะไปกดปักคูปองแทนสินค้า
  const NOT_PRODUCT_RE = /(การแจกรางวัล|แจกรางวัล|โบนัส|ผู้ชนะ|คูปอง|ซื้อขั้นต่ำ|ส่วนลด|ลด\s*\d+\s*%|รายการสินค้าใน\s*LIVE|บิลบอร์ด|แฟลชเซล|เผยแพร่|giveaway|coupon|voucher)/i;
  const PRODUCT_HINT_RE = /(อยู่ในสต็อก|ยอดคลิก|ค่าขอสาธิต|รถเข็น|สินค้าที่ขายได้|Attr\.|in stock|clicks)/i;

  function hasPrice(text) {
    return /฿|บาท/.test(String(text || ''));
  }

  function isProductCardText(text, requireHint) {
    const raw = String(text || '');
    if (!hasPrice(raw)) return false;
    if (NOT_PRODUCT_RE.test(raw)) return false;
    return requireHint ? PRODUCT_HINT_RE.test(raw) : true;
  }

  // เลขลำดับที่โชว์อยู่หัวการ์ด ("1 TOPSUN เก้าอี้สนาม ...")
  function cardIndexFromText(text) {
    const match = String(text || '').trim().match(/^(\d{1,3})(?!\d)/);
    return match ? Number(match[1]) : null;
  }

  function cardNameFromText(text) {
    return String(text || '')
      .replace(/^\s*\d{1,3}\s*/, '')
      .replace(/฿[\d,]+(?:\.\d+)?/g, ' ')
      .replace(/(ปักหมุดแล้ว|ยกเลิกการปักหมุด|ปักหมุด|ตัวเลือกโปรด|อยู่ในสต็อก.*)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);
  }

  // ---------- แยกคอมเมนต์จริงออกจากข้อความ UI ----------
  // หัวเว็บ เมนู ป้ายสถิติ ฯลฯ ก็เป็นข้อความสั้น ๆ เหมือนกัน ถ้าไม่คัดออกจะถูกอ่านเป็นคอมเมนต์
  const UI_NOISE = [
    'ตัวจัดการ LIVE', 'คอนโซล LIVE', 'กิจกรรม LIVE', 'เครื่องมือ LIVE', 'LIVE แจกรางวัล',
    'ไฮไลท์ LIVE', 'คูปองไลฟ์', 'คัดสรรสุดพิเศษ', 'โชว์เคส', 'โชว์เคสสินค้า',
    'ชุดสินค้าสำหรับไลฟ์', 'แคมเปญ LIVE และวิดีโอสั้น', 'การวิเคราะห์', 'การวิเคราะห์ LIVE',
    'ผลการดำเนินงานของ LIVE', 'ประวัติการ LIVE', 'สถานะบัญชี', 'หน้าแรก', 'แดชบอร์ดของ LIVE',
    'แฟลชเซล', 'การแจกรางวัล', 'บิลบอร์ด', 'คูปอง', 'สลับโหมด', 'LIVE แบบด่วน', 'เวลาเริ่มต้น',
    'แชท', 'ทั้งหมด', 'เกี่ยวข้องกับสินค้า', 'กิจกรรม', 'สินค้า', 'เพิ่มสินค้า', 'ยังไม่มีสินค้า',
    'รายการสินค้าใน LIVE นี้', 'ปักหมุด', 'ปักหมุดแล้ว', 'ยกเลิกการปักหมุด', 'ตัวเลือกโปรด',
    'ผู้ชมปัจจุบัน', 'GMV ที่ได้', 'ยอดคลิกสินค้า', 'อัตราการแตะผ่าน', 'ระยะเวลาในการดูเฉลี่ย',
    'คำแนะนำ', 'ความคิดเห็นของผู้ชมจะปรากฏ', 'พิมพ์อะไรสักอย่าง', 'ค้นหารหัสสินค้า',
    'หมวดหมู่ทั้งหมด', 'สต็อกทั้งหมด', 'Promotion quality points',
  ];

  function isUiNoise(text) {
    const raw = normText(text);
    if (!raw) return true;
    const hay = raw.toLowerCase();
    return UI_NOISE.some((label) => {
      const needle = label.toLowerCase();
      // ตรงเป๊ะ หรือขึ้นต้นด้วยป้ายนั้น (เช่น "ตัวจัดการ LIVE ไทย")
      return hay === needle || hay.startsWith(needle);
    });
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
    if (ai.replyScope === 'questions' && !looksLikeQuestion(text)) {
      return { ok: false, reason: 'ตั้งไว้ให้ตอบเฉพาะคำถาม' };
    }

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
    if (ai.replyScope === 'all') {
      lines.push('- ตอบ "ทุกคอมเมนต์" รวมถึงคำทักทาย คำชม อีโมจิ หรือคำพูดลอย ๆ');
      lines.push('  ถ้าไม่ใช่คำถาม ให้ตอบรับสั้น ๆ อย่างเป็นมิตร (ขอบคุณ/ทักกลับ/ชวนดูสินค้า)');
    } else {
      lines.push('- ตอบเฉพาะสิ่งที่ผู้ชมถาม สั้น กระชับ ไม่ทักทายยืดยาว');
    }
    lines.push('- สำคัญ: ห้ามตอบเป็นประโยคแพทเทิร์นเดิมซ้ำ ๆ ให้เปลี่ยนคำพูด สลับคำขึ้นต้น'
      + ' และปรับให้เข้ากับสิ่งที่ลูกค้าคนนั้นพูดจริง ๆ ทุกครั้ง');
    lines.push('- ห้ามแต่งข้อมูลที่ไม่มีในรายการสินค้า (ราคา/โปร/ค่าส่ง/สต็อก) ถ้าไม่รู้ให้บอกว่าเดี๋ยวแม่ค้าตอบในไลฟ์');
    lines.push('- ห้ามใส่ลิงก์ เบอร์โทร ไอดีไลน์ หรือชวนคุยนอกแพลตฟอร์ม');
    lines.push('- ห้ามสัญญาเรื่องการรักษาโรค การลงทุน หรือผลลัพธ์เกินจริง');
    lines.push('- ตอบว่า SKIP อย่างเดียว เฉพาะกรณีข้อความหยาบคาย ก่อกวน สแปม หรือโฆษณาร้านอื่นเท่านั้น');
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
      // หน้ากล้องมีแค่สินค้าตัวหลัก ตัวอื่นหยิบมาโชว์ไม่ได้ ห้ามรับปากเด็ดขาด
      lines.push('- ห้ามพูดว่าจะหยิบสินค้าตัวอื่นมาโชว์ เดี๋ยวโชว์ให้ดู หรือให้รอดูในไลฟ์'
        + ' เพราะหน้ากล้องมีแค่สินค้าตะกร้าที่ ' + focus + ' ตัวเดียว — ให้ชี้ไปที่ตะกร้าแทนเสมอ');
      if (ai.otherBasketMode === 'brief') {
        lines.push('- ถ้าถามถึงตะกร้าอื่นที่ไม่ใช่ที่ ' + focus
          + ' ให้ตอบสั้น ๆ ว่ากดเข้าไปดูในตะกร้าได้เลย ห้ามลงรายละเอียดเอง');
      } else {
        lines.push('- ถ้าถามถึงตะกร้าอื่น ให้ตอบเท่าที่มีข้อมูลจริงในรายการด้านล่างเท่านั้น'
          + ' ถ้าไม่มีข้อมูลของตัวนั้น ให้ชวนกดเข้าไปดูในตะกร้า ห้ามเดาราคาหรือสเปกเด็ดขาด');
        lines.push('  แนวการตอบเวลาไม่มีข้อมูล (เป็นแค่ "แนว" ห้ามลอกทั้งประโยค ให้เปลี่ยนคำพูดทุกครั้ง):');
        lines.push('    · กดเข้าไปดูในตะกร้าได้เลยค่ะ มีรายละเอียดครบ');
        lines.push('    · เบอร์นี้กดดูในตะกร้าก่อนได้นะคะ');
        lines.push('    · อยู่ในตะกร้าแล้วค่ะ กดดูรูปกับสเปกได้เลย');
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

  function buildUserPrompt(comment, recent, reference, recentReplies) {
    const lines = [];
    const lastReplies = (recentReplies || []).slice(-5).filter(Boolean);
    if (lastReplies.length) {
      lines.push('ประโยคที่เราเพิ่งตอบไปในไลฟ์ (ห้ามตอบซ้ำหรือใกล้เคียงกับพวกนี้):');
      lastReplies.forEach((r) => lines.push('- ' + normText(r)));
      lines.push('');
    }
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
        lines.push('ยังไม่มีข้อมูลของตะกร้านี้ — ห้ามเดา และห้ามรับปากว่าจะโชว์ให้ดู'
          + ' ให้ชวนกดเข้าไปดูในตะกร้าด้วยคำพูดของตัวเอง');
      }
    }
    return lines.join('\n');
  }

  // Haiku ยังใช้ output_config.effort ไม่ได้ จึงต้องแยกรูปแบบ body ตามรุ่น
  function supportsEffort(model) {
    return !/^claude-haiku/i.test(String(model || ''));
  }

  // ค่าที่ใช้จริงของค่ายที่เลือกอยู่
  function activeProvider(ai) {
    const name = PROVIDERS[ai.provider] ? ai.provider : 'claude';
    return {
      name,
      label: PROVIDERS[name].label,
      model: ai.models[name],
      key: ai.keys[name],
      base: ai.bases[name],
      url: ai.bases[name] + PROVIDERS[name].path,
    };
  }

  function buildRequestBody(provider, { model, system, user }) {
    if (provider === 'openai') {
      return {
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        max_tokens: 300,
      };
    }
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

  function extractText(provider, response) {
    if (provider === 'openai') {
      const choice = response && response.choices && response.choices[0];
      const text = choice && choice.message && choice.message.content;
      return String(text == null ? '' : text).trim();
    }
    const blocks = (response && response.content) || [];
    return blocks
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join(' ')
      .trim();
  }

  // ---------- ตัวจับเวลาปักหมุด ----------
  /**
   * ตัดสินใจว่ารอบนี้ต้องทำอะไร — แยกเป็นสองงานที่ไม่ยุ่งกัน
   *   งานที่ 1 ปักหมุด: ถ้ายังไม่ปัก → ปักครั้งเดียว / ถ้าปักอยู่แล้ว → ปล่อยไว้ ไม่แตะอีก
   *   งานที่ 2 ต่อเวลา: ถึงรอบแล้วและปุ่ม "+30 วินาที" โผล่อยู่ → กด
   * ระบบนี้ "ไม่กดยกเลิกการปักหมุด" ในทุกกรณี
   *
   * pinState = { pinned, extendAvailable, lastPinAt, lastExtendAt }
   * คืนค่า 'extend' | 'pin' | 'wait' | 'off'
   */
  function nextPinAction(pinState, pin, now) {
    if (!pin.enabled) return 'off';
    const st = pinState || {};

    // โหมดยกเลิกแล้วปักใหม่: ปักอยู่และถึงรอบ → ยกเลิกแล้วปักใหม่ (การ์ดเด้งขึ้นจอผู้ชม)
    if (pin.mode === 'repin' && st.pinned) {
      const since = st.lastRepinAt == null ? st.lastPinAt : st.lastRepinAt;
      if (since != null && now - since < pin.repinEverySec * 1000) return 'wait';
      return 'repin';
    }

    // งานที่ 2 มาก่อน: หมุดที่ปักอยู่ต้องไม่ปล่อยให้หมดเวลา
    if (st.pinned) {
      const due = st.lastExtendAt == null || now - st.lastExtendAt >= pin.extendEverySec * 1000;
      if (due && st.extendAvailable) return 'extend';
      return 'wait';
    }

    // งานที่ 1: ยังไม่ปัก → ปักครั้งเดียว แล้วเว้นอย่างน้อย 20 วินาทีก่อนลองใหม่
    if (st.lastPinAt != null && now - st.lastPinAt < 20000) return 'wait';
    return 'pin';
  }

  // เพดานคลิก: ถ้าโค้ดรวนแล้วกดรัว ต้องหยุดตัวเองก่อนที่ TikTok จะมาหยุดให้
  function withinClickBudget(times, now, maxPerMin) {
    return pruneTimestamps(times, now, 60000).length < clampInt(maxPerMin, 2, 30, 8);
  }

  const api = {
    DEFAULT_SETTINGS, DEFAULT_IGNORE,
    clampInt, toWordList, normalizeSettings, normalizeProducts, normText,
    hasPrice, isProductCardText, cardIndexFromText, cardNameFromText,
    commentId, containsAny, looksLikeQuestion, isUiNoise, detectBasket, resolveProduct, pruneTimestamps, shouldReply,
    isSkip, sanitizeReply, buildSystemPrompt, buildUserPrompt,
    PROVIDERS, activeProvider, supportsEffort, buildRequestBody, extractText, nextPinAction,
    withinClickBudget,
  };

  root.TTLH = Object.assign(root.TTLH || {}, { core: api });
})(typeof globalThis !== 'undefined' ? globalThis : this);
