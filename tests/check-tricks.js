#!/usr/bin/env node
/*
 * tests/check-tricks.js — card #243: the Hardware tricks page and its toys.
 *
 * What it asserts:
 *
 *   1. renderer/trick-toys.js is what tools/trick-toys.js writes (the same
 *      --check the gallery has), and every toy it carries is a real file in
 *      toys/ whose source is byte-equal to the module's.
 *   2. renderer/tricks.html carries the six sections and five studio buttons
 *      (a sixth, shadow/highlight, deliberately has no toy), the Toys link is
 *      the current page, and every other site ribbon links it.
 *   3. Every claim is labelled and backed: each .claim carries a data-source
 *      of manual:<pages>, measured:<test or finding> or unchecked:<source>;
 *      manual claims name an H6/H7/H8 page, measured claims say measured, and
 *      unchecked claims carry the words "reported, unchecked".  The chat
 *      phrases (Skweek, fade_to_*, Toy Story, Ecco) are inside unchecked
 *      claims and nowhere else.
 *   4. The studio page wires the toys: it loads trick-toys.js, findExample()
 *      searches the trick list, ?demo=trick-… reaches it, and the toolbar and
 *      the Docs panel link tricks.html.
 *   5. A REAL PAGE BOOT (the same stub DOM check-studio.js uses): for each of
 *      the five ids, studio.html?demo=<id> installs that toy's source, paints
 *      frame 0 with no #error, and the page's own runFrames() runs 30 frames
 *      in Lua and 30 in IL with the states equal at the end.
 *   6. Both runtimes and the validator on the toys themselves: each runs 61
 *      frames in Lua and in IL with the same VRAM/CRAM/SAT/registers/raster
 *      on every frame (pixels equal at frames 0 and 60), and
 *      validate.validateProgram() accepts each with no error.
 *   7. The measurements the page prints are these numbers, not prose that
 *      drifted: the raster bar's 224 entries and $056/$123/$1FB words, the
 *      palette cycle's 0-byte VRAM/SAT change and 12 changed entries, the
 *      parallax's four BXR values and four marker positions, the fade's two
 *      word sequences, and the sprite budget's 16 strips on lines 48 and 144.
 *   8. The sprite rule's controls: 17 flat sprites on a line and 9 CGX
 *      sprites (18 strips) are both refused with validate-sprite-line, while
 *      16 flat and 8 CGX are accepted.  That is the boundary the page states.
 *
 * What is NOT proven here: this is the page's code path in a stub DOM, not a
 * real browser (a browser run is check-studio's --browser, which needs
 * chrome-headless-shell, #114).  It does not draw pixels into a canvas.
 *
 * Written by @design because the card names the page.  Rule 2: a cold break by
 * another seat is owed before the card closes.
 *
 *   node tests/check-tricks.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const os = require("os");
const child = require("child_process");

const toys = require("../renderer/pce-toys.js");
const il = require("../renderer/pce-il.js");
const validate = require("../renderer/pce-validate.js");
const sprites = require("../renderer/pce-sprites.js");

const ROOT = path.join(__dirname, "..");
const RENDERER = path.join(ROOT, "renderer");
const PAGE = path.join(RENDERER, "tricks.html");
const STUDIO = path.join(RENDERER, "studio.html");
const MODULE = path.join(RENDERER, "trick-toys.js");
const TOYS_DIR = path.join(ROOT, "toys");

let checks = 0;
const failures = [];

function check(ok, name) {
  checks++;
  if (!ok) { failures.push(name); console.log("FAIL  " + name); }
  else console.log("PASS  " + name);
}
function eq(name, got, want) {
  check(JSON.stringify(got) === JSON.stringify(want),
        name + " (got " + JSON.stringify(got) + ", want " +
        JSON.stringify(want) + ")");
}
function diffCount(a, b) {
  let n = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) n++;
  return n + Math.abs(a.length - b.length);
}

/* ---- 1. the generated module ------------------------------------------- */

const gen = child.spawnSync(process.execPath,
  [path.join(ROOT, "tools", "trick-toys.js"), "--check"],
  { encoding: "utf8" });
eq("tools/trick-toys.js --check exits 0", gen.status, 0);

const TRICKS = require(MODULE);
check(TRICKS && Array.isArray(TRICKS.toys),
      "renderer/trick-toys.js carries a toys array");
