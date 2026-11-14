#!/usr/bin/env node
/*
 * tests/check-banked-data.js — #279's evidence: container version 4 and the
 * banked toy builder (docs/BANKED-DATA.md §5.2).
 *
 *   node tests/check-banked-data.js
 *
 * WHAT IS CHECKED
 *
 *   1. The rule that keeps every existing ROM byte-identical: the encoder
 *      writes version 4 only when the tables and code together do not fit one
 *      data bank's 8,160 usable bytes.  Seven committed toys' container shas
 *      are pinned here at their pre-#279 values (captured from HEAD), and the
 *      v1-v3 builder output is compared with a hand-laid data bank (image,
 *      container, 0xFF padding, the zeroed song trailer at 8,160) — so a
 *      changed padding byte or trailer position fails.
 *   2. A v4 container's shape: whole 8 KiB banks, the tables bank first, the
 *      bank count in header bytes 26-27, every function entry's reserved byte
 *      (offset 9) naming its code bank and its codeOff/codeEnd bank-relative
 *      and below 8,160, and a zeroed 32-byte trailer in every bank.  TOWER's
 *      pre-rework source (the 8,524 B program docs/BANKED-DATA.md measured,
 *      copied outside the repo by #272) is the witness: 2 banks, 16,384 B of
 *      container, a 49,152 B ROM.  That file is not in the repo, so the check
 *      SKIPs when it is absent (the art rule's pattern); a synthetic two-code-
 *      bank fixture always runs.
 *   3. The refusals are named: a function larger than a code bank
 *      (toy-function-too-big, naming the id and byte count), a jump at the
 *      usable edge (toy-bank-edge), tables over a bank (toy-tables-bank-full),
 *      a v1-v3 container over 8,160 B (toy-data-bank-full — finding F1's
 *      8,160/8,192 fix, with 8,160 accepted), and a malformed v4 bank count.
 *   4. The browser path (both files with `self`, no module) builds the same
 *      v4 bytes Node does.
 *   5. The nine cold breaks #285's rule-2 pass found (2026-11-04, a different
 *      seat and model): the code payload's place and stream, every jump
 *      target's bank-relative range and boundary, pinned v4 container shas,
 *      the header's tabTabOff, the fit/packing/tables exact-8,160 edges, the
 *      124-bank toy-rom-full refusal, and the builder's per-bank trailer
 *      re-zero.  Each check's name carries its break number, v4 (1)..(9).
 *   6. The rule-2 re-break of those nine, plus four breaks of this seat's
 *      own (2026-11-13, seat test-PCEStudio-1113-125559, deepseek-v4-pro — a
 *      different seat and model from #285's).  Re-broken red: the entry's
 *      codeOff one off its payload's place, every jump target +1, the v4
 *      fill byte 0xAA, tabTabOff and the bank count swapped in the header,
 *      the fit threshold -1, the packing rule >=, the encoder's toy-rom-full
 *      guard removed (a 124-bank program encoded), the tables edge >=, the
 *      builder's trailer re-zero loop from bank 1, the encoder's trailer
 *      zeroing skipping the tables bank, the header's bank count +1, and an
 *      upvalue kind/index swap (caught by the always-run pins: the table
 *      fixture and the seven v1-v3 toys carry upvalues).  Four stayed green
 *      and became checks v4 (10)..(12): the 123-code-bank acceptance edge and
 *      the builder's own toy-rom-full guard, an asset tail one byte early on
 *      both the v4 and the v1-3 path (the tail's first byte alone was
 *      probed), and the fit decision ignoring the table section of a
 *      table-bearing toy.
 * Rule 2 applies to checks v4 (10)..(12) as it did to (1)..(9): a different
 * seat and model must re-break them (and the check catch every break).
 *
 * NOT PROVEN HERE: this suite does not boot a banked ROM.  Since #280 the
 * interpreter does read v4 (boot maps MPR3 to the tables bank and MPR2 per
 * call); its boot and picture evidence is in docs/BANKED-DATA.md §5.7
 * (host-vs-browser parity and a Mednafen save-state diff), not in this file.
 * RULE 2, SECOND PASS (2026-11-13, @test seat test-PCEStudio-1113-125629,
 * deepseek-flash — a different session from the 2026-11-04 author): each of
 * the nine breaks below was applied alone to renderer/pce-ilbc.js or
 * renderer/pce-rom.js in a $TMPDIR copy of HEAD, and the unmodified suite
 * caught all nine with its named v4 (k) FAIL (that break's own named-group
 * counts 98/864/4/2/1/3/1/1/4; every run exit 1; breaks 1, 2 and 4 also move
 * the v4 (3) sha pins, which is expected because they change container
 * bytes).  Against the merged suite (1,639 checks, the seat 125559 pass's
 * v4 (10)..(12) included) the control is 0 failed with the pre-#280
 * renderer/ilvm.bin; on HEAD's own blob its only reds are #282's three
 * single-bank ROM pins, none of them a v4 line.  NOT PROVEN by that pass:
 * the v4 (3) shas are captured from the encoder itself, so a byte already
 * wrong when the pin was taken stays pinned — only (1), (2) and (4) read
 * their bytes back independently; and no check here boots a v4 ROM (above).
 *
 * FOUND WHILE WRITING THEM (2026-11-04, @test): the banked encode path called
 * encodeFunction with codeOff 0 (renderer/pce-ilbc.js, the out.set loop), so
 * a function whose codeOff is nonzero emitted every jump target as its
 * function-relative offset, not the bank-relative offset the format promises
 * (pce-ilbc.js's own v4 comment, docs/BANKED-DATA.md §5.2/§5.6,
 * docs/IL.md §14.1: "codeOff/codeEnd and every jump target are offsets
 * inside that bank").  TOWER's functions in banks past the first tripped the
 * v4 (2) checks: e.g. function 43's jmp at bank offset 7,159 targets 312
 * instead of 7,193 (codeOff 6,881 + 312) — and the interpreter's untouched
 * jump handling (tools/ilvm/ilvm.c: pc = rw(pc)) with its per-instruction
 * range check would fault on it.  Fixed by #286: the banked path passes
 * fnCodeOff[f] as codeOff, so target() and its edge guard are bank-relative;
 * TOWER's v4 (3) pin moved with the corrected operands.  The 2026-11-13
 * re-break (above) caught every one of the nine; the check is not owed.
 */
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const il = require("../renderer/pce-il.js");
const ilbc = require("../renderer/pce-ilbc.js");
const romLib = require("../renderer/pce-rom.js");

