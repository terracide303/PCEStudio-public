#!/usr/bin/env node
/*
 * tests/check-pokes.js — the evidence for #79, "Studio parity with ppu.toys,
 * part 3: panel pokes — keyframed register overrides from the panels with
 * undo/redo, written back into the toy".
 *
 * NOTE: written by @design because the card names this file's subject; under
 * the workshop role split a test written by the builder is flagged for
 * @review to read cold (same arrangement as check.js, check-editor.js,
 * check-toys.js and check-studio.js).
 *
 * Why a suite of its own rather than a block in tests/check-studio.js: that
 * file was under another seat's hands (the #107 Paste & Run card) for the
 * whole of this session, and a shared working tree must not commit another
 * seat's half-finished hunks.  This suite loads the same page the same way —
 * studio.html in a stub DOM — and drives it through the same studio API, so
 * none of the evidence is second-hand.  The stub DOM below is copied from
 * check-studio.js (with its comments); a shared tests/stub-dom.js is the
 * eventual home for the copy.
 *
 * What it measures:
 *  1. The model (renderer/pce-pokes.js) on its own: a poke holds from its
 *     frame on; setting the same frame again replaces the value (and undo
 *     puts the old one back); remove/clear/undo/redo; a bad register name is
 *     refused by code; the Lua it generates carries only the registers a toy
 *     may set, masks each value to the host's own width, refuses the rest by
 *     the host's code (reg-forbidden), and a second write replaces the first
 *     block instead of stacking one.
 *  2. The page: every studio API member #79 adds is there, and the REGISTERS
 *     panel is registered and draws its table.
 *  3. The table is the console's own: every live VDC register from
 *     renderer/pce-panels.js's VDC_REGISTERS (R03/R04 are addresses with no
 *     register), the ten PSG registers from renderer/pce-psg.js's REGISTERS,
 *     the VCE's three write registers, the timer's two and the IRQ pair —
 *     with the same addresses and names, and DCR's fields held to
 *     renderer/pce-vram.js's decodeDcr bit for bit.
 *  4. A poke through HEX, through DECIMAL and through a BIT each change the
 *     drawn frame exactly as renderer/pce-sprites.js's renderFrame with that
 *     register says (diff 0 against the renderer's own output, and non-zero
 *     against the frame before) — for BXR, for BYR and for CR's BB bit.
 *  5. Undo restores the frame byte for byte; redo re-applies it; the poke
 *     survives a seek back and forward (a keyframe is a frame rule, not a
 *     one-shot).
 *  6. Keyframes: two keys on one register at different frames are a curve —
 *     the value in force at each frame is the last key at or before it, the
 *     rendered frame equals the renderer's with that value, the curve box
 *     lists both, a key can be removed and undone.
 *  7. Search, the group filter, the Poked-only toggle and the "N / total"
 *     count filter the table; a hidden row is not shown.
 *  8. The write-back: "Write to toy" puts the curves into main.lua as one
 *     generated block, empties the poke list (baked), and the toy's OWN run
 *     then reproduces the frames the poke previewed — diff 0 at every frame,
 *     on a toy that writes BXR itself every frame (so the block must run
 *     after the toy's frame, every frame, not only when the value changes).
 *     A register a toy may not set (MWR) is reported with reg-forbidden and
 *     never appears in the generated Lua.
 *
 * Not measured here (and said so on the card): a real browser's DOM and CSS
 * (the screenshot is separate, $TMPDIR, described in docs/STUDIO.md);
 * ppu.toys' own page (their panel is described from the @workshop note of
 * 2026-10-29 on #79, not re-fetched); rule 2's cold break by another seat.
 *
 *   node tests/check-pokes.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const RENDERER = path.join(__dirname, "..", "renderer");
const PAGE = path.join(RENDERER, "studio.html");

const pokesModel = require(path.join(RENDERER, "pce-pokes.js"));
const panelsModel = require(path.join(RENDERER, "pce-panels.js"));
const psgModel = require(path.join(RENDERER, "pce-psg.js"));
const vramModel = require(path.join(RENDERER, "pce-vram.js"));
const toyhost = require(path.join(RENDERER, "pce-toyhost.js"));
const sprites = require(path.join(RENDERER, "pce-sprites.js"));

let checks = 0;
const failures = [];

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

function eq(name, got, want) {
  check(JSON.stringify(got) === JSON.stringify(want),
        name + " (got " + JSON.stringify(got) + ", want " +
        JSON.stringify(want) + ")");
}

/* ---- the stub DOM (copied from tests/check-studio.js) ------------------ */

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
      getContext() { return this.__ctx || (this.__ctx = stubContext()); },
      setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; }
    };
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
      if (id === "vrammap") { el.width = 512; el.height = 44; }
      byId.set(id, el);
    }
    return byId.get(id);
  };

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

