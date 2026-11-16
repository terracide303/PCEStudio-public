#!/usr/bin/env node
/*
 * build.js — the native build kit's one script (docs/NATIVE-KIT.md).
 *
 *   node build.js                     builds game/ into game.pce
 *   node build.js --help
 *
 * Needs only Node 18 or newer: no bash, no Python, no npm install.  It
 *   1. finds llvm-mos (LLVM_MOS, or ~/.pcestudio/llvm-mos), or downloads the
 *      official pinned release for this machine (toolchain.json: URL and SHA-256,
 *      checked before anything is unpacked),
 *   2. turns the game (game/main.lua, its art and songs) into C with the
 *      compiler in this kit, compiles it, packs its functions into switched
 *      8 KiB ROM banks, links, and
 *   3. splices in the prebuilt sound-engine banks (engines/) when the game
 *      makes sound, and writes game.pce.
 * It is the same pipeline as tools/build-toyc-banked.sh in the PCEStudio
 * repository, step for step, and builds the same bytes.
 *
 * Options (also environment variables):
 *   --game DIR        the game folder (default: game next to this script)
 *   --out FILE        the ROM to write (default: game.pce next to this script)
 *   --work DIR        scratch folder (default: build next to this script)
 *   --opt -Os|-Oz     the compiler's size/speed switch (OPT; default -Os)
 *   --toolchain DIR   use this llvm-mos SDK (LLVM_MOS)
 *   --archive FILE    use a llvm-mos archive you downloaded yourself; its
 *                     SHA-256 must still match toolchain.json
 *   --home DIR        where the toolchain is kept (PCESTUDIO_HOME;
 *                     default ~/.pcestudio)
 *   --print-toolchain print what would be downloaded, and stop
 * Proxy: HTTPS_PROXY / https_proxy (and NO_PROXY) are honoured.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");
const crypto = require("crypto");
const https = require("https");
const http = require("http");
const tls = require("tls");

const KIT_VERSION = 1;
const KIT_DIR = __dirname;
const WIN = process.platform === "win32";

/* ------------------------------------------------------------------ utils */

class KitError extends Error {}
function die(message) { throw new KitError(message); }
function log(text) { process.stdout.write(text + "\n"); }
function warn(text) { process.stderr.write(text + "\n"); }

function parseArgs(argv) {
  const o = { game: null, out: null, work: null, opt: null, toolchain: null, archive: null, home: null, print: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { if (i + 1 >= argv.length) die(a + " needs a value"); return argv[++i]; };
    if (a === "--game") o.game = val();
    else if (a === "--out") o.out = val();
    else if (a === "--work") o.work = val();
    else if (a === "--opt") o.opt = val();
    else if (a === "--toolchain") o.toolchain = val();
    else if (a === "--archive") o.archive = val();
    else if (a === "--home") o.home = val();
    else if (a === "--print-toolchain") o.print = true;
    else if (a === "--help" || a === "-h") o.help = true;
    else die("unknown option " + a + " (try --help)");
  }
  return o;
}

function readJson(file) {
  /* a kit edited on Windows may carry CRLF and a byte-order mark */
  const text = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  try { return JSON.parse(text); } catch (e) { die(file + " is not valid JSON: " + e.message); }
}

/* Run a program with an argument list (no shell, so spaces in paths and
 * Windows backslashes are not our problem); returns {status, stdout, stderr}. */
function run(cmd, args, opts) {
  const r = cp.spawnSync(cmd, args, Object.assign({ encoding: "utf8", maxBuffer: 256 * 1024 * 1024, windowsHide: true }, opts || {}));
  if (r.error) die("could not run " + cmd + ": " + r.error.message);
  return r;
}

function fail(what, r) {
  const out = ((r.stdout || "") + (r.stderr || "")).trim();
  die(what + (out ? ":\n" + out : "") );
}

/* ----------------------------------------------------------- the toolchain */

function hostKey() { return process.platform + "-" + process.arch; }

function sdkRootOf(dir) {
  /* Windows has no mos-pce-clang.exe: the SDK's mos-pce-clang.bat only runs mos-clang.exe --config mos-pce.cfg */
  const exe = WIN ? "mos-clang.exe" : "mos-pce-clang";
  for (const c of [dir, path.join(dir, "llvm-mos")]) {
    if (fs.existsSync(path.join(c, "bin", exe))) return c;
  }
  return null;
}

function sha256File(file) {
  const h = crypto.createHash("sha256");
  const fd = fs.openSync(file, "r");
  const buf = Buffer.allocUnsafe(1 << 20);
  try {
    for (;;) { const n = fs.readSync(fd, buf, 0, buf.length, null); if (!n) break; h.update(buf.subarray(0, n)); }
  } finally { fs.closeSync(fd); }
  return h.digest("hex");
}

