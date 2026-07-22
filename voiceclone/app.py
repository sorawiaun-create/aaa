"""VoiceClone AI — local web app.

Run with:

    python app.py

then open http://127.0.0.1:8000 in your browser.

Upload a short voice sample, type some text, pick a language, and download the
generated speech. Everything runs locally on your machine.
"""

from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from tts_engine import SUPPORTED_LANGUAGES, engine

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
SAMPLES_DIR = BASE_DIR / "samples"
OUTPUTS_DIR = BASE_DIR / "outputs"

# Only allow a sensible set of audio uploads.
ALLOWED_SUFFIXES = {".wav", ".mp3", ".flac", ".ogg", ".m4a", ".webm"}
MAX_UPLOAD_BYTES = 25 * 1024 * 1024  # 25 MB
MAX_TEXT_CHARS = 5000

SAMPLES_DIR.mkdir(exist_ok=True)
OUTPUTS_DIR.mkdir(exist_ok=True)

app = FastAPI(title="VoiceClone AI", docs_url=None, redoc_url=None)


@app.get("/api/languages")
def languages() -> dict:
    """Return the languages supported by the model."""
    return {"languages": SUPPORTED_LANGUAGES}


@app.post("/api/generate")
async def generate(
    text: str = Form(...),
    language: str = Form("en"),
    sample: UploadFile = File(...),
) -> JSONResponse:
    """Clone the uploaded voice and speak ``text`` in ``language``."""
    text = (text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="กรุณาพิมพ์ข้อความ (Text is required).")
    if len(text) > MAX_TEXT_CHARS:
        raise HTTPException(
            status_code=400,
            detail=f"ข้อความยาวเกินไป (max {MAX_TEXT_CHARS} characters).",
        )
    if language not in SUPPORTED_LANGUAGES:
        raise HTTPException(status_code=400, detail=f"Unsupported language: {language}")

    suffix = Path(sample.filename or "").suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(
            status_code=400,
            detail=f"ชนิดไฟล์ไม่รองรับ (allowed: {', '.join(sorted(ALLOWED_SUFFIXES))}).",
        )

    data = await sample.read()
    if not data:
        raise HTTPException(status_code=400, detail="ไฟล์เสียงว่างเปล่า (empty file).")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="ไฟล์ใหญ่เกินไป (max 25 MB).")

    job_id = uuid.uuid4().hex
    sample_path = SAMPLES_DIR / f"{job_id}{suffix}"
    output_path = OUTPUTS_DIR / f"{job_id}.wav"
    sample_path.write_bytes(data)

    try:
        engine.synthesize(
            text=text,
            speaker_wav=sample_path,
            language=language,
            out_path=output_path,
        )
    except Exception as exc:  # noqa: BLE001 — surface a clean error to the UI
        raise HTTPException(status_code=500, detail=f"สร้างเสียงไม่สำเร็จ: {exc}") from exc
    finally:
        # The reference sample is only needed during generation.
        sample_path.unlink(missing_ok=True)

    return JSONResponse(
        {
            "id": job_id,
            "url": f"/api/audio/{job_id}",
            "download_url": f"/api/audio/{job_id}?download=1",
        }
    )


@app.get("/api/audio/{job_id}")
def audio(job_id: str, download: int = 0) -> FileResponse:
    """Serve a generated audio file (streaming or as a download)."""
    # Guard against path traversal — job ids are hex uuids.
    if not job_id.isalnum():
        raise HTTPException(status_code=400, detail="Bad id.")
    path = OUTPUTS_DIR / f"{job_id}.wav"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="ไม่พบไฟล์เสียง (not found).")

    headers = {}
    if download:
        headers["Content-Disposition"] = f'attachment; filename="voiceclone-{job_id}.wav"'
    return FileResponse(path, media_type="audio/wav", headers=headers)


# Serve the frontend (index.html + assets) at the root.
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)
