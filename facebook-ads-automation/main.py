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
from fb_automation.status import (
    PERIOD_PRESETS, account_totals_from_row, aggregate_metrics, build_status,
    write_status, zero_period,
)
from fb_automation.activity import append_run, load_activity, write_activity
from fb_automation.notify import maybe_notify
from fb_automation.board import write_board
from fb_automation.commands import load_commands, clear_commands

LAST_RUN_KEY = "__last_rule_run__"

log = setup_logging()


def _env_truthy(name: str) -> bool:
    return str(os.environ.get(name, "")).strip().lower() in ("1", "true", "yes", "on")


def process_commands(config: Config, now_local: datetime,
                     events: list, summary: RunSummary, commands_path: str) -> None:
    """ทำคำสั่งควบคุมเองจากกระดานแอด (สั่งทันที ไม่สนโหมดทดสอบ) แล้วเคลียร์คิว."""
    cmds = load_commands(commands_path)
    if not cmds:
        return
    log.info("🕹️  พบคำสั่งควบคุมเอง %d รายการ", len(cmds))
    tok_by_acc = {a.account_id: a.token for a in config.accounts}
    name_by_acc = {a.account_id: a.name for a in config.accounts}
    clients: dict[str, FacebookClient] = {}
    for c in cmds:
        acc_id = str(c.get("account_id", "")).replace("act_", "")
        cid = c.get("campaign_id")
        cname = c.get("campaign_name") or cid
        action = c.get("action")
        aname = c.get("account_name") or name_by_acc.get(acc_id, acc_id)
        try:
            if acc_id not in clients:
                tok = tok_by_acc.get(acc_id)
                if not tok:
                    raise RuntimeError("ไม่พบ token ของบัญชีนี้ในระบบ")
                clients[acc_id] = FacebookClient(acc_id, tok)
            cl = clients[acc_id]
            if action == "PAUSE":
                cl.update_campaign_status(cid, "PAUSED"); detail = "สั่งปิดเอง"; summary.status_changes += 1
            elif action == "ACTIVATE":
                cl.update_campaign_status(cid, "ACTIVE"); detail = "สั่งเปิดเอง"; summary.status_changes += 1
            elif action == "SET_BUDGET":
                val = float(c.get("value"))
                cl.update_campaign_daily_budget(cid, cl.to_minor(val))
                detail = f"ตั้งงบเอง {val:.0f} บาท"; summary.budget_changes += 1
            else:
                continue
            log.info("      🕹️ %s: %s", cname, detail)
            events.append({"account": aname, "campaign": cname, "rule": "🕹️ สั่งเอง",
                           "action": action, "detail": detail, "status": "applied", "error": None})
        except Exception as e:  # noqa: BLE001
            log.error("      ❌ คำสั่งเองล้มเหลว (%s): %s", cname, e)
            summary.errors += 1
            events.append({"account": aname, "campaign": cname, "rule": "🕹️ สั่งเอง",
                           "action": action, "detail": "สั่งเองไม่สำเร็จ", "status": "error",
                           "error": str(e)[:200]})
    try:
        clear_commands(commands_path)
    except OSError as e:
        log.warning("เคลียร์คิวคำสั่งไม่สำเร็จ: %s", e)


def _finalize(now_local: datetime, dry: bool, total: RunSummary,
              events: list, state: State) -> None:
    """เขียน activity.json + แจ้งเตือน LINE (ใช้ทั้งรอบเต็มและรอบที่ข้าม)."""
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

    try:
        maybe_notify(
            events, now_local, state,
            token=os.environ.get("LINE_TOKEN", ""),
            to=os.environ.get("LINE_TO") or None,
            throttle_mins=float(os.environ.get("LINE_THROTTLE_MINS", "60") or 60),
        )
    except Exception as e:  # noqa: BLE001
        log.warning("แจ้งเตือน LINE ไม่สำเร็จ: %s", e)


