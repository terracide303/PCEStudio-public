#!/usr/bin/env node
/*
 * tests/check-studio.js — the evidence for #75's first half (layout + run +
 * panels).
 *
 * NOTE: written by @design because the card names this file. Under the
 * workshop role split a test written by the builder is flagged for @review to
 * read cold (same arrangement as check.js, check-editor.js, check-toys.js and
 * check-il.js).
 *
 * What it measures:
 *  1. renderer/studio.html runs. Its declared scripts (Fengari, the model,
 *     the one toy host, the Lua runtime, the IL runtime and the #26 panels)
 *     and its own inline script are executed in a stub DOM — there is no
 *     jsdom in this project; this is the check-editor.js/check-toys.js
 *     pattern. The page must expose PCEStudio.studio, carry the three example
 *     toys and build its dock.
 *  2. The page's examples have not drifted. Their Lua strings are compared
 *     with the ones tests/check-il.js defines (read from its source, so
 *     requiring this file cannot run check-il's suite), the same three toys
 *     tests/check-toys.js runs, so the page and the evidence agree.
 *  3. Forty frames through the PAGE's own runFrames() equal check-toys'
 *     hand-built expected state: vram, cram, sat, the four register values
 *     and the pixels (renderer/pce-sprites.js drawing that hand-built state)
 *     — diff 0 for every one of the 40 frames. A second run is byte-equal,
 *     so the studio's frame flow is deterministic.
 *  4. The IL half is reused, not merely linked: the same 40 frames through
 *     renderer/pce-il.js equal the Lua frames (state, raster table, pixels)
 *     for all three examples. This is the studio's Lua/IL switch, the PCE
 *     counterpart of ppu.toys' Lua/Cart switch, exercised through the page.
 *  5. Every button in the page has a click handler and every handler is
 *     executed with a synthetic event. The count is asserted (a page that
 *     silently stopped building its dock or menus fails here), each button
 *     must have at least one listener, and a handler that throws fails the
 *     run. Range/select controls that carry state (source, seek, length) are
 *     exercised too.
 *  6. --browser (optional): the real page is loaded in headless Google
 *     Chrome with ?selftest=1&frames=40; the DOM must say PASS 40 frames and
 *     its frame-39 digest must equal the one computed here from check-toys'
 *     hand-built expected state. This is the headless-browser evidence the
 *     card asks for; without the flag the suite still covers 1-5 in the stub
 *     DOM.
 *
 * Not measured here: layout and CSS (a screenshot is the evidence, under
 * $TMPDIR and described in docs/STUDIO.md), a real canvas's pixels (the stub
 * context records nothing), the toy compiler/export (#31, second half of
 * #75), sound (#71), and the agent link (#24).
 *
 *   node tests/check-studio.js
 *   node tests/check-studio.js --browser
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { pathToFileURL } = require("url");
const { execFileSync } = require("child_process");

const sprites = require("../renderer/pce-sprites.js");

/* The three toy sources are read from tests/check-il.js's own text instead of
 * requiring it: at this revision check-il.js runs its whole suite when
 * required, and requiring it would make this check depend on that suite
 * (plus any uncommitted edits to it) just to read three strings. Reading the
 * constants keeps one copy of each toy and still fails loudly if they move. */
function readIlToys() {
  const file = path.join(__dirname, "check-il.js");
  const src = fs.readFileSync(file, "utf8");
  function templateAfter(marker) {
    const i = src.indexOf(marker);
    if (i < 0) return null;
    const a = src.indexOf("`", i + marker.length);
    if (a < 0) return null;
    const b = src.indexOf("`", a + 1);
    if (b < 0) return null;
    return src.slice(a + 1, b);
  }
  const setup = templateAfter("const SETUP = ");
  const palette = templateAfter("const TOY_PALETTE = ");
  const raster = templateAfter("const TOY_RASTER = ");
  const sprite = templateAfter("const TOY_SPRITE = ");
  if (setup == null || palette == null || raster == null || sprite == null)
    throw new Error("tests/check-il.js no longer defines SETUP and the three toys");
  return { SETUP: setup, TOY_PALETTE: setup + palette,
           TOY_RASTER: setup + raster, TOY_SPRITE: sprite };
}

