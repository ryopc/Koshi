# ============================================================================
# koshi – Terminal-Native Decentralized SNS
# Dockerfile
# License: MIT
# ============================================================================
# Multi-stage build for minimal production image.
# Stage 1: Install all dependencies (including dev) for building
# Stage 2: Production image with only runtime dependencies (SQLite standalone)
# Stage 3: Production image (PostgreSQL-backed full server)
# ============================================================================

# ============================================================================
# Stage 1: Dependencies
# ============================================================================
# Use Debian (glibc) as the base — better-sqlite3 has no musl prebuilt binaries
FROM node:20-bookworm AS deps

WORKDIR /app

# Build tools for native modules (better-sqlite3) + wget for healthchecks
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ sqlite3 libsqlite3-dev wget ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package.json ./

# Install dependencies (prebuild-install finds glibc binaries)
RUN npm install --no-audit --no-fund

# ============================================================================
# Stage 2: Standalone server image (SQLite – no external database required)
# Build: docker build --target standalone -t koshi:standalone .
# Run:   docker run -p 3000:3000 koshi:standalone
# ============================================================================
FROM node:20-bookworm AS standalone

WORKDIR /app

# wget is needed for the healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends wget ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user for security
RUN addgroup --system --gid 1001 koshi && \
    adduser --system --uid 1001 koshi

COPY package.json ./

# Copy dependencies and trim to production-only
COPY --from=deps /app/node_modules ./node_modules
RUN npm prune --omit=dev --no-audit --no-fund

# Copy application source + web UI (served automatically if present)
COPY src/ ./src/
COPY web/ ./web/

# Set ownership (SQLite DB lives in ~/.config/koshi)
RUN mkdir -p /home/koshi/.config/koshi && \
    chown -R koshi:koshi /app /home/koshi

# Switch to non-root user
USER koshi

# Expose API port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

# Start standalone server
ENV NODE_ENV=production \
    PORT=3000 \
    LOG_LEVEL=warn
CMD ["node", "src/local/server-standalone.js"]

# ============================================================================
# Stage 3: Production image (PostgreSQL-backed full server)
# ============================================================================
FROM node:20-bookworm AS runner

WORKDIR /app

# wget is needed for the healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends wget ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user for security
RUN addgroup --system --gid 1001 koshi && \
    adduser --system --uid 1001 koshi

# Copy production dependencies
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./

# Copy application source
COPY src/ ./src/
COPY bin/ ./bin/
COPY web/ ./web/

# Set ownership
RUN mkdir -p /home/koshi/.config/koshi && \
    chown -R koshi:koshi /app /home/koshi

# Switch to non-root user
USER koshi

# Expose API port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

# Start server
ENV NODE_ENV=production \
    LOG_LEVEL=warn
CMD ["node", "bin/server.js"]