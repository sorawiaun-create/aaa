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


def _load_cfg():
    dst = ensure_config()
    with open(dst, encoding="utf-8") as f:
        return dst, json.load(f)


def _save_cfg(dst, cfg):
    with open(dst, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)


def setup_channels():
    """ตั้งค่าช่องทางแจ้งเตือน: LINE หรือ Telegram"""
    print("\nตั้งค่าช่องทางไหน?")
    print("   1) LINE")
    print("   2) Telegram  (เด้งเตือนชัวร์กว่า แนะนำ)")
    c = input("เลือก > ").strip()
    if c == "1":
        _setup_line()
    elif c == "2":
        _setup_telegram()
    else:
        print("ยกเลิก")


def _setup_line():
    dst, cfg = _load_cfg()
    print("\nวาง Channel access token ของ LINE (ตัวยาวๆ) แล้วกด Enter")
    print("(ดูวิธีสร้างใน README.md)")
    token = input("token > ").strip()
    if not token:
        print("ไม่ได้ใส่อะไร ยกเลิก")
        return
    cfg.setdefault("line", {})["channel_access_token"] = token
    _save_cfg(dst, cfg)
    print("✅ บันทึก LINE token แล้ว")


def _setup_telegram():
    dst, cfg = _load_cfg()
    print("\nขั้นตอนสร้างบอท Telegram (ทำครั้งเดียว):")
    print("  1) เปิดแอป Telegram ค้นหา @BotFather")
    print("  2) พิมพ์ /newbot ตั้งชื่อ -> จะได้ 'bot token' (ตัวยาวๆ)")
    token = input("\nวาง bot token > ").strip()
    if not token:
        print("ไม่ได้ใส่อะไร ยกเลิก")
        return
    print("\n  3) เปิดแชทกับบอทของคุณ แล้ว 'พิมพ์อะไรก็ได้' ทักไปหาบอท 1 ครั้ง")
    input("     ทักแล้วกด Enter เพื่อให้โปรแกรมหา chat id ให้อัตโนมัติ...")
    chat_id = ""
    try:
        import telegram_client
        chat_id = telegram_client.autodetect_chat_id(token) or ""
    except Exception as e:
        print("   หา chat id อัตโนมัติไม่ได้:", e)
    if not chat_id:
        chat_id = input("   ใส่ chat id เอง (ถ้าไม่รู้ ปล่อยว่างแล้ว Enter): ").strip()
    if not chat_id:
        print("⚠️  ยังไม่มี chat id — ลองทักบอทก่อนแล้วตั้งใหม่")
        return
    cfg.setdefault("telegram", {})
    cfg["telegram"]["bot_token"] = token
    cfg["telegram"]["chat_id"] = chat_id
    _save_cfg(dst, cfg)
    print(f"✅ บันทึก Telegram แล้ว (chat id: {chat_id})")


def setup_window():
    """เลือกหน้าต่างที่จะจับ เพื่อไม่ต้องเปิดค้างหน้าจอ"""
    try:
        import window_capture
        wins = window_capture.list_windows()
    except Exception as e:
        print("โหมดนี้ใช้ได้เฉพาะ Windows:", e)
        return
    if not wins:
        print("หาหน้าต่างไม่เจอ")
        return
    print("\nเลือกหน้าต่างที่จะจับ (โปรแกรมจะดูเฉพาะหน้าต่างนี้ ไม่ต้องเปิดค้างหน้าจอ):")
    print("   0) ปิดโหมดนี้ (กลับไปจับทั้งจอเหมือนเดิม)")
    for i, (_hwnd, title) in enumerate(wins, 1):
        print(f"   {i}) {title[:60]}")
    sel = input("เลือกหมายเลข > ").strip()
    dst, cfg = _load_cfg()
    cfg.setdefault("detection", {})
    if sel == "0":
        cfg["detection"]["window_title"] = ""
        _save_cfg(dst, cfg)
        print("✅ ปิดโหมด window capture แล้ว (จับทั้งจอ)")
        return
    try:
        idx = int(sel) - 1
        title = wins[idx][1]
    except (ValueError, IndexError):
        print("เลขไม่ถูกต้อง ยกเลิก")
        return
    cfg["detection"]["window_title"] = title
    _save_cfg(dst, cfg)
    print(f"✅ ตั้งค่าให้จับหน้าต่าง: {title[:60]}")
    print("   ตอนนี้ย่อ/เอาอย่างอื่นมาทับหน้าต่างนี้ได้แล้ว (ไม่ต้องเปิดค้าง)")


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


def sync_templates_into_config(template_paths):
    """อัปเดตรายการ templates ใน config.json ให้ตรงกับรูปทั้งหมดที่มี

    รองรับจิ๊กซอว์หลายแบบ: ทุกรูปในโฟลเดอร์ templates จะถูกใช้ตรวจจับทั้งหมด
    เจอแบบไหนก่อนก็เตือน
    """
    dst = ensure_config()
    with open(dst, encoding="utf-8") as f:
        cfg = json.load(f)
    cfg.setdefault("detection", {})["templates"] = template_paths
    with open(dst, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
    print(f"📝 ลงทะเบียนจิ๊กซอว์ทั้งหมด {len(template_paths)} แบบใน config แล้ว")


MENU = """
============================================
   🧩 TikTok Live Puzzle Alert
   แจ้งเตือนจิ๊กซอว์ TikTok Live (LINE / Telegram)
============================================
   1) ตั้งค่าช่องทางแจ้งเตือน (LINE / Telegram)
   2) ทดสอบแจ้งเตือน (เสียง + ส่งข้อความ)
   3) เลือกหน้าต่าง TikTok (ไม่ต้องเปิดค้างหน้าจอ)
   4) ตั้งค่ารูปจิ๊กซอว์ (เลือกไฟล์ภาพที่แคปไว้)
   5) เริ่มเฝ้าดูหน้าจอ (รันจริง)  << ใช้ตอนไลฟ์
   6) ออก
============================================"""


def handle(choice):
    if choice == "1":
        setup_channels()
    elif choice == "2":
        pa.test_line(pa.load_config(config_path()))
    elif choice == "3":
        setup_window()
    elif choice == "4":
        img = pick_image()
        if img:
            import calibrate
            saved = calibrate.calibrate_from_image(img)
            if saved:
                sync_templates_into_config(calibrate.list_templates())
        else:
            print("ไม่ได้เลือกไฟล์")
    elif choice == "5":
        pa.run_watch(pa.load_config(config_path()))
    elif choice == "6":
        return False
    else:
        print("พิมพ์เลข 1-6")
    return True


def main():
    # ให้ path relative (templates/...) อ้างอิงข้างๆ โปรแกรมเสมอ
    os.chdir(app_dir())
    ensure_config()
    import calibrate
    while True:
        print(MENU)
        n = len(calibrate.list_templates())
        if n == 0:
            print("   สถานะจิ๊กซอว์: ⚠️  ยังไม่มีรูป (กด 3 เพิ่มก่อนใช้งานจริง)")
        else:
            print(f"   สถานะจิ๊กซอว์: ✅ มี {n} แบบ (เพิ่มอีกได้ด้วยข้อ 3)")
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