const ilExports = readIlToys();

const RENDERER = path.join(__dirname, "..", "renderer");
const PAGE = path.join(RENDERER, "studio.html");
const FRAMES = 40;
const WIDTH = 256;
const HEIGHT = 224;
const FIRST_SCANLINE = 18;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let checks = 0;
const failures = [];
let buttonCount = 0;

function check(ok, name) {
  checks++;
  if (!ok) {
    failures.push(name);
    console.log("FAIL  " + name);
  }
}

function diffCount(a, b) {
  let n = 0, first = -1;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) { if (first < 0) first = i; n++; }
  }
  return { n, first,
    length: a.length !== b.length ? [a.length, b.length] : null };
}

function sameBytes(name, got, want) {
  if (!got || !want) { check(false, name + ": a side is missing"); return; }
  if (got.length !== want.length) {
    check(false, name + " length " + got.length + " != " + want.length);
    return;
  }
  const d = diffCount(got, want);
  check(d.n === 0, name + " diff " + d.n +
        (d.n ? " (first byte " + d.first + ")" : ""));
}

function samePixels(name, got, want) {
  if (!got || !want) { check(false, name + ": a side is missing"); return; }
  if (got.length !== want.length) {
    check(false, name + " pixel bytes " + got.length + " != " + want.length);
    return;
  }
  const d = diffCount(got, want);
  check(d.n === 0, name + " diff " + d.n +
        (d.n ? " (first byte " + d.first + ")" : ""));
}

function eq(name, got, want) {
  check(JSON.stringify(got) === JSON.stringify(want),
        name + " (got " + JSON.stringify(got) + ", want " +
        JSON.stringify(want) + ")");
}

/* ---- the hand-built expected state (copied from tests/check-toys.js) ----
 * This is the same expected state the Lua runtime's own test uses, so #75's
 * evidence is literally "what check-toys expects", not a second opinion. */
function modelState(vram, cram, sat, regs) {
  return {
    vram: vram, cram: cram, sat: sat,
    regs: { BXR: regs.BXR, BYR: regs.BYR, MWR: regs.MWR, CR: regs.CR,
            RCRCount: 0, scanline: FIRST_SCANLINE },
    width: WIDTH, height: HEIGHT
  };
}

function draw(state, raster) {
  const opts = modelState(state.vram, state.cram, state.sat, state.regs);
  if (raster) opts.raster = raster;
  return sprites.renderFrame(opts).pixels;
}

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
  for (let i = 0; i < 28 * 32; i++) word(i, 0x0040);
  const rows = tileWords((x, y) => (x === y ? 15 : 1));
  for (let r = 0; r < 8; r++) {
    word(0x40 * 16 + r, rows[r][0]);
    word(0x40 * 16 + 8 + r, rows[r][1]);
  }
  return vram;
}

function zeroSat() { return new Uint8Array(512); }
function setsCram(cram, addr, word) {
  cram[addr * 2] = word & 0xFF;
  cram[addr * 2 + 1] = (word >> 8) & 0xFF;
}
function rgb(r, g, b) {
  return ((g % 8) * 64) + ((r % 8) * 8) + (b % 8);
}

/* The page's selftest digest, computed here from the hand-built expected
 * state of frame 39: FNV-1a over pixels, vram, cram, sat, then BXR/BYR/CR.
 * Comparing it with the browser's reported digest makes the headless-Chrome
 * run a diff-0 claim, not just a "the page booted" claim. */
