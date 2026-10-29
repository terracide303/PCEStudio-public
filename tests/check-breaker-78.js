#!/usr/bin/env node
/*
 * tests/check-breaker-78.js — #91's two REVIEW-78 fixtures whose suites were
 * being rewritten by another seat when this check was written:
 *
 *   E05 — renderer/pce-editor.js's setVideoMode accepted any width, so the
 *         editor could store a dot clock the VCE does not have and leave
 *         videoMode(pic) undefined for the next preview or export.  The
 *         editor suite has refusal rows for every other VDC limit, but none
 *         called setVideoMode with an illegal width.
 *
 *   E01 — tools/viewer.asm's wide boot read HSR into HDR ($5F02 instead of
 *         $5F04) and no test saw it: tests/check-viewer.js compares the
 *         committed vwide512 capture with the renderer but never assembles
 *         viewer.asm, so the dump was from the pristine ROM and a source-only
 *         change was invisible.  This check builds the ROM, reads its boot,
 *         runs it in Mednafen and reads HDR back from the save state.
 *
 * Why this file and not check-editor.js / check-viewer.js: both files were
 * being edited in the shared working tree by another seat (#67's display
 * window) when #91 was worked.  Adding to them would have meant committing
 * that seat's in-progress work.  When the #67 work lands these fixtures
 * belong next to the other wide-window evidence; until then this file keeps
 * the two #78 gaps guarded on their own.
 *
 * What E05 proves: every width that is not 256, 336 or 512 is refused with
 * the documented `video-mode` code and leaves the picture unchanged, and
 * the three legal widths are still accepted and read back.
 *
 * What E01 proves, in two witnesses:
 *   1. the assembled ROM's boot loads HDR from $5F04/$5F05 (and HSR from
 *      $5F02/$5F03) — the addresses docs/ROM_LAYOUT.md gives the wide-window
 *      block at bank 1 offset 0x1F00;
 *   2. the same ROM run in Mednafen saves HDR equal to the block's HDR and
 *      to the committed tests/dumps/vwide512 capture — the read-back the
 *      break changed ($043F -> $0402).
 * Mednafen is required for witness 2; without it the suite prints SKIP and
 * still runs witness 1 and E05.  E01 is not counted as proven then.
 *
 * What this does NOT prove: that the wide picture's pixels are right (that
 * is tests/check-viewer.js's diff), any other viewer.asm boot register
 * (VPR/VDR/VCR are #67's evidence), setVideoMode's browser wiring (the
 * editor page's Dot clock control is check-editor.js's), or a picture on a
 * real console.  A `"512"` string still slips through setVideoMode's object
 * lookup; that is an observation from this card, not something fixed here.
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const TOOLS = path.join(ROOT, "tools");
const ROM = path.join(TOOLS, "gen", "vwide512.pce");
const WIDE_DUMP = path.join(__dirname, "dumps", "vwide512", "regs.json");
/* docs/ROM_LAYOUT.md: bank 1 offset 0x1F00.  A bank is 8 KiB in the .pce. */
const WINDOW_BLOCK = 0x2000 + 0x1F00;

let checks = 0;
let skipped = [];
const failures = [];

function check(ok, name) {
  checks++;
  if (!ok) {
    failures.push(name);
    console.log("FAIL  " + name);
  }
}
function eq(name, got, want) {
  check(JSON.stringify(got) === JSON.stringify(want),
        name + " (got " + JSON.stringify(got) + ", want " +
        JSON.stringify(want) + ")");
}

/* ---- E05: setVideoMode refuses a dot clock the VCE does not have ----- */

function checkVideoModeRefusal() {
  const ed = require("../renderer/pce-editor.js");
  const pic = ed.newPicture();
  ed.setVideoMode(pic, 512);
  eq("E05: the fixture starts on the 512-dot clock",
     ed.videoMode(pic).width, 512);

  for (const width of [256, 336, 512]) {
    const p = ed.newPicture();
    let threw = null;
    try { ed.setVideoMode(p, width); } catch (e) { threw = e; }
    check(threw === null, "E05: " + width + " dots is accepted" +
          (threw ? " (" + (threw.code || threw.message) + ")" : ""));
    check(ed.videoMode(p).width === width,
          "E05: " + width + " dots reads back");
  }

  for (const width of [400, 0, -1, 1024, 255, 513, null]) {
    /* After an illegal width was stored, videoMode() is undefined; keep the
     * loop reporting rather than crashing on it. */
    const modeBefore = ed.videoMode(pic);
    const before = modeBefore ? modeBefore.width : null;
    let code = null, threw = false;
    try { ed.setVideoMode(pic, width); } catch (e) {
      threw = true; code = e && e.code;
    }
    check(threw && code === "video-mode",
          "E05: " + JSON.stringify(width) + " dots is refused with " +
          "video-mode (" + (threw ? "code " + JSON.stringify(code)
                                  : "ACCEPTED") + ")");
    /* videoMode() reads the picture's width straight out of the mode table,
     * so a stored illegal width leaves it undefined here — report that
     * instead of throwing, which is what the next preview would do. */
    const mode = ed.videoMode(pic);
    check(!!mode && mode.width === before && pic.video === before,
          "E05: a refused " + JSON.stringify(width) + " leaves the picture " +
          "on " + before + " dots (pic.video " + pic.video + ", videoMode " +
          (mode ? mode.width : "undefined") + ")");
  }

  /* The refusal must not be the only thing that happens: the editor still
   * previews the picture it refused to move. */
  let size = null, previewErr = null;
  try { size = ed.previewSize(pic); } catch (e) { previewErr = e; }
  check(!!size && size.width === 512 && size.height > 0,
        "E05: after the refusals the 512-dot picture still previews (" +
        (previewErr ? "threw " + (previewErr.code || previewErr.message)
                    : size.width + "x" + size.height) + ")");
}