function proxyFor(urlObj) {
  const raw = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.ALL_PROXY || process.env.all_proxy;
  if (!raw) return null;
  const no = (process.env.NO_PROXY || process.env.no_proxy || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const host = urlObj.hostname.toLowerCase();
  for (const n of no) {
    if (n === "*" || host === n.replace(/^\./, "") || host.endsWith("." + n.replace(/^\./, ""))) return null;
  }
  try { return new URL(/^[a-z]+:\/\//i.test(raw) ? raw : "http://" + raw); } catch (e) { die("HTTPS_PROXY is not a URL: " + raw); }
  return null;
}

/* One GET, through the proxy's CONNECT tunnel when there is one. */
function httpGet(urlStr) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const headers = { "User-Agent": "pcestudio-native-kit", "Accept": "application/octet-stream" };
    const proxy = u.protocol === "https:" ? proxyFor(u) : null;
    const timeout = 60000;
    if (!proxy) {
      const mod = u.protocol === "https:" ? https : http;
      const req = mod.get(u, { headers: headers, timeout: timeout }, resolve);
      req.on("timeout", () => req.destroy(new Error("no data for 60 s")));
      req.on("error", reject);
      return;
    }
    const pHeaders = { Host: u.hostname + ":" + (u.port || 443) };
    if (proxy.username) pHeaders["Proxy-Authorization"] = "Basic " + Buffer.from(decodeURIComponent(proxy.username) + ":" + decodeURIComponent(proxy.password)).toString("base64");
    const preq = http.request({ host: proxy.hostname, port: proxy.port || 80, method: "CONNECT", path: u.hostname + ":" + (u.port || 443), headers: pHeaders, timeout: timeout });
    preq.on("timeout", () => preq.destroy(new Error("the proxy did not answer in 60 s")));
    preq.on("error", reject);
    preq.on("connect", (res, socket) => {
      if (res.statusCode !== 200) { socket.destroy(); return reject(new Error("the proxy refused the connection: HTTP " + res.statusCode)); }
      const secure = tls.connect({ socket: socket, servername: u.hostname });
      const req = https.get({ host: u.hostname, path: u.pathname + u.search, headers: headers, createConnection: () => secure, agent: false }, resolve);
      req.on("error", reject);
    });
    preq.end();
  });
}

async function download(urlStr, dest, want) {
  let url = urlStr;
  for (let hop = 0; hop < 8; hop++) {
    const res = await httpGet(url);
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      res.resume();
      url = new URL(res.headers.location, url).toString();
      continue;
    }
    if (res.statusCode !== 200) { res.resume(); throw new Error("HTTP " + res.statusCode + " from " + new URL(url).host); }
    const total = +res.headers["content-length"] || want.bytes || 0;
    const hash = crypto.createHash("sha256");
    const out = fs.createWriteStream(dest);
    let got = 0, nextMark = 10;
    await new Promise((resolve, reject) => {
      res.on("data", (chunk) => {
        got += chunk.length; hash.update(chunk);
        if (total && got * 100 / total >= nextMark) { log("  " + Math.min(100, Math.floor(got * 100 / total)) + "%  (" + (got / 1048576).toFixed(0) + " of " + (total / 1048576).toFixed(0) + " MB)"); nextMark += 10; }
      });
      res.on("error", reject);
      res.on("aborted", () => reject(new Error("the connection was cut after " + got + " bytes")));
      out.on("error", reject);
      out.on("finish", resolve);
      res.pipe(out);
    });
    return { sha256: hash.digest("hex"), bytes: got };
  }
  throw new Error("too many redirects");
}

function tarProgram() {
  if (WIN) {
    /* Windows 10 (1803) and newer ship bsdtar as System32\tar.exe; Git's GNU tar may be first on PATH and reads "C:" as a host name */
    const sys = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
    if (fs.existsSync(sys)) return sys;
  }
  return "tar";
}

function extractArchive(archive, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const r = run(tarProgram(), ["-xf", archive, "-C", destDir]);
  if (r.status !== 0) {
    fail("could not unpack " + archive + " with " + tarProgram() + " (" + (WIN ? "Windows 10 and 11 include tar.exe in System32; 7-Zip can unpack the .7z by hand into the folder named below" : "unpacking .tar.xz needs tar with xz support: install xz-utils") + ")", r);
  }
}

function toolchainDir(home, rel, asset) { return path.join(home, "llvm-mos", rel + "-" + asset.sha256.slice(0, 12)); }

