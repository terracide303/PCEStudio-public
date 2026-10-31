#!/usr/bin/env node
/*
 * tests/check-ilvm.js — #100's evidence: the IL as bytecode, interpreted on
 * the console.
 *
 *   1. The encoder (renderer/pce-ilbc.js) is deterministic, produces the
 *      documented container, and refuses by code: a fixed constant
 *      ilbc-fixed, five arguments ilbc-arity, a builtin other than rgb
 *      ilbc-builtin.  #172: a table instruction makes container version 2
 *      with a table section; a table-free toy stays version 1 byte for byte.
 *   2. buildToyRom() glues renderer/ilvm.bin and the bytecode into a
 *      24,576-byte image; Node and a browser context (self, no module)
 *      produce the same bytes; the refusals fire.
 *   3. tools/ilvm/build.sh rebuilds renderer/ilvm.bin byte-identically to
 *      the committed image when llvm-mos is present (SKIP otherwise, the
 *      PCEAS/llvm rule the other suites use).
 *   4. tests/dumps/toypalette-ilvm and toyparallax-ilvm: freshly emitted by
 *      the browser code path (tools/ilvm/emit.js, no compiler), the dumped
 *      ROM sha matches, captured frames are diff 0 against the browser run
 *      with a run of eight consecutive browser frames in order, and the
 *      saved VRAM/CRAM are the browser's.  The TMA measurements are printed
 *      and sanity-checked.
 *   5. #115: tests/dumps/toystatusbar-ilvm, the RCR-split toy (two register
 *      writes at line 24).  Its bar (rows 0-23) is diff 0 against the
 *      browser; its playfield is the known four-line phase, printed as a
 *      note rather than asserted away.  The raster hook is in the container
 *      and the TMA measured its calls.
 *
 * Written by @design because the card names this evidence.  Per workshop
 * rule 2 a cold break by another seat and model is owed: the operand
 * encoding, the loop arithmetic, the closure copies, the timer
 * reconstruction and the browser glue are what to attack.  #171's part has
 * its own targets: follow a site's value through a `move`, through a
 * table-typed global's every getglobal, containment taint (a pair stored in
 * a cram field), the setlist/constant-key/register-key capacity order, and
 * the chunk/init/back-edge repeat rule.
 */
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const zlib = require("zlib");
const { spawnSync } = require("child_process");

const il = require("../renderer/pce-il.js");
const ilbc = require("../renderer/pce-ilbc.js");
const romLib = require("../renderer/pce-rom.js");
const toys = require("../renderer/pce-toys.js");

const ROOT = path.join(__dirname, "..");
const ILVM = path.join(ROOT, "renderer", "ilvm.bin");
const LLVM_DEFAULT = "/Volumes/External II/pce-tools/llvm-mos/llvm-mos";

const PALETTE = { name: "toypalette-ilvm", toy: "tools/toys/palette.lua",
                  period: 8, phase: 8, minMeanTicks: 127 };
const PARALLAX = { name: "toyparallax-ilvm", toy: "toys/parallax.lua",
                   period: 0, phase: 8 };
/* #115: #29's status-bar toy on the same interpreter — the RCR-split case
 * (two register writes at line 24).  Its fixed bar is asserted; the
 * playfield's known four-line phase is recorded, not hidden. */
const STATUS = { name: "toystatusbar-ilvm", toy: "toys/status-bar.lua" };

let checks = 0;
let failures = [];
let skipped = [];
let notes = [];

function check(ok, name) {
  checks++;
  if (!ok) { failures.push(name); console.log("FAIL  " + name); }
}
function eq(name, got, want) {
  check(JSON.stringify(got) === JSON.stringify(want),
        name + " (got " + JSON.stringify(got) + ", want " +
        JSON.stringify(want) + ")");
}
function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}
function refuseCode(fn) {
  try { fn(); } catch (e) { return e && e.code; }
  return null;
}
function throws(fn) {
  try { fn(); } catch (e) { return true; }
  return false;
}

/* ---- a minimal PNG reader (8-bit RGB, non-interlaced) ----------------- */

function decodePng(buf) {
  if (buf.slice(0, 8).toString("latin1") !== "\x89PNG\r\n\x1a\n") {
    throw new Error("not a PNG");
  }
  let pos = 8, width = 0, height = 0, bitDepth = 0, colourType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.slice(pos + 4, pos + 8).toString("latin1");
    const body = buf.slice(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === "IHDR") {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4);
      bitDepth = body[8]; colourType = body[9];
    } else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
  }
  if (bitDepth !== 8 || colourType !== 2) {
    throw new Error("PNG must be 8-bit RGB");
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * 3;
  const out = Buffer.alloc(width * height * 3);
  let prev = Buffer.alloc(stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const line = Buffer.from(raw.slice(p, p + stride));
    p += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= 3 ? line[i - 3] : 0;
      const b = prev[i];
      const c = i >= 3 ? prev[i - 3] : 0;
      let v = line[i];
      if (filter === 1) v = (v + a) & 255;
      else if (filter === 2) v = (v + b) & 255;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
      line[i] = v;
    }
    out.set(line, y * stride);
    prev = line;
  }
  return { width: width, height: height, pixels: out };
}

