#!/usr/bin/env node
/*
 * tests/check-assets.js — the closing evidence of #99 (the ASSETS tab).
 *
 *   node tests/check-assets.js
 *
 * The card's evidence is: "check-studio.js adds each built-in to a toy and
 * plays a note through pce-psg.js (non-silent, the right pitch for melodic
 * ones), the bars match the toy's measured use".
 *
 * NOTE ON THE FILE: the checks live here rather than in check-studio.js
 * because that file was carrying another seat's in-flight SCANLINES work
 * (#92, 347 uncommitted lines) while #99 was written; committing it would
 * have swept that work into this card's commit.  The precedent is #91's
 * check-breaker-78.js.  The panel checks below boot the real panel module
 * against a stub DOM and a studio object with #102's documented API, the way
 * check-studio.js's stub boots the page; when the tree settles they belong
 * beside it.
 *
 * NOTE ON AUTHORSHIP: this file was written by the builder.  Per the
 * workshop's role split that means it tests what the builder already
 * believed, and a cold break by another seat (@review / @test) is owed
 * before the card closes.
 *
 * What it proves, and what it does not:
 *
 *   instruments  fifteen built-ins with ppu.toys' names; the eight melodic
 *                ones are a 32-step 5-bit wave plus an envelope and the seven
 *                drums a noise preset on channels 5-6 (R7).  Each is PLAYED
 *                through renderer/pce-psg.js — the sample-exact Mednafen
 *                model — by writing the registers a toy would; the check
 *                asserts the PCM is not silent and that a melodic note's
 *                fundamental, measured by autocorrelation, is the frequency
 *                CLOCK/(64*F) the register wrote.  The expected frequency is
 *                recomputed here from the PSG clock, not read from
 *                pce-assets.js's toneHz(), so the model cannot agree with
 *                itself.  NOT PROVEN: that a real HuC6280 with these registers
 *                sounds like this — that is check-psg.js's Mednafen capture,
 *                and these writes are ordinary R2/R3/R4/R5/R6/R7 writes.
 *   bars         VRAM / CRAM / ROM are measured, not declared: the VRAM bar
 *                is the total of the non-free segments of #26's vramMap();
 *                the CRAM bar is counted here from cram.bin's own bytes; the
 *                ROM bar is pce-validate.js's estimate plus the toy's files.
 *                Two different Mednafen dumps give two different VRAM bars,
 *                and adding a sprite to the SAT raises one — a constant
 *                would not.
 *   songs        a real .dmf (tests/dumps/hutrack1/demo.dmf) read by
 *                renderer/pce-dmf.js summarises to "N notes · M patterns",
 *                with both counts re-derived here from the module's pattern
 *                cells and order list.
 *   toy file     Add to toy writes instruments.json; a second add of the same
 *                name is refused with asset-duplicate, and the stored patch
 *                is exactly the model's (wave, envelope, source built-in).
 *   refusals     every documented code comes back by code.
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const RENDERER = path.join(__dirname, "..", "renderer");
const DUMPS = path.join(__dirname, "dumps");

const A = require(path.join(RENDERER, "pce-assets.js"));
const panels = require(path.join(RENDERER, "pce-panels.js"));
const validate = require(path.join(RENDERER, "pce-validate.js"));
const dmf = require(path.join(RENDERER, "pce-dmf.js"));
const psg = require(path.join(RENDERER, "pce-psg.js"));
/* #156: the importer the sources' placement is checked against — the same
 * public call pce-toyhost.js's #117 import makes */
const satM = require(path.join(RENDERER, "pce-sat.js"));
const edM = require(path.join(RENDERER, "pce-editor.js"));

let checks = 0;
const failures = [];

function check(ok, name) {
  checks++;
  if (!ok) {
    failures.push(name);
    console.log("FAIL  " + name);
  } else {
    console.log("ok    " + name);
  }
}
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  check(ok, ok ? name : name + " (got " + JSON.stringify(got) +
                 ", want " + JSON.stringify(want) + ")");
}
function close(name, got, want, tol) {
  const ok = Math.abs(got - want) <= tol;
  check(ok, ok ? name : name + " (got " + got + ", want " + want + " ± " + tol + ")");
}
function refuses(code, fn, name) {
  let got = null;
  try { fn(); } catch (e) { got = e.code || "no-code"; }
  check(got === code, name + " (" + (got || "no refusal") + ")");
}

/* ---- 1. the fifteen built-ins ------------------------------------------ */

/* ppu.toys' list, in its order (Dennis's screenshot, 2026-10-29). */
const NAMES = ["piano", "bass", "lead", "strings", "organ", "bell", "flute",
               "pluck", "kick", "snare", "hat", "ohat", "tom", "clap",
               "crash"];
const MELODIC = NAMES.slice(0, 8);
const DRUMS = NAMES.slice(8);

function checkList() {
  console.log("== the built-in instruments");
  eq("#99: fifteen built-ins, ppu.toys' names in its order",
     A.INSTRUMENTS.map((i) => i.name), NAMES);
  eq("#99: eight melodic, seven drums",
     [A.INSTRUMENTS.filter((i) => i.kind === "wave").map((i) => i.name),
      A.INSTRUMENTS.filter((i) => i.kind === "noise").map((i) => i.name)],
     [MELODIC, DRUMS]);
  check(A.INSTRUMENTS.every((i) => i.about && i.about.length > 8),
        "#99: each built-in says what it is (the list's second line)");
  check(A.INSTRUMENTS.every((i) => A.descriptor(i).length > 8),
        "#99: each built-in has a PSG descriptor (" +
        A.descriptor(A.INSTRUMENTS[0]) + ")");
  eq("#99: a drum's descriptor names its channel and NF",
     A.descriptor(A.byId("hat")), "NOISE · channel 5 · NF 26");
}

