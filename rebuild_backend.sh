#!/bin/bash
set -e
echo "=== Extracting new backend ==="
rm -rf /opt/shoonya
mkdir -p /opt/shoonya
tar -xzf /home/maddy/shoonya-backend.tar.gz -C /opt/shoonya --strip-components=1
cp /home/maddy/vm-app.env /opt/shoonya/.env
echo "Extracted. Checking key files..."
grep -n "secretCode" /opt/shoonya/src/app.controller.ts | head -5 || echo "WARNING: secretCode not found in controller"
echo "=== Building image (no-cache) ==="
cd /opt/shoonya
docker build --no-cache -t shoonya-backend:new .
echo "=== Replacing container ==="
docker stop shoonya-app 2>/dev/null || true
docker rm shoonya-app 2>/dev/null || true
docker run -d \
  --name shoonya-app \
  --restart always \
  -p 3001:3001 \
  --env-file /opt/shoonya/.env \
  shoonya-backend:new
echo "=== Waiting 8s for startup ==="
sleep 8
docker logs shoonya-app --tail 10
echo "REBUILD_DONE"
