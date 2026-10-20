#!/bin/sh
# Lines are data, never shell, and are reported by number so that a malformed
# one can't reach the log.
set -eu

found=0
line_number=0
while IFS= read -r line || [ -n "$line" ]; do
  line_number=$((line_number + 1))
  case $line in
    '' | '#'*) continue ;;
  esac
  name=${line%%=*}
  case $line in
    *=*) ;;
    *) name= ;;
  esac
  case $name in
    '' | [0-9]* | *[!A-Za-z0-9_]*)
      echo "secretEnvFile line $line_number is not NAME=value." >&2
      exit 1
      ;;
  esac
  export "$name=${line#*=}"
  found=$((found + 1))
done </run/secrets/build-env

if [ "$found" -eq 0 ]; then
  echo "secretEnvFile has no NAME=value lines." >&2
  exit 1
fi

exec pnpm exec next build
