#!/usr/bin/env node
/*
 * tests/check-native-sound.js — the natively compiled ROM's sound is the
 * studio's (docs/NATIVE-SOUND.md, option C).
 *
 *   node tests/check-native-sound.js
 *
 * tools/toys/sfx.lua and note.lua are compiled to banked native ROMs with the
 * HuTrack engine and the engine's PSG write log (PSG_TRACE=1, never a shipped
 * ROM), run in Geargrafx, and the log in console RAM is compared with the studio runtime's own sound events
 * (renderer/pce-il.js, rt.sound.events) for toy frames 0..23: same order, same
 * registers, same values — the proof tests/check-rom-sound.js gives the
 * interpreter ROM.  A music() fixture (tests/native-music: the sequencer's demo
 * song through the song bank) is compared channel by channel after every toy
 * frame.  The ROMs run in Geargrafx through its MCP server (tools/ggmcp.py,
 * docs/GEARGRAFX-MCP.md).  Needs llvm-mos, PCEAS 4.x and Geargrafx; prints a
 * SKIP line without them.
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const il = require("../renderer/pce-il.js");
const seq = require("../renderer/pce-seq.js");

const ROOT = path.join(__dirname, "..");
const FRAMES = 24, FILL = 0xEE;
let checks = 0;
const failures = [], skipped = [];
function check(ok, name) { checks++; if (!ok) { failures.push(name); console.log("FAIL  " + name); } }
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  check(ok, name + (ok ? "" : ": got " + JSON.stringify(got).slice(0, 200) + " want " + JSON.stringify(want).slice(0, 200)));
}
function sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
const have = (c) => spawnSync("bash", ["-c", "command -v " + c]).status === 0;

/* The studio's PSG channel state after each toy frame, from its write log. */
function studioChannels(events, frames) {
  const ch = [0, 1, 2, 3, 4, 5].map(() => ({ fl: 0, fh: 0, ctl: 0, noise: 0 }));
  let sel = 0, k = 0;
  const out = [];
  for (let f = 0; f < frames; f++) {
    while (k < events.length && events[k].f <= f) {
      const e = events[k++];
      if (e.reg === 0) sel = e.value & 7;
      else if (sel < 6 && e.reg === 2) ch[sel].fl = e.value;
      else if (sel < 6 && e.reg === 3) ch[sel].fh = e.value & 15;
      else if (sel < 6 && e.reg === 4) ch[sel].ctl = e.value;
      else if (sel >= 4 && sel < 6 && e.reg === 7) ch[sel].noise = e.value;
    }
    out.push(ch.map((c) => ({ freq: c.fl | (c.fh << 8), en: (c.ctl & 0x80) ? 1 : 0 })));
  }
  return out;
}

function ggmcp(args) {
  return spawnSync("python3", ["-I", path.join(ROOT, "tools", "ggmcp.py")].concat(args),
    { cwd: ROOT, encoding: "utf8", timeout: 180000, maxBuffer: 1 << 26 });
}

function build(toy, label, scratch) {
  const name = "native-sound-" + label;
  const b = spawnSync("bash", [path.join(ROOT, "tools", "build-toyc-banked.sh"), toy, name],
    { cwd: ROOT, encoding: "utf8", env: Object.assign({}, process.env, { PSG_TRACE: "1", TMPDIR: scratch }) });
  check(b.status === 0, label + ": the trace build links (" + (b.stderr || b.stdout).trim().split("\n").slice(-1)[0] + ")");
  if (b.status !== 0) return null;
  return { rom: path.join(ROOT, "tools", "gen", name + ".pce"),
           image: path.join(ROOT, "tools", "gen", name + ".eng", "hutrack-image.json") };
}

/* sfx()/note()/release(): the glue's own writes are in the engine's log, so
 * the whole stream is compared, write for write. */
