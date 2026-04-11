#!/bin/bash
set -e

DOMAIN="35-200-239-116.sslip.io"

echo "=== Installing nginx and certbot ==="
apt-get install -y nginx certbot python3-certbot-nginx

echo "=== Writing nginx config ==="
cat > /etc/nginx/sites-available/trading-api << 'EOF'
server {
    listen 80;
    server_name 35-200-239-116.sslip.io;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 120s;
    }
}
EOF

ln -sf /etc/nginx/sites-available/trading-api /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo "=== Getting SSL certificate ==="
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --email ganeshkolhe25@gmail.com --redirect

echo "=== Verifying nginx ==="
systemctl status nginx --no-pager | head -5
echo "NGINX_HTTPS_SETUP_COMPLETE"
