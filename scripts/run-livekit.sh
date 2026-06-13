#!/usr/bin/env bash
# Run the LiveKit server for local dev using livekit.yaml.
#
# We use a config file instead of `--dev` because LiveKit's ICE layer otherwise
# binds UDP to the physical LAN interfaces (never loopback) while advertising a
# localhost node_ip — a mismatch that makes browsers fail ICE/DTLS on a
# localhost-only setup. livekit.yaml pins ICE to the loopback interface so every
# candidate is on 127.0.0.1 and reachable from the browser. Keys: devkey/secret.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if ! command -v livekit-server >/dev/null 2>&1; then
  echo "livekit-server not found. Install it with:"
  echo "  curl -sSL https://get.livekit.io | bash"
  exit 1
fi

exec livekit-server --config "$ROOT/livekit.yaml"
