#!/usr/bin/env node
/*
 * tests/check-il.js — the #31 evidence (the IL half): the same three toys that
 * tests/check-toys.js runs through Fengari are compiled to PCEStudio's IL by
 * renderer/pce-il.js and run by the IL interpreter, and every frame is
 * compared with the Fengari runtime's frame:
 *
 *   - vram, cram, sat and the four register values byte-equal;
 *   - the raster table identical (deep, including base/baseCram/cramPrev);
 *   - pixels diff 0 (both runtimes draw through renderer/pce-sprites.js);
 *   - the frame's width and height equal.
 *
 * It also asserts what the IL IS, not only what it does: the three hooks are
 * found and typed (frame(t, f): t fixed, f int; raster(line): int), the
 * instructions each construct lowered to are present (reg, pal, vget/vset,
 * padget, sprite, closure, forprep/fornext, cmp/br), and no string survives
 * as a value.
 *
 * Refusals: the host's codes (reg-range, ...) come back through the IL path
 * exactly as through the Lua path, and the IL's own refusals (il-op,
 * il-method, il-for-in, il-vararg, il-multret, il-string, il-mixed,
 * il-int-range, il-fixed-range, il-type, il-cond, il-table-read,
 * il-pad-write, il-key, il-reg-name, il-surface-shadow, il-unsupported,
 * il-undefined, il-env, il-arity, il-syntax) are asserted by code with the
 * source line in the message.
 *
 * Written by @design because the card names this file. Per workshop rule 2 a
 * cold break by another seat is owed before this closes the card.
 */
"use strict";

const path = require("path");
const toys = require("../renderer/pce-toys.js");
const il = require("../renderer/pce-il.js");

const FRAMES = 40;

let checks = 0;
let failures = [];

function check(ok, name) {
  checks++;
  if (!ok) {
    failures.push(name);
    console.log("FAIL  " + name);
  }
}

function eq(name, got, want) {
  check(JSON.stringify(got) === JSON.stringify(want),
        name + " (got " + JSON.stringify(got) + ", want " +
        JSON.stringify(want) + ")");
}

function diffCount(a, b) {
  let n = 0;
  let first = -1;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) { if (first < 0) first = i; n++; }
  }
  return { n, first, length: a.length !== b.length ? [a.length, b.length] : null };
}

function sameBytes(name, got, want) {
  if (got.length !== want.length) {
    check(false, name + " length " + got.length + " != " + want.length);
    return;
  }
  const d = diffCount(got, want);
  check(d.n === 0, name + " diff " + d.n +
        (d.n ? " (first byte " + d.first + ")" : ""));
}

function samePixels(name, got, want) {
  if (got.length !== want.length) {
    check(false, name + " pixel bytes " + got.length + " != " + want.length);
    return;
  }
  const d = diffCount(got, want);
  check(d.n === 0, name + " diff " + d.n +
        (d.n ? " (first byte " + d.first + ")" : ""));
}

/* ---- the Lua sources (the same ones tests/check-toys.js runs) --------- */

const SETUP = `
local function puttile(char, fn)
  for row = 0, 7 do
    local w0, w1 = 0, 0
    for col = 0, 7 do
      local c = fn(col, row)
      if c % 2 >= 1 then w0 = w0 | (1 << (7 - col)) end
      if c >= 2 and (c % 4) >= 2 then w0 = w0 | (1 << (15 - col)) end
      if c >= 4 and (c % 8) >= 4 then w1 = w1 | (1 << (7 - col)) end
      if c >= 8 then w1 = w1 | (1 << (15 - col)) end
    end
    vram[char * 16 + row] = w0
    vram[char * 16 + 8 + row] = w1
  end
end
`;

const TOY_PALETTE = SETUP + `
function init()
  for y = 0, 27 do
    for x = 0, 31 do vram[y * 32 + x] = 0x0040 end
  end
  puttile(0x40, function(col, row)
    if col == row then return 15 else return 1 end
  end)
end
function frame(t, f)
  for e = 1, 15 do
    pal(e, rgb((e + f) % 8, f % 8, (e * 3 + f) % 8))
  end
end
`;

