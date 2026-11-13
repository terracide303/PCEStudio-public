#!/usr/bin/env node
/*
 * tests/check-ilvm-copyv.js — #281's evidence: the COPYV op, a banked
 * streaming copy from toy data to VRAM (docs/IL.md §14.1,
 * docs/BANKED-DATA.md §3.3/§5.8).
 *
 *   node tests/check-ilvm-copyv.js
 *
 * WHAT IS CHECKED
 *
 *   1. The op's byte shape in a hand-made container.  COPYV is opcode 0x23,
 *      then `vram u16, bank u8, off u16, count u16` (8 bytes, little-
 *      endian).  The encoder does not emit it yet (#218 will turn a run of
 *      constant vram[] writes into a blob); these containers are laid out
 *      by hand here, the same way #217's card asked for the evidence.
 *   2. A 300-word copy through the host harness (tools/ilvm/hostvm.c) from
 *      a version 1 container: bank 0 (the toy data bank), offset 0x200, 300
 *      words into VRAM 0x1000.  vram.bin must hold those 600 bytes word for
 *      word, zero outside the copied run, and the vset after the COPYV must
 *      have landed — the opcode stream continues where it left off.
 *   3. A version 4 container with a one-code-bank layout and four asset
 *      banks: five copies, one fixture each for the 2026-11-04 rule-2 cold
 *      break's three missed mutations plus the two originals:
 *        A  bank 2 off 0x100, 300 words -> VRAM 0x1000 (one bank), and
 *        B  bank 2 off 0x1F00, 300 words -> VRAM 0x2000 (crosses into bank
 *           3 after 128 words) — the two #281 fixtures;
 *        C  bank 2 off 0x2100, 300 words -> VRAM 0x4000 — `off` carries
 *           its top three bits, a malformed container (break B5).  The host
 *           must mask them (`& 0x1FFF`) and the shim must mask them too
 *           (`and #$1F`), so C lands exactly the words A reads: the two
 *           halves agree on malformed input, not only legal input (the
 *           c67836a contract);
 *        D  bank 3 off 0x1FFF, 4,324 words -> VRAM 0x5000 — the stream
 *           spans THREE banks (bank 3's last byte, all of bank 4, 455
 *           bytes of bank 5), so the first word straddles a boundary and
 *           the boundary carries map banks 4 and 5 (break B7:
 *           map_data_bank folding banks >= 4);
 *        E  bank 2 off 0x500, 300 words -> VRAM 0xFF00 — the writes pass
 *           the top of VRAM (break B8): the words land at 0x7F00..0x7FFF
 *           then wrap to 0x0000..0x002B.
 *      Every run is checked word for word, and the vset and ret after the
 *      copies prove MPR2 was mapped back to the function's code bank
 *      (bank 1) when the copy ended.
 *   4. Scratch mutations of the host interpreter must each turn the run
 *      red: ignoring the bank operand (the copy reads bank 0), a one-byte
 *      error in the boundary carry (the crossing copy is shifted), the
 *      13-bit off mask removed entirely, the data-bank map folding banks
 *      >= 4 into the low two bits, and the VRAM write's 16-bit wrap
 *      removed.
 *
 * B8'S WRAP IS PARTLY BY CONSTRUCTION.  The 16-bit wrap of `va + n2` is
 * invisible in vram.bin: the harness's toy_vram_set masks `& 0x7FFF` (VRAM
 * is 32K words — the console's VDC ignores MAWR's top bit the same way),
 * and (x & 0xFFFF) & 0x7FFF == x & 0x7FFF for every x.  The near-top copy
 * E pins the observable boundary behaviour (words continue at word 0 after
 * the top of VRAM); the wrap itself is pinned by a trace build of hostvm.c
 * (below) that prints UNWRAPPED for any pre-mask address past 0xFFFF — the
 * intact host never prints one, the wrap-removed host does.
 *
 * WHAT IS NOT PROVEN HERE.  The console half of COPYV is a bank-3 shim in
 * tools/ilvm/hutrack_engine.asm (CopyvShim), because the fixed 16 KiB image
 * has no room for a copy loop; the host harness runs the C half in
 * tools/ilvm/ilvm.c.  This file proves the op's semantics and the C half.
 * The shim's console behaviour is NOT proven here: tests/check-export-art-console.js
 * runs it in an emulator (2026-11-13; it found that the interpreter handed the shim
 * an offset instead of an address, which this host harness could not see).  Rule 2 ran for
 * this file (the 2026-11-04 cold break, a different seat and model): its
 * three misses are the fixtures C, D and E above.
 *
 * Written by @design because the card names this evidence (the same
 * arrangement as tests/check-ilvm.js's header).
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const romLib = require("../renderer/pce-rom.js");

const ROOT = path.join(__dirname, "..");
const BANK = 8192;
const ILVM = path.join(ROOT, "renderer", "ilvm.bin");
const ILVM_BYTES = romLib.ILVM_BYTES;

let checks = 0;
const failures = [];

function check(ok, name) {
  checks++;
  if (!ok) {
    failures.push(name);
    console.log("FAIL  " + name);
  }
}
function eq(name, got, want) {
  check(got === want,
        name + " (got " + JSON.stringify(got) + ", want " +
        JSON.stringify(want) + ")");
}

/* ---- the container writer ----------------------------------------------
 *
 * A small, explicit writer: every offset below is one the interpreter reads
 * (tools/ilvm/ilvm.c's toy_boot), so the fixture doubles as a readable
 * statement of the v1 and v4 headers.  Nothing here goes through
 * renderer/pce-ilbc.js: the encoder has no COPYV instruction. */

