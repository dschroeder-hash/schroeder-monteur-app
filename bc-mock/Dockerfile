# Build context: repository root.  docker build -f bc-mock/Dockerfile .
FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @schroeder/bc-mock... build \
 && pnpm --filter @schroeder/bc-mock deploy --prod --legacy /out && cp -r bc-mock/dist /out/

FROM node:22-alpine
WORKDIR /app
COPY --from=build /out .
USER node
EXPOSE 4100
CMD ["node", "dist/main.js"]
