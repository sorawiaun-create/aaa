"""สร้างไฟล์สรุปสถานะ (status.json) ให้หน้า Dashboard อ่านโชว์ "ภาพรวม".

ตัวคลาวด์รันทุก ~10 นาที แล้วเขียนไฟล์นี้ (ยอดรวมต่อบัญชี) กลับเข้า repo
หน้าเว็บจึงโชว์ Spend / Revenue / ROAS / Orders ได้ โดยไม่ต้องมี token FB ในเบราว์เซอร์.
"""
from __future__ import annotations

import json
import os
from typing import Any


def aggregate_metrics(metrics_list: list[dict[str, float]]) -> dict[str, float]:
    """รวมยอดจาก metric ต่อแคมเปญ -> ยอดรวมของบัญชี.

    - spend    = ผลรวมค่าใช้จ่าย
    - orders   = ผลรวมจำนวนการซื้อ
    - revenue  = ผลรวม (spend x roas) ของแต่ละแคมเปญ
    - roas     = revenue / spend (ของทั้งบัญชี)
    """
    spend = 0.0
    orders = 0.0
    revenue = 0.0
    for m in metrics_list:
        s = float(m.get("spend", 0) or 0)
        r = float(m.get("roas", 0) or 0)
        spend += s
        orders += float(m.get("purchases", 0) or 0)
        revenue += s * r
    roas = (revenue / spend) if spend > 0 else 0.0
    return {
        "spend": round(spend, 2),
        "revenue": round(revenue, 2),
        "orders": int(round(orders)),
        "roas": round(roas, 2),
        "cost_per_order": round(spend / orders, 2) if orders > 0 else 0.0,
    }


def build_status(
    *,
    updated_at: str,
    timezone: str,
    dry_run: bool,
    accounts: list[dict[str, Any]],
) -> dict[str, Any]:
    """ประกอบ object สถานะทั้งหมด (รวมทุกบัญชี + ยอดรวมทั้งระบบ)."""
    totals = {"spend": 0.0, "revenue": 0.0, "orders": 0}
    for a in accounts:
        totals["spend"] += a.get("spend", 0) or 0
        totals["revenue"] += a.get("revenue", 0) or 0
        totals["orders"] += a.get("orders", 0) or 0
    totals["spend"] = round(totals["spend"], 2)
    totals["revenue"] = round(totals["revenue"], 2)
    totals["roas"] = round(totals["revenue"] / totals["spend"], 2) if totals["spend"] > 0 else 0.0
    return {
        "updated_at": updated_at,
        "timezone": timezone,
        "dry_run": dry_run,
        "totals": totals,
        "accounts": accounts,
    }


def write_status(path: str, status: dict[str, Any]) -> None:
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(status, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)
