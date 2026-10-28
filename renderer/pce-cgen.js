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

  function constLit(k) {
    if (!k) refuse("cgen-key", "a missing constant operand");
    if (k.t === "int") {
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

  function operand(op) {
    if (!op) return "0";
    if (op.r != null) return "r[" + op.r + "]";
    if (op.k) return constLit(op.k);
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

    return {
      functions: functions,
      maxUps: maxUps,
      maxParams: maxParams,
      closureAt: closureAt,
      closureCount: closureSites.length,
      typeOf: typeOf,
      globalIds: globalIds,
      globalNames: globalNames,
      hookInit: program.hooks.init != null,
      hookFrame: program.hooks.frame,
      hookRaster: hookRaster
    };
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
          if (!/^(fn|vram|int|bool)$/.test(a.typeOf[ins.name])) {
            refuse("cgen-global", where + ": global `" + ins.name + "` is " +
                   a.typeOf[ins.name] + "; this backend carries fn/vram/" +
                   "int/bool");
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
        case "builtin":
          if (ins.name !== "rgb") {
            refuse("cgen-op", where + ": builtin `" + ins.name + "` (part A " +
                   "lowers rgb only)");
          }
          break;
        default:
          refuse("cgen-op", where + ": not lowered by this backend (" +
                 "init/frame/raster and reg/pal/vset only; no sprites, " +
                 "tables, pads or fixed point)");
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

  function emitC(program) {
    var a = analyse(program);
    var uses = validate(program, a);
    var out = [];
    var i;
    function line(s) { out.push(s); }

    /* Two argument slots unless some function of the toy takes more (the
     * #29 examples' batfill takes four).  Keeping the two-slot signature for
     * toys that never need it is what leaves part A's palette ROM
     * byte-identical. */
    var ARGS = a.maxParams > 2 ? ["a0", "a1", "a2", "a3"] : ["a0", "a1"];
    var SIG = ARGS.map(function (n) { return "int32_t " + n; }).join(", ");
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
      line("static int32_t il_fn_" + fid +
           "(struct il_closure *cl, " + SIG + ") {");
      line("  int32_t r[" + Math.max(1, fn.registers) + "] = { 0 };");
      line("  (void)cl; " + ARGS.map(function (n) {
        return "(void)" + n + ";";
      }).join(" "));
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
        if (a.typeOf[ins.name] === "vram") {
          /* vset/vget do not take a base operand; the marker is a value
           * only so the register is defined. */
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
          expr = "(int32_t)((uint32_t)" + lhs + " + (uint32_t)" + rhs + ")";
          break;
        case "sub":
          expr = "(int32_t)((uint32_t)" + lhs + " - (uint32_t)" + rhs + ")";
          break;
        case "mul":
          expr = "(int32_t)((uint32_t)" + lhs + " * (uint32_t)" + rhs + ")";
          break;
        case "mod":
          expr = "il_lua_mod(" + lhs + ", " + rhs + ")";
          break;
        case "idiv":
          expr = "il_lua_idiv(" + lhs + ", " + rhs + ")";
          break;
        case "band":
          expr = "(int32_t)((uint32_t)" + lhs + " & (uint32_t)" + rhs + ")";
          break;
        case "bor":
          expr = "(int32_t)((uint32_t)" + lhs + " | (uint32_t)" + rhs + ")";
          break;
        case "bxor":
          expr = "(int32_t)((uint32_t)" + lhs + " ^ (uint32_t)" + rhs + ")";
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
          line("  " + d + " = (int32_t)(" + ca + " < " + cb + ");");
        } else if (ins.op === "le") {
          line("  " + d + " = (int32_t)(" + ca + " <= " + cb + ");");
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
      case "ret":
        line("  return " + (ins.src ? operand(ins.src) : "0") + ";");
        break;
      case "forprep":
        line("  r[" + ins.base + "] = (int32_t)((uint32_t)r[" + ins.base +
             "] - (uint32_t)r[" + (ins.base + 2) + "]);");
        break;
      case "fornext":
        line("  {");
        line("    int32_t st = r[" + (ins.base + 2) + "];");
        line("    int32_t idx = (int32_t)((uint32_t)r[" + ins.base +
             "] + (uint32_t)st);");
        line("    int32_t lim = r[" + (ins.base + 1) + "];");
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
    line(" * #31 console backend: init/frame and, when the toy has one, the");
    line(" * raster(line) hook (docs/IL.md §9-§10).");
    line(" */");
    line("#include <stdint.h>");
    line("#include \"toy_runtime.h\"");
    line("");
    line("#define IL_NCLOSURES " + Math.max(1, a.closureCount));
    line("#define IL_NGLOBALS " + a.globalNames.length);
    line("#define IL_NUPS " + Math.max(1, a.maxUps));
    line("");
    line("struct il_closure {");
    line("  int16_t fid;");
    line("  int32_t up[IL_NUPS];");
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
    line("static struct il_closure il_closures[IL_NCLOSURES]");
    line("    __attribute__((section(\".bss\")));");
    line("static volatile int32_t il_globals[IL_NGLOBALS]");
    line("    __attribute__((section(\".data\"))) = { " +
         a.globalNames.map(function () { return "-1"; }).join(", ") + " };");
    line("");
    for (i = 0; i < a.functions.length; i++) {
      line("static int32_t il_fn_" + i +
           "(struct il_closure *cl, " + SIG + ")" +
           " __attribute__((noinline));");
    }
    line("static int32_t il_call(int32_t cv, " + SIG + ")" +
         " __attribute__((noinline));");
    line("");

    /* ---- the dispatcher ----------------------------------------------- */
    line("static int32_t il_call(int32_t cv, " + SIG + ") {");
    line("  int16_t fid;");
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
      line("static int32_t il_lua_mod(int32_t x, int32_t y) {");
      line("  int32_t m = x % y;");
      line("  if (m != 0 && ((m < 0) != (y < 0))) m += y;");
      line("  return m;");
      line("}");
      line("");
    }
    if (uses.idiv) {
      line("/* Lua's `//`: floor division. */");
      line("static int32_t il_lua_idiv(int32_t x, int32_t y) {");
      line("  int32_t q = x / y;");
      line("  int32_t r = x % y;");
      line("  if (r != 0 && ((r < 0) != (y < 0))) q--;");
      line("  return q;");
      line("}");
      line("");
    }
    if (uses.shl) {
      line("static int32_t il_lua_shl(int32_t x, int32_t n) {");
      line("  if (n < 0 || n >= 32) return 0;");
      line("  return (int32_t)((uint32_t)x << n);");
      line("}");
      line("");
    }
    if (uses.shr) {
      line("static int32_t il_lua_shr(int32_t x, int32_t n) {");
      line("  if (n < 0 || n >= 32) return 0;");
      line("  return (int32_t)((uint32_t)x >> n);");
      line("}");
      line("");
    }

    /* ---- the functions ------------------------------------------------- */
    for (i = 0; i < a.functions.length; i++) {
      emitFunction(a.functions[i], i);
      line("");
    }

    /* ---- the entry points --------------------------------------------- */
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
    line("void toy_frame(int32_t f) {");
    line("  (void)il_call(il_globals[" + a.globalIds["frame"] + "], " +
         callArgs(["0", "f"]) + ");");
    line("}");
    line("");
    /* The raster hook, if any: one call per display line, made by the
     * runtime (which decides how it reaches the RCR interrupt, docs/IL.md
     * §10).  A weaker symbol than the runtime's weak stub, so its presence
     * is how main() knows the toy has a callback. */
    if (a.hookRaster != null) {
      line("void toy_raster(int32_t line) {");
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
            "cgen-target"]
  };
});
