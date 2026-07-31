"""แปลงข้อมูลดิบจาก Facebook Insights ให้เป็น metric ที่กฎใช้เปรียบเทียบ.

ฟังก์ชันในไฟล์นี้เป็น pure function (ไม่แตะ network) จึงเทสได้ง่าย.
"""
from __future__ import annotations

import math
from datetime import datetime
from typing import Any, Iterable

# รายชื่อ field ที่ต้องขอจาก Insights API
INSIGHTS_FIELDS = [
    "campaign_id",
    "spend",
    "impressions",
    "clicks",
    "ctr",
    "cpc",
    "cpm",
    "reach",
    "frequency",
    "actions",
    "purchase_roas",
    "action_values",
]


def _to_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _sum_actions(actions: Iterable[dict[str, Any]] | None, wanted_types: list[str]) -> float:
    """รวมค่า action ตาม action_type ที่สนใจ (คืน 0 ถ้าไม่มี)."""
    if not actions:
        return 0.0
    total = 0.0
    for act in actions:
        if act.get("action_type") in wanted_types:
            total += _to_float(act.get("value"))
    return total


def _first_action_value(actions: Iterable[dict[str, Any]] | None, wanted_types: list[str]) -> float:
    """คืนค่า action ตัวแรกที่เจอตามลำดับ wanted_types (ใช้กับ purchase/roas)."""
    if not actions:
        return 0.0
    by_type = {a.get("action_type"): _to_float(a.get("value")) for a in actions}
    for t in wanted_types:
        if t in by_type:
            return by_type[t]
    return 0.0


def time_of_day(now_local: datetime) -> float:
    """ชั่วโมงปัจจุบันเป็นทศนิยม เช่น 22:30 -> 22.5 (ให้ตรงกับกฎ time_of_day)."""
    return now_local.hour + now_local.minute / 60.0 + now_local.second / 3600.0


def compute_metrics(
    insight: dict[str, Any] | None,
    *,
    now_local: datetime,
    purchase_action_types: list[str],
    result_action_types: list[str],
) -> dict[str, float]:
    """สร้าง dict ของค่า metric ทั้งหมดสำหรับแคมเปญหนึ่ง.

    ``insight`` คือ 1 แถวจาก Insights (หรือ None ถ้าแคมเปญยังไม่มียอดวันนี้).
    """
    insight = insight or {}

    spend = _to_float(insight.get("spend"))
    impressions = _to_float(insight.get("impressions"))
    clicks = _to_float(insight.get("clicks"))
    reach = _to_float(insight.get("reach"))

    actions = insight.get("actions")
    purchases = _first_action_value(actions, purchase_action_types)
    results = _sum_actions(actions, result_action_types)

    # ROAS: purchase_roas เป็น list [{action_type, value}]
    roas = _first_action_value(insight.get("purchase_roas"), purchase_action_types)
    if roas == 0.0 and insight.get("purchase_roas"):
        # fallback: เอาค่าแรกสุดที่มี
        try:
            roas = _to_float(insight["purchase_roas"][0].get("value"))
        except (IndexError, AttributeError, KeyError):
            roas = 0.0

    def _cost_per(n: float) -> float:
        # ไม่มี result -> ต้นทุนต่อหน่วยเป็นอนันต์ (เงื่อนไข ">" จะเป็นจริง, "<" จะเป็นเท็จ)
        return spend / n if n > 0 else math.inf

    return {
        "spend": spend,
        "impressions": impressions,
        "clicks": clicks,
        "reach": reach,
        "frequency": _to_float(insight.get("frequency")),
        "ctr": _to_float(insight.get("ctr")),
        "cpc": _to_float(insight.get("cpc")),
        "cpm": _to_float(insight.get("cpm")),
        "purchases": purchases,
        "results": results,
        "roas": roas,
        "cost_per_purchase": _cost_per(purchases),
        "cost_per_result": _cost_per(results),
        "time_of_day": time_of_day(now_local),
    }
