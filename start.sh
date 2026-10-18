#!/usr/bin/env sh
# BlockForge launcher for macOS / Linux
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Get the LTS version from https://nodejs.org and run ./start.sh again."
  exit 1
fi

[ -d node_modules ] || { echo "Installing BlockForge (first run only)..."; npm install --no-audit --no-fund || exit 1; }

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env - add your free keys in the app under Settings."
fi

URL="http://localhost:5177"
echo "BlockForge is starting at $URL (keep this terminal open)"
( sleep 2; (command -v open >/dev/null && open "$URL") || (command -v xdg-open >/dev/null && xdg-open "$URL") ) >/dev/null 2>&1 &
exec node server/server.js
