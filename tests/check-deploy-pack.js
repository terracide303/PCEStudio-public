#!/usr/bin/env node
/*
 * tests/check-deploy-pack.js — the guard card #154 asks for: the MCP server
 * download cannot vanish from tools/deploy.sh again without a test going red.
 *
 * WHAT HAPPENED: 4f8483f (#142) added a PACK=tools/gen/pcestudio-mcp.zip block
 * to tools/deploy.sh — it builds the pack with tools/mcp-pack.sh, lists it in
 * `--dry`, and uploads it to the site root.  Merge 4b3c1a4 (2026-10-29 17:54,
 * "#125 CITY joins #127/#128's demo-art route") resolved tools/deploy.sh
 * wholesale to the #125 side and took the block with it.  Nothing failed, so
 * the next deploy put no zip up while renderer/pcestudio-for-claude.md still
 * told Claude Code users to download https://pcestudio.terracides.com/pcestudio-mcp.zip
 * (it answered 500).  A comment would not have prevented that; this does.
 *
 * WHAT IS CHECKED:
 *   1. `sh tools/deploy.sh --dry` exits 0.
 *   2. its output lists the pack: a line `tools/gen/pcestudio-mcp.zip` and a
 *      summary line `N files + pcestudio-mcp.zip` — the form #142 shipped and
 *      the one a reader of a deploy log looks for.
 *   3. the dry run really BUILT it: tools/gen/ is emptied of the zip first, and
 *      afterwards the zip is there, non-empty, and carries
 *      pcestudio-mcp/tools/mcp/server.js.  (A stale zip from an earlier run
 *      could otherwise make check 2 look true on a deploy that never builds.)
 *   4. the UP load, not just the listing: an active line in tools/deploy.sh
 *      uploads `"$PACK"` to `"$DEST"` — the site root, the URL the guide uses.
 *      --dry alone would pass a script that lists the pack and never sends it.
 *
 * The control, run every time: the same matcher is fed the dry output with the
 * pack line removed and must reject it, so a matcher that says yes to anything
 * cannot pass this test.  The card also names a second control — the
 * pre-restoration deploy.sh must fail this test — which was run when the card
 * was built and is recorded on the board, not here, because the fixed script is
 * what this checkout now carries.
 *
 * tests/all.sh picks this up by its name (its suite list is tests/check*.js),
 * so no edit to all.sh is needed for the wiring.
 *
 *   node tests/check-deploy-pack.js
 *
 * Written by @design because the card names this test.  Rule 2 (a cold break by
 * a different seat) is owed before the card closes.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const DEPLOY = path.join(ROOT, "tools", "deploy.sh");
const PACK = path.join(ROOT, "tools", "gen", "pcestudio-mcp.zip");
const PACK_REL = "tools/gen/pcestudio-mcp.zip";

let checks = 0;
const failures = [];

function check(ok, name) {
  checks++;
  if (!ok) { failures.push(name); console.log("FAIL  " + name); }
  return ok;
}

/* ---- the matcher, shared by the real check and its control ------------- */

/* Does this --dry output say the pack will be uploaded?  Both halves must be
 * there: the pack path on a line of its own, and the summary that counts it. */
function dryListsPack(stdout) {
  const lines = String(stdout).split(/\r?\n/).map((l) => l.trim());
  const listed = lines.some((l) => l === PACK_REL);
  const counted = lines.some((l) => /^\d+ files \+ pcestudio-mcp\.zip$/.test(l));
  return listed && counted;
}

/* An active (not commented-out) upload of "$PACK" to "$DEST" — a trailing
 * redirect such as `>/dev/null` is allowed, as the script writes it. */
function uploadsPack(src) {
  return String(src).split(/\r?\n/)
        .some((l) => /^\s*upload\s+"\$DEST"\s+"\$PACK"(?:\s|$)/.test(l));
}

/* ---- run the deploy's dry mode ----------------------------------------- */

// Empty the build slot first: check 3 must see THIS run build the zip.
try { fs.unlinkSync(PACK); } catch (e) { /* absent is the expected state */ }

const scratch = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "pce-deploy-check-"));
try {
  const dry = spawnSync("sh", [DEPLOY, "--dry"], {
    cwd: ROOT, encoding: "utf8", timeout: 180000,
    env: Object.assign({}, process.env, { TMPDIR: scratch }),
  });
  const out = (dry.stdout || "") + (dry.stderr || "");

  check(dry.status === 0, "sh tools/deploy.sh --dry exits 0 (got " +
        dry.status + (dry.error ? ": " + dry.error.message : "") + ")");
  check(dryListsPack(dry.stdout || ""),
        "--dry lists " + PACK_REL + " and counts it in the summary");

  // The control: the same matcher must say NO to that output with the pack
  // line taken out.  If it still says yes, the matcher is vacuous.
  const stripped = (dry.stdout || "").split(/\r?\n/)
        .filter((l) => l.trim() !== PACK_REL)
        .map((l) => l.replace(/^\d+ files \+ pcestudio-mcp\.zip$/, "$& removed"))
        .join("\n");
  check(dryListsPack(stripped) === false,
        "control: the matcher rejects the same output with the pack line removed");

  const built = fs.existsSync(PACK) && fs.statSync(PACK).size > 0;
  check(built, "the dry run built " + PACK_REL + " (non-empty)");
  if (built) {
    const names = spawnSync("unzip", ["-Z1", PACK], { encoding: "utf8" });
    check(names.status === 0 &&
          (names.stdout || "").split(/\r?\n/).includes("pcestudio-mcp/tools/mcp/server.js"),
          "the built zip carries pcestudio-mcp/tools/mcp/server.js");
  } else {
    check(false, "the built zip carries pcestudio-mcp/tools/mcp/server.js (no zip to inspect)");
  }

  const src = fs.readFileSync(DEPLOY, "utf8");
  check(uploadsPack(src),
        "tools/deploy.sh uploads \"$PACK\" to \"$DEST\" (the site root), not only lists it");
  check(spawnSync("sh", ["-n", DEPLOY], { encoding: "utf8" }).status === 0,
        "sh -n tools/deploy.sh parses");

  if (dry.status !== 0 && out) {
    console.log("---- deploy --dry output (tail) ----");
    console.log(out.split(/\r?\n/).slice(-15).join("\n"));
    console.log("------------------------------------");
  }
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}

console.log("");
if (failures.length) {
  for (const f of failures) console.log("FAIL  " + f);
  console.log("FAIL  " + failures.length + " of " + checks +
              " checks: tools/deploy.sh does not ship the MCP server download (#154)");
  process.exit(1);
}
console.log("PASS  " + checks + " checks: tools/deploy.sh builds " + PACK_REL +
            ", lists it in --dry and uploads it to the site root (#154)");
