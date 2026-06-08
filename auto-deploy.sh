#!/bin/bash
# Auto-deploy: pull latest main and restart container if HEAD changed.
# Install via cron:
#   * * * * * /mnt/user/appdata/onepiece-game/auto-deploy.sh
set -euo pipefail

REPO_DIR=/mnt/user/appdata/onepiece-game
LOG="$REPO_DIR/auto-deploy.log"

cd "$REPO_DIR"

OLD=$(git rev-parse HEAD)
git pull --quiet --ff-only origin main
NEW=$(git rev-parse HEAD)

if [ "$OLD" != "$NEW" ]; then
  echo "$(date -Iseconds) deploy $OLD -> $NEW" >> "$LOG"
  docker restart onepiece-game >> "$LOG" 2>&1
fi
