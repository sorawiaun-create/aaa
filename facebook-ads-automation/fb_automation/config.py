"""โหลดและตรวจสอบไฟล์ config (บัญชี + กฎ)."""
from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from typing import Any

# ค่าเริ่มต้นของ engine (ตั้งค่าเพิ่มได้ใน config -> "settings")
DEFAULT_TIMEZONE = "Asia/Bangkok"

# action_type จาก Facebook ที่ถือเป็น "การซื้อ" (เรียงตามลำดับความสำคัญ)
DEFAULT_PURCHASE_ACTION_TYPES = ["omni_purchase", "purchase"]

# action_type ที่ถือเป็น "results" (ค่าเริ่มต้น = ทักแชต) — override ต่อบัญชีได้
DEFAULT_RESULT_ACTION_TYPES = [
    "onsite_conversion.messaging_conversation_started_7d",
]

VALID_ACTIONS = {"PAUSE", "ACTIVATE", "INCREASE_BUDGET", "DECREASE_BUDGET", "RESET_BUDGET"}
VALID_OPERATORS = {">", "<", ">=", "<=", "==", "!="}


class ConfigError(Exception):
    """ข้อผิดพลาดของไฟล์ config."""


@dataclass
class Account:
    name: str
    account_id: str          # ตัวเลขล้วน ไม่มี act_
    token: str               # token จริง (resolve จาก env แล้ว)
    target_level: str        # "campaign" (รองรับหลักคือ campaign)
    rules: list[dict[str, Any]]
    enabled: bool = True     # ปิดบัญชีชั่วคราวจาก Dashboard ได้ (ไม่ต้องลบ)
    purchase_action_types: list[str] = field(default_factory=lambda: list(DEFAULT_PURCHASE_ACTION_TYPES))
    result_action_types: list[str] = field(default_factory=lambda: list(DEFAULT_RESULT_ACTION_TYPES))

    @property
    def act_id(self) -> str:
        return f"act_{self.account_id}"


@dataclass
class Settings:
    timezone: str = DEFAULT_TIMEZONE
    dry_run: bool = False
    interval_mins: int = 10   # ให้ประเมินกฎทุกกี่นาที (10/20/30/60) — cron จะ tick ทุก 10 นาที
    # กรอง campaign ตามชื่อ (regex) ถ้าต้องการ — ค่าว่าง = ทุกแคมเปญ
    campaign_name_filter: str | None = None


@dataclass
class Config:
    accounts: list[Account]
    settings: Settings


_ENV_TOKEN_RE = re.compile(r"^env:(?P<name>[A-Za-z_][A-Za-z0-9_]*)$")


def _resolve_token(raw: Any, account_name: str) -> str:
    """แปลงค่า token ในไฟล์ config ให้เป็น token จริง.

    รองรับ 3 รูปแบบ:
      - None / ""            -> อ่านจาก env FB_ACCESS_TOKEN
      - "env:NAME"           -> อ่านจาก env ตัวแปรชื่อ NAME
      - "<token จริง>"       -> ใช้ค่านั้นตรง ๆ (ไม่แนะนำ อย่า commit)
    """
    if raw is None or raw == "":
        token = os.environ.get("FB_ACCESS_TOKEN", "")
        source = "env FB_ACCESS_TOKEN"
    elif isinstance(raw, str) and _ENV_TOKEN_RE.match(raw):
        name = _ENV_TOKEN_RE.match(raw).group("name")
        token = os.environ.get(name, "")
        source = f"env {name}"
    else:
        token = str(raw)
        source = "config (inline)"

    if not token:
        raise ConfigError(
            f"บัญชี '{account_name}': ไม่พบ access token (แหล่งที่คาดหวัง: {source}). "
            f"ตั้งค่า secret/env ให้เรียบร้อยก่อนรัน"
        )
    return token


def _validate_rule(rule: dict[str, Any], account_name: str, idx: int) -> None:
    action = rule.get("action")
    if action not in VALID_ACTIONS:
        raise ConfigError(
            f"บัญชี '{account_name}' กฎที่ {idx} ('{rule.get('name')}'): "
            f"action ไม่ถูกต้อง: {action!r} (ต้องเป็นหนึ่งใน {sorted(VALID_ACTIONS)})"
        )
    conditions = rule.get("conditions") or []
    if not conditions:
        raise ConfigError(
            f"บัญชี '{account_name}' กฎที่ {idx} ('{rule.get('name')}'): ไม่มี conditions"
        )
    for c in conditions:
        if c.get("operator") not in VALID_OPERATORS:
            raise ConfigError(
                f"บัญชี '{account_name}' กฎที่ {idx}: operator ไม่ถูกต้อง: {c.get('operator')!r}"
            )
        if c.get("metric") is None:
            raise ConfigError(
                f"บัญชี '{account_name}' กฎที่ {idx}: condition ขาด metric"
            )
        if c.get("value") is None:
            raise ConfigError(
                f"บัญชี '{account_name}' กฎที่ {idx}: condition ขาด value"
            )


def load_config(path: str, *, dry_run_override: bool | None = None) -> Config:
    """อ่านไฟล์ config.json แล้วคืนเป็น Config object ที่ตรวจสอบแล้ว."""
    if not os.path.exists(path):
        raise ConfigError(f"ไม่พบไฟล์ config: {path}")

    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    # รองรับทั้งรูปแบบ [ ...accounts... ] และ { "accounts": [...], "settings": {...} }
    if isinstance(data, list):
        accounts_raw = data
        settings_raw: dict[str, Any] = {}
    elif isinstance(data, dict):
        accounts_raw = data.get("accounts", [])
        settings_raw = data.get("settings", {}) or {}
    else:
        raise ConfigError("รูปแบบ config ไม่ถูกต้อง (ต้องเป็น list หรือ object)")

    if not accounts_raw:
        raise ConfigError("config ไม่มีบัญชีเลย")

    accounts: list[Account] = []
    for a in accounts_raw:
        name = a.get("name") or a.get("account_id") or "(ไม่มีชื่อ)"
        account_id = str(a.get("account_id") or "").replace("act_", "").strip()
        if not account_id:
            raise ConfigError(f"บัญชี '{name}': ขาด account_id")

        rules = a.get("rules") or []
        for i, r in enumerate(rules, start=1):
            _validate_rule(r, name, i)

        metrics_cfg = a.get("metrics") or {}
        enabled = a.get("enabled", True) is not False
        try:
            tok = _resolve_token(a.get("token"), name)
        except ConfigError:
            if enabled:
                raise
            tok = ""  # บัญชีที่ปิดอยู่ ไม่ต้องมี token ก็ได้
        accounts.append(
            Account(
                name=name,
                account_id=account_id,
                token=tok,
                target_level=a.get("target_level") or "campaign",
                rules=rules,
                enabled=enabled,
                purchase_action_types=list(
                    metrics_cfg.get("purchase_action_types") or DEFAULT_PURCHASE_ACTION_TYPES
                ),
                result_action_types=list(
                    metrics_cfg.get("result_action_types") or DEFAULT_RESULT_ACTION_TYPES
                ),
            )
        )

    try:
        interval = int(settings_raw.get("interval_mins", 10) or 10)
    except (TypeError, ValueError):
        interval = 10
    settings = Settings(
        timezone=settings_raw.get("timezone", DEFAULT_TIMEZONE),
        dry_run=bool(settings_raw.get("dry_run", False)),
        interval_mins=max(10, interval),
        campaign_name_filter=settings_raw.get("campaign_name_filter") or None,
    )
    if dry_run_override is not None:
        settings.dry_run = dry_run_override

    return Config(accounts=accounts, settings=settings)