async function ensureToolchain(opts, tc) {
  const envRoot = opts.toolchain || process.env.LLVM_MOS;
  if (envRoot) {
    const root = sdkRootOf(envRoot);
    if (!root) die("LLVM_MOS / --toolchain is " + envRoot + ", but bin/" + (WIN ? "mos-clang.exe" : "mos-pce-clang") + " is not in it or in its llvm-mos folder");
    return root;
  }
  const home = opts.home || process.env.PCESTUDIO_HOME || path.join(os.homedir(), ".pcestudio");
  const rel = tc.llvmMos.release;
  const asset = tc.llvmMos.assets[hostKey()];
  if (!asset) {
    die("llvm-mos " + rel + " has no official SDK for " + hostKey() + ". Supported: " + Object.keys(tc.llvmMos.assets).join(", ") +
        ".\nBuild llvm-mos yourself (https://github.com/llvm-mos/llvm-mos-sdk) and set LLVM_MOS to its folder, then run this again.");
  }
  const dir = toolchainDir(home, rel, asset);
  const have = sdkRootOf(dir);
  if (have && fs.existsSync(path.join(dir, ".verified"))) return have;

  fs.mkdirSync(path.join(home, "downloads"), { recursive: true });
  let archive = opts.archive;
  let downloaded = false;
  if (archive) {
    if (!fs.existsSync(archive)) die("--archive " + archive + " does not exist");
    log("checking " + archive);
    const got = sha256File(archive);
    if (got !== asset.sha256) die(archive + " has SHA-256 " + got + ", but toolchain.json pins " + asset.sha256 + " (" + asset.url + "). Not unpacking it.");
  } else {
    archive = path.join(home, "downloads", path.basename(new URL(asset.url).pathname));
    const retry = "node build.js";
    log("downloading llvm-mos " + rel + " for " + hostKey() + " (" + (asset.bytes / 1048576).toFixed(0) + " MB, once)\n  " + asset.url);
    let lastErr = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const part = archive + ".part";
        const got = await download(asset.url, part, asset);
        if (got.sha256 !== asset.sha256) {
          fs.rmSync(part, { force: true });
          die("the download has SHA-256 " + got.sha256 + " but toolchain.json pins " + asset.sha256 + ": it was damaged or replaced on the way, and it was NOT unpacked. Run " + retry + " again; if it keeps happening, something between you and GitHub (a proxy, a filter) is altering the file.");
        }
        fs.renameSync(part, archive);
        downloaded = true; lastErr = null;
        break;
      } catch (e) {
        if (e instanceof KitError) throw e;
        lastErr = e;
        warn("  attempt " + attempt + " of 3 failed: " + (e.code ? e.code + " " : "") + e.message);
        if (attempt < 3) await new Promise((res) => setTimeout(res, (+process.env.PCESTUDIO_RETRY_MS || 2000) * attempt));
      }
    }
    if (lastErr) {
      die("could not download the compiler: " + lastErr.message + "\n\n" +
          "What to do:\n" +
          "  - Check your connection and run this again:  node build.js   (a finished download is kept, nothing is repeated)\n" +
          "  - Behind a proxy? Set HTTPS_PROXY (e.g. http://proxy.example:8080) and run it again.\n" +
          "  - Download blocked? Fetch this file in a browser or on another machine:\n      " + asset.url + "\n" +
          "    then run:  node build.js --archive PATH-TO-THE-FILE\n" +
          "    (it must match SHA-256 " + asset.sha256 + "; the script checks).\n" +
          "  - Or install llvm-mos yourself and set LLVM_MOS to its folder.");
    }
  }
  const tmp = dir + ".unpack";
  fs.rmSync(tmp, { recursive: true, force: true });
  log("unpacking (this takes a minute)");
  extractArchive(archive, tmp);
  if (!sdkRootOf(tmp)) { fs.rmSync(tmp, { recursive: true, force: true }); die("the archive unpacked, but has no bin/" + (WIN ? "mos-clang.exe" : "mos-pce-clang") + " in it: " + archive); }
  fs.rmSync(dir, { recursive: true, force: true });
  fs.renameSync(tmp, dir);
  fs.writeFileSync(path.join(dir, ".verified"), JSON.stringify({ sha256: asset.sha256, url: asset.url, verified: new Date().toISOString() }) + "\n");
  if (downloaded) fs.rmSync(archive, { force: true });
  return sdkRootOf(dir);
}

/* ------------------------------------------------------------- the packer
 * A port of tools/bank-toyc.py (compiler step 1, docs/BANKING-STUDY.md): put
 * each il_fn_N into an 8 KiB ROM bank, first-fit-decreasing, clustered by call
 * affinity, and rewrite the C so every call maps its callee's bank. */

