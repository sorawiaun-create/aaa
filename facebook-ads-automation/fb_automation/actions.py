"""ลงมือทำตามแผน (PlannedAction) กับแคมเปญจริง — หรือแค่แสดง log เมื่อ dry-run.

นอกจากทำงานแล้ว ยังบันทึก "เหตุการณ์" (events) ทุกครั้งที่มีการเปลี่ยนแปลง
เพื่อให้หน้า Dashboard โชว์ log ได้ว่ากฎไหนทำงาน ทำอะไร สำเร็จหรือพลาด.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING, Any

from .rules import PlannedAction
from .state import State

if TYPE_CHECKING:  # ไม่ import SDK ตอน runtime -> เทส logic ได้โดยไม่ต้องติดตั้ง facebook_business
    from .fb_client import FacebookClient

log = logging.getLogger("fb_automation")

_EPS = 0.005  # ต่ำกว่านี้ถือว่างบเท่าเดิม


@dataclass
class RunSummary:
    status_changes: int = 0
    budget_changes: int = 0
    skipped_cooldown: int = 0
    errors: int = 0


def _th_status(s: str | None) -> str:
    return {"ACTIVE": "เปิด", "PAUSED": "ปิด"}.get((s or "").upper(), s or "?")


def _apply_budget_sequence(
    current_major: float,
    budget_actions: list[PlannedAction],
    *,
    state: State,
    now: datetime,
    account_id: str,
    unit_id: str,
    unit_label: str,
    summary: RunSummary,
) -> tuple[float | None, list[dict[str, str]]]:
    """คำนวณงบใหม่จากกฎงบทั้งหมด. คืน (งบใหม่หรือ None, รายการกฎที่ทำให้เปลี่ยน)."""
    working = current_major
    changed = False
    applied: list[dict[str, str]] = []

    for pa in budget_actions:
        key = pa.state_key(account_id, unit_id)
        if not state.can_apply(key, pa.frequency_mins, now):
            log.info("      ⏭️  %s: ยังไม่ถึงรอบ (ทุก %s นาที) — ข้าม", pa.rule_name, pa.frequency_mins)
            summary.skipped_cooldown += 1
            continue

        base = working if working > 0 else 0.0
        if pa.budget_op == "increase":
            new = base * (1 + (pa.percent or 0) / 100.0)
        elif pa.budget_op == "decrease":
            new = base * (1 - (pa.percent or 0) / 100.0)
        elif pa.budget_op == "reset":
            new = pa.reset_amount if pa.reset_amount is not None else base
        else:
            continue

        if pa.max_budget is not None and new > pa.max_budget:
            new = pa.max_budget
        if pa.min_budget is not None and new < pa.min_budget:
            new = pa.min_budget

        if abs(new - working) < _EPS:
            continue

        log.info("      💰 %s [%s]: %.2f -> %.2f บาท (กฎ: %s)",
                 unit_label, pa.action, working, new, pa.rule_name)
        working = new
        changed = True
        applied.append({"rule": pa.rule_name, "action": pa.action, "reason": pa.reason})
        state.mark_applied(key, now)

    return (working if changed else None), applied


def execute_campaign(
    client: FacebookClient,
    campaign: dict[str, Any],
    planned: list[PlannedAction],
    *,
    state: State,
    now: datetime,
    dry_run: bool,
    summary: RunSummary,
    account_name: str = "",
    events: list[dict[str, Any]] | None = None,
) -> None:
    """ประมวลผลแผนของแคมเปญเดียว แล้วสั่ง API (หรือ log ถ้า dry-run)."""
    cid = campaign["id"]
    cname = campaign.get("name", cid)
    account_id = client.account_id
    evs = events if events is not None else []

    if not planned:
        return

    log.info("  ▶ %s (%s)", cname, cid)

    def _event(rule, action, detail, ok, err=None, reason=""):
        evs.append({
            "account": account_name, "campaign": cname, "rule": rule,
            "action": action, "detail": detail, "reason": reason,
            "status": "error" if err else ("dry-run" if dry_run else "applied"),
            "error": err,
        })

    # ---- 1) สถานะ ----
    # PAUSE ชนะ ACTIVATE เสมอ (fail-safe กันเงินรั่ว): ถ้ามีกฎ "ปิด" เข้าเงื่อนไข
    # ให้ปิดก่อน แม้จะมีกฎ "เปิด" เข้าเงื่อนไขพร้อมกันและอยู่ล่างกว่า.
    status_actions = [p for p in planned if p.kind == "STATUS"]
    if status_actions:
        pauses = [p for p in status_actions if p.status == "PAUSED"]
        final = pauses[-1] if pauses else status_actions[-1]
        current = (campaign.get("status") or "").upper()
        if final.status != current:
            detail = f"{_th_status(current)} → {_th_status(final.status)}"
            log.info("      🔀 สถานะ: %s (กฎ: %s)", detail, final.rule_name)
            if not dry_run:
                try:
                    client.update_campaign_status(cid, final.status)
                    summary.status_changes += 1
                    _event(final.rule_name, final.action, detail, ok=True, reason=final.reason)
                except Exception as e:  # noqa: BLE001
                    log.error("      ❌ เปลี่ยนสถานะไม่สำเร็จ: %s", e)
                    summary.errors += 1
                    _event(final.rule_name, final.action, detail, ok=False, err=str(e)[:200], reason=final.reason)
            else:
                summary.status_changes += 1
                _event(final.rule_name, final.action, detail, ok=True, reason=final.reason)

    # ---- 2) งบประมาณ ----
    budget_actions = [p for p in planned if p.kind == "BUDGET"]
    if not budget_actions:
        return

    def _apply_budget(unit_id, unit_label, current_major, setter, disp):
        new_major, applied = _apply_budget_sequence(
            current_major, budget_actions,
            state=state, now=now, account_id=account_id,
            unit_id=unit_id, unit_label=unit_label, summary=summary,
        )
        if new_major is None:
            return
        rule = ", ".join(a["rule"] for a in applied)
        action = applied[-1]["action"] if applied else "BUDGET"
        reason = " · ".join(a["reason"] for a in applied if a.get("reason"))
        detail = f"{disp}งบ {current_major:.0f} → {new_major:.0f} บาท"
        if not dry_run:
            try:
                setter(client.to_minor(new_major))
                summary.budget_changes += 1
                _event(rule, action, detail, ok=True, reason=reason)
            except Exception as e:  # noqa: BLE001
                log.error("      ❌ ปรับงบไม่สำเร็จ: %s", e)
                summary.errors += 1
                _event(rule, action, detail, ok=False, err=str(e)[:200], reason=reason)
        else:
            summary.budget_changes += 1
            _event(rule, action, detail, ok=True, reason=reason)

    daily_budget_minor = campaign.get("daily_budget")
    if daily_budget_minor:
        _apply_budget(cid, "แคมเปญ", client.to_major(daily_budget_minor),
                      lambda m: client.update_campaign_daily_budget(cid, m), "")
    else:
        # ABO: งบอยู่ที่ ad set — ปรับทีละ set
        try:
            adsets = client.get_campaign_adsets(cid)
        except Exception as e:  # noqa: BLE001
            log.error("      ❌ ดึง ad set ไม่ได้: %s", e)
            summary.errors += 1
            _event("-", "BUDGET", "ดึง ad set ไม่ได้", ok=False, err=str(e)[:200])
            return

        adsets_with_budget = [a for a in adsets if a.get("daily_budget")]
        if not adsets_with_budget:
            log.info("      ⚠️  แคมเปญนี้ไม่มี daily_budget ทั้งระดับแคมเปญและ ad set — ข้ามการปรับงบ")
            return

        for adset in adsets_with_budget:
            aid = adset["id"]
            aname = adset.get("name", aid)
            _apply_budget(aid, f"ad set '{aname}'", client.to_major(adset["daily_budget"]),
                          lambda m, _id=aid: client.update_adset_daily_budget(_id, m),
                          f"[{aname}] ")