function runPage(search, storage, extra) {
  const parts = pageParts();
  if (!parts.inline) throw new Error("studio.html has no inline script");
  const dom = makeStubDom();
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

/* ---- 1. the model on its own ------------------------------------------ */

function checkModel() {
  const m = pokesModel.create();
  m.poke("BXR", 16, 0);
  m.poke("BXR", 48, 30);
  eq("#79 model: a poke holds from its frame on",
     [m.valueAt("BXR", 0), m.valueAt("BXR", 29), m.valueAt("BXR", 30)],
     [16, 16, 48]);
  check(m.valueAt("BYR", 0) === null,
        "#79 model: a register with no key is not in force");

  /* setting the same register and frame again replaces the value, and undo
   * is a real undo (the old value, not two keys on one frame) */
  m.poke("BXR", 20, 30);
  eq("#79 model: a second set on one frame replaces it", m.curve("BXR"),
     [{ reg: "BXR", value: 16, frame: 0 }, { reg: "BXR", value: 20, frame: 30 }]);
  m.undo();
  eq("#79 model: undo puts the old value back", m.curve("BXR")[1].value, 48);
  m.redo();
  eq("#79 model: redo sets it again", m.curve("BXR")[1].value, 20);

  /* removal and its undo keep the curve's order */
  const removed = m.remove("BXR", 0);
  check(removed && m.curve("BXR").length === 1,
        "#79 model: remove takes one key");
  m.undo();
  eq("#79 model: undo re-inserts the key", m.curve("BXR")[0].frame, 0);

  /* clear and its undo */
  const before = m.all().length;
  m.clear();
  check(m.all().length === 0, "#79 model: clear empties the list");
  m.undo();
  check(m.all().length === before, "#79 model: undo restores the whole list");

  /* a bad name is refused by code, not silently kept */
  let code = null;
  try { m.poke("not a register", 1, 0); } catch (e) { code = e.code; }
  eq("#79 model: a register name is required", code, "poke-reg");

  /* the write-back's Lua */
  m.poke("MWR", 0x50, 5);
  const out = m.lua(m.all());
  check(out.written.indexOf("BXR") >= 0 && out.written.indexOf("MWR") < 0,
        "#79 model: only the toy's registers are written (" +
        JSON.stringify(out.written) + ")");
  eq("#79 model: the rest are refused by the host's own code", out.refused,
     [{ reg: "MWR", code: "reg-forbidden" }]);
  check(out.lua.indexOf("MWR") < 0 && out.lua.indexOf("BXR") >= 0,
        "#79 model: the refused register is not in the Lua");
  check(out.lua.indexOf(pokesModel.OPEN) === 0 &&
        out.lua.indexOf(pokesModel.CLOSE) > 0,
        "#79 model: the block carries its markers");

  /* the value is masked to the host's width (BXR is 10 bits) */
  const wide = pokesModel.create();
  wide.poke("BXR", 0x7FF, 0);
  check(wide.lua(wide.all()).lua.indexOf("v = 1023") > 0,
        "#79 model: a value is masked to the toy's own register width");
  const over = pokesModel.create();
  over.poke("BYR", 0x3FF, 0);
  check(over.lua(over.all()).lua.indexOf("v = 511") > 0,
        "#79 model: BYR is masked to its 9 bits");

  /* a second write replaces the block instead of stacking one */
  const base = "function frame(t, f)\n  reg(\"BXR\", 0)\nend\n";
  const first = m.writeBack(base, m.all());
  const second = m.writeBack(first.source, m.all());
  eq("#79 model: the block is replaced, not stacked",
     (second.source.match(/-- >>> PCEStudio pokes/g) || []).length, 1);
  check(second.source.indexOf("function frame(t, f)") >= 0,
        "#79 model: the toy's own source is kept");
}

/* ---- 2. the page's API and the panel ---------------------------------- */

function checkPageApi(page) {
  const studio = page.sandbox.PCEStudio.studio;
  check(page.loaded.some((s) => /pce-pokes\.js$/.test(s)),
        "#79: the page loads renderer/pce-pokes.js");
  for (const name of ["poke", "pokes", "keyframes", "pokedRegs", "removePoke",
                      "clearPokes", "writePokes", "undo", "redo", "canUndo",
                      "canRedo"]) {
    check(typeof studio[name] === "function",
          "#79: studio." + name + " is on the studio API");
  }
  const def = studio.panels.get("registers");
  check(!!def && typeof def.api === "object" && typeof def.draw === "function",
        "#79: the REGISTERS panel is registered with an api");
  studio.loadExample("palette", true);
  studio.pause();
  studio.seek(0);
  studio.panels.select("registers");
  const api = def.api;
  check(api.dom(), "#79: the panel built its table when selected");
  check(page.dom.get("panel-registers").hidden === false,
        "#79: the panel is the visible one");
}

/* ---- 3. the table is the console's own -------------------------------- */

function checkCatalogue(page) {
  const studio = page.sandbox.PCEStudio.studio;
  studio.panels.select("registers");
  const api = studio.panels.get("registers").api;
  const rows = api.rows();
  const byKey = {};
  for (const r of rows) byKey[r.reg] = r;

  /* every live VDC register, same number and name as pce-panels.js */
  let vdc = 0;
  for (const def of panelsModel.VDC_REGISTERS) {
    if (def.name === "-") continue;
    const reg = def.name === "VWR/VRR" ? "VWR" : def.name;
    const row = byKey[reg];
    check(!!row && row.name === def.name &&
          row.addr === "$" + def.number.toString(16).toUpperCase().padStart(4, "0"),
          "#79 table: VDC " + def.name + " is row R" +
          def.number.toString(16).toUpperCase().padStart(2, "0") +
          (row ? " (got " + row.addr + ")" : " (missing)"));
    if (row) vdc++;
  }
  check(vdc === 18, "#79 table: the 18 VDC registers a picture has (" + vdc + ")");

  /* the ten PSG registers, by pce-psg.js's own names */
  for (const def of psgModel.REGISTERS) {
    const n = def.n < 10 ? "0" + def.n : String(def.n);
    const row = byKey["PSG" + n];
    check(!!row && row.name === def.name &&
          row.addr === "$" + (0x0800 + def.n).toString(16).toUpperCase()
            .padStart(4, "0"),
          "#79 table: PSG $" + (0x0800 + def.n).toString(16).toUpperCase() +
          " is '" + def.name + "'");
  }

  /* the VCE, timer and IRQ registers */
  for (const addr of ["VCECR", "VCE_CTA", "VCE_CTW"]) {
    check(!!byKey[addr], "#79 table: " + addr + " is a row");
  }
  check(byKey.VCECR && byKey.VCECR.addr === "$0400",
        "#79 table: VCECR is the VCE's $0400");
  check(byKey.VCE_CTA && byKey.VCE_CTA.addr === "$0402" &&
        byKey.VCE_CTW && byKey.VCE_CTW.addr === "$0404",
        "#79 table: CTA is $0402 and CTW is $0404");
  check(byKey.TIMER_RELOAD && byKey.TIMER_RELOAD.addr === "$0C00" &&
        byKey.TIMER_CTRL && byKey.TIMER_CTRL.addr === "$0C01",
        "#79 table: the timer is $0C00/$0C01");
  check(byKey.IRQ_DISABLE && byKey.IRQ_DISABLE.addr === "$1402" &&
        byKey.IRQ_REQUEST && byKey.IRQ_REQUEST.addr === "$1403",
        "#79 table: the IRQ registers are $1402/$1403");

  /* DCR's fields are pce-vram.js's decodeDcr, bit for bit */
  const dcr = vramModel.decodeDcr(0x1F);
  eq("#79 table: DCR decodes all five bits",
     Object.keys(dcr).sort(), ["diDec", "dsc", "dsr", "dvc", "siDec"]);
  const dcrFields = (api.rows().find((r) => r.reg === "DCR") || {}).fields;
  eq("#79 table: DCR has the five fields decodeDcr names", dcrFields, 5);

  /* the Lua names on the fields are the toy host's own allowed set */
  const allowed = Object.keys(toyhost.ALLOWED_REGS).sort();
  const luaNames = {};
  for (const r of rows) for (const l of r.lua) luaNames[l] = true;
  eq("#79 table: the fields' Lua names are the toy's registers",
     Object.keys(luaNames).sort(), allowed);
}

/* ---- 4. poking through hex, decimal and a bit -------------------------- */

function rendererFrame(runtime, patch) {
  const opts = runtime.options();
  opts.regs = Object.assign({}, opts.regs, patch || {});
  return sprites.renderFrame(opts).pixels;
}

function checkPokes(page) {
  const studio = page.sandbox.PCEStudio.studio;
  const api = studio.panels.get("registers").api;
  studio.loadExample("palette", true);
  studio.pause();
  studio.seek(30);
  studio.clearPokes();
  const before = studio.output().pixels.slice();
  const rt = studio.render.runtime();
  const frameNow = studio.render.currentFrame();

  /* HEX: BXR = $B.  $40 would be eight whole cells of the palette toy's
   * repeating BAT — the same picture shifted by a whole tile — so the check
   * uses a scroll that is visibly not a multiple of 8. */
  check(api.setHex("VDC07", "B"),
        "#79: a value typed into HEX is taken");
  const afterHex = studio.output().pixels;
  check(studio.pokes().length === 1 &&
        studio.pokes()[0].reg === "BXR" && studio.pokes()[0].value === 0x0B &&
        studio.pokes()[0].frame === frameNow,
        "#79: HEX pokes BXR $40 at the current frame (" +
        JSON.stringify(studio.pokes()) + ")");
  sameBytes("#79: the hex poke's frame is the renderer's with BXR $B",
            afterHex, rendererFrame(rt, { BXR: 0x0B }));
  check(diffCount(before, afterHex).n > 0,
        "#79: and it is not the toy's own frame (" +
        diffCount(before, afterHex).n + " bytes)");
  studio.clearPokes();
  sameBytes("#79: clearing restores the toy's frame",
            studio.output().pixels, before);

  /* DECIMAL: BYR = 9 */
  check(api.setDec("VDC08", "9"), "#79: a value typed into DECIMAL is taken");
  check(studio.pokes().length === 1 && studio.pokes()[0].reg === "BYR" &&
        studio.pokes()[0].value === 9,
        "#79: DECIMAL pokes BYR 9");
  sameBytes("#79: the decimal poke's frame is the renderer's with BYR 9",
            studio.output().pixels, rendererFrame(rt, { BYR: 9 }));
  studio.clearPokes();

  /* a BIT: CR's bit 7 is BB, the background on/off */
  const naturalCR = studio.render.runtime().options().regs.CR;
  const bit7 = (naturalCR >> 7) & 1;
  api.bit("VDC05", 7);
  const poked = studio.pokes();
  check(poked.length === 1 && poked[0].reg === "CR" &&
        poked[0].value === ((naturalCR ^ 0x80) & 0xFF),
        "#79: clicking bit 7 of CR toggles BB (" + JSON.stringify(poked) + ")");
  sameBytes("#79: the bit poke's frame is the renderer's with BB " +
            (bit7 ? "off" : "on"),
            studio.output().pixels,
            rendererFrame(rt, { CR: (naturalCR ^ 0x80) & 0xFF }));

  /* undo / redo over the drawn frame */
  const pokedFrame = studio.output().pixels.slice();
  studio.undo();
  sameBytes("#79: undo restores the toy's frame", studio.output().pixels, before);
  check(studio.pokes().length === 0 && studio.canRedo(),
        "#79: undo emptied the list and armed redo");
  studio.redo();
  sameBytes("#79: redo draws the poked frame again",
            studio.output().pixels, pokedFrame);
  studio.clearPokes();

  /* a keyframe is a frame rule: it survives a seek back and forward */
  studio.clearPokes();
  studio.poke("BXR", 0x0B, 5);
  studio.seek(2);
  sameBytes("#79: before the key's frame the toy's own picture is drawn",
            studio.output().pixels,
            rendererFrame(studio.render.runtime(), {}));
  studio.seek(31);
  sameBytes("#79: after it, the key's value is the renderer's",
            studio.output().pixels, rendererFrame(studio.render.runtime(),
                                                  { BXR: 0x0B }));
  studio.clearPokes();
}

/* ---- 5. keyframes, the curve box, and the filters ---------------------- */

function checkCurves(page) {
  const studio = page.sandbox.PCEStudio.studio;
  const def = studio.panels.get("registers");
  const api = def.api;
  studio.loadExample("palette", true);
  studio.pause();
  studio.clearPokes();

  studio.seek(10);
  api.setHex("VDC07", "B");
  studio.seek(20);
  api.setHex("VDC07", "15");
  const keys = studio.keyframes("BXR");
  eq("#79 curve: two pokes on one register are a curve in frame order",
     keys, [{ reg: "BXR", value: 0x0B, frame: 10 },
            { reg: "BXR", value: 0x15, frame: 20 }]);

  studio.seek(15);
  sameBytes("#79 curve: between the keys the first one holds",
            studio.output().pixels,
            rendererFrame(studio.render.runtime(), { BXR: 0x0B }));
  studio.seek(25);
  sameBytes("#79 curve: after the second key it holds",
            studio.output().pixels,
            rendererFrame(studio.render.runtime(), { BXR: 0x15 }));

  /* the curve box lists them, with a remove button each */
  api.curve("BXR");
  check(api.openCurve() === "BXR",
        "#79 curve: the curve button opens that register's curve");
  const box = page.dom.get("reg-curvebox");
  check(box && box.hidden === false, "#79 curve: the box is shown");
  const del = page.dom.get("reg-key-del-10");
  check(del && (del.listeners.click || []).length === 1,
        "#79 curve: a keyframe has a remove button");
  del.click();
  eq("#79 curve: the × removes that key", studio.keyframes("BXR").length, 1);
  studio.undo();
  eq("#79 curve: undo puts the key back", studio.keyframes("BXR").length, 2);

  /* the add button keys the register at the current frame */
  studio.seek(30);
  api.addKey();
  eq("#79 curve: + key adds one at the current frame",
     studio.keyframes("BXR").map((k) => k.frame), [10, 20, 30]);
  studio.undo();
  api.curve("BXR");

  /* search, filter and the count */
  api.search("BXR");
  eq("#79 filter: search by name shows one row",
     api.count(), { shown: 1, total: api.rows().length, text: api.count().text });
  check(api.count().text === "1 / " + api.rows().length,
        "#79 filter: the count says N / total (" + api.count().text + ")");
  api.search("$0400");
  check(api.count().shown === 1 &&
        api.rows().filter((r) => r.visible)[0].reg === "VCECR",
        "#79 filter: search by address finds the VCE's control register");
  api.search("");
  const all = api.count().shown;
  api.filter("PSG");
  check(api.count().shown === 10, "#79 filter: the PSG group has ten rows (" +
        api.count().shown + ")");
  api.filter("all");
  api.pokedOnly(true);
  check(api.count().shown === 1 &&
        api.rows().filter((r) => r.visible)[0].reg === "BXR",
        "#79 filter: Poked only shows the poked registers (" +
        api.count().shown + ")");
  api.pokedOnly(false);
  check(api.count().shown === all,
        "#79 filter: clearing the filters brings every row back");
  studio.clearPokes();
  api.search("");
}

/* ---- 6. the write-back into the toy ------------------------------------ */

/* A toy that writes BXR itself every frame: the generated block has to win
 * every frame, not only when a key's value changes. */
const SELF_WRITER = [
  "function frame(t, f)",
  "  reg(\"BXR\", 0)",
  "  pal(0, f % 16)",
  "end",
  ""
].join("\n");

function checkWriteBack(page) {
  const studio = page.sandbox.PCEStudio.studio;
  const api = studio.panels.get("registers").api;
  studio.loadExample("palette", true);
  studio.pause();
  /* the toy's own frame() writes BXR = 0 every frame */
  studio.setEditorText(SELF_WRITER);
  studio.selectFile("main.lua");
  page.dom.get("source").value = SELF_WRITER;
  for (const fn of page.dom.get("source").listeners.input || []) {
    fn({ target: page.dom.get("source"), preventDefault() {},
         stopPropagation() {} });
  }
  /* Run, so the toy's own frame() is the one being previewed */
  page.dom.get("btn-run").click();
  studio.pause();
  studio.seek(0);
  sameBytes("#79 write-back: the toy's own frame is BXR 0",
            studio.output().pixels, rendererFrame(studio.render.runtime(),
                                                  { BXR: 0 }));

  /* the curve to write: BXR 16 from frame 0, 64 from frame 10 */
  studio.clearPokes();
  studio.poke("BXR", 16, 0);
  studio.poke("BXR", 64, 10);

  /* the frames the pokes preview, before anything is written.  A poke is the
   * view's, not the toy's: the toy's own state stays BXR 0 all the way while
   * the drawn frame carries the key in force. */
  const expected = (f) => (f < 10 ? 16 : 64);
  const preview = {};
  let previewDiffs = 0, toyTouched = 0;
  for (let f = 0; f <= 12; f++) {
    studio.seek(f);
    preview[f] = studio.output().pixels.slice();
    previewDiffs += diffCount(preview[f],
      rendererFrame(studio.render.runtime(), { BXR: expected(f) })).n;
    if (studio.render.runtime().state.regs.BXR !== 0) toyTouched++;
  }
  check(previewDiffs === 0,
        "#79 write-back: every previewed frame is the renderer's with the " +
        "key in force (diff " + previewDiffs + ")");
  check(toyTouched === 0,
        "#79 write-back: the pokes never touched the toy's own state (" +
        toyTouched + " frames did)");

  /* a register a toy may not set travels with the same call and is refused */
  studio.poke("MWR", 0x50, 0);
  const report = studio.writePokes();
  eq("#79 write-back: the writable registers are the ones written",
     report.written, ["BXR"]);
  eq("#79 write-back: MWR is refused by the host's code",
     report.refused, [{ reg: "MWR", code: "reg-forbidden" }]);
  check(report.changed === true && report.runs === true,
        "#79 write-back: the toy was re-run from the new source");

  /* the source holds exactly one block, and only the writable register */
  const src = studio.toy.file("main.lua").source;
  check((src.match(/-- >>> PCEStudio pokes/g) || []).length === 1,
        "#79 write-back: main.lua has one generated block");
  check(src.indexOf("MWR") < 0, "#79 write-back: MWR is not in main.lua");
  check(src.indexOf('reg = "BXR"') > 0,
        "#79 write-back: BXR's keyframes are in main.lua");

  /* the pokes are baked: the view no longer applies them, and its stacks are
   * empty (the source edit is CodeMirror's undo) */
  check(studio.pokes().length === 0,
        "#79 write-back: the written pokes left the view's list");
  check(!studio.canUndo(), "#79 write-back: the poke undo stack is baked");
  eq("#79 write-back: main.lua still has the toy's own code",
     src.indexOf("reg(\"BXR\", 0)") > 0, true);

  /* the toy's own run now makes the frames the poke previewed */
  for (let f = 0; f <= 12; f++) {
    studio.seek(f);
    sameBytes("#79 write-back: frame " + f + " is the previewed frame, " +
              "from the toy itself", studio.output().pixels, preview[f]);
    check(studio.render.runtime().state.regs.BXR === expected(f),
          "#79 write-back: frame " + f + " has the toy's own BXR " +
          expected(f) + " (got " + studio.render.runtime().state.regs.BXR + ")");
  }

  /* writing again with nothing poked is refused by a named code */
  let code = null;
  try { studio.writePokes(); } catch (e) { code = e.code; }
  eq("#79 write-back: nothing poked is a named refusal", code, "no-pokes");

  /* and a poke that only a view can make writes nothing at all */
  studio.poke("MWR", 0x50, 0);
  const onlyRefused = studio.writePokes();
  check(onlyRefused.changed === false &&
        onlyRefused.refused[0].reg === "MWR",
        "#79 write-back: a register the toy may not set writes nothing");
  check(studio.toy.file("main.lua").source === src ||
        studio.toy.file("main.lua").source === src.replace(/\s+$/, ""),
        "#79 write-back: the source was not touched by a refusal");
  studio.clearPokes();

  /* the toy is not left broken for later checks */
  studio.loadExample("palette", true);
  studio.pause();
  studio.seek(0);
}

/* ---- 7. the page still boots and every panel button has a handler ------ */

function checkButtons(page) {
  const studio = page.sandbox.PCEStudio.studio;
  studio.panels.select("registers");
  const buttons = studio.panels.get("registers").api &&
    page.dom.document.querySelectorAll("button");
  let noHandler = 0, threw = 0;
  const names = [];
  for (const b of buttons) {
    const listeners = b.listeners.click || [];
    if (!listeners.length) { noHandler++; continue; }
    for (const fn of listeners) {
      try {
        fn(page.dom.fakeEvent(b));
      } catch (e) { threw++; names.push((b.id || b.textContent) + ": " + e.message); }
    }
  }
  check(noHandler === 0, "#79: every button on the page has a click handler (" +
        noHandler + " did not)");
  check(threw === 0, "#79: every button handler ran (" + threw + " threw" +
        (names.length ? ": " + names[0] : "") + ")");
  studio.clearPokes();
}

/* ---- main ------------------------------------------------------------- */

function main() {
  checkModel();

  let page;
  try {
    page = runPage("");
  } catch (e) {
    console.log("FAIL  renderer/studio.html did not run (" + e.message + ")");
    process.exit(1);
  }
  const studio = page.sandbox.PCEStudio.studio;
  studio.pause();

  checkPageApi(page);
  checkCatalogue(page);
  checkPokes(page);
  checkCurves(page);
  checkWriteBack(page);
  checkButtons(page);

  console.log("");
  if (failures.length) {
    console.log("FAIL  " + failures.length + " of " + checks + " checks");
    process.exit(1);
  }
  console.log("PASS  " + checks + " checks");
}

main();
