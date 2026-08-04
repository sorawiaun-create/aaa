"""เมนูแบบกดเลข สำหรับดับเบิลคลิกรัน (ไม่ต้องพิมพ์คำสั่ง)

ใช้ได้ 2 แบบ:
  - ดับเบิลคลิก RUN.bat  (ถ้ามี Python ในเครื่อง)
  - ดับเบิลคลิก PuzzleAlert.exe (หลัง build ด้วย build.bat แล้ว ไม่ต้องมี Python)
"""

import json
import os
import shutil
import sys

import puzzle_alert as pa

CONFIG_NAME = "config.json"
EXAMPLE_NAME = "config.example.json"


def app_dir():
    """โฟลเดอร์ที่เก็บ config.json / templates (ข้างๆ ตัวโปรแกรม)"""
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


def resource_path(name):
    """หาไฟล์ที่ถูกฝังมากับ .exe (เช่น config.example.json)"""
    base = getattr(sys, "_MEIPASS", app_dir())
    return os.path.join(base, name)


def ensure_config():
    """ถ้ายังไม่มี config.json ให้คัดลอกจากไฟล์ตัวอย่าง"""
    dst = os.path.join(app_dir(), CONFIG_NAME)
    if not os.path.exists(dst):
        src = resource_path(EXAMPLE_NAME)
        if os.path.exists(src):
            shutil.copy(src, dst)
    return dst


def set_token():
    dst = ensure_config()
    with open(dst, encoding="utf-8") as f:
        cfg = json.load(f)
    print("\nวาง Channel access token ของ LINE (ตัวยาวๆ) แล้วกด Enter")
    print("(ดูวิธีสร้างใน README.md ขั้นตอนที่ 2)")
    token = input("token > ").strip()
    if not token:
        print("ไม่ได้ใส่อะไร ยกเลิก")
        return
    cfg["line"]["channel_access_token"] = token
    with open(dst, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
    print("✅ บันทึก token แล้ว")


def pick_image():
    """เปิดหน้าต่างให้เลือกไฟล์ภาพด้วยเมาส์ (ถ้าเปิดไม่ได้ ให้พิมพ์ path)"""
    try:
        import tkinter as tk
        from tkinter import filedialog

        root = tk.Tk()
        root.withdraw()
        path = filedialog.askopenfilename(
            title="เลือกไฟล์ภาพหน้าจอที่มีจิ๊กซอว์",
            filetypes=[("รูปภาพ", "*.png *.jpg *.jpeg"), ("ทั้งหมด", "*.*")],
        )
        root.destroy()
        return path
    except Exception:
        return input("พิมพ์ path ไฟล์ภาพ: ").strip().strip('"')


def config_path():
    return os.path.join(app_dir(), CONFIG_NAME)


MENU = """
============================================
   🧩 TikTok Live Puzzle Alert
   แจ้งเตือนจิ๊กซอว์ TikTok Live เข้า LINE
============================================
   1) ตั้งค่า / วาง token LINE
   2) ทดสอบส่งข้อความเข้า LINE
   3) ตั้งค่ารูปจิ๊กซอว์ (เลือกไฟล์ภาพที่แคปไว้)
   4) เริ่มเฝ้าดูหน้าจอ (รันจริง)  << ใช้ตอนไลฟ์
   5) ออก
============================================"""


def handle(choice):
    if choice == "1":
        set_token()
    elif choice == "2":
        pa.test_line(pa.load_config(config_path()))
    elif choice == "3":
        img = pick_image()
        if img:
            import calibrate
            calibrate.calibrate_from_image(img)
        else:
            print("ไม่ได้เลือกไฟล์")
    elif choice == "4":
        pa.run_watch(pa.load_config(config_path()))
    elif choice == "5":
        return False
    else:
        print("พิมพ์เลข 1-5")
    return True


def main():
    # ให้ path relative (templates/...) อ้างอิงข้างๆ โปรแกรมเสมอ
    os.chdir(app_dir())
    ensure_config()
    while True:
        print(MENU)
        choice = input("เลือกหมายเลข > ").strip()
        try:
            if not handle(choice):
                break
        except FileNotFoundError as e:
            print("⚠️  ไม่พบไฟล์:", e)
            print("ลองเลือกข้อ 1 เพื่อตั้งค่า token ก่อน")
        except Exception as e:
            print("⚠️  เกิดข้อผิดพลาด:", e)
        input("\nกด Enter เพื่อกลับเมนู...")

    print("บ๊ายบาย 👋")


if __name__ == "__main__":
    main()
