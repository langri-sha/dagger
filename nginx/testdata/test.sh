#!/usr/bin/env bash
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
module=$(dirname "$here")
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT

fixture() {
  local dir=$scratch/$1
  mkdir -p "$dir/modules/nginx"
  cp -r "$here/workspace/." "$dir/"
  git -C "$dir" init --quiet
  cp "$module/main.dang" "$module/dagger-module.toml" "$module/Dockerfile" "$module/nginx_test.py" "$dir/modules/nginx/"
  cat >"$dir/dagger.toml" <<EOF
[modules.site]
source = "modules/nginx"

[modules.site.settings]
context = "site"
spec = "site/nginx.json"
content = "content"
contentPath = "html"
variables = ["GREETING=Hello from the fixture"]
EOF
}

edit_spec() {
  python3 - "$scratch/$1/site/nginx.json" "$2" <<'EOF'
import json
import sys

path, statement = sys.argv[1:]
with open(path) as file:
    spec = json.load(file)
exec(statement, {"spec": spec, "scenarios": spec["scenarios"]})
with open(path, "w") as file:
    json.dump(spec, file)
EOF
}

passes() {
  local name=$1
  echo "== $name: dagger check passes"
  (cd "$scratch/$name" && dagger check)
}

fails_with() {
  local name=$1 message=$2 output
  echo "== $name: dagger check fails with: $message"
  if output=$(cd "$scratch/$name" && dagger check 2>&1); then
    echo "expected failure" >&2
    return 1
  fi
  grep -qF "$message" <<<"$output" || {
    echo "$output" >&2
    echo "missing: $message" >&2
    return 1
  }
}

fixture spec
passes spec

fixture wrong-status
edit_spec wrong-status 'scenarios[0]["requests"][0]["status"] = 201'
fails_with wrong-status "GET / answered 200, expected 201"

fixture wrong-body
edit_spec wrong-body 'scenarios[0]["requests"][1]["body"] = "Gone"'
fails_with wrong-body "GET /missing answered the body 'This page could not be found\\n', expected 'Gone'"

fixture missing-body-text
edit_spec missing-body-text 'scenarios[0]["requests"][0]["bodyContains"] = ["Goodbye"]'
fails_with missing-body-text "GET / answered a body without 'Goodbye'"

fixture wrong-header
edit_spec wrong-header 'scenarios[0]["requests"][0]["responseHeaders"] = ["x-robots-tag: all"]'
fails_with wrong-header "GET / answered x-robots-tag: ['noindex'], expected 'all'"

fixture present-header
edit_spec present-header 'scenarios[0]["requests"][2]["absentHeaders"] = ["x-robots-tag"]'
fails_with present-header "HEAD / answered with x-robots-tag, which must be absent"

fixture missing-log-line
edit_spec missing-log-line 'scenarios[0]["logContains"] = ["GET /never"]'
fails_with missing-log-line "the log has no 'GET /never'"

fixture unwanted-log-line
edit_spec unwanted-log-line 'scenarios[0]["logExcludes"] = ["GET /missing"]'
fails_with unwanted-log-line "the log has 'GET /missing', which must be absent"

fixture untrusted-upstream
edit_spec untrusted-upstream 'scenarios[1]["upstreams"][0]["trusted"] = False'
fails_with untrusted-upstream "GET /proxy/hello?x=1 answered 502, expected 200"

fixture invalid-config
edit_spec invalid-config 'spec["environment"] = ["PORT=notaport"]'
fails_with invalid-config 'host not found in "notaport" of the "listen" directive'

fixture unknown-key
edit_spec unknown-key 'scenarios[0]["requests"][0]["stauts"] = 200'
fails_with unknown-key "scenarios[0].requests[0] has an unknown key 'stauts'"

fixture unnamed-port
edit_spec unnamed-port 'del spec["port"]'
fails_with unnamed-port "so the spec has to name the port"