const ROOT = path.join(__dirname, "..");
const ILVM = path.join(ROOT, "renderer", "ilvm.bin");
const BANK = 8192;
const USABLE = 8160;                 /* 0x1FE0, pce-rom.js's SONG_TABLE_OFF */
const toolPaths = require(path.join(ROOT, "tools", "tool-paths.js"));
/* $PCESTUDIO_ORIGINAL_TOWER, else the copy kept on External II (#295). */
const ORIGINAL_TOWER = toolPaths.originalTower();

let checks = 0, failed = 0;
const skipped = [];

function eq(what, got, want) {
  checks++;
  if (got !== want) {
    failed++;
    console.log("FAIL  " + what + ": got " + JSON.stringify(got) +
                ", want " + JSON.stringify(want));
  }
}
function check(ok, what) {
  checks++;
  if (!ok) { failed++; console.log("FAIL  " + what); }
}
function sha(b) {
  return crypto.createHash("sha256").update(Buffer.from(b)).digest("hex");
}
function refuseCode(fn) {
  try { fn(); } catch (e) { return (e && e.code) || (e && e.name) || "error"; }
  return null;
}
function refuseMessage(fn) {
  try { fn(); } catch (e) { return (e && e.message) || ""; }
  return "";
}
function encodeToy(file) {
  return ilbc.encode(il.compile(fs.readFileSync(path.join(ROOT, file), "utf8"),
                                { chunkName: path.basename(file) }));
}
function u16(b, at) { return b[at] | (b[at + 1] << 8); }
function fnEntry(bytes, i) {
  const at = u16(bytes, 12) + i * 10;
  return { codeOff: u16(bytes, at), codeEnd: u16(bytes, at + 2),
           upOff: u16(bytes, at + 4), nregs: bytes[at + 6],
           nparams: bytes[at + 7], nups: bytes[at + 8], bank: bytes[at + 9] };
}
/* A hand-built IL program, the shape renderer/pce-il.js produces: one
 * `frame` hook, one global slot for it, and whatever instructions the test
 * needs.  No Lua front end is involved. */
function program(code, globals, hookFid) {
  return {
    lang: "pce-il", version: 1,
    globals: globals || [{ name: "frame" }],
    hooks: { frame: hookFid == null ? 0 : hookFid },
    functions: code.map(function (c, i) {
      return { name: i === 0 ? "frame" : "f" + i, params: [], registers: 1,
               upvalues: [], code: c };
    })
  };
}
function consts(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ t: "const", dst: { r: 0 }, k: { t: "int", v: 0 }, line: 1 });
  }
  return out;
}

/* ---- 1. every single-bank toy keeps its bytes -------------------------- */

/* Captured from HEAD (708cf30) before the change: version, container length,
 * sha256.  These are the "a single-bank toy's container bytes are unchanged"
 * and "a v1-3 container's bytes are unchanged" pins. */
const UNCHANGED = [
  ["tools/toys/palette.lua", 1, 578,
   "3eca0d1d4fe0b1b79aae57d82bc784e608f2b9165c6291a5322230336f5efa93"],
  ["toys/palette-cycle.lua", 1, 862,
   "0bf7f46e2fdd4eb78c3201670560d35f0dff1a5e2a49eaf5253b14e68273e8c2"],
  ["toys/parallax.lua", 1, 1115,
   "7ab5404025a7cf796b97e9c215becb4359e0872d371d32c0f3a3129c18466efb"],
  ["toys/status-bar.lua", 1, 1369,
   "da128302c6233e0cdc23087036df829a86c157b42750288318bd092b9454134c"],
  ["toys/platformer/main.lua", 1, 2522,
   "337618a0eba40750b74d7c09d973f7a36c3a4e1f9b968fd198722e556c751de3"],
  /* v3: the table section and/or the sound ops */
  ["toys/dusk-run/main.lua", 3, 7470,
   "136b1e4b4eb79cf692f4198d60fe67a44194488a06adca0970ca51544dbbf5e9"],
  ["toys/demo-game/main.lua", 3, 6285,
   "05f1d7a347a7706b7932a6f48c2a6c8df5fdfefecd736d70900f143c26b04f6e"],
  ["toys/tower/main.lua", 3, 7862,
   "d92451db1fbc952bbf02d3d04a67e4e64de976c49a6ddc5be52541971d092290"]
];

function checkUnchanged() {
  for (const [file, ver, size, pin] of UNCHANGED) {
    let enc;
    try {
      enc = encodeToy(file);
    } catch (e) {
      checks++; failed++;
      console.log("FAIL  " + file + " does not encode: " + (e.code || e));
      continue;
    }
    eq(file + " stays container version " + ver, enc.version, ver);
    eq(file + " container is still " + size + " B", enc.bytes.length, size);
    eq(file + " container sha is HEAD's", sha(enc.bytes), pin);
    eq(file + " is not banked", enc.banked, false);
  }

  const bank0 = fs.readFileSync(ILVM);
  for (const [file, ver, size] of UNCHANGED) {
    const enc = encodeToy(file);
    if (enc.bytes.length > USABLE) continue;
    const rom = romLib.buildToyRom({ bank0: bank0, bytecode: enc.bytes });
    const want = new Uint8Array(40960);
    want.fill(0xFF);
    want.set(bank0, 0);
    want.set(enc.bytes, 32768);
    want[32768 + USABLE] = 0;               /* the song trailer */
    eq(file + " builds the same five-bank ROM bytes (v" + ver + ")",
       sha(rom), sha(want));
  }

  /* The whole-dump ROM shas (the strongest end-to-end statement: the encoder
   * and builder together still make the committed ROMs). */
  for (const [file, dump] of [["tools/toys/palette.lua", "toypalette-ilvm"],
                              ["toys/parallax.lua", "toyparallax-ilvm"],
                              ["toys/status-bar.lua", "toystatusbar-ilvm"]]) {
    const meta = JSON.parse(fs.readFileSync(
      path.join(ROOT, "tests", "dumps", dump, "meta.json"), "utf8"));
    const rom = romLib.buildToyRom({ bank0: bank0,
                                     bytecode: encodeToy(file).bytes });
    eq(file + "'s ROM is the committed " + dump + " ROM",
       sha(rom), meta.rom_sha256);
  }
}

