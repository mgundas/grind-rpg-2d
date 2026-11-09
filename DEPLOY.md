# Jade Throne — deployment guide

This guide is for running the game on a single machine (a VPS, a home server or
a Raspberry Pi) with Docker. It assumes no prior Docker knowledge: every
command is copy-pasteable.

## What runs where

```
browser ──HTTP/WebSocket──► web (nginx :80) ──► server (Node :2567) ──► postgres
                              │
                              ├─ /            game client (static files)
                              ├─ /admin/      admin panel (static files)
                              ├─ /api/        REST API
                              ├─ /matchmake/  Colyseus matchmaking
                              └─ /<pid>/<rid> Colyseus room WebSockets
```

Three containers:

| Service | Image | Purpose |
| --- | --- | --- |
| `postgres` | `postgres:18-alpine` | accounts, characters, items, logs |
| `server` | built from `docker/server.Dockerfile` | game + REST + WebSockets |
| `web` | built from `docker/web.Dockerfile` | nginx, client and admin |

The server port is **not** published to the host. Browsers only talk to
`web`; the server is reachable on the internal Docker network.

## Quick start (one command after the first build)

```bash
git clone <your-repo> jade-throne
cd jade-throne
cp .env.example .env
```

Edit `.env` and set at least:

```bash
POSTGRES_PASSWORD=<long random password>
JWT_ACCESS_SECRET=<at least 32 random characters>
JWT_REFRESH_SECRET=<at least 32 random characters>
SEED_ADMIN_PASSWORD=<admin panel password>
```

Generate secrets on Linux/macOS:

```bash
openssl rand -base64 48
```

Then start everything:

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Open:

- game: `http://<host>:8080/`
- admin: `http://<host>:8080/admin/`

The first start applies the committed database migrations automatically. Create
the admin account once:

```bash
docker compose -f docker-compose.prod.yml exec server node dist/seed.cjs
```

Log in to the admin panel with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` from
`.env`.

Check health:

```bash
curl http://localhost:8080/api/health
# {"status":"ok","db":"up",...}
```

## Environment variables

Only the ones that matter in production are listed; `.env.example` documents
every setting.

| Variable | Required | Notes |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | yes | Compose refuses to start without it. |
| `JWT_ACCESS_SECRET` | yes | ≥32 chars, no dev placeholder. |
| `JWT_REFRESH_SECRET` | yes | ≥32 chars, no dev placeholder. |
| `SEED_ADMIN_PASSWORD` | yes | Used by the seed command. |
| `WEB_PORT` | no | Host port for nginx, default `8080`. |
| `PUBLIC_SERVER_URL` | no | Default `same-origin`: the browser talks to the nginx host. Set a full `wss://game.example.com` URL only if the game server is exposed on its own hostname. |
| `TRUST_PROXY` | no | Number of proxy hops: `1` for the bundled nginx, `2` behind nginx-proxy-manager (default `2` in the compose file). Set `0` only if clients reach the server directly. |
| `LOG_LEVEL` | no | `info` by default. |
| `POSTGRES_USER` / `POSTGRES_DB` | no | Default `jade` / `jade_throne`. |

Never commit `.env`. It contains the database password and token secrets.

## Putting it behind nginx-proxy-manager

If the host already runs nginx-proxy-manager (NPM), point a Proxy Host at the
web container:

| Field | Value |
| --- | --- |
| Domain Names | `game.example.com` |
| Scheme | `http` |
| Forward Hostname / IP | the Docker host IP (or `web` if NPM shares the compose network) |
| Forward Port | `8080` (or your `WEB_PORT`) |
| Websockets Support | **on** |
| Block Common Exploits | on |
| SSL | request a certificate in NPM |

NPM's "Websockets Support" toggle sends the `Upgrade` and `Connection` headers
that Colyseus needs. If WebSockets still fail (the browser reports 400/426 or
the client loops on "connecting"), verify that the proxy host has WebSockets
enabled and that no upstream timeout shorter than an hour is set.

Required nginx behaviour, for reference if you write your own config:

```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_read_timeout 3600s;
```

The bundled `docker/nginx.conf` already does this for `/matchmake/`,
`/colyseus` and room WebSocket paths.

### Separate game hostname instead of same-origin

If you want `wss://game.example.com` to hit the server directly:

1. Set `PUBLIC_SERVER_URL=wss://game.example.com` in `.env`.
2. Rebuild the web image so Vite bakes it in:
   `docker compose -f docker-compose.prod.yml up -d --build web`.
3. In NPM, proxy `game.example.com` to the server's **internal** address and
   port (`server:2567`) on the compose network, or publish `2567` and forward
   to the host. Keep WebSockets enabled.

## Updates

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

Migrations run before the new server starts listening. A failed migration
leaves the old container running until you investigate; check
`docker compose -f docker-compose.prod.yml logs server`.

## Backups

Database dump:

```bash
docker compose -f docker-compose.prod.yml exec postgres \
  pg_dump -U jade jade_throne > jade-throne-$(date +%F).sql
```

Restore (stop the game server first to avoid writes):

```bash
docker compose -f docker-compose.prod.yml stop server
cat jade-throne-2026-11-09.sql | \
  docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U jade -d jade_throne
docker compose -f docker-compose.prod.yml start server
```

The `pgdata` named volume holds the database; back up the dump, not the volume,
so restores work across Postgres minor versions.

## Logs and shutdown

```bash
docker compose -f docker-compose.prod.yml logs -f server
docker compose -f docker-compose.prod.yml ps
```

`docker compose stop` sends `SIGTERM`. The server saves every dirty character,
announces the shutdown in game, closes rooms and exits; do not use
`docker kill` unless the process is wedged.

## Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| `POSTGRES_PASSWORD is required` on `up` | Set it in `.env`. |
| Server exits with "placeholder secrets" | Generate real 32+ char JWT secrets. |
| Game loads but stays "connecting" | WebSockets are not proxied. Enable WebSockets in NPM; confirm `/matchmake/` and room paths reach `server:2567`. |
| Admin shows 404 at `/admin` | Use the trailing slash: `/admin/`. |
| `502 Bad Gateway` | Server is still migrating or unhealthy: check `logs server` and `/api/health`. |
| Characters missing after update | Restore the dump, then check the migration logs. |
| High memory on a small Pi | Reduce population per channel in `packages/shared/src/constants.ts` and rebuild; the server itself is lightweight (~150 MB RSS with a channel of players). |

## Operational limits (known)

- One game-server process. The admin live bus, admin runtime metrics and room
  state are in-process; running several server replicas needs Redis presence
  and a shared admin bus (out of scope for this phase).
- Postgres is not published to the host. To inspect it, use
  `docker compose exec postgres psql -U jade -d jade_throne`.
- The bundled nginx serves plain HTTP. TLS terminates at your reverse proxy.
- The 150-bot load test (`pnpm verify:phase10-load`) targets a dev server and
  writes temporary `loadbot_*` accounts; it refuses to run with
  `NODE_ENV=production`.
