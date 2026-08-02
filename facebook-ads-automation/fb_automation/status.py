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


# ช่วงเวลาย้อนหลังที่ดึงมาโชว์ในหน้าภาพรวม (ตรงกับ date_preset ของ Facebook)
PERIOD_PRESETS = ["today", "yesterday", "last_3d", "last_7d", "last_30d"]


def zero_period() -> dict[str, Any]:
    return {"spend": 0.0, "revenue": 0.0, "orders": 0, "roas": 0.0, "cost_per_order": 0.0}


def account_totals_from_row(row: dict[str, Any], purchase_types: list[str]) -> dict[str, Any]:
    """แปลง insight ระดับบัญชี 1 แถว -> ยอดรวม (spend/revenue/orders/roas)."""
    from .metrics import _first_action_value, _to_float
    spend = _to_float((row or {}).get("spend"))
    orders = _first_action_value((row or {}).get("actions"), purchase_types)
    revenue = _first_action_value((row or {}).get("action_values"), purchase_types)
    if revenue == 0:  # เผื่อบัญชีไม่มี action_values -> ใช้ spend x roas
        revenue = spend * _first_action_value((row or {}).get("purchase_roas"), purchase_types)
    roas = (revenue / spend) if spend > 0 else 0.0
    return {
        "spend": round(spend, 2), "revenue": round(revenue, 2), "orders": int(round(orders)),
        "roas": round(roas, 2), "cost_per_order": round(spend / orders, 2) if orders > 0 else 0.0,
    }


def build_status(
    *,
    updated_at: str,
    timezone: str,
    dry_run: bool,
    accounts: list[dict[str, Any]],
) -> dict[str, Any]:
    """ประกอบ object สถานะ + ยอดรวมทั้งระบบ แยกตามช่วงเวลา.

    แต่ละบัญชีต้องมี key "periods" = {preset: {spend,revenue,orders,roas,cost_per_order}}.
    """
    period_totals: dict[str, Any] = {}
    for p in PERIOD_PRESETS:
        s = r = 0.0
        o = 0
        for a in accounts:
            pd = (a.get("periods") or {}).get(p) or {}
            s += pd.get("spend", 0) or 0
            r += pd.get("revenue", 0) or 0
            o += int(pd.get("orders", 0) or 0)
        period_totals[p] = {
            "spend": round(s, 2), "revenue": round(r, 2), "orders": o,
            "roas": round(r / s, 2) if s > 0 else 0.0,
        }
    return {
        "updated_at": updated_at,
        "timezone": timezone,
        "dry_run": dry_run,
        "period_totals": period_totals,
        "accounts": accounts,
    }


def write_status(path: str, status: dict[str, Any]) -> None:
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(status, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)
