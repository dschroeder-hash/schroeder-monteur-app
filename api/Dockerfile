# Build context: repository root.  docker build -f api/Dockerfile .
FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @schroeder/api... build \
 && pnpm --filter @schroeder/api deploy --prod --legacy /out \
 && cp -r api/dist api/drizzle /out/

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out .
USER node
EXPOSE 4000
# Worker: same image, command "node dist/worker.js"; migrations: "node dist/db/migrate.js"
CMD ["node", "dist/main.js"]
