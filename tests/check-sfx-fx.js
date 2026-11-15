#!/usr/bin/env node
/*
 * tests/check-sfx-fx.js — the sound effects (noise, slide, envelope, presets;
 * renderer/pce-sfx.js) write the same PSG registers in the browser host, the
 * interpreter ROM and the natively compiled ROM, frame for frame.
 *
 *   node tests/check-sfx-fx.js
 *
 * tools/toys/fx.lua plays every preset (several at once, on different
 * channels), the short forms, a plain sfx() cutting into a noise effect and an
 * effect that ends by itself.  The studio runtime's own write log is the
 * reference.  Both ROMs are TRACE builds (the engine's test-only PSG write log,
 * never a shipped ROM) run in Geargrafx through its MCP server; ggmcp.py's
 * `psgstream` lifts the log's window and drains it after every video frame, so
 * the WHOLE stream comes back: [toy frame, register, value] per write.
 * Each preset's own writes (the ones for its channel while it plays) are also
 * compared alone, so a failure names the preset.
 *
 * Without Geargrafx, llvm-mos or PCEAS 4.x the ROM parts print SKIP and the
 * host-only checks (the model, the refusals, the docs) still run.
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const il = require("../renderer/pce-il.js");
const ilbc = require("../renderer/pce-ilbc.js");
const romLib = require("../renderer/pce-rom.js");
const validate = require("../renderer/pce-validate.js");
const toys = require("../renderer/pce-toys.js");
const host = require("../renderer/pce-toyhost.js");
const sfx = require("../renderer/pce-sfx.js");
const toolPaths = require("../tools/tool-paths.js");

const ROOT = path.join(__dirname, "..");
const TOY = "tools/toys/fx.lua";
const FRAMES = 245;
let checks = 0;
const failures = [], skipped = [];
function check(ok, name) { checks++; if (!ok) { failures.push(name); console.log("FAIL  " + name); } }
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  check(ok, name + (ok ? "" : ": got " + JSON.stringify(got).slice(0, 300) + " want " + JSON.stringify(want).slice(0, 300)));
}

/* ---- 1. the model and the refusals, host only ------------------------- */
eq("nine presets, by name", sfx.presetNames(),
   ["jump", "shoot", "hit", "coin", "explosion", "powerup", "select", "hurt", "laser"]);
sfx.PRESETS.forEach((p) => {
  check(p.attack + p.decay <= p.frames && p.frames <= 255 && p.volume <= 31,
        p.name + ": attack + decay fit the frames, frames <= 255, volume <= 31");
  check(p.wave === sfx.WAVE_NOISE ? (p.from <= 31 && p.to <= 31) : (p.from <= 4095 && p.to <= 4095),
        p.name + ": from/to in the wave's range");
});
check(sfx.WAVES[0].length === 32 && sfx.WAVES[2].length === 32 && sfx.WAVES[3].length === 32,
      "the three tone waves are 32 steps");

const source = fs.readFileSync(path.join(ROOT, TOY), "utf8");
function rtEvents(src, frames) {
  const rt = il.create(src, { chunkName: "fx.lua" });
  rt.load();
  for (let k = 0; k < frames; k++) rt.frame(k);
  return rt.sound.events.filter((e) => e.f < frames).map((e) => [e.f, e.reg, e.value]);
}
const want = rtEvents(source, FRAMES);
check(want.length > 600, "the studio's stream for fx.lua has " + want.length + " writes");

function refuses(src, code, label) {
  let got = null;
  try { const rt = il.create(src, { chunkName: "t.lua" }); rt.load(); rt.frame(0); } catch (e) { got = e.code || e.name; }
  eq(label + ": refused by the IL runtime with " + code, got, code);
}
function validates(src, code, label) {
  const rep = validate.validate(src, { chunkName: "t.lua", frames: 2 });
  const codes = (rep.problems || []).map((p) => p.code);
  check(codes.indexOf(code) >= 0, label + ": the validator reports " + code + " (got " + codes.join(",") + ")");
}
refuses('function frame(t, f) sfx_preset("nope", 0) end', "il-sfx-preset", "an unknown preset name");
validates('function frame(t, f) sfx_preset("nope", 0) end', "il-sfx-preset", "an unknown preset name");
validates('function frame(t, f) sfx_preset(3, 0) end', "il-sfx-preset", "a preset name that is not a string");
const named = validate.validate('function frame(t, f) local n = "jump" sfx_preset(n, 0) end', { chunkName: "t.lua", frames: 2 });
check(!(named.problems || []).some((p) => p.code === "il-sfx-preset"), "a preset name held in a local string is accepted");