const HELPER = `
/* bank prototype: switched code lives in .rom_bankN, mapped at page 6 ($C000). */
static uint8_t il_bank = 0;
static inline __attribute__((always_inline)) void il_map(uint8_t b) {
  __asm__ volatile("tam #$40" :: "a"(b) : "memory");
}
#undef IL_DIRECT
/* A direct call (pce-cgen.js resolves the callee at compile time).  A callee in the fixed page
 * (IL_BANK 0) or in the caller's own bank is called as it is.  Any other callee goes through il_call,
 * which lives in the fixed page: a bank switch must not run from inside the banked code it swaps out
 * (measured: direct cross-bank switches crashed TOWER), and a stub per callee costs the fixed page
 * about 70 bytes each, which NOVA TIDE has not got.  A chunk caller (IL_BANK_none, 255) always
 * takes il_call. */
#define IL_DIRECT(caller, callee, cid, ...) ((IL_BANK_il_fn_##callee == 0 || IL_BANK_il_fn_##callee == IL_BANK_##caller) ? il_fn_##callee(&il_closures[cid], __VA_ARGS__) : il_call(cid, __VA_ARGS__))
#undef IL_CHUNK_CALL
#define IL_CHUNK_CALL(sym, e) ({ uint8_t o__ = il_bank; int16_t v__; il_bank = IL_BANK_##sym; il_map(IL_BANK_##sym); v__ = (e); il_bank = o__; il_map(o__); v__; })
`;

