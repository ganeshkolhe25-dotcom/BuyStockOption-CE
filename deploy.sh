#!/bin/bash
# deploy.sh — Deploy backend (VM Docker) + frontend (Cloud Run) in one command
# Usage: bash deploy.sh [be|fe|all]  (default: all)
set -e

GCLOUD="C:\Users\maddy\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"
PROJECT="project-11c8f47d-cee3-4d25-bbb"
ZONE="asia-south1-b"
VM="shoonya-trader"
REGION="asia-south1"
FE_IMAGE="asia-south1-docker.pkg.dev/project-11c8f47d-cee3-4d25-bbb/cloud-run-source-deploy/shoonya-frontend:latest"
BE_SRC="backend/src"
FE_SRC="frontend/src"

MODE="${1:-all}"

deploy_backend() {
  echo ""
  echo "===== BACKEND DEPLOY ====="
  echo "[BE] Copying changed source files to VM..."
  "$GCLOUD" compute scp \
    "${BE_SRC}/heartbeat.service.ts" \
    "${BE_SRC}/scanner.service.ts" \
    "${BE_SRC}/nse.service.ts" \
    "${BE_SRC}/ema5.service.ts" \
    "${BE_SRC}/shoonya.service.ts" \
    "${BE_SRC}/paper.service.ts" \
    "${BE_SRC}/app.controller.ts" \
    "${BE_SRC}/app.module.ts" \
    "${BE_SRC}/candle-breakout.service.ts" \
    "${BE_SRC}/first5candle.service.ts" \
    "${BE_SRC}/gann-angle.service.ts" \
    "${BE_SRC}/gann.service.ts" \
    "${BE_SRC}/prisma.service.ts" \
    "${BE_SRC}/mock-test.ts" \
    "${BE_SRC}/price-gateway.service.ts" \
    "${VM}:/home/maddy/BuyStockOption_CE/backend/src/" \
    --zone "$ZONE" --project "$PROJECT"
  echo "[BE] Copying getAuthCode.py to VM..."
  "$GCLOUD" compute scp \
    "backend/getAuthCode.py" \
    "${VM}:/home/maddy/BuyStockOption_CE/backend/getAuthCode.py" \
    --zone "$ZONE" --project "$PROJECT"
  echo "[BE] Building Docker image on VM..."
  "$GCLOUD" compute ssh "$VM" --zone "$ZONE" --project "$PROJECT" \
    --command="cd /home/maddy/BuyStockOption_CE/backend && docker build -t shoonya-backend:latest . 2>&1 | tail -3"
  echo "[BE] Restarting container..."
  "$GCLOUD" compute ssh "$VM" --zone "$ZONE" --project "$PROJECT" \
    --command="nohup bash -c 'docker stop shoonya-app; docker rm shoonya-app; docker run -d --name shoonya-app --restart always -p 3001:3001 --env-file /home/maddy/vm-app.env --shm-size 256m shoonya-backend:latest' > /home/maddy/restart.log 2>&1 &"
  sleep 14
  "$GCLOUD" compute ssh "$VM" --zone "$ZONE" --project "$PROJECT" \
    --command="docker ps --format '{{.Names}} {{.Status}}' && docker logs shoonya-app --tail 5 2>&1"
  echo "[BE] Backend deployed OK"
}

deploy_frontend() {
  echo ""
  echo "===== FRONTEND DEPLOY ====="
  echo "[FE] Syncing source files to VM..."
  "$GCLOUD" compute ssh "$VM" --zone "$ZONE" --project "$PROJECT" \
    --command="mkdir -p /home/maddy/BuyStockOption_CE/frontend/src/constants"
  "$GCLOUD" compute scp \
    "${FE_SRC}/app/page.tsx" \
    "${VM}:/home/maddy/BuyStockOption_CE/frontend/src/app/page.tsx" \
    --zone "$ZONE" --project "$PROJECT"
  "$GCLOUD" compute scp \
    "${FE_SRC}/components/DashboardTab.tsx" \
    "${FE_SRC}/components/GannAngle.tsx" \
    "${FE_SRC}/components/Ema5Strategy.tsx" \
    "${FE_SRC}/components/CandleBreakout.tsx" \
    "${FE_SRC}/components/StrategyCalendar.tsx" \
    "${VM}:/home/maddy/BuyStockOption_CE/frontend/src/components/" \
    --zone "$ZONE" --project "$PROJECT"
  "$GCLOUD" compute scp \
    "${FE_SRC}/constants/universe.ts" \
    "${VM}:/home/maddy/BuyStockOption_CE/frontend/src/constants/universe.ts" \
    --zone "$ZONE" --project "$PROJECT"
  echo "[FE] Building Docker image on VM..."
  "$GCLOUD" compute ssh "$VM" --zone "$ZONE" --project "$PROJECT" \
    --command="cd /home/maddy/BuyStockOption_CE/frontend && docker build -t ${FE_IMAGE} . 2>&1 | tail -3"
  echo "[FE] Authenticating Docker to Artifact Registry..."
  "$GCLOUD" compute ssh "$VM" --zone "$ZONE" --project "$PROJECT" \
    --command="gcloud auth print-access-token | docker login -u oauth2accesstoken --password-stdin asia-south1-docker.pkg.dev 2>&1"
  echo "[FE] Pushing image to Artifact Registry..."
  "$GCLOUD" compute ssh "$VM" --zone "$ZONE" --project "$PROJECT" \
    --command="docker push ${FE_IMAGE} 2>&1 | tail -3"
  echo "[FE] Deploying Cloud Run service..."
  "$GCLOUD" compute ssh "$VM" --zone "$ZONE" --project "$PROJECT" \
    --command="gcloud run deploy shoonya-frontend --image ${FE_IMAGE} --region ${REGION} --project ${PROJECT} --quiet 2>&1 | tail -5"
  echo "[FE] Frontend deployed OK"
}

if [ "$MODE" = "be" ] || [ "$MODE" = "all" ]; then deploy_backend; fi
if [ "$MODE" = "fe" ] || [ "$MODE" = "all" ]; then deploy_frontend; fi

echo ""
echo "===== DEPLOY COMPLETE ====="
echo "Backend:  https://gargeealgo.co.in/api/health"
echo "Frontend: https://gargeealgo.co.in/terminal"