eq("the module carries five toys", TRICKS.toys.map((t) => t.id).sort(),
   ["trick-fade", "trick-palette", "trick-parallax", "trick-raster",
    "trick-sprites"]);
for (const t of TRICKS.toys) {
  const file = path.join(TOYS_DIR, t.file);
  check(fs.existsSync(file), t.id + ": toys/" + t.file + " exists");
  eq(t.id + ": the module's source is the file's bytes",
     t.source, fs.readFileSync(file, "utf8"));
  check(/\.lua$/.test(t.name), t.id + ": the studio file name ends .lua");
}

/* ---- 2. the page and the ribbons --------------------------------------- */

const page = fs.readFileSync(PAGE, "utf8");
check(/<title>PCEStudio Hardware tricks<\/title>/.test(page),
      "tricks.html has its own title");
check(/class="site-nav"/.test(page) && /href="tricks.html" class="is-on" aria-current="page"/.test(page),
      "tricks.html carries the site ribbon and marks Tricks current");

const SITE_PAGES = ["browse", "claude-code", "credits", "release-notes",
                    "resources", "roadmap", "testers", "toy"];
for (const name of SITE_PAGES) {
  const text = fs.readFileSync(path.join(RENDERER, name + ".html"), "utf8");
  check(/<a href="tricks.html">Tricks<\/a>/.test(text),
        "renderer/" + name + ".html's ribbon links tricks.html");
}

const SECTIONS = ["raster", "palette", "parallax", "fades", "sprites",
                  "shadow"];
for (const id of SECTIONS) {
  check(new RegExp('id="' + id + '"').test(page),
        "tricks.html has the #" + id + " section");
}

const BUTTONS = [...page.matchAll(/href="studio\.html\?demo=([^"]+)"/g)]
  .map((m) => m[1]);
eq("five studio buttons, one per toy", BUTTONS.sort(),
   ["trick-fade", "trick-palette", "trick-parallax", "trick-raster",
    "trick-sprites"]);
for (const id of BUTTONS) {
  check(TRICKS.toys.some((t) => t.id === id),
        "the button " + id + " names a toy in the module");
}
const shadowStart = page.indexOf('id="shadow"');
check(shadowStart > 0 && page.indexOf("studio.html?demo=", shadowStart) < 0,
      "the shadow/highlight section deliberately has no toy button");
check(/not modelled yet/.test(page.slice(shadowStart)),
      "the shadow/highlight section is labelled not modelled yet");

/* ---- 3. every claim is labelled and backed ----------------------------- */

