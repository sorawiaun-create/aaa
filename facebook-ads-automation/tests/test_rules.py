"""ทดสอบตรรกะหลัก (metrics + rules + state) — รันด้วย: python -m pytest หรือ python -m unittest."""
import math
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fb_automation.metrics import compute_metrics, time_of_day  # noqa: E402
from fb_automation.rules import (  # noqa: E402
    evaluate_condition,
    plan_campaign,
    rule_matches,
)
from fb_automation.state import State  # noqa: E402
from fb_automation.actions import _apply_budget_sequence, RunSummary  # noqa: E402


NOON = datetime(2026, 7, 31, 12, 30, 0, tzinfo=timezone.utc)


def _insight(**over):
    base = {"spend": "0"}
    base.update(over)
    return base


class TestMetrics(unittest.TestCase):
    def test_time_of_day(self):
        self.assertAlmostEqual(time_of_day(datetime(2026, 1, 1, 22, 30)), 22.5)
        self.assertAlmostEqual(time_of_day(datetime(2026, 1, 1, 6, 0)), 6.0)

    def test_spend_and_purchases(self):
        ins = _insight(
            spend="120.5",
            actions=[
                {"action_type": "omni_purchase", "value": "3"},
                {"action_type": "purchase", "value": "2"},
                {"action_type": "onsite_conversion.messaging_conversation_started_7d", "value": "5"},
            ],
            purchase_roas=[{"action_type": "omni_purchase", "value": "4.2"}],
        )
        m = compute_metrics(
            ins, now_local=NOON,
            purchase_action_types=["omni_purchase", "purchase"],
            result_action_types=["onsite_conversion.messaging_conversation_started_7d"],
        )
        self.assertEqual(m["spend"], 120.5)
        self.assertEqual(m["purchases"], 3)      # omni_purchase ชนะ
        self.assertEqual(m["results"], 5)
        self.assertAlmostEqual(m["roas"], 4.2)
        self.assertAlmostEqual(m["cost_per_purchase"], 120.5 / 3)
        self.assertAlmostEqual(m["cost_per_result"], 120.5 / 5)

    def test_zero_results_is_infinite_cost(self):
        m = compute_metrics(
            _insight(spend="50"), now_local=NOON,
            purchase_action_types=["purchase"], result_action_types=["x"],
        )
        self.assertEqual(m["purchases"], 0)
        self.assertTrue(math.isinf(m["cost_per_purchase"]))
        self.assertTrue(math.isinf(m["cost_per_result"]))

    def test_none_insight(self):
        m = compute_metrics(
            None, now_local=NOON,
            purchase_action_types=["purchase"], result_action_types=["x"],
        )
        self.assertEqual(m["spend"], 0)
        self.assertEqual(m["roas"], 0)


class TestConditions(unittest.TestCase):
    def test_operators(self):
        metrics = {"spend": 50.0}
        self.assertTrue(evaluate_condition({"metric": "spend", "operator": ">", "value": 40}, metrics))
        self.assertFalse(evaluate_condition({"metric": "spend", "operator": ">", "value": 60}, metrics))
        self.assertTrue(evaluate_condition({"metric": "spend", "operator": ">=", "value": 50}, metrics))
        self.assertTrue(evaluate_condition({"metric": "spend", "operator": "<", "value": 51}, metrics))

    def test_infinite_cost_pauses(self):
        # spend 80 ไม่มีซื้อ -> cost_per_purchase = inf -> "> 80" ควรจริง
        metrics = {"cost_per_purchase": math.inf}
        self.assertTrue(evaluate_condition(
            {"metric": "cost_per_purchase", "operator": ">", "value": 80}, metrics))
        self.assertFalse(evaluate_condition(
            {"metric": "cost_per_purchase", "operator": "<", "value": 80}, metrics))

    def test_unknown_metric_false(self):
        self.assertFalse(evaluate_condition({"metric": "nope", "operator": ">", "value": 1}, {}))

    def test_rule_matches_requires_all(self):
        rule = {"conditions": [
            {"metric": "spend", "operator": ">", "value": 50},
            {"metric": "results", "operator": "<", "value": 1},
        ]}
        self.assertTrue(rule_matches(rule, {"spend": 60, "results": 0}))
        self.assertFalse(rule_matches(rule, {"spend": 60, "results": 2}))
        self.assertFalse(rule_matches(rule, {"spend": 40, "results": 0}))


