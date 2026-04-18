#!/bin/bash
set -e
CONF="/etc/nginx/sites-enabled/gargeealgo"

echo "=== Removing separate /terminal/_next/ block (^~ /terminal covers it) ==="
# Delete the block from 'location /terminal/_next/' to its closing brace
sudo python3 - <<'PYEOF'
import re, subprocess

conf = open("/etc/nginx/sites-enabled/gargeealgo").read()

# Remove the /terminal/_next/ location block entirely
conf = re.sub(
    r'\s*# Next\.js static assets.*?location /terminal/_next/.*?\}',
    '',
    conf,
    flags=re.DOTALL
)

open("/etc/nginx/sites-enabled/gargeealgo", "w").write(conf)
print("Block removed OK")
PYEOF

echo "=== Remaining location blocks ==="
grep "location" "$CONF"

echo "=== Testing config ==="
sudo nginx -t

echo "=== Reloading Nginx ==="
sudo systemctl reload nginx

echo "NGINX_PATCH2_DONE"
