#!/usr/bin/env node
/*
 * tests/check-status.js — the closing measurement of #50 (the VDC's status
 * lines in the model and the sprite budget panel).
 *
 * NOTE: written by @design because the card's close condition needs a check;
 * per the workshop role split it is flagged for @review to read cold (same
 * arrangement as check.js, check-panels.js, check-editor.js).
 *
 * The card asks pce-sprites.js / pce-bg.js to compute the VDC status
 * conditions from the same data they draw, and the panels and sprite budget
 * to show them.  This file computes the OR/CC lines a second time, from the
 * raw bytes, and compares them with the model:
 *
 *   - the SAT search from sat.bin: 64 entries, CGY height 16/32/64/64, the
 *     CGY block mask (p&~2 / p&~6) and block select, VFLIP before the block
 *     select, CGX's two strips (halves p&~1, p&~1+1, HFLIP swapping them),
 *     HFLIP's pixel mirror, and the 16-strip line budget in SATB order;
 *   - the sprite patterns from vram.bin: 64-word cells, planes SG0..SG3 at
 *     +0/+16/+32/+48 words + row, bit 15 the leftmost strip pixel, pixel 0
 *     transparent;
 *   - OR = the line's on-line sprites ask for more than 16 strips (a 17th);
 *   - CC = sprite #0 and another sprite among the kept strips have an
 *     opaque pixel at the same display column;
 *   - RR = the raster table's entry lines (the RCR chain matches on its own
 *     line, 0x40 + line) or, without a table, the saved RCR's 0x40 + line;
 *   - VD = VDW line (VDR & 0x1FF) + 1, the first line after the display;
 *   - the status-register bits: each condition AND its CR interrupt enable
 *     (CC bit 0, OC bit 1, RC bit 2, VC bit 3 — HuC6270 CR R05 p. H7-5..H7-6,
 *     SR p. H7-4), with the CR each line carries (the raster table's writes,
 *     else the saved register).
 *
 * Nothing in this file calls pce-sprites.js to compute an expected value: the
 * expected OR/CC/RR lines and bits are rebuilt above and compared with
 * sprites.status().
 *
 * The Mednafen save states record the VDC status register (regs.json's
 * `status`, mcs-extract.py).  For every dump whose ROM never reads the
 * register (no raster.json, no flicker.json) the saved value must equal the
 * model's accumulated frame SR.  For dumps whose ROM runs an irq1 handler
 * that reads $0000 every interrupt and clears bits 0-5 — the #15/#16 raster
 * chains (RC) and #28's flicker viewer (VC) — the saved 0 cannot be
 * compared: the handler read and cleared it.  The check records that and
 * requires the model to have the interrupt enabled and its condition set
 * (RR for a raster table, VD for flicker), so the two facts (a condition
 * happened, a read cleared it) are consistent.  #31's toy captures
 * (toypalette, toyparallax) are the third case, by name: toyc's runtime
 * polls the status register for the VBlank flag, so the save state is 0 for
 * the same reason, and the model must report VD.  #108 adds #45's HuC builds
 * (palette-huc, parallax-huc) and #100's bytecode builds (toypalette-ilvm,
 * toyparallax-ilvm): their runtimes poll $0000 the same way — measured,
 * saved status $0 against the model's VD bit — so they join the same
 * name list.
 *
 * #49 adds one bit to that comparison: DV (SR bit 4), the VRAM-to-VRAM
 * DMA-done flag, which #50's per-frame SR does not cover (that is CC/OR/RR/
 * VD).  It is set only when DCR bit 1 (DVC) enables it — pcetech §5 "a
 * status bit is set only when its enable bit is set" — and the save's
 * post-transfer LENR = $FFFF shows the transfer completed (pcetech §5.4;
 * MANUALS.md §15.1 GAP 2).  Only tests/dumps/dma1 sets DVC; dma2/dma3 are
 * the negative control.  renderer/pce-vram.js owns the rule and
 * tests/check-dma.js holds it to the capture; the term below is zero for
 * every other dump.
 *
 * The scenes where the flags show:
 *   sprite4  — 19 sprites on row 66 and sprite 0 overlapping sprite 1:
 *              OR and CC on VDW lines 2..17;
 *   sprite11 — 15 strips plus a 32-px CGX 16th entry, sprite 0 overlapping:
 *              OR and CC on lines 2..17;
 *   spainted — the editor's crowded line: OR on lines 200..215, no CC.
 * Until #76 no captured scene had CR bits 0-3 (the interrupt enables) set,
 * so no saved status register held the bits; the check showed the gate by
 * running sprite4's own SAT/patterns with CR = $CF (a model calculation, not
 * hardware evidence).  #76's four scenes are the captured counterpart
 * (REVIEW-48-50 S09/S10) and each pair enables its interrupt:
 *   sprite14 — 16 sprites tile the line exactly: OR false, saved status $00;
 *   sprite15 — sprite14 plus a 17th SAT entry on the line: OR on lines
 *              2..17, saved $02;
 *   sprite16 — a fully transparent sprite covers sprite 0: CC false, saved
 *              $00 (the transparency rule's positive input);
 *   sprite17 — the same geometry with an opaque sprite 1: CC on 2..17,
 *              saved $01 (the positive control, so sprite16's $00 cannot
 *              mean "CC never latches").
 * Each fixture's premise (exactly 16/17 strips requested; a covered column
 * opaque in one entry only / in both) is re-measured from sat.bin+vram.bin.
 *
 * The editor's sprite budget (pce-editor.js's spriteLineBudget/spriteBudget)
 * is held to the same model: a synthetic picture with sprite 0 overlapping
 * sprite 1 and a 17-strip line must report CC and OR, and every line's flags
 * must equal sprites.status() on the exported picture; with an effect table
 * the budget's RR lines must be that table's entries and its SR $04 must
 * equal the model's.
 *
 * Self-mutations (the builder's mutants; a different seat's break is still
 * owed, RULES.md rule 2): ungating the register bits, turning the 17th strip
 * off, dropping collision and making RR a constant each make this check fail.
 * REVIEW-48-50's S09 and S10 are re-run against this file by
 * tests/vdc-mutation.js (#76), in a scratch tree.
 *
 *   node tests/check-status.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const sprites = require("../renderer/pce-sprites.js");
const editor = require("../renderer/pce-editor.js");

let checks = 0;
let failures = 0;
function fail(message) {
  failures++;
  console.log(`FAIL  ${message}`);
}
function ok(what, got, want) {
  checks++;
  if (got !== want) {
    fail(`${what}: got ${JSON.stringify(got)}, expected ` +
         `${JSON.stringify(want)}`);
    return false;
  }
  return true;
}
function okv(what, problems) {
  checks++;
  if (problems.length) {
    fail(`${what}:`);
    problems.slice(0, 10).forEach((p) => console.log(`        ${p}`));
    return false;
  }
  return true;
}

function wordAt(bytes, word) {
  return bytes[word * 2] | (bytes[word * 2 + 1] << 8);
}

/* ---- dumps ------------------------------------------------------------- */

