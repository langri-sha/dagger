#!/bin/sh
set -eu

name="zig-$(uname -m)-linux-$ZIG_VERSION.tar.xz"
cd /tmp
curl --proto '=https' -fsSLO "https://ziglang.org/download/$ZIG_VERSION/$name"
curl --proto '=https' -fsSLO "https://ziglang.org/download/$ZIG_VERSION/$name.minisig"
sh /verify-toolchain.sh "$name"
mkdir /opt/zig
tar -xJf "$name" -C /opt/zig --strip-components=1
