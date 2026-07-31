"""คิวคำสั่งควบคุมเอง (commands.json) จากหน้ากระดานแอด.

Dashboard เขียนคำสั่งเข้าไฟล์นี้ (ผ่าน GitHub API) แล้ว engine อ่านมาทำในรอบถัดไป
(หรือกด "สั่งทำเดี๋ยวนี้" ให้รันทันที) เสร็จแล้วเคลียร์คิว.

รูปแบบคำสั่ง: {account_id, account_name, campaign_id, campaign_name, action, value?}
  action: PAUSE | ACTIVATE | SET_BUDGET (value = งบรายวัน บาท)
"""
from __future__ import annotations

import json
import os
from typing import Any


def load_commands(path: str) -> list[dict[str, Any]]:
    if not os.path.exists(path):
        return []
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        cmds = data.get("commands") if isinstance(data, dict) else data
        return cmds if isinstance(cmds, list) else []
    except (json.JSONDecodeError, OSError):
        return []


def clear_commands(path: str) -> None:
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"commands": []}, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)
