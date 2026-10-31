#!/usr/bin/env node
/*
 * tools/gallery.js — write or check renderer/gallery-toys.js, the example
 * toys as the Browse page, a toy's own page and the studio read them (#80):
 * the sky gradient (#29), STARFALL (#88, #121), the demos OAK WOODS (#128),
 * CITY (#125), and the playable demos PLATFORMER and TOWER (#147) and
 * DUSK RUN (#151).
 *
 * #151 (Dennis, 2026-10-29): the other four #29 effects — "Line-scroll
 * parallax", the "Pseudo-3D road", "Palette cycling" and the "Fixed status
 * bar" — are NOT in Browse any more.  Their toys/*.lua files stay: the
 * examples check and the guide use them.
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
 * is the one-line "what it proves" the toy page prints under the title.
 * #151: only SKY GRADIENT of the five #29 effects is left in Browse; the
 * parallax, road, status-bar and palette-cycle toys stay in toys/ for
 * tests/check-examples.js and the guide, and are not gallery entries. */
const TOYS_META = [
  {
    id: "sky-gradient",
    file: "sky-gradient.lua",
    title: "Sky gradient",
    tags: ["palette", "raster"],
    blurb: "One flat tile becomes a sky: a palette entry is rewritten for " +
      "every line, and a second entry keeps the sun's disc crisp.",
    effect: "palette 1 per line"
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
  /* #125: a game whose art is NOT in the repository.  The repo's city/main.lua
   * is the game with an empty art_boot(); the playable file — the same game
   * plus the pack's converted picture — is demo-art/city/main.lua
   * (tools/city-assets.js writes it) and only a --with-demo-art build reads it.
   * Anokolisa's note asks for credit rather than requiring it; it is here
   * anyway. */
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
  },
  /* #147: two playable demos Dennis wrote with a Claude session, copied into
   * toys/ unchanged.  Their art is drawn in Lua with puttile/putsprite, so
   * there is no pack art and no demo-art folder.  Both run in the studio;
   * the console export refuses them for now (padref, tables — their
   * READMEs say so). */
  {
    id: "platformer",
    file: "platformer/main.lua",
    title: "PLATFORMER",
    author: "PCEStudio examples",
    tags: ["playable", "sprites"],
    blurb: "One screen, one hero, a pit and three brick ledges. J and L run, " +
      "N jumps (hold it higher); land on a ledge and climb back out of the pit.",
    effect: "a playable platformer"
  },
  {
    id: "tower",
    file: "tower/main.lua",
    title: "TOWER",
    author: "PCEStudio examples",
    tags: ["playable", "sprites"],
    blurb: "An original climber: J and L run, I and K climb the ladders, N " +
      "jumps. Dodge the rolling boulders, take the hearts and the hammer, and " +
      "reach a gem to make the next round faster.",
    effect: "a playable climber"
  },
  /* #151: Dennis's endless runner, copied into toys/ unchanged.  Five
   * line-scroll bands (clouds 1/8, mountains 1/4, hills 1/2, ground 1/1 and a
   * still score bar), a sunset backdrop written per line, and sprites drawn
   * in Lua — so there is no pack art and no demo-art folder. */
  {
    id: "dusk-run",
    file: "dusk-run/main.lua",
    title: "DUSK RUN",
    author: "PCEStudio examples",
    tags: ["playable", "sprites", "raster", "parallax"],
    blurb: "An endless sunset run: clouds, mountains, hills and ground slide " +
      "past at four speeds while the score bar holds still. N jumps (hold it " +
      "higher) over the rocks, under the birds, and through the hearts; after " +
      "a game over, N runs again.",
    effect: "a playable endless runner"
  },
  /* #164: a game whose art IS in the repository: every picture in it was drawn
   * for it (tools/nova-tide-art.py), so no art pack and no demo-art folder.
   * It carries the studio's named files, STARFALL's shape plus sources.json
   * (#156), so ASSETS lists "sea" and "ships". */
  {
    id: "nova-tide",
    file: "nova-tide/main.lua",
    title: "NOVA TIDE",
    author: "PCEStudio examples · written with Claude",
    badge: "#164 demo game",
    tags: ["playable", "sprites", "raster", "parallax"],
    blurb: "A side-scrolling shoot-'em-up over a night sea: drones weave in, " +
      "gunships fire back, P capsules power up the ship, and an armoured " +
      "fish waits at the end of every stage. IJKL flies, N fires (hold it), " +
      "P starts again after a game over.",
    effect: "a playable shoot-'em-up with real assets",
    files: [
      { name: "main.lua", kind: "lua" },
      { name: "tiles.json", kind: "tiles" },
      { name: "palettes.json", kind: "palettes" },
      { name: "sprites.json", kind: "sprites" },
      { name: "sources.json", kind: "sources" }
    ]
  }
];

/* #128: where the uncommitted art lives (docs/DECISIONS.md).  Only
 * `--with-demo-art` reads it — the playable main.lua and the picture files
 * beside it (card #156); the committed gallery and `--check` never do. */
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
  let demoDir = null;
  if (withDemoArt && meta.demoArt) {
    /* the playable file: the same toy with the pack's art in its block */
    demoDir = path.join(DEMO_ART, meta.demoArt);
    source = readFile(path.join(demoDir, "main.lua"), meta.id);
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
  if (demoDir) {
    /* #156: the demo's art is the studio's named files beside the playable —
     * tiles, palettes and sprite patterns (the #117 importer's three) plus
     * sources.json, the names the studio's ASSETS list shows.  The entry is
     * a folder, in the envelope's order: main.lua first. */
    const DEMO_FILES = ["main.lua", "tiles.json", "palettes.json",
                        "sprites.json", "sources.json"];
    toy.files = DEMO_FILES.map((name) => ({
      name: name,
      kind: name === "main.lua" ? "lua" : name.replace(/\.json$/, ""),
      source: readFile(path.join(demoDir, name), meta.id)
    }));
  } else if (meta.files) {
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
    " * page and the studio read them (#80): the sky gradient (#29),\n" +
    " * STARFALL (#88, #121), OAK WOODS (#128), CITY (#125),\n" +
    " * the #147 demos PLATFORMER and TOWER, and DUSK RUN (#151).\n" +
    " * #151 took the parallax, road, status-bar and palette-cycle effects\n" +
    " * out of Browse; their toys/*.lua files stay for the tests and guide.\n" +
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
