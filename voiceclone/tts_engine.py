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


def _thai_normalize(text: str) -> str:
    """Light Thai text clean-up. Uses pythainlp when available, else a no-op.

    Good normalization noticeably improves Thai pronunciation, but we never
    hard-fail if pythainlp is missing.
    """
    text = (text or "").strip()
    if not text:
        return text
    try:
        from pythainlp.util import normalize  # noqa: WPS433

        text = normalize(text)
    except Exception:  # noqa: BLE001 — pythainlp is optional
        pass
    # Collapse runs of whitespace.
    return re.sub(r"\s+", " ", text).strip()


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
    ) -> str:
        """Generate Thai speech in the reference voice.

        Args:
            text: The Thai text to speak.
            speaker_wav: Path to the reference voice sample.
            out_path: Where to write the generated ``.wav`` file.
            ref_text: Transcript of what is said in ``speaker_wav``. Leave empty
                to let the model transcribe the sample automatically (slower).

        Returns:
            The output path as a string.
        """
        gen_text = _thai_normalize(text)
        if not gen_text:
            raise ValueError("Text is empty.")
        if not Path(speaker_wav).is_file():
            raise FileNotFoundError(f"Voice sample not found: {speaker_wav}")

        tts = self._ensure_loaded()
        Path(out_path).parent.mkdir(parents=True, exist_ok=True)

        tts.infer(
            ref_file=str(speaker_wav),
            ref_text=_thai_normalize(ref_text),
            gen_text=gen_text,
            file_wave=str(out_path),
            remove_silence=True,
        )
        return str(out_path)


# Module-level singleton used by the web app.
engine = VoiceCloneEngine()

# Simple marker so it's easy to confirm the updated engine is the one running.
print("[VoiceClone] engine ready (soundfile audio backend, torchcodec bypass)", flush=True)
