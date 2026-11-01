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
      closureCount: closureSites.length,
      typeOf: typeOf,
      usesTimer: usesTimer,
      globalIds: globalIds,
      globalNames: globalNames,
      hookInit: program.hooks.init != null,
      hookFrame: program.hooks.frame,
      hookRaster: hookRaster,
      usesTables: usesTables,
      usesSprites: usesSprites,
      table: table,
      sprites: table ? table.sprites : null,
      tableSiteAt: tableSiteAt,
      tableFieldIds: tableFieldIds
    };
  }

  /* Registers read before any write on a linear path.  The llvm-mos
   * dialect zero-initialises the whole register file (`int32_t r[N] = { 0 }`);
   * HuC's C has no initialiser list for a local array, so this backend emits
   * an explicit `r[i] = 0;` for exactly those registers.  A register that is
   * written first needs no initial value and costs nothing.  (Linear order
   * is enough: the IL's registers are the Lua VM's, and a branch target
   * always has its value from a path that wrote it first.) */
  function registersReadFirst(fn, functions) {
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
      if (ins.t === "forprep") written[ins.base] = true;
      else if (ins.t === "fornext") {
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

  function validate(program, a, huc, issues) {
    var uses = { mod: false, idiv: false, shl: false, shr: false };
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
          if (ins.op === "mod") uses.mod = true;
          else if (ins.op === "idiv") uses.idiv = true;
          else if (ins.op === "shl") uses.shl = true;
          else if (ins.op === "shr") uses.shr = true;
          else if (["add", "sub", "mul", "band", "bor", "bxor"]
                   .indexOf(ins.op) < 0) {
            refuse("cgen-op", where + ": arithmetic `" + ins.op + "`");
          }
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

    function emitFunction(fn, fid) {
      var labels = {};
      var pc;
      for (pc = 0; pc < fn.code.length; pc++) {
        var ins = fn.code[pc];
        var t = (ins.t === "jmp" || ins.t === "br" || ins.t === "fornext")
                ? ins.target : null;
        if (t != null) labels[t] = true;
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
        line("  " + d + " = cl->up[" + ins.idx + "];");
        break;
      case "closure": {
        var cid = a.closureAt[fid + ":" + pc];
        var target = a.functions[ins.fid];
        line("  il_closures[" + cid + "].fid = " + ins.fid + ";");
        for (var u = 0; u < target.upvalues.length; u++) {
          var desc = target.upvalues[u];
          var v;
          if (desc.type === "env") v = "0";
          else if (desc.from === "reg") v = "r[" + desc.index + "]";
          else v = "cl->up[" + desc.index + "]";
          line("  il_closures[" + cid + "].up[" + u + "] = " + v + ";");
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
          expr = "(" + T + ")((" + U + ")" + lhs + " * (" + U + ")" + rhs + ")";
          break;
        case "mod":
          expr = "il_lua_mod(" + lhs + ", " + rhs + ")";
          break;
        case "idiv":
          expr = "il_lua_idiv(" + lhs + ", " + rhs + ")";
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
             (ins.when ? 1 : 0) + ") goto L" + ins.target + ";");
        break;
      case "jmp":
        line("  goto L" + ins.target + ";");
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
        var call = "il_call(" + operand(ins.callee);
        for (var ci = 0; ci < ARGS.length; ci++) call += ", " + argOf(ins, ci);
        call += ")";
        line("  " + (d ? d + " = " : "(void)") + call + ";");
        break;
      }
      case "sat":
        /* SAT entry i, word k: VRAM $7F00 + i*4 + k, the buffer the runtime's
         * DSR auto-repeat DMAs into SATB every VBlank (viewer.asm's layout,
         * docs/ROM_LAYOUT.md). */
        line("  toy_sat(" + operand(ins.i) + ", " + operand(ins.k) + ", " +
             operand(ins.v) + ");");
        break;
      case "sprite": {
        /* #190: one SAT entry from the six values pce-ilbc.js resolved off
         * the spec's table site, in the op's own order — slot, x, y,
         * pattern, palette, attr.  validate() has refused any site the
         * walker could not pin, so the records here are all resolved. */
        var spr = a.sprites[fid][pc];
        line("  toy_sprite(" + constLit({ t: "int", v: spr.slot }) + ", " +
             constLit({ t: "int", v: spr.x }) + ", " +
             constLit({ t: "int", v: spr.y }) + ", " +
             constLit({ t: "int", v: spr.pattern }) + ", " +
             constLit({ t: "int", v: spr.palette }) + ", " +
             constLit({ t: "int", v: spr.attr }) + ");");
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
          line("      goto L" + ins.target + ";");
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
        line("      goto L" + ins.target + ";");
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
        line("  toy_vram_set(" + operand(ins.addr) + ", " + operand(ins.word) + ");");
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
        for (var vi = 0; vi < ins.values.length; vi++) {
          line("  il_table_set(" + operand(ins.base) + ", " +
               (ins.index + vi) + ", " + operand(ins.values[vi]) + ");");
        }
        break;
      case "tget":
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
    }
    line("");
    line("#define IL_NCLOSURES " + Math.max(1, a.closureCount));
    line("#define IL_NGLOBALS " + a.globalNames.length);
    line("#define IL_NUPS " + Math.max(1, a.maxUps));
    line("");
    line("struct il_closure {");
    line(huc ? "  int fid;" : "  int16_t fid;");
    line("  " + T + " up[IL_NUPS];");
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
    } else {
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
      line("#define IL_TABLE_CELLS " + ilbc.TABLE_POOL_CELLS);
      line("#define IL_NSLOTS " + a.table.nslots);
      line("static " + T + " il_table_cells[IL_TABLE_CELLS]");
      line("    __attribute__((section(\".bss\")));");
      line("static const uint16_t il_slot_base[IL_NSLOTS] = { " +
           a.table.sites.map(function (s) { return s.base; }).join(", ") + " };");
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
      line("static " + T + " il_lua_mod(" + T + " x, " + T + " y) {");
      /* HuC only initialises a local with a constant (measured: `int m =
       * x % y;` fails to compile), so the dialect splits declaration and
       * assignment. */
      line(huc ? "  " + T + " m; m = x % y;" : "  " + T + " m = x % y;");
      line("  if (m != 0 && ((m < 0) != (y < 0))) m += y;");
      line("  return m;");
      line("}");
      line("");
    }
    if (uses.idiv) {
      line("/* Lua's `//`: floor division. */");
      line("static " + T + " il_lua_idiv(" + T + " x, " + T + " y) {");
      if (huc) {
        line("  " + T + " q; " + T + " r;");
        line("  q = x / y; r = x % y;");
      } else {
        line("  " + T + " q = x / y;");
        line("  " + T + " r = x % y;");
      }
      line("  if (r != 0 && ((r < 0) != (y < 0))) q--;");
      line("  return q;");
      line("}");
      line("");
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
      line("static " + T + " il_table_new(" + T + " s) {");
      line("  " + T + " i;");
      line("  if (s < 0 || s >= IL_NSLOTS) return s;");
      line("  for (i = 0; i < il_slot_cap[s] + il_slot_fields[s]; i++)");
      line("    il_table_cells[il_slot_base[s] + i] = 0;");
      line("  return s;");
      line("}");
      line("");
      line("static " + T + " il_table_get(" + T + " s, " + T + " i) {");
      line("  if (s < 0 || s >= IL_NSLOTS) return 0;");
      line("  if (i < 1 || i > il_slot_cap[s]) return 0;");
      line("  return il_table_cells[il_slot_base[s] + i - 1];");
      line("}");
      line("");
      line("static void il_table_set(" + T + " s, " + T + " i, " + T + " v) {");
      line("  if (s < 0 || s >= IL_NSLOTS) return;");
      line("  if (i < 1 || i > il_slot_cap[s]) return;");
      line("  il_table_cells[il_slot_base[s] + i - 1] = v;");
      line("}");
      line("");
      line("static " + T + " il_table_getf(" + T + " s, " + T + " f) {");
      line("  if (s < 0 || s >= IL_NSLOTS) return 0;");
      line("  if (f >= il_slot_fields[s]) return 0;");
      line("  return il_table_cells[il_slot_base[s] + il_slot_cap[s] + f];");
      line("}");
      line("");
      line("static void il_table_setf(" + T + " s, " + T + " f, " + T + " v) {");
      line("  if (s < 0 || s >= IL_NSLOTS) return;");
      line("  if (f >= il_slot_fields[s]) return;");
      line("  il_table_cells[il_slot_base[s] + il_slot_cap[s] + f] = v;");
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
      line("void toy_raster(" + T + " line) {");
      line("  (void)il_call(il_globals[" + a.globalIds["raster"] + "], " +
           callArgs(["line"]) + ");");
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
    route: "C compiler — the Studio's Export (pce-cgen -> llvm-mos)",
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
                "toy_release/toy_note — the engine-link card declares them, " +
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
