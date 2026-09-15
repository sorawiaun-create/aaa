// เครื่องปักหมุดอัตโนมัติ — แยกเป็นสองงานที่ไม่ยุ่งกัน เดินตรวจทุก 1 วินาที
//   งานที่ 1 ปักหมุด : ยังไม่ปัก → ปักครั้งเดียว · ปักอยู่แล้ว → ปล่อยไว้ ไม่แตะอีก
//   งานที่ 2 ต่อเวลา : ถึงรอบ (ค่าเริ่มต้น 31 วิ) และปุ่ม "+30 วินาที" โผล่ → กด
// ไฟล์นี้ไม่มีการกด "ยกเลิกการปักหมุด" ในทุกกรณี
(function attach(root) {
  'use strict';
  const { core, dom } = root.TTLH;

  const ASSUME_PINNED_MS = 25000; // กดไปแล้วให้ถือว่าปักอยู่ 25 วิ กันอ่านสถานะพลาด

  function createAutoPin({ getSettings, log, onStatus, onHalt }) {
    const state = {
      timer: null,
      clicks: [],
      pinned: false,
      extendAvailable: false,
      lastPinAt: null,
      lastExtendAt: null,
      lastRepinAt: null,
      assumePinnedUntil: 0,
      pins: 0,
      extends: 0,
      lastWarnAt: 0,
    };

    function label(basket) {
      const name = dom.targetName(basket);
      return 'ตะกร้าที่ ' + basket + (name ? ' — ' + name : '');
    }

    function warn(message) {
      const now = Date.now();
      if (now - state.lastWarnAt < 20000) return; // กันบันทึกท่วมจอ
      state.lastWarnAt = now;
      log('warn', message);
    }

    function stopTimer() {
      if (state.timer) clearInterval(state.timer);
      state.timer = null;
    }

    function status() {
      if (!onStatus) return;
      const pin = getSettings().pin;
      const since = pin.mode === 'repin'
        ? (state.lastRepinAt == null ? state.lastPinAt : state.lastRepinAt)
        : state.lastExtendAt;
      const every = pin.mode === 'repin' ? pin.repinEverySec : pin.extendEverySec;
      const nextIn = since == null ? 0
        : Math.max(0, Math.ceil((since + every * 1000 - Date.now()) / 1000));
      onStatus({
        mode: pin.mode,
        running: !!state.timer,
        pinned: state.pinned,
        extendReady: state.extendAvailable,
        pins: state.pins,
        extends: state.extends,
        nextIn,
      });
    }

    // ทุกการคลิกต้องผ่านตรงนี้ ถ้าเกินเพดานต่อนาที = ระบบรวน ให้หยุดตัวเองทันที
    function click(el) {
      const now = Date.now();
      const max = getSettings().pin.maxClicksPerMin;
      state.clicks = core.pruneTimestamps(state.clicks, now, 60000);
      if (!core.withinClickBudget(state.clicks, now, max)) {
        stopTimer();
        log('err', 'กดถี่ผิดปกติ (เกิน ' + max + ' ครั้ง/นาที) — หยุดระบบปักหมุดไว้ก่อน');
        if (onHalt) onHalt();
        return false;
      }
      state.clicks.push(now);
      dom.realClick(el);
      return true;
    }

    // งานที่ 2: กดปุ่ม "+30 วินาที"
    function doExtend(button, pin) {
      const now = Date.now();
      if (pin.dryRun) {
        state.lastExtendAt = now;
        log('info', '[ซ้อม] จะกดต่อเวลา "' + dom.textOf(button) + '"');
        return;
      }
      if (!click(button)) return;
      state.lastExtendAt = now;
      state.assumePinnedUntil = now + ASSUME_PINNED_MS;
      state.extends += 1;
      log('ok', 'กดต่อเวลา +30 วิ แล้ว (ครั้งที่ ' + state.extends + ')');
    }

    // โหมด repin: ยกเลิกหมุด แล้วเว้นช่วงให้หน้าเว็บอัปเดตปุ่มก่อนค่อยปักใหม่
    // (ทุกคลิกอ่านข้อความบนปุ่มก่อน และผ่านเพดานคลิกเหมือนกันหมด)
    function doRepin(settings, pin) {
      const unpin = dom.unpinButton(pin.basket);
      if (!unpin) {
        warn('หาปุ่ม "ยกเลิกการปักหมุด" ของตะกร้าที่ ' + pin.basket + ' ไม่เจอ — รอบหน้าจะลองใหม่');
        return;
      }
      const now = Date.now();
      state.lastRepinAt = now;   // จองรอบไว้ก่อนเสมอ กันวนกดซ้ำถ้าขั้นตอนหลังพลาด
      if (pin.dryRun) {
        log('info', '[ซ้อม] จะยกเลิกหมุดแล้วปักใหม่ · ' + label(pin.basket));
        return;
      }
      if (!click(unpin)) return;
      log('info', 'ยกเลิกหมุดแล้ว กำลังปักใหม่...');
      setTimeout(() => {
        const again = dom.pinButton(pin.basket, settings.selectors.pinButton);
        if (!again) {
          warn('ยกเลิกแล้วแต่หาปุ่ม "ปักหมุด" ไม่เจอ — จะลองใหม่รอบหน้า');
          return;
        }
        if (!click(again)) return;
        state.lastPinAt = Date.now();
        state.lastExtendAt = Date.now();
        state.assumePinnedUntil = Date.now() + ASSUME_PINNED_MS;
        state.pins += 1;
        log('ok', 'ปักหมุดใหม่แล้ว (เด้งขึ้นจอผู้ชมอีกรอบ) · ' + label(pin.basket));
        status();
      }, pin.repinGapMs);
    }

    // งานที่ 1: ปักหมุดครั้งเดียวตอนที่ยังไม่ได้ปัก
    function doPin(settings, pin) {
      const button = dom.pinButton(pin.basket, settings.selectors.pinButton);
      if (!button) {
        warn('หาปุ่ม "ปักหมุด" ของตะกร้าที่ ' + pin.basket + ' ไม่เจอ'
          + ' — เลื่อนรายการสินค้าให้เห็นการ์ด หรือปักหมุดเองสักครั้งก็ได้');
        return;
      }
      const now = Date.now();
      if (pin.dryRun) {
        state.lastPinAt = now;
        log('info', '[ซ้อม] จะกดปักหมุด · ' + label(pin.basket));
        return;
      }
      if (!click(button)) return;
      state.lastPinAt = now;
      state.lastExtendAt = now;   // หมุดเพิ่งเริ่มนับ 30 วิ รอบต่อเวลาเริ่มนับจากตรงนี้
      state.assumePinnedUntil = now + ASSUME_PINNED_MS;
      state.pins += 1;
      log('ok', 'ปักหมุดแล้ว · ' + label(pin.basket));
    }

    function tick() {
      const settings = getSettings();
      const pin = settings.pin;
      const now = Date.now();

      // อ่านสถานะจากหน้าเว็บ แต่ถ้าเพิ่งกดไปเองก็เชื่อตัวเองไว้ก่อน
      state.pinned = dom.isPinned(pin.basket) || now < state.assumePinnedUntil;
      const extendBtn = dom.extendButton(settings.selectors.extendButton);
      state.extendAvailable = !!extendBtn;

      const action = core.nextPinAction(state, pin, now);
      if (action === 'extend') doExtend(extendBtn, pin);
      else if (action === 'repin') doRepin(settings, pin);
      else if (action === 'pin') doPin(settings, pin);
      else if (action === 'wait' && state.pinned && !state.extendAvailable
        && state.lastExtendAt != null && now - state.lastExtendAt > (pin.extendEverySec + 15) * 1000) {
        warn('ถึงรอบกดต่อเวลาแล้วแต่ยังหาปุ่ม "+30 วินาที" ไม่เจอ'
          + ' — ตอนปุ่มโผล่ให้กด "จิ้มเลือกปุ่ม +30 วิ" เพื่อชี้ตำแหน่งให้ระบบ');
      }

      status();
    }

    return {
      start() {
        if (state.timer) return;
        // เริ่มใหม่ทุกครั้ง: ลืมประวัติเก่าให้หมด จะได้ไม่เอาเวลาค้างมาคำนวณผิด
        state.lastPinAt = null;
        state.lastExtendAt = null;
        state.lastRepinAt = null;
        state.assumePinnedUntil = 0;
        state.clicks = [];
        state.timer = setInterval(tick, 1000);
        const pin = getSettings().pin;
        log('ok', pin.mode === 'repin'
          ? 'เริ่มทำงาน — ปักหมุดถ้ายังไม่ปัก แล้วยกเลิก+ปักใหม่ทุก ' + pin.repinEverySec + ' วินาที'
          : 'เริ่มทำงาน — ปักหมุดถ้ายังไม่ปัก แล้วกด +30 วิ ทุก ' + pin.extendEverySec + ' วินาที');
        tick();
      },
      stop() {
        stopTimer();
        log('info', 'หยุดระบบปักหมุดอัตโนมัติ');
        status();
      },
      // กดต่อเวลาเดี๋ยวนี้ (ถ้าปุ่มโผล่อยู่)
      extendNow() {
        const settings = getSettings();
        const button = dom.extendButton(settings.selectors.extendButton);
        if (!button) { log('warn', 'ตอนนี้ยังไม่เห็นปุ่ม "+30 วินาที" บนหน้าจอ'); return; }
        doExtend(button, settings.pin);
        status();
      },
      pinNow() {
        const settings = getSettings();
        state.lastPinAt = null;
        doPin(settings, settings.pin);
        status();
      },
      // รายงานสิ่งที่ระบบเห็นจริง ๆ ไว้ไล่ปัญหา
      preview() {
        const settings = getSettings();
        const basket = settings.pin.basket;
        const card = dom.productCard(basket);
        if (!card) {
          log('warn', 'ยังหาการ์ดสินค้าของตะกร้าที่ ' + basket + ' ไม่เจอ — เลื่อนรายการสินค้าให้เห็นการ์ดก่อน');
          return;
        }
        dom.flash(card);
        const pinBtn = dom.pinButton(basket, settings.selectors.pinButton);
        const extendBtn = dom.extendButton(settings.selectors.extendButton);
        log('ok', 'เล็งอยู่ที่: ' + label(basket) + ' (กรอบสีชมพูในหน้าเว็บ)');
        log('info', 'การ์ดทั้งหมด ' + dom.productCards().length + ' ใบ'
          + ' · ปักหมุดอยู่: ' + (dom.isPinned(basket) ? 'ใช่' : 'ไม่')
          + ' · ปุ่มปักที่จะกด: ' + (pinBtn ? '"' + dom.textOf(pinBtn) + '"' : 'ไม่มี (ปักอยู่แล้ว/หาไม่เจอ)')
          + ' · ปุ่มต่อเวลา: ' + (extendBtn ? '"' + dom.textOf(extendBtn) + '"' : 'ยังไม่โผล่'));
      },
      isRunning() { return !!state.timer; },
      state,
    };
  }

  root.TTLH = Object.assign(root.TTLH || {}, { createAutoPin });
})(typeof window !== 'undefined' ? window : globalThis);