function put16(buf, off, v) {
  buf[off] = v & 0xFF;
  buf[off + 1] = (v >> 8) & 0xFF;
}

/* CopyV's 8 bytes: opcode, vram, bank, off, count. */
function copyv(buf, off, vram, bank, srcOff, count) {
  buf[off] = 0x23;
  put16(buf, off + 1, vram);
  buf[off + 3] = bank;
  put16(buf, off + 4, srcOff);
  put16(buf, off + 6, count);
  return off + 8;
}

/* `vset` with two constant operands: 0x16, 0x80|kAddr, 0x80|kWord. */
function vsetConsts(buf, off) {
  buf[off] = 0x16;
  buf[off + 1] = 0x80;          /* constant 0 */
  buf[off + 2] = 0x81;          /* constant 1 */
  return off + 3;
}

function ret(buf, off) {
  buf[off] = 0x09;              /* ret */
  buf[off + 1] = 0xFF;          /* no value */
  return off + 2;
}

/* Two int constants: `vram` and the marker word the vset writes. */
function constants(buf, off, vram, word) {
  [vram, word].forEach(function (v) {
    buf[off++] = 0;             /* type 0: int, then 4 LE bytes */
    buf[off++] = v & 0xFF;
    buf[off++] = (v >> 8) & 0xFF;
    buf[off++] = (v >> 16) & 0xFF;
    buf[off++] = (v >> 24) & 0xFF;
  });
  return off;
}

function wordsOf(n, seed) {
  const w = new Uint16Array(n);
  for (let i = 0; i < n; i++) w[i] = (i * 37 + seed) & 0xFFFF;
  return w;
}

function putWords(buf, off, words) {
  for (let i = 0; i < words.length; i++) put16(buf, off + i * 2, words[i]);
  return off + words.length * 2;
}

/* Version 1: one data bank.  Header 24 B, one function, two constants, the
 * code at its header codeOff, the 300-word blob after the code at 0x200.
 * This is the shape every small toy has today; the op's bank operand is 0
 * (physical data bank 4). */
