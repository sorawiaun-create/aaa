// เครื่องปักหมุดอัตโนมัติ — เดินทุก 1 วินาที แล้วตัดสินใจตามตรรกะใน core.nextPinAction
(function attach(root) {
  'use strict';
  const { core, dom } = root.TTLH;

  function createAutoPin({ getSettings, log, onStatus }) {
    const state = { lastActionAt: null, pinned: false, timer: null, lastWarnAt: 0 };

    function status(extra) {
      if (!onStatus) return;
      const pin = getSettings().pin;
      const next = state.lastActionAt == null ? 0
        : Math.max(0, Math.ceil((state.lastActionAt + pin.intervalSec * 1000 - Date.now()) / 1000));
      onStatus(Object.assign({ running: !!state.timer, pinned: state.pinned, nextIn: next }, extra));
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
        if (pin.dryRun) {
          log('info', '[ซ้อม] จะยกเลิกหมุดแล้วปักสินค้าที่ ' + pin.basket + ' ใหม่');
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
          log('ok', 'ปักหมุดสินค้าที่ ' + pin.basket + ' ใหม่แล้ว (เด้งขึ้นจอผู้ชมอีกรอบ)');
          status();
        }, pin.repinGapMs);
        status();
        return;
      }

      if (action === 'extend') {
        const btn = dom.extendButton();
        if (!btn) { status(); return; } // ปุ่มต่อเวลาโผล่เฉพาะตอนหมุดใกล้หมด รอรอบหน้า
        if (pin.dryRun) log('info', '[ซ้อม] จะกดต่อเวลาหมุด (+วินาที)');
        else { dom.realClick(btn); log('ok', 'ต่อเวลาหมุดสินค้าที่ ' + pin.basket + ' แล้ว'); }
        state.lastActionAt = Date.now();
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
        log('info', '[ซ้อม] จะกดปักหมุดสินค้าที่ ' + pin.basket);
      } else {
        dom.realClick(btn);
        log('ok', 'ปักหมุดสินค้าที่ ' + pin.basket + ' แล้ว');
      }
      state.lastActionAt = Date.now();
      status();
    }

    return {
      start() {
        if (state.timer) return;
        state.lastActionAt = null; // เริ่มปุ๊บปักหมุดทันที
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
      isRunning() { return !!state.timer; },
      state,
    };
  }

  root.TTLH = Object.assign(root.TTLH || {}, { createAutoPin });
})(typeof window !== 'undefined' ? window : globalThis);
