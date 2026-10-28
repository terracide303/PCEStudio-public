#!/usr/bin/env node
/*
 * tests/check-export-song.js — #35's export step: a DMF song in the .pce.
 *
 * The console side already plays our song (tests/check-hutrack.js).  This
 * check is about the BROWSER side of the export, which cannot run Python or
 * PCEAS:
 *
 *   1. renderer/pce-hutrack.js's convert() must produce the same ten
 *      assembler includes, byte for byte, as HuTrack's own Python converter.
 *      The committed fixtures are that converter's output; song.json records
 *      their hashes.  With HUTRACK_PYTHON set to a Python that has numpy and
 *      resampy, the converter is re-run into a temporary directory and the
 *      fixtures are re-proven, not just trusted.
 *   2. assemble() must turn those includes into the song bank PCEAS emits,
 *      and renderer/pce-rom.js's buildSongRom() must place it exactly where
 *      tools/hutrack.asm does.  The witness is the whole ROM: rebuilt here
 *      with PCEAS 4.x, it must be byte-identical to what the JS path builds.
 *      Two songs are used, and the second one (tests/dumps/hutrack2) was
 *      written to reach the converter paths the first never does — two
 *      instruments and waveforms, envelope loops, a relative arpeggio, two
 *      effect columns, a bare-note row, a volume-only row, a note cut, a
 *      repeated order and a 30-row empty run.
 *   3. Song 1's JS-built ROM must hash to the ROM run.json recorded — the
 *      ROM whose Mednafen WAV tests/check-dmf.js measures.  The export's
 *      "plays the same as hutrack1" claim is therefore a bytes claim, and
 *      the recording already covers it.
 *   4. Every refusal has its code, and the small assembler refuses what it
 *      cannot lay out truthfully.
 *
 *   5. The engine image is copied whole (#72, REVIEW-35's M11).  Check 2
 *      compares the ROM against renderer/hutrack-engine.bin, whose banks
 *      $02-$07 and $0A-$0F are 0xff filler, so a buildSongRom that copied
 *      only 15 of the 16 banks produced byte-identical ROMs (M11).  Check 5
 *      drives buildSongRom with a synthetic 16-bank engine whose every bank,
 *      including $0F, carries data, and requires the ROM's first sixteen
 *      banks to be that engine byte for byte.  It needs no PCEAS and no
 *      Python.  Its fixture self-checks refuse an engine whose tail bank is
 *      filler, so the assertion cannot go quiet by losing its witness.
 *      tests/music-mutation.js re-runs M11 and requires this check to fail.
 *
 * NOTE: written by @design, the seat that wrote the converter and the
 * assembler.  Under workshop RULES.md rule 2 it is not proof of itself —
 * @review owes it a cold break (wrong mask bits, a skipped empty run, an
 * omitted include, a wrong byte order), before this card can close.  Check 5
 * was added by @test under #72, after REVIEW-35 ran that break and this
 * check stayed green.
 *
 * Check 5 does NOT prove that the committed engine image uses its tail bank
 * — it does not (bank $0F is 0xff filler) — so the witness is a synthetic
 * image, not a real engine build.  It proves the copy is whole; it does not
 * prove that anything plays from bank $0F, and no recording exercises a song
 * whose engine data lives there.
 *
 * Needs no PCEAS and no Python for checks 1 and 4; check 2's witness is
 * skipped (reported, not passed) when PCEAS 4.x is unavailable.
 */

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");

const ROOT = path.join(__dirname, "..");
const RENDERER = path.join(ROOT, "renderer");
const dmf = require(path.join(RENDERER, "pce-dmf.js"));
const hutrack = require(path.join(RENDERER, "pce-hutrack.js"));
const romlib = require(path.join(RENDERER, "pce-rom.js"));

const BANK = 8 * 1024;
const ENGINE_BANKS = 16;
const SONGS = [
  { n: 1, name: "demo", dir: "hutrack1", rom: "hutrack-demo.pce",
    buildDir: "build" },
  { n: 2, name: "demo2", dir: "hutrack2", rom: "hutrack-demo2.pce",
    buildDir: "build2" }
];

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const sha = (buf) => sha256(buf).slice(0, 16) + "…";

