#!/bin/bash
set -e

DOMAIN="gargeealgo.co.in"
EMAIL="ganeshkolhe25@gmail.com"
SITE_ROOT="/var/www/gargeealgo"

echo "=== Installing nginx and certbot ==="
apt-get update -y
apt-get install -y nginx certbot python3-certbot-nginx

echo "=== Creating website directory ==="
mkdir -p "$SITE_ROOT"

echo "=== Writing nginx config (HTTP only first, for certbot) ==="
cat > /etc/nginx/sites-available/gargeealgo << EOF
server {
    listen 80;
    server_name $DOMAIN www.$DOMAIN;

    # Marketing website root
    root $SITE_ROOT;
    index index.html;

    # Marketing site — serve static files
    location = / {
        try_files /index.html =404;
    }
    location ~* \.(html|css|js|png|jpg|svg|ico|woff2?)$ {
        root $SITE_ROOT;
        expires 7d;
        add_header Cache-Control "public";
    }

    # ^~ prevents regex locations from intercepting /terminal/_next/*.js assets
    location ^~ /terminal {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 120s;
    }

    # Next.js static assets (served under /terminal/_next/ due to basePath)
    location /terminal/_next/ {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Backend API (NestJS on port 3001)
    location /api/ {
        proxy_pass http://localhost:3001/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 120s;
    }

    # WebSocket endpoint for live data
    location /ws {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host \$host;
        proxy_read_timeout 3600s;
    }
}
EOF

echo "=== Enabling site ==="
ln -sf /etc/nginx/sites-available/gargeealgo /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo "=== Obtaining SSL certificate ==="
certbot --nginx \
  -d "$DOMAIN" \
  -d "www.$DOMAIN" \
  --non-interactive \
  --agree-tos \
  --email "$EMAIL" \
  --redirect

echo "=== Verifying nginx ==="
systemctl status nginx --no-pager | head -8

echo ""
echo "======================================"
echo " SETUP COMPLETE"
echo " https://$DOMAIN            → marketing site"
echo " https://$DOMAIN/terminal   → trading app"
echo " https://$DOMAIN/api/       → backend API"
echo " https://$DOMAIN/ws         → WebSocket"
echo "======================================"
