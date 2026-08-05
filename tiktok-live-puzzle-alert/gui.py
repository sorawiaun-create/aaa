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
        row3 = tk.Frame(f3)
        row3.pack(fill="x", padx=10, pady=(0, 2))
        ttk.Button(row3, text="📎 แนบรูปจิ๊กซอว์...", command=self.add_template).pack(side="left")
        ttk.Button(row3, text="🗑️ ล้างรูปทั้งหมด", command=self.clear_templates).pack(side="left", padx=6)
        ttk.Button(row3, text="🔎 ทดสอบตรวจจับ", command=self.test_detect).pack(side="left")
        ttk.Button(row3, text="📷 ดูภาพที่จับได้", command=self.preview_capture).pack(side="left", padx=6)
        row3b = tk.Frame(f3)
        row3b.pack(fill="x", padx=10, pady=(0, 10))
        tk.Label(row3b, text="ความไว (threshold):", font=FONT).pack(side="left", padx=(0, 2))
        thr0 = str(self.load_cfg().get("detection", {}).get("threshold", 0.75))
        self.var_thr = tk.StringVar(value=thr0)
        ttk.Spinbox(row3b, from_=0.40, to=0.95, increment=0.05, width=5,
                    textvariable=self.var_thr, command=self.save_threshold).pack(side="left")

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
    def ask_text(self, title, prompt):
        """ช่องกรอกที่ 'วางได้' — มีปุ่มวาง + Ctrl+V + คลิกขวาวาง (คืน str หรือ None)"""
        dlg = tk.Toplevel(self.root)
        dlg.title(title)
        dlg.transient(self.root)
        dlg.grab_set()
        dlg.resizable(False, False)
        tk.Label(dlg, text=prompt, font=FONT, justify="left", wraplength=440
                 ).pack(padx=16, pady=(16, 8), anchor="w")
        ent = tk.Entry(dlg, font=FONT, width=54)
        ent.pack(padx=16, fill="x")
        ent.focus_set()

        def do_paste():
            try:
                ent.insert("insert", dlg.clipboard_get())
            except Exception:
                pass

        # Ctrl+V (รองรับทั้งเลย์เอาต์ไทย/อังกฤษ) + คลิกขวาวาง
        ent.bind("<Control-v>", lambda e: (do_paste(), "break")[1])
        ent.bind("<Control-V>", lambda e: (do_paste(), "break")[1])
        menu = tk.Menu(dlg, tearoff=0)
        menu.add_command(label="วาง (Paste)", command=do_paste)
        ent.bind("<Button-3>", lambda e: menu.tk_popup(e.x_root, e.y_root))

        result = {"val": None}

        def ok():
            result["val"] = ent.get().strip()
            dlg.destroy()

        ttk.Button(dlg, text="📋 วางจากคลิปบอร์ด", command=do_paste
                   ).pack(padx=16, pady=(10, 4), anchor="w")
        btns = tk.Frame(dlg)
        btns.pack(pady=(4, 14))
        ttk.Button(btns, text="ตกลง", command=ok).pack(side="left", padx=6)
        ttk.Button(btns, text="ยกเลิก", command=dlg.destroy).pack(side="left", padx=6)
        ent.bind("<Return>", lambda e: ok())
        dlg.wait_window()
        return result["val"] or None

    def setup_line(self):
        token = self.ask_text(
            "ตั้งค่า LINE",
            "วาง Channel access token ของ LINE (กดปุ่ม '📋 วางจากคลิปบอร์ด' ได้):")
        if not token:
            return
        cfg = self.load_cfg()
        cfg.setdefault("line", {})["channel_access_token"] = token
        self.save_cfg(cfg)
        self.refresh_status()
        self.log("✅ บันทึก LINE token แล้ว")

    def setup_telegram(self):
        token = self.ask_text(
            "ตั้งค่า Telegram (1/2)",
            "วาง bot token จาก @BotFather (กดปุ่ม '📋 วางจากคลิปบอร์ด' ได้):")
        if not token:
            return
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
            chat_id = self.ask_text(
                "ตั้งค่า Telegram (2/2)",
                "หา chat id อัตโนมัติไม่เจอ ใส่ chat id เอง (ดูวิธีใน README):") or ""
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

    def clear_templates(self):
        """ลบรูปจิ๊กซอว์ทั้งหมด เริ่มใหม่"""
        import calibrate
        files = calibrate.list_templates()
        if not files:
            self.log("ไม่มีรูปให้ลบ")
            return
        if not messagebox.askyesno(
                "ล้างรูปทั้งหมด",
                f"ลบรูปจิ๊กซอว์ทั้งหมด {len(files)} รูป?\n(แล้วค่อยแนบใหม่ได้เลย)",
                parent=self.root):
            return
        removed = 0
        for p in files:
            try:
                os.remove(p)
                removed += 1
            except Exception:
                pass
        cfg = self.load_cfg()
        cfg.setdefault("detection", {})["templates"] = []
        self.save_cfg(cfg)
        self.refresh_status()
        self.log(f"🗑️ ลบรูปแล้ว {removed} รูป — เริ่มแนบใหม่ได้เลย")

    # ---------- test / tune ----------
    def save_threshold(self):
        try:
            thr = float(self.var_thr.get())
        except (ValueError, tk.TclError):
            return
        cfg = self.load_cfg()
        cfg.setdefault("detection", {})["threshold"] = thr
        self.save_cfg(cfg)
        self.log(f"ตั้งความไว (threshold) = {thr:.2f}")

    def test_detect(self):
        """ทดสอบตรวจจับกับรูปที่แคปไว้ — ไม่ต้องรอจิ๊กซอว์จริง"""
        import calibrate
        if not calibrate.list_templates():
            messagebox.showwarning("ยังไม่มีรูปจิ๊กซอว์",
                                   "กด '📎 แนบรูปจิ๊กซอว์...' ก่อนนะครับ", parent=self.root)
            return
        path = filedialog.askopenfilename(
            title="เลือกรูปหน้าจอที่มีจิ๊กซอว์ (เอาไว้ทดสอบว่าตรวจเจอไหม)",
            filetypes=[("รูปภาพ", "*.png *.jpg *.jpeg"), ("ทั้งหมด", "*.*")])
        if not path:
            return
        from detector import PuzzleDetector
        cfg = self.load_cfg()
        thr = float(cfg.get("detection", {}).get("threshold", 0.75))
        try:
            det = PuzzleDetector(calibrate.list_templates(), thr)
            score, scale = det.score_of_image(path)
        except Exception as e:
            self.log(f"ทดสอบไม่สำเร็จ: {e}")
            return
        ok = score >= thr
        self.log(f"🔎 ผลทดสอบ: คะแนน = {score:.2f} (ขนาด {scale:.2f}x) | threshold {thr:.2f} "
                 f"-> {'✅ ตรวจเจอ' if ok else '❌ ไม่เจอ'}")
        if ok:
            messagebox.showinfo("ผ่าน! ✅",
                                f"ตรวจเจอ! คะแนน {score:.2f}\nพร้อมใช้งานจริงได้เลย 🎉",
                                parent=self.root)
        elif score >= 0.45:
            sug = max(0.4, round(score - 0.05, 2))
            if messagebox.askyesno(
                    "ปรับความไวไหม?",
                    f"คะแนน {score:.2f} ต่ำกว่าความไว {thr:.2f} เลยไม่เจอ\n\n"
                    f"จะลดความไวเป็น {sug:.2f} ให้ตรวจเจอไหม?\n"
                    f"(ถ้าต่ำเกินไปอาจเตือนผิดพลาดบ้าง)", parent=self.root):
                self.var_thr.set(f"{sug:.2f}")
                self.save_threshold()
                messagebox.showinfo("ปรับแล้ว", "ลองกด '🔎 ทดสอบตรวจจับ' ซ้ำอีกทีได้เลย",
                                    parent=self.root)
        else:
            messagebox.showwarning(
                "คะแนนต่ำมาก",
                f"คะแนนแค่ {score:.2f} — แปลว่ารูป template อาจไม่ตรง\n\n"
                "ลองแนบรูปใหม่ แล้วครอบเฉพาะ 'ข้อความที่เหมือนเดิมทุกครั้ง'\n"
                "(เช่นประโยค 'เราตรวจพบว่าไม่มีความเคลื่อนไหว...') อย่าครอบรูปวิว/ชิ้นจิ๊กซอว์",
                parent=self.root)

    def preview_capture(self):
        """บันทึกภาพที่โปรแกรมจับได้ตอนนี้ แล้วเปิดให้ดู — เช็กว่า window capture ได้ภาพจริงไหม"""
        import detector
        cfg = self.load_cfg()
        d = cfg.get("detection", {})
        try:
            path, mode = detector.capture_screen(
                os.path.join(app_dir(), "_preview.jpg"),
                region=d.get("region"), window_title=d.get("window_title"))
        except Exception as e:
            self.log(f"จับภาพไม่สำเร็จ: {e}")
            return
        modetxt = "หน้าต่าง (window capture)" if mode == "window" else "ทั้งจอ"
        self.log(f"📷 บันทึกภาพตัวอย่างแล้ว (โหมด: {modetxt}) — กำลังเปิดให้ดู...")
        self.log("   ถ้าภาพดำ/ว่าง = window capture ใช้กับ TikTok ไม่ได้ ให้เมนู 2 เลือก 'จับทั้งจอ' แทน")
        try:
            os.startfile(path)  # Windows
        except Exception:
            self.log(f"   เปิดไฟล์อัตโนมัติไม่ได้ ดูเองที่: {path}")

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
