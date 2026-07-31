"""ทดสอบตัวแจ้งเตือน LINE (ส่วน logic ที่ไม่แตะ network)."""
import os, sys, unittest
from datetime import datetime, timedelta, timezone
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from fb_automation.notify import build_error_message, send_line, maybe_notify, NOTIFY_KEY
from fb_automation.state import State

NOW = datetime(2026, 7, 31, 22, 5, tzinfo=timezone.utc)


class TestNotify(unittest.TestCase):
    def test_message_has_accounts(self):
        errs = [{"account": "อ่างบัว", "detail": "เชื่อมต่อไม่สำเร็จ", "error": "timeout"}]
        msg = build_error_message(NOW, errs)
        self.assertIn("อ่างบัว", msg)
        self.assertIn("พบปัญหา 1", msg)

    def test_message_truncates(self):
        errs = [{"account": f"A{i}", "detail": "x"} for i in range(15)]
        msg = build_error_message(NOW, errs)
        self.assertIn("และอีก 5", msg)

    def test_send_skips_without_token(self):
        self.assertFalse(send_line("hi", token=""))

    def test_no_errors_no_send(self):
        st = State("/tmp/nope_notify.json", {})
        self.assertFalse(maybe_notify([{"status": "applied"}], NOW, st, token="x"))

    def test_no_token_no_send(self):
        st = State("/tmp/nope_notify2.json", {})
        self.assertFalse(maybe_notify([{"status": "error"}], NOW, st, token=""))

    def test_throttle(self):
        st = State("/tmp/nope_notify3.json", {})
        st.mark_applied(NOTIFY_KEY, NOW)  # เพิ่งแจ้งไป
        # 10 นาทีถัดมา ยังไม่ควรแจ้งซ้ำ (ต่ำกว่า throttle 60)
        self.assertFalse(maybe_notify([{"status": "error"}], NOW + timedelta(minutes=10),
                                      st, token="x", throttle_mins=60))


if __name__ == "__main__":
    unittest.main(verbosity=2)
