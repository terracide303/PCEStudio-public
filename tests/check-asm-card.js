#!/usr/bin/env node
/*
 * tests/check-asm-card.js — the HuCard builder and the first program
 * (card #231's closing evidence).
 *
 *   node tests/check-asm-card.js            run every check
 *   node tests/check-asm-card.js --write    also write tools/gen/asm-first.pce
 *                                           (tools/capture.sh asm-first runs
 *                                           this before launching Mednafen)
 *
 * NOTE ON AUTHORSHIP: written by the builder (@design) because the card's
 * close conditions need this script, following #230's precedent — rule 2
 * owed: a different seat must cold-break this check before the card closes.
 *
 * What it proves, and how:
 *
 *   builder       renderer/pce-card.js writes a .pce of the assembler's
 *                 -raw banks: a 512-byte header whose byte 0 is the bank
 *                 count and whose other bytes are zero, then the banks in
 *                 .bank order; pad:true $FF-fills to 48 banks (384 KB,
 *                 393,216 B) and pad (default false) leaves the image as is;
 *                 a 60-bank image pads only to its own 60.  The card byte
 *                 for a bank/address is header + bank*8192 + (address &
 *                 0x1FFF) — spot-checked at the example's vectors.
 *   named errors  the four refusals carry .code and sizes: card-size (an
 *                 image that is not whole banks, and the empty image),
 *                 card-too-big (129 banks > the HuCard's 128-bank 1 MB
 *                 decode, docs/MANUALS.md §15.1 GAP 4), bank-overflow (a
 *                 listing run crossing the top of its own 8 KB block —
 *                 measured: PCEAS drops or spills the excess, so the image
 *                 alone cannot show it), missing-vectors ($FFFE/$FFFF of
 *                 bank 0 is $0000 — after reset MPR7 = 0 and the CPU reads
 *                 the vector from bank 0, measured in Mednafen: a card
 *                 with vectors only in a later bank does not boot).
 *   bankRegions   pce-asm.js's bankRegions() splits the listing into
 *                 contiguous runs per bank (code at $E000 + vectors at
 *                 $FFF6 are two runs in bank 0), and a run PCEAS spills
 *                 across the bank edge appears as the tail in the next
 *                 bank.
 *   the example   examples/asm-first/main.asm assembles with the built-in
 *                 pce.inc (builtinIncludes) to one 8 KB bank, and WITHOUT
 *                 it the .include "pce.inc" fails — the include file is
 *                 really provided, not silently skipped.  The card built
 *                 from it (pad:true) is 393,728 B, says 48 banks, and
 *                 carries the stated palette words and tile words at the
 *                 assembler's own symbol addresses (read from .sym, not
 *                 invented here) and the reset vector $E000 at $FFFE.  The
 *                 committed asm-first.pcestudio round-trips to the same
 *                 main.asm and NOTES.md text (the project the card builds
 *                 from).
 *   the picture   the stated expected picture — the palette words, tile
 *                 rows and checkerboard rule in examples/asm-first/
 *                 NOTES.md, the ×36 RGB the renderer's cramEntry uses —
 *                 generated pixel by pixel, must equal the Mednafen
 *                 capture tests/dumps/asm-first/mednafen.png byte for
 *                 byte (diff 0).  No dump: a SKIP line with the command
 *                 that makes one, never a pass.
 *
 * NOT PROVEN: the expected picture shares the ×36 RGB formula with the
 * renderer, so a wrong shared formula would cancel (the renderer's own
 * diff-0-against-Mednafen tests are its separate guard); and the rules
 * were chosen by this seat — rule 2, see the note above.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const asmFormat = require("../renderer/pce-asm.js");
const card = require("../renderer/pce-card.js");
const projectFormat = require("../renderer/pce-project.js");

const EXAMPLE = path.join(ROOT, "examples", "asm-first");
const DUMP = path.join(ROOT, "tests", "dumps", "asm-first");
const DUMP_PNG = path.join(DUMP, "mednafen.png");

let checks = 0;
const failures = [];

function check(ok, what) {
  checks++;
  if (!ok) { failures.push(what); console.log("FAIL  " + what); }
}
function eq(what, got, want) {
  check(JSON.stringify(got) === JSON.stringify(want),
        what + " (got " + JSON.stringify(got) + ", want " +
        JSON.stringify(want) + ")");
}
function shaOf(bytes) {
  return crypto.createHash("sha256")
    .update(Buffer.from(bytes.buffer || bytes,
                        bytes.byteOffset || 0, bytes.byteLength))
    .digest("hex");
}

/* ---- minimal PNG reader: 8-bit, non-interlaced, colour types 0/2/6 ---- */
function decodePng(buf) {
  if (buf.slice(0, 8).toString("latin1") !== "\x89PNG\r\n\x1a\n")
    throw new Error("not a PNG");
  let pos = 8;
  let width = 0, height = 0, bitDepth = 0, colourType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.slice(pos + 4, pos + 8).toString("latin1");
    const data = buf.slice(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colourType = data[9];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
  }
  if (bitDepth !== 8 || [0, 2, 6].indexOf(colourType) < 0)
    throw new Error(`unsupported PNG ${bitDepth}bpp type ${colourType}`);
  const chans = { 0: 1, 2: 3, 6: 4 }[colourType];
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * chans;
  const out = Buffer.alloc(width * height * 3);
  const prev = Buffer.alloc(stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const f = raw[p++];
    const line = raw.slice(p, p + stride);
    p += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= chans ? line[i - chans] : 0;
      const b = prev[i];
      const c = i >= chans ? prev[i - chans] : 0;
      if (f === 1) line[i] = (line[i] + a) & 0xFF;
      else if (f === 2) line[i] = (line[i] + b) & 0xFF;
      else if (f === 3) line[i] = (line[i] + ((a + b) >> 1)) & 0xFF;
      else if (f === 4) {
        const pa = Math.abs(a + b - c - a), pb = Math.abs(a + b - c - b),
              pc = Math.abs(a + b - c - c);
        line[i] = (line[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xFF;
      }
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 3;
      if (chans === 1) {
        out[o] = out[o + 1] = out[o + 2] = line[x];
      } else {
        out[o] = line[x * chans];
        out[o + 1] = line[x * chans + 1];
        out[o + 2] = line[x * chans + 2];
      }
    }
    line.copy(prev);
  }
  return { width, height, pixels: out };
}

function readAsmInc() {
  return fs.readFileSync(path.join(ROOT, "renderer", "asm", "pce.inc"),
                         "utf8");
}

/* ---- 1. the builder ----------------------------------------------------- */

function checkBuilder() {
  const b = new Uint8Array(card.BANK);
  b.fill(0x55);
  b[card.BANK - 2] = 0xAB;           /* a reset vector, so it is not refused */
  b[card.BANK - 1] = 0xCD;

  /* unpadded: 512-byte header (byte 0 = bank count, rest zero) + the bank */
  const plain = card.build(b);
  eq("#231: one bank, no pad, is 512 + 8192 bytes", plain.length,
     card.HEADER + card.BANK);
  eq("#231: the header's byte 0 is the bank count", plain[0], 1);
  check(plain.slice(1, card.HEADER).every((x) => x === 0),
        "#231: the header's other 511 bytes are zero");
  check(plain.slice(card.HEADER, card.HEADER + 2).every((x) => x === 0x55),
        "#231: the bank follows the header byte for byte");

  /* padded: $FF-fill to 48 banks, the image untouched */
  const padded = card.build(b, { pad: true });
  eq("#231: padded, one bank, is 48 banks", padded.length,
     card.HEADER + 48 * card.BANK);
  eq("#231: the padded card's header says 48 banks", padded[0], 48);
  check(padded.slice(card.HEADER + card.BANK).every((x) => x === 0xFF),
        "#231: the pad beyond the image is $FF (unprogrammed EPROM)");
  check(padded.slice(card.HEADER, card.HEADER + card.BANK)
          .every((x, i) => x === b[i]),
        "#231: the pad leaves the image itself untouched");

  /* a 60-bank image pads only to its own 60 (the image wins over 48) */
  const big = new Uint8Array(60 * card.BANK);
  big[card.BANK - 2] = 1;
  const bigPadded = card.build(big, { pad: true });
  eq("#231: a 60-bank image pads to 60 banks, not 48", bigPadded.length,
     card.HEADER + 60 * card.BANK);
  eq("#231: ... and its header says 60", bigPadded[0], 60);

  /* two banks: the card bytes follow .bank order */
  const two = new Uint8Array(2 * card.BANK);
  two[0] = 0x11;
  two[card.BANK] = 0x22;
  two[card.BANK - 2] = 1;
  const twoCard = card.build(two);
  eq("#231: two banks, no pad, is 512 + 16384 bytes", twoCard.length,
     card.HEADER + 2 * card.BANK);
  eq("#231: bank 0's first byte lands at offset 512",
     twoCard[card.HEADER], 0x11);
  eq("#231: bank 1's first byte lands at offset 512 + 8192",
     twoCard[card.HEADER + card.BANK], 0x22);
  eq("#231: the header's byte 0 is the bank count", twoCard[0], 2);
}

/* ---- 2. the named errors ------------------------------------------------ */

function checkNamedErrors() {
  /* card-size: not whole banks, and empty — each names its size */
  for (const [what, bytes, wantText] of [
    ["a byte short of one bank", new Uint8Array(card.BANK - 1), "8191 B"],
    ["one byte past one bank", new Uint8Array(card.BANK + 1), "8193 B"],
    ["the empty image", new Uint8Array(0), "empty"]
  ]) {
    let err = null;
    try { card.build(bytes); } catch (e) { err = e; }
    check(err && err.code === "card-size",
          `#231: ${what} is refused as card-size`);
    check(err && String(err.message).indexOf(wantText) >= 0,
          `#231: the card-size error carries the size (${what})`);
  }

  /* card-too-big: 129 banks is one past the 1 MB decode */
  const tooBig = new Uint8Array(129 * card.BANK);
  tooBig[card.BANK - 2] = 1;
  let err = null;
  try { card.build(tooBig); } catch (e) { err = e; }
  check(err && err.code === "card-too-big",
        "#231: 129 banks is refused as card-too-big");
  check(err && /1056768 B/.test(err.message) && /128 banks/.test(err.message),
        "#231: the card-too-big error carries the sizes");

  /* bank-overflow: PCEAS drops or spills a run that crosses its 8 KB
   * block's top (measured: 20 bytes of .db at $1FF0 — the window is
   * $0000-$1FFF — are dropped, the image alone cannot show it, but the
   * listing's run runs to $2005). */
  const overflowSrc = [
    "\t.org $1FF0",
    "start:",
    "\trts",
    "\t.db 1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20",
    "\t.org $FFF6",
    "\t.dw start, start, start, start, start",
    ""
  ].join("\n");
  const overflowAsm = asmFormat.assemble(overflowSrc,
                                        { filename: "overflow.asm" });
  check(overflowAsm.status === 0, "#231: the overflow source assembles " +
        "(PCEAS dropped the excess silently — the image is intact)");
  err = null;
  try {
    card.build(overflowAsm.bytes,
               { layout: asmFormat.bankRegions(overflowAsm.listing) });
  } catch (e) { err = e; }
  check(err && err.code === "bank-overflow",
        "#231: the dropped run is refused as bank-overflow");
  check(err && /bank 0/.test(err.message) && /21 B/.test(err.message) &&
        /\$1ff0/.test(err.message) && /\$2000/.test(err.message),
        "#231: the bank-overflow error names the bank, run and sizes (" +
        String(err && err.message) + ")");

  /* the same layout on the image alone cannot refuse anything — the error
   * comes from the listing, which the studio always passes */
  err = null;
  try { card.build(overflowAsm.bytes); } catch (e) { err = e; }
  check(!err, "#231: without the layout the dropped run is invisible " +
        "(that is why the studio passes it)");

  /* missing-vectors: $FFFE/$FFFF of bank 0 is $0000 — the card would not
   * boot (measured: after reset MPR7 = 0, the CPU reads the vector from
   * bank 0, so vectors only in a later bank boot to a white screen) */
  const noVec = new Uint8Array(card.BANK);
  noVec[0] = 0x55;
  err = null;
  try { card.build(noVec); } catch (e) { err = e; }
  check(err && err.code === "missing-vectors",
        "#231: a bank 0 with a $0000 reset vector is refused as " +
        "missing-vectors");
  check(err && /\$FFFE-\$FFFF/.test(err.message),
        "#231: the missing-vectors error names the vector's addresses");
}

/* ---- 3. bankRegions ----------------------------------------------------- */

function checkRegions() {
  /* code at $E000 + vectors at $FFF6: two runs in bank 0 */
  const src = [
    "\t.org $E000",
    "start:",
    "\trts",
    "\t.org $FFF6",
    "\t.dw start, start, start, start, start",
    ""
  ].join("\n");
  const r = asmFormat.assemble(src, { filename: "regions.asm" });
  check(r.status === 0, "#231: the two-region source assembles");
  eq("#231: bankRegions splits the two runs of bank 0",
     asmFormat.bankRegions(r.listing).map((s) => [s.bank, s.from, s.to,
                                                  s.bytes]),
     [[0, 0xe000, 0xe001, 1], [0, 0xfff6, 0x10000, 10]]);

  /* a run PCEAS spills across the bank edge: $1FFE code keeps its tail in
   * bank 1 (measured) — the tail is the next bank's first run */
  const spill = [
    "\t.org $1FFE",
    "\tnop",
    "\tnop",
    "\tnop",
    "\tnop",
    "\tnop",
    "\trts",
    "\t.org $FFF6",
    "\t.dw $1FFE, $1FFE, $1FFE, $1FFE, $1FFE",
    ""
  ].join("\n");
  const s = asmFormat.assemble(spill, { filename: "spill.asm" });
  check(s.status === 0, "#231: the spilling source assembles (PCEAS " +
        "warns and grows the image)");
  eq("#231: the spill's tail is a run of bank 1",
     asmFormat.bankRegions(s.listing).map((x) => [x.bank, x.from, x.to]),
     [[0, 0x1ffe, 0x2001], [1, 0x2001, 0x2004], [1, 0xfff6, 0x10000]]);
  eq("#231: bankSizes still totals the per-bank bytes",
     asmFormat.bankSizes(s.listing).map((x) => [x.bank, x.bytes]),
     [[0, 3], [1, 13]]);
}

/* ---- 4. the example ----------------------------------------------------- */

function symAddr(sym, name) {
  /* .sym lines are tab-separated: "NN\tAAAA\tname\t..." */
  const m = sym.match(new RegExp("^..\\t([0-9a-f]{4})\\t" + name +
                                 "(\\t|$)", "m"));
  return m ? parseInt(m[1], 16) : null;
}

function checkExample() {
  const src = fs.readFileSync(path.join(EXAMPLE, "main.asm"), "utf8");

  /* the built-in pce.inc: with it the project assembles ... */
  const r = asmFormat.assemble(src, {
    filename: "main.asm",
    builtinIncludes: { "pce.inc": readAsmInc() }
  });
  check(r.status === 0,
        "#231: the example assembles with the built-in pce.inc (" +
        (r.status === 0 ? "" : JSON.stringify(r.errors)) + ")");
  eq("#231: the example is one 8 KB bank", r.bytes.length, card.BANK);
  eq("#231: its readout regions are the vectors and the code",
     asmFormat.bankRegions(r.listing).map((x) => [x.bank, x.from]),
     [[0, 0xfff6], [0, 0xe000]]);

  /* ... and without it (no project copy either) the include is a real
   * missing file, not a silently skipped one */
  const missing = asmFormat.assemble(src, { filename: "main.asm" });
  check(missing.status !== 0 &&
        /Can not open file/.test(JSON.stringify(missing.errors)),
        "#231: without the built-in, .include \"pce.inc\" fails as a " +
        "missing file (" + JSON.stringify(missing.errors) + ")");

  /* the card the studio's Export writes: pad:true, 48 banks */
  const out = card.build(r.bytes, {
    layout: asmFormat.bankRegions(r.listing), pad: true
  });
  eq("#231: the example's card is 393,728 B (48 banks)",
     out.length, card.HEADER + 48 * card.BANK);
  eq("#231: ... and its header says 48 banks", out[0], 48);
  /* a card byte is header + bank*8192 + (address & 0x1FFF): bank 0's
   * $FFFE/$FFFF are the image's last two bytes */
  eq("#231: the reset vector at $FFFE/$FFFF is $E000",
     [out[card.HEADER + (0xfffe & 0x1fff)],
      out[card.HEADER + (0xffff & 0x1fff)]], [0x00, 0xe0]);

  /* the stated palette words and tile words, at the assembler's own
   * symbol addresses — the picture is a function of these bytes */
  const palAddr = symAddr(r.sym, "palette_words");
  const tileAddr = symAddr(r.sym, "tile_words");
  check(palAddr !== null && tileAddr !== null,
        "#231: the .sym carries palette_words and tile_words");
  const palBytes = [];
  for (let i = 0; i < 8; i++) {
    palBytes.push(out[card.HEADER + ((palAddr + i) & 0x1fff)]);
  }
  eq("#231: the card's palette_words are the stated words",
     Array.from(palBytes), [0x47, 0x00, 0xb8, 0x01, 0x3d, 0x00, 0x45, 0x01]);
  const tileBytes = [];
  for (let i = 0; i < 64; i++) {
    tileBytes.push(out[card.HEADER + ((tileAddr + i) & 0x1fff)]);
  }
  /* each character is 16 words: 8 rows of CH0/CH1 then 8 rows of CH2/CH3
   * (zero — unused in 2-bit colour) */
  eq("#231: the card's tile_words are the stated rows",
     Array.from(tileBytes),
     [0x6c, 0x00, 0x81, 0x7e, 0x81, 0x7e, 0x42, 0x3c,
      0x24, 0x18, 0x18, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x18, 0x18, 0x24, 0x24, 0x42, 0x42, 0x81, 0x81,
      0x81, 0x81, 0x42, 0x42, 0x24, 0x24, 0x18, 0x18,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);

  /* the committed .pcestudio round-trips to the committed sources */
  const archive = projectFormat.parseBytes(fs.readFileSync(
    path.join(EXAMPLE, "asm-first.pcestudio")));
  eq("#231: the committed project says kind assembly", archive.kind,
     "assembly");
  eq("#231: ... and holds main.asm and NOTES.md",
     archive.files.map((f) => f.name + ":" + f.kind),
     ["main.asm:asm", "NOTES.md:notes"]);
  const inArchive = {};
  for (const f of archive.files) inArchive[f.name] = f.source;
  eq("#231: the archive's main.asm is the committed source",
     inArchive["main.asm"], src);
  eq("#231: the archive's NOTES.md is the committed notes",
     inArchive["NOTES.md"],
     fs.readFileSync(path.join(EXAMPLE, "NOTES.md"), "utf8"));
}

/* ---- 5. the stated picture ---------------------------------------------- */

function checkPicture() {
  if (!fs.existsSync(DUMP_PNG)) {
    console.log(`SKIP: asm-first — no Mednafen capture in ` +
                `tests/dumps/asm-first/; run tools/capture.sh asm-first`);
    return;
  }
  /* the stated constants (examples/asm-first/NOTES.md), restated here so
   * the expected picture is a function of this file's own numbers */
  const palette = [0x047, 0x1b8, 0x03d, 0x145];
  const rgbOf = (w) => [36 * ((w >> 3) & 7), 36 * ((w >> 6) & 7),
                        36 * (w & 7)];
  /* 32 words: heart rows 0-7, its zero CH2/CH3 rows, diamond rows 0-7,
   * its zero CH2/CH3 rows */
  const tileWords = [
    0x006c, 0x7e81, 0x7e81, 0x3c42, 0x1824, 0x0018, 0x0000, 0x0000,
    0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000,
    0x1818, 0x2424, 0x4242, 0x8181, 0x8181, 0x4242, 0x2424, 0x1818,
    0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000
  ];
  const tilePixel = (t, px, py) =>
    ((tileWords[t * 16 + py] >> (7 - px)) & 1) |
    (((tileWords[t * 16 + py] >> (15 - px)) & 1) << 1);

  /* The capture's first row is VCE line 18, which is not necessarily VDW
   * line 0: the VDC's own registers say which VDW line it is (the same
   * calibration renderer/pce-bg.js uses).  The stated picture is the
   * checkerboard at that phase. */
  const regs = JSON.parse(fs.readFileSync(path.join(DUMP, "regs.json"),
                                          "utf8"));
  const vdwLine0 = regs.RCRCount - (regs.scanline - 18);
  check(vdwLine0 >= 0 && vdwLine0 < 8,
        "#231: the dump's registers put the crop in one tile row " +
        `(vdwLine0 ${vdwLine0})`);
  const pixelAt = (x, y) => {
    const v = y + vdwLine0;
    const t = ((x >> 3) + (v >> 3)) & 1;
    const pv = tilePixel(t, x & 7, v & 7);
    return rgbOf(palette[pv]);
  };

  const frame = decodePng(fs.readFileSync(DUMP_PNG));
  eq("#231: the capture is 256x232", [frame.width, frame.height],
     [256, 232]);
  let bad = 0;
  let firstBad = null;
  for (let y = 0; y < frame.height; y++) {
    for (let x = 0; x < frame.width; x++) {
      const want = pixelAt(x, y);
      const o = (y * frame.width + x) * 3;
      if (frame.pixels[o] !== want[0] || frame.pixels[o + 1] !== want[1] ||
          frame.pixels[o + 2] !== want[2]) {
        if (bad === 0) {
          firstBad = `(${x},${y}): got ` +
            `${frame.pixels[o]},${frame.pixels[o + 1]},${frame.pixels[o + 2]}` +
            ` want ${want[0]},${want[1]},${want[2]}`;
        }
        bad++;
      }
    }
  }
  check(bad === 0,
        `#231: the capture equals the stated picture, diff 0 (` +
        `${bad} mismatching pixels${firstBad ? ", first " + firstBad : ""})`);
}

/* ---- main --------------------------------------------------------------- */

(function main() {
  checkBuilder();
  checkNamedErrors();
  checkRegions();
  checkExample();
  checkPicture();

  if (process.argv.indexOf("--write") >= 0) {
    const src = fs.readFileSync(path.join(EXAMPLE, "main.asm"), "utf8");
    const r = asmFormat.assemble(src, {
      filename: "main.asm",
      builtinIncludes: { "pce.inc": readAsmInc() }
    });
    if (r.status !== 0) {
      console.log("FAIL  --write: the example did not assemble");
      process.exit(1);
    }
    const out = card.build(r.bytes, {
      layout: asmFormat.bankRegions(r.listing), pad: true
    });
    const outPath = path.join(ROOT, "tools", "gen", "asm-first.pce");
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, out);
    console.log(`wrote ${outPath} (${out.length} B, sha256 ` +
                `${shaOf(out).slice(0, 16)}…)`);
  }

  console.log(failures.length
    ? `FAIL  ${failures.length} of ${checks} checks failed`
    : `PASS  ${checks} checks`);
  process.exit(failures.length ? 1 : 0);
}());
