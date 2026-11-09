# syntax=docker/dockerfile:1
# Game server image: builds the esbuild bundle, then installs only production
# dependencies for the native/external packages (pg, argon2, pino, monitor).
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo

# Workspace manifests first so the dependency layer caches independently.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
COPY apps/admin/package.json apps/admin/
COPY packages/shared/package.json packages/shared/
COPY packages/data/package.json packages/data/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @jadethrone/server build

FROM node:24-alpine AS runtime
RUN corepack enable
WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
COPY apps/admin/package.json apps/admin/
COPY packages/shared/package.json packages/shared/
COPY packages/data/package.json packages/data/
RUN pnpm install --prod --frozen-lockfile

COPY --from=build /repo/apps/server/dist ./apps/server/dist
COPY --from=build /repo/apps/server/drizzle ./apps/server/drizzle

# Local workspace sources are only needed for type/runtime imports that the
# bundle did not inline; production uses the bundle.
COPY --from=build /repo/packages/shared/src ./packages/shared/src
COPY --from=build /repo/packages/data/src ./packages/data/src
COPY --from=build /repo/packages/data/maps ./packages/data/maps

ENV NODE_ENV=production
WORKDIR /app/apps/server
EXPOSE 2567
USER node
CMD ["node", "dist/index.cjs"]
