"""ประเมินเงื่อนไข/กฎ และแปลงผลเป็น "แผนการทำงาน" (plan) ต่อแคมเปญ.

เป็น pure logic ล้วน (ไม่แตะ network / state) — ทดสอบง่าย.
"""
from __future__ import annotations

import math
import operator
from dataclasses import dataclass
from typing import Any, Callable

_OPS: dict[str, Callable[[float, float], bool]] = {
    ">": operator.gt,
    "<": operator.lt,
    ">=": operator.ge,
    "<=": operator.le,
    "==": operator.eq,
    "!=": operator.ne,
}


def evaluate_condition(condition: dict[str, Any], metrics: dict[str, float]) -> bool:
    """เช็คเงื่อนไขเดียว. metric ที่ไม่รู้จัก -> ถือว่าไม่ผ่าน (False)."""
    metric = condition.get("metric")
    op = _OPS.get(condition.get("operator"))
    if metric not in metrics or op is None:
        return False
    left = metrics[metric]
    right = float(condition.get("value"))
    # ป้องกัน inf == inf ให้พฤติกรรมสมเหตุสมผล
    if math.isinf(left) and op in (operator.eq, operator.ne):
        return op is operator.ne
    return op(left, right)


def rule_matches(rule: dict[str, Any], metrics: dict[str, float]) -> bool:
    """กฎจะ "ตรง" เมื่อทุกเงื่อนไขเป็นจริง (AND)."""
    conditions = rule.get("conditions") or []
    return all(evaluate_condition(c, metrics) for c in conditions)


@dataclass
class PlannedAction:
    """สิ่งที่ตั้งใจจะทำกับแคมเปญ 1 อย่าง (ยังไม่ลงมือ)."""
    kind: str                       # STATUS | BUDGET
    rule_index: int
    rule_name: str
    action: str                     # PAUSE / ACTIVATE / INCREASE_BUDGET / ...
    # สำหรับ STATUS
    status: str | None = None       # ACTIVE / PAUSED
    # สำหรับ BUDGET
    budget_op: str | None = None    # increase / decrease / reset
    percent: float | None = None
    reset_amount: float | None = None
    max_budget: float | None = None
    min_budget: float | None = None
    frequency_mins: float | None = None

    def state_key(self, account_id: str, campaign_id: str) -> str:
        return f"{account_id}:{campaign_id}:rule{self.rule_index}:{self.action}"


def plan_campaign(rules: list[dict[str, Any]], metrics: dict[str, float]) -> list[PlannedAction]:
    """ไล่กฎทั้งหมดตามลำดับ คืน list ของ action ที่กฎ"ตรง".

    การแก้ conflict (เช่น PAUSE แล้ว ACTIVATE) ทำในขั้น execute (กฎท้ายชนะ).
    """
    planned: list[PlannedAction] = []
    for idx, rule in enumerate(rules):
        # ข้ามกฎที่ถูกปิดชั่วคราวจาก Dashboard (enabled=false)
        if rule.get("enabled", True) is False:
            continue
        if not rule_matches(rule, metrics):
            continue

        action = rule.get("action")
        name = rule.get("name") or f"rule#{idx}"
        params = rule.get("params") or {}

        if action == "PAUSE":
            planned.append(PlannedAction("STATUS", idx, name, action, status="PAUSED"))
        elif action == "ACTIVATE":
            planned.append(PlannedAction("STATUS", idx, name, action, status="ACTIVE"))
        elif action in ("INCREASE_BUDGET", "DECREASE_BUDGET"):
            planned.append(
                PlannedAction(
                    "BUDGET", idx, name, action,
                    budget_op="increase" if action == "INCREASE_BUDGET" else "decrease",
                    percent=_num(params.get("percent")),
                    max_budget=_num(params.get("maxBudget")),
                    min_budget=_num(params.get("minBudget")),
                    frequency_mins=_num(params.get("frequencyMins")),
                )
            )
        elif action == "RESET_BUDGET":
            planned.append(
                PlannedAction(
                    "BUDGET", idx, name, action,
                    budget_op="reset",
                    reset_amount=_num(params.get("resetAmount")),
                    frequency_mins=_num(params.get("frequencyMins")),
                )
            )
    return planned


def _num(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
