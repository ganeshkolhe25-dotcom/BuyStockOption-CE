FROM node:20-slim

ENV DEBIAN_FRONTEND=noninteractive

# System deps: OpenSSL for Prisma, Chromium + Python for auto-connect
RUN apt-get update -y && apt-get install -y --no-install-recommends \
    openssl \
    python3 \
    python3-pip \
    chromium \
    chromium-driver && \
    rm -rf /var/lib/apt/lists/*

# Python deps: selenium for Chrome login, pyotp/requests for QuickAuth
RUN pip3 install selenium pyotp requests --break-system-packages

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/
RUN npm install

COPY . .

# Always force a full TypeScript compile — prevents incremental cache from serving stale dist/
RUN rm -rf dist && npm run build

EXPOSE 8080

CMD ["node", "dist/main.js"]
