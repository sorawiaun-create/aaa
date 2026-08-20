"""ทดสอบการประเมินทุกแคมเปญ (หน้า 'เช็คทุกแคม')."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fb_automation.rules import evaluate_campaign, condition_checks  # noqa: E402

# เลียนแบบเคสจริง: กฎเปิด + กฎปิด "ทัก" ชนกัน
RULES = [
    {"name": "เปิด", "action": "ACTIVATE", "conditions": [
        {"metric": "spend", "operator": ">", "value": 50},
        {"metric": "cost_per_purchase", "operator": "<", "value": 220},
        {"metric": "purchases", "operator": ">", "value": 0}]},
    {"name": "จ่าย 150 ทุนทัก ปิด", "action": "PAUSE", "conditions": [
        {"metric": "spend", "operator": ">", "value": 150},
        {"metric": "cost_per_result", "operator": ">", "value": 50}]},
    {"name": "เพิ่มงบ", "action": "INCREASE_BUDGET", "params": {"percent": 10}, "conditions": [
        {"metric": "roas", "operator": ">", "value": 3}]},
    {"name": "ปิดใช้งานอยู่", "action": "PAUSE", "enabled": False, "conditions": [
        {"metric": "spend", "operator": ">", "value": 1}]},
]


class TestEvaluate(unittest.TestCase):
    def test_blocked_activate(self):
        # แอดดี: เข้าเงื่อนไขเปิด แต่ก็เข้ากฎปิด(ทัก) ด้วย -> ปิดชนะ + blocked_activate
        metrics = {"spend": 171, "cost_per_purchase": 85, "purchases": 2,
                   "cost_per_result": 85, "roas": 4.37, "results": 0}
        ev = evaluate_campaign(RULES, metrics, "PAUSED")
        self.assertEqual(ev["decision"], "KEEP_PAUSED")   # ปิดอยู่แล้ว + กฎปิดเข้า
        self.assertTrue(ev["blocked_activate"])           # ควรเปิดแต่โดนปิดบล็อก
        self.assertEqual(ev["status_rule"], "จ่าย 150 ทุนทัก ปิด")
        # กฎที่ปิดใช้งานต้องไม่โผล่
        names = [r["name"] for r in ev["rules"]]
        self.assertNotIn("ปิดใช้งานอยู่", names)

    def test_activate_when_no_pause(self):
        # จ่ายน้อย ไม่เข้ากฎปิด -> ควรเปิด
        metrics = {"spend": 100, "cost_per_purchase": 60, "purchases": 1,
                   "cost_per_result": 20, "roas": 5, "results": 3}
        ev = evaluate_campaign(RULES, metrics, "PAUSED")
        self.assertEqual(ev["decision"], "TO_ACTIVATE")
        self.assertFalse(ev["blocked_activate"])
        self.assertIn("เพิ่มงบ", ev["budget_rules"])

    def test_no_rule_hits(self):
        metrics = {"spend": 10, "cost_per_purchase": 5, "purchases": 0,
                   "cost_per_result": 5, "roas": 1, "results": 0}
        ev = evaluate_campaign(RULES, metrics, "ACTIVE")
        self.assertEqual(ev["decision"], "NONE")

    def test_condition_checks_marks_pass_fail(self):
        rule = RULES[0]
        metrics = {"spend": 171, "cost_per_purchase": 300, "purchases": 2}
        checks = condition_checks(rule, metrics)
        self.assertTrue(checks[0]["ok"])    # spend 171 > 50
        self.assertFalse(checks[1]["ok"])   # cost_per_purchase 300 < 220 -> False


if __name__ == "__main__":
    unittest.main(verbosity=2)
