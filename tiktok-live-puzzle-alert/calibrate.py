"""ตัวช่วยสร้างรูป template ของกล่องจิ๊กซอว์ + หาพิกัดพื้นที่ (region)

วิธีใช้ (แนะนำ):
  1. ครั้งหน้าที่จิ๊กซอว์เด้งใน TikTok Live Studio ให้กด Print Screen / Snip
     แล้วเซฟเป็นไฟล์รูป เช่น shot.png
  2. รัน:  python calibrate.py --image shot.png
  3. ลากกรอบเลือกเฉพาะ "ส่วนที่อยู่นิ่งๆ" ของกล่อง (เช่น หัวข้อ/ข้อความ/ขอบกล่อง)
     อย่าเลือกชิ้นจิ๊กซอว์ที่เลื่อนได้ เพราะตำแหน่งมันเปลี่ยนทุกครั้ง
  4. กด ENTER เพื่อบันทึก (กด c เพื่อยกเลิก)

หรือจับภาพสดจากหน้าจอ (ถ้าเปิดกล่องค้างไว้ได้):
  python calibrate.py --live
"""

import argparse
import os
import time

import cv2
import numpy as np
import mss

TEMPLATE_PATH = "templates/puzzle.png"


def grab_primary_bgr():
    with mss.mss() as sct:
        raw = sct.grab(sct.monitors[1])  # จอหลัก
    return np.array(raw)[:, :, :3].copy()  # BGRA -> BGR


def main():
    parser = argparse.ArgumentParser(description="สร้าง template จิ๊กซอว์")
    parser.add_argument("--image", help="ไฟล์ภาพหน้าจอที่แคปไว้ (เช่น shot.png)")
    parser.add_argument("--live", action="store_true",
                        help="จับภาพสดจากจอหลักใน 5 วินาที")
    args = parser.parse_args()

    if args.image:
        frame = cv2.imread(args.image)
        if frame is None:
            print(f"อ่านไฟล์ไม่ได้: {args.image}")
            return
    elif args.live:
        print("จะจับภาพจอหลักใน 5 วินาที เปิดกล่องจิ๊กซอว์ให้พร้อม...")
        time.sleep(5)
        frame = grab_primary_bgr()
    else:
        print("ต้องระบุ --image ไฟล์.png  หรือ  --live")
        return

    os.makedirs("templates", exist_ok=True)
    print("ลากกรอบเลือกส่วนที่อยู่นิ่งของกล่องจิ๊กซอว์ แล้วกด ENTER (c = ยกเลิก)")
    roi = cv2.selectROI("เลือกกล่องจิ๊กซอว์ (ENTER=ตกลง / c=ยกเลิก)",
                        frame, showCrosshair=True, fromCenter=False)
    cv2.destroyAllWindows()

    x, y, w, h = [int(v) for v in roi]
    if w == 0 or h == 0:
        print("ยกเลิก ไม่ได้เลือกพื้นที่")
        return

    crop = frame[y:y + h, x:x + w]
    cv2.imwrite(TEMPLATE_PATH, crop)
    print(f"\n✅ บันทึก template แล้ว -> {TEMPLATE_PATH}  (ขนาด {w}x{h})")

    # แนะนำ region เผื่อขอบรอบๆ ไว้กันตำแหน่งขยับเล็กน้อย
    pad = 80
    rx, ry = max(0, x - pad), max(0, y - pad)
    rw, rh = w + pad * 2, h + pad * 2
    print("\nถ้าอยากให้ตรวจเร็วขึ้น + แม่นขึ้น ใส่ค่านี้ใน config.json ช่อง detection:")
    print(f'  "region": [{rx}, {ry}, {rw}, {rh}]')
    print("(ถ้าไม่ใส่ จะสแกนทั้งจอหลัก ก็ใช้ได้ปกติ)")


if __name__ == "__main__":
    main()