function checkWaves() {
  const waves = [];
  for (const inst of A.INSTRUMENTS) {
    if (inst.kind !== "wave") {
      check(A.NOISE_CHANNELS.indexOf(inst.channel) >= 0,
            "#99: " + inst.name + " is noise on channel " + (inst.channel + 1) +
            " (R7 reaches 5-6 only)");
      check(Number.isInteger(inst.nf) && inst.nf >= 0 && inst.nf <= 31,
            "#99: " + inst.name + " NF " + inst.nf + " is 5 bits");
      continue;
    }
    check(inst.wave.length === 32, "#99: " + inst.name + " is a 32-step wave");
    check(inst.wave.every((v) => Number.isInteger(v) && v >= 0 && v <= 31),
          "#99: " + inst.name + "'s steps are 5 bits");
    const lo = Math.min.apply(null, inst.wave), hi = Math.max.apply(null, inst.wave);
    check(hi - lo >= 4, "#99: " + inst.name + " is not a flat wave (" +
          lo + ".." + hi + ")");
    waves.push(inst.wave.join(","));
  }
  eq("#99: no two melodic instruments share a wave", waves.length,
     new Set(waves).size);

  /* the drums differ by their noise clock, and the set spans it */
  const nfs = A.INSTRUMENTS.filter((i) => i.kind === "noise").map((i) => i.nf);
  check(new Set(nfs).size >= 6, "#99: the drums use " + new Set(nfs).size +
        " different noise clocks (" + nfs.join(",") + ")");
  check(Math.min.apply(null, nfs) <= 4 && Math.max.apply(null, nfs) >= 25,
        "#99: the drum set spans the noise clock (low " +
        Math.min.apply(null, nfs) + " to high " + Math.max.apply(null, nfs) + ")");
}

function checkEnvelopes() {
  for (const inst of A.INSTRUMENTS) {
    const e = inst.envelope;
    check(!!e && e.size === e.data.length && e.data.length >= 4,
          "#99: " + inst.name + " has an envelope of " + (e && e.size) + " steps");
    check(e.data.every((v) => Number.isInteger(v) && v >= 0 && v <= 31),
          "#99: " + inst.name + "'s envelope is the channel level's 5 bits");
    check(e.data.some((v) => v > 0), "#99: " + inst.name + " is audible somewhere");
    check(e.loop === undefined || (e.loop >= 0 && e.loop <= e.size),
          "#99: " + inst.name + "'s loop point is inside the envelope");
  }
}

/* ---- 2. playing one through the PSG ------------------------------------ */

/* The PSG's own tone, from the clock and the register: F divides the clock by
 * two per step over 32 steps (psg.cpp RecalcFreqCache / PSG PB-3). */
function expectedHz(freq) {
  return 7159090 / (64 * freq);
}

function playOne(inst, note) {
  const r = A.play(inst, { note: note, frames: 30 });
  const n = r.pcm.length / 2;
  return {
    rms: A.rms(r.pcm, 0, Math.floor(n * 0.25)),
    fundamental: A.fundamental(r.pcm, r.sampleRate, Math.floor(n * 0.2), n),
    whole: A.rms(r.pcm, 0, n),
    trace: r.trace,
    frames: r.frames
  };
}

function checkPlaying() {
  console.log("== playing every built-in through pce-psg.js");
  for (const inst of A.INSTRUMENTS) {
    const p = playOne(inst, "A4");
    check(p.rms.peak > 200 && p.rms.rms > 40,
          "#99: " + inst.name + " is not silent (peak " + p.rms.peak +
          ", rms " + p.rms.rms.toFixed(0) + ")");
  }

  /* melodic: the pitch is the register's, for three notes in three octaves */
  for (const note of ["C4", "A4", "E5"]) {
    for (const inst of A.INSTRUMENTS.filter((i) => i.kind === "wave")) {
      const p = playOne(inst, note);
      const want = expectedHz(p.trace.freq);
      close("#99: " + inst.name + " at " + note + " sounds " +
            want.toFixed(1) + " Hz", p.fundamental.hz, want, want * 0.02);
    }
  }

  /* the envelope is audible as a shape: a decaying patch really decays, a
   * held one does not */
  for (const name of ["piano", "bell", "pluck"]) {
    const inst = A.byId(name);
    const r = A.play(inst, { note: "A4", frames: 30 });
    const n = r.pcm.length / 2;
    const first = A.rms(r.pcm, 0, Math.floor(n / 4)).rms;
    const last = A.rms(r.pcm, Math.floor(n * 3 / 4), n).rms;
    check(last < first * 0.6, "#99: " + name + "'s envelope decays (" +
          first.toFixed(0) + " -> " + last.toFixed(0) + ")");
  }
  {
    const inst = A.byId("organ");
    const r = A.play(inst, { note: "A4", frames: 30 });
    const n = r.pcm.length / 2;
    const first = A.rms(r.pcm, 0, Math.floor(n / 4)).rms;
    const last = A.rms(r.pcm, Math.floor(n * 3 / 4), n).rms;
    check(last >= first * 0.8, "#99: organ holds its level (" +
          first.toFixed(0) + " -> " + last.toFixed(0) + ")");
  }

  /* the trace really writes the wave: 32 R6 writes on the selected channel,
   * and the drum writes R7 instead */
  {
    const t = A.traceFor(A.byId("lead"), { note: "A4" });
    const r6 = t.events.filter((e) => e.reg === 6);
    eq("#99: a melodic note uploads 32 wave steps", r6.length, 32);
    eq("#99: ... and they are the instrument's wave",
       r6.map((e) => e.value), A.byId("lead").wave);
    check(t.events.some((e) => e.reg === 7) === false,
          "#99: a melodic note does not touch the noise register");
  }
  {
    const t = A.traceFor(A.byId("snare"), { note: "A4" });
    const r7 = t.events.filter((e) => e.reg === 7);
    check(r7.length === 1 && (r7[0].value & 0x80) && (r7[0].value & 0x1F) === 12,
          "#99: a drum enables noise with its NF (" + (r7[0] && r7[0].value) + ")");
    eq("#99: ... on channel 5", t.channel, 4);
  }
}

/* ---- 3. add to toy, and the refusals ---------------------------------- */

