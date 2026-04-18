#!/bin/bash
echo "=== Fetching /terminal HTML ==="
curl -s http://localhost:8080/terminal > /tmp/term.html

echo "=== JS chunk paths in HTML ==="
grep -o '/terminal/_next/static/chunks/[^"]*\.js' /tmp/term.html | head -3

echo "=== Testing first chunk via HTTPS ==="
CHUNK=$(grep -o '/terminal/_next/static/chunks/[^"]*\.js' /tmp/term.html | head -1)
echo "Chunk: $CHUNK"
CODE=$(curl -s -o /dev/null -w "%{http_code}" "https://gargeealgo.co.in${CHUNK}")
echo "HTTP Status: $CODE"
