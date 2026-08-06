"""ทดสอบตัวช่วยของฟีเจอร์ AI วิเคราะห์ (เฉพาะฟังก์ชันบริสุทธิ์ ไม่ต่อเน็ต)."""
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fb_automation.ai import build_analysis_prompt, compact_data  # noqa: E402


def _sample():
    status = {
        "updated_at": "2026-08-06T10:00:00+07:00",
        "period_totals": {"today": {"spend": 300, "revenue": 900, "roas": 3.0, "orders": 5}},
        "accounts": [
            {"name": "ร้าน A", "account_id": "111", "disabled": False, "error": None,
             "periods": {
                 "today": {"spend": 100, "revenue": 300, "roas": 3.0, "orders": 2, "cost_per_order": 50},
                 "yesterday": {"spend": 90, "revenue": 180, "roas": 2.0, "orders": 1, "cost_per_order": 90},
                 "last_7d": {"spend": 700, "revenue": 1400, "roas": 2.0, "orders": 10, "cost_per_order": 70},
                 "last_30d": {"spend": 3000, "revenue": 9000, "roas": 3.0, "orders": 40, "cost_per_order": 75},
             }},
            {"name": "ร้าน ปิด", "account_id": "222", "disabled": True, "error": None, "periods": {}},
            {"name": "ร้าน error", "account_id": "333", "disabled": False,
             "error": "token หมดอายุ", "periods": {}},
        ],
    }
    board = {
        "updated_at": "2026-08-06T10:00:00+07:00",
        "accounts": [
            {"name": "ร้าน A", "account_id": "111", "campaigns": [
                {"id": "c1", "name": "แคมเปญ 1", "status": "ACTIVE", "budget": 200,
                 "spend": 80, "roas": 3.5, "orders": 2},
            ]},
            {"name": "ร้าน ปิด", "account_id": "222", "disabled": True, "campaigns": []},
        ],
    }
    return status, board


class TestCompact(unittest.TestCase):
    def test_skips_disabled_and_error(self):
        status, board = _sample()
        data = compact_data(status, board)
        names = [a["name"] for a in data["accounts"]]
        self.assertEqual(names, ["ร้าน A"])  # ข้ามบัญชีปิด/มี error

    def test_periods_and_campaigns(self):
        status, board = _sample()
        data = compact_data(status, board)
        acc = data["accounts"][0]
        self.assertIn("today", acc["periods"])
        self.assertIn("last_30d", acc["periods"])
        self.assertEqual(acc["periods"]["last_7d"]["roas"], 2.0)
        self.assertEqual(acc["campaigns"][0]["name"], "แคมเปญ 1")
        self.assertEqual(acc["campaigns"][0]["roas_today"], 3.5)

    def test_handles_missing_fields(self):
        data = compact_data({"accounts": [{"name": "X", "account_id": "9", "periods": {}}]}, {})
        acc = data["accounts"][0]
        self.assertEqual(acc["periods"]["today"]["spend"], 0)
        self.assertEqual(acc["campaigns"], [])


class TestPrompt(unittest.TestCase):
    def test_prompt_is_str_with_data(self):
        status, board = _sample()
        p = build_analysis_prompt(status, board)
        self.assertIsInstance(p, str)
        self.assertIn("ร้าน A", p)
        self.assertIn("ROAS", p)
        # ต้องมี JSON ฝังอยู่ และ parse ได้
        block = p.split("```json", 1)[1].split("```", 1)[0]
        parsed = json.loads(block)
        self.assertEqual(parsed["accounts"][0]["name"], "ร้าน A")


if __name__ == "__main__":
    unittest.main(verbosity=2)
