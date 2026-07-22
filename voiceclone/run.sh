#!/usr/bin/env bash
# VoiceClone AI — one-command launcher (macOS / Linux)
set -e

cd "$(dirname "$0")"

if [ ! -d ".venv" ]; then
  echo "==> Creating virtual environment (.venv)..."
  python3 -m venv .venv
fi

# shellcheck disable=SC1091
source .venv/bin/activate

echo "==> Installing dependencies (first run only, may take a while)..."
pip install --upgrade pip >/dev/null
pip install -r requirements.txt

echo "==> Starting VoiceClone AI at http://127.0.0.1:8000"
python app.py
