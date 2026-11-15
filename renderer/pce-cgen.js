/*
 * pce-cgen.js — the IL → C backend, part A (card #31, the console half).
 *
 * The pipeline (docs/IL.md):
 *
 *   toy.lua --(Fengari)--> Lua bytecode --(pce-il.js)--> IL --(this file)--> C
 *                                                        --(llvm-mos)--> .pce
 *
 * This file emits C *from the IL program object*, never from the Lua and
 * never from the machine code: it is the backend half of the IL design, and
 * the IL stays the one place the toy's meaning is written down.
 *
 * Two C dialects share the lowering (part B of #31):
 *
 *   target "llvm" (default)  int32_t, llvm-mos's PCE target (parts A and C)
 *   target "huc"             int (HuC's C has no 32-bit type), the HuC
 *                            compiler (fetched by tools/build-huc.sh),
 *                            runtime huc_runtime.c
 *
 * The dialect changes types, attributes and the two shift helpers; it does
 * NOT change the IL lowering or what each toy instruction means.  The
 * default output is byte-identical to part A/C's, so their committed ROMs
 * still rebuild.
 *
 * Part A's scope is the card's own: #30's palette-cycling toy (init + frame,
 * no raster), through IL -> C -> llvm-mos's PCE target, measured in Mednafen.
 * Part C adds the two things the shell needs for `raster(line)`: the `reg`
 * instruction (a VDC register write, so a per-line handler can scroll) and
 * int globals (the frame number a raster callback reads), plus the raster
 * hook itself as `toy_raster(line)`.  The runtime decides how the callback
 * reaches the RCR interrupt (docs/IL.md §10); this file only emits the call.
 * Everything else is still REFUSED by code rather than guessed:
 *
 *   cgen-op         an IL instruction this backend has no C lowering for
 *   cgen-fixed      fixed-point arithmetic (part A/C toys read no fixed
 *                   value; their frame(t, f) uses f, not t)
 *   cgen-cond       a branch whose condition the IL did not type as bool
 *   cgen-global     a global whose type this backend cannot put in C
 *   cgen-arity      more than eight parameters/arguments (#183)
 *   cgen-hook       no frame() hook, no top-level chunk, or a raster() hook
 *                   that is not one int parameter
 *   cgen-closure-loop  a closure created inside a loop (one static slot per
 *                   closure site)
 *   cgen-key        a constant operand that is neither int nor bool
 *   cgen-target     a jump target that is not an instruction
 *   cgen-table-ram      the table slots need more than TABLE_POOL_CELLS, or a
 *                   constant array key / field id is past its slot's shape
 *   cgen-table-escape   an escaping table site that can run more than once
 *                   (one static slot would alias two Lua tables)
 *
 * Tables (#176): the four instructions table/setlist/tget/tset lower into
 * the same static pool model as the interpreter (docs/TABLES-PLAN.md §2):
 * `static int32_t il_table_cells[IL_TABLE_CELLS]` plus const base/cap/fields
 * arrays, one slot per `table` site, and il_globals[i] holds a slot id for a
 * table-typed global.  The layout is the encoder's own tableLayout()
 * (pce-ilbc.js), so the two backends cannot drift.  The HuC dialect refuses
 * tables: its int is 16 bits and the pool cells are the IL's 32-bit int32_t.
 *
 * Sprites (#190): `sprite(i, spec)` lowers to the runtime's shared
 * toy_sprite() (tools/toyc/toy_runtime.h), with the six values pce-ilbc.js's
 * walker resolved from the spec's table site — the same records the encoder
 * turns into op 0x1F (#133), not a second resolution.  So the build-window,
 * escape, constant-field and constant-slot guards are the encoder's own, and
 * a site they cannot pin refuses cgen-op here exactly where the encoder
 * refuses ilbc-op.
 *
 * Sound (#197): music/sfx/release and the note builtin lower to the
 * runtime's toy_music()/toy_sfx()/toy_release()/toy_note() — the calls
 * #198's engine link implements (docs/ROM-SOUND.md), not declared in
 * tools/toyc/toy_runtime.h yet, so a sound toy's C does not build until
 * then.  The browser host runs the same four ops today.
 *
 * The emitted program runs under tools/toyc/toy_runtime.c, which owns the
 * console: the VDC/VCE setup, the frame flow (wait for VBlank, run frame),
 * the VRAM/colour-table writes, and the HuC6280 TMA timer the capture reads
 * so the cycles per frame are measured, not estimated.
 *
 * Nothing in this file knows a HuC6280 opcode. That belongs to clang.
 */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./pce-ilbc.js"));
  } else {
    root.PCEStudio = root.PCEStudio || {};
    root.PCEStudio.cgen = factory(root.PCEStudio.ilbc);
  }
})(typeof self !== "undefined" ? self : this, function (ilbc) {
  "use strict";

  var VERSION = 1;
  /* The four table instructions this backend lowers (#176); the layout they
   * share with the encoder is ilbc.tableLayout, so this file carries no
   * second copy of the pool rule (docs/TABLES-PLAN.md §5). */
  var TABLE_OPS = { table: 1, setlist: 1, tget: 1, tset: 1 };

  function CGenError(code, message, line) {
    this.name = "CGenError";
    this.code = code;
    this.message = message;
    /* The Lua source line the finding points at, when the emitter knows it.
     * check() (below) sets it from the IL instruction for every instruction
     * refusal, so the ROM CHECK drawer and the MCP tool can put the line in
     * the editor gutter.  null means "the program as a whole". */
    this.line = line == null ? null : line;
  }
  CGenError.prototype = Object.create(Error.prototype);
  CGenError.prototype.constructor = CGenError;

  function refuse(code, message, line) { throw new CGenError(code, message, line); }

  /* ---- operands -------------------------------------------------------- */

  function constLitImpl(k, huc) {
    if (!k) refuse("cgen-key", "a missing constant operand");
    if (k.t === "int") {
      if (huc) {
        /* HuC has no 32-bit integer type: its `int` is 16 bits (defs.h,
         * INTSIZE 2).  A constant that does not fit is REFUSED rather than
         * silently truncated: the toy would run a different value on the
         * console than in the browser (docs/IL.md §11.6). */
        var v = k.v | 0;
        if (v < -32768 || v > 65535) {
          refuse("cgen-width", "the constant " + v + " does not fit HuC's " +
                 "16-bit int (-32768..65535)");
        }
        var w = k.v & 0xFFFF;
        return "(" + (w >= 0x8000 ? w - 0x10000 : w) + ")";
      }
      /* The IL's int is 32-bit wrapping; emit the bit pattern, not a
       * possibly-out-of-range decimal literal. */
      return "(int32_t)0x" + (k.v >>> 0).toString(16) + "u";
    }
    if (k.t === "bool") return k.v ? "1" : "0";
    if (k.t === "nil") return "0";
    if (k.t === "fixed") {
      refuse("cgen-fixed", "a fixed-point constant is not part of part A");
    }
    refuse("cgen-key", "a `" + k.t + "` constant is not an int or a bool");
    return "0";
  }

  function operandImpl(op, huc) {
    if (!op) return "0";
    if (op.r != null) return "r[" + op.r + "]";
    if (op.k) return constLitImpl(op.k, huc);
    refuse("cgen-op", "an operand with neither a register nor a constant");
    return "0";
  }

  function staticType(op) {
    if (!op) return "int";
    if (op.r != null) return op.tt || "int";
    if (op.k) return op.k.t;
    return "int";
  }

  /* ---- the program as the emitter needs it ----------------------------- */

  function analyse(program, issues) {
    /* `issues` is check()'s collector: when it is given, a refusal is
     * recorded and analysis goes on instead of throwing on the first one.
     * emitC() passes nothing, so its behaviour is unchanged. */
    function fail(code, message, line) {
      if (issues) {
        issues.push(new CGenError(code, message, line));
        return;
      }
      refuse(code, message, line);
    }
    function firstLine(fn) {
      return fn && fn.code && fn.code.length ? fn.code[0].line : null;
    }

    if (!program || program.lang !== "pce-il" || program.version !== 1) {
      fail("cgen-op", "not a pce-il version 1 program", null);
      return null;
    }
    var functions = program.functions || [];
    if (!functions.length || functions[0].name !== "main") {
      fail("cgen-hook", "the IL has no top-level chunk (function 0 `main`)",
           null);
      return null;
    }
    if (program.hooks.frame == null) {
      fail("cgen-hook", "the toy defines no frame() hook", null);
    }

    var maxUps = 0;
    var maxParams = 0;
    var f, pc;
    for (f = 0; f < functions.length; f++) {
      var fn = functions[f];
      if (fn.params.length > ilbc.MAX_ARGS) {
        fail("cgen-arity", fn.name + " takes " + fn.params.length +
             " parameters; this backend supports at most " + ilbc.MAX_ARGS,
             firstLine(fn));
      }
      maxUps = Math.max(maxUps, fn.upvalues.length);
      maxParams = Math.max(maxParams, fn.params.length);
    }

    /* The raster hook is the toy API's one int parameter.  Checked here so a
     * backend never has to guess what the callback expects. */
    var hookRaster = program.hooks.raster;
    if (hookRaster != null) {
      var rfn = functions[hookRaster];
      if (!rfn || rfn.params.length !== 1 || rfn.params[0] !== "int") {
        fail("cgen-hook", "raster() must be a function of one int parameter",
             firstLine(rfn));
      }
    }

    /* Can a function value outlive the instruction that made it?  A closure
     * is one static slot per site, so a site inside a loop is safe exactly
     * when the value cannot be stored.  This backend refuses every store of
     * a function value (tables and upvalue writes are cgen-op below), so the
     * only escapes left are a returned function and a write to a
     * function-typed global outside the chunk.  Check those first. */
    var fnType = {};
    for (var gf = 0; gf < (program.globals || []).length; gf++) {
      fnType[program.globals[gf].name] = program.globals[gf].type;
    }
    var closureEscapes = false;
    for (f = 0; f < functions.length; f++) {
      var esc = functions[f].code;
      for (pc = 0; pc < esc.length; pc++) {
        var ei = esc[pc];
        if (ei.t === "ret" && staticType(ei.src) === "fn") closureEscapes = true;
        if (ei.t === "setglobal" && fnType[ei.name] === "fn" && f !== 0) {
          closureEscapes = true;
        }
        if (ei.t === "setupval" && staticType(ei.src) === "fn") {
          closureEscapes = true;
        }
        if (ei.t === "tset" && staticType(ei.value) === "fn") {
          closureEscapes = true;
        }
      }
    }

    /* One static closure slot per closure instruction site.  A site inside a
     * loop recreates the closure over the same slot; that is exact when the
     * value cannot escape (above), and refused otherwise. */
    var closureSites = [];
    var closureAt = {};
    for (f = 0; f < functions.length; f++) {
      var code = functions[f].code;
      var backEdges = [];
      for (pc = 0; pc < code.length; pc++) {
        var ins = code[pc];
        var t = null;
        if (ins.t === "jmp" || ins.t === "br" || ins.t === "fornext") t = ins.target;
        if (t != null && t <= pc) backEdges.push([t, pc]);
      }
      for (pc = 0; pc < code.length; pc++) {
        if (code[pc].t !== "closure") continue;
        for (var b = 0; b < backEdges.length; b++) {
          if (pc >= backEdges[b][0] && pc <= backEdges[b][1] && closureEscapes) {
            fail("cgen-closure-loop",
                 "function " + functions[f].name + ": a closure is created " +
                 "inside a loop (IL line " + code[pc].line + ") and a " +
                 "function value can be stored in this program; one static " +
                 "slot per site is not enough", code[pc].line);
          }
        }
        closureAt[f + ":" + pc] = closureSites.length;
        closureSites.push({ fn: f, pc: pc, cid: closureSites.length,
                            fid: code[pc].fid });
      }
    }
    /* Each closure's upvalues sit in one flat array, one run per site sized to
     * its target function's own upvalue count (a slot per site sized for the
     * largest function was 3 KiB of the console's 8 KiB for DUSK RUN). */
    var closureBase = [], upsTotal = 0;
    for (var cs = 0; cs < closureSites.length; cs++) {
      closureBase.push(upsTotal);
      upsTotal += Math.max(1, (functions[closureSites[cs].fid].upvalues || []).length);
    }

    /* Tables (#176): one static slot per `table` instruction site in the
     * fixed pool, zeroed and reused each time the site runs — the same model
     * the interpreter runs (docs/TABLES-PLAN.md §2).  The layout is the
     * encoder's own tableLayout(), so the encoder and this backend report
     * the same sites and cells for the same IL; the refusals mirror the
     * encoder's rule (pce-ilbc.js buildTableSection) with this backend's
     * codes. */
    var usesTables = false, usesSprites = false;
    for (f = 0; f < functions.length && !(usesTables && usesSprites); f++) {
      for (pc = 0; pc < functions[f].code.length; pc++) {
        var okt = functions[f].code[pc].t;
        if (TABLE_OPS[okt]) usesTables = true;
        if (okt === "sprite") usesSprites = true;
      }
    }
    /* music/sfx/release and the note builtin lower to toy_sound.h (the native
     * sound glue, docs/NATIVE-SOUND.md): the boot and each frame then call it. */
    var usesSound = false;
    for (f = 0; f < functions.length && !usesSound; f++) {
      for (pc = 0; pc < functions[f].code.length; pc++) {
        var ost = functions[f].code[pc];
        if (ost.t === "music" || ost.t === "sfx" || ost.t === "release" ||
            (ost.t === "builtin" && ost.name === "note")) { usesSound = true; break; }
      }
    }
    var table = null;
    var tableSiteAt = [];
    var tableFieldIds = {};
    /* #190: a sprite's spec is a table site, so a sprite toy needs the
     * walker's layout even if it builds its spec some other way.  The
     * sprite records (table.sprites) are the SAME resolution the encoder
     * consumes (#133), so both backends resolve and refuse identical
     * sites; this backend only maps a refusal to cgen-op. */
    if (usesTables || usesSprites) {
      table = ilbc.tableLayout(program);
      for (var si = 0; si < table.sites.length; si++) {
        var site = table.sites[si];
        /* A slot's cap/fields are emitted as uint8_t arrays, so a shape
         * that does not fit one byte would silently truncate in the C. */
        if (site.cap > 255 || site.nfields > 255) {
          fail("cgen-table-ram", "the table at function " + site.fid +
               " pc " + site.pc + " (line " + site.line + ") needs " +
               site.cap + " array cells and " + site.nfields +
               " field cells; the pool's cap/fields are one byte", site.line);
        }
        if (site.escapes && site.repeats) {
          fail("cgen-table-escape", "the table at function " + site.fid +
               " pc " + site.pc + " (line " + site.line + ") can run more " +
               "than once and escapes; one static slot would alias two " +
               "tables", site.line);
        }
        if (site.maxKey != null && (site.maxKey > site.cap || site.maxKey < 1)) {
          fail("cgen-table-ram", "a constant key " + site.maxKey + " at " +
               "function " + site.fid + " pc " + site.pc + " is outside " +
               "its slot's array part (cap " + site.cap + ")", site.line);
        }
        if (site.readMaxField != null && site.readMaxField >= site.nfields) {
          fail("cgen-table-ram", "a field id " + site.readMaxField +
               " read at function " + site.fid + " pc " + site.pc +
               " is past the slot's " + site.nfields + " field cells",
               site.line);
        }
        if (tableSiteAt[site.fid] == null) {
          tableSiteAt[site.fid] = new Array(functions[site.fid].code.length);
        }
        tableSiteAt[site.fid][site.pc] = site.id;
      }
      for (var fi = 0; fi < table.fieldIds.length; fi++) {
        tableFieldIds[table.fieldIds[fi]] = fi;
      }
      if (table.cells > ilbc.TABLE_POOL_CELLS) {
        fail("cgen-table-ram", "the table slots need " + table.cells +
             " cells; the fixed pool is " + ilbc.TABLE_POOL_CELLS, null);
      }
    }

    /* Globals: the IL declares their types.  This backend carries function
     * values and the int/bool scalars a toy keeps between frames (the greedy
     * global `g_f` the raster toys use); the surface names are
     * instructions/constants, never values, except `vram`, which vset/vget
     * ignore. */
    var typeOf = {};
    var g;
    for (g = 0; g < (program.globals || []).length; g++) {
      typeOf[program.globals[g].name] = program.globals[g].type;
    }
    var globalIds = {};
    var globalNames = [];
    function globalId(name) {
      if (!Object.prototype.hasOwnProperty.call(globalIds, name)) {
        globalIds[name] = globalNames.length;
        globalNames.push(name);
      }
      return globalIds[name];
    }
    /* The hooks are always slots so the runtime can find them. */
    globalId("init");
    globalId("frame");
    if (hookRaster != null) globalId("raster");
    for (f = 0; f < functions.length; f++) {
      for (pc = 0; pc < functions[f].code.length; pc++) {
        var gi = functions[f].code[pc];
        /* vram needs no slot: vset/vget carry no base operand and its
         * getglobal lowers to a defined zero. */
        if ((gi.t === "getglobal" || gi.t === "setglobal") &&
            (typeOf[gi.name] === "fn" || typeOf[gi.name] === "int" ||
             typeOf[gi.name] === "bool" || typeOf[gi.name] === "table")) {
          globalId(gi.name);
        }
      }
    }

    /* The TMA timer (#45): because the toy has called timer(period, fn), the
     * runtime must raise the timer's interrupt and pump fn from the frame
     * loop.  One flag for the emitter; the backend never guesses. */
    var usesTimer = false;
    for (f = 0; f < functions.length; f++) {
      for (pc = 0; pc < functions[f].code.length; pc++) {
        if (functions[f].code[pc].t === "timer") usesTimer = true;
      }
    }

    return {
      functions: functions,
      maxUps: maxUps,
      maxParams: maxParams,
      closureAt: closureAt,
      closureBase: closureBase,
      upsTotal: Math.max(1, upsTotal),
      closureCount: closureSites.length,
      typeOf: typeOf,
      usesTimer: usesTimer,
      globalIds: globalIds,
      globalNames: globalNames,
      hookInit: program.hooks.init != null,
      hookFrame: program.hooks.frame,
      hookRaster: hookRaster,
      usesTables: usesTables,
      usesSound: usesSound,
      usesSprites: usesSprites,
      table: table,
      sprites: table ? table.sprites : null,
      tableSiteAt: tableSiteAt,
      tableFieldIds: tableFieldIds
    };
  }

  /* The table form of raster(line, spec): which fields the spec table sets,
   * read off the IL (the `table` site and the `tset`s with a string key that
   * come before the call, in one straight run).  Returns the field names, or
   * a string saying why not.  A spec built across a branch, or with a key that
   * is not bxr/byr/cr, is refused here rather than guessed at. */
  var RASTER_KEYS = { bxr: 1, byr: 2, cr: 4 };
  function rasterSpecKeys(fn, pc) {
    var ins = fn.code[pc];
    if (!ins.spec || ins.spec.r == null) return "the spec is not a table value";
    var reg = ins.spec.r, targets = {}, q, keys = [];
    for (q = 0; q < fn.code.length; q++) {
      var t = fn.code[q];
      if (t.t === "jmp" || t.t === "br" || t.t === "fornext") targets[t.target] = true;
    }
    for (q = pc - 1; q >= 0; q--) {
      var c = fn.code[q];
      if (c.t === "table" && c.dst === reg) {
        if (targets[q]) return "the spec table is built across a branch";
        return keys;
      }
      if (targets[q + 1] && q + 1 !== pc) {
        /* a branch lands inside the run that builds the spec */
        return "the spec table is built across a branch";
      }
      if (c.t === "tset" && c.base && c.base.r === reg) {
        if (!c.key || !c.key.k || c.key.k.t !== "str") return "the spec has a non-field key";
        if (!RASTER_KEYS[c.key.k.v]) return "the spec field `" + c.key.k.v + "` is not bxr, byr or cr (cram is not lowered)";
        if (keys.indexOf(c.key.k.v) < 0) keys.push(c.key.k.v);
      } else if (c.dst === reg || (c.t === "call" && c.dst === reg)) {
        return "the spec register is rewritten before the call";
      }
    }
    return "the spec table is not built in this function";
  }

  /* Registers read before any write on a linear path.  The llvm-mos
   * dialect zero-initialises the whole register file (`int32_t r[N] = { 0 }`);
   * HuC's C has no initialiser list for a local array, so this backend emits
   * an explicit `r[i] = 0;` for exactly those registers.  A register that is
   * written first needs no initial value and costs nothing.  (Linear order
   * is enough: the IL's registers are the Lua VM's, and a branch target
   * always has its value from a path that wrote it first.) */
  function registersReadFirst(fn, functions, loopVars) {
    var need = {};
    var written = {};
    var pc, j;
    function readReg(index) {
      if (index != null && !written[index]) need[index] = true;
    }
    function readOp(o) {
      if (o && o.r != null) readReg(o.r);
    }
    for (j = 0; j < fn.params.length; j++) written[j] = true;
    for (pc = 0; pc < fn.code.length; pc++) {
      var ins = fn.code[pc];
      var ops = [ins.a, ins.b, ins.cond, ins.callee, ins.value, ins.addr,
                 ins.word, ins.lineArg, ins.spec, ins.i, ins.k, ins.key,
                 ins.n, ins.pad];
      if (ins.t === "move" || ins.t === "ret") ops.push(ins.src);
      if (ins.args) ops = ops.concat(ins.args);
      if (ins.values) ops = ops.concat(ins.values);
      if (ins.t === "forprep") { readReg(ins.base); readReg(ins.base + 2); }
      if (ins.t === "fornext") {
        readReg(ins.base); readReg(ins.base + 1); readReg(ins.base + 2);
      }
      for (j = 0; j < ops.length; j++) readOp(ops[j]);
      if (ins.t === "closure") {
        var target = functions && functions[ins.fid];
        var ups = target ? target.upvalues : [];
        for (j = 0; j < ups.length; j++) {
          if (ups[j].from === "reg") readReg(ups[j].index);
        }
      }
      if (ins.t === "forprep") {
        written[ins.base] = true;
        /* #292 (range analysis): the body only runs after fornext has set the loop variable */
        if (loopVars) written[ins.base + 3] = true;
      } else if (ins.t === "fornext") {
        written[ins.base] = true;
        written[ins.base + 3] = true;
      } else if (ins.dst != null) written[ins.dst] = true;
    }
    var list = Object.keys(need).map(Number).sort(function (x, y) {
      return x - y;
    });
    return list;
  }

  function fixedIsUsed(fn) {
    var used = {};
    var i, j;
    for (i = 0; i < fn.code.length; i++) {
      var ins = fn.code[i];
      var ops = [ins.a, ins.b, ins.cond, ins.src, ins.callee, ins.value,
                 ins.addr, ins.word, ins.lineArg, ins.spec, ins.i,
                 ins.k, ins.key, ins.base, ins.n, ins.pad];
      if (ins.args) ops = ops.concat(ins.args);
      if (ins.values) ops = ops.concat(ins.values);
      for (j = 0; j < ops.length; j++) {
        if (ops[j] && ops[j].r != null) used[ops[j].r] = true;
      }
    }
    for (i = 0; i < fn.params.length; i++) {
      if (fn.params[i] === "fixed" && used[i]) return true;
    }
    return false;
  }

  /* ---- validation: refuse outside part A, naming the construct --------- */

  /* ---- division by a constant, exactly (the console's software divide is ~1,500 cycles) ----
   * llvm-mos does 32-bit arithmetic at 60-85 cycles per bit of shift, so a reciprocal multiply in 32 bits
   * is no faster than the library divide (measured, 1,650 to 2,400 cycles).  This stays in 16 bits:
   * for a 16-bit dividend a = ah*256 + al and M = floor(65536 / c) = Mh*256 + Ml, the quotient is
   * estimated as  ah*Mh + (ah*Ml >> 8) + (al*Mh >> 8)  (three 8-bit variable times constant products;
   * it never overshoots, and falls short by at most a few), the remainder r = a - q*c is formed, and
   * up to K steps of `if (r >= c) { q++; r -= c; }` finish it.  K is found here by running the exact
   * C arithmetic for ALL 65,536 dividends, so the helper is exact by construction; a constant that
   * needs more than MAX_FIX steps gets no helper and keeps the generic one. */
  var magicCache = {};
  var MAX_FIX = 4;
  function findMagic(c) {
    if (magicCache[c] !== undefined) return magicCache[c];
    var M = Math.floor(65536 / c), Mh = M >> 8, Ml = M & 255, k = 0, a, ok = true;
    for (a = 0; a <= 65535; a++) {
      var ah = a >> 8, al = a & 255;
      var q = ah * Mh + ((ah * Ml) >> 8) + ((al * Mh) >> 8);
      var r = a - q * c;
      var fix = 0;
      if (r < 0) { ok = false; break; }                 /* an overshoot: never happens, but never trust */
      while (r >= c) { q++; r -= c; fix++; if (fix > MAX_FIX) break; }
      if (fix > MAX_FIX || q !== Math.floor(a / c)) { ok = false; break; }
      if (fix > k) k = fix;
    }
    magicCache[c] = ok ? { M: M, Mh: Mh, Ml: Ml, fix: k } : null;
    return magicCache[c];
  }
  /* signed-digit (non-adjacent) form of a constant: [{shift, sign}] with the fewest nonzero digits */
  function nafTerms(m) {
    var terms = [], bit = 0;
    while (m > 0) {
      if (m & 1) { var digit = 2 - (m & 3); terms.push({ shift: bit, sign: digit }); m = m - digit; }
      m = Math.floor(m / 2); bit++;
    }
    return terms;
  }
  /* `dest = src * K` in 16 bits as an explicit shift-add chain.  llvm-mos expands a multiply by a constant
   * inline only for a few simple constants and calls __mulhi3 (200+ cycles) for the rest, so a constant
   * with more than two signed digits is written out; an empty asm statement that "modifies" the value
   * after each step stops llvm folding the chain back into the multiply (and the libcall). */
  function mulChain(dest, src, K, indent, out) {
    var terms = nafTerms(K).sort(function (x, y) { return y.shift - x.shift; });
    if (terms.length <= 2) { out.push(indent + "uint16_t " + dest + " = (uint16_t)(" + src + " * " + K + "u);"); return; }
    out.push(indent + "uint16_t " + dest + " = " + src + ";");
    for (var k = 1; k < terms.length; k++) {
      out.push(indent + dest + " = (uint16_t)((uint16_t)(" + dest + " << " + (terms[k - 1].shift - terms[k].shift) + ") " +
               (terms[k].sign < 0 ? "- " : "+ ") + src + ");");
      out.push(indent + "__asm__ volatile(\"\" : \"+r\"(" + dest + "));");
    }
    var low = terms[terms.length - 1].shift;
    if (low) out.push(indent + dest + " = (uint16_t)(" + dest + " << " + low + ");");
  }
  /* statements computing uint16_t qq (floor(a / c)) and uint16_t rr (a - q*c) from the uint16_t variable `a` */
  function magicQuotientLines(m, c, indent, out) {
    out.push(indent + "uint16_t vh = (uint16_t)(a >> 8), vl = (uint16_t)(a & 255u);");
    var parts = [];
    if (m.Mh) { mulChain("p1", "vh", m.Mh, indent, out); parts.push("p1"); }
    if (m.Ml) { mulChain("p2", "vh", m.Ml, indent, out); parts.push("(uint16_t)(p2 >> 8)"); }
    if (m.Mh) { mulChain("p3", "vl", m.Mh, indent, out); parts.push("(uint16_t)(p3 >> 8)"); }
    out.push(indent + "uint16_t qq = " + (parts.length ? parts.join(" + ") : "0") + ";");
    mulChain("qc", "qq", c, indent, out);
    out.push(indent + "uint16_t rr = (uint16_t)(a - qc);");
    for (var f = 0; f < m.fix; f++) out.push(indent + "if (rr >= " + c + "u) { qq++; rr -= " + c + "u; }");
  }

  function validate(program, a, huc, issues) {
    var uses = { mod: false, idiv: false, shl: false, shr: false, mul: false, divc: {}, mulc: {} };
    var i, j;
    for (i = 0; i < a.functions.length; i++) {
      var fn = a.functions[i];
      if (fixedIsUsed(fn)) {
        var fmsg = "function " + fn.name +
                   " reads a fixed-point parameter; part A passes t = 0";
        if (issues) {
          issues.push(new CGenError("cgen-fixed", fmsg,
            fn.code && fn.code.length ? fn.code[0].line : null));
        } else {
          refuse("cgen-fixed", fmsg);
        }
      }
      for (j = 0; j < fn.code.length; j++) {
        var ins = fn.code[j];
        var where = "function " + fn.name + ", IL line " + ins.line +
                    ", instruction `" + ins.t + "`";
        /* check() runs every instruction and keeps going, so one toy can
         * report all its refusals at once; emitC() has no collector and the
         * first refusal throws exactly as before. */
        try {
        switch (ins.t) {
        case "const":
          if (ins.k && ins.k.t === "fixed") {
            refuse("cgen-fixed", where + ": a fixed-point constant");
          }
          if (!ins.k || (ins.k.t !== "int" && ins.k.t !== "bool" &&
                         ins.k.t !== "nil")) {
            refuse("cgen-key", where + ": a `" + (ins.k && ins.k.t) +
                   "` constant");
          }
          break;
        case "move":
        case "getupval":
        case "jmp":
        case "pal":
        case "vset":
        case "forprep":
        case "fornext":
        case "closure":
          break;
        case "ret":
          /* A returned function value would outlive its static closure slot
           * (this backend has one per site).  No toy in the card returns a
           * function; refusing is what keeps the slot scheme sound. */
          if (staticType(ins.src) === "fn") {
            refuse("cgen-op", where + ": returning a function value");
          }
          break;
        case "getglobal":
        case "setglobal":
          if (!Object.prototype.hasOwnProperty.call(a.typeOf, ins.name)) {
            refuse("cgen-global", where + ": global `" + ins.name +
                   "` has no declared type");
          }
          if (!/^(fn|vram|int|bool|padset|table)$/.test(a.typeOf[ins.name])) {
            refuse("cgen-global", where + ": global `" + ins.name + "` is " +
                   a.typeOf[ins.name] + "; this backend carries fn/vram/" +
                   "int/bool/pad/table");
          }
          break;
        case "reg":
          /* The toy surface's register write, which part C needs for a
           * per-line scroll.  Only the three the host allows, and only by
           * the IL's constant-string name (the host refuses the rest). */
          if (ins.name !== "BXR" && ins.name !== "BYR" && ins.name !== "CR") {
            refuse("cgen-op", where + ": reg(\"" + ins.name + "\") is not a " +
                   "toy register (BXR, BYR, CR)");
          }
          if (staticType(ins.value) !== "int") {
            refuse("cgen-op", where + ": reg()'s value is " +
                   staticType(ins.value) + ", not int");
          }
          break;
        case "arith":
          if (ins.type !== "int") {
            refuse("cgen-fixed", where + ": `" + ins.type + "` arithmetic");
          }
          if (!huc && (ins.op === "mod" || ins.op === "idiv") && ins.b && ins.b.k && ins.b.k.t === "int") {
            var dcv = ins.b.k.v | 0;
            if (dcv >= 3 && dcv <= 32768 && (dcv & (dcv - 1)) !== 0 && findMagic(dcv)) {
              uses.divc[ins.op + ":" + dcv] = { op: ins.op, c: dcv };
            }
          }
          if (ins.op === "mod") uses.mod = true;
          else if (ins.op === "idiv") uses.idiv = true;
          else if (ins.op === "shl") uses.shl = true;
          else if (ins.op === "shr") uses.shr = true;
          else if (ins.op === "mul") {
            uses.mul = true;
            if (!huc) {
              var mk = ins.a && ins.a.k && ins.a.k.t === "int" ? ins.a.k.v | 0 : (ins.b && ins.b.k && ins.b.k.t === "int" ? ins.b.k.v | 0 : null);
              if (mk != null && mk >= 3 && mk <= 4095 && (mk & (mk - 1)) !== 0) uses.mulc[mk] = true;
            }
          }
          else if (["add", "sub", "band", "bor", "bxor"]
                   .indexOf(ins.op) < 0) {
            refuse("cgen-op", where + ": arithmetic `" + ins.op + "`");
          }
          break;
        case "unm":
          if (ins.type !== "int") {
            refuse("cgen-fixed", where + ": `" + ins.type + "` negation");
          }
          break;
        case "bnot":
        case "not":
          break;
        case "cmp":
          if (ins.type === "fixed") {
            refuse("cgen-fixed", where + ": a fixed-point comparison");
          }
          if (ins.type === "bool" && ins.op !== "eq") {
            refuse("cgen-op", where + ": an order comparison on bools");
          }
          break;
        case "br":
          if (staticType(ins.cond) !== "bool") {
            refuse("cgen-cond", where + ": the condition is " +
                   staticType(ins.cond) + ", not bool");
          }
          break;
        case "call":
          if (ins.args.length > ilbc.MAX_ARGS) {
            refuse("cgen-arity", where + ": " + ins.args.length + " arguments");
          }
          break;
        case "sat":
          /* the SAT word (toy_sat): what a moving sprite needs */
          if (staticType(ins.i) !== "int" || staticType(ins.k) !== "int" ||
              staticType(ins.v) !== "int") {
            refuse("cgen-op", where + ": sat()'s arguments must be ints");
          }
          break;
        case "sprite": {
          /* #190: the six operands are pce-ilbc.js's resolved spec (#133),
           * and every guard that produced them is the encoder's own, so
           * this backend refuses exactly the sites the encoder refuses —
           * with this backend's code.  Nothing here re-derives a field. */
          var sprs = a.sprites && a.sprites[i];
          var spr = sprs ? sprs[j] : null;
          if (!spr || !spr.ok) {
            refuse("cgen-op", where + ": " + (spr && spr.why
                   ? spr.why : "the sprite has no resolved spec"));
          }
          break;
        }
        case "raster": {
          /* raster(line, spec): the table form; the spec's fields are read off
           * the IL, the values at the call (toy_raster_entry). */
          var rk = rasterSpecKeys(fn, j);
          if (typeof rk === "string") refuse("cgen-op", where + ": " + rk);
          if (staticType(ins.lineArg) !== "int") {
            refuse("cgen-op", where + ": raster()'s line must be an int");
          }
          for (var rki = 0; rki < rk.length; rki++) {
            if (!Object.prototype.hasOwnProperty.call(a.tableFieldIds, rk[rki])) {
              refuse("cgen-op", where + ": the spec field `" + rk[rki] + "` has no cell");
            }
          }
          break;
        }
        case "padget":
          /* pad[n].field (#45): the console reads the port, the host the
           * scripted state; the C is toy_pad(n, field).  The base operand is
           * the pad head the padref before it made (`tt: "pad"`), which is
           * the pad number itself — the interpreter's padref does the same. */
          if (staticType(ins.pad) !== "pad" && staticType(ins.pad) !== "int") {
            refuse("cgen-op", where + ": pad[n]'s n must be an int");
          }
          break;
        case "padref":
          /* pad[n]'s n, held in a register for the padget that indexes it */
          if (staticType(ins.n) !== "int") {
            refuse("cgen-op", where + ": pad[n]'s n must be an int");
          }
          break;
        case "timer":
          /* timer(period, fn): the runtime's TMA timer and the deferred
           * callback, pumped at the top of toy_frame */
          if (staticType(ins.period) !== "int") {
            refuse("cgen-op", where + ": timer()'s period must be an int");
          }
          if (ins.fn && staticType(ins.fn) !== "fn") {
            refuse("cgen-op", where + ": timer()'s callback must be a function");
          }
          break;
        case "builtin":
          /* rgb and note are the value-returning builtins lowered (toy_rgb,
           * toy_note). */
          if (ins.name !== "rgb" && ins.name !== "note") {
            refuse("cgen-op", where + ": builtin `" + ins.name + "` (part A " +
                   "lowers rgb and note only)");
          }
          break;
        case "music":
          /* #197: the sound surface lowers to the runtime's toy_music /
           * toy_sfx / toy_release — the engine's calls, declared by #198's
           * link (tools/toyc/toy_runtime.h does not carry them yet, so a
           * sound toy's C does not build until then).  The operands are ints
           * by the IL's arity checks; these are the same belt-and-braces
           * guards sat() has. */
          if (staticType(ins.song) !== "int") {
            refuse("cgen-op", where + ": music()'s song must be an int");
          }
          break;
        case "sfx":
          if (staticType(ins.ch) !== "int" || staticType(ins.freq) !== "int" ||
              staticType(ins.volume) !== "int" ||
              staticType(ins.frames) !== "int") {
            refuse("cgen-op", where + ": sfx()'s channel, freq, volume and " +
                   "frames must be ints");
          }
          break;
        case "release":
          if (staticType(ins.ch) !== "int") {
            refuse("cgen-op", where + ": release()'s channel must be an int");
          }
          break;
        case "table":
        case "setlist":
        case "tget":
        case "tset":
          /* #176: the four table ops lower to the fixed pool.  HuC's int is
           * 16 bits (defs.h, INTSIZE 2), so the pool's 32-bit cells cannot
           * round-trip a value there — the dialect refuses all four. */
          if (huc) {
            refuse("cgen-op", where + ": HuC's int is 16 bits and the table " +
                   "pool's cells are 32");
          }
          /* The base operand is a register in every IL this compiler
           * produces (pce-il.js loads an upvalue table into a scratch
           * register first); refusing the impossible shape mirrors the
           * encoder's ilbc-table-key. */
          if ((ins.t === "setlist" || ins.t === "tget" || ins.t === "tset") &&
              (!ins.base || ins.base.r == null)) {
            refuse("cgen-op", where + ": a table base must be a register");
          }
          if (ins.t === "tget" || ins.t === "tset") {
            /* A string key is a field, an int constant/register an array
             * index — anything else (fixed, bool, missing) is cgen-op or
             * falls out of constLitImpl as cgen-fixed/cgen-key. */
            var kt = !ins.key ? "none"
                   : ins.key.r != null ? "register"
                   : ins.key.k ? ins.key.k.t : "none";
            if (kt !== "str" && kt !== "int" && kt !== "register") {
              refuse("cgen-op", where + ": a table key must be a string " +
                     "field or an int operand");
            }
          }
          break;
        default:
          refuse("cgen-op", where + ": not lowered by this backend (" +
                 "init/frame/raster and the reg/pal/vset/sat/sprite/" +
                 "pad/table instructions, the timer and the sound surface " +
                 "only; no fixed point or print)");
        }
        var t = (ins.t === "jmp" || ins.t === "br" || ins.t === "fornext")
                ? ins.target : null;
        if (t != null && (typeof t !== "number" || t < 0 || t >= fn.code.length)) {
          refuse("cgen-target", where + ": target " + t + " is not an instruction");
        }
        } catch (e) {
          if (!issues || !(e instanceof CGenError)) throw e;
          if (e.line == null && ins.line != null) e.line = ins.line;
          issues.push(e);
        }
      }
    }
    return uses;
  }

  /* ---- the emitter ------------------------------------------------------ */

  function emitC(program, options) {
    var huc = !!(options && options.target === "huc");
    var a = analyse(program);
    var uses = validate(program, a, huc);
    var out = [];
    var i;
    function line(s) { out.push(s); }

    /* The IL's 32-bit int is the C dialect's int.  In HuC that is a 16-bit
     * signed int; the type name is the only thing that changes here. */
    var T = huc ? "int" : "int32_t";
    var U = huc ? "unsigned int" : "uint32_t";

    /* Dialect-aware operand helpers, shadowing the module-level ones for
     * everything emitted by this program. */
    var constLit = function (k) { return constLitImpl(k, huc); };
    var operand = function (o) { return operandImpl(o, huc); };

    /* Two argument slots unless some function of the toy takes more (the
     * #29 examples' batfill takes four).  Keeping the two-slot signature for
     * toys that never need it is what leaves part A's palette ROM
     * byte-identical.  #183: a function of five to eight parameters keeps
     * this four-slot signature and reads parameters 5..8 from il_xargs, the
     * extra-argument block (tools/ilvm/ilvm.c's `xargs`). */
    var ARGS = a.maxParams > 2 ? ["a0", "a1", "a2", "a3"] : ["a0", "a1"];
    var WIDE = a.maxParams > 4;
    var SIG = ARGS.map(function (n) { return T + " " + n; }).join(", ");
    function argOf(ins, k) {
      return ins.args[k] ? operand(ins.args[k]) : "0";
    }
    function callArgs(list) {
      var out = [];
      for (var k = 0; k < ARGS.length; k++) {
        out.push(k < list.length ? list[k] : "0");
      }
      return out.join(", ");
    }

    /* A function over SPLIT_OVER IL instructions is emitted as chunks of
     * SPLIT_CHUNK instructions, each its own C function, and a small
     * dispatcher with the same name (compiler step 1: a banked ROM links a
     * function into one 8 KiB bank, and DUSK RUN's frame() alone is 10.9 KB).
     * The registers r[] are a static array of the function (a pointer
     * parameter made every access 2-3x the code on the 6502, measured), so a
     * split function must not be re-entered: the dispatcher guards it with
     * il_split_reentered, which stays 0 unless a split function ran inside
     * itself (a recursive game function; none of the gallery's is).  A
     * chunk is entered at an IL pc (its first, or a label another chunk jumps
     * to) and returns the pc to continue at, or -1 after a `ret` (the value
     * goes through *rv).  Every C temporary is block-scoped inside one IL
     * instruction, so nothing but r[] crosses a chunk.  IL_CHUNK_CALL is the
     * hook a banked build uses to map the chunk's bank around the call
     * (tools/bank-toyc.py); by default it is the call itself. */
    var SPLIT_OVER = (options && options.splitOver) || Infinity;   /* off unless asked: tools/build-toyc-banked.sh splits only what a bank cannot hold */
    var SPLIT_CHUNK = (options && options.splitChunk) || 100;
    var NO_DIRECT = !!(options && options.noDirect);
    var SPLIT_ONLY = (options && options.splitOnly) || null;   /* test aid: fids */
    /* Direct calls: a call whose callee is known when the program is compiled skips il_call (a
     * closure lookup, a ~35-case switch and a bank map around every call: a third of TOWER's and
     * STARFALL's time, measured with tools/pcprof.py).  Almost every call is `getupval` of a local
     * function.  The closure a register holds at a point is the nearest earlier write to it in
     * straight-line code; an upvalue is the value its parent's register held when the closure was
     * created (this backend copies upvalues by value, and it refuses setupval, so nothing changes
     * them later).  resolveReg()/resolveUp() follow that back to a `closure` instruction and return
     * its static slot, or null, and the call stays an il_call. */
    var jumpTargets = [];
    a.functions.forEach(function (f, fi) {
      var tg = {};
      f.code.forEach(function (c) {
        if ((c.t === "jmp" || c.t === "br" || c.t === "fornext") && c.target != null) tg[c.target] = true;
      });
      jumpTargets[fi] = tg;
    });
    var sitesOfFid = {};
    Object.keys(a.closureAt).forEach(function (key) {
      var parts = key.split(":"), sf = +parts[0], sp = +parts[1];
      var tf = a.functions[sf].code[sp].fid;
      (sitesOfFid[tf] = sitesOfFid[tf] || []).push({ fn: sf, pc: sp, cid: a.closureAt[key] });
    });
    function resolveReg(fi, pc, reg, depth) {
      if (depth > 8 || reg == null) return null;
      var code = a.functions[fi].code, tg = jumpTargets[fi];
      for (var q = pc - 1; q >= 0; q--) {
        var d = code[q];
        if (d.dst === reg) {
          if (d.t === "closure") return { fid: d.fid, cid: a.closureAt[fi + ":" + q] };
          /* #292: a constant (a loop limit kept in a local or a once-assigned global) */
          if (d.t === "const" && d.k && d.k.t === "int") return { kint: d.k.v | 0 };
          /* #292: the value is one `table` site's slot (a static table) */
          if (d.t === "table") return { tsite: a.tableSiteAt[fi] ? a.tableSiteAt[fi][q] : null };
          if (d.t === "move" && d.src && d.src.r != null) return resolveReg(fi, q, d.src.r, depth + 1);
          if (d.t === "getupval") return resolveUp(fi, d.idx, depth + 1);
          if (d.t === "getglobal") return resolveGlobal(d.name, depth + 1);
          return null;
        }
        /* a write to the register we cannot see, or a join point: give up */
        if (d.t === "forprep" || d.t === "fornext") return null;
        if (tg[q]) return null;
      }
      return null;
    }
    /* A global function (`function put() ... end`) is assigned once in the main chunk.  If exactly one
     * setglobal in the whole program writes the name, and the register it stores holds a closure at that
     * point, the global is that closure for any call that runs after the main chunk has set it up. */
    var globalSets = {};
    a.functions.forEach(function (f, fi) {
      f.code.forEach(function (c, pc) {
        if (c.t === "setglobal") (globalSets[c.name] = globalSets[c.name] || []).push({ fn: fi, pc: pc, src: c.src });
      });
    });
    function resolveGlobal(name, depth) {
      var sets = globalSets[name];
      if (!sets || sets.length !== 1 || depth > 8) return null;
      var st = sets[0];
      if (st.src && st.src.k && st.src.k.t === "int") return { kint: st.src.k.v | 0 };
      if (!st.src || st.src.r == null) return null;
      return resolveReg(st.fn, st.pc, st.src.r, depth + 1);
    }
    function resolveUp(fi, u, depth) {
      var desc = a.functions[fi].upvalues && a.functions[fi].upvalues[u];
      var sites = sitesOfFid[fi];
      if (!desc || !sites || sites.length !== 1 || depth > 8) return null;
      if (desc.from === "reg") {
        var rr = resolveReg(sites[0].fn, sites[0].pc, desc.index, depth + 1);
        if (rr) return rr;
        /* #292: a main-chunk local kept for the whole run (`local N = 6`) has ONE writer: the constant */
        var pcode = a.functions[sites[0].fn].code, writer = null, nw = 0;
        pcode.forEach(function (w) {
          if (w.dst === desc.index) { nw++; writer = w; }
          else if ((w.t === "forprep" || w.t === "fornext") && desc.index >= w.base && desc.index <= w.base + 3) nw += 2;
        });
        if (a.functions[sites[0].fn].params.length > desc.index) nw += 2;
        if (nw === 1 && writer.t === "const" && writer.k && writer.k.t === "int") return { kint: writer.k.v | 0 };
        return null;
      }
      if (desc.from === "upval") return resolveUp(sites[0].fn, desc.index, depth + 1);
      return null;
    }
    function directCallee(fi, pc, ins) {
      if (huc || NO_DIRECT) return null;
      var c = ins.callee && ins.callee.r != null ? resolveReg(fi, pc, ins.callee.r, 0) : null;
      if (!c || c.fid == null) return null;
      var target = a.functions[c.fid];
      /* a function that is also the toy's hook or called with an unknown arity still takes the shared signature */
      return target ? c : null;
    }

    /* ---- #292: fast table access -------------------------------------------
     * tableTarget(): the `table` site a base operand provably holds (resolveReg follows moves,
     * upvalues and once-assigned globals), or null.  A known site's base, cap and field count are
     * compile-time constants, so tget/tset/setlist/raster read the cell directly.  rangeRegs():
     * conservative per-register intervals (idea borrowed from branch speed-range's rangeAnalysis:
     * flow-insensitive, a fixed point, FULL when unmodelled), used to drop a bounds check and to pick a
     * cell width.  slotKind[s]: 0 = int32 cells, 1 = uint8_t, 2 = int16_t, by the union of every
     * value any store can put in the slot. */
    var NO_STATIC_TABLES = !!(options && options.noStaticTables);   /* test aid: the helper path everywhere */
    function tableTarget(fi, pc, op) {
      if (huc || NO_STATIC_TABLES || !a.usesTables || !op || op.r == null) return null;
      var c = resolveReg(fi, pc, op.r, 0);
      return c && c.tsite != null ? c.tsite : null;
    }
    var rangeCache = {};
    function rangeRegs(fid) {
      if (rangeCache[fid]) return rangeCache[fid];
      var fn = a.functions[fid], n = Math.max(1, fn.registers), FULL = [-2147483648, 2147483647];
      var wdst = [], acc = [], forced = [], rng = [], q, r, iter;
      for (r = 0; r < n; r++) { wdst.push(null); acc.push(null); forced.push(false); rng.push(null); }
      for (r = 0; r < fn.params.length && r < n; r++) forced[r] = true;
      fn.code.forEach(function (c) {
        if (c.t === "forprep" || c.t === "fornext") forced[c.base] = true;
      });
      var rf = registersReadFirst(fn, a.functions, true), readFirst = {};
      rf.forEach(function (x) { readFirst[x] = true; });
      function fits(v) { return v >= FULL[0] && v <= FULL[1]; }
      function mk(lo, hi) { return fits(lo) && fits(hi) && lo <= hi ? [lo, hi] : FULL.slice(); }
      var atPc = null, depthLeft = 4;   /* while evaluating a local definition: the pc its operands are read at */
      function opr(o) {
        if (!o) return FULL;
        if (o.r != null) {
          var b = rng[o.r];
          if (atPc != null && b) {
            var l = localDef(atPc, o.r);
            if (l && Math.max(b[0], l[0]) <= Math.min(b[1], l[1])) return [Math.max(b[0], l[0]), Math.min(b[1], l[1])];
          }
          return b;
        }
        if (o.k) {
          if (o.k.t === "int") return [o.k.v | 0, o.k.v | 0];
          if (o.k.t === "bool") return o.k.v ? [1, 1] : [0, 0];
          if (o.k.t === "nil") return [0, 0];
        }
        return FULL;
      }
      function pow(k) { return Math.pow(2, k); }
      function nextP2m1(x) { var m = 1; while (m <= x) m *= 2; return m - 1; }
      function arithRange(c) {
        if (c.type !== "int") return FULL.slice();
        var A = opr(c.a), B = opr(c.b);
        if (!A || !B) return null;
        var cb = c.b && c.b.k && c.b.k.t === "int" ? c.b.k.v | 0 : null;
        switch (c.op) {
        case "add": return mk(A[0] + B[0], A[1] + B[1]);
        case "sub": return mk(A[0] - B[1], A[1] - B[0]);
        case "mul": {
          var ps = [A[0] * B[0], A[0] * B[1], A[1] * B[0], A[1] * B[1]];
          return mk(Math.min.apply(null, ps), Math.max.apply(null, ps));
        }
        case "mod":
          if (cb != null && cb > 0) return [0, cb - 1];
          if (cb != null && cb < 0) return [cb + 1, 0];
          return FULL.slice();
        case "idiv":
          if (cb != null && cb > 0) return mk(Math.floor(A[0] / cb), Math.floor(A[1] / cb));
          return FULL.slice();
        case "band":
          if (cb != null && cb >= 0) return [0, cb];
          if (c.a && c.a.k && c.a.k.t === "int" && (c.a.k.v | 0) >= 0) return [0, c.a.k.v | 0];
          if (A[0] >= 0 && B[0] >= 0) return [0, Math.min(A[1], B[1])];
          return FULL.slice();
        case "bor":
        case "bxor":
          if (A[0] >= 0 && B[0] >= 0) return [0, nextP2m1(Math.max(A[1], B[1]))];
          return FULL.slice();
        case "shl":
          if (cb != null && cb >= 0 && cb < 32 && A[0] >= 0) return mk(A[0] * pow(cb), A[1] * pow(cb));
          return FULL.slice();
        case "shr":
          if (cb != null && cb >= 0 && cb < 32 && A[0] >= 0) return [Math.floor(A[0] / pow(cb)), Math.floor(A[1] / pow(cb))];
          return FULL.slice();
        default: return FULL.slice();
        }
      }
      function defRange(c) {
        switch (c.t) {
        case "const":
          if (c.k && c.k.t === "int") return [c.k.v | 0, c.k.v | 0];
          if (c.k && c.k.t === "bool") return c.k.v ? [1, 1] : [0, 0];
          if (c.k && c.k.t === "nil") return [0, 0];
          return FULL.slice();
        case "move": { var m = opr(c.src); return m ? m.slice() : null; }
        case "getglobal": case "getupval": {
          var kr = c.t === "getglobal" ? resolveGlobal(c.name, 0) : resolveUp(fid, c.idx, 0);
          return kr && kr.kint != null ? [kr.kint, kr.kint] : FULL.slice();
        }
        case "arith": return arithRange(c);
        case "unm": {
          var u = opr(c.a);
          if (!u) return null;
          return c.type === "int" && u[0] > FULL[0] ? mk(-u[1], -u[0]) : FULL.slice();
        }
        case "not": case "cmp": return [0, 1];
        default: return FULL.slice();
        }
      }
      function union(x, y) { return !x ? (y ? y.slice() : null) : !y ? x.slice() : [Math.min(x[0], y[0]), Math.max(x[1], y[1])]; }
      function refresh(reg) {
        var v = forced[reg] ? FULL.slice() : acc[reg];
        if (!forced[reg] && readFirst[reg]) v = union(v, [0, 0]);
        if (!forced[reg] && !v) v = [0, 0];   /* never written: the zero it starts with */
        rng[reg] = v;
      }
      /* the range of `reg` as the nearest earlier write in straight-line code left it (a loop's start,
       * limit and step are set just before its forprep); FULL past a join point or an unmodelled write */
      function localDef(pc, reg) {
        var tg = jumpTargets[fid];
        if (tg[pc]) return FULL.slice();          /* paths join right here */
        for (var j = pc - 1; j >= 0; j--) {
          var d = fn.code[j];
          if (d.dst === reg) {
            var sp = atPc, sd = depthLeft, v;
            if (sd > 0) { atPc = j; depthLeft = sd - 1; } else atPc = null;
            v = defRange(d);
            atPc = sp; depthLeft = sd;
            return v;
          }
          if ((d.t === "forprep" || d.t === "fornext") && reg >= d.base && reg <= d.base + 3) return FULL.slice();
          if (tg[j]) return FULL.slice();
        }
        return FULL.slice();
      }
      rng.localDef = localDef;
      for (r = 0; r < n; r++) refresh(r);
      var last = {};
      for (iter = 0; iter < 12; iter++) {
        var changed = false;
        last = {};
        for (q = 0; q < fn.code.length; q++) {
          var c = fn.code[q], v = null, tgt = null;
          if (c.dst != null && c.dst < n) {
            tgt = c.dst;
            v = defRange(c);
            if (v) wdst[tgt] = union(wdst[tgt], v);
          } else if (c.t === "fornext" && c.base + 3 < n) {
            var fp = -1, fq;
            for (fq = q - 1; fq >= 0; fq--) if (fn.code[fq].t === "forprep" && fn.code[fq].base === c.base) { fp = fq; break; }
            var lo = fp < 0 ? FULL : localDef(fp, c.base), lm = fp < 0 ? FULL : localDef(fp, c.base + 1),
                st = fp < 0 ? FULL : localDef(fp, c.base + 2);
            tgt = c.base + 3;
            if (!st || !lo || !lm) v = null;
            else if (st[0] === st[1] && st[0] > 0) v = mk(lo[0], lm[1]);
            else if (st[0] === st[1] && st[0] < 0) v = mk(lm[0], lo[1]);
            else v = FULL.slice();
          }
          if (v && tgt != null) {
            var na = union(acc[tgt], v);
            if (!acc[tgt] || na[0] !== acc[tgt][0] || na[1] !== acc[tgt][1]) {
              acc[tgt] = na; last[tgt] = true; changed = true;
              refresh(tgt);
            }
          }
        }
        if (!changed) break;
        if (iter === 11) {
          Object.keys(last).forEach(function (k) { acc[k] = FULL.slice(); refresh(+k); });
          iter = 9;
        }
      }
      /* The loop variable r[base+3] as read at `pc` inside that loop's body, when nothing else in the
       * loop writes it: the loop's own start..limit, however the register is reused elsewhere. */
      rng.loopVar = function (pc, reg) {
        var fp, fe, best = null;
        for (fp = pc - 1; fp >= 0; fp--) {
          var f0 = fn.code[fp];
          if (f0.t !== "forprep" || f0.base + 3 !== reg) continue;
          for (fe = fp + 1; fe < fn.code.length; fe++) {
            var e0 = fn.code[fe];
            if (e0.t === "fornext" && e0.base === f0.base && e0.target != null && e0.target === fp + 2) break;
          }
          if (fe >= fn.code.length || fe < pc) continue;
          best = { fp: fp, fe: fe, base: f0.base };
          break;
        }
        if (!best) return null;
        for (var w = best.fp + 1; w <= best.fe; w++) {
          var x = fn.code[w];
          if (x.dst === reg) return null;
          if ((x.t === "forprep" || x.t === "fornext") && reg >= x.base && reg <= x.base + 3 && x.base !== best.base) return null;
        }
        var lo = localDef(best.fp, best.base), lm = localDef(best.fp, best.base + 1), st = localDef(best.fp, best.base + 2);
        if (!lo || !lm || !st) return null;
        if (st[0] === st[1] && st[0] > 0) return mk(lo[0], lm[1]);
        if (st[0] === st[1] && st[0] < 0) return mk(lm[0], lo[1]);
        return null;
      };
      return (rangeCache[fid] = rng);
    }
    /* [lo, hi] of an operand, or FULL */
    function opRange(fid, op, pc) {
      var FULL = [-2147483648, 2147483647];
      if (!op) return FULL;
      if (op.k) {
        if (op.k.t === "int") return [op.k.v | 0, op.k.v | 0];
        if (op.k.t === "bool") return op.k.v ? [1, 1] : [0, 0];
        if (op.k.t === "nil") return [0, 0];
        return FULL;
      }
      if (op.r != null) {
        var rgs = rangeRegs(fid), rr = rgs[op.r] || FULL;
        if (pc == null) return rr;
        /* every one of these holds at pc, so their intersection does too */
        var out = rr.slice();
        [rgs.loopVar(pc, op.r), rgs.localDef(pc, op.r)].forEach(function (x) {
          if (x && Math.max(out[0], x[0]) <= Math.min(out[1], x[1])) { out[0] = Math.max(out[0], x[0]); out[1] = Math.min(out[1], x[1]); }
        });
        return out;
      }
      return FULL;
    }
    /* the cell kind of every table slot; 0 = int32 everywhere when narrowing is off or there are no tables */
    var slotKind = [];
    var NO_NARROW = !!(options && options.noNarrowCells);
    (function () {
      if (!a.usesTables || !a.table) return;
      var ns = a.table.sites.length, s, un = [0, 0], per = [];
      for (s = 0; s < ns; s++) { slotKind.push(0); per.push([0, 0]); }
      if (huc || NO_NARROW) return;
      function widen(arr, rg) { arr[0] = Math.min(arr[0], rg[0]); arr[1] = Math.max(arr[1], rg[1]); }
      a.functions.forEach(function (f, fi) {
        f.code.forEach(function (c, pc) {
          var vals = c.t === "setlist" ? c.values : c.t === "tset" ? [c.value] : null;
          if (!vals) return;
          var ts = tableTarget(fi, pc, c.base);
          vals.forEach(function (v) {
            var rg = opRange(fi, v, pc);
            if (ts != null) widen(per[ts], rg); else widen(un, rg);
          });
        });
      });
      for (s = 0; s < ns; s++) {
        var u = [Math.min(per[s][0], un[0]), Math.max(per[s][1], un[1])];
        slotKind[s] = (u[0] >= 0 && u[1] <= 255) ? 1 : (u[0] >= -32768 && u[1] <= 32767) ? 2 : 0;
      }
    })();
    var KIND_CT = ["int32_t", "uint8_t", "int16_t"], KIND_POOL = ["il_table_cells", "il_cells8", "il_cells16"];
    var poolBase = [], poolCells = [1, 1, 1], anyNarrow = false;
    (function () {
      if (!a.usesTables || !a.table) return;
      var run = [0, 0, 0];
      a.table.sites.forEach(function (site, s) {
        var k = slotKind[s];
        poolBase.push(run[k]);
        run[k] += site.cap + site.nfields;
        if (k) anyNarrow = true;
      });
      poolCells = [Math.max(1, run[0]), Math.max(1, run[1]), Math.max(1, run[2])];
    })();

    /* Call affinity for the bank packer (tools/bank-toyc.py): a direct call is only fast when caller
     * and callee share a bank, so every direct call site carries a weight = how often it runs per
     * frame, roughly: the caller's own frequency (the frame hook 10,000, the raster hook 224 times that,
     * everything else, init and the main chunk included, once) times 8 per loop level the site sits in, and
     * a callee inherits what its callers send it (eight levels deep, capped).  Relative, not cycles. */
    var siteWeight = {};
    if (!huc && !NO_DIRECT) (function () {
      var nf = a.functions.length, loopW = [], calls = [];
      a.functions.forEach(function (f, fi) {
        var lw = new Array(f.code.length), q, e;
        for (q = 0; q < f.code.length; q++) lw[q] = 1;
        for (q = 0; q < f.code.length; q++) {
          var c = f.code[q];
          if ((c.t === "jmp" || c.t === "br" || c.t === "fornext") && c.target != null && c.target <= q) {
            for (e = c.target; e <= q; e++) lw[e] = Math.min(lw[e] * 8, 4096);
          }
        }
        loopW[fi] = lw;
        f.code.forEach(function (c, pc) {
          if (c.t !== "call") return;
          var dc = directCallee(fi, pc, c);
          if (dc) calls.push({ from: fi, pc: pc, to: dc.fid, w: lw[pc] });
        });
      });
      var base = new Array(nf), level, total = new Array(nf), k;
      for (k = 0; k < nf; k++) { base[k] = 1; total[k] = 0; }
      if (a.hookFrame != null) base[a.hookFrame] = 10000;
      if (a.hookRaster != null) base[a.hookRaster] = 10000 * 224;
      level = base.slice();
      for (k = 0; k < nf; k++) total[k] = level[k];
      for (var round = 0; round < 8; round++) {
        var next = new Array(nf).fill(0), any = false;
        calls.forEach(function (cl) {
          if (!level[cl.from]) return;
          next[cl.to] = Math.min(1e12, next[cl.to] + level[cl.from] * cl.w);
          any = true;
        });
        if (!any) break;
        for (k = 0; k < nf; k++) total[k] = Math.min(1e12, total[k] + next[k]);
        level = next;
      }
      calls.forEach(function (cl) {
        siteWeight[cl.from + ":" + cl.pc] = Math.max(1, Math.min(1e12, Math.round(base[cl.from] > 1 || total[cl.from] > 1 ? total[cl.from] * cl.w : cl.w)));
      });
    })();

    var chunkCtx = null;

    function jumpTo(target) {
      if (chunkCtx && (target < chunkCtx.lo || target >= chunkCtx.hi)) {
        return "{ return " + target + "; }";
      }
      return "goto L" + target + ";";
    }

    function emitSplit(fn, fid, labels) {
      var n = fn.code.length;
      var bounds = [];
      var lo, k, pc;
      /* Cut points (#300): a loop cut by a chunk edge pays a dispatcher round trip on every iteration
       * (NOVA TIDE's collision loop: ~45% of a video frame).  A cut goes where the fewest loops cross
       * it, within +-40% of the nominal chunk length (an inner loop counts 8x its parent); every
       * chunk stays within 1.4x SPLIT_CHUNK instructions. */
      var spans = [];
      fn.code.forEach(function (ij, p) {
        if ((ij.t === "jmp" || ij.t === "br" || ij.t === "fornext") && ij.target != null && ij.target <= p) spans.push([ij.target, p]);
      });
      spans.forEach(function (sp) {
        sp.w = 1;
        spans.forEach(function (o) { if (o !== sp && o[0] <= sp[0] && o[1] >= sp[1] && (o[0] < sp[0] || o[1] > sp[1])) sp.w *= 8; });
      });
      function cutCost(c) {
        var w = 0;
        spans.forEach(function (sp) { if (sp[0] < c && c <= sp[1]) w += sp.w; });
        return w;
      }
      lo = 0;
      while (lo < n) {
        var hi = lo + SPLIT_CHUNK;
        if (n - lo > Math.round(SPLIT_CHUNK * 1.4)) {
          var best = hi, bc = cutCost(hi), c0 = Math.round(SPLIT_CHUNK * 0.6), c1 = Math.round(SPLIT_CHUNK * 1.4);
          for (var c = lo + c0; c <= lo + c1; c++) {
            var cc = cutCost(c);
            if (cc < bc || (cc === bc && Math.abs(c - lo - SPLIT_CHUNK) < Math.abs(best - lo - SPLIT_CHUNK))) { best = c; bc = cc; }
          }
          hi = best;
        } else hi = n;
        bounds.push([lo, Math.min(n, hi)]);
        lo = hi;
      }
      function chunkOf(p) {
        for (var c = 0; c < bounds.length; c++) if (p >= bounds[c][0] && p < bounds[c][1]) return c;
        return -1;
      }
      var entries = bounds.map(function (b) { var o = {}; o[b[0]] = true; return o; });
      for (pc = 0; pc < n; pc++) {
        var ij = fn.code[pc];
        var tt = (ij.t === "jmp" || ij.t === "br" || ij.t === "fornext") ? ij.target : null;
        if (tt != null && chunkOf(tt) !== chunkOf(pc)) entries[chunkOf(tt)][tt] = true;
      }
      /* .bss, not the zero page the compiler would pick: it zeroes the array
       * with a memset through a pointer, and llvm-mos's pointer to a zero-page
       * object is $00xx (the I/O page on this CPU), not $20xx (measured: the
       * banked TOWER stalled after one frame). */
      line("static " + T + " il_fn_" + fid + "_r[" + Math.max(1, fn.registers) + "]");
      line("    __attribute__((section(\".bss\")));");
      line("static uint8_t il_fn_" + fid + "_busy;");
      var splitAt = out.length, pcLines = [], declAt = [];
      for (k = 0; k < bounds.length; k++) {
        var cname = "il_fn_" + fid + "_c" + k;
        var proto = "static int16_t " + cname +
          "(struct il_closure *cl, int16_t pc, int32_t *rv)";
        line(proto + " __attribute__((noinline));");
        line(proto + " {");
        line("  " + T + " *const r = il_fn_" + fid + "_r;");
        line("  (void)cl; (void)rv; (void)r;");
        declAt[k] = out.length;
        line("  switch (pc) {");
        Object.keys(entries[k]).forEach(function (e) {
          line("  case " + e + ": goto L" + e + ";");
        });
        line("  default: return -1;");
        line("  }");
        chunkCtx = { lo: bounds[k][0], hi: bounds[k][1], name: cname };
        for (pc = bounds[k][0]; pc < bounds[k][1]; pc++) {
          if (labels[pc] || entries[k][pc]) line("L" + pc + ": ;");
          var i0 = out.length;
          emitInstruction(fn, fid, fn.code[pc], pc);
          pcLines[pc] = [i0, out.length];
        }
        chunkCtx = null;
        if (k === bounds.length - 1) line("  *rv = 0; return -1;");
        else line("  return " + bounds[k][1] + ";");
        line("}");
      }
      line("static " + T + " il_fn_" + fid +
           "(struct il_closure *cl, " + SIG + ") {");
      line("  " + T + " *const r = il_fn_" + fid + "_r;");
      line("  int32_t rv = 0; int16_t pc = 0; uint8_t i;");
      line("  (void)cl; " + ARGS.map(function (nm) { return "(void)" + nm + ";"; }).join(" "));
      line("  if (il_fn_" + fid + "_busy) { il_split_reentered = 1; return 0; }");
      line("  il_fn_" + fid + "_busy = 1;");
      line("  for (i = 0; i < " + Math.max(1, fn.registers) + "; i++) r[i] = 0;");
      for (pc = 0; pc < fn.params.length; pc++) {
        var psrc = pc < 4 ? "a" + pc : "il_xargs[" + (pc - 4) + "]";
        line("  r[" + pc + "] = " + psrc + ";");
      }
      line("  while (pc >= 0) {");
      for (k = 0; k < bounds.length; k++) {
        var cn = "il_fn_" + fid + "_c" + k;
        line("    " + (k ? "else " : "") + (k < bounds.length - 1
             ? "if (pc < " + bounds[k][1] + ") " : "") +
             "pc = IL_CHUNK_CALL(" + cn + ", " + cn + "(cl, pc, &rv));");
      }
      line("  }");
      line("  il_fn_" + fid + "_busy = 0;");
      line("  return rv;");
      line("}");
      if (!(options && options.noChunkLocals)) promoteChunkLocals(fn, bounds, entries, splitAt, pcLines, declAt);
    }

    /* #300: the registers of a split function are one static array (every chunk shares them), so each
     * IL instruction stored its 32-bit result to memory, temporaries included.  A register that is
     * named in one chunk only and is not live at any entry of that chunk (so every path through the
     * chunk writes it before it reads it, and nothing outside ever reads it) is declared a local of that
     * chunk and the compiler keeps it in a register.  Defs and uses are read off the C text emitted for
     * each IL instruction: a line that starts `r[N] = ` is a def (a kill only when the instruction's text
     * has no `if` or brace, i.e. is unconditional), every other mention a use.  Control flow: an
     * instruction with a target goes to it and falls through, a jmp only to its target, a ret nowhere. */
    function promoteChunkLocals(fn, bounds, entries, start, pcLines, declAt) {
      var n = fn.code.length, reRef = /\br\[(\d+)\]/g, reDef = /^\s*r\[(\d+)\] = /;
      var use = [], kill = [], pc, k, j, m, ln;
      var chunkOfPc = [];
      bounds.forEach(function (b, ci) { for (var q = b[0]; q < b[1]; q++) chunkOfPc[q] = ci; });
      var where = {};                                   /* reg -> {chunk: count}; -1 = outside the chunks */
      function note(rg, ci) { var w = where[rg] || (where[rg] = {}); w[ci] = (w[ci] || 0) + 1; }
      var inChunk = new Array(out.length - start);
      for (pc = 0; pc < n; pc++) {
        var rg = pcLines[pc]; if (!rg) { use[pc] = {}; kill[pc] = {}; continue; }
        var u = {}, kl = {}, txt = out.slice(rg[0], rg[1]);
        var plain = txt.every(function (l) { return !/\bif\b|[{}]/.test(l); });
        for (j = 0; j < txt.length; j++) {
          ln = txt[j]; var dm = reDef.exec(ln), rest = ln;
          if (dm) { if (plain) kl[dm[1]] = true; rest = ln.slice(dm[0].length); note(dm[1], chunkOfPc[pc]); }
          while ((m = reRef.exec(rest))) { u[m[1]] = true; note(m[1], chunkOfPc[pc]); }
        }
        for (j = rg[0]; j < rg[1]; j++) inChunk[j - start] = true;
        /* a use before the def in the same instruction counts as a use: kills apply after uses */
        use[pc] = u; kill[pc] = kl;
      }
      /* every other mention (dispatcher, headers) is outside any chunk */
      for (j = start; j < out.length; j++) {
        if (inChunk[j - start]) continue;
        while ((m = reRef.exec(out[j]))) note(m[1], -1);
      }
      /* backward liveness */
      var liveIn = [], changed = true, succ = [];
      for (pc = 0; pc < n; pc++) {
        var ij = fn.code[pc], sc = [];
        if (ij.t !== "ret") {
          if (ij.target != null) sc.push(ij.target);
          if (ij.t !== "jmp" && pc + 1 < n) sc.push(pc + 1);
        }
        succ[pc] = sc; liveIn[pc] = {};
      }
      var guard = 0;
      while (changed && guard++ < 200) {
        changed = false;
        for (pc = n - 1; pc >= 0; pc--) {
          var cur = {};
          succ[pc].forEach(function (t) { Object.keys(liveIn[t]).forEach(function (r2) { cur[r2] = true; }); });
          Object.keys(kill[pc]).forEach(function (r2) { delete cur[r2]; });
          Object.keys(use[pc]).forEach(function (r2) { cur[r2] = true; });
          if (Object.keys(cur).length !== Object.keys(liveIn[pc]).length) changed = true;
          liveIn[pc] = cur;
        }
      }
      if (changed) return;                              /* did not converge: promote nothing */
      /* (chunk, register) is a local when the register is live at no entry of the chunk and along no edge
       * leaving it: its value never crosses the chunk's border, whatever the other chunks do with the
       * same register number (the Lua VM's stack slots are reused for unrelated temporaries) */
      var locals = bounds.map(function () { return []; });
      bounds.forEach(function (bd, ci) {
        var mention = {}, blocked = {};
        for (pc = bd[0]; pc < bd[1]; pc++) {
          Object.keys(use[pc]).forEach(function (x) { mention[x] = true; });
          Object.keys(kill[pc]).forEach(function (x) { mention[x] = true; });
          var rg4 = pcLines[pc];
          if (rg4) for (j = rg4[0]; j < rg4[1]; j++) { var mm; reDef.lastIndex = 0; if ((mm = reDef.exec(out[j]))) mention[mm[1]] = true; }
          succ[pc].forEach(function (t) { if (t < bd[0] || t >= bd[1]) Object.keys(liveIn[t]).forEach(function (x) { blocked[x] = true; }); });
        }
        Object.keys(entries[ci]).forEach(function (e) { Object.keys(liveIn[+e]).forEach(function (x) { blocked[x] = true; }); });
        if (ci === 0) Object.keys(liveIn[0]).forEach(function (x) { blocked[x] = true; });
        Object.keys(mention).forEach(function (x) { if (!blocked[x]) locals[ci].push(+x); });
      });
      /* rewrite the text, then the declarations (last chunk first, so the indexes hold) */
      for (k = 0; k < bounds.length; k++) {
        if (!locals[k].length) continue;
        var set = {}; locals[k].forEach(function (x) { set[x] = true; });
        for (pc = bounds[k][0]; pc < bounds[k][1]; pc++) {
          var rg3 = pcLines[pc]; if (!rg3) continue;
          for (j = rg3[0]; j < rg3[1]; j++) out[j] = out[j].replace(reRef, function (all, x) { return set[x] ? "l" + x : all; });
        }
      }
      for (k = bounds.length - 1; k >= 0; k--) {
        if (!locals[k].length) continue;
        out.splice(declAt[k], 0, "  " + T + " " + locals[k].sort(function (x, y) { return x - y; }).map(function (x) { return "l" + x; }).join(", ") + ";");
      }
    }

    function emitFunction(fn, fid) {
      var labels = {};
      var pc;
      for (pc = 0; pc < fn.code.length; pc++) {
        var ins = fn.code[pc];
        var t = (ins.t === "jmp" || ins.t === "br" || ins.t === "fornext")
                ? ins.target : null;
        if (t != null) labels[t] = true;
      }
      if (!huc && fn.code.length > SPLIT_OVER && (!SPLIT_ONLY || SPLIT_ONLY.indexOf(fid) >= 0)) {
        emitSplit(fn, fid, labels);
        return;
      }
      line("static " + T + " il_fn_" + fid +
           "(struct il_closure *cl, " + SIG + ") {");
      if (huc) {
        line("  " + T + " r[" + Math.max(1, fn.registers) + "];");
        /* HuC has no block scoping and wants every declaration before the
         * first statement (both measured): two `for` loops in one function
         * cannot both declare `st`, and the declarations must precede the
         * zero assignments below.  Name the loop temporaries after their
         * instruction and declare them at the top. */
        for (var q = 0; q < fn.code.length; q++) {
          if (fn.code[q].t === "fornext") {
            line("  " + T + " st_" + q + ";");
            line("  " + T + " idx_" + q + ";");
            line("  " + T + " lim_" + q + ";");
          }
        }
        var zeroed = registersReadFirst(fn, a.functions);
        for (var z = 0; z < zeroed.length; z++) {
          line("  r[" + zeroed[z] + "] = 0;");
        }
      } else {
        line("  " + T + " r[" + Math.max(1, fn.registers) + "] = { 0 };");
        line("  (void)cl; " + ARGS.map(function (n) {
          return "(void)" + n + ";";
        }).join(" "));
      }
      for (pc = 0; pc < fn.params.length; pc++) {
        var psrc = pc < 4 ? "a" + pc : "il_xargs[" + (pc - 4) + "]";
        line("  r[" + pc + "] = " + psrc + ";");
      }
      for (pc = 0; pc < fn.code.length; pc++) {
        if (labels[pc]) line("L" + pc + ": ;");
        emitInstruction(fn, fid, fn.code[pc], pc);
      }
      line("  return 0;");
      line("}");
    }

    /* the divisor as a positive power of two (1, 2, 4, ... 2^30), else 0 */
    function pow2(op) {
      if (!op || !op.k || op.k.t !== "int") return 0;
      var v = op.k.v | 0;
      return v > 0 && (v & (v - 1)) === 0 ? v : 0;
    }

    /* #292: a direct cell access for a base that provably holds one `table` site.  cellRef() is the C
     * lvalue of the array cell for an int key operand (with its guard), fieldRef() of a field.  A guarded
     * read yields 0 and a guarded write nothing, exactly as the helpers do (docs/TABLES-PLAN.md). */
    function slotShape(ts) { return a.table.sites[ts]; }
    function cellExpr(ts, off) {   /* off: a C expression or a number */
      return KIND_POOL[slotKind[ts]] + "[" + (poolBase[ts] + (typeof off === "number" ? off : 0)) +
             (typeof off === "number" ? "" : " + " + off) + "]";
    }
    function readCast(ts, e) { return slotKind[ts] ? "(" + T + ")" + e : e; }
    function staticTget(fid, ins, pc, ts, d) {
      var sh = slotShape(ts);
      if (ins.key.k && ins.key.k.t === "str") {
        var f = a.tableFieldIds[ins.key.k.v];
        line("  " + d + " = " + (f >= sh.nfields ? "0" : readCast(ts, cellExpr(ts, sh.cap + f))) + ";");
        return;
      }
      var rg = opRange(fid, ins.key, pc), K = operand(ins.key);
      if (rg[0] === rg[1] && ins.key.k) {
        line("  " + d + " = " + (rg[0] >= 1 && rg[0] <= sh.cap ? readCast(ts, cellExpr(ts, rg[0] - 1)) : "0") + ";");
      } else if (sh.cap === 0 || rg[1] < 1 || rg[0] > sh.cap) {
        line("  " + d + " = 0;");
      } else if (rg[0] >= 1 && rg[1] <= sh.cap) {
        line("  " + d + " = " + readCast(ts, cellExpr(ts, "(uint8_t)(" + K + " - 1)")) + ";");
      } else {
        line("  { " + U + " ti = (" + U + ")" + K + "; " + d + " = (ti <= " + sh.cap + "u && (uint8_t)ti) ? " +
             readCast(ts, cellExpr(ts, "(uint8_t)ti - 1")) + " : 0; }");
      }
    }
    function staticTset(fid, ins, pc, ts, keyOp, isField, fieldName, valOp) {
      var sh = slotShape(ts), V = "(" + KIND_CT[slotKind[ts]] + ")(" + operand(valOp) + ")";
      if (isField) {
        var f = a.tableFieldIds[fieldName];
        if (f < sh.nfields) line("  " + cellExpr(ts, sh.cap + f) + " = " + V + ";");
        return;
      }
      var rg = opRange(fid, keyOp, pc), K = operand(keyOp);
      if (rg[0] === rg[1] && keyOp.k) {
        if (rg[0] >= 1 && rg[0] <= sh.cap) line("  " + cellExpr(ts, rg[0] - 1) + " = " + V + ";");
      } else if (sh.cap === 0 || rg[1] < 1 || rg[0] > sh.cap) {
        /* never in range: the write is ignored */
      } else if (rg[0] >= 1 && rg[1] <= sh.cap) {
        line("  " + cellExpr(ts, "(uint8_t)(" + K + " - 1)") + " = " + V + ";");
      } else {
        line("  { " + U + " ti = (" + U + ")" + K + "; if (ti <= " + sh.cap + "u && (uint8_t)ti) " +
             cellExpr(ts, "(uint8_t)ti - 1") + " = " + V + "; }");
      }
    }

    function emitInstruction(fn, fid, ins, pc) {
      var d = ins.dst != null ? "r[" + ins.dst + "]" : null;
      switch (ins.t) {
      case "const":
        line("  " + d + " = " + constLit(ins.k) + ";");
        break;
      case "move":
        line("  " + d + " = " + operand(ins.src) + ";");
        break;
      case "getupval":
        line("  " + d + " = il_ups[cl->ub + " + ins.idx + "];");
        break;
      case "closure": {
        var cid = a.closureAt[fid + ":" + pc];
        var target = a.functions[ins.fid];
        line("  il_closures[" + cid + "].fid = " + ins.fid + ";");
        line("  il_closures[" + cid + "].ub = " + a.closureBase[cid] + ";");
        for (var u = 0; u < target.upvalues.length; u++) {
          var desc = target.upvalues[u];
          var v;
          if (desc.type === "env") v = "0";
          else if (desc.from === "reg") v = "r[" + desc.index + "]";
          else v = "il_ups[cl->ub + " + desc.index + "]";
          line("  il_ups[" + (a.closureBase[cid] + u) + "] = " + v + ";");
        }
        line("  " + d + " = " + cid + ";");
        break;
      }
      case "getglobal":
        if (a.typeOf[ins.name] === "vram" || a.typeOf[ins.name] === "padset") {
          /* vset/vget and padget do not take a base operand; the marker is a
           * value only so the register is defined. */
          line("  " + d + " = 0;");
        } else {
          line("  " + d + " = il_globals[" + a.globalIds[ins.name] + "];");
        }
        break;
      case "setglobal":
        line("  il_globals[" + a.globalIds[ins.name] + "] = " +
             operand(ins.src) + ";");
        break;
      case "arith": {
        var lhs = operand(ins.a);
        var rhs = operand(ins.b);
        var expr;
        switch (ins.op) {
        case "add":
          expr = "(" + T + ")((" + U + ")" + lhs + " + (" + U + ")" + rhs + ")";
          break;
        case "sub":
          expr = "(" + T + ")((" + U + ")" + lhs + " - (" + U + ")" + rhs + ")";
          break;
        case "mul":
          /* the console's generic 32x32 multiply loops over all 32 bits (~2,000 cycles);
           * il_lua_mul's cost follows the smaller operand's bit length */
          if (huc) {
            expr = "(" + T + ")((" + U + ")" + lhs + " * (" + U + ")" + rhs + ")";
          } else {
            /* a constant operand: a power of two is a shift, a small constant takes il_mulc_K's 16-bit path */
            var ck = ins.a && ins.a.k && ins.a.k.t === "int" ? ins.a.k.v | 0 : (ins.b && ins.b.k && ins.b.k.t === "int" ? ins.b.k.v | 0 : null);
            var other = ins.a && ins.a.k && ins.a.k.t === "int" ? rhs : lhs;
            if (ck != null && ck > 0 && (ck & (ck - 1)) === 0) {
              expr = ck === 1 ? other : "(" + T + ")((" + U + ")" + other + " << " + Math.round(Math.log2(ck)) + ")";
            } else if (ck != null && uses.mulc[ck]) {
              expr = "il_mulc_" + ck + "(" + other + ")";
            } else {
              expr = "il_lua_mul(" + lhs + ", " + rhs + ")";
            }
          }
          break;
        case "mod":
          /* x % 2^k is a mask (Lua's floor remainder is non-negative for a positive divisor, which is
           * what two's complement `&` gives); a software 32-bit remainder costs ~2,000 cycles here */
          if (!huc && pow2(ins.b) > 0) {
            expr = pow2(ins.b) === 1 ? "(" + T + ")0"
              : "(" + T + ")((" + U + ")" + lhs + " & 0x" + (pow2(ins.b) - 1).toString(16) + "u)";
          } else if (!huc && uses.divc["mod:" + (ins.b && ins.b.k ? ins.b.k.v | 0 : 0)]) {
            expr = "il_modc_" + (ins.b.k.v | 0) + "(" + lhs + ")";
          } else expr = "il_lua_mod(" + lhs + ", " + rhs + ")";
          break;
        case "idiv":
          /* x // 2^k is an arithmetic shift (floor division); k = 0 is the value itself */
          if (!huc && pow2(ins.b) > 0) {
            var sh = Math.round(Math.log2(pow2(ins.b)));
            expr = sh === 0 ? lhs : "(" + T + ")(" + lhs + " >> " + sh + ")";
          } else if (!huc && uses.divc["idiv:" + (ins.b && ins.b.k ? ins.b.k.v | 0 : 0)]) {
            expr = "il_idivc_" + (ins.b.k.v | 0) + "(" + lhs + ")";
          } else expr = "il_lua_idiv(" + lhs + ", " + rhs + ")";
          break;
        case "band":
          expr = "(" + T + ")((" + U + ")" + lhs + " & (" + U + ")" + rhs + ")";
          break;
        case "bor":
          expr = "(" + T + ")((" + U + ")" + lhs + " | (" + U + ")" + rhs + ")";
          break;
        case "bxor":
          expr = "(" + T + ")((" + U + ")" + lhs + " ^ (" + U + ")" + rhs + ")";
          break;
        case "shl":
          expr = "il_lua_shl(" + lhs + ", " + rhs + ")";
          break;
        case "shr":
          expr = "il_lua_shr(" + lhs + ", " + rhs + ")";
          break;
        default:
          refuse("cgen-op", "arithmetic " + ins.op);
          expr = "0";
        }
        line("  " + d + " = " + expr + ";");
        break;
      }
      case "unm":
        line("  " + d + " = (" + T + ")(0 - (" + U + ")" + operand(ins.a) + ");");
        break;
      case "bnot":
        line("  " + d + " = (" + T + ")(~(" + U + ")" + operand(ins.a) + ");");
        break;
      case "not":
        line("  " + d + " = (" + operand(ins.a) + " == 0);");
        break;
      case "cmp": {
        var ca = operand(ins.a);
        var cb = operand(ins.b);
        if (ins.type === "bool") {
          line("  " + d + " = (" + ca + " == " + cb + ");");
        } else if (ins.op === "eq") {
          line("  " + d + " = (" + ca + " == " + cb + ");");
        } else if (ins.op === "lt") {
          line("  " + d + " = (" + T + ")(" + ca + " < " + cb + ");");
        } else if (ins.op === "le") {
          line("  " + d + " = (" + T + ")(" + ca + " <= " + cb + ");");
        } else {
          refuse("cgen-op", "comparison " + ins.op);
        }
        break;
      }
      case "br":
        line("  if (((" + operand(ins.cond) + " != 0) ? 1 : 0) == " +
             (ins.when ? 1 : 0) + ") " + jumpTo(ins.target));
        break;
      case "jmp":
        line("  " + jumpTo(ins.target));
        break;
      case "call": {
        /* #183: arguments 5..8 go through il_xargs, which the callee copies
         * into r[4..7] at entry.  Always write all four cells so a callee
         * with fewer than eight parameters never reads a stale argument. */
        if (ins.args.length > 4) {
          for (var xi = 0; xi < 4; xi++) {
            line("  il_xargs[" + xi + "] = " + argOf(ins, 4 + xi) + ";");
          }
        }
        var call;
        var dc = directCallee(fid, pc, ins);
        if (dc) {
          /* the caller's own symbol names its bank; a chunk has no single one (IL_BANK_NONE) */
          var callerSym = chunkCtx && chunkCtx.name ? chunkCtx.name : chunkCtx ? "none" : "il_fn_" + fid;
          call = "";
          for (var ci2 = 0; ci2 < ARGS.length; ci2++) call += (ci2 ? ", " : "") + argOf(ins, ci2);
          call = "IL_DIRECT(" + callerSym + ", " + dc.fid + ", " + dc.cid + ", " + call + ")";
        } else {
          call = "il_call(" + operand(ins.callee);
          for (var ci = 0; ci < ARGS.length; ci++) call += ", " + argOf(ins, ci);
          call += ")";
        }
        line("  " + (d ? d + " = " : "(void)") + call + ";" +
             (dc ? " /* AFF " + (chunkCtx && chunkCtx.name ? chunkCtx.name : "il_fn_" + fid) + " il_fn_" + dc.fid + " " +
                   (siteWeight[fid + ":" + pc] || 1) + " */" : ""));
        break;
      }
      case "sat":
        /* SAT entry i, word k: VRAM $7F00 + i*4 + k, the buffer the runtime's
         * DSR auto-repeat DMAs into SATB every VBlank (viewer.asm's layout,
         * docs/ROM_LAYOUT.md). */
        if (huc) {
          line("  toy_sat(" + operand(ins.i) + ", " + operand(ins.k) + ", " +
               operand(ins.v) + ");");
        } else {
          /* toy_sat's own range check, in line (it folds away for constant i and k), then the 16-bit write */
          if (options && options.noSatPut) {
            line("  if ((uint32_t)" + operand(ins.i) + " <= 63u && (uint32_t)" + operand(ins.k) + " <= 3u) " +
                 "toy_vram_set16((uint16_t)(0x7F00 + " + operand(ins.i) + " * 4 + " + operand(ins.k) + "), (uint16_t)" +
                 operand(ins.v) + ");");
          } else {
            /* #300: toy_sat_put writes the raster builds' RAM shadow in line; the others have it as toy_vram_set16 */
            line("  if ((uint32_t)" + operand(ins.i) + " <= 63u && (uint32_t)" + operand(ins.k) + " <= 3u) " +
                 "TOY_SAT_PUT((uint8_t)(" + operand(ins.i) + " * 4 + " + operand(ins.k) + "), (uint16_t)" +
                 operand(ins.v) + ");");
          }
        }
        break;
      case "sprite": {
        /* #190: one SAT entry from the six values pce-ilbc.js resolved off
         * the spec's table site, in the op's own order — slot, x, y,
         * pattern, palette, attr.  validate() has refused any site the
         * walker could not pin, so the records here are all resolved. */
        var spr = a.sprites[fid][pc];
        if (!huc) {
          /* the four SAT words are constants: write them directly (toy_sprite's own composition, folded
           * at compile time; toy_sat ignores a slot outside 0..63, so does this) */
          if (spr.slot >= 0 && spr.slot <= 63) {
            var at = spr.attr;
            var w3 = (spr.palette | ((at & 1) << 7) | (((at >> 1) & 1) << 8) | (((at >> 2) & 1) << 11) |
                      (((at >> 4) & 3) << 12) | (((at >> 3) & 1) << 15)) & 0xFFFF;
            var sw = [spr.y & 0xFFFF, spr.x & 0xFFFF, (spr.pattern << 1) & 0xFFFF, w3];
            line("  toy_vram_set4(" + (0x7F00 + spr.slot * 4) + ", " + sw.join(", ") + ");");
          }
          break;
        }
        line("  toy_sprite(" + constLit({ t: "int", v: spr.slot }) + ", " +
             constLit({ t: "int", v: spr.x }) + ", " +
             constLit({ t: "int", v: spr.y }) + ", " +
             constLit({ t: "int", v: spr.pattern }) + ", " +
             constLit({ t: "int", v: spr.palette }) + ", " +
             constLit({ t: "int", v: spr.attr }) + ");");
        break;
      }
      case "raster": {
        var rkeys = rasterSpecKeys(fn, pc);
        var rmask = 0, rvals = [];
        ["bxr", "byr", "cr"].forEach(function (nm) {
          if (rkeys.indexOf(nm) >= 0) {
            rmask |= RASTER_KEYS[nm];
            var rts = tableTarget(fid, pc, ins.spec);
            if (rts != null) {
              var rsh = slotShape(rts), rf = a.tableFieldIds[nm];
              rvals.push(rf >= rsh.nfields ? "0" : readCast(rts, cellExpr(rts, rsh.cap + rf)));
            } else rvals.push("il_table_getf(" + operand(ins.spec) + ", " + a.tableFieldIds[nm] + ")");
          } else rvals.push("0");
        });
        line("  toy_raster_entry(" + operand(ins.lineArg) + ", " + rmask + ", " +
             rvals.join(", ") + ");");
        break;
      }
      case "padref":
        line("  " + d + " = " + operand(ins.n) + ";");
        break;
      case "padget":
        /* pad[n].field: the runtime's own $1000 read, one bit per field
         * (toy_runtime.h's TOY_PAD_*). */
        line("  " + d + " = toy_pad(" + operand(ins.pad) + ", TOY_PAD_" +
             String(ins.field).toUpperCase() + ");");
        break;
      case "timer":
        line("  toy_timer_set(" + operand(ins.period) + ");");
        line("  il_timer_cb = " + (ins.fn ? operand(ins.fn) : "-1") + ";");
        break;
      case "ret":
        if (chunkCtx) {
          line("  { *rv = " + (ins.src ? operand(ins.src) : "0") + "; return -1; }");
          break;
        }
        line("  return " + (ins.src ? operand(ins.src) : "0") + ";");
        break;
      case "forprep":
        line("  r[" + ins.base + "] = (" + T + ")((" + U + ")r[" + ins.base +
             "] - (" + U + ")r[" + (ins.base + 2) + "]);");
        break;
      case "fornext":
        line("  {");
        if (huc) {
          line("    st_" + pc + " = r[" + (ins.base + 2) + "];");
          line("    idx_" + pc + " = (" + T + ")((" + U + ")r[" + ins.base +
               "] + (" + U + ")st_" + pc + ");");
          line("    lim_" + pc + " = r[" + (ins.base + 1) + "];");
          line("    if ((st_" + pc + " > 0) ? (idx_" + pc + " <= lim_" + pc +
               ") : (lim_" + pc + " <= idx_" + pc + ")) {");
          line("      r[" + ins.base + "] = idx_" + pc + ";");
          line("      r[" + (ins.base + 3) + "] = idx_" + pc + ";");
          line("      " + jumpTo(ins.target));
          line("    }");
          line("  }");
          break;
        } else {
          line("    " + T + " st = r[" + (ins.base + 2) + "];");
          line("    " + T + " idx = (" + T + ")((" + U + ")r[" + ins.base +
               "] + (" + U + ")st);");
          line("    " + T + " lim = r[" + (ins.base + 1) + "];");
        }
        line("    if ((st > 0) ? (idx <= lim) : (lim <= idx)) {");
        line("      r[" + ins.base + "] = idx;");
        line("      r[" + (ins.base + 3) + "] = idx;");
        line("      " + jumpTo(ins.target));
        line("    }");
        line("  }");
        break;
      case "pal":
        line("  toy_pal(" + operand(ins.addr) + ", " + operand(ins.word) + ");");
        break;
      case "reg": {
        var regId = ins.name === "BXR" ? "TOY_REG_BXR"
                  : ins.name === "BYR" ? "TOY_REG_BYR" : "TOY_REG_CR";
        line("  toy_reg(" + regId + ", " + operand(ins.value) + ");");
        break;
      }
      case "vset":
        /* 16-bit arguments on the llvm target: a VRAM address and a word are 16 bits to the VDC and
         * four int32 argument bytes each cost cycles in every call (tools/study-idioms.py's study) */
        if (huc) line("  toy_vram_set(" + operand(ins.addr) + ", " + operand(ins.word) + ");");
        else line("  toy_vram_set16((uint16_t)" + operand(ins.addr) + ", (uint16_t)" + operand(ins.word) + ");");
        break;
      case "builtin":
        /* validate() admits only rgb and note */
        if (ins.name === "rgb") {
          line("  " + d + " = toy_rgb(" + operand(ins.args[0]) + ", " +
               operand(ins.args[1]) + ", " + operand(ins.args[2]) + ");");
        } else {
          line("  " + d + " = toy_note(" + operand(ins.args[0]) + ");");
        }
        break;
      case "music":
        /* #197: the engine's runtime calls (toy_music/toy_sfx/toy_release
         * and toy_note above) are the ones #198's engine link declares in
         * tools/toyc/toy_runtime.h — a sound toy's C builds from then on. */
        line("  toy_music(" + operand(ins.song) + ");");
        break;
      case "sfx":
        line("  toy_sfx(" + operand(ins.ch) + ", " + operand(ins.freq) + ", " +
             operand(ins.volume) + ", " + operand(ins.frames) + ");");
        break;
      case "release":
        line("  toy_release(" + operand(ins.ch) + ");");
        break;
      case "table":
        /* #176: one static slot per `table` site (docs/TABLES-PLAN.md §2.1),
         * zeroed every time the site runs, so a repeating site's new table
         * starts empty.  il_globals carries the slot id of a table global. */
        line("  " + d + " = il_table_new(" + a.tableSiteAt[fid][pc] + ");");
        break;
      case "setlist":
        /* One guarded write per value: a write past the slot's array part
         * writes nothing (the interpreter faults; the console cannot). */
        var slts = tableTarget(fid, pc, ins.base);
        for (var vi = 0; vi < ins.values.length; vi++) {
          if (slts != null) {
            staticTset(fid, ins, pc, slts, { k: { t: "int", v: ins.index + vi } }, false, null, ins.values[vi]);
            continue;
          }
          line("  il_table_set(" + operand(ins.base) + ", " +
               (ins.index + vi) + ", " + operand(ins.values[vi]) + ");");
        }
        break;
      case "tget":
        var tgts = tableTarget(fid, pc, ins.base);
        if (tgts != null) { staticTget(fid, ins, pc, tgts, d); break; }
        if (ins.key.k && ins.key.k.t === "str") {
          /* A string key is a field: its program-wide id (first-appearance
           * order) indexes the slot's field cells. */
          line("  " + d + " = il_table_getf(" + operand(ins.base) + ", " +
               a.tableFieldIds[ins.key.k.v] + ");");
        } else {
          line("  " + d + " = il_table_get(" + operand(ins.base) + ", " +
               operand(ins.key) + ");");
        }
        break;
      case "tset":
        var tsts = tableTarget(fid, pc, ins.base);
        if (tsts != null) {
          var tsstr = ins.key.k && ins.key.k.t === "str";
          staticTset(fid, ins, pc, tsts, ins.key, tsstr, tsstr ? ins.key.k.v : null, ins.value);
          break;
        }
        if (ins.key.k && ins.key.k.t === "str") {
          line("  il_table_setf(" + operand(ins.base) + ", " +
               a.tableFieldIds[ins.key.k.v] + ", " + operand(ins.value) + ");");
        } else {
          line("  il_table_set(" + operand(ins.base) + ", " +
               operand(ins.key) + ", " + operand(ins.value) + ");");
        }
        break;
      default:
        refuse("cgen-op", "instruction " + ins.t);
      }
    }

    /* ---- front matter ------------------------------------------------- */
    line("/*");
    line(" * Generated by PCEStudio renderer/pce-cgen.js from a pce-il v" +
         program.version + " program.");
    line(" * Source " + (program.source || "@toy.lua") + "; hooks init=" +
         (program.hooks.init) + " frame=" + program.hooks.frame +
         " raster=" + (program.hooks.raster == null ? "none" : program.hooks.raster) + ".");
    line(" * #31 console backend (" + (huc ? "part B: HuC, 16-bit int"
                                            : "part A/C: llvm-mos") +
         "): init/frame and,");
    line(" * when the toy has one, the raster(line) hook (docs/IL.md " +
         (huc ? "§11)." : "§9-§10)."));
    line(" */");
    if (huc) {
      line("#include \"huc_runtime.h\"");
    } else {
      line("#include <stdint.h>");
      line("#include \"toy_runtime.h\"");
      if (!(options && options.noSatPut)) {
        line("#ifdef TOY_RASTER_BUILD");
        line("#define TOY_SAT_PUT(off, w) toy_sat_put(off, w)");
        line("#else");
        line("#define TOY_SAT_PUT(off, w) toy_vram_set16((uint16_t)(0x7F00u + (off)), w)");
        line("#endif");
      }
      if (a.usesSound) line("#include \"toy_sound.h\"");
      if (options && options.assets) line("#include \"toy_assets.h\"");
    }
    line("");
    line("#define IL_NCLOSURES " + Math.max(1, a.closureCount));
    if (!huc) {
      /* a banked build (tools/bank-toyc.py) redefines this to map the callee's bank */
      line("#ifndef IL_DIRECT");
      line("#define IL_DIRECT(caller, callee, cid, ...) il_fn_##callee(&il_closures[cid], __VA_ARGS__)");
      line("#endif");
    }
    if (!huc && a.functions.some(function (f, fi) { return f.code.length > SPLIT_OVER && (!SPLIT_ONLY || SPLIT_ONLY.indexOf(fi) >= 0); })) {
      line("#ifndef IL_CHUNK_CALL");
      line("#define IL_CHUNK_CALL(sym, e) (e)");
      line("#endif");
      line("static volatile uint8_t il_split_reentered;");
    }
    line("#define IL_NGLOBALS " + a.globalNames.length);
    line("#define IL_NUPS " + Math.max(1, a.maxUps));
    line("#define IL_NUPCELLS " + a.upsTotal);
    line("");
    line("struct il_closure {");
    line(huc ? "  int fid;" : "  int16_t fid;");
    line(huc ? "  int ub;" : "  uint16_t ub;");
    line("};");
    line("");
    /* These arrays must live in normal RAM (.data/.bss, $2200+), NOT in the
     * PCE target's .zp.bss: that section's addresses are zero-page offsets
     * (the console maps zero-page to RAM $2000+$offset), and llvm-mos
     * materialises a *pointer* to such an object as the offset alone
     * ($0029), so il_call's indirect read of the closure would fetch from
     * the I/O page.  Found by measurement: `il_closures` at $2029 produced
     * `lda ($02),y` with the pointer $003d (docs/IL.md §9).  The `volatile`
     * on il_globals stops LTO scalarising the array into two byte globals
     * in .zp.bss, which stored the wrong byte for il_globals[1]. */
    if (huc) {
      /* HuC's data goes in ordinary BaseRAM; there are no sections to
       * choose and no LTO to defeat (docs/IL.md §11). */
      line("static struct il_closure il_closures[IL_NCLOSURES];");
      line("static " + T + " il_ups[IL_NUPCELLS];");
    } else {
      line("static " + T + " il_ups[IL_NUPCELLS]");
      line("    __attribute__((section(\".bss\")));");
      line("static struct il_closure il_closures[IL_NCLOSURES]");
      line("    __attribute__((section(\".bss\")));");
    }
    line("static volatile " + T + " il_globals[IL_NGLOBALS]" +
         (huc ? "" : "    __attribute__((section(\".data\")))") + " = { " +
         a.globalNames.map(function () { return "-1"; }).join(", ") + " };");
    /* timer(period, fn)'s callback closure slot, written by the timer()
     * instruction and read by the pump the frame flow calls (#45). */
    if (a.usesTimer) {
      line("static " + T + " il_timer_cb = -1;");
    }
    /* #183: the extra-argument block parameters 5..8 travel through, the
     * interpreter's `xargs`.  Emitted only for a toy with a wide function,
     * so a <=4-parameter toy's C stays byte-identical. */
    if (WIDE) {
      line("static " + T + " il_xargs[4];");
    }
    /* #176: the tables' fixed pool, the interpreter's model
     * (docs/TABLES-PLAN.md §2.1): IL_TABLE_CELLS 32-bit cells shared by
     * every toy, one static slot per `table` site, zeroed and reused each
     * time the site runs.  The per-slot shape is the encoder's own
     * tableLayout() (pce-ilbc.js), so both backends report the same sites
     * and cells for the same IL. */
    if (a.usesTables) {
      /* The native pool is the toy's own cells, not the interpreter's fixed
       * 192: the pool is RAM, and 8 KiB is all the console has (DUSK RUN's
       * variables overflowed it by 146 B with three small tables in 768 B). */
      /* #292: cells of a slot whose stored values provably fit a byte or a signed 16-bit word live in
       * il_cells8 / il_cells16; with no such slot the output is the one pool it always was. */
      line("#define IL_TABLE_CELLS " + poolCells[0]);
      line("#define IL_NSLOTS " + a.table.nslots);
      line("static " + T + " il_table_cells[IL_TABLE_CELLS]");
      line("    __attribute__((section(\".bss\")));");
      if (slotKind.indexOf(1) >= 0) {
        line("static uint8_t il_cells8[" + poolCells[1] + "] __attribute__((section(\".bss\")));");
      }
      if (slotKind.indexOf(2) >= 0) {
        line("static int16_t il_cells16[" + poolCells[2] + "] __attribute__((section(\".bss\")));");
      }
      line("static const uint16_t il_slot_base[IL_NSLOTS] = { " +
           poolBase.join(", ") + " };");
      if (anyNarrow) {
        line("static const uint8_t il_slot_kind[IL_NSLOTS] = { " + slotKind.join(", ") + " };");
      }
      line("static const uint8_t il_slot_cap[IL_NSLOTS] = { " +
           a.table.sites.map(function (s) { return s.cap; }).join(", ") + " };");
      line("static const uint8_t il_slot_fields[IL_NSLOTS] = { " +
           a.table.sites.map(function (s) { return s.nfields; }).join(", ") + " };");
    }
    line("");
    for (i = 0; i < a.functions.length; i++) {
      line("static " + T + " il_fn_" + i +
           "(struct il_closure *cl, " + SIG + ")" +
           (huc ? ";" : " __attribute__((noinline));"));
    }
    line("static " + T + " il_call(" + T + " cv, " + SIG + ")" +
         (huc ? ";" : " __attribute__((noinline));"));
    line("");

    /* ---- the dispatcher ----------------------------------------------- */
    line("static " + T + " il_call(" + T + " cv, " + SIG + ") {");
    line(huc ? "  int fid;" : "  int16_t fid;");
    line("  if (cv < 0 || cv >= IL_NCLOSURES) return 0;");
    line("  fid = il_closures[cv].fid;");
    line("  switch (fid) {");
    for (i = 0; i < a.functions.length; i++) {
      line("  case " + i + ": return il_fn_" + i +
           "(&il_closures[cv], " + ARGS.join(", ") + ");");
    }
    line("  default: return 0;");
    line("  }");
    line("}");
    line("");

    /* ---- integer helpers the lowering needs -------------------------- */
    if (uses.mod) {
      line("/* Lua's `%`: the result has the divisor's sign. */");
      line("static " + (huc ? "" : "__attribute__((noinline)) ") + T
           + " il_lua_mod(" + T + " x, " + T + " y) {");
      if (huc) {
        /* HuC only initialises a local with a constant (measured: `int m =
         * x % y;` fails to compile), so the dialect splits declaration and
         * assignment. */
        line("  " + T + " m; m = x % y;");
      } else {
        /* No `%`, as in il_lua_idiv: an srem next to the division llvm-mos
         * fuses into __divmodsi4(x, y, &rem), whose rem pointer is a zp
         * static materialised with the $2000 bank dropped, so the remainder
         * store lands in the VDC page and kills CR (#289).  x - q*y is the
         * same trunc remainder. */
        line("  " + T + " q = x / y;");
        line("  " + T + " m = x - q * y;");
      }
      line("  if (m != 0 && ((m < 0) != (y < 0))) m += y;");
      line("  return m;");
      line("}");
      line("");
    }
    if (uses.idiv) {
      line("/* Lua's `//`: floor division. */");
      line("static " + (huc ? "" : "__attribute__((noinline)) ") + T
           + " il_lua_idiv(" + T + " x, " + T + " y) {");
      if (huc) {
        line("  " + T + " q; " + T + " r;");
        line("  q = x / y; r = x % y;");
      } else {
        /* No `%`: llvm-mos fuses `x / y` with a `x % y` into one
         * __divmodsi4(x, y, &rem) call whose remainder pointer is a
         * zero-page static materialised with the $2000 bank dropped, so
         * the remainder store lands in the VDC page ($00E5 aliases the
         * data/select ports) and kills CR (#289).  x - q*y is the same
         * trunc remainder, and the quotient call needs no pointer. */
        line("  " + T + " q = x / y;");
        line("  " + T + " r = x - q * y;");
      }
      line("  if (r != 0 && ((r < 0) != (y < 0))) q--;");
      line("  return q;");
      line("}");
      line("");
    }
    if (!huc) {
      Object.keys(uses.divc).sort().forEach(function (key) {
        var dc = uses.divc[key], m = findMagic(dc.c), c = dc.c;
        var name = (dc.op === "idiv" ? "il_idivc_" : "il_modc_") + c;
        var body = [];
        line("/* x " + (dc.op === "idiv" ? "//" : "%") + " " + c + " for 0..65535 in 16-bit pieces (estimate from 8-bit products, " + m.fix +
             " correction step" + (m.fix === 1 ? "" : "s") + ", checked on all 65,536 dividends when this C was generated), the same through");
        line(" * the ceiling for -32768..-1 (one shared chain), and the generic helper for anything else.  Inline: the fixed");
        line(" * ROM page has no room for one helper per constant, the banks do. */");
        line("static inline __attribute__((always_inline)) " + T + " " + name + "(" + T + " x) {");
        line("  uint16_t a;");
        line("  uint8_t neg = 0;");
        line("  if ((" + U + ")x <= 0xFFFFu) {");
        line("    a = (uint16_t)x;");
        line("  } else if ((" + U + ")(x + 0x8000) < 0x8000u) {");
        line("    a = (uint16_t)((uint16_t)(0 - (uint16_t)x) + " + (c - 1) + "u);");
        line("    neg = 1;");
        line("  } else {");
        line("    return " + (dc.op === "idiv" ? "il_lua_idiv" : "il_lua_mod") + "(x, " + c + ");");
        line("  }");
        line("  {");
        magicQuotientLines(m, c, "  ", body); body.forEach(function (l) { line(l); });
        /* negative x: floor(x/c) = -ceil(u/c) = -qq (qq from u+c-1), and x mod c = c - 1 - rr */
        if (dc.op === "idiv") line("    return neg ? -(" + T + ")qq : (" + T + ")qq;");
        else line("    return neg ? (" + T + ")(uint16_t)(" + (c - 1) + "u - rr) : (" + T + ")rr;");
        line("  }");
        line("}");
        line("");
      });
    }
    if (uses.mul && !huc) {
      /* x*y modulo 2^32 (what the IL's wrapping int multiply is), by shift and add over the
       * smaller operand's bits: DUSK RUN's pixel rules multiply small numbers by the thousand */
      line("static " + T + " il_lua_mul(" + T + " a, " + T + " b) {");
      line("  " + U + " x = a < 0 ? (" + U + ")0 - (" + U + ")a : (" + U + ")a;");
      line("  " + U + " y = b < 0 ? (" + U + ")0 - (" + U + ")b : (" + U + ")b;");
      line("  " + U + " r = 0;");
      line("  uint16_t m;");
      line("  uint8_t neg = (uint8_t)((a < 0) != (b < 0));");
      line("  if (y > 0xFFFFu) {");
      line("    if (x > 0xFFFFu) return (" + T + ")((" + U + ")a * (" + U + ")b);");
      line("    r = x; x = y; y = r; r = 0;");
      line("  }");
      line("  m = (uint16_t)y;");
      line("  while (m) {");
      line("    if (m & 1) r += x;");
      line("    x <<= 1;");
      line("    m >>= 1;");
      line("  }");
      line("  return (" + T + ")(neg ? (" + U + ")0 - r : r);");
      line("}");
      line("");
      /* x * K for a small constant K: when |x| <= 65535 / K the product fits 16 bits, and a 16-bit shift-add
       * chain costs ~50-150 cycles where il_lua_mul's loop over the smaller operand's bits costs 130-1,000.
       * Anything else (and the sign, handled on the magnitude) falls back to il_lua_mul. */
      Object.keys(uses.mulc).sort(function (x, y) { return x - y; }).forEach(function (ks) {
        var K = +ks, lim = Math.floor(65535 / K), body = [];
        line("static inline __attribute__((always_inline)) " + T + " il_mulc_" + K + "(" + T + " x) {");
        line("  if ((" + U + ")x + " + lim + "u <= " + (2 * lim) + "u) {");
        line("    uint16_t v = (uint16_t)(x < 0 ? 0 - x : x);");
        mulChain("pp", "v", K, "    ", body); body.forEach(function (l) { line(l); });
        line("    return x < 0 ? -(" + T + ")pp : (" + T + ")pp;");
        line("  }");
        line("  return il_lua_mul(x, " + K + ");");
        line("}");
        line("");
      });
    }
    if (uses.shl) {
      line("static " + T + " il_lua_shl(" + T + " x, " + T + " n) {");
      /* 32 bits in the IL; HuC's int is 16, so the shift count's limit is
       * the dialect's width (docs/IL.md §11). */
      line("  if (n < 0 || n >= " + (huc ? 16 : 32) + ") return 0;");
      line("  return (" + T + ")((" + U + ")x << n);");
      line("}");
      line("");
    }
    if (uses.shr) {
      line("static " + T + " il_lua_shr(" + T + " x, " + T + " n) {");
      line("  if (n < 0 || n >= " + (huc ? 16 : 32) + ") return 0;");
      line("  return (" + T + ")((" + U + ")x >> n);");
      line("}");
      line("");
    }

    /* ---- the table pool's helpers (#176) ------------------------------- */
    /* The same guards the interpreter runs (tools/ilvm/ilvm.c): an invalid
     * slot or an access outside the slot's shape reads 0 and writes
     * nothing.  A field key indexes the slot's field cells after its array
     * cells; an int key indexes the array cells 1-based. */
    if (a.usesTables) {
      /* cell(s, off): the cell of slot s at offset off from its base, in whichever pool its kind names */
      var kinds = [0];
      if (slotKind.indexOf(1) >= 0) kinds.push(1);
      if (slotKind.indexOf(2) >= 0) kinds.push(2);
      function access(off, assign) {   /* statements reading (return) or writing the cell at base + off */
        var out = [];
        if (!anyNarrow) {
          out.push(assign ? "  il_table_cells[il_slot_base[s] + " + off + "] = v;"
                          : "  return il_table_cells[il_slot_base[s] + " + off + "];");
          return out;
        }
        out.push("  switch (il_slot_kind[s]) {");
        kinds.forEach(function (k) {
          out.push("  case " + k + ": " + (assign
            ? KIND_POOL[k] + "[il_slot_base[s] + " + off + "] = (" + KIND_CT[k] + ")v; return;"
            : "return (" + T + ")" + KIND_POOL[k] + "[il_slot_base[s] + " + off + "];"));
        });
        out.push("  default: " + (assign ? "return;" : "return 0;"));
        out.push("  }");
        return out;
      }
      line("static " + T + " il_table_new(" + T + " s) {");
      line("  " + T + " i;");
      line("  if (s < 0 || s >= IL_NSLOTS) return s;");
      if (!anyNarrow) {
        line("  for (i = 0; i < il_slot_cap[s] + il_slot_fields[s]; i++)");
        line("    il_table_cells[il_slot_base[s] + i] = 0;");
      } else {
        line("  for (i = 0; i < il_slot_cap[s] + il_slot_fields[s]; i++) {");
        line("    switch (il_slot_kind[s]) {");
        kinds.forEach(function (k) {
          line("    case " + k + ": " + KIND_POOL[k] + "[il_slot_base[s] + i] = 0; break;");
        });
        line("    default: break;");
        line("    }");
        line("  }");
      }
      line("  return s;");
      line("}");
      line("");
      line("static " + T + " il_table_get(" + T + " s, " + T + " i) {");
      line("  if (s < 0 || s >= IL_NSLOTS) return 0;");
      line("  if (i < 1 || i > il_slot_cap[s]) return 0;");
      access("i - 1", false).forEach(function (l) { line(l); });
      line("}");
      line("");
      line("static void il_table_set(" + T + " s, " + T + " i, " + T + " v) {");
      line("  if (s < 0 || s >= IL_NSLOTS) return;");
      line("  if (i < 1 || i > il_slot_cap[s]) return;");
      access("i - 1", true).forEach(function (l) { line(l); });
      line("}");
      line("");
      line("static " + T + " il_table_getf(" + T + " s, " + T + " f) {");
      line("  if (s < 0 || s >= IL_NSLOTS) return 0;");
      line("  if (f >= il_slot_fields[s]) return 0;");
      access("il_slot_cap[s] + f", false).forEach(function (l) { line(l); });
      line("}");
      line("");
      line("static void il_table_setf(" + T + " s, " + T + " f, " + T + " v) {");
      line("  if (s < 0 || s >= IL_NSLOTS) return;");
      line("  if (f >= il_slot_fields[s]) return;");
      access("il_slot_cap[s] + f", true).forEach(function (l) { line(l); });
      line("}");
      line("");
    }

    /* ---- the functions ------------------------------------------------- */
    for (i = 0; i < a.functions.length; i++) {
      emitFunction(a.functions[i], i);
      line("");
    }

    /* ---- the entry points --------------------------------------------- */
    /* The timer's callback closure slot, written by the timer() instruction
     * and read by the pump below.  Only a toy that starts the timer carries
     * it, so part A's palette ROM is unchanged. */
    if (a.usesTimer) {
      line("/* timer(period, fn): the callback the runtime pumps from the");
      line(" * frame loop, one call per TMA interrupt (#45). */");
      line("static void il_timer_pump(void) {");
      line(huc ? "  " + T + " n;" : "  " + T + " n;");
      line("  if (il_timer_cb < 0) return;");
      line("  n = toy_timer_pending();");
      line(huc ? "  while (n > 0) { n--; (void)il_call(il_timer_cb, " +
                 ARGS.map(function () { return "0"; }).join(", ") + "); }"
               : "  while (n-- > 0) (void)il_call(il_timer_cb, " +
                 ARGS.map(function () { return "0"; }).join(", ") + ");");
      line("}");
      line("");
    }

    line("/* The runtime calls toy_boot() once, then toy_frame(f) each VBlank. */");
    line("void toy_boot(void) {");
    /* the toy's art (tiles, palettes, sprites) goes into VRAM, the colour table and
     * the sprite list before its first statement, as the browser's importer does
     * (tools/native-assets.js, tools/toyc/toy_assets.c) */
    if (options && options.assets && !huc) line("  toy_assets_boot();");
    if (a.usesSound && !huc) line("  toy_sound_boot();");
    /* The chunk is function 0, not a closure value: call it directly. */
    line("  (void)il_fn_0(&il_closures[0], " + callArgs([]) + ");");
    if (a.hookInit) {
      line("  if (il_globals[" + a.globalIds["init"] + "] >= 0)");
      line("    (void)il_call(il_globals[" + a.globalIds["init"] + "], " +
           callArgs([]) + ");");
    }
    line("  toy_display_on();");
    line("}");
    line("");
    line("void toy_frame(" + T + " f) {");
    if (a.usesSound && !huc) line("  toy_sound_tick();");
    if (a.usesTimer) line("  il_timer_pump();");
    line("  (void)il_call(il_globals[" + a.globalIds["frame"] + "], " +
         callArgs(["0", "f"]) + ");");
    line("}");
    line("");
    /* The raster hook, if any: one call per display line, made by the
     * runtime (which decides how it reaches the RCR interrupt, docs/IL.md
     * §10).  A weaker symbol than the runtime's weak stub, so its presence
     * is how main() knows the toy has a callback. */
    if (a.hookRaster != null) {
      /* the per-line callback runs 224 times a frame: the bank packer keeps a small one in the fixed page,
       * where il_call needs no bank switch (measured: STARFALL's raster call cost +400 cycles in a bank) */
      line("/* HOT il_fn_" + a.hookRaster + " */");
      line("void toy_raster(" + T + " line) {");
      /* a hook assigned once, from one closure site, is called directly (no il_call per line); the
       * packer keeps a small hook in the fixed page, so this is a plain call there */
      var rsites = sitesOfFid[a.hookRaster];
      var rsets = 0;
      a.functions.forEach(function (f) {
        f.code.forEach(function (c) { if (c.t === "setglobal" && c.name === "raster") rsets++; });
      });
      if (!huc && !NO_DIRECT && rsites && rsites.length === 1 && rsets === 1) {
        line("  (void)IL_DIRECT(none, " + a.hookRaster + ", " + rsites[0].cid + ", " + callArgs(["line"]) + ");");
      } else {
        line("  (void)il_call(il_globals[" + a.globalIds["raster"] + "], " +
             callArgs(["line"]) + ");");
      }
      line("}");
      line("");
    }

    return out.join("\n") + "\n";
  }

  /* ---- the front end on its own (#193) --------------------------------- *
   *
   * check(program) runs analyse() + validate() and returns every refusal,
   * in source order, without emitting a line of C.  renderer/pce-romcheck.js
   * is the one caller: the Studio's ROM CHECK drawer, the MCP rom_check tool
   * and the generated docs all report what this returns, so the list the
   * author sees is the compiler's own, not a second description of it.
   *
   * emitC() is unchanged: it calls analyse(program) and validate(program, a,
   * huc) with no collector and still throws the first CGenError. */
  function check(program, options) {
    var issues = [];
    var a = analyse(program, issues);
    if (a) validate(program, a, !!(options && options.target === "huc"), issues);
    /* The HuC dialect's width rule lives in the constant lowering, which
     * emitC() runs; check() never emits, so apply the same rule to every
     * constant operand here.  The llvm route has no width refusal. */
    if (a && options && options.target === "huc") {
      var scan = function (ins) {
        var ops = [ins.a, ins.b, ins.cond, ins.callee, ins.value, ins.addr,
                   ins.word, ins.lineArg, ins.spec, ins.i, ins.k, ins.key,
                   ins.n, ins.pad];
        if (ins.t === "move" || ins.t === "ret") ops.push(ins.src);
        if (ins.args) ops = ops.concat(ins.args);
        if (ins.values) ops = ops.concat(ins.values);
        for (var q = 0; q < ops.length; q++) {
          var op = ops[q];
          if (!op || !op.k) continue;
          try {
            constLitImpl(op.k, true);
          } catch (e) {
            if (!(e instanceof CGenError)) throw e;
            if (e.line == null) e.line = ins.line == null ? null : ins.line;
            issues.push(e);
          }
        }
      };
      for (var hf = 0; hf < a.functions.length; hf++) {
        for (var hp = 0; hp < a.functions[hf].code.length; hp++) {
          scan(a.functions[hf].code[hp]);
        }
      }
    }
    /* A feature can be refused twice for the same line (a global lookup in
     * analyse and again in validate); keep one of each code+line+message. */
    var seen = {}, out = [];
    for (var i = 0; i < issues.length; i++) {
      var e = issues[i];
      var key = e.code + "\u0000" + (e.line == null ? "" : e.line) +
                "\u0000" + e.message;
      if (seen[key]) continue;
      seen[key] = true;
      out.push({ code: e.code, line: e.line == null ? null : e.line,
                 message: e.message });
    }
    out.sort(function (x, y) {
      var lx = x.line == null ? Infinity : x.line;
      var ly = y.line == null ? Infinity : y.line;
      return lx - ly || (x.code < y.code ? -1 : x.code > y.code ? 1 : 0);
    });
    return out;
  }

  /* What this backend carries today, and what it refuses, as ONE table.
   * renderer/pce-romcheck.js re-exports it, tools/docs.js prints it and the
   * Studio's ROM CHECK drawer shows it: there is no hand-written copy of
   * these lists anywhere, so a feature added to (or refused by) this file
   * cannot go stale in the docs.  `refused` is REFUSALS itself. */
  var FEATURES = {
    route: "C compiler — checked by the Studio's Export; built with llvm-mos",
    carried: [
      { id: "chunk", label: "the file's top-level statements",
        detail: "run once by toy_boot",
        ops: ["const", "move", "ret"] },
      { id: "hooks", label: "init(), frame(t, f) and raster(line)",
        detail: "the three hooks the runtime calls; the console passes t = 0",
        ops: [] },
      { id: "int", label: "32-bit integer arithmetic + - * % // & | ^ << >>",
        detail: "Lua's % and // keep the divisor's sign",
        ops: ["arith"] },
      { id: "bool", label: "booleans, comparisons, and/or",
        detail: "a branch condition the IL did not type as bool is cgen-cond",
        ops: ["cmp", "br"] },
      { id: "flow", label: "if, while, numeric for, break",
        detail: "jumps must land on an instruction (cgen-target)",
        ops: ["br", "jmp", "forprep", "fornext"] },
      { id: "calls", label: "function calls with up to " + ilbc.MAX_ARGS +
        " arguments", detail: "a ninth parameter or argument is cgen-arity",
        ops: ["call"] },
      { id: "closures", label: "closures and upvalues",
        detail: "one static slot per site; a closure created in a loop is " +
                "refused when a function value can be stored",
        ops: ["closure", "getupval"] },
      { id: "globals", label: "int, bool, function and table globals",
        detail: "the IL must declare the global's type (cgen-global)",
        ops: ["getglobal", "setglobal"] },
      { id: "tables", label: "tables: int array keys, string fields",
        detail: "a static pool of " + ilbc.TABLE_POOL_CELLS + " cells, one " +
                "slot per table site; an escaping site that runs more than " +
                "once is cgen-table-escape",
        ops: ["table", "setlist", "tget", "tset"] },
      { id: "vram", label: "vram[...] writes", detail: "vset; a vram read " +
        "(vget) is cgen-op", ops: ["vset"] },
      { id: "pal", label: "pal(addr, word) and rgb(r, g, b)",
        detail: "rgb and note are the value-returning builtins lowered",
        ops: ["pal", "builtin"] },
      { id: "reg", label: "reg(\"BXR\", v), reg(\"BYR\", v), reg(\"CR\", v)",
        detail: "the three registers a toy may write",
        ops: ["reg"] },
      { id: "sat", label: "sat(i, k, v)", detail: "one raw SAT word",
        ops: ["sat"] },
      { id: "sprites", label: "sprite(i, spec)", detail: "one SAT entry " +
        "from a spec table whose slot and fields are constants; a spec the " +
        "encoder's walker cannot pin is cgen-op",
        ops: ["sprite"] },
      { id: "pads", label: "pad[n].field", detail: "the five controllers",
        ops: ["padref", "padget"] },
      { id: "timer", label: "timer(period, fn)",
        detail: "the HuC6280 TMA timer and its callback",
        ops: ["timer"] },
      { id: "sound", label: "music(song), sfx(ch, freq, volume, frames), " +
        "release(ch) and note(midi)",
        detail: "lowered to the engine's runtime calls toy_music/toy_sfx/" +
                "toy_release/toy_note — a later engine link declares them, " +
                "so a sound toy's C does not build until then (the browser " +
                "host runs the same ops today)",
        ops: ["music", "sfx", "release"] }
    ],
    /* Everything else the bytecode route carries and this backend does not is
     * named by the cgen-op details in REFUSALS (the print surface and a
     * sprite spec no walker can pin). */
    refused: null
  };

  /* The codes and their meanings, for the toy author's reference (#61), the
   * chat-AI guide's error table and the ROM CHECK drawer: one table, so a
   * code added above is described here or the reference test notices. */
  var REFUSALS = {
    "cgen-op": "an IL instruction this backend has no C lowering for " +
               "(fixed point, some builtins, print, or a sprite " +
               "whose spec it cannot pin to constants)",
    "cgen-fixed": "fixed-point arithmetic or a fixed-point constant",
    "cgen-cond": "a branch whose condition the IL did not type as bool",
    "cgen-global": "a global whose type this backend cannot put in C",
    "cgen-arity": "more than " + ilbc.MAX_ARGS +
                  " parameters or arguments",
    "cgen-hook": "no frame() hook, no top-level chunk, or a raster() hook " +
                 "that is not one int parameter",
    "cgen-closure-loop": "a closure created inside a loop",
    "cgen-key": "a constant operand that is neither int nor bool",
    "cgen-target": "a jump target that is not an instruction",
    "cgen-width": "a constant that does not fit the C dialect's width",
    "cgen-table-ram": "a table access or slot shape the fixed cell pool " +
                      "cannot serve",
    "cgen-table-escape": "a table site that can run more than once and " +
                         "escapes; one static slot would alias two tables"
  };
  FEATURES.refused = REFUSALS;

  return {
    VERSION: VERSION,
    CGenError: CGenError,
    emitC: emitC,
    check: check,
    FEATURES: FEATURES,
    /* exported for the test: the refusal codes part A can raise */
    CODES: ["cgen-op", "cgen-fixed", "cgen-cond", "cgen-global",
            "cgen-arity", "cgen-hook", "cgen-closure-loop", "cgen-key",
            "cgen-target", "cgen-width", "cgen-table-ram", "cgen-table-escape"],
    REFUSALS: REFUSALS
  };
});
