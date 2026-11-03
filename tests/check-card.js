#!/usr/bin/env node
/*
 * tests/check-card.js — card #231: the hardware include file, the HuCard
 * builder, and the first program.
 *
 *   1. renderer/asm/pce.inc: the names this check needs have the values the
 *      manual tables in docs/MANUALS.md give, each name is defined once, and
 *      a source that includes it (twice — the guard works) assembles clean.
 *   2. renderer/pce-card.js builds examples/asm-first's assembly into a
 *      .pce: 8,192 B, one bank, reset vector $E000, and the same sha256 as
 *      the committed Mednafen dump's meta.json records.
 *   3. the stated expected picture.  The program's own header and
 *      tests/dumps/asm-first/meta.json state it: 256x232, every pixel the
 *      backdrop $007 = RGB(0,0,252) except an 8x8 block at x 32..39,
 *      y 32..39 in $1F8 = RGB(252,252,0).  The Mednafen capture must differ
 *      from that construction in zero pixels; expected.png (written by
 *      --write) is the same construction as a committed picture and is
 *      compared byte for byte.
 *   4. the saved console state says the same: CRAM[0] = $007, CRAM[1] =
 *      $1F8; the BAT cell is pattern $41 with pattern $40 everywhere else;
 *      pattern $41's CH0 is all ones and CH1..CH3 zero; the VDC registers
 *      are the 256x240 window and VCE CR is the /4 clock.
 *   5. the named refusals: a bank that overflows into the next one gives
 *      card-bank-overflow with the used/capacity/over sizes; a boot bank
 *      with no reset vector gives card-vectors; 129 banks gives
 *      card-too-big with the sizes.
 *   6. the optional 384 KiB padding rule: the example padded to 393,216 B
 *      (48 banks), the image's first bank unchanged and the rest $FF.
 *
 * Written by @design because the card names this evidence.  Rule 2: a cold
 * break by another seat is owed before the card closes.
 *
 *   node tests/check-card.js          # compare the committed capture
 *   node tests/check-card.js --write  # also write expected.png
 */
"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const asm = require(path.join(ROOT, "renderer", "pce-asm.js"));
const card = require(path.join(ROOT, "renderer", "pce-card.js"));

const PCE_INC = path.join(ROOT, "renderer", "asm", "pce.inc");
const EXAMPLE = path.join(ROOT, "examples", "asm-first", "main.asm");
const DUMP = path.join(__dirname, "dumps", "asm-first");

let checks = 0;
const failures = [];
function check(ok, name) {
  checks++;
  if (!ok) { failures.push(name); console.log("FAIL  " + name); }
  else console.log("ok    " + name);
}
function eq(name, got, want) {
  check(JSON.stringify(got) === JSON.stringify(want),
        name + " (got " + JSON.stringify(got) + ", want " +
        JSON.stringify(want) + ")");
}

/* ---- a minimal PNG reader and writer (8-bit, non-interlaced, RGB/RGBA) -- */
function decodePng(buf) {
  if (buf.slice(0, 8).toString("latin1") !== "\x89PNG\r\n\x1a\n")
    throw new Error("not a PNG");
  let pos = 8, width = 0, height = 0, bitDepth = 0, colourType = 0;
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
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
  }
  if (bitDepth !== 8 || [0, 2, 6].indexOf(colourType) < 0)
    throw new Error("unsupported PNG " + bitDepth + "bpp type " + colourType);
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
      if (chans === 1) out[o] = out[o + 1] = out[o + 2] = line[x];
      else {
        out[o] = line[x * chans];
        out[o + 1] = line[x * chans + 1];
        out[o + 2] = line[x * chans + 2];
      }
    }
    line.copy(prev);
  }
  return { width, height, pixels: out };
}

