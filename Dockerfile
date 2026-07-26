# Stage 1: Install dependencies
FROM node:22-alpine AS deps

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
COPY web/package.json web/pnpm-lock.yaml ./web/

RUN pnpm install --frozen-lockfile
RUN cd web && pnpm install --frozen-lockfile

# Stage 2: Build
FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/web/node_modules ./web/node_modules

COPY . .

RUN pnpm typecheck
RUN pnpm exec tsc --outDir dist
RUN cd web && pnpm build

# Stage 3: Runner
FROM node:22-alpine AS runner

RUN apk add --no-cache git

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/web/node_modules ./web/node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/web/.next ./web/.next
COPY --from=builder /app/web/public ./web/public
COPY --from=builder /app/web/package.json ./web/package.json
COPY --from=builder /app/web/next.config.ts ./web/next.config.ts
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/shared ./shared

RUN npm install -g concurrently

EXPOSE 3000 3001

CMD ["concurrently", "--kill-others", "node dist/server/index.js", "cd web && npx next start -p 3001"]
