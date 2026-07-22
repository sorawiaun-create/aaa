"""VoiceClone AI — Thai text-to-speech engine with zero-shot voice cloning.

Uses **F5-TTS** with the Thai fine-tuned checkpoint published by VIZINTZOR
(``VIZINTZOR/F5-TTS-THAI``). F5-TTS clones a voice from a short reference clip
and can speak Thai. Everything runs locally on your machine.

The model + vocab are downloaded from the Hugging Face Hub on first use and
cached, so the first generation takes a while; subsequent runs are fast.
"""

from __future__ import annotations

import glob
import os
import re
import shutil
import threading
from pathlib import Path


def _register_ffmpeg_dlls() -> None:
    """Make FFmpeg's shared DLLs discoverable to torchcodec on Windows.

    Since Python 3.8, dependent DLLs loaded in-process are no longer searched
    for on ``PATH`` (only via ``os.add_dll_directory``). So even a correctly
    installed, on-PATH FFmpeg stays invisible to torchcodec, which fails with
    "Could not find module libtorchcodec_coreN.dll (or one of its
    dependencies)". Here we locate FFmpeg's ``bin`` folder (which ships the
    ``av*.dll`` / ``sw*.dll`` files) and register it explicitly. No-op off
    Windows.
    """
    if os.name != "nt":
        return

    candidates: list[str] = []
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg:
        candidates.append(os.path.dirname(ffmpeg))

    # Fallback: common winget "shared" build locations, in case ffmpeg.exe is
    # not on PATH but the DLLs are installed.
    local = os.environ.get("LOCALAPPDATA", "")
    if local:
        candidates += glob.glob(
            os.path.join(local, "Microsoft", "WinGet", "Packages",
                         "Gyan.FFmpeg.Shared*", "**", "bin"),
            recursive=True,
        )

    seen: set[str] = set()
    for path in candidates:
        if path and path not in seen and os.path.isdir(path):
            seen.add(path)
            try:
                os.add_dll_directory(path)
            except OSError:
                pass


# Run as early as possible — before torch / torchcodec get imported.
_register_ffmpeg_dlls()


def _bypass_torchcodec() -> None:
    """Route torchaudio's audio I/O through soundfile instead of torchcodec.

    On many Windows setups (and with bleeding-edge PyTorch), torchcodec's DLLs
    refuse to load — "Could not load libtorchcodec ... Could not find module
    libtorchcodec_coreN.dll (or one of its dependencies)". F5-TTS only needs to
    read/write plain WAV/FLAC/OGG (it pre-converts other formats with FFmpeg
    first), which ``soundfile`` (libsndfile) does without torchcodec at all.

    We replace ``torchaudio.load`` / ``save`` / ``info`` *before* F5-TTS is
    imported so its internal calls never touch torchcodec.
    """
    try:
        import numpy as np  # noqa: WPS433
        import soundfile as sf  # noqa: WPS433
        import torch  # noqa: WPS433
        import torchaudio  # noqa: WPS433
    except Exception:  # noqa: BLE001 — nothing to patch if these are missing
        return

    def _load(filepath, *args, **kwargs):  # noqa: ANN001
        data, sr = sf.read(str(filepath), dtype="float32", always_2d=True)
        # soundfile gives (frames, channels); torchaudio uses (channels, frames).
        return torch.from_numpy(np.ascontiguousarray(data.T)), sr

    def _save(filepath, src, sample_rate, *args, **kwargs):  # noqa: ANN001
        arr = src.detach().cpu().numpy()
        if arr.ndim == 2:
            arr = arr.T  # (channels, frames) -> (frames, channels)
        sf.write(str(filepath), arr, int(sample_rate))

    def _info(filepath, *args, **kwargs):  # noqa: ANN001
        meta = sf.info(str(filepath))

        class _Info:
            sample_rate = int(meta.samplerate)
            num_frames = int(meta.frames)
            num_channels = int(meta.channels)
            bits_per_sample = 16
            encoding = "PCM_S"

        return _Info()

    torchaudio.load = _load
    torchaudio.save = _save
    torchaudio.info = _info


# Hugging Face repo holding the Thai F5-TTS checkpoint + vocab.
HF_REPO = "VIZINTZOR/F5-TTS-THAI"

# The Thai checkpoint was trained on the F5TTS_Base architecture.
MODEL_ARCH = "F5TTS_Base"