const claims = [];
const reClaim = /<(li|div) class="claim"([^>]*)>([\s\S]*?)<\/\1>/g;
let m;
while ((m = reClaim.exec(page))) {
  const attrs = m[2];
  const source = (attrs.match(/data-source="([^"]+)"/) || [])[1] || "";
  claims.push({ source: source, text: m[3].replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ").trim() });
}
check(claims.length >= 15, "the page has at least 15 labelled claims (got " +
      claims.length + ")");
for (const c of claims.slice()) {
  const kind = c.source.split(":")[0];
  check(["manual", "measured", "unchecked"].indexOf(kind) >= 0,
        "claim source \"" + c.source + "\" is manual/measured/unchecked");
  if (kind === "manual") {
    check(/H[6-8]-\d+/.test(c.text),
          "manual claim names a datasheet page: " + c.text.slice(0, 50));
    /* The manuals' last pages (docs/MANUALS.md §2-§8): a citation past the
     * end of the chapter is a typo, not a page. */
    const MAX_PAGE = { 6: 6, 7: 25, 8: 24 };
    for (const pageNo of c.text.matchAll(/H([6-8])-(\d+)/g)) {
      const chip = Number(pageNo[1]), n = Number(pageNo[2]);
      check(n >= 1 && n <= MAX_PAGE[chip],
            "manual claim cites an existing page H" + chip + "-" + n);
    }
  } else if (kind === "measured") {
    check(/measured/i.test(c.text) &&
          /(tests\/check-tricks\.js|docs\/SHADOW-HIGHLIGHT\.md)/.test(c.text),
          "measured claim says measured and names its measurement: " +
          c.text.slice(0, 50));
  } else if (kind === "unchecked") {
    check(/reported, unchecked/i.test(c.text),
          "unchecked claim carries the label: " + c.text.slice(0, 50));
  }
}
check(claims.some((c) => c.source.indexOf("unchecked:") === 0),
      "the page has at least one reported, unchecked claim");

for (const phrase of ["Skweek", "fade_to_*", "Toy Story", "Ecco"]) {
  const found = claims.filter((c) => c.text.indexOf(phrase) >= 0);
  check(found.length > 0, "the page says " + phrase);
  check(found.every((c) => c.source.indexOf("unchecked:") === 0),
        "every claim naming " + phrase + " is labelled reported, unchecked");
}

/* Every citation the page prints is also a citation the test checks. */
for (const needed of ["H6-1", "H6-3", "H6-4", "H6-5", "H7-4", "H7-7",
                      "H7-9", "H7-13", "H7-19", "H7-20", "REFERENCES.md §7",
                      "SHADOW-HIGHLIGHT.md"]) {
  check(page.indexOf(needed) >= 0, "the page cites " + needed);
}

/* ---- 4. the studio is wired -------------------------------------------- */

const studio = fs.readFileSync(STUDIO, "utf8");
check(studio.indexOf('<script src="trick-toys.js"></script>') >= 0,
      "studio.html loads renderer/trick-toys.js");
check(/PCEStudio\.trickData/.test(studio),
      "studio.html reads PCEStudio.trickData");
check(/TRICKS\.find\(/.test(studio) && /findExample/.test(studio),
      "findExample() searches TRICKS");
check(/id="btn-tricks" href="tricks.html"/.test(studio),
      "the studio toolbar links tricks.html");
check(/id="docs-tricks" href="tricks.html"/.test(studio),
      "the Docs panel links tricks.html");

/* ---- the stub DOM, the way check-studio.js boots the page -------------- */

function stubClassList() {
  const set = new Set();
  return {
    add(...n) { for (const x of n) set.add(x); },
    remove(...n) { for (const x of n) set.delete(x); },
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
      if (key === "createImageData" || key === "getImageData")
        return (w, h) => ({ width: w, height: h,
          data: new Uint8ClampedArray(w * h * 4) });
      if (key === "measureText") return () => ({ width: 0 });
      if (key === "canvas") return null;
      return () => {};
    },
    set() { return true; }
  });
}

function makeStorage() {
  const map = new Map();
  return {
    getItem(k) { return map.has(String(k)) ? map.get(String(k)) : null; },
    setItem(k, v) { map.set(String(k), String(v)); },
    removeItem(k) { map.delete(String(k)); },
    clear() { map.clear(); },
    key(i) { return Array.from(map.keys())[i] || null; },
    get length() { return map.size; }
  };
}

function makeStubDom() {
  const all = [];
  const byId = new Map();
  function fakeEvent(target) {
    return { type: "click", target: target, currentTarget: target,
             preventDefault() {}, stopPropagation() {},
             clientX: 1, clientY: 1, key: "", code: "",
             ctrlKey: false, metaKey: false, shiftKey: false, altKey: false };
  }
  function element(tag, id) {
    const el = {
      tagName: String(tag || "div").toUpperCase(), id: id || "",
      children: [], listeners: {}, style: {}, dataset: {}, attributes: {},
      className: "", title: "", textContent: "", value: "", checked: false,
      disabled: false, hidden: false, width: 256, height: 224,
      scrollTop: 0, scrollHeight: 0, selectionStart: 0, selectionEnd: 0,
      files: null, classList: stubClassList(), parentNode: null,
      addEventListener(type, fn) {
        (this.listeners[type] = this.listeners[type] || []).push(fn);
      },
      removeEventListener(type, fn) {
        const l = this.listeners[type];
        if (!l) return;
        const i = l.indexOf(fn);
        if (i >= 0) l.splice(i, 1);
      },
      appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
      insertBefore(child) { return this.appendChild(child); },
      removeChild(child) {
        const i = this.children.indexOf(child);
        if (i >= 0) this.children.splice(i, 1);
        child.parentNode = null;
        return child;
      },
      remove() { if (this.parentNode) this.parentNode.removeChild(this); },
      click() {
        for (const fn of (this.listeners.click || [])) fn(fakeEvent(this));
      },
      focus() {},
      setAttribute(n, v) { this.attributes[n] = String(v); },
      getAttribute(n) {
        return Object.prototype.hasOwnProperty.call(this.attributes, n)
          ? this.attributes[n] : null;
      },
      removeAttribute(n) { delete this.attributes[n]; },
      getBoundingClientRect() { return { left: 0, top: 0, width: this.width, height: this.height }; },
      getContext() { return this.__ctx || (this.__ctx = stubContext()); },
      setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; }
    };
    let elId = String(id || "");
    Object.defineProperty(el, "id", {
      get() { return elId; },
      set(value) { elId = String(value || ""); if (elId) byId.set(elId, el); }
    });
    if (elId) byId.set(elId, el);
    Object.defineProperty(el, "firstChild", {
      get() { return this.children.length ? this.children[0] : null; }
    });
    Object.defineProperty(el, "innerHTML", {
      get() { return ""; }, set(value) { if (!value) this.children.length = 0; }
    });
    all.push(el);
    return el;
  }
  const get = (id) => {
    if (!byId.has(id)) {
      const el = element("div", id);
      if (id === "out") { el.tagName = "CANVAS"; el.width = 256; el.height = 224; }
      if (id === "vrammap") { el.tagName = "CANVAS"; el.width = 384; el.height = 384; }
      byId.set(id, el);
    }
    return byId.get(id);
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
    addEventListener() {}, removeEventListener() {},
    body: element("body", "body"), activeElement: null
  };
  return { document, all, byId, get };
}