function crc32(buf) {
  let c, crc = 0xFFFFFFFF;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xFF;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >> 1)) : (c >> 1);
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;      /* bit depth */
  ihdr[9] = 2;      /* RGB */
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 3)] = 0;      /* filter: none */
    pixels.copy(raw, y * (1 + width * 3) + 1, y * width * 3,
                (y + 1) * width * 3);
  }
  return Buffer.concat([
    Buffer.from("\x89PNG\r\n\x1a\n", "latin1"),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

/* ---- the example ------------------------------------------------------- */
function buildExample(opts) {
  const inc = fs.readFileSync(PCE_INC, "utf8");
  const source = fs.readFileSync(EXAMPLE, "utf8");
  const assembled = asm.assemble(source, {
    filename: "main.asm", includes: { "pce.inc": inc }
  });
  if (assembled.errors.length) {
    return { errors: assembled.errors, assembled: assembled };
  }
  const banks = asm.bankSizes(assembled.listing);
  const rom = card.build(Object.assign({ bytes: assembled.bytes, banks: banks },
                                       opts || {}));
  return { errors: [], assembled: assembled, banks: banks, rom: rom };
}

/* ---- 1. the include file ---------------------------------------------- */
function checkInclude() {
  const text = fs.readFileSync(PCE_INC, "utf8");
  const names = {};
  const dups = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^;]+?)\s*(?:;.*)?$/.exec(line);
    if (!m) continue;
    if (Object.prototype.hasOwnProperty.call(names, m[1])) dups.push(m[1]);
    const expr = m[2].trim().replace(/\$([0-9A-Fa-f]+)/g, "0x$1");
    let value = null;
    try {
      /* the file's own constants are plain PCEAS expressions: numbers,
       * names defined above, + - | << */
      value = Function("n", "with (n) { return (" + expr + "); }")(names);
    } catch (e) { value = null; }
    names[m[1]] = value;
  }
  eq("1. no hardware name is defined twice", dups, []);
  const want = {
    MPR0_MASK: 0x01, MPR7_MASK: 0x80,
    BANK_SIZE: 0x2000, CARD_BANKS: 128,
    VDC_REG: 0x0000, VDC_STATUS: 0x0000, VDC_DATA_LO: 0x0002,
    VDC_DATA_HI: 0x0003, VDC_CR: 0x05, VDC_MWR: 0x09,
    VDC_CR_IE_RC: 0x0004, VDC_CR_SB: 0x0040, VDC_CR_BB: 0x0080,
    VDC_SR_CC: 0x01, VDC_SR_OR: 0x02, VDC_SR_VD: 0x20, VDC_SR_BSY: 0x40,
    VDC_MWR_SCREEN_32x32: 0x00, VDC_MWR_SCREEN_128x64: 0x60,
    VDC_DCR_DSR: 0x10, VDC_DCR_SRC_DEC: 0x04, VDC_DCR_DST_DEC: 0x08,
    BAT_CHAR_MASK: 0x0FFF, BAT_CG_SHIFT: 12, CHAR_WORDS: 16,
    SPRITE_CELL_WORDS: 64, SAT_W3_SPBG: 0x0080, SAT_W3_VFLIP: 0x8000,
    VCE_CR: 0x0400, VCE_CTA_LO: 0x0402, VCE_CTW_HI: 0x0405,
    VCE_BORDER_INDEX: 0x100, VCE_COLOUR_MASK: 0x1FF,
    VCE_CR_CLOCK_4: 0x00, VCE_CR_CLOCK_2: 0x02, VCE_CR_MONO: 0x80,
    PSG_R0_CHANNEL: 0x0800, PSG_R6_WAVE: 0x0806, PSG_R9_LFO_CTRL: 0x0809,
    PSG_CTRL_ON: 0x80, PSG_CTRL_DDA: 0x40, PSG_CTRL_AL_MASK: 0x1F,
    PSG_LFO_TRIGGER: 0x80, PSG_NOISE_ON: 0x80,
    TIMER_COUNT: 0x0C00, TIMER_CONTROL: 0x0C01, TIMER_START: 0x01,
    TIMER_RELOAD_MASK: 0x7F,
    IRQ_DISABLE: 0x1402, IRQ_REQUEST: 0x1403,
    IRQ_DISABLE_IRQ2: 0x01, IRQ_DISABLE_IRQ1: 0x02,
    IRQ_DISABLE_TIMER: 0x04,
    JOY_PORT: 0x1000, JOY_SEL: 0x01, JOY_CLR: 0x02,
    JOY_PAD_UP: 0x01, JOY_PAD_DOWN: 0x02, JOY_PAD_LEFT: 0x08,
    JOY_BTN_I: 0x01, JOY_BTN_RUN: 0x08, JOY_NONE: 0x0F
  };
  for (const name of Object.keys(want)) {
    eq("1. " + name + " is $" + want[name].toString(16), names[name], want[name]);
  }

  /* a source that uses the names assembles; include it twice to prove the
   * guard, and place the vectors so the layout is a real card. */
  const source = [
    "\t.code", "\t.bank 0", "\t.org $E000",
    "\t.include \"pce.inc\"", "\t.include \"pce.inc\"",
    "start:",
    "\tlda #(VDC_CR_BB | VDC_CR_SB)",
    "\tsta VDC_REG",
    "\tlda #(PSG_CTRL_ON | PSG_CTRL_DDA)",
    "\tsta PSG_R4_CONTROL",
    "\tlda #JOY_SEL", "\tsta JOY_PORT",
    "\tstz TIMER_COUNT", "\tlda #TIMER_START", "\tsta TIMER_CONTROL",
    "\tjmp start",
    "\t.org $FFF6", "\t.dw start, start, start, start, start", ""
  ].join("\n");
  const r = asm.assemble(source, { filename: "main.asm",
                                   includes: { "pce.inc": text } });
  eq("1. a program using the names assembles (and the include guard holds)",
     r.errors.map((e) => e.line + ":" + e.message), []);
  check(r.bytes.length === 8192, "1. ... to one 8 KiB bank");
}