function cmpStr(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

/* sizes of il_fn_N from `llvm-nm -S` of the non-LTO object */
function functionSizes(nmText) {
  const sizes = new Map();
  for (const l of nmText.split(/\r?\n/)) {
    const p = l.trim().split(/\s+/);
    if (p.length >= 4) {
      const m = /^il_fn_(\d+(?:_c\d+)?)$/.exec(p[p.length - 1]);
      if (m) sizes.set(m[1], parseInt(p[1], 16));
    }
  }
  return sizes;
}

/* returns {split: [ids]} when functions larger than a bank need splitting, or
 * {text, banks: [ids]} (the banked C and the physical bank numbers used) */
function pack(text, sizes, o) {
  /* a function split into chunks keeps a small dispatcher of its own name in the fixed page */
  const split = new Set();
  for (const k of sizes.keys()) if (k.indexOf("_c") >= 0) split.add(k.split("_")[0]);
  for (const f of split) sizes.delete(f);
  if (o.pinHot) {
    for (const m of text.matchAll(/\/\* HOT il_fn_(\d+) \*\//g)) {
      const k = m[1];
      if (sizes.has(k) && sizes.get(k) <= o.hotMax) { sizes.delete(k); warn("pinned in the fixed page: il_fn_" + k); }
    }
  }
  const edges = new Map();
  for (const m of text.matchAll(/\/\* AFF il_fn_(\d+(?:_c\d+)?) il_fn_(\d+(?:_c\d+)?) (\d+) \*\//g)) {
    const a = m[1], b = m[2], w = parseInt(m[3], 10);
    if (sizes.has(a) && sizes.has(b) && a !== b) {
      const k = cmpStr(a, b) < 0 ? a + "\u0000" + b : b + "\u0000" + a;
      edges.set(k, (edges.get(k) || 0) + w);
    }
  }
  const sortedEdges = [...edges.entries()].map(([k, w]) => { const ab = k.split("\u0000"); return { a: ab[0], b: ab[1], w: w }; });
  sortedEdges.sort((x, y) => (y.w - x.w) || cmpStr(x.a, y.a) || cmpStr(x.b, y.b));
  const place = (slack) => {
    const CAP = 8192 - slack;
    const banks = [];
    const assign = new Map();
    const parent = new Map(), csize = new Map();
    for (const [k, v] of sizes) { parent.set(k, k); csize.set(k, v); }
    const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
    for (const e of sortedEdges) {
      const ra = find(e.a), rb = find(e.b);
      if (ra === rb) continue;
      if (csize.get(ra) + csize.get(rb) <= CAP) { parent.set(rb, ra); csize.set(ra, csize.get(ra) + csize.get(rb)); }
    }
    const clusters = new Map();
    for (const k of [...sizes.keys()].sort(cmpStr)) {
      const r = find(k);
      if (!clusters.has(r)) clusters.set(r, []);
      clusters.get(r).push(k);
    }
    const order = [...clusters.entries()].map(([root, members]) => ({ root: root, members: members, total: members.reduce((s, m) => s + sizes.get(m), 0) }));
    order.sort((x, y) => (y.total - x.total) || cmpStr(x.root, y.root));
    for (const c of order) {
      if (c.total > CAP && c.members.length === 1) { banks.push(c.total); assign.set(c.members[0], banks.length); continue; }
      let placed = false;
      for (let b = 0; b < banks.length; b++) {
        if (banks[b] + c.total <= CAP) { banks[b] += c.total; for (const m of c.members) assign.set(m, b + 1); placed = true; break; }
      }
      if (!placed) { banks.push(c.total); for (const m of c.members) assign.set(m, banks.length); }
    }
    let tw = 0, sw = 0;
    for (const e of sortedEdges) { tw += e.w; if (assign.get(e.a) === assign.get(e.b)) sw += e.w; }
    return { banks: banks, assign: assign, sw: sw, tw: tw, CAP: CAP, slack: slack };
  };
  /* as tools/bank-toyc.py: below 90% of the call weight inside a bank, try a smaller slack and keep the
   * best share (NOVA TIDE: its draw() fills a bank and spr() and hide() land in another).  A retry from a
   * link overflow (BANK_SLACK set, or o.slack raised) does not search. */
  let pl = place(o.slack);
  if (edges.size && pl.sw * 100 < pl.tw * 90 && o.searchSlack !== false) {
    for (const sl of [768, 512, 384, 256]) { const q = place(sl); if (q.sw > pl.sw) pl = q; }
  }
  const { banks, assign, CAP } = pl;
  if (edges.size) {
    warn("call affinity (on): " + pl.sw + " of " + pl.tw + " edge weight is same-bank (" + Math.floor(100 * pl.sw / Math.max(pl.tw, 1)) + "%), " + edges.size + " edges" + (pl.slack !== o.slack ? ", slack " + pl.slack : ""));
  }
  const ids = o.bankIds.length ? o.bankIds : Array.from({ length: 199 }, (_, i) => i + 1);
  for (const [k, v] of [...assign.entries()]) assign.set(k, ids[v - 1]);
  warn("banks used " + banks.length + " fill [" + banks.join(", ") + "]");
  const big = [...sizes.entries()].filter(([k, v]) => v > CAP && k.indexOf("_") < 0).map(([k]) => parseInt(k, 10)).sort((a, b) => a - b);
  if (big.length) return { split: big };
  let mx = 0; for (const v of sizes.values()) if (v > mx) mx = v;
  if (mx > CAP) die("a chunk is larger than one bank: " + mx + " B");

  /* 1. a section attribute on each forward declaration */
  text = text.replace(/^static int(?:32|16)_t il_fn_(\d+(?:_c\d+)?)\((?:struct il_closure \*cl)[^;]*\) __attribute__\(\(noinline\)\);/gm, (whole, k) => {
    if (!assign.has(k)) return whole;
    return whole.replace("__attribute__((noinline))", () => "__attribute__((noinline, section(\".rom_bank" + assign.get(k) + "\")))");
  });
  /* 2. il_call: every case maps its bank around the call */
  let nfnAll = 0;
  for (const m of text.matchAll(/^ {2}case (\d+): return il_fn_\1\(/gm)) nfnAll = Math.max(nfnAll, parseInt(m[1], 10));
  nfnAll += 1;
  let bankTable = [...assign.entries()].sort((x, y) => cmpStr(x[0], y[0]) || (x[1] - y[1])).map(([k, b]) => "#define IL_BANK_il_fn_" + k + " " + b).join("\n") + "\n";
  for (let i = 0; i < nfnAll; i++) if (!assign.has(String(i))) bankTable += "#define IL_BANK_il_fn_" + i + " 0\n";
  bankTable += "#define IL_BANK_none 255\n";
  const mCall = /^static int32_t il_call\([^)]*\) __attribute__\(\(noinline\)\);/m.exec(text);
  if (!mCall) die("il_call's declaration not found in the generated C");
  const callDecl = mCall[0];
  text = text.replace(callDecl, () => bankTable + HELPER + callDecl);
  let nfn = 0;
  for (const m of text.matchAll(/^ {2}case (\d+): return il_fn_\1\(/gm)) nfn = Math.max(nfn, parseInt(m[1], 10));
  nfn += 1;
  const bankOf = [];
  for (let i = 0; i < nfn; i++) bankOf.push(assign.has(String(i)) ? assign.get(String(i)) : 0);
  let ncase = 0;
  text = text.replace(/^ {2}case (\d+): return il_fn_\1\(&il_closures\[cv\]((?:, a\d)*)\);/gm, (whole, id, args) => {
    ncase++;
    return "  case " + id + ": rv = il_fn_" + id + "(&il_closures[cv]" + args + "); break;";
  });
  if (!ncase) die("no il_call cases found in the generated C");
  const oldHead = "  fid = il_closures[cv].fid;\n  switch (fid) {\n";
  if (text.indexOf(oldHead) < 0) die("il_call's switch head not found in the generated C");
  text = text.replace(oldHead, () => "  uint8_t o = il_bank, b = 0;\n  int32_t rv = 0;\n  fid = il_closures[cv].fid;\n  if (fid >= 0 && fid < " + nfn + ") b = il_bank_of[fid];\n  if (b) { il_bank = b; il_map(b); }\n  switch (fid) {\n");
  const oldTail = "  default: return 0;\n  }\n}";
  if (text.indexOf(oldTail) < 0) die("il_call's switch tail not found in the generated C");
  text = text.replace(oldTail, () => "  default: break;\n  }\n  if (b) { il_bank = o; il_map(o); }\n  return rv;\n}");
  text = text.replace(callDecl, () => "static const uint8_t il_bank_of[" + nfn + "] = {" + bankOf.join(",") + "};\n" + callDecl);
  /* 3. the direct boot call */
  if (assign.has("0")) {
    const boot = /\(void\)il_fn_0\(&il_closures\[0\][^;]*\);/;
    if (!boot.test(text)) die("the boot call of il_fn_0 not found in the generated C");
    const b0 = assign.get("0");
    text = text.replace(boot, (m) => "il_bank = " + b0 + "; il_map(" + b0 + "); " + m + " il_bank = 0; il_map(0);");
  }
  return { text: text, banks: banks.map((_, i) => ids[i]) };
}

/* ------------------------------------------------------------ the pipeline */

function hex(n) { return "0x" + n.toString(16).toUpperCase().padStart(4, "0"); }

/* the linked ELF's zero-page end and __heap_start */
function measure(llvm, elf) {
  let zpEnd = 0, heap = null;
  const od = run(llvm("llvm-objdump"), ["-h", elf]);
  for (const l of od.stdout.split(/\r?\n/)) {
    const p = l.trim().split(/\s+/);
    if (p.length >= 4 && (p[1] === ".zp.bss" || p[1] === ".zp")) {
      const vma = parseInt(p[3], 16), size = parseInt(p[2], 16);
      if (!isNaN(vma) && !isNaN(size)) zpEnd = Math.max(zpEnd, (vma & 0xFFFF) + size);
    }
  }
  const nm = run(llvm("llvm-nm"), [elf]);
  for (const l of nm.stdout.split(/\r?\n/)) {
    const p = l.trim().split(/\s+/);
    if (p.length === 3 && p[2] === "__heap_start") heap = parseInt(p[0], 16) & 0xFFFF;
  }
  if (!zpEnd || heap === null) die("cannot read the zero page end or heap start from " + elf);
  return { zpEnd: zpEnd, heap: heap };
}

function nodeScript(rel, args) {
  const r = run(process.execPath, [path.join(KIT_DIR, rel)].concat(args), { cwd: KIT_DIR });
  return r;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { log(fs.readFileSync(__filename, "utf8").split("*/")[0].replace(/^\/\*\s*\n?/, "").replace(/^#!.*\n/, "")); return; }
  const major = +process.versions.node.split(".")[0];
  if (major < 18) die("Node " + process.versions.node + " is too old: this kit needs Node 18 or newer (https://nodejs.org).");

  const tc = readJson(path.join(KIT_DIR, "toolchain.json"));
  if (tc.kit !== KIT_VERSION) {
    die("this kit is out of step: build.js is kit version " + KIT_VERSION + " but toolchain.json is version " + tc.kit +
        ". Download a fresh kit from the studio (Export > Download native build kit) and use all of its files together.");
  }
  if (opts.print) {
    const a = tc.llvmMos.assets[hostKey()];
    log("llvm-mos " + tc.llvmMos.release + " for " + hostKey() + ": " + (a ? a.url + "\n  SHA-256 " + a.sha256 + "\n  " + a.bytes + " bytes" : "no official SDK for this machine"));
    return;
  }
  const gameDir = path.resolve(opts.game || path.join(KIT_DIR, "game"));
  const outRom = path.resolve(opts.out || path.join(KIT_DIR, "game.pce"));
  const work = path.resolve(opts.work || path.join(KIT_DIR, "build"));
  const OPT = opts.opt || process.env.OPT || tc.opt || "-Os";
  if (!/^-O[0-3sz]$/.test(OPT)) die("--opt must be one of -O0 -O1 -O2 -O3 -Os -Oz, not " + OPT);
  if (!fs.existsSync(path.join(gameDir, "main.lua"))) die("no main.lua in " + gameDir + " (the game folder)");
  const gk = path.join(gameDir, "kit.json");
  if (fs.existsSync(gk)) {
    const g = readJson(gk);
    if (g.kit !== KIT_VERSION) {
      die("the game in " + gameDir + " was exported for kit version " + g.kit + ", but this build.js is version " + KIT_VERSION +
          ". Export the game again from the studio (Download native build kit).");
    }
  }

  const sdk = await ensureToolchain(opts, tc);
  const llvm = (name) => path.join(sdk, "bin", name + (WIN ? ".exe" : ""));
  /* the PC Engine driver: mos-pce-clang picks its configuration from its own name; on Windows the same is mos-clang.exe --config mos-pce.cfg */
  const CC = WIN ? llvm("mos-clang") : llvm("mos-pce-clang");
  const CC_PRE = WIN ? ["--config", "mos-pce.cfg"] : [];
  log("compiler: " + sdk);

  /* the game's files, with CRLF turned into LF, in a clean working folder */
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(path.join(work, "game"), { recursive: true });
  for (const name of fs.readdirSync(gameDir)) {
    const src = path.join(gameDir, name);
    if (!fs.statSync(src).isFile()) continue;
    if (/\.(lua|json|md|txt)$/i.test(name)) fs.writeFileSync(path.join(work, "game", name), fs.readFileSync(src, "utf8").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n"));
    else fs.copyFileSync(src, path.join(work, "game", name));
  }
  const rel = (p) => path.relative(KIT_DIR, p).split(path.sep).join("/");   /* tool arguments: relative, as the repo's script passes them */
  const inKit = (p) => path.resolve(p).startsWith(KIT_DIR + path.sep);
  const R = (p) => (inKit(p) ? rel(p) : path.resolve(p));
  const G = R(path.join(work, "game_c"));
  const GAME = R(path.join(work, "game"));
  const ENG = R(path.join(work, "eng"));
  fs.mkdirSync(path.join(work, "eng"), { recursive: true });

  const engines = readJson(path.join(KIT_DIR, "engines", "index.json"));

  function emit(env) {
    const r = run(process.execPath, ["tools/toyc/emit.js", GAME + "/main.lua", G + ".c"], { cwd: KIT_DIR, env: Object.assign({}, process.env, env || {}) });
    if (r.status !== 0) fail("the game was refused by the compiler front end", r);
  }

  async function attempt(slack, pinHot) {
    emit();
    const readC = () => fs.readFileSync(path.resolve(KIT_DIR, G + ".c"), "utf8");
    const text = readC();
    let extra = ["-DTOY_HOLD_BUILD"];
    if (text.includes("void toy_raster(int32_t line)")) extra.push("-DTOY_RASTER_BUILD");
    if (text.includes("toy_raster_entry(")) extra.push("-DTOY_RASTER_BUILD", "-DTOY_RASTER_TABLE");
    if (/toy_pad\(|toy_timer_set\(|toy_sat\(|toy_sprite\(/.test(text)) extra.push("-DTOY_INPUT_BUILD");
    let sound = false;
    let srcs = ["tools/toyc/toy_runtime.c", G + ".banked.c"];
    let heapPick = null;
    if (text.includes('#include "toy_sound.h"')) {
      sound = true;
      /* pass 1: the engine at the lowest base, for the header the C needs */
      const first = engines.bases[0];
      fs.copyFileSync(path.join(KIT_DIR, "engines", first.base, "hutrack-symbols.h"), path.join(work, "eng", "hutrack-symbols.h"));
      extra.push("-I" + ENG, "-Itools/toyc", "-mlto-zp=96");
      srcs.push("tools/toyc/toy_sound.c");
    }
    const compileObj = () => {
      const r = run(CC, CC_PRE.concat([OPT], extra, ["-fno-lto", "-c", "-Itools/toyc", "-o", G + ".o", G + ".c"]), { cwd: KIT_DIR });
      if (r.status !== 0) fail("the compiler failed", r);
      if (r.stderr.trim()) warn(r.stderr.trim());
    };
    const packNow = () => {
      const nm = run(llvm("llvm-nm"), ["-S", G + ".o"], { cwd: KIT_DIR });
      if (nm.status !== 0) fail("llvm-nm failed", nm);
      const sizes = functionSizes(nm.stdout);
      return pack(readC(), sizes, {
        slack: slack, pinHot: pinHot, hotMax: 600, searchSlack: !process.env.BANK_SLACK && slack === 1024,
        bankIds: sound ? [1, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30] : []
      });
    };
    compileObj();
    let res = packNow();
    if (res.split) {
      log("splitting functions " + res.split.join(","));
      let done = false;
      for (const ch of ["100", "60", "40", "25"]) {
        emit({ PCE_SPLIT_ONLY: res.split.join(","), PCE_SPLIT_OVER: "1", PCE_SPLIT_CHUNK: ch });
        compileObj();
        try { res = packNow(); } catch (e) {
          if (e instanceof KitError && /a chunk is larger than one bank/.test(e.message)) { warn("a chunk of " + ch + " instructions is larger than a bank; trying smaller chunks"); res = null; continue; }
          throw e;
        }
        if (res.split) die("splitting did not remove the function(s) larger than a bank");
        done = true; break;
      }
      if (!done) die("a chunk is larger than one bank even in 25-instruction pieces");
    }
    fs.writeFileSync(path.resolve(KIT_DIR, G + ".banked.c"), res.text);
    let banks = res.banks.slice();
    /* the toy's art: data banks after the code banks */
    if (text.includes('#include "toy_assets.h"')) {
      let last = 0; for (const b of banks) if (b > last) last = b;
      if (last < 4) last = 4;
      const r = nodeScript("tools/native-assets.js", [GAME, String(last + 1), G + ".art.c"]);
      if (r.status !== 0) fail("the game's art could not be converted", r);
      const m = /^BANKS (.*)$/m.exec(r.stdout);
      if (!m) die("the game has art files but the importer read none");
      banks = banks.concat(m[1].trim().split(/\s+/).map(Number));
      srcs.push(G + ".art.c", "tools/toyc/toy_assets.c");
      extra.push("-DTOY_INPUT_BUILD", "-Itools/toyc");
      if (r.stderr.trim()) log(r.stderr.trim());
    }
    const defs = banks.map((b) => "-Wl,--defsym=__rom_bank" + b + "_size=0x2000");
    const link = () => run(CC, CC_PRE.concat([OPT], extra, defs, ["-Itools/toyc", "-o", G + ".pce"], srcs), { cwd: KIT_DIR });
    let lr = link();
    if (lr.status !== 0) {
      const logText = lr.stdout + lr.stderr;
      if (/will not fit in region 'rom_bank[1-9]/.test(logText) && slack < 4096) {
        warn("a bank overflowed; repacking with " + (slack + 1024) + " bytes of slack");
        return { retry: { slack: slack + 1024, pinHot: pinHot } };
      }
      if (/region 'rom_bank0'/.test(logText) && pinHot) {
        warn("the fixed page is full: not pinning the raster hook there");
        return { retry: { slack: slack, pinHot: false } };
      }
      fail("the link failed", lr);
    }
    const romPath = path.resolve(KIT_DIR, G + ".pce");
    let rom = fs.readFileSync(romPath);
    if (sound) {
      const m1 = measure(llvm, romPath + ".elf");
      if (m1.zpEnd > 0x2080) die("the game's zero page ends at " + hex(m1.zpEnd) + ", past the sound engine's $2080");
      const pick = engines.bases.find((b) => parseInt(b.base, 16) >= m1.heap);
      if (!pick) die("the game's RAM ends at " + hex(m1.heap) + ", too high for any prebuilt sound engine (the highest base is " + engines.bases[engines.bases.length - 1].base + "). Trim the game's variables or arrays.");
      heapPick = pick;
      if (parseInt(pick.bssEnd, 16) > parseInt(engines.stackFloor, 16)) die("the sound engine's RAM would end at " + pick.bssEnd + ", over " + engines.stackFloor + " (no room for the stack)");
      const edir = path.join(KIT_DIR, "engines", pick.base);
      fs.copyFileSync(path.join(edir, "hutrack-symbols.h"), path.join(work, "eng", "hutrack-symbols.h"));
      lr = link();
      if (lr.status !== 0) fail("the final link failed", lr);
      const m2 = measure(llvm, romPath + ".elf");
      if (m2.zpEnd !== m1.zpEnd || m2.heap !== m1.heap) die("the final link moved the RAM partition (" + hex(m1.zpEnd) + "/" + hex(m1.heap) + " -> " + hex(m2.zpEnd) + "/" + hex(m2.heap) + ")");
      /* songs: the toy folder's song.json / songs.json, as one 8 KiB bank */
      const sr = nodeScript("tools/native-songs.js", [GAME, G + ".songs.bin"]);
      if (sr.status !== 0) fail("the game's songs could not be converted", sr);
      const lines = sr.stdout.trim().split(/\r?\n/);
      log(lines[lines.length - 1]);
      rom = Buffer.from(fs.readFileSync(romPath));
      const need = 5 * 8192;
      let d = rom;
      if (d.length < need) d = Buffer.concat([d, Buffer.alloc(need - d.length, 0xff)]);
      const empty = (a, b) => { for (let i = a; i < b; i++) if (d[i] !== 0xff && d[i] !== 0x00) return false; return true; };
      const code = fs.readFileSync(path.join(edir, "hutrack-code.bin")), tables = fs.readFileSync(path.join(edir, "hutrack-tables.bin"));
      const songs = fs.readFileSync(path.resolve(KIT_DIR, G + ".songs.bin"));
      for (const [bank, blob] of [[2, code], [3, tables], [4, songs]]) {
        if (blob.length !== 8192) die("a sound image is " + blob.length + " bytes, not 8192");
        if (!empty(bank * 8192, (bank + 1) * 8192)) die("bank " + bank + " is not empty in the linked ROM");
        blob.copy(d, bank * 8192);
      }
      rom = d;
    }
    fs.mkdirSync(path.dirname(outRom), { recursive: true });
    fs.writeFileSync(outRom, rom);
    return { rom: rom, banks: banks, sound: sound, enginebase: heapPick && heapPick.base };
  }

  let slack = +(process.env.BANK_SLACK || 1024), pinHot = process.env.BANK_PIN_HOT !== "0", result;
  for (let i = 0; i < 10; i++) {
    result = await attempt(slack, pinHot);
    if (!result.retry) break;
    slack = result.retry.slack; pinHot = result.retry.pinHot;
  }
  if (result.retry) die("could not fit the game after repeated repacking");
  log(path.basename(outRom) + "  " + result.rom.length + " bytes, switched banks: " + result.banks.join(" ") + (result.sound ? ", with the sound engine (RAM base " + result.enginebase + ")" : ""));
  log("sha256 " + crypto.createHash("sha256").update(result.rom).digest("hex"));
}

main().catch((e) => {
  if (e instanceof KitError) { warn("\nbuild failed: " + e.message); process.exit(1); }
  warn("\nbuild failed (a bug in build.js): " + (e && e.stack || e));
  process.exit(1);
});