# Tone presets. F5-TTS has no explicit emotion control (the reference clip sets
# the emotion), but the speaking pace is a real, audible lever, so each preset
# maps to a speech-rate multiplier: >1 = faster/more energetic, <1 = calmer.
TONE_PRESETS: dict[str, float] = {
    "normal": 1.0,      # ปกติ / ทั่วไป
    "sales": 1.12,      # แม่ค้า / ขายของ — สดใส กระตือรือร้น
    "review": 1.18,     # รีวิว / ป้ายยา — ตื่นเต้น เร้าใจ
    "ads": 1.1,         # โฆษณา — กระชับ ดึงดูด
    "travel": 0.95,     # ท่องเที่ยว / บรรยาย — อบอุ่น สบาย
    "formal": 0.92,     # ทางการ / ข่าว — สุขุม ชัดเจน
    "storytelling": 0.9,  # เล่าเรื่อง / นุ่มนวล
}


# The Thai model can only pronounce Thai characters, so Arabic/Thai digits and
# Latin letters must be rewritten as their Thai reading first, otherwise they
# are dropped and the surrounding sentence comes out garbled.

# Thai numerals -> Arabic, so the number reader can handle both.
_THAI_DIGITS = str.maketrans("๐๑๒๓๔๕๖๗๘๙", "0123456789")

# English letter names, for spelling out unknown words / acronyms.
_EN_LETTER = {
    "a": "เอ", "b": "บี", "c": "ซี", "d": "ดี", "e": "อี", "f": "เอฟ",
    "g": "จี", "h": "เอช", "i": "ไอ", "j": "เจ", "k": "เค", "l": "แอล",
    "m": "เอ็ม", "n": "เอ็น", "o": "โอ", "p": "พี", "q": "คิว", "r": "อาร์",
    "s": "เอส", "t": "ที", "u": "ยู", "v": "วี", "w": "ดับเบิลยู",
    "x": "เอ็กซ์", "y": "วาย", "z": "แซด",
}

# Common marketing / social-media English words -> Thai spelling.
_EN_WORDS = {
    "tiktok": "ติ๊กต็อก", "youtube": "ยูทูบ", "facebook": "เฟซบุ๊ก",
    "instagram": "อินสตาแกรม", "ig": "ไอจี", "reels": "รีลส์", "reel": "รีล",
    "live": "ไลฟ์", "line": "ไลน์", "shopee": "ช้อปปี้", "lazada": "ลาซาด้า",
    "shop": "ช็อป", "order": "ออเดอร์", "dm": "ดีเอ็ม", "inbox": "อินบ็อกซ์",
    "admin": "แอดมิน", "add": "แอด", "sale": "เซล", "sales": "เซล",
    "ok": "โอเค", "okay": "โอเค", "promotion": "โปรโมชัน", "promo": "โปรโม",
    "discount": "ดิสเคาน์", "review": "รีวิว", "content": "คอนเทนต์",
    "clip": "คลิป", "subscribe": "ซับสไครบ์", "like": "ไลก์", "share": "แชร์",
    "comment": "คอมเมนต์", "follow": "ฟอลโลว์", "brand": "แบรนด์",
    "new": "นิว", "free": "ฟรี", "set": "เซต", "size": "ไซซ์",
    "color": "คัลเลอร์", "online": "ออนไลน์", "app": "แอป", "wow": "ว้าว",
}


def _read_number(token: str) -> str:
    """Read a numeric token as Thai words. Falls back to the token on error."""
    try:
        from pythainlp.util import num_to_thaiword  # noqa: WPS433
    except Exception:  # noqa: BLE001 — pythainlp optional
        return token

    raw = token.replace(",", "")
    try:
        if "." in raw:
            int_part, _, dec_part = raw.partition(".")
            left = num_to_thaiword(int(int_part)) if int_part else "ศูนย์"
            right = "".join(num_to_thaiword(int(d)) for d in dec_part)
            return f"{left}จุด{right}"
        # Phone-like numbers (leading zero) or very long ones read digit by digit.
        if (raw.startswith("0") and len(raw) > 1) or len(raw) > 9:
            return "".join(num_to_thaiword(int(d)) for d in raw)
        return num_to_thaiword(int(raw))
    except Exception:  # noqa: BLE001
        return token


def _read_english(word: str) -> str:
    """Read an English word as Thai: known word, else spelled out by letter."""
    low = word.lower()
    if low in _EN_WORDS:
        return _EN_WORDS[low]
    return "".join(_EN_LETTER.get(ch, "") for ch in low)


