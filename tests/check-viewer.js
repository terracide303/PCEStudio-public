#!/usr/bin/env node
/*
 * tests/check-viewer.js — diff a viewer ROM's Mednafen frames against the
 * renderer (card #8's closing measurement; #14 extends it to the sprite
 * scenes; also used for #9's browser-built ROMs, tests/dumps/browserN/;
 * #16 extends it to the raster viewers, tests/dumps/vrasterN/ and
 * effect1/).
 *
 * NOTE: written by @design because the card's close condition needs a diff
 * script; per the workshop role split this is flagged for @review to read
 * cold (same arrangement as tests/check.js for #5).
 *
 * For every tests/dumps/{viewer,browser,vsprite,bsprite}<N>/ directory with
 * a mednafen.png (#46 adds browser10, the 88 KiB picture — N is any number):
 *   - renders the frame for the matching scene (sceneN for viewer/browserN,
 *     spriteN for vsprite/bspriteN) with the renderer — pce-sprites.js when
 *     the scene has a sat.bin, else pce-bg.js — from
 *     tests/dumps/{scene,sprite}N/{vram.bin,cram.bin,regs.json,sat.bin} and
 *     requires the viewer's recorded frame to equal it byte for byte
 *     (diff 0).  The renderer is the pixel reference (#5 and #12 proved it
 *     matches Mednafen's own scene ROMs);
 *   - requires the viewer's captured state to contain what the viewer was
 *     told to load: vram.bin equal to the scene's (the tiles, the BAT, the
 *     SG patterns and the SAT all landed), the full 1024-byte cram.bin equal
 *     to the scene's (all 512 colour-table entries landed), the SATB mirror
 *     sat.bin equal to the scene's (the DCR bit-4 DMA carried the SAT — the
 *     #14 evidence), and the static VDC registers (MWR/BXR/BYR/CR/VSR/VDR/
 *     HSR/HDR/DCR/SATB) equal to the scene's (256x224 mode, scroll from the
 *     config, SATB DMA source).
 *
 * #16 — vrasterN and effect1 dumps carry raster.json (the ROM's table,
 * patched with the run's runtime state by capture.sh).  For those:
 *   - the frame is rendered from the dump's OWN state (its vram.bin,
 *     cram.bin, regs.json and the patched table as opts.raster, with
 *     firstScanline = 14 + slstart) and must equal its own mednafen.png
 *     byte for byte — the chain's writes landed per line exactly as the
 *     renderer models them;
 *   - the shared table check (tests/check-raster.js, the same witnesses
 *     tests/check.js holds the scene ROMs to) verifies the table against
 *     the viewer's own save state: the viewer really executed the scene's
 *     table (RCR armed, registers and colour table written in line order);
 *   - cram.bin is NOT compared with the scene's (the save-time colour
 *     table is a per-run frame state — r4's counter differs between runs);
 *     the table check above proves the viewer's own cram instead;
 *   - vram.bin, sat.bin and the VDC registers stay compared with the
 *     scene (rasterN for vrasterN): the same picture data landed and the
 *     same chain state was saved.  effect1 has no scene dump — it is the
 *     editor's own picture — so those comparisons are skipped and
 *     check-editor.js's checkEffectCapture holds it to the editor's state
 *     instead.
 *
 * #68 — the first-frame fixtures (tests/dumps/vtraceN/): a raster dump's
 * image is the steady state, so REVIEW-16's B14 (the boot arm one line late)
 * moves nothing in it.  A VDC write trace from reset does see it: the trace's
 * first RCR matches are the first frame's arms.  checkTraceFixture below
 * requires them to be the table's steps 0..3 in order, with RC set, and every
 * steady-state arm to be a table arm.  vtrace2 is the pristine vraster2;
 * vtrace2-b14 is the same ROM with B14 re-applied, committed as a control
 * that the check must REJECT — a check that has never failed has not been
 * tested.  tools/capture-review16.sh trace records both.
 *
 * #74 — the mixed-op fixture (tests/dumps/vraster13/): REVIEW-30's V1 showed
 * that removing viewer.asm's per-step dispatch-vector update changes nothing
 * on any shipped table, because every table is homogeneous.  vraster13
 * alternates colour-only and BYR-only steps (tools/genreview16.py r13), so
 * the same break makes a mis-dispatched handler write the wrong field.  The
 * fixture is required by name at the bottom of main() and its table must
 * still mix the two shapes; a missing or homogenized fixture fails the suite.
 *
 * Exit code 0 only if every viewer capture matches on all checks, the
 * mixed-op fixture is present and mixed, and every trace fixture lands in its
 * expected class.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");
const bg = require("../renderer/pce-bg.js");
const sprites = require("../renderer/pce-sprites.js");

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

function diffPixels(got, ref, name) {
  if (got.width !== ref.width || got.height !== ref.height)
    return `${name}: SIZE MISMATCH renderer ${got.width}x${got.height} ` +
           `vs viewer ${ref.width}x${ref.height}`;
  let diffs = 0;
  const samples = [];
  for (let i = 0; i < got.pixels.length; i++) {
    if (got.pixels[i] !== ref.pixels[i]) {
      diffs++;
      if (samples.length < 8) {
        const o = i - (i % 3);
        const p = o / 3;
        samples.push(`px(${p % ref.width},${(p / ref.width) | 0}) ` +
          `renderer=${got.pixels[o]},${got.pixels[o + 1]},${got.pixels[o + 2]} ` +
          `viewer=${ref.pixels[o]},${ref.pixels[o + 1]},${ref.pixels[o + 2]}`);
      }
    }
  }
  if (diffs === 0) return null;
  return `${name}: ${diffs} differing pixels of ` +
         `${ref.width * ref.height * 3} bytes\n` + samples.map((s) => `  ${s}`).join("\n");
}

/* #67: VSR is the save state's field for the VDC's R0C (VPR: VDS/VSW);
 * VCR joins the compared registers with the window block, and the frame diff
 * is what proves HSR/HDR/VPR/VDR — but comparing all five directly is the
 * cheap witness that the viewer wrote the picture's registers. */