function v1Fixture() {
  const buf = new Uint8Array(BANK).fill(0xFF);
  buf.set([0x49, 0x4C, 0x42, 0x43], 0);       /* "ILBC" */
  buf[4] = 1;                                  /* version */
  buf[5] = 0;                                  /* no raster */
  buf[6] = 0xFF; buf[7] = 0xFF; buf[8] = 0xFF; /* init/frame/raster */
  buf[9] = 1;                                  /* functions */
  buf[10] = 0;                                 /* globals */
  buf[11] = 2;                                 /* constants */
  put16(buf, 12, 24);                          /* funcTabOff */
  put16(buf, 14, 34);                          /* upTabOff (no upvalues) */
  put16(buf, 16, 34);                          /* constTabOff */
  put16(buf, 18, 44);                          /* globalTabOff (none) */
  put16(buf, 20, 44);                          /* first instruction */
  /* The function entry: codeOff 44, codeEnd filled below, upOff 34,
   * nregs 0, nparams 0, nups 0, reserved 0. */
  put16(buf, 24, 44);
  put16(buf, 26, 0);
  put16(buf, 28, 34);
  buf[30] = 0; buf[31] = 0; buf[32] = 0; buf[33] = 0;
  let o = constants(buf, 34, 0x3000, 0xAAAA);
  check(o === 44, "v1 fixture: the constants end at the code offset");
  const codeStart = 44;
  o = copyv(buf, o, 0x1000, 0, 0x200, 300);
  o = vsetConsts(buf, o);
  o = ret(buf, o);
  put16(buf, 26, o);                           /* codeEnd */
  put16(buf, 22, o);                           /* header codeEnd */
  const blob = wordsOf(300, 0x1234);
  putWords(buf, 0x200, blob);
  return { bytes: buf, words: blob, vram: 0x1000 };
}

/* Version 4: a tables bank and one code bank (the container), then the
 * asset banks the builder appends after it (docs/BANKED-DATA.md §5.2: the
 * assets tail starts on the next whole bank and occupies whole banks).  No
 * trailer is written into an asset bank, so a stream crosses from one bank
 * to the next at exactly 8,192 bytes.  Function 0 runs from bank 1.  The
 * four asset banks (2-5) hold the five fixtures' blobs: A at bank 2 off
 * 0x100 (copy A and, masked, copy C read it), E at bank 2 off 0x500, B at
 * bank 2 off 0x1F00 crossing into bank 3 after 128 words, and D at bank 3
 * off 0x1FFF spanning banks 3, 4 and 5 (4,324 words: bank 3's last byte,
 * all 8,192 bytes of bank 4, 455 bytes of bank 5). */
function v4Fixture() {
  const buf = new Uint8Array(6 * BANK).fill(0xFF);
  buf.set([0x49, 0x4C, 0x42, 0x43], 0);
  buf[4] = 4;                                  /* version 4 */
  buf[5] = 0;
  buf[6] = 0xFF; buf[7] = 0xFF; buf[8] = 0xFF;
  buf[9] = 1;                                  /* functions */
  buf[10] = 0;                                 /* globals */
  buf[11] = 2;                                 /* constants */
  put16(buf, 12, 28);                          /* funcTabOff */
  put16(buf, 14, 38);                          /* upTabOff (no upvalues) */
  put16(buf, 16, 38);                          /* constTabOff */
  put16(buf, 18, 38);                          /* globalTabOff (none) */
  put16(buf, 20, 38);                          /* tabTabOff */
  put16(buf, 22, 0);
  put16(buf, 24, 0);
  put16(buf, 26, 1);                           /* one code bank (bank 1) */
  /* Function 0: code inside bank 1 at offset 0, bank byte 1 at entry+9. */
  put16(buf, 28, 0);                           /* codeOff */
  put16(buf, 30, 0);                           /* codeEnd, filled below */
  put16(buf, 32, 0);                           /* upOff */
  buf[34] = 0; buf[35] = 0; buf[36] = 0;
  buf[37] = 1;                                 /* code bank */
  let o = constants(buf, 38, 0x3000, 0xAAAA);
  check(o === 48, "v4 fixture: the constants end at the table section");
  buf[48] = 0;                                 /* table section: nslots 0 */
  const code = BANK + 0;                       /* bank 1, offset 0 */
  let c = code;
  c = copyv(buf, c, 0x1000, 2, 0x100, 300);    /* A: one bank */
  c = copyv(buf, c, 0x2000, 2, 0x1F00, 300);   /* B: crosses into bank 3 */
  c = copyv(buf, c, 0x4000, 2, 0x2100, 300);   /* C: malformed off (B5) */
  c = copyv(buf, c, 0x5000, 3, 0x1FFF, 4324);  /* D: spans three banks (B7) */
  c = copyv(buf, c, 0xFF00, 2, 0x500, 300);    /* E: past the top of VRAM (B8) */
  c = vsetConsts(buf, c);
  c = ret(buf, c);
  put16(buf, 30, c - code);                    /* codeEnd, bank-relative */
  /* Blob A: asset bank 2 offset 0x100, 300 words, one bank.  Copy C's
   * masked off 0x2100 & 0x1FFF = 0x100 reads this same blob. */
  const a = wordsOf(300, 0x1234);
  putWords(buf, 2 * BANK + 0x100, a);
  /* Blob B: asset bank 2 offset 0x1F00 for 128 words, then asset bank 3
   * offset 0 for the other 172 — the copy crosses at 8,192. */
  const b = wordsOf(300, 0xBEEF);
  putWords(buf, 2 * BANK + 0x1F00, b.subarray(0, 128));
  putWords(buf, 3 * BANK, b.subarray(128));
  /* Blob D: laid flat from bank 3 offset 0x1FFF — the container is one
   * buffer, so putWords flows across bank boundaries: its first word
   * straddles the bank 3/4 boundary and word 4,096 the bank 4/5 one. */
  const d = wordsOf(4324, 0x9C40);
  putWords(buf, 3 * BANK + 0x1FFF, d);
  /* Blob E: asset bank 2 offset 0x500, 300 words, one bank. */
  const e = wordsOf(300, 0x3141);
  putWords(buf, 2 * BANK + 0x500, e);
  /* The builder writes the 32-byte song trailer zeroed in every container
   * bank (renderer/pce-rom.js's buildToyRom) and none in an asset bank. */
  for (let k = 0; k <= 1; k++) buf[k * BANK + 0x1FE0] = 0;
  return { container: buf.subarray(0, 2 * BANK),
           assets: buf.subarray(2 * BANK),
           file: buf, wordsA: a, wordsB: b, wordsD: d, wordsE: e };
}

