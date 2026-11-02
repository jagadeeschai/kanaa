#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
for program in python3 node npm ffmpeg ffprobe; do
  command -v "$program" >/dev/null || { echo "Install $program before starting WideAngle Motion."; exit 1; }
done
if [ ! -x backend/.venv/bin/python ]; then
  python3 -m venv backend/.venv
  backend/.venv/bin/python -m pip install -r backend/requirements.txt
fi
if [ ! -d frontend/node_modules ]; then
  npm --prefix frontend ci
fi
if command -v lsof >/dev/null; then
  for port in 8010 5190; do
    if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "Port $port is already in use. If Motion is running, open http://localhost:5190."
      exit 1
    fi
  done
fi
(cd backend && exec .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8010) &
motion_backend_pid=$!
(cd frontend && exec node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5190 --strictPort) &
motion_frontend_pid=$!
cleanup() { kill "$motion_backend_pid" "$motion_frontend_pid" 2>/dev/null || true; }
trap cleanup EXIT INT TERM
printf '\nWideAngle Motion: http://localhost:5190\nPress Ctrl+C to stop.\n\n'
wait "$motion_backend_pid" "$motion_frontend_pid"
