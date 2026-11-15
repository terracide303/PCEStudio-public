#!/usr/bin/env node
/*
 * tests/check-native-kit.js — the native build kit (docs/NATIVE-KIT.md).
 *
 *   node tests/check-native-kit.js [--update-pins]
 *
 * The kit is the zip the Export dialog offers: one Node script (tools/native-kit/
 * build.js) that builds a game's ROM with the native compiler on macOS, Linux
 * and Windows.  This suite proves it, for the four games the kit has to carry
 * (PLATFORMER, TOWER, STARFALL, NOVA TIDE), by what it does, not by what it says:
 *
 *   1. The zip's contents: the one script, toolchain.json (the pinned llvm-mos
 *      release with a SHA-256 per host), the prebuilt sound-engine images, the
 *      licences, the compiler front end and the game; no bash or Python, no
 *      /Volumes path; renderer/native-kit-base.json is current.
 *   2. Each game's zip is unpacked into an EMPTY directory (its name has a
 *      space in it) and `node build.js` runs there with nothing but Node and the
 *      toolchain it downloads itself (into a scratch home; LLVM_MOS is removed
 *      from the environment).  The ROM's SHA-256 must equal the pin in
 *      tests/native-kit-pins.json — the same pins on every OS, which is what the
 *      GitHub workflow native-kit.yml checks on ubuntu, windows and macOS.
 *   3. Where tools/build-toyc-banked.sh can run (the maintainer's Mac: bash,
 *      PCEAS 4.x, a local llvm-mos) the ROM is also compared with that script's,
 *      built with ENGINE_BASES from the kit's engine index: byte for byte.
 *   4. Failure paths, offline: a download whose SHA-256 is wrong is refused and
 *      nothing is unpacked; a download that cannot connect says how to retry and
 *      how to fetch the file by hand; a stale kit version stops with a message;
 *      CRLF in main.lua builds the same ROM.
 *
 * The first run downloads the compiler (115-210 MB) into $PCE_KIT_HOME (default
 * $TMPDIR/pcestudio-kit-home) and keeps it; with no network and no copy there,
 * the build checks print SKIP.  PCE_KIT_GAMES=a,b limits the games (names:
 * platformer, tower, starfall, novatide).  --update-pins rewrites the pins from
 * a Mac run that also matched the repo script.
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");
const crypto = require("crypto");
const http = require("http");

const ROOT = path.resolve(__dirname, "..");
const kit = require("../renderer/pce-native-kit.js");
const zip = require("../renderer/pce-zip.js");
const PINS_FILE = path.join(__dirname, "native-kit-pins.json");
const OPT = "-Oz";
const GAMES = [
  { key: "platformer", label: "PLATFORMER", dir: "toys/platformer" },
  { key: "tower", label: "TOWER", dir: "toys/tower" },
  { key: "starfall", label: "STARFALL", dir: "toys/demo-game" },
  { key: "novatide", label: "NOVA TIDE", dir: "toys/nova-tide" }
];

let failures = 0, skips = 0;
function check(ok, text) { console.log((ok ? "PASS  " : "FAIL  ") + text); if (!ok) failures++; }
function skip(text) { console.log("SKIP  " + text); skips++; }
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

const base = JSON.parse(fs.readFileSync(path.join(ROOT, "renderer", "native-kit-base.json"), "utf8"));
function toyFiles(dir) {
  const out = [];
  for (const n of kit.GAME_FILES) {
    const p = path.join(ROOT, dir, n);
    if (fs.existsSync(p)) out.push({ name: n, source: fs.readFileSync(p, "utf8") });
  }
  return out;
}
function makeZip(dir, name) {
  return kit.build({
    base: base, name: name, files: toyFiles(dir),
    compiler: (url) => fs.readFileSync(path.resolve(ROOT, "renderer", url), "utf8")
  });
}
function unzipTo(bytes, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const names = [];
  for (const e of zip.read(bytes)) {
    const p = path.join(dest, e.name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, Buffer.from(e.bytes));
    names.push(e.name);
  }
  return names;
}

const SCRATCH = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "pce-native-kit-"));
const HOME = process.env.PCE_KIT_HOME || path.join(process.env.TMPDIR || os.tmpdir(), "pcestudio-kit-home");
process.on("exit", () => { try { fs.rmSync(SCRATCH, { recursive: true, force: true }); } catch (e) { /* best effort */ } });

