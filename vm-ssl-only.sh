#!/bin/bash
# Run this AFTER gargeealgo.co.in DNS A records point to 35.200.239.116
# Upload to VM and run: sudo bash vm-ssl-only.sh
set -e

DOMAIN="gargeealgo.co.in"
EMAIL="ganeshkolhe25@gmail.com"

echo "=== Obtaining SSL certificate for $DOMAIN ==="
certbot --nginx \
  -d "$DOMAIN" \
  -d "www.$DOMAIN" \
  --non-interactive \
  --agree-tos \
  --email "$EMAIL" \
  --redirect

echo "=== Reloading Nginx with SSL ==="
nginx -t && systemctl reload nginx

echo ""
echo "======================================"
echo " SSL SETUP COMPLETE"
echo " https://$DOMAIN          → marketing site"
echo " https://$DOMAIN/terminal → trading app"
echo " https://$DOMAIN/api/     → backend API"
echo "======================================"
