# ============================================================================
# koshi – Terminal-Native Decentralized SNS
# Dockerfile (Optimized)
# ============================================================================

# Stage 1: Dependencies (production only)
FROM node:20-bookworm AS deps

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ sqlite3 libsqlite3-dev wget ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./

# devDependencies をインストールしない → node_modules レイヤーを軽量化
RUN npm ci --no-audit --no-fund --omit=dev

# Stage 2: Standalone server image (SQLite)
FROM node:20-bookworm AS standalone

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends wget ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN addgroup --system --gid 1001 koshi && \
    adduser --system --uid 1001 koshi

# 依存関係をデペンスステージからコピー（npm prune 不要）
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./

COPY src/ ./src/
COPY web/ ./web/

RUN mkdir -p /home/koshi/.config/koshi && \
    chown -R koshi:koshi /app /home/koshi

ENV HOME=/home/koshi

USER koshi

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

ENV NODE_ENV=production \
    PORT=3000 \
    LOG_LEVEL=error

CMD ["node", "src/local/server-standalone.js"]

# Stage 3: Production image (PostgreSQL-backed full server)
FROM node:20-bookworm AS runner

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends wget ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN addgroup --system --gid 1001 koshi && \
    adduser --system --uid 1001 koshi

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./

COPY src/ ./src/
COPY bin/ ./bin/
COPY web/ ./web/

RUN mkdir -p /home/koshi/.config/koshi && \
    chown -R koshi:koshi /app /home/koshi

ENV HOME=/home/koshi

USER koshi

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

ENV NODE_ENV=production \
    LOG_LEVEL=error

CMD ["node", "bin/server.js"]
