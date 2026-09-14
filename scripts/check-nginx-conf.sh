#!/usr/bin/env bash
# Prove docker/nginx.prod.conf can actually start nginx.
#
# This exists because a config nginx refuses to parse does not degrade — it
# takes the WHOLE SITE down, static assets included, and the failure looks
# nothing like its cause. A `location ~ ^/daily/(archive|[0-9]{4}-...)$` line
# shipped unquoted: nginx's lexer read the `{` of `{4}` as the opening brace of
# the location block, truncated the regex, failed to compile it, and refused to
# start. Every request then 502'd from the proxy in front. `docker compose up`
# reported the web container as "Started", and the backend's own /ready was
# fine, so nothing upstream of the smoke test noticed.
#
# The whole class is cheap to catch: run `nginx -t` over the real file.
#
# Three substitutions make it testable outside compose — none changes the
# syntax under test:
#   * `backend:3001` is a compose service name that only resolves on the
#     compose network; nginx fails config tests on an unresolvable upstream.
#   * `root` points at an image path that does not exist on a CI runner.
#   * `listen 80` becomes an unprivileged port, because `nginx -t` test-binds
#     the listen sockets and CI does not run as root.
#
# The verdict is nginx's "syntax is ok" line, NOT the exit code. `nginx -t`
# exits non-zero when it cannot bind — which says nothing about the config and
# is guaranteed on any unprivileged runner. Parsing is what we are testing, and
# a config nginx cannot parse never reaches the bind step: the regex bug above
# printed `[emerg] pcre2_compile() failed` with no "syntax is ok" at all.
set -euo pipefail

CONF="$(dirname "$0")/../docker/nginx.prod.conf"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# The image the production web container is actually built FROM, so the check
# runs the same nginx that will serve the config (docker/Dockerfile.frontend).
NGINX_IMAGE="${NGINX_IMAGE:-nginx:alpine}"

# CI installs nginx on the runner; the VPS has no host nginx but always has
# docker and this image already pulled. Preferring the host binary keeps CI
# fast; the docker path is what makes the deploy-time guard real rather than a
# silent skip on the one machine where it matters most.
if command -v nginx >/dev/null 2>&1; then
  RUNNER="host"
elif command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  RUNNER="docker"
else
  echo "check-nginx-conf: no nginx and no usable docker — SKIPPING."
  echo "  This check did not run. Install nginx-light, or make docker available."
  exit 0
fi

mkdir -p "$WORK/html" "$WORK/logs"
sed -e 's/server backend:3001;/server 127.0.0.1:3001;/' \
    -e 's/listen 80;/listen 8199;/' \
    -e "s#root /usr/share/nginx/html;#root $WORK/html;#" \
    "$CONF" > "$WORK/site.conf"

cat > "$WORK/main.conf" <<NGINX
events {}
pid $WORK/nginx.pid;
error_log $WORK/logs/error.log;
http {
  access_log off;
  client_body_temp_path $WORK/logs;
  proxy_temp_path $WORK/logs;
  fastcgi_temp_path $WORK/logs;
  uwsgi_temp_path $WORK/logs;
  scgi_temp_path $WORK/logs;
  include $WORK/site.conf;
}
NGINX

if [ "$RUNNER" = "host" ]; then
  nginx -t -c "$WORK/main.conf" >"$WORK/out" 2>&1 || true
else
  # Mount at the same absolute path so the `include` line inside main.conf
  # resolves identically inside the container. Writable because nginx -t
  # checks its temp paths.
  docker run --rm -v "$WORK:$WORK" "$NGINX_IMAGE" \
    nginx -t -c "$WORK/main.conf" >"$WORK/out" 2>&1 || true
fi

if ! grep -q "syntax is ok" "$WORK/out"; then
  echo "check-nginx-conf: FAILED — docker/nginx.prod.conf would not start nginx."
  echo "  A config nginx cannot parse takes down the entire site, not one route."
  echo "  Note: a regex containing { } (e.g. [0-9]{4}) must be QUOTED in a"
  echo "  location directive, or nginx reads the brace as the block opener."
  echo
  sed 's/^/  /' "$WORK/out"
  exit 1
fi

echo "check-nginx-conf: ok — nginx accepts docker/nginx.prod.conf (via $RUNNER)"