function checkAdd() {
  console.log("== Add to toy (instruments.json)");
  let text = null;
  for (const inst of A.INSTRUMENTS) {
    const out = A.addInstrument(text, inst);
    text = out.text;
  }
  const doc = A.parseInstruments(text);
  eq("#99: all fifteen add to the toy's file", doc.instruments.length, 15);
  eq("#99: in ppu.toys' order", doc.instruments.map((i) => i.name), NAMES);
  check(doc.instruments.every((i) => i.source === "built-in"),
        "#99: each one is carried as built-in (it is the toy's copy now)");
  const lead = doc.instruments.find((i) => i.name === "lead");
  eq("#99: the stored patch keeps the wave", lead.wave, A.byId("lead").wave);
  eq("#99: ... and the envelope",
     [lead.envelope.size, lead.envelope.loop, lead.envelope.data],
     [A.byId("lead").envelope.size, A.byId("lead").envelope.loop,
      A.byId("lead").envelope.data]);
  const snare = doc.instruments.find((i) => i.name === "snare");
  eq("#99: a drum stores its channel and NF", [snare.channel, snare.nf], [4, 12]);

  refuses("asset-duplicate",
          () => A.addInstrument(text, A.byId("lead")),
          "#99: adding the same instrument twice is refused");
  const removed = A.removeInstrument(text, "lead");
  eq("#99: Remove takes it out again",
     A.parseInstruments(removed.text).instruments.length, 14);

  console.log("== the refusals come back by code");
  refuses("asset-json", () => A.parseInstruments("{nope"), "not JSON");
  refuses("asset-shape", () => A.parseInstruments('{"waves":[]}'),
          "no instruments array");
  refuses("asset-wave",
          () => A.addInstrument(null, { name: "bad", kind: "wave",
            wave: new Array(31).fill(16), envelope: { size: 4, loop: 3,
              data: [31, 20, 10, 0] } }),
          "a 31-step wave");
  refuses("asset-wave",
          () => A.addInstrument(null, { name: "bad", kind: "wave",
            wave: new Array(32).fill(32), envelope: { size: 4, loop: 3,
              data: [31, 20, 10, 0] } }),
          "a wave step above 31");
  refuses("asset-envelope",
          () => A.addInstrument(null, { name: "bad", kind: "wave",
            wave: new Array(32).fill(16), envelope: { size: 4, loop: 3,
              data: [31, 20, 40, 0] } }),
          "an envelope step above 31");
  refuses("asset-envelope",
          () => A.addInstrument(null, { name: "bad", kind: "wave",
            wave: new Array(32).fill(16), envelope: { size: 5, loop: 3,
              data: [31, 20, 10, 0] } }),
          "an envelope whose size disagrees with its data");
  refuses("asset-noise",
          () => A.addInstrument(null, { name: "bad", kind: "noise", channel: 0,
            nf: 3, envelope: { size: 2, loop: 2, data: [31, 0] } }),
          "noise on channel 1 (no generator there)");
  refuses("asset-noise",
          () => A.addInstrument(null, { name: "bad", kind: "noise", channel: 4,
            nf: 40, envelope: { size: 2, loop: 2, data: [31, 0] } }),
          "NF above 31");
  refuses("asset-name",
          () => A.addInstrument(null, { name: "two words", kind: "noise",
            channel: 4, nf: 3, envelope: { size: 2, loop: 2, data: [31, 0] } }),
          "a name that is not a flat identifier");
}

/* ---- 4. songs: a real .dmf -------------------------------------------- */

function checkSongs() {
  console.log("== songs, from a real module");
  const raw = fs.readFileSync(path.join(DUMPS, "hutrack1", "demo.dmf"));
  const mod = dmf.read(raw);

  /* independent: the patterns the order list names, and the note cells in
   * them, counted here from pce-dmf's own output */
  const used = new Set();
  for (const channel of mod.orderMatrix)
    for (const p of channel) if (p !== undefined && p !== null) used.add(p);
  let notes = 0;
  for (const p of used) {
    for (let ch = 0; ch < 6; ch++) {
      const rows = mod.patterns[p] && (mod.patterns[p][ch] || mod.patterns[p][String(ch)]);
      for (const row of rows || []) if (row && row.note) notes++;
    }
  }

  const song = A.fromDmf(mod);
  eq("#99: the song's name is the module's", song.name, mod.songName);
  eq("#99: its pattern count is the order list's distinct patterns",
     song.patterns, used.size);
  eq("#99: its note count is the note cells in those patterns",
     song.notes, notes);
  eq("#99: the list's line is ppu.toys' shape", A.songLabel(song),
     notes + " notes · " + used.size + " patterns");
  check(notes > 0 && used.size > 0,
        "#99: the demo module has music in it (" + A.songLabel(song) + ")");

  const added = A.addSong(null, song);
  const doc = A.parseSongs(added.text);
  eq("#99: songs.json holds it", doc.songs.length, 1);
  eq("#99: ... with both counts", [doc.songs[0].notes, doc.songs[0].patterns],
     [notes, used.size]);
  refuses("asset-duplicate", () => A.addSong(added.text, song),
          "a song the toy already has");
  const blank = A.blankSong("song1");
  check(blank.blank && A.songLabel(blank) === "0 notes · 0 patterns",
        "#99: a blank song is marked as having no music yet");
}

/* ---- 5. the named sources (#156) --------------------------------------- */

/* A small picture the panels' models accept: two tiles, one background
 * palette row, one sprite pattern on one sprite row.  The expected numbers
 * below are recomputed here, not read from pce-assets.js. */
