#!/usr/bin/env node
/*
 * tests/check-helpers.js — the #204 evidence: sprite_ascii, sfx_preset and
 * tune_write are the studio's own machinery, wrapped thin, and the list
 * every consumer of the tools sees agrees.
 *
 *   1. an ASCII 16x16 sprite lands as the same tiles/palette as the
 *      equivalent grid source_add — byte-identical sprites.json and
 *      palettes.json — and the reply names each frame with the pattern,
 *      SAT slot and palette row the merged files give it (a second add
 *      appends past the first, in both paths);
 *   2. each preset plays and is deterministic: the same {name, pitch,
 *      length} is the same reply every call, and its lua in a toy makes
 *      toy_run's sound report show the PSG writing, with the sfx owning
 *      channel 0 — the preset's channel — and no other;
 *   3. a tune of 8 note names writes song.json the way song_write writes
 *      it (the melody on the style instrument, the bass on the bass), and
 *      music(0) plays it;
 *   4. bad legend/rows/cell/frames/name/note give the named refusals;
 *   5. tools/list and tools.json agree: the committed capture
 *      (tests/dumps/mcp-tools-list.json), the relay's static list
 *      (tools/relay/tools.json) and the core's own TOOLS are one list.
 *
 *   node tests/check-helpers.js
 *
 * Written by @design because the card names this test.  Rule 2: a cold
 * break by another seat is owed before the card closes.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const CORE_FILE = path.join(ROOT, "renderer", "pce-agent-tools.js");
const DUMP = path.join(ROOT, "tests", "dumps", "mcp-tools-list.json");
const RELAY = path.join(ROOT, "tools", "relay", "tools.json");

const core = require(CORE_FILE);

let checks = 0;
const failures = [];

function check(ok, name) {
  checks++;
  if (!ok) { failures.push(name); console.log("FAIL  " + name); }
}
function eq(name, got, want) {
  check(JSON.stringify(got) === JSON.stringify(want),
        name + " (got " + JSON.stringify(got) + ", want " +
        JSON.stringify(want) + ")");
}

/* the host the Node branch needs: png work only, which these calls skip */
const host = {
  inflate: async () => new Uint8Array(0),
  deflate: async (raw) => raw
};

function session() {
  return core.createSession(host);
}

/* one call, decoded: {error, code, json} */
async function call(s, name, args) {
  const r = await s.call(name, args || {});
  const text = r.content && r.content[0] ? r.content[0].text : "{}";
  return { isError: !!r.isError, json: JSON.parse(text) };
}

async function must(s, name, args, what) {
  const r = await call(s, name, args);
  check(!r.isError, name + " answers " + (what || "") +
        (r.isError ? " (refused " + r.json.code + ": " + r.json.message + ")"
                   : ""));
  return r.json;
}

const MAIN_EMPTY = "function frame(t, f) end";

/* the shared 16x16 art: a transparent 2x3 corner, red frame, white 8x8
 * centre — drawn once as ASCII and once as its own pixel grid */
const ART_ROWS = [
  "..rrrrrrrrrrrrrr",
  "..rrrrrrrrrrrrrr",
  "..rrrrrrrrrrrrrr",
  "rrrrrrrrrrrrrrrr",
  "rrrrwwwwwwwwrrrr",
  "rrrrwwwwwwwwrrrr",
  "rrrrwwwwwwwwrrrr",
  "rrrrwwwwwwwwrrrr",
  "rrrrwwwwwwwwrrrr",
  "rrrrwwwwwwwwrrrr",
  "rrrrwwwwwwwwrrrr",
  "rrrrwwwwwwwwrrrr",
  "rrrrrrrrrrrrrrrr",
  "rrrrrrrrrrrrrrrr",
  "rrrrrrrrrrrrrrrr",
  "rrrrrrrrrrrrrrrr"
];
const ART_LEGEND = { r: [255, 0, 0], w: [255, 255, 255] };
const ART_PALETTE = [[255, 0, 0], [255, 255, 255]];
const ART_GRID = (function () {
  const pixels = [];
  for (const line of ART_ROWS) {
    for (const ch of line) {
      pixels.push(ch === "." ? -1 : ch === "r" ? 0 : 1);
    }
  }
  return { width: 16, height: 16, pixels: pixels };
})();

/* ---- 1. an ASCII sprite and the equivalent grid land on the same bytes -- */

