#!/bin/bash
# Prints a QR code for the tailnet address, then runs Tailscale Serve
# in the foreground (Ctrl+C stops the address).

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR" || exit 1

PORT=8787
if [ -f library.config.json ]; then
  cfg_port=$(node -e 'try{const c=require("./library.config.json"); if(typeof c.port==="number") process.stdout.write(String(c.port))}catch(e){}')
  if [ -n "$cfg_port" ]; then
    PORT="$cfg_port"
  fi
fi

TS=""
for candidate in \
  "/Applications/Tailscale.app/Contents/MacOS/Tailscale" \
  "/usr/local/bin/tailscale" \
  "/opt/homebrew/bin/tailscale"
do
  if [ -x "$candidate" ]; then
    TS="$candidate"
    break
  fi
done
if [ -z "$TS" ] && command -v tailscale >/dev/null 2>&1; then
  TS="$(command -v tailscale)"
fi
if [ -z "$TS" ]; then
  echo "Tailscale is not installed."
  exit 1
fi

DNS=$("$TS" status --json | node -e 'let s=""; process.stdin.on("data", d => { s += d }); process.stdin.on("end", () => { const name = JSON.parse(s).Self.DNSName.replace(/\.$/, ""); process.stdout.write(name); })')
if [ -z "$DNS" ]; then
  echo "Tailscale is installed but this Mac is not signed in."
  exit 1
fi

node "$PROJECT_DIR/scripts/print-share-qr.mjs" "https://${DNS}/"
echo "Proxying that address to http://127.0.0.1:$PORT"
echo "Press Ctrl+C to stop."
echo ""
exec "$TS" serve "$PORT"