function loadDump(name) {
  const dir = path.join(__dirname, "dumps", name);
  const regs = JSON.parse(fs.readFileSync(path.join(dir, "regs.json"), "utf8"));
  const d = {
    name,
    dir,
    regs,
    vram: fs.readFileSync(path.join(dir, "vram.bin")),
    cram: fs.readFileSync(path.join(dir, "cram.bin")),
    sat: fs.existsSync(path.join(dir, "sat.bin"))
      ? fs.readFileSync(path.join(dir, "sat.bin")) : null,
    raster: fs.existsSync(path.join(dir, "raster.json"))
      ? JSON.parse(fs.readFileSync(path.join(dir, "raster.json"), "utf8"))
      : null,
    /* #28: the flicker viewer's VBlank handler reads SR too */
    flicker: fs.existsSync(path.join(dir, "flicker.json"))
      ? JSON.parse(fs.readFileSync(path.join(dir, "flicker.json"), "utf8"))
      : null
  };
  d.firstScanline = 14 + (regs.slstart != null ? regs.slstart : 4);
  d.vdwLine0 = regs.RCRCount - (regs.scanline - d.firstScanline);
  d.height = 232;
  d.width = 256;
  d.opts = {
    vram: d.vram, cram: d.cram, sat: d.sat || undefined, regs,
    raster: d.raster || undefined, firstScanline: d.firstScanline,
    width: d.width, height: d.height
  };
  return d;
}

function dumpNames() {
  const root = path.join(__dirname, "dumps");
  return fs.readdirSync(root).filter((n) =>
    fs.existsSync(path.join(root, n, "regs.json"))).sort();
}

/* #83: #31's toy captures.  Their ROM is toyc's runtime, whose frame flow
 * polls $0000 until the VBlank flag is set (toy_runtime.c, "Reading the
 * status register acknowledges the flags") — so the save state records 0
 * exactly like the raster chain's and flicker viewer's irq1 handlers below.
 * The dumps are still checked line by line through compareDump; only the
 * saved-register equality is unavailable.  This is a NAME list, not a
 * structural rule: a still capture that happens to carry meta.json is not
 * skipped, and a toy capture under an unlisted name still gets compared.
 * #108 adds #45's HuC builds (same toy_runtime.c flow) and #100's bytecode
 * builds (ilvm_runtime.c polls $0000 for VD before each frame). */
const TOY_CAPTURES = new Set(["toypalette", "toyparallax",
                              "palette-huc", "parallax-huc",
                              "toypalette-ilvm", "toyparallax-ilvm",
                              "toystatusbar-ilvm"]);

/* ---- the independent status oracle (raw bytes only) -------------------- */