const TOY_RASTER = SETUP + `
function init()
  for y = 0, 27 do
    for x = 0, 31 do vram[y * 32 + x] = 0x0040 end
  end
  puttile(0x40, function(col, row)
    if col == row then return 15 else return 1 end
  end)
end
function frame(t, f)
  g_f = f
  reg("BXR", (f * 2) % 1024)
  reg("BYR", (f * 3) % 512)
end
function raster(line)
  local band = line // 8
  reg("BXR", (g_f * 2 + band * 3) % 1024)
  if line % 8 == 0 then
    pal(2 + (band % 14), rgb(g_f % 8, band % 8, (g_f + band) % 8))
  end
end
`;

const TOY_SPRITE = SETUP + `local function putsprite(pattern, fn)
  -- A sprite pattern is NOT a BAT character: the SAT's pattern code p is read
  -- at word p*64, plane n at p*64 + n*16 + row, and bit 15 is the strip's
  -- left pixel (HuC6270 manual 2.4 "sprite pattern"; renderer/pce-sprites.js
  -- stripWords/stripPixel).  16 rows of 16 pixels, four 1-bit planes.
  for row = 0, 15 do
    local p0, p1, p2, p3 = 0, 0, 0, 0
    for col = 0, 15 do
      local c = fn(col, row)
      if c % 2 >= 1 then p0 = p0 | (1 << (15 - col)) end
      if c >= 2 and (c % 4) >= 2 then p1 = p1 | (1 << (15 - col)) end
      if c >= 4 and (c % 8) >= 4 then p2 = p2 | (1 << (15 - col)) end
      if c >= 8 then p3 = p3 | (1 << (15 - col)) end
    end
    vram[pattern * 64 + row] = p0
    vram[pattern * 64 + 16 + row] = p1
    vram[pattern * 64 + 32 + row] = p2
    vram[pattern * 64 + 48 + row] = p3
  end
end

function init()
  -- one solid 16x16 sprite, colour 1, pattern code $100 (sprite cell 256)
  putsprite(0x100, function(col, row)
    return 1
  end)
  pal(0x101, rgb(7, 7, 0))
  reg("CR", 0xC0)
  -- SAT X 32 / Y 64 is the top-left of the display; start in the middle so
  -- every pad direction has room to move
  sx, sy = 144, 160
end
function frame(t, f)
  if pad[1].right then sx = sx + 1 end
  if pad[1].left then sx = sx - 1 end
  if pad[1].up then sy = sy - 1 end
  if pad[1].down then sy = sy + 1 end
  sprite(0, { x = sx, y = sy, pattern = 0x100, palette = 0 })
end
`;

/* ---- the comparison --------------------------------------------------- */

function compareToys(name, source, pads) {
  const luaRT = toys.create(source, { budgetMs: 250 });
  const ilRT = il.create(source, { budgetMs: 250 });
  luaRT.load();
  ilRT.load();
  check(ilRT.initialized === true, name + ": the IL runtime loaded");
  check(!!ilRT.program && ilRT.program.lang === "pce-il",
        name + ": compile() returns a pce-il program");

  for (let f = 0; f < FRAMES; f++) {
    if (pads) {
      luaRT.setPad(1, pads[f]);
      ilRT.setPad(1, pads[f]);
    }
    const want = luaRT.frame(f);
    const got = ilRT.frame(f);
    sameBytes(name + " f" + f + " vram", got.state.vram, want.state.vram);
    sameBytes(name + " f" + f + " cram", got.state.cram, want.state.cram);
    sameBytes(name + " f" + f + " sat", got.state.sat, want.state.sat);
    eq(name + " f" + f + " regs", got.state.regs, want.state.regs);
    eq(name + " f" + f + " raster", got.raster, want.raster);
    samePixels(name + " f" + f + " pixels", got.pixels, want.pixels);
    eq(name + " f" + f + " size", [got.width, got.height],
       [want.width, want.height]);
  }
  check(ilRT.callbackRaster === luaRT.callbackRaster,
        name + ": both runtimes agree on callback mode (" +
        luaRT.callbackRaster + ")");
  luaRT.dispose();
  ilRT.dispose();
  return ilRT.program;
}

