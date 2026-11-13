#!/usr/bin/env node
/*
 * tests/check-export-art-console.js — the Export button's ROM loads the toy's art, on the console.
 *
 * The studio's Export carries a toy's art as the importer's banked-data plan: the encoder prepends
 * copyv ops, the ROM streams the blob into VRAM.  tests/check-ilvm-copyv.js proves the op in the
 * host harness only; the console half (the bank-3 CopyvShim) was never run.  On 2026-11-13 the
 * exported PCEHero intro came out black: the interpreter handed the shim its program counter as an
 * offset into the $4000 code window, the shim read it as an absolute address, took its operands
 * from the wrong bytes (MAWR = $FFFF) and wrote garbage.  Now the interpreter hands over the
 * address ($4000 + pc).
 *
 * This builds tests/native-art (art files, nothing drawn by the toy) the way the studio's Export
 * does, runs the ROM in Geargrafx for 60 video frames and compares the VRAM it holds, copy by copy,
 * with the importer's VRAM image (a 64 KiB byte image: word i is bytes 2i and 2i+1) word for word.  SKIP without Geargrafx.
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..");
const il = require(ROOT + "/renderer/pce-il.js");
const ilbc = require(ROOT + "/renderer/pce-ilbc.js");
const romLib = require(ROOT + "/renderer/pce-rom.js");
const toyhost = require(ROOT + "/renderer/pce-toyhost.js");
let checks = 0;
const failures = [];
function check(ok, name) { checks++; if (!ok) { failures.push(name); console.log("FAIL  " + name); } else console.log("  ok  " + name); }

const gg = process.env.GEARGRAFX || "/Volumes/External II/pce-tools/geargrafx/app/Geargrafx.app/Contents/MacOS/geargrafx";
if (!fs.existsSync(gg)) { console.log("SKIP: Geargrafx not found"); process.exit(0); }

const dir = path.join(ROOT, "tests", "native-art");
const files = toyhost.importer.FILES.filter((n) => fs.existsSync(path.join(dir, n)))
  .map((n) => ({ name: n, source: fs.readFileSync(path.join(dir, n), "utf8") }));
const image = toyhost.importer.read(files);
const plan = toyhost.importer.plan(files);
check(!!image && !!plan, "the importer reads tests/native-art");
const program = il.compile(fs.readFileSync(path.join(dir, "main.lua"), "utf8"), { chunkName: "@main.lua" });
const encoded = ilbc.encode(program, { art: plan });
const rom = romLib.buildToyRom({ bank0: fs.readFileSync(path.join(ROOT, "renderer", "ilvm.bin")), bytecode: encoded.bytes, assets: plan.blob });
const scratch = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "export-art-"));
fs.writeFileSync(path.join(scratch, "rom.pce"), Buffer.from(rom));
fs.writeFileSync(path.join(scratch, "want.json"), JSON.stringify({ vram: Array.from(image.vram), copies: plan.copies }));

const PY = `
import sys, json
sys.path.insert(0, "tools")
from ggmcp import GG
exp = json.load(open(sys.argv[2])); V = exp["vram"]
g = GG(sys.argv[1]); g.tool("debug_step_frame", {"frames": 60, "mode": "sync"})
areas = {a["name"]: a for a in json.loads(g.tool("list_memory_areas"))["areas"]}
a = areas["VRAM"]; out = b""
while len(out) < 65536:
    n = min(4096, 65536 - len(out))
    t = json.loads(g.tool("read_memory", {"area": a["id"], "offset": "%04X" % (len(out) // a["unit_size"]), "size": n}))
    out += bytes.fromhex(t["data"].replace(" ", ""))
w = [out[i] | (out[i + 1] << 8) for i in range(0, 65536, 2)]
res = []
for c in exp["copies"]:
    s, n = c["vram"], c["words"]
    res.append({"vram": s, "words": n, "differ": sum(1 for i in range(n) if w[(s + i) & 0x7FFF] != (V[((s + i) & 0x7FFF) * 2] | (V[((s + i) & 0x7FFF) * 2 + 1] << 8)))})
print(json.dumps(res))
g.close()
`;
const r = spawnSync("python3", ["-I", "-c", PY, path.join(scratch, "rom.pce"), path.join(scratch, "want.json")], { cwd: ROOT, encoding: "utf8" });
let res = null;
try { res = JSON.parse(r.stdout.trim().split("\n").pop()); } catch (e) { /* reported below */ }
check(!!res, "the emulator ran the exported ROM (" + (r.stderr || "").trim().split("\n").slice(-1)[0] + ")");
(res || []).forEach(function (c) {
  check(c.differ === 0, "copy of " + c.words + " words to VRAM $" + c.vram.toString(16) + ": " + c.differ + " words differ from the importer's image");
});
console.log(failures.length ? "FAIL  " + failures.length + " of " + checks + " checks failed" : "PASS  " + checks + " checks, the exported ROM's VRAM equals the importer's image");
process.exit(failures.length ? 1 : 0);