function diff(a, b) {
  const n = Math.min(a.length, b.length);
  let count = 0;
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) count++;
  return count;
}

function sampleHash(pixels) {
  let h = 2166136261;
  for (let i = 0; i < pixels.length; i += 97) {
    h = ((h ^ pixels[i]) * 16777619) >>> 0;
  }
  return h;
}

/* ---- 1. the encoder ---------------------------------------------------- */

function encodeToy(file) {
  const source = fs.readFileSync(path.join(ROOT, file), "utf8");
  const program = il.compile(source, { chunkName: path.basename(file) });
  return ilbc.encode(program);
}

function checkEncoder() {
  const pal = encodeToy(PALETTE.toy);
  const pal2 = encodeToy(PALETTE.toy);
  const par = encodeToy(PARALLAX.toy);
  eq("the encoder is deterministic", Buffer.from(pal.bytes),
     Buffer.from(pal2.bytes));
  eq("the palette bytecode is 578 B", pal.bytes.length, 578);
  eq("the parallax bytecode is 1115 B", par.bytes.length, 1115);
  eq("the container starts with ILBC", Array.from(pal.bytes.slice(0, 4)),
     [0x49, 0x4C, 0x42, 0x43]);
  eq("version 1", pal.bytes[4], 1);
  eq("palette hook slots", pal.hooks, { init: 0, frame: 1, raster: 255 });
  eq("parallax hook slots", par.hooks, { init: 0, frame: 1, raster: 2 });
  check(pal.codeBytes > 0 && pal.codeBytes < pal.size,
        "the code section is inside the container");
  check(pal.functions === 5 && par.functions === 8,
        "the function counts are the IL's");

  /* Refusals, by code.  Each toy reaches the encoder's check without being
   * refused earlier by the IL. */
  function codeFor(source) {
    return refuseCode(function () {
      ilbc.encode(il.compile(source, { chunkName: "refusal.lua" }));
    });
  }
  /* #172: a table is carried now, so the old `ilbc-op` case is the smallest
   * table toy and it must encode as version 2. */
  const tableToy = ilbc.encode(il.compile(
    "function frame(t, f)\n  local a = {1, 2}\n  a[1] = f\nend\n",
    { chunkName: "table.lua" }));
  eq("a table is no longer ilbc-op: it encodes version 2",
     tableToy.version, 2);
  eq("the table toy has one slot and two cells",
     tableToy.tables, { nslots: 1, cells: 2 });
  eq("a fixed constant is ilbc-fixed", codeFor(
    "function frame(t, f)\n  local x = 1.5\n  pal(1, floor(x))\nend\n"),
    "ilbc-fixed");
  eq("a builtin other than rgb is ilbc-builtin", codeFor(
    "function frame(t, f)\n  pal(1, clamp(f, 0, 8))\nend\n"),
    "ilbc-builtin");
}

/* `clamp` with five arguments is an IL arity refusal, so a function with
 * five parameters is the encoder's own ilbc-arity case. */
function checkArityRefusal() {
  const source = [
    "local function five(a, b, c, d, e) return e end",
    "function frame(t, f)",
    "  pal(1, five(1, 2, 3, 4, 5))",
    "end",
    ""
  ].join("\n");
  const code = refuseCode(function () {
    ilbc.encode(il.compile(source, { chunkName: "arity.lua" }));
  });
  eq("five parameters is ilbc-arity", code, "ilbc-arity");
}

/* ---- #171: the table layout ------------------------------------------- *
 * tableLayout() reads each table's shape from its uses: one slot per `table`
 * instruction, its array capacity, the program-wide field ids written into
 * it, whether the value escapes, and whether the site can run more than
 * once.  This pins the three games' measured inventories (docs/
 * TABLES-PLAN.md §1) and two controls: a frame-built table stored in a
 * global (escaping and re-executing), and the nested cram pair, which
 * escapes only with its outer.  NOVA is pinned at the cap rule's 349 cells;
 * #177 is the card that turns its register-key sites into 183. */
function layoutToy(file) {
  const source = fs.readFileSync(path.join(ROOT, file), "utf8");
  return ilbc.tableLayout(il.compile(source, { chunkName: path.basename(file) }));
}

