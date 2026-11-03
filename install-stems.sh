#!/bin/bash
# Optional: installs voice separation (Demucs and PyTorch, about 650 MB) beside Kanaa, not inside it.
# To remove it, delete backend/.stems and backend/.models/torch.
set -euo pipefail
cd "$(dirname "$0")/backend"
# PyTorch lags new Python releases, so use the Python Kanaa itself runs on.
.venv/bin/python -m venv --clear .stems
.stems/bin/python -m pip install --quiet --upgrade pip
.stems/bin/python -m pip install --quiet demucs==4.0.1 'torch<2.9' 'torchaudio<2.9' soundfile
TORCH_HOME="$PWD/.models/torch" .stems/bin/python -c "from demucs.pretrained import get_model; get_model('htdemucs')"
echo "Voice separation is ready. Restart Kanaa to use it."
