#!/usr/bin/env bash
# Codespaces: starts the demo automatically after each start of the codespace (postStartCommand) and writes the
# address of the app to the log. Log: /tmp/demo.log
set -u
cd "$(dirname "$0")/.."
URL="https://${CODESPACE_NAME:-localhost}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
{
  echo "▶ Demo startet automatisch (erster Start ca. 5 Minuten) …"
  # the database container may still be starting
  for _ in $(seq 1 60); do (echo >/dev/tcp/127.0.0.1/5432) 2>/dev/null && break; sleep 2; done
  if [ -d app/.next/standalone ]; then bash scripts/demo.sh --no-build; else bash scripts/demo.sh; fi
  if ! curl -sf -o /dev/null http://localhost:3000/login; then
    echo "✘ Die Demo ist nicht gestartet – Details oben. Erneut versuchen: scripts/demo.sh"
    exit 1
  fi
  echo ""
  echo "======================================================================"
  echo "  Monteur-App: $URL"
  echo "  (auf dem iPad in Safari öffnen – mit demselben GitHub-Konto angemeldet)"
  echo "======================================================================"
} >/tmp/demo.log 2>&1
