#!/bin/bash
# Deploy marketing website + Nginx + (optionally) rebuild frontend
# Run from your local machine: bash deploy-website.sh
set -e

VM_IP="35.200.239.116"
VM_USER="maddy"
SSH="ssh -i ~/.ssh/id_rsa_gcp ${VM_USER}@${VM_IP}"
SCP="scp -i ~/.ssh/id_rsa_gcp"

echo "=== [1/4] Uploading marketing website files ==="
$SSH "sudo mkdir -p /var/www/gargeealgo && sudo chown ${VM_USER}:${VM_USER} /var/www/gargeealgo"
$SCP website/index.html ${VM_USER}@${VM_IP}:/var/www/gargeealgo/index.html

echo "=== [2/4] Uploading nginx setup script ==="
$SCP vm-nginx-domain-setup.sh ${VM_USER}@${VM_IP}:/tmp/vm-nginx-domain-setup.sh
$SSH "chmod +x /tmp/vm-nginx-domain-setup.sh && sudo /tmp/vm-nginx-domain-setup.sh"

echo "=== [3/4] Rebuilding frontend with new API URL ==="
# Pack frontend (exclude node_modules and .next)
tar --exclude='frontend/node_modules' \
    --exclude='frontend/.next' \
    --exclude='frontend/.git' \
    -czf /tmp/fe-website-deploy.tar.gz frontend/

$SCP /tmp/fe-website-deploy.tar.gz ${VM_USER}@${VM_IP}:/tmp/fe-website-deploy.tar.gz
$SSH bash << 'REMOTE'
set -e
cd /tmp
tar -xzf fe-website-deploy.tar.gz
cp -r frontend /home/maddy/shoonya-app/frontend-new

# Rebuild and restart
cd /home/maddy/shoonya-app
cp -r frontend-new/. frontend-new-merged/ 2>/dev/null || true

# Rebuild docker image for frontend
docker build \
  -f frontend/Dockerfile \
  --build-arg NODE_ENV=production \
  -t shoonya-frontend:latest \
  ./frontend

docker stop shoonya-frontend-app 2>/dev/null || true
docker rm shoonya-frontend-app 2>/dev/null || true
docker run -d \
  --name shoonya-frontend-app \
  --restart unless-stopped \
  -p 8080:3000 \
  shoonya-frontend:latest

echo "Frontend container restarted."
REMOTE

echo "=== [4/4] Done ==="
echo ""
echo "Website:  https://gargeealgo.co.in"
echo "Terminal: https://gargeealgo.co.in/terminal"
echo "API:      https://gargeealgo.co.in/api"
echo ""
echo "ACTION NEEDED: Point your domain DNS A record:"
echo "  gargeealgo.co.in  →  35.200.239.116"
echo "  www.gargeealgo.co.in  →  35.200.239.116"