const CGY_HEIGHT = [16, 32, 64, 64];
const CGY_MASK = [0x3FF, 0x3FF & ~2, 0x3FF & ~6, 0x3FF & ~6];

/* The opaque pixels a strip paints: a Uint8Array(256), 1 where the sprite
 * has a non-zero pixel at that display column. */
function stripMask(vram, cell, row, x, hflip) {
  const mask = new Uint8Array(256);
  const base = cell * 64 + row;
  for (let c = 0; c < 16; c++) {
    const dx = x + c;
    if (dx < 0 || dx >= 256) continue;
    const bit = hflip ? c : 15 - c;
    const pix = ((wordAt(vram, base) >> bit) & 1)
              | (((wordAt(vram, base + 16) >> bit) & 1) << 1)
              | (((wordAt(vram, base + 32) >> bit) & 1) << 2)
              | (((wordAt(vram, base + 48) >> bit) & 1) << 3);
    if (pix) mask[dx] = 1;
  }
  return mask;
}

/* One VDW line's sprite conditions, recomputed from sat.bin and vram.bin. */
function oracleSpriteLine(sat, vram, line) {
  const strips = [];
  let requested = 0, onLine = 0;
  for (let i = 0; i < 64; i++) {
    const y = wordAt(sat, i * 4) & 0x3FF;
    const x = wordAt(sat, i * 4 + 1) & 0x3FF;
    const w2 = wordAt(sat, i * 4 + 2);
    const w3 = wordAt(sat, i * 4 + 3);
    const cgy = (w3 >> 12) & 3;
    const height = CGY_HEIGHT[cgy];
    const row0 = y - 64;
    if (line < row0 || line >= row0 + height) continue;
    onLine++;
    const cgx = (w3 >> 8) & 1;
    requested += cgx ? 2 : 1;
    let yoff = line - row0;
    if (w3 & 0x8000) yoff = height - 1 - yoff;   /* VFLIP first */
    const p = (w2 >> 1) & 0x3FF;
    let cell = (p & CGY_MASK[cgy]) | ((yoff & 0x30) >> 3);
    const row = yoff & 15;
    const hflip = (w3 >> 11) & 1;
    const leftX = x - 32;
    if (cgx) {
      cell &= ~1;
      strips.push({ cell: hflip ? cell | 1 : cell, x: leftX, row, hflip,
                    number: i });
      strips.push({ cell: hflip ? cell : cell | 1, x: leftX + 16, row, hflip,
                    number: i });
    } else {
      strips.push({ cell, x: leftX, row, hflip, number: i });
    }
  }
  const kept = strips.slice(0, 16);
  const own = new Uint8Array(256), other = new Uint8Array(256);
  for (const s of kept) {
    const mask = stripMask(vram, s.cell, s.row, s.x, s.hflip);
    const target = s.number === 0 ? own : other;
    for (let x = 0; x < 256; x++) if (mask[x]) target[x] = 1;
  }
  let collision = false;
  for (let x = 0; x < 256 && !collision; x++) {
    collision = !!(own[x] && other[x]);
  }
  return { strips: kept.length, requested, sprites: onLine,
           overflow: requested > 16, collision };
}

/* The CR each rendered line carries, from the dump's own table (the same
 * per-line rule pce-bg.js applies): a raster entry's CR from the first line
 * it fires on, the frame-start latch = the table's last CR, else the saved
 * register. */
function crLines(dump) {
  const out = new Array(dump.height);
  const regs = dump.regs;
  const entries = dump.raster && dump.raster.entries
    ? dump.raster.entries.slice().sort((a, b) => a.line - b.line) : [];
  let cur = (regs.CR || 0) & 0xFF;
  if (entries.length) {
    cur = dump.raster.base && dump.raster.base.cr != null
      ? dump.raster.base.cr : cur;
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].cr != null) { cur = entries[i].cr; break; }
    }
  }
  let cursor = 0;
  for (let row = 0; row < dump.height; row++) {
    const line = dump.vdwLine0 + row;
    while (cursor < entries.length && entries[cursor].line <= line) {
      const e = entries[cursor++];
      if (e.cr != null) cur = e.cr;
    }
    out[row] = cur;
  }
  return out;
}

/* The VDW lines the RCR chain matches, plus the first line of vertical
 * blanking: the model's timing rule re-derived from the dump. */
function oracleTiming(dump) {
  const regs = dump.regs;
  const vdr = regs.VDR != null ? regs.VDR
            : regs.VDW_cache != null ? regs.VDW_cache : 0xEF;
  const vdw = (vdr & 0x1FF) + 1;
  const rr = new Set();
  const entries = dump.raster && dump.raster.entries
    ? dump.raster.entries.slice().sort((a, b) => a.line - b.line) : [];
  if (entries.length) {
    for (const e of entries) if (e.line >= 0 && e.line <= vdw) rr.add(e.line);
  } else if (regs.RCR != null) {
    const line = (regs.RCR & 0x3FF) - 0x40;
    if (line >= 0 && line <= vdw) rr.add(line);
  }
  return { vdw, vblankLine: vdw, rr };
}