function checkTableLayout() {
  const star = layoutToy("toys/demo-game/main.lua");
  eq("STARFALL has 44 table sites", star.nslots, 44);
  eq("STARFALL's tables need 172 cells", star.cells, 172);
  eq("STARFALL's field cells are 126", star.fieldCells, 126);
  eq("STARFALL's array cells are 46", star.arrayCells, 46);
  check(star.sites.every(function (s, i) {
    return s.base === (i ? star.sites[i - 1].base + star.sites[i - 1].cells : 0);
  }), "STARFALL's slots are packed in site order");
  eq("STARFALL's sites fill the pool exactly",
     star.sites[star.sites.length - 1].base +
     star.sites[star.sites.length - 1].cells, star.cells);
  eq("STARFALL's field ids are first-appearance order", star.fieldIds,
     ["x", "y", "pattern", "palette", "byr", "cram"]);
  eq("the register-key array cap is 16", star.arrayCap, 16);
  eq("STARFALL's 7 escaping sites are its table globals",
     star.sites.filter(function (s) { return s.escapes; })
       .map(function (s) { return s.globals[0]; }),
     ["DIGIT", "bl", "bx", "by", "ex", "ey", "es"]);
  eq("37 STARFALL spec sites do not escape",
     star.sites.filter(function (s) {
       return !s.escapes && s.globals.length === 0;
     }).length, 37);
  check(star.sites.filter(function (s) { return s.escapes; })
        .every(function (s) { return !s.repeats; }),
        "the escaping globals are built once (chunk/init), so they cannot " +
        "re-execute");

  /* The two raster specs at main.lua:498 and :646: an outer spec writing
   * `byr` and `cram` (ids 4 and 5), a one-cell list wrapper, and the
   * two-cell pair.  The pair escapes only if the outer does; neither does,
   * because raster() copies the fields it needs. */
  const outers = star.sites.filter(function (s) {
    return s.fields.length === 2 && s.fields[0] === 4 && s.fields[1] === 5;
  });
  eq("STARFALL builds two raster outer specs", outers.length, 2);
  eq("each raster outer reserves six field cells",
     outers.map(function (s) { return s.nfields; }), [6, 6]);
  for (const outer of outers) {
    const nested = star.sites.filter(function (s) {
      return s.line === outer.line && s.cap === 2;
    });
    eq("the raster at line " + outer.line + " has a two-cell nested pair",
       nested.length, 1);
    if (nested.length === 1) {
      eq("the nested pair at line " + outer.line +
         " escapes only with its outer", nested[0].escapes, outer.escapes);
      check(!outer.escapes,
            "the raster spec at line " + outer.line + " does not escape");
    }
  }

  const tower = layoutToy("toys/tower/main.lua");
  eq("TOWER has 6 table sites", tower.nslots, 6);
  eq("TOWER's tables need 33 cells", tower.cells, 33);
  eq("TOWER has no field cells", tower.fieldCells, 0);
  eq("TOWER has no field ids", tower.fieldIds, []);
  eq("TOWER's 6 escaping sites are its table globals", tower.escaping, 6);

  const nova = layoutToy("toys/nova-tide/main.lua");
  eq("NOVA has 27 table sites", nova.nslots, 27);
  eq("NOVA at the cap rule needs 349 cells (#177: 183)", nova.cells, 349);
  eq("NOVA's array cells at the cap rule are 344", nova.arrayCells, 344);
  eq("NOVA's only field name is bxr", nova.fieldIds, ["bxr"]);
  eq("NOVA's 5 raster specs do not escape",
     nova.sites.filter(function (s) { return !s.escapes; }).length, 5);
  console.log("      table layout: STARFALL " + star.nslots + " sites/" +
              star.cells + " cells (" + star.fieldCells + " field), TOWER " +
              tower.nslots + "/" + tower.cells + ", NOVA " + nova.nslots +
              "/" + nova.cells + " at the cap rule");

  /* A table built in frame() and stored in a global: one slot could not
   * carry two Lua tables, so it is both escaping and re-executing. */
  const held = ilbc.tableLayout(il.compile([
    "held = nil",
    "function frame(t, f)",
    "  local s = {x = f}",
    "  held = s",
    "end",
    ""
  ].join("\n"), { chunkName: "held.lua" }));
  eq("a frame-built table stored in a global is one site", held.nslots, 1);
  eq("it is flagged escaping", held.sites[0].escapes, true);
  eq("it is flagged re-executing", held.sites[0].repeats, true);
  eq("it is stored in the table global `held`", held.sites[0].globals, ["held"]);

  /* The same nested cram shape, with the outer spec escaping (a call
   * argument) and not escaping (a raster spec).  The pair follows its
   * outer both ways. */
  const pairCall = ilbc.tableLayout(il.compile([
    "local function sink(spec)",
    "  spec.byr = 0",
    "end",
    "function frame(t, f)",
    "  sink({byr = 1, cram = {{0, 5}}})",
    "end",
    ""
  ].join("\n"), { chunkName: "pair-call.lua" }));
  eq("a call-passed raster spec is three sites", pairCall.nslots, 3);
  eq("their array caps are 0, 1 and 2",
     pairCall.sites.map(function (s) { return s.cap; }), [0, 1, 2]);
  check(pairCall.sites.every(function (s) { return s.escapes; }),
        "the nested pair escapes with an outer passed to a call");

  const pairRaster = ilbc.tableLayout(il.compile([
    "function frame(t, f)",
    "  raster(1, {byr = 1, cram = {{0, 5}}})",
    "end",
    ""
  ].join("\n"), { chunkName: "pair-raster.lua" }));
  eq("a raster-consumed spec is three sites", pairRaster.nslots, 3);
  check(pairRaster.sites.every(function (s) { return !s.escapes; }),
        "the nested pair does not escape when its outer is a raster spec");

  eq("tableLayout refuses a non-pce-il program",
     refuseCode(function () { ilbc.tableLayout({ lang: "x" }); }),
     "ilbc-program");
}