/* ---- E01: the wide viewer boot's HDR, from the ROM and a capture ----- */

function buildWide() {
  const r = spawnSync("make", ["-C", TOOLS, "gen/vwide512.pce"],
                      { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0) {
    return "make -C tools gen/vwide512.pce failed: " +
      ((r.stderr || r.stdout || "").trim().split("\n").slice(-2).join(" / ") ||
       "exit " + r.status);
  }
  if (!fs.existsSync(ROM)) return "make reported success but " + ROM +
    " does not exist";
  return null;
}

function bootBytes(rom) {
  function occurrences(pat) {
    const at = [];
    for (let i = 0; i + pat.length <= rom.length; i++) {
      let ok = true;
      for (let k = 0; k < pat.length; k++)
        if (rom[i + k] !== pat[k]) { ok = false; break; }
      if (ok) at.push(i);
    }
    return at;
  }
  const HDR = [0xAD, 0x04, 0x5F];      /* lda $5F04 (HDR lo / HDW) */
  const HDR_HI = [0xAD, 0x05, 0x5F];   /* lda $5F05 (HDR hi / HDE) */
  const HSR = [0xAD, 0x02, 0x5F];      /* lda $5F02 (HSR lo / HSW) */
  const HSR_HI = [0xAD, 0x03, 0x5F];   /* lda $5F03 (HSR hi / HDS) */
  return {
    hdr: occurrences(HDR), hdrHi: occurrences(HDR_HI),
    hsr: occurrences(HSR), hsrHi: occurrences(HSR_HI),
    all: occurrences
  };
}

function checkBoot() {
  const rom = fs.readFileSync(ROM);
  const b = bootBytes(rom);
  eq("E01: the assembled viewer has exactly one `lda $5F04` (HDR lo, the " +
     "wide block's HDW)", b.hdr.length, 1);
  eq("E01: the assembled viewer has exactly one `lda $5F05` (HDR hi)",
     b.hdrHi.length, 1);
  eq("E01: the assembled viewer has exactly one `lda $5F02` (HSR lo)",
     b.hsr.length, 1);
  eq("E01: the assembled viewer has exactly one `lda $5F03` (HSR hi)",
     b.hsrHi.length, 1);
  if (b.hdr.length === 1) {
    /* The HDR routine selects VDC register $0B first (`st0 #$0b` = 03 0B). */
    const at = b.hdr[0];
    let armed = false;
    for (let i = Math.max(0, at - 40); i + 1 < at; i++) {
      if (rom[i] === 0x03 && rom[i + 1] === 0x0B) { armed = true; break; }
    }
    check(armed, "E01: the `lda $5F04` sits in the HDR write ($0B) routine " +
          "(no `st0 #$0b` within 40 bytes before it at $" +
          at.toString(16) + ")");
  }
}

/* The window block as the ROM carries it: [VCE CR, unused, HSR lo, HSR hi,
 * HDR lo, HDR hi, ...] (docs/ROM_LAYOUT.md). */
function windowBlock() {
  const rom = fs.readFileSync(ROM);
  if (rom.length < WINDOW_BLOCK + 8) return null;
  const b = rom.slice(WINDOW_BLOCK, WINDOW_BLOCK + 8);
  return {
    VCECR: b[0],
    HSR: b[2] | (b[3] << 8),
    HDR: b[4] | (b[5] << 8)
  };
}

function haveMednafen() {
  const r = spawnSync("sh", ["-c", "command -v mednafen"],
                      { encoding: "utf8" });
  return r.status === 0 && (r.stdout || "").trim() !== "";
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/* One headless Mednafen run: the same signal route tools/capture.sh uses
 * (SIGINT -> CloseGame -> autosave), with SDL's dummy video/audio drivers so
 * no window takes the screen the human is using.  No synthetic key or mouse
 * event is sent. */
function captureOnce(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pce91-wide-"));
  const romCopy = path.join(dir, name + ".pce");
  fs.copyFileSync(ROM, romCopy);
  const logPath = path.join(dir, "mednafen.log");
  const log = fs.openSync(logPath, "w");
  const child = spawn("mednafen", [
    "-force_module", "pce", "-pce.xscale", "1", "-pce.yscale", "1",
    "-autosave", "1", romCopy
  ], {
    cwd: ROOT,
    env: Object.assign({}, process.env,
                       { SDL_VIDEODRIVER: "dummy",
                         SDL_AUDIODRIVER: "dummy" }),
    stdio: ["ignore", log, log]
  });
  sleepMs(7000);
  try { child.kill("SIGINT"); } catch (e) { /* already gone */ }
  for (let i = 0; i < 15 && child.exitCode === null; i++) sleepMs(500);
  try { child.kill("SIGKILL"); } catch (e) { /* already gone */ }
  fs.closeSync(log);

  const mcsDir = path.join(os.homedir(), ".mednafen", "mcs");
  let state = null;
  try {
    const files = fs.readdirSync(mcsDir)
      .filter((f) => f.startsWith(name + ".") && f.endsWith(".mca"))
      .map((f) => path.join(mcsDir, f))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    state = files[0] || null;
  } catch (e) { state = null; }

  let regs = null, why = null;
  if (!state) {
    why = "no autosave state in " + mcsDir + " (see " + logPath + ")";
  } else {
    const out = path.join(dir, "dump");
    const r = spawnSync("python3", ["-I", path.join(TOOLS, "mcs-extract.py"),
                                    state, out, "4"],
                        { encoding: "utf8" });
    if (r.status !== 0 || !fs.existsSync(path.join(out, "regs.json"))) {
      why = "mcs-extract.py exit " + r.status + ": " +
        ((r.stderr || r.stdout || "").trim().split("\n").slice(-1)[0] || "");
    } else {
      regs = JSON.parse(fs.readFileSync(path.join(out, "regs.json"), "utf8"));
    }
  }
  /* Remove this run's state so the next run's glob cannot read it. */
  if (state) { try { fs.rmSync(state, { force: true }); } catch (e) {} }
  return { regs: regs, why: why, dir: dir };
}

function captureWide() {
  const name = "vwidegaps91-" + process.pid;
  let got = captureOnce(name);
  if (!got.regs) got = captureOnce(name);        /* one more settle window */
  return got;
}

function checkCapture(block) {
  const committed = JSON.parse(fs.readFileSync(WIDE_DUMP, "utf8"));
  check(block !== null, "E01: the ROM carries the wide-window block at $" +
        WINDOW_BLOCK.toString(16));
  if (block) {
    eq("E01: the ROM's block VCE CR is the picture's", block.VCECR,
       committed.VCECR);
    eq("E01: the ROM's block HDR is the capture's HDR", block.HDR,
       committed.HDR);
    eq("E01: the ROM's block HSR is the capture's HSR", block.HSR,
       committed.HSR);
  }

  if (!haveMednafen()) {
    skipped.push("E01 capture read-back (mednafen not found)");
    console.log("SKIP  E01 capture read-back: mednafen not found");
    return;
  }
  const cap = captureWide();
  if (!cap.regs) {
    check(false, "E01: the rebuilt wide ROM could not be captured (" +
          cap.why + ")");
    return;
  }
  eq("E01: the rebuilt ROM's saved HDR is the wide block's HDR (HDR wrote " +
     "$5F04, not $5F02)", cap.regs.HDR, committed.HDR);
  eq("E01: the rebuilt ROM's saved HSR is the committed capture's",
     cap.regs.HSR, committed.HSR);
  eq("E01: the rebuilt ROM's saved VCE CR is the picture's", cap.regs.VCECR,
     committed.VCECR);
}

/* ---- main ------------------------------------------------------------ */

function main() {
  checkVideoModeRefusal();

  const build = buildWide();
  if (build) {
    check(false, "E01: " + build);
  } else {
    checkBoot();
    checkCapture(windowBlock());
  }

  if (failures.length) {
    console.log("FAIL  " + failures.length + " of " + checks + " checks failed" +
                (skipped.length ? " (" + skipped.length + " skipped)" : ""));
    process.exit(1);
  }
  console.log("PASS  " + checks + " checks, #91: setVideoMode refuses a dot " +
              "clock the VCE does not have, and the wide viewer's boot writes " +
              "HDR from $5F04 (assembled and read back from a Mednafen save " +
              "state)" + (skipped.length ? "; SKIP " + skipped.join("; ")
                                         : ""));
}

main();