function pageParts() {
  const html = fs.readFileSync(STUDIO, "utf8");
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
  const dom = makeStubDom();
  const html = fs.readFileSync(STUDIO, "utf8");
  const reId = /<([a-zA-Z][\w-]*)\b[^>]*\bid="([^"]+)"/g;
  let im;
  while ((im = reId.exec(html))) {
    const el = dom.get(im[2]);
    el.tagName = im[1].toUpperCase();
    if (el.tagName === "CANVAS") {
      el.width = im[2] === "vrammap" ? 384 : 256;
      el.height = im[2] === "vrammap" ? 384 : 224;
    }
  }
  const raf = [];
  const sandbox = {
    console, Uint8Array, Uint8ClampedArray, Array, Math, JSON, Object, String,
    Number, parseInt, parseFloat, isNaN, Date, RegExp, Promise, Set, Map,
    HTMLDocument: function HTMLDocument() {},
    HTMLCanvasElement: function HTMLCanvasElement() {},
    location: { search: search || "" },
    requestAnimationFrame(fn) { raf.push(fn); return raf.length; },
    cancelAnimationFrame() {},
    setTimeout() { return 0; },
    clearTimeout() {},
    addEventListener() {}, removeEventListener() {},
    document: dom.document,
    URLSearchParams,
    localStorage: makeStorage(),
    FileReader: function FileReader() {},
    __now: 0
  };
  sandbox.performance = { now: () => sandbox.__now };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const src of parts.srcs) {
    vm.runInContext(fs.readFileSync(path.resolve(RENDERER, src), "utf8"),
                    sandbox, { filename: "renderer/" + src });
  }
  vm.runInContext(parts.inline, sandbox,
                  { filename: "renderer/studio.html <inline>" });
  return { sandbox, dom };
}

/* ---- 5. each toy runs in the studio page ------------------------------- */

