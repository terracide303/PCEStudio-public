#!/usr/bin/env node
/*
 * tools/tool-paths.js — where the external tools and the demo art live on
 * this machine (#295).
 *
 * The drives were renamed: PCEAS, llvm-mos, HuC and the demo art used to sit
 * under /Volumes/External and sit under /Volumes/External II now.  A suite
 * that named the old drive failed on this machine for a reason that had
 * nothing to do with what it checks.  So every consumer asks this module
 * instead of carrying a path of its own, with one order (docs/TESTING.md):
 *
 *   1. the environment override the tool has always read, used verbatim;
 *   2. the tool's home on /Volumes/External II;
 *   3. no path — the caller prints its own SKIP naming what it looked for.
 *
 * The old drive is NOT searched.  Its HuC builds the palette and parallax
 * ROMs to hashes that no longer match the pinned ones (measured 2026-11-14:
 * check-il-huc goes red with it), so finding it would turn a skip into a
 * FAIL.  A machine that keeps a tool on the old drive sets its override,
 * which behaves exactly as it did before this module existed.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const EXTERNAL_II = "/Volumes/External II";

/* One list per thing, in the order docs/TESTING.md names. */
const PCEAS = [
  path.join(EXTERNAL_II, "pce-tools", "bin", "pceas")
];
const LLVM_MOS = [
  path.join(EXTERNAL_II, "pce-tools", "llvm-mos", "llvm-mos"),  /* the SDK root */
  path.join(EXTERNAL_II, "pce-tools", "llvm-mos")               /* the unpacked parent */
];
const HUC = [
  path.join(EXTERNAL_II, "pce-tools", "huc-src")
];
const DEMO_ART = [
  path.join(EXTERNAL_II, "agent-workshop-demo", "support", "deploy-art"),
  path.join(EXTERNAL_II, "agent-workshop-demo", "demo-art")
];
const ORIGINAL_TOWER = [
  path.join(EXTERNAL_II, "backup-External", "pcestudio-toys", "originals",
            "tower", "main.lua"),
  path.join(EXTERNAL_II, "pcestudio-toys", "originals", "tower", "main.lua")
];
const OAK_PACK = [
  path.join(EXTERNAL_II, "Download", "oak_woods_v1.0.zip"),
  path.join(EXTERNAL_II, "agent-workshop-demo", "support", "packs",
            "oak_woods_v1.0.zip")
];

function firstExisting(candidates) {
  for (const p of candidates) {
    if (!p) continue;
    try { if (fs.existsSync(p)) return p; } catch (e) { /* try the next */ }
  }
  return null;
}

/* A directory counts only when every named entry is present: huc-src on
 * External II has bin/pceas but no bin/huc, so a bare directory test would
 * pick a toolchain that cannot compile. */
function firstWith(candidates, entries) {
  for (const dir of candidates) {
    if (!dir) continue;
    let complete = true;
    for (const e of entries) {
      try { if (!fs.existsSync(path.join(dir, e))) { complete = false; break; } }
      catch (err) { complete = false; break; }
    }
    if (complete) return dir;
  }
  return null;
}

module.exports = {
  EXTERNAL_II,
  candidates: { PCEAS, LLVM_MOS, HUC, DEMO_ART, ORIGINAL_TOWER, OAK_PACK },
  firstExisting,
  firstWith,

  /* $PCEAS, else the External II pceas, else null (check-asm SKIPs). */
  pceas() {
    return process.env.PCEAS || firstExisting(PCEAS);
  },

  /* $LLVM_MOS, else the first SDK root that carries bin/mos-pce-clang. */
  llvmMos() {
    return process.env.LLVM_MOS ||
      firstWith(LLVM_MOS, [path.join("bin", "mos-pce-clang")]);
  },

  /* $HUC_DIR, else the first huc-src with bin/huc AND bin/pceas. */
  huc() {
    return process.env.HUC_DIR ||
      firstWith(HUC, [path.join("bin", "huc"), path.join("bin", "pceas")]);
  },

  /* The caller's own $DEMO_ART (or $PCE_DEMO_ART) verbatim, else the first
   * demo-art folder on External II.  When neither exists it returns the
   * expected External II path rather than null, so path.join() and the
   * caller's own SKIP message still have a name to print. */
  demoArt(envValue) {
    return envValue || firstExisting(DEMO_ART) || DEMO_ART[0];
  },

  /* $PCESTUDIO_ORIGINAL_TOWER, else the copy kept on External II. */
  originalTower() {
    return process.env.PCESTUDIO_ORIGINAL_TOWER ||
      firstExisting(ORIGINAL_TOWER);
  },

  /* --pack, else $OAK_WOODS_PACK, else a copy on External II.  A missing
   * pack returns the first candidate so the caller can name it. */
  oakPack(packArg) {
    return packArg || process.env.OAK_WOODS_PACK ||
      firstExisting(OAK_PACK) || OAK_PACK[0];
  }
};
