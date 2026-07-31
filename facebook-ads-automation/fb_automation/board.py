"""เขียนไฟล์ "กระดานแอด" (board.json) — สแนปช็อตแคมเปญรายบัญชี ให้ Dashboard โชว์และคุมเอง."""
from __future__ import annotations

import json
import os
from typing import Any


def write_board(path: str, board: dict[str, Any]) -> None:
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(board, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)