/* ---- 2. the v4 shape --------------------------------------------------- */

function checkContainer(bytes, wantBanks, label) {
  eq(label + ": container magic", String.fromCharCode.apply(
    null, Array.from(bytes.slice(0, 4))), "ILBC");
  eq(label + ": container version", bytes[4], 4);
  eq(label + ": container is whole banks", bytes.length % BANK, 0);
  eq(label + ": header names " + wantBanks + " code bank(s)",
     u16(bytes, 26), wantBanks);
  eq(label + ": container is " + (1 + wantBanks) + " banks",
     bytes.length, (1 + wantBanks) * BANK);
  eq(label + ": header codeOff is 0 (entries carry the bounds)",
     u16(bytes, 22), 0);
  eq(label + ": header codeEnd is 0", u16(bytes, 24), 0);

  const nfunc = bytes[9];
  const seen = new Set();
  for (let i = 0; i < nfunc; i++) {
    const f = fnEntry(bytes, i);
    seen.add(f.bank);
    check(f.bank >= 1 && f.bank <= wantBanks,
          label + ": function " + i + "'s bank byte is 1.." + wantBanks +
          " (got " + f.bank + ")");
    check(f.codeOff <= f.codeEnd && f.codeEnd <= USABLE,
          label + ": function " + i + " is whole inside its bank (" +
          f.codeOff + ".." + f.codeEnd + ", usable " + USABLE + ")");
  }
  check(seen.size === wantBanks,
        label + ": every code bank holds at least one function (" +
        Array.from(seen).sort() + ")");

  for (let b = 0; b <= wantBanks; b++) {
    eq(label + ": bank " + b + " carries the zeroed song trailer",
       bytes[b * BANK + USABLE], 0);
  }

  let rom;
  try {
    rom = romLib.buildToyRom({
      bank0: fs.readFileSync(ILVM), bytecode: bytes });
  } catch (e) {
    rom = null;
    eq(label + ": the builder takes the container",
       (e && e.code) || (e && e.name) || "error", null);
  }
  if (rom) {
    eq(label + ": ROM bytes", rom.length, 32768 + (1 + wantBanks) * BANK);
  }
}

function checkVanillaFixture() {
  /* Two functions that cannot share one bank: 4,998 B each. */
  const enc = ilbc.encode(program([consts(1666), consts(1666)],
                                  [{ name: "frame" }, { name: "f1" }]));
  eq("a two-function fixture is version 4", enc.version, 4);
  eq("it has two code banks", enc.codeBanks, 2);
  checkContainer(enc.bytes, 2, "two-code-bank fixture");
  eq("function 0 is in bank 1", fnEntry(enc.bytes, 0).bank, 1);
  eq("function 1 is in bank 2", fnEntry(enc.bytes, 1).bank, 2);
  eq("function 0 starts bank 1 at 0", fnEntry(enc.bytes, 0).codeOff, 0);
  eq("function 1 starts bank 2 at 0", fnEntry(enc.bytes, 1).codeOff, 0);

  /* Packing: a full-ish first function pushes the rest to bank 2, and the
   * small functions then share that bank in order. */
  const enc2 = ilbc.encode(program([consts(2666), consts(100), consts(100),
                                    consts(100)],
                                   [{ name: "frame" }, { name: "f1" },
                                    { name: "f2" }, { name: "f3" }]));
  eq("the fixture needs two code banks", enc2.codeBanks, 2);
  eq("function 0 fills bank 1 at 0", fnEntry(enc2.bytes, 0).codeOff, 0);
  eq("function 0 stays in bank 1", fnEntry(enc2.bytes, 0).bank, 1);
  eq("function 1 starts bank 2 at 0", fnEntry(enc2.bytes, 1).codeOff, 0);
  eq("function 1 is in bank 2", fnEntry(enc2.bytes, 1).bank, 2);
  eq("function 2 follows at 300", fnEntry(enc2.bytes, 2).codeOff, 300);
  eq("function 3 follows at 600", fnEntry(enc2.bytes, 3).codeOff, 600);
  eq("functions 2 and 3 stay in bank 2", fnEntry(enc2.bytes, 3).bank, 2);

  /* Determinism: the container is a pure function of the program. */
  const again = ilbc.encode(program([consts(1666), consts(1666)],
                                    [{ name: "frame" }, { name: "f1" }]));
  eq("the v4 container is deterministic", sha(again.bytes), sha(enc.bytes));

  /* The browser path: `self`, no module, the exact branch the studio runs. */
  const sandbox = { self: {}, console: console };
  sandbox.self.window = sandbox.self;
  vm.createContext(sandbox);
  for (const f of ["renderer/pce-ilbc.js", "renderer/pce-rom.js"]) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), sandbox,
                    { filename: f });
  }
  const browser = sandbox.self.PCEStudio.ilbc.encode(
    program([consts(1666), consts(1666)], [{ name: "frame" }, { name: "f1" }]));
  eq("the browser context encodes the same v4 bytes",
     sha(browser.bytes), sha(enc.bytes));
  const browserRom = sandbox.self.PCEStudio.rom.buildToyRom({
    bank0: new Uint8Array(fs.readFileSync(ILVM)),
    bytecode: new Uint8Array(browser.bytes) });
  const nodeRom = romLib.buildToyRom({
    bank0: fs.readFileSync(ILVM), bytecode: enc.bytes });
  eq("the browser context builds the same banked ROM",
     sha(browserRom), sha(nodeRom));
}