function sourcesFixture() {
  const blank = new Array(64).fill(0);
  const cross = new Array(64).fill(0);
  cross[0] = 1; cross[63] = 15;         /* colour indexes into the bg row */
  const bgRow = new Array(16).fill(0);
  bgRow[1] = 0x1FF; bgRow[15] = 0x0FF;
  const sprRow = new Array(16).fill(0);
  sprRow[1] = 0x1C0;
  const background = new Array(16).fill(null);
  background[0] = bgRow;
  const sprites = new Array(16).fill(null);
  sprites[0] = sprRow;
  const tilesDoc = {
    version: 1, video: 256,
    tiles: [{ char: 64, palette: 0, pixels: blank },
            { char: 65, palette: 0, pixels: cross }],
    map: { mwr: 0, bxr: 0, byr: 0, cells: new Array(1024).fill(64) }
  };
  const palsDoc = { version: 1, backdrop: 0, background, sprites };
  const spritesDoc = {
    version: 1,
    patterns: [{ width: 16, height: 16, pixels: new Array(256).fill(0) }],
    sprites: []
  };
  const sourcesDoc = {
    version: 1,
    sources: [
      { name: "hill", kind: "bg",
        tiles: { first: 0, count: 2 }, map: true,
        palettes: { side: "bg", first: 0, count: 1 } },
      { name: "dot", kind: "sprites",
        patterns: { first: 0, count: 1 }, sprites: { first: 0, count: 0 },
        palettes: { side: "spr", first: 0, count: 1 } }
    ]
  };
  return [
    { name: "tiles.json", source: JSON.stringify(tilesDoc) + "\n" },
    { name: "palettes.json", source: JSON.stringify(palsDoc) + "\n" },
    { name: "sprites.json", source: JSON.stringify(spritesDoc) + "\n" },
    { name: "sources.json", source: JSON.stringify(sourcesDoc) + "\n" }
  ];
}

function checkSources() {
  console.log("== the named sources, at the importer's placement");
  const files = sourcesFixture();

  /* no sources.json at all: an empty list, no refusal — the common case */
  const none = A.sources([{ name: "tiles.json", source: "{}" }]);
  eq("#156: no sources.json is an empty list, not an error",
     none, { sources: [], notes: [] });

  const r = A.sources(files);
  eq("#156: the list is the document's order",
     r.sources.map((s) => [s.name, s.kind]),
     [["hill", "bg"], ["dot", "sprites"]]);
  eq("#156: no notes for ranges the files hold", r.notes, []);

  /* the placement, recomputed independently from the importer's own calls */
  const pic = satM.pictureFromFiles(files);
  const codes = edM.patternLayout(pic).codes;
  const hill = r.sources[0], dot = r.sources[1];
  eq("#156: a bg source owns its tiles' words (char*16) and the BAT",
     hill.vram.segments,
     [{ what: "tiles", first: 64 * 16, count: 2 * 16 },
      { what: "map", first: 0, count: 1024 }]);
  eq("#156: its palette rows are the bg CRAM entries",
     hill.cram.segments,
     [{ what: "palettes", side: "bg", first: 0, count: 16 }]);
  eq("#156: a sprites source owns the importer's pattern cells and no SAT",
     dot.vram.segments,
     [{ what: "patterns", first: codes[0] * 64, count: 64 }]);
  eq("#156: its palette rows are the sprite CRAM entries",
     dot.cram.segments,
     [{ what: "palettes", side: "spr", first: 256, count: 16 }]);
  eq("#156: the size and placement are the words and entries",
     [hill.size, hill.placement],
     ["1,056 words · 16 colours",
      "VRAM 0x400-0x41f tiles · VRAM 0x0-0x3ff map · CRAM 0-15"]);

  /* the preview: the files' own cells, laid out as a sheet */
  check(!!hill.preview && !!dot.preview, "#156: both previews are built eagerly");
  eq("#156: the tiles preview is a 16-column sheet of the source's cells",
     [hill.preview.cols, hill.preview.cells.length,
      hill.preview.cells[1].char, hill.preview.cells[1].x,
      hill.preview.cells[1].y],
     [16, 2, 65, 8, 0]);
  eq("#156: the tiles preview carries the importer's own pixels",
     hill.preview.cells[1].pixels[63], 15);
  eq("#156: the patterns preview carries the importer's cell and size",
     [dot.preview.cells.length, dot.preview.cells[0].cell,
      dot.preview.cells[0].w, dot.preview.cells[0].h],
     [1, codes[0], 16, 16]);
  eq("#156: each preview names the palette rows it uses",
     [hill.preview.palettes.map((p) => p.side + p.row),
      dot.preview.palettes.map((p) => p.side + p.row)],
     [["bg0"], ["spr0"]]);
  eq("#156: the preview's row is the file's row",
     hill.preview.palettes[0].words[1], 0x1FF);

  /* the bars carry the sources as their parts */
  const bar = A.bars({
    map: { segments: [{ kind: "map", words: 1024 },
                      { kind: "tiles", words: 32 },
                      { kind: "patterns", words: 64 },
                      { kind: "sat", words: 512 },
                      { kind: "free", words: 100 }] },
    state: { cram: new Uint8Array(1024) },
    files: files,
    sources: r.sources
  });
  eq("#156: the VRAM bar's parts are the sources plus the rest",
     bar[0].parts.map((p) => [p.label, p.used, p.source]),
     [["hill", 1056, true], ["dot", 64, true], ["other", 512, false]]);
  check(bar[0].parts[0].first === 1024 && bar[0].parts[1].first === codes[0] * 64,
        "#156: ... each part marked with its range's first word (" +
        bar[0].parts[0].first + ", " + bar[0].parts[1].first + ")");
  eq("#156: the CRAM bar's parts are the sources",
     bar[1].parts.map((p) => [p.label, p.used, p.first]),
     [["hill", 16, 0], ["dot", 16, 256]]);

  /* stale ranges: noted and dropped, not refused */
  const stale = sourcesFixture();
  const staleDoc = JSON.parse(stale[3].source);
  staleDoc.sources[0].tiles.count = 5000;
  staleDoc.sources[1].patterns = { first: 30, count: 10 };
  stale[3].source = JSON.stringify(staleDoc);
  const r2 = A.sources(stale);
  eq("#156: a range past the files is dropped with a note, once",
     r2.notes,
     ["hill: 0+5000 runs past 2 — dropped",
      "dot: 30+10 runs past 1 — dropped"]);
  eq("#156: what remains still lists the source",
     r2.sources[0].vram.segments.map((s) => s.what), ["map"]);
  eq("#156: ... and a source keeps what still fits (its palette rows)",
     r2.sources.map((s) => [s.name, s.vram.segments.length,
                            s.cram.segments.length]),
     [["hill", 1, 1], ["dot", 0, 1]]);

  /* refusals */
  const bad = sourcesFixture();
  bad[3].source = "{nope";
  refuses("source-json", () => A.sources(bad), "#156: sources.json that is not JSON");
  bad[3].source = '{"version":1}';
  refuses("source-shape", () => A.sources(bad), "#156: no sources array");
  bad[3].source = JSON.stringify({ version: 1, sources: [{ name: "x", kind: "bg" }] });
  refuses("source-shape", () => A.sources(bad), "#156: an entry with no ranges");
  bad[3].source = JSON.stringify({
    version: 1,
    sources: [{ name: "x", kind: "bg", tiles: { first: 0, count: 1 },
                palettes: { side: "mid", first: 0, count: 1 } }]
  });
  refuses("source-shape", () => A.sources(bad), "#156: a palette side that is not bg/spr");
  bad[3].source = JSON.stringify({
    version: 1,
    sources: [{ name: "x", kind: "song", tiles: { first: 0, count: 1 } }]
  });
  refuses("source-kind", () => A.sources(bad), "#156: a kind the studio does not know");
  bad[3].source = JSON.stringify({
    version: 1, sources: [42]
  });
  refuses("source-shape", () => A.sources(bad), "#156: an entry that is not an object");
  check(A.REFUSALS["source-json"] && A.REFUSALS["source-shape"] &&
        A.REFUSALS["source-kind"] && A.REFUSALS["no-import"],
        "#156: the new refusals are documented in REFUSALS");

  /* mergeSource: the Add Source entry, replaced by name, else appended */
  const entry = { name: "hill", kind: "bg", tiles: { first: 0, count: 2 },
                  map: true, palettes: { side: "bg", first: 0, count: 1 } };
  const m1 = A.mergeSource(null, entry);
  eq("#156: mergeSource makes the file and joins the entry",
     JSON.parse(m1.text).sources.map((s) => s.name),
     ["hill"]);
  const m2 = A.mergeSource(m1.text, Object.assign({}, entry, { tiles: { first: 0, count: 9 } }));
  eq("#156: ... a second add of the same name replaces the entry",
     JSON.parse(m2.text).sources.map((s) => s.tiles.count), [9]);
  const m3 = A.mergeSource(m2.text, { name: "dot", kind: "sprites",
                                      patterns: { first: 0, count: 1 } });
  eq("#156: ... a different name is appended",
     JSON.parse(m3.text).sources.map((s) => s.name), ["hill", "dot"]);
}

