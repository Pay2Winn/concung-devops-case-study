#!/bin/sh
# Kiểm tra image thật, không cần Python hoặc framework kiểm thử.
set -eu
image=${1:?Usage: sh tests/smoke.sh IMAGE REVISION}
revision=${2:?Expected source revision}
container=$(docker run -d --read-only --tmpfs /tmp:rw,nosuid,nodev,size=64m,mode=1777 \
    --cap-drop ALL --security-opt no-new-privileges -e APP_ENV=test "$image")
trap 'docker rm -f "$container" >/dev/null' EXIT
trap 'exit 1' INT TERM
ready=false
for attempt in 1 2 3 4 5 6 7 8 9 10; do
    if docker exec "$container" wget -qO- http://127.0.0.1:8080/health >/dev/null; then ready=true; break; fi
    sleep 1
done
if [ "$ready" != true ]; then docker logs "$container"; exit 1; fi
get() { docker exec "$container" wget -qO- "http://127.0.0.1:8080$1"; }
test "$(get /health)" = '{"status":"ok"}'
test "$(get /version)" = "{\"revision\":\"$revision\",\"environment\":\"test\"}"
for path in / /js/application.js /style/main.css /LICENSE.txt; do
    test -n "$(get "$path")"
done
case "$(get /)" in *2048*) ;; *) exit 1;; esac
case "$(get /LICENSE.txt)" in *'MIT License'*) ;; *) exit 1;; esac
if get /.git/config; then printf '%s\n' 'Private path exposed' >&2; exit 1; fi
printf '%s\n' 'PASS: game, assets, license, health, revision and private path'
