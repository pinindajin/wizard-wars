FROM oven/bun:1.2-slim AS deps
WORKDIR /app
# prisma generate reads prisma.config.ts; DATABASE_URL must be present even
# though generate never connects — it's referenced by the config loader.
ENV DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build"
COPY package.json bun.lock* ./
COPY prisma ./prisma/
RUN bun install --frozen-lockfile
RUN bunx prisma generate

FROM oven/bun:1.2-slim AS builder
WORKDIR /app
# NODE_ENV=production avoids a known Next.js 16 bug where /_global-error
# prerender crashes with "useContext null" if NODE_ENV is unset/development.
ARG NEXT_PUBLIC_COLYSEUS_URL=""
ENV NODE_ENV=production
ENV DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build"
ENV NEXT_PUBLIC_COLYSEUS_URL=${NEXT_PUBLIC_COLYSEUS_URL}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run build

FROM oven/bun:1.2-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./
COPY --from=builder /app/server.ts ./
COPY --from=builder /app/src ./src
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/tsconfig.json ./
COPY --from=builder /app/next.config.ts ./
COPY --from=builder /app/prisma.config.ts ./
COPY --from=builder /app/middleware.ts ./

EXPOSE 3000 3001

# Only the configured migration owner should run Prisma migrations.
CMD ["sh", "-c", "set -e; if [ -n \"${WW_REALTIME_ADMIN_TOKEN_FROM_COMPOSE:-}\" ]; then export WW_REALTIME_ADMIN_TOKEN=\"${WW_REALTIME_ADMIN_TOKEN_FROM_COMPOSE}\"; fi; if [ \"${RUN_MIGRATIONS:-false}\" = \"true\" ]; then bunx prisma migrate deploy; fi; case \"${WW_SERVER_MODE:-single}\" in web) exec bun run start:web ;; realtime) exec bun run start:realtime ;; *) exec bun run start ;; esac"]
