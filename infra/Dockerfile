# syntax=docker/dockerfile:1.7
#
# Production image for @budget-tracker/web.
#
# Build context is the repo root (see docker-compose.prod.yml: `context: ..`).
# Output is a Next.js standalone server bundle running as a non-root user.
#
# Stages:
#   deps     → cacheable dependency install (only package manifests change often)
#   builder  → full source + Next.js build (`pnpm --filter @budget-tracker/web build`)
#   runner   → minimal runtime layer copying only the standalone output

# ---- deps -------------------------------------------------------------------
FROM node:24-alpine AS deps
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /repo

# Root workspace files — Instance A's PR establishes these at the repo root.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Package manifests only. Keep this list in sync with real packages; new
# packages added under `packages/*` or `apps/*` need a matching line here so
# their workspace deps resolve during `pnpm install`.
COPY apps/web/package.json ./apps/web/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/core/package.json ./packages/core/package.json

RUN pnpm install --frozen-lockfile

# ---- builder ----------------------------------------------------------------
FROM node:24-alpine AS builder
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /repo

# Bring node_modules from the deps layer.
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /repo/packages/db/node_modules ./packages/db/node_modules
COPY --from=deps /repo/packages/core/node_modules ./packages/core/node_modules

# Now copy the actual source.
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @budget-tracker/web build

# ---- runner -----------------------------------------------------------------
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Next.js standalone output with monorepo layout: the server entry file is
# at apps/web/server.js, and the minimal node_modules tree is placed at the
# root. Static assets and public files must be copied over manually —
# `next build` does not include them in the standalone output.
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/public ./apps/web/public

USER nextjs
EXPOSE 3000

CMD ["node", "apps/web/server.js"]
