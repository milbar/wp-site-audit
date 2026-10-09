FROM node:20-bookworm-slim

# Chromium a GDPR/süti-méréshez és a Lighthouse-hoz (a puppeteer-core nem tölt le sajátot)
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-liberation fonts-noto-color-emoji ca-certificates hunspell hunspell-hu default-jre-headless \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4580 \
    DATA_DIR=/data \
    CHROME_PATH=/usr/bin/chromium \
    CHROME_FLAGS=--disable-dev-shm-usage

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY . .

RUN mkdir -p /data && chown -R node:node /data /app
USER node

VOLUME /data
EXPOSE 4580

CMD ["node", "server.mjs"]
