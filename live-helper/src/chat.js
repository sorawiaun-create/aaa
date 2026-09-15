// เครื่องอ่านคอมเมนต์ + ให้ AI ร่างคำตอบ + พิมพ์ส่งกลับในแชทไลฟ์
(function attach(root) {
  'use strict';
  const { core, dom } = root.TTLH;

  function createAutoReply({ getSettings, log, onStatus, askAI }) {
    const state = {
      seen: {},          // id คอมเมนต์ที่อ่านเข้าคิวแล้ว -> เวลา (กันเข้าคิวซ้ำ)
      handled: {},       // id คอมเมนต์ที่ตัดสินใจ/ตอบไปแล้ว -> เวลา
      lastByUser: {},    // ผู้ใช้ -> เวลาที่ตอบล่าสุด
      replyTimes: [],    // เวลาที่ตอบไป (ใช้จำกัดจำนวนต่อนาที)
      sentLog: [],       // เวลาที่ส่งแชทจริง เก็บไว้ 10 นาที ไว้ดูสถิติกิจกรรม
      ownTexts: [],      // ข้อความที่เราส่งเอง กันตอบตัวเอง
      recent: [],        // คอมเมนต์ล่าสุดไว้เป็นบริบท
      queue: [],
      busy: false,
      observer: null,
      timer: null,
      replied: 0,
      skipped: 0,
      otherBasket: 0,   // จำนวนคำถามที่พูดถึงตะกร้าอื่น (แม่ค้าอาจอยากตอบเอง)
      lastWarnAt: 0,
    };

    function status() {
      if (!onStatus) return;
      onStatus({
        running: !!state.observer,
        queue: state.queue.length,
        replied: state.replied,
        skipped: state.skipped,
        otherBasket: state.otherBasket,
      });
    }

    function warn(message) {
      const now = Date.now();
      if (now - state.lastWarnAt < 15000) return;
      state.lastWarnAt = now;
      log('warn', message);
    }

    function remember(comment) {
      state.seen[core.commentId(comment)] = Date.now();
      state.recent.push(comment);
      if (state.recent.length > 20) state.recent.shift();
      const ids = Object.keys(state.seen);
      if (ids.length > 500) delete state.seen[ids[0]];
    }

    function collect(comment) {
      const id = core.commentId(comment);
      if (state.seen[id]) return;
      remember(comment);
      state.queue.push(comment);
      if (state.queue.length > 30) state.queue.shift(); // คอมเมนต์เก่าเกินไปก็ไม่ต้องตอบแล้ว
      status();
    }

    // อ่านได้เป็นคอมเมนต์แล้วหยุดที่ชั้นนั้น ถ้ายังอ่านไม่ได้ค่อยไล่ลงชั้นลูก
    // (บางทีหน้าเว็บยัดมาทั้งก้อน บางทีมาทีละรายการ)
    function collectTree(node, depth) {
      if (!node || node.nodeType !== 1 || depth > 4) return;
      const comment = dom.parseCommentNode(node);
      if (comment) { collect(comment); return; }
      for (const child of Array.from(node.children)) collectTree(child, depth + 1);
    }

    function send(text) {
      const settings = getSettings();
      const input = dom.chatInput(settings.selectors.chatInput);
      if (!input) { warn('หาช่องพิมพ์แชทไม่เจอ — ใช้ปุ่ม "จิ้มเลือกเอง" ช่วยได้'); return false; }
      dom.typeInto(input, text);
      const btn = dom.sendButton(settings.selectors.sendButton, input);
      if (btn) dom.realClick(btn);
      else dom.pressEnter(input);
      state.ownTexts.push(text);
      if (state.ownTexts.length > 20) state.ownTexts.shift();
      state.sentLog = core.pruneTimestamps(state.sentLog, Date.now(), 600000);
      state.sentLog.push(Date.now());
      return true;
    }

    async function processOne() {
      if (state.busy || !state.queue.length) return;
      const settings = getSettings();
      const comment = state.queue.shift();
      const verdict = core.shouldReply(comment, state, settings.ai, Date.now());
      state.handled[core.commentId(comment)] = Date.now();
      if (!verdict.ok) {
        state.skipped += 1;
        log('mute', 'ข้าม "' + comment.text + '" — ' + verdict.reason);
        status();
        return;
      }

      state.busy = true;
      status();
      try {
        const focus = settings.pin.basket;
        const context = {
          scraped: dom.scrapeProducts(8),
          knowledge: settings.products,
          focusBasket: focus,
        };

        // ลูกค้าอ้างสินค้าด้วยเลข เช่น "หมายเลข14" — เช็กว่าเป็นตัวหลักหรือตัวอื่น
        const basket = core.detectBasket(comment.text);
        const reference = basket ? core.resolveProduct(basket, context) : null;
        if (reference && reference.basket !== focus) {
          state.otherBasket += 1;
          log('ask', 'ถามถึงตะกร้าที่ ' + reference.basket + ' — ' + comment.user + ': ' + comment.text
            + (reference.known ? '' : ' (ยังไม่มีข้อมูลตัวนี้)'));
          if (settings.ai.otherBasketMode === 'skip') {
            state.skipped += 1;
            log('mute', 'ไม่ตอบให้ ตามที่ตั้งไว้ว่าให้แม่ค้าตอบเอง');
            return;
          }
        }

        const system = core.buildSystemPrompt(settings.ai, context);
        const user = core.buildUserPrompt(comment, state.recent, reference, state.ownTexts);
        const result = await askAI({ system, user });
        if (!result.ok) { log('err', 'AI ตอบไม่สำเร็จ: ' + result.error); return; }

        if (core.isSkip(result.text)) {
          state.skipped += 1;
          log('mute', 'AI เลือกไม่ตอบ "' + comment.text + '"');
          return;
        }
        const reply = core.sanitizeReply(result.text, settings.ai.maxChars);
        if (!reply) { state.skipped += 1; log('mute', 'AI ตอบว่าง เลยข้าม'); return; }

        if (settings.ai.dryRun) {
          state.ownTexts.push(reply);
          if (state.ownTexts.length > 20) state.ownTexts.shift();
          log('info', '[ร่าง ไม่ส่ง] ' + comment.user + ' → ' + reply);
          return;
        }
        if (!send(reply)) return;
        state.replied += 1;
        state.replyTimes = core.pruneTimestamps(state.replyTimes, Date.now(), 60000);
        state.replyTimes.push(Date.now());
        state.lastByUser[core.normText(comment.user).toLowerCase()] = Date.now();
        log('ok', 'ตอบ ' + comment.user + ' → ' + reply);
      } catch (err) {
        log('err', 'ตอบคอมเมนต์ผิดพลาด: ' + (err && err.message ? err.message : String(err)));
      } finally {
        state.busy = false;
        status();
      }
    }

    function attachObserver() {
      const settings = getSettings();
      const list = dom.chatList(settings.selectors.chatList);
      if (!list) {
        warn('หากล่องรายการแชทไม่เจอ — เปิดแท็บ "แชท" ค้างไว้ หรือใช้ปุ่ม "จิ้มเลือกเอง"');
        return false;
      }
      // คอมเมนต์ที่มีอยู่ก่อนกดเริ่ม ถือว่าอ่านแล้ว จะได้ไม่ย้อนไปตอบของเก่า
      list.querySelectorAll('*').forEach((node) => {
        const comment = dom.parseCommentNode(node);
        if (comment) state.seen[core.commentId(comment)] = Date.now();
      });

      state.observer = new MutationObserver((records) => {
        for (const record of records) {
          record.addedNodes.forEach((node) => collectTree(node, 0));
        }
      });
      state.observer.observe(list, { childList: true, subtree: true });
      return true;
    }

    return {
      start() {
        if (state.observer) return;
        if (!attachObserver()) return;
        state.timer = setInterval(processOne, 1500);
        log('ok', 'เริ่มระบบ AI ตอบคอมเมนต์');
        if (getSettings().ai.dryRun) {
          log('warn', '⚠️ "โหมดร่าง" เปิดอยู่ — AI จะคิดคำตอบให้ดูแต่ไม่ส่งเข้าแชทจริง'
            + ' ถ้าต้องการให้ส่งจริง ให้เอาเครื่องหมายถูกหน้า "โหมดร่าง" ออก');
        }
        status();
      },

      // ไล่เช็กทีละขั้นว่าติดตรงไหน เวลา AI ไม่ตอบ
      diagnose() {
        const settings = getSettings();
        const list = dom.chatList(settings.selectors.chatList);
        const input = dom.chatInput(settings.selectors.chatInput);
        const sendBtn = dom.sendButton(settings.selectors.sendButton, input);
        const provider = core.activeProvider(settings.ai);

        log('info', '1) กล่องแชท: ' + (list ? 'เจอแล้ว' : 'ไม่เจอ — กด "จิ้มเลือกกล่องแชท"'));
        log('info', '2) ช่องพิมพ์: ' + (input ? 'เจอแล้ว' : 'ไม่เจอ — กด "จิ้มเลือกช่องพิมพ์"')
          + ' · ปุ่มส่ง: ' + (sendBtn ? 'เจอแล้ว' : 'ไม่เจอ (จะใช้ปุ่ม Enter แทน)'));
        log('info', '3) AI: ' + provider.label + ' รุ่น ' + provider.model
          + ' · คีย์: ' + (provider.key ? 'ใส่แล้ว' : 'ยังไม่ได้ใส่'));
        log('info', '4) โหมดร่าง: ' + (settings.ai.dryRun ? 'เปิดอยู่ (จะไม่ส่งจริง)' : 'ปิดอยู่ (ส่งจริง)')
          + ' · ระบบทำงานอยู่: ' + (state.observer ? 'ใช่' : 'ไม่'));
        log('info', '5) อ่านคอมเมนต์มาแล้ว ' + Object.keys(state.seen).length + ' ข้อความ'
          + ' · รอตอบในคิว ' + state.queue.length
          + ' · ตอบไปแล้ว ' + state.replied + ' · ข้าม ' + state.skipped);
        if (list) dom.flash(list);
      },

      // ส่งข้อความจริงเข้าแชทหนึ่งครั้ง เพื่อพิสูจน์ว่าเส้นทางการส่งใช้ได้
      sendTest(text) {
        const message = core.sanitizeReply(text || 'ทดสอบระบบค่ะ', getSettings().ai.maxChars);
        if (send(message)) log('ok', 'ส่งข้อความทดสอบเข้าแชทแล้ว: ' + message);
      },
      stop() {
        if (state.observer) state.observer.disconnect();
        if (state.timer) clearInterval(state.timer);
        state.observer = null;
        state.timer = null;
        state.queue.length = 0;
        log('info', 'หยุดระบบ AI ตอบคอมเมนต์');
        status();
      },
      isRunning() { return !!state.observer; },
      // ทดสอบว่าเส้นทาง AI ใช้ได้ไหม โดยไม่ต้องรอลูกค้าคอมเมนต์จริง
      async test(text) {
        const settings = getSettings();
        const comment = { user: 'ทดสอบ', text: String(text || '').trim() };
        if (!comment.text) { log('warn', 'พิมพ์ข้อความที่จะทดสอบก่อน'); return; }
        log('info', 'ทดสอบ: ' + comment.text);
        const system = core.buildSystemPrompt(settings.ai, {
          scraped: dom.scrapeProducts(8),
          knowledge: settings.products,
          focusBasket: settings.pin.basket,
        });
        const result = await askAI({ system, user: core.buildUserPrompt(comment, [], null, state.ownTexts) });
        if (!result.ok) { log('err', 'AI ตอบไม่สำเร็จ: ' + result.error); return; }
        if (core.isSkip(result.text)) { log('mute', 'AI เลือกไม่ตอบข้อความนี้'); return; }
        log('ok', 'AI ตอบว่า → ' + core.sanitizeReply(result.text, settings.ai.maxChars));
      },
      state,
    };
  }

  root.TTLH = Object.assign(root.TTLH || {}, { createAutoReply });
})(typeof window !== 'undefined' ? window : globalThis);
