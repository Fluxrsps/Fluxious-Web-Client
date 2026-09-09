#!/usr/bin/env bash
#
# Generates the launcher icons from android/art. Run by CI, not committed as output.
#
#   f2_big.png     square with its own rounded corners; used as-is for the legacy mipmaps.
#   Flux-Icon2.png round badge on transparency; used for the adaptive foreground, which is masked
#                  to the launcher's shape and only guaranteed the middle ~66%.

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
art="$here/../art"
res="$here/../app/src/main/res"

square="$art/f2_big.png"
badge="$art/Flux-Icon2.png"

for file in "$square" "$badge"; do
    if [[ ! -f "$file" ]]; then
        echo "missing source art: $file" >&2
        exit 1
    fi
done

if command -v magick >/dev/null 2>&1; then
    im() { magick "$@"; }
elif command -v convert >/dev/null 2>&1; then
    im() { convert "$@"; }
else
    echo "ImageMagick not found (need 'magick' or 'convert')" >&2
    exit 1
fi

densities=(mdpi hdpi xhdpi xxhdpi xxxhdpi)
legacy=(48 72 96 144 192)
foreground=(108 162 216 324 432)
safe_zone=66

for i in "${!densities[@]}"; do
    density="${densities[$i]}"
    dir="$res/mipmap-$density"
    mkdir -p "$dir"

    size="${legacy[$i]}"
    im "$square" -resize "${size}x${size}" -strip "$dir/ic_launcher.png"

    im "$square" -resize "${size}x${size}" -strip "$dir/ic_launcher_round.png"

    canvas="${foreground[$i]}"
    inner=$(( canvas * safe_zone / 100 ))
    im "$badge" -resize "${inner}x${inner}" \
        -background none -gravity center -extent "${canvas}x${canvas}" \
        -strip "$dir/ic_launcher_foreground.png"
done

echo "icons written to $res/mipmap-*"
