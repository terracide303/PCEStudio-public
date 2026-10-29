#!/usr/bin/env node
/*
 * tests/check-source-import.js — card #123's evidence: Add Source.
 *
 * The card closes on: "tests/check-import.js imports a test PNG (generated
 * here, not copied) as BG and as sprites — every tile uses <=16 colours from
 * one palette, every colour is a legal VCE word, the rendered result through
 * pce-bg.js matches the importer's own preview; a WAV becomes a DDA sample
 * whose playback through pce-psg.js correlates with the source; a small .mid
 * becomes a song with the right notes."
 *
 * NOTE ON THE FILE NAME: the card names tests/check-import.js, but that name
 * was taken by #117 (the panels' files into a running toy, ef6e222) before
 * this card's importer existed. The checks live here, beside it, so neither
 * card's evidence is buried in the other's.
 *
 * Every input is GENERATED in this file — a PNG built with zlib here, a WAV
 * written sample by sample, a MIDI file assembled event by event. Nothing is
 * copied from anywhere, so the test proves the importer on data the repo
 * does not already depend on.
 *
 *   node tests/check-source-import.js
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");

const src = require("../renderer/pce-source.js");
const bg = require("../renderer/pce-bg.js");
const screen = require("../renderer/pce-screen.js");
const sat = require("../renderer/pce-sat.js");
const ed = require("../renderer/pce-editor.js");
const seq = require("../renderer/pce-seq.js");

let checks = 0, failures = 0;
function check(ok, what, detail) {
  checks++;
  if (!ok) {
    failures++;
    console.log("  FAIL " + what + (detail === undefined ? "" : "  — " + detail));
  }
}

/* ------------------------------------------------------------------ PNG -- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/* An 8-bit RGBA PNG, filter 0 on every row. */
function makePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;    /* bit depth */
  ihdr[9] = 6;    /* colour type: RGBA */
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const o = y * (width * 4 + 1) + 1 + x * 4;
      const i = (y * width + x) * 4;
      raw[o] = rgba[i]; raw[o + 1] = rgba[i + 1];
      raw[o + 2] = rgba[i + 2]; raw[o + 3] = rgba[i + 3];
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

/* The test picture: three interfering waves, which give every 8x8 cell far
 * more than 15 distinct colours.  A smooth gradient would not: its cells
 * would fit in one palette exactly, and every dither would then be a
 * no-op -- a picture that cannot tell the modes apart cannot test them.
 * The top-left cell is transparent, for the alpha rule. */
function testPicture(w, h) {
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const wave = (p) => Math.round(128 + 120 * Math.sin(p));
      rgba[i] = wave(2 * Math.PI * x / 11);
      rgba[i + 1] = wave(2 * Math.PI * y / 9);
      rgba[i + 2] = wave(2 * Math.PI * (x + y) / 13);
      rgba[i + 3] = (x < 8 && y < 8) ? 0 : 255;   /* a transparent corner */
    }
  }
  return { width: w, height: h, rgba };
}

/* ---------------------------------------------------------------- checks -- */

const VCE = (w) => typeof w === "number" && w >= 0 && w <= 511 && w === Math.floor(w);

function tileColours(tile, palettes) {
  const row = palettes[tile.palette] || [];
  const seen = {};
  for (const v of tile.pixels) {
    const word = v === 0 ? null : row[v];
    if (v !== 0) seen[word === undefined ? "?" : word] = true;
  }
  return Object.keys(seen);
}