function runKit(kitDir, args, env) {
  const e = Object.assign({}, process.env, { PCESTUDIO_HOME: HOME }, env || {});
  delete e.LLVM_MOS;
  return cp.spawnSync(process.execPath, [path.join(kitDir, "build.js")].concat(args || []), { cwd: kitDir, env: e, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

/* the same, without blocking this process: the local test server lives in it */
function runKitAsync(kitDir, args, env) {
  return new Promise((resolve) => {
    const e = Object.assign({}, process.env, { PCESTUDIO_HOME: HOME }, env || {});
    delete e.LLVM_MOS;
    const c = cp.spawn(process.execPath, [path.join(kitDir, "build.js")].concat(args || []), { cwd: kitDir, env: e });
    let out = "", err = "";
    c.stdout.on("data", (d) => { out += d; });
    c.stderr.on("data", (d) => { err += d; });
    c.on("close", (status) => resolve({ status: status, stdout: out, stderr: err }));
  });
}

/* ---- 1. the zip ---- */
function checkContents() {
  const stale = cp.spawnSync(process.execPath, [path.join(ROOT, "tools", "native-kit", "make-base.js"), "--check"], { encoding: "utf8" });
  check(stale.status === 0, "renderer/native-kit-base.json is current (" + (stale.stderr || stale.stdout).trim() + ")");
  const z = makeZip("toys/platformer", "platformer");
  const names = new Set(z.entries);
  const top = "pcestudio-native-kit/";
  for (const need of ["build.js", "toolchain.json", "README.md", "game/main.lua", "game/kit.json",
    "LICENSES/PCEStudio-GPL-3.0.txt", "LICENSES/HuTrack-MIT.txt", "LICENSES/llvm-mos.txt", "LICENSES/Fengari-MIT.txt",
    "tools/toyc/emit.js", "tools/toyc/toy_runtime.c", "tools/toyc/toy_runtime.h", "tools/toyc/toy_assets.c",
    "tools/toyc/toy_sound.c", "tools/native-assets.js", "tools/native-songs.js",
    "engines/index.json", "engines/0x2400/hutrack-code.bin", "engines/0x3800/hutrack-symbols.h",
    "renderer/pce-cgen.js", "renderer/pce-il.js", "vendor/fengari/fengari-web.js"]) {
    check(names.has(top + need), "the kit carries " + need);
  }
  const odd = z.entries.filter((n) => /\.(sh|py|exe|dll|dylib|so|7z|xz)$/i.test(n));
  check(odd.length === 0, "no shell scripts, Python or binaries of the toolchain in the zip (" + odd.join(", ") + ")");
  const bins = z.entries.filter((n) => /\.bin$/.test(n) && !/^pcestudio-native-kit\/engines\//.test(n));
  check(bins.length === 0, "the only binaries are the prebuilt engine images under engines/");
  const script = fs.readFileSync(path.join(ROOT, "tools", "native-kit", "build.js"), "utf8");
  check(!/\/Volumes/.test(script), "build.js names no /Volumes path");
  check(!/["'`](bash|sh|python3?|py)["'`]/.test(script), "build.js starts no shell, bash or Python");
  const tc = JSON.parse(fs.readFileSync(path.join(ROOT, "tools", "native-kit", "toolchain.json"), "utf8"));
  const hosts = Object.keys(tc.llvmMos.assets);
  check(["darwin-arm64", "darwin-x64", "linux-x64", "win32-x64"].every((h) => hosts.indexOf(h) >= 0), "toolchain.json pins macOS arm64/x64, Linux x64 and Windows x64 (" + hosts.join(", ") + ")");
  check(hosts.every((h) => /^[0-9a-f]{64}$/.test(tc.llvmMos.assets[h].sha256) && /^https:\/\/github\.com\/llvm-mos\/llvm-mos-sdk\/releases\/download\/v[\d.]+\//.test(tc.llvmMos.assets[h].url)),
        "every pin is a SHA-256 and an official llvm-mos-sdk release URL");
  const idx = JSON.parse(Buffer.from(zip.read(z.zip).find((e) => e.name === top + "engines/index.json").bytes).toString("utf8"));
  check(idx.bases.length >= 4 && idx.bases.every((b) => parseInt(b.bssEnd, 16) <= parseInt(idx.stackFloor, 16)), "every prebuilt engine base leaves the stack its room (" + idx.bases.map((b) => b.base).join(" ") + ")");
  /* the zip is reproducible */
  check(sha(Buffer.from(makeZip("toys/platformer", "platformer").zip)) === sha(Buffer.from(z.zip)), "the same game makes the same zip");
}

/* ---- the failure paths (no toolchain needed) ---- */
async function checkFailures() {
  const dir = path.join(SCRATCH, "fail kit");
  unzipTo(makeZip("toys/platformer", "platformer").zip, dir);
  const kd = path.join(dir, "pcestudio-native-kit");
  const home = path.join(SCRATCH, "fail home");

  /* a stale kit: toolchain.json and build.js disagree */
  const tcPath = path.join(kd, "toolchain.json");
  const tc = JSON.parse(fs.readFileSync(tcPath, "utf8"));
  const orig = JSON.stringify(tc);
  tc.kit = 99;
  fs.writeFileSync(tcPath, JSON.stringify(tc));
  let r = runKit(kd, [], { PCESTUDIO_HOME: home });
  check(r.status === 1 && /out of step/.test(r.stderr) && /Download a fresh kit/.test(r.stderr), "a kit whose toolchain.json is another version stops and says to download a fresh kit");
  fs.writeFileSync(tcPath, orig);
  const gk = path.join(kd, "game", "kit.json");
  fs.writeFileSync(gk, JSON.stringify({ kit: 7 }));
  r = runKit(kd, [], { PCESTUDIO_HOME: home });
  check(r.status === 1 && /exported for kit version 7/.test(r.stderr), "a game exported for another kit version stops with its own message");
  fs.writeFileSync(gk, JSON.stringify({ kit: kit.VERSION }));

  /* a download with the wrong bytes: refused, nothing unpacked */
  const junk = Buffer.from("this is not a compiler");
  const server = http.createServer((req, res) => { res.writeHead(200, { "content-length": junk.length }); res.end(junk); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const host = process.platform + "-" + process.arch;
  const tcBad = JSON.parse(orig);
  tcBad.llvmMos.assets[host] = { url: "http://127.0.0.1:" + port + "/llvm-mos-test.tar.xz", sha256: "0".repeat(64), bytes: junk.length, format: "tar.xz" };
  fs.writeFileSync(tcPath, JSON.stringify(tcBad));
  r = await runKitAsync(kd, [], { PCESTUDIO_HOME: home });
  check(r.status === 1 && /SHA-256/.test(r.stderr) && /NOT unpacked/.test(r.stderr), "a download with the wrong SHA-256 is refused (" + (r.stderr.match(/build failed: ([^\n]{0,60})/) || [])[1] + ")");
  check(!fs.existsSync(path.join(home, "llvm-mos")) || fs.readdirSync(path.join(home, "llvm-mos")).length === 0, "… and nothing was unpacked");
  check(!fs.existsSync(path.join(home, "downloads", "llvm-mos-test.tar.xz")), "… the damaged file is not kept");
  const wrongFile = path.join(SCRATCH, "wrong.tar.xz");
  fs.writeFileSync(wrongFile, junk);
  r = await runKitAsync(kd, ["--archive", wrongFile], { PCESTUDIO_HOME: home });
  check(r.status === 1 && /pins/.test(r.stderr) && /Not unpacking/.test(r.stderr), "--archive with the wrong file is refused before unpacking");
  server.close();

  /* a download that cannot connect: clear text, the retry command */
  tcBad.llvmMos.assets[host].url = "http://127.0.0.1:" + port + "/x";   /* the server is closed now */
  fs.writeFileSync(tcPath, JSON.stringify(tcBad));
  r = runKit(kd, [], { PCESTUDIO_HOME: home, PCESTUDIO_RETRY_MS: "1" });
  check(r.status === 1 && /could not download the compiler/.test(r.stderr) && /node build\.js/.test(r.stderr) && /--archive/.test(r.stderr) && /HTTPS_PROXY/.test(r.stderr),
        "a download that fails says what to do: the retry command, the proxy variable, --archive");
  fs.writeFileSync(tcPath, orig);

  /* an LLVM_MOS that is not a toolchain */
  r = runKit(kd, [], { LLVM_MOS: path.join(SCRATCH, "nothing here") });
  /* runKit deletes LLVM_MOS from the environment: call directly */
  r = cp.spawnSync(process.execPath, [path.join(kd, "build.js")], { cwd: kd, encoding: "utf8", env: Object.assign({}, process.env, { LLVM_MOS: path.join(SCRATCH, "nothing here") }) });
  check(r.status === 1 && /bin\/(mos-pce-clang|mos-clang\.exe)/.test(r.stderr), "an LLVM_MOS with no compiler in it is named in the error");
  r = runKit(kd, ["--print-toolchain"]);
  check(r.status === 0 && /llvm-mos v[\d.]+ for /.test(r.stdout), "--print-toolchain says what would be downloaded");
}

/* ---- is there a toolchain (cached or downloadable)? ---- */
function haveToolchain() {
  const dir = path.join(HOME, "llvm-mos");
  if (!fs.existsSync(dir)) return false;
  return fs.readdirSync(dir).some((d) => fs.existsSync(path.join(dir, d, ".verified")));
}

/* ---- the repo script's ROM, where it can run ---- */
function referenceTools() {
  if (process.platform === "win32") return null;
  const paths = require("../tools/tool-paths.js");
  const llvm = paths.llvmMos && paths.llvmMos();
  const pceas4 = process.env.PCEAS4 || path.join(os.homedir(), ".local", "bin", "pceas4");
  if (!llvm || !fs.existsSync(pceas4) || !fs.existsSync("/bin/bash")) return null;
  return { llvm: llvm, pceas4: pceas4 };
}
function referenceRom(ref, g, engineBases) {
  const name = "kitcheck-" + g.key;
  const r = cp.spawnSync("bash", [path.join(ROOT, "tools", "build-toyc-banked.sh"), g.dir + "/main.lua", name], {
    cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    env: Object.assign({}, process.env, { LLVM_MOS: ref.llvm, PCEAS4: ref.pceas4, OPT: OPT, ENGINE_BASES: engineBases })
  });
  if (r.status !== 0) { console.log(r.stdout + r.stderr); return null; }
  const rom = fs.readFileSync(path.join(ROOT, "tools", "gen", name + ".pce"));
  for (const f of fs.readdirSync(path.join(ROOT, "tools", "gen"))) if (f.startsWith(name + ".") || f === name + ".eng") fs.rmSync(path.join(ROOT, "tools", "gen", f), { recursive: true, force: true });
  return rom;
}

async function main() {
  checkContents();
  await checkFailures();

  const want = (process.env.PCE_KIT_GAMES || "").split(",").filter(Boolean);
  const games = GAMES.filter((g) => !want.length || want.indexOf(g.key) >= 0);
  const pins = fs.existsSync(PINS_FILE) ? JSON.parse(fs.readFileSync(PINS_FILE, "utf8")) : { opt: OPT, roms: {} };
  const ref = referenceTools();
  const idx = JSON.parse(fs.readFileSync(path.join(ROOT, "tools", "native-kit", "engines", "index.json"), "utf8"));
  const bases = idx.bases.map((b) => b.base).join(" ");
  const newPins = { opt: OPT, roms: Object.assign({}, pins.roms) };
  let matchedRef = true;

  for (const g of games) {
    const dir = path.join(SCRATCH, "kit " + g.key);   /* a space in the folder's name */
    fs.mkdirSync(dir);
    unzipTo(makeZip(g.dir, g.key).zip, dir);
    const kd = path.join(dir, "pcestudio-native-kit");
    const t0 = Date.now();
    const r = runKit(kd, ["--opt", OPT]);
    if (r.status !== 0) {
      if (!haveToolchain() && /could not download the compiler/.test(r.stderr)) { skip(g.label + ": no network and no cached compiler in " + HOME); continue; }
      console.log(r.stdout + r.stderr);
      check(false, g.label + ": the kit builds game.pce");
      continue;
    }
    const rom = fs.readFileSync(path.join(kd, "game.pce"));
    check(rom.length >= 24576 && rom.length % 8192 === 0, g.label + ": the kit builds game.pce (" + rom.length + " bytes, " + ((Date.now() - t0) / 1000).toFixed(1) + " s)");
    const digest = sha(rom);
    if (pins.roms[g.key]) check(digest === pins.roms[g.key], g.label + ": ROM SHA-256 equals the pin " + pins.roms[g.key].slice(0, 12) + " (" + digest.slice(0, 12) + ")");
    else console.log("      " + g.label + " has no pin yet: " + digest);
    if (ref) {
      const rr = referenceRom(ref, g, bases);
      const same = !!rr && sha(rr) === digest;
      check(same, g.label + ": byte for byte equal to tools/build-toyc-banked.sh (" + (rr ? sha(rr).slice(0, 12) : "no ROM") + ")");
      if (!same) matchedRef = false;
    }
    newPins.roms[g.key] = digest;
    /* CRLF in the game's text files builds the same ROM (PLATFORMER, the fast one) */
    if (g.key === "platformer") {
      const mainLua = path.join(kd, "game", "main.lua");
      fs.writeFileSync(mainLua, fs.readFileSync(mainLua, "utf8").replace(/\r?\n/g, "\r\n"));
      const r2 = runKit(kd, ["--opt", OPT]);
      check(r2.status === 0 && sha(fs.readFileSync(path.join(kd, "game.pce"))) === digest, "a main.lua with CRLF line endings builds the same ROM");
    }
  }
  if (!ref) skip("no local llvm-mos + PCEAS 4.x + bash: the repo script's ROMs were not compared here (the pins carry the proof on this machine)");
  if (process.argv.indexOf("--update-pins") >= 0) {
    if (!ref || !matchedRef) { console.log("FAIL  --update-pins needs a run on a machine where the repo script matched"); failures++; }
    else { fs.writeFileSync(PINS_FILE, JSON.stringify(newPins, null, 1) + "\n"); console.log("wrote " + path.relative(ROOT, PINS_FILE)); }
  }
  console.log(failures ? "\n" + failures + " FAILED" : "\nok" + (skips ? " (" + skips + " skipped)" : ""));
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