function expectedPaletteDigest(f) {
  const vram = backgroundVram();
  const cram = new Uint8Array(1024);
  for (let e = 1; e <= 15; e++) {
    setsCram(cram, e, rgb((e + f) % 8, f % 8, (e * 3 + f) % 8));
  }
  const sat = zeroSat();
  const pixels = draw({ vram: vram, cram: cram, sat: sat,
                        regs: { BXR: 0, BYR: 0, MWR: 0, CR: 0x80 } });
  let h = 2166136261;
  const feed = (arr) => {
    for (let i = 0; i < arr.length; i++) {
      h ^= arr[i];
      h = Math.imul(h, 16777619);
    }
  };
  feed(pixels); feed(vram); feed(cram); feed(sat);
  h ^= 0; h = Math.imul(h, 16777619);
  h ^= 0; h = Math.imul(h, 16777619);
  h ^= 0x80; h = Math.imul(h, 16777619);
  return (h >>> 0).toString(16).padStart(8, "0");
}

/* ---- the stub DOM ------------------------------------------------------ */
/* No jsdom in this project. The page's own inline script and the module
 * scripts its tags name are executed in order; elements are created on first
 * getElementById/createElement. The stub records every element so the button
 * pass can find the whole page, including the dock tabs and menus the page
 * builds at load. Canvases return an empty recording context: the stub is
 * not asked to show pixels, only to let every handler run. */
function stubClassList() {
  const set = new Set();
  return {
    add(...names) { names.forEach((n) => set.add(n)); },
    remove(...names) { names.forEach((n) => set.delete(n)); },
    toggle(name, force) {
      if (force === undefined) {
        if (set.has(name)) { set.delete(name); return false; }
        set.add(name); return true;
      }
      if (force) { set.add(name); return true; }
      set.delete(name); return false;
    },
    contains(name) { return set.has(name); }
  };
}

function stubContext() {
  return new Proxy({}, {
    get(_, key) {
      if (key === "createImageData" || key === "getImageData") {
        return (w, h) => ({ width: w, height: h,
          data: new Uint8ClampedArray(w * h * 4) });
      }
      if (key === "measureText") return () => ({ width: 0 });
      if (key === "canvas") return null;
      return () => {};
    },
    set() { return true; }
  });
}

function makeStubDom() {
  const all = [];
  const byId = new Map();

  function element(tag, id) {
    const el = {
      tagName: String(tag || "div").toUpperCase(),
      id: id || "",
      children: [],
      listeners: {},
      style: {},
      dataset: {},
      attributes: {},
      className: "",
      title: "",
      textContent: "",
      value: "",
      checked: false,
      disabled: false,
      hidden: false,
      width: 256,
      height: 224,
      scrollTop: 0,
      scrollHeight: 0,
      selectionStart: 0,
      selectionEnd: 0,
      files: null,
      classList: stubClassList(),
      parentNode: null,
      addEventListener(type, fn) {
        (this.listeners[type] = this.listeners[type] || []).push(fn);
      },
      removeEventListener(type, fn) {
        const l = this.listeners[type];
        if (!l) return;
        const i = l.indexOf(fn);
        if (i >= 0) l.splice(i, 1);
      },
      appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        return child;
      },
      insertBefore(child) { return this.appendChild(child); },
      removeChild(child) {
        const i = this.children.indexOf(child);
        if (i >= 0) this.children.splice(i, 1);
        child.parentNode = null;
        return child;
      },
      remove() { if (this.parentNode) this.parentNode.removeChild(this); },
      click() {
        const l = this.listeners.click || [];
        const ev = fakeEvent(this);
        for (const fn of l) fn(ev);
      },
      focus() {},
      setAttribute(name, value) { this.attributes[name] = String(value); },
      getAttribute(name) {
        return Object.prototype.hasOwnProperty.call(this.attributes, name)
          ? this.attributes[name] : null;
      },
      removeAttribute(name) { delete this.attributes[name]; },
      getBoundingClientRect() {
        return { left: 0, top: 0, width: this.width, height: this.height };
      },
      getContext() { return stubContext(); },
      setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; }
    };
    Object.defineProperty(el, "firstChild", {
      get() { return this.children.length ? this.children[0] : null; }
    });
    Object.defineProperty(el, "innerHTML", {
      get() { return ""; },
      set(value) { if (!value) this.children.length = 0; }
    });
    all.push(el);
    return el;
  }

  function fakeEvent(target) {
    return {
      type: "click", target: target, currentTarget: target,
      preventDefault() {}, stopPropagation() {},
      clientX: Math.floor(target.width / 2) || 1,
      clientY: Math.floor(target.height / 2) || 1,
      key: "", code: "",
      ctrlKey: false, metaKey: false, shiftKey: false, altKey: false
    };
  }

  const get = (id) => {
    if (!byId.has(id)) {
      const el = element(id === "vrammap" ? "canvas" : "div", id);
      if (id === "out") { el.width = 256; el.height = 224; }
      if (id === "vrammap") { el.width = 512; el.height = 44; }
      byId.set(id, el);
    }
    return byId.get(id);
  };

  /* The page's static HTML is not parsed by the stub; seed the ids with the
   * tag the real document gives them, so a static <button> is a BUTTON here
   * and "every button" really means every button. */
  const define = (id, tag) => {
    const el = get(id);
    el.tagName = String(tag).toUpperCase();
    if (el.tagName === "CANVAS") {
      if (id === "out") { el.width = 256; el.height = 224; }
      else if (id === "vrammap") { el.width = 512; el.height = 44; }
    }
    return el;
  };

  const document = {
    getElementById: get,
    createElement(tag) { return element(tag); },
    querySelectorAll(selector) {
      if (selector === "button") return all.filter((e) => e.tagName === "BUTTON");
      if (selector[0] === "#") { const e = get(selector.slice(1)); return [e]; }
      if (selector[0] === "[") {
        const key = selector.slice(1, -1);
        return all.filter((e) => e.dataset[key] !== undefined);
      }
      return [];
    },
    querySelector(selector) {
      const list = document.querySelectorAll(selector);
      return list.length ? list[0] : null;
    },
    addEventListener() {},
    removeEventListener() {},
    body: element("body", "body"),
    activeElement: null
  };

  return { document, all, byId, get, define, fakeEvent };
}

