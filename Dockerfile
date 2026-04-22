FROM oven/bun:1.2-slim AS base

WORKDIR /app

# Install dependencies
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# Copy source
COPY . .

# Generate Prisma client
RUN bunx prisma generate

# Build Next.js
RUN bun run build

# Production image
FROM oven/bun:1.2-slim AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY --from=base /app/.next ./.next
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/package.json ./package.json
COPY --from=base /app/public ./public
COPY --from=base /app/prisma ./prisma
COPY --from=base /app/server.ts ./server.ts
COPY --from=base /app/src ./src
COPY --from=base /app/tsconfig.json ./tsconfig.json
COPY --from=base /app/next.config.ts ./next.config.ts

EXPOSE 3000

CMD ["bun", "run", "start"]
