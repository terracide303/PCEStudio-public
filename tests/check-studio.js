#!/usr/bin/env node
/*
 * tests/check-studio.js — the evidence for #75 (layout + run + panels) and
 * #77 (the CodeMirror editor, the toy's files, save/open, autosave, Vim).
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
 *  9. --browser (optional): the real page is loaded in headless Google
 *     Chrome with ?selftest=1&frames=40; the DOM must say PASS 40 frames and
 *     its frame-39 digest must equal the one computed here from check-toys'
 *     hand-built expected state. A second load with ?docs=sprites must show
 *     the Docs panel open with the generated reference. A third, an HTTP
 *     iframe driver, proves CodeMirror itself (Lua mode, gutter, line
 *     numbers, active line), save/reopen, Vim, the real DOM shortcuts and
 *     autosave across a reload. Without the flag the suite still covers 1-8
 *     in the stub DOM.
 *
 * Not measured here: layout and CSS (a screenshot is the evidence, under
 * $TMPDIR and described in docs/STUDIO.md), a real canvas's pixels (the stub
 * context records nothing), the toy compiler/export (#31, second half of
 * #75), sound (#71), the asset importer (#24/#71), and the agent link (#24).
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

function runPage(search, storage) {
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

  /* the export button opens a message that names #31, and the message is in
   * the page (the stub does not parse static HTML into textContent). */
  clickOne(page, "btn-export");
  check(page.dom.get("export-modal").hidden === false,
        "Export opens its dialog");
  const html = fs.readFileSync(PAGE, "utf8");
  check(/NEEDS #31/.test(html) && /toy compiler is card #31/.test(html),
        "the Export dialog says it needs #31");
  clickOne(page, "export-close");
  check(page.dom.get("export-modal").hidden === true,
        "the Export dialog closes");

  /* the same panel from a URL (this is how the screenshots open it) */
  const q = runPage("?docs=sprites&paused=1");
  check(q.dom.get("docs-panel").hidden === false,
        "?docs=<chapter> opens the Docs panel on load");
  check(q.sandbox.PCEStudio.studio.docsChapter() === "sprites",
        "?docs=sprites lands on the sprites chapter");
  q.sandbox.PCEStudio.studio.closeDocs();
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

  /* An asset edit must not become the Lua that runs. */
  studio.selectFile("tiles.json");
  const assetText = '{"version":1,"tiles":[{"char":64,"palette":0}]}\n';
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

  /* Save and reopen: one JSON envelope, byte-identical both ways. */
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
  check(!!env && env.files[0].source === edited &&
        env.files.find((f) => f.name === "tiles.json").source === assetText,
        "the envelope's sources are the editor's exact texts");
  const before = studio.envelopeText();
  studio.loadExample("raster", true);           /* move away from the toy */
  studio.openToy(saved.text, saved.name);
  const after = studio.envelopeText();
  check(saved.text === after, "a saved toy reopened is byte-identical");
  check(before === after, "reopening does not rewrite the toy silently");
  check(studio.editorText() === edited && studio.current().source === edited,
        "reopening restores the editor and the Lua that runs");
  check(studio.files().length === 5 &&
        studio.files().find((f) => f.name === "tiles.json").source === assetText,
        "reopening restores the asset files too");

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

  /* Ctrl/Cmd+S saves the toy envelope, not just main.lua. */
  studio.setEditorText(studio.editorText() + "\n-- saved by shortcut\n");
  check(shortcut(studio, { key: "s", ctrlKey: true }) === true,
        "Ctrl+S is a page shortcut");
  const storedToy = storage.getItem("pcestudio.toy.v1") || "";
  check(storedToy.indexOf("-- saved by shortcut") >= 0 &&
        /"files"/.test(storedToy),
        "Ctrl+S saves the whole toy envelope");

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
  checkFortyFrames(page);
  checkIlSwitch(page);
  checkButtons(page);
  checkFiles(page);
  checkShortcuts(page);

  let browser = "not-requested";
  if (process.argv.indexOf("--browser") >= 0) browser = await checkBrowser();

  const ms = Date.now() - started;
  if (failures.length) {
    console.log("FAIL  " + failures.length + " of " + checks +
                " checks failed (" + ms + " ms)");
    process.exit(1);
  }
  console.log("PASS  " + checks + " checks, " + FRAMES +
              " frames diff 0 vs check-toys' expected state, Lua == IL for 3 " +
              "examples, editor/files/shortcuts, every button's handler " +
              "executed (" + buttonCount + " buttons)" +
              (browser === "pass" ? ", headless Chrome: PASS 40 + driver" : "") +
              " (" + ms + " ms)");
}

main().catch((e) => {
  console.log("FAIL  " + (e && e.stack ? e.stack : e));
  process.exit(1);
});
