// เครื่องอ่านคอมเมนต์ + ให้ AI ร่างคำตอบ + พิมพ์ส่งกลับในแชทไลฟ์
(function attach(root) {
  'use strict';
  const { core, dom } = root.TTLH;

  function createAutoReply({ getSettings, log, onStatus, askAI }) {
    const state = {
      seen: {},          // id คอมเมนต์ที่เห็นแล้ว -> เวลา
      lastByUser: {},    // ผู้ใช้ -> เวลาที่ตอบล่าสุด
      replyTimes: [],    // เวลาที่ตอบไป (ใช้จำกัดจำนวนต่อนาที)
      ownTexts: [],      // ข้อความที่เราส่งเอง กันตอบตัวเอง
      recent: [],        // คอมเมนต์ล่าสุดไว้เป็นบริบท
      queue: [],
      busy: false,
      observer: null,
      timer: null,
      replied: 0,
      skipped: 0,
      lastWarnAt: 0,
    };

    function status() {
      if (!onStatus) return;
      onStatus({
        running: !!state.observer,
        queue: state.queue.length,
        replied: state.replied,
        skipped: state.skipped,
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

    function collect(node) {
      const comment = dom.parseCommentNode(node);
      if (!comment) return;
      const id = core.commentId(comment);
      if (state.seen[id]) return;
      remember(comment);
      state.queue.push(comment);
      if (state.queue.length > 30) state.queue.shift(); // คอมเมนต์เก่าเกินไปก็ไม่ต้องตอบแล้ว
      status();
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
      return true;
    }

    async function processOne() {
      if (state.busy || !state.queue.length) return;
      const settings = getSettings();
      const comment = state.queue.shift();
      const verdict = core.shouldReply(comment, state, settings.ai, Date.now());
      if (!verdict.ok) {
        state.skipped += 1;
        log('mute', 'ข้าม "' + comment.text + '" — ' + verdict.reason);
        status();
        return;
      }

      state.busy = true;
      status();
      try {
        const products = dom.scrapeProducts(8);
        const system = core.buildSystemPrompt(settings.ai, products);
        const user = core.buildUserPrompt(comment, state.recent);
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
          record.addedNodes.forEach((node) => {
            if (node.nodeType !== 1) return;
            collect(node);
            node.querySelectorAll && node.querySelectorAll(':scope > *').forEach(collect);
          });
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
        log('ok', 'เริ่มระบบ AI ตอบคอมเมนต์' + (getSettings().ai.dryRun ? ' (โหมดร่าง ไม่ส่งจริง)' : ''));
        status();
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
      state,
    };
  }

  root.TTLH = Object.assign(root.TTLH || {}, { createAutoReply });
})(typeof window !== 'undefined' ? window : globalThis);
