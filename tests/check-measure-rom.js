#!/usr/bin/env node
/*
 * tests/check-measure-rom.js — #169's evidence: the interpreter ROM's speed
 * counters, read back through tools/measure-rom.js.
 *
 * The counters are the interpreter's own (docs/ROM_LAYOUT.md): per update,
 * whether the next VBlank arrived before the update finished (an OVERRUN)
 * and the longest update in scanlines.  A "update" is frame(), or frame()
 * plus the 224-call raster collection for a toy with a raster() callback.
 *
 * What is checked, with real Mednafen runs of freshly emitted ROMs:
 *
 *   1. A deliberately heavy toy (a 600-iteration loop in frame()) reports
 *      overruns > 0, a worst update past one 262-line video frame, and the
 *      "too slow" verdict.
 *   2. A light toy reports overruns === 0 and the "60 Hz" verdict.
 *   3. A middle toy (a 50-iteration loop) reports overruns > 0, a worst
 *      update inside two video frames, and the "30 Hz" verdict — the middle
 *      band the verdict has to tell apart from both ends.
 *   4. A different PICTURE does not change the counters: two ROMs with the
 *      same frame() but different init() output (a palette write vs 256
 *      VRAM words) report the same overruns (0) and the same worst update
 *      within one timer tick (2.25 scanlines).  The counters measure the
 *      update, not what it draws.
 *
 * Mednafen is the only emulator with a scriptable save state in this repo
 * (docs/ROM_SPEED.md); when it is not installed this suite prints SKIP with
 * the reason and exits 0, like the other emulator suites.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const EMIT = path.join(ROOT, "tools", "ilvm", "emit.js");
const MEASURE = path.join(ROOT, "tools", "measure-rom.js");
const MEDNAFEN = process.env.MEDNAFEN || "/opt/homebrew/bin/mednafen";
const FRAME_LINES = 262;
const TICK_LINES = 2.25;           /* one TMA tick = 1024 clocks */

let checks = 0;
let failures = [];

function check(ok, name) {
  checks++;
  if (!ok) { failures.push(name); console.log("FAIL  " + name); }
}

function eq(name, got, want) {
  check(got === want, name + " (got " + JSON.stringify(got) + ", want " +
        JSON.stringify(want) + ")");
}

const HEAVY = [
  "function frame(t, f)",
  "  local a = 0",
  "  for i = 0, 600 do",
  "    a = a + i",
  "  end",
  "end",
  ""
].join("\n");

const MID = [
  "function frame(t, f)",
  "  local a = 0",
  "  for i = 0, 50 do",
  "    a = a + i",
  "  end",
  "end",
  ""
].join("\n");

/* The same update, two pictures: init() is outside every measured bracket. */
const LIGHT_A = [
  "function init()",
  "  pal(1, rgb(1, 0, 0))",
  "end",
  "function frame(t, f)",
  "  local a = f + 1",
  "  local b = a * 2",
  "end",
  ""
].join("\n");

const LIGHT_B = [
  "function init()",
  "  for i = 0, 63 do",
  "    pal(i, rgb(3, 2, 1))",
  "  end",
  "  for i = 0, 255 do",
  "    vram[i] = i * 17",
  "  end",
  "end",
  "function frame(t, f)",
  "  local a = f + 1",
  "  local b = a * 2",
  "end",
  ""
].join("\n");

function run(args, opts) {
  const r = spawnSync(process.execPath, args, Object.assign({
    cwd: ROOT, encoding: "utf8", timeout: 180000
  }, opts || {}));
  return r;
}

