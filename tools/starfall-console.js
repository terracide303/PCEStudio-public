#!/usr/bin/env node
/*
 * tools/starfall-console.js — what the studio's Export makes of STARFALL
 * (card #131), reproduced in Node with the same modules the page runs.
 *
 *   node tools/starfall-console.js [toy.lua] [--song song.json]
 *
 * Default toy: toys/demo-game/main.lua (STARFALL).
 *
 * The page's Export is three stages, in this order (renderer/studio.html's
 * exportAnalysis(), which mirrors renderer/studio-panel-console.js's
 * analyse()):
 *
 *   1. the CONSOLE tab's checks: pce-il.js compile, pce-validate.js budgets,
 *      pce-cgen.js emitC (the C backend, llvm-mos)
 *   2. if stage 1 reported any error, STOP: the encoder is never reached
 *      (renderer/studio.html:4196)
 *   3. pce-ilbc.js encode -> pce-rom.js buildToyRom over renderer/ilvm.bin
 *
 * Stage 1's cgen refuses the FIRST instruction it cannot lower, so the page
 * shows one finding where the toy has a dozen kinds of blocker.  This tool
 * prints both: the page's report verbatim, then the complete inventory of
 * every IL instruction kind either backend cannot carry, counted over the
 * toy's whole IL rather than stopping at the first hit — and the refusals
 * that name an operand rather than a kind (cgen-global's typed globals),
 * which is what the C backend would reach next after the table kinds
 * #176 carried.
 *
 * #178 adds the table inventory any toy can be measured with: the encoder's
 * own tableLayout() sites and cells (array plus field), their shapes (array,
 * record, nested), the escaping and re-executing sites, the table ops the
 * first frame actually executes (counted through the IL host's onOp, the
 * same instrument docs/TABLES-PLAN.md used), and the projected version 2
 * container size with the four table ops at their real sizes — beside the
 * 8 KiB data-bank verdict.  A toy whose validator returns no blank budget
 * (TOWER today) gets a NOTE instead of a crash.
 *
 * Exit status is 0 whatever the verdict: this is a measuring instrument, not
 * a pass/fail check.  Read the tables.  tests/check-starfall-console.js and
 * tests/check-tables.js are the pass/fail checks: they pin what this prints.
 *
 * require()ing the file gives { analyse, report } and runs nothing.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const il = require(path.join(ROOT, "renderer/pce-il.js"));
const validate = require(path.join(ROOT, "renderer/pce-validate.js"));
const cgen = require(path.join(ROOT, "renderer/pce-cgen.js"));
const ilbc = require(path.join(ROOT, "renderer/pce-ilbc.js"));
const romLib = require(path.join(ROOT, "renderer/pce-rom.js"));

const DEFAULT_TOY = "toys/demo-game/main.lua";
const FRAMES = 8;              /* renderer/studio-panel-console.js's run length */

/* The accepted sets, read off the two backends' own sources rather than
 * retyped: pce-ilbc.js's OPS (its `default` refuses ilbc-op), pce-cgen.js's
 * `switch (ins.t)` in the lowering pass (its `default` refuses cgen-op) and
 * pce-ilbc.js's BUILTIN map.  A hard-coded copy went stale silently when
 * #124 moved code; a parse that cannot find the switch refuses loudly. */
const ILBC_OPS = new Set(Object.keys(ilbc.OPS || {}));
const ILBC_ARITH = new Set(["add", "sub", "mul", "mod", "idiv", "band",
  "bor", "bxor", "shl", "shr"]);
const ILBC_CMP = new Set(["eq", "lt", "le"]);
const ILBC_REG = new Set(["BXR", "BYR", "CR"]);
const KEY_OK = new Set(["int", "bool", "nil"]);
/* cgen's getglobal/setglobal allow-list (pce-cgen.js validate()).  A global
 * of any other type is a cgen-global refusal, which is an operand's type,
 * not an instruction kind — see `cgenExtra` below. */
const CGEN_GLOBAL_OK = /^(fn|vram|int|bool|padset|table)$/;

