#!/bin/sh
set -eu

name=$1

minisign -Vm "$name" -P "RWSGOq2NVecA2UPNdBUZykf1CCb147pkmdtYxgb3Ti+JO/wCYvhbAb/U"

# minisign signs the third line, the trusted comment, and ignores lines past the
# fourth, so only that line may say which file the signature is for.
if ! sed -n 3p "$name.minisig" | tr ' \t' '\n\n' | grep -qxF "file:$name"; then
  echo "the signature of $name is for another file" >&2
  exit 1
fi
