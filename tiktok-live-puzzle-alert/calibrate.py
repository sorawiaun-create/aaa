"""ตัวช่วยสร้างรูป template ของกล่องจิ๊กซอว์ + หาพิกัดพื้นที่ (region)

วิธีใช้ (แนะนำ):
  1. ครั้งหน้าที่จิ๊กซอว์เด้งใน TikTok Live Studio ให้กด Print Screen / Snip
     แล้วเซฟเป็นไฟล์รูป เช่น shot.png
  2. รัน:  python calibrate.py --image shot.png   (หรือใช้เมนูในโปรแกรมหลัก)
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

TEMPLATES_DIR = "templates"


def grab_primary_bgr():
    with mss.mss() as sct:
        raw = sct.grab(sct.monitors[1])  # จอหลัก
    return np.array(raw)[:, :, :3].copy()  # BGRA -> BGR


def calibrate_from_frame(frame):
    """รับภาพ (BGR) มาให้ผู้ใช้ลากกรอบเลือก แล้วบันทึกเป็น template ใหม่ (ไม่ทับของเดิม)

    คืนค่า path ของไฟล์ที่บันทึก หรือ None ถ้ายกเลิก
    รองรับจิ๊กซอว์หลายแบบ: เรียกซ้ำได้เรื่อยๆ จะได้ puzzle_1.png, puzzle_2.png ...
    """
    os.makedirs(TEMPLATES_DIR, exist_ok=True)
    print("ลากกรอบเลือกส่วนที่อยู่นิ่งของกล่องจิ๊กซอว์ แล้วกด ENTER (c = ยกเลิก)")
    roi = cv2.selectROI("เลือกกล่องจิ๊กซอว์ (ENTER=ตกลง / c=ยกเลิก)",
                        frame, showCrosshair=True, fromCenter=False)
    cv2.destroyAllWindows()

    x, y, w, h = [int(v) for v in roi]
    if w == 0 or h == 0:
        print("ยกเลิก ไม่ได้เลือกพื้นที่")
        return None

    path = next_template_path()
    crop = frame[y:y + h, x:x + w]
    cv2.imwrite(path, crop)
    print(f"\n✅ บันทึก template แล้ว -> {path}  (ขนาด {w}x{h})")
    print(f"   ตอนนี้มี template ทั้งหมด {len(list_templates())} แบบ")
    print("   (ถ้ามีจิ๊กซอว์อีกแบบ ให้กดเมนูข้อ 3 ซ้ำ ใส่รูปแบบนั้นเพิ่มได้เลย)")
    return path


def next_template_path():
    """หาชื่อไฟล์ถัดไปที่ยังไม่ถูกใช้ เช่น templates/puzzle_1.png"""
    i = 1
    while True:
        path = os.path.join(TEMPLATES_DIR, f"puzzle_{i}.png")
        if not os.path.exists(path):
            return path
        i += 1


def list_templates():
    """คืน list ของ path รูป template ทั้งหมดในโฟลเดอร์"""
    if not os.path.isdir(TEMPLATES_DIR):
        return []
    out = []
    for name in sorted(os.listdir(TEMPLATES_DIR)):
        if name.lower().endswith((".png", ".jpg", ".jpeg")):
            out.append(os.path.join(TEMPLATES_DIR, name).replace("\\", "/"))
    return out


def calibrate_from_image(image_path):
    frame = cv2.imread(image_path)
    if frame is None:
        print(f"อ่านไฟล์ไม่ได้: {image_path}")
        return None
    return calibrate_from_frame(frame)


def main():
    parser = argparse.ArgumentParser(description="สร้าง template จิ๊กซอว์")
    parser.add_argument("--image", help="ไฟล์ภาพหน้าจอที่แคปไว้ (เช่น shot.png)")
    parser.add_argument("--live", action="store_true",
                        help="จับภาพสดจากจอหลักใน 5 วินาที")
    args = parser.parse_args()

    if args.image:
        calibrate_from_image(args.image)
    elif args.live:
        print("จะจับภาพจอหลักใน 5 วินาที เปิดกล่องจิ๊กซอว์ให้พร้อม...")
        time.sleep(5)
        calibrate_from_frame(grab_primary_bgr())
    else:
        print("ต้องระบุ --image ไฟล์.png  หรือ  --live")


if __name__ == "__main__":
    main()
