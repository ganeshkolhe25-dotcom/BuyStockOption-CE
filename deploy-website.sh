#!/bin/bash
# Deploy marketing website, Nginx, and frontend container to GCP VM
# Usage: bash deploy-website.sh
# Requires: gcloud CLI authenticated
set -e

GCLOUD="gcloud"
PROJECT="project-2f647b6c-d2ba-4001-970"
ZONE="asia-south1-b"
VM="shoonya-trader"
GC="$GCLOUD compute --project $PROJECT"

echo "======================================================"
echo "  Gargee Algo — Website + Frontend Deploy"
echo "======================================================"

# ── Step 1: Upload marketing website ─────────────────────
echo ""
echo "=== [1/5] Uploading marketing website ==="
$GC scp website/index.html ${VM}:/home/maddy/index.html --zone $ZONE
$GC ssh $VM --zone $ZONE --command \
  "sudo mkdir -p /var/www/gargeealgo && sudo cp /home/maddy/index.html /var/www/gargeealgo/index.html && sudo chown -R www-data:www-data /var/www/gargeealgo"
echo "Marketing site uploaded OK"

# ── Step 2: Upload & run Nginx setup ─────────────────────
echo ""
echo "=== [2/5] Setting up Nginx + SSL ==="
$GC scp vm-nginx-domain-setup.sh ${VM}:/home/maddy/vm-nginx-domain-setup.sh --zone $ZONE
$GC ssh $VM --zone $ZONE --command \
  "chmod +x /home/maddy/vm-nginx-domain-setup.sh && sudo /home/maddy/vm-nginx-domain-setup.sh"
echo "Nginx + SSL configured OK"

# ── Step 3: Pack and upload frontend source ───────────────
echo ""
echo "=== [3/5] Packing frontend source ==="
rm -f /tmp/fe-website-deploy.tar.gz
tar --exclude='frontend/node_modules' \
    --exclude='frontend/.next' \
    --exclude='frontend/.git' \
    -czf /tmp/fe-website-deploy.tar.gz frontend/
echo "Packed: $(du -sh /tmp/fe-website-deploy.tar.gz | cut -f1)"

$GC scp /tmp/fe-website-deploy.tar.gz ${VM}:/home/maddy/fe-website-deploy.tar.gz --zone $ZONE
echo "Frontend source uploaded OK"

# ── Step 4: Build frontend Docker image on VM ─────────────
echo ""
echo "=== [4/5] Building frontend image on VM ==="
$GC scp vm-frontend-setup.sh ${VM}:/home/maddy/vm-frontend-setup.sh --zone $ZONE
$GC ssh $VM --zone $ZONE --command "chmod +x /home/maddy/vm-frontend-setup.sh && bash /home/maddy/vm-frontend-setup.sh"
echo "Frontend container running OK"

# ── Step 5: Reload Nginx ──────────────────────────────────
echo ""
echo "=== [5/5] Reloading Nginx ==="
$GC ssh $VM --zone $ZONE --command "sudo nginx -t && sudo systemctl reload nginx"

echo ""
echo "======================================================"
echo "  DEPLOY COMPLETE"
echo "  https://gargeealgo.co.in            → marketing site"
echo "  https://gargeealgo.co.in/terminal   → trading app"
echo "  https://gargeealgo.co.in/api/       → backend API"
echo "======================================================"
echo ""
echo "NOTE: DNS A records must point to 35.200.239.116"
echo "  gargeealgo.co.in      → 35.200.239.116"
echo "  www.gargeealgo.co.in  → 35.200.239.116"
