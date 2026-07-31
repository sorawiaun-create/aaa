"""ลงมือทำตามแผน (PlannedAction) กับแคมเปญจริง — หรือแค่แสดง log เมื่อ dry-run."""
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
) -> float | None:
    """คำนวณงบใหม่จากกฎงบทั้งหมดตามลำดับ. คืนงบใหม่ (บาท) ถ้าเปลี่ยน ไม่งั้น None."""
    working = current_major
    changed = False

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

        # เพดาน/พื้น
        if pa.max_budget is not None and new > pa.max_budget:
            new = pa.max_budget
        if pa.min_budget is not None and new < pa.min_budget:
            new = pa.min_budget

        if abs(new - working) < _EPS:
            # ไม่มีการเปลี่ยนจริง (เช่น ชนเพดานอยู่แล้ว) — ไม่ mark เพื่อให้ลองใหม่ได้ภายหลัง
            continue

        log.info(
            "      💰 %s [%s]: %.2f -> %.2f บาท (กฎ: %s)",
            unit_label, pa.action, working, new, pa.rule_name,
        )
        working = new
        changed = True
        state.mark_applied(key, now)

    return working if changed else None


def execute_campaign(
    client: FacebookClient,
    campaign: dict[str, Any],
    planned: list[PlannedAction],
    *,
    state: State,
    now: datetime,
    dry_run: bool,
    summary: RunSummary,
) -> None:
    """ประมวลผลแผนของแคมเปญเดียว แล้วสั่ง API (หรือ log ถ้า dry-run)."""
    cid = campaign["id"]
    cname = campaign.get("name", cid)
    account_id = client.account_id

    if not planned:
        return

    log.info("  ▶ %s (%s)", cname, cid)

    # ---- 1) สถานะ (กฎท้ายสุดชนะ) ----
    status_actions = [p for p in planned if p.kind == "STATUS"]
    if status_actions:
        final = status_actions[-1]
        current = (campaign.get("status") or "").upper()
        if final.status != current:
            log.info("      🔀 สถานะ: %s -> %s (กฎ: %s)", current or "?", final.status, final.rule_name)
            if not dry_run:
                try:
                    client.update_campaign_status(cid, final.status)
                    summary.status_changes += 1
                except Exception as e:  # noqa: BLE001
                    log.error("      ❌ เปลี่ยนสถานะไม่สำเร็จ: %s", e)
                    summary.errors += 1
            else:
                summary.status_changes += 1
        else:
            log.debug("      สถานะเป็น %s อยู่แล้ว — ไม่เปลี่ยน", current)

    # ---- 2) งบประมาณ ----
    budget_actions = [p for p in planned if p.kind == "BUDGET"]
    if not budget_actions:
        return

    daily_budget_minor = campaign.get("daily_budget")
    if daily_budget_minor:
        # CBO: งบอยู่ที่แคมเปญ
        current_major = client.to_major(daily_budget_minor)
        new_major = _apply_budget_sequence(
            current_major, budget_actions,
            state=state, now=now, account_id=account_id,
            unit_id=cid, unit_label="แคมเปญ", summary=summary,
        )
        if new_major is not None and not dry_run:
            try:
                client.update_campaign_daily_budget(cid, client.to_minor(new_major))
                summary.budget_changes += 1
            except Exception as e:  # noqa: BLE001
                log.error("      ❌ ปรับงบแคมเปญไม่สำเร็จ: %s", e)
                summary.errors += 1
        elif new_major is not None:
            summary.budget_changes += 1
    else:
        # ABO: งบอยู่ที่ ad set — ปรับทีละ set
        try:
            adsets = client.get_campaign_adsets(cid)
        except Exception as e:  # noqa: BLE001
            log.error("      ❌ ดึง ad set ไม่ได้: %s", e)
            summary.errors += 1
            return

        adsets_with_budget = [a for a in adsets if a.get("daily_budget")]
        if not adsets_with_budget:
            log.info("      ⚠️  แคมเปญนี้ไม่มี daily_budget ทั้งระดับแคมเปญและ ad set — ข้ามการปรับงบ")
            return

        for adset in adsets_with_budget:
            aid = adset["id"]
            aname = adset.get("name", aid)
            current_major = client.to_major(adset["daily_budget"])
            new_major = _apply_budget_sequence(
                current_major, budget_actions,
                state=state, now=now, account_id=account_id,
                unit_id=aid, unit_label=f"ad set '{aname}'", summary=summary,
            )
            if new_major is not None and not dry_run:
                try:
                    client.update_adset_daily_budget(aid, client.to_minor(new_major))
                    summary.budget_changes += 1
                except Exception as e:  # noqa: BLE001
                    log.error("      ❌ ปรับงบ ad set ไม่สำเร็จ: %s", e)
                    summary.errors += 1
            elif new_major is not None:
                summary.budget_changes += 1
