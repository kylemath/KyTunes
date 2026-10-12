#!/usr/bin/env bash
# Builds the GitHub Pages site: main at /KyTunes/, and every other branch at
# /KyTunes/preview/<branch>/ so a branch can be tried on a phone before merging.
set -euo pipefail

out="${1:-site}"
repo_root="$(pwd)"
work="$(mktemp -d)"
rm -rf "$out"
mkdir -p "$out/preview"

git fetch --no-tags --prune origin '+refs/heads/*:refs/remotes/origin/*'

build() {
  local ref="$1" base="$2" dest="$3"
  local dir="$work/$(echo "$ref" | tr '/' '_')"
  git worktree add --detach "$dir" "origin/$ref" >/dev/null
  # Chained with && because set -e is off when build runs inside an if.
  (
    cd "$dir" &&
    npm ci --no-audit --no-fund &&
    npx tsc -b &&
    KYTUNES_BASE="$base" npx vite build --mode pages --base "$base"
  ) || return 1
  mkdir -p "$dest"
  cp -R "$dir/dist/." "$dest/"
  git worktree remove --force "$dir"
}

build main /KyTunes/ "$out"
# The main site's service worker covers /KyTunes/preview/ too. Until main's vite
# config excludes previews itself, patch its offline fallback so it can't
# answer preview pages with main's index.html.
if ! grep -q 'preview' "$out/sw.js"; then
  sed -i 's#denylist:\[#denylist:[/\\/preview\\//,#' "$out/sw.js"
fi

links=""
for ref in $(git for-each-ref --format='%(refname:lstrip=3)' refs/remotes/origin); do
  [ "$ref" = main ] || [ "$ref" = HEAD ] || [ "$ref" = gh-pages ] && continue
  slug="$(printf %s "$ref" | tr -c 'A-Za-z0-9._-' '-')"
  if build "$ref" "/KyTunes/preview/$slug/" "$out/preview/$slug"; then
    when="$(git log -1 --format='%cr — %s' "origin/$ref" | sed 's/&/\&amp;/g; s/</\&lt;/g')"
    links="$links<li><a href=\"$slug/\">$ref</a><small>$when</small></li>"
  else
    echo "::warning::Preview build failed for $ref"
    git worktree remove --force "$work/$(echo "$ref" | tr '/' '_')" 2>/dev/null || true
  fi
done

cat > "$out/preview/index.html" <<HTML
<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>KyTunes previews</title>
<style>
  body { font: 16px system-ui, sans-serif; background: #111827; color: #e5e7eb; margin: 0; padding: 24px 16px; }
  h1 { font-size: 20px; } a { color: #818cf8; font-size: 18px; }
  ul { list-style: none; padding: 0; } li { padding: 12px 0; border-bottom: 1px solid #1f2937; }
  small { display: block; color: #9ca3af; margin-top: 4px; }
</style>
<h1>KyTunes branch previews</h1>
<p><a href="../">main</a></p>
<ul>${links:-<li>No other branches.</li>}</ul>
HTML

cd "$repo_root"
git worktree prune
