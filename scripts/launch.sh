#!/bin/bash
# LocalPlayer launcher — starts Vite dev server and opens as installed PWA
# Designed to work standalone from .app double-click (no terminal/IDE needed)

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT=5173
URL="http://localhost:$PORT"
LOG_FILE="$PROJECT_DIR/.localplayer.log"
APP_NAME="KyTunes"

exec > "$LOG_FILE" 2>&1

echo "=== KyTunes launch at $(date) ==="
echo "PROJECT_DIR: $PROJECT_DIR"

# ---------- Ensure a modern Node is on PATH ----------
# When launched from .app, the shell has almost no PATH. We must explicitly
# find and activate a Node >= 18 that can run Vite 7.

export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  echo "Loading nvm..."
  source "$NVM_DIR/nvm.sh"
  nvm use 20 >/dev/null 2>&1 || nvm use 18 >/dev/null 2>&1 || true
fi

# fnm fallback
if ! command -v node &>/dev/null || [ "$(node -e 'process.stdout.write(String(+process.versions.node.split(".")[0]>=18))')" != "1" ]; then
  if command -v fnm &>/dev/null; then
    eval "$(fnm env)" && fnm use 20 2>/dev/null || fnm use 18 2>/dev/null || true
  fi
fi

# Homebrew Node fallback (common on macOS)
if ! command -v node &>/dev/null || [ "$(node -e 'process.stdout.write(String(+process.versions.node.split(".")[0]>=18))')" != "1" ]; then
  for candidate in /opt/homebrew/bin/node /usr/local/bin/node; do
    if [ -x "$candidate" ]; then
      major=$("$candidate" -e 'process.stdout.write(process.versions.node.split(".")[0])')
      if [ "$major" -ge 18 ] 2>/dev/null; then
        export PATH="$(dirname "$candidate"):$PATH"
        break
      fi
    fi
  done
fi

# Direct nvm binary fallback if nvm.sh didn't set PATH correctly
if ! command -v node &>/dev/null || [ "$(node -e 'process.stdout.write(String(+process.versions.node.split(".")[0]>=18))')" != "1" ]; then
  for dir in "$NVM_DIR/versions/node"/v20.* "$NVM_DIR/versions/node"/v22.* "$NVM_DIR/versions/node"/v18.*; do
    if [ -x "$dir/bin/node" ]; then
      export PATH="$dir/bin:$PATH"
      echo "Using Node from $dir"
      break
    fi
  done
fi

echo "Node: $(which node 2>/dev/null) $(node --version 2>/dev/null)"
echo "npm:  $(which npm 2>/dev/null) $(npm --version 2>/dev/null)"

NODE_MAJOR=$(node -e 'process.stdout.write(process.versions.node.split(".")[0])' 2>/dev/null)
if [ -z "$NODE_MAJOR" ] || [ "$NODE_MAJOR" -lt 18 ] 2>/dev/null; then
  osascript -e "display dialog \"KyTunes requires Node.js >= 18 but found $(node --version 2>/dev/null || echo 'none').

Install a modern Node:
  brew install node
or:
  nvm install 20\" with title \"$APP_NAME\" buttons {\"OK\"} default button \"OK\" with icon stop" &
  exit 1
fi

# ---------- Clean up on exit ----------
cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
}
trap cleanup EXIT INT TERM

cd "$PROJECT_DIR" || exit 1

# Kill stale server on our port
STALE_PID=$(lsof -i ":$PORT" -sTCP:LISTEN -t 2>/dev/null)
if [ -n "$STALE_PID" ]; then
  echo "Killing stale server PID $STALE_PID on port $PORT"
  kill "$STALE_PID" 2>/dev/null
  sleep 1
fi

# ---------- Start Vite dev server ----------
npm run dev -- --port "$PORT" >> "$LOG_FILE" 2>&1 &
SERVER_PID=$!
echo "Server PID: $SERVER_PID"

echo "Waiting for server on port $PORT..."
for i in $(seq 1 30); do
  if curl -s "$URL" >/dev/null 2>&1; then
    echo "Server is up after ~$((i / 2))s"
    break
  fi
  sleep 0.5
done

if ! curl -s "$URL" >/dev/null 2>&1; then
  osascript -e "display dialog \"$APP_NAME failed to start. Check .localplayer.log in the project folder.\" with title \"$APP_NAME\" buttons {\"OK\"} default button \"OK\" with icon stop" &
  exit 1
fi

# ---------- Open the app ----------
# Prefer the installed PWA (custom icon, standalone) — but only when launched via
# this .app, which has already started the server. Do NOT open the PWA directly
# from Chrome Apps/Dock — use this .app launcher instead.
PWA_APP=""
for dir in "$HOME/Applications/Chrome Apps.localized" "$HOME/Applications/Chrome Apps" "$HOME/Applications"; do
  if [ -d "$dir/$APP_NAME.app" ]; then
    PWA_APP="$dir/$APP_NAME.app"
    break
  fi
done

if [ -n "$PWA_APP" ]; then
  echo "Launching installed PWA: $PWA_APP"
  open -a "$PWA_APP"
else
  echo "PWA not installed — opening in Chrome."
  if [ -d "/Applications/Google Chrome.app" ]; then
    open -na "Google Chrome" --args "--app=$URL"
  elif [ -d "/Applications/Chromium.app" ]; then
    open -na "Chromium" --args "--app=$URL"
  elif [ -d "/Applications/Microsoft Edge.app" ]; then
    open -na "Microsoft Edge" --args "--app=$URL"
  elif [ -d "/Applications/Brave Browser.app" ]; then
    open -na "Brave Browser" --args "--app=$URL"
  else
    open "$URL"
  fi

  sleep 3
  osascript -e "display dialog \"To get a standalone app with its own Dock icon:

1. Look for the install icon (⊕) on the right side of the address bar
2. Click it and choose Install

Then always launch via the KyTunes.app (from create-app) — not the PWA directly — so the server starts first.\" with title \"$APP_NAME — Install as App\" buttons {\"OK\"} default button \"OK\"" &
fi

wait "$SERVER_PID"
