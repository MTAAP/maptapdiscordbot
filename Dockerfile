FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY .npmrc package.json package-lock.json tsconfig.json ./
RUN npm ci --ignore-scripts

COPY src ./src
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM node:24-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        chromium \
        fonts-liberation \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

RUN mkdir -p /data && chown node:node /data
ENV NODE_ENV=production
ENV DATABASE_PATH=/data/maptap.db
ENV CHROME_PATH=/usr/bin/chromium

USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "const s = require('fs').statSync('/tmp/mappy-heartbeat'); process.exit(Date.now() - s.mtimeMs < 120000 ? 0 : 1)"

CMD ["node", "dist/index.js"]