function cgenAcceptedKinds() {
  const src = fs.readFileSync(path.join(ROOT, "renderer/pce-cgen.js"), "utf8");
  const m = /switch\s*\(ins\.t\)\s*\{([\s\S]*?)\n\s*default:/.exec(src);
  if (!m) {
    throw new Error("starfall-console: pce-cgen.js's `switch (ins.t)` was " +
                    "not found; the accepted-kind set cannot be read");
  }
  const set = new Set();
  const re = /case\s+"([^"]+)":/g;
  let hit;
  while ((hit = re.exec(m[1]))) set.add(hit[1]);
  if (!set.size) {
    throw new Error("starfall-console: pce-cgen.js's switch parsed to no cases");
  }
  return set;
}

function ilbcBuiltinNames() {
  const src = fs.readFileSync(path.join(ROOT, "renderer/pce-ilbc.js"), "utf8");
  const m = /var BUILTIN = \{([^}]*)\}/.exec(src);
  if (!m) {
    throw new Error("starfall-console: pce-ilbc.js's BUILTIN map was not found");
  }
  const set = new Set();
  const re = /([A-Za-z_$][\w$]*)\s*:/g;
  let hit;
  while ((hit = re.exec(m[1]))) set.add(hit[1]);
  return set;
}

const CGEN_OPS = cgenAcceptedKinds();
const ILBC_BUILTIN = ilbcBuiltinNames();

function stage(fn) {
  try { return { ok: true, value: fn() }; }
  catch (e) { return { ok: false, code: e.code || e.name, message: e.message }; }
}
function oneLine(s) { return String(s == null ? "" : s).replace(/\s+/g, " "); }
function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

/* ---- the analysis ------------------------------------------------------
 * Everything the report prints, as data, so tests/check-starfall-console.js
 * can pin it.  Nothing here writes to a file. */
/* opts.songs: the modules a toy's music(index) plays, handed to the
 * validator the way the runtime gets them.  Without it a toy that calls
 * music(0) is refused with music-range — a missing argument, not a finding. */
