#!/usr/bin/env node
/*
 * tools/gallery.js — write or check renderer/gallery-toys.js, the example
 * toys as the Browse page, a toy's own page and the studio read them (#80):
 * the five effects of #29, and STARFALL (#88), a game whose four files the
 * studio opens as one toy (#121).
 *
 * The Lua sources are toys/*.lua, read here and never copied by hand.  The
 * titles, tags and one-line blurbs live in this file — the one place they are
 * written — so a new example is a line here plus its toys/*.lua file.  A toy
 * with `files` is a folder: every file it lists is read from beside main.lua
 * and carried in the entry, so the studio opens the same bytes.
 *
 *   node tools/gallery.js             the module on stdout
 *   node tools/gallery.js --write     write renderer/gallery-toys.js
 *   node tools/gallery.js --check     exit 1 if the committed file is not
 *                                     exactly what this tool writes
 *
 * tests/check-studio.js runs --check and loads the module in the three pages.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const TOYS = path.join(ROOT, "toys");
const OUT = path.join(ROOT, "renderer", "gallery-toys.js");

/* The gallery, in the order toys/README.md tells the tricks in.  `effect`
 * is the one-line "what it proves" the toy page prints under the title. */
const TOYS_META = [
  {
    id: "parallax",
    file: "parallax.lua",
    title: "Line-scroll parallax",
    tags: ["parallax", "raster"],
    blurb: "Four background bands scroll at four speeds. The PC Engine has no " +
      "HDMA, so the RCR line interrupt writes BXR once per band.",
    effect: "BXR × 4 lines"
  },
  {
    id: "sky-gradient",
    file: "sky-gradient.lua",
    title: "Sky gradient",
    tags: ["palette", "raster"],
    blurb: "One flat tile becomes a sky: a palette entry is rewritten for " +
      "every line, and a second entry keeps the sun's disc crisp.",
    effect: "palette 1 per line"
  },
  {
    id: "road",
    file: "road.lua",
    title: "Pseudo-3D road",
    tags: ["3d", "raster", "palette"],
    blurb: "BYR picks a row of a perspective-drawn map, BXR bends the road " +
      "and the palette shades it while the stripes rush toward the viewer.",
    effect: "BXR + BYR + palette per line"
  },
  {
    id: "status-bar",
    file: "status-bar.lua",
    title: "Fixed status bar",
    tags: ["split", "raster"],
    blurb: "An RCR split: lines 0–23 hold still while the playfield below " +
      "scrolls under them, in a palette the bar cannot spill into.",
    effect: "BXR + BYR at lines 0 and 24"
  },
  {
    id: "palette-cycle",
    file: "palette-cycle.lua",
    title: "Palette cycling",
    tags: ["palette", "animation"],
    blurb: "Water and fire: rotating two runs of the 512-word VCE table " +
      "animates the picture without touching a tile or the map.",
    effect: "palette writes per frame"
  },
  /* #121: #88's demo game is not an effect but a game, and its picture lives
   * in the panels' three asset files beside main.lua.  `files` makes the
   * entry a folder the studio opens whole, in this order (main.lua first,
   * the order a saved toy's envelope keeps). */
  {
    id: "starfall",
    file: "demo-game/main.lua",
    title: "STARFALL",
    author: "PCEStudio examples",
    badge: "#88 demo game",
    tags: ["playable", "sprites", "music", "raster"],
    blurb: "A game, not an effect: six drones fall through a scrolling " +
      "starfield while the top 24 lines hold still under the raster split. " +
      "IJKL flies the ship, N fires, M is the second button.",
    effect: "a playable game",
    files: [
      { name: "main.lua", kind: "lua" },
      { name: "tiles.json", kind: "tiles" },
      { name: "palettes.json", kind: "palettes" },
      { name: "sprites.json", kind: "sprites" }
    ]
  },
  /* #128: a game whose art is NOT in the repository (docs/DECISIONS.md,
   * 2026-10-29).  The source here is the toy's placeholder picture; the
   * playable file with the pack's art is demo-art/oak-woods/main.lua and
   * tools/deploy.sh puts it on the site.  `song` is our own module, carried
   * in the entry so music(0) has something to play in Browse and the studio. */
  {
    id: "oak-woods",
    file: "oak-woods/main.lua",
    title: "OAK WOODS",
    author: "PCEStudio · art by Brullov",
    badge: "#128 demo game",
    tags: ["playable", "sprites", "music", "raster", "parallax"],
    blurb: "A forest runner: three tree bands slide past at a quarter, a half " +
      "and the full speed, rocks roll in on the ground, and the top 24 lines " +
      "hold the HUD still. IJKL dodges, N jumps; reach the sign.",
    effect: "a forest runner",
    song: "oak-woods/song.json",
    demoArt: "oak-woods"
  },
  /* #127: the same shape as #128.  The repo's cave/main.lua is the demo with
   * a plain rock stub; the playable file with the pack's converted picture is
   * demo-art/cave/main.lua (tools/cave-assets.js writes it) and only a
   * --with-demo-art build reads it.  The author is the pack's, because its
   * licence asks for attribution (toys/cave/README.md). */
  {
    id: "cave",
    file: "cave/main.lua",
    title: "CAVE",
    author: "Will Tice · unTied Games",
    badge: "#127 demo",
    tags: ["demo", "parallax", "palette", "sprites"],
    blurb: "The Retro Pixel Cave: four background bands and a floor scroll " +
      "at five speeds while the rock's lit veins breathe and two bats and " +
      "an ember cross the dark. IJKL scrolls it by hand.",
    effect: "five BXR bands + a palette cycle",
    demoArt: "cave"
  },
  /* #125: the same shape again.  The repo's city/main.lua is the game with an
   * empty art_boot(); the playable file — the same game plus the pack's
   * converted picture — is demo-art/city/main.lua (tools/city-assets.js writes
   * it) and only a --with-demo-art build reads it.  Anokolisa's note asks for
   * credit rather than requiring it; it is here anyway. */
  {
    id: "city",
    file: "city/main.lua",
    title: "CITY",
    author: "PCEStudio · art by Anokolisa",
    badge: "#125 demo",
    tags: ["demo", "parallax", "palette", "sprites", "playable"],
    blurb: "A flooded city street at night: the pack's own scene is the one " +
      "background, split into two BXR bands by the raster callback while the " +
      "water cycles its palette. IJKL walks and jumps, N fires.",
    effect: "one background, two bands",
    demoArt: "city"
  }
];