const pageFrames = {};
for (const t of TRICKS.toys) {
  let pageBoot = null, err = null;
  try { pageBoot = runPage("?demo=" + t.id + "&paused=1"); }
  catch (e) { err = e; }
  check(!!pageBoot, t.id + ": studio.html?demo=" + t.id + " boots" +
        (err ? " (" + err.message + ")" : ""));
  if (!pageBoot) continue;
  const S = pageBoot.sandbox.PCEStudio;
  check(!!S && !!S.studio && !!S.trickData,
        t.id + ": the page exposes trickData and studio");
  const api = S.studio;
  eq(t.id + ": ?demo= installed this toy's source", api.files()[0].source,
     t.source);
  eq(t.id + ": the page painted frame 0 without an error",
     [pageBoot.dom.get("error").hidden, pageBoot.dom.get("saved").textContent],
     [true, "saved in this browser"]);
  check(!!api.state(), t.id + ": a frame's model state is readable");
  let luaFrames = null, ilFrames = null, runErr = null;
  try {
    luaFrames = api.runFrames(30, null, "lua");
    ilFrames = api.runFrames(30, null, "il");
  } catch (e) { runErr = e; }
  check(!!luaFrames && !!ilFrames, t.id + ": the page ran 30 frames in Lua " +
        "and 30 in IL" + (runErr ? " (" + runErr.message + ")" : ""));
  if (luaFrames && ilFrames) {
    eq(t.id + ": 30 Lua frames came back", luaFrames.length, 30);
    eq(t.id + ": 30 IL frames came back", ilFrames.length, 30);
    pageFrames[t.id] = { lua: luaFrames[29].state, il: ilFrames[29].state };
    const a = luaFrames[29].state, b = ilFrames[29].state;
    eq(t.id + ": the page's Lua and IL agree on VRAM at frame 29",
       diffCount(a.vram, b.vram), 0);
    eq(t.id + ": the page's Lua and IL agree on CRAM at frame 29",
       diffCount(a.cram, b.cram), 0);
    eq(t.id + ": the page's Lua and IL agree on the SAT at frame 29",
       diffCount(a.sat, b.sat), 0);
    eq(t.id + ": the page's Lua and IL agree on the registers at frame 29",
       a.regs, b.regs);
  }
}

/* ---- 6 + 7. the toys, both runtimes, and the numbers the page prints --- */

function runBoth(t) {
  const lua = toys.create(t.source, { chunkName: t.id });
  const ilr = il.create(t.source, { chunkName: t.id });
  lua.load();
  ilr.load();
  const frames = [];
  for (let f = 0; f <= 60; f++) {
    const a = lua.frame(f);
    const b = ilr.frame(f);
    frames.push(a);
    eq(t.id + " f" + f + ": Lua and IL VRAM agree", diffCount(a.state.vram, b.state.vram), 0);
    eq(t.id + " f" + f + ": Lua and IL CRAM agree", diffCount(a.state.cram, b.state.cram), 0);
    eq(t.id + " f" + f + ": Lua and IL SAT agree", diffCount(a.state.sat, b.state.sat), 0);
    eq(t.id + " f" + f + ": Lua and IL registers agree", a.state.regs, b.state.regs);
    eq(t.id + " f" + f + ": Lua and IL raster agree",
       JSON.stringify(a.raster), JSON.stringify(b.raster));
    if (f === 0 || f === 60) {
      eq(t.id + " f" + f + ": Lua and IL pixels agree",
         diffCount(a.pixels, b.pixels), 0);
    }
  }
  return frames;
}

const runs = {};
for (const t of TRICKS.toys) {
  let frames = null, err = null;
  try { frames = runBoth(t); } catch (e) { err = e; }
  check(!!frames, t.id + ": 61 frames run without an error in both runtimes" +
        (err ? " (" + (err.code || "") + ": " + err.message + ")" : ""));
  runs[t.id] = frames;
}

/* The page's frame 29 against the standalone frame 29: the same toy ran,
 * not the studio's default example wearing this toy's file name. */
for (const t of TRICKS.toys) {
  if (!pageFrames[t.id] || !runs[t.id]) continue;
  const pageState = pageFrames[t.id].lua;
  const own = runs[t.id][29].state;
  eq(t.id + ": the page ran this toy (VRAM at frame 29)",
     diffCount(pageState.vram, own.vram), 0);
  eq(t.id + ": the page ran this toy (CRAM at frame 29)",
     diffCount(pageState.cram, own.cram), 0);
  eq(t.id + ": the page ran this toy (SAT at frame 29)",
     diffCount(pageState.sat, own.sat), 0);
  eq(t.id + ": the page ran this toy (registers at frame 29)",
     pageState.regs, own.regs);
}

const reports = {};
for (const t of TRICKS.toys) {
  let rep = null, err = null;
  try {
    const program = il.compile(t.source, { chunkName: t.id });
    rep = validate.validateProgram(program, { chunkName: t.id });
  } catch (e) { err = e; }
  check(!!rep, t.id + ": the validator ran" +
        (err ? " (" + (err.code || "") + ": " + err.message + ")" : ""));
  if (rep) {
    reports[t.id] = rep;
    const errors = rep.problems.filter((p) => p.severity === "error");
    eq(t.id + ": the validator reports no error", errors.map((p) => p.code), []);
    check(rep.ok === true, t.id + ": the validator's ok is true");
  }
}

