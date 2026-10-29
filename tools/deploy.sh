#!/bin/sh
# Put the browser studio online at https://pcestudio.terracides.com (Dennis, 2026-10-29: public).
#
#   PCE_CP_PASS=... sh tools/deploy.sh          upload
#   sh tools/deploy.sh --dry                    list what would be uploaded
#   sh tools/deploy.sh --dry --stage DIR        ... and leave the staged copy in DIR
#
# Only the web part goes up: renderer/, toys/ and the browser libraries the pages load.
# The MCP server pack (tools/gen/pcestudio-mcp.zip, built here by tools/mcp-pack.sh, never
# committed) goes up too, at the site root, so a tester's Claude Code can drive PCEStudio.
# LICENSE (GPL-3.0) goes up with it. NOT tools/, tests/, docs/ or the vendored HuC copy (its licence is not settled, docs/DECISIONS.md).
# Uploads go through cPanel's Fileman API over HTTPS: plain FTP to this host refused some files
# (451) and timed out on others, 2026-10-29. The password comes from the environment only.
set -eu
cd "$(dirname "$0")/.."
CP="${PCE_CP_HOST:-https://sv97.ifastnet.com:2083}"
USER="${PCE_CP_USER:-terracid}"
DEST="${PCE_CP_DIR:-public_html/pcestudio}"

# --dry lists what would go up.  --stage DIR also leaves the staged copy in DIR:
# the HTML a visitor would receive (with its ?v= stamps), the generated index.html
# and .htaccess.  tests/check-deploy-cache.js reads that copy; nothing in the
# repository is ever rewritten.
dry=0
stage_dir=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry) dry=1 ;;
    --stage)
      [ $# -ge 2 ] || { echo "--stage needs a directory" >&2; exit 2; }
      stage_dir=$2; shift ;;
    *) echo "usage: sh tools/deploy.sh [--dry] [--stage DIR]" >&2; exit 2 ;;
  esac
  shift
done

files=$( { find renderer -type f \( -name '*.html' -o -name '*.js' -o -name '*.css' -o -name '*.bin' -o -name '*.json' -o -name '*.png' -o -name '*.md' \);
           find toys -type f;
           find vendor/codemirror vendor/fengari vendor/ppu-toys -type f;
           echo LICENSE; } | grep -v '/\.' | sort )

# The MCP server as a download (#142; restored by #154 — merge 4b3c1a4 dropped
# this block and the site kept linking a zip that was never uploaded). A
# stranger cannot clone this private repo, so the guide points at
# pcestudio-mcp.zip on the site. It is built by tools/mcp-pack.sh into
# tools/gen/ (gitignored, never committed) and goes to the site root beside
# the guide. tests/check-deploy-pack.js fails if --dry stops listing it.
PACK=tools/gen/pcestudio-mcp.zip
sh tools/mcp-pack.sh "$PACK" >/dev/null

# ---- the staged copy, and the two cache fixes (#155) ----------------------
# Dennis, 2026-10-29: 'the toys on the website is not up to date and has the
# wrong toys'.  @workshop measured the cause: the host answers
# renderer/gallery-toys.js with `cache-control: max-age=2592000, public` — 30
# days — so a browser that loaded the site once kept the old gallery and the
# old scripts, and Browse showed toys the site no longer had.  It is fixed at
# both ends:
#
#   1. .htaccess (below) tells Apache to revalidate every page, script,
#      stylesheet and data file.  Images and fonts are not matched: they keep
#      the caching the host gives them.  The file list skips dotfiles by
#      construction (`grep -v '/\.'`), so it is generated here and uploaded
#      explicitly.
#   2. Every local <script src>/<link href> in the staged HTML carries
#      ?v=<git short hash>, so even a proxy that cached a file on its own, or a
#      host with AllowOverride off (which ignores .htaccess), cannot pair a new
#      page with an old script.
#
# The rewrite runs on the staged copy ONLY: the repository's HTML is what the
# editor and the tests read, and a ?v= committed there would be stale by the
# next commit.
V=$(git rev-parse --short HEAD 2>/dev/null || echo dev)

stage_keep=0
if [ -n "$stage_dir" ]; then
  web_stage=$stage_dir
  stage_keep=1
  mkdir -p "$web_stage"
else
  web_stage=$(mktemp -d "${TMPDIR:-/tmp}/pce-stage-XXXXXX")
fi
jar=""
cleanup() {
  if [ -n "$jar" ]; then rm -f "$jar"; fi
  if [ "$stage_keep" -eq 0 ]; then rm -rf "$web_stage"; fi
  return 0
}
trap cleanup EXIT

cat > "$web_stage/.htaccess" <<'HTACCESS'
# PCEStudio — anything that can change between deploys is revalidated (#155).
# The host answered renderer/gallery-toys.js with
# `cache-control: max-age=2592000, public` (30 days, @workshop 2026-10-29), so a
# visitor who had loaded the site once kept an old gallery and old scripts.
# Images and fonts are deliberately not matched: they keep their cache.
<IfModule mod_headers.c>
  <FilesMatch "\.(html|js|json|md|css)$">
    Header set Cache-Control "no-cache"
  </FilesMatch>
