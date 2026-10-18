#!/usr/bin/env sh
# BlockForge installer / updater for macOS and Linux.
#   curl -fsSL https://raw.githubusercontent.com/zielonyxiom/blockforge/main/install.sh | sh
# Downloads BlockForge to ~/BlockForge, installs dependencies and starts it.
# Running it again updates BlockForge and keeps your .env (keys) and projects.
set -e
REPO="zielonyxiom/blockforge"
DIR="$HOME/BlockForge"

echo ""
echo "  BlockForge installer"
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "  Node.js is not installed."
  if command -v brew >/dev/null 2>&1; then echo "  Install it with:  brew install node"
  elif command -v apt >/dev/null 2>&1; then echo "  Install it with:  sudo apt install nodejs npm   (or use https://nodejs.org)"
  else echo "  Get the LTS version from https://nodejs.org"; fi
  echo "  Then run this installer again."
  exit 1
fi
echo "  Node.js $(node --version) found."

TMP="$(mktemp -d)"
echo "  Downloading BlockForge..."
curl -fsSL "https://github.com/$REPO/archive/refs/heads/main.tar.gz" | tar -xz -C "$TMP"
SRC="$(find "$TMP" -maxdepth 1 -type d -name 'blockforge-*' | head -n 1)"
mkdir -p "$DIR"
# copy everything except your keys and projects
(cd "$SRC" && tar --exclude=./.env --exclude=./projects -cf - .) | (cd "$DIR" && tar -xf -)
rm -rf "$TMP"

cd "$DIR"
echo "  Installing dependencies (first time takes a minute)..."
npm install --no-audit --no-fund --loglevel=error
[ -f .env ] || cp .env.example .env
chmod +x start.sh

echo "  Installed to $DIR - start it any time with:  $DIR/start.sh"
exec ./start.sh
