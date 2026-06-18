#!/usr/bin/env bash
# Regenerate all icon assets from build/icon-master.png (produced by
# scripts/make-icon.cjs). Run via: npm run make:icon
#
# Outputs:
#   build/icon.icns            - macOS app icon (electron-builder)
#   build/icon.png             - 512px PNG (linux/win + fallback)
#   build/AppIcon.iconset/*    - full iconset (incl. non-standard 64 / 1024)
#   src/icon.png               - 512px PNG used by the app
#   logo.png                   - 128px brand logo shown in the in-app sample
set -euo pipefail
cd "$(dirname "$0")/.."

MASTER="build/icon-master.png"
[ -f "$MASTER" ] || { echo "missing $MASTER - run make-icon.cjs first"; exit 1; }

# 1. Clean iconset with only iconutil-valid names -> icon.icns
rm -rf build/_icns.iconset
mkdir -p build/_icns.iconset
for spec in "16:icon_16x16" "32:icon_16x16@2x" "32:icon_32x32" "64:icon_32x32@2x" \
            "128:icon_128x128" "256:icon_128x128@2x" "256:icon_256x256" \
            "512:icon_256x256@2x" "512:icon_512x512" "1024:icon_512x512@2x"; do
  sz="${spec%%:*}"; name="${spec##*:}"
  sips -z "$sz" "$sz" "$MASTER" --out "build/_icns.iconset/$name.png" >/dev/null
done
iconutil -c icns build/_icns.iconset -o build/icon.icns
rm -rf build/_icns.iconset

# 2. Full AppIcon.iconset (keeps vomit's existing name set, incl. 64 / 1024)
rm -rf build/AppIcon.iconset
mkdir -p build/AppIcon.iconset
for spec in "16:icon_16x16" "32:icon_16x16@2x" "32:icon_32x32" "64:icon_32x32@2x" \
            "64:icon_64x64" "128:icon_64x64@2x" "128:icon_128x128" "256:icon_128x128@2x" \
            "256:icon_256x256" "512:icon_256x256@2x" "512:icon_512x512" \
            "1024:icon_512x512@2x" "1024:icon_1024x1024"; do
  sz="${spec%%:*}"; name="${spec##*:}"
  sips -z "$sz" "$sz" "$MASTER" --out "build/AppIcon.iconset/$name.png" >/dev/null
done

# 3. PNG variants at their established sizes
sips -z 512 512 "$MASTER" --out build/icon.png >/dev/null
sips -z 512 512 "$MASTER" --out src/icon.png >/dev/null
sips -z 128 128 "$MASTER" --out logo.png >/dev/null

rm -f "$MASTER"
echo "Generated icon.icns, icon.png, AppIcon.iconset, src/icon.png, logo.png"
