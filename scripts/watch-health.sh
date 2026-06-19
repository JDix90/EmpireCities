#!/usr/bin/env bash
# Borderfall — launch-day health watch.
#
# Polls /health and /ready on an interval and prints one line per check. On a
# non-200 (or unreachable) it prints a loud FAIL line and rings the terminal bell,
# and tracks a consecutive-failure streak so a single blip doesn't look like an
# outage. Leave this running in a terminal while you announce; pair it with the
# Sentry dashboard for error detail.
#
# Usage:
#   ./scripts/watch-health.sh                              # prod, every 15s
#   ./scripts/watch-health.sh https://borderfall.gg 10     # custom URL + interval(s)
#
# Exit: Ctrl-C. (Does not exit on failure — it keeps watching and alerting.)
set -uo pipefail

BASE="${1:-https://borderfall.gg}"
BASE="${BASE%/}"
INTERVAL="${2:-15}"

streak=0
printf '[watch] %s  every %ss  (Ctrl-C to stop)\n' "$BASE" "$INTERVAL"

while true; do
  ts="$(date '+%H:%M:%S')"
  h=$(curl -s -o /dev/null -m 8 -w '%{http_code}' "$BASE/health" 2>/dev/null || echo 000)
  r=$(curl -s -o /dev/null -m 8 -w '%{http_code}' "$BASE/ready" 2>/dev/null || echo 000)

  if [ "$h" = "200" ] && [ "$r" = "200" ]; then
    streak=0
    printf '%s  OK    health=%s ready=%s\n' "$ts" "$h" "$r"
  else
    streak=$((streak + 1))
    # \a = terminal bell. Repeat a few times so it's noticeable.
    printf '\a%s  FAIL  health=%s ready=%s  (consecutive failures: %d)\n' "$ts" "$h" "$r" "$streak"
    if [ "$r" != "200" ] && [ "$h" = "200" ]; then
      printf '       -> process is up but /ready is down: Postgres or Redis is unhealthy.\n'
    fi
  fi
  sleep "$INTERVAL"
done
