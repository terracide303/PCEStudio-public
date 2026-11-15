#!/usr/bin/env node
/*
 * tests/check-native-raster-flicker.js — every video frame of a raster game is a correct picture.
 *
 * The raster runtime used to compute a game frame while the line-interrupt chain was DISARMED: in
 * those video frames the VDC showed the last line's scroll and backdrop colour for the whole screen.
 * In STARFALL one video frame in three was right and two in three were wrong, on any real screen a
 * flash; tools/native-compare.js (and every earlier check) needs only ONE of its last 12 frames to
 * match a browser frame, so nothing noticed (found 2026-11-14 by looking at consecutive frames).
 *
 * This builds STARFALL (the callback form raster(line)) and NOVA TIDE (the table form
 * raster(line, spec), OPT=-Oz), records them in Mednafen, keeps the last 24 CONSECUTIVE video frames
 * and requires that EVERY one of them equals some frame of the browser's run of the same toy
 * (diff 0), except STARFALL's known line 24: the status-bar split's colour write lands about 15
 * pixels into that line (docs/NATIVE.md), which is allowed as at most 24 differing pixels, all on
 * row 24.  Needs llvm-mos and Mednafen; SKIP without.
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { spawn, spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..");
const MEDNAFEN = "/opt/homebrew/bin/mednafen";
const llvm = (process.env.LLVM_MOS || "/Volumes/External II/pce-tools/llvm-mos/llvm-mos") + "/bin/mos-pce-clang";
if (!fs.existsSync(MEDNAFEN) || !fs.existsSync(llvm)) { console.log("SKIP: Mednafen or llvm-mos not found"); process.exit(0); }
const toys = require(ROOT + "/renderer/pce-toys.js");
const TAIL = 24, BROWSER_FRAMES = 700;   /* a game at 60 Hz reaches game frame ~560 in the 10 s capture (was 420 when STARFALL ran at 28 fps) */
let checks = 0;
const failures = [];
function check(ok, name) { checks++; if (!ok) { failures.push(name); console.log("FAIL  " + name); } else console.log("  ok  " + name); }
if (process.env.RASTER_FLICKER_VERBOSE) console.log("scratch " + (process.env.TMPDIR || os.tmpdir()));
const scratch = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "raster-flicker-"));

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function capture(rom, dir, ms) {
  const movie = path.join(dir, "capture.mov"), home = path.join(dir, "home");
  fs.mkdirSync(path.join(home, "mcs"), { recursive: true });
  const env = Object.assign({}, process.env, { MEDNAFEN_HOME: home, SDL_VIDEODRIVER: "dummy", SDL_AUDIODRIVER: "dummy" });
  const child = spawn(MEDNAFEN, ["-force_module", "pce", "-sound", "0", "-autosave", "1",
    "-pce.slstart", "3", "-pce.slend", "234", "-pce.xscale", "1", "-pce.yscale", "1",
    "-qtrecord", movie, "-qtrecord.vcodec", "png", "-qtrecord.w_double_threshold", "0",
    "-qtrecord.h_double_threshold", "0", rom], { env: env, stdio: ["ignore", "ignore", "pipe"] });
  await sleep(ms);
  if (child.exitCode === null && child.signalCode === null) { try { child.kill("SIGINT"); } catch (e) { /* gone */ } }
  const deadline = Date.now() + 30000;
  while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) await sleep(100);
  if (child.exitCode === null && child.signalCode === null) { try { child.kill("SIGKILL"); } catch (e) { /* gone */ } }
  if (!fs.existsSync(movie) || !fs.statSync(movie).size) return null;
  const frames = path.join(dir, "frames");
  const m = spawnSync("python3", ["-I", path.join(ROOT, "tools", "movframes.py"), movie, "--tail", String(TAIL), frames, "256", "224", "4"],
    { cwd: ROOT, encoding: "utf8", timeout: 600000 });
  if (m.status !== 0) return null;
  return fs.readdirSync(frames).filter((f) => /^frame\d+\.png$/.test(f)).sort().map((f) => path.join(frames, f));
}

