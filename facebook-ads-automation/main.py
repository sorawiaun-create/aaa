#!/usr/bin/env python3
"""จุดเริ่มรัน — ตัวรันกฎอัตโนมัติ Facebook Ads หลายบัญชี.

การใช้งาน:
    python main.py                     # รัน 1 รอบ (อ่าน config.json)
    python main.py --dry-run           # จำลอง ไม่แก้ไขจริง
    python main.py --config custom.json
    python main.py --loop --interval 10   # วนทุก 10 นาที (สำหรับรันบนเครื่อง/VPS)

ตั้งค่าผ่าน env:
    FB_ACCESS_TOKEN   token ของ Facebook (ใช้ร่วมทุกบัญชีที่ token ว่างใน config)
    FB_DRY_RUN        "1"/"true" = จำลองอย่างเดียว
    CONFIG_PATH       path ของไฟล์ config (ค่าเริ่มต้น ./config.json)
    STATE_PATH        path ของไฟล์ state (ค่าเริ่มต้น ./state.json)
    LOG_LEVEL         DEBUG / INFO / WARNING
"""
from __future__ import annotations

import argparse
import os
import time
from datetime import datetime
from zoneinfo import ZoneInfo

from fb_automation.actions import RunSummary, execute_campaign
from fb_automation.config import Config, ConfigError, load_config
from fb_automation.fb_client import FacebookClient
from fb_automation.logging_setup import setup_logging
from fb_automation.metrics import compute_metrics
from fb_automation.rules import plan_campaign
from fb_automation.state import State
from fb_automation.status import aggregate_metrics, build_status, write_status
from fb_automation.activity import append_run, load_activity, write_activity

log = setup_logging()


def _env_truthy(name: str) -> bool:
    return str(os.environ.get(name, "")).strip().lower() in ("1", "true", "yes", "on")


def run_once(config: Config, state: State, now_local: datetime) -> RunSummary:
    """รัน 1 รอบครบทุกบัญชี."""
    total = RunSummary()
    dry = config.settings.dry_run
    name_filter = config.settings.campaign_name_filter
    import re
    name_re = re.compile(name_filter) if name_filter else None

    log.info("=" * 64)
    log.info("เริ่มรอบ %s  (เวลาไทย %s)%s",
             now_local.strftime("%Y-%m-%d %H:%M:%S"),
             f"{now_local.hour:02d}:{now_local.minute:02d}",
             "  [DRY-RUN]" if dry else "")
    log.info("=" * 64)

    status_accounts: list[dict] = []
    events: list[dict] = []

    for account in config.accounts:
        acct_stat = {
            "name": account.name,
            "account_id": account.account_id,
            "campaigns": 0,
            "active_today": 0,
            "error": None,
            "disabled": not account.enabled,
            "spend": 0.0, "revenue": 0.0, "orders": 0, "roas": 0.0, "cost_per_order": 0.0,
        }
        # ข้ามบัญชีที่ถูกปิดจาก Dashboard
        if not account.enabled:
            log.info("🏦 บัญชี: %s — ⏸️ ปิดอยู่ ข้าม", account.name)
            status_accounts.append(acct_stat)
            continue

        log.info("🏦 บัญชี: %s (act_%s) — %d กฎ",
                 account.name, account.account_id, len(account.rules))
        try:
            client = FacebookClient(account.account_id, account.token)
            campaigns = client.get_campaigns()
            insights = client.get_insights_by_campaign()
        except Exception as e:  # noqa: BLE001
            log.error("  ❌ เชื่อมต่อ/ดึงข้อมูลบัญชีไม่สำเร็จ: %s", e)
            total.errors += 1
            acct_stat["error"] = str(e)[:200]
            status_accounts.append(acct_stat)
            events.append({"account": account.name, "campaign": "-", "rule": "-",
                           "action": "CONNECT", "detail": "เชื่อมต่อบัญชีไม่สำเร็จ",
                           "status": "error", "error": str(e)[:200]})
            continue

        log.info("  พบ %d แคมเปญ, %d แคมเปญมียอดวันนี้", len(campaigns), len(insights))
        acct_stat["campaigns"] = len(campaigns)
        acct_stat["active_today"] = len(insights)

        account_metrics: list[dict] = []
        for campaign in campaigns:
            if name_re and not name_re.search(campaign.get("name", "")):
                continue
            metrics = compute_metrics(
                insights.get(campaign["id"]),
                now_local=now_local,
                purchase_action_types=account.purchase_action_types,
                result_action_types=account.result_action_types,
            )
            account_metrics.append(metrics)
            planned = plan_campaign(account.rules, metrics)
            if planned:
                execute_campaign(
                    client, campaign, planned,
                    state=state, now=now_local, dry_run=dry, summary=total,
                    account_name=account.name, events=events,
                )

        acct_stat.update(aggregate_metrics(account_metrics))
        status_accounts.append(acct_stat)

    log.info("-" * 64)
    log.info("สรุป: เปลี่ยนสถานะ %d · ปรับงบ %d · ข้าม(รอบ) %d · error %d%s",
             total.status_changes, total.budget_changes,
             total.skipped_cooldown, total.errors,
             "  [DRY-RUN ไม่ได้แก้จริง]" if dry else "")

    # เขียนไฟล์สรุปให้หน้า Dashboard อ่าน (ไม่ให้พังทั้งรอบถ้าเขียนไม่ได้)
    try:
        status_path = os.environ.get("STATUS_PATH", "status.json")
        write_status(status_path, build_status(
            updated_at=now_local.isoformat(),
            timezone=config.settings.timezone,
            dry_run=dry,
            accounts=status_accounts,
        ))
    except Exception as e:  # noqa: BLE001
        log.warning("เขียน status.json ไม่สำเร็จ: %s", e)

    # เขียน log การทำงาน (activity.json) — เก็บย้อนหลังให้ดูได้ในหน้า Dashboard
    try:
        activity_path = os.environ.get("ACTIVITY_PATH", "activity.json")
        activity = load_activity(activity_path)
        append_run(activity, {
            "t": now_local.isoformat(),
            "dry_run": dry,
            "summary": {
                "status_changes": total.status_changes,
                "budget_changes": total.budget_changes,
                "skipped_cooldown": total.skipped_cooldown,
                "errors": total.errors,
            },
            "events": events,
        })
        write_activity(activity_path, activity)
    except Exception as e:  # noqa: BLE001
        log.warning("เขียน activity.json ไม่สำเร็จ: %s", e)

    return total