const VDC_REGS = ["MWR", "BXR", "BYR", "CR", "VSR", "VDR", "VCR", "HSR",
                  "HDR", "VCECR", "DCR", "SATB"];

/* The shared #15/#16 raster-table check (tests/check.js uses the same
 * witnesses on the scene dumps). */
const { checkRaster } = require("./check-raster");

/* The matching scene dir for a viewer capture: viewerN/browserN -> sceneN,
 * vspriteN -> spriteN (#14), bspriteN -> spriteN (#42: the browser export
 * of a sprite scene, captured in Mednafen — REVIEW-14's J-gap),
 * vrasterN -> rasterN (#16: the #15 scene whose table the viewer runs).
 * effect1 has no scene — it is the editor's own picture (null: skip the
 * scene comparisons).
 * #70: vwide336/vwide512 -> wide336/wide512 (the viewer's wide-window block
 * carries the picture's VCE CR + HSR/HDR; the frame is 341 or 512 dots). */
function sceneDir(dir) {
  const name = path.basename(dir);
  if (name === "effect1") return null;
  const scene = name.replace(/^vsprite/, "sprite")
                    .replace(/^bsprite/, "sprite")
                    .replace(/^vraster/, "raster")
                    .replace(/^vwide/, "wide")
                    .replace(/^(?:viewer|browser)/, "scene");
  return path.join(path.dirname(dir), scene);
}

