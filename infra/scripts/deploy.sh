#!/usr/bin/env bash
# Deployment with database migrations first (OP-37):
#   1. migration job with the NEW image (if the job already exists) – migrations are additive, the running apps keep working
#   2. Bicep deployment (rolls out api, worker, app with the new image)
#   3. on the very first deployment: run the job now that it exists (schema + database logins)
# Usage: infra/scripts/deploy.sh <resource-group> <param-file> <image-tag> <acr-login-server>
set -euo pipefail
RG="$1"; PARAMS="$2"; TAG="$3"; ACR="$4"
ENVNAME="$(grep -oP "param env = '\K[a-z]+" "$PARAMS")"
JOB="schr-monteur-${ENVNAME}-migrate"
IMAGE="${ACR}/monteur-api:${TAG}"

run_job() {
  echo "▶ Migration job ${JOB} (${IMAGE})"
  EXEC="$(az containerapp job start -n "$JOB" -g "$RG" --image "$IMAGE" --query name -o tsv)"
  for _ in $(seq 1 90); do
    STATUS="$(az containerapp job execution show -n "$JOB" -g "$RG" --job-execution-name "$EXEC" --query properties.status -o tsv)"
    case "$STATUS" in
      Succeeded) echo "✔ migrations applied"; return 0 ;;
      Failed|Stopped|Degraded) echo "✘ migration job ${STATUS} – see Log Analytics (ContainerAppConsoleLogs_CL, ${JOB})"; return 1 ;;
    esac
    sleep 10
  done
  echo "✘ migration job timed out"; return 1
}

FIRST=false
if az containerapp job show -n "$JOB" -g "$RG" >/dev/null 2>&1; then run_job; else FIRST=true; fi

echo "▶ Bicep deployment"
IMAGE_TAG="$TAG" az deployment group create --resource-group "$RG" --parameters "$PARAMS" --name "monteur-${TAG:0:12}"

if [ "$FIRST" = true ]; then run_job; fi
