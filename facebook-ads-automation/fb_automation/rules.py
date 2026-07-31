"""ประเมินเงื่อนไข/กฎ และแปลงผลเป็น "แผนการทำงาน" (plan) ต่อแคมเปญ.

เป็น pure logic ล้วน (ไม่แตะ network / state) — ทดสอบง่าย.
"""
from __future__ import annotations

import math
import operator
from dataclasses import dataclass
from typing import Any, Callable

# ชื่อ metric ภาษาไทย (สั้น) สำหรับเขียน "เหตุผล" ใน log
METRIC_TH = {
    "time_of_day": "เวลา", "spend": "จ่าย", "purchases": "ซื้อ", "results": "ทัก",
    "roas": "ROAS", "cost_per_purchase": "ทุนซื้อ", "cost_per_result": "ทุนทัก",
    "impressions": "อิมเพรสชัน", "clicks": "คลิก", "ctr": "CTR", "cpc": "CPC",
    "cpm": "CPM", "frequency": "ความถี่", "reach": "เข้าถึง",
}


def _fmt_num(x: Any) -> str:
    if x is None:
        return "?"
    try:
        xf = float(x)
    except (TypeError, ValueError):
        return str(x)
    if math.isinf(xf):
        return "∞"
    return str(int(xf)) if xf.is_integer() else f"{xf:.2f}"


def _fmt_time(v: Any) -> str:
    try:
        h = int(float(v)); m = int(round((float(v) - h) * 60))
        if m >= 60:
            h += 1; m -= 60
        return f"{h}:{m:02d}"
    except (TypeError, ValueError):
        return str(v)


def describe_conditions(rule: dict[str, Any], metrics: dict[str, float]) -> str:
    """สร้างข้อความ "เหตุผล" ภาษาไทย พร้อมค่าจริงตอนนั้น.

    เช่น "จ่าย=350 (>300) และ ROAS=2.50 (<2.8)"
    """
    parts = []
    for c in rule.get("conditions") or []:
        m = c.get("metric"); op = c.get("operator"); thr = c.get("value")
        act = metrics.get(m)
        if m == "time_of_day":
            a = _fmt_time(act) if act is not None else "?"
            t = str(thr)
        else:
            a = _fmt_num(act); t = _fmt_num(thr)
        parts.append(f"{METRIC_TH.get(m, m)}={a} ({op}{t})")
    return " และ ".join(parts)


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
    reason: str = ""                # เหตุผล (เงื่อนไข + ค่าจริง) สำหรับ log

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
        reason = describe_conditions(rule, metrics)

        if action == "PAUSE":
            planned.append(PlannedAction("STATUS", idx, name, action, status="PAUSED", reason=reason))
        elif action == "ACTIVATE":
            planned.append(PlannedAction("STATUS", idx, name, action, status="ACTIVE", reason=reason))
        elif action in ("INCREASE_BUDGET", "DECREASE_BUDGET"):
            planned.append(
                PlannedAction(
                    "BUDGET", idx, name, action,
                    budget_op="increase" if action == "INCREASE_BUDGET" else "decrease",
                    percent=_num(params.get("percent")),
                    max_budget=_num(params.get("maxBudget")),
                    min_budget=_num(params.get("minBudget")),
                    frequency_mins=_num(params.get("frequencyMins")),
                    reason=reason,
                )
            )
        elif action == "RESET_BUDGET":
            planned.append(
                PlannedAction(
                    "BUDGET", idx, name, action,
                    budget_op="reset",
                    reset_amount=_num(params.get("resetAmount")),
                    frequency_mins=_num(params.get("frequencyMins")),
                    reason=reason,
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