/* ---- 6. the bars are measured ----------------------------------------- */

const SAT_ADDR = 0x7F00;

function loadDump(name) {
  const dir = path.join(DUMPS, name);
  const regs = JSON.parse(fs.readFileSync(path.join(dir, "regs.json"), "utf8"));
  const vram = new Uint8Array(fs.readFileSync(path.join(dir, "vram.bin")));
  const cram = new Uint8Array(fs.readFileSync(path.join(dir, "cram.bin")));
  const satFile = path.join(dir, "sat.bin");
  const opts = { vram, cram, regs, width: 256, height: 232, firstScanline: 18 };
  if (fs.existsSync(satFile)) opts.sat = new Uint8Array(fs.readFileSync(satFile));
  return { name, opts, vram, cram, regs };
}

function cramWords(cram) {
  const out = [];
  for (let i = 0; i < 512; i++)
    out.push((cram[i * 2] | (cram[i * 2 + 1] << 8)) & 0x1FF);
  return out;
}

/* A toy the validator can price: the page's palette toy (#75's SETUP plus
 * its init/frame), quoted here so this check depends on the validator and
 * not on the page. */
const TOY = [
  "local function puttile(char, fn)",
  "  for row = 0, 7 do",
  "    local w0 = 0",
  "    for col = 0, 7 do",
  "      local c = fn(col, row)",
  "      if c % 2 >= 1 then w0 = w0 | (1 << (7 - col)) end",
  "    end",
  "    vram[char * 16 + row] = w0",
  "  end",
  "end",
  "function init()",
  "  for y = 0, 27 do",
  "    for x = 0, 31 do vram[y * 32 + x] = 0x0040 end",
  "  end",
  "  puttile(0x40, function(col, row)",
  "    if col == row then return 15 else return 1 end",
  "  end)",
  "end",
  "function frame(t, f)",
  "  for e = 1, 15 do",
  "    pal(e, rgb((e + f) % 8, f % 8, (e * 3 + f) % 8))",
  "  end",
  "end",
  ""
].join("\n");