function word(cram, addr) { return cram[addr * 2] | (cram[addr * 2 + 1] << 8); }
function entriesOf(frame) {
  const out = {};
  if (frame.raster) for (const e of frame.raster.entries) out[e.line] = e;
  return out;
}
function lineWord(frame, line, addr) {
  const e = entriesOf(frame)[line];
  if (!e || !e.cram) return null;
  for (const pair of e.cram) if (pair[0] === addr) return pair[1];
  return null;
}

/* 7a — raster bar: 224 writes, the gradient's ends, the 12-line bar. */
if (runs["trick-raster"]) {
  const f = runs["trick-raster"][60];
  const at = entriesOf(f);
  eq("raster bar: 224 raster entries, one per display line",
     f.raster ? f.raster.entries.length : 0, 224);
  eq("raster bar: line 0 is $056", lineWord(f, 0, 1), 0x056);
  eq("raster bar: line 223 is $123", lineWord(f, 223, 1), 0x123);
  let bar = 0;
  for (let L = 0; L < 224; L++) if (lineWord(f, L, 1) === 0x1FB) bar++;
  eq("raster bar: the bar is 12 lines of $1FB", bar, 12);
  eq("raster bar: at frame 60 the bar is lines 152-163",
     [lineWord(f, 152, 1), lineWord(f, 163, 1), lineWord(f, 151, 1)],
     [0x1FB, 0x1FB, 0x0DC]);
  const distinct = new Set();
  for (let L = 0; L < 224; L++) distinct.add(L + ":" + lineWord(f, L, 1));
  eq("raster bar: every line carries its own word", distinct.size, 224);
  check(!!at[0] && at[0].rcr === 64, "raster bar: line 0's RCR is $40 + 0");
  const rep = reports["trick-raster"];
  if (rep) {
    eq("raster bar: frame() cycles", rep.budgets.frameCycles, 1173);
    eq("raster bar: mean raster() cycles", Math.round(rep.budgets.rasterMean), 1721);
    eq("raster bar: blank cycles on the worst line", rep.budgets.blank.cycles, 65);
    check(rep.budgets.blank.cycles <= 123,
          "raster bar: every line's writes fit the ~123-cycle blank");
  }
}

/* 7b — palette cycle: nothing but the palette changes. */
if (runs["trick-palette"]) {
  const a = runs["trick-palette"][0], b = runs["trick-palette"][1];
  eq("palette cycle: VRAM is unchanged between frames 0 and 1",
     diffCount(a.state.vram, b.state.vram), 0);
  eq("palette cycle: the SAT is unchanged between frames 0 and 1",
     diffCount(a.state.sat, b.state.sat), 0);
  let changed = 0;
  for (let e = 0; e < 512; e++)
    if (word(a.state.cram, e) !== word(b.state.cram, e)) changed++;
  eq("palette cycle: 12 CRAM entries change (six water, six fire)", changed, 12);
  eq("palette cycle: the picture changes with them",
     diffCount(a.pixels, b.pixels), 61824);
  eq("palette cycle: there is no raster table", runs["trick-palette"][60].raster, null);
  const rep = reports["trick-palette"];
  if (rep) eq("palette cycle: frame() cycles", rep.budgets.frameCycles, 5871);
}

