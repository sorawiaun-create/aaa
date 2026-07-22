"""VoiceClone AI — text-to-speech engine with zero-shot voice cloning.

Wraps the XTTS-v2 model (via the coqui-tts community fork). The model is loaded
lazily on first use so that starting the web server stays fast; the first
generation request will take longer while the model downloads / loads into
memory.

Everything runs locally on your own machine — no audio is sent to any server.
"""

from __future__ import annotations

import os
import threading
from pathlib import Path

# Languages supported by the XTTS-v2 model. Key = code passed to the model,
# value = human-readable name shown in the UI.
SUPPORTED_LANGUAGES: dict[str, str] = {
    "en": "English",
    "es": "Español (Spanish)",
    "fr": "Français (French)",
    "de": "Deutsch (German)",
    "it": "Italiano (Italian)",
    "pt": "Português (Portuguese)",
    "pl": "Polski (Polish)",
    "tr": "Türkçe (Turkish)",
    "ru": "Русский (Russian)",
    "nl": "Nederlands (Dutch)",
    "cs": "Čeština (Czech)",
    "ar": "العربية (Arabic)",
    "zh-cn": "中文 (Chinese)",
    "ja": "日本語 (Japanese)",
    "hu": "Magyar (Hungarian)",
    "ko": "한국어 (Korean)",
    "hi": "हिन्दी (Hindi)",
}

MODEL_NAME = "tts_models/multilingual/multi-dataset/xtts_v2"


class VoiceCloneEngine:
    """Lazily-loaded singleton wrapper around the XTTS-v2 model."""

    def __init__(self) -> None:
        self._tts = None
        self._lock = threading.Lock()
        self._device = "cpu"

    @property
    def device(self) -> str:
        return self._device

    def _ensure_loaded(self):
        """Load the model on first use. Thread-safe."""
        if self._tts is not None:
            return self._tts

        with self._lock:
            if self._tts is not None:
                return self._tts

            # Import here so the module can be inspected (and languages listed)
            # without paying the heavy import cost up front.
            import torch  # noqa: WPS433
            from TTS.api import TTS  # noqa: WPS433

            # Accept the Coqui model license non-interactively so the download
            # does not block on a terminal prompt inside the web server.
            os.environ.setdefault("COQUI_TOS_AGREED", "1")

            self._device = "cuda" if torch.cuda.is_available() else "cpu"
            self._tts = TTS(MODEL_NAME).to(self._device)
            return self._tts

    def synthesize(
        self,
        text: str,
        speaker_wav: str | os.PathLike,
        language: str,
        out_path: str | os.PathLike,
    ) -> str:
        """Generate speech that mimics ``speaker_wav`` saying ``text``.

        Args:
            text: The text to speak.
            speaker_wav: Path to the reference voice sample (wav/mp3/flac/...).
            language: One of ``SUPPORTED_LANGUAGES``.
            out_path: Where to write the generated ``.wav`` file.

        Returns:
            The output path as a string.
        """
        text = (text or "").strip()
        if not text:
            raise ValueError("Text is empty.")
        if language not in SUPPORTED_LANGUAGES:
            raise ValueError(f"Unsupported language: {language!r}")
        if not Path(speaker_wav).is_file():
            raise FileNotFoundError(f"Voice sample not found: {speaker_wav}")

        tts = self._ensure_loaded()
        Path(out_path).parent.mkdir(parents=True, exist_ok=True)

        tts.tts_to_file(
            text=text,
            speaker_wav=str(speaker_wav),
            language=language,
            file_path=str(out_path),
            split_sentences=True,
        )
        return str(out_path)


# Module-level singleton used by the web app.
engine = VoiceCloneEngine()
