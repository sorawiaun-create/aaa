"""จับภาพหน้าต่างด้วย Windows Graphics Capture (WGC) — แบบเดียวกับที่ OBS ใช้

จับหน้าต่างได้แม้ถูกบัง/ย่อ และแม้แอปเรนเดอร์ด้วยการ์ดจอ (เช่น TikTok Live Studio)
ต้องติดตั้งไลบรารี: pip install windows-capture  (Windows 10 1903+ เท่านั้น)

ออกแบบเป็น session ที่รันต่อเนื่องในเธรดเบื้องหลัง แล้วเก็บเฟรมล่าสุดไว้
เรียก .grab() เพื่อดึงภาพ BGR ล่าสุด (numpy) — คืน None ถ้ายังไม่มีเฟรม
"""

import threading
import time


def available():
    try:
        import windows_capture  # noqa: F401
        return True
    except Exception:
        return False


def _frame_to_bgr(frame):
    """แปลง Frame ของ windows-capture เป็น numpy BGR (รองรับหลายเวอร์ชันของ API)"""
    buf = None
    for attr in ("frame_buffer",):
        buf = getattr(frame, attr, None)
        if buf is not None:
            break
    if buf is None:
        # บาง API ต้องแปลงก่อน
        conv = getattr(frame, "convert_to_bgr", None)
        if conv is not None:
            buf = getattr(conv(), "frame_buffer", None)
    if buf is None:
        return None
    if buf.ndim == 3 and buf.shape[2] == 4:
        return buf[:, :, :3].copy()  # BGRA -> BGR
    return buf.copy()


class WGCSession:
    def __init__(self, window_name, wait_first=1.0):
        from windows_capture import WindowsCapture

        self.window_name = window_name
        self._latest = None
        self._lock = threading.Lock()
        self._control = None
        self._thread = None

        cap = WindowsCapture(
            cursor_capture=False,
            draw_border=False,
            window_name=window_name,
        )

        @cap.event
        def on_frame_arrived(frame, capture_control):
            bgr = _frame_to_bgr(frame)
            if bgr is not None:
                with self._lock:
                    self._latest = bgr

        @cap.event
        def on_closed():
            pass

        self._cap = cap
        # เริ่มจับ — ใช้ free-threaded ถ้ามี ไม่งั้นสร้างเธรดเอง
        start_ft = getattr(cap, "start_free_threaded", None)
        if start_ft is not None:
            self._control = start_ft()
        else:
            self._thread = threading.Thread(target=cap.start, daemon=True)
            self._thread.start()

        # รอเฟรมแรกสักครู่ (กัน grab() คืน None ตอนเพิ่งเริ่ม)
        deadline = wait_first
        step = 0.05
        while deadline > 0 and self.grab() is None:
            time.sleep(step)
            deadline -= step

    def grab(self):
        with self._lock:
            return None if self._latest is None else self._latest.copy()

    def stop(self):
        try:
            if self._control is not None and hasattr(self._control, "stop"):
                self._control.stop()
        except Exception:
            pass