function checkBars() {
  console.log("== the bars are the toy's measured use");
  const report = validate.validate(TOY);
  check(report.ok || report.problems.length === 0,
        "the validator prices the palette toy (" + (report.ok ? "ok" : report.code) + ")");
  check(!!report.budgets && report.budgets.rom.bytes > 0,
        "#99: the validator gives a ROM estimate (" +
        (report.budgets && report.budgets.rom.bytes) + " bytes)");

  const files = [
    { name: "main.lua", source: TOY },
    { name: "tiles.json", source: '{"version":1,"tiles":[]}\n' },
    { name: "palettes.json", source: '{"version":1}\n' },
    { name: "sprites.json", source: '{"version":1,"sprites":[]}\n' },
    { name: "instruments.json", source: '{"version":1,"instruments":[]}\n' },
    { name: "songs.json", source: '{"version":1,"songs":[]}\n' }
  ];

  const seen = {};
  for (const name of ["painted", "scene1"]) {
    const dump = loadDump(name);
    const st = panels.state(dump.opts);
    const map = panels.vramMap(st);
    const bars = A.bars({ state: st, map, report, files });
    const vram = bars.find((b) => b.id === "vram");
    const cram = bars.find((b) => b.id === "cram");
    const rom = bars.find((b) => b.id === "rom");

    const wantVram = map.segments.filter((s) => s.kind !== "free")
      .reduce((n, s) => n + s.words, 0);
    eq("#99: " + name + ": the VRAM bar is every claimed word", vram.used, wantVram);
    eq("#99: " + name + ": ... and its parts add up",
       vram.parts.reduce((n, p) => n + p.used, 0), vram.used);
    eq("#99: " + name + ": VRAM's capacity is 0x8000", vram.cap, 32768);
    check(vram.used > 0 && vram.used < vram.cap,
          "#99: " + name + ": the bar sits inside the chip (" + vram.used + ")");

    /* CRAM counted here, from cram.bin's bytes */
    const words = cramWords(dump.cram);
    const bg = words.slice(0, 256).filter((w) => w !== 0).length;
    const spr = words.slice(256).filter((w) => w !== 0).length;
    eq("#99: " + name + ": the CRAM bar is the entries holding a colour",
       cram.used, bg + spr);
    eq("#99: " + name + ": ... split 256 BG / 256 sprites",
       cram.parts, [{ label: "BG", used: bg }, { label: "sprites", used: spr }]);
    eq("#99: " + name + ": CRAM's capacity is 512", cram.cap, 512);

    /* ROM: the validator's bytes plus the toy's files, counted here */
    let carried = 0;
    for (const f of files)
      if (f.name !== "main.lua") carried += f.source.length;
    eq("#99: " + name + ": the ROM bar is the estimate plus the files",
       rom.used, report.budgets.rom.bytes + carried);
    eq("#99: " + name + ": ROM's capacity is the 1 MB card", rom.cap, 1048576);
    eq("#99: " + name + ": ... and its parts add up",
       rom.parts.reduce((n, p) => n + p.used, 0), rom.used);

    seen[name] = { vram: vram.used, cram: cram.used };
  }

  check(seen.painted.vram !== seen.scene1.vram,
        "#99: two different pictures give two different VRAM bars (" +
        seen.painted.vram + " vs " + seen.scene1.vram + ")");

  /* and it follows the toy, not a constant: a SAT naming one more pattern
   * must raise the VRAM bar */
  const dump = loadDump("scene1");
  const before = A.bars({ state: panels.state(dump.opts),
                          map: panels.vramMap(panels.state(dump.opts)) });
  const regs2 = Object.assign({}, dump.regs);
  const sat = new Uint8Array(fs.existsSync(path.join(DUMPS, "scene1", "sat.bin"))
    ? fs.readFileSync(path.join(DUMPS, "scene1", "sat.bin"))
    : dump.vram.slice(SAT_ADDR * 2, SAT_ADDR * 2 + 512));
  /* sprite 20 (the next free slot): Y=$20, X=$40, pattern $180, palette 0,
   * 16x16 — a pattern cell far above anything scene1 uses */
  const slot = 20 * 4;
  sat[slot] = 0x20; sat[slot + 1] = 0x00;
  sat[slot + 2] = 0x40; sat[slot + 3] = 0x00;
  sat[slot + 4] = 0x80; sat[slot + 5] = 0x01;
  sat[slot + 6] = 0x00; sat[slot + 7] = 0x00;
  const st2 = panels.state(Object.assign({}, dump.opts, { sat, regs: regs2 }));
  const after = A.bars({ state: st2, map: panels.vramMap(st2) });
  check(after[0].used > before[0].used,
        "#99: a sprite naming a new pattern raises the VRAM bar (" +
        before[0].used + " -> " + after[0].used + ")");

  /* no state, no measurement — the bar says so rather than showing a number */
  const empty = A.bars({});
  eq("#99: with no frame the bars are empty and say so",
     empty.map((b) => [b.used, b.measured]), [[0, false], [0, false], [0, false]]);
  eq("#99: with no report the ROM bar has no code",
     empty[2].parts[0].used, 0);
}

/* ---- 7. the panel module, against the studio API ---------------------- */

/* A stub DOM: only what studio-panel-assets.js uses.  Elements are records
 * with the listeners kept so the check can click them. */
function makeDom() {
  const byId = {};
  function element(tag) {
    const e = {
      tagName: tag, children: [], className: "", id: "", type: "",
      textContent: "", title: "", disabled: false, hidden: false,
      style: {}, dataset: {}, listeners: {}, parentNode: null,
      appendChild(c) { this.children.push(c); this.firstChild = this.children[0]; c.parentNode = this; return c; },
      insertBefore(c, before) {
        const i = this.children.indexOf(before);
        if (i < 0) return this.appendChild(c);
        this.children.splice(i, 0, c);
        this.firstChild = this.children[0];
        c.parentNode = this;
        return c;
      },
      removeChild(c) {
        const i = this.children.indexOf(c);
        if (i >= 0) this.children.splice(i, 1);
        this.firstChild = this.children[0];
        c.parentNode = null;
        return c;
      },
      addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
      setAttribute(k, v) { this[k] = v; },
      removeAttribute(k) { delete this[k]; },
      querySelector() { return this.children.find((c) => c.tagName === "h2") || null; },
      get firstChild() { return this.children[0] || null; }
    };
    return e;
  }
  const doc = {
    head: element("head"),
    body: element("body"),
    createElement: element,
    getElementById: (id) => byId[id] || null,
    getElementsByTagName: (t) => (t === "head" ? [doc.head] : [])
  };
  return { doc, byId, element };
}

function textOf(e) {
  return (e.textContent || "") + (e.children || []).map(textOf).join(" ");
}

function findButton(e, label) {
  if (e.textContent === label && e.tagName === "button") return e;
  for (const c of e.children || []) {
    const got = findButton(c, label);
    if (got) return got;
  }
  return null;
}

function findAll(e, pred, out) {
  out = out || [];
  if (pred(e)) out.push(e);
  for (const c of e.children || []) findAll(c, pred, out);
  return out;
}

function click(e) {
  const fns = (e.listeners && e.listeners.click) || [];
  for (const fn of fns) fn({ preventDefault() {}, stopPropagation() {} });
}