/* ---- the host harness -------------------------------------------------- */

function haveCc() {
  return !spawnSync("cc", ["--version"], { encoding: "utf8" }).error;
}

function buildHostvm(bin, ilvmSource, hostvmSource) {
  const r = spawnSync("cc", [
    "-DILVM_HOST", "-O2", "-I", path.join(ROOT, "tools", "toyc"),
    "-I", path.join(ROOT, "tools", "ilvm"),
    ilvmSource,
    path.join(ROOT, "tools", "ilvm", "ilvm_sound.c"),
    hostvmSource || path.join(ROOT, "tools", "ilvm", "hostvm.c"), "-o", bin
  ], { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0) {
    const out = ((r.stderr || "") + (r.stdout || "")).trim().split("\n");
    console.log("      cc: " + out.slice(-3).join(" | "));
  }
  return r.status === 0;
}

/* Run one container for one frame; return the spawn result, so a caller
 * can read stderr (the B8 trace build prints UNWRAPPED there). */
function runResult(hostvm, container, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, "toy.ilbc");
  fs.writeFileSync(p, Buffer.from(container));
  return spawnSync(hostvm, [p, dir, "1"], { encoding: "utf8" });
}

/* Run one container for one frame; return the VRAM words. */
function run(hostvm, container, dir) {
  const r = runResult(hostvm, container, dir);
  if (r.status !== 0) {
    console.log("      hostvm: " + ((r.stderr || "") + (r.stdout || ""))
      .trim().split("\n").slice(-3).join(" | "));
    return null;
  }
  const raw = fs.readFileSync(path.join(dir, "vram.bin"));
  const vram = new Uint16Array(raw.length / 2);
  for (let i = 0; i < vram.length; i++) vram[i] = raw.readUInt16LE(i * 2);
  return vram;
}

function expectWords(vram, base, words, name) {
  let bad = -1;
  for (let i = 0; i < words.length; i++) {
    if (vram[base + i] !== words[i]) { bad = i; break; }
  }
  check(bad < 0, name + ": vram[" + base + ".." + (base + words.length - 1) +
        "] is the blob word for word" +
        (bad < 0 ? "" : " (first miss at word " + bad + ": got " +
         vram[base + bad] + ", want " + words[bad] + ")"));
}

/* ---- main -------------------------------------------------------------- */

