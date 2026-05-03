#!/bin/sh
set -eu

mkdir -p .tools/bin
curl -fsSL https://github.com/pnpm/pnpm/releases/download/v10.33.2/pnpm-macos-arm64 -o .tools/bin/pnpm
chmod +x .tools/bin/pnpm
echo "Local pnpm installed at ./.tools/bin/pnpm"