async function asciiVsGrid() {
  const a = session();
  const g = session();
  await must(a, "toy_write",
             { files: [{ name: "main.lua", source: MAIN_EMPTY }] }, "the toy");
  await must(g, "toy_write",
             { files: [{ name: "main.lua", source: MAIN_EMPTY }] }, "the toy");

  const reply = await must(a, "sprite_ascii", {
    name: "box", cell: [16, 16], legend: ART_LEGEND, rows: ART_ROWS
  }, "the sprite");
  eq("sprite_ascii names one frame box-0 with its numbers",
     reply.frames, [{ frame: 0, name: "box-0", pattern: 0, sat: 0,
                      palette: 0, size: [16, 16] }]);
  check(reply.budget && reply.budget.sprites === 1 &&
        reply.stats && reply.stats.tiles === 1,
        "the reply carries the merged set's budget and stats");

  const gridReply = await must(g, "source_add", {
    kind: "sprites", name: "box", grid: ART_GRID, palette: ART_PALETTE,
    size: [16, 16]
  }, "the same pixels as a grid");
  check(gridReply.ok, "the grid source_add answers ok");

  const asciiSprites = await must(a, "file_read", { name: "sprites.json" },
                                  "its sprites.json back");
  const gridSprites = await must(g, "file_read", { name: "sprites.json" },
                                  "its sprites.json back");
  const asciiPalettes = await must(a, "file_read", { name: "palettes.json" },
                                   "its palettes.json back");
  const gridPalettes = await must(g, "file_read", { name: "palettes.json" },
                                   "its palettes.json back");
  eq("the ASCII sprite's sprites.json is the grid's, byte for byte",
     asciiSprites.source, gridSprites.source);
  eq("the ASCII sprite's palettes.json is the grid's, byte for byte",
     asciiPalettes.source, gridPalettes.source);

  /* a second add appends past the first in BOTH paths, and the reply
   * reports the numbers the merged files give it */
  const reply2 = await must(a, "sprite_ascii", {
    name: "ball", cell: [16, 16], legend: ART_LEGEND, rows: ART_ROWS
  }, "a second sprite");
  eq("the second sprite's frame reports the appended numbers",
     reply2.frames, [{ frame: 0, name: "ball-0", pattern: 1, sat: 1,
                       palette: 1, size: [16, 16] }]);
  await must(g, "source_add", {
    kind: "sprites", name: "ball", grid: ART_GRID, palette: ART_PALETTE,
    size: [16, 16]
  }, "the same second grid");
  const asciiSprites2 = await must(a, "file_read", { name: "sprites.json" },
                                   "its merged sprites.json back");
  const gridSprites2 = await must(g, "file_read", { name: "sprites.json" },
                                  "its merged sprites.json back");
  eq("the second merge is byte-identical in both paths too",
     asciiSprites2.source, gridSprites2.source);

  /* a sheet of cells becomes one frame per cell, and frames keeps the
   * first N */
  const sheet = session();
  await must(sheet, "toy_write",
             { files: [{ name: "main.lua", source: MAIN_EMPTY }] },
             "the toy");
  const twoRows = ART_ROWS.map(function (line) { return line + line; });
  const two = await must(sheet, "sprite_ascii", {
    name: "twins", cell: [16, 16], legend: ART_LEGEND, rows: twoRows
  }, "a two-cell sheet");
  eq("a two-cell sheet becomes two named frames", two.frames.map(function (f) {
    return [f.name, f.pattern, f.sat];
  }), [["twins-0", 0, 0], ["twins-1", 1, 1]]);
  const one = await must(sheet, "sprite_ascii", {
    name: "first", cell: [16, 16], legend: ART_LEGEND, rows: twoRows,
    frames: 1
  }, "the first cell only");
  eq("frames: 1 keeps the first cell, still named frame 0", one.frames, [
    /* the twins' two identical cells share one palette row (the importer's
     * own dedupe), so the next free row is 1 */
    { frame: 0, name: "first-0", pattern: 2, sat: 2, palette: 1,
      size: [16, 16] }
  ]);
}

/* ---- 2. every preset plays, on its channel, and is deterministic -------- */