/* ---- #172: the version 2 container and the four table ops -------------- *
 * A toy with a table instruction gets version 2: a 28-byte header with
 * tabTabOff, a table section (u8 nslots, then per slot u16 base, u8 cap,
 * u8 nfields), and the four opcodes 0x18..0x1B.  A string key is a field id
 * (kind 1), never a value constant.  The exact bytes are pinned; STARFALL's
 * section is checked against tableLayout; the refusals have their own toys;
 * and the three committed ILVM dumps stay version 1 and byte-identical. */
function encodeSource(source) {
  return ilbc.encode(il.compile(source, { chunkName: "toy.lua" }));
}

function u16At(bytes, off) { return bytes[off] | (bytes[off + 1] << 8); }

function checkTableEncoding() {
  /* The small four-op toy and its exact container bytes.  The four ops in
   * the code section:
   *   18 02 00          table   dst r2, slot 0
   *   19 02 01 02 03 04 setlist base r2, first 1, n 2, values k3 k4
   *   1b 02 01 00 82    tset    base r2, key r1 (kind 0), value k2
   *   1a 05 02 01 00    tget    dst r5, base r2, key r1 (kind 0) */
  const toy = encodeSource([
    "function frame(t, f)",
    "  local a = {7, 8}",
    "  a[f] = 9",
    "  pal(1, a[f])",
    "end",
    ""
  ].join("\n"));
  eq("the four-op toy is container version 2", toy.version, 2);
  eq("its version 2 header is 28 bytes", u16At(toy.bytes, 12), 28);
  eq("the table section is nslots + 4 B",
     Array.from(toy.bytes.slice(u16At(toy.bytes, 20), u16At(toy.bytes, 22))),
     [1, 0, 0, 2, 0]);   /* 1 slot: base 0, cap 2, nfields 0 */
  eq("the four-op toy's exact container bytes",
     Buffer.from(toy.bytes).toString("hex"),
     "494c42430200ff00ff0202041c00300034004800520057008000000057005f" +
     "003000020001005f0080003200060201000200020000070000000008000000" +
     "00090000000001000000056672616d650370616c0100000200070001040000" +
     "09ff1802000103000104011902010203041b020100820104031a0502010014" +
     "040509ff");
  const code = Buffer.from(toy.bytes).slice(u16At(toy.bytes, 22),
                                          u16At(toy.bytes, 24));
  function at(op) { return code.indexOf(op); }
  eq("table opcode and operands", Array.from(code.slice(at(0x18), at(0x18) + 3)),
     [0x18, 0x02, 0x00]);
  eq("setlist opcode and operands",
     Array.from(code.slice(at(0x19), at(0x19) + 6)),
     [0x19, 0x02, 0x01, 0x02, 0x03, 0x04]);
  eq("tset opcode and operands",
     Array.from(code.slice(at(0x1B), at(0x1B) + 5)),
     [0x1B, 0x02, 0x01, 0x00, 0x82]);
  eq("tget opcode and operands",
     Array.from(code.slice(at(0x1A), at(0x1A) + 5)),
     [0x1A, 0x05, 0x02, 0x01, 0x00]);

  /* A string key is a field id (kind 1) and never a value constant. */
  const fieldToy = encodeSource([
    "function frame(t, f)",
    "  local s = {x = f}",
    "  pal(1, s.x)",
    "end",
    ""
  ].join("\n"));
  const fcode = Buffer.from(fieldToy.bytes).slice(u16At(fieldToy.bytes, 22),
                                                 u16At(fieldToy.bytes, 24));
  const ti = fcode.indexOf(0x1B);
  eq("a string key encodes kind 1 and its field id",
     Array.from(fcode.slice(ti, ti + 5)), [0x1B, 0x02, 0x00, 0x01, 0x01]);
  const gi = fcode.indexOf(0x1A);
  eq("a string read encodes kind 1 too",
     Array.from(fcode.slice(gi, gi + 5)), [0x1A, 0x05, 0x02, 0x00, 0x01]);
  check(Buffer.from(fieldToy.bytes).toString("latin1").indexOf("x") < 0,
        "the string key `x` is not in the value constant pool");
  eq("the field toy's table section has one field cell",
     Array.from(fieldToy.bytes.slice(u16At(fieldToy.bytes, 20),
                                     u16At(fieldToy.bytes, 22))),
     [1, 0, 0, 0, 1]);

  /* STARFALL's table section against tableLayout(): 44 slots, 172 cells, in
   * site order.  STARFALL still cannot encode (sprite/pad/sfx are not
   * carried), so the section is built directly by the encoder's own
   * builder — the bytes encode() writes. */
  const starProg = il.compile(
    fs.readFileSync(path.join(ROOT, "toys/demo-game/main.lua"), "utf8"),
    { chunkName: "main.lua" });
  const starLayout = ilbc.tableLayout(starProg);
  const starSection = ilbc.buildTableSection(starProg, starLayout);
  eq("STARFALL's section declares 44 slots", starSection.bytes[0], 44);
  eq("STARFALL's section is 1 + 4 x 44 bytes",
     starSection.bytes.length, 1 + 4 * 44);
  let packed = true, cells = 0;
  for (let i = 0; i < starLayout.sites.length; i++) {
    const s = starLayout.sites[i], at = 1 + 4 * i;
    packed = packed &&
      u16At(starSection.bytes, at) === s.base &&
      starSection.bytes[at + 2] === s.cap &&
      starSection.bytes[at + 3] === s.nfields &&
      s.base === cells;
    cells += s.nfields + s.cap;
  }
  check(packed, "STARFALL's slots carry tableLayout's base/cap/nfields in " +
        "site order");
  eq("STARFALL's section covers its 172 cells", cells, 172);
  eq("the builder agrees with the layout", starSection.cells,
     starLayout.cells);

  /* Refusals on their own toys. */
  eq("a constant key past the array is ilbc-table-ram", refuseCode(
    function () {
      ilbc.encode(il.compile(
        "function frame(t, f)\n  local a = {1, 2}\n  a[9] = 1\nend\n",
        { chunkName: "ram.lua" }));
    }), "ilbc-table-ram");
  eq("an escaping re-executing table is ilbc-table-escape", refuseCode(
    function () {
      ilbc.encode(il.compile([
        "held = nil",
        "function frame(t, f)",
        "  local s = {x = f}",
        "  held = s",
        "end",
        ""
      ].join("\n"), { chunkName: "escape.lua" }));
    }), "ilbc-table-escape");
  eq("a table key that is not a string or int operand is ilbc-table-key",
     refuseCode(function () {
       const p = il.compile(
         "function frame(t, f)\n  local a = {1, 2}\n  a[1] = 1\nend\n",
         { chunkName: "key.lua" });
       const fn = p.functions.filter(function (x) {
         return x.code.some(function (i) { return i.t === "tset"; });
       })[0];
       fn.code.filter(function (i) { return i.t === "tset"; })[0].key =
         { k: { t: "bool", v: true } };
       ilbc.encode(p);
     }), "ilbc-table-key");
  const big = new Array(300).fill("0").join(", ");
  eq("a table past 255 array cells is ilbc-range", refuseCode(function () {
    ilbc.encode(il.compile(
      "function frame(t, f)\n  local a = {" + big + "}\n  pal(1, a[1])\n" +
      "end\n", { chunkName: "big.lua" }));
  }), "ilbc-range");

  /* The three committed ILVM dumps stay version 1 and byte-identical. */
  for (const spec of [PALETTE, PARALLAX, STATUS]) {
    const enc = encodeToy(spec.toy);
    eq(spec.name + " stays container version 1", enc.version, 1);
    const meta = JSON.parse(fs.readFileSync(
      path.join(ROOT, "tests", "dumps", spec.name, "meta.json"), "utf8"));
    const rom = romLib.buildToyRom({
      bank0: fs.readFileSync(ILVM), bytecode: enc.bytes });
    eq(spec.name + "'s ROM is still the committed one",
       sha256(Buffer.from(rom)), meta.rom_sha256);
  }
}

