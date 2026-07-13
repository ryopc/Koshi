# ============================================================================
# koshi – Terminal-Native Decentralized SNS
# Dockerfile
# License: MIT
# ============================================================================
# Multi-stage build for minimal production image.
# Stage 1: Install all dependencies (including dev) for building
# Stage 2: Production image with only runtime dependencies
# ============================================================================

# ============================================================================
# Stage 1: Dependencies
# ============================================================================
FROM node:20-alpine AS deps

WORKDIR /app

# Copy package files
COPY package.json ./

# Install dependencies
RUN npm install

# ============================================================================
# Stage 2: Production image
# ============================================================================
FROM node:20-alpine AS runner

WORKDIR /app

# Create non-root user for security
RUN addgroup --system --gid 1001 koshi && \
    adduser --system --uid 1001 koshi

# Copy production dependencies
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./

# Copy application source
COPY src/ ./src/
COPY bin/ ./bin/

# Set ownership
RUN chown -R koshi:koshi /app

# Switch to non-root user
USER koshi

# Expose API port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

# Start server
ENV NODE_ENV=production
CMD ["node", "bin/server.js"]
