#!/bin/bash
# Starts the Vite dev server.
# The role is chosen here, before Vite starts, the same way
# create-app.sh chooses --client or --server before the Mac app launches.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROLE_FILE="$PROJECT_DIR/.kytunes-role"
cd "$PROJECT_DIR"

ROLE="${KYTUNES_ROLE:-${VITE_KYTUNES_ROLE:-}}"
FROM_ENV=0
if [ -n "$ROLE" ]; then
  FROM_ENV=1
fi
CHOOSE=0
ARGS=()

while [ $# -gt 0 ]; do
  case "$1" in
    --role)
      if [ $# -lt 2 ]; then
        echo "Missing role after --role. Use client or server."
        exit 1
      fi
      ROLE="$2"
      FROM_ENV=0
      shift 2
      ;;
    --role=*)
      ROLE="${1#--role=}"
      FROM_ENV=0
      shift
      ;;
    --choose)
      CHOOSE=1
      ROLE=""
      FROM_ENV=0
      shift
      ;;
    *)
      ARGS+=("$1")
      shift
      ;;
  esac
done

if [ "$CHOOSE" = "0" ] && [ -z "$ROLE" ] && [ -f "$ROLE_FILE" ]; then
  ROLE="$(tr -d '[:space:]' < "$ROLE_FILE")"
  if [ "$ROLE" != "client" ] && [ "$ROLE" != "server" ]; then
    ROLE=""
  fi
fi

if [ -n "$ROLE" ] && [ "$ROLE" != "client" ] && [ "$ROLE" != "server" ]; then
  echo "Role must be client or server."
  exit 1
fi

choose_role() {
  echo "This dev server needs a role before it starts."
  echo ""
  echo "  client   This computer plays music from a library hosted somewhere else."
  echo "  server   This computer hosts the music."
  echo ""
  PS3="Choose client or server: "
  select ROLE in client server; do
    if [ "$ROLE" = "client" ] || [ "$ROLE" = "server" ]; then
      break
    fi
    echo "Type 1 or 2."
  done
  printf '%s\n' "$ROLE" > "$ROLE_FILE"
}

if [ -z "$ROLE" ]; then
  # Prompt only in a real terminal. npm run launch logs to a file and must not wait here.
  if [ -t 0 ] && [ -t 1 ]; then
    choose_role
  elif [ "$CHOOSE" = "1" ]; then
    echo "Choose client or server from a terminal, or pass --role client or --role server."
    exit 1
  fi
fi

if [ "$ROLE" = "client" ] || [ "$ROLE" = "server" ]; then
  export VITE_KYTUNES_ROLE="$ROLE"
  if [ "$FROM_ENV" = "0" ] && [ "$CHOOSE" = "0" ] && [ ! -f "$ROLE_FILE" ]; then
    printf '%s\n' "$ROLE" > "$ROLE_FILE"
  fi
  echo "KyTunes dev server: $ROLE"
  if [ "$ROLE" = "client" ]; then
    echo "This computer plays music from a library hosted somewhere else."
    echo "Open the address below and add that library."
  else
    echo "This computer hosts the music."
    echo "Open the address below, then enter the music folder and a password."
  fi
  echo "Run npm run dev -- --choose to switch."
  echo ""
fi

VITE_BIN="$PROJECT_DIR/node_modules/.bin/vite"
if [ ! -x "$VITE_BIN" ]; then
  echo "Vite is not installed. Run npm install in $PROJECT_DIR."
  exit 1
fi

if [ ${#ARGS[@]} -eq 0 ]; then
  exec "$VITE_BIN"
else
  exec "$VITE_BIN" "${ARGS[@]}"
fi