class TestPlanning(unittest.TestCase):
    def test_time_window_pause(self):
        rules = [{
            "name": "ปิดดึก", "action": "PAUSE",
            "conditions": [
                {"metric": "time_of_day", "operator": ">", "value": 22},
                {"metric": "time_of_day", "operator": "<", "value": 23.59},
            ],
        }]
        night = compute_metrics(None, now_local=datetime(2026, 7, 31, 22, 30, tzinfo=timezone.utc),
                                purchase_action_types=["p"], result_action_types=["r"])
        day = compute_metrics(None, now_local=datetime(2026, 7, 31, 12, 0, tzinfo=timezone.utc),
                              purchase_action_types=["p"], result_action_types=["r"])
        self.assertEqual(len(plan_campaign(rules, night)), 1)
        self.assertEqual(len(plan_campaign(rules, day)), 0)

    def test_increase_budget_plan(self):
        rules = [{
            "name": "เพิ่มงบ", "action": "INCREASE_BUDGET",
            "params": {"percent": 50, "maxBudget": 5000, "frequencyMins": 50},
            "conditions": [{"metric": "roas", "operator": ">", "value": 3}],
        }]
        plan = plan_campaign(rules, {"roas": 5})
        self.assertEqual(len(plan), 1)
        self.assertEqual(plan[0].kind, "BUDGET")
        self.assertEqual(plan[0].percent, 50)
        self.assertEqual(plan[0].max_budget, 5000)
        self.assertEqual(plan[0].frequency_mins, 50)


class TestBudgetSequence(unittest.TestCase):
    def _plan(self, **kw):
        from fb_automation.rules import PlannedAction
        defaults = dict(kind="BUDGET", rule_index=0, rule_name="t", action="INCREASE_BUDGET",
                        budget_op="increase")
        defaults.update(kw)
        return PlannedAction(**defaults)

    def test_increase_respects_max(self):
        state = State("/tmp/nonexistent_state_x.json", {})
        pa = self._plan(percent=50, max_budget=100)
        new = _apply_budget_sequence(
            80, [pa], state=state, now=NOON, account_id="1", unit_id="c1",
            unit_label="แคมเปญ", summary=RunSummary(),
        )
        self.assertEqual(new, 100)  # 80*1.5=120 -> capped 100

    def test_reset_budget(self):
        state = State("/tmp/nonexistent_state_y.json", {})
        pa = self._plan(action="RESET_BUDGET", budget_op="reset", reset_amount=300)
        new = _apply_budget_sequence(
            57, [pa], state=state, now=NOON, account_id="1", unit_id="c1",
            unit_label="แคมเปญ", summary=RunSummary(),
        )
        self.assertEqual(new, 300)

    def test_no_change_returns_none(self):
        state = State("/tmp/nonexistent_state_z.json", {})
        pa = self._plan(action="RESET_BUDGET", budget_op="reset", reset_amount=300)
        new = _apply_budget_sequence(
            300, [pa], state=state, now=NOON, account_id="1", unit_id="c1",
            unit_label="แคมเปญ", summary=RunSummary(),
        )
        self.assertIsNone(new)  # งบเท่าเดิม

    def test_frequency_cooldown(self):
        state = State("/tmp/nonexistent_state_w.json", {})
        pa = self._plan(percent=50, frequency_mins=50)
        # ครั้งแรกผ่าน
        new1 = _apply_budget_sequence(
            100, [pa], state=state, now=NOON, account_id="1", unit_id="c1",
            unit_label="แคมเปญ", summary=RunSummary(),
        )
        self.assertEqual(new1, 150)
        # อีก 10 นาที -> ยังไม่ครบ 50 นาที -> ข้าม
        new2 = _apply_budget_sequence(
            150, [pa], state=state, now=NOON + timedelta(minutes=10), account_id="1", unit_id="c1",
            unit_label="แคมเปญ", summary=RunSummary(),
        )
        self.assertIsNone(new2)
        # อีก 60 นาที -> ครบแล้ว -> เพิ่มได้
        new3 = _apply_budget_sequence(
            150, [pa], state=state, now=NOON + timedelta(minutes=60), account_id="1", unit_id="c1",
            unit_label="แคมเปญ", summary=RunSummary(),
        )
        self.assertEqual(new3, 225)


class TestStatePersistence(unittest.TestCase):
    def test_save_and_load(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "state.json")
            s = State.load(path)
            s.mark_applied("k1", NOON)
            s.save()
            s2 = State.load(path)
            self.assertIsNotNone(s2.last_applied("k1"))
            self.assertFalse(s2.can_apply("k1", 50, NOON + timedelta(minutes=10)))
            self.assertTrue(s2.can_apply("k1", 50, NOON + timedelta(minutes=51)))


if __name__ == "__main__":
    unittest.main(verbosity=2)
