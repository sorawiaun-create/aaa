"""Facebook Ads multi-account automation engine.

โมดูลนี้อ่านไฟล์ config (บัญชี + กฎ) แล้ว:
  1. ดึงสถิติแคมเปญวันนี้จาก Facebook Ads API
  2. ประเมินเงื่อนไขของแต่ละกฎ
  3. สั่ง PAUSE / ACTIVATE / เพิ่มงบ / รีเซ็ตงบ ตามผลลัพธ์
"""

__version__ = "1.0.0"
