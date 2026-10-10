#!/usr/bin/env bash
set -euo pipefail
if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <transparent-vp8.webm> <output.webp>" >&2
  exit 2
fi
input="$1"
output="$2"
# RMBG browser export is VP8 WebM with alpha. libvpx is required to decode
# the VP8 alpha plane correctly before encoding the app's animated WebP.
ffmpeg -y -v error -c:v libvpx -i "$input" \
  -vf 'fps=20,scale=288:288:flags=lanczos' \
  -c:v libwebp_anim -lossless 0 -quality 82 -loop 0 "$output"
