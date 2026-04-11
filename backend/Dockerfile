FROM node:20-slim

# Install system deps: OpenSSL for Prisma, Chromium + Python for auto-connect
RUN apt-get update -y && apt-get install -y \
    openssl \
    python3 \
    python3-pip \
    chromium \
    chromium-driver \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# Install Python selenium deps
RUN pip3 install selenium pyotp requests --break-system-packages

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/
RUN npm install

COPY . .

RUN npm run build

EXPOSE 8080

CMD ["node", "dist/main.js"]
