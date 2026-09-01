#!/bin/sh
set -eu

CONTAINER=${CONTAINER:-t3-prod-paperclip-1}
PROFILE_ENV=${PROFILE_ENV:-/root/.hermes/profiles/eng-rick/.env}
API_BASE_URL=${API_BASE_URL:-http://172.16.10.1:8643}
BRIDGE=${BRIDGE:-br-67f2e613a24c}
SUBNET=${SUBNET:-172.16.10.0/24}

api_key=''
while IFS= read -r line; do
  case "$line" in
    API_SERVER_KEY=*)
      api_key=${line#API_SERVER_KEY=}
      break
      ;;
  esac
done < "$PROFILE_ENV"

if [ -z "$api_key" ]; then
  printf '%s\n' 'API_SERVER_KEY not found' >&2
  exit 1
fi

printf '%s\n' 'service:'
systemctl is-enabled hermes-eng-rick-gateway-relay.service
systemctl is-active hermes-eng-rick-gateway-relay.service

printf '%s\n' 'listener:'
ss -ltn '( sport = :8643 )'

printf '%s\n' 'firewall:'
iptables -S ufw-user-input | grep -- "-s $SUBNET -d 172.16.10.1/32 -i $BRIDGE -p tcp -m tcp --dport 8643 -j ACCEPT"

printf '%s\n' 'container-health:'
docker exec "$CONTAINER" curl --fail --silent --show-error --max-time 10 \
  -H "Authorization: Bearer $api_key" "$API_BASE_URL/v1/health" >/dev/null
printf '%s\n' 'HTTP 200'

printf '%s\n' 'container-authenticated-models:'
docker exec "$CONTAINER" curl --fail --silent --show-error --max-time 10 \
  -H "Authorization: Bearer $api_key" "$API_BASE_URL/v1/models" >/dev/null
printf '%s\n' 'HTTP 200'

printf '%s\n' 'container-unauthenticated-models:'
status=$(docker exec "$CONTAINER" curl --silent --show-error --max-time 10 -o /dev/null -w '%{http_code}' "$API_BASE_URL/v1/models")
printf 'HTTP %s\n' "$status"
test "$status" = 401
