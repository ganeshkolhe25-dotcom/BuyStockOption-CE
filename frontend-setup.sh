#!/bin/bash
set -e
echo "=== [1/4] Extracting frontend code ==="
mkdir -p /opt/shoonya-frontend
tar -xzf /home/maddy/shoonya-frontend.tar.gz -C /opt/shoonya-frontend
echo "Code extracted OK"

echo "=== [2/4] Building frontend Docker image ==="
cd /opt/shoonya-frontend/frontend
docker build --no-cache -t shoonya-frontend .
echo "Image built OK"

echo "=== [3/4] Starting frontend container ==="
docker stop shoonya-frontend-app 2>/dev/null || true
docker rm shoonya-frontend-app 2>/dev/null || true
docker run -d \
  --name shoonya-frontend-app \
  --restart always \
  -p 8080:8080 \
  shoonya-frontend
echo "Container started OK"

echo "=== [4/4] Verifying ==="
sleep 5
docker ps
docker logs shoonya-frontend-app --tail 10
echo "FRONTEND_SETUP_COMPLETE"
