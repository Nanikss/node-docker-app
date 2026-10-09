#!/usr/bin/env bash
# Runs on the EC2 host. Releases a new image with a readiness gate:
#   1. pull the image and start it as a candidate on a temporary localhost port
#   2. wait for /readyz; if it never gets ready, remove it and leave the live container alone
#   3. stop the live container (SIGTERM, so it drains in-flight requests) and start the new one on port 80
#   4. if the new one fails its readiness check on port 80, put the previous image back
# The previous image is remembered so `deploy.sh --rollback` can return to it.
#
# Usage: deploy.sh <image-tag>     e.g. deploy.sh 3f2c1ab
#        deploy.sh --rollback
set -euo pipefail

IMAGE_REPO="${IMAGE_REPO:-ghcr.io/nanikss/node-docker-app}"
NAME="${APP_NAME:-node-docker-app}"
HOST_PORT="${HOST_PORT:-80}"
CANDIDATE_PORT="${CANDIDATE_PORT:-3001}"
READY_TIMEOUT="${READY_TIMEOUT:-60}"
STATE_DIR="${STATE_DIR:-$HOME/.node-docker-app}"
ENV_FILE="${ENV_FILE:-/etc/node-docker-app.env}" # optional, e.g. DATABASE_URL=...

log() { printf '[deploy] %s\n' "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

usage() {
  echo "usage: $0 <image-tag> | --rollback" >&2
  exit 2
}

# run_container <name> <host-port-binding> <image>
run_container() {
  local args=(-d --name "$1" --restart unless-stopped -p "$2:3000"
    --log-opt max-size=10m --log-opt max-file=3)
  if [[ -f "$ENV_FILE" ]]; then
    args+=(--env-file "$ENV_FILE")
  fi
  docker run "${args[@]}" "$3" >/dev/null
}

# wait_ready <url>: poll until it returns 2xx or READY_TIMEOUT seconds pass
wait_ready() {
  local deadline=$((SECONDS + READY_TIMEOUT))
  until curl -fsS -o /dev/null --max-time 2 "$1"; do
    if ((SECONDS >= deadline)); then
      return 1
    fi
    sleep 2
  done
}

remove_container() {
  docker stop --time 10 "$1" >/dev/null 2>&1 || true
  docker rm "$1" >/dev/null 2>&1 || true
}

running_image() {
  docker inspect --format '{{.Config.Image}}' "$NAME" 2>/dev/null || true
}

release() {
  local image="$1" previous candidate="$NAME-candidate"
  previous="$(running_image)"
  log "releasing $image (live: ${previous:-none})"

  docker pull "$image"

  remove_container "$candidate"
  run_container "$candidate" "127.0.0.1:$CANDIDATE_PORT" "$image"
  if ! wait_ready "http://127.0.0.1:$CANDIDATE_PORT/readyz"; then
    docker logs --tail 50 "$candidate" >&2 || true
    remove_container "$candidate"
    die "candidate never became ready; ${previous:-nothing} is still live"
  fi
  log "candidate is ready, switching traffic"
  remove_container "$candidate"

  remove_container "$NAME"
  run_container "$NAME" "$HOST_PORT" "$image"
  if ! wait_ready "http://127.0.0.1:$HOST_PORT/readyz"; then
    docker logs --tail 50 "$NAME" >&2 || true
    remove_container "$NAME"
    if [[ -n "$previous" ]]; then
      log "restoring $previous"
      run_container "$NAME" "$HOST_PORT" "$previous"
    fi
    die "$image failed its readiness check on port $HOST_PORT"
  fi

  mkdir -p "$STATE_DIR"
  if [[ -n "$previous" && "$previous" != "$image" ]]; then
    echo "$previous" >"$STATE_DIR/previous_image"
  fi
  echo "$image" >"$STATE_DIR/current_image"
  docker image prune -f >/dev/null || true
  log "$image is live"
}

[[ $# -eq 1 ]] || usage

case "$1" in
  --rollback)
    [[ -s "$STATE_DIR/previous_image" ]] || die "no previous image recorded in $STATE_DIR"
    release "$(cat "$STATE_DIR/previous_image")"
    ;;
  -*)
    usage
    ;;
  *)
    [[ "$1" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]] || die "invalid image tag: $1"
    release "$IMAGE_REPO:$1"
    ;;
esac
