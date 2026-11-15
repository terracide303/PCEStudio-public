#!/usr/bin/env node
/*
 * tests/check-sample.js — sample(name, channel), DDA playback (renderer/pce-sample.js).
 *
 *   node tests/check-sample.js
 *
 * 1. the importer: the committed samples.json is what tools/wav2sample.js makes from the committed
 *    WAV files; the WAVs are what tools/gen-sample-wav.js synthesises; the bank's bytes and its
 *    budget refusals.
 * 2. the browser: the Lua runtime and the IL runtime write the same PSG stream for tools/toys/sample;
 *    the DDA steps are the sample's data in order; the music's own channels are untouched by a sample.
 * 3. the refusals, by code: an unknown name, a bad channel, the bank budget, sample() with timer(), and
 *    the interpreter ROM's ilbc-sample.
 * 4. the native ROM (a trace build with the DDA step log, run in Geargrafx through tools/ggmcp.py): the
 *    steps the timer interrupt wrote equal the browser's, step for step, for a whole sample; a sample
 *    cut by another equals the browser's up to the cut (where it stops depends on the cycle the call
 *    ran at, which the browser models as the frame's start); the engine's PSG write stream for the
 *    toy's other writes equals the studio's; the four music channels' frequency and on/off equal the
 *    studio's after every toy frame while samples play on the other two.
 *    Without Geargrafx, llvm-mos or PCEAS 4.x the ROM part prints SKIP.
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const il = require("../renderer/pce-il.js");
const ilbc = require("../renderer/pce-ilbc.js");
const toys = require("../renderer/pce-toys.js");
const validate = require("../renderer/pce-validate.js");
const seq = require("../renderer/pce-seq.js");
const sample = require("../renderer/pce-sample.js");
const toolPaths = require("../tools/tool-paths.js");

const ROOT = path.join(__dirname, "..");
const DIR = path.join(ROOT, "tools", "toys", "sample");
let checks = 0;
const failures = [], skipped = [];
function check(ok, name) { checks++; if (!ok) { failures.push(name); console.log("FAIL  " + name); } }
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  check(ok, name + (ok ? "" : ": got " + JSON.stringify(got).slice(0, 200) + " want " + JSON.stringify(want).slice(0, 200)));
}
const read = (n) => fs.readFileSync(path.join(DIR, n), "utf8");

/* ---- 1. the importer and the bank ------------------------------------------------------------ */
const scratch0 = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "sample-"));
{
  const r = spawnSync("node", [path.join(ROOT, "tools", "gen-sample-wav.js"), scratch0], { encoding: "utf8" });
  check(r.status === 0, "tools/gen-sample-wav.js runs");
  ["thump.wav", "click.wav"].forEach((n) =>
    check(fs.readFileSync(path.join(scratch0, n)).equals(fs.readFileSync(path.join(DIR, n))), n + " is what the generator synthesises (no recording)"));
  const out = path.join(scratch0, "samples.json");
  const w = spawnSync("node", [path.join(ROOT, "tools", "wav2sample.js"), out,
    "thump=" + path.join(DIR, "thump.wav") + ",div=2", "click=" + path.join(DIR, "click.wav") + ",div=1,bits=4"], { encoding: "utf8" });
  check(w.status === 0 && /sample bank: 1131 of 8120/.test(w.stdout), "tools/wav2sample.js converts both and reports the budget (" + w.stdout.trim().split("\n").pop() + ")");
  check(fs.readFileSync(out, "utf8") === read("samples.json"), "samples.json is exactly what the importer makes from the WAVs");
}
const list = sample.parse(read("samples.json"));
eq("two samples, by name", sample.names(list), ["thump", "click"]);
eq("rates: 3,496 Hz and 6,991 Hz", list.map((s) => Math.round(sample.rateOf(s.div))), [3496, 6991]);
check(list.every((s) => s.data.every((v) => v >= 0 && v <= 31)), "every step is a 5-bit DDA value");
check(list[1].data.every((v) => (v & 1) === ((v >> 4) & 1)), "the 4-bit sample keeps 16 levels (the low bit follows the high one)");
check(list[0].data[0] >= 13 && list[0].data[0] <= 19 && list[0].data[list[0].data.length - 1] >= 13 && list[0].data[list[0].data.length - 1] <= 19,
      "a sample starts and ends near the centre level (no click)");
{
  const bank = sample.build(list);
  check(bank.length === 8192 && bank[0] === 2, "the bank is 8 KiB with a count of 2");
  const off = bank[8] | (bank[9] << 8), len = bank[10] | (bank[11] << 8);
  eq("entry 0: offset, length, divisor", [off, len, bank[12]], [sample.HEADER, list[0].data.length, 2]);
  eq("entry 0's steps are in the bank", Array.from(bank.slice(off, off + len)), Array.from(list[0].data));
  const big = Array.from({ length: 9 }, (_, i) => ({ name: "s" + i, div: 1, bits: 5, data: new Uint8Array(10) }));
  eq("nine samples: sample-count", sample.check(big).code, "sample-count");
  eq("8,121 bytes of steps: sample-bank-full", sample.check([{ name: "a", div: 1, bits: 5, data: new Uint8Array(8121) }]).code, "sample-bank-full");
  check(sample.check([{ name: "a", div: 1, bits: 5, data: new Uint8Array(8120) }]).ok, "8,120 bytes of steps fit");
  ["{", '{"samples":[]}', '{"samples":[{"name":"1x","data":"AA=="}]}',
   '{"samples":[{"name":"a","div":5,"data":"AA=="}]}', '{"samples":[{"name":"a","bits":6,"data":"AA=="}]}',
   '{"samples":[{"name":"a","data":"/w=="}]}'].forEach((t, i) => {
    let code = null; try { sample.parse(t); } catch (e) { code = e.code; }
    check(!!code, "a bad samples.json (" + i + ") is refused with a code (" + code + ")");
  });
  let c = null; try { sample.parseWav(new Uint8Array(60)); } catch (e) { c = e.code; }
  eq("not a WAV: sample-wav", c, "sample-wav");
}

