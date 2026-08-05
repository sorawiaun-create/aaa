"""ตรวจจับกล่องจิ๊กซอว์ยืนยันตัวตนบนหน้าจอด้วยการเทียบภาพ (template matching)

หลักการ: จับภาพหน้าจอ -> เทียบกับรูป template ของกล่องจิ๊กซอว์ที่เตรียมไว้
ถ้าความคล้ายเกินค่า threshold ถือว่า "เจอ"

ใช้ multi-scale matching (เทียบหลายขนาด) เพื่อให้ทนกับกรณีที่รูปตอน calibrate
กับตอนจับจริงขนาดต่างกัน (เช่น calibrate จากรูปเต็มจอ แต่รันด้วย window capture)
"""

import cv2
import numpy as np
import mss

# ขนาดที่ลองเทียบตอนใช้งานจริง (เผื่อ template กับภาพจริงขนาดไม่เท่ากันเล็กน้อย)
DEFAULT_SCALES = [0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3]
# ตอนทดสอบ (offline) ลองละเอียดขึ้น เพื่อหาสเกลที่ตรงที่สุด
FINE_SCALES = [round(0.4 + 0.05 * i, 2) for i in range(0, 25)]  # 0.40 .. 1.60


def pick_monitor(sct, monitor_index):
    """เลือกจอจาก mss.monitors อย่างปลอดภัย (0 = ทุกจอรวมกัน, 1 = จอหลัก, 2 = จอที่สอง...)"""
    mons = sct.monitors
    idx = int(monitor_index)
    if idx < 0 or idx >= len(mons):
        idx = 1 if len(mons) > 1 else 0
    return mons[idx]


def capture_screen(path, region=None, window_title=None, monitor_index=1):
    """จับภาพ ณ ตอนนี้ บันทึกเป็นไฟล์ (ไม่ต้องมี template) — ใช้ดูตัวอย่างว่าโปรแกรมเห็นอะไร

    คืนค่า (path, mode) โดย mode = 'window' ถ้าใช้ window capture, 'screen' ถ้าจับทั้งจอ
    """
    if window_title:
        # 1) WGC (จับได้แม้โดนบัง/การ์ดจอ) — วิธีที่ดีที่สุด
        try:
            import wgc_capture
            if wgc_capture.available():
                sess = wgc_capture.WGCSession(window_title)
                img = sess.grab()
                sess.stop()
                if img is not None and img.any():
                    cv2.imwrite(path, img, [cv2.IMWRITE_JPEG_QUALITY, 85])
                    return path, "window(WGC)"
        except Exception:
            pass
        # 2) PrintWindow (สำรอง)
        try:
            import window_capture as wc
            hwnd = wc.find_window(window_title)
            if hwnd:
                img = wc.capture_window(hwnd)
                if img is not None:
                    cv2.imwrite(path, img, [cv2.IMWRITE_JPEG_QUALITY, 85])
                    return path, "window"
        except Exception:
            pass
    with mss.mss() as sct:
        if region:
            x, y, w, h = region
            mon = {"left": int(x), "top": int(y), "width": int(w), "height": int(h)}
        else:
            mon = pick_monitor(sct, monitor_index)
        raw = sct.grab(mon)
    bgr = cv2.cvtColor(np.array(raw), cv2.COLOR_BGRA2BGR)
    cv2.imwrite(path, bgr, [cv2.IMWRITE_JPEG_QUALITY, 85])
    return path, "screen"


def best_match(screen_gray, templates, scales=DEFAULT_SCALES):
    """เทียบ template ทุกอันหลายขนาด คืน (best_score, best_scale)"""
    best = 0.0
    best_scale = 1.0
    for _name, tpl in templates:
        th, tw = tpl.shape[:2]
        for s in scales:
            sw, sh = int(tw * s), int(th * s)
            if sw < 8 or sh < 8:
                continue
            if sh > screen_gray.shape[0] or sw > screen_gray.shape[1]:
                continue
            rt = tpl if s == 1.0 else cv2.resize(tpl, (sw, sh))
            res = cv2.matchTemplate(screen_gray, rt, cv2.TM_CCOEFF_NORMED)
            _minv, maxv, _minl, _maxl = cv2.minMaxLoc(res)
            if maxv > best:
                best = float(maxv)
                best_scale = s
    return best, best_scale