function pageParts() {
  const html = fs.readFileSync(PAGE, "utf8");
  const srcs = [];
  const reSrc = /<script\s+src="([^"]+)"\s*><\/script>/g;
  let m;
  while ((m = reSrc.exec(html))) srcs.push(m[1]);
  let inline = null;
  const reInline = /<script>([\s\S]*?)<\/script>/g;
  while ((m = reInline.exec(html))) inline = m[1];
  return { srcs, inline };
}

function runPage(search) {
  const parts = pageParts();
  if (!parts.inline) throw new Error("studio.html has no inline script");
  if (!parts.srcs.length) throw new Error("studio.html names no scripts");
  const dom = makeStubDom();
  /* seed every static id with its real tag before the page's script runs */
  const html = fs.readFileSync(PAGE, "utf8");
  const reId = /<([a-zA-Z][\w-]*)\b[^>]*\bid="([^"]+)"/g;
  let idMatch;
  while ((idMatch = reId.exec(html))) dom.define(idMatch[2], idMatch[1]);
  const raf = [];
  const sandbox = {
    console,
    Uint8Array, Uint8ClampedArray, Array, Math, JSON, Object, String, Number,
    parseInt, parseFloat, isNaN, Date, RegExp, Promise, Set, Map,
    HTMLDocument: function HTMLDocument() {},
    HTMLCanvasElement: function HTMLCanvasElement() {},
    location: { search: search || "" },
    requestAnimationFrame(fn) { raf.push(fn); return raf.length; },
    cancelAnimationFrame() {},
    setTimeout() { return 0; },
    clearTimeout() {},
    addEventListener() {},
    removeEventListener() {},
    document: dom.document,
    URLSearchParams,
    __now: 0
  };
  sandbox.performance = { now: () => sandbox.__now };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const loaded = [];
  for (const src of parts.srcs) {
    const file = path.resolve(RENDERER, src);
    vm.runInContext(fs.readFileSync(file, "utf8"), sandbox,
      { filename: "renderer/" + src });
    loaded.push(src);
  }
  vm.runInContext(parts.inline, sandbox,
    { filename: "renderer/studio.html <inline>" });
  return { sandbox, dom, raf, loaded, inline: parts.inline };
}

