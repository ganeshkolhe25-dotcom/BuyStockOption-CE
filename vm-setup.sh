#!/bin/bash
set -e
echo "=== [1/5] Installing Docker ==="
apt-get update -y
apt-get install -y docker.io
systemctl enable docker
systemctl start docker
usermod -aG docker maddy
docker --version
echo "Docker installed OK"

echo "=== [2/5] Extracting backend code ==="
mkdir -p /opt/shoonya
tar -xzf /home/maddy/shoonya-backend.tar.gz -C /opt/shoonya
cp /home/maddy/vm-app.env /opt/shoonya/.env
echo "Code extracted OK"

echo "=== [3/5] Building Docker image ==="
cd /opt/shoonya
docker build -t shoonya-backend .
echo "Image built OK"

echo "=== [4/5] Starting container ==="
docker stop shoonya-app 2>/dev/null || true
docker rm shoonya-app 2>/dev/null || true
docker run -d \
  --name shoonya-app \
  --restart always \
  -p 3001:3001 \
  --env-file /opt/shoonya/.env \
  shoonya-backend
echo "Container started OK"

echo "=== [5/5] Verifying ==="
sleep 5
docker ps
docker logs shoonya-app --tail 20
echo "SETUP_COMPLETE"
