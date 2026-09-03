#!/usr/bin/env bash
# One-command deploy for CG Resource Hub.
# Packages the local repo (git + node_modules + data excluded), uploads to
# the server, rebuilds the image, swaps the container, health-checks.
#
# Usage:  bash scripts/deploy.sh
# Secrets live only in ~/deploy-cgrh.sh on the server — nothing sensitive here.
set -euo pipefail
cd "$(dirname "$0")/.."

SERVER="ubuntu@49.233.29.72"
KEY="$HOME/.ssh/NexArt_Hermes.pem"
URL="https://hub.nexart.net"
REMOTE_TARBALL="/tmp/cgrh-deploy.tar.gz"

echo "[1/5] packaging repo..."
TARBALL="$(mktemp -t cgrh-deploy-XXXXXX.tar.gz)"
# shellcheck disable=SC2086
tar \
  --exclude=.git \
  --exclude='node_modules' --exclude='*/node_modules' \
  --exclude='web/dist' --exclude='api/data/database.sqlite*' \
  --exclude='.cbmm-cache' --exclude='.thumb-cache' --exclude='.web-cache' \
  --exclude='test_fixtures' --exclude='_legacy_root_backup' --exclude='docs' \
  --exclude='cache' --exclude='data' --exclude='scripts' \
  --exclude='*.log' --exclude='.env' --exclude='.dev.log' \
  --exclude='metadata.json' --exclude='.shares_map.json' --exclude='_api_notes' \
  --exclude='api/_peek_users.cjs' --exclude='api/_run_api.bat' \
  --exclude='api/tools/__pycache__' --exclude='api/tools/_e2e_test' \
  --exclude='api/tools/_test_run.py' --exclude='api/tools/_installers' \
  --exclude='web/_drift_test.cjs' --exclude='web/_run_web.bat' \
  --exclude='web/check-i18n.cjs' --exclude='web/scripts' \
  --exclude='__pycache__' --exclude='.venv' \
  -czf "$TARBALL" .
ls -lh "$TARBALL"

echo "[2/5] uploading..."
scp -q -o BatchMode=yes -i "$KEY" "$TARBALL" "$SERVER:$REMOTE_TARBALL"
rm -f "$TARBALL"

echo "[3/5] building + swapping container on server..."
ssh -o BatchMode=yes -i "$KEY" "$SERVER" "bash ~/deploy-cgrh.sh $REMOTE_TARBALL"

echo "[4/5] verifying public URL..."
for i in 1 2 3 4 5; do
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 8 "$URL/" || true)
  if [ "$code" = "200" ]; then
    echo "[5/5] DONE — $URL is live (200)"
    exit 0
  fi
  sleep 3
done
echo "[5/5] WARNING — public check returned '$code'. The container may still be warming up; check manually."
exit 1