/* ---- 1. the page boots ------------------------------------------------- */
function checkBoot(page) {
  const S = page.sandbox.PCEStudio;
  check(!!S && !!S.studio, "the page exposes PCEStudio.studio");
  if (!S || !S.studio) return;
  const studio = page.sandbox.PCEStudio.studio;
  check(studio.examples.length === 3,
        "the page carries three examples (got " + studio.examples.length + ")");
  check(studio.panels.length === 8,
        "the panel dock has eight PCE panels (got " + studio.panels.length + ")");
  check(page.loaded.some((s) => /pce-toys\.js$/.test(s)),
        "the page loads renderer/pce-toys.js");
  check(page.loaded.some((s) => /pce-il\.js$/.test(s)),
        "the page loads renderer/pce-il.js (the Lua/IL switch)");
  check(page.loaded.some((s) => /pce-panels\.js$/.test(s)),
        "the page loads renderer/pce-panels.js (the #26 panels)");
  const ids = studio.examples.map((e) => e.id).sort();
  eq("the example ids", ids, ["palette", "raster", "sprite"]);

  /* The page's sources are the exact strings tests/check-il.js exports. */
  const byId = {};
  for (const ex of studio.examples) byId[ex.id] = ex.source;
  check(byId.palette === ilExports.TOY_PALETTE,
        "palette-cycle.lua is tests/check-il.js's TOY_PALETTE");
  check(byId.raster === ilExports.TOY_RASTER,
        "raster-bands.lua is tests/check-il.js's TOY_RASTER");
  check(byId.sprite === ilExports.TOY_SPRITE,
        "sprite-pad.lua is tests/check-il.js's TOY_SPRITE");

  /* The page autoloads the first example and paints frame 0. */
  const cur = studio.current();
  check(cur.id === "palette", "the page starts on palette-cycle.lua");
  check(cur.frame === 0, "the page has painted frame 0 (got " + cur.frame + ")");
  check(!!studio.state(), "a frame's model state is readable");
}

/* ---- 2/3. 40 frames diff 0 against check-toys' expected state ---------- */
function checkFortyFrames(page) {
  const studio = page.sandbox.PCEStudio.studio;
  const frames = page.sandbox.PCEStudio.studio.runFrames(FRAMES, "palette", "lua");
  check(frames.length === FRAMES,
        "the page ran " + FRAMES + " frames (got " + frames.length + ")");
  const vram = backgroundVram();
  let pixelDiff = 0;
  for (let f = 0; f < frames.length; f++) {
    const got = frames[f];
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
    eq("palette f" + f + " regs", got.state.regs,
       { BXR: 0, BYR: 0, MWR: 0, CR: 0x80 });
    check(got.raster === null, "palette f" + f + " has no raster table");
    samePixels("palette f" + f + " pixels", got.pixels, want);
    if (diffCount(got.pixels, want).n) pixelDiff++;
    check(got.frame === f, "palette f" + f + " reports its frame number");
    check(got.width === WIDTH && got.height === HEIGHT,
          "palette f" + f + " is " + WIDTH + "x" + HEIGHT);
  }
  check(pixelDiff === 0, "all " + FRAMES + " frames are pixel diff 0");

  /* determinism: the same run again, byte for byte */
  const again = studio.runFrames(FRAMES, "palette", "lua");
  let same = again.length === frames.length;
  for (let f = 0; same && f < frames.length; f++) {
    same = diffCount(again[f].pixels, frames[f].pixels).n === 0 &&
      diffCount(again[f].state.vram, frames[f].state.vram).n === 0 &&
      diffCount(again[f].state.cram, frames[f].state.cram).n === 0 &&
      diffCount(again[f].state.sat, frames[f].state.sat).n === 0 &&
      JSON.stringify(again[f].state.regs) === JSON.stringify(frames[f].state.regs) &&
      JSON.stringify(again[f].raster) === JSON.stringify(frames[f].raster);
  }
  check(same, "a second 40-frame run is byte-identical (deterministic)");
}