/* ---- 2. the browser glue ---------------------------------------------- */


function checkRom() {
  const bank0 = fs.readFileSync(ILVM);
  eq("renderer/ilvm.bin is 16 KiB (two instructions banks plus data)",
     bank0.length, 16384);
  const enc = encodeToy(PALETTE.toy);
  const rom = romLib.buildToyRom({ bank0: bank0, bytecode: enc.bytes });
  eq("buildToyRom is 24,576 B (16 KiB image + one data bank)",
     rom.length, 24576);
  check(Buffer.from(rom.slice(0, 16384)).equals(bank0),
        "the image is the ROM's first 16 KiB");
  eq("the data bank starts with ILBC", Array.from(rom.slice(16384, 16388)),
     [0x49, 0x4C, 0x42, 0x43]);
  check(Buffer.from(rom.slice(16384, 16384 + enc.bytes.length))
        .equals(Buffer.from(enc.bytes)),
        "the bytecode is at physical bank 2, offset 0");
  eq("the rest of the data bank is 0xFF padding",
     rom[16384 + enc.bytes.length], 0xFF);

  /* The browser path: the same files with `self`, no `module`, exactly the
   * branch a <script> in the studio page runs. */
  const sandbox = { self: {}, console: console };
  sandbox.self.window = sandbox.self;
  vm.createContext(sandbox);
  for (const f of ["renderer/pce-ilbc.js", "renderer/pce-rom.js"]) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), sandbox,
                    { filename: f });
  }
  const enc2 = sandbox.self.PCEStudio.ilbc.encode(
    il.compile(fs.readFileSync(path.join(ROOT, PALETTE.toy), "utf8"),
               { chunkName: "palette.lua" }));
  const rom2 = sandbox.self.PCEStudio.rom.buildToyRom(
    { bank0: new Uint8Array(bank0), bytecode: new Uint8Array(enc2.bytes) });
  eq("Node and the browser context build the same ROM bytes",
     sha256(Buffer.from(rom2)), sha256(Buffer.from(rom)));

  check(throws(function () {
    romLib.buildToyRom({ bank0: bank0.slice(0, 8192), bytecode: enc.bytes });
  }), "a short image is refused");
  check(throws(function () {
    romLib.buildToyRom({ bank0: bank0, bytecode: enc.bytes.slice(0, 10) });
  }), "a malformed container is refused");
  check(throws(function () {
    romLib.buildToyRom({ bank0: bank0, bytecode: new Uint8Array(9000) });
  }), "a container past one bank is refused");
}

