#!/bin/bash
# Builds Kanaa.app for this Mac and installs it in Applications.
# The app is Electron's own, with Kanaa's small launcher inside. Nothing here needs npm.
set -euo pipefail
ELECTRON=33.4.11
ARCHIVE="electron-v$ELECTRON-darwin-arm64.zip"
RELEASE="https://github.com/electron/electron/releases/download/v$ELECTRON"
CACHE="$HOME/Library/Caches/wideangle-motion"
cd "$(dirname "$0")/.."
ROOT="$PWD"
OUT="$ROOT/desktop/dist"
APP="$OUT/Kanaa.app"

npm --prefix frontend run build

mkdir -p "$CACHE"
if [ ! -f "$CACHE/$ARCHIVE" ]; then
  curl -fL -o "$CACHE/$ARCHIVE.part" "$RELEASE/$ARCHIVE"
  mv "$CACHE/$ARCHIVE.part" "$CACHE/$ARCHIVE"
fi
WANTED=$(curl -fsL "$RELEASE/SHASUMS256.txt" | grep " \*$ARCHIVE\$" | cut -d' ' -f1)
[ "$(shasum -a 256 "$CACHE/$ARCHIVE" | cut -d' ' -f1)" = "$WANTED" ] || { rm -f "$CACHE/$ARCHIVE"; echo "The Electron download failed its check. Run this again."; exit 1; }

rm -rf "$OUT"
mkdir -p "$OUT"
ditto -x -k "$CACHE/$ARCHIVE" "$OUT"
mv "$OUT/Electron.app" "$APP"

RESOURCES="$APP/Contents/Resources"
rm -f "$RESOURCES/default_app.asar"
mkdir "$RESOURCES/app"
cp desktop/main.cjs desktop/package.json "$RESOURCES/app/"
python3 -c 'import json,sys; print(json.dumps({"root": sys.argv[1]}))' "$ROOT" > "$RESOURCES/app/root.json"

backend/.venv/bin/python desktop/make_icon.py "$OUT"
mv "$OUT/icon.icns" "$RESOURCES/electron.icns"
rm -rf "$OUT/icon.iconset"

PLIST="$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Set :CFBundleName Kanaa' -c 'Set :CFBundleDisplayName Kanaa' -c 'Set :CFBundleIdentifier com.kanaa.app' -c "Set :CFBundleShortVersionString 1.0.0" -c 'Set :CFBundleVersion 1' "$PLIST"
codesign --force --deep --sign - "$APP"

if [ "${1:-}" != "--no-install" ]; then
  rm -rf "/Applications/Kanaa.app" "/Applications/WideAngle Motion.app"
  ditto "$APP" "/Applications/Kanaa.app"
  echo "Installed in Applications."
fi