/* 7c — parallax: four BXR writes and four marker positions in the picture. */
if (runs["trick-parallax"]) {
  const f = runs["trick-parallax"][60];
  const at = entriesOf(f);
  const bands = [0, 56, 112, 168].map((L) => at[L] ? at[L].bxr : null);
  eq("parallax: BXR at lines 0/56/112/168 is 7/30/60/120", bands,
     [7, 30, 60, 120]);
  const xs = bands.map((b) => (43 - b + 4096) % 256);
  eq("parallax: the four markers stand at 36/13/239/179", xs,
     [36, 13, 239, 179]);
  function rgbAt(img, x, y) {
    const i = (y * img.width + x) * 3;
    return [img.pixels[i], img.pixels[i + 1], img.pixels[i + 2]];
  }
  function cramRgb(cram, addr) {
    const v = word(cram, addr);
    return [36 * ((v >> 3) & 7), 36 * ((v >> 6) & 7), 36 * (v & 7)];
  }
  for (let band = 0; band < 4; band++) {
    const marker = cramRgb(f.state.cram, band * 16 + 3);
    let found = -1;
    for (let x = 0; x < f.width; x++) {
      const p = rgbAt(f, x, band * 56 + 28);
      if (p[0] === marker[0] && p[1] === marker[1] && p[2] === marker[2]) {
        found = x; break;
      }
    }
    eq("parallax: band " + band + "'s marker is at x " + xs[band] +
       " in the picture", found, xs[band]);
  }
  check(new Set(xs).size === 4, "parallax: the four markers are at four different x");
  const rep = reports["trick-parallax"];
  if (rep) {
    eq("parallax: frame() cycles", rep.budgets.frameCycles, 1203);
    eq("parallax: mean raster() cycles", Math.round(rep.budgets.rasterMean), 1399);
    eq("parallax: blank cycles on the worst line", rep.budgets.blank.cycles, 64);
  }
}

/* 7d — fades: the exact intermediate words the page prints. */
if (runs["trick-fade"]) {
  const FADE7 = [0x1FF, 0x1B6, 0x16D, 0x124, 0x0DB, 0x092, 0x049, 0x000];
  const HALF_WHITE = [0x1FF, 0x1B6, 0x1B6, 0x16D, 0x16D, 0x124, 0x124,
                      0x0DB, 0x0DB, 0x092, 0x092, 0x049, 0x049, 0x000, 0x000];
  const HALF_RED_BLUE = [0x038, 0x030, 0x031, 0x029, 0x02A, 0x022, 0x023,
                         0x01B, 0x01C, 0x014, 0x015, 0x00D, 0x00E, 0x006,
                         0x007];
  const top = [], bottom = [];
  for (let f = 0; f < 15; f++) {
    top.push(word(runs["trick-fade"][f].state.cram, 1));
    bottom.push(word(runs["trick-fade"][f].state.cram, 17));
  }
  eq("fade: the 7-step white->black words", top.slice(0, 8), FADE7);
  eq("fade: the toy holds black after step 7", top.slice(8), [0, 0, 0, 0, 0, 0, 0]);
  eq("fade: the 14-half-step red->blue words", bottom, HALF_RED_BLUE);
  /* The half-step white sequence is not a second toy: it is the same
   * arithmetic at 14 steps, so compute it here and pin the holds. */
  const half = [];
  for (let k = 0; k <= 14; k++) {
    const c = Math.floor((7 * 14 + (0 - 7) * k) / 14);
    half.push(c * 64 + c * 8 + c);
  }
  eq("fade: 14 half-steps from white repeat levels (the holds)", half,
     HALF_WHITE);
  check(HALF_WHITE[2] === HALF_WHITE[1] && HALF_WHITE[4] === HALF_WHITE[3],
        "fade: a half-step can be the previous word (a visible hold)");
  check(HALF_RED_BLUE[1] !== HALF_RED_BLUE[0] &&
        HALF_RED_BLUE[2] !== HALF_RED_BLUE[1],
        "fade: a crossfade between different colours does make new words");
  /* The page's table is the measurement too: a typo in a cell is a false
   * claim, so parse the table and hold every cell to the arrays above. */
  const tableMatch = page.match(/<table class="words">([\s\S]*?)<\/table>/);
  check(!!tableMatch, "fade: the page prints the word table");
  if (tableMatch) {
    const rows = [...tableMatch[1].matchAll(
      /<tr><td>(\d+)<\/td><td[^>]*>([^<]*)<\/td><td[^>]*>([^<]*)<\/td><td[^>]*>([^<]*)<\/td><\/tr>/g)];
    eq("fade: the word table has one row per step 0..14", rows.length, 15);
    for (const row of rows) {
      const k = Number(row[1]);
      const cell = (s) => {
        const m = s.match(/\$([0-9A-F]{3})/);
        return m ? parseInt(m[1], 16) : null;
      };
      eq("fade: the page's step " + k + " row",
         [cell(row[2]), cell(row[3]), cell(row[4])],
         [k <= 7 ? FADE7[k] : null, HALF_WHITE[k], HALF_RED_BLUE[k]]);
    }
  }
  const rep = reports["trick-fade"];
  if (rep) eq("fade: frame() cycles", rep.budgets.frameCycles, 4809);
}