/* ---- 3. the committed image rebuilds ---------------------------------- */

function checkRebuild() {
  const llvm = process.env.LLVM_MOS || LLVM_DEFAULT;
  if (!fs.existsSync(path.join(llvm, "bin", "mos-pce-clang"))) {
    skipped.push("ilvm.bin rebuild (llvm-mos not found at " + llvm + ")");
    console.log("SKIP  ilvm.bin rebuild: llvm-mos not found at " + llvm);
    return;
  }
  /* build.sh writes renderer/ilvm.bin; keep the committed file safe so a
   * differing toolchain reports FAIL without changing the tree. */
  const committed = fs.readFileSync(ILVM);
  const r = spawnSync(path.join(ROOT, "tools", "ilvm", "build.sh"), [],
                      { cwd: ROOT, encoding: "utf8", env: process.env });
  const rebuilt = fs.existsSync(ILVM) ? fs.readFileSync(ILVM) : null;
  fs.writeFileSync(ILVM, committed);
  check(r.status === 0, "tools/ilvm/build.sh exits 0 (" +
        (r.stderr || "").trim().split("\n").slice(-1)[0] + ")");
  if (r.status !== 0 || !rebuilt) return;
  eq("the rebuilt image is the committed renderer/ilvm.bin",
     sha256(rebuilt), sha256(committed));
  eq("the image is two physical banks", rebuilt.length, 16384);
  const report = JSON.parse(fs.readFileSync(
    path.join(ROOT, "tools", "gen", "ilvm.json"), "utf8"));
  eq("the build report's sha is the committed image", report.sha256,
     sha256(committed));
}

/* ---- 4. the dumps ----------------------------------------------------- */

function emitFresh(toy, outPce) {
  const r = spawnSync(process.execPath,
    [path.join(ROOT, "tools", "ilvm", "emit.js"), toy, outPce,
     path.basename(toy, ".lua")],
    { cwd: ROOT, encoding: "utf8" });
  check(r.status === 0, "tools/ilvm/emit.js " + toy + " exits 0 (" +
        (r.stderr || "").trim().split("\n").slice(-1)[0] + ")");
  return r.status === 0;
}

/* Match a capture's last frames against the browser's run.  `period` 0 means
 * the picture does not repeat: match any browser frame in 0..maxF. */