function analyse(rel, opts) {
  opts = opts || {};
  rel = rel || DEFAULT_TOY;
  const src = path.resolve(ROOT, rel);
  const source = fs.readFileSync(src, "utf8");
  const out = {
    rel: rel, bytes: source.length,
    compile: null, program: null, validator: null, report: null,
    cgen: null, page: null, encode: null, rom: null,
    inventory: null, cgenExtra: null, capacity: null, tables: null
  };

  const comp = stage(() => il.compile(source, { chunkName: "@main.lua" }));
  out.compile = comp;
  if (!comp.ok) return out;
  const program = comp.value;
  out.program = program;

  const vr = stage(() => validate.validateProgram(program, {
    chunkName: "@main.lua", frames: FRAMES, songs: opts.songs || [] }));
  out.validator = vr;
  const report = vr.ok ? vr.value : null;
  out.report = report;

  const cgenR = stage(() => cgen.emitC(program, { target: "llvm" }));
  out.cgen = cgenR;

  const errors = (report ? report.problems.filter((p) =>
    p.severity !== "warn").length : 1) + (cgenR.ok ? 0 : 1);
  out.page = {
    errors: errors,
    blocked: errors > 0,
    earlyReturn: "renderer/studio.html:4196"
  };

  const enc = stage(() => ilbc.encode(program));
  out.encode = enc;
  if (enc.ok) {
    out.rom = stage(() => romLib.buildToyRom({
      bank0: fs.readFileSync(path.join(ROOT, "renderer/ilvm.bin")),
      bytecode: enc.value.bytes }));
  }

  /* tableLayout() is the encoder's own reading of each site (shape, cells,
   * escape, repeat) and, since #133, of each sprite's resolved spec; it
   * changes no bytes.  The inventory below consults its sprite records, so
   * the sprite rows count what each backend will actually refuse (#190:
   * both consume the same records), not just the kind's presence in OPS. */
  let layout = null, layoutError = null;
  try { layout = ilbc.tableLayout(program); }
  catch (e) { layoutError = { code: e.code || e.name, message: e.message }; }

  /* ---- the complete inventory, by KIND -------------------------------- */
  const kinds = new Map();
  function note(kind, line, backend) {
    const key = kind + " | " + backend;
    if (!kinds.has(key)) {
      kinds.set(key, { kind: kind, backend: backend, n: 0, lines: new Set() });
    }
    const k = kinds.get(key);
    k.n++;
    if (line != null) k.lines.add(line);
  }

  let total = 0;
  const refused = new Set();     /* one entry per instruction, both backends */
  for (const fn of program.functions) {
    fn.code.forEach((ins, pc) => {
      total++;
      if (!ILBC_OPS.has(ins.t)) note(ins.t, ins.line, "route 1 (ilbc)");
      if (!CGEN_OPS.has(ins.t)) note(ins.t, ins.line, "C backend (cgen)");
      if (ins.t === "builtin" && !ILBC_BUILTIN.has(ins.name)) {
        note("builtin " + ins.name, ins.line, "C backend (cgen)");
      }
      if (!ILBC_OPS.has(ins.t) || !CGEN_OPS.has(ins.t) ||
          (ins.t === "builtin" && !ILBC_BUILTIN.has(ins.name))) {
        refused.add(fn.id + ":" + pc);
      }
      if (ins.t === "arith" && !ILBC_ARITH.has(ins.op)) {
        note("arith " + ins.op, ins.line, "route 1 (ilbc)");
      }
      if (ins.t === "cmp" && !ILBC_CMP.has(ins.op)) {
        note("cmp " + ins.op, ins.line, "route 1 (ilbc)");
      }
      if (ins.t === "reg" && !ILBC_REG.has(ins.name)) {
        note("reg " + ins.name, ins.line, "route 1 (ilbc)");
      }
      if (ins.t === "builtin" && !ILBC_BUILTIN.has(ins.name)) {
        note("builtin " + ins.name, ins.line, "route 1 (ilbc)");
      }
      /* #133/#190: a sprite whose spec the walker cannot pin refuses
       * deeper than the kind table — both backends consume the SAME
       * records (pce-ilbc.js's sprite resolution), so one note per backend
       * marks exactly the sites that backend's encode/emit refuses. */
      if (ins.t === "sprite" && layout &&
          layout.sprites && layout.sprites[fn.id]) {
        const spr = layout.sprites[fn.id][pc];
        if (!spr || !spr.ok) {
          note("sprite", ins.line, "route 1 (ilbc)");
          note("sprite", ins.line, "C backend (cgen)");
          /* Both backends refuse this instruction, so it belongs in the
           * union even though neither kind table rejects `sprite`. */
          refused.add(fn.id + ":" + pc);
        }
      }
      for (const f of ["k", "src", "a", "b", "cond", "value"]) {
        const v = ins[f];
        if (v && v.k && !KEY_OK.has(v.k.t)) {
          note("constant " + v.k.t, ins.line, "route 1 (ilbc)");
        }
      }
    });
  }

  out.inventory = {
    functions: program.functions.length,
    total: total,
    refusedCount: refused.size,
    rows: Array.from(kinds.values()).sort((a, b) => b.n - a.n).map((k) => ({
      kind: k.kind, backend: k.backend, n: k.n,
      lines: Array.from(k.lines).sort((a, b) => a - b)
    }))
  };

  /* ---- refusals that name an operand, not a kind ---------------------- *
   * pce-cgen.js's validate() refuses getglobal/setglobal unless the
   * global's declared type is fn/vram/int/bool/padset/table.  The inventory
   * above cannot see this: getglobal/setglobal ARE carried kinds.  #176
   * carried the table kind too, so STARFALL's table-typed drawings globals
   * (DIGIT, bl, bx, by, ex, ey, es) no longer refuse — this section now
   * reads zero for them, and its purpose is holding the code reachable for
   * the next type cgen puts in C. */
  const typeOf = {};
  for (const g of program.globals || []) typeOf[g.name] = g.type;
  const extra = { n: 0, get: 0, set: 0, names: {}, first: null,
                  otherChecks: { fixed: 0, cond: 0, arity: 0, closure: 0 } };
  function condType(op) {
    if (!op) return "int";
    if (op.r != null) return op.tt || "int";
    if (op.k) return op.k.t;
    return "int";
  }
  for (const fn of program.functions) {
    fn.code.forEach((ins, pc) => {
      if (ins.t === "arith" && ins.type !== "int") extra.otherChecks.fixed++;
      if (ins.t === "cmp" && ins.type === "fixed") extra.otherChecks.fixed++;
      if (ins.t === "br" && condType(ins.cond) !== "bool") {
        extra.otherChecks.cond++;
      }
      if (ins.t === "call" && ins.args.length > 4) extra.otherChecks.arity++;
      if ((ins.t === "getglobal" || ins.t === "setglobal") &&
          (!typeOf[ins.name] || !CGEN_GLOBAL_OK.test(typeOf[ins.name]))) {
        const t = typeOf[ins.name] || "untyped";
        extra.n++;
        if (ins.t === "getglobal") extra.get++; else extra.set++;
        extra.names[ins.name + ":" + t] =
          (extra.names[ins.name + ":" + t] || 0) + 1;
        if (!extra.first) {
          extra.first = { fn: fn.id, fnName: fn.name, pc: pc, line: ins.line,
                          kind: ins.t, name: ins.name, type: t };
        }
      }
    });
    if (fn.params.length > 4) extra.otherChecks.arity++;   /* once per fn */
  }
  /* The first cgen refusal left in traversal order — what the page's Export
   * reports after #176 carried the four table kinds and the table-typed
   * globals.  This is the claim the write-up has to make, so it is data. */
  let next = null;
  for (const fn of program.functions) {
    fn.code.forEach((ins, pc) => {
      if (next) return;
      let code = null;
      if (!CGEN_OPS.has(ins.t)) code = "cgen-op";
      else if (ins.t === "builtin" && ins.name !== "rgb") code = "cgen-op";
      else if ((ins.t === "getglobal" || ins.t === "setglobal") &&
               (!typeOf[ins.name] ||
                !CGEN_GLOBAL_OK.test(typeOf[ins.name]))) code = "cgen-global";
      if (code) {
        next = { code: code, fn: fn.id, fnName: fn.name, pc: pc,
                 line: ins.line, kind: ins.t, name: ins.name || null,
                 type: typeOf[ins.name] || null };
      }
    });
  }
  extra.nextRefusal = next;
  out.cgenExtra = extra;

  /* ---- #178: the table inventory, and the first frame's table ops ----- *
   * tableLayout() is the encoder's own reading of each site (shape, cells,
   * escape, repeat); it changes no bytes.  The executed counts come from
   * running the toy's first frame through the IL host with onOp — the same
   * instrument docs/TABLES-PLAN.md used — and count only the frame after
   * load() (the chunk and init() build the arrays once; they are not the
   * frame the console pays every time).  Both are staged: a toy this tool
   * cannot run still prints its inventory and says why the frame did not
   * run, rather than taking the whole report down. */
  const exec = {
    ok: false, code: null, message: null, il: 0,
    table: 0, setlist: 0, tget: 0, tset: 0, total: 0
  };
  if (layout) {
    let counting = false;
    try {
      const rt = il.create(source, {
        chunkName: "@main.lua", songs: opts.songs || [],
        onOp: (fid, ins) => {
          if (!counting) return;
          exec.il++;
          if (ins.t === "table" || ins.t === "setlist" ||
              ins.t === "tget" || ins.t === "tset") {
            exec[ins.t]++;
            exec.total++;
          }
        }
      });
      rt.load();
      counting = true;
      rt.frame(0);
      exec.ok = true;
    } catch (e) {
      exec.code = e.code || e.name;
      exec.message = e.message;
    }
  } else {
    exec.code = layoutError.code;
    exec.message = layoutError.message;
  }

  const shapes = { array: 0, record: 0, mixed: 0, empty: 0, nested: 0 };
  if (layout) {
    for (const s of layout.sites) {
      const array = s.cap > 0, record = s.nfields > 0;
      if (array && record) shapes.mixed++;
      else if (array) shapes.array++;
      else if (record) shapes.record++;
      else shapes.empty++;
      if (s.nested) shapes.nested++;
    }
  }
  out.tables = {
    ok: !!layout,
    code: layoutError ? layoutError.code : null,
    message: layoutError ? layoutError.message : null,
    sites: layout ? layout.nslots : 0,
    cells: layout ? layout.cells : 0,
    arrayCells: layout ? layout.arrayCells : 0,
    fieldCells: layout ? layout.fieldCells : 0,
    shapes: shapes,
    escaping: layout ? layout.escaping : 0,
    reexecuting: layout ? layout.reexecuting : 0,
    fieldIds: layout ? layout.fieldIds.slice() : [],
    sitesList: layout ? layout.sites : [],
    executed: exec
  };

  /* ---- capacity: would the bytecode fit the one 8 KiB data bank? ------ *
   * The container layout is renderer/pce-ilbc.js's own (its header comment
   * and the per-op sizes at renderer/pce-ilbc.js:195).  A toy with a table
   * instruction gets version 2: a 28-byte header (#172) and a table section
   * of u8 nslots plus 4 B per slot (u16 base, u8 cap, u8 nfields).  A toy
   * without one stays version 1 at 24 B.  The model is checked against the
   * two committed v1 containers before it is used: it must reproduce them
   * to within a few bytes (it lands 1 B and 4 B short).  A kind route 1
   * cannot carry has no defined size, so it is counted at an assumed size
   * and the answer is reported across a range; the smallest assumption that
   * is still realistic is 3 B.  The projection that counts only the four
   * table ops at their real sizes (everything uncarried at 0 B) is `exact`
   * — #178's measurement. */
  const ILBC_SIZE = {
    const: 3, move: 3, getglobal: 3, setglobal: 3, getupval: 3, setupval: 3,
    closure: 3, ret: 2, jmp: 3, br: 5, forprep: 2, fornext: 4, arith: 5,
    unm: 3, bnot: 3, cmp: 5, pal: 3, reg: 3, vset: 3, vget: 3,
    table: 3, tget: 5, tset: 5, sprite: 7
  };
  function opSize(ins) {
    if (ins.t === "call") return 4 + ins.args.length;
    if (ins.t === "builtin") return 3 + ins.args.length;
    if (ins.t === "setlist") return 4 + (ins.values ? ins.values.length : 0);
    return ILBC_SIZE[ins.t] || 0;
  }
  function projectSize(prog, unknownSize, layout) {
    const consts = [], seen = new Set();
    let ups = 0, code = 0;
    const add = (o) => {
      if (!o || !o.k) return;
      const key = o.k.t + ":" + JSON.stringify(o.k.v);
      if (seen.has(key)) return;
      seen.add(key); consts.push(o.k);
    };
    for (const fn of prog.functions) {
      ups += fn.upvalues.length;
      for (const ins of fn.code) {
        const s = opSize(ins);
        if (s) code += s; else code += unknownSize;
        if (ins.k) add({ k: ins.k });
        for (const f of ["dst", "src", "callee", "cond", "value", "a", "b",
                         "addr", "word", "lineArg"]) {
          if (ins[f] && typeof ins[f] === "object") add(ins[f]);
        }
        for (const f of ["args", "addrs"]) {
          if (Array.isArray(ins[f])) for (const o of ins[f]) add(o);
        }
      }
    }
    let constSize = 0;
    for (const k of consts) {
      if (k.t === "int") constSize += 5;
      else if (k.t === "bool") constSize += 2;
      else if (k.t === "nil") constSize += 1;
      else if (k.t === "string") constSize += 2 + k.v.length;
    }
    let globalSize = 0;
    for (const g of prog.globals || []) globalSize += 1 + g.name.length;
    /* The version 2 table section: one byte of slot count and four per
     * slot — u16 base, u8 cap, u8 nfields (pce-ilbc.js's buildTableSection;
     * #178 corrected an earlier 5 B-per-slot guess). */
    layout = layout || ilbc.tableLayout(prog);
    const header = layout.nslots > 0 ? ilbc.HEADER_TABLES : ilbc.HEADER;
    return header + prog.functions.length * 10 + ups * 2 + constSize +
           globalSize + code + 1 + layout.nslots * 4;
  }

  /* the model's own control: the two committed containers */
  const CONTROLS = [["tools/toys/palette.lua", 578],
                    ["toys/parallax.lua", 1115]];
  let worst = 0;
  const controls = [];
  for (const [crel, want] of CONTROLS) {
    const p = il.compile(fs.readFileSync(path.join(ROOT, crel), "utf8"),
                         { chunkName: "@main.lua" });
    const got = projectSize(p, 3);
    worst = Math.max(worst, Math.abs(got - want));
    controls.push({ rel: crel, committed: want, modelled: got });
  }
  out.capacity = {
    bank: romLib.BANK,
    worst: worst,
    controls: controls,
    exact: (() => {
      const n = layout ? projectSize(program, 0, layout) : null;
      return n == null ? null
        : { bytes: n, over: n > romLib.BANK, by: Math.abs(n - romLib.BANK) };
    })(),
    projections: layout ? [3, 4, 6].map((assumed) => {
      const n = projectSize(program, assumed, layout);
      return { assumed: assumed, bytes: n, over: n > romLib.BANK,
               by: Math.abs(n - romLib.BANK) };
    }) : []
  };

  return out;
}