function checkViewer(dir) {
  const name = path.basename(dir);
  const scenedir = sceneDir(dir);
  const problems = [];

  const vvram = fs.readFileSync(path.join(dir, "vram.bin"));
  const vcram = fs.readFileSync(path.join(dir, "cram.bin"));
  const vregs = JSON.parse(fs.readFileSync(path.join(dir, "regs.json"), "utf8"));
  const vsatPath = path.join(dir, "sat.bin");
  const hasVsat = fs.existsSync(vsatPath);
  const rasterPath = path.join(dir, "raster.json");
  const hasRaster = fs.existsSync(rasterPath);

  // 1. the frame.  A raster dump (#16) renders from its own state with its
  // patched table — the chain's per-line writes are the picture; the
  // table is first verified against that state (the same witnesses
  // tests/check.js uses on the scene dumps: the viewer really executed
  // the scene's table).
  let got;
  const ref = decodePng(fs.readFileSync(path.join(dir, "mednafen.png")));
  if (hasRaster) {
    const raster = JSON.parse(fs.readFileSync(rasterPath, "utf8"));
    const firstScanline = 14 + (vregs.slstart != null ? vregs.slstart : 4);
    const vdwLine0 = vregs.RCRCount - (vregs.scanline - firstScanline);
    if (checkRaster(name, raster, vregs, vcram, vdwLine0).length) {
      problems.push(`${name}: raster.json does not match the save state`);
    }
    const opts = { vram: vvram, cram: vcram, regs: vregs,
                   width: bg.frameWidth({ regs: vregs }),
                   height: 232, firstScanline, raster };
    got = hasVsat
      ? sprites.renderFrame(Object.assign({ sat: fs.readFileSync(vsatPath) },
                                          opts))
      : bg.renderFrame(opts);
  } else {
    const svram = fs.readFileSync(path.join(scenedir, "vram.bin"));
    const scram = fs.readFileSync(path.join(scenedir, "cram.bin"));
    const sregs = JSON.parse(fs.readFileSync(path.join(scenedir, "regs.json"), "utf8"));
    const ssatPath = path.join(scenedir, "sat.bin");
    const opts = { vram: svram, cram: scram, regs: sregs,
                   width: bg.frameWidth({ regs: sregs }), height: 232 };
    if (fs.existsSync(ssatPath)) opts.sat = fs.readFileSync(ssatPath);
    got = fs.existsSync(ssatPath)
      ? sprites.renderFrame(opts) : bg.renderFrame(opts);
  }
  const p = diffPixels(got, ref, name);
  if (p) problems.push(p);

  // 2. the state: the viewer really loaded the tiles + BAT + SG patterns +
  // the SAT, the palettes, and the SATB DMA carried the SAT.  A raster
  // dump skips the cram comparison (a per-run frame state — r4's counter)
  // and effect1 skips the lot (no scene; check-editor.js holds it to the
  // editor's state).
  if (scenedir) {
    const svram = fs.readFileSync(path.join(scenedir, "vram.bin"));
    const sregs = JSON.parse(fs.readFileSync(path.join(scenedir, "regs.json"), "utf8"));
    const ssatPath = path.join(scenedir, "sat.bin");
    const scram = fs.readFileSync(path.join(scenedir, "cram.bin"));
    if (!vvram.equals(svram)) {
      let first = 0;
      while (first < vvram.length && vvram[first] === svram[first]) first++;
      problems.push(`${name}: vram differs from ${path.basename(scenedir)} ` +
                    `at byte ${first} (copied data did not land)`);
    }
    if (!hasRaster && !vcram.equals(scram)) {
      let first = 0;
      while (first < vcram.length && vcram[first] === scram[first]) first++;
      problems.push(`${name}: cram differs from ${path.basename(scenedir)} ` +
                    `at byte ${first} (the 512 colour-table entries did not land)`);
    }
    for (const r of VDC_REGS) {
      if (vregs[r] !== sregs[r])
        problems.push(`${name}: ${r}=${vregs[r]} but ` +
                      `${path.basename(scenedir)} has ${sregs[r]}`);
    }
    if (fs.existsSync(ssatPath) && hasVsat) {
      const ssat = fs.readFileSync(ssatPath);
      const vsat = fs.readFileSync(vsatPath);
      if (!vsat.equals(ssat)) {
        let first = 0;
        while (first < vsat.length && vsat[first] === ssat[first]) first++;
        problems.push(`${name}: sat.bin differs from ` +
                      `${path.basename(scenedir)} at byte ${first} ` +
                      `(the SATB DMA did not carry the SAT)`);
      }
    }
  }

  if (problems.length === 0) {
    const against = scenedir ? ` and the ${path.basename(scenedir)} state` : "";
    console.log(`${name}: OK (frame diff 0${hasRaster ? ", table matches " +
                "the save state" : ""}${against})`);
    return 0;
  }
  problems.forEach((s) => console.log(s));
  return 1;
}

