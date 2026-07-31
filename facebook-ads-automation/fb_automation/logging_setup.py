"""ตั้งค่า logging ให้อ่านง่ายทั้งบนเครื่องและใน GitHub Actions."""
from __future__ import annotations

import logging
import os
import sys


def setup_logging(level: str | None = None) -> logging.Logger:
    """สร้าง/คืนค่า root logger ของโปรเจกต์."""
    level_name = (level or os.environ.get("LOG_LEVEL") or "INFO").upper()
    log_level = getattr(logging, level_name, logging.INFO)

    logger = logging.getLogger("fb_automation")
    logger.setLevel(log_level)

    # กันไม่ให้ handler ซ้ำเวลาถูกเรียกหลายครั้ง
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(
            logging.Formatter(
                "%(asctime)s  %(levelname)-7s  %(message)s",
                datefmt="%Y-%m-%d %H:%M:%S",
            )
        )
        logger.addHandler(handler)

    logger.propagate = False
    return logger