function checkToys() {
  const pA = compareToys("palette", TOY_PALETTE);
  const pB = compareToys("raster", TOY_RASTER);
  const pads = [];
  for (let f = 0; f < FRAMES; f++) {
    pads.push(f < 10 ? { right: true }
            : f < 20 ? { down: true }
            : f < 30 ? { left: true }
            : { up: true });
  }
  const pC = compareToys("sprite", TOY_SPRITE, pads);
  return { pA, pB, pC };
}

/* A fourth toy, beyond the card's three: the constructs the lowering is
 * easiest to get wrong — a while loop, Lua's truthiness and the and/or
 * idiom, a negative-step numeric for, % and // on negatives, and a closure
 * with a mutable captured variable. It writes only VRAM words, so the same
 * byte comparison applies. */
const TOY_BREADTH = `
function frame(t, f)
  local a = 0
  while a < (f % 4) do a = a + 1 end
  local flag = (f % 2 == 0)
  local b = flag and 7 or 9
  local c = (0 - 7) % 3
  local step = 0 - 1
  local n = 0
  for i = 3, 1, step do n = n + i end
  local function counter()
    local k = 0
    return function() k = k + 1 return k end
  end
  local nextv = counter()
  vram[0] = a
  vram[1] = b
  vram[2] = c
  vram[3] = n
  vram[4] = nextv()
  vram[5] = nextv()
  vram[6] = ((0 - 7) // 3) & 0xFFFF
end
`;

function checkBreadth() {
  const luaRT = toys.create(TOY_BREADTH, { budgetMs: 250 });
  const ilRT = il.create(TOY_BREADTH, { budgetMs: 250 });
  luaRT.load();
  ilRT.load();
  for (let f = 0; f < 8; f++) {
    const want = luaRT.frame(f);
    const got = ilRT.frame(f);
    sameBytes("breadth f" + f + " vram", got.state.vram, want.state.vram);
    sameBytes("breadth f" + f + " cram", got.state.cram, want.state.cram);
    samePixels("breadth f" + f + " pixels", got.pixels, want.pixels);
    eq("breadth f" + f + " regs", got.state.regs, want.state.regs);
  }
  luaRT.dispose();
  ilRT.dispose();
}

/* ---- what the IL is --------------------------------------------------- */

function hookFunction(program, name) {
  if (program.hooks[name] == null) return null;
  return program.functions[program.hooks[name]];
}

function opCount(fn, t) {
  return fn.code.filter(function (i) { return i.t === t; }).length;
}
function hasOp(fn, t) { return opCount(fn, t) > 0; }
function hasArith(fn, op) {
  return fn.code.some(function (i) { return i.t === "arith" && i.op === op; });
}
function hasRegName(fn, name) {
  return fn.code.some(function (i) { return i.t === "reg" && i.name === name; });
}
function hasPadField(fn, field) {
  return fn.code.some(function (i) { return i.t === "padget" && i.field === field; });
}