def run_once(config: Config, state: State, now_local: datetime, force: bool = False) -> RunSummary:
    """รัน 1 รอบครบทุกบัญชี."""
    total = RunSummary()
    dry = config.settings.dry_run
    name_filter = config.settings.campaign_name_filter
    import re
    name_re = re.compile(name_filter) if name_filter else None
    events: list[dict] = []

    # 1) ทำคำสั่งควบคุมเองก่อนเสมอ (แม้จะข้ามรอบประเมินกฎ)
    commands_path = os.environ.get("COMMANDS_PATH", "commands.json")
    process_commands(config, now_local, events, total, commands_path)

    # 2) เช็คความถี่: ถ้ายังไม่ถึงรอบ (และไม่ได้บังคับ) ข้ามการประเมินกฎ
    interval = config.settings.interval_mins or 10
    if not force and interval > 10:
        last = state.last_applied(LAST_RUN_KEY)
        if last is not None:
            elapsed = (now_local - last).total_seconds() / 60.0
            if elapsed < interval - 1:
                log.info("⏭️  ข้ามรอบประเมินกฎ (ตั้งไว้ทุก %d นาที · ผ่านไป %.0f นาที)", interval, elapsed)
                _finalize(now_local, dry, total, events, state)
                return total
    state.mark_applied(LAST_RUN_KEY, now_local)

    log.info("=" * 64)
    log.info("เริ่มรอบ %s  (เวลาไทย %s)%s",
             now_local.strftime("%Y-%m-%d %H:%M:%S"),
             f"{now_local.hour:02d}:{now_local.minute:02d}",
             "  [DRY-RUN]" if dry else "")
    log.info("=" * 64)

    status_accounts: list[dict] = []
    board_accounts: list[dict] = []

    for account in config.accounts:
        board_campaigns: list[dict] = []
        acct_stat = {
            "name": account.name,
            "account_id": account.account_id,
            "campaigns": 0,
            "active_today": 0,
            "error": None,
            "disabled": not account.enabled,
            "periods": {p: zero_period() for p in PERIOD_PRESETS},
        }
        # ข้ามบัญชีที่ถูกปิดจาก Dashboard
        if not account.enabled:
            log.info("🏦 บัญชี: %s — ⏸️ ปิดอยู่ ข้าม", account.name)
            status_accounts.append(acct_stat)
            board_accounts.append({"name": account.name, "account_id": account.account_id,
                                   "disabled": True, "campaigns": []})
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
            board_accounts.append({"name": account.name, "account_id": account.account_id,
                                   "error": str(e)[:200], "campaigns": []})
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

            budget = client.to_major(campaign["daily_budget"]) if campaign.get("daily_budget") else None
            board_campaigns.append({
                "id": campaign["id"], "name": campaign.get("name", ""),
                "status": (campaign.get("status") or "").upper(),
                "budget": round(budget, 2) if budget is not None else None,
                "spend": round(metrics["spend"], 2), "roas": round(metrics["roas"], 2),
                "orders": int(metrics["purchases"]),
            })

            planned = plan_campaign(account.rules, metrics)
            if planned:
                execute_campaign(
                    client, campaign, planned,
                    state=state, now=now_local, dry_run=dry, summary=total,
                    account_name=account.name, events=events,
                )

        # ---- ข้อมูลย้อนหลังสำหรับหน้าภาพรวม ----
        # วันนี้: ใช้ยอดรวมจากแคมเปญที่คำนวณแล้ว (ตรงกับกระดานแอด)
        today_totals = aggregate_metrics(account_metrics)
        acct_stat["periods"]["today"] = today_totals
        # ช่วงอื่น: ดึงยอดรวมระดับบัญชีของแต่ละช่วงเวลา
        for preset in ("yesterday", "last_3d", "last_7d", "last_30d"):
            try:
                row = client.get_account_totals(preset)
                acct_stat["periods"][preset] = account_totals_from_row(row, account.purchase_action_types)
            except Exception as e:  # noqa: BLE001
                log.warning("  ดึงข้อมูลย้อนหลัง (%s) ไม่ได้: %s", preset, e)
        status_accounts.append(acct_stat)
        board_campaigns.sort(key=lambda c: (c["status"] != "ACTIVE", -c["spend"]))
        board_accounts.append({"name": account.name, "account_id": account.account_id,
                               "campaigns": board_campaigns})

    log.info("-" * 64)
    log.info("สรุป: เปลี่ยนสถานะ %d · ปรับงบ %d · ข้าม(รอบ) %d · error %d%s",
             total.status_changes, total.budget_changes,
             total.skipped_cooldown, total.errors,
             "  [DRY-RUN ไม่ได้แก้จริง]" if dry else "")

    # เขียนไฟล์สรุป + กระดานแอด ให้หน้า Dashboard อ่าน (ไม่ให้พังทั้งรอบถ้าเขียนไม่ได้)
    try:
        write_status(os.environ.get("STATUS_PATH", "status.json"), build_status(
            updated_at=now_local.isoformat(), timezone=config.settings.timezone,
            dry_run=dry, accounts=status_accounts,
        ))
    except Exception as e:  # noqa: BLE001
        log.warning("เขียน status.json ไม่สำเร็จ: %s", e)
    try:
        write_board(os.environ.get("BOARD_PATH", "board.json"),
                    {"updated_at": now_local.isoformat(), "accounts": board_accounts})
    except Exception as e:  # noqa: BLE001
        log.warning("เขียน board.json ไม่สำเร็จ: %s", e)

    _finalize(now_local, dry, total, events, state)
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

    # workflow_dispatch (กดเอง/สั่งทำเดี๋ยวนี้) = บังคับรันเต็มรอบ ไม่สนความถี่
    force = _env_truthy("RUN_FORCE") or args.dry_run or _env_truthy("FB_DRY_RUN")

    def _one_pass() -> RunSummary:
        state = State.load(args.state)
        summary = run_once(config, state, datetime.now(tz), force=force)
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