/* the Lua runtime and the IL runtime refuse alike, by the host's codes */
function codeOf(make, src) {
  try { const rt = make(src, { chunkName: "t.lua", budgetMs: 250 }); rt.load(); rt.frame(0); } catch (e) { return e.code || e.name; }
  return null;
}
[["an unknown preset name", 'function frame(t, f) sfx_preset("nope", 0) end', "sfx-preset"],
 ["noise on channel 0", "function frame(t, f) sfx_noise(0, 10, 20, 5) end", "sfx-range"],
 ["a noise rate of 32", "function frame(t, f) sfx_noise(4, 32, 20, 5) end", "sfx-range"],
 ["a slide to F 4096", "function frame(t, f) sfx_slide(0, 100, 4096, 20, 5) end", "sfx-range"],
 ["attack + decay past the frames", "function frame(t, f) sfx_fx(0, 0, 100, 200, 20, 4, 4, 6) end", "sfx-range"],
 ["an effect of 256 frames", "function frame(t, f) sfx_fx(0, 0, 100, 200, 20, 0, 0, 256) end", "sfx-range"],
 ["wave 4", "function frame(t, f) sfx_fx(0, 4, 100, 200, 20, 0, 0, 6) end", "sfx-range"],
 ["a preset on channel 6", 'function frame(t, f) sfx_preset("jump", 6) end', "sfx-range"],
 ["a noise preset on channel 0", 'function frame(t, f) sfx_preset("hit", 0) end', "sfx-range"]
].forEach(([label, src, code]) => {
  eq(label + ": the Lua runtime refuses with " + code, codeOf(toys.create, src), code);
  const ilCode = code === "sfx-preset" ? "il-sfx-preset" : code;   /* the IL names it at compile time */
  eq(label + ": the IL runtime refuses with " + ilCode, codeOf(il.create, src), ilCode);
});
check(host.REFUSALS["sfx-preset"] && host.REFUSALS["sfx-range"], "both codes are in the host's refusal table");
{
  const rt = toys.create(source, { chunkName: "fx.lua", budgetMs: 250 });
  rt.load();
  for (let k = 0; k < FRAMES; k++) rt.frame(k);
  eq("the Lua runtime writes the IL runtime's stream for fx.lua",
     rt.sound.events.filter((e) => e.f < FRAMES).map((e) => [e.f, e.reg, e.value]), want);
}

/* ---- 2. every preset alone: the channel's writes while it plays ---------- */
const PLAN = [["jump", 0, 0], ["coin", 4, 1], ["shoot", 20, 2], ["hit", 40, 4], ["explosion", 56, 5],
              ["powerup", 60, 3], ["select", 100, 0], ["hurt", 110, 1], ["laser", 130, 2]];
function channelStream(events, ch, f0, f1) {   /* events of channel ch (by R0) with f in [f0, f1] */
  let sel = 0; const out = [];
  events.forEach((e) => {
    if (e[1] === 0) sel = e[2] & 7;
    if (e[0] >= f0 && e[0] <= f1 && sel === ch && e[1] !== 1) out.push(e);
  });
  return out;
}
const planCh = (name) => PLAN.filter((p) => p[0] === name)[0];
sfx.PRESETS.forEach((p) => {
  const [, f0, ch] = planCh(p.name);
  const mine = channelStream(want, ch, f0, f0 + p.frames);
  check(mine.length > 3, p.name + ": the studio writes " + mine.length + " register writes on channel " + ch);
});

/* the studio's AUDIO panel plays a preset the way this does: a scratch host, the preset's writes, pce-psg.js */
sfx.PRESETS.forEach((p) => {
  const h = host.createHost({});
  const ch = p.wave === sfx.WAVE_NOISE ? 5 : 1;
  h.beginFrame(0); h.sfxPreset(p.name, ch);
  for (let f = 1; f <= p.frames + 4; f++) h.beginFrame(f);
  const got = h.renderSound(p.frames + 5);
  let peak = 0; for (const v of got.pcm) peak = Math.max(peak, Math.abs(v));
  check(peak > 500, p.name + ": the panel's preview is audible (peak " + peak + " of 32768, " + got.pcm.length + " samples)");
});
const panelSrc = fs.readFileSync(path.join(ROOT, "renderer", "studio-panel-audio.js"), "utf8");
check(/presetNames\(\)\.forEach/.test(panelSrc) && /playPreset/.test(panelSrc), "the AUDIO panel lists the presets and plays them");
for (const page of ["studio", "toy", "toys", "browse"]) {
  const html = fs.readFileSync(path.join(ROOT, "renderer", page + ".html"), "utf8");
  const at = (n) => html.indexOf('<script src="' + n + '"></script>');
  check(at("pce-sfx.js") > 0 && at("pce-sfx.js") < at("pce-toyhost.js"), page + ".html loads pce-sfx.js before pce-toyhost.js");
}

