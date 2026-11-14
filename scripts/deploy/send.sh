#!/usr/bin/env bash
set -euo pipefail
: "${DEPLOY_HOST:?missing DEPLOY_HOST}"
: "${DEPLOY_USER:?missing DEPLOY_USER}"
: "${DEPLOY_SSH_KEY:?missing DEPLOY_SSH_KEY}"
: "${DEPLOY_KNOWN_HOSTS:?missing DEPLOY_KNOWN_HOSTS}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]]
[[ "$DEPLOY_USER" =~ ^[a-z_][a-z0-9_-]*$ ]]
[[ "$DEPLOY_HOST" =~ ^[a-zA-Z0-9.:-]+$ ]]
umask 077
credentials=$(mktemp -d)
trap 'rm -rf "$credentials"' EXIT
printf '%s\n' "$DEPLOY_SSH_KEY" > "$credentials/key"
printf '%s\n' "$DEPLOY_KNOWN_HOSTS" > "$credentials/known_hosts"
unset DEPLOY_SSH_KEY DEPLOY_KNOWN_HOSTS
ssh_options=(-i "$credentials/key" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$credentials/known_hosts" -o ConnectTimeout=15)
remote="$DEPLOY_USER@$DEPLOY_HOST"
git archive --format=tar "$DEPLOY_SHA" | ssh "${ssh_options[@]}" "$remote" "deploy $DEPLOY_SHA"
for attempt in $(seq 1 330); do
  status=$(ssh "${ssh_options[@]}" "$remote" "status $DEPLOY_SHA")
  phase=$(printf '%s' "$status" | python3 -c 'import json,sys;print(json.load(sys.stdin)["phase"])')
  case "$phase" in
    ready) echo "Deployment is healthy: $DEPLOY_SHA"; exit 0 ;;
    failed|rollback_failed|unknown) echo "Deployment failed; inspect the server deployment log."; exit 1 ;;
    accepted|running|building|starting|checking|rolling_back) ;;
    *) echo "Unexpected deployment status"; exit 1 ;;
  esac
  sleep 10
done
echo "Deployment status timed out; the detached worker may still be running."
exit 1
