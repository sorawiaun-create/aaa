"""ทดสอบการ "เปิดแอดจริง" — แก้บั๊ก log แจ้งเปิดแต่แอดไม่วิ่ง.

เปิดแคมเปญต้องเปิด ad set ข้างในที่ถูกปิดด้วย และต้องยืนยัน effective_status
แล้วรายงานตามจริง (ถ้ายังไม่วิ่งให้ถือเป็น error เพื่อเตือน).
"""
import os
import sys
import unittest
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fb_automation.actions import execute_campaign, activate_campaign_fully, RunSummary
from fb_automation.rules import plan_campaign
from fb_automation.state import State

NOW = datetime(2026, 8, 6, 10, 0, tzinfo=timezone.utc)


class FakeClient:
    account_id = "1"

    def __init__(self, effective="ACTIVE", adsets=None, fail_adset=False):
        self.status_calls = []
        self.adset_status_calls = []
        self._effective = effective
        self._adsets = adsets if adsets is not None else []
        self._fail_adset = fail_adset

    def update_campaign_status(self, cid, st):
        self.status_calls.append(st)

    def update_adset_status(self, aid, st):
        if self._fail_adset:
            raise RuntimeError("no permission")
        self.adset_status_calls.append((aid, st))

    def get_campaign_adsets(self, cid):
        return self._adsets

    def get_campaign_effective_status(self, cid):
        return self._effective

    def to_major(self, x):
        return float(x) / 100

    def to_minor(self, x):
        return int(x * 100)


def _activate_plan():
    rules = [{"name": "เปิด", "action": "ACTIVATE",
              "conditions": [{"metric": "spend", "operator": ">", "value": 100}]}]
    return plan_campaign(rules, {"spend": 200})


class TestActivateFully(unittest.TestCase):
    def test_activates_paused_adsets_too(self):
        cl = FakeClient(effective="ACTIVE", adsets=[
            {"id": "s1", "name": "set1", "status": "PAUSED"},
            {"id": "s2", "name": "set2", "status": "ACTIVE"},
        ])
        res = activate_campaign_fully(cl, "c1")
        self.assertEqual(cl.status_calls, ["ACTIVE"])            # เปิดแคมเปญ
        self.assertEqual(cl.adset_status_calls, [("s1", "ACTIVE")])  # เปิดเฉพาะ set ที่ปิดอยู่
        self.assertEqual(res["adsets_activated"], 1)
        self.assertEqual(res["effective"], "ACTIVE")

    def test_event_ok_when_really_delivering(self):
        cl = FakeClient(effective="ACTIVE", adsets=[{"id": "s1", "name": "s", "status": "PAUSED"}])
        events = []
        s = RunSummary()
        execute_campaign(cl, {"id": "c1", "name": "x", "status": "PAUSED"}, _activate_plan(),
                         state=State("/tmp/z.json", {}), now=NOW, dry_run=False,
                         summary=s, account_name="A", events=events)
        self.assertEqual(events[0]["status"], "applied")
        self.assertEqual(s.errors, 0)
        self.assertEqual(s.status_changes, 1)

    def test_event_error_when_not_delivering(self):
        # สั่งเปิดสำเร็จแต่ effective ยังเป็น ADSET_PAUSED -> ต้องถือเป็น error + บอกความจริง
        cl = FakeClient(effective="ADSET_PAUSED", adsets=[])
        events = []
        s = RunSummary()
        execute_campaign(cl, {"id": "c1", "name": "x", "status": "PAUSED"}, _activate_plan(),
                         state=State("/tmp/z.json", {}), now=NOW, dry_run=False,
                         summary=s, account_name="A", events=events)
        self.assertEqual(events[0]["status"], "error")
        self.assertEqual(s.errors, 1)
        self.assertIn("ยังไม่วิ่ง", events[0]["detail"])

    def test_dry_run_does_not_touch_api(self):
        cl = FakeClient()
        events = []
        execute_campaign(cl, {"id": "c1", "name": "x", "status": "PAUSED"}, _activate_plan(),
                         state=State("/tmp/z.json", {}), now=NOW, dry_run=True,
                         summary=RunSummary(), account_name="A", events=events)
        self.assertEqual(cl.status_calls, [])
        self.assertEqual(events[0]["status"], "dry-run")


if __name__ == "__main__":
    unittest.main(verbosity=2)