let failures = 0;
function fail(msg) { failures++; console.log(`FAIL: ${msg}`); }
function ok(msg) { console.log(`ok   ${msg}`); }
function check(cond, msg) { if (cond) ok(msg); else fail(msg); }

function songPath(song, ...rest) {
  return path.join(__dirname, "dumps", song.dir, ...rest);
}

function load(song) {
  const dmfFile = songPath(song, song.name + ".dmf");
  const spec = JSON.parse(fs.readFileSync(songPath(song, "song.json"), "utf8"));
  return { dmfFile, spec, mod: dmf.read(fs.readFileSync(dmfFile)) };
}

/* ---- 1. the converter's bytes are the Python converter's ---------------- */

function checkFixtureHashes(song, spec) {
  const file = songPath(song, song.name + ".dmf");
  const buf = fs.readFileSync(file);
  check(buf.length === spec.dmf.file_bytes &&
        sha256(buf) === spec.dmf.file_sha256,
        `${song.dir}/${song.name}.dmf matches song.json (${buf.length} B)`);

  const dir = songPath(song, "song");
  const onDisk = fs.readdirSync(dir).filter((n) => n.endsWith(".inc")).sort();
  const recorded = Object.keys(spec.includes || {}).sort();
  check(onDisk.join(",") === recorded.join(","),
        `${song.dir}: ${recorded.length} converter includes, the same set ` +
        `song.json records`);
  let bad = 0;
  for (const name of recorded) {
    const p = path.join(dir, name);
    if (!fs.existsSync(p)) { fail(`${song.dir}: missing ${name}`); bad++; continue; }
    const bytes = fs.readFileSync(p);
    const rec = spec.includes[name];
    if (bytes.length !== rec.bytes || sha256(bytes) !== rec.sha256) {
      fail(`${song.dir}/${name}: does not match song.json`);
      bad++;
    }
  }
  if (!bad) ok(`${song.dir}: every include's sha256 matches song.json`);
}

function checkConverter(song, mod, spec) {
  const result = hutrack.convert(mod, {
    songName: song.name, subFolder: "song", includePath: ""
  });
  const dir = songPath(song, "song");
  const names = Object.keys(result.files).sort();
  const want = fs.readdirSync(dir).filter((n) => n.endsWith(".inc"))
    .map((n) => "song/" + n).sort();
  check(names.join(",") === want.join(","),
        `${song.dir}: convert() writes the same ${want.length} files`);

  let identical = 0;
  for (const name of want) {
    const disk = fs.readFileSync(path.join(dir, path.basename(name)), "utf8");
    const got = result.files[name];
    if (got === undefined) { fail(`${song.dir}: ${name} not produced`); continue; }
    if (got !== disk) {
      const a = got.split("\n"), b = disk.split("\n");
      let line = 0;
      while (line < Math.max(a.length, b.length) && a[line] === b[line]) line++;
      fail(`${song.dir}/${name}: differs from the Python converter at line ` +
           `${line + 1}: ${JSON.stringify(a[line])} vs ${JSON.stringify(b[line])}`);
    } else {
      identical++;
    }
  }
  if (identical === want.length)
    ok(`${song.dir}: all ${want.length} includes byte-identical ` +
       `(${want.reduce((s, n) => s + fs.statSync(path.join(dir, path.basename(n))).size, 0)} B)`);

  const songBank = hutrack.assemble(result.files, result.entry);
  check(songBank.length > 0 && songBank.length <= BANK,
        `${song.dir}: the includes assemble to ${songBank.length} B, inside ` +
        `the 8 KiB song bank`);
  return { result, songBank };
}