def main() -> int:
    parser = argparse.ArgumentParser(description="Facebook Ads multi-account automation")
    parser.add_argument("--config", default=os.environ.get("CONFIG_PATH", "config.json"))
    parser.add_argument("--state", default=os.environ.get("STATE_PATH", "state.json"))
    parser.add_argument("--dry-run", action="store_true", help="จำลอง ไม่แก้ไขจริง")
    parser.add_argument("--loop", action="store_true", help="วนซ้ำเรื่อย ๆ (ใช้บนเครื่อง/VPS)")
    parser.add_argument("--interval", type=int, default=10, help="นาทีต่อรอบ เมื่อใช้ --loop")
    args = parser.parse_args()

    dry_run = args.dry_run or _env_truthy("FB_DRY_RUN")

    try:
        config = load_config(args.config, dry_run_override=True if dry_run else None)
    except ConfigError as e:
        log.error("Config error: %s", e)
        return 2

    try:
        tz = ZoneInfo(config.settings.timezone)
    except Exception:  # noqa: BLE001
        log.warning("timezone '%s' ไม่ถูกต้อง ใช้ UTC", config.settings.timezone)
        tz = ZoneInfo("UTC")

    def _one_pass() -> RunSummary:
        state = State.load(args.state)
        summary = run_once(config, state, datetime.now(tz))
        try:
            state.save()
        except OSError as e:
            log.warning("บันทึก state ไม่สำเร็จ: %s", e)
        return summary

    if not args.loop:
        summary = _one_pass()
        return 1 if summary.errors else 0

    log.info("โหมด loop: รันทุก %d นาที (กด Ctrl+C เพื่อหยุด)", args.interval)
    while True:
        try:
            _one_pass()
        except KeyboardInterrupt:
            log.info("หยุดโดยผู้ใช้")
            return 0
        except Exception as e:  # noqa: BLE001
            log.error("รอบนี้ล้มเหลว: %s", e)
        time.sleep(max(60, args.interval * 60))


if __name__ == "__main__":
    raise SystemExit(main())