def _thai_normalize(text: str) -> str:
    """Rewrite text so the Thai model can pronounce it.

    Converts digits and English words to their Thai reading, then applies
    pythainlp's normalizer. Degrades gracefully if pythainlp is unavailable.
    """
    text = (text or "").strip()
    if not text:
        return text

    text = text.translate(_THAI_DIGITS)
    # Numbers (with optional thousands separators / decimals).
    text = re.sub(r"\d[\d,]*(?:\.\d+)?", lambda m: _read_number(m.group()), text)
    # English words / acronyms.
    text = re.sub(r"[A-Za-z]+", lambda m: _read_english(m.group()), text)

    try:
        from pythainlp.util import normalize  # noqa: WPS433

        text = normalize(text)
    except Exception:  # noqa: BLE001 — pythainlp is optional
        pass
    # Collapse runs of whitespace.
    return re.sub(r"\s+", " ", text).strip()


# F5-TTS degrades when asked to generate more than ~10 s of audio in one pass.
# Thai text rarely has punctuation, so the model treats a whole paragraph as one
# long sentence and the tail comes out garbled. We split the text into short
# pieces (at sentence, then word boundaries) and generate each one separately.
# ~90 Thai characters stays comfortably under the degradation threshold.
MAX_CHUNK_CHARS = 90


def _split_text_for_tts(text: str, max_chars: int = MAX_CHUNK_CHARS) -> list[str]:
    """Split Thai text into short chunks that each generate cleanly."""
    text = (text or "").strip()
    if not text:
        return []

    # First pass: sentences (pythainlp if available, else punctuation split).
    try:
        from pythainlp import sent_tokenize  # noqa: WPS433

        sentences = sent_tokenize(text)
    except Exception:  # noqa: BLE001 — pythainlp optional
        sentences = re.split(r"(?<=[.!?。！?\n])\s*", text)

    # Second pass: break any still-too-long sentence at word boundaries.
    units: list[str] = []
    for sentence in sentences:
        sentence = sentence.strip()
        if not sentence:
            continue
        if len(sentence) <= max_chars:
            units.append(sentence)
            continue
        try:
            from pythainlp import word_tokenize  # noqa: WPS433

            words = word_tokenize(sentence, keep_whitespace=False)
        except Exception:  # noqa: BLE001
            words = sentence.split(" ")
        current = ""
        for word in words:
            if current and len(current) + len(word) > max_chars:
                units.append(current)
                current = word
            else:
                current += word
        if current:
            units.append(current)

    # Final pass: greedily merge small units back up to max_chars.
    chunks: list[str] = []
    current = ""
    for unit in units:
        if current and len(current) + len(unit) > max_chars:
            chunks.append(current)
            current = unit
        else:
            current += unit
    if current:
        chunks.append(current)
    return chunks


