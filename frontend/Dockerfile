FROM node:20-alpine

WORKDIR /app

# Install dependencies needed for Native builds if any
RUN apk add --no-cache libc6-compat

COPY package*.json ./
RUN npm ci

COPY . .

# Build Next.js
RUN npm run build

# Next.js collects completely static files automatically to /public and `.next/static`
EXPOSE 8080

ENV PORT=8080
ENV NODE_ENV=production

CMD ["npm", "start"]
