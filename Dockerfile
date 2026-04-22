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

EXPOSE 3000

# Run migrations at container startup (DATABASE_URL is injected by Render at runtime).
CMD ["sh", "-c", "bunx prisma migrate deploy && bun run start"]
