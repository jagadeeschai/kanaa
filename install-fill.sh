#!/bin/bash
# Optional: installs Remove person or object's models on this Mac, from Hugging Face:
#  - the fill: LaMa (big-lama as ONNX, Apache 2.0, about 208 MB) from Carve/LaMa-ONNX
#  - click to choose: MobileSAM (ONNX, MIT, about 45 MB) from Acly/MobileSAM
# To remove them, delete backend/.models/lama and backend/.models/mobilesam.
set -euo pipefail
cd "$(dirname "$0")/backend"
mkdir -p .models/lama
curl -fSL --progress-bar -o .models/lama/lama_fp32.onnx.part https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx
echo "1faef5301d78db7dda502fe59966957ec4b79dd64e16f03ed96913c7a4eb68d6  .models/lama/lama_fp32.onnx.part" | shasum -a 256 -c --quiet
mv .models/lama/lama_fp32.onnx.part .models/lama/lama_fp32.onnx
mkdir -p .models/mobilesam
fetch() {  # file, sha256
  curl -fSL --progress-bar -o ".models/mobilesam/$1.part" "https://huggingface.co/Acly/MobileSAM/resolve/main/$1"
  echo "$2  .models/mobilesam/$1.part" | shasum -a 256 -c --quiet
  mv ".models/mobilesam/$1.part" ".models/mobilesam/$1"
}
fetch mobile_sam_image_encoder.onnx 580f5fb648ea1062c0aabc26217aed56921985f03f0cbbd852bba81d760cc749
fetch sam_mask_decoder_single.onnx 93915fc7c993ab9d59ab8c9ccd3bce37f7509c81ab4150a74abd4d2abbd8570d
echo "Remove person or object can now choose by click and fill on this Mac. Restart Kanaa to use it."
