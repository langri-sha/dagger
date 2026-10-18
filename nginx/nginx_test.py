"""Validates an nginx test spec, serves echo upstreams, and checks a scenario."""

import http.client
import json
import os
import re
import sys
import time

SPEC = {"environment": list, "port": int, "scenarios": list}
SCENARIO = {
    "name": str,
    "environment": list,
    "resolver": str,
    "upstreams": list,
    "trustStore": str,
    "requests": list,
    "logContains": list,
    "logExcludes": list,
}
UPSTREAM = {"hostnames": list, "tls": bool, "trusted": bool, "headers": list, "body": str}
REQUEST = {
    "method": str,
    "path": str,
    "headers": list,
    "status": int,
    "body": str,
    "bodyContains": list,
    "responseHeaders": list,
    "absentHeaders": list,
}

LOG_TIMEOUT = 10

NAME = re.compile(r"[A-Za-z0-9._-]+")


def shape(value, keys, where, required=()):
    errors = []
    if not isinstance(value, dict):
        return [f"{where} must be an object"]
    for key in value:
        if key not in keys:
            errors.append(f"{where} has an unknown key {key!r}")
        elif not isinstance(value[key], keys[key]) or (
            keys[key] is int and isinstance(value[key], bool)
        ):
            errors.append(f"{where}.{key} must be a {keys[key].__name__}")
        elif keys[key] is list and not all(isinstance(item, (str, dict)) for item in value[key]):
            errors.append(f"{where}.{key} must hold strings or objects")
    for key in required:
        if key not in value:
            errors.append(f"{where} needs {key!r}")
    return errors


def header_pairs(entries, where):
    errors = []
    for entry in entries:
        if not isinstance(entry, str) or ":" not in entry:
            errors.append(f"{where} entry {entry!r} is not 'name: value'")
    return errors


def validate(spec):
    errors = shape(spec, SPEC, "spec")
    if errors:
        return errors
    for entry in spec.get("environment", []):
        if not isinstance(entry, str) or "=" not in entry:
            errors.append(f"spec.environment entry {entry!r} is not NAME=value")
    names = set()
    for i, scenario in enumerate(spec.get("scenarios", [])):
        where = f"scenarios[{i}]"
        found = shape(scenario, SCENARIO, where, required=("name",))
        errors += found
        if found:
            continue
        if not NAME.fullmatch(scenario["name"]):
            errors.append(f"{where}.name {scenario['name']!r} may only hold letters, digits, '.', '_' and '-'")
        if scenario["name"] in names:
            errors.append(f"{where} repeats the name {scenario['name']!r}")
        names.add(scenario["name"])
        for entry in scenario.get("environment", []):
            if not isinstance(entry, str) or "=" not in entry:
                errors.append(f"{where}.environment entry {entry!r} is not NAME=value")
        for entry in scenario.get("logContains", []) + scenario.get("logExcludes", []):
            if not isinstance(entry, str):
                errors.append(f"{where} log expectation {entry!r} is not a string")
        for j, upstream in enumerate(scenario.get("upstreams", [])):
            at = f"{where}.upstreams[{j}]"
            found = shape(upstream, UPSTREAM, at, required=("hostnames",))
            errors += found
            if not found:
                errors += header_pairs(upstream.get("headers", []), f"{at}.headers")
                if not upstream["hostnames"]:
                    errors.append(f"{at}.hostnames is empty")
        for j, request in enumerate(scenario.get("requests", [])):
            at = f"{where}.requests[{j}]"
            found = shape(request, REQUEST, at, required=("path",))
            errors += found
            if found:
                continue
            if not request["path"].startswith("/"):
                errors.append(f"{at}.path must start with /")
            errors += header_pairs(request.get("headers", []), f"{at}.headers")
            errors += header_pairs(request.get("responseHeaders", []), f"{at}.responseHeaders")
    return errors


def quote(text):
    escaped = text.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
    return f'"{escaped}"'


def upstream_config(upstream):
    lines = ["events {}", "http {", "  server {"]
    if upstream.get("tls", False):
        lines += [
            "    listen 443 ssl;",
            "    ssl_certificate /certs/upstream.crt;",
            "    ssl_certificate_key /certs/upstream.key;",
        ]
    else:
        lines.append("    listen 80;")
    lines.append("    location / {")
    for entry in upstream.get("headers", []):
        name, value = (part.strip() for part in entry.split(":", 1))
        lines.append(f"      add_header {name} {quote(value)} always;")
    lines.append(f"      return 200 {quote(upstream.get('body', ''))};")
    lines += ["    }", "  }", "}"]
    return "\n".join(lines) + "\n"