/* The Python converter, when a Python with its requirements is named. */
function checkPython(song) {
  const py = process.env.HUTRACK_PYTHON;
  if (!py) {
    console.log(`skip ${song.dir}: HUTRACK_PYTHON not set, so the fixtures ` +
                `are trusted as recorded, not regenerated`);
    return;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pce-hutrack-py-"));
  const r = cp.spawnSync(py, [
    path.join(ROOT, "vendor/hutrack/utils/HuTrackConverter.py"), "--no_gui",
    "--filein", songPath(song, song.name + ".dmf"),
    "--destinationPath", tmp, "--songname", song.name,
    "--subfolder", "song", "--includePath", ""
  ], { encoding: "utf8" });
  if (r.status !== 0) {
    fail(`${song.dir}: the Python converter failed: ${(r.stderr || "").trim()}`);
    return;
  }
  const dir = songPath(song, "song");
  let bad = 0;
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith(".inc"))) {
    const a = fs.readFileSync(path.join(tmp, "song", name));
    const b = fs.readFileSync(path.join(dir, name));
    if (sha256(a) !== sha256(b)) { fail(`${song.dir}/${name}: Python run differs`); bad++; }
  }
  if (!bad) ok(`${song.dir}: the vendored Python converter re-produces the ` +
               `committed includes`);
  fs.rmSync(tmp, { recursive: true, force: true });
}

/* ---- 2. the ROM: the JS path against PCEAS ------------------------------ */

function pceas() {
  const name = process.env.PCEAS4 || "pceas4";
  if (name.includes("/")) return fs.existsSync(name) ? name : null;
  const which = cp.spawnSync("sh", ["-c", `command -v ${JSON.stringify(name)}`],
                             { encoding: "utf8" });
  return which.status === 0 ? name : null;
}

