# Build context: repository root.  docker build -f app/Dockerfile --build-arg NEXT_PUBLIC_API_URL=... .
FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /repo
ARG NEXT_PUBLIC_AUTH_MODE=entra
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_ENTRA_CLIENT_ID
ARG NEXT_PUBLIC_ENTRA_TENANT_ID
ARG NEXT_PUBLIC_ENTRA_API_SCOPE
ARG NEXT_PUBLIC_BASE_PATH
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @schroeder/app... build

FROM node:22-alpine
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build /repo/app/.next/standalone ./
COPY --from=build /repo/app/.next/static ./app/.next/static
COPY --from=build /repo/app/public ./app/public
USER node
EXPOSE 3000
CMD ["node", "app/server.js"]