/* Emit a toy and measure its ROM.  Returns the tool's JSON. */
function measure(toyName, source, frames) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "measure-" + toyName + "-"));
  const lua = path.join(dir, toyName + ".lua");
  const rom = path.join(dir, toyName + ".pce");
  fs.writeFileSync(lua, source);
  const emit = run([EMIT, lua, rom, toyName]);
  check(emit.status === 0, toyName + ": tools/ilvm/emit.js exits 0" +
        (emit.status === 0 ? "" : " (" +
         (emit.stderr || "").trim().split("\n").slice(-1)[0] + ")"));
  if (emit.status !== 0) return null;
  const m = run([MEASURE, rom, "--frames", String(frames)]);
  check(m.status === 0, toyName + ": tools/measure-rom.js exits 0" +
        (m.status === 0 ? "" : " (" +
         (m.stderr || "").trim().split("\n").slice(-1)[0] + ")"));
  if (m.status !== 0) return null;
  let json;
  try {
    json = JSON.parse(m.stdout);
  } catch (e) {
    check(false, toyName + ": measure-rom prints one JSON object (" +
          JSON.stringify(m.stdout.slice(0, 120)) + ")");
    return null;
  }
  return json;
}

function main() {
  console.log("check-measure-rom: #169 the interpreter's overrun and " +
              "worst-update counters");

  if (!fs.existsSync(MEDNAFEN)) {
    console.log("SKIP  mednafen not found at " + MEDNAFEN +
                " (set MEDNAFEN to its path); the save-state readback " +
                "cannot run");
    return;
  }

  const heavy = measure("heavy", HEAVY, 150);
  const light = measure("light", LIGHT_A, 120);
  const mid = measure("mid", MID, 120);
  const lightB = measure("light-b", LIGHT_B, 120);
  if (!heavy || !light || !mid || !lightB) {
    console.log("FAIL " + failures.length + " of " + checks + " checks");
    process.exit(1);
  }

  /* the contract's four keys, no more */
  eq("the result has the four documented keys",
     Object.keys(heavy).sort().join(","),
     "frames,overruns,verdict,worstUpdateLines");
  check(heavy.frames > 0 && light.frames > 0 && mid.frames > 0,
        "all three toys measured updates (heavy " + heavy.frames +
        ", light " + light.frames + ", mid " + mid.frames + ")");

  /* 1. heavy */
  check(heavy.overruns > 0, "heavy: overruns > 0 (got " + heavy.overruns + ")");
  check(heavy.worstUpdateLines > FRAME_LINES,
        "heavy: the worst update is past one video frame (" +
        heavy.worstUpdateLines + " lines, need > " + FRAME_LINES + ")");
  eq("heavy: verdict is 'too slow'", heavy.verdict, "too slow");

  /* 2. light */
  eq("light: overruns is 0", light.overruns, 0);
  check(light.worstUpdateLines <= FRAME_LINES,
        "light: the worst update fits one video frame (" +
        light.worstUpdateLines + " lines)");
  eq("light: verdict is '60 Hz'", light.verdict, "60 Hz");

  /* 3. middle: the band between 60 and too slow */
  check(mid.overruns > 0, "mid: overruns > 0 (got " + mid.overruns + ")");
  check(mid.worstUpdateLines > FRAME_LINES &&
        mid.worstUpdateLines <= 2 * FRAME_LINES,
        "mid: the worst update is between one and two video frames (" +
        mid.worstUpdateLines + " lines)");
  eq("mid: verdict is '30 Hz'", mid.verdict, "30 Hz");

  /* 4. a different picture does not move the counters */
  eq("a different picture: overruns unchanged", lightB.overruns, light.overruns);
  check(Math.abs(lightB.worstUpdateLines - light.worstUpdateLines) <=
        2 * TICK_LINES,
        "a different picture: the worst update is unchanged within one " +
        "timer tick (" + light.worstUpdateLines + " vs " +
        lightB.worstUpdateLines + " lines)");
  eq("a different picture: verdict unchanged", lightB.verdict, light.verdict);

  console.log("      heavy: " + heavy.frames + " updates, " + heavy.overruns +
              " overruns, worst " + heavy.worstUpdateLines + " lines");
  console.log("      light: " + light.frames + " updates, " + light.overruns +
              " overruns, worst " + light.worstUpdateLines + " lines");
  console.log("      mid:   " + mid.frames + " updates, " + mid.overruns +
              " overruns, worst " + mid.worstUpdateLines + " lines");

  if (failures.length) {
    console.log("FAIL " + failures.length + " of " + checks + " checks");
    process.exit(1);
  }
  console.log("PASS " + checks + " checks");
}

main();