async function presetsPlay() {
  const s = session();
  await must(s, "toy_write",
             { files: [{ name: "main.lua", source: MAIN_EMPTY }] },
             "the toy");
  const names = ["jump", "hit", "coin", "explosion", "shoot", "powerup",
                 "laser", "blip", "death", "menu"];
  for (const name of names) {
    const r1 = await call(s, "sfx_preset", { name: name });
    check(!r1.isError, "sfx_preset " + name + " answers" +
          (r1.isError ? " (refused " + r1.json.code + ")" : ""));
    if (r1.isError) continue;
    const r2 = await call(s, "sfx_preset", { name: name });
    eq("sfx_preset " + name + " is deterministic (same call, same reply)",
       r2.json, r1.json);
    check(r1.json.channel === 0, name + " plays on channel 0");
    check(Array.isArray(r1.json.instruments) &&
          r1.json.instruments.length === 15,
          name + " lists the 15 built-in instruments");
    check(Array.isArray(r1.json.runs) && r1.json.runs.length > 0 &&
          r1.json.runs.some(function (run) {
            return run.volume > 0 && run.frames >= 1;
          }),
          name + " is a run of steps, at least one sounding");

    /* the lua, in a toy that starts the effect at frame 0: the sfx owns
     * channel 0 and no other channel sounds */
    const isFn = r1.json.call.indexOf("sfx_" + name + "(") === 0;
    const body = isFn
      ? "local i = f % " + r1.json.length_frames + "\n  " + r1.json.call
      : r1.json.call;
    /* the fn presets' lua defines the function; the one-call presets' lua
     * is bare text whose ch the call has already filled in */
    const main = (isFn ? r1.json.lua : "") +
      "\nfunction frame(t, f)\n  " + body + "\nend";
    await must(s, "toy_write",
               { files: [{ name: "main.lua", source: main }] },
               name + "'s lua");
    const run = await call(s, "toy_run", { frames: 1 });
    check(!run.isError, name + "'s lua runs in a toy" +
          (run.isError ? " (refused " + run.json.code + ": " +
                          run.json.message + ")" : ""));
    if (run.isError) continue;
    const sound = run.json.sound || {};
    check(sound.writes > 0,
          name + " writes the PSG registers (writes " + sound.writes + ")");
    const chans = sound.channels || [];
    const mine = chans[0];
    check(!!mine && !!mine.sfx && mine.sfx.freq > 0,
          name + "'s sfx owns channel 0 at the report frame" +
          (mine && mine.sfx ? " (freq " + mine.sfx.freq + ")" : ""));
    for (let c = 1; c < chans.length; c++) {
      check(!chans[c].sfx, name + " leaves channel " + c + " alone");
    }
  }

  /* pitch and length move the effect; a bad value is refused */
  const p1 = await call(s, "sfx_preset", { name: "blip" });
  const p2 = await call(s, "sfx_preset", { name: "blip", pitch: 12 });
  check(!p2.isError && p2.json.lua !== p1.json.lua &&
        p2.json.midi[0] === 107,
        "pitch 12 moves the blip up to the engine note clamp " +
        "(midi " + p2.json.midi[0] + ", the clamp at 83 + 24)");
  const p3 = await call(s, "sfx_preset", { name: "blip", length: 8 });
  check(!p3.isError && p3.json.length_frames === 8 &&
        p3.json.lua !== p1.json.lua,
        "length 8 doubles the blip's frames");
}

/* ---- 3. a tune of 8 notes writes the song file -------------------------- */

async function tuneWritesSong() {
  const s = session();
  await must(s, "toy_write", {
    files: [{ name: "main.lua",
              source: "function init() music(0) end\n" +
                      "function frame(t, f) end" }]
  }, "a toy that plays music(0)");
  const r = await call(s, "tune_write", {
    name: "eight", melody: "C4 E4 G4 E4 F4 A4 G4 E4",
    bass: "C3 . G2 .", tempo: 150
  });
  check(!r.isError, "tune_write answers" +
        (r.isError ? " (refused " + r.json.code + ": " +
                      r.json.message + ")" : ""));
  if (r.isError) return;
  eq("the melody's 8 note names all land", r.json.melody_notes, 8);
  eq("the bass line's 2 note names land", r.json.bass_notes, 2);
  eq("the tune is written as song.json", r.json.file, "song.json");
  eq("the tune's style is the default lead", r.json.style, "lead");
  eq("the tune's tempo is the one asked for", r.json.tempo, 150);
  check(r.json.music_index === 0, "music(0) is the tune's slot");

  const read = await must(s, "file_read", { name: "song.json" },
                          "the song file back");
  const song = JSON.parse(read.source);
  eq("the written song holds the 16 melody steps (8 notes x 2)",
     song.steps, 16);
  const lead = song.instruments.filter(function (i) {
    return i.name === "lead";
  })[0];
  const bass = song.instruments.filter(function (i) {
    return i.name === "bass";
  })[0];
  const firstMelody = song.patterns[0].channels[0][0];
  const firstBass = song.patterns[0].channels[1][0];
  check(lead && bass, "the written song carries the built-in instruments");
  eq("the melody's first note is C4 on the lead", firstMelody,
     { note: 36, instrument: song.instruments.indexOf(lead), length: 2 });
  eq("the bass's first note is C3 on the bass", firstBass,
     { note: 24, instrument: song.instruments.indexOf(bass), length: 4 });

  /* and music(0) plays it: the toy's sound report says so */
  const run = await must(s, "toy_run", { frames: 10 }, "the toy with music");
  const music = run.sound && run.sound.music;
  check(!!music && music.playing && music.index === 0 && music.notes > 0,
        "music(0) plays the written tune (notes " +
        (music ? music.notes : "none") + ")");
}