function checkOriginalTower() {
  if (!ORIGINAL_TOWER || !fs.existsSync(ORIGINAL_TOWER)) {
    const why = "the pre-#272 TOWER is not at " +
                (ORIGINAL_TOWER ||
                 toolPaths.candidates.ORIGINAL_TOWER.join(" or ")) +
                " (set PCESTUDIO_ORIGINAL_TOWER)";
    skipped.push(why);
    console.log("SKIP  TOWER's 2-bank container: " + why);
    return;
  }
  const enc = ilbc.encode(il.compile(fs.readFileSync(ORIGINAL_TOWER, "utf8"),
                                     { chunkName: "tower.lua" }));
  eq("the pre-rework TOWER does not fit one bank, so it is version 4",
     enc.version, 4);
  eq("TOWER's container is 2 banks (16,384 B)", enc.bytes.length, 2 * BANK);
  eq("TOWER has one code bank", enc.codeBanks, 1);
  eq("TOWER's code totals 7,206 B", enc.codeBytes, 7206);
  checkContainer(enc.bytes, 1, "TOWER");
  const rom = romLib.buildToyRom({
    bank0: fs.readFileSync(ILVM), bytecode: enc.bytes });
  eq("TOWER builds a 49,152 B ROM", rom.length, 49152);
  check(Buffer.from(rom.slice(0, 32768))
        .equals(fs.readFileSync(ILVM)),
        "TOWER's ROM opens with the 32 KiB interpreter image");
  check(Buffer.from(rom.slice(32768, 49152)).equals(Buffer.from(enc.bytes)),
        "TOWER's two data banks are the container, in order");
  eq("TOWER's physical bank 4 trailer is zero", rom[32768 + USABLE], 0);
  eq("TOWER's physical bank 5 trailer is zero", rom[32768 + BANK + USABLE], 0);
}

/* ---- 3. the named refusals --------------------------------------------- */

function checkRefusals() {
  const bank0 = fs.readFileSync(ILVM);

  /* A function bigger than a code bank. */
  eq("a 9,000 B function is toy-function-too-big",
     refuseCode(function () { ilbc.encode(program([consts(3000)])); }),
     "toy-function-too-big");
  const tooBig = refuseMessage(function () {
    ilbc.encode(program([consts(3000)]));
  });
  check(/function 0 \(`frame`\) is 9000 B/.test(tooBig),
        "toy-function-too-big names the function id and byte count (" +
        tooBig + ")");

  /* The exact boundary: 8,160 B is one whole code bank and encodes; 8,161 B
   * is one byte over and is refused.  (2,720 consts x 3 B = 8,160; 2,719
   * consts and two rets = 8,161.) */
  const full = ilbc.encode(program([consts(2720)]));
  eq("a function of exactly 8,160 B encodes", full.version, 4);
  eq("it is one code bank", full.codeBanks, 1);
  eq("it occupies the whole bank", fnEntry(full.bytes, 0).codeEnd, 8160);
  eq("its bank trailer starts after it", full.bytes[BANK + USABLE], 0);
  const overEdge = consts(2719);
  overEdge.push({ t: "ret", src: null, line: 1 });
  overEdge.push({ t: "ret", src: null, line: 1 });
  eq("a function of 8,161 B is toy-function-too-big",
     refuseCode(function () { ilbc.encode(program([overEdge])); }),
     "toy-function-too-big");

  /* A jump at the bank edge: a function that fills the usable 8,160 bytes
   * exactly and jumps one past its last instruction, i.e. into the trailer. */
  const edge = consts(2719);
  edge.push({ t: "jmp", target: 2720, line: 1 });
  eq("a jump to a full bank's edge is toy-bank-edge",
     refuseCode(function () { ilbc.encode(program([edge])); }),
     "toy-bank-edge");
  check(/jumps to pc 2720, bank offset 8160/.test(
    refuseMessage(function () { ilbc.encode(program([edge])); })),
    "toy-bank-edge names the pc and the bank offset");

  /* Tables over a bank: 255 max-length global names. */
  const globals = [{ name: "frame" }];
  for (let i = 1; i < 255; i++) {
    globals.push({ name: ("g" + i).padEnd(40, "x") });
  }
  eq("tables over 8,160 B are toy-tables-bank-full",
     refuseCode(function () {
       ilbc.encode(program([[{ t: "ret", src: null, line: 1 }]], globals));
     }), "toy-tables-bank-full");

  /* Finding F1: the builder refuses a v1-v3 container in 8,161..8,192, the
   * range the old 8,192-byte check let through, and accepts exactly 8,160. */
  function fakeContainer(len) {
    const b = new Uint8Array(len);
    b.set([0x49, 0x4C, 0x42, 0x43], 0);
    b[4] = 1;
    return b;
  }
  eq("a v1-3 container of exactly 8,160 B is accepted",
     refuseCode(function () {
       romLib.buildToyRom({ bank0: bank0, bytecode: fakeContainer(USABLE) });
     }), null);
  eq("a v1-3 container of 8,161 B is toy-data-bank-full",
     refuseCode(function () {
       romLib.buildToyRom({ bank0: bank0, bytecode: fakeContainer(USABLE + 1) });
     }), "toy-data-bank-full");
  const f1 = refuseMessage(function () {
    romLib.buildToyRom({ bank0: bank0, bytecode: fakeContainer(8192) });
  });
  check(/8,160 usable/.test(f1) && /song trailer/.test(f1),
        "toy-data-bank-full states the real 8,160 B usable size (" + f1 + ")");

  /* The builder checks a v4 container's own bank count. */
  const enc = ilbc.encode(program([consts(1666), consts(1666)],
                                  [{ name: "frame" }, { name: "f1" }]));
  const badLen = new Uint8Array(enc.bytes.length - BANK);
  badLen.set(enc.bytes.slice(0, badLen.length));
  check(refuseCode(function () {
    romLib.buildToyRom({ bank0: bank0, bytecode: badLen });
  }) != null, "a v4 container one bank short of its header count is refused");
  const badCount = Uint8Array.from(enc.bytes);
  badCount[26] = 5;
  check(refuseCode(function () {
    romLib.buildToyRom({ bank0: bank0, bytecode: badCount });
  }) != null, "a v4 container whose count does not match its length is " +
       "refused");
  check(refuseCode(function () {
    const zero = new Uint8Array(BANK);
    zero.set([0x49, 0x4C, 0x42, 0x43], 0);
    zero[4] = 4;
    romLib.buildToyRom({ bank0: bank0, bytecode: zero });
  }) != null, "a v4 container with no code bank is refused");

  /* An asset tail after a banked container occupies whole banks after it. */
  const assets = new Uint8Array(9000);
  assets.fill(7);
  const withAssets = romLib.buildToyRom({
    bank0: bank0, bytecode: enc.bytes, assets: assets });
  eq("a 3-bank container plus 9,000 B of assets is five data banks",
     withAssets.length, 32768 + 5 * BANK);
  eq("the asset tail starts on the bank after the container",
     withAssets[32768 + enc.bytes.length], 7);
  /* Break (11): the asset tail must not overlap the container.  The broken
   * builder wrote assets one byte early: the suite stayed green because only
   * the tail's first byte was probed.  The whole data region is compared. */
  check(Buffer.from(withAssets.slice(32768, 32768 + enc.bytes.length))
        .equals(Buffer.from(enc.bytes)),
        "v4 (11) the container's bytes are intact before the asset tail");
  check(Buffer.from(withAssets.slice(32768 + enc.bytes.length,
                                     32768 + enc.bytes.length + assets.length))
        .equals(Buffer.from(assets)),
        "v4 (11) the asset tail is byte-identical after the container");
  check(withAssets.slice(32768 + enc.bytes.length + assets.length)
        .every(function (b) { return b === 0xFF; }),
        "v4 (11) the banks after the asset tail are 0xFF fill");
  /* Break (11), unbanked: since #288 the v1-3 asset tail has the v4 place
   * rule — whole banks after the container (docs/BANKED-DATA.md §5.10), so
   * the copyv bank math is one rule for every version and a toy's art no
   * longer needs the bytecode to shrink into the same bank.  The broken
   * builder wrote assets one byte early on this path too — equally green
   * until these lines. */
  const flatAssets = new Uint8Array(100);
  flatAssets.fill(7);
  const withFlatAssets = romLib.buildToyRom({
    bank0: bank0, bytecode: fakeContainer(300), assets: flatAssets });
  eq("a v1-3 container plus a 100 B asset tail builds a 49,152 B ROM",
     withFlatAssets.length, 32768 + 2 * BANK);
  check(Buffer.from(withFlatAssets.slice(32768, 32768 + 300))
        .equals(Buffer.from(fakeContainer(300))),
        "v1-3 (11) the container's bytes are intact in bank 0");
  check(Buffer.from(withFlatAssets.slice(32768 + BANK, 32768 + BANK + 100))
        .equals(Buffer.from(flatAssets)),
        "v1-3 (11) the asset tail is byte-identical on the bank after the " +
        "container");
  eq("v1-3 (11) its song trailer is zero", withFlatAssets[32768 + USABLE], 0);
  const rest = withFlatAssets.slice(32768 + 300, 32768 + BANK);
  check(rest.every(function (b, i) {
          return i === USABLE - 300 ? b === 0 : b === 0xFF;
        }),
        "v1-3 (11) the rest of bank 0 is 0xFF fill (the trailer zero)");
  check(withFlatAssets.slice(32768 + BANK + 100)
        .every(function (b) { return b === 0xFF; }),
        "v1-3 (11) the asset bank's rest is 0xFF fill");
}

