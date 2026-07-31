"""ทดสอบ commands (คำสั่งเอง) + interval + board — offline (mock FB client)."""
import json, os, sys, tempfile, unittest
from datetime import datetime, timezone
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fb_automation.commands import load_commands, clear_commands
from fb_automation.config import Config, Settings, Account
from fb_automation.actions import RunSummary
import main as M

NOW = datetime(2026, 7, 31, 22, 0, tzinfo=timezone.utc)
_CALLS = []


class FakeClient:
    def __init__(self, acc_id, token): pass
    def update_campaign_status(self, cid, st): _CALLS.append(("status", cid, st))
    def to_minor(self, v): return int(round(v * 100))
    def update_campaign_daily_budget(self, cid, m): _CALLS.append(("budget", cid, m))


class TestCommands(unittest.TestCase):
    def test_load_clear(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "commands.json")
            self.assertEqual(load_commands(p), [])          # ไม่มีไฟล์
            json.dump({"commands": [{"action": "PAUSE"}]}, open(p, "w"))
            self.assertEqual(len(load_commands(p)), 1)
            clear_commands(p)
            self.assertEqual(load_commands(p), [])

    def test_process_commands_applies_and_clears(self):
        _CALLS.clear()
        orig = M.FacebookClient
        M.FacebookClient = FakeClient
        try:
            cfg = Config(accounts=[Account(name="A", account_id="123", token="x",
                                           target_level="campaign", rules=[])],
                         settings=Settings())
            with tempfile.TemporaryDirectory() as d:
                p = os.path.join(d, "commands.json")
                json.dump({"commands": [
                    {"account_id": "123", "campaign_id": "c1", "campaign_name": "Camp1", "action": "PAUSE"},
                    {"account_id": "123", "campaign_id": "c2", "action": "SET_BUDGET", "value": 300},
                ]}, open(p, "w"))
                events, summ = [], RunSummary()
                M.process_commands(cfg, NOW, events, summ, p)
                self.assertIn(("status", "c1", "PAUSED"), _CALLS)
                self.assertIn(("budget", "c2", 30000), _CALLS)     # 300 บาท -> 30000
                self.assertEqual(len(events), 2)
                self.assertTrue(all(e["status"] == "applied" for e in events))
                self.assertEqual(load_commands(p), [])             # เคลียร์แล้ว
        finally:
            M.FacebookClient = orig


class TestInterval(unittest.TestCase):
    def test_interval_min_10(self):
        from fb_automation.config import load_config
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "cfg.json")
            json.dump({"settings": {"interval_mins": 30}, "accounts":
                       [{"name": "A", "account_id": "1", "token": "x", "rules": []}]}, open(p, "w"))
            self.assertEqual(load_config(p).settings.interval_mins, 30)
            json.dump({"settings": {"interval_mins": 3}, "accounts":
                       [{"name": "A", "account_id": "1", "token": "x", "rules": []}]}, open(p, "w"))
            self.assertEqual(load_config(p).settings.interval_mins, 10)   # ต่ำสุด 10


if __name__ == "__main__":
    unittest.main(verbosity=2)
