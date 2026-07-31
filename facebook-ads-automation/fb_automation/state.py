"""จัดการ state ข้ามรอบการรัน (ใช้จำกัดความถี่การเพิ่มงบ frequencyMins).

เก็บเป็นไฟล์ JSON เล็ก ๆ. บน GitHub Actions ไฟล์นี้ถูก restore/save ผ่าน cache.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any


class State:
    def __init__(self, path: str, data: dict[str, Any] | None = None):
        self.path = path
        self._data: dict[str, Any] = data or {}
        self._last_applied: dict[str, str] = self._data.setdefault("last_applied", {})

    @classmethod
    def load(cls, path: str) -> "State":
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    return cls(path, json.load(f))
            except (json.JSONDecodeError, OSError):
                # ไฟล์เสีย -> เริ่มใหม่ ดีกว่าพัง
                return cls(path, {})
        return cls(path, {})

    def save(self) -> None:
        tmp = f"{self.path}.tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self._data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, self.path)

    def last_applied(self, key: str) -> datetime | None:
        raw = self._last_applied.get(key)
        if not raw:
            return None
        try:
            dt = datetime.fromisoformat(raw)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except ValueError:
            return None

    def can_apply(self, key: str, frequency_mins: float | None, now: datetime) -> bool:
        """เช็คว่าเลย cooldown แล้วหรือยัง. frequency_mins None/0 = ไม่จำกัด."""
        if not frequency_mins:
            return True
        last = self.last_applied(key)
        if last is None:
            return True
        elapsed_min = (now - last).total_seconds() / 60.0
        return elapsed_min >= frequency_mins

    def mark_applied(self, key: str, now: datetime) -> None:
        self._last_applied[key] = now.astimezone(timezone.utc).isoformat()
