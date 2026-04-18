#!/bin/bash
# Runs ON the VM — extracts, builds, and starts the frontend Docker container
set -e

echo "=== Extracting frontend source ==="
sudo rm -rf /opt/shoonya-frontend
sudo mkdir -p /opt/shoonya-frontend
sudo chown maddy:maddy /opt/shoonya-frontend
tar -xzf /home/maddy/fe-website-deploy.tar.gz -C /opt/shoonya-frontend --strip-components=1
echo "Extracted OK"

echo "=== Building Docker image (this takes ~3-5 min) ==="
cd /opt/shoonya-frontend
docker build --no-cache -t shoonya-frontend .
echo "Image built OK"

echo "=== Starting frontend container on port 8080 ==="
docker stop shoonya-frontend-app 2>/dev/null || true
docker rm   shoonya-frontend-app 2>/dev/null || true
docker run -d \
  --name shoonya-frontend-app \
  --restart always \
  -p 8080:8080 \
  -e NODE_ENV=production \
  shoonya-frontend
echo "Frontend container started OK"

echo "=== Verifying ==="
sleep 6
docker ps | grep shoonya-frontend-app
docker logs shoonya-frontend-app --tail 15
echo "FRONTEND_SETUP_COMPLETE"