/* ---- 4. the nine #285 cold breaks, now checked -------------------------- */

/* The v4 instruction stream, decoded.  Sizes include the opcode byte and
 * come from renderer/pce-ilbc.js's container header comment; the
 * variable-length ops (call, builtin, setlist) read their count from the
 * stream.  An opcode the walker cannot size FAILS the suite — a decoder gap
 * must never read as a pass. */
const OPC = { const: 0x01, move: 0x02, getglobal: 0x03, setglobal: 0x04,
              getupval: 0x05, setupval: 0x06, closure: 0x07, call: 0x08,
              ret: 0x09, jmp: 0x0A, br: 0x0B, forprep: 0x0C, fornext: 0x0D,
              arith: 0x0E, unm: 0x0F, bnot: 0x10, not: 0x11, cmp: 0x12,
              builtin: 0x13, pal: 0x14, reg: 0x15, vset: 0x16, vget: 0x17,
              table: 0x18, setlist: 0x19, tget: 0x1A, tset: 0x1B,
              padref: 0x1C, padget: 0x1D, sat: 0x1E, sprite: 0x1F,
              music: 0x20, sfx: 0x21, release: 0x22, copyv: 0x23 };
const OP_BYTE = {};
for (const name of Object.keys(OPC)) OP_BYTE[OPC[name]] = name;

function ilSize(ins) {                /* the instruction's encoded length */
  switch (ins.t) {
  case "call": return 4 + (ins.args || []).length;
  case "builtin": return 4 + (ins.args || []).length;
  case "setlist": return 4 + (ins.values || []).length;
  case "br": case "arith": case "cmp": case "tget": case "tset": case "sfx":
    return 5;
  case "fornext": case "padget": case "sat": return 4;
  case "jmp": return 3;
  case "forprep": case "ret": case "music": case "release": return 2;
  case "sprite": return 7;
  case "copyv": return 8;                  /* #288: vram u16, bank u8,
                                              off u16, count u16 */
  default: return 3; /* const move getglobal setglobal getupval setupval
                        closure unm bnot not pal reg vset vget table padref */
  }
}
function byteSize(op, bytes, at) {    /* the emitted instruction's length */
  /* call/builtin/setlist: opcode, two operand bytes, then the count byte. */
  if (op === OPC.call || op === OPC.builtin || op === OPC.setlist) {
    return 4 + bytes[at + 3];
  }
  switch (op) {
  case OPC.br: case OPC.arith: case OPC.cmp: case OPC.tget: case OPC.tset:
  case OPC.sfx: return 5;
  case OPC.fornext: case OPC.padget: case OPC.sat: return 4;
  case OPC.jmp: return 3;
  case OPC.forprep: case OPC.ret: case OPC.music: case OPC.release: return 2;
  case OPC.sprite: return 7;
  case OPC.copyv: return 8;
  default:
    return OP_BYTE[op] != null ? 3 : 0;
  }
}
function expectedOffsets(code) {
  const offs = [0];
  for (const ins of code) offs.push(offs[offs.length - 1] + ilSize(ins));
  return offs;
}