function runStream(toy, label, scratch) {
  const built = build(toy, label, scratch);
  if (!built) return;
  const r = ggmcp([built.rom, "psgtrace", built.image, "120"]);
  check(r.status === 0, label + ": Geargrafx ran the ROM and read the log");
  if (r.status !== 0) return;
  const got = JSON.parse(r.stdout);
  eq(label + ": the log's reset ran (ok byte $A5)", got.ok, 0xA5);
  const source = fs.readFileSync(path.join(ROOT, toy), "utf8");
  const rt = il.create(source, { chunkName: path.basename(toy) });
  rt.load();
  for (let k = 0; k < FRAMES; k++) rt.frame(k);
  const want = rt.sound.events.filter((e) => e.f < FRAMES).map((e) => [e.f, e.reg, e.value]);
  check(got.events.length > 0, label + ": the log recorded PSG writes (" + got.events.length + ")");
  eq(label + ": the native ROM wrote exactly the studio's stream over " + FRAMES +
     " frames (" + want.length + " writes, frame for frame)", got.events, want);
  check(got.tail, label + ": the log's unfilled tail is still $EE");
}

/* music(): the engine writes the channel registers itself and the log does not
 * carry those, so the PSG's state is compared after every toy frame: the four
 * tonal channels' frequency and on/off exactly, the two noise channels' on/off
 * (a drum's pitch lands on the nearest legacy value, docs/ROM-SOUND.md §6). */
function runMusic(dir, label, scratch) {
  const built = build(path.join(dir, "main.lua"), label, scratch);
  if (!built) return;
  const N = 75;
  const r = ggmcp([built.rom, "psgframes", built.image, String(N)]);
  check(r.status === 0, label + ": Geargrafx stepped the ROM frame by frame");
  if (r.status !== 0) return;
  const got = JSON.parse(r.stdout);
  const songs = seq.songsFromFiles([{ name: "song.json",
    source: fs.readFileSync(path.join(ROOT, dir, "song.json"), "utf8") }]);
  const rt = il.create(fs.readFileSync(path.join(ROOT, dir, "main.lua"), "utf8"),
                       { chunkName: "main.lua", songs: songs });
  rt.load();
  for (let k = 0; k < N; k++) rt.frame(k);
  const want = studioChannels(rt.sound.events, N);
  let compared = 0, tonal = 0, noise = 0, lit = 0;
  Object.keys(got).forEach((key) => {
    const tf = +key;
    if (tf < 1 || tf >= N) return;
    compared++;
    const st = got[key], s = want[tf];
    let t = true;
    for (let c = 0; c < 4; c++) {
      if (st[c][1] !== s[c].en) t = false;
      else if (st[c][1] && st[c][0] !== s[c].freq) t = false;
    }
    if (t) tonal++;
    if (st[4][1] === s[4].en && st[5][1] === s[5].en) noise++;
    if (st.some((c) => c[1])) lit++;
  });
  check(compared >= 40, label + ": " + compared + " toy frames compared");
  check(lit > 20, label + ": the PSG is sounding (" + lit + " frames with a channel on)");
  eq(label + ": the four tonal channels' frequency and on/off equal the studio's in every frame", tonal, compared);
  eq(label + ": the two noise channels' on/off equal the studio's in every frame", noise, compared);
}

const gg = process.env.GEARGRAFX ||
  "/Volumes/External II/pce-tools/geargrafx/app/Geargrafx.app/Contents/MacOS/geargrafx";
if (!fs.existsSync(gg) || !fs.existsSync(
    (process.env.LLVM_MOS || "/Volumes/External II/pce-tools/llvm-mos/llvm-mos") + "/bin/mos-pce-clang")) {
  skipped.push("Geargrafx or llvm-mos not found");
} else {
  const scratch = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "native-sound-"));
  runStream("tools/toys/sfx.lua", "sfx", scratch);
  runStream("tools/toys/note.lua", "note", scratch);
  runMusic("tests/native-music", "music", scratch);
}
skipped.forEach((s) => console.log("SKIP: " + s));
if (failures.length) { console.log("FAIL  " + failures.length + " of " + checks + " checks failed"); process.exit(1); }
console.log("PASS  " + checks + " checks, the native ROM's PSG writes equal the studio's" + (skipped.length ? " (SKIPPED: " + skipped.join("; ") + ")" : ""));
