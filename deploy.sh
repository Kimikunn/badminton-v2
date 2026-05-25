#!/bin/bash
# ==========================================
# BAD Club v2 - Deploy Script
# Builds frontend → deploys → Playwright verification
# Usage: bash deploy.sh
# ==========================================

set -e

APP_DIR="/opt/apps/badminton-v2"
DIST_DIR="/tmp/baddist_deploy"

echo "[BAD Club v2] Deploy"
echo ""

# Step 1: Build frontend
echo "[1/4] Building frontend..."
cd "$APP_DIR/client"
rm -rf "$DIST_DIR"
npx vite build --outDir "$DIST_DIR" --emptyOutDir 2>&1 | tail -3

# Step 2: Deploy to running containers via docker cp
echo "[2/4] Deploying to containers..."
sg docker -c "docker cp $DIST_DIR/. badminton-v2:/app/client/dist/ && docker cp $DIST_DIR/. badminton-v2-test:/app/client/dist/"

# Step 3: Quick HTTP check
echo "[3/4] Verifying HTTP..."
sleep 2
P=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8089/)
T=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8090/)

# Step 4: Playwright verification (smoke + contrast)
echo "[4/4] Running Playwright checks..."
cd "$APP_DIR"
export PLAYWRIGHT_BROWSERS_PATH=/tmp/pw-browsers
npx playwright test e2e/smoke.spec.js e2e/contrast.spec.js --reporter=line 2>&1 | tail -5

echo ""
echo "✅ Deploy complete! Production: $P | Test: $T"
