FROM node:24-bookworm-slim AS build

RUN apt-get update -qq \
    && apt-get install -y -qq --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY .npmrc package.json package-lock.json tsconfig.json ./
RUN npm ci

COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim

WORKDIR /app

COPY package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

RUN mkdir -p /data
ENV NODE_ENV=production
ENV DATABASE_PATH=/data/maptap.db

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "const s = require('fs').statSync('/tmp/mappy-heartbeat'); process.exit(Date.now() - s.mtimeMs < 120000 ? 0 : 1)"

CMD ["node", "dist/index.js"]
