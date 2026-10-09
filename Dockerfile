# syntax=docker/dockerfile:1

# Stage 1: install production dependencies only, from the lockfile.
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Stage 2: runtime image with no build tooling, npm cache or dev dependencies.
FROM node:20-alpine
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app

# Files stay owned by root: the app user can read its code but not modify it.
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY db ./db

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q --spider "http://127.0.0.1:${PORT}/healthz" || exit 1

# Exec form: node is PID 1 and receives SIGTERM directly (no npm or shell in between).
CMD ["node", "src/server.js"]
