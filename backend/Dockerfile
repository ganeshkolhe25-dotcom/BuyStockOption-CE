FROM node:20-slim

ENV DEBIAN_FRONTEND=noninteractive

# Essential packages only — no Chromium (QuickAuth uses REST, no browser needed)
RUN apt-get update -y && apt-get install -y --no-install-recommends \
    openssl \
    python3 \
    python3-pip && \
    rm -rf /var/lib/apt/lists/*

# Install Python deps for QuickAuth (pyotp/requests) only — no selenium
RUN pip3 install pyotp requests --break-system-packages

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/
RUN npm install

COPY . .

RUN npm run build

EXPOSE 8080

CMD ["node", "dist/main.js"]