/* ---- 3. the ROMs ------------------------------------------------------- */
function framesOf(events) { return events.map((e) => [e[0], e[1], e[2]]); }
function compareStream(label, got) {
  eq(label + ": the log's reset ran (ok byte $A5)", got.ok, 0xA5);
  const mine = framesOf(got.events).filter((e) => e[0] < FRAMES);
  check(mine.length === want.length, label + ": " + mine.length + " writes, the studio's " + want.length);
  let first = -1;
  for (let i = 0; i < Math.max(mine.length, want.length); i++) {
    if (JSON.stringify(mine[i]) !== JSON.stringify(want[i])) { first = i; break; }
  }
  check(first < 0, label + ": every write equal, in order" + (first < 0 ? "" :
        " - first difference at write " + first + ": got " + JSON.stringify(mine[first]) + " want " + JSON.stringify(want[first]) +
        " (frame " + (want[first] || mine[first])[0] + ")"));
  sfx.PRESETS.forEach((p) => {
    const [, f0, ch] = planCh(p.name);
    eq(label + ": preset " + p.name + " on channel " + ch + " equals the studio's frame for frame",
       channelStream(mine, ch, f0, f0 + p.frames), channelStream(want, ch, f0, f0 + p.frames));
  });
}
function ggmcp(args) {
  return spawnSync("python3", ["-I", path.join(ROOT, "tools", "ggmcp.py")].concat(args),
    { cwd: ROOT, encoding: "utf8", timeout: 240000, maxBuffer: 1 << 26 });
}

const gg = process.env.GEARGRAFX ||
  "/Volumes/External II/pce-tools/geargrafx/app/Geargrafx.app/Contents/MacOS/geargrafx";
const llvm = [process.env.LLVM_MOS].concat(toolPaths.candidates.LLVM_MOS)
  .filter((r) => r && fs.existsSync(path.join(r, "bin", "mos-pce-clang")))[0];
const havePceas4 = spawnSync("bash", ["-c", "command -v pceas4 || test -x \"$PCEAS4\""]).status === 0 ||
  fs.existsSync(path.join(os.homedir(), ".local", "bin", "pceas4"));
if (!fs.existsSync(gg) || !llvm || !havePceas4) {
  skipped.push("Geargrafx, llvm-mos or PCEAS 4.x not found: the ROM parts did not run");
} else {
  const scratch = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "sfx-fx-"));
  const env = Object.assign({}, process.env, { TMPDIR: scratch,
    PATH: path.join(os.homedir(), ".local", "bin") + ":" + process.env.PATH });

  /* the interpreter ROM: a TRACE build of the interpreter (tools/gen is
   * rewritten by build.sh, so it is saved and put back) and the toy's bytecode */
  const genDir = path.join(ROOT, "tools", "gen"), saved = path.join(scratch, "gen-saved");
  fs.cpSync(genDir, saved, { recursive: true });
  const traceBin = path.join(scratch, "ilvm-trace.bin");
  let traceImage = null;
  const b = spawnSync("bash", [path.join(ROOT, "tools", "ilvm", "build.sh")],
    { cwd: ROOT, encoding: "utf8", env: Object.assign({}, env, { TRACE: "1", BIN: traceBin }) });
  check(b.status === 0, "the interpreter's trace build links (" + (b.stderr || b.stdout).trim().split("\n").slice(-1)[0] + ")");
  if (b.status === 0) traceImage = path.join(scratch, "hutrack-image.json");
  if (traceImage) fs.copyFileSync(path.join(genDir, "hutrack-image.json"), traceImage);
  fs.rmSync(genDir, { recursive: true, force: true });
  fs.cpSync(saved, genDir, { recursive: true });
  if (traceImage) {
    const encoded = ilbc.encode(il.compile(source, { chunkName: "fx.lua" }));
    const rom = path.join(scratch, "fx-interp.pce");
    fs.writeFileSync(rom, Buffer.from(romLib.buildToyRom({ bank0: fs.readFileSync(traceBin), bytecode: encoded.bytes })));
    const r = ggmcp([rom, "psgstream", traceImage, String(FRAMES + 6)]);
    check(r.status === 0, "the interpreter ROM ran in Geargrafx (" + (r.stderr || "").trim().split("\n").slice(-1)[0] + ")");
    if (r.status === 0) compareStream("interpreter ROM", JSON.parse(r.stdout));
  }

  /* the native ROM */
  const nb = spawnSync("bash", [path.join(ROOT, "tools", "build-toyc-banked.sh"), TOY, "sfx-fx"],
    { cwd: ROOT, encoding: "utf8", env: Object.assign({}, env, { PSG_TRACE: "1" }) });
  check(nb.status === 0, "the native trace build links (" + (nb.stderr || nb.stdout).trim().split("\n").slice(-1)[0] + ")");
  if (nb.status === 0) {
    const r = ggmcp([path.join(ROOT, "tools", "gen", "sfx-fx.pce"),
                     "psgstream", path.join(ROOT, "tools", "gen", "sfx-fx.eng", "hutrack-image.json"), String(FRAMES + 6)]);
    check(r.status === 0, "the native ROM ran in Geargrafx (" + (r.stderr || "").trim().split("\n").slice(-1)[0] + ")");
    if (r.status === 0) compareStream("native ROM", JSON.parse(r.stdout));
  }
  fs.rmSync(scratch, { recursive: true, force: true });
}

skipped.forEach((s) => console.log("SKIP: " + s));
if (failures.length) { console.log("FAIL  " + failures.length + " of " + checks + " checks failed"); process.exit(1); }
console.log("PASS  " + checks + " checks, the effects write the studio's PSG registers on every route" +
            (skipped.length ? " (SKIPPED: " + skipped.join("; ") + ")" : ""));