/* ---- #68: the first frame, from a VDC trace from reset -------------------
 *
 * REVIEW-16's B14 (the boot arm one line late) changes only the first RCR
 * match after boot: every later frame re-arms from the chain.  The image
 * captures cannot see it — Mednafen's movie's first recorded frame is already
 * steady (measured: the mutant's 524-frame movie has one frame hash) — so the
 * instrument is a VDC write trace from reset (tools/capture-review16.sh
 * trace; the instrumented Mednafen's `RCRIRQ` lines).  The trace's first
 * matches are the first frame's RCR arms: the pristine ROM arms step 0 at
 * 0x40 + entries[0].line, then steps 1..3 in table order; the B14 mutant's
 * first arm is one line late (0x42 where the table says 0x41).
 *
 * A fixture is a directory tests/dumps/vtraceN/ with raster.json, meta.json,
 * rcrirq-first.txt (the first 8 RCRIRQ lines) and rcrirq-last.txt (the last
 * 4).  meta.expect is "match" (the pristine ROM) or "mismatch" (the B14
 * control): the control is not a failure — it is committed to prove this
 * check can say no, and the suite fails if the control ever passes.
 *
 * Result classes (all exit 1 except OK):
 *   OK            match: the first four arms equal the table's steps 0..3 and
 *                 every steady-state arm is a table arm; or mismatch: the
 *                 control reports the first-frame deviation and nothing else.
 *   MISSING       a fixture file is absent or unparseable.
 *   TRUNCATED     fewer than 4 RCRIRQ lines (the chain did not run long
 *                 enough — a capture failure, not a verdict).
 *   DEVIATION     match: the first frame did not arm the table in order, or
 *                 fired with RC clear, or a steady-state arm is not a table
 *                 arm.  This is the B14 detection for a real capture.
 *   RC-CLEAR      an RCRIRQ line fired with CR bit 2 (RC) clear.
 *   PROVENANCE    match: tools/gen/vraster2.pce exists and its sha256 differs
 *                 from the one the trace was recorded from — re-capture.
 *                 (The mismatch control's ROM is a scratch mutant, so its
 *                 sha is recorded but not compared.)
 *   CONTROL-PASSED  mismatch: the check found no deviation, so it cannot see
 *                 B14 and every "match" verdict above it is untrustworthy.
 *   WRONG-REASON  mismatch: the control was rejected for a reason other than
 *                 the first-frame arm (a broken fixture, not a witness).
 */
function parseRcrIrq(text) {
  const out = [];
  for (const line of text.split("\n")) {
    const m = /^RCRIRQ RCRCount=(\d+) RCR=([0-9a-f]+) CR=([0-9a-f]+)$/
      .exec(line);
    if (m) out.push({ count: parseInt(m[1], 10), rcr: parseInt(m[2], 16),
                      cr: parseInt(m[3], 16) });
  }
  return out;
}

function readFixtureFile(dir, name) {
  const p = path.join(dir, name);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, "utf8");
}