/* ---- the report -------------------------------------------------------- */
function report(r) {
  console.log("toy: " + r.rel + " (" + r.bytes + " bytes)");
  console.log("");

  if (!r.compile.ok) {
    console.log("IL compile refused: " + r.compile.code + ": " +
                oneLine(r.compile.message));
    return;
  }

  const reportVal = r.report;
  console.log("== 1. the CONSOLE tab's checks (what the page shows) ==");
  console.log("   validator: " + (reportVal
    ? (reportVal.ok ? "ok (no error)" : "REFUSED, code " + reportVal.code) +
      ", " + reportVal.problems.length + " problem(s)"
    : "threw " + r.validator.code));
  if (reportVal && reportVal.problems.length) {
    for (const p of reportVal.problems) {
      console.log("     " + p.severity + " " + p.code + " line " + p.line +
                  ": " + oneLine(p.message));
    }
  }
  console.log("   C emitter: " + (r.cgen.ok
    ? "lowered " + r.cgen.value.length + " bytes of C"
    : r.cgen.code + ": " + oneLine(r.cgen.message)));
  console.log("   page verdict: " + (r.page.blocked
    ? "BLOCKED (" + r.page.errors + " error) - " + r.page.earlyReturn +
      " returns here, so pce-ilbc.js is never run"
    : "proceeds to the encoder"));
  console.log("");

  if (reportVal && reportVal.budgets) {
    const b = reportVal.budgets;
    console.log("   budgets (the model's estimate, NOT a capture):");
    console.log("     frame(): " + b.frameCycles + " cycles");
    console.log("     collection (frame() plus the 224 raster() calls): " +
                b.collectionCycles + " cycles, " +
                (b.ratio60 * 100).toFixed(2) + "% of a 60 Hz frame, " +
                b.hz.toFixed(1) + " Hz on the COMPILED route's model");
    console.log("     route 1 (the interpreter, what the Export builds): " +
                b.route1.collectionCycles + " cycles = " +
                b.route1.ratio60.toFixed(3) + " display frames, " +
                b.route1.hz.toFixed(1) + " Hz, meets60 " + b.route1.meets60 +
                " (factor " + b.route1.factor + ", " + b.route1.shape + ")");
    console.log("     sprites " + b.sprites.sprites + " / " + b.sprites.strips +
                " strips, busiest line " + b.sprites.line + "; VRAM " +
                b.vram.maxWord + " words; blank " +
                (b.blank ? b.blank.cycles + " cycles" : "n/a") + "; ROM ~" +
                b.rom.bytes + " B (" + b.rom.banks + " banks)");
    if (!b.blank) {
      console.log("     NOTE this toy's validator returns no blank budget " +
                  "(budgets.blank is null), so the pre-render blank cycles " +
                  "are not shown; the rest of the budget is unaffected");
    }
    console.log("");
  }

  const tb = r.tables;
  console.log("== 2. the table inventory (#178) ==");
  if (!tb || !tb.ok) {
    console.log("   NOTE pce-ilbc.js's tableLayout() refused this program (" +
                (tb ? tb.code : "not run") + "), so no inventory is printed: " +
                oneLine(tb && tb.message));
  } else {
    console.log("   " + tb.sites + " sites, " + tb.cells + " cells = " +
                tb.arrayCells + " array + " + tb.fieldCells + " field");
    console.log("   shapes: " + tb.shapes.array + " array, " +
                tb.shapes.record + " record, " + tb.shapes.mixed +
                " array+record, " + tb.shapes.empty + " empty; " +
                tb.shapes.nested + " nested");
    console.log("   escaping sites " + tb.escaping + ", re-executing sites " +
                tb.reexecuting);
    console.log("   field names (" + tb.fieldIds.length + "): " +
                (tb.fieldIds.length
                  ? tb.fieldIds.map((n, i) => n + "(" + i + ")").join(" ")
                  : "none"));
    const ex = tb.executed;
    if (ex.ok) {
      console.log("   first frame: " + ex.total + " table ops = " +
                  ex.table + " table + " + ex.setlist + " setlist + " +
                  ex.tget + " tget + " + ex.tset + " tset (" + ex.il +
                  " IL instructions executed)");
    } else {
      console.log("   NOTE the first frame did not run (" + ex.code + ": " +
                  oneLine(ex.message) + "), so no executed table ops are " +
                  "counted");
    }
    if (r.capacity.exact) {
      const e = r.capacity.exact;
      console.log("   projected container: " + fmt(e.bytes) +
                  " B with the four table ops at their real sizes and every " +
                  "other uncarried kind at 0 B — " + (e.over ? "OVER" : "fits") +
                  " the " + fmt(r.capacity.bank) + " B data bank" +
                  (e.over ? " by " + fmt(e.by) + " B" : ""));
    }
    console.log("   per site (array cap, field count, cells):");
    console.log("     id  line   shape          cap  fld  cells  flags");
    for (const s of tb.sitesList) {
      const array = s.cap > 0, record = s.nfields > 0;
      const shape = array && record ? "array+record"
                  : array ? "array" : record ? "record" : "empty";
      const flags = [s.escapes ? "escapes" : null,
                     s.repeats ? "repeats" : null,
                     s.nested ? "nested" : null,
                     s.globals.length ? "global:" + s.globals.join(",") : null]
                    .filter(Boolean).join(" ");
      console.log("     " + String(s.id).padStart(2) + "  " +
                  String(s.line == null ? "-" : s.line).padStart(4) + "   " +
                  shape.padEnd(14) + String(s.cap).padStart(3) + "  " +
                  String(s.nfields).padStart(3) + "  " +
                  String(s.cells).padStart(5) + "  " + flags);
    }
  }
  console.log("");

  console.log("== 3. the encoder (reached only when the console tab is clean)" +
              " ==");
  if (!r.encode.ok) {
    console.log("   pce-ilbc.js refused: " + r.encode.code + ": " +
                oneLine(r.encode.message));
  } else {
    console.log(r.rom.ok
      ? "   bytecode " + r.encode.value.bytes.length + " B -> .pce " +
        r.rom.value.length + " B"
      : "   buildToyRom refused: " + r.rom.code + ": " +
        oneLine(r.rom.message));
  }
  console.log("");

  const inv = r.inventory;
  console.log("== every instruction kind a backend cannot carry ==");
  console.log("   " + inv.functions + " IL functions, " + inv.total +
              " instructions");
  for (const k of inv.rows) {
    console.log("   " + k.kind.padEnd(16) + String(k.n).padStart(4) + "  " +
                k.backend + ", first main.lua:" +
                (k.lines[0] == null ? "-" : k.lines[0]) + ", " +
                k.lines.length + " distinct line(s)");
  }
  console.log("   " + inv.refusedCount + " of " + inv.total +
              " instructions (" +
              (100 * inv.refusedCount / inv.total).toFixed(1) +
              "%) are refused by at least one backend");
  console.log("");

  const ex = r.cgenExtra;
  console.log("== refusals that name an operand, not a kind ==");
  console.log("   cgen-global (renderer/pce-cgen.js validate()): " + ex.n +
              " getglobal/setglobal on a typed global outside " +
              "fn/vram/int/bool/padset/table (" + ex.get + " get, " + ex.set +
              " set)");
  for (const name of Object.keys(ex.names)) {
    console.log("     " + name.padEnd(24) + String(ex.names[name]).padStart(4));
  }
  if (ex.first) {
    console.log("   first: function " + ex.first.fn + " `" + ex.first.fnName +
                "` pc " + ex.first.pc + ", main.lua:" + ex.first.line + " (" +
                ex.first.kind + " " + ex.first.name + ":" + ex.first.type + ")");
  } else {
    console.log("   first: none (no global outside the allow-list is read)");
  }
  console.log("   the next cgen refusal is " + (ex.nextRefusal
    ? ex.nextRefusal.code + " at function " + ex.nextRefusal.fn +
      " pc " + ex.nextRefusal.pc + ", main.lua:" +
      ex.nextRefusal.line + " (" + ex.nextRefusal.kind + ")"
    : "none"));
  console.log("   other operand checks that would refuse (none found on this " +
              "toy): cgen-fixed " + ex.otherChecks.fixed + ", cgen-cond " +
              ex.otherChecks.cond + ", cgen-arity " + ex.otherChecks.arity);
  console.log("");

  const cap = r.capacity;
  console.log("== would the bytecode fit the interpreter's 8 KiB data bank? ==");
  console.log("   size model checked on the two committed containers: worst " +
              "error " + cap.worst + " B");
  for (const p of cap.projections) {
    console.log("   projected " + String(p.bytes).padStart(5) + " B with each " +
                "of the " + inv.refusedCount + " uncarried instructions at " +
                p.assumed + " B  (" + (p.over ? "OVER" : "fits") + " the " +
                cap.bank + " B bank by " + p.by + " B)");
  }
  const last = cap.projections[cap.projections.length - 1];
  console.log("   " + (last
    ? (last.over
       ? "renderer/pce-rom.js:622 refuses such a build with toy-data-bank-full"
       : "renderer/pce-rom.js:622 would accept this one")
    : "the size model could not be projected (tableLayout() refused)"));
}

if (require.main === module) {
  /* node tools/starfall-console.js [toy.lua] [--song song.json] */
  const args = process.argv.slice(2);
  const at = args.indexOf("--song");
  const songs = at >= 0 && args[at + 1]
    ? [JSON.parse(fs.readFileSync(path.resolve(ROOT, args[at + 1]), "utf8"))]
    : [];
  const rel = args.filter((a, i) => a !== "--song" &&
                                    !(at >= 0 && i === at + 1))[0];
  report(analyse(rel, { songs: songs }));
}

module.exports = {
  analyse: analyse,
  report: report,
  DEFAULT_TOY: DEFAULT_TOY,
  CGEN_OPS: CGEN_OPS,
  ILBC_OPS: ILBC_OPS,
  ILBC_BUILTIN: ILBC_BUILTIN,
  CGEN_GLOBAL_OK: CGEN_GLOBAL_OK
};