function makeStudio(dom) {
  const S = (id) => dom.byId[id];
  const files = [
    { name: "main.lua", kind: "lua", source: TOY },
    { name: "tiles.json", kind: "tiles", source: '{"version":1,"tiles":[]}\n' },
    { name: "palettes.json", kind: "palettes", source: '{"version":1}\n' },
    { name: "sprites.json", kind: "sprites", source: '{"version":1,"sprites":[]}\n' },
    { name: "waves.json", kind: "waves", source: '{"version":1,"channels":[]}\n' }
  ];
  const toasts = [];
  const registered = [];
  const watchers = [];
  S("assets-pane").appendChild(dom.element("h2")).textContent = "ASSETS";
  S("assets-pane").appendChild(dom.element("div")).className = "asset-list";
  const st = panels.state(loadDump("painted").opts);
  return {
    files, toasts, registered, watchers, state: st,
    $: (id) => S(id),
    document: dom.doc,
    toast: (m) => toasts.push(m),
    hex: (v, w) => "$" + String(v == null ? "-" : v.toString(16)).padStart(w, "0"),
    layout: { codeTab: () => "assets", drawer: () => "", panel: (id) => id },
    panels: Object.assign([], {
      register: (def) => { registered.push(def); return def; }
    }),
    toy: {
      current: () => ({ name: "untitled toy", mode: "lua", frame: 0, source: TOY }),
      mode: () => "lua",
      source: () => TOY,
      files: () => files,
      file: (n) => files.find((f) => f.name === n) || null,
      activeFile: () => "main.lua",
      mainSource: () => TOY,
      persist: () => true,
      saved: () => true,
      refreshAssets: () => true,
      onAssetEdit: (fn) => { watchers.push(fn); return fn; }
    },
    render: {
      state: () => st,
      currentFrame: () => 0,
      pause: () => true,
      seek: () => 0,
      length: () => 240
    }
  };
}

function loadPanelModule(sandbox) {
  const code = fs.readFileSync(path.join(RENDERER, "studio-panel-assets.js"), "utf8");
  vm.runInContext(code, sandbox, { filename: "studio-panel-assets.js" });
}

