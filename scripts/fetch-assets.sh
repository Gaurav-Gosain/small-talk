#!/usr/bin/env bash
# Fetch the Reachy Mini 3D assets (URDF + STL meshes) from the pollen-robotics
# desktop app (Apache 2.0) into frontend/public/robot-3d/.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/frontend/public/robot-3d"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Cloning reachy-mini-desktop-app (shallow)…"
git clone --depth 1 https://github.com/pollen-robotics/reachy-mini-desktop-app "$TMP/app"

mkdir -p "$DEST"
cp "$TMP/app/src/assets/robot-3d/reachy-mini.urdf" "$DEST/"
cp -r "$TMP/app/src/assets/robot-3d/meshes" "$DEST/"

echo "Assets in $DEST:"
ls "$DEST"
echo "meshes: $(ls "$DEST/meshes" | wc -l) files"
