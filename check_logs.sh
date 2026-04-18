#!/bin/bash
docker logs shoonya-app 2>&1 | grep -v "Max Trades" | grep -v "DEBUG" | tail -200