/* ---- 4. the IL switch through the page --------------------------------- */
function checkIlSwitch(page) {
  const studio = page.sandbox.PCEStudio.studio;
  for (const id of ["palette", "raster", "sprite"]) {
    const lua = studio.runFrames(FRAMES, id, "lua");
    let ilFrames;
    try {
      ilFrames = studio.runFrames(FRAMES, id, "il");
    } catch (e) {
      check(false, id + ": the IL refused a page example (" +
                   (e.code || "error") + ": " + e.message + ")");
      continue;
    }
    let same = ilFrames.length === lua.length;
    let firstBad = -1;
    for (let f = 0; same && f < lua.length; f++) {
      const a = lua[f], b = ilFrames[f];
      same = diffCount(a.pixels, b.pixels).n === 0 &&
        diffCount(a.state.vram, b.state.vram).n === 0 &&
        diffCount(a.state.cram, b.state.cram).n === 0 &&
        diffCount(a.state.sat, b.state.sat).n === 0 &&
        JSON.stringify(a.state.regs) === JSON.stringify(b.state.regs) &&
        JSON.stringify(a.raster) === JSON.stringify(b.raster);
      if (!same) firstBad = f;
    }
    check(same, id + ": 40 frames Lua == IL (page switch)" +
          (firstBad >= 0 ? " — first bad frame " + firstBad : ""));
  }
  /* Leave the visible runtime on a Lua example. */
  studio.loadExample("palette", true);
  studio.pause();
}

/* ---- 5. every button's handler ---------------------------------------- */
function checkButtons(page) {
  const studio = page.sandbox.PCEStudio.studio;
  studio.loadExample("palette", true);
  studio.pause();

  /* Create the dynamic marker button so it is part of "every button". */
  const add = page.dom.get("btn-addmarker");
  const addListeners = add.listeners.click || [];
  check(addListeners.length === 1, "Add marker has one click handler");
  if (addListeners.length) addListeners[0](page.dom.fakeEvent(add));

  const buttons = page.dom.document.querySelectorAll("button");
  buttonCount = buttons.length;
  check(buttons.length >= 40,
        "the page built its buttons (got " + buttons.length + ")");

  let clicked = 0;
  let noHandler = 0;
  let threw = 0;
  const failuresHere = [];
  for (const button of buttons) {
    const label = (button.id || button.textContent || button.className ||
                   "unnamed").trim().slice(0, 42);
    const listeners = button.listeners.click || [];
    if (!listeners.length) {
      noHandler++;
      failuresHere.push("no click handler: " + label);
      continue;
    }
    for (const fn of listeners) {
      try {
        fn(page.dom.fakeEvent(button));
        clicked++;
      } catch (e) {
        threw++;
        failuresHere.push("threw in " + label + ": " + (e.message || e));
      }
    }
  }
  check(noHandler === 0,
        "every button has a click handler (" + noHandler + " did not)");
  check(threw === 0,
        "every button handler ran without throwing (" + threw + " threw)");
  for (const f of failuresHere) console.log("      " + f);
  check(clicked >= buttons.length,
        "every button handler was executed (" + clicked + " executions, " +
        buttons.length + " buttons)");

  /* The other controls that carry state, exercised on the real page code. */
  const source = page.dom.get("source");
  const before = source.value;
  source.value = before + "\n-- edited by the check\n";
  let srcRan = 0;
  for (const fn of source.listeners.input || []) {
    fn({ target: source, preventDefault() {}, stopPropagation() {} });
    srcRan++;
  }
  check(srcRan > 0, "the source box has an input handler");
  check(page.sandbox.PCEStudio.studio.current().source.endsWith("check\n"),
        "the source box handler takes the edit");

  const seek = page.dom.get("seek");
  seek.value = "20";
  for (const fn of seek.listeners.input || []) {
    fn({ target: seek, preventDefault() {}, stopPropagation() {} });
  }
  check(page.sandbox.PCEStudio.studio.current().frame === 20,
        "the scrubber seeks the page (frame " +
        page.sandbox.PCEStudio.studio.current().frame + ")");

  const length = page.dom.get("length");
  length.value = "120";
  for (const fn of length.listeners.change || []) {
    fn({ target: length, preventDefault() {}, stopPropagation() {} });
  }
  check(seek.max === "119", "the length control resets the scrubber's max (" +
        seek.max + ")");

  /* Check uses the source box, not the example on disk, and does not discard
   * the edit while doing it. */
  const edited = page.sandbox.PCEStudio.studio.current().source;
  const result = page.sandbox.PCEStudio.studio.check();
  check(result.same === true, "Check on the edited source is deterministic");
  check(page.sandbox.PCEStudio.studio.current().source === edited,
        "Check keeps the edited source (no silent revert to the example)");

  /* Leave the page on its first example, paused at frame 0. */
  studio.loadExample("palette", true);
  studio.pause();
  studio.seek(0);
  check(page.sandbox.PCEStudio.studio.current().frame === 0,
        "the page can be left paused at frame 0");
}