/* ---- 2. the browser ------------------------------------------------------------------------ */
const files = ["samples.json", "song.json"].map((n) => ({ name: n, source: read(n) }));
const songs = seq.songsFromFiles(files);
function run(make, src, frames) {
  const rt = make(src, { chunkName: "t.lua", files, songs, budgetMs: 250 });
  rt.load();
  for (let k = 0; k < frames; k++) rt.frame(k);
  return rt;
}
function steps(events) {     /* R6 writes while the selected channel is in DDA mode with the channel on */
  const ctl = [0, 0, 0, 0, 0, 0]; let sel = 0; const out = [];
  events.forEach((e) => {
    if (e.reg === 0) sel = e.value & 7;
    else if (e.reg === 4 && sel < 6) ctl[sel] = e.value;
    else if (e.reg === 6 && sel < 6 && (ctl[sel] & 0xC0) === 0xC0) out.push(e.value);
  });
  return out;
}
const LOOP = read("main.lua"), ONCE = read("once.lua");
{
  const a = run(toys.create, LOOP, 125).sound.events.map((e) => [e.f, e.t, e.reg, e.value]);
  const b = run(il.create, LOOP, 125).sound.events.map((e) => [e.f, e.t, e.reg, e.value]);
  eq("the Lua runtime and the IL runtime write the same stream for the sample toy", a, b);
}
const once = run(il.create, ONCE, 90);
const thump = Array.from(list[0].data), click = Array.from(list[1].data);
const mine = steps(once.sound.events);
{
  const first = mine.slice(0, thump.length);
  eq("the first sample's steps are the sample's data, in order", first, thump);
  const rest = mine.slice(thump.length);
  const cutLen = rest.length - click.length;
  check(cutLen > 0 && cutLen < thump.length, "the thump cut by the click wrote " + cutLen + " steps");
  eq("the cut sample's steps are a prefix of its data", rest.slice(0, cutLen), thump.slice(0, cutLen));
  eq("the click that cut it plays whole", rest.slice(cutLen), click);
}
{
  /* the cadence: steps fall at the timer's period, 58 or 59 to a frame at 3,496 Hz */
  const ev = once.sound.events.filter((e) => e.f === 10 && e.reg === 6 && e.t > 4000);
  const ts = ev.map((e) => e.t);
  check(ev.length >= 56 && ev.length <= 59, "3,496 Hz writes " + ev.length + " steps in a frame");
  check(ts.every((t, i) => i === 0 || t - ts[i - 1] === sample.periodCycles(2)), "each step is one timer period (2,048 cycles) after the last");
  check(once.sound.events.every((e) => e.t >= 0 && e.t < sample.FRAME_CYCLES), "every write falls inside its frame");
}
{
  /* the music keeps playing: with the sample calls removed, channels 0..3 get the same writes */
  const stripped = ONCE.replace(/sample\([^)]*\)/g, "local z = 0");
  const chan = (events) => { let sel = 0; const out = []; events.forEach((e) => {
    if (e.reg === 0) sel = e.value & 7; else if (sel < 4 && e.reg >= 2 && e.reg <= 7) out.push([e.f, sel, e.reg, e.value]); }); return out; };
  const a = chan(run(il.create, ONCE, 90).sound.events), b = chan(run(il.create, stripped, 90).sound.events);
  check(a.length > 100, "the song writes to the four tonal channels (" + a.length + " writes)");
  eq("a sample on channels 4 and 5 leaves the song's writes on channels 0..3 as they were", a, b);
}
{
  /* the channel is taken and given back like sfx(): R4 goes to DDA, and after the hold the release writes land */
  const ev = once.sound.events.filter((e) => e.f >= 3);
  check(ev.some((e) => e.reg === 4 && e.value === (0xC0 | 31)), "the channel is switched to DDA mode (R4 = $DF)");
  check(sample.holdFrames(list[0]) === 20 && sample.framesFor(list[0]) === 19, "the thump holds its channel 20 frames (" + sample.holdFrames(list[0]) + ")");
}