/* The status register the model should report for the whole frame. */
function oracleFrame(dump, crs, timing) {
  const sat = dump.sat;
  let orBit = false, ccBit = false, rrBit = false, vdBit = false;
  let OR = false, CC = false;
  for (let row = 0; row < dump.height; row++) {
    const line = dump.vdwLine0 + row;
    const cr = crs[row];
    let cond = null;
    if (sat && ((cr & 0x40) || (cr & 0x03))) {
      cond = oracleSpriteLine(sat, dump.vram, line);
    }
    if (cond && cond.overflow) { OR = true; orBit = orBit || !!(cr & 0x02); }
    if (cond && cond.collision) { CC = true; ccBit = ccBit || !!(cr & 0x01); }
  }
  for (const line of timing.rr) {
    const row = line - dump.vdwLine0;
    const cr = row >= 0 && row < dump.height ? crs[row] : crs[dump.height - 1];
    rrBit = rrBit || !!(cr & 0x04);
  }
  const vblankCr = crs[dump.height - 1];
  vdBit = !!(vblankCr & 0x08);
  const RR = timing.rr.size > 0;
  return { vdw: timing.vdw, vblankLine: timing.vblankLine,
           OR, CC, RR, VD: true,
           orBit, ccBit, rrBit, vdBit,
           sr: (ccBit ? 0x01 : 0) | (orBit ? 0x02 : 0) | (rrBit ? 0x04 : 0) |
               (vdBit ? 0x20 : 0) };
}

/* ---- the model vs the oracle ------------------------------------------ */

function compareDump(dump, model) {
  const problems = [];
  const crs = crLines(dump);
  const timing = oracleTiming(dump);
  if (model.lines.length !== dump.height) {
    problems.push(`${model.lines.length} model lines, expected ${dump.height}`);
    return problems;
  }
  for (let row = 0; row < dump.height; row++) {
    const got = model.lines[row];
    const line = dump.vdwLine0 + row;
    if (got.line !== line) {
      problems.push(`row ${row}: model line ${got.line}, expected ${line}`);
      continue;
    }
    const cr = crs[row];
    /* the VDC only searches sprites when the layer is on or an OC/CC
     * interrupt is enabled (Mednafen: CR & 0x40 and drawing, or CR & 0x03) */
    const detect = !!(cr & 0x40) || !!(cr & 0x03);
    const cond = dump.sat && detect
      ? oracleSpriteLine(dump.sat, dump.vram, line) : null;
    const rr = timing.rr.has(line);
    const vd = line === timing.vblankLine;
    const want = {
      OR: cond ? cond.overflow : false,
      CC: cond ? cond.collision : false,
      RR: rr, VD: vd,
      orBit: !!(cond && cond.overflow && (cr & 0x02)),
      ccBit: !!(cond && cond.collision && (cr & 0x01)),
      rrBit: !!(rr && (cr & 0x04)),
      vdBit: !!(vd && (cr & 0x08)),
      sprites: cond ? cond.sprites : 0,
      strips: cond ? cond.strips : 0,
      requested: cond ? cond.requested : 0
    };
    for (const key of Object.keys(want)) {
      if (got[key] !== want[key]) {
        problems.push(`row ${row} (VDW line ${line}) ${key}: model ` +
                      `${got[key]}, oracle ${want[key]}`);
      }
    }
  }
  const f = model.frame;
  const wantF = oracleFrame(dump, crs, timing);
  for (const key of Object.keys(wantF)) {
    if (f[key] !== wantF[key]) {
      problems.push(`frame ${key}: model ${JSON.stringify(f[key])}, ` +
                    `oracle ${JSON.stringify(wantF[key])}`);
    }
  }
  return problems;
}

/* The save state's status register.  The ROMs without a raster table never
 * read it, so the model's accumulated frame SR is directly comparable; the
 * raster ROMs' irq1 handler reads $0000 (and so clears it) on every
 * interrupt, which is why their saved value is 0 (docs/RENDERER.md, #16). */