/* ---- 2. the builder ---------------------------------------------------- */
function checkBuilder() {
  const built = buildExample();
  eq("2. the example assembles with no errors",
     built.errors.map((e) => e.line + ":" + e.message), []);
  eq("2. the assembled image is one 8 KiB bank", built.assembled.bytes.length,
     8192);
  eq("2. the ROM is the assembled bytes (no relocation)",
     Buffer.compare(Buffer.from(built.rom.bytes),
                    Buffer.from(built.assembled.bytes)), 0);
  eq("2. the reset vector is $E000", built.rom.vector.reset, 0xE000);
  eq("2. the five vectors are irq2/irq1/timer/nmi/reset",
     built.rom.vector.table, [0xE0CD, 0xE0CD, 0xE0CD, 0xE0CD, 0xE000]);
  const sha = crypto.createHash("sha256").update(built.rom.bytes).digest("hex");

  const meta = JSON.parse(fs.readFileSync(path.join(DUMP, "meta.json"), "utf8"));
  eq("2. the dump's meta records this ROM's size", meta.rom.size, 8192);
  eq("2. the dump's meta records this ROM's sha256", meta.rom.sha256, sha);
  eq("2. the dump was built from this example", meta.source,
     "examples/asm-first/main.asm");

  /* the refusals */
  const overflowSource = ["\t.code", "\t.bank 0", "\t.org $E000"]
    .concat(Array(8300).fill("\t.db $AA")).join("\n") + "\n";
  const over = asm.assemble(overflowSource, { filename: "main.asm" });
  let error = null;
  try {
    card.build({ bytes: over.bytes, banks: asm.bankSizes(over.listing) });
  } catch (e) { error = e; }
  check(error && error.code === "card-bank-overflow",
        "2. a bank that overflows into the next gives card-bank-overflow");
  check(error && error.bank === 0 && error.used === 8300 &&
        error.capacity === 8192 && error.over === 108,
        "2. ... with the used, capacity and over sizes (got " +
        (error ? JSON.stringify({ bank: error.bank, used: error.used,
          capacity: error.capacity, over: error.over }) : "no error") + ")");
  check(error && /bank 0 holds 8300 B in an 8192 B bank \(108 B over\)/
        .test(error.message),
        "2. ... and the message names the bank and both sizes");

  /* the other overflow shape: a source that starts near $FFFF and wraps to
   * the bottom of the same bank (PCEAS fills the wrapped bytes with $FF) */
  const endSource = ["\t.code", "\t.bank 0", "\t.org $FFF6",
                     "\t.dw 1,2,3,4,5,6,7,8,9,10", ""].join("\n");
  const end = asm.assemble(endSource, { filename: "main.asm" });
  error = null;
  try {
    card.build({ bytes: end.bytes, banks: asm.bankSizes(end.listing) });
  } catch (e) { error = e; }
  check(error && error.code === "card-bank-overflow" &&
        error.used === 20 && error.capacity === 10 && error.over === 10,
        "2. a source that runs off $FFFF gives card-bank-overflow with the " +
        "room and the overrun (got " +
        (error ? JSON.stringify({ used: error.used, capacity: error.capacity,
          over: error.over }) : "no error") + ")");
  check(error && /from \$FFF6 and runs 10 B past \$FFFF \(10 B fit after/
        .test(error.message),
        "2. ... naming $FFF6, the overrun and the room");

  const noVectors = asm.assemble(
    "\t.code\n\t.bank 0\n\t.org $E000\n\tnop\n", { filename: "main.asm" });
  error = null;
  try {
    card.build({ bytes: noVectors.bytes,
                 banks: asm.bankSizes(noVectors.listing) });
  } catch (e) { error = e; }
  check(error && error.code === "card-vectors",
        "2. a boot bank with no reset vector gives card-vectors");

  const big = new Uint8Array(129 * 8192).fill(0xFF);
  big[0x1FFE] = 0x00;
  big[0x1FFF] = 0xE0;
  error = null;
  try { card.build({ bytes: big }); } catch (e) { error = e; }
  check(error && error.code === "card-too-big" && error.used === 129 * 8192 &&
        error.capacity === 128 * 8192 && error.over === 8192,
        "2. 129 banks gives card-too-big with the sizes");

  /* 6. the optional padding rule */
  const padded = buildExample({ pad384: true });
  eq("6. pad384 makes a 393,216 B image", padded.rom.size, 393216);
  eq("6. ... 48 banks", padded.rom.imageBanks, 48);
  eq("6. ... and records 385,024 B of padding", padded.rom.padding, 385024);
  check(Buffer.compare(Buffer.from(padded.rom.bytes.slice(0, 8192)),
                       Buffer.from(built.rom.bytes)) === 0,
        "6. the padded image's first bank is unchanged");
  let tailFF = true;
  for (let i = 8192; i < padded.rom.bytes.length; i++) {
    if (padded.rom.bytes[i] !== 0xFF) { tailFF = false; break; }
  }
  check(tailFF, "6. every padded byte is $FF (the erased ROM byte)");
}

/* ---- 3/4. the stated picture and the saved state ---------------------- */
function expectedPicture() {
  const meta = JSON.parse(fs.readFileSync(path.join(DUMP, "meta.json"), "utf8"));
  const e = meta.expected;
  const width = 256, height = 232;
  const px = Buffer.alloc(width * height * 3);
  const wordRGB = (w) => [36 * ((w >> 3) & 7), 36 * ((w >> 6) & 7),
                          36 * (w & 7)];
  const back = wordRGB(parseInt(e.backdrop.slice(1), 16));
  const block = wordRGB(parseInt(e.block.slice(1), 16));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inBlock = x >= e.x0 && x < e.x1 && y >= e.y0 && y < e.y1;
      const c = inBlock ? block : back;
      const o = (y * width + x) * 3;
      px[o] = c[0];
      px[o + 1] = c[1];
      px[o + 2] = c[2];
    }
  }
  return { width: width, height: height, pixels: px, meta: meta, e: e };
}

