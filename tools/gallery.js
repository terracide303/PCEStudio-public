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

/* Where the demo art lives when a toy carries an `art` entry: beside the
 * repo, never inside it (docs/DECISIONS.md, 2026-10-29).  Only --art-dir
 * turns it on, so `--check` and a fresh clone see the generator's output
 * without any art on the machine. */
let ART_DIR = null;

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
  /* #127: a demo built from a bought tileset.  The art is NOT in the repo
   * (docs/DECISIONS.md, 2026-10-29): `art` names the file tools/cave-assets.js
   * writes beside the repo, and only a build with --art-dir appends it, so
   * the committed module and a fresh clone carry the toy's own Lua alone. */
  {
    id: "cave",
    file: "cave/main.lua",
    title: "CAVE",
    author: "Will Tice · unTied Games",
    badge: "#127 demo",
    tags: ["demo", "parallax", "palette", "sprites", "scroll"],
    blurb: "Four background bands and a floor scroll at five speeds over " +
      "the Retro Pixel Cave tileset while the rock's lit veins breathe and " +
      "two bats and an ember cross the dark. IJKL scrolls it by hand.",
    effect: "five BXR bands + a palette cycle",
    art: { dir: "cave", file: "art.lua" }
  }
];

function readFile(file, id) {
  if (!fs.existsSync(file)) {
    throw new Error("no " + path.relative(ROOT, file) + " for the gallery's " +
                    id + " (tools/gallery.js)");
  }
  const text = fs.readFileSync(file, "utf8");
  if (!text) throw new Error(path.relative(ROOT, file) + " is empty");
  return text;
}

function readToy(meta) {
  const file = path.join(TOYS, meta.file);
  const source = readFile(file, meta.id);
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
  if (meta.art) {
    /* the art is appended, exactly as the toy page runs it: main.lua defines
     * the stub, the art file defines the same functions last */
    if (ART_DIR) {
      const file = path.join(ART_DIR, meta.art.dir, meta.art.file);
      if (!fs.existsSync(file))
        throw new Error("no " + path.join(meta.art.dir, meta.art.file) +
                        " in " + ART_DIR + " for the gallery's " + meta.id);
      toy.source = source + "\n" + fs.readFileSync(file, "utf8");
      toy.art = { file: meta.art.file, present: true };
    } else {
      toy.art = { file: meta.art.file, present: false };
    }
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

function data() {
  const seen = new Set();
  const toys = TOYS_META.map((meta) => {
    if (seen.has(meta.id)) throw new Error("duplicate gallery id " + meta.id);
    seen.add(meta.id);
    return readToy(meta);
  });
  return { version: 1, toys: toys };
}

function render() {
  return "/*\n" +
    " * gallery-toys.js — the example toys as the Browse page, a toy's own\n" +
    " * page and the studio read them (#80): the five effects of #29 and\n" +
    " * STARFALL (#88, #121).\n" +
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
    "  return " + JSON.stringify(data(), null, 2) + ";\n" +
    "});\n";
}

function main(argv) {
  const args = argv.slice(2);
  let mode = "stdout";
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--write") mode = "write";
    else if (a === "--check") mode = "check";
    else if (a === "--art-dir") ART_DIR = args[++i];
    else if (a === "--help" || a === "-h") {
      process.stdout.write("usage: node tools/gallery.js [--write | --check]" +
                           " [--art-dir DIR]\n");
      return 0;
    } else {
      process.stderr.write("unknown argument: " + a + "\n");
      return 2;
    }
  }
  let text;
  try {
    text = render();
  } catch (e) {
    process.stderr.write("gallery: " + e.message + "\n");
    return 2;
  }
  if (mode === "stdout") { process.stdout.write(text); return 0; }
  if (mode === "write") {
    fs.writeFileSync(OUT, text);
    process.stdout.write("wrote renderer/gallery-toys.js (" + data().toys.length +
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
                       data().toys.length + " toys, " + text.length +
                       " bytes)\n");
  return 0;
}

if (require.main === module) process.exit(main(process.argv));

module.exports = { TOYS_META, data, render };