/* ---- 3. the refusals ------------------------------------------------------------------------- */
function codeOf(make, src) { try { make(src, { chunkName: "t.lua", files, songs, budgetMs: 250 }).load(); const rt = make(src, { chunkName: "t.lua", files, songs, budgetMs: 250 }); rt.load(); rt.frame(0); } catch (e) { return e.code || e.name; } return null; }
eq("an unknown name: sample-name in the Lua runtime", codeOf(toys.create, 'function frame(t, f) sample("nope", 5) end'), "sample-name");
eq("an unknown name: il-sample in the IL", codeOf(il.create, 'function frame(t, f) sample("nope", 5) end'), "il-sample");
eq("channel 6: sample-range (Lua)", codeOf(toys.create, 'function frame(t, f) sample("thump", 6) end'), "sample-range");
eq("channel 6: sample-range (IL)", codeOf(il.create, 'function frame(t, f) sample("thump", 6) end'), "sample-range");
eq("an index past the list: sample-name", codeOf(il.create, "function frame(t, f) sample(2, 5) end"), "sample-name");
check(host_has("sample-name") && host_has("sample-range") && host_has("sample-file"), "the host's refusal table lists the sample codes");
function host_has(c) { return !!require("../renderer/pce-toyhost.js").REFUSALS[c]; }
{
  const rep = (src, o) => validate.validate(src, Object.assign({ chunkName: "t.lua", frames: 3, files, songs }, o || {}));
  const codes = (r) => (r.problems || []).map((p) => p.code);
  check(codes(rep(ONCE)).indexOf("validate-sample-native-only") >= 0, "the validator says the interpreter ROM does not carry sample()");
  check(!codes(rep(ONCE)).some((c) => /^validate-sample-(bank|timer|file)$/.test(c)), "the committed toy passes the sample budget");
  check(codes(rep('function frame(t, f) timer(5) sample("thump", 5) end')).indexOf("validate-sample-timer") >= 0, "sample() with timer(): validate-sample-timer");
  const big = JSON.stringify({ samples: Array.from({ length: 9 }, (_, i) => ({ name: "s" + i, div: 1, bits: 5, data: sample.toB64(new Uint8Array(10)) })) });
  const r9 = rep('function frame(t, f) sample("s0", 5) end', { files: [{ name: "samples.json", source: big }] });
  check(codes(r9).indexOf("validate-sample-bank") >= 0, "nine samples: validate-sample-bank");
  let got = null;
  try { ilbc.encode(il.compile(ONCE, { chunkName: "once.lua", files })); } catch (e) { got = e.code; }
  eq("the interpreter ROM refuses sample(): ilbc-sample", got, "ilbc-sample");
  check(!!ilbc.REFUSALS["ilbc-sample"] && !!validate.REFUSALS["validate-sample-bank"], "the refusal tables list ilbc-sample and validate-sample-bank");
}

/* ---- 4. the native ROM ---------------------------------------------------------------------- */
function ggmcp(args) {
  return spawnSync("python3", ["-I", path.join(ROOT, "tools", "ggmcp.py")].concat(args),
    { cwd: ROOT, encoding: "utf8", timeout: 240000, maxBuffer: 1 << 26 });
}
const gg = process.env.GEARGRAFX || "/Volumes/External II/pce-tools/geargrafx/app/Geargrafx.app/Contents/MacOS/geargrafx";
const llvm = [process.env.LLVM_MOS].concat(toolPaths.candidates.LLVM_MOS)
  .filter((r) => r && fs.existsSync(path.join(r, "bin", "mos-pce-clang")))[0];