function checkPanel() {
  console.log("== the ASSETS panel module");
  const dom = makeDom();
  ["assets-pane", "tab-assets"].forEach((id) => {
    dom.byId[id] = dom.element(id === "assets-pane" ? "div" : "button");
    dom.byId[id].id = id;
  });

  const studio = makeStudio(dom);
  const P = { PCEStudio: { assets: A, validate: null, panels: {
    vramMap: (st) => panels.vramMap(st) } } };
  const sandbox = { console, self: null };
  sandbox.self = sandbox;
  sandbox.PCEStudio = P.PCEStudio;
  sandbox.window = sandbox;
  vm.createContext(sandbox);

  /* the module file registers one module; its register() is called with the
   * studio object, the way studio.html's registerPanelModules does */
  loadPanelModule(sandbox);
  const mods = sandbox.PCEStudio.studioPanelModules;
  eq("#99: one module, id assets", mods.map((m) => m.id), ["assets"]);
  const api = mods[0].register(studio);
  check(!!api && typeof api.addToToy === "function",
        "#99: the module hands the page an api (panelApi(\"assets\"))");
  eq("#99: it registers one workspace panel",
     studio.registered.map((d) => [d.id, d.group]),
     [["assets", "workspace"]]);
  check(studio.registered[0].open !== undefined,
        "#99: the panel's Panels-menu entry opens the ASSETS tab");

  /* the pane: fifteen built-ins, each with an Add to toy button */
  const pane = dom.byId["assets-pane"];
  const adds = findAll(pane, (e) => e.className === "btn-mini" &&
                          /Add to toy|In toy/.test(e.textContent));
  eq("#99: the pane lists fifteen built-ins with a button each", adds.length, 15);
  eq("#99: ... in ppu.toys' order",
     adds.map((b) => b.id), NAMES.map((n) => "assets-add-" + n));
  const text = textOf(pane);
  for (const name of NAMES)
    check(text.indexOf(name) >= 0, "#99: the pane lists " + name);
  check(text.indexOf("BUILT-IN") >= 0, "#99: each is tagged BUILT-IN");

  /* the three bars */
  const bars = api.bars();
  eq("#99: three bars, VRAM / CRAM / ROM", bars.map((b) => b.label),
     ["VRAM", "CRAM", "ROM"]);
  /* one fill per part (VRAM kinds + CRAM halves + ROM files), each with a
   * percentage width */
  const fills = findAll(pane, (e) => e.className === "asx-fill");
  eq("#99: one fill per bar part",
     fills.length, bars[0].parts.length + bars[1].parts.length + bars[2].parts.length);
  check(fills.every((f) => /%$/.test(f.style.width) &&
                          parseFloat(f.style.width) >= 0),
        "#99: every part fill has a width (" +
        fills.map((f) => f.style.width).join(" · ") + ")");

  /* #156: no sources.json yet — the list says so */
  eq("#156: the pane's sources list is empty without sources.json",
     api.sources(), []);
  check(textOf(pane).indexOf("no named sources") >= 0,
        "#156: ... and says how to get one");

  /* #156: with the files carrying sources.json, the pane lists them by name
   * with kind, size and placement, and "…" opens the grid */
  const fixture = sourcesFixture();
  for (const f of fixture) {
    const at = studio.files.findIndex((x) => x.name === f.name);
    if (at >= 0) studio.files[at] = f;
    else studio.files.push(f);
  }
  api.refresh();
  const sources = api.sources();
  eq("#156: the pane lists the named sources",
     sources.map((s) => [s.name, s.kind]),
     [["hill", "bg"], ["dot", "sprites"]]);
  eq("#156: each row carries size and placement",
     [sources[0].size, sources[0].placement],
     ["1,056 words · 16 colours",
      "VRAM 0x400-0x41f tiles · VRAM 0x0-0x3ff map · CRAM 0-15"]);
  check(textOf(pane).indexOf("SOURCES") >= 0,
        "#156: the pane has the SOURCES section");

  /* the bars now colour the sources' ranges */
  const sbars = api.bars();
  eq("#156: the VRAM bar's parts begin with the sources",
     sbars[0].parts.slice(0, 2).map((p) => [p.label, p.source]),
     [["hill", true], ["dot", true]]);
  const sfills = findAll(pane, (e) => e.className === "asx-fill" &&
                          /hsl\(/.test(e.style.background || ""));
  check(sfills.length >= 2, "#156: each source's fill is its own hue (" +
        sfills.length + " coloured fills)");
  check(sbars[0].parts[0].first === 1024 && sbars[0].parts[1].first === 17 * 64,
        "#156: the source's fill sits at its range's address (" +
        sbars[0].parts[0].first + ", " + sbars[0].parts[1].first + ")");

  /* the "…" preview: the grid's pixels, drawn from the files */
  const px = api.sourcePixels(sources[0]);
  check(!!px && px.width === 16 && px.height === 8,
        "#156: the tiles preview is the sheet's size (" +
        (px && px.width + "x" + px.height) + ")");
  /* cell 1's top-left pixel is colour 1 of the bg row: 0x1FF = white */
  eq("#156: a preview pixel is the row's colour (0x1FF is white)",
     Array.from(px.rgba.slice(32, 36)), [252, 252, 252, 255]);
  /* the blank tile's colour 0 is the backdrop, not transparent */
  eq("#156: colour 0 on a bg row is the backdrop colour",
     Array.from(px.rgba.slice(0, 4)), [0, 0, 0, 255]);
  /* sprite colour 0 is transparent, the way the VDC shows it */
  const dotPx = api.sourcePixels(sources[1]);
  check(!!dotPx && dotPx.width === 16 && dotPx.height === 16 &&
        dotPx.rgba.every((v) => v === 0),
        "#156: colour 0 on a sprite row is transparent");

  /* clicking "…" opens the modal with the palette strip */
  const openHill = findAll(pane, (e) => e.id === "assets-source-open-hill")[0];
  check(!!openHill, "#156: each source row has a … button");
  click(openHill);
  const modal = findAll(dom.doc.body, (e) => e.id === "assets-source-preview")[0];
  check(!!modal, "#156: … opens the source's preview modal");
  check(textOf(modal).indexOf("hill · bg") >= 0,
        "#156: ... titled with the name and kind");
  const swatches = findAll(modal, (e) => e.className === "asx-swat");
  eq("#156: the strip shows the source's 16-entry row", swatches.length, 16);
  eq("#156: ... with the row's colours (entry 1 is white)",
     swatches[1].style.background, "rgb(252,252,252)");
  const closeBtn = findAll(modal, (e) => e.id === "assets-source-close")[0];
  check(!!closeBtn, "#156: the modal has a Close button");
  click(closeBtn);
  check(dom.doc.body.children.indexOf(modal) < 0,
        "#156: Close removes the modal");

  /* Add to toy: piano */
  const piano = adds.find((b) => b.id === "assets-add-piano");
  click(piano);
  const file = studio.files.find((f) => f.name === "instruments.json");
  check(!!file, "#99: Add to toy creates the toy's instruments.json");
  const doc = A.parseInstruments(file.source);
  eq("#99: ... holding exactly the patch clicked", doc.instruments.map((i) => i.name),
     ["piano"]);
  eq("#99: ... which is the built-in's own wave", doc.instruments[0].wave,
     A.byId("piano").wave);
  /* the pane is redrawn, so the button is looked up again, not held */
  const pianoNow = findAll(pane, (e) => e.id === "assets-add-piano")[0];
  check(!!pianoNow && pianoNow.disabled && pianoNow.textContent === "In toy",
        "#99: the button becomes In toy");
  click(pianoNow);
  eq("#99: clicking it again does not add a second copy",
     A.parseInstruments(file.source).instruments.length, 1);

  /* the toy's own list */
  check(textOf(pane).indexOf("IN THE TOY") >= 0,
        "#99: the pane has the toy's own instrument list");
  const remove = findButton(pane, "Remove");
  check(!!remove, "#99: a patched instrument can be removed");
  click(remove);
  eq("#99: Remove empties the toy's list",
     A.parseInstruments(file.source).instruments.length, 0);

  /* + Add: Song */
  const add = dom.byId["assets-add"] || findButton(pane, "+ Add");
  check(!!add, "#99: the pane has ppu.toys' + Add");
  click(add);
  const songItem = findButton(pane, "Song");
  check(!!songItem, "#99: + Add offers a Song");
  click(songItem);
  const songs = A.parseSongs(studio.files.find((f) => f.name === "songs.json").source);
  eq("#99: a song is added to songs.json", songs.songs.map((s) => s.name), ["song1"]);
  check(textOf(pane).indexOf("no music yet") >= 0,
        "#99: a blank song says it has no music yet");

  /* + Add: Wave */
  click(findButton(pane, "+ Add"));
  click(findButton(pane, "Wave"));
  const inst = A.parseInstruments(
    studio.files.find((f) => f.name === "instruments.json").source).instruments;
  eq("#99: a wave is added to the toy's instruments", inst.map((i) => i.name),
     ["wave1"]);
  check(inst[0].wave.length === 32, "#99: ... with a 32-step wave to edit");

  /* + Add: the art items open the panel that owns them */
  click(findButton(pane, "+ Add"));
  click(findButton(pane, "Tiles"));
  check(studio.toasts.some((t) => /tiles\.json/.test(t)),
        "#99: + Add Tiles points at the panel that edits tiles.json");
}

/* ---- run -------------------------------------------------------------- */

checkList();
checkWaves();
checkEnvelopes();
checkPlaying();
checkAdd();
checkSongs();
checkSources();
checkBars();
checkPanel();

if (failures.length === 0) {
  console.log(`PASS: ${checks} checks — fifteen built-ins play through ` +
              `pce-psg.js at their register's pitch, the bars are the toy's ` +
              `measured use, the named sources sit where the importer put ` +
              `them, and Add to toy writes instruments.json`);
  process.exitCode = 0;
} else {
  console.log(`FAIL: ${failures.length} of ${checks} checks failed`);
  for (const f of failures) console.log("  - " + f);
  process.exitCode = 1;
}