def parse_headers(entries):
    return [tuple(part.strip() for part in entry.split(":", 1)) for entry in entries]


def read_log(path):
    try:
        with open(path, encoding="utf-8", errors="replace") as file:
            return file.read()
    except FileNotFoundError:
        return ""


def without_nulls(value):
    if isinstance(value, dict):
        return {key: without_nulls(item) for key, item in value.items() if item is not None}
    if isinstance(value, list):
        return [without_nulls(item) for item in value]
    return value


def check(scenario, host, port, log):
    name = scenario["name"]
    failures = []

    def fail(message):
        failures.append(f"{name}: {message}")
        print(f"FAIL {name}: {message}")

    for request in scenario.get("requests", []):
        method = request.get("method", "GET")
        path = request["path"]
        label = f"{method} {path}"
        connection = http.client.HTTPConnection(host, port, timeout=30)
        try:
            connection.request(method, path, headers=dict(parse_headers(request.get("headers", []))))
            response = connection.getresponse()
            body = response.read().decode("utf-8", errors="replace")
            headers = [(key.lower(), value) for key, value in response.getheaders()]
        except OSError as error:
            fail(f"{label} could not be requested: {error}")
            continue
        finally:
            connection.close()

        if "status" in request:
            if response.status != request["status"]:
                fail(f"{label} answered {response.status}, expected {request['status']}")
            else:
                print(f"ok   {name}: {label} -> {response.status}")
        if "body" in request:
            if body != request["body"]:
                fail(f"{label} answered the body {body!r}, expected {request['body']!r}")
            else:
                print(f"ok   {name}: {label} -> body {body!r}")
        for text in request.get("bodyContains", []):
            if text not in body:
                fail(f"{label} answered a body without {text!r}")
            else:
                print(f"ok   {name}: {label} -> body contains {text!r}")
        for key, value in parse_headers(request.get("responseHeaders", [])):
            values = [got for got_key, got in headers if got_key == key.lower()]
            if not any(got.lower() == value.lower() for got in values):
                fail(f"{label} answered {key}: {values or 'nothing'}, expected {value!r}")
            else:
                print(f"ok   {name}: {label} -> {key}: {value}")
        for key in request.get("absentHeaders", []):
            if any(got_key == key.lower() for got_key, _ in headers):
                fail(f"{label} answered with {key}, which must be absent")
            else:
                print(f"ok   {name}: {label} -> no {key}")

    contains = scenario.get("logContains", [])
    excludes = scenario.get("logExcludes", [])
    if contains or excludes:
        deadline = time.monotonic() + LOG_TIMEOUT
        text = read_log(log)
        while any(line not in text for line in contains) and time.monotonic() < deadline:
            time.sleep(0.2)
            text = read_log(log)
        time.sleep(0.5)
        text = read_log(log)
        for line in contains:
            if line not in text:
                fail(f"the log has no {line!r}")
            else:
                print(f"ok   {name}: the log has {line!r}")
        for line in excludes:
            if line in text:
                fail(f"the log has {line!r}, which must be absent")
            else:
                print(f"ok   {name}: the log has no {line!r}")

    if failures:
        print("\n--- log ---\n" + read_log(log))
    return failures


def main(argv):
    command, path, *rest = argv
    with open(path, encoding="utf-8") as file:
        document = json.load(file)

    if command == "validate":
        errors = validate(document)
        for error in errors:
            print(f"FAIL {error}")
        return 1 if errors else 0

    if command == "upstream":
        with open("/tmp/upstream.conf", "w", encoding="utf-8") as file:
            file.write(upstream_config(document))
        os.execvp("nginx", ["nginx", "-c", "/tmp/upstream.conf", "-e", "/dev/stderr", "-g", "daemon off; pid /tmp/nginx.pid;"])

    if command == "check":
        host, port, log = rest
        return 1 if check(without_nulls(document), host, int(port), log) else 0

    print(f"unknown command {command!r}")
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