if (!haveCc()) {
  console.log("SKIP  COPYV host harness: no system cc");
  console.log("SKIP  COPYV has no other evidence: the console shim is the " +
              "Mednafen capture owed once #218 emits a blob");
  process.exit(0);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ilvm-copyv-"));
const hostvm = path.join(tmp, "hostvm");
if (!buildHostvm(hostvm, path.join(ROOT, "tools", "ilvm", "ilvm.c"))) {
  check(false, "the system cc builds ilvm.c with hostvm.c (COPYV's host half)");
} else {
  /* ---- 2. the version 1 copy ------------------------------------------ */
  const v1 = v1Fixture();
  const vram1 = run(hostvm, v1.bytes, path.join(tmp, "v1"));
  check(vram1 !== null, "v1: hostvm exits 0");
  if (vram1) {
    expectWords(vram1, v1.vram, v1.words, "v1 300-word copy");
    eq("v1: the vset after the copy wrote its marker word",
       vram1[0x3000], 0xAAAA);
    eq("v1: nothing was written before the copy", vram1[0x0FFF], 0);
    eq("v1: nothing was written after the copy", vram1[0x1000 + 300], 0);
    eq("v1: nothing was written after the marker", vram1[0x3001], 0);
    eq("v1: the 300 copied words are 300 distinct words (not a constant run)",
       new Set(v1.words).size > 250, true);
  }

  /* ---- 3. the version 4 copies: one bank, a crossing, the cold break's
   * three missed shapes ----------------------------------------------- */
  const v4 = v4Fixture();
  const vram4 = run(hostvm, v4.file, path.join(tmp, "v4"));
  check(vram4 !== null, "v4: hostvm exits 0");
  if (vram4) {
    expectWords(vram4, 0x1000, v4.wordsA, "v4 copy A from bank 2 (one bank)");
    expectWords(vram4, 0x2000, v4.wordsB,
                "v4 copy B crossing bank 2 -> bank 3");
    expectWords(vram4, 0x4000, v4.wordsA,
                "v4 copy C with a malformed off (top three bits set) reads " +
                "the words the legal copy A reads (host and shim mask to " +
                "13 bits)");
    expectWords(vram4, 0x5000, v4.wordsD,
                "v4 copy D spanning banks 3 -> 4 -> 5 (4,324 words, first " +
                "word straddles the boundary)");
    expectWords(vram4, 0x7F00, v4.wordsE.subarray(0, 256),
                "v4 copy E near the top of VRAM: 0x7F00..0x7FFF");
    expectWords(vram4, 0x0000, v4.wordsE.subarray(256),
                "v4 copy E wraps past the top of VRAM: 0x0000..0x002B");
    eq("v4: the vset after all five copies wrote its marker word " +
       "(MPR2 was mapped back to the code bank)", vram4[0x3000], 0xAAAA);
    eq("v4: nothing was written past the crossing copy", vram4[0x2000 + 300],
       0);
    eq("v4: nothing was written before the malformed-off copy",
       vram4[0x3FFF], 0);
    eq("v4: nothing was written past the malformed-off copy",
       vram4[0x4000 + 300], 0);
    eq("v4: nothing was written past the three-bank copy",
       vram4[0x5000 + 4324], 0);
    eq("v4: nothing was written before the near-top copy", vram4[0x7EFF], 0);
    eq("v4: nothing was written past the wrapped tail", vram4[0x002C], 0);
    eq("v4: the crossing copy's second half is not a repeat of its first " +
       "(bank 3's bytes really were read)", v4.wordsB[299] !== v4.wordsB[0],
       true);
    eq("v4: the three-bank copy's bank-4 span is not a repeat of its bank-3 " +
       "span (bank 4's bytes really were read)",
       v4.wordsD[4096] !== v4.wordsD[0], true);
  }
  /* The fixture's container+assets bytes are what the builder makes of the
   * same inputs: whole banks, the container's pairs first, the asset tail
   * after.  hostvm runs exactly those data banks. */
  const rom = romLib.buildToyRom({
    bank0: fs.readFileSync(ILVM),
    bytecode: v4.container,
    assets: v4.assets
  });
  check(Buffer.compare(Buffer.from(rom.slice(ILVM_BYTES)),
                       Buffer.from(v4.file)) === 0,
        "v4: buildToyRom lays the container and its asset banks exactly as " +
        "the harness runs them");

  /* ---- 4. scratch mutations: a broken copy must turn this red --------- */
  const source = fs.readFileSync(path.join(ROOT, "tools", "ilvm", "ilvm.c"),
                                 "utf8");
  const hostvmSrc = fs.readFileSync(
    path.join(ROOT, "tools", "ilvm", "hostvm.c"), "utf8");
  const shimSrc = fs.readFileSync(
    path.join(ROOT, "tools", "ilvm", "hutrack_engine.asm"), "utf8");
  /* (a) the bank operand is ignored: the copy reads bank 0. */
  const bankNeedle = "        sb = rb(pc++);\n        off = rw(pc);";
  check(source.indexOf(bankNeedle) >= 0,
        "the control mutation's anchor (the bank operand) is in ilvm.c");
  const mutant1 = source.replace(bankNeedle,
                                 "        sb = rb(pc++); sb = 0;\n        off = rw(pc);");
  /* (b) the boundary carry is one byte wrong after the crossing.  The
   * carry appears twice — after the low byte and after the high byte, so a
   * word that straddles the boundary is handled — and both must move. */
  const carryNeedle = "so = (uint16_t)(so - 0x2000); sb++;";
  check(source.indexOf(carryNeedle) >= 0,
        "the control mutation's anchor (the boundary carry) is in ilvm.c");
  check(source.split(carryNeedle).length === 3,
        "the boundary carry is checked after both bytes of a word");
  const mutant2 = source.split(carryNeedle).join(
    "so = (uint16_t)(so - 0x1FFF); sb++;");
  /* B5: the 13-bit off mask is removed entirely, so `so = off`.  Copy C's
   * off 0x2100 then reads bank 3 offset 0x100 — blob B's tail and fill,
   * not blob A's words at bank 2's masked 0x100. */
  const maskNeedle = "        so = (uint16_t)(off & 0x1FFF);";
  check(source.indexOf(maskNeedle) >= 0,
        "the B5 anchor (the 13-bit off mask) is in ilvm.c");
  const mutant5 = source.replace(maskNeedle, "        so = off;");
  /* The shim's half of the same agreement: `and #$1F` keeps the top three
   * bits out before the pointer's `ora #$40` (the MPR2 window), so a host
   * that masks and a shim that masks stay one contract. */
  const shimMaskNeedle = "    and #$1F\n    ora #$40";
  check(shimSrc.indexOf(shimMaskNeedle) >= 0,
        "the shim's 13-bit off mask (and #$1F, ora #$40) is in " +
        "hutrack_engine.asm");
  /* B7: map_data_bank folds banks >= 4 into the low two bits.  Copy D's
   * stream maps banks 4 and 5, which the fold turns into banks 0 and 1 —
   * the tables bank and the code bank, not blob D's bytes. */
  const foldNeedle = "  prog = ilvm_program + ((uint16_t)b << 13);";
  check(source.indexOf(foldNeedle) >= 0,
        "the B7 anchor (map_data_bank's host half) is in ilvm.c");
  const mutant7 = source.replace(
    foldNeedle, "  prog = ilvm_program + ((uint16_t)(b & 3) << 13);");
  /* B8: the VRAM write's 16-bit wrap is removed.  vram.bin cannot see this
   * (the harness masks & 0x7FFF and (x & 0xFFFF) & 0x7FFF == x & 0x7FFF),
   * so a trace build of hostvm.c prints UNWRAPPED for every pre-mask
   * address past 0xFFFF.  Copy E (VRAM 0xFF00, 300 words) is the only copy
   * whose writes cross 0x10000. */
  const wrapNeedle =
    "          toy_vram_set((int32_t)(uint16_t)(va + n2), (int32_t)w);";
  check(source.indexOf(wrapNeedle) >= 0,
        "the B8 anchor (the 16-bit VRAM wrap) is in ilvm.c");
  const mutant8 = source.replace(
    wrapNeedle, "          toy_vram_set((int32_t)(va + n2), (int32_t)w);");
  const traceNeedle = "  vram[addr & 0x7FFF] = (uint16_t)word;";
  check(hostvmSrc.indexOf(traceNeedle) >= 0,
        "the B8 trace anchor (toy_vram_set's mask) is in hostvm.c");
  const traceHostvm = hostvmSrc.replace(traceNeedle,
    "  vram[addr & 0x7FFF] = (uint16_t)word;\n" +
    "  if (addr > 0xFFFF) fprintf(stderr, \"UNWRAPPED %d\\n\", addr);");
  [["ignored bank operand", mutant1, 0x1000, v4.wordsA],
   ["one-byte boundary carry", mutant2, 0x2000, v4.wordsB],
   ["13-bit off mask removed (B5)", mutant5, 0x4000, v4.wordsA],
   ["data-bank fold for banks >= 4 (B7)", mutant7, 0x5000, v4.wordsD]]
  .forEach(function (m) {
    const name = m[0];
    const src = path.join(tmp, "ilvm-" + m[0].replace(/\W+/g, "-") + ".c");
    fs.writeFileSync(src, m[1]);
    const bin = src + ".hostvm";
    if (!buildHostvm(bin, src)) {
      check(false, "control mutation (" + name + "): the mutant builds");
      return;
    }
    const mv = run(bin, v4.file,
                   path.join(tmp, "mutant-" + m[0].replace(/\W+/g, "-")));
    check(mv !== null, "control mutation (" + name + "): the mutant runs");
    if (!mv) return;
    let differs = false;
    const want = m[3];
    for (let i = 0; i < want.length; i++) {
      if (mv[m[2] + i] !== want[i]) differs = true;
    }
    check(differs, "control mutation (" + name + ") changes the copied " +
          "words: the check would go red");
  });

  /* B8's wrap is the one break vram.bin cannot see; the trace build sees
   * what the harness masks away.  The intact host's copy E wraps its
   * addresses inside 16 bits, so no UNWRAPPED line may appear; the
   * wrap-removed host passes 0x10000..0x1002B and must. */
  const traceHostvmPath = path.join(tmp, "hostvm-trace.c");
  fs.writeFileSync(traceHostvmPath, traceHostvm);
  const traceBin = path.join(tmp, "hostvm-trace");
  if (!buildHostvm(traceBin, path.join(ROOT, "tools", "ilvm", "ilvm.c"),
                   traceHostvmPath)) {
    check(false, "the B8 trace hostvm builds");
  } else {
    const t1 = runResult(traceBin, v4.file, path.join(tmp, "trace-intact"));
    check(t1.status === 0, "B8 trace: the intact host runs");
    eq("B8 trace: the intact host never passes an unwrapped VRAM address " +
       "(copy E wraps at 0x10000)",
       (t1.stderr.match(/UNWRAPPED/g) || []).length, 0);
    const m8src = path.join(tmp, "ilvm-wrap-removed-B8.c");
    fs.writeFileSync(m8src, mutant8);
    const m8bin = m8src + ".hostvm";
    if (!buildHostvm(m8bin, m8src, traceHostvmPath)) {
      check(false, "B8 mutation: the wrap-removed mutant builds");
    } else {
      const m8 = runResult(m8bin, v4.file, path.join(tmp, "trace-mutant"));
      check(m8.status === 0, "B8 mutation: the wrap-removed mutant runs");
      check((m8.stderr.match(/UNWRAPPED/g) || []).length > 0,
            "B8 mutation: the wrap-removed host passes unwrapped VRAM " +
            "addresses past 0xFFFF (the check would go red)");
    }
  }
}

/* The committed image is the one every ROM embeds; check-ilvm rebuilds and
 * compares it.  Here only its size, so a truncated bank-3 shim cannot ride
 * along unnoticed when the rebuild tools are absent. */
eq("renderer/ilvm.bin is the 32 KiB image (the bank-3 CopyvShim rides in " +
   "bank 3)", fs.statSync(ILVM).size, 32768);

if (failures.length) {
  console.log("FAIL " + failures.length + " of " + checks + " checks");
  process.exit(1);
}
console.log("PASS " + checks + " checks");