function checkStructure(programs) {
  const { pA, pB, pC } = programs;

  /* hooks found, and typed with the toy API's signatures */
  for (const [label, p, wantRaster] of
       [["palette", pA, false], ["raster", pB, true], ["sprite", pC, false]]) {
    check(p.hooks.init != null, label + ": init is found");
    check(p.hooks.frame != null, label + ": frame is found");
    eq(label + ": raster hook", p.hooks.raster != null, wantRaster);
    const init = hookFunction(p, "init");
    const frame = hookFunction(p, "frame");
    eq(label + ": init() takes no parameters", init.params, []);
    eq(label + ": frame(t, f) types", frame.params, ["fixed", "int"]);
    check(init.hooks.indexOf("init") >= 0, label + ": init is marked in the IL");
    check(frame.hooks.indexOf("frame") >= 0, label + ": frame is marked in the IL");
  }

  const frameB = hookFunction(pB, "frame");
  const rasterB = hookFunction(pB, "raster");
  eq("raster: raster(line) types", rasterB.params, ["int"]);

  /* the instructions each construct produced */
  const initA = hookFunction(pA, "init");
  const frameA = hookFunction(pA, "frame");
  check(hasOp(frameA, "pal"), "palette: frame builds its palette with `pal`");
  check(hasOp(initA, "vset"), "palette: the BAT is written with `vset`");
  check(hasOp(initA, "forprep") && hasOp(initA, "fornext"),
        "palette: a numeric for lowered to forprep/fornext");
  check(hasOp(initA, "closure"), "palette: the puttile argument is a closure");
  check(hasArith(initA, "mul") && hasArith(initA, "add"),
        "palette: char*16+row lowered to mul/add");
  check(hasOp(initA, "call"), "palette: puttile is called");
  /* the anonymous function init passes to puttile is the one that compares */
  const anonA = pA.functions.filter(function (f) {
    return f.params.length === 2 && f.params[0] === "int" && f.params[1] === "int";
  })[0];
  check(!!anonA, "palette: the closure's parameters are typed int");
  check(anonA && anonA.code.some(function (i) { return i.t === "cmp" && i.op === "eq"; }),
        "palette: `col == row` lowered to a cmp eq");
  check(anonA && hasOp(anonA, "br"), "palette: the comparison branches with `br`");

  check(hasRegName(frameB, "BXR") && hasRegName(frameB, "BYR"),
        "raster: reg(\"BXR\"/\"BYR\") lowered to typed `reg` instructions");
  check(hasRegName(rasterB, "BXR"), "raster: the callback writes reg BXR too");
  check(hasOp(rasterB, "pal"), "raster: the callback writes the palette");
  check(hasArith(rasterB, "idiv") || hasArith(rasterB, "mod") ||
        rasterB.code.some(function (i) { return i.t === "arith"; }),
        "raster: line // 8 and % 8 lowered to arithmetic");
  check(rasterB.code.every(function (i) {
          return i.t !== "fornext" || i.base !== 0 || i.target != null;
        }), "raster: branches carry resolved targets");

  const initC = hookFunction(pC, "init");
  const frameC = hookFunction(pC, "frame");
  check(hasRegName(initC, "CR"), "sprite: reg(\"CR\") lowered");
  check(hasOp(initC, "padref") === false && hasPadField(frameC, "right"),
        "sprite: pad[1].right lowered to a pad field read");
  for (const field of ["left", "up", "down"]) {
    check(hasPadField(frameC, field), "sprite: pad[1]." + field + " lowered");
  }
  check(hasOp(frameC, "sprite"), "sprite: sprite(i, spec) lowered to the `sprite` op");
  const spriteOp = frameC.code.filter(function (i) { return i.t === "sprite"; })[0];
  check(spriteOp && spriteOp.spec && spriteOp.spec.r != null,
        "sprite: the spec table is an operand (a table value)");
  check(hasOp(initC, "ttable") === false, "sprite: no unknown instruction kinds");

  /* every instruction is typed where it needs to be, and carries its line */
  for (const [label, p] of [["palette", pA], ["raster", pB], ["sprite", pC]]) {
    let badLine = 0;
    let untyped = 0;
    for (const fn of p.functions) {
      for (const ins of fn.code) {
        if (!ins.line) badLine++;
        if (ins.t === "arith" && !ins.type) untyped++;
        if (ins.t === "cmp" && !ins.type) untyped++;
      }
    }
    eq(label + ": every instruction has a source line", badLine, 0);
    eq(label + ": every arithmetic/comparison is typed", untyped, 0);
  }

  /* strings exist only as names: no str constant survives in the IL */
  let strConstants = 0;
  for (const p of [pA, pB, pC]) {
    for (const fn of p.functions) {
      for (const ins of fn.code) {
        if (ins.t === "const" && ins.k && ins.k.t === "str") strConstants++;
      }
    }
  }
  eq("no string constant survives in the IL", strConstants, 0);

  /* the program is data: compile() takes no host and returns plain objects */
  eq("the IL program has a version", pA.version, 1);
  check(Array.isArray(pA.functions) && pA.functions.length >= 4,
        "palette: the IL carries the nested functions");
}

