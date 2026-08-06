"""ทดสอบ: PAUSE ต้องชนะ ACTIVATE เมื่อเข้าเงื่อนไขพร้อมกัน (fail-safe)."""
import os, sys, unittest
from datetime import datetime, timezone
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from fb_automation.rules import plan_campaign
from fb_automation.actions import execute_campaign, RunSummary
from fb_automation.state import State

NOW = datetime(2026, 7, 31, 17, 46, tzinfo=timezone.utc)


class FakeClient:
    account_id = "1"
    def __init__(self, effective="ACTIVE", adsets=None):
        self.status_calls = []
        self.adset_status_calls = []
        self._effective = effective
        self._adsets = adsets if adsets is not None else []
    def update_campaign_status(self, cid, st): self.status_calls.append(st)
    def update_adset_status(self, aid, st): self.adset_status_calls.append((aid, st))
    def get_campaign_adsets(self, cid): return self._adsets
    def get_campaign_effective_status(self, cid): return self._effective
    def to_major(self, x): return float(x) / 100
    def to_minor(self, x): return int(x * 100)


class TestConflict(unittest.TestCase):
    def test_pause_beats_activate_even_when_activate_is_last(self):
        # เลียนแบบเคสจริง: PAUSE (จ่าย>150 & ทุนซื้อ>75) และ ACTIVATE (จ่าย>100 & ทุนซื้อ>75 & ซื้อ>0)
        rules = [
            {"name": "จ่าย 150 ทุนซื้อ > 75 ปิด", "action": "PAUSE", "conditions": [
                {"metric": "spend", "operator": ">", "value": 150},
                {"metric": "cost_per_purchase", "operator": ">", "value": 75}]},
            {"name": "กฎใหม่", "action": "ACTIVATE", "conditions": [
                {"metric": "spend", "operator": ">", "value": 100},
                {"metric": "cost_per_purchase", "operator": ">", "value": 75},
                {"metric": "purchases", "operator": ">", "value": 0}]},
        ]
        metrics = {"spend": 2111.0, "cost_per_purchase": 162.0, "purchases": 13}
        planned = plan_campaign(rules, metrics)
        self.assertEqual(len(planned), 2)   # ทั้งสองกฎเข้าเงื่อนไข
        cl = FakeClient()
        events = []
        execute_campaign(cl, {"id": "c1", "name": "แคมเปญยอดขายใหม่", "status": "ACTIVE"},
                         planned, state=State("/tmp/z.json", {}), now=NOW,
                         dry_run=False, summary=RunSummary(), account_name="A", events=events)
        self.assertEqual(cl.status_calls, ["PAUSED"])       # ต้องปิด ไม่ใช่เปิด
        self.assertEqual(events[0]["action"], "PAUSE")

    def test_activate_still_works_when_no_pause(self):
        rules = [{"name": "เปิด", "action": "ACTIVATE",
                  "conditions": [{"metric": "spend", "operator": ">", "value": 100}]}]
        planned = plan_campaign(rules, {"spend": 200})
        cl = FakeClient(); events = []
        execute_campaign(cl, {"id": "c1", "name": "x", "status": "PAUSED"}, planned,
                         state=State("/tmp/z.json", {}), now=NOW, dry_run=False,
                         summary=RunSummary(), account_name="A", events=events)
        self.assertEqual(cl.status_calls, ["ACTIVE"])