function checkDump(spec, maxF, tail) {
  const dir = path.join(ROOT, "tests", "dumps", spec.name);
  if (!fs.existsSync(path.join(dir, "meta.json"))) {
    check(false, "tests/dumps/" + spec.name +
          "/meta.json exists (run tools/capture-ilvm.sh " + spec.name + ")");
    return;
  }
  const meta = JSON.parse(fs.readFileSync(path.join(dir, "meta.json"),
                                          "utf8"));
  const toyPath = path.join(ROOT, spec.toy);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ilvm-"));
  const fresh = path.join(tmp, "fresh.pce");
  if (emitFresh(spec.toy, fresh)) {
    eq(spec.name + ": a fresh browser-path build is the dumped ROM",
       sha256(fs.readFileSync(fresh)), meta.rom_sha256);
    eq(spec.name + ": the ROM is 24,576 B", fs.statSync(fresh).size, 24576);
  }

  const browser = toys.create(fs.readFileSync(toyPath, "utf8"),
                              { budgetMs: 1000 });
  browser.load();
  const wantPixels = [], wantHashes = [], wantState = [];
  for (let f = 0; f < maxF; f++) {
    const g = browser.frame(f);
    wantPixels.push(g.pixels);
    wantHashes.push(sampleHash(g.pixels));
    wantState.push({ vram: g.state.vram, cram: g.state.cram });
  }
  browser.dispose();

  const frameDir = path.join(dir, "frames");
  if (!fs.existsSync(frameDir)) {
    check(false, spec.name + ": tests/dumps/" + spec.name +
          "/frames exists (run tools/capture-ilvm.sh " + spec.name + ")");
    return;
  }
  const files = fs.readdirSync(frameDir)
    .filter(function (f) { return /^frame\d+\.png$/.test(f); }).sort();
  check(files.length > 100, spec.name + " has more than 100 recorded frames (" +
        files.length + ")");
  const use = files.slice(-Math.min(tail, files.length));
  const matched = [];
  let unmatched = 0;
  for (const f of use) {
    const img = decodePng(fs.readFileSync(path.join(frameDir, f)));
    const h = sampleHash(img.pixels);
    let found = -1;
    for (let k = 0; k < maxF; k++) {
      if (wantHashes[k] === h && diff(img.pixels, wantPixels[k]) === 0) {
        found = k;
        break;
      }
    }
    if (found < 0) unmatched++;
    else matched.push(found);
  }
  check(matched.length > 0, spec.name + ": a captured frame is diff 0 " +
        "against the browser's run");
  if (unmatched) {
    notes.push(spec.name + ": " + unmatched + " of the last " + tail +
               " frames are compute/boot frames (static, no browser match)");
  }

  /* A run of eight consecutive browser frames in order.  The capture may
   * repeat a picture while the toy computes the next one (palette) or hold
   * one while the raster table is built (parallax), so repeats are allowed
   * but the browser frames must advance by one. */
  let best = 0, cur = 0, prev = null, bestEnd = -1;
  for (let i = 0; i < matched.length; i++) {
    if (prev === null) cur = 1;
    else if (matched[i] === prev) cur = cur;
    else if (matched[i] === prev + 1) cur++;
    else cur = 1;
    if (cur > best) { best = cur; bestEnd = i; }
    prev = matched[i];
  }
  check(best >= spec.phase, spec.name + ": " + best +
        " consecutive browser frames are present in order (need " +
        spec.phase + ")");

  /* The save's VRAM and CRAM are the browser's at the matched frame.  The
   * save follows the display, so a frame or two on is allowed. */
  const vram = fs.readFileSync(path.join(dir, "vram.bin"));
  const cram = fs.readFileSync(path.join(dir, "cram.bin"));
  let stateOk = false;
  for (let k = 0; k < maxF; k++) {
    if (diff(vram, wantState[k].vram) === 0 &&
        diff(cram, wantState[k].cram) === 0) {
      stateOk = true;
      notes.push(spec.name + ": the save's vram/cram are browser frame " +
                 k + "'s");
      break;
    }
  }
  check(stateOk, spec.name + ": the saved VRAM and CRAM are the browser's");
}

function checkMeasure(spec) {
  const meta = JSON.parse(fs.readFileSync(
    path.join(ROOT, "tests", "dumps", spec.name, "meta.json"), "utf8"));
  const m = meta.capture.measure;
  check(m.count > 5, spec.name + ": the TMA measured more than five frames");
  check(m.flags === 0, spec.name + ": no raster/base list overflowed");
  check(m.cycles_per_frame > 0, spec.name + ": cycles per frame is positive");
  /* A frame() longer than one video frame is reconstructed from the TMA
   * counter's phase at the last VBlank (§14.5).  The counter is seven bits,
   * so a read that forgot the phase cannot exceed 127 ticks.  Rule 2's cold
   * break re-applied exactly that stale read and recaptured: 30,510
   * cycles/frame passed every other assertion, so this bound is the guard. */
  if (spec.minMeanTicks) {
    check(m.mean_ticks > spec.minMeanTicks,
          spec.name + ": frame() spans more than one video frame (" +
          m.mean_ticks.toFixed(2) + " TMA ticks, need > " +
          spec.minMeanTicks + "; a 7-bit-only read cannot exceed 127)");
  }
  console.log("      " + spec.name + ": frame() " +
              Math.round(m.cycles_per_frame) + " cycles (" +
              m.mean_ticks.toFixed(2) + " TMA ticks, min " + m.min_ticks +
              "), " + m.count + " frames");
  if (m.raster_calls) {
    console.log("      " + spec.name + ": raster() " +
                Math.round(m.cycles_per_raster_call) + " cycles/call, " +
                Math.round(m.cycles_per_collection) +
                " cycles/collection, " + m.raster_calls + " calls");
    check(m.cycles_per_raster_call > 0,
          spec.name + ": cycles per raster call is positive");
    check(m.cycles_per_collection > m.cycles_per_raster_call,
          spec.name + ": a collection costs more than one call");
  }
}

/* ---- #115: the status-bar toy, the RCR-split raster case ---------------- *
 * The bar is 24 fixed lines over a scrolling playfield, so the table has
 * entries at lines 0 and 24 (two registers each).  The console picture's
 * playfield is four lines out of phase with the browser — the same known
 * #31C handler limitation docs/IL.md §10.4 records for the compiled route,
 * carried by the shared runtime — so this check does not pretend a whole
 * frame matches.  What it proves: the toy's raster callback is in the
 * container, the interpreter's 224 calls fill the table, the handler
 * replays it, and the part the toy exists for (rows 0-23 not moving) is
 * exactly the browser's. */
function barHash(pixels) {
  let h = 2166136261;
  for (let y = 0; y < 24; y++) {
    for (let x = 0; x < 256; x++) {
      const i = (y * 256 + x) * 3;
      h = ((h ^ pixels[i]) * 16777619) >>> 0;
      h = ((h ^ pixels[i + 1]) * 16777619) >>> 0;
      h = ((h ^ pixels[i + 2]) * 16777619) >>> 0;
    }
  }
  return h;
}

