#!/usr/bin/env node
/*
 * tests/check-project.js — the #162 evidence: the .pcestudio project file.
 *
 * A project is a ZIP whose layout is the same as an unpacked project folder
 * (renderer/pce-project.js, docs/PROJECT-FORMAT.md).  This check builds one
 * with the SAME module the studio's Save uses, then reads it back with the
 * same module:
 *
 *   1. a save -> open -> save round-trip is byte-identical: every code and
 *      asset file, NOTES.md's text and the versions come back unchanged;
 *   2. a real 1 MB PNG original in art/ survives byte for byte, and
 *      sources.json names it (the `original` field);
 *   3. the finished archive passes `unzip -t` (and is listed by `unzip -Z1`)
 *      — the same reader macOS Archive Utility and every other unzip uses;
 *   4. a DEFLATED archive (made with the system `zip -9`, which is what
 *      Archive Utility writes) also opens: renderer/pce-zip.js reads stored
 *      and deflate;
 *   5. the checklist works: saving with art/ unticked leaves art/ out;
 *   6. the format refuses what it cannot be: no project.json, the wrong
 *      format, a project without main.lua, an unsafe file name.
 *
 * The studio side — Save project/Open project driven headlessly, the Project
 * window, a .pce.json still opening, open-with-only-songs leaving main.lua
 * unchanged — is in tests/check-studio.js (its #162 section).
 *
 *   node tests/check-project.js
 *
 * Written by @design because the card names this test.  Rule 2: a cold break
 * by another seat is owed before the card closes.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { spawnSync } = require("child_process");

const zip = require("../renderer/pce-zip.js");
const P = require("../renderer/pce-project.js");

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
function sameBytes(name, a, b) {
  const x = Buffer.from(a), y = Buffer.from(b);
  check(x.length === y.length && x.equals(y),
        name + " (" + x.length + " vs " + y.length + " bytes)");
}

/* ---- a real PNG, about 1 MB ------------------------------------------- */
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zip.crc32(body) >>> 0, 0);
  return Buffer.concat([len, body, crc]);
}
function makePng(w, h) {
  /* incompressible pixels, so the PNG stays about 1 MB */
  const raw = Buffer.alloc((w * 4 + 1) * h);
  let n = 12345;
  for (let y = 0; y < h; y++) {
    const row = y * (w * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      for (let k = 0; k < 4; k++) {
        n = (Math.imul(n, 1103515245) + 12345) >>> 0;
        raw[row + 1 + x * 4 + k] = (n >>> 16) & 255;
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([PNG_SIG, pngChunk("IHDR", ihdr),
                        pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
                        pngChunk("IEND", Buffer.alloc(0))]);
}

const TMP = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(),
                                    "pce-project-"));
function tmp(name) { return path.join(TMP, name); }
function unlinkAll() {
  try {
    for (const name of fs.readdirSync(TMP)) {
      const p = path.join(TMP, name);
      try {
        if (fs.lstatSync(p).isDirectory()) fs.rmSync(p, { recursive: true, force: true });
        else fs.unlinkSync(p);
      } catch (e) { /* leave it */ }
    }
    fs.rmdirSync(TMP);
  } catch (e) { /* leave the scratch dir */ }
}

function main() {
  const png = makePng(512, 512);
  check(png.length > 1024 * 1024,
        "the test's original is a real PNG over 1 MB (" + png.length + " B)");

  const notes = P.notesTemplate({ title: "Demo game", date: "2026-10-31" });
  check(/## Goal/.test(notes) && /## What works/.test(notes) &&
        /## What does not work/.test(notes) && /## Decisions/.test(notes) &&
        /## Next steps/.test(notes),
        "the NOTES.md template asks goal / works / does not / decisions / next");

  const files = [
    { name: "main.lua", source: "-- demo\nfunction frame(t, f) end\n" },
    { name: "tiles.json", source: "{\n  \"version\": 1,\n  \"tiles\": []\n}\n" },
    { name: "palettes.json", source: "{\n  \"version\": 1,\n  \"backdrop\": 0,\n  \"background\": [],\n  \"sprites\": []\n}\n" },
    { name: "sources.json", source: JSON.stringify({
        version: 1, sources: [{ name: "hero", kind: "bg", original: "art/hero.png",
                                tiles: { first: 0, count: 1 },
                                map: true,
                                palettes: { side: "bg", first: 0, count: 1 } }]
      }, null, 2) + "\n" },
    { name: "songs.json", source: "{\n  \"version\": 1,\n  \"songs\": []\n}\n" },
    { name: "NOTES.md", source: notes }
  ];
  const project = {
    title: "Demo game", author: "Dennis",
    created: "2026-10-31T10:00:00.000Z",
    modified: "2026-10-31T10:30:00.000Z",
    files: files,
    art: [{ name: "hero.png", bytes: png, source: "hero" }],
    versions: [{ label: "first look", created: "2026-10-31T10:15:00.000Z",
                 files: [{ name: "main.lua", source: "-- an older main\n" }] }]
  };

  /* 1. build; the entries are the unpacked folder, no directory records */
  const built = P.build(project);
  const entryNames = zip.read(built).map((e) => e.name);
  eq("the archive's entries are the unpacked project folder", entryNames, [
    "project.json", "main.lua", "tiles.json", "palettes.json", "sources.json",
    "songs.json", "NOTES.md", "art/hero.png", "versions/1-first-look/main.lua"
  ]);
  check(!entryNames.some((n) => /\/$/.test(n)),
        "no directory records: every entry is a file");
  const projText = Buffer.from(zip.read(built)
    .find((e) => e.name === "project.json").bytes).toString("utf8");
  const projDoc = JSON.parse(projText);
  eq("project.json's format is pcestudio/1", projDoc.format, "pcestudio/1");
  eq("project.json names the title", projDoc.title, "Demo game");
  eq("project.json has the file list and kinds", projDoc.files[0],
     { name: "main.lua", kind: "lua", bytes: files[0].source.length });
  check(projDoc.files.some((f) => f.name === "NOTES.md" && f.kind === "notes"),
        "project.json's file list marks NOTES.md as notes");
  eq("project.json names the original art", projDoc.art[0].path, "art/hero.png");
  eq("project.json names the version folder", projDoc.versions[0].dir,
     "versions/1-first-look");

  /* 2. write it and prove an ordinary unzip reads it */
  const out = tmp("demo.pcestudio");
  fs.writeFileSync(out, built);
  const unzipTest = spawnSync("unzip", ["-t", out], { encoding: "utf8" });
  if (unzipTest.error && unzipTest.error.code === "ENOENT") {
    console.log("SKIP  unzip -t: no `unzip` on PATH; the archive was not read " +
                "by a second reader");
  } else {
    check(unzipTest.status === 0,
          "unzip -t accepts the project (exit " + unzipTest.status + ")");
    check(/No errors detected/.test(unzipTest.stdout || ""),
          "unzip -t reports no errors (" +
          String(unzipTest.stdout || "").trim().split("\n").pop() + ")");
    const listed = spawnSync("unzip", ["-Z1", out], { encoding: "utf8" });
    const names = String(listed.stdout || "").trim().split("\n").sort();
    check(listed.status === 0 && names.join("\n") === entryNames.slice().sort().join("\n"),
          "unzip -Z1 lists the same entries the writer put in");
  }
  /* macOS's own extractor (Archive Utility uses ditto's engine): unpack the
   * archive and compare the files, not only the directory listing. */
  const dittoDir = tmp("ditto");
  const ditto = spawnSync("ditto", ["-x", "-k", out, dittoDir], { encoding: "utf8" });
  if (ditto.error && ditto.error.code === "ENOENT") {
    console.log("SKIP  ditto -x -k: no `ditto` on PATH (not macOS)");
  } else {
    const unpackedMain = path.join(dittoDir, "main.lua");
    const unpackedArt = path.join(dittoDir, "art", "hero.png");
    check(ditto.status === 0 && fs.existsSync(unpackedMain),
          "ditto -x -k (Archive Utility's extractor) unpacks the project");
    check(fs.existsSync(unpackedArt) &&
          Buffer.from(fs.readFileSync(unpackedArt)).equals(png),
          "ditto -x -k gives the 1 MB original back byte for byte");
  }

  /* 3. save -> open: every file byte-identical, NOTES.md and art/ intact */
  const opened = P.parseBytes(built);
  eq("open: the title", opened.title, "Demo game");
  eq("open: the author", opened.author, "Dennis");
  eq("open: the file names", opened.files.map((f) => f.name), files.map((f) => f.name));
  let identical = true;
  for (const f of files) {
    const back = opened.files.find((g) => g.name === f.name);
    if (!back || back.source !== f.source) identical = false;
  }
  check(identical, "open: every code/asset/notes file is byte-identical");
  check(opened.notes === notes, "open: NOTES.md is intact");
  eq("open: art/ is intact, named for its source", opened.art.map((a) => a.name),
     ["hero.png"]);
  sameBytes("open: the 1 MB PNG original survives byte for byte",
            opened.art[0].bytes, png);
  eq("open: sources.json's original is read back", opened.art[0].source, "hero");
  eq("open: the version's label", opened.versions[0].label, "first look");
  eq("open: the version's files", opened.versions[0].files.map((f) => f.name),
     ["main.lua"]);

  /* save again: the archive is byte-identical (fixed timestamps, same order) */
  const rebuilt = P.build(opened);
  sameBytes("save -> open -> save is byte-identical", rebuilt, built);

  /* 4. the checklist: art unticked leaves art/ out, everything else stays */
  const noArt = P.build(opened, { art: false });
  const noArtNames = zip.read(noArt).map((e) => e.name);
  check(!noArtNames.some((n) => n.indexOf("art/") === 0),
        "save with art/ unticked leaves art/ out");
  check(noArtNames.indexOf("main.lua") >= 0 &&
        noArtNames.indexOf("NOTES.md") >= 0 &&
        noArtNames.some((n) => n.indexOf("versions/") === 0),
        "... and keeps the code, the notes and the versions");
  const codeOff = (() => {
    try { P.build(opened, { code: false }); return null; }
    catch (e) { return e; }
  })();
  check(codeOff && codeOff.code === "project-code",
        "a project that would leave out main.lua is refused (project-code)");

  /* 5. a deflated archive, the shape Archive Utility writes, opens too */
  const folder = tmp("unpacked");
  fs.mkdirSync(folder);
  for (const e of zip.read(built)) {
    const dest = path.join(folder, e.name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, e.bytes);
  }
  const deflated = tmp("deflated.pcestudio");
  const zipped = spawnSync("zip", ["-q", "-9", "-r", ".." + path.sep +
    path.basename(deflated), "."], { cwd: folder, encoding: "utf8" });
  if (zipped.error && zipped.error.code === "ENOENT") {
    console.log("SKIP  deflated archive: no `zip` on PATH");
  } else {
    check(zipped.status === 0, "zip -9 builds a deflated copy");
    const raw = new Uint8Array(fs.readFileSync(deflated));
    const deflatedRead = zip.read(raw);
    check(deflatedRead.some((e) => e.method === 8),
          "the deflated copy really has DEFLATE entries");
    const fromDeflated = P.parseBytes(raw);
    check(fromDeflated.notes === notes &&
          fromDeflated.art.length === 1 &&
          Buffer.from(fromDeflated.art[0].bytes).equals(png),
          "the deflated archive opens with NOTES.md and the original intact");
  }

  /* 6. the refusals carry codes a caller can act on */
  function refuses(name, fn, code) {
    try { fn(); check(false, name + " (no refusal)"); }
    catch (e) { check(e.code === code, name + " (" + e.code + ")"); }
  }
  refuses("a zip without project.json is refused", () => {
    P.parseEntries([{ name: "main.lua", bytes: zip.utf8Encode("-- x\n") }]);
  }, "project-format");
  refuses("a project.json of the wrong format is refused", () => {
    P.parseEntries([
      { name: "project.json", bytes: zip.utf8Encode("{\"format\":\"other/1\"}\n") },
      { name: "main.lua", bytes: zip.utf8Encode("-- x\n") }
    ]);
  }, "project-format");
  refuses("a project without main.lua is refused", () => {
    P.parseEntries([
      { name: "project.json", bytes: zip.utf8Encode("{\"format\":\"pcestudio/1\"}\n") }
    ]);
  }, "project-main");
  refuses("an unsafe file name is refused", () => {
    P.build({ title: "x", files: [{ name: "../escape.lua", source: "-- x\n" }],
              art: [], versions: [] });
  }, "project-name");
  refuses("a path read from an archive is refused", () => {
    P.parseEntries([
      { name: "project.json", bytes: zip.utf8Encode("{\"format\":\"pcestudio/1\"}\n") },
      { name: "main.lua", bytes: zip.utf8Encode("-- x\n") },
      { name: "../escape.lua", bytes: zip.utf8Encode("-- evil\n") }
    ]);
  }, "project-name");
  /* Finder's Archive Utility adds these; a re-zipped project must still open */
  const withJunk = P.parseEntries([
    { name: "project.json", bytes: zip.utf8Encode("{\"format\":\"pcestudio/1\"}\n") },
    { name: "main.lua", bytes: zip.utf8Encode("-- x\n") },
    { name: ".DS_Store", bytes: new Uint8Array([0, 1, 2]) },
    { name: "__MACOSX/._main.lua", bytes: new Uint8Array([3, 4]) }
  ]);
  check(withJunk.files.length === 1 && withJunk.files[0].name === "main.lua",
        "Finder's .DS_Store / __MACOSX entries are skipped, not loaded");
  /* project.json without art.source: sources.json's `original` supplies it */
  const fallback = P.parseEntries([
    { name: "project.json", bytes: zip.utf8Encode(JSON.stringify({
        format: "pcestudio/1", title: "f", files: [], art: [], versions: [] })) },
    { name: "main.lua", bytes: zip.utf8Encode("-- x\n") },
    { name: "sources.json", bytes: zip.utf8Encode(JSON.stringify({
        version: 1, sources: [{ name: "hero", kind: "bg",
                                original: "art/hero.png" }] })) },
    { name: "art/hero.png", bytes: new Uint8Array([1, 2, 3]) }
  ]);
  eq("sources.json names an art original when project.json does not",
     fallback.art[0].source, "hero");
  /* the format keeps every version it is given; the handful is the page's
   * rule (snapshotVersion refuses past MAX_VERSIONS), so a folder written by
   * another tool with more is read whole rather than silently dropped */
  const many = [];
  for (let i = 0; i < P.MAX_VERSIONS + 1; i++)
    many.push({ label: "v" + i, created: "", files:
      [{ name: "main.lua", source: "-- version " + i + "\n" }] });
  const manyBytes = P.build({ title: "x",
    files: [{ name: "main.lua", source: "-- x\n" }], art: [], versions: many });
  const manyParsed = P.parseBytes(manyBytes);
  check(manyParsed.versions.length === P.MAX_VERSIONS + 1,
        "a project written with more versions is read whole, not dropped");
  check(P.sizes({ files: [{ name: "main.lua", source: "1234\n" },
                          { name: "songs.json", source: "12\n" },
                          { name: "NOTES.md", source: "1\n" }],
                  art: [{ name: "a.png", bytes: new Uint8Array(10) }],
                  versions: [] }).art === 10,
        "the checklist's size for art/ is the originals' bytes");
  eq("the download name is the project title's flat name",
     P.zipName("My Game!"), "My-Game.pcestudio");

  /* a zip the reader cannot use says so with a code, not a crash */
  refuses("a non-ZIP is refused", () => zip.read(zip.utf8Encode("not a zip")),
          "zip-eocd");

  if (failures.length) {
    console.log("FAIL  " + failures.length + " of " + checks + " checks failed");
    return 1;
  }
  console.log("PASS  " + checks + " checks: .pcestudio round-trips byte for " +
              "byte, NOTES.md and a 1 MB original intact, unzip -t accepts " +
              "it, deflate reads, refusals carry codes");
  return 0;
}

let status = 1;
try { status = main(); }
catch (e) {
  console.log("FAIL  " + (e && e.stack ? e.stack : e));
  status = 1;
}
unlinkAll();
process.exit(status);
