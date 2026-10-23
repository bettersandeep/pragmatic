#!/bin/bash
# Makes build/icon.icns from web/public/favicon.svg. Run from desktop/: bash build/make-icon.sh
# The art is 824px on a 1024px canvas, as on the macOS icon grid. Needs Google Chrome, sips and iconutil.
set -euo pipefail
cd "$(dirname "$0")"
work=$(mktemp -d)
cp ../../web/public/favicon.svg "$work/"
cat > "$work/icon.html" <<'EOF'
<!doctype html><html><body style="margin:0;background:transparent"><img src="favicon.svg" style="position:absolute;left:100px;top:100px;width:824px;height:824px"></body></html>
EOF
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=1 --default-background-color=00000000 --window-size=1024,1024 \
  --screenshot="$work/icon-1024.png" "file://$work/icon.html" >/dev/null 2>&1
mkdir "$work/icon.iconset"
for s in 16 32 128 256 512; do
  sips -z $s $s "$work/icon-1024.png" --out "$work/icon.iconset/icon_${s}x${s}.png" >/dev/null
  sips -z $((s * 2)) $((s * 2)) "$work/icon-1024.png" --out "$work/icon.iconset/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$work/icon.iconset" -o icon.icns
rm -rf "$work"
