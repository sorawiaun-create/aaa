"""เฝ้าดูหน้าจอ TikTok Live Studio แล้วแจ้งเตือนเข้า LINE เมื่อจิ๊กซอว์ยืนยันตัวตนเด้ง

คุณยังเป็นคนต่อจิ๊กซอว์เอง โปรแกรมนี้แค่ "เตือนไม่ให้พลาดจังหวะ" เท่านั้น

วิธีใช้:
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


def load_config(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


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
        print(f"ไม่พบไฟล์ {args.config} — คัดลอกจาก config.example.json ก่อน "
              "แล้วใส่ token")
        return

    line = LineClient(
        cfg["line"]["channel_access_token"],
        cfg["line"].get("to_user_id"),
    )

    if args.test_line:
        line.send("✅ ทดสอบ: เชื่อมต่อ LINE สำเร็จ พร้อมเตือนจิ๊กซอว์ TikTok Live แล้ว")
        print("ส่งข้อความทดสอบไป LINE เรียบร้อย ถ้าไม่ได้รับ เช็ก token / แอดบอทเป็นเพื่อนหรือยัง")
        return

    d = cfg["detection"]
    detector = PuzzleDetector(
        d["templates"],
        d.get("threshold", 0.8),
        d.get("region"),
    )
    interval = float(d.get("interval_seconds", 1.5))
    repeat = float(cfg.get("repeat_line_alert_seconds", 30))
    sound_on = bool(cfg.get("sound_alert", True))

    print("🟢 เริ่มเฝ้าดูหน้าจอ TikTok Live Studio... (กด Ctrl+C เพื่อหยุด)")
    if args.debug:
        print("   [debug] จะโชว์ค่า score ทุกรอบ ค่าตอนเจอจิ๊กซอว์ควรใกล้ 1.0")

    alerting = False       # ตอนนี้กำลังเตือนอยู่ไหม (จิ๊กซอว์ยังค้างหน้าจอ)
    last_line_ts = 0.0     # ส่ง LINE ครั้งล่าสุดเมื่อไหร่

    try:
        while True:
            try:
                found, score = detector.check()
            except Exception as e:  # ตรวจจับพลาด อย่าให้โปรแกรมตาย
                print("⚠️  ตรวจจับผิดพลาด:", e)
                time.sleep(interval)
                continue

            if args.debug:
                print(f"   score={score:.3f} {'<< เจอ' if found else ''}")

            now = time.time()
            if found:
                if not alerting:
                    alerting = True
                    last_line_ts = now
                    print(f"🔔 เจอจิ๊กซอว์! (score={score:.2f}) กำลังแจ้งเตือน...")
                    try:
                        line.send("🧩 TikTok Live เด้งจิ๊กซอว์ให้ยืนยันตัวตน! "
                                  "รีบกลับมาต่อก่อนโดนตัดไลฟ์ ⏰")
                    except Exception as e:
                        print("   LINE error:", e)
                    if sound_on:
                        play_alert()
                else:
                    # ยังค้างอยู่ -> เตือนเสียงต่อ + ส่ง LINE ซ้ำเป็นระยะ
                    if sound_on:
                        play_alert()
                    if now - last_line_ts >= repeat:
                        last_line_ts = now
                        try:
                            line.send("⚠️ ยังไม่ได้ต่อจิ๊กซอว์นะ! รีบด่วน ก่อนไลฟ์โดนตัด 🧩")
                        except Exception as e:
                            print("   LINE error:", e)
            else:
                if alerting:
                    alerting = False
                    print("✅ จิ๊กซอว์หายแล้ว (น่าจะต่อเรียบร้อย)")

            time.sleep(interval)
    except KeyboardInterrupt:
        print("\n👋 หยุดการทำงานแล้ว")


if __name__ == "__main__":
    main()
