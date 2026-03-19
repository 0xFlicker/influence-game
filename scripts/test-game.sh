#!/usr/bin/env bash
# Dev Test Harness — Create, fill, and start a game via the API.
#
# Usage:
#   ./scripts/test-game.sh [options]
#
# Options are passed through to the Bun script. See scripts/test-game.ts for details.
# Examples:
#   ./scripts/test-game.sh                              # defaults: 6 players, budget, fast
#   ./scripts/test-game.sh --players 8 --timing standard
#   ./scripts/test-game.sh --wait                       # poll until game is running
#   ./scripts/test-game.sh --no-start                   # create + fill only

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_DIR"
exec doppler run -- bun "$SCRIPT_DIR/test-game.ts" "$@"
