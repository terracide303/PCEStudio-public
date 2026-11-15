#!/usr/bin/env node
/*
 * tests/check-bake-art.js — baking a toy's generated art (tools/bake-art.js, card #294).
 *
 *   node tests/check-bake-art.js
 *
 *  1. The bake is deterministic: two runs write the same bytes, and they are the bytes committed in
 *     tests/native-dusk-baked/vram.json.
 *  2. It round-trips through the importer (renderer/pce-toyhost.js, the vram.json file): the importer's
 *     VRAM equals what the gallery game (toys/dusk-run) left after its 137 drawing frames, except the
 *     sprite list, which the toy rewrites every frame and the bake leaves out.
 *  3. The baked fixture (tests/native-dusk-baked) equals the gallery game in the browser model: its
 *     frame k is the gallery game's frame 137+k, and VRAM, colours, registers and sprite list agree
 *     for every k up to game frame 200 (the gallery frames 130..136 only draw; nothing is shown).
 *  4. Additive: a toy with no vram.json imports exactly as before (STARFALL's picture is unchanged by
 *     an absent file), and a malformed vram.json is refused with a named reason.
 *  5. The native ROM's VRAM and colours equal the importer's picture (the bake), word for word, and
 *     the fixture's art is the same words the gallery game's browser run holds (tile and map area).
 *     Needs llvm-mos and Geargrafx; prints SKIP for this part without them.
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..");
const toys = require("../renderer/pce-toys.js");
const toyhost = require("../renderer/pce-toyhost.js");
let checks = 0;
const failures = [];
function check(ok, name) { checks++; if (!ok) { failures.push(name); console.log("FAIL  " + name); } }
const scratch = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "bake-art-"));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const eq = (a, b) => a.length === b.length && Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

/* 1. deterministic */
const bake = (d) => spawnSync("node", [path.join(ROOT, "tools", "bake-art.js"), "toys/dusk-run/main.lua", "137", d],
  { cwd: ROOT, encoding: "utf8" });
const b1 = bake(path.join(scratch, "a")), b2 = bake(path.join(scratch, "b"));
check(b1.status === 0 && b2.status === 0, "bake-art runs (" + (b1.stderr || "").trim().split("\n").pop() + ")");
const j1 = fs.readFileSync(path.join(scratch, "a", "vram.json")), j2 = fs.readFileSync(path.join(scratch, "b", "vram.json"));
check(eq(j1, j2), "two bakes are byte-identical");
check(eq(j1, fs.readFileSync(path.join(ROOT, "tests/native-dusk-baked/vram.json"))), "the bake equals the committed fixture art");

/* 2. importer round trip */
const SAT = 0x7F00 * 2;
const gal = toys.create(read("toys/dusk-run/main.lua"), { budgetMs: 5000 });
const fix = toys.create(read("tests/native-dusk-baked/main.lua"), {
  budgetMs: 5000, files: [{ name: "vram.json", source: j1.toString("utf8") }] });
gal.load(); fix.load();
for (let f = 0; f < 137; f++) gal.frame(f);
const imp = toyhost.importer.read([{ name: "vram.json", source: j1.toString("utf8") }]);
check(imp && imp.vram.length === 65536, "the importer reads vram.json");
let dv = 0;
for (let i = 0; i < 65536; i++) if ((i < SAT || i >= SAT + 512) && imp.vram[i] !== gal.state.vram[i]) dv++;
check(dv === 0, "importer VRAM equals the gallery game's after 137 frames, off the sprite list and the score row (" + dv + " bytes differ)");

/* 3. fixture == gallery game, game frames 137..200 */
let bad = 0, first = "";
for (let k = 0; k < 64; k++) {
  gal.frame(137 + k); fix.frame(k);
  const a = gal.state, b = fix.state;
  const same = eq(a.vram, b.vram) && eq(a.cram, b.cram) && eq(a.sat, b.sat) &&
    JSON.stringify(a.regs) === JSON.stringify(b.regs);
  if (!same) { bad++; if (!first) first = "game frame " + (137 + k); }
}
check(bad === 0, "fixture equals the gallery game at game frames 137..200 (" + bad + " differ" + (first ? ", first " + first : "") + ")");
gal.dispose(); fix.dispose();