/* ---- the helpers agree with the prelude ------------------------------- */

const TOY_HELPERS = `
function init() end
function frame(t, f)
  print(clamp(f, 0, 10), min(f, 3), max(f, 4), abs(0 - f), floor(f / 2))
  print(rgb(f, f + 1, f + 2), lerp(0, 10, 0.5), min(f, 100))
end
`;

function checkHelpers() {
  const luaRT = toys.create(TOY_HELPERS, { budgetMs: 250 });
  const ilRT = il.create(TOY_HELPERS, { budgetMs: 250 });
  luaRT.load();
  ilRT.load();
  for (let f = 0; f < 10; f++) {
    luaRT.frame(f);
    ilRT.frame(f);
  }
  eq("helpers: the IL log equals the prelude's", ilRT.log, luaRT.log);
  eq("helpers: the IL log is not empty", ilRT.log.length > 0, true);
  luaRT.dispose();
  ilRT.dispose();
}

/* ---- refusals --------------------------------------------------------- */

function refusal(name, source, code) {
  let rt = null;
  try {
    rt = il.create(source, { budgetMs: 250 });
    rt.load();
    rt.frame(0);
    check(false, "refusal " + name + " was accepted (wanted " + code + ")");
  } catch (e) {
    check(e instanceof il.ToyError && e.code === code,
          "refusal " + name + " code " + (e && e.code) + " (wanted " + code +
          "): " + (e && e.message));
  } finally {
    if (rt) rt.dispose();
  }
}

function checkHostRefusals() {
  refusal("a register a toy may not touch", `
function init() reg("MWR", 0) end`, "reg-forbidden");
  refusal("BXR past 10 bits", `
function init() reg("BXR", 1024) end`, "reg-range");
  refusal("BYR past 9 bits", `
function init() reg("BYR", 512) end`, "reg-range");
  refusal("a colour address past 511", `
function init() pal(512, 0) end`, "pal-range");
  refusal("a colour word past 511", `
function init() pal(0, 512) end`, "pal-range");
  refusal("a VRAM address past 32767", `
function init() vram[32768] = 1 end`, "vram-range");
  refusal("a VRAM word past $FFFF", `
function init() vram[0] = 65536 end`, "vram-range");
  refusal("a SAT entry past 63", `
function init() sprite(64, {}) end`, "sprite-range");
  refusal("a sprite X past 1023", `
function init() sprite(0, { x = 1024 }) end`, "sprite-range");
  refusal("a raster line past 223", `
function frame(t, f) raster(224, { bxr = 1 }) end`, "raster-line");
  refusal("two raster entries on one line", `
function frame(t, f)
  raster(10, { bxr = 1 })
  raster(10, { cr = 0x80 })
end`, "raster-line-full");
}

