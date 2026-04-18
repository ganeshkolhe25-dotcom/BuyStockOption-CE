#!/bin/bash
set -e

CONF="/etc/nginx/sites-enabled/gargeealgo"

echo "=== Patching /terminal location to use ^~ modifier ==="
sudo sed -i 's|location /terminal {|location ^~ /terminal {|' "$CONF"

# Verify patch applied
grep "location ^~ /terminal" "$CONF" && echo "Patch applied OK" || echo "ERROR: patch not found"

echo "=== Testing Nginx config ==="
sudo nginx -t

echo "=== Reloading Nginx ==="
sudo systemctl reload nginx

echo "NGINX_PATCHED_AND_RELOADED"
