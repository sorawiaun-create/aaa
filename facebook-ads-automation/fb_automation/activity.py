"""เก็บ log การทำงานย้อนหลัง (activity.json) ให้หน้า Dashboard โชว์.

โครงสร้าง: { "runs": [ {t, dry_run, summary, events:[...]}, ... ] }  (รอบล่าสุดอยู่บนสุด)
เก็บย้อนหลังไม่เกิน KEEP_RUNS รอบ.
"""
from __future__ import annotations

import json
import os
from typing import Any

KEEP_RUNS = 60


def load_activity(path: str) -> dict[str, Any]:
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, dict) and isinstance(data.get("runs"), list):
                    return data
        except (json.JSONDecodeError, OSError):
            pass
    return {"runs": []}


def append_run(activity: dict[str, Any], run_entry: dict[str, Any], keep: int = KEEP_RUNS) -> dict[str, Any]:
    runs = activity.setdefault("runs", [])
    runs.insert(0, run_entry)
    del runs[keep:]
    return activity


def write_activity(path: str, activity: dict[str, Any]) -> None:
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(activity, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)
