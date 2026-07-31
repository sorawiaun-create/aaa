"""ทดสอบการรวมยอดสำหรับหน้า Dashboard (status.json)."""
import math
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fb_automation.status import aggregate_metrics, build_status  # noqa: E402


class TestAggregate(unittest.TestCase):
    def test_basic(self):
        # 2 แคมเปญ: spend 100 roas 3 -> rev 300 ; spend 50 roas 4 -> rev 200
        m = [
            {"spend": 100, "roas": 3, "purchases": 2},
            {"spend": 50, "roas": 4, "purchases": 1},
        ]
        r = aggregate_metrics(m)
        self.assertEqual(r["spend"], 150)
        self.assertEqual(r["revenue"], 500)
        self.assertEqual(r["orders"], 3)
        self.assertAlmostEqual(r["roas"], round(500 / 150, 2))
        self.assertAlmostEqual(r["cost_per_order"], round(150 / 3, 2))

    def test_empty_and_zero_spend(self):
        self.assertEqual(aggregate_metrics([])["roas"], 0.0)
        r = aggregate_metrics([{"spend": 0, "roas": 0, "purchases": 0}])
        self.assertEqual(r["spend"], 0)
        self.assertEqual(r["cost_per_order"], 0.0)

    def test_ignores_infinite_costs(self):
        # cost_per_* อาจเป็น inf แต่ aggregate ใช้แค่ spend/roas/purchases
        m = [{"spend": 80, "roas": 0, "purchases": 0, "cost_per_purchase": math.inf}]
        r = aggregate_metrics(m)
        self.assertEqual(r["revenue"], 0)
        self.assertEqual(r["spend"], 80)


class TestBuildStatus(unittest.TestCase):
    def test_totals(self):
        accounts = [
            {"name": "A", "spend": 100, "revenue": 300, "orders": 2},
            {"name": "B", "spend": 100, "revenue": 200, "orders": 3},
        ]
        s = build_status(updated_at="2026-07-31T15:00:00+07:00",
                         timezone="Asia/Bangkok", dry_run=False, accounts=accounts)
        self.assertEqual(s["totals"]["spend"], 200)
        self.assertEqual(s["totals"]["revenue"], 500)
        self.assertEqual(s["totals"]["orders"], 5)
        self.assertEqual(s["totals"]["roas"], 2.5)
        self.assertEqual(len(s["accounts"]), 2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