/* Breaks (1) and (2): walk function fid's emitted bank stream from
 * bank*8,192 + codeOff and require it to be its IL code, instruction for
 * instruction — a payload written one byte off its entry fails at the first
 * opcode — and every jump operand (jmp/br/fornext's u16) to be
 * bank-relative, below 8,160 and exactly the target pc's boundary. */
function checkStream(enc, fid, want, name) {
  const f = fnEntry(enc.bytes, fid);
  const start = f.bank * BANK + f.codeOff;
  const end = f.bank * BANK + f.codeEnd;
  if (want.length) {
    eq("v4 (1) " + name + ": function " + fid + "'s code starts at its " +
       "entry's codeOff (" + OP_BYTE[OPC[want[0].t]] + ")",
       enc.bytes[start], OPC[want[0].t]);
  }
  const offs = expectedOffsets(want);
  const boundaries = new Set(offs.map(o => f.codeOff + o));
  const gotOps = [];
  let at = start, i = 0;
  while (at < end) {
    if (i >= want.length) {
      check(false, "v4 (1) " + name + ": function " + fid + " has more " +
            "emitted code than IL instructions");
      return;
    }
    const op = enc.bytes[at];
    const size = byteSize(op, enc.bytes, at);
    if (!size) {
      check(false, "v4 (1) " + name + ": function " + fid + " emitted opcode " +
            "0x" + op.toString(16) + " at bank offset " +
            (at - f.bank * BANK) + " — extend the decoder's byteSize");
      return;
    }
    gotOps.push(op);
    if (op === OPC.jmp || op === OPC.br || op === OPC.fornext) {
      const atT = at + (op === OPC.br ? 3 : op === OPC.fornext ? 2 : 1);
      const t = u16(enc.bytes, atT);
      const what = "v4 (2) " + name + ": function " + fid + "'s " +
                   OP_BYTE[op] + " at bank offset " + (at - f.bank * BANK);
      check(t < USABLE, what + " target " + t + " is below " + USABLE);
      check(boundaries.has(t), what + " target " + t +
            " is an instruction boundary");
      eq(what + " target is pc " + want[i].target + "'s bank offset",
         t, f.codeOff + offs[want[i].target]);
    }
    at += size;
    i++;
  }
  check(i === want.length && at === end,
        "v4 (1) " + name + ": function " + fid + "'s whole code stream " +
        "decodes (" + i + " instructions, " + (end - start) + " B)");
  const wantOps = want.map(ins => OPC[ins.t]);
  check(gotOps.length === wantOps.length &&
        gotOps.every((o, n) => o === wantOps[n]),
        "v4 (1) " + name + ": function " + fid + "'s opcode stream is its IL");
}