function run() {
  console.log("check-source-import — card #123, Add Source");

  /* ---- 1. the PNG is decoded, not guessed ------------------------------ */
  const pic = testPicture(64, 48);
  const png = makePng(pic.width, pic.height, pic.rgba);
  const info = src.pngInfo(new Uint8Array(png));
  check(info.width === 64 && info.height === 48, "pngInfo reads the header");
  const decoded = src.decodePng(new Uint8Array(png), zlib.inflateSync);
  let same = true;
  for (let i = 0; i < pic.rgba.length; i++)
    if (decoded.rgba[i] !== pic.rgba[i]) { same = false; break; }
  check(same, "decodePng gives back exactly the pixels that were encoded");

  /* ---- 2. BG: every tile one palette, every colour a VCE word ---------- */
  const bgr = src.importImage(decoded, { kind: "bg", dither: "none", name: "test" });
  check(bgr.kind === "bg", "importImage returns a BG result");
  check(bgr.palettes.length >= 1 && bgr.palettes.length <= 16,
        "the BG uses 1..16 palettes", String(bgr.palettes.length));
  let legal = true, wide = 0, maxColours = 0;
  for (const row of bgr.palettes) {
    check(row.length === 16, "a palette row is 16 entries");
    for (const w of row) if (!VCE(w)) { legal = false; }
  }
  check(legal, "every palette entry is a legal VCE word (0..511)");
  for (const t of bgr.tiles) {
    if (t.palette < 0 || t.palette >= bgr.palettes.length) wide++;
    for (const v of t.pixels) if (!(v >= 0 && v < 16)) wide++;
    const n = tileColours(t, bgr.palettes).length;
    if (n > 16) wide++;
    if (n > maxColours) maxColours = n;
  }
  check(wide === 0, "every BG tile's pixels index its own palette, 0..15");
  check(maxColours <= 16, "a tile shows at most 16 colours", String(maxColours));
  check(bgr.stats.tiles <= src.MAX_TILES, "the tiles fit the ROM's tile budget",
        String(bgr.stats.tiles));

  /* ---- 3. the files are the panels' own format ------------------------- */
  check(!!bgr.files["tiles.json"] && !!bgr.files["palettes.json"],
        "BG emits tiles.json and palettes.json");
  const files = Object.keys(bgr.files).map((n) => ({ name: n, source: bgr.files[n] }));
  let parsed = null;
  try { parsed = sat.pictureFromFiles(files); }
  catch (e) { console.log("    pictureFromFiles: " + e.code + " " + e.message); }
  check(!!parsed, "the panels' pictureFromFiles reads what the importer writes");
  check(!!parsed && parsed.map[0] === src.FIRST_CHAR,
        "the BAT's first cell names the first tile");

  /* ---- 4. pce-bg.js draws exactly the importer's preview --------------- */
  let frame = null;
  try { frame = ed.renderPreview(parsed); }
  catch (e) { console.log("    renderPreview: " + (e.code || "") + " " + e.message); }
  check(!!frame && frame.width === 256 && frame.height === 240,
        "the rendered frame is the 256x240 display");
  let diff = 0, worst = null;
  if (frame) {
    check(frame.pixels.length === bgr.preview.pixels.length,
          "preview and render are the same size");
    for (let i = 0; i < frame.pixels.length; i++) {
      if (frame.pixels[i] !== bgr.preview.pixels[i]) {
        diff++;
        if (worst === null) worst = i;
      }
    }
  }
  check(diff === 0, "pce-bg.js renders the importer's preview pixel for pixel",
        diff ? diff + " channel values differ, first at " + worst : "0 differ");

  /* ---- 5. sprites: patterns, each on one palette ----------------------- */
  const spr = src.importImage(decoded, { kind: "sprites", size: [16, 16],
                                         dither: "none", name: "sheet" });
  check(spr.kind === "sprites" && spr.patterns.length === 12,
        "a 64x48 picture is 4x3 patterns of 16x16", String(spr.patterns.length));
  check(spr.palettes.length <= 16, "sprites use at most 16 palettes");
  let sprLegal = true, sprWide = 0;
  for (const row of spr.palettes) for (const w of row) if (!VCE(w)) sprLegal = false;
  check(sprLegal, "every sprite palette entry is a legal VCE word");
  for (const p of spr.patterns) {
    for (const v of p.pixels) if (!(v >= 0 && v < 16)) sprWide++;
    const used = {};
    for (const v of p.pixels) if (v) used[spr.palettes[0][v]] = true;
    if (Object.keys(used).length > 16) sprWide++;
  }
  check(sprWide === 0, "every sprite pattern's pixels index one palette (0..15)");
  const sprFiles = Object.keys(spr.files).map((n) => ({ name: n, source: spr.files[n] }));
  let sprParsed = null;
  try { sprParsed = sat.pictureFromFiles(sprFiles); }
  catch (e) { console.log("    sprites pictureFromFiles: " + e.code + " " + e.message); }
  check(!!sprParsed, "sprites.json round-trips through the panels' reader");
  check(!!sprParsed && sprParsed.spritePatterns.length === spr.patterns.length,
        "the patterns survive the panels' reader");

  /* transparency: the transparent corner is colour 0 */
  check(spr.patterns[0].pixels[0] === 0,
        "an alpha-0 pixel is colour 0 in a sprite pattern");
  check(bgr.tiles.filter((t) => t.char === src.FIRST_CHAR)[0].pixels[0] === 0,
        "the blank tile is all colour 0");

  /* ---- 6. the alpha threshold decides what is colour 0 ----------------- */
  const half = new Uint8Array(64 * 4);
  for (let i = 0; i < 64; i++) {
    half[i * 4] = 240; half[i * 4 + 1] = 30; half[i * 4 + 2] = 90;
    half[i * 4 + 3] = 100;                     /* below 128, above 64 */
  }
  const low = src.importImage({ width: 8, height: 8, rgba: half },
                              { kind: "sprites", alphaThreshold: 128 });
  const high = src.importImage({ width: 8, height: 8, rgba: half },
                               { kind: "sprites", alphaThreshold: 64 });
  check(low.patterns[0].pixels[0] === 0,
        "a pixel at alpha 100 is colour 0 at threshold 128");
  check(high.patterns[0].pixels[0] !== 0,
        "the same pixel is drawn at threshold 64");

  /* ---- 7. the three dithers differ, and each keeps the rule ------------ */
  const modes = ["none", "ordered", "diffusion"];
  const seenTiles = new Set();
  for (const d of modes) {
    const r = src.importImage(decoded, { kind: "bg", dither: d });
    check(r.stats.dither === d, "the result names its dither: " + d);
    check(r.stats.maxTileColours <= 16, d + ": a tile still shows <= 16 colours");
    seenTiles.add(JSON.stringify(r.tiles.map((t) => t.pixels)));
  }
  check(seenTiles.size === 3,
        "none, ordered and diffusion give three different pictures",
        String(seenTiles.size));

  /* ---- 8. the palettes slider caps the palette count ------------------- */
  const capped = src.importImage(decoded, { kind: "bg", maxPalettes: 2 });
  check(capped.palettes.length <= 2, "maxPalettes 2 gives at most 2 palettes",
        String(capped.palettes.length));

  /* ---- 9. WAV -> a DDA sample the PSG plays back ----------------------- */
  const wav = makeWav(44100, 0.5, (t) => Math.sin(2 * Math.PI * 300 * t));
  const w = src.parseWav(new Uint8Array(wav));
  check(w.sampleRate === 44100 && w.channels === 1 && w.bits === 16,
        "the generated WAV parses (44100 Hz, mono, 16-bit)");
  check(Math.abs(w.frames - 22050) <= 1, "its frame count is 0.5 s", String(w.frames));

  const sample = src.importWav(new Uint8Array(wav), { rate: 6000, name: "tone" });
  check(sample.kind === "sample" && sample.rate === 6000,
        "the WAV becomes a 6000 Hz DDA sample");
  check(sample.samples.length >= 2990 && sample.samples.length <= 3010,
        "0.5 s at 6000 Hz is ~3000 samples", String(sample.samples.length));
  let fiveBit = true;
  for (const v of sample.samples) if (!(v >= 0 && v <= 31 && v === Math.floor(v))) fiveBit = false;
  check(fiveBit, "every DDA sample is 5 bits (0..31)");
  check(sample.stats.bytes === sample.samples.length,
        "the size shown against the ROM bar is one byte a sample");

  const played = src.renderSample(sample);
  check(played.pcm.length > 0 && played.sampleRate === 44100,
        "pce-psg.js renders the sample to PCM");
  const want = src.resample(w.mono, 44100, 6000);
  const got = src.resample(monoOf(played.pcm), played.sampleRate, 6000);
  /* pce_fast's bass/treble filters delay the output by a couple of samples,
   * so the comparison slides them into line over +-400 samples (66 ms). */
  const fit = src.correlationLag(want, got, 400);
  check(fit.r > 0.9, "the PSG's playback correlates with the source WAV (r > 0.9)",
        "r = " + fit.r.toFixed(4) + " at lag " + fit.lag);
  check(Math.abs(fit.lag) <= 16, "the filter's delay is under 16 samples",
        String(fit.lag));
  const silence = new Float32Array(got.length);
  check(src.correlateAt(want, silence, 0) === -1,
        "a flat signal correlates as -1 (it measures something)");

  /* ---- 10. .mid -> a song with the right notes ------------------------- */
  const midi = makeMidi([{ note: 60, start: 0, end: 480 },      /* C4 */
                         { note: 64, start: 480, end: 960 },    /* E4 */
                         { note: 67, start: 960, end: 1440 },   /* G4 */
                         { note: 72, start: 1440, end: 1920 }]);/* C5 */
  const m = src.parseMidi(new Uint8Array(midi));
  check(m.notes.length === 4, "the MIDI file parses to 4 notes", String(m.notes.length));
  check(m.division === 480, "its division is 480 ticks a quarter note");

  const song = src.importMidi(new Uint8Array(midi), { name: "riff" });
  check(song.kind === "song" && song.song.name === "riff", "the .mid becomes a song");
  check(song.song.instruments.length === 6,
        "the song carries the sequencer's six instruments");
  let songOk = false;
  try { seq.check(song.song); songOk = true; } catch (e) { console.log("    seq.check: " + e.message); }
  check(songOk, "the imported song passes the sequencer's own check");

  /* A step is a sixteenth note, so a quarter note is four steps and the
   * four notes land on steps 0, 4, 8 and 12 of pattern A, channel 1. */
  const wantNotes = [36, 40, 43, 48];    /* pce-seq.js: note 0 = C1 = MIDI 24 */
  const steps = [0, 4, 8, 12];
  const chan = song.song.patterns[0].channels[0];
  check(steps.map((s) => chan[s] && chan[s].note).join(",") === wantNotes.join(","),
        "C4 E4 G4 C5 land on steps 0, 4, 8, 12 as notes 36/40/43/48",
        steps.map((s) => (chan[s] ? chan[s].note : "null")).join(","));
  check(chan[0] && chan[0].length === 4, "a quarter note is four steps long");

  /* ---- 11. the kinds, and what each refuses ---------------------------- */
  const kinds = {};
  for (const k of ["bg", "sprites", "tilesheet", "palette"]) {
    const r2 = src.importImage(decoded, { kind: k });
    kinds[k] = r2;
    check(r2.kind === k, "kind " + k + " imports");
  }
  check(kinds.tilesheet.map === null, "a tilesheet carries no BAT map");
  check(!!kinds.palette.files["palettes.json"] && !kinds.palette.files["tiles.json"],
        "palette-only writes palettes.json and no tiles");
  check(kinds.sprites.files["sprites.json"] !== undefined, "sprites write sprites.json");

  const refusals = [
    ["source-kind", () => src.importImage(decoded, { kind: "mode7" })],
    ["source-dither", () => src.importImage(decoded, { dither: "noise" })],
    ["source-size", () => src.importImage(decoded, { kind: "sprites", size: [24, 24] })],
    ["source-alpha", () => src.importImage(decoded, { alphaThreshold: 300 })],
    ["png-signature", () => src.decodePng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), zlib.inflateSync)],
    ["wav-signature", () => src.parseWav(new Uint8Array(16))],
    ["mid-signature", () => src.parseMidi(new Uint8Array(16))],
    ["studio-json", () => src.importStudio("{ not json")],
    ["studio-version", () => src.importStudio('{"version":"other"}')],
    ["source-rate", () => src.importWav(new Uint8Array(wav), { rate: 100 })]
  ];
  for (const [code, fn] of refusals) {
    let got = null;
    try { fn(); } catch (e) { got = e.code; }
    check(got === code, "refuses with " + code, String(got));
  }

  /* ---- 12. the studio's own file -------------------------------------- */
  const envelope = JSON.stringify({
    version: "pce.studio/1", title: "tiny",
    files: [{ name: "main.lua", source: "function frame(t, f) end" },
            { name: "tiles.json", source: "{}" }]
  });
  const studio = src.importStudio(envelope);
  check(studio.kind === "studio" && studio.files.length === 2,
        "a pce.studio/1 file arrives as its files");
  check(src.kindOf("walk.png") === "bg" &&
        src.kindOf("tune.mid") === "song" &&
        src.kindOf("hit.wav") === "sample" &&
        src.kindOf("toy.pce.studio") === "studio",
        "kindOf names each dropped file's kind");

  /* ---- 13. the dialog offers what the card says, and only that --------- */
  /* The dialog is DOM; check-studio.js opens it (every button's handler is
   * executed there).  What is checked here is the wording the card names,
   * read from the module, because a label that silently drifted would be a
   * different program. */
  const panelSrc = fs.readFileSync(
    path.join(__dirname, "..", "renderer", "studio-panel-assets.js"), "utf8");
  const labels = [
    "drop a PNG, WAV, .mid or .pce.studio, or click to pick",
    "BG (tilemap)",
    "Sprites (patterns)",
    "Tilesheet (tiles only)",
    "Palette only",
    "Sample (DDA audio)",
    "Song (.mid)",
    "4bpp · 16 colours (the PC Engine always uses 16 per tile)",
    "palettes · at most 16",
    "none · flat nearest colour",
    "ordered · 8x8 Bayer",
    "diffusion · Floyd-Steinberg",
    "alpha threshold 128",
    "Preview appears here after you drop an image or audio file",
    "\"Cancel\"",
    "\"Add source\""
  ];
  for (const text of labels)
    check(panelSrc.indexOf(text) >= 0, "the dialog says: " + text);
  check(panelSrc.indexOf('"Mode 7"') < 0 && panelSrc.indexOf('["mode7"') < 0,
        "no Mode 7 option: the PC Engine has no rotation or scaling to map it to");
  check(panelSrc.indexOf("?? \"2bpp\"") < 0 && panelSrc.indexOf("8bpp") < 0,
        "no bit-depth list -- one fixed 4bpp line instead");

  /* ---- 14. the scratch files really are ours --------------------------- */
  const out = path.join(os.tmpdir(), "pcestudio-source-import");
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "test.png"), png);
  fs.writeFileSync(path.join(out, "test.wav"), wav);
  fs.writeFileSync(path.join(out, "test.mid"), midi);
  check(fs.statSync(path.join(out, "test.png")).size === png.length,
        "the generated PNG is on disk for inspection at " + out);

  console.log("\n" + checks + " checks, " + (checks - failures) + " PASS, " +
              failures + " FAIL");
  if (failures) process.exit(1);
}