function firstFrameProblems(dir) {
  const name = path.basename(dir);
  const problems = [];      /* nothing to do with B14: a broken fixture */
  const frameProblems = []; /* the first-frame arm class: B14's witness */
  const rasterText = readFixtureFile(dir, "raster.json");
  const metaText = readFixtureFile(dir, "meta.json");
  const firstText = readFixtureFile(dir, "rcrirq-first.txt");
  const lastText = readFixtureFile(dir, "rcrirq-last.txt");
  for (const [what, text] of [["raster.json", rasterText],
                              ["meta.json", metaText],
                              ["rcrirq-first.txt", firstText],
                              ["rcrirq-last.txt", lastText]]) {
    if (text == null) problems.push(`${name}: missing ${what}`);
  }
  if (problems.length) return { problems, frameProblems, meta: null };

  let raster, meta;
  try {
    raster = JSON.parse(rasterText);
    meta = JSON.parse(metaText);
  } catch (e) {
    problems.push(`${name}: unparseable JSON (${e.message})`);
    return { problems, frameProblems, meta: null };
  }
  const entries = raster.entries || [];
  const first = parseRcrIrq(firstText);
  const last = parseRcrIrq(lastText);
  if (entries.length < 4) {
    problems.push(`${name}: raster.json has ${entries.length} entries, ` +
                  `need at least 4`);
  }
  if (first.length < 4) {
    problems.push(`${name}: ${first.length} RCRIRQ line(s) in ` +
                  `rcrirq-first.txt, need at least 4`);
  }
  if (last.length < 1) {
    problems.push(`${name}: no RCRIRQ line in rcrirq-last.txt`);
  }

  /* the first frame: the boot arm fires step 0, and the table's first four
   * steps fire in order — every arm value is 0x40 + the entry's line */
  const steps = Math.min(4, entries.length, first.length);
  for (let i = 0; i < steps; i++) {
    const want = 0x40 + entries[i].line;
    if (first[i].rcr !== want) {
      frameProblems.push(`${name}: first-frame RCR match ${i} armed ` +
        `RCR=0x${first[i].rcr.toString(16)}, the table's step ${i} ` +
        `(line ${entries[i].line}) arms 0x${want.toString(16)}`);
    }
    if (!(first[i].cr & 0x04)) {
      problems.push(`${name}: first-frame RCR match ${i} fired with CR=` +
                    `0x${first[i].cr.toString(16)} (RC, bit 2, clear)`);
    }
  }
  /* steady state: after the first frame the chain's arms are table arms */
  const arms = new Set(entries.map((e) => 0x40 + e.line));
  for (const l of last) {
    if (!arms.has(l.rcr)) {
      problems.push(`${name}: steady-state RCR match armed RCR=` +
                    `0x${l.rcr.toString(16)}, not any table entry's arm`);
    }
  }

  /* provenance: a "match" fixture must have been recorded from the ROM the
   * tree builds now.  The control is a deliberate mutant built in scratch,
   * so its hash is recorded but cannot be the tree's. */
  if (meta.expect === "match") {
    if (typeof meta.rom !== "string" ||
        !/^[0-9a-f]{64}$/.test(meta.rom_sha256 || "")) {
      problems.push(`${name}: meta.json has no rom/rom_sha256`);
    } else {
      const rom = path.join(__dirname, "..", meta.rom);
      if (fs.existsSync(rom)) {
        const now = crypto.createHash("sha256")
          .update(fs.readFileSync(rom)).digest("hex");
        if (now !== meta.rom_sha256) {
          problems.push(`${name}: ${meta.rom} is sha256 ${now.slice(0, 12)}… ` +
            `but the trace was recorded from ${meta.rom_sha256.slice(0, 12)}… — ` +
            `re-run tools/capture-review16.sh trace`);
        }
      } else {
        /* not a failure — the fixture is committed evidence — but it must be
         * visible that this run could not hold it to the tree's ROM */
        console.log(`${name}: provenance not checked — ${meta.rom} is not ` +
                    `built (run make -C tools) and the fixture's sha is ` +
                    `${meta.rom_sha256.slice(0, 12)}…`);
      }
    }
  } else if (meta.expect === "mismatch") {
    if (!meta.mutation) {
      problems.push(`${name}: the control's meta.json records no mutation`);
    }
  } else {
    problems.push(`${name}: meta.expect is ${JSON.stringify(meta.expect)}, ` +
                  `expected "match" or "mismatch"`);
  }
  return { problems, frameProblems, meta };
}

function checkTraceFixture(dir) {
  const name = path.basename(dir);
  const r = firstFrameProblems(dir);
  if (r.problems.length) {
    r.problems.forEach((p) => console.log(p));
    return 1;
  }
  if (r.meta.expect === "mismatch") {
    if (r.frameProblems.length === 0) {
      console.log(`${name}: CONTROL PASSED — the first-frame check did not ` +
                  `see the recorded B14 deviation, so it cannot be trusted ` +
                  `to catch B14 on a real capture`);
      return 1;
    }
    console.log(`${name}: OK (control: ${r.frameProblems[0]})`);
    return 0;
  }
  if (r.frameProblems.length) {
    r.frameProblems.forEach((p) => console.log(p));
    return 1;
  }
  console.log(`${name}: OK (first RCR match arms the table's step 0; the ` +
              `first four matches are steps 0..3 in order)`);
  return 0;
}