function checkStatusBarDump() {
  const dir = path.join(ROOT, "tests", "dumps", STATUS.name);
  const metaPath = path.join(dir, "meta.json");
  if (!fs.existsSync(metaPath)) {
    check(false, "tests/dumps/" + STATUS.name +
          "/meta.json exists (run tools/capture-ilvm.sh " + STATUS.name + ")");
    return;
  }
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  eq("status-bar's capture is toys/status-bar.lua", meta.source, STATUS.toy);
  eq("status-bar's container carries the raster callback",
     meta.bytecode.hooks.raster, 2);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ilvm-bar-"));
  const fresh = path.join(tmp, "fresh.pce");
  if (emitFresh(STATUS.toy, fresh)) {
    eq("status-bar: a fresh browser-path build is the dumped ROM",
       sha256(fs.readFileSync(fresh)), meta.rom_sha256);
    eq("status-bar: the ROM is 24,576 B", fs.statSync(fresh).size, 24576);
  }

  const browser = toys.create(fs.readFileSync(path.join(ROOT, STATUS.toy),
                                              "utf8"), { budgetMs: 1000 });
  browser.load();
  const maxF = 240;
  const wantPixels = [], wantBars = [], wantState = [];
  for (let f = 0; f < maxF; f++) {
    const g = browser.frame(f);
    wantPixels.push(g.pixels);
    wantBars.push(barHash(g.pixels));
    wantState.push({ vram: g.state.vram, cram: g.state.cram });
  }
  browser.dispose();

  const frameDir = path.join(dir, "frames");
  const files = fs.readdirSync(frameDir)
    .filter(function (f) { return /^frame\d+\.png$/.test(f); }).sort();
  check(files.length > 100, "status-bar has more than 100 recorded frames (" +
        files.length + ")");
  const use = files.slice(-300);
  let hit = null;
  for (const f of use) {
    const img = decodePng(fs.readFileSync(path.join(frameDir, f)));
    const h = barHash(img.pixels);
    /* the bar's blink repeats every 60 frames, so every candidate must be
     * tried on the whole picture, not just the first hash match */
    const candidates = [];
    for (let k = 0; k < maxF; k++) if (wantBars[k] === h) candidates.push(k);
    if (!candidates.length) continue;
    let bestK = -1, bestDiff = Infinity;
    for (const k of candidates) {
      const d = diff(img.pixels, wantPixels[k]);
      if (d < bestDiff) { bestDiff = d; bestK = k; }
    }
    hit = { file: f, img: img, k: bestK, whole: bestDiff };
    break;
  }
  check(!!hit, "status-bar: a captured frame's bar (rows 0-23) hashes to a " +
        "browser frame's");
  if (hit) {
    check(diff(hit.img.pixels.slice(0, 24 * 256 * 3),
               wantPixels[hit.k].slice(0, 24 * 256 * 3)) === 0,
          "status-bar: the fixed bar is diff 0 against browser frame " + hit.k);
    notes.push("status-bar: the playfield is " + hit.whole + " bytes off " +
               "the closest browser frame with the same bar (frame " + hit.k +
               "), the #31C handler's four-line phase (docs/IL.md §10.4); " +
               "rows 0-23 are exact");
  }

  /* the save's VRAM is the toy's static init, and one blink state's CRAM */
  const vram = fs.readFileSync(path.join(dir, "vram.bin"));
  const cram = fs.readFileSync(path.join(dir, "cram.bin"));
  check(diff(vram, wantState[0].vram) === 0,
        "status-bar: the saved VRAM is the browser's");
  let cramOk = false, cramFrame = -1;
  for (let k = 0; k < maxF; k++) {
    if (diff(cram, wantState[k].cram) === 0) { cramOk = true; cramFrame = k;
                                               break; }
  }
  check(cramOk, "status-bar: the saved CRAM is a browser frame's blink state");
  if (cramOk) notes.push("status-bar: the save's CRAM is browser frame " +
                        cramFrame + "'s");
  checkMeasure(STATUS);
}

/* ---- run -------------------------------------------------------------- */

console.log("check-ilvm: #100 the IL as bytecode, interpreted");

checkEncoder();
checkArityRefusal();
checkTableLayout();
checkTableEncoding();
checkRom();
checkRebuild();

const paletteMax = 300;
checkDump(PALETTE, paletteMax, 96);
checkMeasure(PALETTE);
/* The palette picture repeats every eight frames; the tail of 96 frames is
 * plenty of toy frames at ~3 video frames each. */

const parallaxMax = 400;
checkDump(PARALLAX, parallaxMax, 500);
checkMeasure(PARALLAX);

/* #115: the RCR-split toy on the same interpreter */
checkStatusBarDump();

for (const n of notes) console.log("note  " + n);
if (skipped.length) {
  console.log("skipped: " + skipped.join("; "));
}
if (failures.length) {
  console.log("FAIL " + failures.length + " of " + checks + " checks");
  process.exit(1);
}
console.log("PASS " + checks + " checks");
