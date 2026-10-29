#!/usr/bin/env node
/*
 * tests/check-studio.js — the evidence for #75 (layout + run + panels),
 * #77 (the CodeMirror editor, the toy's files, save/open, autosave, Vim) and
 * #78 (the output column's layers, CRT, SND, markers, length, resolution and
 * pad keys).
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
 *  3. The Docs panel is #61's reference, not a copy: its source is
 *     byte-equal to renderer/docs.html, the injected page carries all ten
 *     chapters plus ppu.toys' search/chapter map/kicker, the top-bar button
 *     opens it, × closes it, Guide lands on the right chapter, ?docs=sprites
 *     opens it on load, and the Export dialog names #31.
 *  4. Forty frames through the PAGE's own runFrames() equal check-toys'
 *     hand-built expected state: vram, cram, sat, the four register values
 *     and the pixels (renderer/pce-sprites.js drawing that hand-built state)
 *     — diff 0 for every one of the 40 frames. A second run is byte-equal,
 *     so the studio's frame flow is deterministic.
 *  5. The IL half is reused, not merely linked: the same 40 frames through
 *     renderer/pce-il.js equal the Lua frames (state, raster table, pixels)
 *     for all three examples. This is the studio's Lua/IL switch, the PCE
 *     counterpart of ppu.toys' Lua/Cart switch, exercised through the page.
 *  6. Every button in the page has a click handler and every handler is
 *     executed with a synthetic event. The count is asserted (a page that
 *     silently stopped building its dock or menus fails here), each button
 *     must have at least one listener, and a handler that throws fails the
 *     run. Range/select controls that carry state (source, seek, length) are
 *     exercised too.
 *  7. #77: the vendored CodeMirror files and notice; the five-file toy; the
 *     editor's text is the Lua that runs (an edit changes pixels) and an
 *     asset edit does not; save/reopen of one pce.studio/1 envelope is
 *     byte-identical; autosave restores the editor, runtime text and assets
 *     on a second page with the same storage; the ppu.toys guards refuse by
 *     code; a plain .lua opens as a toy.
 *  8. #77: every PCE meaning of docs/STUDIO.md §5's shortcut table executes
 *     (Space, R, Ctrl+Enter, Ctrl+., Ctrl+,, Ctrl+S, Escape, Tab and the pad
 *     keys), and Settings → Vim is an opt-in that persists.
 *  9. #78: the output column — BG/SPR through CR bit 7/6 (pixel diff 0 against
 *     pce-sprites.renderFrame with the bit cleared, and the exact changed-pixel
 *     counts), View only masking the picture without a register write, the
 *     resolution label over 256/341/512, markers that seek, the scrubber's
 *     length (clamp, max, playhead — and #144: ▶ plays past Length, through
 *     the page's own rAF loop, until Stop), the CRT overlay, SND's honest
 *     #71 state, and all eight pad keys on the focused output.
 * 10. --browser (optional): the real page is loaded in headless Google
 *     Chrome with ?selftest=1&frames=40; the DOM must say PASS 40 frames and
 *     its frame-39 digest must equal the one computed here from check-toys'
 *     hand-built expected state. A second load with ?docs=sprites must show
 *     the Docs panel open with the generated reference. A third, an HTTP
 *     iframe driver, proves CodeMirror itself (Lua mode, gutter, line
 *     numbers, active line), save/reopen, Vim, the real DOM shortcuts and
 *     autosave across a reload. Without the flag the suite still covers 1-8
 *     in the stub DOM.
 * 11. #89 (REVIEW-31C S02/S04/S06): every file's source is in the save
 *     envelope and comes back after reopen (five of five, not two); Ctrl+S
 *     starts a real .pce.json download, not only an autosave; and a mounted
 *     CodeMirror's text — not the stale textarea — is what editorText()
 *     returns and what the page runs, through a stand-in that models
 *     CodeMirror's non-syncing textarea.
 * 12. #93: the LAYERS panel.  Four previews (backdrop, BG, sprites, composed)
 *     diff-0 against frames this check renders from CR values it computes
 *     itself; the layer toggles are CR bits (BB/SB) and the composed preview
 *     and the canvas agree with the renderer; a sprite's SPBG flipped in the
 *     view equals the renderer given a SAT this check patched; a 16-step fade
 *     is planned, its arithmetic re-done here channel by channel, written
 *     into main.lua and RUN for 17 frames — every frame's CRAM and pixels
 *     equal the computed palettes — and recorded as fade.json.  Refusals by
 *     code.  Blind spots in docs/STUDIO.md §12: the painted canvases are not
 *     pixel-diffed (the stub records calls), no raster-table toy is
 *     exercised, and the fade's source palettes are captured constants.
 * 13. #139: the resizable regions.  Each of the three dividers is a separator
 *     in the markup, focusable, with its own clamp; a pointer drag moves the
 *     region by the dragged pixels through the grid's custom properties, the
 *     clamp stops it at the minimum, arrows move it 8 px (Shift 40) and
 *     double-click/Home reset it, the saved sizes come back on a second page
 *     with the same storage, and the output frame's pixel digest is the same
 *     before and after.  The --browser driver does the same with in-page
 *     PointerEvents and reads the regions' rectangles.
 *
 * #90 adds a VISIBILITY assertion to every example: the frame the canvas drew
 * must be a picture at the expected place (57,344 / 7,168 / 256 non-backdrop
 * pixels), and the sprite example's block must move one column a frame while
 * the pad-right key is held — driven through the page's key handler and
 * studio.stepForward, never by writing state behind the page's back.
 *
 * #106 closes the #84/#90 breaker's misses here (docs/REVIEW-84.md,
 * docs/CHECK-106.md), each with a control that fails when the guard is
 * weakened:
 *   - the bucket stops at a tile of a different character (M02): a 2x2 $42
 *     island inside the $40 field must survive the fill;
 *   - a zoom chip never writes the BAT (M05): the map's cells and
 *     tiles.json's bytes are snapshotted around every chip;
 *   - the visible-screen outline's cell is computed here from BYR, not from
 *     the panel's arithmetic (M07) — the stub canvas now records rect()
 *     arguments, because it used to swallow the outline entirely;
 *   - the movement assertion is one function, `movesByPad`, and ten frames
 *     with NO pad held must fail it (M10).
 *
 * #116 closes eight of the nine misses the cold break in docs/REVIEW-PANELS.md
 * left here (each was MISSED on this suite; the ninth, 79-G2, is in
 * tests/check-pokes.js).  Each check is written so the mutant named there
 * fails it — re-run on a fresh clone with the break applied, 8/8 DETECTED —
 * and each is a bit the old fixture could not see:
 *   - 85-P2: a tooltip for palette 1 / sprite palette 2, where *8 and *16
 *     differ (palette 0 cannot tell them apart);
 *   - 86-S2: two sprites over one point, the lower SAT index wins;
 *   - 92-R2: a wobble's BXR on all 224 lines, against the check's own sine;
 *   - 93-L2: background palette 1's fade addresses (17-31, never $010);
 *   - 93-L3: a raster toy whose lines set CR — the layer mask reaches them;
 *   - 97-A2: the row's L/R balance sliders fired as DOM events;
 *   - 98-C2: the count with a warning but no error ("0 errors · 1 warning");
 *   - 107-P2: ```LUA / ```Luau fences, and the old source kept on a refusal.
 * Blind spots: this still cannot see the panels' painted pixels (the stub
 * canvas records calls) and does not exercise the browser driver for these
 * eight beyond what --browser already covers.
 *
 * Not measured here: layout and CSS (a screenshot is the evidence, under
 * $TMPDIR and described in docs/STUDIO.md), a real canvas's pixels (the stub
 * context records the calls, not the rendered result), the toy
 * compiler/export (#31, second half of #75), sound (#71), the asset importer
 * (#24/#71), and the agent link (#24).
 *
 *   node tests/check-studio.js
 *   node tests/check-studio.js --browser
 */
"use strict";

const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { pathToFileURL } = require("url");
const { execFileSync, spawn } = require("child_process");

const sprites = require("../renderer/pce-sprites.js");
const vramModel = require("../renderer/pce-vram-map.js");
/* #115 — the Export button's route 1, built in the page: the same three
 * modules tests/check-ilvm.js runs in Node, so the page's bytes can be held
 * against Node's without a second implementation. */
const il = require("../renderer/pce-il.js");
const ilbc = require("../renderer/pce-ilbc.js");
const romLib = require("../renderer/pce-rom.js");
const ILVM = path.join(__dirname, "..", "renderer", "ilvm.bin");

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
           TOY_RASTER: setup + raster, TOY_SPRITE: setup + sprite };
}

const ilExports = readIlToys();

/* #115 — what Node's buildToyRom makes of the two toys the browser driver
 * exports.  The driver compares the downloaded Blob's FNV-1a and length
 * against these; the byte-for-byte equality is the stub test's (checkExport
 * above) and check-ilvm.js's committed ROM shas. */
function fnv1a(bytes) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    h = Math.imul(h ^ bytes[i], 16777619) >>> 0;
  }
  return h >>> 0;
}
function toyRomExpectation(source) {
  const bank0 = fs.readFileSync(ILVM);
  const encoded = ilbc.encode(il.compile(source, { chunkName: "@main.lua" }));
  const bytes = romLib.buildToyRom({ bank0: bank0, bytecode: encoded.bytes });
  return { length: bytes.length, fnv: fnv1a(bytes),
           bytecodeBytes: encoded.bytes.length };
}
const EXPORT_EXPECT = {
  palette: toyRomExpectation(ilExports.TOY_PALETTE),
  /* #151: the parallax toy left Browse, so the gallery's remaining #29
   * raster toy is the one the page's Export builds here. */
  "sky-gradient": toyRomExpectation(fs.readFileSync(
    path.join(__dirname, "..", "toys", "sky-gradient.lua"), "utf8"))
};

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

/* A canvas context that draws nothing and remembers what it was asked to
 * draw.  Every drawing method is still a no-op (nothing is rendered in the
 * stub DOM), but its name and arguments are recorded in __calls, so geometry
 * the page paints — the #84 visible-screen outline, in particular — can be
 * read back by the evidence.  Before this, a wrong outline was invisible:
 * the Proxy swallowed rect() and strokeRect() alike. */
function stubContext() {
  const calls = [];
  return new Proxy({}, {
    get(_, key) {
      if (key === "__calls") return calls;
      if (key === "createImageData" || key === "getImageData") {
        return (w, h) => ({ width: w, height: h,
          data: new Uint8ClampedArray(w * h * 4) });
      }
      if (key === "measureText") return () => ({ width: 0 });
      if (key === "canvas") return null;
      return (...args) => { calls.push({ name: key, args: args }); };
    },
    set() { return true; }
  });
}

/* A localStorage stand-in: the stub DOM has no browser storage, and #77's
 * autosave is part of what this page promises. The same object is passed to
 * two runPage() calls to model a reload. */
function makeStorage() {
  const map = new Map();
  return {
    getItem(key) { return map.has(String(key)) ? map.get(String(key)) : null; },
    setItem(key, value) { map.set(String(key), String(value)); },
    removeItem(key) { map.delete(String(key)); },
    clear() { map.clear(); },
    key(i) { return Array.from(map.keys())[i] || null; },
    get length() { return map.size; },
    dump() { return new Map(map); }
  };
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
      /* One context per element, as a real canvas has: the recorder stays
       * reachable at el.__ctx across redraws. */
      getContext() { return this.__ctx || (this.__ctx = stubContext()); },
      setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; }
    };
    /* A created element with an id is findable by getElementById, as in a
     * real document — the dock tabs and #84's tool/zoom buttons are built
     * dynamically and the evidence clicks them by id. */
    let elId = String(id || "");
    Object.defineProperty(el, "id", {
      get() { return elId; },
      set(value) {
        elId = String(value || "");
        if (elId) byId.set(elId, el);
      }
    });
    if (elId) byId.set(elId, el);
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
      if (id === "vrammap") { el.width = 384; el.height = 384; }
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
      else if (id === "vrammap") { el.width = 384; el.height = 384; }
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

function runPage(search, storage, extra) {
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
    localStorage: storage || makeStorage(),
    FileReader: function FileReader() {},
    __now: 0
  };
  sandbox.performance = { now: () => sandbox.__now };
  /* #89 / S06: a fake window.CodeMirror, so a page whose real DOM cannot host
   * the vendored editor still mounts one.  It must be in the sandbox before
   * the page's inline script runs (mountEditor is called from init()). */
  if (extra) for (const k of Object.keys(extra)) sandbox[k] = extra[k];
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
  return { sandbox, dom, raf, loaded, inline: parts.inline,
           storage: sandbox.localStorage };
}

/* #80 — the Browse and toy pages are documents of their own.  This boots one
 * the way runPage() boots the studio: the scripts its tags name, then its
 * inline script, in the same stub DOM with the ids seeded from its markup.
 * The canvas still draws nothing here (the stub context records calls); the
 * --browser run is what reads pixels, and the page's own selftest is what it
 * reads. */
function runBarePage(file, search) {
  const html = fs.readFileSync(file, "utf8");
  const srcs = [];
  const reSrc = /<script\s+src="([^"]+)"\s*><\/script>/g;
  let m;
  while ((m = reSrc.exec(html))) srcs.push(m[1]);
  let inline = null;
  const reInline = /<script>([\s\S]*?)<\/script>/g;
  while ((m = reInline.exec(html))) inline = m[1];
  if (!inline) throw new Error(path.basename(file) + " has no inline script");
  if (!srcs.length) throw new Error(path.basename(file) + " names no scripts");
  const dom = makeStubDom();
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
    localStorage: makeStorage(),
    __now: 0
  };
  sandbox.performance = { now: () => sandbox.__now };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const dir = path.dirname(file);
  for (const src of srcs) {
    const target = path.resolve(dir, src);
    vm.runInContext(fs.readFileSync(target, "utf8"), sandbox,
      { filename: path.relative(path.join(__dirname, ".."), target) });
  }
  vm.runInContext(inline, sandbox,
    { filename: path.basename(file) + " <inline>" });
  return { sandbox, dom, raf };
}

/* ---- 1. the page boots ------------------------------------------------- */
function checkBoot(page) {
  const S = page.sandbox.PCEStudio;
  check(!!S && !!S.studio, "the page exposes PCEStudio.studio");
  if (!S || !S.studio) return;
  const studio = page.sandbox.PCEStudio.studio;
  check(studio.examples.length === 3,
        "the page carries three examples (got " + studio.examples.length + ")");
  check(studio.panels.length === 10,
        "the panel dock has ten PCE panels (got " + studio.panels.length + ")");
  check(page.loaded.some((s) => /pce-toys\.js$/.test(s)),
        "the page loads renderer/pce-toys.js");
  check(page.loaded.some((s) => /pce-il\.js$/.test(s)),
        "the page loads renderer/pce-il.js (the Lua/IL switch)");
  check(page.loaded.some((s) => /pce-panels\.js$/.test(s)),
        "the page loads renderer/pce-panels.js (the #26 panels)");
  check(studio.vim() === false, "plain editor keys are the default");
  check(studio.files().length === 5, "the page starts with a five-file toy");
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

/* ---- 1b. the Docs panel and the export message ------------------------ */
function clickOne(page, id) {
  const el = page.dom.get(id);
  const listeners = el.listeners.click || [];
  check(listeners.length > 0, id + " has a click handler");
  for (const fn of listeners) fn(page.dom.fakeEvent(el));
  return el;
}

function checkDocs(page) {
  const S = page.sandbox.PCEStudio;
  const studio = S.studio;
  check(!!S.docs && typeof S.docs.html === "function",
        "pce-docs.js loaded: the Docs panel has #61's generator");
  const docsFile = path.join(RENDERER, "docs.html");
  const raw = fs.readFileSync(docsFile, "utf8");
  const pageRaw = studio.docsHtml();
  check(pageRaw === raw,
        "the Docs panel's source is renderer/docs.html byte for byte (" +
        pageRaw.length + " vs " + raw.length + " bytes)");
  const injected = studio.docsPage();
  const frame = page.dom.get("docs-frame");
  check(typeof frame.srcdoc === "string" && frame.srcdoc === injected,
        "the docs iframe carries the injected #61 page");
  check(injected.indexOf("SEARCH THE GUIDE") >= 0,
        "the docs panel has ppu.toys' docs search");
  check(injected.indexOf('id="docs-map"') >= 0,
        "the docs panel has ppu.toys' chapter map");
  check(injected.indexOf('content:"THE FIELD GUIDE"') >= 0,
        "the docs panel has ppu.toys' hero kicker");
  const chapters = ["the-toy", "registers", "palettes", "sprites", "raster",
                    "pads", "passwords", "sound", "budgets", "refusals"];
  let found = 0;
  for (const id of chapters) if (injected.indexOf('id="' + id + '"') >= 0) found++;
  check(found === chapters.length,
        "all " + chapters.length + " generated chapters are in the panel (got " +
        found + ")");

  /* closed at load, opened by the top-bar button, closed by its × */
  check(page.dom.get("docs-panel").hidden === true,
        "the Docs panel starts closed");
  clickOne(page, "btn-docs");
  check(page.dom.get("docs-panel").hidden === false,
        "the top-bar Docs button opens the Docs panel");
  clickOne(page, "docs-close");
  check(page.dom.get("docs-panel").hidden === true,
        "the Docs panel's close button closes it");

  /* a panel's Guide opens the reference at that panel's chapter */
  clickOne(page, "dock-guide");
  check(page.dom.get("docs-panel").hidden === false,
        "the Guide button opens the Docs panel");
  check(studio.docsChapter() === "registers",
        "SCREEN's Guide opens the registers chapter (got " +
        JSON.stringify(studio.docsChapter()) + ")");
  studio.closeDocs();
  studio.openDocs("sprites");
  check(studio.docsChapter() === "sprites" && page.dom.get("docs-panel").hidden === false,
        "openDocs('sprites') lands on the sprites chapter");
  studio.closeDocs();

  /* #115: the export dialog is #87's spec, in the page's own markup — the
   * title, the close ×, the can't-run lead, the findings list, the footer
   * with the static-estimate sentence, and the route line.  The stub does
   * not parse static HTML into textContent, so the strings are read from the
   * file; the browser driver reads them rendered. */
  clickOne(page, "btn-export");
  check(page.dom.get("export-modal").hidden === false,
        "Export opens its dialog");
  const exportHtml = fs.readFileSync(PAGE, "utf8");
  check(/<h2 id="export-title">Export to ROM/.test(exportHtml),
        "the Export dialog's title is Export to ROM (#87's spec)");
  check(/id="export-close"[\s\S]{0,80}aria-label="Close the export dialog"/.test(
          exportHtml) || /aria-label="Close the export dialog"[\s\S]{0,80}id="export-close"/.test(
          exportHtml),
        "the Export dialog has ppu.toys' close ×");
  check(/id="export-findings"/.test(exportHtml),
        "the dialog has a findings list (#98's findings go there)");
  check(/Experimental: frame timing is\s+a static estimate, checked on an emulator, not on hardware\./.test(
          exportHtml),
        "the dialog's footer is the Experimental static-estimate sentence");
  clickOne(page, "export-close");
  check(page.dom.get("export-modal").hidden === true,
        "the Export dialog's × closes it");
  clickOne(page, "btn-export");
  clickOne(page, "export-done");
  check(page.dom.get("export-modal").hidden === true,
        "the Export dialog's Close button closes it");

  /* the same panel from a URL (this is how the screenshots open it) */
  const q = runPage("?docs=sprites&paused=1");
  check(q.dom.get("docs-panel").hidden === false,
        "?docs=<chapter> opens the Docs panel on load");
  check(q.sandbox.PCEStudio.studio.docsChapter() === "sprites",
        "?docs=sprites lands on the sprites chapter");
  q.sandbox.PCEStudio.studio.closeDocs();
}

/* ---- 1c. #115 — Export to ROM, built in the page ----------------------- *
 * The same three modules check-ilvm.js runs in Node are handed to the page's
 * own exportBytes(), and the bytes must be Node's byte for byte.  A toy the
 * CONSOLE tab refuses shows its findings; a toy the console accepts but the
 * IL bytecode cannot carry (timer()) is the encoder's own refusal, and it
 * must appear as a finding rather than a broken download. */
async function checkExport(page) {
  const studio = page.sandbox.PCEStudio.studio;
  const bank0 = fs.readFileSync(ILVM);
  function nodeBytes(source) {
    const program = il.compile(source, { chunkName: "@main.lua" });
    const encoded = ilbc.encode(program);
    return Buffer.from(romLib.buildToyRom({ bank0: bank0,
                                            bytecode: encoded.bytes }));
  }
  function pageBuild(where) {
    const got = studio.exportBytes(bank0);
    check(got.ok, where + ": the page exports the toy (" +
          JSON.stringify(got.findings) + ")");
    return got;
  }

  /* the studio's two examples, built in the page and in Node */
  for (const id of ["palette", "raster"]) {
    studio.loadExample(id, true);
    const source = studio.current().source;
    const got = pageBuild(id);
    if (!got.ok) continue;
    eq("#115: " + id + " export is 24,576 B", got.bytes.length, 24576);
    check(Buffer.from(got.bytes).equals(nodeBytes(source)),
          "#115: " + id + "'s page-built ROM is Node buildToyRom's bytes");
    eq("#115: " + id + "'s bytecode length is the encoder's",
       got.bytecodeBytes, ilbc.encode(il.compile(source)).bytes.length);
    check(/^[A-Za-z0-9._-]+\.pce$/.test(got.name),
          "#115: " + id + " downloads a .pce (" + got.name + ")");
    const route1 = got.route1;
    check(route1 && route1.collectionCycles > 0,
          "#115: " + id + "'s export carries route 1's projection");
  }

  /* #29's sky gradient, the raster case, through the page's gallery.  (#151
   * removed the parallax toy from Browse; its file is still in toys/ and
   * still tested, but the gallery no longer lists it, so this check uses the
   * remaining #29 raster toy.) */
  studio.loadExample("sky-gradient", true);
  const rasterSource = fs.readFileSync(path.join(__dirname, "..", "toys",
    "sky-gradient.lua"), "utf8");
  check(studio.current().source === rasterSource,
        "#115: the gallery loads toys/sky-gradient.lua's exact source");
  const par = pageBuild("sky-gradient");
  if (par.ok) {
    check(Buffer.from(par.bytes).equals(nodeBytes(rasterSource)),
          "#115: the sky gradient's ROM built in the page is Node's bytes");
    check(par.route1 && par.route1.shape === "raster" &&
          par.route1.meets60 === false,
          "#115: the validator says the raster route 1 does not meet 60 Hz");
    check(par.route1.collectionCycles > par.bytes.length * 100,
          "#115: the projection is the interpreter's cost, not the ROM's size");
  }

  /* the asset tail: a non-default file rides after the bytecode, and the
   * default empty files add nothing (so the evidence toys stay identical). */
  studio.loadExample("palette", true);
  const plain = studio.exportBytes(bank0);
  const tiles = studio.toy.file("tiles.json");
  tiles.source = '{"version":1,"tiles":[{"char":64}]}\n';
  const withTail = pageBuild("asset tail");
  if (plain.ok && withTail.ok) {
    /* The data bank is one 8 KiB bank, so the ROM's length does not change:
     * the tail starts right after the bytecode and the bank's 0xFF padding
     * follows it. */
    const tail = Buffer.from(JSON.stringify({ version: 1, files: [
      { name: "tiles.json", source: tiles.source }] }), "utf8");
    const at = 16384 + withTail.bytecodeBytes;
    eq("#115: the asset tail starts after the bytecode", at,
       16384 + plain.bytecodeBytes);
    check(Buffer.from(withTail.bytes.slice(at, at + tail.length))
      .equals(tail), "#115: the tail is the asset files' JSON bytes");
    check(withTail.bytes[at + tail.length] === 0xFF,
          "#115: … and 0xFF pads the rest of the data bank");
    check(withTail.bytes.length === plain.bytes.length,
          "#115: the tail rides inside the one data bank, not on top of it");
  }
  studio.loadExample("palette", true);

  /* a toy the CONSOLE tab refuses: its findings are the dialog's findings */
  studio.loadExample("palette", true);
  studio.setEditorText('function frame(t, f)\n  reg("NOPE", 0)\nend\n');
  const bad = studio.exportAnalysis();
  check(!bad.ok, "#115: a toy the CONSOLE tab refuses does not export");
  check(bad.findings.some((f) => f.code === "validate-range"),
        "#115: … its finding is the console's validate-range (" +
        bad.findings.map((f) => f.code).join(", ") + ")");
  check(bad.findings.some((f) => f.line === 2),
        "#115: … with main.lua:2 for the dialog's link");
  await studio.exportToy();
  const badDialog = studio.exportDialog();
  check(badDialog && badDialog.phase === "blocked",
        "#115: the dialog does not build a refused toy");
  check(badDialog && /This toy can't run on the PC Engine as written yet\.\s+The compiler's findings point at what to change:/
        .test(badDialog.lead),
        "#115: … and leads with #87's can't-run sentence (" +
        JSON.stringify(badDialog && badDialog.lead) + ")");
  check(badDialog && badDialog.findings.some((f) => f.line === 2),
        "#115: … with the findings the dialog lists");

  /* the console accepts timer(); route 1's encoder does not */
  studio.setEditorText("function init()\n  timer(60, function() end)\nend\n" +
                       "function frame(t, f)\nend\n");
  const con = studio.console();
  eq("#115: the timer toy has no console errors", con.errors, 0);
  const timer = studio.exportAnalysis();
  check(!timer.ok, "#115: a route-1-refused toy does not export");
  check(timer.findings.some((f) => /^ilbc-/.test(f.code)),
        "#115: … and the encoder's refusal is a finding (" +
        timer.findings.map((f) => f.code).join(", ") + ")");
  check(/route 1 cannot carry/.test((timer.findings.find((f) =>
        /^ilbc-/.test(f.code)) || {}).message || ""),
        "#115: … worded as route 1's refusal, not a compiler bug");

  /* the button's own action in the stub: no fetch, so it ends blocked with
   * the image finding instead of throwing */
  studio.loadExample("palette", true);
  page.dom.get("btn-export").click();
  await new Promise((resolve) => setImmediate(resolve));
  const dialog = studio.exportDialog();
  check(dialog && dialog.phase === "blocked",
        "#115: the Export button's action reports its state (" +
        JSON.stringify(dialog && dialog.phase) + ")");
  check(dialog && dialog.findings.some((f) => f.code === "export-image"),
        "#115: … naming the interpreter image it could not fetch in the stub");
  check(studio.exportOpen() === true, "#115: the dialog stays open on that");
  studio.loadExample("palette", true);
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

  /* The other controls that carry state, exercised on the real page code.
   * The button pass above clicked the asset tabs too, so come back to
   * main.lua: an asset edit must not become the Lua that runs. */
  studio.selectFile("main.lua");
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

/* ---- 6. #77: the editor and files ------------------------------------- */
function shortcut(studio, ev) {
  const e = Object.assign({
    key: "", code: "", ctrlKey: false, metaKey: false, shiftKey: false,
    altKey: false, target: null,
    preventDefault() {}, stopPropagation() {}
  }, ev || {});
  return studio.handleShortcut(e);
}

function codeOf(fn) {
  try { fn(); return "no-throw"; }
  catch (e) { return e.code || ("plain:" + (e.message || e)); }
}

function checkFiles(page) {
  const studio = page.sandbox.PCEStudio.studio;
  const html = fs.readFileSync(PAGE, "utf8");

  /* The editor is CodeMirror in a real browser, vendored with its notice. */
  const cmPath = path.join(__dirname, "..", "vendor", "codemirror");
  check(fs.existsSync(path.join(cmPath, "LICENSE")) &&
        /MIT License/.test(fs.readFileSync(path.join(cmPath, "LICENSE"), "utf8")),
        "CodeMirror is vendored with its MIT notice");
  for (const f of ["lib/codemirror.js", "lib/codemirror.css",
                   "mode/lua/lua.js", "addon/selection/active-line.js",
                   "keymap/vim.js"]) {
    check(fs.existsSync(path.join(cmPath, f)),
          "vendor/codemirror/" + f + " is present");
  }
  check(html.indexOf("vendor/codemirror/lib/codemirror.js") >= 0 &&
        html.indexOf("vendor/codemirror/mode/lua/lua.js") >= 0 &&
        html.indexOf("vendor/codemirror/keymap/vim.js") >= 0,
        "studio.html loads CodeMirror, its Lua mode and its Vim keymap");
  check(studio.editorKind() === "textarea",
        "the stub DOM keeps the textarea fallback (real DOM: CodeMirror)");

  /* A toy is a file set beside main.lua. */
  studio.loadExample("palette", true);
  studio.pause();
  const names = studio.fileNames();
  check(names.length === 5 &&
        names[0] === "main.lua" &&
        names.indexOf("tiles.json") >= 0 &&
        names.indexOf("palettes.json") >= 0 &&
        names.indexOf("sprites.json") >= 0 &&
        names.indexOf("waves.json") >= 0,
        "a toy is main.lua plus tiles/palettes/sprites/waves beside it (" +
        names.join(", ") + ")");
  check(studio.activeFile() === "main.lua",
        "main.lua is the active file after loading an example");

  /* The editor's text is what runs. Change a colour the palette toy writes
   * every frame and the pixels must move; the source the page reports must
   * be the editor's text, not the example on disk. */
  const original = studio.examples[0].source;
  const edited = original.replace(
    "rgb((e + f) % 8, f % 8, (e * 3 + f) % 8)", "rgb(0, 0, 0)");
  check(edited !== original, "the check can produce a different toy source");
  const baseFrames = studio.runFrames(3, "palette", "lua");
  studio.setEditorText(edited);
  const editedFrames = studio.runFrames(3, null, "lua");
  check(studio.editorText() === edited,
        "the editor returns the text that was put in it");
  check(studio.current().source === edited,
        "the Lua the page will run is the editor's text");
  let moved = 0;
  for (let i = 0; i < Math.min(baseFrames[2].pixels.length,
                               editedFrames[2].pixels.length); i++) {
    if (baseFrames[2].pixels[i] !== editedFrames[2].pixels[i]) moved++;
  }
  check(moved > 0, "an edit to the editor's text changes the frame it runs (" +
        moved + " bytes moved in frame 2)");

  /* An asset edit must not become the Lua that runs.  Since #117 the files
   * are also the toy's starting VRAM/CRAM, so the edit is a VALID tiles.json
   * (one blank tile) — an unreadable one is refused by the importer when the
   * runtime is rebuilt, which is a different check (the refusal is the
   * panels' asset-shape, not this round-trip's subject). */
  studio.selectFile("tiles.json");
  const assetText = '{"version":1,"tiles":[{"char":64,"palette":0,"pixels":[' +
    new Array(64).fill(0).join(",") + ']}]}\n';
  studio.setEditorText(assetText);
  check(studio.current().source === edited,
        "editing an asset file leaves the running Lua unchanged");
  check(studio.files().find((f) => f.name === "tiles.json").source === assetText,
        "the asset edit lands in tiles.json");
  check(studio.activeFile() === "tiles.json",
        "selecting an asset makes it the editor's file");
  studio.selectFile("main.lua");
  check(studio.editorText() === edited && studio.activeFile() === "main.lua",
        "switching back restores main.lua's editor text");

  /* Save and reopen: one JSON envelope, byte-identical both ways.  #89 /
   * S02: the review dropped palettes.json's source and the suite stayed
   * green, because only main.lua's and tiles.json's sources were compared
   * (and save/reopen lost the same text on both sides).  Snapshot all five
   * files first and compare every one. */
  const filesBefore = studio.files().map((f) => ({ name: f.name,
                                                   source: f.source }));
  const saved = studio.saveToy();
  check(/\.pce\.json$/.test(saved.name),
        "Save file names a .pce.json envelope (got " + saved.name + ")");
  let env = null;
  try { env = JSON.parse(saved.text); } catch (e) { /* checked below */ }
  check(!!env && env.version === "pce.studio/1",
        "the saved toy carries version pce.studio/1");
  check(!!env && Array.isArray(env.files) && env.files.length === 5 &&
        env.files[0].name === "main.lua" &&
        env.files.some((f) => f.name === "tiles.json"),
        "the envelope carries every file in order, main.lua first");
  check(!!env && Array.isArray(env.sources) && env.sources.length === 0,
        "the envelope keeps ppu.toys' sources slot (empty until #24)");
  {
    const envFiles = (env && Array.isArray(env.files) ? env.files : [])
      .map((f) => ({ name: f.name, source: f.source }));
    const wrong = filesBefore.filter((f, i) => !envFiles[i] ||
      envFiles[i].name !== f.name || envFiles[i].source !== f.source);
    check(filesBefore.length === 5 && wrong.length === 0,
          "the envelope carries every file's source exactly (five of five)" +
          (wrong.length ? "; wrong: " + wrong.map((f) => f.name).join(", ") +
           " (envelope has " + envFiles.length + " files)" : ""));
  }
  const before = studio.envelopeText();
  studio.loadExample("raster", true);           /* move away from the toy */
  studio.openToy(saved.text, saved.name);
  const after = studio.envelopeText();
  check(saved.text === after, "a saved toy reopened is byte-identical");
  check(before === after, "reopening does not rewrite the toy silently");
  check(studio.editorText() === edited && studio.current().source === edited,
        "reopening restores the editor and the Lua that runs");
  {
    const reopened = studio.files().map((f) => ({ name: f.name,
                                                  source: f.source }));
    const wrong = filesBefore.filter((f, i) => !reopened[i] ||
      reopened[i].name !== f.name || reopened[i].source !== f.source);
    check(reopened.length === 5 && wrong.length === 0,
          "reopening restores every asset file's bytes (five of five)" +
          (wrong.length ? "; wrong: " + wrong.map((f) => f.name).join(", ")
           : ""));
  }

  /* Autosave is the whole toy, not one string. Run a second page against the
   * same storage: that is a reload for the page's purposes. */
  check(page.storage.getItem("pcestudio.toy.v1") !== null,
        "edits autosave the toy to browser storage");
  const reloaded = runPage("", page.storage);
  const again = reloaded.sandbox.PCEStudio.studio;
  check(again.editorText() === edited,
        "autosave survives a reload (the editor comes back with the edit)");
  check(again.current().source === edited,
        "autosave survives a reload (the reloaded page runs the same Lua)");
  check(again.files().find((f) => f.name === "tiles.json").source === assetText,
        "autosave survives a reload (asset files included)");
  check(/restored from this browser/.test(
          reloaded.dom.get("saved").textContent),
        "the reloaded page says it restored the toy from this browser");

  /* The ppu.toys guards: version, names, duplicates, main.lua. Validate
   * before replacing anything, and refuse with a code. */
  const good = JSON.parse(saved.text);
  check(codeOf(() => studio.parseToy(
          JSON.stringify(Object.assign({}, good, { version: "ppu.toys/1" })),
          "x.pce.json")) === "toy-file-version",
        "a foreign version is refused by code (toy-file-version)");
  const dup = JSON.parse(saved.text);
  dup.files.push(JSON.parse(JSON.stringify(dup.files[0])));
  check(codeOf(() => studio.parseToy(JSON.stringify(dup), "x.pce.json")) ===
        "toy-file-duplicate", "a duplicate file name is refused");
  const unsafe = JSON.parse(saved.text);
  unsafe.files[0].name = "../evil.lua";
  check(codeOf(() => studio.parseToy(JSON.stringify(unsafe), "x.pce.json")) ===
        "toy-file-name", "an unsafe file name is refused");
  const noMain = JSON.parse(saved.text);
  noMain.files = noMain.files.slice(1);
  check(codeOf(() => studio.parseToy(JSON.stringify(noMain), "x.pce.json")) ===
        "toy-file-main", "a toy without main.lua is refused");
  check(codeOf(() => studio.parseToy("{ not json", "x.pce.json")) ===
        "toy-file-json", "a broken envelope is refused by code (toy-file-json)");
  const plain = studio.parseToy("function init() end\n", "one.lua");
  check(plain.files.length === 5 && plain.files[0].name === "main.lua" &&
        plain.files[0].source === "function init() end\n",
        "a plain .lua opens as a toy with the default asset files");

  /* Leave the page on the palette example, paused. */
  studio.loadExample("palette", true);
  studio.pause();
}

/* ---- 6b. the CodeMirror editorText path (#89 / S06) -------------------- */
/* The stub DOM has no window.CodeMirror, so the default run only exercises
 * the textarea fallback — which is exactly why the review's S06 break
 * (editorText() always reading the stale textarea) passed.  This page mounts
 * a stand-in that behaves like CodeMirror where it matters: fromTextArea
 * takes the textarea's text once, the textarea is NOT kept in sync, and an
 * edit arrives through the change handler. */
function fakeCodeMirror() {
  function CM() {
    throw new Error("fake CodeMirror: the page only calls fromTextArea");
  }
  CM.fromTextArea = function (textarea) {
    return {
      opts: {},
      text: String((textarea && textarea.value) || ""),
      handlers: {},
      getValue() { return this.text; },
      setValue(v) { this.text = String(v == null ? "" : v); },
      getOption(name) { return this.opts[name]; },
      setOption(name, value) { this.opts[name] = value; },
      on(name, fn) {
        (this.handlers[name] = this.handlers[name] || []).push(fn);
      },
      focus() {},
      refresh() {},
      /* a keystroke that replaces the buffer and fires "change" */
      type(text) {
        this.text = String(text);
        for (const fn of (this.handlers.change || []).slice()) fn(this);
      },
      somethingSelected() { return false; },
      replaceSelection() {},
      indentSelection() {}
    };
  };
  return CM;
}

function checkCodeMirrorEditorText() {
  const page = runPage("?paused=1", makeStorage(),
                       { CodeMirror: fakeCodeMirror() });
  const studio = page.sandbox.PCEStudio.studio;
  check(studio.editorKind() === "codemirror",
        "the stub can mount a CodeMirror stand-in (got " +
        studio.editorKind() + ")");
  const cm = studio.codeMirror();
  check(!!cm, "the page holds the mounted editor instance");
  if (!cm) return;

  /* The stand-in took the textarea's text once at mount.  From here the
   * textarea is stale, as CodeMirror leaves it. */
  const typed = studio.editorText() + "\n-- typed in codemirror-77\n";
  page.dom.get("source").value = "-- stale textarea text\n";
  cm.type(typed);

  check(studio.editorText() === typed,
        "editorText() is CodeMirror's text, not the stale textarea's (" +
        JSON.stringify(String(studio.editorText()).slice(0, 40)) + ")");
  check(studio.current().source === typed,
        "the Lua the page runs is CodeMirror's text");
  const main = studio.files().find((f) => f.name === "main.lua");
  check(!!main && main.source === typed,
        "the CodeMirror edit lands in main.lua");
  check(page.dom.get("source").value === "-- stale textarea text\n",
        "the stand-in leaves the textarea stale (as CodeMirror does)");
}

/* ---- 7. every PCE shortcut of docs/STUDIO.md §5 ------------------------ */
function checkShortcuts(page) {
  const studio = page.sandbox.PCEStudio.studio;
  const storage = page.storage;

  /* Space: play / pause, but only outside a text field. */
  studio.loadExample("palette", true);
  studio.pause();
  check(shortcut(studio, { key: " ", code: "Space" }) === true,
        "Space is a page shortcut");
  check(studio.isPlaying() === true, "Space plays");
  shortcut(studio, { key: " ", code: "Space" });
  check(studio.isPlaying() === false, "Space pauses");
  const typing = page.dom.document.createElement("textarea");
  check(shortcut(studio, { key: " ", code: "Space", target: typing }) === false,
        "Space in a text field is a character, not transport");
  check(studio.isPlaying() === false, "typing Space does not start the toy");

  /* R: restart from frame 0 and play. */
  studio.seek(5);
  check(shortcut(studio, { key: "r", code: "KeyR" }) === true,
        "R is a page shortcut");
  check(studio.current().frame === 0 && studio.isPlaying() === true,
        "R restarts at frame 0 and plays");
  studio.pause();

  /* Ctrl/Cmd+Enter: compile the editor's text and run. */
  const ctrlRun = studio.editorText() + "\n-- ctrl+enter\n";
  studio.setEditorText(ctrlRun);
  check(shortcut(studio, { key: "Enter", ctrlKey: true }) === true,
        "Ctrl+Enter is a page shortcut");
  check(studio.current().source.endsWith("-- ctrl+enter\n") &&
        studio.isPlaying() === true,
        "Ctrl+Enter runs the editor's text");
  studio.pause();

  /* Ctrl/Cmd+. and Ctrl/Cmd+, step one frame. */
  studio.seek(3);
  check(shortcut(studio, { key: ".", ctrlKey: true }) === true,
        "Ctrl+. is a page shortcut");
  check(studio.current().frame === 4, "Ctrl+. steps one frame forward");
  check(shortcut(studio, { key: ",", metaKey: true }) === true,
        "Cmd+, is a page shortcut");
  check(studio.current().frame === 3, "Ctrl/Cmd+, steps one frame back");

  /* Ctrl/Cmd+S saves the toy envelope, not just main.lua.  #89 / S04: the
   * review rebound the shortcut to autosave only (persistToy), and the
   * storage assertion below still passed — persistToy writes the same
   * envelope.  The shortcut must reach the FILE path, so watch the anchor
   * downloadText() creates and the file it would save. */
  studio.setEditorText(studio.editorText() + "\n-- saved by shortcut\n");
  const downloads = [];
  const anchorDoc = page.dom.document;
  const makeAnchor = anchorDoc.createElement;
  anchorDoc.createElement = function (tag) {
    const el = makeAnchor.call(anchorDoc, tag);
    if (String(tag).toLowerCase() === "a") {
      const click = el.click;
      el.click = function () {
        downloads.push({ download: el.download, href: el.href });
        return click.call(el);
      };
    }
    return el;
  };
  try {
    check(shortcut(studio, { key: "s", ctrlKey: true }) === true,
          "Ctrl+S is a page shortcut");
  } finally {
    anchorDoc.createElement = makeAnchor;
  }
  eq("Ctrl+S starts exactly one download", downloads.length, 1);
  check(downloads.length === 1 && /\.pce\.json$/.test(String(downloads[0].download)),
        "Ctrl+S downloads a .pce.json file (got " +
        (downloads[0] ? downloads[0].download : "no download") + ")");
  let filePayload = null;
  if (downloads.length === 1 &&
      /^data:application\/json[^,]*,/.test(String(downloads[0].href))) {
    try {
      filePayload = decodeURIComponent(
        String(downloads[0].href).replace(/^data:[^,]*,/, ""));
    } catch (e) { /* checked below */ }
  }
  check(!!filePayload && filePayload.indexOf("-- saved by shortcut") >= 0 &&
        /"files"/.test(filePayload),
        "the downloaded file is the toy envelope with the edit in it");
  check(/^saved .*\.pce\.json$/.test(page.dom.get("saved").textContent),
        "Ctrl+S says which file it saved (got " +
        JSON.stringify(page.dom.get("saved").textContent) + ")");
  const storedToy = storage.getItem("pcestudio.toy.v1") || "";
  check(storedToy.indexOf("-- saved by shortcut") >= 0 &&
        /"files"/.test(storedToy),
        "Ctrl+S also autosaves the whole toy envelope");

  /* Escape closes whatever is open. */
  page.dom.get("open-pop").hidden = false;
  page.dom.get("settings-pop").hidden = false;
  check(shortcut(studio, { key: "Escape" }) === true,
        "Escape is a page shortcut");
  check(page.dom.get("open-pop").hidden === true &&
        page.dom.get("settings-pop").hidden === true,
        "Escape closes the open popovers");

  /* Tab indents in the editor's fallback (CodeMirror handles it in a real
   * browser; the headless run exercises that one). */
  studio.selectFile("main.lua");
  const source = page.dom.get("source");
  const beforeTab = source.value;
  source.selectionStart = source.selectionEnd = 0;
  for (const fn of source.listeners.keydown || []) {
    fn({ key: "Tab", code: "Tab", target: source,
         preventDefault() {}, stopPropagation() {} });
  }
  check(source.value === "  " + beforeTab,
        "Tab inserts two spaces in the fallback editor");

  /* The pad keys while the output has focus (ppu.toys' §5.1 controller row,
   * with the PCE's 2-button pad). */
  const canvas = page.dom.get("out");
  for (const fn of canvas.listeners.keydown || []) {
    fn({ code: "KeyL", key: "l", target: canvas,
         preventDefault() {}, stopPropagation() {} });
  }
  check(studio.pad().right === true, "L holds pad right while the output has focus");
  for (const fn of canvas.listeners.keyup || []) {
    fn({ code: "KeyL", key: "l", target: canvas,
         preventDefault() {}, stopPropagation() {} });
  }
  check(studio.pad().right === undefined, "releasing L releases pad right");

  /* Vim is opt-in in Settings; the button pass above may have left it on. */
  studio.setVim(false);
  check(studio.vim() === false, "plain keys are the default after toggling");
  studio.setVim(true);
  check(studio.vim() === true && studio.settings().vim === true,
        "Settings → Vim turns the Vim keymap on");
  check(/(\"vim\":true)/.test(storage.getItem("pcestudio.settings.v1") || ""),
        "the Vim choice is saved with the settings");
  studio.setVim(false);
  check(studio.vim() === false, "Settings → Plain turns it off again");

  studio.loadExample("palette", true);
  studio.pause();
  studio.seek(0);
}

/* ---- 9. #78: the output column ---------------------------------------- *
 * Each control is exercised through the page's own state and the pixels are
 * compared with renderer/pce-sprites.js drawing the same frame with the
 * layer's CR bit cleared — the model the toy runtime itself uses. */
function renderMasked(page, clearBits) {
  const rt = page.sandbox.PCEStudio.studio.runtime();
  const opts = rt.options();
  opts.regs = Object.assign({}, opts.regs);
  opts.regs.CR = (opts.regs.CR & ~clearBits) & 0xFF;
  return sprites.renderFrame(opts).pixels;
}

/* Pixels whose RGB differs, not bytes: diffCount counts channels, and a
 * layer change that keeps one channel equal would look smaller than it is. */
function pixelDiffCount(a, b) {
  let n = 0;
  for (let i = 0; i + 2 < a.length && i + 2 < b.length; i += 3) {
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++;
  }
  return n;
}

function runEditorSource(studio, source) {
  studio.selectFile("main.lua");
  studio.setEditorText(source);
  studio.handleShortcut({ key: "Enter", code: "Enter", ctrlKey: true,
    metaKey: false, shiftKey: false, altKey: false, target: null,
    preventDefault() {}, stopPropagation() {} });
  studio.pause();
  studio.seek(0);
}

function checkOutputColumn(page) {
  const S = page.sandbox.PCEStudio;
  const studio = S.studio;
  const html = fs.readFileSync(PAGE, "utf8");
  const seek = page.dom.get("seek");
  const length = page.dom.get("length");

  /* -- the resolution label follows the dot clock (256/341/512) -- */
  const labels = [0, 1, 2, 3].map((v) => studio.resolutionFor(v).label);
  eq("resolution at VCE CR DCC 00/01/10/11", labels,
     ["256×224", "341×224", "512×224", "512×224"]);
  check(studio.resolutionFor(1).width === S.bg.DOT_CLOCK.frameWidth[1] &&
        studio.resolutionFor(2).width === S.bg.DOT_CLOCK.frameWidth[2],
        "the label's widths are renderer/pce-bg.js's DOT_CLOCK table");
  check(/5\.37 MHz/.test(studio.resolutionFor(0).title) &&
        /7\.16 MHz/.test(studio.resolutionFor(1).title) &&
        /10\.74 MHz/.test(studio.resolutionFor(2).title),
        "the label names the dot clock of the selected VCE CR");
  studio.loadExample("palette", true);
  studio.pause();
  studio.seek(0);
  const live = studio.resolution();
  check(live.width === 256 && live.height === 224 && live.dotClock === 0,
        "the live toy " + live.width + "×" + live.height + " on dot clock " +
        live.dotClock);
  check(page.dom.get("res").textContent === "256×224" &&
        /VCE dot clock 5\.37 MHz/.test(page.dom.get("res").title),
        "the output row's label reads " + page.dom.get("res").textContent);

  /* -- Layers: BG through CR bit 7 (BB) -- */
  const paletteOn = studio.output();
  samePixels("the canvas shows the palette toy's own frame",
             paletteOn.pixels, studio.runtime().last.pixels);
  const bgOffPixels = renderMasked(page, 0x80);
  studio.setLayer("bg", false);
  check(studio.layers().bg === false && studio.layers().viewOnly === false,
        "Layers → BG clears the layer in the hardware mode");
  samePixels("BG off is the renderer with CR bit 7 clear",
             studio.output().pixels, bgOffPixels);
  const bgDiff = pixelDiffCount(paletteOn.pixels, studio.output().pixels);
  check(bgDiff === paletteOn.width * paletteOn.height,
        "BG off changes every pixel (BB blanks the whole background): " +
        bgDiff + " of " + (paletteOn.width * paletteOn.height));
  let allBlank = true;
  for (let i = 0; i < studio.output().pixels.length; i++) {
    if (studio.output().pixels[i] !== 0) { allBlank = false; break; }
  }
  check(allBlank, "with BB clear every pixel is CRAM[$100] (colour 0 here)");
  check(studio.state().regs.CR === 0x00 &&
        studio.runtime().state.regs.CR === 0x00,
        "the live VDC's CR bit 7 is clear, the way a register write would");
  studio.setLayer("bg", true);
  samePixels("BG on restores the toy's frame", studio.output().pixels,
             paletteOn.pixels);
  check(studio.state().regs.CR === 0x80,
        "BG on restores CR bit 7 the toy wrote");

  /* -- Layers: sprites through CR bit 6 (SB) -- *
   * The page's own sprite-pad.lua (no fixture: #90 fixed it, and this is
   * the example whose picture the screenshot must show).  At frame 0 no
   * pad is held, so its solid 16×16 block stands at display (112,96): SAT
   * X 32 / Y 64 is the top-left corner, and the toy starts at X 144 / Y 160
   * (pce-sprites.js; SPR_X / SPR_Y below are that place). */
  studio.loadExample("sprite", true);
  studio.pause();
  studio.seek(0);
  check(page.dom.get("doc-title").textContent === "sprite-pad.lua",
        "the Sprite layer check runs the page's own sprite-pad.lua");
  const spriteOn = studio.output();
  const sprOffPixels = renderMasked(page, 0x40);
  studio.setLayer("sprites", false);
  samePixels("SPR off is the renderer with CR bit 6 clear",
             studio.output().pixels, sprOffPixels);
  const sprDiff = pixelDiffCount(spriteOn.pixels, studio.output().pixels);
  check(sprDiff === 16 * 16,
        "SPR off changes exactly the 16×16 sprite: " + sprDiff + " pixels");
  let outside = 0;
  for (let y = 0; y < spriteOn.height; y++) {
    for (let x = 0; x < spriteOn.width; x++) {
      const i = (y * spriteOn.width + x) * 3;
      const changed = spriteOn.pixels[i] !== studio.output().pixels[i] ||
        spriteOn.pixels[i + 1] !== studio.output().pixels[i + 1] ||
        spriteOn.pixels[i + 2] !== studio.output().pixels[i + 2];
      if (changed && (x < SPR_X || x > SPR_X + 15 ||
                      y < SPR_Y || y > SPR_Y + 15)) outside++;
    }
  }
  check(outside === 0, "no pixel outside the sprite's 16×16 box changed (" +
        outside + " did)");
  check(studio.state().regs.CR === 0x80,
        "SPR off clears CR bit 6 and leaves bit 7 set");
  studio.setLayer("sprites", true);
  samePixels("SPR on restores the sprite", studio.output().pixels,
             spriteOn.pixels);

  /* -- View only: the same picture, no register write -- */
  studio.loadExample("palette", true);
  studio.pause();
  studio.seek(0);
  studio.setLayerViewOnly(true);
  const crBefore = studio.runtime().state.regs.CR;
  studio.setLayer("bg", false);
  samePixels("View only BG off draws the same blank frame",
             studio.output().pixels, renderMasked(page, 0x80));
  check(studio.runtime().state.regs.CR === crBefore &&
        studio.state().regs.CR === 0x80,
        "View only leaves the toy's CR alone (" +
        studio.runtime().state.regs.CR + ")");
  studio.seek(3);
  check(studio.runtime().state.regs.CR === 0x80,
        "View only keeps the toy's CR across a seek");
  let stillBlank = true;
  for (let i = 0; i < studio.output().pixels.length; i++) {
    if (studio.output().pixels[i] !== 0) { stillBlank = false; break; }
  }
  check(stillBlank, "the hidden layer stays hidden on every frame of a seek");
  studio.setLayerViewOnly(false);
  check(studio.runtime().state.regs.CR === 0x00,
        "leaving View only applies the hidden layer to CR");
  studio.setLayer("bg", true);
  check(studio.runtime().state.regs.CR === 0x80,
        "showing BG again restores the bit the toy set");
  /* A layer shown while still in View only is restored when the mode ends:
   * View only never writes CR, so the bit comes back on the way out. */
  studio.setLayer("bg", false);
  studio.setLayerViewOnly(true);
  studio.setLayer("bg", true);
  check(studio.runtime().state.regs.CR === 0x00,
        "showing a layer in View only still does not write CR");
  studio.setLayerViewOnly(false);
  check(studio.runtime().state.regs.CR === 0x80,
        "leaving View only restores a layer that was shown in it");
  studio.setLayer("sprites", true);

  /* -- #91 / REVIEW-78 S02/S05: a raster table's CR is gated too --------- *
   * The layer cases above run the page's examples, which have no raster
   * table, so maskedRaster's per-entry rewrite was never exercised: REVIEW-78
   * S02 leaked 57,344 background pixels from a raster entry that turned CR's
   * BG bit on, and S05 the same from a table's base.cr, both in View only
   * with BG hidden.  Two fixtures, one per path:
   *
   *   S02: the raster callback sets CR = $C0 at line 32 (an entry with cr).
   *   S05: init() sets CR = $C0 and the callback only writes BXR, so every
   *        line starts from the table's base.cr.
   *
   * Each case proves the fixture is worth checking before it asserts the
   * mask: the table really carries the CR the break would leak (an entry
   * with bit 7 for S02, a base with bit 7 and no cr entries for S05), and
   * the picture with every layer shown is a picture, so "every pixel is
   * CRAM[$100]" cannot be true merely because the toy draws nothing. */
  function litPixels(img) {
    let n = 0;
    for (let i = 0; i + 2 < img.pixels.length; i += 3) {
      if (img.pixels[i] !== 0 || img.pixels[i + 1] !== 0 ||
          img.pixels[i + 2] !== 0) n++;
    }
    return n;
  }
  function rasterMaskCase(label, source, shape) {
    studio.setLayerViewOnly(false);
    studio.setLayer("bg", true);
    studio.setLayer("sprites", true);
    runEditorSource(studio, ilExports.SETUP + source);
    const table = studio.runtime().lastRaster;
    check(!!table && table.entries.length > 0,
          label + ": the fixture builds a raster table (" +
          (table ? table.entries.length : 0) + " entries)");
    const problem = shape(table);
    check(problem === null, label + ": the fixture reaches the mask's path" +
          (problem ? " — " + problem : " (the table carries the CR the break " +
           "would leak)"));
    const on = studio.output();
    const lit = litPixels(on);
    check(lit > (on.width * on.height) / 2,
          label + ": with every layer shown the background is drawn (" + lit +
          " of " + (on.width * on.height) + " pixels)");
    studio.setLayerViewOnly(true);
    studio.setLayer("bg", false);
    const hidden = studio.output();
    const leaked = litPixels(hidden);
    check(leaked === 0, label + ": with BG hidden in View only every pixel is " +
          "CRAM[$100] (" + leaked + " pixels are drawn; the raster table's CR " +
          "must go through the same mask as the frame's)");
    studio.setLayerViewOnly(false);
    studio.setLayer("bg", true);
    studio.setLayer("sprites", true);
  }

  rasterMaskCase(
    "S02 raster entry with CR",
    `
function init()
  for y = 0, 27 do
    for x = 0, 31 do vram[y * 32 + x] = 0x0040 end
  end
  puttile(0x40, function(col, row) return 1 end)
  pal(1, rgb(7, 7, 7))
end
function frame(t, f) end
function raster(line)
  if line == 32 then reg("CR", 0xC0) end
end
`,
    (table) => {
      if (!table) return "no table";
      const crs = table.entries.filter((e) => e.cr != null);
      if (!crs.length) return "no entry carries cr";
      if (!crs.some((e) => (e.cr & 0x80) !== 0))
        return "no entry sets CR bit 7 (" +
               crs.map((e) => "$" + e.cr.toString(16)).join(", ") + ")";
      return null;
    });

  rasterMaskCase(
    "S05 raster base with CR",
    `
function init()
  for y = 0, 27 do
    for x = 0, 31 do vram[y * 32 + x] = 0x0040 end
  end
  puttile(0x40, function(col, row) return 1 end)
  pal(1, rgb(7, 7, 7))
  reg("CR", 0xC0)
end
function frame(t, f) end
function raster(line)
  if line == 0 then reg("BXR", 0) end
end
`,
    (table) => {
      if (!table) return "no table";
      if (table.entries.some((e) => e.cr != null))
        return "an entry carries cr, so the base is not the latch";
      if (!table.base || (table.base.cr & 0x80) === 0)
        return "base.cr does not set CR bit 7";
      return null;
    });

  /* -- markers: add at the current frame, click to seek -- */
  studio.loadExample("palette", true);
  studio.pause();
  studio.seek(7);
  studio.addMarker();
  studio.seek(3);
  studio.addMarker();
  studio.addMarker();
  const marks = studio.markers();
  check(marks.indexOf(7) >= 0 && marks.indexOf(3) >= 0 &&
        marks.indexOf(3) === marks.lastIndexOf(3),
        "markers are added once each at the current frame (" +
        JSON.stringify(marks) + ")");
  check(marks.every((m, i) => i === 0 || marks[i - 1] <= m),
        "the marker list is sorted");
  studio.seek(0);
  const markerList = page.dom.get("marker-list");
  const markerButtons = markerList.children.filter((el) =>
    /frame \d+/.test(el.textContent));
  check(markerButtons.length === marks.length,
        "each marker has a button (" + markerButtons.length + " of " +
        marks.length + ")");
  const at7 = markerButtons.find((b) => b.textContent === "frame 7");
  check(!!at7, "the frame-7 marker is in the list");
  if (at7) {
    at7.click();
    check(studio.current().frame === 7 && studio.isPlaying() === false,
          "clicking a marker seeks to its frame and pauses (frame " +
          studio.current().frame + ")");
  }

  /* -- the scrubber's length holds -- */
  studio.setLength(120);
  check(studio.length() === 120 && seek.max === "119" &&
        length.value === "120",
        "Length 120 sets the slider's max to 119");
  studio.seek(500);
  check(studio.current().frame === 119,
        "a seek past the length clamps to the last frame (" +
        studio.current().frame + ")");
  studio.seek(100);
  studio.setLength(50);
  check(studio.length() === 50 && studio.current().frame === 49,
        "shortening the length moves the playhead inside it (" +
        studio.current().frame + ")");
  check(studio.setLength(0) === 1 && seek.max === "0",
        "Length clamps up to 1 frame");
  check(studio.setLength(99999) === 3600 && seek.max === "3599",
        "Length clamps down to 3600 frames");
  studio.setLength(300);

  /* -- the CRT look is a real scanline overlay -- */
  const wrap = page.dom.get("canvas-wrap");
  const crtWas = wrap.classList.contains("crt");
  clickOne(page, "btn-crt");
  check(wrap.classList.contains("crt") === !crtWas &&
        page.dom.get("btn-crt").getAttribute("aria-pressed") ===
          String(!crtWas),
        "CRT toggles the canvas's scanline overlay");
  clickOne(page, "btn-crt");
  check(wrap.classList.contains("crt") === crtWas, "CRT toggles back");
  check(/\.canvas-wrap\.crt::after/.test(html) &&
        /repeating-linear-gradient/.test(html),
        "the CRT look is the page's repeating scanline gradient");

  /* -- SND: the honest state until #71 -- */
  check(/id="btn-snd"[^>]*aria-pressed="false"/.test(html) &&
        /No toy sound surface until #71/.test(html),
        "SND is not claiming a sound that is off, and its tooltip names #71");
  clickOne(page, "btn-snd");
  check(/Sound is card #71/.test(page.dom.get("toast").textContent) &&
        /PSG model/.test(page.dom.get("toast").textContent),
        "SND says the PSG model exists but toys have no sound surface (#71)");
  check(page.dom.get("btn-snd").getAttribute("aria-pressed") === "false",
        "clicking SND leaves it unpressed (no invented control)");

  /* -- pad keys on the focused output: all eight of the 2-button pad -- */
  const canvas = page.dom.get("out");
  const padKeys = [["KeyI", "up"], ["KeyK", "down"], ["KeyJ", "left"],
                   ["KeyL", "right"], ["KeyN", "i"], ["KeyM", "ii"],
                   ["KeyO", "select"], ["KeyP", "run"]];
  let padOk = true;
  for (const [code, field] of padKeys) {
    for (const fn of canvas.listeners.keydown || []) {
      fn({ code: code, key: code.slice(3).toLowerCase(), target: canvas,
           preventDefault() {}, stopPropagation() {} });
    }
    if (studio.pad()[field] !== true) padOk = false;
    for (const fn of canvas.listeners.keyup || []) {
      fn({ code: code, key: "", target: canvas,
           preventDefault() {}, stopPropagation() {} });
    }
    if (studio.pad()[field] !== undefined) padOk = false;
  }
  check(padOk, "IJKL/NM/OP hold and release all eight pad-1 fields");
  check(studio.handleShortcut({ key: "l", code: "KeyL", target: null }) === false,
        "the page-wide shortcuts leave the pad keys to the focused output");

  /* Leave the page as the other checks expect it. */
  studio.setLayerViewOnly(false);
  studio.setLayer("bg", true);
  studio.setLayer("sprites", true);
  studio.setLength(300);
  studio.loadExample("palette", true);
  studio.pause();
  studio.seek(0);
}

/* ---- 9b. #144: ▶ plays past Length, until Stop ------------------------ *
 * Dennis's platformer froze at frame 299 (t=4.98 s) with nothing on screen
 * saying why: the play loop's step paused at lengthFrames - 1. It is fixed
 * by following ppu.toys' Studio, whose clock is free and whose Length is
 * only the scrubber's max (docs/STUDIO.md §2.3, "Playing past Length"), so
 * the two things a person watches are the two things asserted here: the
 * clock's frame counter keeps rising and ▶ is still running, while the
 * scrubber saturates at Length - 1.
 *
 * Nothing here calls stepForward(): the page's own requestAnimationFrame
 * queue is pumped with 60 Hz timestamps, so what runs is the loop the ▶
 * button starts.  The control that must fail on this check is a page whose
 * stepForward() still has the old `pause()` at lengthFrames - 1. */
function checkPlayPastLength(page) {
  const S = page.sandbox.PCEStudio;
  const studio = S.studio;
  const clock = page.dom.get("clock");
  const seek = page.dom.get("seek");

  /* The emptiest toy there is: the frame index is the whole measurement. */
  runEditorSource(studio, "function frame(t, f) end\n");
  studio.setLength(300);
  studio.seek(0);
  /* Ctrl+Enter in runEditorSource queued a tick; ▶ queues its own. */
  page.raf.length = 0;

  clickOne(page, "btn-play");
  check(studio.isPlaying() === true && page.raf.length >= 1,
        "#144: ▶ starts the play loop (one pending rAF tick)");

  const pump = (n) => {
    for (let i = 0; i < n; i++) {
      page.sandbox.__now += 1000 / 60;
      const due = page.raf.splice(0);
      for (const fn of due) fn(page.sandbox.__now);
    }
  };
  pump(420);

  const frame = studio.current().frame;
  const clockText = clock.textContent;
  check(frame > 400, "#144: ▶ runs past Length — " + frame +
        " frames at Length 300 (it used to pause at 299)");
  check(studio.isPlaying() === true,
        "#144: the play loop is still running at frame " + frame);
  check(seek.value === "299",
        "#144: the scrubber saturates at Length − 1 (" + seek.value + ")");
  check(/frame 4\d\d/.test(clockText),
        "#144: the clock's frame counter keeps rising (" + clockText + ")");

  /* Pausing and playing again past Length resumes; it does not restart. */
  clickOne(page, "btn-play");
  check(studio.isPlaying() === false && studio.current().frame > 400,
        "#144: ⏸ pauses where the clock is (frame " +
        studio.current().frame + ")");
  clickOne(page, "btn-play");
  check(studio.isPlaying() === true && studio.current().frame > 400,
        "#144: ▶ past Length resumes, it does not jump back to 0 (frame " +
        studio.current().frame + ")");
  clickOne(page, "btn-stop");
  check(studio.isPlaying() === false && studio.current().frame === 0,
        "■ stops the play loop and returns to frame 0 (frame " +
        studio.current().frame + ")");

  /* Length still bounds a scrub, and ▶ parked on the last frame restarts. */
  studio.seek(310);
  check(studio.current().frame === 299,
        "#144: a seek past Length still clamps to the last frame (frame " +
        studio.current().frame + ")");
  page.raf.length = 0;
  clickOne(page, "btn-play");
  check(studio.isPlaying() === true && studio.current().frame === 0,
        "▶ at the last frame restarts from 0 (frame " +
        studio.current().frame + ")");
  clickOne(page, "btn-stop");

  /* Leave the page as the other checks expect it. */
  studio.setLength(300);
  studio.loadExample("palette", true);
  studio.pause();
  studio.seek(0);
}

/* ---- 7b. #90: every example's picture is visible, in the page's pixels --- *
 * Found by a headless screenshot of ?demo=sprite: the screen was entirely
 * black, while check-toys was green — the toy wrote its pattern at the BAT's
 * address and the state comparison agreed with itself.  These are the
 * assertions a black screen cannot pass, measured on the frame the canvas
 * drew (studio.output()), not in the toy's words.
 *
 * The pad is driven through the page's own controls: the canvas key handler
 * holds our pad, and studio.stepForward is the play loop's own step — the one
 * place the held pad reaches the toy (padLog).  Nothing writes state behind
 * the page's back. */
/* sprite-pad.lua's block at frame 0: SAT X 32 / Y 64 is display (0,0)
 * (pce-sprites.js) and the toy starts at sx, sy = 144, 160. */
const SPR_X = 112;
const SPR_Y = 96;

/* The movement assertion as a function, not a hand-rolled loop: the moving
 * run and the still-sprite control below must go through the same
 * comparison, or weakening one would leave the other green.  `fromX` is the
 * box's column before the run; true only when every frame stands one more
 * (right) or one fewer (left) column along `dir` than the frame before, at
 * the same row. */
function movesByPad(frames, dir, fromX) {
  const step = dir === "right" ? 1 : -1;
  if (!frames.length) return false;
  for (let i = 0; i < frames.length; i++) {
    const want = fromX + step * (i + 1);
    if (!frames[i].box || frames[i].box[0] !== want ||
        frames[i].box[1] !== SPR_Y) return false;
  }
  return true;
}

function cramRgb(cram, addr) {
  const v = cram[addr * 2] | (cram[addr * 2 + 1] << 8);
  return [36 * ((v >> 3) & 7), 36 * ((v >> 6) & 7), 36 * (v & 7)];
}

/* Pixels inside box = [x0, y0, x1, y1) that are not the backdrop (CRAM[0],
 * the colour a background colour 0 shows; a 256x224 frame has no CRAM[$100]
 * border pixels), and their bounding box (null when none). */
function visibleBox(img, cram, box) {
  const bg = cramRgb(cram, 0);
  let n = 0, minX = img.width, minY = img.height, maxX = -1, maxY = -1;
  for (let y = box[1]; y < box[3] && y < img.height; y++) {
    for (let x = box[0]; x < box[2] && x < img.width; x++) {
      const i = (y * img.width + x) * 3;
      if (img.pixels[i] === bg[0] && img.pixels[i + 1] === bg[1] &&
          img.pixels[i + 2] === bg[2]) continue;
      n++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { n: n, box: n ? [minX, minY, maxX, maxY] : null };
}

function exampleCram(studio) {
  return studio.runtime().last.state.cram;
}

function checkExamplesVisible(page) {
  const studio = page.sandbox.PCEStudio.studio;
  const canvas = page.dom.get("out");
  const key = (type, code, k) => {
    for (const fn of canvas.listeners[type] || []) {
      fn({ code: code, key: k, target: canvas,
           preventDefault() {}, stopPropagation() {} });
    }
  };

  /* -- each example shows its picture -- */
  const expect = [
    /* id, frame, box, least non-backdrop pixels */
    ["palette", 60, [0, 0, 256, 224], 50000],   /* the tiled field */
    ["raster", 30, [0, 0, 256, 224], 3000],     /* the colour-15 diagonals */
    ["sprite", 0, [SPR_X, SPR_Y, SPR_X + 16, SPR_Y + 16], 256],  /* block */
  ];
  const counts = [];
  for (const [id, f, box, k] of expect) {
    studio.loadExample(id, true);
    studio.pause();
    studio.seek(0);
    studio.seek(f);
    check(studio.current().frame === f,
          id + " VISIBILITY: the page is on frame " + f);
    const vis = visibleBox(studio.output(), exampleCram(studio), box);
    counts.push(id + " f" + f + " " + vis.n);
    check(vis.n >= k,
          id + " VISIBILITY: frame " + f + " shows its picture at the " +
          "expected place (" + vis.n + " non-backdrop pixels in " +
          JSON.stringify(box) + ", at least " + k + ")");
    if (id === "sprite") {
      eq("sprite VISIBILITY: the block is the whole 16x16 box at " +
         "(" + SPR_X + "," + SPR_Y + ")", vis.box,
         [SPR_X, SPR_Y, SPR_X + 15, SPR_Y + 15]);
    }
  }

  /* -- the sprite answers the pad, in the pixels -- *
   * The block is solid, so the frame's non-backdrop pixels are it: ten
   * frames of right move it ten columns, ten frames of left bring it back.
   * The example goes through the page's editor → Run path (Ctrl+Enter), so
   * the source the human edits is the source these pixels come from. */
  const spriteSource = studio.examples.filter((e) => e.id === "sprite")[0]
    .source;
  runEditorSource(studio, spriteSource);
  check(studio.current().source === spriteSource,
        "the editor ran the page's own sprite-pad.lua (Ctrl+Enter)");
  const spriteBox = () => visibleBox(studio.output(), exampleCram(studio),
                                     [0, 0, 256, 224]);
  const start = spriteBox();
  eq("sprite VISIBILITY: frame 0's block stands at (" + SPR_X + "," + SPR_Y +
     ")", start.box, [SPR_X, SPR_Y, SPR_X + 15, SPR_Y + 15]);

  key("keydown", "KeyL", "l");
  check(studio.pad().right === true, "holding L holds pad right");
  let right = [];
  for (let i = 0; i < 10; i++) {
    studio.stepForward();
    right.push(spriteBox());
  }
  check(studio.current().frame === 10,
        "ten steps run ten frames (frame " + studio.current().frame + ")");
  check(right.every((v) => v.n === 256),
        "sprite VISIBILITY: every frame of the move shows all 256 block " +
        "pixels (" + right.map((v) => v.n).join(",") + ")");
  check(movesByPad(right, "right", SPR_X),
        "sprite VISIBILITY: ten frames of right move the block right one " +
        "column a frame (x = " + right.map((v) => (v.box || [])[0])
                                  .join(",") + ")");
  key("keyup", "KeyL", "");

  key("keydown", "KeyJ", "j");
  let left = [];
  for (let i = 0; i < 10; i++) {
    studio.stepForward();
    left.push(spriteBox());
  }
  const back = left[left.length - 1];
  eq("sprite VISIBILITY: ten frames of left bring the block back to (" +
     SPR_X + "," + SPR_Y + ")", back.box,
     [SPR_X, SPR_Y, SPR_X + 15, SPR_Y + 15]);
  check(movesByPad(left, "left", SPR_X + 10),
        "sprite VISIBILITY: ten frames of left move the block left one " +
        "column a frame (x = " + left.map((v) => (v.box || [])[0])
                                   .join(",") + ")");
  key("keyup", "KeyJ", "");

  /* The control: the SAME assertion, given ten frames with no pad held, must
   * be false.  The #90 breaker's M10 made the movement check accept a still
   * sprite; the moving run alone cannot see that — a positive-only check
   * agrees with a still one.  The sprite is at (SPR_X, SPR_Y) after the
   * left run, and with no key it stays there, so "moved right" is a lie the
   * control has to catch. */
  let still = [];
  for (let i = 0; i < 10; i++) {
    studio.stepForward();
    still.push(spriteBox());
  }
  check(still.every((v) => v.box && v.box[0] === SPR_X && v.box[1] === SPR_Y),
        "no pad held: the block stands still at (" + SPR_X + "," + SPR_Y +
        ") for ten frames (x = " + still.map((v) => (v.box || [])[0])
                                          .join(",") + ")");
  check(!movesByPad(still, "right", SPR_X),
        "the movement assertion FAILS on a still sprite (the control)");
  check(!movesByPad(still, "left", SPR_X),
        "the movement assertion FAILS on a still sprite read as left too");

  console.log("      VISIBILITY: " + counts.join("  ·  ") +
              " non-backdrop pixels at the expected place; the sprite moves " +
              "with the pad key");

  /* Leave the page as the other checks expect it. */
  studio.loadExample("palette", true);
  studio.pause();
  studio.seek(0);
}

/* ---- 7b. #107: Paste & Run, in the stub DOM --------------------------- */
/* The clipboard is not in the stub DOM (there is no navigator), so the
 * browser driver is where the button and the drop are proven. What is proven
 * here is the rule itself and every outcome of pasting text in hand: the
 * fence strip, the refusals by code, a good toy running and showing its
 * picture, and a broken one naming main.lua line N in the error line and in
 * CONSOLE. */
function checkPasteRun(page) {
  const studio = page.sandbox.PCEStudio.studio;
  const dom = page.dom;
  studio.loadExample("raster", true);
  studio.pause();

  /* one rule: the code is the fence's contents, whatever prose surrounds it */
  const body = "function frame(t, f)\n  pal(0, 63, 0, 0)\nend\n";
  check(studio.stripFence("Here is your toy:\n\n```lua\n" + body +
                          "```\n\nCopy it, then press Paste & Run.") === body,
        "#107: a ```lua fence is stripped and the prose around it dropped");
  check(studio.stripFence(body) === body,
        "#107: code with no fence passes through unchanged");
  check(studio.stripFence("```\n" + body + "```") === body,
        "#107: a fence with no language is still a fence");
  check(studio.stripFence("```lua\r\n" + body.replace(/\n/g, "\r\n") + "```") === body,
        "#107: CRLF text is normalised, so the line numbers stay the toy's");
  check(studio.stripFence("```lua\n\nfunction frame() end\n```") ===
        "\nfunction frame() end\n",
        "#107: a blank first line is kept, so line numbers stay the toy's");

  let langErr = null;
  try { studio.stripFence("```js\nconsole.log(1)\n```"); }
  catch (e) { langErr = e; }
  check(!!langErr && langErr.code === "paste-language",
        "#107: a ```js fence is refused by code (" +
        (langErr && langErr.code) + ")");
  let fenceErr = null;
  try { studio.stripFence("```lua\nfunction frame() end"); }
  catch (e) { fenceErr = e; }
  check(!!fenceErr && fenceErr.code === "paste-fence",
        "#107: an unclosed fence is refused by code (" +
        (fenceErr && fenceErr.code) + ")");

  /* #116 (REVIEW-PANELS 107-P2): a Markdown fence's language is not
   * case-sensitive in practice — ```LUA and ```Luau are Lua, and refusing
   * them keeps the old source.  The suite only used ```lua and ```js. */
  let upperErr = null, upper = null;
  try { upper = studio.stripFence("```LUA\n" + body + "```"); }
  catch (e) { upperErr = e; }
  check(upperErr === null && upper === body,
        "#107: a ```LUA fence is the same language as ```lua (" +
        (upperErr ? upperErr.code + ": " + upperErr.message
                  : JSON.stringify(upper)) + ")");
  let luauErr = null, luau = null;
  try { luau = studio.stripFence("```Luau\n" + body + "```"); }
  catch (e) { luauErr = e; }
  check(luauErr === null && luau === body,
        "#107: a ```Luau fence is the same language as ```lua (" +
        (luauErr ? luauErr.code + ": " + luauErr.message
                 : JSON.stringify(luau)) + ")");
  /* and a real refusal leaves main.lua as it was */
  const keptSource = studio.current().source;
  const keptText = studio.editorText();
  check(studio.pasteText("```js\nconsole.log(1)\n```") === false,
        "#107: pasting a ```js fence reports that it did not run");
  check(studio.lastError() && studio.lastError().code === "paste-language",
        "#107: … with paste-language (" +
        JSON.stringify(studio.lastError()) + ")");
  check(studio.current().source === keptSource &&
        studio.editorText() === keptText,
        "#107: a refused paste leaves the old main.lua in place");

  /* a real toy, pasted the way an AI answers: prose, a fence, more prose */
  const palette = studio.examples.filter((e) => e.id === "palette")[0];
  const answer = "Here is a palette-cycling toy.\n\n```lua\n" +
    palette.source + "```\n\nCopy this, then press Paste & Run.";
  check(studio.pasteText(answer) === true,
        "#107: pasting a fenced toy reports that it ran");
  check(studio.lastError() === null, "#107: a good paste leaves no error");
  check(studio.current().source === studio.stripFence(answer),
        "#107: main.lua is the fence's code, not the prose");
  check(studio.editorText() === studio.current().source,
        "#107: the editor shows the pasted source");
  check(dom.get("doc-title").textContent === "main.lua",
        "#107: the document title says main.lua");
  check(dom.get("error").hidden === true, "#107: the error line is empty");

  /* it ran, and the picture is on the canvas: the palette example's field at
   * frame 60 (the same threshold checkExamplesVisible uses) */
  studio.seek(60);
  studio.pause();
  const out = studio.output();
  const cram = studio.runtime().last.state.cram;
  const vis = visibleBox(out, cram, [0, 0, 256, 224]);
  check(vis.n > 50000,
        "#107: the pasted toy runs and shows its picture (" + vis.n +
        " non-backdrop pixels at frame 60)");

  /* a broken paste: the error line says where, in the studio's file name */
  const broken = "function frame(t, f)\n  nope()\nend\n";
  check(studio.pasteText(broken) === false, "#107: a broken paste reports failure");
  const err = studio.lastError();
  check(!!err && err.code === "toy-error" && /^main\.lua line 2:/.test(err.message),
        "#107: the error line names main.lua line 2 (" +
        (err && err.code + ": " + err.message) + ")");
  check(/main\.lua line 2/.test(dom.get("error").textContent),
        "#107: the page's error line carries that line");
  studio.panels.select("console");
  studio.panels.refresh(true);
  const consoleText = dom.get("console-table").textContent;
  check(/last error: toy-error: main\.lua line 2/.test(consoleText),
        "#107: CONSOLE repeats it, so one line can go back to the AI");

  /* nothing to run */
  check(studio.pasteText("   \n") === false &&
        studio.lastError().code === "paste-empty",
        "#107: an empty paste is refused as paste-empty");

  /* leave a working toy for the checks after this one */
  studio.loadExample("palette", true);
  studio.pause();
  studio.seek(0);
}

/* ---- 9b. the resizable regions (#139) --------------------------------- */
/* The card's evidence is the --browser run, which drags each divider with
 * in-page pointer events and reloads the page.  This is the same page code
 * under the stub DOM: the drag arithmetic, the clamp, the keyboard contract,
 * the reset and the per-browser save.  The element rectangles are set here
 * because the stub DOM has no layout — getBoundingClientRect reads the
 * element's width/height. */
function splitDigest(pixels) {
  let h = 2166136261;
  for (let i = 0; i < pixels.length; i++) {
    h ^= pixels[i] & 0xff; h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

function checkStudioSplits(page) {
  const studio = page.sandbox.PCEStudio.studio;
  const dom = page.dom;
  const el = (id) => dom.get(id);
  function fire(target, type, more) {
    const list = (target.listeners && target.listeners[type]) || [];
    for (const fn of list) fn(Object.assign(dom.fakeEvent(target), more || {}));
    return list.length;
  }
  function size(id, w, h) {
    const e = el(id); e.width = w; e.height = h;
  }
  /* a 1280x900 page: 800 px of left column, 480 of output, a 420 px editor
   * over a 280 px dock, and a 180 px drawer under a 400 px picture */
  size("studio-main", 1280, 900);
  size("workspace", 800, 700);
  size("code-pane", 800, 420);
  size("output-pane", 480, 900);
  size("bottom-body", 480, 180);
  size("canvas-wrap", 460, 400);

  const ids = ["cols", "rows", "bottom"];
  const html = fs.readFileSync(PAGE, "utf8");
  /* the stub DOM does not parse attributes, so the markup itself is read */
  const tagOf = (id) => {
    const m = new RegExp('<[a-z]+[^>]*id="' + id + '"[^>]*>').exec(html);
    return m ? m[0] : "";
  };
  for (const which of ids) {
    const div = studio.layout.splitEl(which);
    check(!!div, "the " + which + " divider is a grid item in the page");
    if (!div) continue;
    const tag = tagOf(div.id);
    check(/role="separator"/.test(tag),
          "the " + which + " divider is a separator");
    check(/tabindex="0"/.test(tag),
          "the " + which + " divider is focusable (keyboard resize)");
    check(new RegExp('aria-orientation="' +
                     (which === "cols" ? "vertical" : "horizontal") + '"')
          .test(tag),
          "the " + which + " divider says which way it runs");
    check(/aria-label="[^"]+"/.test(tag),
          "the " + which + " divider is named for a screen reader");
  }
  check(studio.layout.split("cols") === null &&
        studio.layout.split("rows") === null &&
        studio.layout.split("bottom") === null,
        "a fresh browser starts on the default fr split, no saved sizes");
  check(!el("studio-main").style["--split-left"],
        "no saved size leaves the column tracks on their fr split");

  const frameBefore = splitDigest(studio.render.output().pixels);

  /* --- the columns: drag right 120 px, then 60 px back ----------------- */
  const colsEl = el("split-cols");
  check(fire(colsEl, "pointerdown", { clientX: 500, clientY: 400 }) === 1,
        "pointerdown on the column divider is handled");
  fire(colsEl, "pointermove", { clientX: 620, clientY: 400 });
  check(studio.layout.split("cols") === 920,
        "dragging the column divider 120 px right makes the left column " +
        "920 px (got " + studio.layout.split("cols") + ")");
  check(el("studio-main").style["--split-left"] === "920px" &&
        el("studio-main").style["--split-right"] === "1fr",
        "the columns move through the grid's custom properties, not an overlay");
  fire(colsEl, "pointermove", { clientX: 560, clientY: 400 });
  check(studio.layout.split("cols") === 860,
        "a pointermove back to +60 px gives 860 px (got " +
        studio.layout.split("cols") + ")");
  fire(colsEl, "pointerup", {});
  check(colsEl.getAttribute("aria-valuemin") === "320" &&
        colsEl.getAttribute("aria-valuemax") === "974",
        "the divider announces its clamp (320..974 px, got " +
        colsEl.getAttribute("aria-valuemin") + ".." +
        colsEl.getAttribute("aria-valuemax") + ")");
  const held = studio.layout.split("cols");
  fire(colsEl, "pointermove", { clientX: 1100, clientY: 400 });
  check(studio.layout.split("cols") === held,
        "a pointermove after pointerup does not resize (the drag ended)");

  /* --- the code pane and the dock: drag down 100 px -------------------- */
  const rowsEl = el("split-rows");
  fire(rowsEl, "pointerdown", { clientX: 400, clientY: 300 });
  fire(rowsEl, "pointermove", { clientX: 400, clientY: 400 });
  check(studio.layout.split("rows") === 520,
        "dragging the dock divider 100 px down makes the editor 520 px " +
        "(got " + studio.layout.split("rows") + ")");
  check(el("workspace").style["--split-code"] === "520px",
        "the editor's row is the px track and the dock takes the rest");
  fire(rowsEl, "pointerup", {});

  /* --- the output and the drawer: drag up 100 px ----------------------- */
  const bottomEl = el("split-bottom");
  fire(bottomEl, "pointerdown", { clientX: 700, clientY: 700 });
  fire(bottomEl, "pointermove", { clientX: 700, clientY: 600 });
  check(studio.layout.split("bottom") === 280,
        "dragging the drawer divider 100 px up makes the markers drawer " +
        "280 px (got " + studio.layout.split("bottom") + ")");
  check(el("output-pane").style["--split-bottom"] === "280px",
        "the drawer's row is the px track and the picture takes the rest");
  fire(bottomEl, "pointerup", {});

  /* --- the clamp: nothing collapses to zero ---------------------------- */
  fire(bottomEl, "pointerdown", { clientX: 700, clientY: 700 });
  fire(bottomEl, "pointermove", { clientX: 700, clientY: 5000 });
  check(studio.layout.split("bottom") === 64,
        "dragging the drawer divider far down stops at its 64 px minimum " +
        "(got " + studio.layout.split("bottom") + ")");
  fire(bottomEl, "pointerup", {});
  fire(colsEl, "pointerdown", { clientX: 500, clientY: 400 });
  fire(colsEl, "pointermove", { clientX: -5000, clientY: 400 });
  check(studio.layout.split("cols") === 320,
        "dragging the column divider past the left edge stops at 320 px " +
        "(got " + studio.layout.split("cols") + ")");
  fire(colsEl, "pointerup", {});

  /* --- the keyboard: arrows move, Home resets -------------------------- */
  const kb = el("split-rows");
  kb.focus();
  fire(kb, "keydown", { key: "ArrowDown", code: "ArrowDown" });
  check(studio.layout.split("rows") === 528,
        "ArrowDown moves the divider 8 px (520 -> " +
        studio.layout.split("rows") + ")");
  fire(kb, "keydown", { key: "ArrowDown", code: "ArrowDown", shiftKey: true });
  check(studio.layout.split("rows") === 568,
        "Shift+ArrowDown moves it 40 px (" + studio.layout.split("rows") + ")");
  fire(kb, "keydown", { key: "Home", code: "Home" });
  check(studio.layout.split("rows") === null &&
        !el("workspace").style["--split-code"],
        "Home resets the divider to the default fr split");

  /* --- double-click resets -------------------------------------------- */
  fire(el("split-cols"), "dblclick", {});
  check(studio.layout.split("cols") === null &&
        !el("studio-main").style["--split-left"],
        "double-clicking the column divider resets it");
  fire(bottomEl, "dblclick", {});
  check(studio.layout.split("bottom") === null &&
        !el("output-pane").style["--split-bottom"],
        "double-clicking the drawer divider resets it");

  /* --- the output still renders the same frame ------------------------- */
  const frameAfter = splitDigest(studio.render.output().pixels);
  check(frameAfter === frameBefore,
        "moving all three dividers leaves the output frame identical (" +
        frameBefore + " vs " + frameAfter + ")");

  /* --- saved per browser, restored on the next page -------------------- */
  fire(el("split-cols"), "pointerdown", { clientX: 500, clientY: 400 });
  fire(el("split-cols"), "pointermove", { clientX: 620, clientY: 400 });
  fire(el("split-cols"), "pointerup", {});
  fire(el("split-rows"), "pointerdown", { clientX: 400, clientY: 300 });
  fire(el("split-rows"), "pointermove", { clientX: 400, clientY: 380 });
  fire(el("split-rows"), "pointerup", {});
  fire(bottomEl, "pointerdown", { clientX: 700, clientY: 700 });
  fire(bottomEl, "pointermove", { clientX: 700, clientY: 620 });
  fire(bottomEl, "pointerup", {});
  let savedRaw = "";
  try { savedRaw = page.storage.getItem("pcestudio.layout.v1") || ""; } catch (e) {}
  check(/"cols":\d+/.test(savedRaw) && /"rows":\d+/.test(savedRaw) &&
        /"bottom":\d+/.test(savedRaw),
        "the three sizes are saved in the browser under pcestudio.layout.v1 (" +
        savedRaw + ")");
  const again = runPage("", page.storage);
  const restored = again.sandbox.PCEStudio.studio;
  check(restored.layout.split("cols") === 920 &&
        restored.layout.split("rows") === 500 &&
        restored.layout.split("bottom") === 260,
        "a reload restores the three sizes (got " +
        JSON.stringify(restored.layout.split()) + ")");
  check(again.dom.get("studio-main").style["--split-left"] === "920px",
        "the reloaded page puts the saved px back on the grid");
}

/* ---- 8. the real headless browser (optional) --------------------------- */
/* The #77 browser evidence needs a page that can edit, reload and read the
 * studio back. A same-origin iframe driver served over HTTP does that with
 * no dependencies: the studio's own PCEStudio.studio object is the API the
 * driver uses, and localStorage is a real browser's. */
const DRIVER_HTML = [
  '<!doctype html><meta charset="utf-8"><title>RUNNING</title>',
  '<pre id="driver-result">RUNNING</pre>',
  '<script>',
  '(function () {',
  '  var log = [], failed = 0;',
  '  var EXPECT = ' + JSON.stringify(EXPORT_EXPECT) + ';',
  '  function ck(ok, name) { log.push((ok ? "PASS " : "FAIL ") + name);',
  '    if (!ok) failed++; }',
  '  function done() {',
  '    var pre = document.getElementById("driver-result");',
  '    pre.textContent = log.join("\\n");',
  '    document.title = failed ? "FAIL" : "PASS";',
  '  }',
  '  function waitStudio(win) {',
  '    return new Promise(function (resolve) {',
  '      var n = 0;',
  '      var t = setInterval(function () {',
  '        if (win.PCEStudio && win.PCEStudio.studio) { clearInterval(t);',
  '          resolve(win.PCEStudio.studio); }',
  '        else if (++n > 400) { clearInterval(t); resolve(null); }',
  '      }, 25);',
  '    });',
  '  }',
  '  function loadFrame(src) {',
  '    return new Promise(function (resolve) {',
  '      var f = document.createElement("iframe");',
  '      f.style.width = "1280px"; f.style.height = "900px";',
  '      f.onload = function () {',
  '        waitStudio(f.contentWindow).then(function (s) {',
  '          resolve({ frame: f, win: f.contentWindow, studio: s });',
  '        });',
  '      };',
  '      f.src = src;',
  '      document.body.appendChild(f);',
  '    });',
  '  }',
  '  (async function () {',
  '    var url = "/renderer/studio.html?paused=1";',
  '    var a = await loadFrame(url);',
  '    var s = a.studio;',
  '    if (!s) { ck(false, "the studio booted in the iframe"); done(); return; }',
  '    var doc = a.win.document;',
  '    var opt = s.editorOptions() || {};',
  '    ck(s.editorKind() === "codemirror",',
  '       "CodeMirror is the editor in a real browser (got " + s.editorKind() + ")");',
  '    ck(opt.mode === "lua", "the editor is in CodeMirror\'s Lua mode (" + opt.mode + ")");',
  '    ck(opt.lineNumbers === true, "the editor shows line numbers");',
  '    ck(opt.keyMap === "default", "plain keys are CodeMirror\'s default");',
  '    var gutter = doc.querySelector(".CodeMirror-gutters");',
  '    var nums = doc.querySelectorAll(".CodeMirror-linenumber");',
  '    ck(!!doc.querySelector(".CodeMirror") && !!gutter && nums.length > 0,',
  '       "the CodeMirror DOM has a gutter and " + nums.length + " line numbers");',
  '    ck(doc.querySelectorAll(".cm-keyword").length > 0,',
  '       "Lua keywords are highlighted (" +',
  '       doc.querySelectorAll(".cm-keyword").length + " tokens)");',
  '    ck(doc.querySelectorAll(".CodeMirror-activeline-background").length > 0,',
  '       "the cursor line is highlighted like ppu.toys\' editor");',
  '    ck(s.editorText() === s.current().source,',
  '       "the editor\'s text is the Lua the page runs");',
  '',
  '    /* #139: the three dividers, dragged with in-page pointer events (no OS',
  '     * input).  They run here, before the driver starts editing the toy, so',
  '     * a failure further down the chain cannot hide this card\'s evidence. */',
  '    s.seek(30); s.pause();',
  '    function box(el) {',
  '      var r = el.getBoundingClientRect();',
  '      return { x: r.left, y: r.top, w: r.width, h: r.height };',
  '    }',
  '    function pev(kind, x, y) {',
  '      return new a.win.PointerEvent(kind, { bubbles: true,',
  '        cancelable: true, clientX: x, clientY: y, pointerId: 1,',
  '        pointerType: "mouse", isPrimary: true,',
  '        button: kind === "pointerdown" ? 0 : -1,',
  '        buttons: kind === "pointerup" ? 0 : 1 });',
  '    }',
  '    function drag(id, dx, dy) {',
  '      var el = doc.getElementById(id);',
  '      var r = el.getBoundingClientRect();',
  '      var x = r.left + r.width / 2, y = r.top + r.height / 2;',
  '      el.dispatchEvent(pev("pointerdown", x, y));',
  '      el.dispatchEvent(pev("pointermove", x + dx / 2, y + dy / 2));',
  '      el.dispatchEvent(pev("pointermove", x + dx, y + dy));',
  '      el.dispatchEvent(pev("pointerup", x + dx, y + dy));',
  '    }',
  '    var canvasEl = doc.getElementById("out");',
  '    function digest() {',
  '      var d = canvasEl.getContext("2d")',
  '        .getImageData(0, 0, canvasEl.width, canvasEl.height).data;',
  '      var h = 2166136261;',
  '      for (var i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 16777619); }',
  '      return h >>> 0;',
  '    }',
  '    var pix0 = digest();',
  '    var ws0 = box(doc.getElementById("workspace"));',
  '    var out0 = box(doc.getElementById("output-pane"));',
  '    var code0 = box(doc.getElementById("code-pane"));',
  '    var body0 = box(doc.getElementById("bottom-body"));',
  '    ck(ws0.w > 300 && code0.h > 200 && body0.h > 40,',
  '       "the three regions have a size to drag (" + ws0.w + ", " +',
  '       code0.h + ", " + body0.h + ")");',
  '',
  '    drag("split-cols", 120, 0);',
  '    var ws1 = box(doc.getElementById("workspace"));',
  '    ck(Math.abs((ws1.w - ws0.w) - 120) < 3,',
  '       "dragging the column divider 120 px right widens the code column (" +',
  '       ws0.w + " -> " + ws1.w + ")");',
  '    var outCol = box(doc.getElementById("output-pane"));',
  '    ck(Math.abs((out0.w - outCol.w) - 120) < 4,',
  '       "the output column gives up the 120 px the code column took (" +',
  '       out0.w + " -> " + outCol.w + ")");',
  '',
  '    drag("split-rows", 0, 80);',
  '    var code1 = box(doc.getElementById("code-pane"));',
  '    ck(Math.abs((code1.h - code0.h) - 80) < 3,',
  '       "dragging the dock divider 80 px down makes the editor taller (" +',
  '       code0.h + " -> " + code1.h + ")");',
  '',
  '    var body0b = box(doc.getElementById("bottom-body"));',
  '    drag("split-bottom", 0, -60);',
  '    var body1 = box(doc.getElementById("bottom-body"));',
  '    ck(Math.abs((body1.h - body0b.h) - 60) < 3,',
  '       "dragging the drawer divider 60 px up makes the drawer taller (" +',
  '       body0b.h + " -> " + body1.h + ", first measured " + body0.h + ")");',
  '',
  '    ck(digest() === pix0,',
  '       "the output still renders the same frame after all three drags");',
  '    var frBox = box(doc.getElementById("display-frame"));',
  '    ck(Math.abs(frBox.w / frBox.h - 256 / 224) < 0.01,',
  '       "the canvas keeps its 256:224 aspect in the resized column (" +',
  '       frBox.w.toFixed(1) + "x" + frBox.h.toFixed(1) + ")");',
  '',
  '    var savedLayout = "";',
  '    try { savedLayout = a.win.localStorage.getItem("pcestudio.layout.v1") || ""; }',
  '    catch (e) {}',
  '    ck(/"cols":\\d+/.test(savedLayout) && /"rows":\\d+/.test(savedLayout) &&',
  '       /"bottom":\\d+/.test(savedLayout),',
  '       "the three divider sizes are saved in the browser (" + savedLayout + ")");',
  '',
  '    /* a second page with the same browser profile: the sizes come back */',
  '    var lay = await loadFrame(url);',
  '    var ldoc = lay.win.document;',
  '    var ws2 = box(ldoc.getElementById("workspace"));',
  '    var code2 = box(ldoc.getElementById("code-pane"));',
  '    var body2 = box(ldoc.getElementById("bottom-body"));',
  '    ck(lay.studio && Math.abs(ws2.w - ws1.w) < 2 &&',
  '       Math.abs(code2.h - code1.h) < 2 && Math.abs(body2.h - body1.h) < 2,',
  '       "a reload restores the three sizes (" + ws1.w + "/" + code1.h + "/" +',
  '       body1.h + " -> " + ws2.w + "/" + code2.h + "/" + body2.h + ")");',
  '',
  '    function dbl(id) {',
  '      doc.getElementById(id).dispatchEvent(new a.win.MouseEvent("dblclick",',
  '        { bubbles: true, cancelable: true }));',
  '    }',
  '    dbl("split-cols"); dbl("split-rows"); dbl("split-bottom");',
  '    var ws3 = box(doc.getElementById("workspace"));',
  '    var code3 = box(doc.getElementById("code-pane"));',
  '    var body3 = box(doc.getElementById("bottom-body"));',
  '    ck(Math.abs(ws3.w - ws0.w) < 2 && Math.abs(code3.h - code0.h) < 2 &&',
  '       Math.abs(body3.h - body0.h) < 2,',
  '       "double-clicking each divider restores the default split (" +',
  '       ws3.w + "/" + code3.h + "/" + body3.h + ")");',
  '',
  '    var kdiv = doc.getElementById("split-cols");',
  '    kdiv.focus();',
  '    var kb0 = box(doc.getElementById("workspace")).w;',
  '    kdiv.dispatchEvent(new a.win.KeyboardEvent("keydown", { key: "ArrowRight",',
  '      code: "ArrowRight", bubbles: true, cancelable: true }));',
  '    ck(Math.abs(box(doc.getElementById("workspace")).w - (kb0 + 8)) < 2,',
  '       "ArrowRight on the focused divider moves it 8 px (" + kb0 + " -> " +',
  '       box(doc.getElementById("workspace")).w + ")");',
  '    kdiv.dispatchEvent(new a.win.KeyboardEvent("keydown", { key: "Home",',
  '      code: "Home", bubbles: true, cancelable: true }));',
  '    ck(Math.abs(box(doc.getElementById("workspace")).w - kb0) < 2,',
  '       "Home resets the divider from the keyboard");',
  '    s.seek(0); s.pause();',
  '',
  '    var marker = "-- autosave-marker-77";',
  '    var edited = marker + "\\n" + s.editorText();',
  '    s.setEditorText(edited);',
  '    ck(s.editorText() === edited && s.current().source === edited,',
  '       "an edit is both the editor text and the running Lua");',
  '    var code = doc.querySelector(".CodeMirror-code");',
  '    ck(!!code && code.textContent.indexOf("autosave-marker-77") >= 0,',
  '       "CodeMirror renders the edit in its own DOM");',
  '',
  '    s.selectFile("tiles.json");',
  '    var asset = \'{"version":1,"tiles":[{"char":64,"marker":"asset-77"}]}\\n\';',
  '    s.setEditorText(asset);',
  '    ck(s.current().source === edited,',
  '       "editing an asset does not change the running Lua");',
  '    s.selectFile("main.lua");',
  '    ck(s.editorText() === edited, "main.lua comes back with the edit");',
  '',
  '    var saved = s.saveToy();',
  '    s.loadExample("raster", true);',
  '    s.openToy(saved.text, saved.name);',
  '    ck(saved.text === s.envelopeText(),',
  '       "save then reopen is byte-identical in the browser");',
  '    ck(s.editorText() === edited && s.current().source === edited,',
  '       "reopening restores the editor and the Lua that runs");',
  '',
  '    s.setVim(true);',
  '    ck((s.editorOptions() || {}).keyMap === "vim",',
  '       "Settings -> Vim selects CodeMirror\'s vim keymap");',
  '    try {',
  '      ck(/"vim":true/.test(a.win.localStorage.getItem("pcestudio.settings.v1") || ""),',
  '         "the Vim choice is saved in the browser settings");',
  '    } catch (e) { ck(false, "browser settings are readable"); }',
  '    s.setVim(false);',
  '',
  '    s.pause();',
  '    a.win.dispatchEvent(new a.win.KeyboardEvent("keydown",',
  '      { key: " ", code: "Space", bubbles: true }));',
  '    ck(s.isPlaying() === true, "Space plays in the real page");',
  '    a.win.dispatchEvent(new a.win.KeyboardEvent("keydown",',
  '      { key: " ", code: "Space", bubbles: true }));',
  '    ck(s.isPlaying() === false, "Space pauses in the real page");',
  '    s.seek(2); s.pause();',
  '    a.win.dispatchEvent(new a.win.KeyboardEvent("keydown",',
  '      { key: ".", code: "Period", ctrlKey: true, bubbles: true }));',
  '    ck(s.current().frame === 3, "Ctrl+. steps a frame in the real page");',
  '    s.seek(4); s.pause();',
  '    a.win.dispatchEvent(new a.win.KeyboardEvent("keydown",',
  '      { key: "r", code: "KeyR", bubbles: true }));',
  '    ck(s.current().frame === 0 && s.isPlaying() === true,',
  '       "R restarts at frame 0 in the real page");',
  '    s.pause();',
  '',
  '    var cv = doc.getElementById("out");',
  '    cv.dispatchEvent(new a.win.KeyboardEvent("keydown",',
  '      { key: "l", code: "KeyL", bubbles: true }));',
  '    ck(s.pad().right === true, "L holds pad right on the focused output");',
  '    cv.dispatchEvent(new a.win.KeyboardEvent("keyup",',
  '      { key: "l", code: "KeyL", bubbles: true }));',
  '    ck(s.pad().right === undefined, "releasing L releases pad right");',
  '',
  '    s.setEditorText(edited);',
  '    a.win.dispatchEvent(new a.win.KeyboardEvent("keydown",',
  '      { key: "s", code: "KeyS", ctrlKey: true, bubbles: true }));',
  '    var stored = "";',
  '    try { stored = a.win.localStorage.getItem("pcestudio.toy.v1") || ""; }',
  '    catch (e) {}',
  '    ck(stored.indexOf("autosave-marker-77") >= 0,',
  '       "Ctrl+S saves the toy envelope to the browser");',
  '',
  '    var cm = s.codeMirror();',
  '    s.setEditorText("x = 1\\n");',
  '    cm.setCursor({ line: 0, ch: 0 });',
  '    cm.focus();',
  '    var input = cm.getInputField();',
  '    var tabEvent = new a.win.KeyboardEvent("keydown",',
  '      { key: "Tab", code: "Tab", bubbles: true, cancelable: true });',
  '    try { Object.defineProperty(tabEvent, "keyCode", { get: function () { return 9; } });',
  '          Object.defineProperty(tabEvent, "which", { get: function () { return 9; } }); }',
  '    catch (e) {}',
  '    input.dispatchEvent(tabEvent);',
  '    ck(cm.getValue().indexOf("  x = 1") === 0,',
  '       "Tab inserts two spaces in CodeMirror (got " +',
  '       JSON.stringify(cm.getValue()) + ")");',
  '',
  '    /* Leave the toy the author was editing, reload the same iframe, and',
  '     * the autosave must bring it back. */',
  '    s.setEditorText(edited);',
  '    var reloaded = await new Promise(function (resolve) {',
  '      a.frame.onload = function () { waitStudio(a.win).then(resolve); };',
  '      a.win.location.reload();',
  '    });',
  '    ck(!!reloaded, "the studio boots again after an iframe reload");',
  '    if (reloaded) {',
  '      ck(reloaded.editorKind() === "codemirror",',
  '         "CodeMirror mounts again after a reload");',
  '      ck(reloaded.editorText() === edited,',
  '         "autosave survives a reload: the editor text comes back");',
  '      ck(reloaded.current().source === edited,',
  '         "autosave survives a reload: the reloaded page runs the edit");',
  '      ck(reloaded.files().some(function (f) {',
  '           return f.name === "tiles.json" && f.source === asset; }),',
  '         "autosave survives a reload: asset files included");',
  '      var note = a.win.document.getElementById("saved");',
  '      ck(!!note && /restored from this browser/.test(note.textContent),',
  '         "the reloaded page says it restored the toy from this browser");',
  '    }',
  '    /* And a fresh page with the same browser profile (the second tab case). */',
  '    var b = await loadFrame(url);',
  '    var s2 = b.studio;',
  '    ck(!!s2, "a fresh tab with the same profile boots");',
  '    if (s2) {',
  '      ck(s2.editorText() === edited && s2.current().source === edited,',
  '         "a fresh tab restores the autosaved toy too");',
  '    }',
  '    /* #84: the SCREEN panel\'s cell map in a real browser — a real mouse',
  '     * event on the canvas, the canvas\'s own pixels, and the zoom chips.',
  '     * The reload above replaced the iframe\'s document, so read it again. */',
  '    var cs = reloaded || s;',
  '    var cdoc = a.win.document;',
  '    cs.loadExample("palette", true);',
  '    var palFile = cs.files().filter(function (f) {',
  '      return f.name === "palettes.json"; })[0];',
  '    var palDoc = JSON.parse(palFile.source);',
  '    palDoc.background = palDoc.background || [];',
  '    palDoc.background[0] = new Array(16).fill(0);',
  '    palDoc.background[0][5] = 0x1FF;',
  '    cs.selectFile("palettes.json");',
  '    cs.setEditorText(JSON.stringify(palDoc));',
  '    cs.selectFile("main.lua");',
  '    cs.screenNewTile();',
  '    cs.screenSelectColour(5);',
  '    cs.screenPaintTilePixel(2, 3);',
  '    var map = cdoc.getElementById("scr-map");',
  '    function mapEvent(kind, cx, cy) {',
  '      map.dispatchEvent(new a.win.MouseEvent(kind, {',
  '        clientX: cx, clientY: cy, bubbles: true, cancelable: true }));',
  '    }',
  '    function mapScale() { return map.width / 256; }',
  '    var r0 = map.getBoundingClientRect();',
  '    function cellX(cx) { return r0.left + (cx * 8 + 4) * mapScale(); }',
  '    function cellY(cy) { return r0.top + (cy * 8 + 4) * mapScale(); }',
  '    ck(map.width >= 256 && map.height >= 256,',
  '       "the map canvas is drawn in the browser (" + map.width + "x" +',
  '       map.height + ")");',
  '    cs.screenSetTool("pencil");',
  '    mapEvent("mousedown", cellX(3), cellY(4));',
  '    mapEvent("mouseup", cellX(3), cellY(4));',
  '    ck(cs.screen().cell(3, 4) === 0x41,',
  '       "a real mouse event paints the cell under the pointer");',
  '    var mg = map.getContext("2d");',
  '    var mp = mg.getImageData((3 * 8 + 2) * mapScale(),',
  '                             (4 * 8 + 3) * mapScale(), 1, 1).data;',
  '    ck(mp[0] === 252 && mp[1] === 252 && mp[2] === 252,',
  '       "the canvas shows the painted pixel (rgb " + mp[0] + "," + mp[1] +',
  '       "," + mp[2] + ")");',
  '    cs.screenSetTool("rect");',
  '    mapEvent("mousedown", cellX(6), cellY(6));',
  '    mapEvent("mousemove", cellX(8), cellY(8));',
  '    mapEvent("mouseup", cellX(8), cellY(8));',
  '    var block = 0;',
  '    for (var yy = 6; yy <= 8; yy++)',
  '      for (var xx = 6; xx <= 8; xx++)',
  '        if (cs.screen().cell(xx, yy) === 0x41) block++;',
  '    ck(block === 9, "a real drag fills a 3x3 rect (" + block + " cells)");',
  '    cdoc.getElementById("scr-zoom-2x").click();',
  '    ck(map.width === 512 && cs.screen().zoom === "2x",',
  '       "the 2x chip redraws the map at 512 px in the browser");',
  '    cdoc.getElementById("scr-zoom-fit").click();',
  '    var grid = cdoc.getElementById("scr-grid");',
  '    grid.checked = false;',
  '    grid.dispatchEvent(new a.win.Event("change", { bubbles: true }));',
  '    ck(cs.screen().grid === false, "the grid checkbox works in the browser");',
  '',
  '    /* #85: the PALETTES picker and the VRAM map with real DOM clicks and a',
  '     * real canvas. */',
  '    cs.loadExample("palette", true);',
  '    cs.pause();',
  '    cs.seek(0);',
  '    cs.panels.select("palettes");',
  '    cdoc.getElementById("pal-0-5").click();',
  '    cdoc.getElementById("pal-c-7").click();',
  '    var palAfter = JSON.parse(cs.files().filter(function (f) {',
  '      return f.name === "palettes.json"; })[0].source);',
  '    ck(palAfter.background[0][5] === 0x38,',
  '       "a real click on a swatch and a picker colour writes $038 (" +',
  '       palAfter.background[0][5] + ")");',
  '    ck(/rgb\\(252,\\s*0,\\s*0\\)/.test(cdoc.getElementById("pal-0-5").style.background),',
  '       "the swatch is red in the browser (" +',
  '       cdoc.getElementById("pal-0-5").style.background + ")");',
  '    ck(/CRAM \\$005/.test(cdoc.getElementById("pal-readout").textContent),',
  '       "the readout names CRAM $005 in the browser");',
  '    cs.panels.select("vram");',
  '    cs.vramPage(0);',
  '    var vmap = cdoc.getElementById("vrammap");',
  '    ck(vmap.width === 384 && vmap.height === 384,',
  '       "the VRAM map canvas is 384 px in the browser (" + vmap.width + ")");',
  '    var vctx = vmap.getContext("2d");',
  '    var vimg = cs.vramImage();',
  '    ck(!!vimg && vimg.width === 128, "the sheet is 128 x 128 in the browser");',
  '    /* character $40 is cell 64: column 0, row 4; its (0,0) pixel is colour 15 */',
  '    var drawn = vctx.getImageData(0, 97, 1, 1).data;',
  '    var sheetPx = vimg.data[(32 * 128) * 4];',
  '    ck(drawn[0] === sheetPx,',
  '       "the canvas shows the sheet\'s own pixel (" + drawn[0] + " vs " +',
  '       sheetPx + ")");',
  '    var vr = vmap.getBoundingClientRect();',
  '    vmap.dispatchEvent(new a.win.MouseEvent("click", {',
  '      clientX: vr.left + 5, clientY: vr.top + 100,',
  '      bubbles: true, cancelable: true }));',
  '    ck(cs.vram().selected === 0x401,',
  '       "a real click on the map selects the word under the pointer (" +',
  '       cs.vram().selected + ")");',
  '    ck(cs.vram().overlays.labels.indexOf("BAT") >= 0,',
  '       "the BAT is labelled on the drawn map in the browser");',
  '    /* #107 — Paste & Run: the clipboard, the fence, the run, undo, a dropped',
  '     * .lua, and the fallback box when the browser refuses the clipboard. */',
  '    cs.loadExample("raster", true);',
  '    var beforePaste = cs.editorText();',
  '    var paletteSrc = cs.examples.filter(function (e) { return e.id === "palette"; })[0].source;',
  '    var fenced = "Here is your toy:\\n\\n```lua\\n" + paletteSrc +',
  '      "```\\n\\nCopy this, then press Paste & Run.";',
  '    try {',
  '      Object.defineProperty(a.win.navigator, "clipboard", { configurable: true,',
  '        value: { readText: function () { return Promise.resolve(fenced); } } });',
  '    } catch (e) { ck(false, "the test can stand in for the clipboard"); }',
  '    cdoc.getElementById("btn-paste-run").click();',
  '    await new Promise(function (r) { setTimeout(r, 200); });',
  '    ck(cs.lastError() === null, "Paste & Run from the clipboard leaves no error (" +',
  '       JSON.stringify(cs.lastError()) + ")");',
  '    ck(cs.editorText() === paletteSrc,',
  '       "the pasted main.lua is the fence\'s code, not the prose around it");',
  '    ck(cs.current().source === paletteSrc,',
  '       "the pasted source is the Lua the page runs");',
  '    cs.seek(60); cs.pause();',
  '    var out7 = cs.output(), cram7 = cs.runtime().last.state.cram, vis7 = 0;',
  '    function cramRgb7(cram, addr) {',
  '      var v = cram[addr * 2] | (cram[addr * 2 + 1] << 8);',
  '      return [36 * ((v >> 3) & 7), 36 * ((v >> 6) & 7), 36 * (v & 7)];',
  '    }',
  '    var bg7 = cramRgb7(cram7, 0);',
  '    for (var i7 = 0; i7 < out7.pixels.length; i7 += 3) {',
  '      if (out7.pixels[i7] !== bg7[0] || out7.pixels[i7 + 1] !== bg7[1] ||',
  '          out7.pixels[i7 + 2] !== bg7[2]) vis7++;',
  '    }',
  '    ck(vis7 > 50000, "the pasted toy runs and is visible (" + vis7 +',
  '       " non-backdrop pixels at frame 60)");',
  '',
  '    cs.codeMirror().undo();',
  '    ck(cs.editorText() === beforePaste,',
  '       "Ctrl+Z restores the source that Paste & Run replaced");',
  '    ck(cs.current().source === beforePaste,',
  '       "and the page runs the restored source again");',
  '',
  '    try {',
  '      var dt7 = new a.win.DataTransfer();',
  '      dt7.items.add(new a.win.File([paletteSrc], "from-ai.lua",',
  '        { type: "text/plain" }));',
  '      a.win.dispatchEvent(new a.win.DragEvent("drop",',
  '        { dataTransfer: dt7, bubbles: true, cancelable: true }));',
  '    } catch (e) { ck(false, "a DragEvent could be built (" + e.message + ")"); }',
  '    for (var w7 = 0; w7 < 100 && cs.lastDrop().status === "pending"; w7++) {',
  '      await new Promise(function (r) { setTimeout(r, 20); });',
  '    }',
  '    ck(cs.lastDrop().status === "done",',
  '       "a dropped .lua loads (drop status " + cs.lastDrop().status + ")");',
  '    ck(cs.lastDrop().name === "from-ai.lua",',
  '       "the dropped file is the one that loaded (" + cs.lastDrop().name + ")");',
  '    ck(cs.editorText() === paletteSrc && cs.current().source === paletteSrc,',
  '       "the dropped .lua is main.lua and the Lua the page runs");',
  '',
  '    try {',
  '      Object.defineProperty(a.win.navigator, "clipboard", { configurable: true,',
  '        value: { readText: function () {',
  '          return Promise.reject(new Error("denied")); } } });',
  '    } catch (e) {}',
  '    cdoc.getElementById("btn-paste-run").click();',
  '    await new Promise(function (r) { setTimeout(r, 100); });',
  '    ck(cs.pasteBox().open === true,',
  '       "the browser refusing the clipboard opens the fallback paste box");',
  '    ck(/refused/i.test(cs.pasteBox().note),',
  '       "the box says why (" + cs.pasteBox().note.slice(0, 64) + ")");',
  '    cs.setPasteBoxText("```lua\\n" + beforePaste + "```");',
  '    cdoc.getElementById("paste-go").click();',
  '    ck(cs.pasteBox().open === false, "the box closes once the toy runs");',
  '    ck(cs.editorText() === beforePaste && cs.lastError() === null,',
  '       "the box\'s code becomes main.lua and runs");',
  '',
  '    /* #115 — Export to ROM from the page.  The Export button analyses the',
  '     * toy with the CONSOLE tab\'s checks, encodes it, fetches renderer/',
  '     * ilvm.bin over this HTTP origin and downloads a Blob.  The anchor is',
  '     * intercepted so headless Chrome writes no file; the blob URL is',
  '     * fetched back and held against Node buildToyRom\'s FNV and length. */',
  '    var downloads = [];',
  '    var proto = a.win.HTMLAnchorElement && a.win.HTMLAnchorElement.prototype;',
  '    if (proto) proto.click = function () {',
  '      downloads.push({ name: this.download, href: this.href });',
  '    };',
  '    function fnv(u8) { var h = 2166136261 >>> 0;',
  '      for (var i = 0; i < u8.length; i++)',
  '        h = Math.imul(h ^ u8[i], 16777619) >>> 0; return h >>> 0; }',
  '    function sameBytes(x, y) { if (x.length !== y.length) return false;',
  '      for (var i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;',
  '      return true; }',
  '    async function exportAndDownload(s, example) {',
  '      downloads.length = 0;',
  '      s.loadExample(example, true);',
  '      var st = await s.exportToy();',
  '      var link = downloads[0] || null, bytes = null;',
  '      if (link) bytes = new Uint8Array(await (await a.win.fetch(link.href))',
  '        .arrayBuffer());',
  '      return { state: st, link: link, bytes: bytes };',
  '    }',
  '    var pex = await exportAndDownload(cs, "palette");',
  '    ck(pex.state && pex.state.phase === "built",',
  '       "the Export button builds the palette toy in the page (" +',
  '       (pex.state && pex.state.phase) + ")");',
  '    ck(!!pex.link && pex.link.name === "palette-cycle.pce",',
  '       "the page downloads palette-cycle.pce (" +',
  '       (pex.link && pex.link.name) + ")");',
  '    ck(!!pex.bytes && pex.bytes.length === EXPECT.palette.length &&',
  '       fnv(pex.bytes) === EXPECT.palette.fnv,',
  '       "the downloaded palette ROM is Node buildToyRom\'s bytes (" +',
  '       (pex.bytes ? pex.bytes.length : "none") + " B, fnv " +',
  '       (pex.bytes ? fnv(pex.bytes) : "none") + ")");',
  '    var pAgain = cs.exportBytes(cs.exportBank0());',
  '    ck(pAgain.ok && sameBytes(pAgain.bytes, pex.bytes),',
  '       "the download is the page\'s own exportBytes build");',
  '    ck(/Built palette-cycle\\.pce/.test(',
  '         cdoc.getElementById("export-lead").textContent),',
  '       "the dialog says what it built (" +',
  '       cdoc.getElementById("export-lead").textContent + ")");',
  '    ck(/does not meet 60 Hz/.test(',
  '         cdoc.getElementById("export-route").textContent),',
  '       "the dialog says route 1 does not meet 60 Hz (" +',
  '       cdoc.getElementById("export-route").textContent + ")");',
  '    ck(/Experimental: frame timing is\\s+a static estimate, checked on an\\s+' +
    'emulator, not on hardware\\./.test(',
  '         cdoc.getElementById("export-footer").textContent),',
  '       "the dialog footer is the Experimental static-estimate sentence");',
  '',
  '    var xex = await exportAndDownload(cs, "sky-gradient");',
  '    ck(xex.state && xex.state.phase === "built",',
  '       "the Export button builds the sky gradient in the page (" +',
  '       (xex.state && xex.state.phase) + ")");',
  '    ck(!!xex.link && xex.link.name === "sky-gradient.pce",',
  '       "the page downloads sky-gradient.pce (" +',
  '       (xex.link && xex.link.name) + ")");',
  '    ck(!!xex.bytes && xex.bytes.length === EXPECT["sky-gradient"].length &&',
  '       fnv(xex.bytes) === EXPECT["sky-gradient"].fnv,',
  '       "the downloaded sky-gradient ROM is Node buildToyRom\'s bytes (" +',
  '       (xex.bytes ? xex.bytes.length : "none") + " B, fnv " +',
  '       (xex.bytes ? fnv(xex.bytes) : "none") + ")");',
  '    ck(/Route 1: \\d+ B of IL bytecode/.test(',
  '         cdoc.getElementById("export-route").textContent),',
  '       "the dialog names the route and the bytecode (" +',
  '       cdoc.getElementById("export-route").textContent + ")");',
  '',
  '    downloads.length = 0;',
  '    cs.setEditorText("function frame(t, f)\\n  reg(\\"NOPE\\", 0)\\nend\\n");',
  '    var bex = await cs.exportToy();',
  '    ck(bex.phase === "blocked",',
  '       "a toy the CONSOLE tab refuses does not build (" + bex.phase + ")");',
  '    ck(downloads.length === 0,',
  '       "… and downloads nothing (" + downloads.length + ")");',
  '    ck(/can\'t run on the PC Engine as written yet/.test(',
  '         cdoc.getElementById("export-lead").textContent),',
  '       "the dialog leads with the can\'t-run sentence");',
  '    var fits = cdoc.getElementById("export-findings")',
  '      .querySelectorAll(".export-finding");',
  '    ck(fits.length > 0 && /main\\.lua:2/.test(fits[0].textContent),',
  '       "the findings list carries main.lua:2 (" +',
  '       (fits[0] && fits[0].textContent) + ")");',
  '    var flink = fits[0] && fits[0].querySelector("button.export-line");',
  '    if (flink) flink.click();',
  '    ck(cs.codeMirror().getCursor().line === 1,',
  '       "a finding\'s main.lua:2 link moves the editor to line 2 (" +',
  '       cs.codeMirror().getCursor().line + ")");',
  '',
  '    cdoc.getElementById("btn-export").click();',
  '    await new Promise(function (r) { setTimeout(r, 50); });',
  '    cs.setEditorText("function init()\\n  timer(60, function() end)\\nend\\n" +',
  '                     "function frame(t, f)\\nend\\n");',
  '    var tex = await cs.exportToy();',
  '    ck(tex.phase === "blocked" && (tex.findings || []).some(function (f) {',
  '         return /^ilbc-/.test(f.code); }),',
  '       "route 1\'s encoder refusal is a finding (" +',
  '       (tex.findings || []).map(function (f) { return f.code; })',
  '         .join(", ") + ")");',
  '    cdoc.getElementById("export-done").click();',
  '    ck(cdoc.getElementById("export-modal").hidden === true,',
  '       "the Export dialog closes");',
  '    cs.loadExample("palette", true);',
  '',
  '    done();',
  '  })().catch(function (e) {',
  '    ck(false, "driver threw: " + (e && e.message ? e.message : e));',
  '    done();',
  '  });',
  '})();',
  '</script>'
].join("\n");

function startStudioServer() {
  const root = path.resolve(__dirname, "..");
  const types = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8", ".json": "application/json",
    ".png": "image/png", ".bin": "application/octet-stream"
  };
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, "http://127.0.0.1");
      if (url.pathname === "/__driver.html") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(DRIVER_HTML);
        return;
      }
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
      const file = path.resolve(root, rel);
      if (file !== root && !file.startsWith(root + path.sep)) {
        res.writeHead(403); res.end("forbidden"); return;
      }
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); res.end("not found"); return; }
        res.writeHead(200, { "content-type":
          types[path.extname(file).toLowerCase()] || "application/octet-stream" });
        res.end(data);
      });
    });
    server.listen(0, "127.0.0.1", () =>
      resolve({ server, port: server.address().port }));
  });
}

function spawnChrome(args, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(CHROME, args, { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch (e) {}
      resolve({ out, timedOut: true });
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ out, code });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ out, error });
    });
  });
}

async function checkBrowserDriver() {
  const { server, port } = await startStudioServer();
  const profile = path.join(process.env.TMPDIR || os.tmpdir(),
                            "pcestudio-chrome-77-" + process.pid);
  let dom = "";
  try {
    const res = await spawnChrome([
      "--headless=new", "--disable-gpu", "--no-sandbox",
      "--user-data-dir=" + profile,
      "--virtual-time-budget=30000",
      "--dump-dom", "http://127.0.0.1:" + port + "/__driver.html"
    ], 120000);
    dom = res.out || "";
    if (res.timedOut) check(false, "headless Chrome driver finished in time");
    if (res.error) check(false, "headless Chrome driver started (" +
      res.error.message + ")");
  } finally {
    server.close();
  }
  const m = dom.match(/id="driver-result"[^>]*>([\s\S]*?)<\/pre>/);
  const text = m ? m[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&") : "";
  const lines = text.split("\n").filter((l) => /^(PASS|FAIL) /.test(l));
  if (!lines.length) {
    check(false, "the headless browser driver produced a result (" +
      (text.trim().slice(0, 120) || "no #driver-result") + ")");
    return "fail";
  }
  for (const line of lines) {
    check(line.slice(0, 4) === "PASS", "browser driver: " + line.slice(5));
  }
  console.log("      browser driver: " + lines.length + " checks, " +
    lines.filter((l) => l.slice(0, 4) === "FAIL").length + " failed");
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  return lines.every((l) => l.slice(0, 4) === "PASS") ? "pass" : "fail";
}

async function checkBrowser() {
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

  /* The Docs panel in the real browser: the page is the #61 reference with
   * the ppu.toys docs layout, opened by ?docs=<chapter>. */
  const docsProfile = profile + "-docs";
  const docsUrl = pathToFileURL(PAGE).href + "?docs=sprites&paused=1";
  let docsDom = "";
  try {
    docsDom = execFileSync(CHROME, [
      "--headless=new", "--disable-gpu", "--no-sandbox",
      "--user-data-dir=" + docsProfile,
      "--virtual-time-budget=25000",
      "--dump-dom", docsUrl
    ], { encoding: "utf8", timeout: 120000,
         stdio: ["ignore", "pipe", "ignore"] });
  } catch (e) {
    check(false, "headless Chrome ran the Docs panel (" + e.message + ")");
  }
  const docsTag = docsDom.match(/<section[^>]*id="docs-panel"[^>]*>/);
  check(!!docsTag && !/\bhidden\b/.test(docsTag[0]),
        "headless Chrome: ?docs opens the Docs panel (no hidden attribute)");
  check(docsDom.indexOf('id="docs-frame"') >= 0,
        "headless Chrome: the Docs panel carries the docs iframe");
  check(docsDom.indexOf("SEARCH THE GUIDE") >= 0 &&
        docsDom.indexOf("docs-map") >= 0 &&
        docsDom.indexOf("The toy author") >= 0,
        "headless Chrome: the docs iframe is the generated reference with " +
        "ppu.toys' search and chapter map");
  console.log("      browser docs: " + (docsTag ? "docs-panel open" : "no panel") +
              ", #61 reference + ppu.toys layout");
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  try { fs.rmSync(docsProfile, { recursive: true, force: true }); } catch (e) {}

  /* #77: CodeMirror, assets, save/reopen, autosave across a reload, Vim and
   * every PCE shortcut, in a real browser over HTTP. */
  const driver = await checkBrowserDriver();

  return /^PASS 40 frames/.test(text) && driver === "pass" ? "pass" : "fail";
}

/* ---- 11. #84: the SCREEN panel's cell-map editor ---------------------- */

function framePixel(frame, x, y) {
  const o = (y * frame.width + x) * 3;
  return [frame.pixels[o], frame.pixels[o + 1], frame.pixels[o + 2]];
}

/* An event at a chosen point of an element, in the stub DOM's own shape. */
function pointerAt(el, clientX, clientY) {
  return { type: "mousedown", target: el, currentTarget: el,
           preventDefault() {}, stopPropagation() {},
           clientX: clientX, clientY: clientY, key: "", code: "",
           ctrlKey: false, metaKey: false, shiftKey: false, altKey: false };
}

function mapCells(studio) {
  const out = [];
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) out.push(studio.screen().cell(x, y));
  return out;
}

function countChar(cells, char) {
  let n = 0;
  for (const c of cells) if (c === char) n++;
  return n;
}

function checkScreenPanel(page) {
  const S = page.sandbox.PCEStudio;
  const studio = S.studio;
  const sc = S.screen;
  check(!!sc && typeof sc.session === "function",
        "#84: renderer/pce-screen.js loaded");
  check(page.loaded.some((s) => /pce-screen\.js$/.test(s)),
        "the page loads renderer/pce-screen.js");
  if (!sc || !studio.screen) { check(false, "#84: the page has no screen editor"); return; }

  /* the ppu.toys row: six tools, four zooms, the grid, the footers */
  eq("the tool row", sc.TOOLS.map((t) => t.id),
     ["select", "pencil", "rect", "fill", "erase", "move"]);
  eq("the zoom row", sc.ZOOMS, ["fit", "1x", "2x", "4x"]);
  for (const t of sc.TOOLS)
    check(!!page.dom.get("scr-tool-" + t.id), "tool " + t.id + " has a button");
  for (const z of sc.ZOOMS)
    check(!!page.dom.get("scr-zoom-" + z), "zoom " + z + " has a button");
  check(page.dom.get("scr-grid").checked === true, "the cell grid starts on");
  check(/32 × 32 cells/.test(page.dom.get("scr-foot").textContent),
        "the footer says 32 × 32 cells");
  check(/visible screen/.test(page.dom.get("scr-foot").textContent),
        "the footer names the visible screen");
  check(/Select first cell/.test(page.dom.get("scr-pick").textContent),
        "the pick line starts on 'Select first cell'");
  check(!!page.dom.get("scr-map") && !!page.dom.get("scr-tiles") &&
        !!page.dom.get("scr-tileedit"),
        "the map, the tile sheet and the tile editor are all on the panel");

  let st = studio.screen();
  check(!!st, "the panel has a session over the toy's assets");
  if (!st) return;
  check(st.tiles === 1, "a fresh toy's assets hold one tile (got " +
        st.tiles + ")");
  check(st.mapSize.width === 32 && st.mapSize.height === 32 &&
        st.mapSize.mwr === 0,
        "the map is the 32×32 BAT, MWR $00");
  check(st.error === "", "the fresh assets load without an error (" +
        st.error + ")");

  /* palette 0 colour 5 = white ($1FF), so one painted pixel is visible */
  studio.selectFile("palettes.json");
  const pal = JSON.parse(studio.files().find((f) =>
    f.name === "palettes.json").source);
  pal.background = pal.background || [];
  pal.background[0] = new Array(16).fill(0);
  pal.background[0][5] = 0x1FF;
  studio.setEditorText(JSON.stringify(pal));
  studio.selectFile("main.lua");

  /* + tile, then the tile pencil paints one pixel of it */
  studio.screenNewTile();
  st = studio.screen();
  check(st.tiles === 2 && st.tile === 0x41,
        "the + tile button makes tile $41 and selects it");
  studio.screenSelectColour(5);
  check(studio.screen().colour === 5, "the palette strip picks colour 5");
  const beforePaint = studio.screenFrame();
  check(studio.screenPaintTilePixel(2, 3) === 1,
        "the tile pencil writes the tile into tiles.json");
  let tiles = JSON.parse(studio.files().find((f) => f.name === "tiles.json").source);
  const tile41 = tiles.tiles.find((t) => t.char === 0x41);
  check(!!tile41 && tile41.pixels[3 * 8 + 2] === 5,
        "tiles.json holds the painted pixel (tile $41, pixel 2,3 = 5)");

  /* pencil: one cell, and exactly one frame pixel changes */
  studio.screenSetTool("pencil");
  studio.screenClick(3, 4);
  check(studio.screen().cell(3, 4) === 0x41,
        "the pencil paints the selected tile into cell (3,4)");
  tiles = JSON.parse(studio.files().find((f) => f.name === "tiles.json").source);
  check(tiles.map.cells[4 * 32 + 3] === 0x41,
        "tiles.json's map names the tile at (3,4)");
  const afterPaint = studio.screenFrame();
  check(diffCount(beforePaint.pixels, afterPaint.pixels).n === 3,
        "exactly one frame pixel changed, one colour byte each (" +
        diffCount(beforePaint.pixels, afterPaint.pixels).n + " bytes)");
  eq("the frame pixel is palette 0's colour 5",
     framePixel(afterPaint, 3 * 8 + 2, 4 * 8 + 3), [252, 252, 252]);
  check(studio.files().find((f) => f.name === "tiles.json").source ===
        sc.tilesText(studio.screenPicture()),
        "tiles.json is the picture's own text, not a second copy");

  /* pencil drag paints every cell between the endpoints */
  studio.screenPress(0, 5);
  studio.screenDrag(5, 5);
  studio.screenRelease(5, 5);
  let row = [];
  for (let x = 0; x <= 5; x++) row.push(studio.screen().cell(x, 5));
  eq("a pencil drag paints the line, no gaps",
     row.join(","), "65,65,65,65,65,65");

  /* rect: a 4x3 block */
  studio.screenSetTool("rect");
  studio.screenPress(2, 2);
  studio.screenDrag(5, 4);
  studio.screenRelease(5, 4);
  let cells = mapCells(studio);
  let block = 0;
  for (let y = 2; y <= 4; y++)
    for (let x = 2; x <= 5; x++) if (studio.screen().cell(x, y) === 0x41) block++;
  check(block === 12, "the rect fills its 4×3 block (got " + block + ")");
  check(countChar(cells, 0x41) === 12 + 6,
        "the rect changed only its own cells (" + countChar(cells, 0x41) +
        " of 1024 are $41)");

  /* fill: the connected $40 region becomes the selected tile, and a tile of
   * a different character is a wall.  The #84 breaker's M02 dropped the
   * neighbour test, and a whole-map fill cannot tell the two apart: every
   * cell is the same $40, so an unconditional flood lands on the same 1024
   * cells.  The island of $42 is what separates them. */
  studio.screenNewTile();
  check(studio.screen().tile === 0x42,
        "a second + tile makes tile $42 and selects it (got $" +
        (studio.screen().tile || 0).toString(16).toUpperCase() + ")");
  studio.screenSetTool("pencil");
  const ISLAND = [[10, 10], [11, 10], [10, 11], [11, 11]];
  for (const [ix, iy] of ISLAND) studio.screenClick(ix, iy);
  check(ISLAND.every(([ix, iy]) => studio.screen().cell(ix, iy) === 0x42),
        "the island is four cells of $42 inside the $40 field");
  studio.screenSelectChar(0x41);
  studio.screenSetTool("fill");
  studio.screenClick(25, 25);
  cells = mapCells(studio);
  check(countChar(cells, 0x42) === 4,
        "the bucket stops at a different tile (the island's " +
        countChar(cells, 0x42) + " cells stay $42)");
  check(countChar(cells, 0x41) === 1020,
        "the bucket fills the connected $40 region (" + countChar(cells, 0x41) +
        " of 1024 cells are $41, the island's 4 are not)");

  /* erase: back to the blank tile */
  studio.screenSetTool("erase");
  studio.screenClick(3, 3);
  check(studio.screen().cell(3, 3) === 0x40,
        "erase paints the blank tile of the cell's palette");

  /* move: a cell's tile moves, the source goes blank */
  studio.screenSetTool("pencil");
  studio.screenClick(7, 7);
  studio.screenSetTool("move");
  studio.screenPress(7, 7);
  studio.screenDrag(9, 9);
  studio.screenRelease(9, 9);
  check(studio.screen().cell(9, 9) === 0x41 &&
        studio.screen().cell(7, 7) !== 0x41,
        "move takes the tile with it and blanks the source");

  /* select: a rectangle, and the footer counts it */
  studio.screenSetTool("select");
  studio.screenPress(1, 1);
  studio.screenDrag(4, 3);
  studio.screenRelease(4, 3);
  eq("select commits the rectangle", studio.screen().selection,
     { x0: 1, y0: 1, x1: 4, y1: 3 });
  check(/4 × 3 = 12 cells/.test(page.dom.get("scr-pick").textContent),
        "the pick line counts the selection");

  /* the zoom row changes the canvas, never the BAT: the #84 breaker's M05
   * made a zoom chip resample the zoomed picture back into the map and
   * commit it.  The dimension assertions alone cannot see that (every canvas
   * size stays right), so each chip is bracketed by a snapshot of the map's
   * cells and of tiles.json's own bytes. */
  const ZOOM_PX = { "2x": 512, "4x": 1024, "1x": 256 };
  for (const z of ["2x", "4x", "1x", "fit"]) {
    const cellsBeforeZoom = mapCells(studio);
    const jsonBeforeZoom = studio.files().find((f) =>
      f.name === "tiles.json").source;
    clickOne(page, "scr-zoom-" + z);
    check(studio.screen().zoom === z, "the " + z + " chip sets the zoom");
    if (ZOOM_PX[z]) {
      check(studio.screenCanvas().map === ZOOM_PX[z],
            z + " draws a " + ZOOM_PX[z] + "-px map canvas (got " +
            studio.screenCanvas().map + ")");
    } else {
      check(studio.screenCanvas().map >= 256, "Fit fills the panel");
    }
    const zoomDiff = mapCells(studio).filter((c, i) =>
      c !== cellsBeforeZoom[i]).length;
    check(zoomDiff === 0,
          "zooming to " + z + " leaves the BAT's cells unchanged (" +
          zoomDiff + " of 1024 cells changed)");
    check(studio.files().find((f) => f.name === "tiles.json").source ===
          jsonBeforeZoom,
          "zooming to " + z + " leaves tiles.json byte for byte unchanged");
  }

  /* the grid checkbox */
  const gridBox = page.dom.get("scr-grid");
  gridBox.checked = false;
  for (const fn of gridBox.listeners.change || [])
    fn(page.dom.fakeEvent(gridBox));
  check(studio.screen().grid === false, "the grid checkbox turns the grid off");
  gridBox.checked = true;
  for (const fn of gridBox.listeners.change || [])
    fn(page.dom.fakeEvent(gridBox));
  check(studio.screen().grid === true, "and back on");

  /* the palette strip and the tile sheet are clickable */
  const strip = page.dom.get("scr-palette");
  check(strip.children.length === 16, "the palette strip has 16 colours");
  strip.children[7].click();
  check(studio.screen().colour === 7, "clicking a swatch picks that colour");
  const tilesCanvas = page.dom.get("scr-tiles");
  const trect = tilesCanvas.getBoundingClientRect();
  const tev = pointerAt(tilesCanvas, trect.left + 12, trect.top + 4);
  for (const fn of tilesCanvas.listeners.click || []) fn(tev);
  check(studio.screen().tile === 0x41, "the tile sheet selects the clicked tile");

  /* the tile editor paints a pixel of the selected tile */
  const te = page.dom.get("scr-tileedit");
  const erect = te.getBoundingClientRect();
  const eev = pointerAt(te,
    erect.left + (2.5 / 8) * (erect.width || 64),
    erect.top + (3.5 / 8) * (erect.height || 64));
  for (const fn of te.listeners.mousedown || []) fn(eev);
  const tileNow = JSON.parse(studio.files().find((f) =>
    f.name === "tiles.json").source).tiles.find((t) => t.char === 0x41);
  check(!!tileNow && tileNow.pixels[3 * 8 + 2] === studio.screen().colour,
        "the tile editor paints the pixel under the pointer (" +
        (tileNow ? tileNow.pixels[3 * 8 + 2] : "none") + ")");

  /* BXR/BYR: the map scrolls and the frame shifts exactly one pixel */
  const beforeBxr = studio.screenFrame();
  clickOne(page, "scr-bxr-up");
  check(studio.screen().scroll.BXR === 1, "BXR + moves the scroll to 1");
  const afterBxr = studio.screenFrame();
  eq("BXR 1 shifts the frame one pixel left",
     framePixel(afterBxr, 0, 40), framePixel(beforeBxr, 1, 40));
  const beforeByr = studio.screenFrame();
  clickOne(page, "scr-byr-up");
  check(studio.screen().scroll.BYR === 1, "BYR + moves the scroll to 1");
  const afterByr = studio.screenFrame();
  eq("BYR 1 shifts the frame one pixel up",
     framePixel(afterByr, 40, 0), framePixel(beforeByr, 40, 1));
  tiles = JSON.parse(studio.files().find((f) => f.name === "tiles.json").source);
  check(tiles.map.bxr === 1 && tiles.map.byr === 1,
        "tiles.json carries the scroll with the BAT");

  /* the assets are the toy's: save, reopen, same picture */
  const mapBefore = mapCells(studio);
  const env = studio.envelopeText();
  studio.openToy(env, "roundtrip.pce.json", { apply: false, persist: false });
  eq("reopening the toy restores the BAT", mapCells(studio).join(),
     mapBefore.join());
  check(studio.screen().scroll.BXR === 1 && studio.screen().scroll.BYR === 1,
        "reopening the toy restores BXR/BYR");

  /* the visible-screen outline: its first row is the cell BYR names, and
   * here that cell is computed from the register itself, not from the
   * panel's own arithmetic.  The #84 breaker's M07 started the outline one
   * cell (8 px) low; the stub canvas used to swallow rect(), so nothing
   * noticed.  Two BYR values, neither a multiple of 8, so a mere constant
   * shift cannot hide behind the rounding. */
  const mapCanvas = page.dom.get("scr-map");
  const canvasCalls = () => (mapCanvas.__ctx && mapCanvas.__ctx.__calls) || [];
  const frameLines = studio.screenFrame().height;   /* the picture's window */
  for (const byr of [1, 9]) {
    const mark = canvasCalls().length;
    studio.screenScroll(0, byr - studio.screen().scroll.BYR);
    check(studio.screen().scroll.BYR === byr,
          "the scroll sets BYR to " + byr + " (got " +
          studio.screen().scroll.BYR + ")");
    const scale = mapCanvas.width / 256;
    const outline = canvasCalls().slice(mark)
      .filter((c) => c.name === "rect").map((c) => c.args)[0];
    check(!!outline, "BYR " + byr + ": the visible-screen outline is drawn");
    if (!outline) continue;
    const y0 = byr % 256;
    const cell = Math.floor(((outline[1] - 0.5) / scale) / 8);
    check(cell === Math.floor(y0 / 8),
          "the visible-screen outline starts on the cell BYR " + byr +
          " names (cell " + Math.floor(y0 / 8) + ", drawn at " + cell + ")");
    check(Math.round((outline[3] + 1) / scale) ===
          Math.min(frameLines, 256 - y0),
          "the outline is " + Math.min(frameLines, 256 - y0) + " lines tall " +
          "at BYR " + byr);
    /* BXR cannot move this outline: the window is exactly the map's 256
     * dots wide (the panel says so), so the BXR half of the cell is the
     * full-width x = 0.5.  Pinned here so a stray horizontal offset fails. */
    check(outline[0] === 0.5 && outline[2] === mapCanvas.width - 1,
          "the outline spans the map's full width at BYR " + byr);
  }
  studio.screenScroll(0, 1 - studio.screen().scroll.BYR);
  check(studio.screen().scroll.BYR === 1,
        "the outline test leaves BYR back at 1");

  /* the refusals are pce-editor.js's and the panel's own */
  const fresh = S.editor.newPicture();
  const sess = sc.session(fresh);
  let code = null;
  try { sc.selectColour(sess, 16); } catch (e) { code = e.code; }
  eq("a 17th colour number is refused", code, "colour-index");
  code = null;
  try { sc.setTool(sess, "nope"); } catch (e) { code = e.code; }
  eq("an unknown tool is refused", code, "tool-range");
  code = null;
  try {
    sc.pictureFromFiles([{ name: "tiles.json",
      source: JSON.stringify({ version: 1, tiles: [],
        map: { mwr: 16, cells: [] } }) }]);
  } catch (e) { code = e.code; }
  eq("a wider MWR map names part B rather than pretending", code, "map-size");
  code = null;
  try {
    sc.pictureFromFiles([{ name: "tiles.json",
      source: JSON.stringify({ version: 1, tiles: [],
        map: { mwr: 0, cells: new Array(1024).fill(0x41) } }) }]);
  } catch (e) { code = e.code; }
  eq("a map naming a tile the file does not hold is refused", code, "no-tile");
  code = null;
  try { sc.selectTile(sess, 0x7FF); } catch (e) { code = e.code; }
  eq("selecting a missing tile is refused", code, "no-tile");

  /* and the module's own text round-trips */
  const one = sc.pictureFromFiles([{ name: "tiles.json",
    source: JSON.stringify({ version: 1, tiles: [] }) }]);
  const text = sc.tilesText(one);
  const back = sc.pictureFromFiles([{ name: "tiles.json", source: text }]);
  eq("tiles.json round-trips byte for byte", sc.tilesText(back), text);

  /* leave the page on a clean example */
  studio.loadExample("palette", true);
  studio.pause();
}

/* ---- 11b. #86: the SPRITES panel's visual editor ---------------------- *
 * The card closes on: the 64 sprites drawn, one selected and moved on the
 * screen, its pattern edited with #84's tools.  Everything below is driven
 * through the panel's own api object (the module the registry holds), over
 * the live stub page, and every frame assertion is the editor's own
 * renderPreview — there is no second picture to disagree with. */

const SPR_WHITE = 0x1FF;   /* (g=7,r=7,b=7): the editor's white, check-studio's */
const SPR_RED = 0x038;     /* (g=0,r=7,b=0) */

function setAssetFile(studio, name, text) {
  studio.selectFile(name);
  studio.setEditorText(text);
  studio.selectFile("main.lua");
}

function assetText(studio, name) {
  const f = studio.files().find((x) => x.name === name);
  return f ? f.source : null;
}

/* ---- #97: the AUDIO panel as a mixer ---------------------------------- *
 * ppu.toys' AUDIO panel is the shape; the PSG is what it can actually be.
 * Every control is driven through the panel's own API — the same functions
 * its DOM handlers call — and each one is checked twice: the register words
 * the mixer writes, and the PCM renderer/pce-psg.js makes from them.  The
 * meter is checked against that PCM, which is the only way a bar can be
 * evidence rather than decoration. */
function fire(el, type) {
  const listeners = el.listeners[type] || [];
  for (const fn of listeners)
    fn({ type: type, target: el, currentTarget: el,
         preventDefault() {}, stopPropagation() {},
         clientX: 10, clientY: 6, key: "", code: "" });
  return listeners.length;
}

function audioWritesOf(studio, reg) {
  return studio.audioWritesOf(reg).map((w) => w.value);
}

/* The mixer writes R4 twice per voice: once in the setup pass (all off) and
 * once in the enable pass (the level).  [6] is voice 0's enable. */
function audioR4(studio, voice) {
  const w = audioWritesOf(studio, 4);
  return w[6 + voice];
}

function audioR6(studio) {
  return audioWritesOf(studio, 6);
}

/* The peak per side of the rendered PCM for the mix the panel holds. */
function audioPeaks(studio, seconds) {
  const doc = studio.audioMix();
  if (!doc) return { left: 0, right: 0 };
  const pcm = require("../renderer/pce-mix.js").render(doc, seconds || 0.2).pcm;
  let left = 0, right = 0;
  for (let i = 0; i < pcm.length; i += 2) {
    left = Math.max(left, Math.abs(pcm[i]));
    right = Math.max(right, Math.abs(pcm[i + 1]));
  }
  return { left: left, right: right };
}

function checkAudioPanel(page) {
  const S = page.sandbox.PCEStudio;
  const studio = S.studio;
  const mixModel = S.mix;

  check(!!mixModel && typeof mixModel.newMix === "function",
        "#97: renderer/pce-mix.js loaded");
  check(page.loaded.some((s) => /pce-mix\.js$/.test(s)),
        "#97: the page loads renderer/pce-mix.js");
  check(page.loaded.some((s) => /pce-wave\.js$/.test(s)),
        "#97: the page loads renderer/pce-wave.js (the wave editor's model)");
  if (!mixModel || !studio.audio) {
    check(false, "#97: the page has no AUDIO mixer");
    return;
  }

  studio.loadExample("palette", true);
  studio.pause();
  studio.seek(0);
  studio.panels.select("audio");

  /* ---- the mix the panel reads ---------------------------------------- */
  let st = studio.audio();
  eq("#97: the mixer has the PSG's six voices", st.voices.length, 6);
  eq("#97: the mix starts on voice 1", st.selected, 0);
  eq("#97: voice 1 is a wave voice, on, square at A4",
     [st.voices[0].mode, st.voices[0].on, st.voices[0].freq, st.voices[0].note,
      st.voices[0].al, st.voices[0].balance].join(","),
     "wave,true,254,A4,31,255");
  eq("#97: master volume is R1 full ($FF)", st.master, 0xFF);

  /* ---- the rows are on the panel -------------------------------------- */
  const host = page.dom.get("aud-rows");
  const rows = host.children.filter((c) => /aud-row/.test(c.className));
  eq("#97: one header row plus six voice rows", rows.length, 7);
  let controls = 0;
  for (let i = 0; i < 6; i++) {
    const row = page.dom.get("aud-row-" + i);
    controls += row.children.filter((c) => c.tagName === "BUTTON" ||
      c.tagName === "INPUT" || c.tagName === "SELECT" || c.tagName === "CANVAS")
      .length;
  }
  check(controls >= 6 * 7,
        "#97: every voice row carries its controls (" + controls + ")");
  const modeSel = page.dom.get("aud-mode-0");
  const noiseOpt = modeSel.children.find((o) => o.value === "noise");
  check(!!noiseOpt && noiseOpt.disabled === true,
        "#97: the mode picker greys noise on a voice without the generator");
  check(page.dom.get("aud-mode-4").children.find((o) => o.value === "noise")
          .disabled !== true,
        "#97: … and offers it on voice 5");
  const mini = page.dom.get("aud-wave-0");
  mini.__ctx.__calls.length = 0;
  studio.audioSelect(0);
  check(mini.__ctx.__calls.filter((c) => c.name === "fillRect").length === 32,
        "#97: each row draws its 32-step wave (" +
        mini.__ctx.__calls.filter((c) => c.name === "fillRect").length +
        " bars)");

  /* ---- the register stream is the PSG's own --------------------------- */
  let w = studio.audioWrites();
  const r2 = audioWritesOf(studio, 2);
  const r3 = audioWritesOf(studio, 3);
  const r5 = audioWritesOf(studio, 5);
  eq("#97: R2 carries the frequency LSB (254 & $FF)", r2[0], 254);
  eq("#97: R3 carries the high nibble (0 for A4)", r3[0], 0);
  eq("#97: R5 carries the balance ($FF = both sides full)", r5[0], 0xFF);
  eq("#97: the setup pass writes R4 = 0 before the wave",
     audioWritesOf(studio, 4).slice(0, 6).join(","), "0,0,0,0,0,0");
  eq("#97: voice 1 is enabled at AL 31 ($9F)", audioR4(studio, 0), 0x9F);
  eq("#97: the other five voices are off ($00)",
     audioWritesOf(studio, 4).slice(7, 12).join(","), "0,0,0,0,0");
  eq("#97: R6 holds 6 x 32 wave steps", audioR6(studio).length, 192);
  eq("#97: R1 is the master volume", audioWritesOf(studio, 1).join(","), "255");

  /* the mixer's writes ARE pce-wave.js's: fold, not a second generator */
  const wv = S.wave;
  const folded = wv.instructions(mixModel.soundOf(studio.audioMix()))
    .filter((i) => i.write)
    .map((i) => ({ reg: i.write[0], value: i.write[1] }));
  check(JSON.stringify(folded) === JSON.stringify(studio.audioWrites()),
        "#97: the mixer's write stream is pce-wave.js's own");

  /* ---- volume (R4 bits 0-4) ------------------------------------------- */
  studio.audioSolo(0, true);
  const full = audioPeaks(studio, 0.2).left;
  studio.audioLevel(0, 10);
  st = studio.audio();
  eq("#97: the volume slider sets AL", st.voices[0].al, 10);
  eq("#97: AL 10 is R4 = $8A", audioR4(studio, 0), 0x8A);
  eq("#97: the row's slider follows the API",
     page.dom.get("aud-vol-0").value, "10");
  const quiet = audioPeaks(studio, 0.2).left;
  const measured = 20 * Math.log10(quiet / full);
  check(Math.abs(measured - st.meters[0].left.db) < 0.1,
        "#97: the meter is the PCM (AL 31->10: meter " +
        st.meters[0].left.db.toFixed(2) + " dB, measured " +
        measured.toFixed(2) + ")");
  check(Math.abs(st.meters[0].left.vl - 21) === 0,
        "#97: AL 10 is a 21-step reduction");
  studio.audioLevel(0, 0);
  eq("#97: AL 0 is the PSG's off (-inf dB)",
     studio.audio().meters[0].left.db, -Infinity);
  studio.audioLevel(0, 21);
  check(studio.audio().meters[0].left.db < -15 &&
        studio.audio().meters[0].left.db > -16,
        "#97: AL 21 is 11 steps off full, ~1.5 dB each");

  /* the DOM slider is the same action */
  const vol = page.dom.get("aud-vol-0");
  vol.value = "5";
  fire(vol, "input");
  eq("#97: the row's slider writes AL", studio.audio().voices[0].al, 5);
  eq("#97: … and R4", audioR4(studio, 0), 0x85);
  studio.audioLevel(0, 31);
  studio.audioSolo(0, false);          /* the meters below are per voice */

  /* ---- balance (R5), and master (R1) ---------------------------------- */
  studio.audioBalance(0, 0xF0);
  st = studio.audio();
  eq("#97: balance L only is R5 = $F0", st.voices[0].balance, 0xF0);
  eq("#97: … written as $F0", audioWritesOf(studio, 5)[0], 0xF0);
  eq("#97: the left meter is full", st.meters[0].left.vl, 0);
  eq("#97: the right meter is off", st.meters[0].right.vl, 0x1F);
  const lr = audioPeaks(studio, 0.2);
  check(lr.left > 0 && lr.right === 0,
        "#97: R5 $F0 is heard on the left and not the right (" +
        lr.left + " / " + lr.right + ")");
  eq("#97: the row's L/R sliders show the nibbles",
     page.dom.get("aud-balL-0").value + "/" + page.dom.get("aud-balR-0").value,
     "15/0");
  studio.audioBalance(0, 0xFF);

  /* #116 (REVIEW-PANELS 97-A2): the row's own L/R sliders.  The API above is
   * tested; these are the DOM inputs a person drags, and the halves must not
   * be swapped: L owns R5's high nibble, R its low one. */
  studio.audioBalance(0, 0xFF);
  const balL = page.dom.get("aud-balL-0");
  balL.value = "0";
  fire(balL, "input");
  eq("#97: the row's L slider writes R5's high nibble",
     studio.audio().voices[0].balance, 0x0F);
  eq("#97: … and that is R5 = $0F", audioWritesOf(studio, 5)[0], 0x0F);
  eq("#97: … so the left meter is off",
     studio.audio().meters[0].left.vl, 0x1F);
  const balR = page.dom.get("aud-balR-0");
  balR.value = "0";
  fire(balR, "input");
  eq("#97: the row's R slider writes R5's low nibble",
     studio.audio().voices[0].balance, 0x00);
  eq("#97: … and that is R5 = $00", audioWritesOf(studio, 5)[0], 0x00);
  eq("#97: … so the right meter is off too",
     studio.audio().meters[0].right.vl, 0x1F);
  studio.audioBalance(0, 0xFF);

  studio.audioMaster(0xF0);
  st = studio.audio();
  eq("#97: the master is R1", st.master, 0xF0);
  eq("#97: … written to R1", audioWritesOf(studio, 1)[0], 0xF0);
  eq("#97: master L full / R off", st.meters[0].right.vl, 0x1F);
  eq("#97: the master readout names the register",
     /R1 \$F0/.test(page.dom.get("aud-master-readout").textContent), true);
  studio.audioMaster(0xFF);

  /* ---- pitch: the 12-bit word and the note ----------------------------- */
  eq("#97: A4 is F = 254", studio.audioPitch(0, 254), 254);
  eq("#97: … named A4", studio.audio().voices[0].note, "A4");
  eq("#97: … R2 = $FE", audioWritesOf(studio, 2)[0], 0xFE);
  eq("#97: … R3 = $00", audioWritesOf(studio, 3)[0], 0x00);
  const up = studio.audioStep(0, 1);
  eq("#97: the + button steps one semitone to A#4",
     studio.audio().voices[0].note, "A#4");
  check(up < 254 && up > 254 * 0.9,
        "#97: … a higher pitch is a SMALLER divider (" + up + ")");
  studio.audioStep(0, -1);
  eq("#97: and − comes back to A4", studio.audio().voices[0].note, "A4");
  eq("#97: C4 is F 428", studio.audioNote(0, "C4"), 428);
  eq("#97: … named C4", studio.audio().voices[0].note, "C4");
  eq("#97: a 12-bit word reaches into R3", studio.audioPitch(0, 1151), 1151);
  eq("#97: … R3 = $04", audioWritesOf(studio, 3)[0], 0x04);
  eq("#97: … R2 = $7F", audioWritesOf(studio, 2)[0], 0x7F);
  studio.audioPitch(0, 254);

  /* ---- modes: noise and DDA ------------------------------------------- */
  eq("#97: voice 5 takes the noise generator",
     studio.audioMode(4, "noise"), "noise");
  eq("#97: noise writes R7 = $80 | NF",
     audioWritesOf(studio, 7).filter((v) => (v & 0x80))[0], 0x8F);
  const noisePeak = audioPeaks(studio, 0.2);
  check(noisePeak.left !== noisePeak.right || noisePeak.left > 0,
        "#97: a noise voice makes sound");
  eq("#97: a voice without the generator is refused",
     codeOf(() => studio.audioMode(0, "noise")), "noise-channel");
  eq("#97: a mode that is not wave/noise/dda is refused",
     codeOf(() => studio.audioMode(0, "sample")), "mode-range");
  studio.audioMode(4, "wave");

  eq("#97: voice 2 can hold a DDA level", studio.audioMode(1, "dda"), "dda");
  eq("#97: … the setup pass selects DDA while still off ($40)",
     audioWritesOf(studio, 4)[1], 0x40);
  eq("#97: … and an off DDA voice writes no level", audioR6(studio).length, 160);
  studio.audioOn(1, true);
  eq("#97: DDA on sets R4 bit 6 ($C0 | AL)", audioR4(studio, 1) & 0xC0, 0xC0);
  eq("#97: a DDA voice writes no 32-step wave",
     audioR6(studio).length, 161);
  eq("#97: the DDA level is the one R6 write", audioR6(studio)[160], 16);
  eq("#97: the panel counts the DDA bytes in the ROM",
     studio.audio().ddaBytes, 4);
  check(/DDA sample bytes in the ROM · 4 B/.test(
          page.dom.get("aud-budget").textContent),
        "#97: the footer counts them (" +
        page.dom.get("aud-budget").textContent + ")");
  eq("#97: a DDA level past 31 is refused",
     codeOf(() => studio.audioDdaLevel(1, 32)), "dda-range");
  studio.audioMode(1, "wave");
  studio.audioOn(1, false);
  eq("#97: back to wave writes R4 with bit 6 clear", audioR4(studio, 1) & 0xC0, 0);
  eq("#97: and the DDA byte count falls to 0", studio.audio().ddaBytes, 0);

  /* ---- M and S --------------------------------------------------------- */
  studio.audioMute(2, true);
  st = studio.audio();
  eq("#97: M takes the voice out", st.audible[2], false);
  eq("#97: … by writing R4 = $00", audioR4(studio, 2), 0x00);
  eq("#97: a muted voice's meter is off", st.meters[2].left.vl, 0x1F);
  check(page.dom.get("aud-mute-2").classList.contains("is-on"),
        "#97: the M button shows it");
  eq("#97: the M button toggles it back",
     (fire(page.dom.get("aud-mute-2"), "click"), studio.audio().voices[2].mute),
     false);

  studio.audioSolo(0, false);
  studio.audioOn(2, true);
  studio.audioSolo(2, true);
  eq("#97: S leaves only that voice on", studio.audio().audible.join(","),
     "false,false,true,false,false,false");
  eq("#97: … the others' R4 is $00",
     audioWritesOf(studio, 4).slice(6).join(","),
     "0,0,159,0,0,0");
  studio.audioSolo(2, false);
  studio.audioOn(2, false);
  studio.audioSolo(0, true);

  /* ---- the LFO --------------------------------------------------------- */
  let lfo = studio.audioLfo(1, 200);
  eq("#97: LFCTL 1 and R8 = 200", [lfo.ctl, lfo.freq].join(","), "1,200");
  eq("#97: R8 is written", audioWritesOf(studio, 8).pop(), 200);
  const r9 = audioWritesOf(studio, 9);
  eq("#97: R9 is a strobe: set bit 7, then clear it",
     r9.slice(-2).join(","), (0x81) + "," + 1);
  eq("#97: with the LFO on, voice 2 is the silent carrier",
     studio.audio().writes.filter((x) => x.reg === 4)[7].value, 0x80);
  check(/voice 2 is the carrier/.test(
          page.dom.get("aud-lfo-readout").textContent),
        "#97: the LFO tab says what it does");
  studio.audioLfo(0);
  eq("#97: LFO off writes no R8/R9", studio.audioWritesOf(8).length, 0);

  /* ---- the driver's envelope ------------------------------------------ */
  studio.audioEnv(0, { attack: 4, decay: 2, sustain: 10, rate: 3 });
  st = studio.audio();
  eq("#97: the envelope is stored", JSON.stringify(st.voices[0].env),
     '{"attack":4,"decay":2,"sustain":10,"rate":3}');
  eq("#97: attack 4 then decay 2 is 7 R4 values",
     studio.audioEnvelope(0).length, 7);
  eq("#97: … starting at 0 and ending at the sustain",
     [studio.audioEnvelope(0)[0], studio.audioEnvelope(0)[6]].join(","), "0,10");
  check(/driver envelope/.test(page.dom.get("aud-env-readout").textContent),
        "#97: the envelope tab names the driver, not a chip ADSR");
  eq("#97: an attack past 15 is refused",
     codeOf(() => studio.audioEnv(0, { attack: 16, decay: 0, sustain: 0,
                                       rate: 1 })), "env-range");

  const trig = studio.audioTrigger(0);
  eq("#97: Trigger selects the voice then writes R4",
     trig.map((x) => x.reg + ":" + x.value).join(","), "0:0,4:128");
  eq("#97: … the voice is on at the first envelope value",
     [studio.audio().voices[0].on, studio.audio().voices[0].al].join(","),
     "true,0");
  const rel = studio.audioRelease(0);
  eq("#97: Release note ramps R4 down over `rate` steps",
     rel.filter((x) => x.reg === 4).length, 3);
  eq("#97: … and ends by switching the channel off",
     rel[rel.length - 1].value, 0x00);
  eq("#97: … the voice is off afterwards", studio.audio().voices[0].on, false);
  eq("#97: Release all releases every voice",
     studio.audioReleaseAll().length, 6);
  studio.audioReset(0);
  eq("#97: Reset voice is the mixer's default again",
     [studio.audio().voices[0].al, studio.audio().voices[0].balance,
      studio.audio().voices[0].freq].join(","), "31,255,254");

  /* ---- #62's wave editor, inline -------------------------------------- */
  const wave = studio.audioWaveStep(0, 3, 0);
  eq("#97: the wave editor writes one step", wave[3], 0);
  eq("#97: … into the voice's own 32 steps", studio.audio().voices[0].al, 31);
  eq("#97: … and into R6", audioR6(studio)[3], 0);
  const preset = studio.audioPreset(0, "saw");
  eq("#97: a preset replaces the wave",
     [preset[0], preset[31]].join(","), "0,31");
  eq("#97: a wave step past 31 is refused",
     codeOf(() => studio.audioWaveStep(0, 32, 0)), "wave-step");
  eq("#97: a wave value past 31 is refused",
     codeOf(() => studio.audioWaveStep(0, 0, 32)), "wave-range");
  eq("#97: a channel past 6 is refused",
     codeOf(() => studio.audioSelect(6)), "channel-range");

  /* the wave canvas: a real click sets the column under it */
  const canvas = page.dom.get("aud-waveedit");
  const before = studio.audio().voices[0].wave.slice();
  fire(canvas, "click");
  const after = studio.audio().voices[0].wave;
  check(after.some((v, i) => v !== before[i]),
        "#97: a click on the wave canvas writes one column");
  /* the stub canvas keeps its default height; the real one is the HTML's */
  eq("#97: … the column and value under the click (10 px of 256 → step 1)",
     after[1], Math.round((1 - 6 / canvas.height) * 31));

  /* the presets are in the picker */
  eq("#97: the preset picker offers #62's shapes",
     page.dom.get("aud-preset").children
       .filter((o) => o.value).map((o) => o.value).join(","),
     "square,pulse,saw,invsaw,triangle,sine,silence");

  /* ---- the tabs -------------------------------------------------------- */
  studio.audioTab("wave");
  eq("#97: the wave tab is the default", studio.audio().tab, "wave");
  eq("#97: the LFO tab opens", studio.audioTab("lfo"), "lfo");
  eq("#97: … and only its pane is shown",
     [page.dom.get("aud-tab-lfo").hidden, page.dom.get("aud-tab-wave").hidden]
       .join(","), "false,true");
  studio.audioTab("registers");
  check(/R4 channel control/.test(page.dom.get("aud-regs").textContent) &&
        /R9 LFO control/.test(page.dom.get("aud-regs").textContent),
        "#97: the registers tab prints the voice's R2-R7 and R1/R8/R9");
  studio.audioTab("envelope");
  check(page.dom.get("aud-env-meter").__ctx.__calls
          .some((c) => c.name === "fillRect"),
        "#97: the envelope tab draws the R4 sequence");
  eq("#97: an unknown tab is refused",
     codeOf(() => studio.audioTab("echo")), "tab-range");
  studio.audioTab("wave");

  /* ---- the honest line, and the save ----------------------------------- */
  check(/has no echo/.test(page.dom.get("aud-echo").textContent),
        "#97: the panel says the PSG has no echo");
  check(/second, later, quieter voice/.test(
          page.dom.get("aud-echo").textContent),
        "#97: … and what to do instead");

  /* the mix saves with the toy */
  studio.audioLevel(0, 12);
  studio.audioBalance(0, 0x3C);
  const text = studio.audioSaveMix();
  check(text === assetText(studio, "waves.json"),
        "#97: Save mix writes waves.json, byte for byte");
  const doc = JSON.parse(assetText(studio, "waves.json"));
  eq("#97: waves.json holds six voices", doc.voices.length, 6);
  eq("#97: … and the edit", [doc.voices[0].al, doc.voices[0].balance]
     .join(","), "12,60");
  eq("#97: the other four files are untouched", studio.files().length, 5);

  /* every edit is written, because the mix saves with the toy */
  studio.audioLevel(0, 1);
  eq("#97: an edit is in waves.json at once",
     JSON.parse(assetText(studio, "waves.json")).voices[0].al, 1);
  eq("#97: Save mix returns the file's own text",
     studio.audioSaveMix(), assetText(studio, "waves.json"));
  studio.audioLoadSaved();
  eq("#97: Load saved re-reads the file",
     studio.audio().voices[0].al, 1);

  /* a hand-edited waves.json is what the panel reads */
  setAssetFile(studio, "waves.json", JSON.stringify({
    version: 1,
    master: { balance: 0xFF },
    lfo: { freq: 255, ctl: 0 },
    voices: [{ on: true, mode: "wave", wave: new Array(32).fill(20),
               freq: 428, al: 7, balance: 0xF0, mute: false, solo: false,
               noise: { nf: 15 }, dda: [1], env: { attack: 0, decay: 0,
               sustain: 31, rate: 1 } }]
      .concat(new Array(5).fill(null).map(() => ({
        on: false, mode: "wave", wave: new Array(32).fill(16), freq: 254,
        al: 31, balance: 255, mute: false, solo: false, noise: { nf: 15 },
        dda: [1], env: { attack: 0, decay: 0, sustain: 31, rate: 1 } })))
  }, null, 2) + "\n");
  studio.panels.select("audio");
  studio.audioLoadSaved();
  eq("#97: the panel reads a hand-written waves.json",
     [studio.audio().voices[0].al, studio.audio().voices[0].freq,
      studio.audio().voices[0].note].join(","), "7,428,C4");

  /* a broken one is refused by code and not written over */
  const broken = "{ not json";
  setAssetFile(studio, "waves.json", broken);
  studio.audioLoadSaved();
  check(/waves-json/.test(studio.audio().error),
        "#97: a broken waves.json is a waves-json refusal (" +
        studio.audio().error + ")");
  eq("#97: … and the file is not rewritten", assetText(studio, "waves.json"),
     broken);
  eq("#97: a five-voice mix is refused",
     codeOf(() => mixModel.fromJSON('{"voices":[]}')), "mix-voices");

  /* ---- live from a running toy (#71's PSG writes) --------------------- *
   * The toy host records every PSG write a toy makes as pce-psg.js's own
   * event shape; the panel reads that stream, so "what the toy is doing to
   * the chip" and "what it sounds like" are one source. */
  studio.loadExample("palette", true);
  studio.pause();
  studio.panels.select("audio");
  runEditorSource(studio, [
    "function init()",
    "  sfx(2, 254, 31, 60)",
    "end",
    "function frame(t, f) end",
    ""
  ].join("\n"));
  const rt = studio.render.runtime();
  const events = rt && rt.sound ? rt.sound.events : [];
  check(events.length > 0, "#97: the toy's PSG writes are recorded (#71)");
  check(events.every((e) => typeof e.f === "number" && typeof e.t === "number" &&
                            e.reg >= 0 && e.reg <= 9),
        "#97: … in pce-psg.js's own event shape");
  const live = studio.audioLive();
  check(!!live && live.writes === events.length,
        "#97: the panel reads the same stream (" +
        (live ? live.writes : 0) + " of " + events.length + ")");
  eq("#97: … decoded onto the voice the toy used",
     [live.voices[2].freq, live.voices[2].note, live.voices[2].al,
      live.voices[2].dda].join(","), "254,A4,31,false");
  eq("#97: … and the voices the toy left alone",
     live.voices.map((v) => (v.freq ? 1 : 0)).join(""), "001000");
  check(/live toy/.test(page.dom.get("aud-status").textContent),
        "#97: the panel says it is reading a live toy (" +
        page.dom.get("aud-status").textContent + ")");
  /* #111: the host's sfx() starts the channel in WAVEFORM mode ($80 | AL),
   * not DDA with the enable clear, so the panel reads the voice as on — the
   * 32 R6 steps the SFX uploaded are what pce-psg.js steps. */
  eq("#111: the host's SFX leaves the voice on in waveform mode",
     [live.voices[2].on, live.voices[2].mode].join(","), "true,wave");
  const livePcm = studio.audioLivePcm();
  eq("#97: the live PCM is pce-psg.js's render of those writes",
     livePcm.samples, rt.renderSound().pcm.length);

  /* ---- the render the panel plays -------------------------------------- */
  studio.loadExample("palette", true);
  studio.pause();
  studio.panels.select("audio");
  const r1 = studio.audioRender(0.2);
  check(r1.samples > 1000 && r1.peak > 0,
        "#97: the mix renders through pce-psg.js (" + r1.samples +
        " samples, peak " + r1.peak + ")");
  studio.audioLevel(0, 0);
  studio.audioMode(4, "wave");
  studio.audioMode(3, "wave");
  check(studio.audioRender(0.2).peak < r1.peak,
        "#97: a quieter mix renders quieter");
  eq("#97: Play mix renders and reports the peak",
     studio.audioPlay(0.1).samples > 0, true);
  studio.audioStop();
  eq("#97: stopping leaves the panel not playing", studio.audio().playing, false);

  /* the panel is left as it was found */
  studio.loadExample("palette", true);
  studio.pause();
  studio.seek(0);
  studio.panels.select("screen");
}

/* ---- #140: the voice picker offers the song's patches AND the built-ins --
 * ppu.toys' AUDIO dropdown is the shape (Dennis, 2026-10-29): the song's own
 * sample first with a tick on it, a grey heading, then every built-in sample,
 * so a patch is one pick away instead of a trip through ASSETS.  Ours lists
 * the toy's instruments.json first, a "load into the voice" heading, and all
 * fifteen of #99's built-ins.  Picking a built-in adds it to instruments.json
 * (once) and loads it into the voice; Trigger plays it — the patch's own
 * registers through pce-psg.js, at the voice's frequency, noise for a drum.
 *
 * NOTE: written by @design under the same arrangement as the rest of this
 * file — rule 2's cold break by another seat is owed. */
function checkAudioVoicePicker(page) {
  const S = page.sandbox.PCEStudio;
  const studio = S.studio;
  const A = S.assets;
  const NAMES = ["piano", "bass", "lead", "strings", "organ", "bell", "flute",
                 "pluck", "kick", "snare", "hat", "ohat", "tom", "clap",
                 "crash"];
  if (!A || !studio.audioChoose) {
    check(false, "#140: the page has no AUDIO voice picker");
    return;
  }

  studio.loadExample("palette", true);
  studio.pause();
  studio.panels.select("audio");
  studio.audioSelect(0);

  const instrumentsJson = () => {
    const f = studio.files().find((x) => x.name === "instruments.json");
    if (!f) return null;
    try { return JSON.parse(f.source); } catch (e) { return null; }
  };
  const stored = () => (instrumentsJson() || { instruments: [] }).instruments;
  const pick = page.dom.get("aud-instrument");
  const groupOf = () => pick && pick.children
    .find((c) => c.tagName === "OPTGROUP");

  /* ---- the picker's shape before anything is picked ------------------- *
   * A fresh toy has no instruments.json, so everything the picker offers is
   * a built-in under the heading. */
  eq("#140: a fresh toy carries no instruments.json", instrumentsJson(), null);
  check(!!pick, "#140: the AUDIO panel carries the voice picker");
  if (!groupOf()) {
    /* nothing below can mean anything without the list, and a missing group
     * must be a red check rather than a crash that ends the whole run */
    check(false, "#140: … the built-ins sit under a heading");
    return;
  }
  eq("#140: the heading is the card's 'load into the voice'",
     groupOf().label, "load into the voice");
  eq("#140: the first option is this voice's own patch",
     pick.children[0].value, "");
  eq("#140: all fifteen built-ins are listed, in #99's order",
     groupOf().children.map((o) => o.textContent).join(","), NAMES.join(","));
  eq("#140: … each carried as builtin:<id>",
     groupOf().children.map((o) => o.value).join(","),
     NAMES.map((n) => "builtin:" + n).join(","));
  /* the same list through the page's evidence surface (a module whose api
   * shadows its own list would recurse here rather than pass) */
  eq("#140: the page's built-in list is the picker's",
     studio.audioBuiltins().map((b) => b.id).join(","), NAMES.join(","));
  eq("#140: … typed the way the chip makes them",
     studio.audioBuiltins().map((b) => b.kind).join(","),
     A.INSTRUMENTS.map((i) => i.kind).join(","));

  /* ---- one pick per built-in, through the picker's own handler -------- *
   * The DOM change handler is driven, not the API, so what is measured is
   * the control a person clicks. */
  const perPick = [];
  for (const name of NAMES) {
    const before = stored().length;
    pick.value = "builtin:" + name;
    const fired = fire(pick, "change");
    const voice = studio.audio().selected;
    perPick.push([fired, stored().length - before,
                  voice, studio.audioLoaded(voice)]);
  }
  eq("#140: every pick reaches the picker's change handler",
     perPick.map((p) => p[0]).join(","), NAMES.map(() => 1).join(","));
  eq("#140: … and adds exactly one instrument to the toy",
     perPick.map((p) => p[1]).join(","), NAMES.map(() => 1).join(","));
  eq("#140: each pick is what that voice then holds",
     perPick.map((p) => p[3]).join(","), NAMES.join(","));
  eq("#140: a drum moves to the first voice with the noise generator " +
     "(0-based 4, the panel's voice 5)",
     perPick.map((p) => p[2]).join(","), "0,0,0,0,0,0,0,0,4,4,4,4,4,4,4");
  eq("#140: the toy ends with all fifteen, each once",
     [stored().length, new Set(stored().map((i) => i.name)).size].join(","),
     "15,15");

  /* ---- the song's instruments now come first, with the tick ----------- *
   * ppu.toys marks the song's own entry ('✓ Sample 00 · song'); ours marks
   * the one loaded into the selected voice. */
  studio.audioSelect(0);
  studio.audioChoose("piano", 0);
  const groupAt = pick.children.findIndex((c) => c.tagName === "OPTGROUP");
  eq("#140: the song's instruments sit above the heading",
     groupAt, 1 + NAMES.length);
  eq("#140: … one entry each, in the order they were added",
     pick.children.slice(1, groupAt).map((o) => o.value).join(","),
     NAMES.map((n) => "toy:" + n).join(","));
  check(pick.children.slice(1, groupAt)
         .every((o) => / · (wave|noise)$/.test(o.textContent)),
        "#140: … each saying its kind (" + pick.children[1].textContent + ")");
  check(pick.children[1].textContent.indexOf("✓ ") === 0,
        "#140: the one loaded into this voice is ticked (" +
        pick.children[1].textContent + ")");
  eq("#140: … and the picker's value points at it", pick.value, "toy:piano");

  /* ---- no duplicates: the same built-in again adds nothing ------------ */
  const again = studio.audioChoose("piano", 0);
  eq("#140: picking a built-in the toy already has adds nothing",
     again.added, false);
  eq("#140: … instruments.json still holds one piano",
     [stored().length, stored().filter((i) => i.name === "piano").length]
       .join(","), "15,1");
  /* … and the entry is ASSETS' own stored shape, not the built-in object */
  const patch = stored()[0];
  eq("#140: the stored copy is ASSETS' own shape",
     [patch.source, patch.kind, patch.envelope.size]
       .join(","), "built-in,wave," + patch.envelope.data.length);

  /* ---- Trigger plays it: pce-psg.js's PCM from the patch's registers -- *
   * `audioAudition` is the function onTrigger calls, so this is Trigger's
   * output, not a second renderer.  The voice is A4 (F = 254 → 440.4 Hz). */
  const pitches = [];
  for (const name of NAMES) {
    const inst = A.byId(name);
    studio.audioSelect(0);
    studio.audioNote(0, "A4");
    const got = studio.audioChoose(name, 0);
    const aud = studio.audioAudition(got.voice);
    const n = aud.pcm.length / 2;
    /* the loud part: a pluck has decayed to nothing by frame 30 */
    const level = A.rms(aud.pcm, 0, Math.floor(n * 0.25));
    check(level.rms > 40 && level.peak > 200,
          "#140: Trigger on " + name + " is not silent (rms " +
          level.rms.toFixed(0) + ", peak " + level.peak + ")");
    if (inst.kind === "wave") {
      const hz = A.fundamental(aud.pcm, aud.sampleRate, Math.floor(n * 0.2), n);
      /* anchored on the MIX's voice, not on the trace: the trace agreeing
       * with itself would prove nothing about what Trigger asked for */
      const voiceFreq = studio.audio().voices[got.voice].freq;
      const want = A.toneHz(voiceFreq);
      pitches.push(name + ":" + aud.freq);
      check(aud.freq === voiceFreq && Math.abs(hz.hz - want) <= want * 0.02,
            "#140: … at the voice's pitch, F = " + voiceFreq + " → " +
            want.toFixed(1) + " Hz for " + name + " (trace F = " + aud.freq +
            ", measured " + hz.hz.toFixed(1) + ")");
      eq("#140: … with 32 R6 wave steps on the voice",
         aud.trace.events.filter((e) => e.reg === 6).length, 32);
    } else {
      const r7 = aud.trace.events.filter((e) => e.reg === 7);
      eq("#140: " + name + " is the noise generator (R7 = $80 | NF " +
         inst.nf + ")", r7.length ? r7[0].value : null, 0x80 | inst.nf);
      eq("#140: … so it uploads no wave",
         aud.trace.events.filter((e) => e.reg === 6).length, 0);
      eq("#140: … and plays on the voice it moved to",
         aud.trace.channel, got.voice);
    }
  }
  eq("#140: every melodic built-in sounds the voice's A4 (F = 254)",
     pitches.join(","),
     NAMES.filter((n) => A.byId(n).kind === "wave").map((n) => n + ":254")
       .join(","));

  /* the panel is left as it was found */
  studio.loadExample("palette", true);
  studio.pause();
  studio.seek(0);
  studio.panels.select("screen");
}

function spritePanel(page) {
  const def = page.sandbox.PCEStudio.studio.panels.get("sprites");
  return (def && def.api) || null;
}

/* A fresh asset set for the sprite panel: no tiles, no BAT (the editor's own
 * blank picture), the palettes the checks paint with, no sprites. */
function resetSpriteAssets(studio) {
  setAssetFile(studio, "tiles.json", JSON.stringify({ version: 1, tiles: [] }));
  const pal = { version: 1, backdrop: 0,
                background: new Array(16).fill(0).map(() => new Array(16).fill(0)),
                sprites: new Array(16).fill(0).map(() => new Array(16).fill(0)) };
  pal.background[0][5] = SPR_RED;
  pal.sprites[0][5] = SPR_WHITE;
  setAssetFile(studio, "palettes.json", JSON.stringify(pal));
  setAssetFile(studio, "sprites.json", JSON.stringify({ version: 1, sprites: [] }));
}

function countPixel(frame, x, y) {
  return framePixel(frame, x, y).join(",");
}

function countNonBlack(frame) {
  let n = 0;
  for (let i = 0; i < frame.pixels.length; i += 3)
    if (frame.pixels[i] || frame.pixels[i + 1] || frame.pixels[i + 2]) n++;
  return n;
}

function checkSpritesPanel(page) {
  const S = page.sandbox.PCEStudio;
  const studio = S.studio;
  const sat = S.sat;
  const ed = S.editor;

  check(!!sat && typeof sat.session === "function",
        "#86: renderer/pce-sat.js loaded");
  check(page.loaded.some((s) => /pce-sat\.js$/.test(s)),
        "the page loads renderer/pce-sat.js");
  const api = spritePanel(page);
  check(!!api, "#86: the sprites panel has an api for the evidence");
  if (!sat || !api) { check(false, "#86: the page has no sprite editor"); return; }

  /* The panel is the module's: its tab, its Guide chapter, its own buttons. */
  const def = studio.panels.get("sprites");
  check(def.label === "SPRITES" && def.chapter === "sprites" &&
        typeof def.draw === "function",
        "#86: the SPRITES panel registers its label, chapter and draw");
  eq("the pattern tools are #84's six, one array",
     sat.TOOLS, S.screen.TOOLS);
  for (const t of sat.TOOLS)
    check(!!page.dom.get("spr-tool-" + t.id),
          "sprite tool " + t.id + " has a button");
  for (const z of sat.ZOOMS)
    check(!!page.dom.get("spr-zoom-" + z), "sprite zoom " + z + " has a button");
  for (const id of ["spr-screen", "spr-slots", "spr-pattern", "spr-sheet",
                    "spr-palette", "spr-prev", "spr-next", "spr-release",
                    "spr-park", "spr-clear", "spr-newpattern", "spr-x-up",
                    "spr-y-up", "spr-hflip", "spr-vflip", "spr-priority"])
    check(!!page.dom.get(id), "#86: the panel has " + id);

  /* Open the panel on a fresh asset set. */
  studio.panels.select("sprites");
  resetSpriteAssets(studio);
  studio.panels.dirty();
  studio.panels.refresh(true);

  let st = api.state();
  check(!!st, "#86: the panel has a session over the toy's assets");
  if (!st) return;
  eq("#86: the header starts at SAT 0/64",
     page.dom.get("spr-count").textContent, "SAT 0/64");
  check(/0\/16 sprites/.test(page.dom.get("spr-line").textContent),
        "the per-line header starts at 0/16 sprites (" +
        page.dom.get("spr-line").textContent + ")");
  check(page.dom.get("spr-grid").checked === true, "the pattern grid starts on");
  check(api.drawn(), "the panel drew its own text");

  /* #120: this screen draws the toy's ASSETS (SB forced on by renderPreview)
   * while Run draws the toy's own CR, and the host powers on at $80 — so the
   * panel must say what the toy has to write, in the panel and in TOYS.md.
   * Written by @design because the card names both places; rule 2's cold
   * break is owed (the author wrote the check). */
  const sbHint = page.dom.get("spr-sbhint");
  check(!!sbHint && /SB/.test(sbHint.textContent) &&
        /reg\("CR", 0xC0\)/.test(sbHint.textContent),
        "#120: the SPRITES panel says Run needs reg(\"CR\", 0xC0) (SB) — " +
        JSON.stringify(sbHint && sbHint.textContent));
  const toysDoc = fs.readFileSync(path.join(__dirname, "..", "docs", "TOYS.md"),
                                  "utf8");
  check(/sprite layer is off until the toy sets SB/.test(toysDoc) &&
        /reg\("CR", 0xC0\)/.test(toysDoc),
        "#120: docs/TOYS.md §2 states the sprite layer is off until SB and " +
        "names reg(\"CR\", 0xC0)");

  /* ---- place a sprite on slot 0: the SAT fills in order ---------------- */
  eq("#86: clicking slot 0 places sprite 0 (and its 16x16 pattern)",
     api.selectSlot(0), 0);
  st = api.state();
  eq("the header counts it", page.dom.get("spr-count").textContent, "SAT 1/64");
  let doc = JSON.parse(assetText(studio, "sprites.json"));
  check(doc.sprites.length === 1 && doc.sprites[0].x === 112 &&
        doc.sprites[0].y === 96 && doc.sprites[0].pattern === 0,
        "sprites.json holds the placed sprite (112,96) pattern 0");
  check(Array.isArray(doc.patterns) && doc.patterns.length === 1 &&
        doc.patterns[0].width === 16 && doc.patterns[0].height === 16 &&
        doc.patterns[0].pixels.length === 256,
        "sprites.json holds its 16x16 pattern with 256 colour numbers");
  check(!("tiles" in doc), "sprites.json carries the SAT, not the BAT");

  /* ---- the pencil paints the pattern, and the frame shows it ----------- */
  api.setTool("pencil");
  api.selectColour(5);
  eq("the pencil click reports one changed pixel", api.click(2, 3), 1);
  st = api.state();
  eq("the pattern pixel is colour number 5", st.pixel(2, 3), 5);
  doc = JSON.parse(assetText(studio, "sprites.json"));
  eq("sprites.json holds it (pixel 3*16+2)", doc.patterns[0].pixels[3 * 16 + 2], 5);
  let frame = api.frame();
  eq("the frame's pixel at the sprite's (2,3) is sprite palette 0 colour 5",
     countPixel(frame, 112 + 2, 96 + 3), "252,252,252");
  eq("the frame's neighbour is untouched", countPixel(frame, 112 + 3, 96 + 3),
     "0,0,0");
  check(countNonBlack(frame) === 1,
        "exactly one pixel of the picture is the sprite (" +
        countNonBlack(frame) + ")");

  /* rect fills a block, in pattern pixels */
  api.setTool("rect");
  api.press(0, 0);
  api.drag(3, 2);
  api.release(3, 2);
  st = api.state();
  let block = 0;
  for (let y = 0; y <= 2; y++)
    for (let x = 0; x <= 3; x++) if (st.pixel(x, y) === 5) block++;
  check(block === 12, "the rect fills its 4×3 block of pixels (" + block + ")");

  /* fill stops at a different colour: the island is colour 0 inside colour 5 */
  api.setTool("pencil");
  api.click(6, 6);                 /* one 5 in the middle of 0s */
  api.setTool("fill");
  api.click(10, 10);               /* floods the 0 region, not the island */
  st = api.state();
  eq("the bucket fills the connected 0 region", st.pixel(0, 15), 5);
  eq("…and stops at a different colour", st.pixel(6, 6), 5);

  /* erase paints colour 0 (transparent) */
  api.setTool("erase");
  api.click(2, 3);
  st = api.state();
  eq("erase paints colour 0", st.pixel(2, 3), 0);

  /* move carries a block */
  api.setTool("select");
  api.press(6, 6); api.drag(6, 6); api.release(6, 6);
  api.setTool("move");
  api.press(6, 6); api.drag(6, 8); api.release(6, 8);
  st = api.state();
  eq("the move left its source blank", st.pixel(6, 6), 0);
  eq("the move carried the pixel", st.pixel(6, 8), 5);

  /* ---- select on the screen and move it -------------------------------- */
  resetSpriteAssets(studio);
  studio.panels.dirty(); studio.panels.refresh(true);
  api.selectSlot(0);
  api.setTool("pencil"); api.selectColour(5);
  api.press(0, 0); api.release(0, 0);          /* one lit pixel at (112,96) */
  eq("the panel selects the sprite under the point",
     api.screenPress(112, 96), 0);
  eq("the drag moves it", api.screenDrag(122, 106), 1);
  api.screenRelease();
  st = api.state();
  eq("sprite 0 is at (122,106)", st.spriteAt(0).x + "," + st.spriteAt(0).y,
     "122,106");
  frame = api.frame();
  eq("the frame's lit pixel moved with it", countPixel(frame, 122, 106),
     "252,252,252");
  eq("…and the old place is empty", countPixel(frame, 112, 96), "0,0,0");

  /* release position puts it back where the file had it */
  const back = api.releasePosition();
  st = api.state();
  check(!!back && st.spriteAt(0).x === 112 && st.spriteAt(0).y === 96,
        "release position puts the sprite back where it was read from (" +
        (back && back.x) + "," + (back && back.y) + ")");

  /* the − / + buttons move the selected sprite one pixel */
  api.selectSlot(0);
  api.nudge("x", 1); api.nudge("y", -1);
  st = api.state();
  eq("X + moves one column", st.spriteAt(0).x, 113);
  eq("Y − moves one row", st.spriteAt(0).y, 95);
  frame = api.frame();
  eq("the frame follows the nudge", countPixel(frame, 113, 95),
     "252,252,252");

  /* ---- the flips -------------------------------------------------------- */
  api.setTool("pencil");
  api.press(0, 0); api.release(0, 0);      /* a pixel at the pattern's corner */
  const plain = api.frame();
  api.setField("hflip", 1);
  const flipped = api.frame();
  eq("HFLIP mirrors the pixel to the right edge",
     countPixel(flipped, 113 + 15, 95), "252,252,252");
  eq("…and the corner is blank", countPixel(flipped, 113, 95),
     countPixel(plain, 113 + 15, 95));
  api.setField("hflip", 0);
  eq("clearing HFLIP restores the picture", countPixel(api.frame(), 113, 95),
     "252,252,252");

  /* ---- off-screen: the VDC has no per-sprite off switch ---------------- */
  const litBox = countNonBlack(api.frame());
  api.park();
  st = api.state();
  check(st.parked === true && st.spriteAt(0).y === sat.PARK_ROW,
        "#86: 'off-screen' parks the sprite at display row " + sat.PARK_ROW);
  check(countNonBlack(api.frame()) === 0,
        "…and the frame draws none of it (" + countNonBlack(api.frame()) + " px)");
  check(litBox > 0, "the sprite was visible before it was parked (" + litBox +
        " px)");
  doc = JSON.parse(assetText(studio, "sprites.json"));
  check(doc.sprites[0].parked === 1 && doc.sprites[0].y === 0,
        "sprites.json records it as parked, not as y 240 in the x/y range");
  eq("Y − brings a parked sprite back to the last line", api.nudge("y", -1).y,
     ed.VIEW_H - 1);

  /* ---- clear a slot, and the SAT's order ------------------------------- */
  api.selectSlot(0);
  api.clearSlot();
  st = api.state();
  eq("clear slot removes it from the SAT", st.count, 0);
  doc = JSON.parse(assetText(studio, "sprites.json"));
  eq("…and from sprites.json", doc.sprites.length, 0);
  eq("the empty slot after the placed ones places a sprite",
     api.selectSlot(0), 0);
  eq("…and the file has it", JSON.parse(assetText(studio, "sprites.json"))
     .sprites.length, 1);
  const sess = api.session();
  let code = null;
  try { sat.selectSlot(sess, 9); } catch (e) { code = e.code; }
  eq("a gap in the SAT is refused, not invented", code, "sprite-gap");
  code = null;
  try { sat.selectSlot(sess, 64); } catch (e) { code = e.code; }
  eq("a 65th slot does not exist", code, "sprite-range");

  /* ---- size is per sprite: a 32x16 pattern is two strips --------------- */
  resetSpriteAssets(studio);
  studio.panels.dirty(); studio.panels.refresh(true);
  api.selectSlot(0);
  api.selectColour(5);
  const pattern2 = api.newPattern();          /* 32x16 by the picker's value */
  check(pattern2 === 1, "the size picker's + pattern makes pattern 1");
  api.setField("pattern", 1);
  st = api.state();
  eq("the sprite's size is its pattern's", st.size.width + "x" + st.size.height,
     "16x16");
  /* the picker's value is the first option until the page sets it */
  page.dom.get("spr-newsize").value = "32x16";
  const wide = api.newPattern();
  api.setField("pattern", wide);
  st = api.state();
  eq("a 32x16 pattern gives a 32x16 sprite",
     st.size.width + "x" + st.size.height, "32x16");
  api.press(0, 0); api.release(0, 0);
  api.setTool("rect"); api.press(0, 0); api.drag(31, 15); api.release(31, 15);
  st = api.state();
  const line = sat.lineStatus(api.picture(), 96);
  eq("the 32-px sprite asks for two strips on its line", line.strips, 2);
  check(page.dom.get("spr-sprsize").textContent === "32 × 16",
        "the panel names the sprite's own size (" +
        page.dom.get("spr-sprsize").textContent + ")");

  /* ---- SPBG: in front of the BG, or behind it -------------------------- */
  setAssetFile(studio, "tiles.json", JSON.stringify({
    version: 1,
    tiles: [{ char: 0x40, palette: 0, pixels: new Array(64).fill(5) }]
  }));
  studio.panels.dirty(); studio.panels.refresh(true);
  api.selectSlot(0);
  api.setField("priority", 1);
  frame = api.frame();
  eq("SPBG 1 draws the sprite over an opaque BG pixel",
     countPixel(frame, 112, 96), "252,252,252");
  api.setField("priority", 0);
  frame = api.frame();
  eq("SPBG 0 hides it behind the BG's colour 5", countPixel(frame, 112, 96),
     "252,0,0");

  /* ---- overflow: a 17th strip on a line -------------------------------- */
  resetSpriteAssets(studio);
  studio.panels.dirty(); studio.panels.refresh(true);
  api.selectSlot(0);
  api.setTool("pencil"); api.selectColour(5);
  api.press(0, 0); api.release(0, 0);
  for (let i = 1; i < 17; i++) {
    const n = api.selectSlot(i);
    if (n < 0) break;
    api.setField("y", 96);
  }
  st = api.state();
  eq("seventeen sprites are in the SAT", st.count, 17);
  const busy = sat.lineStatus(api.picture(), 96);
  check(busy.requested === 17 && busy.strips === 16 && busy.overflow,
        "line 96 asks for 17 strips and the VDC keeps 16 (asked " +
        busy.requested + ", kept " + busy.strips + ")");
  check(/\d+ line\(s\) over|nothing dropped/.test(
          page.dom.get("spr-line").textContent),
        "the per-line header reports the drop (" +
        page.dom.get("spr-line").textContent + ")");
  check(st.slots.some((s) => s.dropped > 0),
        "the slot grid marks the sprite whose strip was dropped");

  /* ---- refusals: the editor's own codes -------------------------------- */
  const s3 = api.session();
  code = null;
  try { sat.setField(s3, "x", 256); } catch (e) { code = e.code; }
  eq("x 256 is off the picture", code, "sprite-range");
  code = null;
  try { sat.setField(s3, "palette", 16); } catch (e) { code = e.code; }
  eq("a 17th sprite palette is refused", code, "17th-sprite-palette");
  code = null;
  try { sat.setField(s3, "nonsense", 1); } catch (e) { code = e.code; }
  eq("an unknown sprite field is refused", code, "sprite-field");
  code = null;
  try { sat.selectColour(s3, 16); } catch (e) { code = e.code; }
  eq("a 17th colour number is refused", code, "colour-index");
  api.setTool("pencil"); api.selectColour(4);
  api.press(99, 99); api.release(99, 99);
  eq("a press outside a 16x16 pattern clamps to its corner",
     api.state().pixel(15, 15), 4);

  /* ---- the asset file's refusals --------------------------------------- */
  code = null;
  try {
    sat.pictureFromFiles([{ name: "sprites.json", source: "{not json" }]);
  } catch (e) { code = e.code; }
  eq("a sprites.json that is not JSON is refused", code, "asset-json");
  code = null;
  try {
    sat.pictureFromFiles([{ name: "sprites.json", source: JSON.stringify({
      version: 1, patterns: [{ width: 24, height: 24, pixels: [] }] }) }]);
  } catch (e) { code = e.code; }
  eq("a pattern size the VDC cannot draw is refused", code, "sprite-size");
  code = null;
  try {
    sat.pictureFromFiles([{ name: "sprites.json", source: JSON.stringify({
      version: 1, patterns: [{ width: 16, height: 16,
                               pixels: new Array(256).fill(16) }] }) }]);
  } catch (e) { code = e.code; }
  eq("a 17th colour number in the file is refused", code, "17th-colour");
  code = null;
  try {
    sat.pictureFromFiles([{ name: "sprites.json", source: JSON.stringify({
      version: 1, sprites: new Array(65).fill({ x: 0, y: 0, pattern: 0 }) }) }]);
  } catch (e) { code = e.code; }
  eq("a file with 65 sprites is refused", code, "65th-sprite");

  /* ---- sprites.json round-trips byte for byte --------------------------- */
  const one = sat.pictureFromFiles([
    { name: "sprites.json", source: assetText(studio, "sprites.json") }
  ]);
  const text = sat.spritesText(one);
  const again = sat.pictureFromFiles([{ name: "sprites.json", source: text }]);
  eq("sprites.json round-trips byte for byte", sat.spritesText(again), text);

  /* ---- the panel does not touch the SCREEN panel's file ---------------- */
  resetSpriteAssets(studio);
  studio.panels.dirty(); studio.panels.refresh(true);
  const tilesBefore = assetText(studio, "tiles.json");
  api.selectSlot(0);
  api.setTool("pencil");
  api.click(1, 1);
  eq("a sprite edit leaves tiles.json alone", assetText(studio, "tiles.json"),
     tilesBefore);
  check(assetText(studio, "sprites.json") !==
        '{\n  "version": 1,\n  "sprites": []\n}\n',
        "…and writes sprites.json");

  /* ---- the canvas, and a real DOM event over the pattern --------------- */
  const sizes = api.canvas();
  check(sizes.screen > 0 && sizes.slots === 192 && sizes.sheet === 256 &&
        sizes.pattern > 0,
        "the screen, the slot grid, the sheet and the pattern canvas drew (" +
        JSON.stringify(sizes) + ")");
  api.setTool("pencil");
  api.selectColour(3);
  const patternEl = page.dom.get("spr-pattern");
  const before = api.state().pixel(0, 0);
  api.pointer("press", pointerAt(patternEl, 1, 1), patternEl);
  api.pointer("release", pointerAt(patternEl, 1, 1), patternEl);
  check(api.state().pixel(0, 0) === 3 && before !== 3,
        "a real pointer event on the pattern canvas paints pixel (0,0)");

  /* the live frame's SAT line is the page's, not the picture's */
  studio.loadExample("sprite", true);
  studio.pause();
  studio.panels.select("sprites");
  studio.panels.refresh(true);
  check(/^frame: line \d+ · \d+\/64 sprites in range/.test(
          page.dom.get("spr-live").textContent),
        "the panel reads the live frame's SAT too (" +
        page.dom.get("spr-live").textContent + ")");

  /* ---- #116 (REVIEW-PANELS 86-S2): two sprites over one point ---------- *
   * The VDC draws the LOWER SAT index on an overlap (pce-sprites.js
   * paintLine paints last-to-first), and a press on the screen selects the
   * sprite the VDC draws there.  Every fixture above has exactly one sprite,
   * so "the only sprite" and "the first of two" look the same. */
  resetSpriteAssets(studio);
  {
    const pat0 = { width: 16, height: 16, pixels: new Array(256).fill(0) };
    pat0.pixels[0] = 5;                    /* (0,0): both sprites lit here */
    const pat1 = { width: 16, height: 16, pixels: new Array(256).fill(0) };
    pat1.pixels[0] = 5;                    /* (0,0): the overlap */
    pat1.pixels[1] = 5;                    /* (1,0): only sprite 1 here */
    setAssetFile(studio, "sprites.json", JSON.stringify({
      version: 1,
      patterns: [pat0, pat1],
      sprites: [{ x: 10, y: 10, pattern: 0 },
                { x: 10, y: 10, pattern: 1 }]
    }));
    studio.panels.dirty();
    studio.panels.refresh(true);
    const pic = api.picture();
    eq("#86: two sprites over one point — the overlap is the lower SAT index",
       sat.spriteAt(pic, 10, 10), 0);
    eq("#86: … and a press on the screen selects it", api.screenPress(10, 10), 0);
    /* the control: where only the second sprite draws, it is its own index */
    eq("#86: a point only the second sprite covers is sprite 1",
       sat.spriteAt(pic, 11, 10), 1);
  }

  /* leave the page on a clean example */
  studio.loadExample("palette", true);
  studio.pause();
  studio.panels.select("screen");
}

/* ---- #94: the SEQUENCER panel ----------------------------------------- *
 * The card's evidence: a pattern written headlessly through the panel's own
 * API (the same calls its canvas click handler makes), the song it compiles
 * checked row by row, and the sound it plays being pce-song.js's and
 * pce-psg.js's for those notes.  tests/check-sequencer.js is the model's
 * own, longer evidence; this is the panel on the page. */
function checkSequencerPanel(page) {
  const S = page.sandbox.PCEStudio;
  const studio = S.studio;
  const seq = S.seq;
  const def = studio.panels.get("sequencer");
  check(!!seq && typeof seq.demoSong === "function",
        "#94: renderer/pce-seq.js loaded");
  check(page.loaded.some((s) => /pce-seq\.js$/.test(s)),
        "#94: the page loads renderer/pce-seq.js");
  check(!!def && typeof def.api === "object" && !!def.api,
        "#94: the SEQUENCER panel registered with its API");
  if (!seq || !def || !def.api) {
    check(false, "#94: the page has no SEQUENCER panel");
    return;
  }
  const api = def.api;

  studio.loadExample("palette", true);
  studio.pause();
  studio.panels.select("sequencer");

  const st = api.state();
  eq("#94: a toy with no song.json opens on the demo song",
     seq.orderText(st), "A");
  eq("#94: the grid is the PSG's six channels",
     st.patterns[0].channels.length, 6);
  eq("#94: six voices is the chip's limit, and the bar shows it",
     [api.voiceLimit(), api.voiceCapacity()].join(","), "6,6");
  eq("#94: nothing is saved until the panel writes",
     studio.fileNames().indexOf("song.json"), -1);
  eq("#94: the palette is four waves and two noise drums",
     api.instruments().map((i) => i.kind).join(","),
     "wave,wave,wave,wave,noise,noise");
  eq("#94: a wave instrument is 32 steps of 5 bits", [
     st.instruments[0].wave.length,
     Math.max(...st.instruments[0].wave) <= 31].join(","), "32,true");
  eq("#94: an instrument carries its driver envelope",
     st.instruments[1].env.data.join(","), "31,28,24");

  /* ---- the grid and the voices bar are drawn --------------------------- */
  const grid = page.dom.get("seq-grid");
  const voices = page.dom.get("seq-voices");
  grid.__ctx.__calls.length = 0;
  voices.__ctx.__calls.length = 0;
  studio.panels.refresh(true);
  const cells = grid.__ctx.__calls.filter((c) => c.name === "fillRect").length;
  check(cells >= 6 * 16 + 16,
        "#94: the grid draws six rows of sixteen cells and the notes (" +
        cells + " rects)");
  const bars = voices.__ctx.__calls.filter((c) => c.name === "fillRect").length;
  check(bars >= 16,
        "#94: the voices bar has one bar per step (" + bars + " rects)");
  const notesDrawn = grid.__ctx.__calls.filter((c) => c.name === "fillText")
    .map((c) => String(c.args[0]));
  check(notesDrawn.indexOf("C4") >= 0,
        "#94: the grid labels notes by name (" + notesDrawn.join(" ") + ")");

  /* ---- a pattern written through the panel ----------------------------- */
  api.clearPattern();
  /* the button pass above clicked Eraser; this check paints notes */
  api.eraser(false);
  api.setTempo(150);
  api.swing(0);
  api.steps(8);
  api.selectPattern(0);
  api.setInstrument(0);
  api.setNote("C4");
  api.setLength(2);
  api.paint(0, 0);                    /* C4 on channel 1, step 1, 2 steps */
  api.paint(0, 4);                    /* … again on step 5 */
  api.setInstrument(4);               /* the kick drum */
  api.setLength(1);
  api.paint(4, 2);                    /* noise on channel 5, step 3 */

  const song = api.song();
  eq("#94: the compiled song is the DMF shape pce-song takes",
     [song.rowsPerPattern, song.orderCount, song.timeBase, song.frameMode,
      song.tick1, song.tick2].join(","), "8,1,1,1,6,6");
  const ch0 = song.patterns[0][0];
  eq("#94: step 1 is C4 on the lead wave",
     [ch0[0].note.semitone, ch0[0].note.octave, ch0[0].instrument].join(","),
     "0,3,0");
  check(ch0[2].note && ch0[2].note.cut === true && ch0[2].instrument === null,
        "#94: a two-step note is cut two steps later");
  check(ch0[6].note && ch0[6].note.cut === true,
        "#94: … and the second one at step 7");
  check(!ch0[1].note && !ch0[3].note,
        "#94: the steps between the notes are empty rows");
  const ch4 = song.patterns[4][0];   /* channel 5, order slot 0 */
  eq("#94: the drum is on channel 5 with the noise instrument",
     [ch4[2].note.semitone, ch4[2].instrument].join(","), "0,4");
  check(ch4[3].note && ch4[3].note.cut === true,
        "#94: the one-step drum is cut at the next step");

  /* ---- the noise writes pce-song.js does not make ---------------------- */
  const got = api.events();
  const r7 = got.events.filter((e) => e.kind && /^noise/.test(e.kind) &&
                                      e.reg === 7);
  eq("#94: the drum switches R7 on and off (two writes each)",
     r7.map((e) => e.value).join(","), "156,0");
  eq("#94: … on the drum's own channel",
     got.events.filter((e) => e.kind && /^noise/.test(e.kind) &&
                              e.reg === 0 && e.value === 4).length >= 2, true);
  const rowFrames = api.timing();
  eq("#94: the drum's R7 on is the frame of row 3",
     r7[0].f, rowFrames.rowFrame(2));
  eq("#94: … and its off is row 4", r7[1].f, rowFrames.rowFrame(3));

  /* ---- the sound is pce-song.js's and pce-psg.js's --------------------- */
  const played = api.render();
  check(played.pcm.length > 0 && played.count > 0,
        "#94: the song renders to PCM (" + played.pcm.length + " samples)");
  let pcmPeak = 0;
  for (let i = 0; i < played.pcm.length; i++)
    pcmPeak = Math.max(pcmPeak, Math.abs(played.pcm[i]));
  check(pcmPeak > 0, "#94: … and the PCM is not silence (peak " +
        pcmPeak + ")");
  const again = psgEventCount(played.events);
  eq("#94: the rendered stream is the one the model hands pce-psg",
     played.events.length, again);

  /* ---- the six-voice limit --------------------------------------------- */
  api.setInstrument(0);
  api.clearPattern();
  for (let ch = 0; ch < 6; ch++) api.paint(ch, 0);
  eq("#94: six channels sounding at one step is the maximum",
     [...api.voices()].sort((a, b) => b - a)[0], 6);
  eq("#94: the voices bar shows six", api.voicesAt(0), 6);
  api.setInstrument(4);               /* a noise drum */
  let refused = null;
  try { api.paint(0, 2); } catch (e) { refused = e.code; }
  eq("#94: a seventh voice is refused — a noise drum on a wave-only channel",
     refused, "seq-voice");

  /* ---- #95: the staff view, on the same song --------------------------- */
  check(page.loaded.some((s) => /pce-staff\.js$/.test(s)),
        "#95: the page loads renderer/pce-staff.js");
  check(!!S.staff && typeof S.staff.layout === "function",
        "#95: the staff model registers as PCEStudio.staff");
  const staffBtn = page.dom.get("seq-view-staff");
  check(staffBtn && staffBtn.disabled === false,
        "#95: the Staff button is enabled");

  api.clearPattern();
  api.eraser(false);
  api.setInstrument(0);
  api.setLength(1);
  api.setNote("C4");
  api.paint(0, 0);                    /* inside the treble staff */
  api.setNote("C7");
  api.paint(0, 2);                    /* far above it: 15ma */
  api.setNote("E4");
  api.paint(0, 4);                    /* back down: loco */

  /* the button pass earlier clicked every button, so ask for the grid */
  eq("#95: the grid is the panel's other view", api.view("grid"), "grid");
  eq("#95: the staff model reads the same song the grid edits",
     api.staff().notes.length, 3);
  eq("#95: the staff is one of the two views, and only one shows",
     [api.view("staff"), page.dom.get("seq-staffbox").hidden,
      page.dom.get("seq-gridbox").hidden].join(","), "staff,false,true");

  const staffCanvas = page.dom.get("seq-staff");
  staffCanvas.__ctx.__calls.length = 0;
  studio.panels.refresh(true);
  const staffCalls = staffCanvas.__ctx.__calls;
  const heads = staffCalls.filter((c) => c.name === "ellipse").length;
  eq("#95: the staff draws one note head per note", heads, 3);
  const staffLabels = staffCalls.filter((c) => c.name === "fillText")
    .map((c) => String(c.args[0]));
  check(staffLabels.indexOf("15ma") >= 0,
        "#95: a note far above the staff is marked 15ma (" +
        staffLabels.join(" ") + ")");
  check(staffLabels.indexOf("loco") >= 0,
        "#95: the return to the written octave is marked loco");
  check(staffCalls.some((c) => c.name === "bezierCurveTo"),
        "#95: the clefs are drawn as paths, not typed glyphs");
  eq("#95: back to the grid, and the staff box hides again",
     [api.view("grid"), page.dom.get("seq-staffbox").hidden,
      page.dom.get("seq-gridbox").hidden].join(","), "grid,true,false");

  /* ---- the song saves with the toy as song.json ------------------------ */
  const names = studio.fileNames();
  check(names.indexOf("song.json") >= 0,
        "#94: an edit saves the song as song.json (" + names.join(", ") + ")");
  const saved = studio.files().find((f) => f.name === "song.json").source;
  const back = seq.fromJSON(saved);
  eq("#94: song.json round-trips through the model byte for byte",
     seq.toJSON(back), saved);
  eq("#94: … and carries the pattern the panel wrote",
     back.patterns[0].channels[0][0].note, 36);
  eq("#94: the toy's other files are untouched",
     studio.fileNames().slice(0, 5).join(","),
     "main.lua,tiles.json,palettes.json,sprites.json,waves.json");

  /* put the toy back as the five-file toy the other checks expect */
  const live = studio.toy.files();
  const at = live.findIndex((f) => f.name === "song.json");
  if (at >= 0) live.splice(at, 1);
  studio.toy.persist();
  studio.loadExample("palette", true);
  studio.pause();
  studio.panels.select("screen");
}

/* The rendered stream's write count, read back from the player's own trace so
 * the comparison is between two objects, not two calls to one function. */
function psgEventCount(events) {
  return events.filter((e) => e.reg !== undefined).length;
}

/* ---- #102: every panel is its own module ------------------------------ *
 * The page only loads the ten modules; each one registers itself (its tab,
 * its Panels-menu entry, its Guide chapter and its draw) through the studio
 * API.  This block proves the split is real — the page's inline script no
 * longer holds the panels' drawing code — and that the registry builds the
 * dock and the menu from what registered. */
const PANEL_MODULES = ["screen", "vram", "palettes", "sprites", "audio",
                       "sequencer", "layers", "scanlines", "registers",
                       "console", "markers", "agent", "assets"];
const CHIP_PANELS = ["screen", "vram", "palettes", "sprites", "audio",
                     "sequencer", "layers", "scanlines", "registers",
                     "console"];

function checkPanelModules(page) {
  const S = page.sandbox.PCEStudio;
  const studio = S.studio;

  eq("#102: the thirteen panel modules registered, chip panels first",
     studio.panels.modules().join(","), PANEL_MODULES.join(","));
  for (const id of PANEL_MODULES) {
    check(page.loaded.indexOf("studio-panel-" + id + ".js") >= 0,
          "#102: the page loads renderer/studio-panel-" + id + ".js");
  }
  eq("#102: the chip panels are the registry's, in dock order",
     studio.panels.map((p) => p.id).join(","), CHIP_PANELS.join(","));

  /* The registry: the array is the chip list and carries the methods. */
  check(typeof studio.panels.register === "function" &&
        typeof studio.panels.list === "function" &&
        typeof studio.panels.get === "function" &&
        typeof studio.panels.select === "function" &&
        typeof studio.panels.toggle === "function" &&
        typeof studio.panels.refresh === "function" &&
        typeof studio.panels.dirty === "function",
        "#102: studio.panels is the registry and the chip list");
  eq("#102: the registry holds all thirteen panels",
     studio.panels.list().length, PANEL_MODULES.length);
  check(studio.panels.get("vram").group === "chip" &&
        studio.panels.get("markers").group === "workspace",
        "#102: a panel carries its group");
  check(studio.panels.get("vram").chapter === "the-toy" &&
        studio.panels.get("screen").chapter === "registers",
        "#102: a panel carries its Guide chapter");
  for (const id of CHIP_PANELS) {
    const def = studio.panels.get(id);
    /* #97 gave AUDIO a draw: #102's one exception (the panel that had no
     * state to paint) is gone. */
    check(typeof def.draw === "function",
          "#102: " + id + "'s draw comes from its module (" +
          (typeof def.draw) + ")");
  }
  let dup = null;
  try { studio.panels.register({ id: "vram", label: "again" }); }
  catch (e) { dup = e.message; }
  check(!!dup && /two panels registered as vram/.test(dup),
        "#102: a duplicate panel id is refused (" + dup + ")");

  /* The dock and the Panels menu are built from the registry. */
  const tabs = page.dom.get("dock-tabs").children.map((b) => b.id);
  eq("#102: a dock tab per chip panel", tabs.join(","),
     CHIP_PANELS.map((id) => "dtab-" + id).join(","));
  const menu = page.dom.get("panels-pop");
  const items = menu.children.filter((c) => c.className === "pop-item")
    .map((b) => (b.children[1] && b.children[1].textContent) || b.textContent);
  check(items.indexOf("Markers") >= 0 && items.indexOf("Agent") >= 0,
        "#102: the workspace modules added Markers and Agent to the menu (" +
        items.join(" · ") + ")");
  for (const id of CHIP_PANELS) {
    check(items.indexOf(studio.panels.get(id).label) >= 0,
          "#102: " + id + " added itself to the Panels menu");
  }

  /* The split is real: the page's own inline script holds no panel drawing
   * code and no panel state — it is in the module files. */
  const html = fs.readFileSync(PAGE, "utf8");
  for (const gone of ["function drawVram", "function drawPalettes",
                      "function drawSprites", "function drawScanlines",
                      "function drawRegisters", "function drawConsole",
                      "function drawScreen", "function screenDrawMap",
                      "function bindScreenEditor", "function drawMarkers",
                      "function addMarker", "let palCells", "let screenPic",
                      'label: "SCREEN"']) {
    check(html.indexOf(gone) < 0,
          "#102: studio.html no longer holds " + JSON.stringify(gone));
  }
  for (const fn of ["studio-panel-screen.js", "studio-panel-vram.js",
                    "studio-panel-palettes.js", "studio-panel-sprites.js",
                    "studio-panel-audio.js", "studio-panel-sequencer.js",
                    "studio-panel-scanlines.js",
                    "studio-panel-registers.js", "studio-panel-console.js",
                    "studio-panel-markers.js", "studio-panel-agent.js"]) {
    check(html.indexOf('src="' + fn + '"') >= 0,
          "#102: studio.html loads " + fn);
  }

  /* A panel's Guide chapter comes from its registration. */
  studio.panels.select("console");
  clickOne(page, "dock-guide");
  eq("#102: CONSOLE's Guide opens its module's chapter",
     S.studio.docsChapter(), "budgets");
  studio.closeDocs();
  studio.panels.select("screen");
}

/* ---- #102 closes #84's visual gaps ------------------------------------ *
 * ppu.toys' BACKGROUNDS has a curve button beside each offset, and its map
 * size and screen width are pickers.  Ours: the curve buttons name #79 (the
 * keyframes are that card's), the map-size picker lists the VDC's six MWR
 * sizes and refuses anything but $00 with the model's own code (part B), and
 * the screen-width picker changes the picture's VCE dot clock, which
 * tiles.json carries. */
function checkScreenGaps(page) {
  const S = page.sandbox.PCEStudio;
  const studio = S.studio;
  const sc = S.screen;
  studio.loadExample("palette", true);
  studio.pause();
  studio.seek(0);

  /* the curve buttons exist, are handlers, and name #79 */
  const pageHtml = fs.readFileSync(PAGE, "utf8");
  for (const reg of ["bxr", "byr"]) {
    const b = page.dom.get("scr-" + reg + "-curve");
    check(!!b && (b.listeners.click || []).length === 1,
          "#102: the " + reg.toUpperCase() + " curve button has a handler");
    check(new RegExp("id=\"scr-" + reg + "-curve\"[^>]*title=\"[^\"]*#79")
            .test(pageHtml),
          "#102: the " + reg.toUpperCase() + " curve button says #79 in its " +
          "title");
    for (const fn of b.listeners.click || []) fn(page.dom.fakeEvent(b));
    check(/#79/.test(page.dom.get("toast").textContent),
          "#102: clicking the " + reg.toUpperCase() + " curve button names " +
          "#79 (" + page.dom.get("toast").textContent + ")");
  }
  /* #79 wired the button: it selects the REGISTERS panel and opens the
   * offset's curve there, so the dock is on a different tab now. */
  studio.panels.select("screen");

  /* the map-size dropdown: the six MWR sizes on offer, $00 works, the rest
   * refuse with map-size and snap back */
  const sizeSel = page.dom.get("scr-mapsize");
  eq("#102: the map-size picker lists the VDC's six MWR sizes",
     sizeSel.children.length, 6);
  const offered = sizeSel.children.map((o) => o.value + "=" + o.textContent);
  eq("#102: the six sizes are the hardware's", offered.join(","),
     "0=32 × 32,16=64 × 32,32=128 × 32,64=32 × 64,80=64 × 64,96=128 × 64");
  check(studio.screen().mapSize.mwr === 0 && sizeSel.value === "0",
        "#102: the picker starts on the 32 × 32 BAT ($00)");
  sizeSel.value = "16";
  for (const fn of sizeSel.listeners.change || [])
    fn(page.dom.fakeEvent(sizeSel));
  check(/map-size/.test(studio.screen().error),
        "#102: picking a wider map refuses with map-size (" +
        studio.screen().error + ")");
  check(sizeSel.value === "0",
        "#102: the refused picker snaps back to $00");
  sizeSel.value = "0";
  for (const fn of sizeSel.listeners.change || [])
    fn(page.dom.fakeEvent(sizeSel));
  check(studio.screen().error === "",
        "#102: re-picking $00 clears the refusal");

  /* the screen-width dropdown: 256 / 341 / 512 dots, carried in tiles.json */
  const videoSel = page.dom.get("scr-video");
  eq("#102: the screen-width picker lists the VCE's three dot clocks",
     videoSel.children.map((o) => o.value).join(","), "256,336,512");
  const frame256 = studio.screenFrame();
  check(frame256.width === 256,
        "#102: 256 dots draws a 256-px frame (" + frame256.width + ")");
  videoSel.value = "336";
  for (const fn of videoSel.listeners.change || [])
    fn(page.dom.fakeEvent(videoSel));
  eq("#102: 336 dots is the picture's mode", studio.screen().video, 336);
  const frame336 = studio.screenFrame();
  check(frame336.width === 341,
        "#102: 336 dots draws the VCE's 341-px frame (" + frame336.width + ")");
  check(/341×224 · 7\.16 MHz/.test(
          page.dom.get("scr-video-note").textContent),
        "#102: the width note names the frame and the dot clock (" +
        page.dom.get("scr-video-note").textContent + ")");
  let tiles = JSON.parse(studio.files().find((f) =>
    f.name === "tiles.json").source);
  eq("#102: tiles.json carries the dot clock", tiles.video, 336);
  eq("#102: the drop-down agrees with the file", videoSel.value, "336");
  /* save and reopen keeps it */
  const env = studio.envelopeText();
  studio.openToy(env, "wide.pce.json", { apply: false, persist: false });
  eq("#102: reopening the toy restores the dot clock",
     studio.screen().video, 336);
  videoSel.value = "512";
  for (const fn of videoSel.listeners.change || [])
    fn(page.dom.fakeEvent(videoSel));
  check(studio.screenFrame().width === 512,
        "#102: 512 dots draws a 512-px frame (" +
        studio.screenFrame().width + ")");
  videoSel.value = "256";
  for (const fn of videoSel.listeners.change || [])
    fn(page.dom.fakeEvent(videoSel));
  check(studio.screenFrame().width === 256 &&
        studio.screen().video === 256,
        "#102: back to the 256-dot clock");

  /* the module's own refusals for the two pickers */
  let code = null;
  const pic = studio.screenPicture();
  try { sc.setMapSize(pic, 0x30); } catch (e) { code = e.code; }
  eq("#102: an MWR code that does not exist is refused", code, "map-size");
  code = null;
  try { sc.setVideoWidth(pic, 320); } catch (e) { code = e.code; }
  eq("#102: a fourth dot clock is refused", code, "video-mode");

  studio.loadExample("palette", true);
  studio.pause();
  studio.seek(0);
}

/* ---- #85: PALETTES as a visual editor --------------------------------- *
 * ppu.toys' CGRAM panel one size up: the 32 x 16 table, a click on a swatch
 * selects that entry, and a click in the 512-colour picker writes exactly
 * one 9-bit word into palettes.json — the same picture SCREEN edits.  The
 * evidence reads the file text back, so the entry reaching disk is checked,
 * not only the panel's own in-memory claim. */
function paletteFile(studio) {
  return JSON.parse(studio.files().find((f) => f.name === "palettes.json").source);
}

function checkPalettesPanel(page) {
  const S = page.sandbox.PCEStudio;
  const studio = S.studio;
  const pa = S.palettes;

  check(!!pa && typeof pa.picker === "function",
        "#85: renderer/pce-palettes.js loaded");
  check(page.loaded.some((s) => /pce-palettes\.js$/.test(s)),
        "#85: the page loads renderer/pce-palettes.js");
  if (!pa || !studio.palettes) {
    check(false, "#85: the page has no palettes editor");
    return;
  }

  studio.loadExample("palette", true);
  studio.pause();
  studio.seek(0);
  studio.panels.select("palettes");

  /* the 32 x 16 table and the 512-colour picker are on the panel */
  const grid = page.dom.get("pal32");
  const rows = grid.children.filter((c) => c.className === "prow");
  check(rows.length === 32, "#85: the table has 32 palette rows (" +
        rows.length + ")");
  let swatches = 0;
  for (const row of rows)
    swatches += row.children.filter((c) => c.tagName === "BUTTON").length;
  check(swatches === 512, "#85: 512 swatch buttons, one per CRAM entry (" +
        swatches + ")");
  check(grid.children.filter((c) => c.className === "pal-head").length === 2,
        "#85: the table is split into background and sprite palettes");

  const colours = pa.picker();
  check(colours.length === 512, "#85: the picker offers 512 colours");
  check(new Set(colours.map((c) => c.word)).size === 512,
        "#85: the 512 picker colours are all different");
  check(colours.every((c) => c.word >= 0 && c.word < 512 &&
                            c.r >= 0 && c.r < 8 && c.g >= 0 && c.g < 8 &&
                            c.b >= 0 && c.b < 8),
        "#85: every picker colour is a 9-bit word (3 bits per channel)");
  check(!!page.dom.get("pal-c-0") && !!page.dom.get("pal-c-511"),
        "#85: every one of the 512 colours is a button");

  let st = studio.palettes();
  check(st.palettes === 32 && st.entries === 16 && st.colours === 512,
        "#85: the panel reports 32 palettes of 16 = 512 entries");
  check(st.blank === true,
        "#85: palettes.json starts all black (the example writes its own pal())");
  check(/all black/.test(page.dom.get("pal-note").textContent),
        "#85: the panel says so instead of pretending the file is the frame");

  /* select entry (0,5); the picker's white ($1FF) writes it */
  const sel = studio.paletteSelect(0, 5);
  check(sel.palette === 0 && sel.entry === 5,
        "#85: clicking a swatch selects that entry");
  eq("#85: the swatch click through the DOM selects it",
     (page.dom.get("pal-2-4").click(), studio.palettes().selected.palette), 2);
  eq("#85: … and the entry", studio.palettes().selected.entry, 4);
  studio.paletteSelect(0, 5);

  studio.palettePick(511);                       /* b7 g7 r7 = $1FF, white */
  let pal = paletteFile(studio);
  check(pal.background[0] && pal.background[0][5] === 0x1FF,
        "#85: the picker writes background palette 0 entry 5 = $1FF (" +
        JSON.stringify(pal.background[0] && pal.background[0][5]) + ")");
  eq("#85: the swatch repaints with the new colour",
     page.dom.get("pal-0-5").style.background, "rgb(252,252,252)");
  check(/CRAM \$005/.test(page.dom.get("pal-readout").textContent),
        "#85: the readout names the entry's CRAM address");
  check(/word \$1FF/.test(page.dom.get("pal-readout").textContent),
        "#85: the readout names the 9-bit word");
  check(/CRAM \$005/.test(page.dom.get("pal-0-5").title) &&
        /word \$1FF/.test(page.dom.get("pal-0-5").title),
        "#85: the swatch's tooltip carries its address and word");

  /* #116 (REVIEW-PANELS 85-P2): palette 0 is the one row where `*8` and `*16`
   * give the same address, so the tooltip above cannot tell 16 entries a
   * palette from 8.  Palettes 1-15 and the sprite palettes can: an entry's
   * CRAM address is palette*16 + entry (palettes 16-31 at $100-$1FF). */
  check(/CRAM \$015/.test(pa.title(1, 5, 0x1FF)),
        "#85: background palette 1 entry 5's tooltip is CRAM $015 (" +
        pa.title(1, 5, 0x1FF) + ")");
  check(/CRAM \$123/.test(pa.title(18, 3, 0x0E4)),
        "#85: sprite palette 2 entry 3's tooltip is CRAM $123 (" +
        pa.title(18, 3, 0x0E4) + ")");
  check(/CRAM \$015/.test(page.dom.get("pal-1-5").title),
        "#85: the drawn swatch for palette 1 entry 5 carries it too (" +
        page.dom.get("pal-1-5").title + ")");
  check(studio.palettes().word === 0x1FF && studio.palettes().blank === false,
        "#85: the panel's own state agrees");

  /* one click, one word: pick red ($038) on the same entry */
  page.dom.get("pal-c-7").click();                /* b0 g0 r7 = $038, red */
  pal = paletteFile(studio);
  eq("#85: the picker button writes the entry", pal.background[0][5], 0x38);
  eq("#85: the VCE word's channels", studio.paletteCss(0x38), "rgb(252,0,0)");
  eq("#85: the swatch is red", page.dom.get("pal-0-5").style.background,
     "rgb(252,0,0)");
  check(studio.palettesPicture().palettes[0][5] === 0x38,
        "#85: the picture the panel edits holds the entry");
  eq("#85: $1FF is exactly 511 picker entries along", colours[511].word, 0x1FF);
  eq("#85: $038 is entry 7 of the picker", colours[7].word, 0x38);

  /* SCREEN reads the same file: a palette edit reaches its picture */
  studio.panels.select("screen");
  check(studio.screenPicture() && studio.screenPicture().palettes[0][5] === 0x38,
        "#85: SCREEN picks up the palette edit (the same palettes.json)");
  studio.panels.select("palettes");

  /* entry 0 of a background palette is the one shared backdrop */
  studio.paletteSelect(3, 0);
  check(/shared backdrop/.test(page.dom.get("pal-readout").textContent),
        "#85: entry 0 says it is the shared backdrop");
  studio.palettePick(64);                         /* b1 g0 r0 = $001 */
  pal = paletteFile(studio);
  eq("#85: entry 0 writes the backward", pal.backdrop, 0x001);
  check(pal.background.every((row) => row[0] === 0x001),
        "#85: every background palette's entry 0 is that backdrop");

  /* palettes 16-31 are the sprite palettes, and they are separate */
  studio.paletteSelect(18, 3);
  eq("#85: palette 18 is a sprite palette", studio.palettes().kind, "sprite");
  studio.paletteSetWord(18, 3, 0x0E4);
  pal = paletteFile(studio);
  eq("#85: sprite palette 2 entry 3 = $0E4", pal.sprites[2][3], 0x0E4);
  check(pal.background[2][3] !== 0x0E4,
        "#85: the background palettes are untouched by a sprite edit");

  /* the editor's own refusals come back by code */
  eq("#85: a 33rd palette is refused",
     codeOf(() => studio.paletteSetWord(32, 0, 0)), "palette-range");
  eq("#85: a 17th entry is refused",
     codeOf(() => studio.paletteSetWord(0, 16, 0)), "entry-range");
  eq("#85: a colour past 9 bits is refused",
     codeOf(() => studio.paletteSetWord(0, 1, 512)), "colour-range");
  eq("#85: a fractional colour is refused",
     codeOf(() => studio.paletteSetWord(0, 1, 1.5)), "colour-range");
  eq("#85: a 513th picker index is refused",
     codeOf(() => studio.palettePick(512)), "picker-range");
  eq("#85: a bad channel is refused",
     codeOf(() => pa.word(8, 0, 0)), "channel-range");

  studio.panels.select("screen");
  studio.loadExample("palette", true);
  studio.pause();
  studio.seek(0);
}

/* ---- #85: VRAM as a drawn map ----------------------------------------- *
 * ppu.toys' VRAM panel is an image of characters, not a table of ranges.
 * The decode is proved against a hand-built VRAM (all sixteen colour
 * numbers, a diagonal, a BAT word and a SAT sprite), then the live panel is
 * read: the page it drew, the ImageData it put on the sheet, the word under
 * the pointer and the region the word belongs to. */
function encodeChar(vram, ch, pixel) {
  for (let y = 0; y < 8; y++) {
    let w0 = 0, w1 = 0;
    for (let x = 0; x < 8; x++) {
      const v = pixel(x, y) & 0xF;
      if (v & 1) w0 |= 1 << (7 - x);
      if (v & 2) w0 |= 1 << (15 - x);
      if (v & 4) w1 |= 1 << (7 - x);
      if (v & 8) w1 |= 1 << (15 - x);
    }
    vram[(ch * 16 + y) * 2] = w0 & 0xFF;
    vram[(ch * 16 + y) * 2 + 1] = w0 >> 8;
    vram[(ch * 16 + 8 + y) * 2] = w1 & 0xFF;
    vram[(ch * 16 + 8 + y) * 2 + 1] = w1 >> 8;
  }
}

function decodeChar(vram, ch) {
  const out = new Array(64);
  for (let y = 0; y < 8; y++) {
    const w0 = vram[(ch * 16 + y) * 2] | (vram[(ch * 16 + y) * 2 + 1] << 8);
    const w1 = vram[(ch * 16 + 8 + y) * 2] |
               (vram[(ch * 16 + 8 + y) * 2 + 1] << 8);
    for (let x = 0; x < 8; x++) {
      const bit = 7 - x;
      out[y * 8 + x] = ((w0 >> bit) & 1) | (((w0 >> (bit + 8)) & 1) << 1) |
                       (((w1 >> bit) & 1) << 2) | (((w1 >> (bit + 8)) & 1) << 3);
    }
  }
  return out;
}

function checkVramPanel(page) {
  const S = page.sandbox.PCEStudio;
  const studio = S.studio;
  const V = vramModel;

  check(!!S.vramMap && typeof S.vramMap.charPixels === "function",
        "#85: renderer/pce-vram-map.js loaded");
  check(page.loaded.some((s) => /pce-vram-map\.js$/.test(s)),
        "#85: the page loads renderer/pce-vram-map.js");

  /* ---- the decode, against a hand-built VRAM -------------------------- */
  const vram = new Uint8Array(65536);
  encodeChar(vram, 0x40, (x, y) => (x === y ? 5 : 0));
  eq("#85: the diagonal decodes to eight 5s",
     Array.from(V.charPixels(vram, 0x40)).filter((v) => v === 5).length, 8);
  eq("#85: one pixel of the diagonal", V.charPixel(vram, 0x40, 3, 3), 5);
  eq("#85: off the diagonal", V.charPixel(vram, 0x40, 0, 7), 0);
  encodeChar(vram, 0x41, (x, y) => y * 8 + x);
  eq("#85: all sixteen colour numbers round-trip",
     Array.from(V.charPixels(vram, 0x41)).join(","),
     Array.from({ length: 64 }, (_, i) => i % 16).join(","));

  /* ---- pages ---------------------------------------------------------- */
  eq("#85: the chip is eight pages of 256 characters", V.PAGES, 8);
  eq("#85: a character is sixteen words", V.CHAR_WORDS, 16);
  const range4 = V.pageRange(4);
  check(range4.firstChar === 1024 && range4.lastChar === 1279 &&
        range4.startWord === 16384 && range4.endWord === 20479,
        "#85: page 4 is characters 1024-1279, words $4000-$4FFF");
  eq("#85: the SAT's first word is its first character",
     V.charOfWord(0x7F00), 2032);
  eq("#85: the last word is the last character's last row",
     V.charOfWord(0x7FFF), 2047);

  /* ---- what a word is -------------------------------------------------- */
  const geom = { width: 32, height: 32, shift: 5, wmask: 31, hmask: 31 };
  const map = { segments: [
    { start: 0, words: 1024, kind: "BAT" },
    { start: 1024, words: 1024, kind: "tiles" },
    { start: 0x7F00, words: 64, kind: "SAT" }
  ] };
  vram[0] = 0x23; vram[1] = 0x51;                 /* BAT word $5123 */
  let d = V.describe(vram, map, geom, 0x7F00, 0);
  eq("#85: a BAT word is a BAT cell", d.kind, "BAT");
  check(/BAT cell 0/.test(d.text) && /char \$123/.test(d.text) &&
        /palette 5/.test(d.text),
        "#85: the BAT readout names the character and palette field (" +
        d.text + ")");
  d = V.describe(vram, map, geom, 0x7F00, 0x400 + 3);
  check(d.kind === "tiles" && d.row === 3 && d.plane === 0 &&
        /\$040/.test(d.text), "#85: a tile word names its row and plane");
  d = V.describe(vram, map, geom, 0x7F00, 0x400 + 11);
  check(d.row === 3 && d.plane === 1,
        "#85: the second plane of the same row is the row's other word");
  const satAt = 0x7F00 + 2 * 4;
  vram[satAt * 2] = 0x23; vram[satAt * 2 + 1] = 0x01;          /* Y = $123 */
  vram[(satAt + 1) * 2] = 0x45;                                 /* X = $45  */
  vram[(satAt + 2) * 2] = 7 << 1;                               /* pattern  */
  vram[(satAt + 3) * 2] = 9 | 0x80;                  /* palette 9, SPBG 1 */
  d = V.describe(vram, map, geom, 0x7F00, 0x7F00 + 8);
  check(d.kind === "SAT" && d.sprite === 2,
        "#85: a SAT word names its sprite");
  check(/Y 291/.test(d.detail) && /X 69/.test(d.detail) &&
        /pattern \$007/.test(d.detail) && /palette 9/.test(d.detail),
        "#85: … and its Y, X, pattern and palette (" + d.detail + ")");
  d = V.describe(vram, map, geom, 0x7F00, 0x7FFF);
  eq("#85: a word nothing owns is free", d.kind, "free");

  /* the model's refusals */
  eq("#85: a 2049th character is refused",
     codeOf(() => V.charPixels(vram, 2048)), "char-range");
  eq("#85: a ninth page is refused",
     codeOf(() => V.pageRange(8)), "page-range");
  eq("#85: word 32768 is outside VRAM",
     codeOf(() => V.describe(vram, map, geom, 0x7F00, 32768)), "vram-range");

  /* ---- the live panel -------------------------------------------------- */
  studio.loadExample("palette", true);
  studio.pause();
  studio.seek(0);
  studio.panels.select("vram");
  studio.vramPage(0);
  let vs = studio.vram();
  check(!!vs, "#85: the VRAM panel drew the running frame");
  if (!vs) return;
  check(vs.pages === 8 && vs.page === 0 && vs.firstChar === 0 &&
        vs.lastChar === 255,
        "#85: it starts on page 0, characters 0-255");
  check(vs.canvas.width === 384 && vs.canvas.height === 384,
        "#85: the map canvas is a 384-px page (" + vs.canvas.width + "x" +
        vs.canvas.height + ")");
  check(vs.drawn === true, "#85: the sheet was drawn");
  check(vs.regions.length >= 3, "#85: the regions came from the frame (" +
        vs.regions.map((r) => r.kind).join(",") + ")");
  check(vs.jumps.length >= 3 && vs.jumps.every((j) => j.page >= 0 &&
                                                   j.page < 8),
        "#85: there is a jump for each region");
  eq("#85: the page select holds all eight pages",
     page.dom.get("vram-page").children.length, 8);
  eq("#85: the preview palette select holds sixteen background palettes",
     page.dom.get("vram-pal").children.length, 16);

  /* the sheet is the toy's VRAM, pixel for pixel: the palette example's
   * tile $40 is a diagonal of colour 15 on colour 1 */
  const frameState = studio.state();
  const t = decodeChar(frameState.vram, 0x40);
  check(t[0] === 15 && t[1] === 1,
        "#85: the example's tile $40 is 15s down the diagonal");
  const cramWord = (entry) => (frameState.cram[entry * 2] |
                               (frameState.cram[entry * 2 + 1] << 8)) & 0x1FF;
  const rgbOf = (word) => [((word >> 3) & 7) * 36, ((word >> 6) & 7) * 36,
                           (word & 7) * 36];
  const sheet = studio.vramImage();
  check(!!sheet && sheet.width === 128 && sheet.height === 128,
        "#85: one page is a 128 x 128 sheet (16 x 16 characters)");
  /* character $40 is cell 64: column 0, row 4 */
  let o = ((4 * 8 + 0) * 128 + (0 * 8 + 0)) * 4;
  const want15 = rgbOf(cramWord(15));
  check(sheet.data[o] === want15[0] && sheet.data[o + 1] === want15[1] &&
        sheet.data[o + 2] === want15[2],
        "#85: the drawn pixel is palette 0 entry 15's colour (" +
        [sheet.data[o], sheet.data[o + 1], sheet.data[o + 2]].join(",") +
        " vs " + want15.join(",") + ")");
  o = ((4 * 8 + 0) * 128 + (0 * 8 + 1)) * 4;
  const want1 = rgbOf(cramWord(1));
  check(sheet.data[o] === want1[0] && sheet.data[o + 1] === want1[1] &&
        sheet.data[o + 2] === want1[2],
        "#85: … and the pixel beside it is entry 1's colour");

  /* the preview palette is the sheet's colours: palette 1 is black here */
  studio.vramSetPalette(1);
  const sheet1 = studio.vramImage();
  o = ((4 * 8) * 128) * 4;
  check(sheet1.data[o] === rgbOf(cramWord(16 + 15))[0] &&
        sheet1.data[o + 1] === rgbOf(cramWord(16 + 15))[1] &&
        sheet1.data[o + 2] === rgbOf(cramWord(16 + 15))[2],
        "#85: the preview palette changes the sheet's colours");
  studio.vramSetPalette(0);

  /* paging and the region jumps */
  studio.vramPage(7);
  vs = studio.vram();
  check(vs.page === 7 && vs.firstChar === 1792 && vs.lastChar === 2047,
        "#85: page 7 is characters 1792-2047");
  const satJump = vs.jumps.find((j) => j.kind === "SAT");
  check(!!satJump && satJump.page === 7,
        "#85: the SAT is on page 7 and its jump says so");
  page.dom.get("vram-jump-SAT").click();
  eq("#85: the SAT jump button pages there", studio.vram().page, 7);
  studio.vramPage(0);

  /* the pointer names the word: BAT, tile, SAT */
  d = studio.vramHover(5);
  check(d.kind === "BAT" && /BAT cell 5/.test(d.text),
        "#85: hovering a BAT word names the cell (" +
        (d && d.text) + ")");
  studio.vramPick(0x400);
  vs = studio.vram();
  check(vs.selected === 0x400 && vs.kind === "tiles",
        "#85: clicking a tile's word selects it and says what it is");
  check(/\$040 is one tile/.test(page.dom.get("vram-pick").textContent),
        "#85: the readout names the character");
  d = studio.vramDescribe(0x7F00 + 2 * 4);
  check(d.kind === "SAT" && d.sprite === 2,
        "#85: a SAT word in the running frame names its sprite");
  const canvas = page.dom.get("vrammap");
  canvas.listeners.click[0](pointerAt(canvas, 5, 100));
  eq("#85: a click on the canvas selects the word under the pointer",
     studio.vram().selected, 0x401);

  /* the drawn map, not a table: the sheet is an image, its regions are
   * labelled on it, and the legend is chips */
  const over = studio.vram().overlays;
  check(over.grid === 34 && over.tints >= 64,
        "#85: the BAT's 64 cells on page 0 are tinted and the grid is drawn (" +
        over.tints + " tints, " + over.grid + " grid lines)");
  check(over.labels.indexOf("BAT") >= 0,
        "#85: the BAT's name is drawn on the map (" +
        over.labels.join(",") + ")");
  const canvasCalls = (page.dom.get("vrammap").__ctx &&
                       page.dom.get("vrammap").__ctx.__calls) || [];
  check(canvasCalls.some((c) => c.name === "drawImage"),
        "#85: the canvas really got the sheet (drawImage)");
  check(canvasCalls.some((c) => c.name === "fillText" && /BAT/.test(c.args[0])),
        "#85: … and the BAT label (fillText)");
  const legend = page.dom.get("vram-legend").children;
  check(legend.length >= 3 &&
        /BAT/.test(legend[0].children[1].textContent) &&
        /words/.test(legend[0].children[1].textContent),
        "#85: the legend is chips naming each region and its word count");

  studio.panels.select("screen");
  studio.loadExample("palette", true);
  studio.pause();
  studio.seek(0);
}

/* ---- #102: the studio API the panels are written against -------------- *
 * current toy and assets (the SCREEN tests above drive them), render/seek,
 * pokes with undo/redo, the Panels registry and the theme tokens. */
function checkStudioApi(page) {
  const S = page.sandbox.PCEStudio;
  const studio = S.studio;
  studio.loadExample("palette", true);
  studio.pause();
  studio.seek(30);

  check(typeof studio.toy.files === "function" &&
        studio.toy.files() === studio.toy.files(),
        "#102: toy.files() is the live asset array, not a copy");
  check(studio.render.currentFrame() === 30 &&
        studio.render.length() === 300 &&
        studio.render.state() !== null,
        "#102: render exposes the frame, the length and the state");
  check(typeof studio.render.panelLine === "function" &&
        typeof studio.render.hex === "function" &&
        typeof studio.render.runFrames === "function",
        "#102: render exposes the line, hex and runFrames");

  /* the theme tokens: the page's CSS custom properties by name */
  const tokens = studio.theme.tokens();
  check(Object.keys(tokens).length >= 26 &&
        Object.keys(tokens).every((k) => k.indexOf("--") === 0),
        "#102: the theme exposes the page's custom properties (" +
        Object.keys(tokens).length + ")");
  eq("#102: a theme token is read by name", studio.theme.token("bg"),
     tokens["--bg"]);

  /* a poke overrides a register and the drawn frame follows; undo and redo
   * move it between the two stacks */
  const before = studio.output().pixels.slice();
  studio.poke("CR", 0x00);
  eq("#102: the poke is in the list", studio.pokes().length, 1);
  check(studio.canUndo() && !studio.canRedo(),
        "#102: a poke can be undone, and redo is empty");
  const poked = studio.output().pixels;
  check(diffCount(before, poked).n > 0,
        "#102: a CR $00 poke blanks the picture in the drawn frame (" +
        diffCount(before, poked).n + " bytes)");
  studio.undo();
  samePixels("#102: undo restores the toy's own frame", studio.output().pixels,
             before);
  check(studio.pokes().length === 0 && studio.canRedo(),
        "#102: undo emptied the poke list and armed redo");
  studio.redo();
  check(diffCount(before, studio.output().pixels).n > 0 &&
        studio.pokes().length === 1,
        "#102: redo re-applies the poke");
  studio.clearPokes();
  samePixels("#102: clearPokes restores the frame", studio.output().pixels,
             before);

  /* Ctrl/Cmd+Z outside a text field is the poke undo; inside it belongs to
   * the editor, so it is not consumed */
  studio.poke("BXR", 2);
  check(studio.handleShortcut({ key: "z", code: "KeyZ", ctrlKey: true,
                                metaKey: false, shiftKey: false,
                                target: null }) === true,
        "#102: Ctrl+Z undoes a poke outside the editor");
  check(studio.pokes().length === 0, "#102: and the poke is gone");
  studio.setEditorText(studio.editorText());
  check(studio.handleShortcut({ key: "z", code: "KeyZ", ctrlKey: true,
                                metaKey: false, shiftKey: false,
                                target: page.dom.get("source") }) === false,
        "#102: Ctrl+Z in a text field is left to the editor");

  /* the panel registry, driven through the API */
  check(studio.panels.active() === "screen",
        "#102: the registry knows the active panel");
  studio.panels.select("registers");
  check(studio.panels.active() === "registers" &&
        page.dom.get("panel-registers").hidden === false,
        "#102: the registry selects a panel");
  studio.panels.toggle("vram");
  check(studio.panels.visible().indexOf("vram") < 0,
        "#102: the registry hides a panel");
  studio.panels.toggle("vram");
  studio.panels.select("screen");
  studio.panels.dirty();
  studio.panels.refresh(true);

  studio.clearPokes();
  studio.loadExample("palette", true);
  studio.pause();
  studio.seek(0);
}

/* ---- #92: SCANLINES as a band editor ---------------------------------- *
 * ppu.toys' SCANLINES panel, on the PCE's line interrupt: Inspect line,
 * Apply edits to, the mini frame, Full frame · lines 0-223, a row per band
 * (number, name, Enabled, from-to, move up/down, duplicate, Edit, N
 * controls, a menu) and Add band.  The bands are renderer/pce-raster.js's;
 * what a line may cost is renderer/pce-validate.js's; the toy is written
 * with a fenced raster(line) callback.
 *
 * The frame evidence is two-sided and neither side is the panel's own
 * arithmetic: (1) the panel's preview is pce-sprites.js's compositor over
 * the toy's state with the band table, compared against a render built here
 * from studio.scanlineTable(); (2) after Apply to toy the toy really runs
 * the generated raster() callback, and the runtime's own lastRaster must be
 * the same table, line for line. */

/* One table's entries, in a stable shape, for comparing two of them. */
function rasterEntries(table) {
  if (!table) return null;
  const entries = (table.entries || []).slice()
    .sort((a, b) => a.line - b.line)
    .map((e) => ({
      line: e.line, rcr: e.rcr,
      bxr: e.bxr == null ? null : e.bxr,
      byr: e.byr == null ? null : e.byr,
      cr: e.cr == null ? null : e.cr,
      cram: e.cram ? e.cram.map((w) => w[0] + ":" + w[1]).join(",") : null
    }));
  return { bxr: (table.base || {}).bxr, byr: (table.base || {}).byr,
           cr: (table.base || {}).cr, entries: entries };
}

function checkScanlinesPanel(page) {
  const S = page.sandbox.PCEStudio;
  const studio = S.studio;
  const r = S.raster;
  check(!!r && typeof r.toRaster === "function",
        "#92: renderer/pce-raster.js loaded");
  check(page.loaded.some((s) => /pce-raster\.js$/.test(s)),
        "the page loads renderer/pce-raster.js");
  check(page.loaded.some((s) => /pce-validate\.js$/.test(s)),
        "the page loads renderer/pce-validate.js (the #32 price)");
  if (!r || !studio.scanlines) {
    check(false, "#92: the page has no SCANLINES editor");
    return;
  }

  /* The price the panel shows is the validator's own. */
  check(S.validate && S.validate.RCR && S.validate.RCR.BLANK === 123,
        "#92: the panel reads #32's blank budget from pce-validate.js (" +
        (S.validate && S.validate.RCR && S.validate.RCR.BLANK) + ")");
  eq("#92: the panel quotes the validator's 123-cycle blank",
     studio.scanlinePrice().BLANK, S.validate.RCR.BLANK);

  studio.loadExample("palette", true);
  studio.pause();
  studio.seek(0);
  studio.panels.select("scanlines");

  /* ppu.toys' furniture, on the page */
  check(!!page.dom.get("scn-mini") && !!page.dom.get("scn-preview") &&
        !!page.dom.get("scn-line") && !!page.dom.get("scn-line-slider") &&
        !!page.dom.get("scn-target") && !!page.dom.get("scn-add"),
        "#92: the mini frame, the preview, Inspect line (number and slider), " +
        "Apply edits to and Add band are all on the panel");
  eq("#92: the frame note reads 'Full frame · lines 0-223'",
     page.dom.get("scn-frame-note").textContent, "Full frame · lines 0-223");
  check(/^0$/.test(page.dom.get("scn-line").value),
        "#92: Inspect line starts at 0 (" + page.dom.get("scn-line").value + ")");

  let st = studio.scanlines();
  check(!!st && st.bands.length === 1,
        "#92: a fresh toy starts on one band (got " +
        (st ? st.bands.length : "none") + ")");
  if (!st) return;
  eq("#92: the one band is the full frame", st.bands[0].from + "-" + st.bands[0].to,
     "0-223");
  eq("#92: the full-frame band holds the frame's CR, one control",
     st.bands[0].controls, 1);
  check(st.bands[0].cr != null && st.bands[0].bxr === undefined,
        "#92: it writes CR and leaves BXR/BYR to the toy's own frame()");
  check(studio.scanlineDrawn() && page.dom.get("scn-bands").children.length === 1,
        "#92: the band is a row on the panel");
  check(page.dom.get("scn-target").children.length === 1,
        "#92: Apply edits to lists the band");

  /* Inspect line: the number and the slider move the same value. */
  const slider = page.dom.get("scn-line-slider");
  slider.value = "40";
  for (const fn of slider.listeners.input || [])
    fn({ target: slider, preventDefault() {}, stopPropagation() {} });
  eq("#92: the slider sets the inspected line", studio.scanlines().inspect, 40);

  /* Add band at line 32: ppu.toys' "Add band" splits the band covering it. */
  studio.scanlineInspect(32);
  const made = studio.scanlineAdd(null, 32);
  check(!!made, "#92: Add band made a band at line 32 (" +
        studio.scanlines().error + ")");
  if (!made) return;
  st = studio.scanlines();
  eq("#92: the bands now split at 32",
     st.bands.map((b) => b.from + "-" + b.to).join(","), "0-31,32-223");

  /* Edit it: one control, BXR 64. */
  studio.scanlineSet(made.id, { bxr: 64, byr: null, cr: null });
  st = studio.scanlines();
  const second = st.bands[1];
  eq("#92: the new band holds one control", second.controls, 1);
  eq("#92: BXR 64 is what the band writes", second.bxr, 64);
  eq("#92: the band's cost is the validator's 64 cycles (1 register write)",
     second.cycles, 29 + 35);
  check(second.share > 0.5 && second.share < 0.53,
        "#92: the row shows its share of the 123-cycle blank (" +
        Math.round(second.share * 100) + "%)");

  /* ---- the frame is the renderer's, twice ---------------------------- */
  const table = studio.scanlineTable();
  eq("#92: the table has one entry per band start", table.entries.length, 2);
  eq("#92: band 2's entry fires at line 32",
     table.entries.map((e) => e.line).join(","), "0,32");
  eq("#92: the entry carries the band's BXR and the RCR it arms",
     table.entries[1].bxr + "/$" + table.entries[1].rcr.toString(16), "64/$60");

  const panelFrame = studio.scanlineFrame();
  check(!!panelFrame, "#92: the panel has a preview frame");
  const stLive = studio.state();
  const direct = sprites.renderFrame({
    vram: stLive.vram, cram: stLive.cram, sat: stLive.sat, regs: stLive.regs,
    width: stLive.width, height: stLive.height,
    firstScanline: stLive.firstScanline, raster: table
  });
  eq("#92: the panel's preview is pce-sprites.js drawing the band table",
     diffCount(panelFrame.pixels, direct.pixels).n, 0);

  /* Apply to toy, then let the toy run its own generated raster(). */
  const changed = studio.scanlineApply();
  eq("#92: Apply to toy writes main.lua", changed.join(","), "main.lua");
  const src = studio.files().find((f) => f.name === "main.lua").source;
  check(src.indexOf(r.FENCE_OPEN) >= 0 && src.indexOf(r.FENCE_CLOSE) >= 0,
        "#92: main.lua holds the fenced SCANLINES block");
  check(/function raster\(line\)/.test(src) &&
        /if line == 32 then reg\("BXR", 64\) end/.test(src),
        "#92: the generated callback writes BXR 64 at line 32");
  const frames = studio.runFrames(2);
  const live = studio.runtime().lastRaster;
  check(!!live, "#92: the toy built a raster table by running");
  /* the toy's last frame is what the panel now draws; its base is the
   * register the previous frame's callback left (a BXR the band wrote), so
   * the panel's table is re-read rather than the pre-run copy compared */
  const afterRun = studio.scanlineTable();
  eq("#92: the runtime's own table is the panel's, line for line",
     JSON.stringify(rasterEntries(live)), JSON.stringify(rasterEntries(afterRun)));
  eq("#92: the callback's band wrote BXR 64 on line 32, so that is the " +
     "register the next frame latches", rasterEntries(live).bxr, 64);
  check(frames.length === 2, "#92: the toy ran its two frames");

  /* and the drawn frame is the panel's preview: the same pixels */
  studio.panels.select("scanlines");
  studio.seek(0);
  studio.panels.refresh(true);
  const shown = studio.state();
  const drawnFrame = sprites.renderFrame({
    vram: shown.vram, cram: shown.cram, sat: shown.sat, regs: shown.regs,
    width: shown.width, height: shown.height,
    firstScanline: shown.firstScanline, raster: shown.raster
  });
  eq("#92: the frame on the output is the panel's band table",
     diffCount(drawnFrame.pixels, panelFrame.pixels).n, 0);
  check(shown.entries.length === 2, "#92: the shown state carries two entries (" +
        shown.entries.length + ")");

  /* ---- refused by code past the budget ------------------------------- */
  let code = null;
  try { studio.scanlineSet(second.id, { bxr: 64, byr: 0, cr: 128 }); }
  catch (e) { code = e.code; }
  eq("#92: three register writes on one line are refused", code,
     "raster-band-budget");
  st = studio.scanlines();
  check(st.bands[1].byr === undefined && st.bands[1].cr === undefined,
        "#92: the refused edit left the band alone (byr " +
        st.bands[1].byr + ", cr " + st.bands[1].cr + ")");
  check(/raster-band-budget/.test(page.dom.get("scn-note").textContent),
        "#92: the panel says which code refused it (" +
        page.dom.get("scn-note").textContent + ")");

  /* a register and two colour words: 29 + 35 + 72 = 136, over the blank */
  code = null;
  try { studio.scanlineSet(second.id, { bxr: 64, cram: [[1, 511], [2, 0]] }); }
  catch (e) { code = e.code; }
  eq("#92: a register and two colours are refused", code, "raster-band-budget");

  /* three colour words: the panel's price is the validator's, on the same
   * line, and it is past both rules */
  const vb = S.validate.blankBudget({ entries: [
    { line: 9, rcr: 0x49, cram: [[1, 1], [2, 2], [3, 3]] }] });
  eq("#92: the validator prices three colour words at 137 cycles",
     vb.lines[0].cycles, 137);
  eq("#92: the panel's price is the same number",
     S.raster.priceOf(0, 3).cycles, vb.lines[0].cycles);
  check(vb.coloursOver.length === 1 && vb.over.length === 1,
        "#92: and the validator marks that line over on both rules");
  const overBand = S.raster.newBand({ name: "three", from: 0, to: 9,
    cram: [[1, 1], [2, 2], [3, 3]] }, 224);
  const overCodes = S.raster.checkList([overBand], 224).map((p) => p.code);
  check(overCodes.indexOf("raster-band-budget") >= 0 &&
        overCodes.indexOf("raster-band-colours") >= 0,
        "#92: a three-colour band is refused by the budget and the colour " +
        "rule (" + overCodes.join(",") + ")");
  code = null;
  try { studio.scanlineSet(second.id, { bxr: null, cram: [[1, 1], [2, 2], [3, 3]] }); }
  catch (e) { code = e.code; }
  eq("#92: three colour words on one line are refused by the panel",
     code, "raster-band-budget");

  /* two colour words alone are inside it */
  studio.scanlineSet(second.id, { bxr: null, cram: [[1, 511], [2, 0]] });
  eq("#92: two colour words fit (29 + 72 = 101 cycles)",
     studio.scanlines().bands[1].cycles, 29 + 72);
  studio.scanlineSet(second.id, { cram: null, bxr: 64 });

  /* the inspector's colour-write controls write into the band */
  studio.scanlineSelect(second.id);
  page.dom.get("scn-cram-addr").value = "5";
  page.dom.get("scn-cram-word").value = "511";
  clickOne(page, "scn-cram-add");
  const withCram = studio.scanlineBands().filter((b) => b.id === second.id)[0];
  eq("#92: + colour adds a CRAM write to the selected band",
     JSON.stringify(withCram.cram), "[[5,511]]");
  eq("#92: and the row counts it", studio.scanlines().bands[1].controls, 2);
  clickOne(page, "scn-cram-clear");
  check(studio.scanlineBands().filter((b) => b.id === second.id)[0].cram ===
        undefined, "#92: clear removes the colour writes");

  /* ---- move, duplicate, remove --------------------------------------- */
  const ids = studio.scanlines().bands.map((b) => b.id);
  studio.scanlineMove(ids[1], "up");
  eq("#92: move up swaps the two bands' line ranges",
     studio.scanlines().bands.map((b) => b.from + "-" + b.to).join(","),
     "0-191,192-223");
  studio.scanlineMove(ids[1], "down");
  eq("#92: and move down puts it back",
     studio.scanlines().bands.map((b) => b.from + "-" + b.to).join(","),
     "0-31,32-223");
  eq("#92: duplicating a full display is refused (no free lines)",
     studio.scanlineDuplicate(ids[0]), null);
  check(/raster-line-full/.test(studio.scanlines().error),
        "#92: and the refusal names the code (" +
        studio.scanlines().error + ")");
  studio.scanlineRemove(ids[1]);
  eq("#92: the last band cannot be removed",
     studio.scanlineRemove(ids[0]), null);
  check(/raster-band-order/.test(studio.scanlines().error),
        "#92: the last band's refusal names the code (" +
        studio.scanlines().error + ")");

  /* ---- the toy is the source of truth -------------------------------- */
  studio.loadExample("palette", true);
  studio.pause();
  studio.seek(0);
  studio.scanlineInspect(64);
  const b1 = studio.scanlineAdd(null, 64);
  studio.scanlineSet(b1.id, { bxr: 200 });
  studio.scanlineApply();
  const env = studio.envelopeText();
  studio.loadExample("raster", true);            /* a different toy */
  studio.pause();
  studio.openToy(env, "bands.pce.json", { apply: false, persist: false });
  eq("#92: reopening the toy restores the bands from main.lua",
     studio.scanlines().bands.map((b) => b.from + "-" + b.to).join(","),
     "0-63,64-223");
  eq("#92: and BXR 200 comes back with them",
     studio.scanlines().bands[1].bxr, 200);

  /* a toy with its own hand-written raster() is not overwritten */
  studio.loadExample("raster", true);
  studio.pause();
  studio.seek(0);
  code = null;
  try { studio.scanlineApply(); } catch (e) { code = e.code; }
  eq("#92: a hand-written raster() is refused, not replaced", code, "raster-hand");

  /* Import reads the toy's own table back into bands */
  studio.runFrames(2);
  const imported = studio.scanlineImport();
  check(imported.length > 0, "#92: Import adopts the example's own table (" +
        imported.length + " bands, runs of lines that hold the same values)");
  check(imported.length < 65, "#92: the import is inside the panel's 64-band " +
        "ceiling (" + imported.length + ")");
  const importedTable = studio.scanlineTable({ frame: 0 });
  const toyTable = studio.runtime().lastRaster;
  eq("#92: the imported bands rebuild the toy's first two entries",
     JSON.stringify(rasterEntries(importedTable).entries.slice(0, 2)),
     JSON.stringify(rasterEntries(toyTable).entries.slice(0, 2)));

  /* ---- #17's effects as ready-made bands ----------------------------- */
  studio.loadExample("palette", true);
  studio.pause();
  studio.seek(0);
  studio.scanlineInvalidate();
  studio.loadExample("palette", true);
  studio.pause();
  studio.scanlineInspect(0);
  const grad = studio.scanlineAdd("gradient", 0);
  check(!!grad && grad.fx && grad.fx.kind === "gradient",
        "#92: the Gradient ready-made band makes a gradient band");
  const gradTable = studio.scanlineTable({ frame: 0 });
  check(gradTable.entries.length > 20,
        "#92: a gradient writes a colour on every line (" +
        gradTable.entries.length + " entries)");
  eq("#92: one colour write a line is 65 cycles, inside the blank",
     S.raster.budget(grad).cycles, 29 + 36);
  /* pce-editor.js (#17) draws the same gradient: the two models agree */
  const ed = S.editor;
  const pic = ed.newPicture();
  ed.setGradient(pic, { palette: 0, entry: 1, from: 0x000, to: 0x1FF,
                        line0: 0, line1: 15 });
  const edsTable = ed.toRaster(pic, 0);
  const mine = S.raster.toRaster([S.raster.newBand({
    name: "g", from: 0, to: 15,
    fx: { kind: "gradient", palette: 0, entry: 1, from: 0x000, to: 0x1FF }
  }, 224)], { lines: 224, base: { bxr: 0, byr: 0, cr: 0 } });
  eq("#92: the gradient is #17's gradient, colour for colour",
     JSON.stringify(rasterEntries(mine).entries.map((e) => e.line + "=" + e.cram)),
     JSON.stringify(rasterEntries(edsTable).entries
       .filter((e) => e.line <= 15).map((e) => e.line + "=" + e.cram)));

  const wob = studio.scanlineAdd("wobble", 32);
  check(!!wob && wob.fx.kind === "wobble", "#92: the Wobble band");
  eq("#92: a wobble is one BXR write a line (64 cycles)",
     S.raster.budget(wob).cycles, 64);
  check(studio.scanlines().problems.length === 0,
        "#92: a gradient and a wobble are inside the budget");

  /* ---- the line count and the window --------------------------------- */
  studio.scanlineSetLines(240);
  eq("#92: the display can be 240 lines (#67)",
     page.dom.get("scn-frame-note").textContent, "Full frame · lines 0-239");
  studio.scanlineSetLines(200);
  check(/raster-lines/.test(studio.scanlines().error),
        "#92: a third line count is refused (" + studio.scanlines().error + ")");
  studio.scanlineSetLines(224);

  /* ---- #116 (REVIEW-PANELS 92-R2): the wobble's BXR, line by line ------ *
   * The budget above prices a wobble at one write a line whatever the
   * values; the values are BXR = round(amplitude * sin(2π * (line - line0 +
   * speed*frame) / period)), and they were never read. */
  const wobBand = [{ from: 0, to: 223, enabled: true,
                     fx: { kind: "wobble", amplitude: 4, period: 32,
                           speed: 0 } }];
  const wobTable = r.toRaster(wobBand, { lines: 224 });
  const wobByLine = new Map(wobTable.entries.map((e) => [e.line, e.bxr]));
  let wobbleBad = null;
  const wobbleFirst = [];
  for (let line = 0; line < 224; line++) {
    const want = Math.round(4 * Math.sin(2 * Math.PI * line / 32)) & 0x3FF;
    const got = wobByLine.get(line);
    if (got !== want && !wobbleBad)
      wobbleBad = "line " + line + ": got " + got + ", want " + want;
    if (line < 6) wobbleFirst.push(line + ":" + got);
  }
  check(!wobbleBad, "#92: a period-32 wobble's BXR is 4·sin(2π·line/32) on " +
        "every one of the 224 lines" + (wobbleBad ? " (" + wobbleBad + ")" : ""));
  eq("#92: the wobble's first six lines are 0,1,2,2,3,3 — a period, not a " +
     "half-period", wobbleFirst.join(","), "0:0,1:1,2:2,3:2,4:3,5:3");
  /* the phase is the band's own start, the frame and the speed; the base
   * BXR is the table's, added to the offset.  Amplitude 4 over period 24
   * keeps every line off a rounding knife-edge. */
  const wobPhase = [{ from: 10, to: 40, enabled: true,
                      fx: { kind: "wobble", amplitude: 4, period: 24,
                            speed: 2 } }];
  const phaseTable = r.toRaster(wobPhase, { lines: 224, frame: 3,
                                            base: { bxr: 7 } });
  const phaseByLine = new Map(phaseTable.entries.map((e) => [e.line, e.bxr]));
  let phaseBad = null;
  for (let line = 10; line <= 40; line++) {
    const phase = (line - 10 + 2 * 3) / 24;
    const want = (7 + Math.round(4 * Math.sin(2 * Math.PI * phase))) & 0x3FF;
    if (phaseByLine.get(line) !== want && !phaseBad)
      phaseBad = "line " + line + ": got " + phaseByLine.get(line) +
                 ", want " + want;
  }
  check(!phaseBad, "#92: a wobble's phase is line0 + speed·frame, with its " +
        "own amplitude, period and the table's base BXR" +
        (phaseBad ? " (" + phaseBad + ")" : ""));

  studio.loadExample("palette", true);
  studio.pause();
  studio.seek(0);
}

/* ---- #98: the CONSOLE panel, ppu.toys' SNES tab ---------------------- *
 * The panel runs the real pipeline on the real Lua the editor holds:
 * pce-il.js lowers it, pce-validate.js prices it, pce-cgen.js emits C and
 * refuses what part A/C cannot compile.  The three inputs here are the card's
 * three states: a clean toy (green), a toy with a known refusal at a known
 * line (red, and the finding's link moves the editor there), and a toy whose
 * frame costs more than the console can give (red, the frame budget finding
 * pointing at function frame()).  Nothing is faked: every number comes from
 * the modules through the panel's own api. */
function checkConsolePanel(page) {
  const S = page.sandbox.PCEStudio;
  const studio = S.studio;
  const dom = page.dom;

  /* The refusal is on line 4; reg("NOPE") is both a static range refusal
   * (validate-range) and one the C emitter refuses (cgen-op). */
  const REFUSAL = "g = 0\nfunction frame(t, f)\n  g = g + 1\n" +
                  "  reg(\"NOPE\", 0)\nend\n";
  /* 20,000 iterations costs ~2,001,250 cycles, over the validator's
   * 8-display-frame ceiling; frame() is on line 2. */
  const OVER = "g = 0\nfunction frame(t, f)\n" +
               "  for i = 1, 20000 do g = g + 1 end\nend\n";
  const CLEAN = ilExports.TOY_PALETTE;

  function load(source) {
    if (studio.activeFile() !== "main.lua") studio.selectFile("main.lua");
    studio.setEditorText(source);
    studio.panels.select("console");
    studio.panels.refresh(true);
    return studio.console();
  }

  /* ---- a clean toy is green ------------------------------------------ */
  let rep = load(CLEAN);
  check(!!rep, "#98: CONSOLE has a report for the palette toy");
  eq("#98: a clean toy's banner is green", rep.banner.state, "ok");
  eq("#98: the green banner's words", rep.banner.text,
     "Can run on the PC Engine");
  eq("#98: the green banner is drawn", dom.get("console-banner").textContent,
     "Can run on the PC Engine");
  check(dom.get("console-banner").className.indexOf("is-ok") >= 0,
        "#98: the green banner carries the ok class (" +
        dom.get("console-banner").className + ")");
  eq("#98: a clean toy has no findings", rep.findings.length, 0);
  check(/No findings/.test(dom.get("console-findings").children[0].textContent),
        "#98: the findings list says there is nothing to fix");
  check(rep.stats.collectionCycles > 0 &&
        rep.stats.collectionCycles < S.validate.MODEL.FRAME_CLOCKS,
        "#98: the clean toy has a frame time (" + rep.stats.collectionCycles +
        " cycles)");
  check(rep.stats.framePct > 0 && rep.stats.framePct < 1,
        "#98: the frame time is a fraction of 119,904 (" +
        (rep.stats.framePct * 100).toFixed(2) + "%)");
  check(rep.stats.codeBytes > 0 && rep.stats.romBytes > 0,
        "#98: code and ROM sizes are measured (" + rep.stats.codeBytes +
        " B of C, " + rep.stats.romBytes + " B estimated ROM)");
  eq("#98: the stats draw one row per figure",
     dom.get("console-stats").children.length, 6);
  const html = fs.readFileSync(PAGE, "utf8");
  check(/static estimate, checked against Mednafen and ares,\s+not hardware/
          .test(html), "#98: the honest note is on the panel");
  check(html.indexOf("frame time · compiler findings · code size") >= 0,
        "#98: the panel says what it is");

  /* ---- a known refusal: red, with a link to its Lua line ------------- */
  rep = load(REFUSAL);
  eq("#98: a refused toy's banner is red", rep.banner.state, "bad");
  check(/^Can't run on the PC Engine as written yet: \d+ problems? to fix$/
          .test(rep.banner.text),
        "#98: the red banner names the count (" + rep.banner.text + ")");
  eq("#98: the red banner is drawn", dom.get("console-banner").textContent,
     rep.banner.text);
  check(dom.get("console-banner").className.indexOf("is-bad") >= 0,
        "#98: the red banner carries the bad class");
  const range = rep.findings.filter((f) => f.code === "validate-range")[0];
  check(!!range, "#98: the validator's refusal is listed");
  eq("#98: the range finding points at main.lua line 4", range && range.line, 4);
  check(rep.findings.some((f) => f.code === "cgen-op"),
        "#98: the C emitter's refusal is listed too (" +
        rep.findings.map((f) => f.code).join(", ") + ")");
  const links = [];
  for (const row of dom.get("console-findings").children) {
    for (const cell of row.children) {
      if (cell.className === "con-line") links.push(cell);
    }
  }
  const link = links.filter((e) => e.textContent === "main.lua:4")[0];
  check(!!link, "#98: the finding draws a clickable main.lua:4 (" +
        links.map((e) => e.textContent).join(", ") + ")");
  /* clicking the link puts the editor's cursor on that line */
  const line4 = REFUSAL.split("\n").slice(0, 3).join("\n").length + 1;
  if (link) {
    link.click();
    eq("#98: the link moves the editor to line 4", dom.get("source").selectionStart,
       line4);
  }
  check(rep.stats.collectionCycles == null,
        "#98: a toy that never ran a frame still draws, without inventing one");
  eq("#98: an unmeasured toy still draws its three figures",
     dom.get("console-stats").children.length, 3);

  /* ---- an over-budget frame: red, and the link is function frame() --- */
  rep = load(OVER);
  eq("#98: an over-budget toy's banner is red", rep.banner.state, "bad");
  const budget = rep.findings.filter((f) => f.code === "validate-frame-budget")[0];
  check(!!budget, "#98: the frame budget refusal is listed (" +
        rep.findings.map((f) => f.code).join(", ") + ")");
  check(rep.stats.collectionCycles >
        S.validate.MODEL.HARD_FRAMES * S.validate.MODEL.FRAME_CLOCKS,
        "#98: the over-budget frame is measured, not guessed (" +
        rep.stats.collectionCycles + " cycles)");
  eq("#98: the frame budget finding links to function frame()'s line",
     budget && budget.line, 2);

  /* ---- #116 (REVIEW-PANELS 98-C2): a warning is not an error ----------- *
   * No fixture above emits a severity "warn" finding, so the warning half of
   * the count was never read: 0 errors + 2 warnings must not read "2
   * errors".  This toy's frame is over 60 Hz but under the 8-frame ceiling,
   * which the validator prices as one warning. */
  const SLOW = "g = 0\nfunction frame(t, f)\n" +
               "  for i = 1, 1500 do g = g + 1 end\nend\n";
  rep = load(SLOW);
  eq("#98: a slow-but-runnable toy has no errors", rep.errors, 0);
  eq("#98: … and exactly one warning", rep.warnings, 1);
  check(rep.findings.some((f) => f.severity === "warn" &&
                                 f.code === "validate-slow-frame"),
        "#98: the warning is a finding in its own right (" +
        rep.findings.map((f) => f.severity + ":" + f.code).join(", ") + ")");
  eq("#98: a warning leaves the banner green", rep.banner.state, "ok");
  eq("#98: … drawn green", dom.get("console-banner").textContent,
     "Can run on the PC Engine");
  eq("#98: the count separates errors from warnings",
     dom.get("console-count").textContent, "0 errors · 1 warning");
  check(/is-warn/.test(dom.get("console-findings").children[0].className),
        "#98: the warning is drawn as a warning (" +
        dom.get("console-findings").children[0].className + ")");

  /* restore the page's own state for the sections after this one */
  studio.panels.select("screen");
  studio.loadExample("palette", true);
  studio.pause();
  studio.seek(0);
}

/* ---- #93: LAYERS, the PCE's answer to ppu.toys' COMPOSE ---------------- *
 * ppu.toys' COMPOSE previews a main and a sub screen and adds them with a
 * brightness; the PC Engine has neither, so this panel shows the backdrop,
 * the background and the sprites apart and composed, the stacking order, the
 * layers' on/off through CR (BB/SB), each sprite's SPBG bit, and a fade done
 * the only way the VCE can: by rewriting palettes.
 *
 * What is measured here, all through the page's own API:
 *   - each preview is renderer/pce-sprites.js drawing the running frame with
 *     ONE CR value changed, compared against a frame this check renders
 *     itself from that same value (the test never asks the panel what the
 *     answer is);
 *   - the layer toggles are CR bits: the composed preview and the canvas
 *     both equal the renderer with the bit cleared, and the live VDC's CR
 *     carries the write;
 *   - a sprite's SPBG bit flipped in the view equals the renderer given a SAT
 *     this check patches itself (word 3 bit 7);
 *   - a 16-step fade runs headlessly: the toy code the panel writes is put
 *     into main.lua, the toy is run for 17 frames, and every frame's CRAM
 *     entries and pixels equal this check's own arithmetic and the renderer
 *     drawn with the computed palettes.  The plan's step 8 word is also
 *     worked out here by hand (3-bit channels, floor) so the fade's curve is
 *     checked, not just its self-consistency;
 *   - the two write-backs (main.lua block, fade.json) and the model's
 *     refusals by code.
 *
 * Written by @design with the panel, as this file's card says; @review owes
 * it a cold break (RULES.md rule 2). */
const LAYERS_SCENE = `
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

function init()
  -- a filled 32x32 BAT of one opaque character (colours 1 and 15)
  for y = 0, 27 do
    for x = 0, 31 do vram[y * 32 + x] = 0x0040 end
  end
  puttile(0x40, function(col, row)
    if col == row then return 15 else return 1 end
  end)
  -- a 16x16 sprite, colour 2 (planes 0 and 1 set), SPBG 0 = behind the BG
  for row = 0, 15 do
    vram[0x100 * 64 + row] = 0
    vram[0x100 * 64 + 16 + row] = 0xFFFF
    vram[0x100 * 64 + 32 + row] = 0
    vram[0x100 * 64 + 48 + row] = 0
  end
  pal(0, rgb(1, 0, 0))       -- the shared backdrop, CRAM $000
  pal(1, rgb(0, 7, 0))       -- the background's colour 1 (green 7)
  pal(15, rgb(7, 7, 7))      -- its colour 15
  pal(0x101, rgb(0, 0, 7))   -- sprite colour 1
  pal(0x102, rgb(7, 0, 7))   -- sprite colour 2
  reg("CR", 0xC0)
end
function frame(t, f)
  sprite(0, { x = 144, y = 160, pattern = 0x100, palette = 0, spbg = false })
end
`;

/* The same scene with a line callback that sets CR on every line (#116,
 * REVIEW-PANELS 93-L3): a raster entry's CR overrides the frame's register
 * on its line, so the layer mask has to reach it too. */
const LAYERS_RASTER_SCENE = LAYERS_SCENE.replace(
  "function frame(t, f)",
  "function raster(line)\n" +
  "  reg(\"CR\", 0xC0)\n" +
  "end\n" +
  "function frame(t, f)");

/* The frame the running runtime would draw with one CR value (and optionally
 * one CRAM table / one SAT), rendered here by the renderer itself. */
function layerFrame(studio, over) {
  const opts = studio.runtime().options();
  opts.regs = Object.assign({}, opts.regs);
  if (over && over.CR != null) opts.regs.CR = over.CR;
  if (over && over.cram) opts.cram = over.cram;
  if (over && over.sat) opts.sat = over.sat;
  return sprites.renderFrame(opts);
}

/* CRAM words -> the renderer's byte table (the test's own conversion, not the
 * model's). */
function cramBytesOf(words) {
  const out = new Uint8Array(1024);
  for (let i = 0; i < 512; i++) {
    out[i * 2] = words[i] & 0xFF;
    out[i * 2 + 1] = (words[i] >> 8) & 0x3;
  }
  return out;
}

function cramWordsOf(bytes) {
  const words = new Array(512);
  for (let i = 0; i < 512; i++)
    words[i] = (bytes[i * 2] | (bytes[i * 2 + 1] << 8)) & 0x1FF;
  return words;
}

/* The same fade arithmetic a person can do on paper: three 3-bit channels,
 * floor at every step. */
function fadedWord(from, to, k, steps) {
  const ch = (w) => [(w >> 6) & 7, (w >> 3) & 7, w & 7];
  const a = ch(from), b = ch(to);
  const mix = (x, y) => Math.floor((x * steps + (y - x) * k) / steps);
  return (mix(a[0], b[0]) << 6) | (mix(a[1], b[1]) << 3) | mix(a[2], b[2]);
}

function countPixels(pixels, test) {
  let n = 0;
  for (let i = 0; i + 2 < pixels.length; i += 3)
    if (test(pixels[i], pixels[i + 1], pixels[i + 2])) n++;
  return n;
}

function checkLayersPanel(page) {
  const S = page.sandbox.PCEStudio;
  const studio = S.studio;
  const L = S.layers;
  const modFile = fs.readFileSync(path.join(RENDERER, "studio-panel-layers.js"), "utf8");

  check(!!studio.panels.get("layers"),
        "#93: the LAYERS panel registered");
  eq("#93: LAYERS is a chip panel with a draw and the model's Guide chapter",
     [studio.panels.get("layers").group,
      typeof studio.panels.get("layers").draw,
      studio.panels.get("layers").chapter],
     ["chip", "function", "registers"]);
  check(modFile.indexOf("No colour blending on the PC Engine") >= 0,
        "#93: the panel carries the one line about no colour blending");
  check(modFile.indexOf("flicker (#28)") >= 0 && /dither/.test(modFile),
        "#93: that line names flicker (#28) and a dither");

  /* A scene with both layers: an opaque tiled BG and a SPBG=0 sprite over
   * it.  Frame 0, paused. */
  studio.loadExample("palette", true);
  runEditorSource(studio, LAYERS_SCENE);
  studio.pause();
  studio.seek(0);
  const st = studio.state();
  check(!!st && st.regs.CR === 0xC0,
        "#93: the scene runs with CR $C0 (BB and SB set)");
  const cr = st.regs.CR;
  const live = L.cramWords ? L.cramWords(st.cram) : cramWordsOf(st.cram);
  check(live[0] === 0x008 && live[1] === 0x1C0 && live[15] === 0x1FF &&
        live[0x101] === 0x007 && live[0x102] === 0x03F,
        "#93: the scene's palettes are where the toy wrote them (backdrop $008, " +
        "BG $1C0/$1FF, sprite $007/$03F)");

  /* -- the four previews, each the renderer with one CR value -- */
  const pv = studio.layerPreviews();
  const dec = S.bg.decodeCram(st.cram);
  let backdropSame = true;
  for (let i = 0; i < pv.backdrop.pixels.length; i += 3) {
    if (pv.backdrop.pixels[i] !== dec[0] ||
        pv.backdrop.pixels[i + 1] !== dec[1] ||
        pv.backdrop.pixels[i + 2] !== dec[2]) { backdropSame = false; break; }
  }
  check(backdropSame && pv.backdrop.pixels.length === st.width * st.height * 3,
        "#93: the backdrop preview is CRAM $000 everywhere (" +
        [dec[0], dec[1], dec[2]].join(",") + ")");

  const bgOnly = layerFrame(studio, { CR: (cr | 0x80) & ~0x40 });
  const spOnly = layerFrame(studio, { CR: (cr | 0x40) & ~0x80 });
  const composed = layerFrame(studio, { CR: cr });
  samePixels("#93: the BG preview is the renderer with BB on and SB clear",
             pv.bg.pixels, bgOnly.pixels);
  samePixels("#93: the sprite preview is the renderer with SB on and BB clear",
             pv.sprites.pixels, spOnly.pixels);
  samePixels("#93: the composed preview is the renderer with the frame's CR",
             pv.composed.pixels, composed.pixels);
  samePixels("#93: the composed preview is what the output column draws",
             pv.composed.pixels, studio.output().pixels);

  /* The sprite is behind the BG and the BG is opaque, so it is invisible in
   * the composed frame but visible in its own preview. */
  const MAGENTA = (r, g, b) => r === 252 && g === 0 && b === 252;
  check(countPixels(pv.composed.pixels, MAGENTA) === 0,
        "#93: with SPBG=0 under an opaque BG the sprite shows nowhere");
  check(countPixels(pv.sprites.pixels, MAGENTA) === 256,
        "#93: the sprite preview shows the 16x16 block (" +
        countPixels(pv.sprites.pixels, MAGENTA) + " pixels)");
  check(countPixels(pv.bg.pixels, MAGENTA) === 0,
        "#93: the BG preview holds no sprite pixels");

  /* -- the stacking order, spelled out -- */
  const stack = L.stack();
  eq("#93: the stacking order is backdrop, SPBG=0, BG, SPBG=1",
     stack.map((s) => s.key).join(","),
     "backdrop,sprites-back,bg,sprites-front");
  const rows = studio.layerRows();
  eq("#93: the layer table starts backdrop / background / sprites",
     rows.slice(0, 3).map((r) => r.label).join(","),
     "Backdrop,Background,Sprites");
  eq("#93: the table names the bits the layers really live on",
     [rows[1].source, rows[2].source],
     ["CR bit 7 (BB)", "CR bit 6 (SB)"]);
  check(/SAT word 3 bit 7/.test(rows[3].source),
        "#93: the sprite row names SPBG (SAT word 3 bit 7)");

  /* -- toggles through CR -- */
  studio.setLayer("sprites", false);
  check(studio.layers().sprites === false &&
        (studio.state().regs.CR & 0x40) === 0,
        "#93: sprites off clears SB (CR bit 6) in the live VDC");
  samePixels("#93: sprites off — the panel's composed frame is CR with SB clear",
             studio.layerPreviews().composed.pixels,
             layerFrame(studio, { CR: cr & ~0x40 }).pixels);
  samePixels("#93: sprites off — the canvas is that same frame",
             studio.output().pixels, layerFrame(studio, { CR: cr & ~0x40 }).pixels);
  check(/SB 0/.test(studio.layerRegisters()),
        "#93: the registers fold shows SB 0 while sprites are off");
  studio.setLayer("sprites", true);

  studio.setLayer("bg", false);
  /* BB clear blanks the background to CRAM $100; the SPRITES are still on,
   * and an SPBG=0 sprite shows over a colour index whose low nibble is 0 —
   * so the sprite is now the only thing in the picture. */
  const bgOff = layerFrame(studio, { CR: (cr & ~0x80) | 0x40 });
  samePixels("#93: BG off — the composed frame is CR with BB clear, SB set",
             studio.layerPreviews().composed.pixels, bgOff.pixels);
  check((studio.state().regs.CR & 0x80) === 0 &&
        (studio.state().regs.CR & 0x40) === 0x40,
        "#93: BG off clears only BB; SB stays the toy's");
  check(countPixels(studio.layerPreviews().composed.pixels, MAGENTA) === 256,
        "#93: with the BG blanked the SPBG=0 sprite shows over the backdrop");
  studio.setLayer("bg", true);
  samePixels("#93: both layers back — the composed frame is the toy's own",
             studio.layerPreviews().composed.pixels, composed.pixels);

  /* -- a sprite's SPBG, flipped in the view -- */
  const sat0 = studio.state().sat;
  const patched = new Uint8Array(sat0);
  patched[6] = patched[6] | 0x80;      /* SAT word 3, high byte, bit 7 */
  const inFront = layerFrame(studio, { CR: cr, sat: patched });
  check(countPixels(inFront.pixels, MAGENTA) === 256,
        "#93: SPBG=1 puts the sprite in front of the opaque BG (control)");
  studio.layerSetSpritePriority(0, true);
  const afterFlip = studio.layerPreviews().composed;
  samePixels("#93: the flipped sprite equals the renderer with SPBG set in the SAT",
             afterFlip.pixels, inFront.pixels);
  check(countPixels(afterFlip.pixels, MAGENTA) === 256,
        "#93: the flip shows the sprite in the composed frame");
  check(studio.state().sat[6] === sat0[6],
        "#93: the view's flip does not touch the toy's SAT (SPBG left as it was)");
  check(/SPBG 1/.test(studio.layerRegisters()),
        "#93: the registers fold reads SPBG 1 after the flip");
  eq("#93: the sprite row says it is a view override",
     [studio.layerRows()[3].front, studio.layerRows()[3].viewOnly,
      studio.layerRows()[3].spbg],
     [true, true, false]);
  studio.layerClearSpritePriorities();
  samePixels("#93: clearing the override returns the sprite behind the BG",
             studio.layerPreviews().composed.pixels, composed.pixels);

  /* -- the fade -- */
  /* The button pass before this check clicked every chip, so the spec is
   * set here rather than assumed. */
  const allSpec = studio.fadeSetSpec({ palettes: "all", target: "black",
                                       steps: 16, curve: "linear" });
  eq("#93: \"all\" chooses the VCE's 32 palettes, black, 16 steps, linear",
     [allSpec.palettes.length, allSpec.target, allSpec.steps, allSpec.curve],
     [32, 0, 16, "linear"]);
  studio.fadeSetSpec({ palettes: [{ kind: "background", palette: 0 },
                                  { kind: "sprite", palette: 0 }],
                       target: "white", steps: 16, curve: "linear" });
  let plan = studio.fadePlan();
  const want = [0].concat(Array.from({ length: 15 }, (_, i) => 1 + i),
                          Array.from({ length: 16 }, (_, i) => 0x100 + i));
  eq("#93: background palette 0 owns the backdrop and entries 1-15; sprite " +
     "palette 0 owns CRAM $100-$10F",
     plan.addresses.join(","), want.join(","));
  eq("#93: step 0 is the source palette",
     plan.frames[0], plan.addresses.map((a) => live[a]));
  eq("#93: the last step is the target word",
     plan.frames[16].filter((w) => w === 0x1FF).length,
     plan.addresses.length);
  /* By hand: $03F (G0 R7 B7) -> $1FF at 8 of 16 is G3 R7 B7 = $0FF. */
  const at102 = plan.addresses.indexOf(0x102);
  check(at102 >= 0 && fadedWord(0x03F, 0x1FF, 8, 16) === 0x0FF &&
        plan.frames[8][at102] === 0x0FF,
        "#93: step 8 of $03F -> white is $0FF, by the check's own arithmetic " +
        "and the plan's (plan says $" +
        (at102 >= 0 ? plan.frames[8][at102].toString(16).toUpperCase() : "?") +
        ")");
  /* And every step of the plan is that arithmetic, not just step 8. */
  let planOk = true;
  for (let k = 0; k <= 16 && planOk; k++)
    for (let i = 0; i < plan.addresses.length; i++)
      if (plan.frames[k][i] !== fadedWord(live[plan.addresses[i]], 0x1FF, k, 16))
        planOk = false;
  check(planOk, "#93: all 17 steps are the 3-bit floor interpolation");

  /* The panel's drawn step equals the renderer with those palettes. */
  const step8 = studio.fadeStep(8);
  const words8 = live.slice();
  for (let i = 0; i < plan.addresses.length; i++)
    words8[plan.addresses[i]] = plan.frames[8][i];
  samePixels("#93: the fade preview at step 8 is the renderer with step 8's palettes",
             step8.frame.pixels,
             layerFrame(studio, { CR: cr, cram: cramBytesOf(words8) }).pixels);

  /* The curve is integer arithmetic the toy code can repeat: ease-in at 8 of
   * 16 is 4, ease-out is 12. */
  eq("#93: the curves are (k*k)/steps and steps-((steps-k)^2)/steps",
     [L.curveAt("in", 8, 16), L.curveAt("out", 8, 16), L.curveAt("linear", 8, 16)],
     [4, 12, 8]);

  /* -- the toy code the panel writes, run headlessly -- */
  const wrote = studio.fadeWriteToy();
  check(wrote && wrote.changed === true,
        "#93: Write to toy puts the fade block into main.lua");
  const src = studio.current().source;
  check(src.indexOf("-- >>> PCEStudio fade") >= 0 &&
        src.indexOf("-- <<< PCEStudio fade") >= 0,
        "#93: the block carries its markers (a second write replaces it)");
  const again = studio.fadeWriteToy();
  check(again.changed === false &&
        (studio.current().source.match(/-- >>> PCEStudio fade/g) || []).length === 1,
        "#93: writing twice leaves one block, byte-equal");

  const frames = studio.render.runFrames(17, null, "lua");
  eq("#93: the written toy runs 17 frames (16 steps, 0..16)", frames.length, 17);
  let cramFrames = 0, pixelFrames = 0, firstBad = "";
  for (let f = 0; f < 17; f++) {
    const fr = frames[f];
    const words = cramWordsOf(fr.state.cram);
    let cramOk = true;
    for (let i = 0; i < plan.addresses.length; i++)
      if (words[plan.addresses[i]] !== plan.frames[f][i]) cramOk = false;
    if (!cramOk) { cramFrames++; if (!firstBad) firstBad = "cram f" + f; }
    const want = words.slice();
    for (let i = 0; i < plan.addresses.length; i++)
      want[plan.addresses[i]] = plan.frames[f][i];
    const exp = layerFrame(studio, { CR: cr, cram: cramBytesOf(want) });
    if (pixelDiffCount(fr.pixels, exp.pixels) !== 0) {
      pixelFrames++;
      if (!firstBad) firstBad = "pixels f" + f;
    }
  }
  check(cramFrames === 0,
        "#93: every frame's CRAM is the step's palette (" + firstBad + ")");
  check(pixelFrames === 0,
        "#93: every frame equals the renderer with the computed palettes (" +
        firstBad + ")");
  check(pixelDiffCount(frames[16].pixels, composed.pixels) > 0,
        "#93: the faded frame is a different picture from the toy's own");
  check(countPixels(frames[16].pixels, (r, g, b) => r === 252 && g === 252 &&
                                                b === 252) ===
        st.width * st.height,
        "#93: at step 16 the whole picture is white (every channel to 7)");

  /* -- the asset form -- */
  const asset = studio.fadeSaveAsset();
  check(studio.fileNames().indexOf("fade.json") >= 0,
        "#93: Save as asset puts fade.json in the toy's files");
  const file = studio.files().find((x) => x.name === "fade.json");
  let parsed = null;
  try { parsed = JSON.parse(file.source); } catch (e) { parsed = null; }
  check(!!parsed && parsed.kind === "pce.fade" && parsed.steps === 16 &&
        parsed.frames.length === 17 &&
        parsed.addresses.length === plan.addresses.length,
        "#93: fade.json records the 17 stepped palettes");
  eq("#93: fade.json's step 8 is the plan's step 8", parsed.frames[8],
     plan.frames[8]);
  check(asset.changed === true &&
        studio.fadeSaveAsset().changed === false,
        "#93: saving the same plan again writes nothing");

  /* -- refusals, by code -- */
  eq("#93: a 1-step fade is refused", codeOf(() => studio.fadeSetSpec({ steps: 1 })),
     "fade-steps");
  eq("#93: an unknown curve is refused", codeOf(() => studio.fadeSetSpec({ curve: "smooth" })),
     "fade-curve");
  eq("#93: a target past 9 bits is refused",
     codeOf(() => studio.fadeSetSpec({ target: 0x200 })), "fade-target");
  eq("#93: a fade with no palette is refused",
     codeOf(() => studio.fadeSetSpec({ palettes: [] })), "fade-palettes");
  eq("#93: an unknown palette kind is refused",
     codeOf(() => studio.fadeSetSpec({ palettes: [{ kind: "bg", palette: 0 }] })),
     "palette-kind");
  check(studio.fadeSpec().steps === 16 && studio.fadeSpec().curve === "linear",
        "#93: a refused spec leaves the panel's fade as it was");

  /* ---- #116 (REVIEW-PANELS 93-L2): background palettes 1-15 ----------- *
   * Entry 0 of every background palette is the shared backdrop at CRAM
   * $000, so the BG never reads $010, $020, …; a fade that wrote them would
   * spend writes on colours nothing shows.  The plan above uses background
   * palette 0, where the duplicate is deduplicated away. */
  const bg1Addresses = Array.from({ length: 15 }, (_, i) => 0x11 + i);
  eq("#93: addressesOf('background', 1) is entries 1-15 only (17-31)",
     L.addressesOf("background", 1).join(","), bg1Addresses.join(","));
  studio.fadeSetSpec({ palettes: [{ kind: "background", palette: 1 },
                                  { kind: "sprite", palette: 0 }],
                       target: "black", steps: 8, curve: "linear" });
  const plan1 = studio.fadePlan();
  const sp0Addresses = Array.from({ length: 16 }, (_, i) => 0x100 + i);
  eq("#93: a background palette 1 fade plans 17-31, then the sprite " +
     "palette's $100-$10F", plan1.addresses.join(","),
     bg1Addresses.concat(sp0Addresses).join(","));
  check(plan1.addresses.indexOf(0x010) < 0,
        "#93: the plan never writes CRAM $010, which the BG does not read");

  /* The ?fade= hook: the screenshot needs no synthetic input (the same trick
   * as ?poke= and ?bands=). */
  const p2 = runPage("?demo=sprite&paused=1&panel=layers&fade=b0+s0,white,8,linear");
  const s2 = p2.sandbox.PCEStudio.studio;
  eq("#93: ?fade= sets the panel's fade spec",
     [s2.fadeSpec().steps, s2.fadeSpec().curve, s2.fadeSpec().target],
     [8, "linear", 0x1FF]);
  eq("#93: ?panel=layers selects the panel", s2.panels.active(), "layers");
  const plan2 = s2.fadePlan();
  eq("#93: ?fade= captured the plan (backdrop, entries 1-15, sprite $100-$10F)",
     plan2.addresses.length, 32);

  /* ---- #116 (REVIEW-PANELS 93-L3): a raster line's CR is masked too ----- *
   * A raster() entry's CR overrides the frame's register on its line, so
   * switching the BG off must clear BB there as well — no fixture above has
   * a raster table at all. */
  studio.loadExample("palette", true);
  runEditorSource(studio, LAYERS_RASTER_SCENE);
  const rst = studio.state();
  check(!!rst && !!rst.raster && rst.raster.entries.length === 224 &&
        rst.raster.entries.every((e) => e.cr === 0xC0),
        "#93: the raster toy's table sets CR $C0 on every line (" +
        (rst && rst.raster ? rst.raster.entries.length : "no table") +
        " entries)");
  const noBB = (v) => v & ~0x80;
  const gatedTable = L.gatedRaster(rst.raster, noBB);
  check(gatedTable.entries.every((e) => e.cr === 0x40),
        "#93: gatedRaster clears BB on every raster entry's CR");
  check(gatedTable.base.cr === 0x40,
        "#93: … and on the table's base CR (" + gatedTable.base.cr + ")");
  studio.setLayer("bg", false);
  const wantRaster = {
    base: Object.assign({}, rst.raster.base, { cr: 0x40 }),
    baseCram: rst.raster.baseCram,
    entries: rst.raster.entries.map((e) => Object.assign({}, e, { cr: 0x40 }))
  };
  const wantOpts = studio.runtime().options();
  wantOpts.regs = Object.assign({}, wantOpts.regs, { CR: 0x40 });
  wantOpts.raster = wantRaster;
  samePixels("#93: with the BG off, every raster line is the renderer with " +
             "BB cleared", studio.layerPreviews().composed.pixels,
             sprites.renderFrame(wantOpts).pixels);
  check((studio.state().regs.CR & 0x80) === 0,
        "#93: … and the live VDC's BB is clear");
  studio.setLayer("bg", true);

  /* Leave the page on the sprite example, paused at frame 0 (the code the
   * fade was written into is not carried on). */
  studio.loadExample("sprite", true);

  studio.pause();
  studio.seek(0);
}

/* ---- #80: the gallery, the Browse page and a toy's own page ----------- *
 * The five example toys (#29) are toys/*.lua; renderer/gallery-toys.js is
 * tools/gallery.js's output of them.  What this checks: the generator is
 * current and every source is the file byte for byte; the studio's ?toy=
 * opens one and runs it equal to the file through the runtime directly; the
 * Browse page builds a card per toy with the two links and its filters; a
 * toy's page shows that toy's file, and says so by code when the id is not
 * one.  The pictures are the --browser run's (each page's selftest reads the
 * frame it drew); the stub DOM cannot show pixels. */
const BROWSE_PAGE = path.join(RENDERER, "browse.html");
const TOY_PAGE = path.join(RENDERER, "toy.html");
const TOYS_DIR = path.join(__dirname, "..", "toys");

function toySource(file) {
  return fs.readFileSync(path.join(TOYS_DIR, file), "utf8");
}

function checkGallery(page) {
  const S = page.sandbox.PCEStudio;
  const studio = S.studio;

  /* 1. the data is the generator's, and the generator reads toys/*.lua */
  let out = "";
  try {
    out = execFileSync(process.execPath,
      [path.join(__dirname, "..", "tools", "gallery.js"), "--check"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    check(/is the generator's output/.test(out),
          "tools/gallery.js --check: " + out.trim());
  } catch (e) {
    check(false, "tools/gallery.js --check exits 0 (" +
          String((e && (e.stderr || e.message)) || e).trim() + ")");
  }
  const data = (S.galleryData && S.galleryData.toys) || [];
  /* #128 added OAK WOODS, #127 CAVE, #125 CITY and #147 PLATFORMER and TOWER
   * — five demos besides the sky gradient (#29) and STARFALL; #151 added
   * DUSK RUN and took the other four #29 effects out of Browse (their toys
   * stay in toys/).  Browse and the studio read the same generated list. */
  check(data.length === 8,
        "the gallery carries the sky gradient, STARFALL, OAK WOODS, CAVE, " +
        "CITY, PLATFORMER, TOWER and DUSK RUN (got " + data.length + ")");
  eq("the gallery's ids, in the toys' order", data.map((t) => t.id),
     ["sky-gradient", "starfall", "oak-woods", "cave", "city", "platformer",
      "tower", "dusk-run"]);
  /* #125: the committed gallery carries CITY's art-free toy — the playable
   * file with the pack's picture is demo-art/city/main.lua and only the
   * deploy reads it (tools/gallery.js --with-demo-art). */
  const cityToy = data.find((t) => t.id === "city") || {};
  check(typeof cityToy.source === "string" &&
        (cityToy.source.match(/vram\[/g) || []).length === 0,
        "#125: the committed CITY source has no converted art in it");
  let mismatched = [];
  for (const t of data) {
    if (t.source !== toySource(t.file)) mismatched.push(t.file);
  }
  check(mismatched.length === 0,
        "every gallery source is toys/<file> byte for byte" +
        (mismatched.length ? " (" + mismatched.join(", ") + ")" : ""));

  /* #121: STARFALL is a folder toy — the card's title, author, four tags and
   * all four files, each the toys/demo-game/ file byte for byte. */
  const star = data.find((t) => t.id === "starfall") || {};
  eq("#121: STARFALL's title", star.title, "STARFALL");
  eq("#121: STARFALL's author", star.author, "PCEStudio examples");
  eq("#121: STARFALL's tags", star.tags,
     ["playable", "sprites", "music", "raster"]);
  check(/IJKL/.test(star.blurb || "") && /N fires/.test(star.blurb || ""),
        "#121: STARFALL's description names the pad keys (" +
        JSON.stringify(star.blurb) + ")");
  eq("#121: STARFALL's files, main.lua first",
     (star.files || []).map((f) => f.name + ":" + f.kind),
     ["main.lua:lua", "tiles.json:tiles", "palettes.json:palettes",
      "sprites.json:sprites"]);
  const starWrong = (star.files || []).filter((f) =>
    f.source !== toySource("demo-game/" + f.name));
  check(star.files && star.files.length === 4 && starWrong.length === 0,
        "#121: all four STARFALL files are toys/demo-game/ byte for byte" +
        (starWrong.length ? " (wrong: " +
         starWrong.map((f) => f.name).join(", ") + ")" : ""));

  /* 2. the studio: the gallery list, the top-bar link, and ?toy= */
  eq("studio.gallery is the gallery's toys", studio.gallery.map((g) => g.id),
     data.map((t) => t.id));
  check(studio.gallery[0].source === toySource("sky-gradient.lua"),
        "studio.gallery's sky-gradient source is toys/sky-gradient.lua");
  check(/id="btn-browse"[^>]*href="browse\.html"/.test(
          fs.readFileSync(PAGE, "utf8")),
        "the top bar links Browse (the stub DOM does not parse static hrefs)");

  const skySrc = toySource("sky-gradient.lua");
  const q = runPage("?toy=sky-gradient&paused=1");
  const qs = q.sandbox.PCEStudio.studio;
  eq("?toy=sky-gradient is the gallery's sky-gradient", qs.current().id,
     "sky-gradient");
  eq("?toy=sky-gradient shows sky-gradient.lua in the title",
     qs.current().name, "sky-gradient.lua");
  check(qs.current().source === skySrc,
        "?toy=sky-gradient runs toys/sky-gradient.lua byte for byte");

  /* the same 40 frames as the file run through the runtime with no page */
  const pageFrames = qs.runFrames(40, "sky-gradient", "lua");
  const rt = S.toys.create(skySrc, { budgetMs: 120 });
  rt.load();
  const direct = [];
  for (let f = 0; f < 40; f++) { rt.setPad(1, {}); direct.push(rt.frame(f)); }
  rt.dispose();
  let pixelsDiffer = 0, stateDiffer = 0;
  for (let f = 0; f < pageFrames.length; f++) {
    if (diffCount(pageFrames[f].pixels, direct[f].pixels).n) pixelsDiffer++;
    if (diffCount(pageFrames[f].state.vram, direct[f].state.vram).n ||
        diffCount(pageFrames[f].state.cram, direct[f].state.cram).n ||
        diffCount(pageFrames[f].state.sat, direct[f].state.sat).n)
      stateDiffer++;
  }
  check(pageFrames.length === 40 && pixelsDiffer === 0,
        "the studio's sky-gradient runs 40 frames pixel-equal to " +
        "toys/sky-gradient.lua (" + pixelsDiffer + " differ)");
  check(stateDiffer === 0,
        "… with vram/cram/sat equal on every frame (" +
        stateDiffer + " differ)");

  /* #121: ?toy=starfall opens the demo game as a folder toy — all four
   * files, the panels' pictures among them — and runs visibly: frame 60 has
   * tens of thousands of pixels that are not the frame's own background. */
  const sg = runPage("?toy=starfall&paused=1");
  const ss = sg.sandbox.PCEStudio.studio;
  eq("#121: ?toy=starfall is the demo game", ss.current().id, "starfall");
  check(ss.current().source === toySource("demo-game/main.lua"),
        "#121: ?toy=starfall runs toys/demo-game/main.lua byte for byte");
  eq("#121: the studio holds all four STARFALL files",
     ss.fileNames().join(","),
     "main.lua,tiles.json,palettes.json,sprites.json");
  const sAssetWrong = ss.files().filter((f) => f.name !== "main.lua").filter(
    (f) => f.source !== toySource("demo-game/" + f.name));
  check(sAssetWrong.length === 0,
        "#121: … and the three asset files are toys/demo-game/'s" +
        (sAssetWrong.length ? " (wrong: " +
         sAssetWrong.map((f) => f.name).join(", ") + ")" : ""));
  let sEnv = null;
  try { sEnv = JSON.parse(ss.envelopeText()); } catch (e) { /* checked */ }
  check(!!sEnv && sEnv.title === "STARFALL" && /IJKL/.test(sEnv.description),
        "#121: the studio's toy is titled STARFALL and its description names " +
        "the pad keys");
  const sFrames = ss.runFrames(61, null, "lua");
  const sLast = sFrames[sFrames.length - 1];
  /* the studio page does not load pce-gallery.js, so count the ink here */
  let sInk = 0;
  if (sLast && sLast.pixels) {
    const px = sLast.pixels, r0 = px[0], g0 = px[1], b0 = px[2];
    for (let i = 0; i < px.length; i += 3)
      if (px[i] !== r0 || px[i + 1] !== g0 || px[i + 2] !== b0) sInk++;
  }
  check(sFrames.length === 61 && sInk > 1000,
        "#121: STARFALL runs from frame 0 to 60 and frame 60 has a picture (" +
        sInk + " pixels)");

  /* #121: the Open… list offers it, and its button loads the same toy in
   * place (the stub DOM's click runs the listener the person's click does). */
  const menu = page.dom.get("example-list");
  const starBtn = (menu ? menu.children : []).find(
    (el) => el.getAttribute && el.getAttribute("data-example-id") === "starfall");
  check(!!starBtn && /STARFALL/.test(starBtn.textContent),
        "#121: Open… lists STARFALL (" +
        JSON.stringify(starBtn ? starBtn.textContent : null) + ")");
  if (starBtn) starBtn.click();
  eq("#121: the Open… button loads STARFALL", studio.current().id, "starfall");
  eq("#121: … with its four files", studio.fileNames().join(","),
     "main.lua,tiles.json,palettes.json,sprites.json");
  check(studio.current().source === toySource("demo-game/main.lua"),
        "#121: … and the game's own main.lua");
  studio.loadExample("palette", true);   /* leave the page on a #29 toy */

  const miss = runPage("?toy=no-such-toy&paused=1");
  const ms = miss.sandbox.PCEStudio.studio;
  eq("?toy=<unknown> records the miss", ms.galleryMiss(), "no-such-toy");
  eq("?toy=<unknown> leaves the first example loaded",
     ms.current().id, "palette");

  /* 3. the Browse page */
  const b = runBarePage(BROWSE_PAGE, "?paused=1");
  const B = b.sandbox.PCEStudio.browse;
  check(!!B, "browse.html exposes PCEStudio.browse");
  const cards = B.cards();
  eq("browse.html builds a card per toy in the toys' order",
     cards.map((c) => c.id),
     ["sky-gradient", "starfall", "oak-woods", "cave", "city", "platformer",
      "tower", "dusk-run"]);
  /* #125: the committed CITY card runs the art-free toy, so it draws no
   * picture here; the deployed gallery carries the playable file and does.
   * Every other card must have ink. */
  check(cards.every((c) => !c.error && (c.ink > 0 || c.id === "city")),
        "every card drew its frame 60, except the CITY placeholder " +
        "(art-free in the repo, playable when deployed) (" +
        cards.map((c) => c.id + " " + c.ink).join(", ") + ")");
  check(cards.every((c) => c.href === "toy.html?id=" + c.id),
        "each card links to the toy's own page");
  check(cards.every((c) => c.studioHref === "studio.html?toy=" + c.id),
        "each card's Open in Studio links to the studio with the toy");
  check(cards.every((c) => c.rawHref === "../toys/" + c.file),
        "each card names the toy's own file");

  /* #121: STARFALL's card is one of the wall's, drawn at frame 60 and
   * linked both ways like the rest. */
  const starCard = cards.find((c) => c.id === "starfall") || {};
  check(starCard.ink > 1000 && !starCard.error,
        "#121: Browse draws STARFALL's frame 60 (" + starCard.ink +
        " pixels" + (starCard.error ? ", error " + starCard.error : "") + ")");
  check(starCard.href === "toy.html?id=starfall" &&
        starCard.studioHref === "studio.html?toy=starfall" &&
        starCard.rawHref === "../toys/demo-game/main.lua",
        "#121: the STARFALL card links to its page, the studio and its file");

  /* #147: PLATFORMER and TOWER are Dennis's two playable demos, copied
   * unchanged.  Both are on Browse with the two links, and the studio opens
   * each byte for byte and runs it visibly. */
  for (const id of ["platformer", "tower"]) {
    const t = data.find((x) => x.id === id) || {};
    eq("#147: " + id + "'s author", t.author, "PCEStudio examples");
    eq("#147: " + id + "'s tags", t.tags, ["playable", "sprites"]);
    check(/J and L/.test(t.blurb || "") && /N jumps/.test(t.blurb || ""),
          "#147: " + id + "'s blurb names the pad keys (" +
          JSON.stringify(t.blurb) + ")");

    const card = cards.find((c) => c.id === id) || {};
    check(card.ink > 1000 && !card.error,
          "#147: Browse draws " + id + "'s frame 60 (" + card.ink +
          " pixels" + (card.error ? ", error " + card.error : "") + ")");
    check(card.href === "toy.html?id=" + id &&
          card.studioHref === "studio.html?toy=" + id &&
          card.rawHref === "../toys/" + id + "/main.lua",
          "#147: the " + id + " card links to its page, the studio and its " +
          "file");

    const q = runPage("?toy=" + id + "&paused=1");
    const qs = q.sandbox.PCEStudio.studio;
    eq("#147: ?toy=" + id + " opens the demo", qs.current().id, id);
    check(qs.current().source === toySource(id + "/main.lua"),
          "#147: ?toy=" + id + " runs toys/" + id + "/main.lua byte for byte");
    const qFrames = qs.runFrames(61, null, "lua");
    const qLast = qFrames[qFrames.length - 1];
    let qInk = 0;
    if (qLast && qLast.pixels) {
      const px = qLast.pixels, r0 = px[0], g0 = px[1], b0 = px[2];
      for (let i = 0; i < px.length; i += 3)
        if (px[i] !== r0 || px[i + 1] !== g0 || px[i + 2] !== b0) qInk++;
    }
    check(qFrames.length === 61 && qInk > 1000,
          "#147: " + id + " runs frame 0 to 60 and frame 60 has a picture (" +
          qInk + " pixels)");
  }

  /* #151: DUSK RUN, Dennis's endless runner, copied unchanged.  It is on
   * Browse with the two links, and the studio opens it byte for byte and
   * runs it visibly — its build draws a few tiles a frame, so frame 60 is
   * already the score bar and the ground. */
  {
    const t = data.find((x) => x.id === "dusk-run") || {};
    eq("#151: dusk-run's author", t.author, "PCEStudio examples");
    eq("#151: dusk-run's tags", t.tags,
       ["playable", "sprites", "raster", "parallax"]);
    check(/N jumps/.test(t.blurb || "") && /rocks/.test(t.blurb || ""),
          "#151: dusk-run's blurb names the pad keys (" +
          JSON.stringify(t.blurb) + ")");

    const card = cards.find((c) => c.id === "dusk-run") || {};
    check(card.ink > 1000 && !card.error,
          "#151: Browse draws dusk-run's frame 60 (" + card.ink +
          " pixels" + (card.error ? ", error " + card.error : "") + ")");
    check(card.href === "toy.html?id=dusk-run" &&
          card.studioHref === "studio.html?toy=dusk-run" &&
          card.rawHref === "../toys/dusk-run/main.lua",
          "#151: the dusk-run card links to its page, the studio and its file");

    const q = runPage("?toy=dusk-run&paused=1");
    const qs = q.sandbox.PCEStudio.studio;
    eq("#151: ?toy=dusk-run opens the demo", qs.current().id, "dusk-run");
    check(qs.current().source === toySource("dusk-run/main.lua"),
          "#151: ?toy=dusk-run runs toys/dusk-run/main.lua byte for byte");
    const qFrames = qs.runFrames(61, null, "lua");
    const qLast = qFrames[qFrames.length - 1];
    let qInk = 0;
    if (qLast && qLast.pixels) {
      const px = qLast.pixels, r0 = px[0], g0 = px[1], b0 = px[2];
      for (let i = 0; i < px.length; i += 3)
        if (px[i] !== r0 || px[i + 1] !== g0 || px[i + 2] !== b0) qInk++;
    }
    check(qFrames.length === 61 && qInk > 1000,
          "#151: dusk-run runs frame 0 to 60 and frame 60 has a picture (" +
          qInk + " pixels)");
  }

  B.setTag("raster");
  eq("the raster tag shows the raster toys", B.visible(),
     ["sky-gradient", "starfall", "oak-woods", "dusk-run"]);
  B.setTag("");
  B.setQuery("sky");
  eq("the search box filters to the sky gradient", B.visible(),
     ["sky-gradient"]);
  B.setQuery("PCEStudio");
  eq("search by author finds the toys PCEStudio made", B.visible(),
     B.toys().map((t) => t.id).filter((id) => id !== "cave"));
  /* #127: the cave's card carries the pack's author, because the pack's
   * licence asks for attribution — and the search can find it there */
  B.setQuery("Will Tice");
  eq("the CAVE card is found by the pack's author", B.visible(), ["cave"]);
  B.setQuery("");
  B.setSort("az");
  eq("A–Z sorts by title", B.visible(),
     ["cave", "city", "dusk-run", "oak-woods", "platformer", "sky-gradient",
      "starfall", "tower"]);
  B.setSort("written");

  const bt = runBarePage(BROWSE_PAGE, "?tag=raster");
  eq("?tag=raster opens the page filtered",
     bt.sandbox.PCEStudio.browse.visible(),
     ["sky-gradient", "starfall", "oak-woods", "dusk-run"]);

  /* 4. a toy's own page */
  const t = runBarePage(TOY_PAGE, "?id=sky-gradient&paused=1");
  const T = t.sandbox.PCEStudio.toyPage;
  check(!!T, "toy.html exposes PCEStudio.toyPage");
  eq("toy.html?id=sky-gradient is the sky gradient", T.toy().id,
     "sky-gradient");
  check(T.source() === skySrc,
        "the toy page's source is toys/sky-gradient.lua byte for byte");
  eq("its raw-source link is the toy's file", T.rawHref(),
     "../toys/sky-gradient.lua");
  eq("its Open in Studio link", T.studioHref(),
     "studio.html?toy=sky-gradient");
  eq("its tag chips", T.toy().tags, ["palette", "raster"]);

  const toyFrames = T.frames(60);
  const toyLast = toyFrames[toyFrames.length - 1];
  const ink = toyLast ? t.sandbox.PCEStudio.gallery.countInk(toyLast) : 0;
  check(toyFrames.length === 60 && ink > 0,
        "the toy page runs 60 frames and frame 60 has a picture (" + ink +
        " pixels)");

  const m = runBarePage(TOY_PAGE, "?id=not-a-toy");
  const mt = m.sandbox.PCEStudio.toyPage;
  const mErr = mt.error ? mt.error() : null;
  check(!!mErr && mErr.code === "unknown-toy",
        "an id that is not a toy is refused by code (got " +
        JSON.stringify(mErr) + ")");
  check(m.dom.get("toy-page").getAttribute("data-error") === "unknown-toy",
        "the page marks the unknown id on its root");
  eq("and it names the id it was given", mt.id, "not-a-toy");
}

/* #80's pixels: the stub DOM records drawing calls and shows nothing, so the
 * two new pages are opened in headless Chrome and their own selftest is
 * read.  browse.html's selftest counts every card's frame-60 ink (a toy that
 * runs without error can still draw a flat rectangle — #90); toy.html's
 * runs 60 frames and reports the ink and a digest. */
async function checkGalleryBrowser() {
  if (!fs.existsSync(CHROME)) {
    console.log("NOT RUN  gallery browser: " + CHROME + " is not installed");
    return "not-run";
  }
  const base = path.join(process.env.TMPDIR || os.tmpdir(),
                         "pcestudio-chrome-80-" + process.pid);
  const pages = [
    { name: "browse.html", file: BROWSE_PAGE, search: "?selftest=1",
      want: /^PASS 8 cards, each drawn at frame 60 · ink / },
    { name: "toy.html?id=sky-gradient", file: TOY_PAGE,
      search: "?id=sky-gradient&selftest=1",
      want: /^PASS 60 frames · sky-gradient · 256x224 · ink [1-9][0-9]* · digest / }
  ];
  let pass = true;
  for (let i = 0; i < pages.length; i++) {
    const def = pages[i];
    const profile = base + "-" + i;
    let dom = "";
    try {
      dom = execFileSync(CHROME, [
        "--headless=new", "--disable-gpu", "--no-sandbox",
        "--user-data-dir=" + profile,
        "--virtual-time-budget=30000",
        "--dump-dom", pathToFileURL(def.file).href + def.search
      ], { encoding: "utf8", timeout: 120000,
           stdio: ["ignore", "pipe", "ignore"] });
    } catch (e) {
      check(false, "headless Chrome ran " + def.name + " (" + e.message + ")");
      pass = false;
    }
    const m = dom.match(/id="selftest"[^>]*>([^<]+)</);
    const text = m ? m[1].trim() : "";
    const ok = def.want.test(text);
    check(ok, "headless Chrome: " + def.name + "'s selftest (" +
          JSON.stringify(text.slice(0, 160)) + ")");
    if (text) console.log("      browser gallery: " + def.name + " — " +
                          text.slice(0, 150));
    pass = pass && ok;
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }
  return pass ? "pass" : "fail";
}

/* ---- main ------------------------------------------------------------- */
async function main() {
  const started = Date.now();
  let page;
  try {
    page = runPage("");
  } catch (e) {
    console.log("FAIL  renderer/studio.html did not run (" + e.message + ")");
    process.exit(1);
  }
  checkBoot(page);
  checkDocs(page);
  await checkExport(page);
  checkFortyFrames(page);
  checkIlSwitch(page);
  checkButtons(page);
  checkFiles(page);
  checkShortcuts(page);
  checkCodeMirrorEditorText();
  checkOutputColumn(page);
  checkPlayPastLength(page);
  checkStudioSplits(page);
  checkExamplesVisible(page);
  checkPasteRun(page);
  checkScreenPanel(page);
  checkSpritesPanel(page);
  checkPanelModules(page);
  checkScreenGaps(page);
  checkPalettesPanel(page);
  checkVramPanel(page);
  checkScanlinesPanel(page);
  checkConsolePanel(page);
  checkLayersPanel(page);
  checkAudioPanel(page);
  checkAudioVoicePicker(page);
  checkSequencerPanel(page);
  checkStudioApi(page);
  checkGallery(page);

  let browser = "not-requested";
  let galleryBrowser = "not-requested";
  if (process.argv.indexOf("--browser") >= 0) {
    browser = await checkBrowser();
    galleryBrowser = await checkGalleryBrowser();
  }

  const ms = Date.now() - started;
  if (failures.length) {
    console.log("FAIL  " + failures.length + " of " + checks +
                " checks failed (" + ms + " ms)");
    process.exit(1);
  }
  console.log("PASS  " + checks + " checks, " + FRAMES +
              " frames diff 0 vs check-toys' expected state, Lua == IL for 3 " +
              "examples, editor/files/shortcuts, output column, every button's " +
              "handler executed (" + buttonCount + " buttons)" +
              (browser === "pass" ? ", headless Chrome: PASS 40 + driver" : "") +
              (galleryBrowser === "pass"
                ? ", headless Chrome: browse + toy page selftests" : "") +
              " (" + ms + " ms)");
}

main().catch((e) => {
  console.log("FAIL  " + (e && e.stack ? e.stack : e));
  process.exit(1);
});