function compareMednafen(dump, model, notes) {
  const problems = [];
  const saved = dump.regs.status;
  if (saved == null) {
    notes.push(`${dump.name}: no status in the save state, not compared`);
    return problems;
  }
  const toy = TOY_CAPTURES.has(dump.name);
  if (!dump.raster && !dump.flicker && !toy) {
    /* #49: DV (SR bit 4) is the VRAM-to-VRAM DMA-done flag: gated by DCR
     * bit 1 (DVC), and the save's LENR = $FFFF shows the transfer finished
     * (see the header).  Zero for every dump with DVC clear. */
    const dv = (dump.regs.DCR & 0x02) && dump.regs.LENR === 0xFFFF ? 0x10 : 0;
    if ((model.frame.sr | dv) !== saved) {
      problems.push(`${dump.name}: saved VDC status $${saved.toString(16)}, ` +
                    `the model's frame SR is $${model.frame.sr.toString(16)}` +
                    (dv ? ` (+ DV $10)` : ""));
    }
    return problems;
  }
  /* an irq1 handler (raster chain or #28 flicker), or toyc's frame flow
   * (#31's toys), reads and clears SR */
  if (saved !== 0) {
    problems.push(`${dump.name}: saved status is $${saved.toString(16)}, ` +
                  "expected 0 — " +
                  (toy
                    ? "the toy runtime polls SR for the VBlank flag and clears it"
                    : `the irq1 handler reads SR and clears it on every ` +
                      `${dump.flicker ? "VBlank" : "RCR"} interrupt`));
  }
  if (dump.raster && !(model.frame.rrBit)) {
    problems.push(`${dump.name}: RR is enabled and the table has matches, ` +
                  "so the model must report an RR bit before the read; it " +
                  "does not");
  }
  if ((dump.flicker || toy) && !(model.frame.vdBit)) {
    problems.push(`${dump.name}: VD is enabled ` +
                  `(CR $${dump.regs.CR.toString(16)}, bit 3) and the ROM ` +
                  "reads SR, so the model must report a VD bit before the " +
                  "read; it does not");
  }
  notes.push(`${dump.name}: saved status 0 — ` +
             (toy ? "the toy runtime read and cleared it"
                  : "the handler read and cleared it") +
             `; model ` +
             (dump.flicker || toy
               ? `VC-enabled VD ${model.frame.vdBit ? "set" : "clear"}`
               : `RC-enabled RR ${model.frame.rrBit ? "set" : "clear"}`) +
             ` (not a register comparison)`);
  return problems;
}

/* ---- the explicit scenes ---------------------------------------------- */

function linesWhere(model, key) {
  return model.lines.filter((l) => l[key]).map((l) => l.line);
}

function checkScene(name, model, want) {
  const problems = [];
  const or = linesWhere(model, "OR");
  const cc = linesWhere(model, "CC");
  if (want.overflow) {
    if (!or.length) problems.push("no line reports sprite overflow");
    if (want.or0 != null &&
        (or[0] !== want.or0 || or[or.length - 1] !== want.or1)) {
      problems.push(`OR lines ${or[0]}..${or[or.length - 1]}, expected ` +
                    `${want.or0}..${want.or1}`);
    }
  } else if (or.length) {
    problems.push(`${or.length} unexpected overflow line(s)`);
  }
  if (want.collision) {
    if (!cc.length) problems.push("no line reports a sprite-0 collision");
    if (want.cc0 != null &&
        (cc[0] !== want.cc0 || cc[cc.length - 1] !== want.cc1)) {
      problems.push(`CC lines ${cc[0]}..${cc[cc.length - 1]}, expected ` +
                    `${want.cc0}..${want.cc1}`);
    }
  } else if (cc.length) {
    problems.push(`${cc.length} unexpected collision line(s)`);
  }
  okv(`${name}: the flags show (OR ${or.length} line(s), CC ` +
      `${cc.length} line(s))`, problems);
  return { or, cc };
}

/* ---- #76: the fixtures' premises, read from the raw bytes ---------------
 *
 * The four scenes #76 added are only evidence if the picture really is the
 * input the break needs, so each premise is measured from sat.bin/vram.bin
 * here rather than trusted from the generator:
 *
 *   sprite14  some line asks for exactly 16 strips and keeps all 16;
 *   sprite15  some line asks for exactly 17 and keeps 16 — one more than
 *             sprite14, and the two dumps' pictures are otherwise the same;
 *   sprite16  SAT entry 1 covers entry 0's 16 columns and paints NOT ONE
 *             opaque pixel (so a covered column with no opaque overlap
 *             exists, while entry 0 has opaque pixels of its own);
 *   sprite17  the same geometry with entry 1 opaque — the positive control
 *             that shows the CC condition and its enable do work.
 *
 * The 16x16 decode here is the one stripMask already uses for the oracle;
 * these scenes carry no CGY/CGX entries, and the check refuses them (rather
 * than silently decoding wrong) if that stops being true. */
function satEntry16(sat, i) {
  const y = wordAt(sat, i * 4) & 0x3FF;
  const x = (wordAt(sat, i * 4 + 1) & 0x3FF) - 32;
  const w2 = wordAt(sat, i * 4 + 2);
  const w3 = wordAt(sat, i * 4 + 3);
  return {
    row0: y - 64, cell: (w2 >> 1) & 0x3FF, x,
    hflip: (w3 >> 11) & 1, cgy: (w3 >> 12) & 3, cgx: (w3 >> 8) & 1
  };
}