/* ---- 6. the real headless browser (optional) --------------------------- */
function checkBrowser() {
  if (!fs.existsSync(CHROME)) {
    console.log("NOT RUN  browser: " + CHROME + " is not installed");
    return "not-run";
  }
  const profile = path.join(process.env.TMPDIR || os.tmpdir(),
                            "pcestudio-chrome-" + process.pid);
  const url = pathToFileURL(PAGE).href +
    "?selftest=1&frames=40&example=palette";
  let dom = "";
  try {
    dom = execFileSync(CHROME, [
      "--headless=new", "--disable-gpu", "--no-sandbox",
      "--user-data-dir=" + profile,
      "--virtual-time-budget=20000",
      "--dump-dom", url
    ], { encoding: "utf8", timeout: 120000,
         stdio: ["ignore", "pipe", "ignore"] });
  } catch (e) {
    check(false, "headless Chrome ran studio.html (" + e.message + ")");
    return "fail";
  }
  const m = dom.match(/id="selftest"[^>]*>([^<]+)</);
  const text = m ? m[1].trim() : "";
  check(/^PASS 40 frames/.test(text),
        "headless Chrome: the page's selftest says PASS 40 frames (got " +
        JSON.stringify(text.slice(0, 120)) + ")");
  const digest = text.match(/digest ([0-9a-f]{8})/);
  const want = expectedPaletteDigest(FRAMES - 1);
  check(!!digest && digest[1] === want,
        "headless Chrome: frame 39's digest equals check-toys' expected " +
        "state (" + (digest ? digest[1] : "none") + " vs " + want + ")");
  if (text) console.log("      browser: " + text);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  return /^PASS 40 frames/.test(text) ? "pass" : "fail";
}

/* ---- main ------------------------------------------------------------- */
function main() {
  const started = Date.now();
  let page;
  try {
    page = runPage("");
  } catch (e) {
    console.log("FAIL  renderer/studio.html did not run (" + e.message + ")");
    process.exit(1);
  }
  checkBoot(page);
  checkFortyFrames(page);
  checkIlSwitch(page);
  checkButtons(page);

  let browser = "not-requested";
  if (process.argv.indexOf("--browser") >= 0) browser = checkBrowser();

  const ms = Date.now() - started;
  if (failures.length) {
    console.log("FAIL  " + failures.length + " of " + checks +
                " checks failed (" + ms + " ms)");
    process.exit(1);
  }
  console.log("PASS  " + checks + " checks, " + FRAMES +
              " frames diff 0 vs check-toys' expected state, Lua == IL for 3 " +
              "examples, every button's handler executed (" + buttonCount +
              " buttons)" +
              (browser === "pass" ? ", headless Chrome says PASS 40" : "") +
              " (" + ms + " ms)");
}

main();