/* #128: where the uncommitted art lives (docs/DECISIONS.md).  Only
 * `--with-demo-art` reads it; the committed gallery and `--check` never do. */
const DEMO_ART = process.env.DEMO_ART ||
  "/Volumes/External/agent-workshop-demo/demo-art";

function readFile(file, id) {
  if (!fs.existsSync(file)) {
    throw new Error("no " + path.relative(ROOT, file) + " for the gallery's " +
                    id + " (tools/gallery.js)");
  }
  const text = fs.readFileSync(file, "utf8");
  if (!text) throw new Error(path.relative(ROOT, file) + " is empty");
  return text;
}

function readToy(meta, withDemoArt) {
  const file = path.join(TOYS, meta.file);
  let source = readFile(file, meta.id);
  if (withDemoArt && meta.demoArt) {
    /* the playable file: the same toy with the pack's art in its block */
    source = readFile(path.join(DEMO_ART, meta.demoArt, "main.lua"), meta.id);
  }
  const toy = {
    id: meta.id,
    file: meta.file,
    title: meta.title,
    author: meta.author || "PCEStudio",
    tags: meta.tags.slice(),
    blurb: meta.blurb,
    effect: meta.effect
  };
  if (meta.badge) toy.badge = meta.badge;
  toy.source = source;
  if (meta.song) {
    toy.songs = [JSON.parse(readFile(path.join(TOYS, meta.song), meta.id))];
  }
  if (meta.files) {
    const dir = path.dirname(file);
    toy.files = meta.files.map((f) => ({
      name: f.name,
      kind: f.kind,
      source: readFile(path.join(dir, f.name), meta.id)
    }));
    if (toy.files[0].name !== "main.lua" ||
        toy.files[0].source !== source) {
      throw new Error("the gallery's " + meta.id + " must list main.lua " +
                      "first, and it must be the toy's source");
    }
  }
  return toy;
}