function checkStripBoundaryPremise(name, dump) {
  const problems = [];
  const marks = [];
  for (let line = 0; line < dump.height; line++) {
    const L = dump.vdwLine0 + line;
    const c = oracleSpriteLine(dump.sat, dump.vram, L);
    marks.push({ line: L, requested: c.requested, kept: c.strips,
                 overflow: c.overflow, collision: c.collision });
  }
  const want = name === "sprite14"
    ? { requested: 16, kept: 16, overflow: false }
    : { requested: 17, kept: 16, overflow: true };
  const hit = marks.filter((m) => m.requested === want.requested &&
                                  m.kept === want.kept);
  if (!hit.length) {
    problems.push(`no line asks for ${want.requested} strips and keeps ` +
                  `${want.kept} (the scene does not exercise the boundary)`);
  } else {
    const bad = hit.filter((m) => m.overflow !== want.overflow);
    if (bad.length) {
      problems.push(`line ${bad[0].line}: ${want.requested} strips requested, ` +
                    `overflow ${bad[0].overflow} in the raw-byte oracle`);
    }
  }
  okv(`${name}: a line asks for exactly ${want.requested} strips ` +
      `(overflow ${want.overflow} without the status enable)`, problems);
}

function checkOverlapPremise(name, dump) {
  const problems = [];
  const e0 = satEntry16(dump.sat, 0), e1 = satEntry16(dump.sat, 1);
  if (e0.cgy || e0.cgx || e1.cgy || e1.cgx) {
    problems.push("entry 0/1 are not 16x16; this premise only decodes those");
    okv(`${name}: the transparent/opaque overlap premise`, problems);
    return;
  }
  const line = e0.row0;   /* its first display line */
  const m0 = stripMask(dump.vram, e0.cell, 0, e0.x, e0.hflip);
  const m1 = stripMask(dump.vram, e1.cell, 0, e1.x, e1.hflip);
  const opaque0 = m0.reduce((a, b) => a + b, 0);
  const opaque1 = m1.reduce((a, b) => a + b, 0);
  const both = m0.reduce((a, b, x) => a + (b && m1[x] ? 1 : 0), 0);
  const covered = (e0.x === e1.x);
  if (line !== e1.row0) problems.push("the two entries are not on one line");
  if (!covered) problems.push(`entry 1 covers x ${e1.x}..${e1.x + 15}, entry 0 x ` +
                              `${e0.x}..${e0.x + 15} — they do not overlap`);
  if (opaque0 === 0) problems.push("entry 0 paints no opaque pixel at all");
  if (name === "sprite16") {
    if (opaque1 !== 0)
      problems.push(`entry 1 paints ${opaque1} opaque pixel(s): the overlap ` +
                    "is not transparent-only");
    if (both !== 0)
      problems.push(`${both} column(s) opaque in both entries — the capture ` +
                    "does not test transparency");
  } else {
    if (opaque1 === 0) problems.push("entry 1 paints no opaque pixel");
    if (both === 0) problems.push("no column is opaque in both entries — the " +
                                  "positive control does not collide");
  }
  okv(`${name}: entry 1 covers entry 0's whole strip, ` +
      `${opaque0}/${opaque1} opaque column(s), ${both} shared`, problems);
}

/* ---- the editor's sprite budget --------------------------------------- */