/* ---------------------------------------------------------------- inputs -- */

function monoOf(pcm) {
  const n = pcm.length / 2;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = pcm[i * 2] / 32768;
  return out;
}

/* 16-bit mono PCM WAV, `fn(t)` giving the signal in -1..1. */
function makeWav(sampleRate, seconds, fn) {
  const frames = Math.floor(sampleRate * seconds);
  const data = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i++) {
    const v = Math.max(-1, Math.min(1, fn(i / sampleRate)));
    data.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(1, 0);              /* PCM */
  fmt.writeUInt16LE(1, 2);              /* mono */
  fmt.writeUInt32LE(sampleRate, 4);
  fmt.writeUInt32LE(sampleRate * 2, 8); /* byte rate */
  fmt.writeUInt16LE(2, 12);             /* block align */
  fmt.writeUInt16LE(16, 14);            /* bits */
  const body = Buffer.concat([
    Buffer.from("WAVE", "latin1"),
    Buffer.from("fmt ", "latin1"), Buffer.from([16, 0, 0, 0]), fmt,
    Buffer.from("data", "latin1"),
    (() => { const n = Buffer.alloc(4); n.writeUInt32LE(data.length, 0); return n; })(),
    data
  ]);
  const riff = Buffer.alloc(8);
  riff.write("RIFF", 0, "latin1");
  riff.writeUInt32LE(body.length, 4);
  return Buffer.concat([riff, body]);
}

