"""ตรวจจับกล่องจิ๊กซอว์ยืนยันตัวตนบนหน้าจอด้วยการเทียบภาพ (template matching)

หลักการ: จับภาพหน้าจอ -> เทียบกับรูป template ของกล่องจิ๊กซอว์ที่เตรียมไว้
ถ้าความคล้ายเกินค่า threshold ถือว่า "เจอ"
"""

import cv2
import numpy as np
import mss


class PuzzleDetector:
    def __init__(self, template_paths, threshold=0.8, region=None):
        if not template_paths:
            raise ValueError("ต้องมีอย่างน้อย 1 template (ดู calibrate.py)")
        self.threshold = float(threshold)
        # region = [x, y, width, height] อ้างอิงจากจอหลัก หรือ None = ทั้งจอหลัก
        self.region = region
        self.templates = []
        for path in template_paths:
            img = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
            if img is None:
                raise FileNotFoundError(
                    f"อ่านไฟล์ template ไม่ได้: {path} "
                    "(สร้างก่อนด้วย: python calibrate.py --image ภาพที่แคปไว้.png)"
                )
            self.templates.append((path, img))
        self._sct = mss.mss()

    def _monitor(self):
        if self.region:
            x, y, w, h = self.region
            return {"left": int(x), "top": int(y), "width": int(w), "height": int(h)}
        # monitors[1] = จอหลัก
        return self._sct.monitors[1]

    def _grab_gray(self):
        raw = self._sct.grab(self._monitor())
        frame = np.array(raw)  # BGRA
        return cv2.cvtColor(frame, cv2.COLOR_BGRA2GRAY)

    def check(self):
        """คืนค่า (found: bool, best_score: float)"""
        screen = self._grab_gray()
        best = 0.0
        for _name, tpl in self.templates:
            if tpl.shape[0] > screen.shape[0] or tpl.shape[1] > screen.shape[1]:
                # template ใหญ่กว่าพื้นที่ที่จับ -> ข้าม
                continue
            res = cv2.matchTemplate(screen, tpl, cv2.TM_CCOEFF_NORMED)
            _min_v, max_v, _min_l, _max_l = cv2.minMaxLoc(res)
            best = max(best, float(max_v))
        return best >= self.threshold, best

    def capture(self, path):
        """จับภาพหน้าจอ (สี) ณ ตอนนี้ บันทึกเป็น JPEG สำหรับแนบไป LINE"""
        raw = self._sct.grab(self._monitor())
        frame = np.array(raw)  # BGRA
        bgr = cv2.cvtColor(frame, cv2.COLOR_BGRA2BGR)
        cv2.imwrite(path, bgr, [cv2.IMWRITE_JPEG_QUALITY, 80])
        return path