</IfModule>
HTACCESS

# Only the HTML is staged (it is the only thing the ?v= rewrite touches); the
# vendor libraries are uploaded from the repository as they are.
for f in $files; do
  case "$f" in
    *.html) mkdir -p "$web_stage/$(dirname "$f")"; cp "$f" "$web_stage/$f" ;;
  esac
done
node tools/cache-bust.js "$web_stage" "$V"

# The site root lands on Browse (#155: Dennis wants the site to open on the
# toys), and carries the chat-AI guide (#105) so it can be fetched by its own
# URL: https://pcestudio.terracides.com/pcestudio-for-claude.md
printf '<!doctype html><meta charset="utf-8"><title>PCEStudio</title>\n<meta http-equiv="refresh" content="0; url=renderer/browse.html">\n<h1><a href="renderer/browse.html">PCEStudio — Browse the toys</a></h1>\n<p><a href="renderer/studio.html">Open the studio</a></p>\n<p><a href="pcestudio-for-claude.md">PCEStudio for Claude</a> — the guide to paste into a chat AI.</p>\n' > "$web_stage/index.html"

# The summary line keeps the form tests/check-deploy-pack.js matches (#154).
if [ "$dry" = 1 ]; then
  echo "$files"
  echo .htaccess
  echo index.html
  echo "$PACK"
  echo "$(echo "$files" | wc -l | tr -d ' ') files + pcestudio-mcp.zip"
  echo "(index.html and .htaccess are generated; images and fonts stay cached)"
  exit 0
fi
: "${PCE_CP_PASS:?set PCE_CP_PASS (never put it in a file)}"

jar=$(mktemp)
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

# The site root opens Browse, carries the chat-AI guide (#105), and tells the
# server to revalidate (.htaccess, #155). Both generated files are uploaded here
# because the file list above cannot contain them.
upload "$DEST" "$web_stage/index.html" >/dev/null
upload "$DEST" "$web_stage/.htaccess" >/dev/null
upload "$DEST" renderer/pcestudio-for-claude.md >/dev/null
# The MCP server pack (#142) sits at the site root: .../pcestudio-mcp.zip,
# the URL the guide and README.txt give a tester.
upload "$DEST" "$PACK" >/dev/null

total=0
for d in $(echo "$files" | xargs -n1 dirname | sort -u); do
  p=""; [ "$d" = "." ] || for part in $(echo "$d" | tr '/' ' '); do p="${p:+$p/}$part"; mkd "$DEST/$p"; done
  group=$(echo "$files" | awk -v d="$d" '{ f=$0; if (index(f,"/")==0) f="."; else sub("/[^/]*$","",f); if (f==d) print $0 }')
  target="$DEST/$d"; [ "$d" = "." ] && target="$DEST"
  # HTML comes from the staged copy (its ?v= stamps); everything else straight
  # from the repository.
  staged_group=$(for f in $group; do
    if [ -f "$web_stage/$f" ]; then printf '%s\n' "$web_stage/$f"; else printf '%s\n' "$f"; fi
  done)
  upload "$target" $staged_group >/dev/null
  total=$((total + $(echo "$group" | wc -l)))
done
# ---- the demo art (#127, #128), which is NEVER in the repository ----------
# Dennis, 2026-10-29: the packs' art may be shown on the site but not
# committed (docs/DECISIONS.md).  Each demo's playable toy and its converted
# picture live beside the repo in demo-art/<toy>/; this uploads them, and
# makes the site's gallery carry the playable source instead of the repo's
# placeholder.  The repo's own renderer/gallery-toys.js stays the art-free
# copy the tests check — this is the only place the two are joined.
DEMO_ART="${DEMO_ART:-/Volumes/External/agent-workshop-demo/demo-art}"
demo_toys=""
for toy in oak-woods city; do
  [ -f "$DEMO_ART/$toy/main.lua" ] && demo_toys="$demo_toys $toy"
done
if [ -n "$demo_toys" ]; then
  stage=$(mktemp -d "${TMPDIR:-/tmp}/pce-deploy-XXXXXX")
  node tools/gallery.js --with-demo-art > "$stage/gallery-toys.js"
  upload "$DEST/renderer" "$stage/gallery-toys.js" >/dev/null
  total=$((total + 1))
  rm -rf "$stage"
  for toy in $demo_toys; do
    echo "demo art: $DEMO_ART/$toy"
    # the art folder, and the playable main.lua where the toy page's Raw
    # source and the gallery's ../toys/ link point
    mkd "$DEST"; mkd "$DEST/demo-art"; mkd "$DEST/demo-art/$toy"; mkd "$DEST/toys/$toy"
    art=$(find "$DEMO_ART/$toy" -type f ! -name '.*' | sort)
    upload "$DEST/demo-art/$toy" $art >/dev/null
    total=$((total + $(echo "$art" | wc -l)))
    upload "$DEST/toys/$toy" "$DEMO_ART/$toy/main.lua" >/dev/null
    total=$((total + 1))
  done
else
  echo "demo art: none beside $DEMO_ART — the site keeps the placeholders"
fi
echo "uploaded $total files + index.html + .htaccess to $DEST"
