"""หน้าต่างโปรแกรม (Dashboard) แบบมีปุ่มกด — ไม่ต้องพิมพ์คำสั่ง

ดับเบิลคลิก START.bat หรือ PuzzleAlert.exe เพื่อเปิด
"""

import json
import os
import queue
import sys
import threading

import tkinter as tk
from tkinter import filedialog, messagebox, scrolledtext, ttk

import puzzle_alert as pa

CONFIG_NAME = "config.json"
EXAMPLE_NAME = "config.example.json"

FONT = ("Tahoma", 10)
FONT_BOLD = ("Tahoma", 11, "bold")
FONT_TITLE = ("Tahoma", 15, "bold")


def app_dir():
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


def resource_path(name):
    base = getattr(sys, "_MEIPASS", app_dir())
    return os.path.join(base, name)


class App:
    def __init__(self, root):
        self.root = root
        os.chdir(app_dir())
        self.cfg_path = os.path.join(app_dir(), CONFIG_NAME)
        self._ensure_config()

        self.log_queue = queue.Queue()
        self.worker = None
        self.stop_event = None

        root.title("TikTok Live Puzzle Alert")
        root.geometry("640x680")
        root.minsize(560, 600)

        self._build_ui()
        self.refresh_status()
        self.refresh_windows()
        self.root.after(200, self._drain_log)
        self.log("พร้อมใช้งาน — ตั้งค่าช่องทางแจ้งเตือน แล้วแนบรูปจิ๊กซอว์ ก่อนกดเริ่ม")

    # ---------- config ----------
    def _ensure_config(self):
        if not os.path.exists(self.cfg_path):
            src = resource_path(EXAMPLE_NAME)
            if os.path.exists(src):
                with open(src, encoding="utf-8") as f:
                    data = f.read()
                with open(self.cfg_path, "w", encoding="utf-8") as f:
                    f.write(data)

    def load_cfg(self):
        with open(self.cfg_path, encoding="utf-8") as f:
            return json.load(f)

    def save_cfg(self, cfg):
        with open(self.cfg_path, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)

    # ---------- UI ----------
    def _build_ui(self):
        tk.Label(self.root, text="🧩 TikTok Live Puzzle Alert", font=FONT_TITLE).pack(pady=(12, 2))
        tk.Label(self.root, text="เตือนเมื่อจิ๊กซอว์ยืนยันตัวตนเด้ง — คุณต่อเอง ไม่พลาดจังหวะ",
                 font=("Tahoma", 9), fg="#666").pack()

        # 1) ช่องทางแจ้งเตือน
        f1 = ttk.LabelFrame(self.root, text=" 1. ช่องทางแจ้งเตือน ")
        f1.pack(fill="x", padx=14, pady=8)
        self.lbl_channel = tk.Label(f1, text="", font=FONT, anchor="w", justify="left")
        self.lbl_channel.pack(fill="x", padx=10, pady=(8, 4))
        row1 = tk.Frame(f1)
        row1.pack(fill="x", padx=10, pady=(0, 10))
        ttk.Button(row1, text="ตั้งค่า LINE", command=self.setup_line).pack(side="left")
        ttk.Button(row1, text="ตั้งค่า Telegram", command=self.setup_telegram).pack(side="left", padx=6)
        ttk.Button(row1, text="🔔 ทดสอบแจ้งเตือน", command=self.test_alert).pack(side="left")

        # 2) หน้าต่างที่จับ
        f2 = ttk.LabelFrame(self.root, text=" 2. หน้าต่างที่จะจับภาพ (ไม่ต้องเปิดค้างหน้าจอ) ")
        f2.pack(fill="x", padx=14, pady=8)
        row2 = tk.Frame(f2)
        row2.pack(fill="x", padx=10, pady=10)
        self.cmb_window = ttk.Combobox(row2, font=FONT, state="readonly")
        self.cmb_window.pack(side="left", fill="x", expand=True)
        ttk.Button(row2, text="↻", width=3, command=self.refresh_windows).pack(side="left", padx=4)
        ttk.Button(row2, text="ใช้หน้าต่างนี้", command=self.apply_window).pack(side="left")

        # 3) รูปจิ๊กซอว์
        f3 = ttk.LabelFrame(self.root, text=" 3. รูปจิ๊กซอว์ที่ให้โปรแกรมจำ ")
        f3.pack(fill="x", padx=14, pady=8)
        self.lbl_template = tk.Label(f3, text="", font=FONT, anchor="w")
        self.lbl_template.pack(fill="x", padx=10, pady=(8, 4))
        ttk.Button(f3, text="📎 แนบรูปจิ๊กซอว์...", command=self.add_template).pack(anchor="w", padx=10, pady=(0, 10))

        # 4) เริ่ม/หยุด
        f4 = tk.Frame(self.root)
        f4.pack(fill="x", padx=14, pady=6)
        self.lbl_state = tk.Label(f4, text="⚪ หยุดอยู่", font=FONT_BOLD)
        self.lbl_state.pack(side="left")
        self.btn_watch = tk.Button(f4, text="▶  เริ่มเฝ้าดู", font=FONT_BOLD,
                                   bg="#22a06b", fg="white", width=16,
                                   command=self.toggle_watch)
        self.btn_watch.pack(side="right")

        # log
        tk.Label(self.root, text="สถานะ / ประวัติ:", font=("Tahoma", 9), fg="#666").pack(anchor="w", padx=16)
        self.txt_log = scrolledtext.ScrolledText(self.root, height=9, font=("Consolas", 9),
                                                 state="disabled", bg="#111", fg="#ddd")
        self.txt_log.pack(fill="both", expand=True, padx=14, pady=(0, 12))

    # ---------- status ----------
    def refresh_status(self):
        cfg = self.load_cfg()
        parts = []
        lc = cfg.get("line", {})
        tok = lc.get("channel_access_token", "")
        parts.append("LINE ✅" if (tok and not tok.startswith("ใส่ ")) else "LINE ⚪")
        tg = cfg.get("telegram", {})
        parts.append("Telegram ✅" if (tg.get("bot_token") and tg.get("chat_id")) else "Telegram ⚪")
        self.lbl_channel.config(text="   ".join(parts))

        import calibrate
        n = len(calibrate.list_templates())
        wt = cfg.get("detection", {}).get("window_title", "")
        wtext = f"จับหน้าต่าง: {wt[:40]}" if wt else "จับทั้งจอ (ค่าเริ่มต้น)"
        color = "#22a06b" if n else "#c1121f"
        self.lbl_template.config(text=f"มีรูปจิ๊กซอว์ {n} แบบ    |    {wtext}", fg=color)

    # ---------- channels ----------
    def setup_line(self):
        from tkinter import simpledialog
        token = simpledialog.askstring(
            "ตั้งค่า LINE",
            "วาง Channel access token ของ LINE:\n(ดูวิธีสร้างใน README)",
            parent=self.root)
        if not token:
            return
        cfg = self.load_cfg()
        cfg.setdefault("line", {})["channel_access_token"] = token.strip()
        self.save_cfg(cfg)
        self.refresh_status()
        self.log("✅ บันทึก LINE token แล้ว")

    def setup_telegram(self):
        from tkinter import simpledialog
        token = simpledialog.askstring(
            "ตั้งค่า Telegram (1/2)",
            "วาง bot token จาก @BotFather:",
            parent=self.root)
        if not token:
            return
        token = token.strip()
        messagebox.showinfo(
            "ทักบอทก่อน",
            "เปิดแชทกับบอทของคุณในแอป Telegram\nพิมพ์อะไรก็ได้ทักไป 1 ครั้ง\nแล้วกด OK",
            parent=self.root)
        chat_id = ""
        try:
            import telegram_client
            chat_id = telegram_client.autodetect_chat_id(token) or ""
        except Exception as e:
            self.log(f"หา chat id อัตโนมัติไม่ได้: {e}")
        if not chat_id:
            chat_id = simpledialog.askstring(
                "ตั้งค่า Telegram (2/2)",
                "หา chat id อัตโนมัติไม่เจอ\nใส่ chat id เอง (ดูวิธีใน README):",
                parent=self.root) or ""
            chat_id = chat_id.strip()
        if not chat_id:
            self.log("⚠️ ยังไม่มี chat id — ลองทักบอทก่อนแล้วตั้งใหม่")
            return
        cfg = self.load_cfg()
        cfg.setdefault("telegram", {})
        cfg["telegram"]["bot_token"] = token
        cfg["telegram"]["chat_id"] = chat_id
        self.save_cfg(cfg)
        self.refresh_status()
        self.log(f"✅ บันทึก Telegram แล้ว (chat id: {chat_id})")

    def test_alert(self):
        self.log("กำลังทดสอบ...")
        threading.Thread(target=self._test_worker, daemon=True).start()

    def _test_worker(self):
        try:
            pa.test_line(self.load_cfg())
            self.log("ส่งทดสอบแล้ว — เช็กมือถือว่าเด้งไหม")
        except Exception as e:
            self.log(f"ทดสอบล้มเหลว: {e}")

    # ---------- window ----------
    def refresh_windows(self):
        self._windows = []
        try:
            import window_capture
            self._windows = window_capture.list_windows()
        except Exception as e:
            self.cmb_window["values"] = ["(ใช้ได้เฉพาะ Windows)"]
            self.cmb_window.current(0)
            return
        titles = ["(จับทั้งจอ — ค่าเริ่มต้น)"] + [t for _h, t in self._windows]
        self.cmb_window["values"] = titles
        # เลือกให้ตรงกับที่ตั้งไว้
        cur = self.load_cfg().get("detection", {}).get("window_title", "")
        idx = 0
        for i, (_h, t) in enumerate(self._windows, 1):
            if t == cur:
                idx = i
                break
        self.cmb_window.current(idx)

    def apply_window(self):
        sel = self.cmb_window.current()
        cfg = self.load_cfg()
        cfg.setdefault("detection", {})
        if sel <= 0:
            cfg["detection"]["window_title"] = ""
            self.log("ตั้งเป็น: จับทั้งจอ")
        else:
            title = self._windows[sel - 1][1]
            cfg["detection"]["window_title"] = title
            self.log(f"ตั้งเป็น: จับหน้าต่าง '{title[:40]}' (ย่อ/บังได้แล้ว)")
        self.save_cfg(cfg)
        self.refresh_status()

    # ---------- template ----------
    def add_template(self):
        path = filedialog.askopenfilename(
            title="เลือกไฟล์ภาพหน้าจอที่มีจิ๊กซอว์",
            filetypes=[("รูปภาพ", "*.png *.jpg *.jpeg"), ("ทั้งหมด", "*.*")])
        if not path:
            return
        self.log("เปิดหน้าต่างเลือกพื้นที่... ลากกรอบรอบ 'ข้อความที่เหมือนเดิมทุกครั้ง' แล้วกด Enter")
        import calibrate
        try:
            saved = calibrate.calibrate_from_image(path)
        except Exception as e:
            self.log(f"เพิ่มรูปไม่สำเร็จ: {e}")
            return
        if saved:
            cfg = self.load_cfg()
            cfg.setdefault("detection", {})["templates"] = calibrate.list_templates()
            self.save_cfg(cfg)
            self.refresh_status()
            self.log(f"✅ เพิ่มรูปจิ๊กซอว์แล้ว (รวม {len(calibrate.list_templates())} แบบ)")
        else:
            self.log("ยกเลิกการเพิ่มรูป")

    # ---------- watch ----------
    def toggle_watch(self):
        if self.worker and self.worker.is_alive():
            self.stop_event.set()
            self.btn_watch.config(text="▶  เริ่มเฝ้าดู", bg="#22a06b")
            self.lbl_state.config(text="⚪ หยุดอยู่")
            return
        cfg = self.load_cfg()
        import calibrate
        if not calibrate.list_templates():
            messagebox.showwarning("ยังไม่มีรูปจิ๊กซอว์",
                                   "กด '📎 แนบรูปจิ๊กซอว์...' เพิ่มรูปก่อนเริ่มนะครับ",
                                   parent=self.root)
            return
        if not pa.build_channels(cfg):
            messagebox.showwarning("ยังไม่ได้ตั้งช่องทาง",
                                   "ตั้งค่า LINE หรือ Telegram ก่อนเริ่มนะครับ",
                                   parent=self.root)
            return
        self.stop_event = threading.Event()
        self.worker = threading.Thread(target=self._watch_worker, args=(cfg,), daemon=True)
        self.worker.start()
        self.btn_watch.config(text="■  หยุด", bg="#c1121f")
        self.lbl_state.config(text="🟢 กำลังเฝ้าดู")

    def _watch_worker(self, cfg):
        try:
            pa.run_watch(cfg, stop_event=self.stop_event, log=self.log)
        except Exception as e:
            self.log(f"เกิดข้อผิดพลาด: {e}")
        # กลับสภาพปุ่มเมื่อ loop จบ
        self.root.after(0, lambda: (
            self.btn_watch.config(text="▶  เริ่มเฝ้าดู", bg="#22a06b"),
            self.lbl_state.config(text="⚪ หยุดอยู่"),
        ))

    # ---------- log ----------
    def log(self, msg):
        self.log_queue.put(str(msg))

    def _drain_log(self):
        try:
            while True:
                msg = self.log_queue.get_nowait()
                self.txt_log.config(state="normal")
                self.txt_log.insert("end", msg + "\n")
                self.txt_log.see("end")
                self.txt_log.config(state="disabled")
        except queue.Empty:
            pass
        self.root.after(200, self._drain_log)


def main():
    root = tk.Tk()
    try:
        App(root)
    except Exception as e:
        messagebox.showerror("เปิดโปรแกรมไม่สำเร็จ", str(e))
        raise
    root.mainloop()


if __name__ == "__main__":
    main()