/* 7e — sprites: 16 strips on two rows, the second from 8 CGX sprites. */
if (runs["trick-sprites"]) {
  const st = runs["trick-sprites"][60].state;
  const status = sprites.status({
    vram: st.vram, cram: st.cram, sat: st.sat,
    regs: { BXR: st.regs.BXR, BYR: st.regs.BYR, CR: st.regs.CR,
            RCRCount: 0, scanline: 18 },
    width: 256, height: 224
  });
  const byLine = {};
  for (const ln of status.lines) byLine[ln.line] = ln;
  eq("sprites: line 48 is 16 sprites / 16 strips / 0 dropped",
     [byLine[48].sprites, byLine[48].strips, byLine[48].requested,
      byLine[48].dropped], [16, 16, 16, 0]);
  eq("sprites: line 144 is 8 sprites / 16 strips / 0 dropped (CGX costs two)",
     [byLine[144].sprites, byLine[144].strips, byLine[144].requested,
      byLine[144].dropped], [8, 16, 16, 0]);
  eq("sprites: the frame sets neither OR nor CC",
     [status.frame.OR, status.frame.CC], [false, false]);
  const rep = reports["trick-sprites"];
  if (rep) {
    eq("sprites: the validator's worst line", rep.budgets.sprites.line, 48);
    eq("sprites: the validator's worst strips", rep.budgets.sprites.strips, 16);
    eq("sprites: the validator's worst request", rep.budgets.sprites.requested, 16);
    eq("sprites: the validator dropped nothing", rep.budgets.sprites.dropped, 0);
    eq("sprites: frame() cycles", rep.budgets.frameCycles, 12885);
  }
}

/* 8. the controls: the 17th strip is refused, as the page says. */
function checkFixture(name, count, cgx, wantOk, wantRequested) {
  const lines = ["function init()", "  reg(\"CR\", 0xC0)"];
  for (let i = 0; i < count; i++) {
    lines.push("  sprite(" + i + ", {x = " + (32 + i * 16) +
               ", y = 112, pattern = " + (0x100 + i) +
               (cgx ? ", cgx = true" : "") + ", palette = 0})");
  }
  lines.push("end");
  let rep = null, err = null;
  try {
    rep = validate.validateProgram(
      il.compile(lines.join("\n"), { chunkName: name }), { chunkName: name });
  } catch (e) { err = e; }
  check(!!rep, name + ": the validator ran" +
        (err ? " (" + (err.code || "") + ": " + err.message + ")" : ""));
  if (!rep) return;
  eq(name + ": ok is " + wantOk, rep.ok, wantOk);
  eq(name + ": strips requested on the line", rep.budgets.sprites.requested,
     wantRequested);
  if (!wantOk) {
    check(rep.problems.some((p) => p.severity === "error" &&
                                   p.code === "validate-sprite-line"),
          name + ": refused with validate-sprite-line");
  }
}
checkFixture("16 flat sprites", 16, false, true, 16);
checkFixture("8 CGX sprites", 8, true, true, 16);
checkFixture("17 flat sprites", 17, false, false, 17);
checkFixture("9 CGX sprites", 9, true, false, 18);

/* ---- the page prints the numbers this run measured --------------------- */

const printed = [
  "224 entries", "one palette write per display line", "$056", "$123",
  "$1FB", "1,173", "1,721", "65", "61,824", "12 palette entries",
  "36, 13, 239 and 179", "7, 30, 60 and 120", "1,203", "1,399",
  "$1B6", "$16D", "$124", "$0DB", "$092", "$049", "4,809",
  "16 sprites, 16 strips, 0 dropped", "8 sprites, 16 strips, 0 dropped",
  "validate-sprite-line"
];
for (const text of printed) {
  check(page.indexOf(text) >= 0, "the page prints the measured value \"" +
        text + "\"");
}

/* ---- verdict ----------------------------------------------------------- */

console.log("");
if (failures.length) {
  console.log("FAIL  " + failures.length + " of " + checks + " checks");
  process.exit(1);
}
console.log("PASS  " + checks + " checks — the six tricks, five toys that run " +
            "in the studio page and both runtimes, the validator's budgets " +
            "and the 17th-strip refusals");