function decodePng(buf) {
  let pos = 8, width = 0, height = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.slice(pos + 4, pos + 8).toString("latin1"), body = buf.slice(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === "IHDR") { width = body.readUInt32BE(0); height = body.readUInt32BE(4); }
    else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = width * 3, out = Buffer.alloc(width * height * 3);
  let prev = Buffer.alloc(stride), p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++], line = Buffer.from(raw.slice(p, p + stride));
    p += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= 3 ? line[i - 3] : 0, b = prev[i], c = i >= 3 ? prev[i - 3] : 0;
      let v = line[i];
      if (filter === 1) v = (v + a) & 255;
      else if (filter === 2) v = (v + b) & 255;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (filter === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255; }
      line[i] = v;
    }
    out.set(line, y * stride);
    prev = line;
  }
  return out;
}

function browserFrames(toyPath) {
  const dir = path.dirname(path.join(ROOT, toyPath));
  const files = ["tiles.json", "palettes.json", "sprites.json"].filter((n) => fs.existsSync(path.join(dir, n)))
    .map((n) => ({ name: n, source: fs.readFileSync(path.join(dir, n), "utf8") }));
  const b = toys.create(fs.readFileSync(path.join(ROOT, toyPath), "utf8"), files.length ? { budgetMs: 2000, files: files } : { budgetMs: 2000 });
  b.load();
  const out = [];
  for (let f = 0; f < BROWSER_FRAMES; f++) out.push(Buffer.from(b.frame(f).pixels));
  b.dispose();
  return out;
}

/* the least number of differing pixels, and the rows they are on, against any browser frame */
function bestMatch(img, want) {
  let best = { px: Infinity, rows: [] };
  const W = 256;
  for (let k = 0; k < want.length; k++) {
    const w = want[k];
    let px = 0;
    for (let i = 0; i < img.length && px <= best.px; i += 3) if (img[i] !== w[i] || img[i + 1] !== w[i + 1] || img[i + 2] !== w[i + 2]) px++;
    if (px < best.px) {
      const rows = new Set();
      for (let i = 0; i < img.length; i += 3) if (img[i] !== w[i] || img[i + 1] !== w[i + 1] || img[i + 2] !== w[i + 2]) rows.add(Math.floor(i / 3 / W));
      best = { px: px, rows: Array.from(rows), frame: k };
      if (px === 0) break;
    }
  }
  return best;
}

(async function () {
  const games = [
    { name: "STARFALL (callback form)", toy: "toys/demo-game/main.lua", opt: "-Os", tolerant24: true },
    { name: "NOVA TIDE (table form)", toy: "toys/nova-tide/main.lua", opt: "-Oz", tolerant24: false }
  ];
  for (const g of games) {
    const slug = path.basename(path.dirname(g.toy));
    const b = spawnSync("bash", [path.join(ROOT, "tools", "build-toyc-banked.sh"), g.toy, "flick-" + slug],
      { cwd: ROOT, encoding: "utf8", env: Object.assign({}, process.env, { TMPDIR: scratch, OPT: g.opt }) });
    check(b.status === 0, g.name + ": builds");
    if (b.status !== 0) continue;
    const dir = path.join(scratch, slug); fs.mkdirSync(dir, { recursive: true });
    const files = await capture(path.join(ROOT, "tools", "gen", "flick-" + slug + ".pce"), dir, 10000);
    check(!!files && files.length >= TAIL, g.name + ": Mednafen recorded " + TAIL + " consecutive frames");
    if (!files || files.length < TAIL) continue;
    const want = browserFrames(g.toy);
    let good = 0; const bad = [];
    files.forEach(function (f, i) {
      const m = bestMatch(decodePng(fs.readFileSync(f)), want);
      const ok = m.px === 0 || (g.tolerant24 && m.px <= 24 && m.rows.every((r) => r === 24));
      if (ok) good++; else bad.push(i + ":" + m.px + "px");
      if (process.env.RASTER_FLICKER_VERBOSE) console.log("  frame " + i + ": closest browser frame " + m.frame + ", " + m.px + " px on rows " + m.rows.slice(0, 12).join(",") + (ok ? " (allowed)" : ""));
    });
    check(good === files.length, g.name + ": " + good + " of " + files.length + " consecutive frames equal a browser frame" + (bad.length ? " (wrong: " + bad.slice(0, 8).join(" ") + ")" : ""));
  }
  console.log(failures.length ? "FAIL  " + failures.length + " of " + checks + " checks failed" : "PASS  " + checks + " checks, every consecutive frame of a raster game is a correct picture");
  process.exit(failures.length ? 1 : 0);
})();