function data(withDemoArt) {
  const seen = new Set();
  const toys = TOYS_META.map((meta) => {
    if (seen.has(meta.id)) throw new Error("duplicate gallery id " + meta.id);
    seen.add(meta.id);
    return readToy(meta, withDemoArt);
  });
  return { version: 1, toys: toys };
}

function render(withDemoArt) {
  return "/*\n" +
    " * gallery-toys.js — the example toys as the Browse page, a toy's own\n" +
    " * page and the studio read them (#80): the five effects of #29,\n" +
    " * STARFALL (#88, #121), OAK WOODS (#128) and CAVE (#127).\n" +
    " *\n" +
    " * GENERATED by tools/gallery.js from toys/*.lua; do not edit by hand.\n" +
    " * The titles, tags and blurbs are that tool's TOYS_META, the sources are\n" +
    " * the toys' own files, so the gallery cannot drift from what the\n" +
    " * examples check runs.  A toy with `files` is a folder: the studio opens\n" +
    " * every file it lists.  `node tools/gallery.js --check` says whether this\n" +
    " * file still matches; `--write` regenerates it.\n" +
    " */\n" +
    "(function (root, factory) {\n" +
    "  if (typeof module === \"object\" && module.exports) {\n" +
    "    module.exports = factory();\n" +
    "  } else {\n" +
    "    root.PCEStudio = root.PCEStudio || {};\n" +
    "    root.PCEStudio.galleryData = factory();\n" +
    "  }\n" +
    "})(typeof globalThis !== \"undefined\" ? globalThis : this, function () {\n" +
    "  \"use strict\";\n" +
    "  return " + JSON.stringify(data(withDemoArt), null, 2) + ";\n" +
    "});\n";
}

function main(argv) {
  const args = argv.slice(2);
  let mode = "stdout";
  let withDemoArt = false;
  for (const a of args) {
    if (a === "--write") mode = "write";
    else if (a === "--check") mode = "check";
    else if (a === "--with-demo-art") withDemoArt = true;
    else if (a === "--help" || a === "-h") {
      process.stdout.write("usage: node tools/gallery.js [--write | --check | " +
                           "--with-demo-art]\n");
      return 0;
    } else {
      process.stderr.write("unknown argument: " + a + "\n");
      return 2;
    }
  }
  let text;
  try {
    text = render(withDemoArt);
  } catch (e) {
    process.stderr.write("gallery: " + e.message + "\n");
    return 2;
  }
  if (mode === "stdout") { process.stdout.write(text); return 0; }
  if (mode === "write") {
    fs.writeFileSync(OUT, text);
    process.stdout.write("wrote renderer/gallery-toys.js (" + data(withDemoArt).toys.length +
                         " toys, " + text.length + " bytes)\n");
    return 0;
  }
  const have = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : null;
  if (have !== text) {
    process.stderr.write("renderer/gallery-toys.js is not the generator's " +
      "output.\nrun `node tools/gallery.js --write` to regenerate it from " +
      "toys/*.lua and tools/gallery.js's TOYS_META.\n");
    return 1;
  }
  process.stdout.write("renderer/gallery-toys.js is the generator's output (" +
                       data(withDemoArt).toys.length + " toys, " + text.length +
                       " bytes)\n");
  return 0;
}

if (require.main === module) process.exit(main(process.argv));

module.exports = { TOYS_META, data, render };
