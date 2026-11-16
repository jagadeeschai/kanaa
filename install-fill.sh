#!/bin/bash
# Optional: installs the fill model for Remove person on this Mac (LaMa, big-lama as ONNX, Apache 2.0, about 208 MB)
# from huggingface.co/Carve/LaMa-ONNX. To remove it, delete backend/.models/lama.
set -euo pipefail
cd "$(dirname "$0")/backend"
mkdir -p .models/lama
curl -fSL --progress-bar -o .models/lama/lama_fp32.onnx.part https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx
echo "1faef5301d78db7dda502fe59966957ec4b79dd64e16f03ed96913c7a4eb68d6  .models/lama/lama_fp32.onnx.part" | shasum -a 256 -c --quiet
mv .models/lama/lama_fp32.onnx.part .models/lama/lama_fp32.onnx
echo "Remove person can now fill on this Mac. Restart Kanaa to use it."
