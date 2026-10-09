#!/usr/bin/env sh
cd "$(dirname "$0")"
command -v node >/dev/null 2>&1 || { echo "Node.js 20+ szükséges: https://nodejs.org"; exit 1; }
[ -d node_modules/lighthouse ] || npm install --no-audit --no-fund || exit 1
exec node server.mjs --open
