"""เฝ้าดูหน้าจอ TikTok Live Studio แล้วแจ้งเตือนเข้า LINE เมื่อจิ๊กซอว์ยืนยันตัวตนเด้ง

คุณยังเป็นคนต่อจิ๊กซอว์เอง โปรแกรมนี้แค่ "เตือนไม่ให้พลาดจังหวะ" เท่านั้น

รันแบบเมนู (แนะนำ):   ดับเบิลคลิก RUN.bat  หรือ  PuzzleAlert.exe
รันแบบคำสั่ง:
  python puzzle_alert.py --test-line   # ทดสอบว่าส่ง LINE ได้
  python puzzle_alert.py               # รันจริง (เฝ้าดูหน้าจอ)
  python puzzle_alert.py --debug       # โชว์ค่าความคล้ายทุกวินาที ไว้จูน threshold
"""

import argparse
import json
import time

from detector import PuzzleDetector
from line_client import LineClient
from sound import play_alert
from telegram_client import TelegramClient


def load_config(path="config.json"):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def build_channels(cfg):
    """สร้างรายการช่องทางแจ้งเตือนที่ตั้งค่าไว้ (LINE / Telegram)"""
    channels = []
    lc = cfg.get("line", {})
    tok = lc.get("channel_access_token", "")
    if tok and not tok.startswith("ใส่ "):
        channels.append(LineClient(tok, lc.get("to_user_id")))
    tg = cfg.get("telegram", {})
    if tg.get("bot_token") and tg.get("chat_id"):
        channels.append(TelegramClient(tg["bot_token"], tg["chat_id"]))
    return channels


def notify_all(channels, text, image_path=None, attach=True):
    """ส่งแจ้งเตือนไปทุกช่องทาง (ช่องไหนพังก็ไม่ล้มทั้งหมด)"""
    for ch in channels:
        try:
            ch.notify(text, image_path=image_path, attach=attach)
        except Exception as e:
            print(f"   {type(ch).__name__} error:", e)


def test_line(cfg):
    """ทดสอบทั้งเสียงในเครื่อง + ส่งข้อความไปทุกช่องทาง"""
    # 1) เสียงในเครื่อง (ให้เหมือนตอนเจอจิ๊กซอว์จริง)
    if cfg.get("sound_alert", True):
        print("🔊 เล่นเสียงทดสอบ... (ควรได้ยินเสียงบี๊บ)")
        play_alert()
    else:
        print("(sound_alert ปิดอยู่ ข้ามการทดสอบเสียง)")

    # 2) ส่งข้อความไปทุกช่องทางที่ตั้งค่าไว้
    channels = build_channels(cfg)
    if not channels:
        print("⚠️  ยังไม่ได้ตั้งค่าช่องทางแจ้งเตือนเลย (กดเมนูข้อ 1 ก่อน)")
        return
    print(f"ส่งข้อความทดสอบไป {len(channels)} ช่องทาง...")
    notify_all(channels, "✅ ทดสอบ: พร้อมเตือนจิ๊กซอว์ TikTok Live แล้ว", attach=False)
    print("ส่งเรียบร้อย ถ้าไม่ได้รับ ให้เช็กการตั้งค่า/แจ้งเตือนในแอป")