function main() {
  const dumps = path.join(__dirname, "dumps");
  if (!fs.existsSync(dumps)) {
    console.error(`no dumps in ${dumps} — run tools/capture.sh first`);
    return 2;
  }
  const dirs = fs.readdirSync(dumps).filter((d) => {
    if (!/^(?:viewer|browser)[0-9]+$|^(?:vsprite|bsprite)[0-9]+$|^vraster[0-9]+$|^vwide(?:336|512)$|^effect1$/.test(d)) {
      return false;
    }
    const scenedir = sceneDir(path.join(dumps, d));
    return fs.existsSync(path.join(dumps, d, "mednafen.png")) &&
      (scenedir === null || fs.existsSync(path.join(scenedir, "regs.json")));
  }).sort().map((d) => path.join(dumps, d));
  if (dirs.length === 0) {
    console.error("no viewer/browser/vsprite/bsprite/vraster/effect dumps " +
                  "with a matching scene found — run tools/capture.sh first");
    return 2;
  }
  let failed = 0;
  for (const dir of dirs) failed += checkViewer(dir);
  /* #74: the mixed-op fixture is required by name, because it is the only
   * witness for viewer.asm's per-step dispatch (REVIEW-30's V1: a stale
   * dispatch vector is invisible on every homogeneous shipped table).  A
   * missing capture or a table that no longer MIXES the two step shapes
   * fails the suite — otherwise deleting or homogenizing the fixture would
   * quietly remove the dispatch evidence and the suite would still pass. */
  const mixedDir = path.join(dumps, "vraster13");
  if (!fs.existsSync(path.join(mixedDir, "mednafen.png"))) {
    console.log("vraster13: MISSING — the #74 mixed-op dispatch fixture is " +
                "required (tools/genreview16.py r13 --viewer; " +
                "tools/capture.sh 13 vraster)");
    failed++;
  } else {
    const mixed = JSON.parse(
      fs.readFileSync(path.join(mixedDir, "raster.json"), "utf8"));
    let colourOnly = 0, byrOnly = 0;
    for (const e of mixed.entries || []) {
      const regs = ["bxr", "byr", "cr"].filter((k) => e[k] != null).length;
      const cram = e.cram && e.cram.length ? 1 : 0;
      if (regs === 0 && cram === 1) colourOnly++;
      if (regs === 1 && e.byr != null && cram === 0) byrOnly++;
    }
    if (!colourOnly || !byrOnly) {
      console.log(`vraster13: the fixture does not MIX the step shapes ` +
                  `(colour-only ${colourOnly}, BYR-only ${byrOnly}) — the ` +
                  `#74 dispatch witness is gone`);
      failed++;
    }
  }
  /* #68: the first-frame trace fixtures.  They are not pictures (no
   * mednafen.png), so they are not in `dirs`; the control (vtrace2-b14) is
   * part of the check: it must be REJECTED, or the match verdict means
   * nothing.  The two fixtures are required by name — deleting one must
   * fail the suite, not quietly shrink it. */
  const TRACE_FIXTURES = ["vtrace2", "vtrace2-b14"];
  for (const d of TRACE_FIXTURES) {
    if (!fs.existsSync(path.join(dumps, d, "meta.json"))) {
      console.log(`${d}: MISSING — the first-frame fixture is required ` +
                  `(run tools/capture-review16.sh trace)`);
      failed++;
    }
  }
  const traceDirs = fs.readdirSync(dumps)
    .filter((d) => /^vtrace[0-9]+(?:-b14)?$/.test(d) &&
                   fs.existsSync(path.join(dumps, d, "meta.json")))
    .sort().map((d) => path.join(dumps, d));
  for (const dir of traceDirs) failed += checkTraceFixture(dir);
  console.log(failed === 0
    ? `PASS: viewer/browser/vsprite/bsprite/vraster/effect ROMs match the ` +
      `renderer pixel for pixel on ${dirs.length} capture(s)` +
      (traceDirs.length
        ? `, and ${traceDirs.length} first-frame trace fixture(s) check out ` +
          `(the B14 control is rejected)`
        : "")
    : `FAIL: ${failed} viewer/browser/vsprite/bsprite/vraster/effect ` +
      `capture(s) or trace fixture(s) differ`);
  return failed === 0 ? 0 : 1;
}

process.exitCode = main();