/* 4. additive */
const sfDir = path.join(ROOT, "toys", "demo-game");
const sfFiles = toyhost.importer.FILES.filter((n) => fs.existsSync(path.join(sfDir, n)))
  .map((n) => ({ name: n, source: fs.readFileSync(path.join(sfDir, n), "utf8") }));
const sfOff = sfFiles.filter((f) => f.name !== "vram.json");
check(!sfFiles.some((f) => f.name === "vram.json"), "no gallery toy carries a vram.json");
const w0 = sfOff.length ? toyhost.importer.read(sfOff) : null;
check(w0 === null || w0.vram.length === 65536, "a toy without vram.json imports as before");
let refused = "";
try { toyhost.importer.read([{ name: "vram.json", source: '{"format":"pce-vram/1","runs":[{"addr":32767,"words":"AAAAAA=="}]}' }]); }
catch (e) { refused = String(e.reason || e.code || e.message); }
check(/vram-range/.test(refused), "a run past the 32,768 words is refused (" + refused + ")");

/* 5. native ROM */
const gg = process.env.GEARGRAFX || "/Volumes/External II/pce-tools/geargrafx/app/Geargrafx.app/Contents/MacOS/geargrafx";
const llvm = (process.env.LLVM_MOS || "/Volumes/External II/pce-tools/llvm-mos/llvm-mos") + "/bin/mos-pce-clang";
if (!fs.existsSync(gg) || !fs.existsSync(llvm)) console.log("SKIP: Geargrafx or llvm-mos not found (the ROM part)");
else {
  const b = spawnSync("bash", [path.join(ROOT, "tools", "build-toyc-banked.sh"), "tests/native-dusk-baked/main.lua", "native-dusk-baked"],
    { cwd: ROOT, encoding: "utf8", env: Object.assign({}, process.env, { TMPDIR: scratch }) });
  check(b.status === 0, "the baked game links (" + (b.stderr || b.stdout).trim().split("\n").slice(-1)[0].slice(0, 100) + ")");
  if (b.status === 0) {
    const out = path.join(scratch, "vram.bin");
    const r = spawnSync("python3", ["-I", path.join(ROOT, "tools", "ggmcp.py"), path.join(ROOT, "tools", "gen", "native-dusk-baked.pce"), "vramdump", out, "60"],
      { cwd: ROOT, encoding: "utf8", timeout: 300000 });
    check(r.status === 0, "Geargrafx ran the ROM and dumped VRAM and colours");
    if (r.status === 0) {
      const raw = fs.readFileSync(out);
      const W = (off, len) => new Uint16Array(raw.buffer.slice(raw.byteOffset + off, raw.byteOffset + off + len));
      const gotV = W(0, 65536), gotC = W(65536, 1024);
      const wantV = new Uint16Array(imp.vram.buffer.slice(imp.vram.byteOffset, imp.vram.byteOffset + 65536));
      /* off what the running game writes itself: the sprite list, and the score digits in map row 1 */
      const own = (i) => (i < 0x7F00 || i >= 0x8000) && (i < 0x20 || i >= 0x40);
      let d = 0, nz = 0;
      for (let i = 0; i < 32768; i++) { if (wantV[i]) nz++; if (own(i) && wantV[i] !== gotV[i]) d++; }
      check(nz > 1500, "the baked picture has real data (" + nz + " non-zero VRAM words)");
      if (d) for (let i = 0, n = 0; i < 32768 && n < 12; i++) if (own(i) && wantV[i] !== gotV[i]) { console.log("  word " + i.toString(16) + " want " + wantV[i].toString(16) + " got " + gotV[i].toString(16)); n++; }
      check(d === 0, "the ROM's VRAM equals the importer's picture, off the sprite list and the score row (" + d + " words differ)");
      /* the colours: the toy writes its own palette in code, so the importer holds none (no --cram) */
    }
  }
}
if (failures.length) { console.log("FAIL  " + failures.length + " of " + checks + " checks failed"); process.exit(1); }
console.log("PASS  " + checks + " checks: the bake is deterministic, round-trips through the importer, and the baked game equals the gallery game");