const havePceas4 = spawnSync("bash", ["-c", "command -v pceas4 || test -x \"$PCEAS4\""]).status === 0 ||
  fs.existsSync(path.join(os.homedir(), ".local", "bin", "pceas4"));
if (!fs.existsSync(gg) || !llvm || !havePceas4) {
  skipped.push("Geargrafx, llvm-mos or PCEAS 4.x not found: the ROM part did not run");
} else {
  const scratch = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "sample-rom-"));
  const env = Object.assign({}, process.env, { TMPDIR: scratch, PSG_TRACE: "1", DDA_LOG: "1",
    PATH: path.join(os.homedir(), ".local", "bin") + ":" + process.env.PATH });
  let irqRange = { start: 0, size: 0 };
  function build(toy, name) {
    const nb = spawnSync("bash", [path.join(ROOT, "tools", "build-toyc-banked.sh"), "tools/toys/sample/" + toy, name],
      { cwd: ROOT, encoding: "utf8", env });
    check(nb.status === 0, name + ": the native trace build links (" + (nb.stderr || nb.stdout).trim().split("\n").slice(-1)[0] + ")");
    if (nb.status !== 0) return null;
    return { rom: path.join(ROOT, "tools", "gen", name + ".pce"), image: path.join(ROOT, "tools", "gen", name + ".eng", "hutrack-image.json") };
  }
  function stream(b, name) {      /* run it: the engine's log, the step log, the steps per frame */
    const nm = spawnSync(path.join(llvm, "bin", "llvm-nm"), [b.rom + ".elf"], { encoding: "utf8" }).stdout;
    const addr = (n) => parseInt((nm.match(new RegExp("^[0-9a-f]+ [A-Za-z] " + n + "$", "m")) || ["0 x"])[0].split(" ")[0], 16) & 0xFFFF;
    const log = addr("toy_dda_log"), ptr = addr("toy_dda_ptr");
    const nmS = spawnSync(path.join(llvm, "bin", "llvm-nm"), ["-S", b.rom + ".elf"], { encoding: "utf8" }).stdout;
    const im = nmS.match(/^([0-9a-f]+) ([0-9a-f]+) [A-Za-z] irq_timer$/m);
    irqRange = im ? { start: parseInt(im[1], 16) & 0xFFFF, size: parseInt(im[2], 16) } : { start: 0, size: 0 };
    check(irqRange.size > 20, name + ": irq_timer's size is in the ELF (" + irqRange.size + " bytes)");
    check(log > 0x2000 && ptr >= 0x2000 && ptr < 0x2080, name + ": the step log and its zero-page pointer are in the ELF (" + log.toString(16) + ", " + ptr.toString(16) + ")");
    const sh = (fs.readFileSync(path.join(b.image, "..", "hutrack-symbols.h"), "utf8").match(/HUTRACK_PSG_SEL\s+0x([0-9A-Fa-f]+)u/) || [])[1];
    check(!!sh, name + ": the engine was built with the channel-select shadow (HUTRACK_PSG_SEL)");
    const r = ggmcp([b.rom, "ddastream", b.image, "0x" + log.toString(16), "0x" + ptr.toString(16), "90", "0x" + sh]);
    check(r.status === 0, name + ": the ROM ran in Geargrafx (" + (r.stderr || "").trim().split("\n").slice(-1)[0] + ")");
    return r.status === 0 ? JSON.parse(r.stdout) : null;
  }
  function ddaChecks(got, model, name, irq) {
    eq(name + ": the engine's log reset ran (ok byte $A5)", got.ok, 0xA5);
    /* the interrupt puts the PSG's channel select back where the interrupted engine code had it: after every frame the
     * chip's select equals the engine's shadow (a frame ending between the engine's two stores can differ: a few at most) */
    const inIrq = (pc) => pc >= irq.start && pc < irq.start + irq.size;
    const seen = got.selects.filter((p, i) => got.ptr_per_frame[i] > got.ptr_per_frame[0] && !inIrq(p[2]));   /* once a sample has run, outside the handler itself */
    const bad = seen.filter((p) => p[0] !== p[1]).length;
    check(seen.length >= 30 && bad === 0, name + ": the chip's channel select equals the engine's in " + (seen.length - bad) + " of " + seen.length + " frames (" + (got.selects.length - seen.length) + " paused inside the handler or before a sample)");
    const dda = got.dda;
    eq(name + ": the interrupt wrote the whole first thump, step for step the browser's", dda.slice(0, thump.length), thump);
    const rest = dda.slice(thump.length), cut = rest.length - click.length;
    check(cut > 0 && cut < thump.length, name + ": the thump cut by the click wrote " + cut + " steps on the console (the browser models " + (model.length - thump.length - click.length) + ")");
    eq(name + ": the cut thump is a prefix of the sample", rest.slice(0, cut), thump.slice(0, cut));
    eq(name + ": the click plays whole", rest.slice(cut), click);
    const perFrame = got.ptr_per_frame.map((p, i, a) => i ? p - a[i - 1] : 0).filter((n) => n > 0);
    check(perFrame.length > 15 && perFrame.filter((n) => n >= 57 && n <= 59).length >= 15,
          name + ": the console writes 57..59 steps a frame at 3,496 Hz (" + perFrame.slice(0, 8).join(",") + "...)");
  }

  /* A: the song plays on channels 0..5 and two samples take 5 and 4 */
  const A = build("once.lua", "sample-music");
  if (A) {
    const got = stream(A, "with music");
    if (got) ddaChecks(got, mine, "with music", irqRange);
    const pf = ggmcp([A.rom, "psgframes", A.image, "75"]);
    check(pf.status === 0, "with music: Geargrafx stepped the sample ROM frame by frame");
    if (pf.status === 0) {
      const gotS = JSON.parse(pf.stdout);
      const ch = [0, 1, 2, 3, 4, 5].map(() => ({ fl: 0, fh: 0, ctl: 0 })); let sel = 0, k = 0; const want = [];
      const ev = once.sound.events;
      for (let f = 0; f < 75; f++) {
        while (k < ev.length && ev[k].f <= f) {
          const e = ev[k++];
          if (e.reg === 0) sel = e.value & 7;
          else if (sel < 6 && e.reg === 2) ch[sel].fl = e.value;
          else if (sel < 6 && e.reg === 3) ch[sel].fh = e.value & 15;
          else if (sel < 6 && e.reg === 4) ch[sel].ctl = e.value;
        }
        want.push(ch.map((c) => ({ freq: c.fl | (c.fh << 8), en: (c.ctl & 0x80) ? 1 : 0 })));
      }
      let compared = 0, equal = 0;
      Object.keys(gotS).forEach((key) => {
        const tf = +key; if (tf < 1 || tf >= 75) return;
        compared++;
        const st = gotS[key], w = want[tf]; let ok = true;
        for (let c = 0; c < 4; c++) { if (st[c][1] !== w[c].en) ok = false; else if (st[c][1] && st[c][0] !== w[c].freq) ok = false; }
        if (ok) equal++;
      });
      check(compared >= 40, "with music: " + compared + " toy frames compared");
      eq("with music: while samples play on channels 5 and 4 the song's four tonal channels equal the studio's in every frame", equal, compared);
    }
  }

  /* B: no song, so the engine's log is the whole story: the reserve, the square upload and the release */
  const B = build("stream.lua", "sample-stream");
  if (B) {
    const got = stream(B, "no music");
    if (got) {
      const model = run(il.create, read("stream.lua"), 90);
      ddaChecks(got, steps(model.sound.events), "no music", irqRange);
      /* the studio's stream minus each DDA step's (R0, R6) pair and the setup's (R0, R4 = $DF) pair, which the C side
       * and the interrupt write and the engine's log does not carry */
      const studio = [], evs = model.sound.events;
      for (let i = 0; i < evs.length; i++) {
        const e = evs[i], nx = evs[i + 1];
        if (e.reg === 0 && nx && ((nx.reg === 6 && nx.t === e.t + 6) || (nx.reg === 4 && nx.value === 0xDF))) { i++; continue; }
        studio.push([e.f, e.reg, e.value]);
      }
      const nat = got.events.filter((e) => e[0] < 80), cmp = studio.filter((e) => e[0] < 80);
      let first = -1;
      for (let i = 0; i < Math.max(nat.length, cmp.length); i++) if (JSON.stringify(nat[i]) !== JSON.stringify(cmp[i])) { first = i; break; }
      check(first < 0 && nat.length > 100, "no music: the engine's own " + nat.length + " writes (reserve, upload, release) are the studio's, write for write" +
            (first < 0 ? "" : " - first difference at " + first + ": got " + JSON.stringify(nat[first]) + " want " + JSON.stringify(cmp[first])));
    }
  }
}

if (skipped.length) skipped.forEach((s) => console.log("SKIP  " + s));
console.log(failures.length ? "check-sample: " + failures.length + " FAILED of " + checks : "check-sample: " + checks + " checks pass");
process.exit(failures.length ? 1 : 0);
