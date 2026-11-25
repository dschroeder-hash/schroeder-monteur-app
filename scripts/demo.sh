#!/usr/bin/env bash
# Demo of the complete Monteur-App with test data – no Azure, no Business Central needed.
#   App with test login:  http://localhost:3000   (choose a persona: Monteur, Meister, Lager, Personal, Admin)
# Requires: Node 22, pnpm 9, a local PostgreSQL 16 (admin URL in PG_ADMIN_URL).
# Usage: scripts/demo.sh            (builds, creates the database "monteur_demo" fresh, starts everything)
#        scripts/demo.sh --no-build (starts again without building)
set -euo pipefail
cd "$(dirname "$0")/.."
PG_ADMIN_URL="${PG_ADMIN_URL:-postgres://postgres:postgres@localhost:5432/postgres}"
HOSTPART="$(node -e "const u=new URL(process.argv[1]);console.log(u.host)" "$PG_ADMIN_URL")"
OWNER_URL="$(node -e "const u=new URL(process.argv[1]);u.pathname='/monteur_demo';console.log(u.toString())" "$PG_ADMIN_URL")"
LOGS=".demo-logs"; mkdir -p "$LOGS"

if [ "${1:-}" != "--no-build" ]; then
  echo "▶ Build (einige Minuten) …"
  pnpm install --frozen-lockfile >/dev/null
  pnpm turbo build --filter='!@schroeder/app' >"$LOGS/build.log" 2>&1
  (cd app && NEXT_PUBLIC_AUTH_MODE=dev NEXT_PUBLIC_API_URL= API_PROXY_TARGET=http://localhost:4000 pnpm build) >>"$LOGS/build.log" 2>&1
fi

echo "▶ Datenbank monteur_demo mit Testdaten …"
(cd api && node --input-type=module -e "
import pg from 'pg';
import { runMigrations } from './dist/db/migrate.js';
import { createDb } from './dist/db/client.js';
import { seedDev } from './dist/seed/dev-seed.js';
const admin = new pg.Client({ connectionString: '$PG_ADMIN_URL' });
await admin.connect();
await admin.query('drop database if exists monteur_demo with (force)');
await admin.query('create database monteur_demo');
await admin.end();
await runMigrations('$OWNER_URL');
const o = new pg.Client({ connectionString: '$OWNER_URL' });
await o.connect();
await o.query(\`do \\\$\\\$ begin
  if not exists (select 1 from pg_roles where rolname = 'monteur_api_demo') then create role monteur_api_demo login password 'demo'; end if;
  if not exists (select 1 from pg_roles where rolname = 'monteur_worker_demo') then create role monteur_worker_demo login password 'demo'; end if;
end \\\$\\\$\`);
await o.query('grant monteur_app to monteur_api_demo; grant monteur_worker to monteur_worker_demo');
await o.query('grant connect on database monteur_demo to monteur_api_demo, monteur_worker_demo');
await o.end();
const { db, pool } = createDb('$OWNER_URL', 1);
await seedDev(db, new Date());
await pool.end();
")

for p in 3000 4000 4001 4100; do (fuser -k "$p/tcp" 2>/dev/null || true); done
echo "▶ Start …"
PORT=4100 nohup node bc-mock/dist/main.js >"$LOGS/bc-mock.log" 2>&1 &
APP_ENV=dev PORT=4000 AUTH_MODE=dev DEV_AUTH_SECRET=demo-secret-demo-secret-demo-secret-1234 \
  DATABASE_URL="postgres://monteur_api_demo:demo@$HOSTPART/monteur_demo" CORS_ORIGINS=http://localhost:3000 \
  PUBLIC_API_URL=http://localhost:3000 LOCAL_STORAGE_DIR=/tmp/monteur-demo-uploads \
  CART_AI="${CART_AI:-$([ -n "${ANTHROPIC_API_KEY:-}" ] && echo claude || echo mock)}" \
  PARTS_CATALOGS='[{"id":"agco","label":"AGCO (Fendt, Valtra, Massey Ferguson)","brands":["FENDT","VALTRA","MF","AGCO"],"url":"https://parts.agcocorp.com/de/de/dealers/redirect/schroeder11","mode":"iframe"},{"id":"testkatalog","label":"Testkatalog","brands":[],"url":"/v1/dev/partsbook?HOOK_URL={HOOK_URL}","mode":"iframe"}]' \
  nohup node api/dist/main.js >"$LOGS/api.log" 2>&1 &
APP_ENV=dev BC_MODE=mock BC_API_BASE_URL=http://localhost:4100/api BC_TOKEN_URL=http://localhost:4100/oauth2/token \
  WORKER_HEALTH_PORT=4001 DATABASE_URL="postgres://monteur_worker_demo:demo@$HOSTPART/monteur_demo" \
  nohup node api/dist/worker.js >"$LOGS/worker.log" 2>&1 &
PORT=3000 HOSTNAME=0.0.0.0 nohup node app/.next/standalone/app/server.js >"$LOGS/app.log" 2>&1 &

for _ in $(seq 1 60); do curl -sf http://localhost:3000/health/live >/dev/null 2>&1 && break; sleep 1; done
echo "✔ Monteur-App läuft: http://localhost:3000  (Logs in $LOGS/)"
