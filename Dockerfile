# Multi-stage Dockerfile for KK-LRMS
# Stage 1: Install ALL dependencies (dev included for build)
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Stage 2: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_BUILD_ID=dev
ARG NEXT_PUBLIC_BUILD_TIME
# Sub-path the app is served under (e.g. /sr-lrms). Inlined into the client
# bundle at build time, so it must be present here, not only at runtime.
ARG NEXT_PUBLIC_BASE_PATH=
# MOPH province code the deployment defaults to (32=Surin). Inlined at build.
ARG NEXT_PUBLIC_DEFAULT_PROVINCE_CODE=
ENV NEXT_PUBLIC_BUILD_ID=$NEXT_PUBLIC_BUILD_ID
ENV NEXT_PUBLIC_BUILD_TIME=$NEXT_PUBLIC_BUILD_TIME
ENV NEXT_PUBLIC_BASE_PATH=$NEXT_PUBLIC_BASE_PATH
ENV NEXT_PUBLIC_DEFAULT_PROVINCE_CODE=$NEXT_PUBLIC_DEFAULT_PROVINCE_CODE
ENV NEXT_TELEMETRY_DISABLED=1
ENV DOCKER_BUILD=true
RUN npm run build

# Stage 3: Production (minimal image)
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root user and data directory
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs && \
    mkdir -p /app/data && chown nextjs:nodejs /app/data

# Copy standalone output
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
