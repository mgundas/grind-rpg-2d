# syntax=docker/dockerfile:1
# Static client + admin build behind nginx. VITE_SERVER_URL=same-origin makes
# the browser talk to the nginx host, which proxies matchmaking/WebSockets.
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
COPY apps/admin/package.json apps/admin/
COPY packages/shared/package.json packages/shared/
COPY packages/data/package.json packages/data/
RUN pnpm install --frozen-lockfile

COPY . .
ARG VITE_SERVER_URL=same-origin
ENV VITE_SERVER_URL=$VITE_SERVER_URL
RUN pnpm --filter @jadethrone/client build && pnpm --filter @jadethrone/admin build

FROM nginx:1.27-alpine AS runtime
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/client/dist /usr/share/nginx/html
COPY --from=build /repo/apps/admin/dist /usr/share/nginx/html/admin
EXPOSE 80