class PuzzleDetector:
    def __init__(self, template_paths, threshold=0.8, region=None, window_title=None,
                 monitor_index=1):
        if not template_paths:
            raise ValueError("ต้องมีอย่างน้อย 1 template (แนบรูปจิ๊กซอว์ก่อน)")
        self.threshold = float(threshold)
        # region = [x, y, width, height] อ้างอิงจากจอหลัก หรือ None = ทั้งจอ
        self.region = region
        # monitor_index: 0 = ทุกจอรวมกัน, 1 = จอหลัก, 2 = จอที่สอง...
        self.monitor_index = int(monitor_index)
        # window_title != "" -> จับเฉพาะหน้าต่างนั้น (ไม่ต้องเปิดค้างหน้าจอ)
        self.window_title = (window_title or "").strip()
        self._warned = False
        self._wgc = None  # None=ยังไม่ลอง, False=ใช้ไม่ได้, obj=session
        self.templates = []
        for path in template_paths:
            img = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
            if img is None:
                raise FileNotFoundError(f"อ่านไฟล์ template ไม่ได้: {path}")
            self.templates.append((path, img))
        self._sct = mss.mss()

    def _monitor(self):
        if self.region:
            x, y, w, h = self.region
            return {"left": int(x), "top": int(y), "width": int(w), "height": int(h)}
        return pick_monitor(self._sct, self.monitor_index)

    def _wgc_grab(self):
        """ดึงเฟรมจาก WGC (สร้าง session ครั้งเดียวแล้วใช้ซ้ำ) — คืน None ถ้าใช้ไม่ได้"""
        if self._wgc is False:
            return None
        if self._wgc is None:
            try:
                import wgc_capture
                if not wgc_capture.available():
                    self._wgc = False
                    return None
                self._wgc = wgc_capture.WGCSession(self.window_title)
            except Exception:
                self._wgc = False
                return None
        try:
            return self._wgc.grab()
        except Exception:
            return None

    def _grab_bgr(self):
        """จับภาพเป็น BGR — ใช้ window capture ถ้าตั้งค่าไว้ ไม่งั้นจับทั้งจอ"""
        if self.window_title:
            # 1) WGC (จับได้แม้โดนบัง)
            img = self._wgc_grab()
            if img is not None and img.any():
                return img
            # 2) PrintWindow (สำรอง)
            try:
                import window_capture as wc
                hwnd = wc.find_window(self.window_title)
                if hwnd:
                    img = wc.capture_window(hwnd)
                    if img is not None and img.any():
                        return img
            except Exception as e:
                if not self._warned:
                    print("⚠️  window capture ใช้ไม่ได้ ใช้จับทั้งจอแทน:", e)
                    self._warned = True
            if not self._warned:
                print(f"⚠️  จับหน้าต่าง '{self.window_title}' ไม่ได้ ใช้จับทั้งจอแทนชั่วคราว")
                self._warned = True
        raw = self._sct.grab(self._monitor())
        return cv2.cvtColor(np.array(raw), cv2.COLOR_BGRA2BGR)

    def _grab_gray(self):
        return cv2.cvtColor(self._grab_bgr(), cv2.COLOR_BGR2GRAY)

    def check(self):
        """คืนค่า (found: bool, best_score: float)"""
        best, _scale = best_match(self._grab_gray(), self.templates)
        return best >= self.threshold, best

    def score_of_image(self, path):
        """ทดสอบ: เทียบ template กับไฟล์รูป (คืน best_score, best_scale) — ลองสเกลละเอียด"""
        img = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
        if img is None:
            raise FileNotFoundError(f"อ่านไฟล์ไม่ได้: {path}")
        return best_match(img, self.templates, FINE_SCALES)

    def capture(self, path):
        """จับภาพ (สี) ณ ตอนนี้ บันทึกเป็น JPEG สำหรับแนบไปแจ้งเตือน"""
        bgr = self._grab_bgr()
        cv2.imwrite(path, bgr, [cv2.IMWRITE_JPEG_QUALITY, 80])
        return path
