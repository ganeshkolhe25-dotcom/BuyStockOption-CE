#!/bin/bash
set -e

DOMAIN="35-200-239-116.sslip.io"

echo "=== Updating nginx for backend (3001) + frontend (8080) ==="
cat > /etc/nginx/sites-available/trading-api << 'EOF'
server {
    listen 80;
    server_name 35-200-239-116.sslip.io;

    # Backend API — all trading/scan/settings endpoints
    location ~ ^/(scan|settings|shoonya|auth|portfolio|heartbeat|trade|health) {
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

    # Frontend — everything else (Next.js)
    location / {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 60s;
    }
}
EOF

nginx -t
systemctl reload nginx

# Re-apply SSL cert so HTTPS (443) is never lost after a config rewrite
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --email ganeshkolhe25@gmail.com --redirect 2>&1 | tail -5

echo "=== Nginx updated OK ==="
systemctl status nginx --no-pager | head -3