/* A format-0 Standard MIDI File, one track, 480 ticks a quarter, 120 BPM. */
function makeMidi(notes) {
  const track = [];
  const push = (...bytes) => { for (const b of bytes) track.push(b & 0xFF); };
  const varInt = (v) => {
    const out = [v & 0x7F];
    v >>>= 7;
    while (v) { out.unshift((v & 0x7F) | 0x80); v >>>= 7; }
    return out;
  };
  push(0x00, 0xFF, 0x51, 0x03, 0x07, 0xA1, 0x20);   /* 120 BPM */
  push(0x00, 0xFF, 0x03, 0x04, 0x52, 0x49, 0x46, 0x46); /* "RIFF" */
  let tick = 0;
  const events = [];
  for (const n of notes) {
    events.push({ at: n.start, bytes: [0x90, n.note, 0x64] });
    events.push({ at: n.end, bytes: [0x80, n.note, 0x40] });
  }
  events.sort((a, b) => a.at - b.at);
  for (const e of events) {
    push(...varInt(e.at - tick));
    tick = e.at;
    push(...e.bytes);
  }
  push(0x00, 0xFF, 0x2F, 0x00);

  const header = Buffer.alloc(14);
  header.write("MThd", 0, "latin1");
  header.writeUInt32BE(6, 4);
  header.writeUInt16BE(0, 8);       /* format 0 */
  header.writeUInt16BE(1, 10);      /* one track */
  header.writeUInt16BE(480, 12);    /* division */
  const len = Buffer.alloc(4);
  len.writeUInt32BE(track.length, 0);
  return Buffer.concat([header, Buffer.from("MTrk", "latin1"), len, Buffer.from(track)]);
}

run();
