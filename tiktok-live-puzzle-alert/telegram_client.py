"""ส่งแจ้งเตือนผ่าน Telegram Bot (เด้งเตือนชัวร์กว่า LINE และตั้งง่าย)

ต้องมี:
  - bot_token : ได้จากการทักหา @BotFather ในแอป Telegram แล้วสร้างบอท
  - chat_id   : รหัสห้องแชทของคุณ (โปรแกรมช่วยหาให้อัตโนมัติได้)
"""

import requests


class TelegramClient:
    def __init__(self, bot_token, chat_id):
        self.base = f"https://api.telegram.org/bot{bot_token}"
        self.chat_id = str(chat_id)

    def send(self, text):
        r = requests.post(
            f"{self.base}/sendMessage",
            data={"chat_id": self.chat_id, "text": text},
            timeout=15,
        )
        if not r.ok:
            raise RuntimeError(f"Telegram ส่งไม่สำเร็จ (HTTP {r.status_code}): {r.text[:200]}")

    def send_photo(self, path, caption=""):
        with open(path, "rb") as f:
            r = requests.post(
                f"{self.base}/sendPhoto",
                data={"chat_id": self.chat_id, "caption": caption[:1000]},
                files={"photo": f},
                timeout=30,
            )
        if not r.ok:
            raise RuntimeError(f"Telegram ส่งรูปไม่สำเร็จ (HTTP {r.status_code}): {r.text[:200]}")

    def notify(self, text, image_path=None, attach=True):
        """ส่งแจ้งเตือน (แนบรูปได้โดยตรง ไม่ต้องอัปขึ้นเว็บอื่น)"""
        if image_path and attach:
            self.send_photo(image_path, caption=text)
        else:
            self.send(text)


def autodetect_chat_id(bot_token):
    """หา chat_id อัตโนมัติจากข้อความล่าสุดที่ทักบอท (คืน None ถ้ายังไม่มี)"""
    r = requests.get(f"https://api.telegram.org/bot{bot_token}/getUpdates", timeout=15)
    data = r.json()
    if not data.get("ok"):
        raise RuntimeError(f"bot_token อาจไม่ถูกต้อง: {data}")
    for upd in reversed(data.get("result", [])):
        msg = upd.get("message") or upd.get("edited_message")
        if msg and msg.get("chat", {}).get("id") is not None:
            return str(msg["chat"]["id"])
    return None
