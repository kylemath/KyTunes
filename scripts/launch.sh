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

SERVER_PID=""
DEV_STARTED=0
LIBRARY_PID=""
LIBRARY_STARTED=0
SHARE_STARTED=0
TS_BIN=""

# ---------- Clean up on exit ----------
# Only processes this launch started are stopped. A dev server or library
# server that was already running is left alone.
cleanup() {
  if [ "$DEV_STARTED" = "1" ] && [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null
  fi
  if [ "$LIBRARY_STARTED" = "1" ] && [ -n "$LIBRARY_PID" ]; then
    kill "$LIBRARY_PID" 2>/dev/null
  fi
  if [ "$SHARE_STARTED" = "1" ] && [ -n "$TS_BIN" ]; then
    "$TS_BIN" serve reset >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

cd "$PROJECT_DIR" || exit 1

# ---------- Library server ----------
# Other devices stream from this process. It uses library.config.json, so the
# password is not passed on the command line.
LIBRARY_PORT=8787
if [ -f "$PROJECT_DIR/library.config.json" ]; then
  cfg_port=$(node -e 'try{const c=require("./library.config.json"); if(typeof c.port==="number") process.stdout.write(String(c.port))}catch(e){}')
  if [ -n "$cfg_port" ]; then
    LIBRARY_PORT="$cfg_port"
  fi
  if curl -sf "http://127.0.0.1:$LIBRARY_PORT/api/health" >/dev/null 2>&1; then
    echo "Library server already running on port $LIBRARY_PORT"
  else
    echo "Starting library server on port $LIBRARY_PORT"
    node server/library-server.mjs &
    LIBRARY_PID=$!
    LIBRARY_STARTED=1
    for i in $(seq 1 40); do
      if curl -sf "http://127.0.0.1:$LIBRARY_PORT/api/health" >/dev/null 2>&1; then
        echo "Library server is up after ~$((i / 4))s"
        break
      fi
      if ! kill -0 "$LIBRARY_PID" 2>/dev/null; then
        echo "Library server exited"
        break
      fi
      sleep 0.25
    done
    if ! curl -sf "http://127.0.0.1:$LIBRARY_PORT/api/health" >/dev/null 2>&1; then
      echo "Library server did not become ready"
      osascript -e "display dialog \"KyTunes opened, but the library server did not start. Other devices will not be able to stream. Check .localplayer.log in the project folder.\" with title \"$APP_NAME\" buttons {\"OK\"} default button \"OK\" with icon caution" &
    fi
  fi
  if curl -sf "http://127.0.0.1:$LIBRARY_PORT/api/health" >/dev/null 2>&1; then
    TS_BIN=""
    for candidate in \
      "/Applications/Tailscale.app/Contents/MacOS/Tailscale" \
      "/usr/local/bin/tailscale" \
      "/opt/homebrew/bin/tailscale"
    do
      if [ -x "$candidate" ]; then
        TS_BIN="$candidate"
        break
      fi
    done
    if [ -z "$TS_BIN" ] && command -v tailscale >/dev/null 2>&1; then
      TS_BIN="$(command -v tailscale)"
    fi
    if [ -z "$TS_BIN" ]; then
      echo "Tailscale is not installed — phone link not published"
    else
      serve_status=$("$TS_BIN" serve status --json 2>/dev/null || echo '{}')
      if printf '%s' "$serve_status" | grep -q "127.0.0.1:${LIBRARY_PORT}"; then
        echo "Tailscale Serve already publishing port $LIBRARY_PORT"
      elif "$TS_BIN" serve --bg "$LIBRARY_PORT" >/dev/null 2>&1; then
        SHARE_STARTED=1
        echo "Tailscale Serve publishing port $LIBRARY_PORT"
      else
        echo "Tailscale Serve is already running in another window — leaving it"
      fi
    fi
  fi
else
  echo "No library.config.json — skipping the library server"
fi

# ---------- Vite dev server ----------
# Keep a player that is already running. The library server is additional.
if curl -sf "$URL" >/dev/null 2>&1; then
  echo "Dev server already running on port $PORT — leaving it up"
else
  echo "Starting dev server on port $PORT"
  npm run dev -- --port "$PORT" >> "$LOG_FILE" 2>&1 &
  SERVER_PID=$!
  DEV_STARTED=1
fi

echo "Waiting for server on port $PORT..."
for i in $(seq 1 30); do
  if curl -sf "$URL" >/dev/null 2>&1; then
    echo "Dev server is up after ~$((i / 2))s"
    break
  fi
  if [ "$DEV_STARTED" = "1" ] && ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "Dev server exited"
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

# Stay alive while a server this launch started is running, so quitting the
# app stops only that process. An already-running dev server is not waited on
# and is not stopped.
if [ "$DEV_STARTED" = "1" ]; then
  wait "$SERVER_PID"
elif [ "$LIBRARY_STARTED" = "1" ]; then
  wait "$LIBRARY_PID"
fi