function checkPicture(write) {
  const want = expectedPicture();
  const expectedPath = path.join(DUMP, "expected.png");
  const expected = encodePng(want.width, want.height, want.pixels);
  if (write) fs.writeFileSync(expectedPath, expected);

  const got = decodePng(fs.readFileSync(path.join(DUMP, "mednafen.png")));
  eq("3. the capture is 256x232", [got.width, got.height], [256, 232]);
  let diffs = 0, first = null;
  for (let i = 0; i < got.pixels.length; i++) {
    if (got.pixels[i] !== want.pixels[i]) {
      diffs++;
      if (first === null) {
        const p = ((i / 3) | 0);
        first = "px(" + (p % got.width) + "," + ((p / got.width) | 0) + ") " +
                "captured " + [got.pixels[i - (i % 3)],
                               got.pixels[i - (i % 3) + 1],
                               got.pixels[i - (i % 3) + 2]].join(",") +
                " expected " + [want.pixels[i - (i % 3)],
                                want.pixels[i - (i % 3) + 1],
                                want.pixels[i - (i % 3) + 2]].join(",");
      }
    }
  }
  check(diffs === 0, "3. the Mednafen picture differs from the stated " +
        "picture in 0 pixels (" + diffs + " differ" +
        (first ? "; first " + first : "") + ")");

  /* the picture is exactly two colours, and the block covers 8x8 = 64 of
   * the block colour (the rest is the backdrop). */
  const colours = new Set();
  let blockPixels = 0, backPixels = 0;
  const blockRGB = want.pixels[(want.e.y0 * want.width + want.e.x0) * 3] + "," +
                   want.pixels[(want.e.y0 * want.width + want.e.x0) * 3 + 1] + "," +
                   want.pixels[(want.e.y0 * want.width + want.e.x0) * 3 + 2];
  const backRGB = want.pixels[0] + "," + want.pixels[1] + "," +
                  want.pixels[2];
  for (let y = 0; y < got.height; y++) {
    for (let x = 0; x < got.width; x++) {
      const o = (y * got.width + x) * 3;
      const key = got.pixels[o] + "," + got.pixels[o + 1] + "," +
                  got.pixels[o + 2];
      colours.add(key);
      if (key === blockRGB) blockPixels++;
      if (key === backRGB) backPixels++;
    }
  }
  eq("3. the capture has exactly two colours", colours.size, 2);
  eq("3. the block is the 8x8 = 64 pixels the program marks", blockPixels, 64);
  eq("3. every other pixel is the backdrop",
     backPixels, got.width * got.height - 64);
  if (fs.existsSync(expectedPath)) {
    const file = decodePng(fs.readFileSync(expectedPath));
    let same = file.pixels.length === got.pixels.length;
    for (let i = 0; same && i < file.pixels.length; i++) {
      if (file.pixels[i] !== got.pixels[i]) same = false;
    }
    check(same, "3. expected.png and the capture are the same picture");
  }

  /* 4. the save state the same program wrote */
  const cram = fs.readFileSync(path.join(DUMP, "cram.bin"));
  const word = (buf, i) => buf[i * 2] | (buf[i * 2 + 1] << 8);
  eq("4. CRAM colour 0 is the stated backdrop",
     "$" + word(cram, 0).toString(16).padStart(3, "0"), "$007");
  eq("4. CRAM colour 1 is the stated block colour",
     "$" + word(cram, 1).toString(16).padStart(3, "0"), "$1f8");

  const vram = fs.readFileSync(path.join(DUMP, "vram.bin"));
  eq("4. the BAT cell (4,4) is pattern $41", word(vram, 4 * 32 + 4), 0x0041);
  eq("4. the BAT's first cell is pattern $40", word(vram, 0), 0x0040);
  eq("4. pattern $41 is CH0 ones then CH1..CH3 zero",
     Array.from({ length: 16 }, (_, i) => word(vram, 0x410 + i)),
     [0x00FF, 0x00FF, 0x00FF, 0x00FF, 0x00FF, 0x00FF, 0x00FF, 0x00FF,
      0, 0, 0, 0, 0, 0, 0, 0]);

  const regs = JSON.parse(fs.readFileSync(path.join(DUMP, "regs.json"), "utf8"));
  eq("4. the VDC has the 256x240 window and background on",
     [regs.CR, regs.MWR, regs.HSR, regs.HDR, regs.VSR, regs.VDR, regs.VCR],
     [0x80, 0x00, 0x0202, 0x041F, 0x0F02, 0x00EF, 0x000C]);
  eq("4. the VCE is on the /4 dot clock", regs.VCECR, 0x04);
}

function main() {
  const write = process.argv.indexOf("--write") >= 0;
  checkInclude();
  checkBuilder();
  checkPicture(write);
  if (failures.length) {
    console.log("FAIL  " + failures.length + " of " + checks + " checks failed");
    process.exit(1);
  }
  console.log("PASS  " + checks + " checks: pce.inc's names assemble, the " +
              "example builds a 8 KiB HuCard, Mednafen's picture is the " +
              "stated one pixel for pixel, the save state agrees, and the " +
              "builder refuses overflow/vectors/too-big by name");
}

main();
