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
 *                            compiler from vendor/huc, runtime huc_runtime.c
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
 *   cgen-arity      more than two parameters/arguments
 *   cgen-hook       no frame() hook, no top-level chunk, or a raster() hook
 *                   that is not one int parameter
 *   cgen-closure-loop  a closure created inside a loop (one static slot per
 *                   closure site)
 *   cgen-key        a constant operand that is neither int nor bool
 *   cgen-target     a jump target that is not an instruction
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
    module.exports = factory();
  } else {
    root.PCEStudio = root.PCEStudio || {};
    root.PCEStudio.cgen = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var VERSION = 1;

  function CGenError(code, message) {
    this.name = "CGenError";
    this.code = code;
    this.message = message;
  }
  CGenError.prototype = Object.create(Error.prototype);
  CGenError.prototype.constructor = CGenError;

  function refuse(code, message) { throw new CGenError(code, message); }

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

  function analyse(program) {
    if (!program || program.lang !== "pce-il" || program.version !== 1) {
      refuse("cgen-op", "not a pce-il version 1 program");
    }
    var functions = program.functions || [];
    if (!functions.length || functions[0].name !== "main") {
      refuse("cgen-hook", "the IL has no top-level chunk (function 0 `main`)");
    }
    if (program.hooks.frame == null) {
      refuse("cgen-hook", "the toy defines no frame() hook");
    }

    var maxUps = 0;
    var maxParams = 0;
    var f, pc;
    for (f = 0; f < functions.length; f++) {
      var fn = functions[f];
      if (fn.params.length > 4) {
        refuse("cgen-arity", fn.name + " takes " + fn.params.length +
               " parameters; this backend supports at most 4");
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
        refuse("cgen-hook", "raster() must be a function of one int parameter");
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
            refuse("cgen-closure-loop",
                   "function " + functions[f].name + ": a closure is created " +
                   "inside a loop (IL line " + code[pc].line + ") and a " +
                   "function value can be stored in this program; one static " +
                   "slot per site is not enough");
          }
        }
        closureAt[f + ":" + pc] = closureSites.length;
        closureSites.push({ fn: f, pc: pc, cid: closureSites.length,
                            fid: code[pc].fid });
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
             typeOf[gi.name] === "bool")) {
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
      hookRaster: hookRaster
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

  function validate(program, a) {
    var uses = { mod: false, idiv: false, shl: false, shr: false };
    var i, j;
    for (i = 0; i < a.functions.length; i++) {
      var fn = a.functions[i];
      if (fixedIsUsed(fn)) {
        refuse("cgen-fixed", "function " + fn.name +
               " reads a fixed-point parameter; part A passes t = 0");
      }
      for (j = 0; j < fn.code.length; j++) {
        var ins = fn.code[j];
        var where = "function " + fn.name + ", IL line " + ins.line +
                    ", instruction `" + ins.t + "`";
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
          if (!/^(fn|vram|int|bool|padset)$/.test(a.typeOf[ins.name])) {
            refuse("cgen-global", where + ": global `" + ins.name + "` is " +
                   a.typeOf[ins.name] + "; this backend carries fn/vram/" +
                   "int/bool/pad");
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
          if (ins.args.length > 4) {
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
          if (ins.name !== "rgb") {
            refuse("cgen-op", where + ": builtin `" + ins.name + "` (part A " +
                   "lowers rgb only)");
          }
          break;
        default:
          refuse("cgen-op", where + ": not lowered by this backend (" +
                 "init/frame/raster and reg/pal/vset/sat/pad and the timer " +
                 "only; no sprites, tables or fixed point)");
        }
        var t = (ins.t === "jmp" || ins.t === "br" || ins.t === "fornext")
                ? ins.target : null;
        if (t != null && (typeof t !== "number" || t < 0 || t >= fn.code.length)) {
          refuse("cgen-target", where + ": target " + t + " is not an instruction");
        }
      }
    }
    return uses;
  }

  /* ---- the emitter ------------------------------------------------------ */

  function emitC(program, options) {
    var huc = !!(options && options.target === "huc");
    var a = analyse(program);
    var uses = validate(program, a);
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
     * byte-identical. */
    var ARGS = a.maxParams > 2 ? ["a0", "a1", "a2", "a3"] : ["a0", "a1"];
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
        line("  r[" + pc + "] = a" + pc + ";");
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
        /* validate() admits only rgb */
        line("  " + d + " = toy_rgb(" + operand(ins.args[0]) + ", " +
             operand(ins.args[1]) + ", " + operand(ins.args[2]) + ");");
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

  return {
    VERSION: VERSION,
    CGenError: CGenError,
    emitC: emitC,
    /* exported for the test: the refusal codes part A can raise */
    CODES: ["cgen-op", "cgen-fixed", "cgen-cond", "cgen-global",
            "cgen-arity", "cgen-hook", "cgen-closure-loop", "cgen-key",
            "cgen-target", "cgen-width"]
  };
});
