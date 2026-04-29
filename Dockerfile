# ── Stage 1: install production dependencies ───────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ── Stage 2: runtime image ────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

# Create a non-root user for least-privilege execution
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copy only the pruned dependency tree from the deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application source (see .dockerignore for exclusions)
COPY . .

# Ensure the data directory exists and is writable by the app user
# (the host/EFS mount at /data will override this at runtime)
RUN mkdir -p /data && chown appuser:appgroup /data

USER appuser

EXPOSE 3000

# Liveness probe — fails if the process hangs or Express stops responding
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "server.js"]