class VoiceCloneEngine:
    """Lazily-loaded singleton wrapper around the Thai F5-TTS model."""

    def __init__(self) -> None:
        self._tts = None
        self._lock = threading.Lock()
        self._device = "cpu"

    @property
    def device(self) -> str:
        return self._device

    def _pick_files(self) -> tuple[str, str]:
        """Find and download the best checkpoint + vocab from the HF repo.

        Filenames on the repo change over time, so we list the repo and pick
        the highest-step full checkpoint (preferring ``.safetensors``) rather
        than hard-coding a name that may disappear.
        """
        from huggingface_hub import HfApi, hf_hub_download  # noqa: WPS433

        files = HfApi().list_repo_files(HF_REPO)

        def step_of(name: str) -> int:
            match = re.search(r"(\d+)", Path(name).stem)
            return int(match.group(1)) if match else -1

        checkpoints = [
            f
            for f in files
            if f.endswith((".safetensors", ".pt"))
            and "small" not in f.lower()
            and "vocos" not in f.lower()
        ]
        if not checkpoints:
            checkpoints = [f for f in files if f.endswith((".safetensors", ".pt"))]
        if not checkpoints:
            raise RuntimeError(f"No model checkpoint found in {HF_REPO}.")

        # Prefer safetensors, then the highest training step.
        checkpoints.sort(key=lambda f: (f.endswith(".safetensors"), step_of(f)))
        ckpt_name = checkpoints[-1]

        vocab_name = next((f for f in files if Path(f).name == "vocab.txt"), None)

        ckpt_path = hf_hub_download(HF_REPO, ckpt_name)
        vocab_path = hf_hub_download(HF_REPO, vocab_name) if vocab_name else ""
        return ckpt_path, vocab_path

    def _ensure_loaded(self):
        """Load the model on first use. Thread-safe."""
        if self._tts is not None:
            return self._tts

        with self._lock:
            if self._tts is not None:
                return self._tts

            # Ensure FFmpeg DLLs are registered, and route audio I/O through
            # soundfile — both BEFORE importing F5-TTS so torchcodec is never
            # needed.
            _register_ffmpeg_dlls()
            _bypass_torchcodec()

            import torch  # noqa: WPS433
            from f5_tts.api import F5TTS  # noqa: WPS433

            self._device = "cuda" if torch.cuda.is_available() else "cpu"

            # On CPU, make sure PyTorch uses every core available.
            if self._device == "cpu":
                cores = os.cpu_count() or 1
                torch.set_num_threads(cores)

            ckpt_file, vocab_file = self._pick_files()

            self._tts = F5TTS(
                model=MODEL_ARCH,
                ckpt_file=ckpt_file,
                vocab_file=vocab_file,
                device=self._device,
            )
            return self._tts

    def synthesize(
        self,
        text: str,
        speaker_wav: str,
        out_path: str,
        ref_text: str = "",
        nfe_step: int = 16,
        speed: float = 1.0,
    ) -> str:
        """Generate Thai speech in the reference voice.

        Args:
            text: The Thai text to speak.
            speaker_wav: Path to the reference voice sample.
            out_path: Where to write the generated ``.wav`` file.
            ref_text: Transcript of what is said in ``speaker_wav``. Leave empty
                to let the model transcribe the sample automatically (slower).
            nfe_step: Number of denoising steps. Lower is faster but slightly
                lower quality (8 = fastest, 16 = balanced, 32 = best). This is
                the main speed lever on CPU.
            speed: Speaking-rate multiplier (see ``TONE_PRESETS``). >1 speaks
                faster/more energetically, <1 calmer.

        Returns:
            The output path as a string.
        """
        gen_text = _thai_normalize(text)
        if not gen_text:
            raise ValueError("Text is empty.")
        if not Path(speaker_wav).is_file():
            raise FileNotFoundError(f"Voice sample not found: {speaker_wav}")

        nfe_step = max(4, min(64, int(nfe_step)))
        speed = max(0.5, min(2.0, float(speed)))
        ref_text = _thai_normalize(ref_text)

        tts = self._ensure_loaded()
        Path(out_path).parent.mkdir(parents=True, exist_ok=True)

        chunks = _split_text_for_tts(gen_text)

        # Short text: one pass straight to the output file (fast path).
        if len(chunks) <= 1:
            tts.infer(
                ref_file=str(speaker_wav),
                ref_text=ref_text,
                gen_text=gen_text,
                file_wave=str(out_path),
                nfe_step=nfe_step,
                speed=speed,
                remove_silence=False,
            )
            return str(out_path)

        # Long text: generate each chunk separately (so none exceeds the
        # ~10 s window where F5-TTS degrades), then stitch the audio together.
        import numpy as np  # noqa: WPS433
        import soundfile as sf  # noqa: WPS433

        # Resolve the reference transcript once so we don't re-run ASR per chunk.
        if not ref_text:
            try:
                from f5_tts.infer.utils_infer import (  # noqa: WPS433
                    preprocess_ref_audio_text,
                )

                _, ref_text = preprocess_ref_audio_text(str(speaker_wav), "")
            except Exception:  # noqa: BLE001 — fall back to per-chunk ASR
                ref_text = ""

        pieces: list = []
        sr = 24000
        for chunk in chunks:
            wav, sr, _ = tts.infer(
                ref_file=str(speaker_wav),
                ref_text=ref_text,
                gen_text=chunk,
                nfe_step=nfe_step,
                speed=speed,
                remove_silence=False,
            )
            pieces.append(np.asarray(wav, dtype=np.float32))
            # Short pause between chunks for a natural join.
            pieces.append(np.zeros(int(sr * 0.12), dtype=np.float32))

        final = np.concatenate(pieces[:-1]) if pieces else np.zeros(1, np.float32)
        sf.write(str(out_path), final, sr)
        return str(out_path)


# Module-level singleton used by the web app.
engine = VoiceCloneEngine()

# Simple marker so it's easy to confirm the updated engine is the one running.
print("[VoiceClone] engine ready (soundfile audio backend, torchcodec bypass)", flush=True)