/* ---- 4. the refusals are named ------------------------------------------ */

async function refusalsNamed() {
  const s = session();
  await must(s, "toy_write",
             { files: [{ name: "main.lua", source: MAIN_EMPTY }] },
             "the toy");

  async function refused(name, args, code, what) {
    const r = await call(s, name, args);
    check(r.isError && r.json.code === code,
          what + " is refused " + code +
          (r.isError ? "" : " (got ok: " + JSON.stringify(r.json) + ")") +
          (!r.isError || r.json.code === code ? ""
                                               : " — got " + r.json.code));
  }

  await refused("sprite_ascii",
                { cell: [16, 16], legend: ART_LEGEND, rows: ART_ROWS },
                "ascii-name", "a sprite with no name");
  await refused("sprite_ascii", {
    name: "box", cell: [16, 16], rows: ART_ROWS,
    legend: { rr: [255, 0, 0] }
  }, "ascii-legend", "a legend key that is not one character");
  await refused("sprite_ascii", {
    name: "box", cell: [16, 16], rows: ART_ROWS,
    legend: { r: [300, 0, 0] }
  }, "ascii-legend", "a legend colour past 255");
  await refused("sprite_ascii", {
    name: "box", cell: [16, 16], legend: ART_LEGEND,
    rows: ["rrrr", "rrr"]
  }, "ascii-rows", "rows of unequal length");
  await refused("sprite_ascii", {
    name: "box", cell: [16, 16], legend: ART_LEGEND,
    rows: ["rrrr", "rrrx", "rrrr", "rrrr"]
  }, "ascii-rows", "a character not in the legend");
  await refused("sprite_ascii", {
    name: "box", cell: [15, 16], legend: ART_LEGEND, rows: ART_ROWS
  }, "ascii-cell", "a cell that is not a sprite size");
  await refused("sprite_ascii", {
    name: "box", cell: [16, 16], legend: ART_LEGEND, rows: ART_ROWS,
    frames: 99
  }, "ascii-frames", "more frames than cells");

  await refused("sfx_preset", { name: "cow" }, "sfx-name",
                "a preset that does not exist");
  await refused("sfx_preset", { name: "blip", pitch: 100 }, "sfx-pitch",
                "a pitch past 83 semitones");
  await refused("sfx_preset", { name: "blip", length: 700 }, "sfx-length",
                "a length past 600 frames");

  await refused("tune_write", { melody: "C4 X4" }, "tune-note",
                "a melody token that is not a note name");
  await refused("tune_write", { melody: "" }, "tune-melody",
                "an empty melody");
}

/* ---- 5. tools/list and tools.json are one list -------------------------- */

function listsAgree() {
  const dump = JSON.parse(fs.readFileSync(DUMP, "utf8"));
  const relay = JSON.parse(fs.readFileSync(RELAY, "utf8"));
  eq("the committed tools/list capture and the relay's tools.json agree",
     relay, dump);
  eq("the core's own TOOLS are the committed capture", core.TOOLS, dump);
  eq("all three name the three #204 tools", {
    sprite_ascii: !!dump.filter((t) => t.name === "sprite_ascii").length,
    sfx_preset: !!dump.filter((t) => t.name === "sfx_preset").length,
    tune_write: !!dump.filter((t) => t.name === "tune_write").length
  }, { sprite_ascii: true, sfx_preset: true, tune_write: true });
}

async function main() {
  await asciiVsGrid();
  await presetsPlay();
  await tuneWritesSong();
  await refusalsNamed();
  listsAgree();
  console.log(checks + " checks, " + failures.length + " failures");
  if (failures.length) {
    console.log(failures.join("\n"));
    process.exitCode = 1;
  }
}

main().catch(function (e) {
  console.error(e && e.stack ? e.stack : e);
  process.exitCode = 1;
});
