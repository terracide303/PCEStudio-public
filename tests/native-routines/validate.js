#!/usr/bin/env node
/*
 * tests/native-routines/validate.js — do the Lua ports reproduce what the real routines did?
 *
 *   node tests/native-routines/validate.js [VECTOR_DIR]      (default $TMPDIR/rb)
 *
 * The vectors are inputs and outputs read from an instruction trace of the real game running in an emulator
 * (tools/bench-routine.py trace: a load's value is the next trace line's register, a store's value the register on
 * its line).  They are NOT in the repository (they stay in scratch); this script only replays them: it cuts each
 * fixture's routine out between its ROUTINE-BEGIN / ROUTINE-END lines, runs it in the studio's own runtime
 * (renderer/pce-toys.js) with the captured inputs, and compares the sprite-list words (or the product) it produces
 * with the captured outputs.  Prints one line per routine: calls replayed and calls that disagreed.
 */
"use strict";
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..", "..");
const toys = require(ROOT + "/renderer/pce-toys.js");
const dir = process.argv[2] || path.join(process.env.TMPDIR || "/tmp", "rb");
const rd = (n) => JSON.parse(fs.readFileSync(path.join(dir, n + ".json"), "utf8")).calls;

function routine(name) {
  const s = fs.readFileSync(path.join(__dirname, name, "main.lua"), "utf8");
  const a = s.indexOf("-- ROUTINE-BEGIN"), b = s.indexOf("-- ROUTINE-END");
  return s.slice(a, b);
}
const ZEROS = "{ 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0 }";
function run(src) {
  const t = toys.create(src, { budgetMs: 2000 });
  t.load(); t.frame(0);
  const sat = t.state.sat;
  const w = (i, k) => sat[(i * 4 + k) * 2] | (sat[(i * 4 + k) * 2 + 1] << 8);
  return { w: w, log: t.log };
}
const results = [];
function report(name, n, bad, note) { results.push(name + ": " + (n - bad) + " of " + n + " calls reproduced" + (note ? " (" + note + ")" : "")); }

/* word written to the VDC data port: low byte on $0002, high byte on $0003 */
function vdcWords(c) {
  const out = [], v = c.writes.filter((x) => x[0] === 2 || x[0] === 3);
  for (let i = 0; i + 1 < v.length; i += 2) out.push(v[i][1] | (v[i + 1][1] << 8));
  return out;
}

(function klaxY() {
  const calls = rd("k1"); let bad = 0;
  calls.forEach((c) => {
    const y = c.reads[0][1], want = vdcWords(c)[0];
    const r = run(routine("klax-y-word") + "oy = " + ZEROS + "\nfunction frame(t, f) oy[1] = " + y + " put_y(1) end\n");
    if (r.w(1, 0) !== want) bad++;
  });
  report("game A routine 1 (Y word)", calls.length, bad);
})();
(function klaxX() {
  const calls = rd("k2"); let bad = 0;
  calls.forEach((c) => {
    const fl = c.reads[0][1], x = c.reads[1][1], want = vdcWords(c)[0];
    const r = run(routine("klax-x-word") + "ox = " + ZEROS + "\nofl = " + ZEROS + "\nfunction frame(t, f) ox[1] = " + x + " ofl[1] = " + fl + " put_x(1) end\n");
    if (r.w(1, 1) !== want) bad++;
  });
  report("game A routine 2 (X word)", calls.length, bad);
})();
(function klaxP() {
  const calls = rd("k3"); let bad = 0;
  calls.forEach((c) => {
    const p = c.reads[0][1], want = vdcWords(c)[0];
    const r = run(routine("klax-pattern-word") + "opat = " + ZEROS + "\nfunction frame(t, f) opat[1] = " + p + " put_pat(1) end\n");
    if (r.w(1, 2) !== want) bad++;
  });
  report("game A routine 3 (pattern word)", calls.length, bad);
})();
(function blazing() {
  const calls = rd("b1"); let bad = 0;
  calls.forEach((c) => {
    const y = c.reads[0][1], x = c.reads[1][1], a = c.reads[2][1], want = vdcWords(c);
    const r = run(routine("blazing-sprite") + "oy = " + ZEROS + "\nox = " + ZEROS + "\noa = " + ZEROS +
      "\nfunction frame(t, f) oy[1] = " + y + " ox[1] = " + x + " oa[1] = " + a + " put_sprite(1) end\n");
    for (let k = 0; k < 4; k++) if (r.w(1, k) !== want[k]) { bad++; break; }
  });
  report("game C routine 1 (4-word sprite)", calls.length, bad);
})();
(function mul() {
  const calls = rd("s1"); let bad = 0, n = 0;
  calls.forEach((c) => {
    const a = c.regs[0], b = c.regs[2];
    if (b === 0) return;                       /* the zero-multiplier path is a different routine */
    n++;
    const r = run(routine("sss-multiply") + "function frame(t, f) print(mul8(" + a + ", " + b + ")) end\n");
    const got = +r.log[0], hi = c.regs_out[0];
    if ((got >> 8) !== hi) bad++;
  });
  report("game B routine 1 (8x8 multiply, high byte)", n, bad);
})();
(function meta() {
  const calls = rd("s2"); let bad = 0, n = 0;
  calls.forEach((c) => {
    const ind = c.reads.filter((x) => x[0] === -1).map((x) => x[1]);
    const cnt = ind[2], data = ind.slice(3, 3 + 8 * cnt);
    if (!cnt || data.length < 8 * cnt) return;
    const words = vdcWords(c).slice(1);           /* the first word pair is the address register */
    /* the offsets are added with ADC/EOR from zero page, which the trace does not show as a load: take them from the
     * FIRST entry (output minus table word) and let every further entry of the call check that the same offset applies */
    const w16 = (i) => data[i] | (data[i + 1] << 8);
    if (words.length < 4) return;
    const yo = (words[0] - w16(0)) & 65535, xo = (words[1] - w16(2)) & 65535, fl = words[3] ^ w16(6);
    const slot = (c.writes.find((x) => x[0] === 2)[1]) / 4;
    if (cnt > 8 || words.length < 4 * cnt) return;
    n++;
    const ms = "{ " + data.concat(new Array(64 - data.length).fill(0)).join(",") + " }";
    const src = routine("sss-metasprite").replace("function expand", "function expand") +
      "ms = " + ms + "\nyo = " + yo + "\nxo = " + xo + "\nfl = " + fl + "\nfunction frame(t, f) expand(" + slot + ", " + cnt + ") end\n";
    const r = run(src);
    for (let e = 0; e < cnt; e++) for (let k = 0; k < 4; k++) if (r.w(slot + e, k) !== words[e * 4 + k]) { bad++; e = cnt; break; }
  });
  report("game B routine 2 (meta-sprite expander)", n, bad);
})();
console.log(results.join("\n"));
process.exit(results.some((r) => !/^.*: (\d+) of \1 calls/.test(r)) ? 1 : 0);
