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
    def test_period_totals(self):
        accounts = [
            {"name": "A", "periods": {"today": {"spend": 100, "revenue": 300, "orders": 2},
                                       "last_7d": {"spend": 700, "revenue": 1400, "orders": 10}}},
            {"name": "B", "periods": {"today": {"spend": 100, "revenue": 200, "orders": 3},
                                       "last_7d": {"spend": 300, "revenue": 900, "orders": 6}}},
        ]
        s = build_status(updated_at="2026-07-31T15:00:00+07:00",
                         timezone="Asia/Bangkok", dry_run=False, accounts=accounts)
        self.assertEqual(s["period_totals"]["today"]["spend"], 200)
        self.assertEqual(s["period_totals"]["today"]["revenue"], 500)
        self.assertEqual(s["period_totals"]["today"]["roas"], 2.5)
        self.assertEqual(s["period_totals"]["last_7d"]["spend"], 1000)
        self.assertEqual(s["period_totals"]["last_7d"]["orders"], 16)
        # ช่วงที่บัญชีไม่มีข้อมูล -> รวมเป็น 0 ไม่พัง
        self.assertEqual(s["period_totals"]["yesterday"]["spend"], 0)


class TestAccountTotalsFromRow(unittest.TestCase):
    def test_from_row(self):
        from fb_automation.status import account_totals_from_row
        row = {"spend": "500",
               "actions": [{"action_type": "omni_purchase", "value": "5"}],
               "action_values": [{"action_type": "omni_purchase", "value": "1500"}]}
        r = account_totals_from_row(row, ["omni_purchase", "purchase"])
        self.assertEqual(r["spend"], 500)
        self.assertEqual(r["orders"], 5)
        self.assertEqual(r["revenue"], 1500)
        self.assertEqual(r["roas"], 3.0)
        self.assertEqual(r["cost_per_order"], 100)

    def test_empty_row(self):
        from fb_automation.status import account_totals_from_row
        r = account_totals_from_row({}, ["omni_purchase"])
        self.assertEqual(r["spend"], 0)
        self.assertEqual(r["roas"], 0.0)


if __name__ == "__main__":
    unittest.main(verbosity=2)


import tempfile
from fb_automation.activity import load_activity, append_run, write_activity


class TestActivity(unittest.TestCase):
    def test_append_and_trim(self):
        act = {"runs": []}
        for i in range(70):
            append_run(act, {"t": str(i), "events": []}, keep=60)
        self.assertEqual(len(act["runs"]), 60)
        self.assertEqual(act["runs"][0]["t"], "69")   # ล่าสุดอยู่บนสุด

    def test_roundtrip(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "activity.json")
            write_activity(p, {"runs": [{"t": "x", "events": [{"account": "A"}]}]})
            got = load_activity(p)
            self.assertEqual(got["runs"][0]["events"][0]["account"], "A")

    def test_load_missing(self):
        self.assertEqual(load_activity("/tmp/nope_xyz_activity.json"), {"runs": []})
