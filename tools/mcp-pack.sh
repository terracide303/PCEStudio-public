#!/bin/sh
# tools/mcp-pack.sh — build pcestudio-mcp.zip, the MCP server a stranger can
# download (card #142). The repository is private, so the guide on the site
# cannot tell a tester to clone tools/mcp/server.js; it tells them to download
# this zip instead.
#
#   sh tools/mcp-pack.sh              build tools/gen/pcestudio-mcp.zip
#   sh tools/mcp-pack.sh <path.zip>   build somewhere else
#
# WHAT GOES IN — and nothing else:
#   * tools/mcp/server.js and the renderer/*.js modules it require()s.  The
#     list is WALKED from the code at build time, not typed here: a module the
#     server gains a require() for is in the pack without anyone remembering
#     to edit this file, and a module it drops is gone.  The walk follows
#     `require("./x.js")` relative to the requiring file and
#     `require(path.join(ROOT, "renderer", "x.js"))` from the server, through
#     the vendored Fengari (server.js -> pce-il.js -> vendor/fengari/...).
#   * renderer/ilvm.bin — not a require(), but server.js reads it in
#     export_pce (the IL bytecode interpreter image); without it that tool is
#     broken in the pack.
#   * plugin/skills/creating-pce-toys/ — the recipes and SKILL.md, which the
#     README says to link into a Claude Code session.
#   * LICENSE (GPL-3.0, so the download carries the licence) and README.txt.
#
# The zip is NEVER committed: it lands in tools/gen/, which .gitignore
# already excludes.  tools/deploy.sh uploads it to the site root.
#
# The pack is rooted at pcestudio-mcp/, so after unzipping the server is
# <folder>/pcestudio-mcp/tools/mcp/server.js and server.js's ROOT
# (__dirname/../..) finds renderer/ and vendor/ beside tools/. That layout is
# what the guide's `claude mcp add` line names.
set -eu
cd "$(dirname "$0")/.."

OUT="${1:-tools/gen/pcestudio-mcp.zip}"
case "$OUT" in /*) ;; *) OUT="$PWD/$OUT" ;; esac   # absolute: the zip runs from a temp dir

command -v zip >/dev/null 2>&1 || { echo "mcp-pack: zip is not installed" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "mcp-pack: node is not installed" >&2; exit 1; }
command -v unzip >/dev/null 2>&1 || { echo "mcp-pack: unzip is not installed" >&2; exit 1; }

STAGE="$(mktemp -d "${TMPDIR:-/tmp}/pce-mcp-pack-XXXXXX")" || exit 1
trap 'rm -rf "$STAGE"' EXIT
PACK="$STAGE/pcestudio-mcp"
mkdir -p "$PACK"

# ---- 1. walk the requires (and the ROOT-joined file reads) ----------------
FILES="$STAGE/files.txt"
node -e '
const fs = require("fs"), path = require("path");
const root = process.cwd(), seen = new Set(), out = [];
function add(rel, why) {
  const key = path.normalize(rel);
  if (seen.has(key)) return;
  const abs = path.join(root, key);
  if (!fs.existsSync(abs)) { console.error("mcp-pack: " + key + " required by " + why + " is missing"); process.exit(1); }
  seen.add(key); out.push(key);
  if (!/\.js$/.test(key)) return;
  const src = fs.readFileSync(abs, "utf8");
  for (const m of src.matchAll(/require\s*\(([^)]*)/g)) {
    const arg = m[1];
    const strs = [...arg.matchAll(/["\x27]([^"\x27]+)["\x27]/g)].map((x) => x[1]);
    if (!strs.length) continue;
    if (arg.includes("ROOT")) add(strs.join("/"), key);
    else if (strs[0].startsWith(".")) add(path.join(path.dirname(key), strs[0]), key);
  }
  for (const m of src.matchAll(/readFileSync\s*\(\s*path\.join\s*\(\s*ROOT\s*,([^)]*)/g)) {
    const strs = [...m[1].matchAll(/["\x27]([^"\x27]+)["\x27]/g)].map((x) => x[1]);
    if (strs.length) add(strs.join("/"), key);
  }
}
add("tools/mcp/server.js", "the pack");
out.sort().forEach((f) => console.log(f));
' > "$FILES"

[ -s "$FILES" ] || { echo "mcp-pack: the require walk found nothing" >&2; exit 1; }

# ---- 2. stage it ---------------------------------------------------------
while IFS= read -r f; do
  mkdir -p "$PACK/$(dirname "$f")"
  cp "$f" "$PACK/$f"
done < "$FILES"

# A vendored library ships with its own licence text, not only its code.
for lib in $(sed -n 's#^\(vendor/[^/]*\)/.*#\1#p' "$FILES" | sort -u); do
  for f in LICENSE VENDORED.md; do
    [ -f "$lib/$f" ] && cp "$lib/$f" "$PACK/$lib/$f"
  done
done

mkdir -p "$PACK/plugin/skills"
cp -R plugin/skills/creating-pce-toys "$PACK/plugin/skills/creating-pce-toys"

cp LICENSE "$PACK/LICENSE"
cat > "$PACK/README.txt" <<'TXT'
PCEStudio MCP server — make PC Engine toys from Claude Code.
Unzip; you get a pcestudio-mcp folder. It needs Node and nothing else.
Add the server (<folder> is that pcestudio-mcp folder):
claude mcp add pcestudio -- node <folder>/tools/mcp/server.js
claude mcp list        # it should say pcestudio ... connected
Link the skill: mkdir -p ~/.claude/skills
ln -s <folder>/plugin/skills/creating-pce-toys ~/.claude/skills/creating-pce-toys
Start a new Claude Code session: skills load when a session starts.
Tools: toy_write, toy_run, frame_png, validate, export_pce, docs, registers_get, register_set. Read SKILL.md for the loop.
Licensed GPL-3.0 (see LICENSE). The guide: https://pcestudio.terracides.com/pcestudio-for-claude.md
TXT

# The README is the download's first page; a version nobody counted drifts.
lines=$(wc -l < "$PACK/README.txt" | tr -d ' ')
[ "$lines" = "10" ] || { echo "mcp-pack: README.txt is $lines lines, the download's is 10" >&2; exit 1; }

# ---- 3. zip --------------------------------------------------------------
mkdir -p "$(dirname "$OUT")"
rm -f "$OUT"
( cd "$STAGE" && zip -qr -X "$OUT" pcestudio-mcp ) || { echo "mcp-pack: zip failed" >&2; exit 1; }

entries=$(unzip -Z1 "$OUT" | wc -l | tr -d ' ')
bytes=$(wc -c < "$OUT" | tr -d ' ')
echo "packed $entries entries, $bytes bytes -> $(echo "$OUT" | sed "s#^$PWD/##")"
echo "$OUT"