function checkAgainstPceas(songs, built) {
  const pceasPath = pceas();
  if (!pceasPath) {
    console.log("skip export: no PCEAS 4.x (set PCEAS4), so the song bank is " +
                "not compared with the assembler's");
    return;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pce-hutrack-rom-"));
  const engine = new Uint8Array(fs.readFileSync(
    path.join(RENDERER, "hutrack-engine.bin")));

  for (const song of songs) {
    const rom = path.join(tmp, song.rom);
    const build = path.join(tmp, song.buildDir);
    const r = cp.spawnSync(path.join(ROOT, "tools/build-hutrack.sh"), [], {
      encoding: "utf8",
      env: Object.assign({}, process.env, {
        PCEAS4: pceasPath, BUILD: build, ROM: rom,
        SONG: songPath(song, "song")
      })
    });
    if (r.status !== 0) {
      fail(`${song.dir}: build-hutrack.sh failed: ` +
           `${(r.stderr || r.stdout || "").trim().split("\n").slice(-3).join(" | ")}`);
      continue;
    }
    const pceasRom = fs.readFileSync(rom);
    const jsRom = Buffer.from(romlib.buildSongRom({
      engine: engine, song: built[song.n].songBank
    }));
    check(pceasRom.length === romlib.ROM_BANKS * BANK,
          `${song.dir}: PCEAS emits ${pceasRom.length} B = ` +
          `${romlib.ROM_BANKS} banks`);
    check(jsRom.equals(pceasRom),
          `${song.dir}: the JS-built ROM is byte-identical to PCEAS's ` +
          `(${sha(jsRom)})` +
          (jsRom.equals(pceasRom) ? "" :
           `, first difference at ${firstDiff(jsRom, pceasRom)}`));

    /* The committed engine image must be this build's banks $00-$0F, or the
     * export ships stale code. */
    const engineNow = pceasRom.subarray(0, ENGINE_BANKS * BANK);
    check(Buffer.from(engine).equals(engineNow),
          `${song.dir}: renderer/hutrack-engine.bin equals banks $00-$0F ` +
          `(${sha(engineNow)})`);

    /* The song bank is the one region the two songs may differ in. */
    const songBank = pceasRom.subarray(ENGINE_BANKS * BANK);
    check(!songBank.subarray(built[song.n].songBank.length).some((b) => b !== 0xff),
          `${song.dir}: PCEAS pads the rest of the song bank with 0xff`);

    built[song.n].rom = jsRom;
    built[song.n].pceasSha = sha256(pceasRom);
  }
  fs.rmSync(tmp, { recursive: true, force: true });

  /* #35's "plays the same as hutrack1": the recorded ROM is this ROM. */
  const run = JSON.parse(fs.readFileSync(songPath(songs[0], "run.json"), "utf8"));
  const song1 = built[1];
  check(song1.pceasSha === undefined || song1.pceasSha === run.rom.sha256,
        `song 1: the export's ROM is the recorded ROM ` +
        `(${run.rom.sha256.slice(0, 16)}…)`);
}

function firstDiff(a, b) {
  for (let i = 0; i < Math.min(a.length, b.length); i++)
    if (a[i] !== b[i]) return `byte ${i} (bank ${i / BANK | 0}, offset ${i % BANK})`;
  return `length ${a.length} vs ${b.length}`;
}

/* ---- 3. refusals -------------------------------------------------------- */

function refuses(fn, code, what) {
  try {
    fn();
    fail(`${what}: no refusal (expected ${code})`);
  } catch (e) {
    if (e.code === code) ok(`${what}: ${code}`);
    else fail(`${what}: refused with ${e.code || e.message}, expected ${code}`);
  }
}

function checkRefusals(songs, mods) {
  const s1 = JSON.parse(JSON.stringify(mods[1]));
  const opts = { songName: "demo", subFolder: "song", includePath: "" };

  function mutated(fn) {
    const copy = JSON.parse(JSON.stringify(s1));
    fn(copy);
    return () => hutrack.convert(copy, opts);
  }

  refuses(mutated((m) => { m.samples = [{}]; }), "song-pcm",
          "a song with a PCM sample");
  refuses(mutated((m) => { m.patterns[0][0][1].volume = 32; }), "song-volume",
          "a volume of 32");
  refuses(mutated((m) => {
    m.patterns[0][0][0].note = { semitone: 11, octave: 7 };
  }), "song-note", "a note above HuTrack's C0..B6");
  refuses(mutated((m) => { m.patterns[0][0][0].fxSlots[0].code = 0x120; }),
          "song-effect", "an effect code above one byte");
  refuses(mutated((m) => {
    m.patterns[0][0][1].fxSlots[0] = { code: 0x10, arg: 5 };
  }), "song-effect", "a waveform index the song does not have");
  refuses(mutated((m) => {
    m.instruments[0].arpeggioEnv = { size: 1, data: [200], loop: 0, mode: 1 };
  }), "song-arp", "a fixed arpeggio note past 195");
  refuses(mutated((m) => { m.patterns[0][0][0].instrument = 9; }),
          "song-instrument", "an instrument index that does not exist");
  refuses(() => hutrack.convert(s1, {
    songName: "a/b", subFolder: "song", includePath: ""
  }), "song-name", "a song name with a directory separator");

  console.log("assembler refusals");
  refuses(() => hutrack.assemble({
    "x.inc": ".big\n  .db " + new Array(8193).fill(1).join(",") + "\n"
  }, "x.inc"), "song-bank", "a song past its 8 KiB bank");
  refuses(() => hutrack.assemble({
    "x.inc": ".a\n  .db 1\n.a\n  .db 2\n"
  }, "x.inc"), "song-label", "a label defined twice");
  refuses(() => hutrack.assemble({
    "x.inc": "  .dw .missing\n"
  }, "x.inc"), "song-label", "a .dw of an undefined label");
  refuses(() => hutrack.assemble({
    "x.inc": "  .db 256\n"
  }, "x.inc"), "song-value", "a .db value above 255");
  refuses(() => hutrack.assemble({
    "x.inc": "  .db 1\n  .org $4000\n"
  }, "x.inc"), "song-syntax", "a directive the assembler does not know");
  refuses(() => hutrack.assemble({
    "x.inc": "  .include \"song/none.inc\"\n"
  }, "x.inc"), "song-syntax", "an include that is not in the file set");
}

/* ---- 4. the assembler's own semantics ----------------------------------- */

function checkAssembler() {
  const files = {
    "s.song.inc": "  .include \"song/s.header.inc\"\n",
    "song/s.header.inc":
      ".a\n  .dw .b\n  .db bank(.b)\n  .db 1, 2, 3\n" +
      ".b\n  .dw $1234\n  .db 255\n"
  };
  const bank = hutrack.assemble(files, "s.song.inc", { bank: 0x10, org: 0x4000 });
  /* .a at $4000: .dw .b -> $4006; bank -> $10; then 1,2,3; .b at $4006:
   * .dw $1234; .db 255. */
  const want = [0x06, 0x40, 0x10, 1, 2, 3, 0x34, 0x12, 255];
  check(bank.length === want.length && want.every((v, i) => bank[i] === v),
        `assembler: labels resolve to bank-relative CPU addresses, forward ` +
        `references included (${Array.from(bank).join(",")})`);
}

/* ---- 5. the engine image is copied whole (#72, REVIEW-35's M11) -------- */

/* The one committed engine image uses banks $00, $01, $08 and $09; every
 * other bank is 0xff filler.  A fifteen-bank copy is therefore
 * indistinguishable from a whole copy in check 2, which is exactly what
 * REVIEW-35's M11 showed.  This assertion needs an engine whose tail bank is
 * in use, so it builds one: every bank distinct, bank $0F carrying data. */
function checkEngineCopy() {
  console.log("engine copy — buildSongRom takes all 16 banks, tail included");
  const banks = romlib.ENGINE_BANKS;
  const engine = new Uint8Array(banks * BANK);
  for (let b = 0; b < banks; b++)
    for (let i = 0; i < BANK; i++)
      engine[b * BANK + i] = (b * 31 + i * 17 + 1) & 0xff;
  const tail = engine.subarray((banks - 1) * BANK);

  check(tail.some((v) => v !== 0xff),
        `fixture: engine bank $${(banks - 1).toString(16)} carries data ` +
        `(${tail.filter((v) => v !== 0xff).length} of ${BANK} bytes are not ` +
        `0xff, so a lost tail is visible)`);
  check(new Set(Array.from({ length: banks }, (_, b) =>
          engine.subarray(b * BANK, (b + 1) * BANK).join(","))).size === banks,
        `fixture: all ${banks} engine banks are distinct, so each copy ` +
        `misplacement is visible`);

  const song = new Uint8Array(BANK);
  for (let i = 0; i < BANK; i++) song[i] = (i * 5 + 3) & 0xff;
  const rom = romlib.buildSongRom({ engine: engine, song: song });
  check(rom.length === romlib.ROM_BANKS * BANK,
        `the ROM is ${romlib.ROM_BANKS} banks (${rom.length} B)`);

  let diff = -1;
  for (let i = 0; i < engine.length; i++)
    if (rom[i] !== engine[i]) { diff = i; break; }
  check(diff < 0,
        `buildSongRom copies all ${banks} engine banks — first difference: ` +
        (diff < 0 ? "none"
                  : `byte ${diff} (bank ${diff / BANK | 0}, offset ${diff % BANK})`));

  /* Name the tail in its own assertion: a truncation must fail on the bank
   * the committed image cannot reach. */
  let tailDiff = -1;
  for (let i = 0; i < BANK; i++)
    if (rom[(banks - 1) * BANK + i] !== tail[i]) { tailDiff = i; break; }
  check(tailDiff < 0,
        `engine bank $${(banks - 1).toString(16)} (the tail) lands at byte ` +
        `${(banks - 1) * BANK} — first difference: ` +
        (tailDiff < 0 ? "none" : String(tailDiff)));

  const at = romlib.SONG_BANK * BANK;
  let songBad = -1;
  for (let i = 0; i < song.length; i++)
    if (rom[at + i] !== song[i]) { songBad = i; break; }
  const after = rom.subarray(at + song.length);
  check(songBad < 0 && !after.some((v) => v !== 0xff),
        `the song lands at bank $${romlib.SONG_BANK.toString(16)} and the ` +
        `rest of the ROM is 0xff` +
        (songBad < 0 ? "" : ` (first difference: ${songBad})`));
}

/* ---- run ---------------------------------------------------------------- */

const songs = SONGS;
const built = {};
const mods = {};
for (const song of songs) {
  const { spec, mod } = load(song);
  mods[song.n] = mod;
  checkFixtureHashes(song, spec);
  built[song.n] = checkConverter(song, mod, spec);
  checkPython(song);
}
checkAgainstPceas(songs, built);
checkRefusals(songs, mods);
checkAssembler();
checkEngineCopy();

console.log(failures ? `\n${failures} failure(s)` : "\nall checks passed");
process.exit(failures ? 1 : 0);
