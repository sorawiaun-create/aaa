// เครื่องปักหมุดอัตโนมัติ — เดินทุก 1 วินาที แล้วตัดสินใจตามตรรกะใน core.nextPinAction
(function attach(root) {
  'use strict';
  const { core, dom } = root.TTLH;

  function createAutoPin({ getSettings, log, onStatus, getCaptchaCount }) {
    const state = { lastActionAt: null, nextDelayMs: 0, pinned: false, timer: null, lastWarnAt: 0 };

    // เรียกทุกครั้งหลังลงมือ เพื่อสุ่มรอบถัดไป (และยืดออกถ้าเคยเจอจิ๊กซอว์)
    function scheduleNext() {
      const count = getCaptchaCount ? getCaptchaCount() : 0;
      state.nextDelayMs = core.nextDelayMs(getSettings().pin, count, Math.random);
    }

    function status(extra) {
      if (!onStatus) return;
      const pin = getSettings().pin;
      const wait = state.nextDelayMs || pin.intervalSec * 1000;
      const next = state.lastActionAt == null ? 0
        : Math.max(0, Math.ceil((state.lastActionAt + wait - Date.now()) / 1000));
      onStatus(Object.assign({ running: !!state.timer, pinned: state.pinned, nextIn: next }, extra));
    }

    // ป้ายกำกับที่อ่านรู้เรื่องว่ากำลังทำอะไรกับสินค้าตัวไหน
    function label(basket) {
      const name = dom.targetName(basket);
      return 'ตะกร้าที่ ' + basket + (name ? ' — ' + name : '');
    }

    function warn(message) {
      const now = Date.now();
      if (now - state.lastWarnAt < 15000) return; // กันบันทึกท่วมจอ
      state.lastWarnAt = now;
      log('warn', message);
    }

    function tick() {
      const settings = getSettings();
      const pin = settings.pin;
      state.pinned = dom.isPinned(pin.basket);

      const action = core.nextPinAction(state, pin, Date.now());
      if (action === 'off' || action === 'wait') { status(); return; }

      // ยกเลิกหมุดแล้วปักใหม่ เพื่อให้การ์ดสินค้าเด้งขึ้นจอผู้ชมอีกรอบ
      if (action === 'repin') {
        const unpin = dom.unpinButton(pin.basket);
        if (!unpin) {
          warn('หาปุ่ม "ยกเลิกการปักหมุด" ของตะกร้าที่ ' + pin.basket + ' ไม่เจอ');
          status();
          return;
        }
        state.lastActionAt = Date.now();
        scheduleNext();
        if (pin.dryRun) {
          log('info', '[ซ้อม] จะยกเลิกหมุดแล้วปักใหม่ · ' + label(pin.basket));
          status();
          return;
        }
        dom.realClick(unpin);
        // รอให้หน้าเว็บอัปเดตปุ่มกลับเป็น "ปักหมุด" ก่อนค่อยกดซ้ำ
        setTimeout(() => {
          const again = dom.pinButton(pin.basket, settings.selectors.pinButton);
          if (!again) {
            warn('ยกเลิกหมุดแล้วแต่หาปุ่มปักหมุดใหม่ไม่เจอ — รอบหน้าจะลองอีกครั้ง');
            state.lastActionAt = null; // ให้ลองใหม่ทันทีในรอบถัดไป
            return;
          }
          dom.realClick(again);
          state.lastActionAt = Date.now();
          log('ok', 'ปักหมุดใหม่แล้ว (เด้งขึ้นจอผู้ชมอีกรอบ) · ' + label(pin.basket));
          status();
        }, pin.repinGapMs);
        status();
        return;
      }

      if (action === 'extend') {
        const btn = dom.extendButton();
        if (!btn) { status(); return; } // ปุ่มต่อเวลาโผล่เฉพาะตอนหมุดใกล้หมด รอรอบหน้า
        if (pin.dryRun) log('info', '[ซ้อม] จะกดต่อเวลาหมุด (+วินาที)');
        else { dom.realClick(btn); log('ok', 'ต่อเวลาหมุด · ' + label(pin.basket)); }
        state.lastActionAt = Date.now();
        scheduleNext();
        status();
        return;
      }

      const btn = dom.pinButton(pin.basket, settings.selectors.pinButton);
      if (!btn) {
        warn('หาปุ่ม "ปักหมุด" ของตะกร้าที่ ' + pin.basket + ' ไม่เจอ — ลองเลื่อนรายการสินค้าให้เห็นการ์ด หรือใช้ปุ่ม "จิ้มเลือกเอง"');
        status();
        return;
      }
      if (pin.dryRun) {
        log('info', '[ซ้อม] จะกดปักหมุด · ' + label(pin.basket));
      } else {
        dom.realClick(btn);
        log('ok', 'ปักหมุดแล้ว · ' + label(pin.basket));
      }
      state.lastActionAt = Date.now();
      scheduleNext();
      status();
    }

    return {
      start() {
        if (state.timer) return;
        state.lastActionAt = null; // เริ่มปุ๊บปักหมุดทันที
        scheduleNext();
        state.timer = setInterval(tick, 1000);
        log('ok', 'เริ่มระบบปักหมุดอัตโนมัติ (ทุก ' + getSettings().pin.intervalSec + ' วินาที)');
        tick();
      },
      stop() {
        if (state.timer) clearInterval(state.timer);
        state.timer = null;
        log('info', 'หยุดระบบปักหมุดอัตโนมัติ');
        status();
      },
      pinNow() { state.lastActionAt = null; tick(); },
      // ตรวจก่อนกดจริงว่าระบบเล็งการ์ดใบไหนอยู่ (กันไปกดโดนคูปอง/การแจกรางวัล)
      preview() {
        const basket = getSettings().pin.basket;
        const card = dom.productCard(basket);
        if (!card) {
          log('warn', 'ยังหาการ์ดสินค้าของตะกร้าที่ ' + basket + ' ไม่เจอ — เลื่อนรายการสินค้าให้เห็นการ์ดก่อน');
          return;
        }
        dom.flash(card);
        log('ok', 'จะปัก: ' + label(basket) + ' (กรอบสีชมพูในหน้าเว็บ)');
        const all = dom.productCards().length;
        log('info', 'ตอนนี้เห็นการ์ดสินค้าทั้งหมด ' + all + ' ใบ');
      },
      isRunning() { return !!state.timer; },
      state,
    };
  }

  root.TTLH = Object.assign(root.TTLH || {}, { createAutoPin });
})(typeof window !== 'undefined' ? window : globalThis);