function checkEditorBudget() {
  const pic = editor.newPicture();
  const pat = editor.newSpritePattern(pic, 16, 16);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) editor.paintSpriteIndex(pic, pat, x, y, 1);
  /* sprite 0 at x 0..15, sprite 1 at x 8..23: eight opaque columns overlap */
  editor.addSprite(pic, { x: 0, y: 0, pattern: pat });
  editor.addSprite(pic, { x: 8, y: 0, pattern: pat });
  /* fifteen more 16-px sprites on line 0: 17 strips asked for, 16 kept */
  for (let i = 0; i < 15; i++) {
    editor.addSprite(pic, { x: 40 + 15 * i, y: 0, pattern: pat });
  }
  const budget = editor.spriteBudget(pic);
  const problems = [];
  if (!budget.lines[0].overflow)
    problems.push("line 0 asks for 17 strips but the budget reports no " +
                  "overflow");
  if (!budget.lines[0].collision)
    problems.push("sprite 0 overlaps sprite 1 but the budget reports no " +
                  "collision");
  if (budget.status.OR !== true || budget.status.CC !== true)
    problems.push("the budget's status block does not carry OR/CC");
  if (budget.status.vblankLine !== 240)
    problems.push(`VD line ${budget.status.vblankLine}, expected 240`);
  if (budget.status.RR.length)
    problems.push("a picture with no effects reports RCR matches");
  okv("editor budget: a 17-strip line and a sprite-0 hit are reported",
      problems);

  /* the editor budget and pce-sprites.js agree on every line of the picture
   * the editor would export */
  const data = editor.toPicture(pic);
  const sat = data.vram.slice(editor.SAT_ADDR * 2, editor.SAT_ADDR * 2 + 512);
  const model = sprites.status({
    vram: data.vram, cram: data.cram, sat,
    regs: editor.viewRegs(pic), width: editor.VIEW_W, height: editor.VIEW_H
  });
  const diffs = [];
  for (let y = 0; y < editor.VIEW_H; y++) {
    const b = budget.lines[y], m = model.lines[y];
    if (b.overflow !== m.OR)
      diffs.push(`line ${y}: budget OR ${b.overflow}, model ${m.OR}`);
    if (b.collision !== m.CC)
      diffs.push(`line ${y}: budget CC ${b.collision}, model ${m.CC}`);
  }
  okv("editor budget: every line's OR/CC equals pce-sprites.js on the " +
      "exported picture", diffs);

  /* VD/RR: with an effect table the budget's RR lines are the table's
   * entries and its SR equals the model's (the exported CR has RC) */
  editor.setGradient(pic, { from: 0, to: 511, line0: 0, line1: 223 });
  const budget2 = editor.spriteBudget(pic);
  const raster = editor.toRaster(pic, 0);
  const entryLines = raster.entries.map((e) => e.line);
  const model2 = sprites.status({
    vram: data.vram, cram: data.cram, sat,
    regs: editor.viewRegs(pic), raster,
    width: editor.VIEW_W, height: editor.VIEW_H
  });
  const probs2 = [];
  if (budget2.status.RR.length !== entryLines.length ||
      budget2.status.RR.some((l, i) => l !== entryLines[i])) {
    probs2.push(`budget RR lines ${budget2.status.RR.length}, the table has ` +
                `${entryLines.length}`);
  }
  if (budget2.status.sr !== model2.frame.sr) {
    probs2.push(`budget SR $${budget2.status.sr.toString(16)}, model SR ` +
                `$${model2.frame.sr.toString(16)}`);
  }
  if (!model2.frame.RR) probs2.push("the model reports no RR match");
  if (model2.frame.vblankLine !== 240)
    probs2.push(`model VD line ${model2.frame.vblankLine}, expected 240`);
  okv("editor budget: RR lines are the effect table's and SR matches the " +
      "model", probs2);
}

/* ---- builder's mutants: the check must fail on them -------------------- */

function copyModel(model) {
  return {
    lines: model.lines.map((l) => Object.assign({}, l)),
    frame: Object.assign({}, model.frame),
    timing: model.timing
  };
}

function regrade(model) {
  let orBit = false, ccBit = false, rrBit = false, vdBit = false;
  for (const l of model.lines) {
    orBit = orBit || l.orBit;
    ccBit = ccBit || l.ccBit;
    rrBit = rrBit || l.rrBit;
  }
  vdBit = model.frame.vdBit;
  model.frame.orBit = orBit;
  model.frame.ccBit = ccBit;
  model.frame.rrBit = rrBit;
  model.frame.vdBit = vdBit;
  model.frame.sr = (ccBit ? 0x01 : 0) | (orBit ? 0x02 : 0) |
                   (rrBit ? 0x04 : 0) | (vdBit ? 0x20 : 0);
  return model;
}

const MUTANTS = [
  { name: "ungated bits (every condition latches whatever CR says)",
    apply(model) {
      for (const l of model.lines) {
        l.orBit = l.OR;
        l.ccBit = l.CC;
        l.rrBit = l.RR;
      }
      model.frame.vdBit = model.frame.VD;
      return regrade(model);
    } },
  { name: "the 17th strip not an overflow",
    apply(model) {
      for (const l of model.lines) l.OR = l.orBit = false;
      model.frame.OR = model.frame.orBit = false;
      return regrade(model);
    } },
  { name: "collisions dropped",
    apply(model) {
      for (const l of model.lines) l.CC = l.ccBit = false;
      model.frame.CC = model.frame.ccBit = false;
      return regrade(model);
    } },
  { name: "RR a constant, ignoring the raster chain",
    apply(model) {
      for (const l of model.lines) l.RR = l.rrBit = false;
      model.frame.RR = model.frame.rrBit = false;
      return regrade(model);
    } }
];

function runMutants(dumps, models) {
  for (const mutant of MUTANTS) {
    let caught = 0;
    for (let i = 0; i < dumps.length; i++) {
      const m = mutant.apply(copyModel(models[i]));
      const problems = compareDump(dumps[i], m)
        .concat(compareMednafen(dumps[i], m, []));
      if (problems.length) caught++;
    }
    ok(`mutant "${mutant.name}" is caught`, caught > 0, true);
  }
}

/* ---- main -------------------------------------------------------------- */