def run_watch(cfg, debug=False, stop_event=None, log=None):
    """วนเฝ้าดูหน้าจอ เจอจิ๊กซอว์เมื่อไหร่แจ้งเตือน

    stop_event : threading.Event สำหรับสั่งหยุด (ใช้กับ GUI) — ไม่ใส่ = วนจน Ctrl+C
    log        : ฟังก์ชันรับข้อความสถานะ (ใช้กับ GUI) — ไม่ใส่ = print ลง console
    """
    log = log or print
    channels = build_channels(cfg)
    if not channels:
        log("⚠️  ยังไม่ได้ตั้งค่าช่องทางแจ้งเตือนเลย (ตั้งค่า LINE/Telegram ก่อน)")
        return
    d = cfg["detection"]
    detector = PuzzleDetector(
        d["templates"],
        d.get("threshold", 0.8),
        d.get("region"),
        d.get("window_title"),
        d.get("monitor_index", 1),
    )
    interval = float(d.get("interval_seconds", 1.5))
    repeat = float(cfg.get("repeat_line_alert_seconds", 30))
    sound_on = bool(cfg.get("sound_alert", True))
    attach_shot = bool(cfg.get("attach_screenshot", True))

    log("🟢 เริ่มเฝ้าดู TikTok Live Studio แล้ว...")
    if debug:
        log("   [debug] จะโชว์ค่า score ทุกรอบ ค่าตอนเจอจิ๊กซอว์ควรใกล้ 1.0")

    def _sleep(sec):
        """หยุดพักแบบสั่งหยุดกลางคันได้ (คืน True ถ้าถูกสั่งหยุด)"""
        if stop_event:
            return stop_event.wait(sec)
        time.sleep(sec)
        return False

    alerting = False       # ตอนนี้จิ๊กซอว์ยังค้างหน้าจออยู่ไหม
    last_line_ts = 0.0     # ส่งแจ้งเตือนครั้งล่าสุดเมื่อไหร่

    try:
        while not (stop_event and stop_event.is_set()):
            try:
                found, score = detector.check()
            except Exception as e:  # ตรวจจับพลาด อย่าให้โปรแกรมตาย
                log(f"⚠️  ตรวจจับผิดพลาด: {e}")
                if _sleep(interval):
                    break
                continue

            if debug:
                log(f"   score={score:.3f} {'<< เจอ' if found else ''}")

            now = time.time()
            if found:
                if not alerting:
                    alerting = True
                    last_line_ts = now
                    log(f"🔔 เจอจิ๊กซอว์! (score={score:.2f}) กำลังแจ้งเตือน...")
                    # แนบรูปตอนนั้น (ถ้าเปิดไว้) จะได้เห็นว่าจิ๊กซอว์แบบไหน
                    shot = None
                    if attach_shot:
                        try:
                            shot = detector.capture("_last_alert.jpg")
                        except Exception as e:
                            log(f"   จับภาพไม่สำเร็จ (จะส่งแบบไม่มีรูป): {e}")
                    notify_all(channels,
                               "🧩 TikTok Live เด้งจิ๊กซอว์ให้ยืนยันตัวตน! "
                               "รีบกลับมาต่อก่อนโดนตัดไลฟ์ ⏰",
                               image_path=shot, attach=attach_shot)
                    if sound_on:
                        play_alert()
                else:
                    # ยังค้างอยู่ -> เตือนเสียงต่อ + ส่งซ้ำเป็นระยะ
                    if sound_on:
                        play_alert()
                    if now - last_line_ts >= repeat:
                        last_line_ts = now
                        notify_all(channels,
                                   "⚠️ ยังไม่ได้ต่อจิ๊กซอว์นะ! รีบด่วน ก่อนไลฟ์โดนตัด 🧩")
            else:
                if alerting:
                    alerting = False
                    log("✅ จิ๊กซอว์หายแล้ว (น่าจะต่อเรียบร้อย)")

            if _sleep(interval):
                break
    except KeyboardInterrupt:
        pass
    log("👋 หยุดเฝ้าดูแล้ว")


def main():
    parser = argparse.ArgumentParser(description="แจ้งเตือนจิ๊กซอว์ TikTok Live เข้า LINE")
    parser.add_argument("--config", default="config.json")
    parser.add_argument("--test-line", action="store_true",
                        help="ส่งข้อความทดสอบไป LINE แล้วจบ")
    parser.add_argument("--debug", action="store_true",
                        help="โชว์ค่าความคล้าย (score) ทุกรอบ")
    args = parser.parse_args()

    try:
        cfg = load_config(args.config)
    except FileNotFoundError:
        print(f"ไม่พบไฟล์ {args.config} — คัดลอกจาก config.example.json ก่อน แล้วใส่ token")
        return

    if args.test_line:
        test_line(cfg)
    else:
        run_watch(cfg, debug=args.debug)


if __name__ == "__main__":
    main()
