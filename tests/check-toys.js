#!/usr/bin/env node
/*
 * tests/check-toys.js — the #30 evidence: three small toys run headlessly for
 * N frames, and every frame's picture and hardware state is compared with the
 * same state built by hand and drawn by the SAME model
 * (renderer/pce-sprites.js over renderer/pce-bg.js), diff 0.
 *
 *   toy A  palette cycling   (no raster table)
 *   toy B  scrolling with raster(line)  (the per-line callback form)
 *   toy C  a sprite reading pad[1]      (the SAT + input)
 *
 * plus the refusals the card names — a value out of range, a register a toy
 * may not touch, too many raster entries on a line — the password helpers,
 * the sandbox doors, and a timeout.
 *
 * The expected states are built here, in JavaScript, from each toy's written
 * specification (below), NOT by reading the runtime's own state: the runtime
 * has to land the toy's writes in the model's input arrays, and then the
 * model has to draw them. The comparison is therefore
 *   runtime frame  ==  sprites.renderFrame(hand-built state)   (diff 0)
 * and the two states are compared byte for byte as well.
 *
 * Written by @design because the card names this file. Per workshop rule 2 a
 * cold break by another seat is owed before this closes the card.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const bg = require("../renderer/pce-bg.js");
const sprites = require("../renderer/pce-sprites.js");
const toys = require("../renderer/pce-toys.js");

const WIDTH = 256;
const HEIGHT = 224;
const FRAMES = 40;
const FIRST_SCANLINE = 18;

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

/* Byte-array equality with the first differing index named. */
function sameBytes(name, got, want) {
  if (got.length !== want.length) {
    check(false, name + " length " + got.length + " != " + want.length);
    return;
  }
  for (let i = 0; i < got.length; i++) {
    if (got[i] !== want[i]) {
      check(false, name + " differs at byte " + i + ": " + got[i] + " != " +
                  want[i]);
      return;
    }
  }
  check(true, name);
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

function samePixels(name, got, want) {
  if (got.length !== want.length) {
    check(false, name + " pixel bytes " + got.length + " != " + want.length);
    return;
  }
  const d = diffCount(got, want);
  check(d.n === 0, name + " diff " + d.n +
        (d.n ? " (first byte " + d.first + ")" : ""));
}

/* The model's input, the one shape every check uses. */
function modelState(vram, cram, sat, regs) {
  return {
    vram: vram,
    cram: cram,
    sat: sat,
    regs: {
      BXR: regs.BXR, BYR: regs.BYR, MWR: regs.MWR, CR: regs.CR,
      RCRCount: 0, scanline: FIRST_SCANLINE
    },
    width: WIDTH,
    height: HEIGHT
  };
}

function draw(state, raster) {
  const opts = modelState(state.vram, state.cram, state.sat, state.regs);
  if (raster) opts.raster = raster;
  return sprites.renderFrame(opts).pixels;
}

/* ---- the one tile both background toys use --------------------------- */

/* The tile layout is pce-bg.js's: pixel bit 0 -> word0 bit (7-col), bit 1 ->
 * word0 bit (15-col), bit 2 -> word1 bit (7-col), bit 3 -> word1 bit
 * (15-col) (renderer/pce-bg.js renderIndices/backgroundPixel). */
function tileWords(pixelFn) {
  const words = [];
  for (let y = 0; y < 8; y++) {
    let w0 = 0, w1 = 0;
    for (let x = 0; x < 8; x++) {
      const c = pixelFn(x, y);
      if (c & 1) w0 |= 1 << (7 - x);
      if (c & 2) w0 |= 1 << (15 - x);
      if (c & 4) w1 |= 1 << (7 - x);
      if (c & 8) w1 |= 1 << (15 - x);
    }
    words.push([w0 & 0xFFFF, w1 & 0xFFFF]);
  }
  return words;
}

function backgroundVram() {
  const vram = new Uint8Array(65536);
  const word = (addr, v) => {
    vram[addr * 2] = v & 0xFF;
    vram[addr * 2 + 1] = (v >> 8) & 0xFF;
  };
  /* 32x28 BAT cells, character $40, palette 0 */
  for (let i = 0; i < 28 * 32; i++) word(i, 0x0040);
  /* tile $40: colour 1 with the diagonal in colour 15 */
  const rows = tileWords((x, y) => (x === y ? 15 : 1));
  for (let r = 0; r < 8; r++) {
    word(0x40 * 16 + r, rows[r][0]);
    word(0x40 * 16 + 8 + r, rows[r][1]);
  }
  return vram;
}

function zeroSat() { return new Uint8Array(512); }
function cramWord(cram, addr) {
  return cram[addr * 2] | (cram[addr * 2 + 1] << 8);
}
function setsCram(cram, addr, word) {
  cram[addr * 2] = word & 0xFF;
  cram[addr * 2 + 1] = (word >> 8) & 0xFF;
}
function cramWords(cram) {
  const out = new Array(512);
  for (let i = 0; i < 512; i++) out[i] = cramWord(cram, i);
  return out;
}
/* rgb() from the prelude: 3-bit channels, G 6-8 / R 3-5 / B 0-2 */
function rgb(r, g, b) {
  return ((g % 8) * 64) + ((r % 8) * 8) + (b % 8);
}

/* ---- the Lua sources ------------------------------------------------- */

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

const TOY_SPRITE = `
function init()
  -- one solid 16x16 sprite, colour 1, pattern code $100 (cell 256)
  for row = 0, 15 do
    vram[0x100 * 16 + row] = 0xFFFF
    vram[0x100 * 16 + 8 + row] = 0
  end
  pal(0x101, rgb(7, 7, 0))
  reg("CR", 0xC0)
  sx, sy = 32, 64
end
function frame(t, f)
  if pad[1].right then sx = sx + 1 end
  if pad[1].left then sx = sx - 1 end
  if pad[1].up then sy = sy - 1 end
  if pad[1].down then sy = sy + 1 end
  sprite(0, { x = sx, y = sy, pattern = 0x100, palette = 0 })
end
`;

/* ---- toy A: palette cycling ------------------------------------------ */

function checkPaletteToy() {
  const rt = toys.create(TOY_PALETTE, { budgetMs: 250 });
  rt.load();
  const vram = backgroundVram();
  for (let f = 0; f < FRAMES; f++) {
    const got = rt.frame(f);
    const cram = new Uint8Array(1024);
    for (let e = 1; e <= 15; e++) {
      setsCram(cram, e, rgb((e + f) % 8, f % 8, (e * 3 + f) % 8));
    }
    const state = { vram: vram, cram: cram, sat: zeroSat(),
                    regs: { BXR: 0, BYR: 0, MWR: 0, CR: 0x80 } };
    const want = draw(state);
    sameBytes("palette f" + f + " vram", got.state.vram, vram);
    sameBytes("palette f" + f + " cram", got.state.cram, cram);
    sameBytes("palette f" + f + " sat", got.state.sat, zeroSat());
    eq("palette f" + f + " regs", got.state.regs, state.regs);
    check(got.raster === null, "palette f" + f + " has no raster table");
    samePixels("palette f" + f + " pixels", got.pixels, want);
  }
  rt.dispose();
}

/* ---- toy B: scrolling with raster(line) ------------------------------ */

function checkRasterToy() {
  const rt = toys.create(TOY_RASTER, { budgetMs: 250 });
  rt.load();
  const vram = backgroundVram();
  let cram = new Uint8Array(1024);
  let prevLine = {};   /* line -> [[addr,word]] from the previous frame */
  for (let f = 0; f < FRAMES; f++) {
    const got = rt.frame(f);

    const baseCram = cramWords(cram);
    const baseBxr = (f * 2) % 1024;
    const baseByr = (f * 3) % 512;
    const base = { bxr: baseBxr, byr: baseByr, cr: 0x80 };

    const entries = [];
    const nextPrev = {};
    for (let line = 0; line < HEIGHT; line++) {
      const band = Math.floor(line / 8);
      const entry = { line: line, rcr: 0x40 + line,
                      bxr: (f * 2 + band * 3) % 1024 };
      if (line % 8 === 0) {
        const addr = 2 + (band % 14);
        const word = rgb(f % 8, band % 8, (f + band) % 8);
        entry.cram = [[addr, word]];
        entry.cramPrev = prevLine[line] || [];
        nextPrev[line] = entry.cram;
        setsCram(cram, addr, word);     /* the live VCE after this frame */
      }
      entries.push(entry);
    }

    const lastBxr = (f * 2 + Math.floor((HEIGHT - 1) / 8) * 3) % 1024;
    const wantRegs = { BXR: lastBxr, BYR: baseByr, MWR: 0, CR: 0x80 };
    const wantRaster = { base: base, baseCram: baseCram, entries: entries };
    const state = { vram: vram, cram: cram, sat: zeroSat(), regs: wantRegs };
    const want = draw(state, wantRaster);

    sameBytes("raster f" + f + " vram", got.state.vram, vram);
    sameBytes("raster f" + f + " cram", got.state.cram, cram);
    eq("raster f" + f + " regs", got.state.regs, wantRegs);
    check(JSON.stringify(got.raster) === JSON.stringify(wantRaster),
          "raster f" + f + " table matches the hand-built table");
    samePixels("raster f" + f + " pixels", got.pixels, want);
    /* the callback makes one entry for every line, in increasing order */
    check(got.raster.entries.length === HEIGHT,
          "raster f" + f + " has one entry per VDW line");
    prevLine = nextPrev;
  }
  rt.dispose();
}

/* ---- toy C: a sprite reading pad[1] ---------------------------------- */

function checkSpriteToy() {
  const rt = toys.create(TOY_SPRITE, { budgetMs: 250 });
  rt.load();
  const vram = new Uint8Array(65536);
  const word = (addr, v) => {
    vram[addr * 2] = v & 0xFF;
    vram[addr * 2 + 1] = (v >> 8) & 0xFF;
  };
  /* pce-sprites.js: word bit 15 is the leftmost sprite pixel; a solid
   * colour-1 16x16 cell is plane word0 = $FFFF, word1 = 0 at rows 0..15. */
  for (let r = 0; r < 16; r++) {
    word(0x100 * 16 + r, 0xFFFF);
    word(0x100 * 16 + 8 + r, 0);
  }
  const cram = new Uint8Array(1024);
  setsCram(cram, 0x101, rgb(7, 7, 0));

  const pads = [];
  for (let f = 0; f < FRAMES; f++) {
    pads.push(f < 10 ? { right: true }
            : f < 20 ? { down: true }
            : f < 30 ? { left: true }
            : { up: true });
  }

  let sx = 32, sy = 64;
  for (let f = 0; f < FRAMES; f++) {
    const p = pads[f];
    rt.setPad(1, p);
    const got = rt.frame(f);
    if (p.right) sx += 1;
    if (p.left) sx -= 1;
    if (p.up) sy -= 1;
    if (p.down) sy += 1;

    const sat = new Uint8Array(512);
    const satWord = (k, v) => {
      sat[k * 2] = v & 0xFF;
      sat[k * 2 + 1] = (v >> 8) & 0xFF;
    };
    satWord(0, sy);              /* word0: Y (64 = display row 0) */
    satWord(1, sx);              /* word1: X (32 = display column 0) */
    satWord(2, 0x100 << 1);      /* word2: pattern << 1 */
    satWord(3, 0);               /* word3: palette 0, no flags */

    const state = { vram: vram, cram: cram, sat: sat,
                    regs: { BXR: 0, BYR: 0, MWR: 0, CR: 0xC0 } };
    const want = draw(state);
    sameBytes("sprite f" + f + " vram", got.state.vram, vram);
    sameBytes("sprite f" + f + " cram", got.state.cram, cram);
    sameBytes("sprite f" + f + " sat", got.state.sat, sat);
    eq("sprite f" + f + " regs", got.state.regs, state.regs);
    samePixels("sprite f" + f + " pixels", got.pixels, want);
  }
  rt.dispose();
}

/* ---- the two raster forms, including a static table from init() ------ */

function checkRasterForms() {
  /* table form registered in init(): the same entry every frame */
  const rt = toys.create(`
function init()
  raster(5, { bxr = 123, cram = {{ 3, 7 }} })
end
function frame(t, f) end`, { budgetMs: 250 });
  rt.load();
  check(rt.callbackRaster === false, "a toy with no raster callback is table form");
  for (let f = 0; f < 3; f++) {
    const got = rt.frame(f);
    const want = {
      base: { bxr: 0, byr: 0, cr: 0x80 },
      baseCram: new Array(512).fill(0),
      entries: [{ line: 5, rcr: 0x45, bxr: 123, cram: [[3, 7]],
                  cramPrev: f === 0 ? [] : [[3, 7]] }]
    };
    check(JSON.stringify(got.raster) === JSON.stringify(want),
          "static table f" + f + " is the one registered in init()");
    const cram = new Uint8Array(1024);
    setsCram(cram, 3, 7);
    const state = { vram: new Uint8Array(65536), cram: cram, sat: zeroSat(),
                    regs: { BXR: 0, BYR: 0, MWR: 0, CR: 0x80 } };
    samePixels("static table f" + f + " pixels", got.pixels,
               draw(state, want));
  }
  rt.dispose();

  /* a callback defined inside init() is still found (detection runs after) */
  const rt2 = toys.create(`
function init()
  raster = function(line) reg("BXR", line) end
end
function frame(t, f) end`, { budgetMs: 250 });
  rt2.load();
  check(rt2.callbackRaster === true, "a raster callback defined in init() is found");
  const got = rt2.frame(0);
  check(got.raster.entries.length === HEIGHT,
        "a callback defined in init() runs for every line");
  rt2.dispose();
}

/* ---- refusals with codes --------------------------------------------- */

function refusal(name, source, code, opts) {
  const rt = toys.create(source, opts || { budgetMs: 250 });
  try {
    rt.load();
    rt.frame(0);
    check(false, "refusal " + name + " was accepted (wanted " + code + ")");
  } catch (e) {
    check(e instanceof toys.ToyError && e.code === code,
          "refusal " + name + " code " + (e && e.code) + " (wanted " + code +
          "): " + (e && e.message));
  } finally {
    rt.dispose();
  }
}

function checkRefusals() {
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
  refusal("a colour write past the line's budget", `
function frame(t, f) g_f = f; g_n = 0 end
function raster(line)
  if line == 0 and g_f == 0 then
    for i = 1, 65 do pal(i % 512, 0) end
  end
end`, "raster-line-full");
  refusal("a function in a password", `
function init() password.pack({ f = print }) end`, "password-value");
  refusal("a password that is not one", `
function init() password.unpack("P1ZZZZ") end`, "password-code");
  refusal("a mistyped password", `
function init()
  local c = password.pack({ score = 10 })
  local head = string.sub(c, 1, 2)
  local ch = string.sub(c, 3, 3)
  local other = ch == "A" and "B" or "A"
  password.unpack(head .. other .. string.sub(c, 4))
end`, "password-code");
  refusal("a runaway loop", `
function init() while true do end end`, "toy-timeout", { budgetMs: 20 });
  refusal("a Lua error names file:line", `
function frame(t, f)
  local x = nil
  return x + 1
end`, "toy-error");
}

/* ---- the sandbox and the password round trip ------------------------- */

function checkSandbox() {
  const rt = toys.create(`
function init()
  assert(os == nil and io == nil and require == nil and dofile == nil and
         loadfile == nil and package == nil and debug == nil and
         coroutine == nil, "a host door is still open")
  print("sandbox ok")
end`, { budgetMs: 250 });
  rt.load();
  check(rt.log[0] === "sandbox ok",
        "os/io/require/dofile/loadfile/package/debug/coroutine are all nil");
  rt.dispose();
}

function checkPasswords() {
  const rt = toys.create(`
function init()
  local value = { score = 1234, level = "C3", flags = { true, false },
                  name = "PCE" }
  local code = password.pack(value)
  local back = password.unpack(code)
  print(code)
  print(back.score, back.level, back.flags[1], back.flags[2], back.name)
  -- deterministic: the same value always gives the same code
  print(password.pack(value) == code)
  print(password.pack(1234) ~= password.pack(-1234))
end`, { budgetMs: 250 });
  rt.load();
  check(rt.log.length === 4, "password toy printed four lines");
  check(/^P1[A-Z2-7]+$/.test(rt.log[0]),
        "the code is a P1 base32 string: " + rt.log[0]);
  check(rt.log[1] === "1234\tC3\ttrue\tfalse\tPCE",
        "the value round-trips through the code: " + JSON.stringify(rt.log[1]));
  check(rt.log[2] === "true", "the same value always packs the same code");
  check(rt.log[3] === "true", "different numbers pack different codes");
  const first = rt.log[0];
  rt.dispose();

  /* the same value packs to the same code in a fresh VM: the table order a
   * Lua `pairs` walk gives must not leak into the code */
  const again = toys.create(
    "function init() print(password.pack({ name = \"PCE\", flags = { true, false }, level = \"C3\", score = 1234 })) end",
    { budgetMs: 250 });
  again.load();
  check(again.log[0] === first, "a fresh VM packs the same code");
  again.dispose();
}

/* ---- the runtime asks the same model the tests ask ------------------- */

function checkOneModel() {
  const rt = toys.create(TOY_PALETTE, { budgetMs: 250 });
  rt.load();
  const frame = rt.frame(7);
  const opts = rt.options();
  const drawn = sprites.renderFrame(opts).pixels;
  samePixels("the runtime's frame IS the model's drawing",
             frame.pixels, drawn);
  rt.dispose();
}

/* ---- the page's own wiring, in a stub DOM --------------------------- */

/* This project has no jsdom. Following tests/check-editor.js's #52 pattern,
 * this executes renderer/toys.html's declared scripts in order and its inline
 * script in a stub DOM, clicks Run, and pumps requestAnimationFrame a few
 * times: it proves the browser path loads the VM, creates a runtime, runs a
 * toy frame and paints it without an error. It is not a browser: layout, CSS
 * and a real canvas are stubbed, and no synthetic input is used. */
function checkPage() {
  const vm = require("vm");
  const html = fs.readFileSync(path.join(__dirname, "..", "renderer", "toys.html"),
                               "utf8");
  const srcs = [];
  const reSrc = /<script\s+src="([^"]+)"\s*><\/script>/g;
  let m;
  while ((m = reSrc.exec(html))) srcs.push(m[1]);
  let inline = null;
  const reInline = /<script>([\s\S]*?)<\/script>/g;
  while ((m = reInline.exec(html))) inline = m[1];
  if (!inline || !srcs.length) {
    check(false, "toys.html names its scripts and an inline script");
    return;
  }

  const elements = new Map();
  function stubElement(id) {
    return {
      id: id, listeners: {}, textContent: "", value: "", disabled: false,
      checked: false, dataset: {}, width: 256, height: 224,
      addEventListener(type, fn) {
        (this.listeners[type] = this.listeners[type] || []).push(fn);
      },
      getContext() {
        return {
          createImageData(w, h) {
            return { width: w, height: h,
                     data: new Uint8ClampedArray(w * h * 4) };
          },
          putImageData() {}, fillRect() {}, drawImage() {}
        };
      }
    };
  }
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, stubElement(id));
    return elements.get(id);
  };
  const raf = [];
  const sandbox = {
    console: console,
    Uint8Array: Uint8Array, Uint8ClampedArray: Uint8ClampedArray,
    /* fengari-web's browser check names these constructors at load */
    HTMLDocument: function HTMLDocument() {},
    HTMLCanvasElement: function HTMLCanvasElement() {},
    location: { search: "" },
    performance: { now: () => sandbox.__now },
    requestAnimationFrame(fn) { raf.push(fn); return raf.length; },
    cancelAnimationFrame() {},
    document: {
      getElementById: element,
      querySelectorAll: () => []
    },
    __now: 0
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  try {
    for (const src of srcs) {
      const file = path.join(__dirname, "..", "renderer", src);
      vm.runInContext(fs.readFileSync(file, "utf8"), sandbox,
                      { filename: "renderer/" + src });
    }
    vm.runInContext(inline, sandbox, { filename: "renderer/toys.html <inline>" });
  } catch (e) {
    check(false, "toys.html did not run (" + e.message + ")");
    return;
  }
  check(typeof sandbox.PCEStudio === "object" &&
        typeof sandbox.PCEStudio.toys === "object",
        "toys.html loaded the runtime as a browser global");
  const run = element("run");
  if (!run.listeners.click || run.listeners.click.length !== 1) {
    check(false, "toys.html has exactly one Run click handler");
    return;
  }
  try {
    run.listeners.click[0]();
  } catch (e) {
    check(false, "toys.html's Run threw (" + e.message + ")");
    return;
  }
  check(element("error").textContent === "",
        "the page reports no error after Run: " + element("error").textContent);
  let painted = 0;
  try {
    for (let i = 0; i < 4; i++) {
      const fn = raf.shift();
      if (!fn) break;
      sandbox.__now += 17;
      fn(sandbox.__now);
      if (/^frame [1-9]/.test(element("status").textContent)) painted++;
    }
  } catch (e) {
    check(false, "toys.html's frame loop threw (" + e.message + ")");
    return;
  }
  check(painted >= 3,
        "toys.html ran and painted frames: status " +
        JSON.stringify(element("status").textContent));
  check(element("error").textContent === "",
        "no error after the frames: " + element("error").textContent);
}

/* ---- main ------------------------------------------------------------ */

function main() {
  const started = Date.now();
  checkPaletteToy();
  checkRasterToy();
  checkSpriteToy();
  checkRasterForms();
  checkRefusals();
  checkSandbox();
  checkPasswords();
  checkOneModel();
  checkPage();

  const ms = Date.now() - started;
  if (failures.length) {
    console.log("FAIL  " + failures.length + " of " + checks +
                " checks failed (" + ms + " ms)");
    process.exit(1);
  }
  console.log("PASS  " + checks + " checks, 3 toys x " + FRAMES +
              " frames diff 0, every refusal by code (" + ms + " ms)");
}

main();