function checkRule2Breaks() {
  const bank0 = fs.readFileSync(ILVM);
  const C = { t: "const", dst: { r: 0 }, k: { t: "int", v: 0 }, line: 1 };
  const RET = { t: "ret", src: null, line: 1 };
  const jmp = t => ({ t: "jmp", target: t, line: 1 });
  const br = t => ({ t: "br", cond: { r: 0 }, when: false, target: t,
                     line: 1 });
  const fn = t => ({ t: "fornext", base: 0, target: t, line: 1 });

  const vanillaCode = [consts(1666), consts(1666)];
  const vanilla = ilbc.encode(program(vanillaCode,
                                      [{ name: "frame" }, { name: "f1" }]));
  const jumpyCode = [[jmp(2), C, C, br(6), C, C, fn(1)].concat(consts(1658)),
                     [C, jmp(2), C, br(4), C, C, fn(2)].concat(consts(1657))];
  const jumpy = ilbc.encode(program(jumpyCode,
                                    [{ name: "frame" }, { name: "f1" }]));

  /* A table-bearing v4 fixture: the real Lua front end (so the table section
   * is the encoder's own), padded to 8,130 B so tables+code exceed one bank. */
  const tableSrc = "frame = function(t, f) local u = {} u.x = 1 " +
                   "local y = u.x + 1 return y end";
  const tableProg = il.compile(tableSrc, { chunkName: "banked-table.lua" });
  const pad = [];
  for (let p = 0; p < 2700; p++) pad.push(C);
  tableProg.functions[1].code = pad.concat(tableProg.functions[1].code);
  const tableEnc = ilbc.encode(tableProg);
  eq("the table fixture is version 4", tableEnc.version, 4);
  check(tableEnc.tables.nslots > 0, "the table fixture has a table section");

  /* Break (3): pinned v4 shas.  The seven v1-v3 pins above cover unbanked
   * toys; before #285 no v4 sha was pinned, so a fill byte or layout change
   * (0x00 instead of 0xFF, a shifted payload) could pass.  Captured
   * 2026-11-04 from the intact encoder.  Re-pinned for #280: a banked
   * container now always carries the table section, so the two table-free
   * fixtures moved by that one byte (the table fixture is unchanged).  The
   * jump fixture's bytes move again when #286 fixes its bank-relative
   * targets. */
  for (const [what, bytes, pin] of [
    ["the two-code-bank fixture's container",
     vanilla.bytes,
     "f5d7c050b42b500347f78d24dbb4b7258b2a9df2cfd8926b5e1090b26448ad8e"],
    ["the jump fixture's container",
     jumpy.bytes,
     "6fd5f897d908bd2d047a9d45693cdc36e3893c4cb1c11f5db04713a677450a97"],
    ["the table fixture's container",
     tableEnc.bytes,
     "1a52e77572415d32abdc01f628570825c1807aeebba21d640b3a10af470e4ebe"]]) {
    eq("v4 (3) " + what + " sha is pinned", sha(bytes), pin);
  }

  /* Breaks (1) and (2): the code streams and every jump target. */
  checkStream(vanilla, 0, vanillaCode[0], "the two-code-bank fixture");
  checkStream(vanilla, 1, vanillaCode[1], "the two-code-bank fixture");
  checkStream(jumpy, 0, jumpyCode[0], "the jump fixture");
  checkStream(jumpy, 1, jumpyCode[1], "the jump fixture");
  checkStream(tableEnc, 1, tableProg.functions[1].code, "the table fixture");

  /* Break (4): the v4 header's tabTabOff lands on the table section, whose
   * first byte is its u8 nslots. */
  const tabTabOff = u16(tableEnc.bytes, 20);
  eq("v4 (4) the header tabTabOff points at the table section's u8 nslots",
     tableEnc.bytes[tabTabOff], tableEnc.tables.nslots);
  const section = ilbc.buildTableSection(tableProg).bytes;
  check(Buffer.from(tableEnc.bytes.slice(tabTabOff,
                                         tabTabOff + section.length))
        .equals(Buffer.from(section)),
        "v4 (4) the table section at tabTabOff is buildTableSection's bytes");

  /* Break (5): the fit threshold.  Tables (8,156 B with the 24-byte v1-v3
   * header) plus 4 B of code is exactly 8,160 B — it fits, so it stays a
   * v1-v3 container and builds.  The broken `>=` banks it. */
  const g5 = [{ name: "frame" }];
  for (let i = 1; i <= 196; i++) g5.push({ name: ("g" + i).padEnd(40, "x") });
  g5.push({ name: "g197".padEnd(79, "x") });
  const fitsCode = refuseCode(function () {
    return ilbc.encode(program([[RET, RET]], g5));
  });
  eq("v4 (5) a toy whose tables+code is exactly 8,160 B stays a v1-3 " +
     "container (no refusal)", fitsCode, null);
  if (fitsCode === null) {
    const fits = ilbc.encode(program([[RET, RET]], g5));
    eq("v4 (5) its version is 1", fits.version, 1);
    eq("v4 (5) it is not banked", fits.banked, false);
    eq("v4 (5) its container is 8,160 B", fits.bytes.length, USABLE);
    eq("v4 (5) it still builds",
       refuseCode(function () {
         romLib.buildToyRom({ bank0: bank0, bytecode: fits.bytes });
       }), null);
  }

  /* Break (6): the packing rule.  Function 0 is 8,156 B, function 1 is 4 B —
  * it exactly fills the bank, so it must start at 8,156 with no gap, in the
  * same bank.  The broken `>=` pushes it to a second bank. */
  const gapFree = ilbc.encode(program(
    [consts(2718).concat([RET]), [RET, RET]],
    [{ name: "frame" }, { name: "f1" }]));
  eq("v4 (6) a second function that exactly fills the bank starts at the " +
     "prior codeEnd", fnEntry(gapFree.bytes, 1).codeOff,
     fnEntry(gapFree.bytes, 0).codeEnd);
  eq("v4 (6) it stays in the same code bank",
     fnEntry(gapFree.bytes, 1).bank, fnEntry(gapFree.bytes, 0).bank);
  eq("v4 (6) the fixture still needs one code bank", gapFree.codeBanks, 1);

  /* Break (7): the toy-rom-full guard.  124 functions of exactly 8,160 B
   * need 124 code banks; a HuCard holds 123 after the 32 KiB image. */
  const romFull = program(
    Array.from({ length: 124 }, function () { return consts(2720); }));
  eq("v4 (7) a 124-code-bank program is toy-rom-full",
     refuseCode(function () { ilbc.encode(romFull); }), "toy-rom-full");

  /* Break (8): tables of exactly 8,160 B fill the tables bank but are not
   * over it — the broken `>=` refuses them.  Since #280 a banked container
   * always carries the table section, so the 8,160 B includes its one byte:
   * 28 B of header + 16 B of upvalue descriptors + 8,115 B of global names
   * + the empty section's 1 byte.  The code must be over 5 B so the v1
   * layout (24-byte header, no section) does not fit either: 8,155 B of
   * tables + 8 B of code = 8,163 > 8,160, while the v4 tables are exactly
   * 8,160. */
  const g8 = [{ name: "frame" }];
  for (let i = 1; i <= 196; i++) g8.push({ name: ("g" + i).padEnd(40, "x") });
  g8.push({ name: "g197".padEnd(73, "x") });
  const fullCode = refuseCode(function () {
    return ilbc.encode(program([[C, C, RET]], g8));
  });
  eq("v4 (8) tables of exactly 8,160 B encode (no refusal)", fullCode, null);
  if (fullCode === null) {
    const fullTables = ilbc.encode(program([[C, C, RET]], g8));
    eq("v4 (8) their version is 4", fullTables.version, 4);
    eq("v4 (8) their container is 2 banks", fullTables.bytes.length, 2 * BANK);
  }

  /* Break (9): the builder re-zeros every container bank's song trailer, so
   * a v4 container handed in with dirty trailers builds the same ROM as a
   * clean one. */
  const dirty = Uint8Array.from(vanilla.bytes);
  dirty[USABLE] = 0x5A;
  dirty[BANK + USABLE] = 0x5A;
  dirty[2 * BANK + USABLE] = 0x5A;
  const romDirty = romLib.buildToyRom({ bank0: bank0, bytecode: dirty });
  eq("v4 (9) the ROM re-zeros the tables bank's trailer",
     romDirty[32768 + USABLE], 0);
  eq("v4 (9) the ROM re-zeros code bank 1's trailer",
     romDirty[32768 + BANK + USABLE], 0);
  eq("v4 (9) the ROM re-zeros code bank 2's trailer",
     romDirty[32768 + 2 * BANK + USABLE], 0);
  eq("v4 (9) a dirty-trailer container builds the same ROM",
     sha(romDirty),
     sha(romLib.buildToyRom({ bank0: bank0, bytecode: vanilla.bytes })));

  /* TOWER's pinned v4 sha and its whole stream, when the witness is there.
   * Re-pinned 2026-11-04 by #286: the encoder now adds each function's
   * fnCodeOff to its jump targets, so every jump operand in a function that
   * starts past a bank's first byte changed (the v4 (2) checks below say
   * the new bytes are the bank-relative targets the format promises). */
  if (ORIGINAL_TOWER && fs.existsSync(ORIGINAL_TOWER)) {
    const towerProg = il.compile(fs.readFileSync(ORIGINAL_TOWER, "utf8"),
                                 { chunkName: "tower.lua" });
    const tower = ilbc.encode(towerProg);
    eq("v4 (3) TOWER's v4 container sha is pinned", sha(tower.bytes),
       "9ef67ed4246406beb5c37e28f2bc4aad17c2649512a7366759d0500b6b6666a0");
    for (let fid = 0; fid < towerProg.functions.length; fid++) {
      checkStream(tower, fid, towerProg.functions[fid].code, "TOWER");
    }
  }

  /* Break (10): the acceptance edge of toy-rom-full.  A program that needs
   * exactly 123 code banks fills the HuCard (123 code banks + the tables
   * bank + the 4 image banks = 128).  The broken `>=` guard refuses it — the
   * suite stayed green because v4 (7) pins only the 124 refusal — and a
   * builder whose toy-rom-full guard is gone builds a 129-bank ROM from a
   * hand-made 124-bank container. */
  const maxProgram = program(
    Array.from({ length: 123 }, function () { return consts(2720); }));
  const maxRefusal = refuseCode(function () { ilbc.encode(maxProgram); });
  eq("v4 (10) a 123-code-bank program encodes (no refusal)", maxRefusal, null);
  if (maxRefusal === null) {
    const maxEnc = ilbc.encode(maxProgram);
    eq("v4 (10) it names 123 code banks", maxEnc.codeBanks, 123);
    eq("v4 (10) its container is 124 banks", maxEnc.bytes.length, 124 * BANK);
    checkContainer(maxEnc.bytes, 123, "the 123-bank fixture");
    eq("v4 (10) the builder takes it: a 128-bank, 1,048,576 B ROM",
       refuseCode(function () {
         romLib.buildToyRom({ bank0: bank0, bytecode: maxEnc.bytes });
       }), null);
    const tail = new Uint8Array(100);
    tail.fill(7);
    eq("v4 (10) the same container plus any asset tail is toy-rom-full",
       refuseCode(function () {
         romLib.buildToyRom({ bank0: bank0, bytecode: maxEnc.bytes,
                              assets: tail });
       }), "toy-rom-full");
  }
  const overHand = new Uint8Array((1 + 124) * BANK);
  overHand.set([0x49, 0x4C, 0x42, 0x43], 0);      /* the ILBC magic */
  overHand[4] = 4;
  overHand[26] = 124;
  eq("v4 (10) a hand-made 124-code-bank container is toy-rom-full",
     refuseCode(function () {
       romLib.buildToyRom({ bank0: bank0, bytecode: overHand });
     }), "toy-rom-full");

  /* Break (12): the fit decision for a table-bearing (wide) program must
   * count the table section.  The broken encoder subtracted the section and
   * emitted an 8,161 B v2 container instead of banking — the suite stayed
   * green because breaks (5) and (8) are table-free.  A wide toy whose
   * v1-v3 layout totals exactly 8,160 B stays v2; one byte more is v4. */
  const edgeProg = il.compile(tableSrc, { chunkName: "banked-table-edge.lua" });
  const pad12 = [];
  for (let p = 0; p < 2600; p++) pad12.push(C);
  edgeProg.functions[1].code = pad12.concat(edgeProg.functions[1].code);
  const edgeBase = ilbc.encode(edgeProg);
  eq("v4 (12) the padded table toy still fits one bank (version 2)",
     edgeBase.version, 2);
  check(edgeBase.bytes.length < USABLE,
        "v4 (12) its v2 container is below 8,160 B (" +
        edgeBase.bytes.length + ")");
  /* The gap to 8,160 is closed with 3-byte consts plus one global name of
   * length L (a global adds exactly L+1 bytes; a name is one u8 length). */
  const gap = USABLE - edgeBase.bytes.length;
  const k12 = Math.max(0, Math.ceil((gap - 256) / 3));
  const L12 = gap - 3 * k12 - 1;
  check(L12 >= 1 && L12 <= 255,
        "v4 (12) the exact-fit global length is a u8 (L=" + L12 + ")");
  function edgeToy(extraConsts, globalLen) {
    const more = [];
    for (let p = 0; p < extraConsts; p++) more.push(C);
    return {
      lang: edgeProg.lang, version: edgeProg.version,
      globals: edgeProg.globals.concat([{ name: "z".padEnd(globalLen, "x") }]),
      hooks: edgeProg.hooks,
      functions: edgeProg.functions.map(function (fn, i) {
        return i === 1 ? Object.assign({}, fn, { code: fn.code.concat(more) })
                       : fn;
      })
    };
  }
  const fitsWide = ilbc.encode(edgeToy(k12, L12));
  eq("v4 (12) tables+code of exactly 8,160 B stay a v2 container",
     fitsWide.version, 2);
  eq("v4 (12) its container is exactly 8,160 B", fitsWide.bytes.length, USABLE);
  eq("v4 (12) it builds",
     refuseCode(function () {
       romLib.buildToyRom({ bank0: bank0, bytecode: fitsWide.bytes });
     }), null);
  const overWide = ilbc.encode(edgeToy(k12, L12 + 1));
  eq("v4 (12) one byte more is version 4", overWide.version, 4);
  eq("v4 (12) it is a 2-bank container", overWide.bytes.length, 2 * BANK);
  eq("v4 (12) it builds",
     refuseCode(function () {
       romLib.buildToyRom({ bank0: bank0, bytecode: overWide.bytes });
     }), null);
}

/* ---- run ---------------------------------------------------------------- */

console.log("check-banked-data: #279 container v4 and the banked builder");
checkUnchanged();
checkVanillaFixture();
checkOriginalTower();
checkRefusals();
checkRule2Breaks();

if (skipped.length) {
  console.log("note  " + checks + " checks, " + failed + " failed, " +
              skipped.length + " skipped");
} else {
  console.log("note  " + checks + " checks, " + failed + " failed");
}
if (failed) {
  console.log("FAIL  check-banked-data: " + failed + " of " + checks +
              " checks failed");
  process.exit(1);
}
if (skipped.length) {
  console.log("SKIP  check-banked-data: " + skipped.join("; "));
}
console.log("PASS  " + checks + " checks");