function main() {
  const names = dumpNames();
  const dumps = names.map(loadDump);
  const models = dumps.map((d) => sprites.status(d.opts));
  const notes = [];
  let comparable = 0, cleared = 0;

  for (let i = 0; i < dumps.length; i++) {
    const dump = dumps[i], model = models[i];
    const problems = compareDump(dump, model);
    const readCleared = dump.raster || dump.flicker || TOY_CAPTURES.has(dump.name);
    if (!readCleared && dump.regs.status != null) comparable++;
    if (readCleared && dump.regs.status != null) cleared++;
    problems.push(...compareMednafen(dump, model, notes));
    okv(`${dump.name}: the model's status lines and frame agree with the ` +
        `independent computation`, problems);
  }

  /* the scenes the card names */
  const byName = {};
  dumps.forEach((d, i) => { byName[d.name] = models[i]; });
  checkScene("sprite4", byName.sprite4,
             { overflow: true, collision: true, or0: 2, or1: 17, cc0: 2,
               cc1: 17 });
  checkScene("sprite11", byName.sprite11,
             { overflow: true, collision: true, or0: 2, or1: 17, cc0: 2,
               cc1: 17 });
  checkScene("spainted", byName.spainted,
             { overflow: true, collision: false, or0: 200, or1: 215 });

  /* #76: the four fixtures REVIEW-48-50's S09/S10 named.  sprite14/sprite15
   * sit either side of the 16-strip budget and sprite16/sprite17 either
   * side of an opaque overlap, and each pair's ROM enables the matching
   * status interrupt, so the saved register (compared with the model above)
   * carries the condition.  The premises are measured from the raw bytes
   * first: a dump that stopped being the input the break needs must be a
   * FAIL of its own, not a silent pass. */
  for (const n of ["sprite14", "sprite15", "sprite16", "sprite17"]) {
    if (!byName[n]) {
      fail(`#76 fixture ${n} is missing from tests/dumps — run ` +
           `tools/capture.sh ${n.replace("sprite", "")} sprite`);
    }
  }
  if (byName.sprite14 && byName.sprite15) {
    checkScene("sprite14", byName.sprite14,
               { overflow: false, collision: false });
    checkScene("sprite15", byName.sprite15,
               { overflow: true, collision: false, or0: 2, or1: 17 });
  }
  if (byName.sprite16 && byName.sprite17) {
    checkScene("sprite16", byName.sprite16,
               { overflow: false, collision: false });
    checkScene("sprite17", byName.sprite17,
               { overflow: false, collision: true, cc0: 2, cc1: 17 });
  }
  const fixturePremises = {
    sprite14: checkStripBoundaryPremise,
    sprite15: checkStripBoundaryPremise,
    sprite16: checkOverlapPremise,
    sprite17: checkOverlapPremise
  };
  for (const n of Object.keys(fixturePremises)) {
    const d = dumps[names.indexOf(n)];
    if (d) fixturePremises[n](n, d);
  }
  /* the saved register, by name: the four fixtures' whole point is that
   * Mednafen's own SR separates each pair. */
  const savedStatus = (n) => (dumps[names.indexOf(n)] || { regs: {} }).regs.status;
  if (dumps[names.indexOf("sprite14")])
    ok("sprite14 (16 strips, OC enabled): the saved status has no OR",
       savedStatus("sprite14"), 0x00);
  if (dumps[names.indexOf("sprite15")])
    ok("sprite15 (17 strips, OC enabled): the saved status is OR ($02)",
       savedStatus("sprite15"), 0x02);
  if (dumps[names.indexOf("sprite16")])
    ok("sprite16 (transparent overlap, CC enabled): the saved status has " +
       "no CC", savedStatus("sprite16"), 0x00);
  if (dumps[names.indexOf("sprite17")])
    ok("sprite17 (opaque overlap, CC enabled): the saved status is CC ($01)",
       savedStatus("sprite17"), 0x01);

  /* the enable gate: sprite4's own capture with CR bits 0-3 on */
  const s4 = dumps[names.indexOf("sprite4")];
  const gated = sprites.status(Object.assign({}, s4.opts, {
    regs: Object.assign({}, s4.regs, { CR: s4.regs.CR | 0x0F })
  }));
  ok("sprite4 with CR=$CF: CC+OR+VD latch into SR",
     gated.frame.sr, 0x01 | 0x02 | 0x20);
  ok("sprite4 with CR=$CF: the saved capture has no enables, so its " +
     "status register stays 0", s4.regs.status, 0);

  /* the budget panel's flags */
  checkEditorBudget();

  /* the check must fail on a changed model */
  runMutants(dumps, models);

  console.log(`status: ${dumps.length} dumps — ${comparable} save states ` +
              `compared register-for-register, ${cleared} read-cleared ` +
              `(raster/flicker handlers, toy runtimes)`);
  notes.slice(0, 3).forEach((n) => console.log(`  ${n}`));
  if (failures) {
    console.log(`FAIL: ${failures} problem(s) in ${checks} checks`);
    return 1;
  }
  console.log(`PASS: the VDC status lines are computed from the same SAT/` +
              `patterns the renderer draws — ${checks} checks on ` +
              `${dumps.length} dumps, including sprite4/sprite11 (OR+CC), ` +
              `spainted (OR) and the editor budget`);
  return 0;
}

process.exitCode = main();
