#!/usr/bin/env node
/*
 * tests/check-sound-guide.js — the sound guide and the three sound example
 * toys the MCP Claude reads.
 *
 *   1. The guide is a docs topic ("sound-guide") the MCP session serves, it is
 *      in docs.html, it names no board cards, and it names every call, wave,
 *      preset and refusal code the sound surface has (so a new call that the
 *      guide forgets fails here).
 *   2. toys/examples/{sound-jump-shoot.lua, song-effects/, noise-explosion.lua}
 *      each pass validate and rom_check and export through export_pce
 *      (the very calls the connected Claude makes), and the export is the
 *      independent il -> ilbc -> rom build byte for byte.
 *   3. Played with scripted button presses, each example makes sound in the
 *      studio's two runtimes (the Lua one and the IL one the ROM is built
 *      from) and the two write the same PSG registers, write for write, and the
 *      PCM the model renders from them is audible.  The same calls' registers
 *      are proven equal on the interpreter ROM and the native ROM by
 *      tests/check-sfx-fx.js.
 *   4. The LFO is refused with a code, in the Lua runtime and the validator,
 *      and the guide says so (the song format's effect columns are pinned by
 *      tests/check-dmf.js: song-fx).
 *
 * Written by @design: the author's own test; a cold break by another seat is
 * owed (workshop rule 2).
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const docs = require("../renderer/pce-docs.js");
const host = require("../renderer/pce-toyhost.js");
const sfx = require("../renderer/pce-sfx.js");
const toys = require("../renderer/pce-toys.js");
const il = require("../renderer/pce-il.js");
const ilbc = require("../renderer/pce-ilbc.js");
const rom = require("../renderer/pce-rom.js");
const seq = require("../renderer/pce-seq.js");
const songbank = require("../renderer/pce-songbank.js");
const validate = require("../renderer/pce-validate.js");
const server = require("../tools/mcp/server.js");

const ROOT = path.resolve(__dirname, "..");
let checks = 0;
const failures = [];
function check(ok, name) { checks++; if (!ok) { failures.push(name); console.log("FAIL  " + name); } }
function eq(name, got, want) {
  check(JSON.stringify(got) === JSON.stringify(want),
        name + " (got " + JSON.stringify(got).slice(0, 200) + ", want " + JSON.stringify(want).slice(0, 200) + ")");
}
async function call(name, args) {
  const reply = await server.session.call(name, args || {});
  return JSON.parse(reply.content[0].text);
}

const EXAMPLES = [
  { name: "sound-jump-shoot", main: "toys/examples/sound-jump-shoot.lua", extra: [],
    presses: [[10, { i: true }], [11, {}], [40, { ii: true }], [41, {}], [60, { right: true }], [61, {}], [70, { ii: true }], [71, {}]] },
  { name: "song-effects", main: "toys/examples/song-effects/main.lua", extra: ["toys/examples/song-effects/song.json"],
    presses: [[30, { i: true }], [31, {}], [70, { ii: true }], [71, {}]] },
  { name: "noise-explosion", main: "toys/examples/noise-explosion.lua", extra: [],
    presses: [[8, { i: true }], [9, {}], [30, { ii: true }], [31, {}], [50, { left: true }], [66, {}]] }
];

async function main() {
  /* ---- 1. the guide ---------------------------------------------------- */
  const ref = docs.reference();
  const sec = ref.sections.find((s) => s.id === "sound-guide");
  check(!!sec, "the reference has a sound-guide chapter");
  const served = await call("docs", { topic: "sound-guide" });
  check(served.ok && /sound-guide|Sound guide/i.test(served.markdown), "docs('sound-guide') is served through the MCP session");
  const text = served.markdown || "";
  check(!/#\d{2,3}\b/.test(text), "the guide names no board cards");
  const html = fs.readFileSync(path.join(ROOT, "renderer", "docs.html"), "utf8");
  check(html.indexOf('id="sound-guide"') > 0, "docs.html carries the chapter");
  const need = [].concat(
    ["sfx(", "sfx_noise(", "sfx_slide(", "sfx_fx(", "sfx_preset(", "release(", "music(", "note("],
    sfx.WAVE_NAMES, sfx.presetNames(),
    ["lfo", "song-fx", "sfx-range", "il-unsupported", "cycles", "export_pce", "toys/examples/sound-jump-shoot.lua",
     "toys/examples/song-effects/", "toys/examples/noise-explosion.lua"]);
  need.forEach((w) => check(text.indexOf(w) >= 0, "the guide names " + w));

  /* ---- 2. the examples through the MCP session -------------------------- */
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "sound-guide-"));
  const runs = {};
  for (const ex of EXAMPLES) {
    const source = fs.readFileSync(path.join(ROOT, ex.main), "utf8");
    check(/^-- [a-z-]+(\.lua)? — /.test(source), ex.name + " opens with a header comment");
    check(!/#\d{1,3}\b/.test(source.split("\n").filter((l) => /^--/.test(l)).join("\n")), ex.name + "'s comments name no cards");
    const files = [{ name: "main.lua", source: source }].concat(ex.extra.map((p) => ({ name: path.basename(p), source: fs.readFileSync(path.join(ROOT, p), "utf8") })));
    const wrote = await call("toy_write", { files: files });
    check(wrote.ok !== false, ex.name + " loads through toy_write");
    const v = await call("validate", {});
    check(v.ok && v.problems.filter((p) => p.severity === "error").length === 0, ex.name + " passes validate" + (v.ok ? "" : " (" + v.code + ")"));
    eq(ex.name + " has no validate findings at all", v.problems, []);
    const rc = await call("rom_check", {});
    check(rc.ok && rc.findings.length === 0, ex.name + " rom_checks clean" + (rc.findings ? " " + JSON.stringify(rc.findings).slice(0, 200) : ""));
    check(rc.budget.rows.every((r) => r.status === "ok"), ex.name + "'s every budget row is ok");
    const out = path.join(tmp, ex.name + ".pce");
    const ex2 = await call("export_pce", { name: ex.name, out: out });
    check(ex2.ok === true, ex.name + " exports through export_pce" + (ex2.ok ? "" : " (" + ex2.code + ": " + ex2.message + ")"));
    if (ex2.ok) {
      const program = il.compile(source, { chunkName: "main.lua" });
      const songs = ex.extra.length ? seq.songsFromFiles(files.filter((f) => f.name === "song.json")) : [];
      const o = { bank0: fs.readFileSync(path.join(ROOT, "renderer", "ilvm.bin")), bytecode: ilbc.encode(program).bytes };
      if (songs.length) o.songs = (n) => songbank.build(songs, n);
      const want = Buffer.from(rom.buildToyRom(o));
      const got = fs.readFileSync(ex2.path);
      check(Buffer.compare(got, want) === 0, ex.name + "'s export is the independent build byte for byte (" + got.length + " B)");
    }
    runs[ex.name] = { source, files };
  }

  /* ---- 3. played with scripted presses, both runtimes -------------------- */
  for (const ex of EXAMPLES) {
    const { source, files } = runs[ex.name];
    const songs = ex.extra.length ? seq.songsFromFiles(files.filter((f) => f.name === "song.json")) : [];
    const streams = [];
    for (const make of [toys.create, il.create]) {
      const rt = make(source, { chunkName: "main.lua", budgetMs: 250, songs: songs });
      rt.load();
      for (let k = 0; k < 220; k++) {
        ex.presses.forEach((p) => { if (p[0] === k) rt.setPad(1, p[1]); });
        rt.frame(k);
      }
      streams.push(rt.sound.events.map((e) => [e.f, e.reg, e.value]));
    }
    check(streams[0].length > 40, ex.name + ": the studio writes " + streams[0].length + " PSG registers when played");
    eq(ex.name + ": the Lua and IL runtimes write the same registers", streams[1], streams[0]);
    const rt = il.create(source, { chunkName: "main.lua", budgetMs: 250, songs: songs });
    rt.load();
    for (let k = 0; k < 120; k++) { ex.presses.forEach((p) => { if (p[0] === k) rt.setPad(1, p[1]); }); rt.frame(k); }
    const pcm = rt.renderSound ? rt.renderSound(120) : null;
    if (pcm) {
      let peak = 0; for (const v of pcm.pcm) peak = Math.max(peak, Math.abs(v));
      check(peak > 500, ex.name + ": the PCM is audible (peak " + peak + ")");
    }
  }

  /* ---- 4. refusals ------------------------------------------------------- */
  function codeOf(make, src) {
    try { const rt = make(src, { chunkName: "t.lua", budgetMs: 250 }); rt.load(); rt.frame(0); } catch (e) { return e.code || e.name; }
    return null;
  }
  eq("lfo() is refused by the Lua runtime", codeOf(toys.create, "function frame(t, f) lfo(1, 2) end"), "sfx-lfo");
  eq("sfx_lfo() is refused by the Lua runtime", codeOf(toys.create, "function frame(t, f) sfx_lfo(1, 2) end"), "sfx-lfo");
  eq("lfo() is refused by the IL runtime", codeOf(il.create, "function frame(t, f) lfo(1, 2) end"), "il-unsupported");
  const rep = validate.validate("function frame(t, f) lfo(1, 2) end", { chunkName: "t.lua", frames: 2 });
  check((rep.problems || []).some((p) => p.code === "il-unsupported" && /LFO/.test(p.message)), "the validator refuses lfo() and names the LFO");
  check(host.REFUSALS["sfx-lfo"], "sfx-lfo is in the host's refusal table");
  fs.rmSync(tmp, { recursive: true, force: true });
  if (failures.length) { console.log("FAIL  " + failures.length + " of " + checks + " checks failed"); process.exit(1); }
  console.log("PASS  " + checks + " checks: the sound guide is served, the three sound examples validate, rom_check, export and play the same in both runtimes");
}
main().catch((e) => { console.log("FAIL  " + (e && e.stack || e)); process.exit(1); });
