#!/usr/bin/env bash
# Generate placeholder spoken audio for the two demo Reachies.
# Uses espeak-ng if available (sounds like speech); otherwise falls back to a
# short ffmpeg tone so the audio pipe can still be verified.
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)/samples"
mkdir -p "$DIR"

say() {  # say <outfile> <voice-pitch> <text>
  local out="$1" pitch="$2" text="$3"
  if command -v espeak-ng >/dev/null 2>&1; then
    espeak-ng -p "$pitch" -s 150 -w "$out" "$text"
  elif command -v espeak >/dev/null 2>&1; then
    espeak -p "$pitch" -s 150 -w "$out" "$text"
  else
    # fallback: 3s tone (frequency varies with "pitch")
    local freq=$((220 + pitch * 4))
    ffmpeg -v error -y -f lavfi -i "sine=frequency=${freq}:duration=3" "$out"
  fi
}

say "$DIR/ada-1.wav"  30 "Hi, I'm Ada. I think the most interesting question about small models is what they let us run on the edge."
say "$DIR/bode-1.wav" 70 "Bode here. Sure, but small doesn't mean simple. The constraints are exactly what make this fun."

echo "Wrote samples to $DIR:"
ls -la "$DIR"
