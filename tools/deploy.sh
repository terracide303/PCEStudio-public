#!/bin/sh
# Put the browser studio online at https://pcestudio.terracides.com (Dennis, 2026-10-29: public).
#
#   PCE_CP_PASS=... sh tools/deploy.sh          upload
#   sh tools/deploy.sh --dry                    list what would be uploaded
#
# Only the web part goes up: renderer/, toys/ and the browser libraries the pages load.
# LICENSE (GPL-3.0) goes up with it. NOT tools/, tests/, docs/ or vendor/huc (its licence is not settled, docs/DECISIONS.md).
# Uploads go through cPanel's Fileman API over HTTPS: plain FTP to this host refused some files
# (451) and timed out on others, 2026-10-29. The password comes from the environment only.
set -eu
cd "$(dirname "$0")/.."
CP="${PCE_CP_HOST:-https://sv97.ifastnet.com:2083}"
USER="${PCE_CP_USER:-terracid}"
DEST="${PCE_CP_DIR:-public_html/pcestudio}"

files=$( { find renderer -type f \( -name '*.html' -o -name '*.js' -o -name '*.css' -o -name '*.bin' -o -name '*.json' -o -name '*.png' -o -name '*.md' \);
           find toys -type f;
           find vendor/codemirror vendor/fengari vendor/ppu-toys -type f;
           echo LICENSE; } | grep -v '/\.' | sort )

# #125: a demo toy's art is NOT in the repo (Dennis, 2026-10-29; docs/DECISIONS.md).
# It lives beside the repo in demo-art/<toy>/ and goes up with the toy, at
# art/<toy>/, which is where the gallery entry's `art` base points
# (renderer/pce-gallery.js's loadArt).  A folder without tiles.json is not a
# toy's picture and is skipped; the evidence/ subfolder stays behind.
DEMO_ART="${PCE_DEMO_ART:-/Volumes/External/agent-workshop-demo/demo-art}"
demo_files=""
for d in "$DEMO_ART"/*/; do
  [ -f "$d/tiles.json" ] || continue
  toy=$(basename "$d")
  for f in "$d"tiles.json "$d"palettes.json "$d"sprites.json; do
    [ -f "$f" ] && demo_files="$demo_files $f"
  done
done

if [ "${1:-}" = "--dry" ]; then
  echo "$files"
  [ -n "$demo_files" ] && for f in $demo_files; do echo "-> art/$(basename "$(dirname "$f")")/$(basename "$f")  $f"; done
  echo "$(echo "$files" | wc -l | tr -d ' ') files, $(echo $demo_files | wc -w | tr -d ' ') demo-art files"
  exit 0
fi
: "${PCE_CP_PASS:?set PCE_CP_PASS (never put it in a file)}"

jar=$(mktemp); trap 'rm -f "$jar"' EXIT
token=$(curl -s --max-time 40 -c "$jar" --data-urlencode "user=$USER" --data-urlencode "pass=$PCE_CP_PASS" \
          "$CP/login/?login_only=1" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("security_token",""))')
[ -n "$token" ] || { echo "cPanel login failed" >&2; exit 1; }

upload() {   # upload <remote dir> <file>...
  dir=$1; shift
  set -- $(for f; do printf ' -F file-%s=@%s' "$(echo "$f" | cksum | cut -d' ' -f1)" "$f"; done)
  out=$(curl -s --max-time 120 -b "$jar" -F "dir=$dir" -F "overwrite=1" "$@" "$CP$token/execute/Fileman/upload_files")
  echo "$out" | python3 -c 'import json,sys
d=json.load(sys.stdin)
if d.get("status")!=1: print("FAIL", d.get("errors")); sys.exit(1)
x=d["data"]; print("ok %d" % x["succeeded"]) if not x["failed"] else (print("FAIL", x), sys.exit(1))'
}

mkd() {      # make <path> under the destination (parent must exist)
  parent=$(dirname "$1"); name=$(basename "$1")
  curl -s --max-time 40 -b "$jar" "$CP$token/execute/Fileman/mkdir?path=$parent&name=$name" >/dev/null
}

# The site root opens the studio, and carries the chat-AI guide (#105) so it
# can be fetched by its own URL: https://pcestudio.terracides.com/pcestudio-for-claude.md
index=$(mktemp -d)/index.html
printf '<!doctype html><meta charset="utf-8"><title>PCEStudio</title>\n<meta http-equiv="refresh" content="0; url=renderer/studio.html">\n<a href="renderer/studio.html">PCEStudio</a>\n<p><a href="pcestudio-for-claude.md">PCEStudio for Claude</a> — the guide to paste into a chat AI.</p>\n' > "$index"
upload "$DEST" "$index" >/dev/null
upload "$DEST" renderer/pcestudio-for-claude.md >/dev/null

total=0
for d in $(echo "$files" | xargs -n1 dirname | sort -u); do
  p=""; [ "$d" = "." ] || for part in $(echo "$d" | tr '/' ' '); do p="${p:+$p/}$part"; mkd "$DEST/$p"; done
  group=$(echo "$files" | awk -v d="$d" '{ f=$0; if (index(f,"/")==0) f="."; else sub("/[^/]*$","",f); if (f==d) print $0 }')
  target="$DEST/$d"; [ "$d" = "." ] && target="$DEST"
  upload "$target" $group >/dev/null
  total=$((total + $(echo "$group" | wc -l)))
done
# the demo art, at art/<toy>/ (the gallery's `art` base)
for d in $(echo "$demo_files" | tr ' ' '\n' | xargs -n1 dirname | sort -u); do
  [ -n "$d" ] || continue
  toy=$(basename "$d")
  mkd "$DEST/art"; mkd "$DEST/art/$toy"
  upload "$DEST/art/$toy" $(echo "$demo_files" | tr ' ' '\n' | grep "^$d/" | tr '\n' ' ') >/dev/null
  total=$((total + $(echo "$demo_files" | tr ' ' '\n' | grep -c "^$d/")))
done

echo "uploaded $total files + index.html to $DEST"