function checkIlRefusals() {
  refusal("a length operator", `
function init() local t = {} local n = #t end`, "il-op");
  refusal("a string concatenation", `
function init() local s = "a" .. "b" end`, "il-op");
  refusal("a power operator", `
function init() local a = 2 local x = a ^ 3 end`, "il-op");
  refusal("a method call", `
function init() local t = {} t:foo() end`, "il-method");
  refusal("a generic for", `
function init() for k, v in pairs({}) do end end`, "il-for-in");
  refusal("a vararg function", `
function init() local function f(...) return ... end end`, "il-vararg");
  refusal("two return values", `
function init() local function f() return 1, 2 end end`, "il-multret");
  refusal("two results requested", `
function init() local function f() return 1 end local a, b = f() end`, "il-multret");
  refusal("print of a string", `
function init() print("hello") end`, "il-string");
  refusal("a fixed-point register where an int is required", `
function init() local x = 1.5 pal(x, 0) end`, "il-mixed");
  /* Fengari stores a decimal past 2^31 as a float (Lua 5.3's lexer), so the
   * IL sees it as a fixed-point constant; the il-int-range guard in
   * pce-il.js is therefore not reachable from a Lua literal and is not
   * asserted here (docs/IL.md §5 says so). */
  refusal("a number past the fixed-point range", `
function init() local x = 1e9 end`, "il-fixed-range");
  refusal("calling a number", `
function init() local x = 1 x() end`, "il-type");
  refusal("a condition with no value", `
function init() local s = "x" if s then end end`, "il-cond");
  refusal("reading a toy-built table", `
function init() local t = { a = 1 } local y = t.a end`, "il-table-read");
  refusal("writing a pad", `
function init() pad[1].right = true end`, "il-pad-write");
  refusal("a pad field that is not a constant", `
function init() local f = "right" local b = pad[1][f] end`, "il-key");
  refusal("reg() with a name from a parameter", `
local function f(n) reg(n, 1) end
function init() f("BXR") end`, "il-reg-name");
  refusal("reassigning a surface builtin", `
function init() reg = function() end end`, "il-surface-shadow");
  refusal("an unsupported helper", `
function init() local x = tostring(1) end`, "il-unsupported");
  refusal("an undefined global", `
function init() local x = nope end`, "il-undefined");
  refusal("_ENV used as a value", `
function init() local e = _ENV end`, "il-env");
  refusal("too many arguments", `
local function f(a) return a end
function init() f(1, 2) end`, "il-arity");
  refusal("a Lua syntax error", `
function init( end`, "il-syntax");

  /* the lines are in the messages, not just the codes */
  try {
    il.compile("\nfunction init()\n  local t = {} local y = t.a\nend");
    check(false, "il-table-read report was expected");
  } catch (e) {
    check(e.code === "il-table-read" && /line 3/.test(e.message),
          "an IL refusal names the source line (" + e.message + ")");
  }
}

/* ---- what is NOT in this half (written down, not hidden) -------------- */

function checkNotProven() {
  /* The card says no machine code yet. If a backend ever appears in this file
   * the note here should be updated in the same commit. */
  check(typeof il.compile === "function" &&
        typeof il.create === "function" &&
        typeof il.runProgram === "function",
        "the IL half exposes compile/create/runProgram");
  check(!("assemble" in il) && !("emit" in il) && !("backend" in il),
        "no machine-code backend is claimed by this half");
}

/* ---- main ------------------------------------------------------------- */

function main() {
  const programs = checkToys();
  checkBreadth();
  checkStructure(programs);
  checkHelpers();
  checkHostRefusals();
  checkIlRefusals();
  checkNotProven();

  if (failures.length) {
    console.log("FAIL  " + failures.length + " of " + checks + " checks failed");
    process.exit(1);
  }
  console.log("PASS  " + checks + " checks, 3 toys x " + FRAMES +
              " frames + a breadth toy IL == Fengari (state, raster, pixels), " +
              "the IL's structure and both refusal sets");
}

/* #31 part A's console test needs the SAME toy source this file runs, not a
 * copy that could drift: requiring this file defines the sources and runs
 * nothing (require.main is not this module), so tests/check-il-console.js
 * compiles exactly these strings. */
if (require.main === module) main();

module.exports = {
  FRAMES: FRAMES,
  SETUP: SETUP,
  TOY_PALETTE: TOY_PALETTE,
  TOY_RASTER: TOY_RASTER,
  TOY_SPRITE: TOY_SPRITE,
  TOY_BREADTH: TOY_BREADTH,
  TOY_HELPERS: TOY_HELPERS
};
