# Multi-stage build for Guided Shopping (Vite frontend + Express backend)
# Mirrors the Timeline deployment pattern.

# ---------- Builder ----------
FROM node:20-alpine AS builder

WORKDIR /app

# Copy root package.json (frontend)
COPY package.json package-lock.json ./
RUN npm ci

# Copy server package.json + lockfile
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci

# Copy the rest
COPY . .

# Build frontend (Vite → /app/dist)
RUN npm run build

# Build backend (tsc → /app/server/dist)
RUN cd server && npm run build

# ---------- Runtime ----------
FROM node:20-alpine

WORKDIR /app

# Frontend static build
COPY --from=builder /app/dist ./dist

# Backend compiled output + dependencies
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/server/package.json ./server/package.json
COPY --from=builder /app/server/node_modules ./server/node_modules

# server/index.ts resolves /app/dist relative to itself
WORKDIR /app/server

EXPOSE 4001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:4001/health || exit 1

ENV NODE_ENV=production
ENV PORT=4001

CMD ["node", "dist/index.js"]
