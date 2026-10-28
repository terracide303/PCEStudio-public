/*
 * pce-il.js — PCEStudio's intermediate language, the Lua subset's lowering,
 * and a reference interpreter (card #31, the IL half).
 *
 * The pipeline is the one ppu.toys' author described (docs/PPU-TOYS.md):
 *
 *   Lua subset --(this file)--> IL --(later: #32 analysis, backends)--> code
 *
 * The front end is Lua 5.3's own parser and compiler, the copy the browser
 * runs: vendor/fengari (MIT). This file does NOT parse Lua a second time. It
 * compiles the toy with Fengari, reads the resulting Proto tree (instructions,
 * constants, nested prototypes, upvalue descriptors, line info), and lowers
 * those instructions to the IL below. That is rule 1 in practice: the
 * reference implementation does the syntax and the constant handling; this
 * file reads its output.
 *
 * The IL is typed, small, and explicit about the toy's hooks:
 *   - every value has a type (int, fixed, bool, table, fn, vram, pad,
 *     padset, env); a string exists only as a key or a name operand;
 *   - the instructions are listed in docs/IL.md, one entry per op;
 *   - init/frame/raster are found and typed before inference (frame(t, f):
 *     t is fixed, f is int; raster(line): line is int);
 *   - the toy surface (reg/pal/vram/sat/sprite/raster/print/pad) lowers to
 *     its own instructions, so #32 can count VDC/VCE traffic without knowing
 *     the Lua or the machine code.
 *
 * The interpreter executes the IL over renderer/pce-toyhost.js — the same
 * host, and the same frame flow, that renderer/pce-toys.js (the Fengari
 * runtime) uses. Nothing here draws; renderer/pce-sprites.js does.
 *
 * Refusals (a ToyError with e.code; docs/IL.md §5):
 *   il-syntax       Lua's own compile error (the message carries file:line)
 *   il-op           a Lua construct the IL has no instruction for
 *   il-method       a `:` method call (SELF)
 *   il-for-in       a generic for (pairs/ipairs)
 *   il-vararg       `...`
 *   il-multret      more than one value returned or requested
 *   il-string       a string used as a value
 *   il-mixed        int and fixed in one variable, or a fixed where an int is required
 *   il-int-range    an integer constant outside the IL's 32-bit integer
 *   il-fixed-range  a fixed-point constant outside its range
 *   il-type         a value the typer cannot resolve, or a type conflict
 *   il-cond         a condition that is not a bool
 *   il-table-read   reading a field of a toy-built table (write-only for now)
 *   il-pad-write    writing a pad table
 *   il-key          a table key that is not a constant or an integer register
 *   il-reg-name     reg()'s first argument is not a constant string
 *   il-surface-shadow  a toy reassigns a surface builtin (reg, pal, ...)
 *   il-unsupported  a known-unsupported helper (pairs, tostring, note, ...)
 *   il-undefined    using a global that is never defined
 *   il-env          using _ENV itself as a value
 *   il-arity        a call with the wrong number of arguments
 *   il-jump         a jump target that is not an instruction boundary
 *   toy-timeout     a hook ran past the instruction budget
 *   toy-error       a runtime misuse inside the IL (calling nil, ...)
 * plus the host's own codes, unchanged (reg-forbidden, reg-range, pal-range,
 * vram-range, sat-range, sprite-range, raster-line, raster-line-full).
 *
 * What this file deliberately does NOT do: machine code. The backend is
 * renderer/pce-cgen.js (part A: the IL -> C -> llvm-mos route, docs/IL.md
 * §9); the HuC route, a direct HuC6280 generator and their comparison are
 * later. No backend-specific choice is baked in here; the IL's types and op
 * list are what every backend reads.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./pce-sprites.js"),
                             require("./pce-toyhost.js"),
                             require("../vendor/fengari/fengari-node.js"));
  } else {
    root.PCEStudio = root.PCEStudio || {};
    root.PCEStudio.il = factory(root.PCEStudio.sprites,
                                root.PCEStudio.toyhost, root.fengari);
  }
})(typeof self !== "undefined" ? self : this, function (sprites, toyhost, F) {
  "use strict";

  var ToyError = toyhost.ToyError;
  var WIDTH = toyhost.WIDTH;
  var HEIGHT = toyhost.HEIGHT;
  var VDW_LINES = toyhost.VDW_LINES;
  var FIX = 65536;                  /* the IL's fixed point: Q16.16 */
  var LFIELDS_PER_FLUSH = 50;       /* Lua 5.3's SETLIST group size */
  var MAX_INSTRUCTIONS = 5000000;   /* one hook's IL budget */

  function refuse(code, message) { throw new ToyError(code, message); }

  /* ---- Lua 5.3 opcodes (vendor/fengari/src/lopcodes.js order) ---------- */

  var OP = {
    MOVE: 0, LOADK: 1, LOADKX: 2, LOADBOOL: 3, LOADNIL: 4,
    GETUPVAL: 5, GETTABUP: 6, GETTABLE: 7, SETTABUP: 8, SETUPVAL: 9,
    SETTABLE: 10, NEWTABLE: 11, SELF: 12,
    ADD: 13, SUB: 14, MUL: 15, MOD: 16, POW: 17, DIV: 18, IDIV: 19,
    BAND: 20, BOR: 21, BXOR: 22, SHL: 23, SHR: 24,
    UNM: 25, BNOT: 26, NOT: 27, LEN: 28, CONCAT: 29,
    JMP: 30, EQ: 31, LT: 32, LE: 33, TEST: 34, TESTSET: 35,
    CALL: 36, TAILCALL: 37, RETURN: 38,
    FORLOOP: 39, FORPREP: 40, TFORCALL: 41, TFORLOOP: 42,
    SETLIST: 43, CLOSURE: 44, VARARG: 45, EXTRAARG: 46
  };
  var OP_NAMES = {};
  for (var opName in OP) { if (OP.hasOwnProperty(opName)) OP_NAMES[OP[opName]] = opName; }

  /* Lua 5.3 constant tags as fengari stores them (ljstype.js: LUA_TNUMFLT=3,
   * LUA_TNUMINT=19, LUA_TSTRING=20). */
  var K_NUMFLT = 3, K_NUMINT = 19, K_STRING = 20;

  /* ---- types ------------------------------------------------------------ */

  /* A type is a small object. Simple kinds are singletons; fn signatures are
   * their own objects; a variable is {k:"var", id, ref}. */
  var T = {
    INT: { k: "int" },
    FIXED: { k: "fixed" },
    BOOL: { k: "bool" },
    STR: { k: "str" },
    TABLE: { k: "table" },
    VRAM: { k: "vram" },
    PAD: { k: "pad" },
    PADSET: { k: "padset" },
    ENV: { k: "env" },
    NIL: { k: "nil" }
  };
  function fnType(params, ret) {
    return { k: "fn", params: params, ret: ret || null };
  }
  function builtinType(name) { return { k: "builtin", name: name }; }
  function unsupportedType(name) { return { k: "unsupported", name: name }; }
  var nextVar = 1;
  function varType() { return { k: "var", id: nextVar++, ref: null }; }
  function isVar(t) { return !!t && t.k === "var"; }
  function resolve(t) {
    while (isVar(t) && t.ref) t = t.ref;
    return t;
  }
  function typeName(t) {
    t = resolve(t);
    if (!t) return "any";
    if (t.k === "var") return "unresolved";
    if (t.k === "fn") return "fn";
    if (t.k === "builtin") return "builtin " + t.name;
    if (t.k === "unsupported") return "unsupported " + t.name;
    return t.k;
  }

  /* Unify two types. Returns true when something was learned.
   * Errors are recorded (not thrown) so a whole function can be checked and
   * the first error, with its line, reported. docs/IL.md §4 lists the rules:
   * a variable has ONE numeric type; an int and a fixed in one variable is
   * `il-mixed`; literals are the exception the specialization pass applies. */
  function unify(a, b, errs, line) {
    a = resolve(a); b = resolve(b);
    if (a === b) return false;
    if (isVar(a)) { a.ref = b; return true; }
    if (isVar(b)) { b.ref = a; return true; }
    if (a.k === "nil" || b.k === "nil") return false;
    if (a.k === "int" && b.k === "int") return false;
    if (a.k === "fixed" && b.k === "fixed") return false;
    if ((a.k === "int" && b.k === "fixed") || (a.k === "fixed" && b.k === "int")) {
      errs.push({ code: "il-mixed", line: line,
                  message: "an int and a fixed-point value in one place (" +
                           typeName(a) + " and " + typeName(b) + ")" });
      return false;
    }
    if (a.k === "bool" && b.k === "bool") return false;
    if (a.k === "str" && b.k === "str") return false;
    if (a.k === "table" && b.k === "table") return false;
    if (a.k === "vram" && b.k === "vram") return false;
    if (a.k === "pad" && b.k === "pad") return false;
    if (a.k === "padset" && b.k === "padset") return false;
    if (a.k === "env" && b.k === "env") return false;
    if (a.k === "builtin" && b.k === "builtin" && a.name === b.name) return false;
    if (a.k === "unsupported" && b.k === "unsupported" && a.name === b.name) return false;
    if (a.k === "fn" && b.k === "fn") {
      if (a.params.length !== b.params.length) {
        errs.push({ code: "il-arity", line: line,
                    message: "a function used with " + a.params.length +
                             " and " + b.params.length + " parameters" });
        return false;
      }
      var changed = false;
      for (var i = 0; i < a.params.length; i++) {
        if (unify(a.params[i], b.params[i], errs, line)) changed = true;
      }
      if (a.ret && b.ret && unify(a.ret, b.ret, errs, line)) changed = true;
      if (!a.ret && b.ret) { a.ret = b.ret; changed = true; }
      return changed;
    }
    errs.push({ code: "il-type", line: line,
                message: "a " + typeName(a) + " used where a " +
                         typeName(b) + " is required" });
    return false;
  }

  function typeOfConst(k) {
    if (!k) return T.NIL;
    if (k.t === "int") return T.INT;
    if (k.t === "fixed") return T.FIXED;
    if (k.t === "bool") return T.BOOL;
    if (k.t === "str") return T.STR;
    return T.NIL;
  }

  /* ---- the builtin surface --------------------------------------------- */

  /* Each builtin is one of:
   *   {surface:true}          lowered to its own IL instruction (reg, pal, ...)
   *   {sig:[types], ret:type} a value-returning helper implemented here.
   * The signatures are what the typer checks; the implementations are below
   * and docs/TOYS.md §2 is the surface both runtimes share. */
  var SURFACE = ["reg", "pal", "sat", "sprite", "raster", "print"];
  var HELPERS = {
    rgb: { sig: [T.INT, T.INT, T.INT], ret: T.INT },
    min: { sig: [T.INT, T.INT], ret: T.INT, numeric: true },
    max: { sig: [T.INT, T.INT], ret: T.INT, numeric: true },
    floor: { sig: [T.INT], ret: T.INT, numeric: true },
    abs: { sig: [T.INT], ret: T.INT, numeric: true },
    clamp: { sig: [T.INT, T.INT, T.INT], ret: T.INT, numeric: true },
    lerp: { sig: [T.INT, T.INT, T.FIXED], ret: T.FIXED },
    ramp: { sig: [T.TABLE, T.FIXED], ret: T.FIXED },
    ramp_int: { sig: [T.TABLE, T.FIXED], ret: T.INT },
    sin: { sig: [T.FIXED], ret: T.FIXED },
    cos: { sig: [T.FIXED], ret: T.FIXED },
    sqrt: { sig: [T.FIXED], ret: T.FIXED }
  };
  var UNSUPPORTED_GLOBALS = {
    note: "note() needs the string parser; it is part of the sound card (#71)",
    ease: "ease() takes an easing name (a string), which the IL does not carry",
    lerp_color: "lerp_color() takes colour words the IL has no type for yet",
    ramp_color: "ramp_color() takes colour keyframes the IL has no type for yet",
    password: "password.pack/unpack return and take strings; the IL has no string values",
    tostring: "strings are not values in the IL",
    tonumber: "strings are not values in the IL",
    type: "the IL is statically typed; there is no type() at run time",
    pairs: "generic iteration over a table is a generic for (il-for-in)",
    ipairs: "generic iteration over a table is a generic for (il-for-in)",
    next: "generic iteration over a table is a generic for (il-for-in)",
    select: "variable argument counts are not in the IL",
    error: "error() takes a string message; the IL raises typed refusals",
    assert: "assert() takes a string message; the IL raises typed refusals",
    string: "strings are not values in the IL",
    table: "the table library is not in the IL subset",
    math: "call the numeric helpers directly (min/max/floor/abs/sqrt/sin/cos)",
    utf8: "strings are not values in the IL"
  };

  /* ---- the front end: Lua source -> Fengari Proto ---------------------- */

  function withLuaState(fn) {
    var L = F.lauxlib.luaL_newstate();
    if (!L) refuse("il-syntax", "Lua would not start (out of memory)");
    try {
      return fn(L);
    } finally {
      F.lua.lua_close(L);
    }
  }

  function parse(source, chunkName) {
    return withLuaState(function (L) {
      var bytes = F.to_luastring(source);
      var rc = F.lauxlib.luaL_loadbuffer(L, bytes, bytes.length,
                                         F.to_luastring(chunkName || "@toy.lua"));
      if (rc !== F.lua.LUA_OK) {
        var v = F.lua.lua_tostring(L, -1);
        var msg = v ? F.to_jsstring(v) : "Lua could not compile the toy";
        refuse("il-syntax", msg);
      }
      var closure = F.lua.lua_topointer(L, -1);
      if (!closure || !closure.p) {
        refuse("il-syntax", "Lua compiled the toy but returned no prototype");
      }
      return closure.p;
    });
  }

  function constString(k) {
    if (!k || k.ttype() !== K_STRING) return null;
    try { return F.to_jsstring(k.tsvalue().realstring); }
    catch (e) { return null; }
  }

  function decodeConst(k, line) {
    if (!k) return { t: "nil", v: null };
    var tt = k.ttype();
    if (tt === K_NUMINT) {
      var iv = k.value | 0;
      if (iv !== k.value) {
        refuse("il-int-range", "line " + line + ": the integer " + k.value +
               " does not fit the IL's 32-bit int");
      }
      return { t: "int", v: iv };
    }
    if (tt === K_NUMFLT) {
      var fv = k.value;
      if (!isFinite(fv) || Math.abs(fv) > 32767) {
        refuse("il-fixed-range", "line " + line + ": the number " + fv +
               " does not fit the IL's Q16.16 fixed point");
      }
      return { t: "fixed", v: fv };
    }
    if (tt === K_STRING) return { t: "str", v: constString(k) };
    return { t: "nil", v: null };
  }

  /* ---- operand helpers -------------------------------------------------- */

  function reg(n) { return { r: n }; }
  function konst(k) { return { k: k }; }
  function isRegOperand(op) { return op && op.r != null; }
  function isConstOperand(op) { return op && op.k != null; }
  function isStrConst(op) { return isConstOperand(op) && op.k.t === "str"; }

  /* ---- lowering one prototype ------------------------------------------ */

  /* Each prototype becomes one IL function. Registers and upvalues carry
   * type variables. The lowering emits "pre" instructions (operands are
   * register indices or constants); after inference they are specialized to
   * the final instruction list. */
  function lowerProto(proto, ctx) {
    var fnRec = {
      id: ctx.functions.length,
      name: ctx.nameFor(proto),
      proto: proto,
      numparams: proto.numparams,
      maxstack: proto.maxstacksize,
      params: (function () {
        var a = [];
        for (var i = 0; i < proto.numparams; i++) a.push(varType());
        return a;
      })(),
      ret: varType(),
      upTypes: [],
      captures: [],
      nextReg: proto.maxstacksize,     /* scratch slots start beyond the frame */
      pre: [],
      lines: proto.lineinfo || [],
      hooks: [],
      isRoot: ctx.functions.length === 0
    };
    for (var u = 0; u < proto.upvalues.length; u++) {
      var ud = proto.upvalues[u];
      var uname = ud.name ? (function () {
        try { return F.to_jsstring(ud.name.realstring); } catch (e) { return null; }
      })() : null;
      fnRec.upTypes.push(uname === "_ENV" ? T.ENV : varType());
      fnRec.captures.push({ instack: !!ud.instack, idx: ud.idx, name: uname });
    }
    if (!fnRec.isRoot && proto.is_vararg) {
      refuse("il-vararg", "line " + (proto.linedefined || 0) +
             ": a function with `...` is not in the IL subset");
    }
    ctx.functions.push(fnRec);

    var childFids = [];
    for (var c = 0; c < (proto.p ? proto.p.length : 0); c++) {
      childFids.push(lowerProto(proto.p[c], ctx).id);
    }

    var code = proto.code;
    var emittedAt = {};       /* pc -> index of the first IL instruction */
    var skippedPc = {};       /* pcs that are the JMP half of a condition */
    var branches = [];        /* {instr, targetPc} to patch after lowering */
    var regStr = {};          /* register -> string constant held there */
    var regFn = {};           /* register -> function id, when it holds a closure */
    var openReg = null;       /* the result register of a call with C=0, until
                               * the CALL/SETLIST that consumes it */

    function emit(instr) {
      instr.line = fnRec.lines[emittedAt.__pc] || 0;
      fnRec.pre.push(instr);
      return fnRec.pre.length - 1;
    }
    function markPc(pc) { if (emittedAt[pc] == null) emittedAt[pc] = fnRec.pre.length; }
    function rk(b, line) {
      if (b >= 256) {
        var k = decodeConst(proto.k[b - 256], line);
        return konst(k);
      }
      return reg(b);
    }
    function jumpTarget(pc, sBx) { return pc + 1 + sBx; }
    function targetOfCond(pc, sBx) { return pc + 2 + sBx; }
    function branch(instr, targetPc) {
      branches.push({ instr: instr, targetPc: targetPc, line: instr.line });
    }
    function heldString(regIdx) { return regStr[regIdx] != null ? regStr[regIdx] : null; }
    function clearReg(regIdx) { delete regStr[regIdx]; delete regFn[regIdx]; }

    for (var pc = 0; pc < code.length; pc++) {
      var i = code[pc];
      var line = fnRec.lines[pc] || 0;
      emittedAt.__pc = pc;
      markPc(pc);
      var A = i.A, B = i.B, C = i.C, sBx = i.sBx;
      var thisOpen = openReg;
      openReg = null;

      switch (i.opcode) {

      case OP.MOVE: {
        fnRec.pre.push({ t: "move", dst: A, src: reg(B), line: line });
        if (regStr[B] != null) regStr[A] = regStr[B]; else delete regStr[A];
        if (regFn[B] != null) regFn[A] = regFn[B]; else delete regFn[A];
        break;
      }

      case OP.LOADK: {
        var kk = decodeConst(proto.k[i.Bx], line);
        fnRec.pre.push({ t: "const", dst: A, k: kk, line: line });
        if (kk.t === "str") regStr[A] = kk.v; else delete regStr[A];
        delete regFn[A];
        break;
      }

      case OP.LOADKX:
        refuse("il-op", "line " + line + ": LOADKX (a very large constant table) is not lowered");

      case OP.LOADBOOL: {
        fnRec.pre.push({ t: "const", dst: A, k: { t: "bool", v: !!B }, line: line });
        clearReg(A);
        if (C) {
          /* LOADBOOL C=1 skips the next instruction on this path, but that
           * instruction is a legitimate jump target from the other path (it
           * is how Lua materialises a comparison as a bool), so it must still
           * be emitted: jump over it and continue. */
          var lj = { t: "jmp", target: null, line: line };
          fnRec.pre.push(lj);
          branch(lj, pc + 2);
        }
        break;
      }

      case OP.LOADNIL: {
        for (var nilR = A; nilR <= A + B; nilR++) {
          fnRec.pre.push({ t: "const", dst: nilR, k: { t: "nil", v: null }, line: line });
          clearReg(nilR);
        }
        break;
      }

      case OP.GETUPVAL:
        fnRec.pre.push({ t: "getupval", dst: A, idx: B, line: line });
        delete regStr[A]; delete regFn[A];
        break;

      case OP.SETUPVAL:
        fnRec.pre.push({ t: "setupval", idx: B, src: reg(A), line: line });
        break;

      case OP.GETTABUP: {
        var key = rk(C, line);
        if (fnRec.upTypes[B] && resolve(fnRec.upTypes[B]).k === "env") {
          if (!isStrConst(key)) {
            refuse("il-key", "line " + line + ": a global read needs a constant name");
          }
          if (SURFACE.indexOf(key.k.v) >= 0 || HELPERS[key.k.v] ||
              UNSUPPORTED_GLOBALS[key.k.v]) {
            /* one of the toy's builtins: a value only a call can use, and
             * the call is specialised, so it is usually dead (specialize
             * drops it when it is the call's callee) */
            fnRec.pre.push({ t: "builtinval", dst: A, name: key.k.v, line: line });
          } else {
            fnRec.pre.push({ t: "getglobal", dst: A, name: key.k.v, line: line });
          }
        } else {
          fnRec.pre.push({ t: "gettable", dst: A, base: { upval: B },
                           key: key, line: line });
        }
        delete regStr[A]; delete regFn[A];
        break;
      }

      case OP.SETTABUP: {
        var skey = rk(B, line);
        var sval = rk(C, line);
        if (fnRec.upTypes[A] && resolve(fnRec.upTypes[A]).k === "env") {
          if (!isStrConst(skey)) {
            refuse("il-key", "line " + line + ": a global write needs a constant name");
          }
          fnRec.pre.push({ t: "setglobal", name: skey.k.v, src: sval, line: line });
          /* a hook defined at top level: remember which function it is */
          if (skey.k.v === "init" || skey.k.v === "frame" || skey.k.v === "raster") {
            var fid = isRegOperand(sval) ? regFn[sval.r] : null;
            if (fid != null) ctx.hookFids[skey.k.v] = fid;
          }
        } else {
          fnRec.pre.push({ t: "settable", base: { upval: A }, key: skey,
                           value: sval, line: line });
        }
        break;
      }

      case OP.GETTABLE:
        fnRec.pre.push({ t: "gettable", dst: A, base: reg(B), key: rk(C, line),
                         line: line });
        delete regStr[A]; delete regFn[A];
        break;

      case OP.SETTABLE:
        fnRec.pre.push({ t: "settable", base: reg(A), key: rk(B, line),
                         value: rk(C, line), line: line });
        break;

      case OP.NEWTABLE:
        fnRec.pre.push({ t: "table", dst: A, line: line });
        delete regStr[A]; delete regFn[A];
        break;

      case OP.SELF:
        refuse("il-method", "line " + line + ": a `:` method call is not in the IL subset");

      case OP.ADD: case OP.SUB: case OP.MUL: case OP.MOD:
      case OP.DIV: case OP.IDIV:
      case OP.BAND: case OP.BOR: case OP.BXOR: case OP.SHL: case OP.SHR: {
        var arithNames = {};
        arithNames[OP.ADD] = "add"; arithNames[OP.SUB] = "sub";
        arithNames[OP.MUL] = "mul"; arithNames[OP.MOD] = "mod";
        arithNames[OP.DIV] = "div"; arithNames[OP.IDIV] = "idiv";
        arithNames[OP.BAND] = "band"; arithNames[OP.BOR] = "bor";
        arithNames[OP.BXOR] = "bxor"; arithNames[OP.SHL] = "shl";
        arithNames[OP.SHR] = "shr";
        fnRec.pre.push({ t: "arith", op: arithNames[i.opcode], dst: A,
                         a: rk(B, line), b: rk(C, line), line: line });
        delete regStr[A]; delete regFn[A];
        break;
      }

      case OP.POW:
        refuse("il-op", "line " + line + ": `^` (POW) is floating point and not in the IL");

      case OP.UNM:
        fnRec.pre.push({ t: "unm", dst: A, a: reg(B), line: line });
        delete regStr[A]; delete regFn[A];
        break;

      case OP.BNOT:
        fnRec.pre.push({ t: "bnot", dst: A, a: reg(B), line: line });
        delete regStr[A]; delete regFn[A];
        break;

      case OP.NOT:
        fnRec.pre.push({ t: "not", dst: A, a: reg(B), line: line });
        delete regStr[A]; delete regFn[A];
        break;

      case OP.LEN:
        refuse("il-op", "line " + line + ": `#` (LEN) is not in the IL subset");

      case OP.CONCAT:
        refuse("il-op", "line " + line + ": string concatenation is not in the IL subset");

      case OP.JMP:
        var j = { t: "jmp", target: null, line: line };
        fnRec.pre.push(j);
        branch(j, jumpTarget(pc, sBx));
        break;

      case OP.EQ: case OP.LT: case OP.LE: {
        var next = code[pc + 1];
        if (!next || next.opcode !== OP.JMP) {
          refuse("il-jump", "line " + line + ": a comparison not followed by a jump");
        }
        skippedPc[pc + 1] = true;
        var cmpDst = fnRec.nextReg++;        /* a scratch slot beyond the frame */
        var cmpName = i.opcode === OP.EQ ? "eq" : (i.opcode === OP.LT ? "lt" : "le");
        fnRec.pre.push({ t: "cmp", op: cmpName, dst: cmpDst,
                         a: rk(B, line), b: rk(C, line), line: line });
        /* Lua: if (result ~= A) then skip the jump; else take it. */
        var br = { t: "br", cond: reg(cmpDst), target: null, when: !!A, line: line };
        fnRec.pre.push(br);
        branch(br, targetOfCond(pc, next.sBx));
        pc++;                                /* the JMP is part of this pair */
        break;
      }

      case OP.TEST: {
        var nextT = code[pc + 1];
        if (!nextT || nextT.opcode !== OP.JMP) {
          refuse("il-jump", "line " + line + ": TEST not followed by a jump");
        }
        skippedPc[pc + 1] = true;
        /* OP_TEST skips the next JMP when (C ? isfalse(R(A)) : truthy);
         * so the JMP is taken when that condition is FALSE: for C=0, when
         * the value is falsey; for C=1, when it is truthy. */
        var brT = { t: "br", cond: reg(A), target: null, when: C ? true : false,
                    line: line };
        fnRec.pre.push(brT);
        branch(brT, targetOfCond(pc, nextT.sBx));
        pc++;
        break;
      }

      case OP.TESTSET: {
        var nextS = code[pc + 1];
        if (!nextS || nextS.opcode !== OP.JMP) {
          refuse("il-jump", "line " + line + ": TESTSET not followed by a jump");
        }
        skippedPc[pc + 1] = true;
        var brS = { t: "br", cond: reg(B), target: null,
                    when: C ? false : true, line: line };
        fnRec.pre.push(brS);
        branch(brS, pc + 2);                 /* skip: leave R(B) in R(A)? no */
        /* Lua: when the test does not match, R(A) := R(B) and take the jump;
         * when it matches, skip the jump and leave R(A) alone. The branch
         * above jumps to the fall-through in the matching case, so the move
         * below and the jump are the non-matching case. */
        fnRec.pre.push({ t: "move", dst: A, src: reg(B), line: line });
        if (regStr[B] != null) regStr[A] = regStr[B]; else delete regStr[A];
        if (regFn[B] != null) regFn[A] = regFn[B]; else delete regFn[A];
        var jS = { t: "jmp", target: null, line: line };
        fnRec.pre.push(jS);
        branch(jS, targetOfCond(pc, nextS.sBx));
        pc++;
        break;
      }

      case OP.CALL: {
        if (C > 2) {
          /* a generic for is `f, s, v = explist; jmp; tforcall`: the iterator
           * call's line is the for's line, so name it il-for-in */
          var forIter = false;
          for (var look = pc + 1; look <= pc + 3 && look < code.length; look++) {
            if (code[look].opcode === OP.TFORCALL) { forIter = true; break; }
            if (code[look].opcode !== OP.JMP && code[look].opcode !== OP.LOADNIL) break;
          }
          if (forIter) {
            refuse("il-for-in", "line " + line +
                   ": a generic for (pairs/ipairs) is not in the IL");
          }
          refuse("il-multret", "line " + line + ": a call with more than one result");
        }
        var args = [];
        if (B === 0) {
          /* the argument list is open: it is the result of the call right
           * before this one, which the IL types as one value (f(g())) */
          if (thisOpen == null || thisOpen < A + 1) {
            refuse("il-multret", "line " + line + ": a call with an open argument list");
          }
          for (var oa = A + 1; oa <= thisOpen; oa++) args.push(reg(oa));
        } else {
          for (var a = 1; a < B; a++) args.push(reg(A + a));
        }
        var hasResult = C === 2 || C === 0;
        var callInstr = { t: "call", dst: hasResult ? A : null, callee: reg(A),
                          args: args, line: line, open: C === 0 };
        fnRec.pre.push(callInstr);
        clearReg(A);
        if (C === 0) openReg = A;          /* consumed by the next open call */
        if (C === 2) clearReg(A);          /* the result replaces the function */
        break;
      }

      case OP.TAILCALL:
        refuse("il-op", "line " + line + ": a tail call is not lowered (il-op)");

      case OP.RETURN: {
        if (B === 0) refuse("il-multret", "line " + line + ": a return with an open result list");
        if (B > 2) refuse("il-multret", "line " + line + ": more than one return value");
        fnRec.pre.push({ t: "ret", src: B === 2 ? reg(A) : null, line: line });
        break;
      }

      case OP.FORPREP: {
        fnRec.pre.push({ t: "forprep", base: A, line: line });
        var jp = { t: "jmp", target: null, line: line };
        fnRec.pre.push(jp);
        branch(jp, jumpTarget(pc, sBx));
        break;
      }

      case OP.FORLOOP: {
        var fl = { t: "fornext", base: A, target: null, line: line };
        fnRec.pre.push(fl);
        branch(fl, jumpTarget(pc, sBx));
        break;
      }

      case OP.TFORCALL: case OP.TFORLOOP:
        refuse("il-for-in", "line " + line + ": a generic for (pairs/ipairs) is not in the IL");

      case OP.SETLIST: {
        var n = B;
        var cField = C;
        if (n === 0) refuse("il-multret", "line " + line + ": a table constructor with an open list");
        if (cField === 0) {
          var extra = code[pc + 1];
          if (!extra || extra.opcode !== OP.EXTRAARG) {
            refuse("il-jump", "line " + line + ": SETLIST without its EXTRAARG");
          }
          cField = extra.Ax;
          pc++;
        }
        var vals = [];
        for (var v = 1; v <= n; v++) vals.push(reg(A + v));
        fnRec.pre.push({ t: "setlist", base: reg(A),
                         index: (cField - 1) * LFIELDS_PER_FLUSH + 1,
                         values: vals, line: line });
        break;
      }

      case OP.CLOSURE: {
        var childId = childFids[i.Bx];
        if (childId == null) refuse("il-jump", "line " + line + ": CLOSURE names no prototype");
        fnRec.pre.push({ t: "closure", dst: A, fid: childId, line: line });
        delete regStr[A];
        regFn[A] = childId;
        break;
      }

      case OP.VARARG:
        refuse("il-vararg", "line " + line + ": `...` is not in the IL subset");

      case OP.EXTRAARG:
        refuse("il-jump", "line " + line + ": a stray EXTRAARG");

      default:
        refuse("il-op", "line " + line + ": opcode " +
               (OP_NAMES[i.opcode] || i.opcode) + " is not lowered");
      }
    }

    /* Branch targets become instruction indices. A target inside the JMP half
     * of a condition would mean Lua emitted a jump into a pair — it does not;
     * refuse rather than guess. */
    for (var b = 0; b < branches.length; b++) {
      var brc = branches[b];
      if (skippedPc[brc.targetPc]) {
        refuse("il-jump", "line " + brc.line + ": a jump lands inside a comparison pair");
      }
      var at = emittedAt[brc.targetPc];
      if (at == null) at = fnRec.pre.length;
      brc.instr.target = at;
    }

    fnRec.childFids = childFids;
    return fnRec;
  }

  /* ---- the typer -------------------------------------------------------- */

  /* The typer is a forward pass in the linear instruction order, not an SSA
   * reconstruction. That is enough for what Lua's compiler emits here: a
   * local keeps its register and its type for its lifetime, and the only
   * deliberate re-uses are temporaries the compiler gives one job at a time
   * (docs/IL.md §4 says this in full). Each instruction records the type it
   * consumes (operand.tt) and produces (ins.dstType); #32 reads those.
   *
   * Types flow between functions through the parameter, return and upvalue
   * type variables and through the globals table; a fixpoint of passes binds
   * them (puttile's `fn` parameter becomes a function when init passes it a
   * closure). A value with no binding defaults to int where an operation is
   * numeric; using it as a callee, a table base or a condition is refused. */

  function makeCtx() {
    return {
      functions: [],
      hookFids: { init: null, frame: null, raster: null },
      names: {},
      nameFor: function (proto) {
        var n = proto.linedefined > 0 ? ("fn@" + proto.linedefined) : "main";
        this.names[n] = (this.names[n] || 0) + 1;
        return n;
      }
    };
  }

  /* A toy may replace `raster`: that is how it chooses the callback form
   * (the Lua runtime detects the same thing). Every other surface name is
   * bound by the lowering and reassigning it would make calls it already
   * specialised mean something else. */
  function isBoundBuiltin(name) {
    return (SURFACE.indexOf(name) >= 0 && name !== "raster") ||
           name === "vram" || name === "pad";
  }
  function isUnsupportedName(name) {
    return Object.prototype.hasOwnProperty.call(UNSUPPORTED_GLOBALS, name);
  }
  function builtinSpec(name) {
    if (SURFACE.indexOf(name) >= 0) return { surface: true };
    if (HELPERS[name]) return HELPERS[name];
    if (UNSUPPORTED_GLOBALS[name]) return { unsupported: UNSUPPORTED_GLOBALS[name] };
    return null;
  }
  function globalType(globals, name) {
    if (globals[name]) return globals[name];
    if (SURFACE.indexOf(name) >= 0) { globals[name] = builtinType(name); return globals[name]; }
    if (HELPERS[name]) { globals[name] = builtinType(name); return globals[name]; }
    if (UNSUPPORTED_GLOBALS[name]) {
      globals[name] = unsupportedType(name);
      globals[name].reason = UNSUPPORTED_GLOBALS[name];
      return globals[name];
    }
    if (name === "vram") { globals[name] = T.VRAM; return globals[name]; }
    if (name === "pad") { globals[name] = T.PADSET; return globals[name]; }
    if (name === "pi") { globals[name] = T.FIXED; return globals[name]; }
    globals[name] = varType();
    return globals[name];
  }

  /* The hook signatures are the toy API's (docs/TOYS.md §2, docs/IL.md §3):
   * init(), frame(t, f) with t fixed and f int, raster(line) with line int. */
  var HOOK_PARAMS = {
    init: [],
    frame: [T.FIXED, T.INT],
    raster: [T.INT]
  };

  function applyHookSignatures(ctx, errs) {
    for (var name in ctx.hookFids) {
      if (!Object.prototype.hasOwnProperty.call(ctx.hookFids, name)) continue;
      var fid = ctx.hookFids[name];
      if (fid == null) continue;
      var fn = ctx.functions[fid];
      var wanted = HOOK_PARAMS[name];
      if (!fn || fn.params.length !== wanted.length) {
        errs.push({ code: "il-type", line: 0,
                    message: name + " must take " + wanted.length + " parameters" });
        continue;
      }
      for (var p = 0; p < wanted.length; p++) {
        unify(fn.params[p], wanted[p], errs, 0);
      }
      fn.hooks.push(name);
    }
  }

  function kindOf(t) { return resolve(t).k; }

  /* One typing pass over one function. In strict mode every operand is
   * required to have a concrete type where the operation needs one; in the
   * fixpoint passes the pass only learns and defaults. */
  function typeFn(fn, ctx, globals, errs, strict) {
    var rt = [];                    /* register slot -> type */
    for (var pi = 0; pi < fn.params.length; pi++) rt[pi] = fn.params[pi];
    var changed = false;
    function U(a, b, line) { if (unify(a, b, errs, line)) changed = true; }
    function note(op, t) {
      if (op && op.r != null) {
        var r = resolve(t);
        op.tt = r.k;
        if (strict && r.k === "var") op.tt = "any";
      }
      return t;
    }
    function get(op, line) {
      if (!op) return T.NIL;
      if (op.r != null) return rt[op.r] || T.NIL;
      return typeOfConst(op.k);
    }
    function numJoin(a, b, line) {
      var ra = resolve(a), rb = resolve(b);
      if (ra.k === "fixed" || rb.k === "fixed") {
        if (ra.k === "bool" || ra.k === "str" || ra.k === "table" ||
            ra.k === "fn" || rb.k === "bool" || rb.k === "str" ||
            rb.k === "table" || rb.k === "fn") {
          errs.push({ code: "il-type", line: line,
                      message: "arithmetic on a " + typeName(a) + " and a " + typeName(b) });
          return T.INT;
        }
        return T.FIXED;
      }
      if (ra.k === "var" && rb.k !== "var") {
        if (rb.k === "int" || rb.k === "fixed") { U(a, b, line); return rb; }
      }
      if (rb.k === "var" && ra.k !== "var") {
        if (ra.k === "int" || ra.k === "fixed") { U(b, a, line); return ra; }
      }
      if (ra.k === "bool" || ra.k === "str" || ra.k === "table" ||
          ra.k === "fn" || rb.k === "bool" || rb.k === "str" ||
          rb.k === "table" || rb.k === "fn") {
        errs.push({ code: "il-type", line: line,
                    message: "arithmetic on a " + typeName(a) + " and a " + typeName(b) });
        return T.INT;
      }
      return T.INT;
    }
    function wantInt(op, line) {
      var t = get(op, line);
      note(op, t);
      var r = resolve(t);
      if (r.k === "var") { U(t, T.INT, line); return; }
      if (r.k !== "int") {
        errs.push({ code: "il-mixed", line: line,
                    message: "an int is required, got a " + typeName(t) });
      }
    }
    function wantBool(op, line) {
      var t = get(op, line);
      note(op, t);
      var r = resolve(t);
      if (r.k === "var") { U(t, T.BOOL, line); return; }
      if (r.k !== "bool") {
        errs.push({ code: "il-cond", line: line,
                    message: "a condition of type " + typeName(t) +
                             "; the IL requires a bool" });
      }
    }

    for (var p = 0; p < fn.pre.length; p++) {
      var ins = fn.pre[p];
      var line = ins.line;
      switch (ins.t) {

      case "const":
        rt[ins.dst] = typeOfConst(ins.k);
        break;

      case "move": {
        var mt = get(ins.src, line);
        rt[ins.dst] = mt;
        ins.dstType = kindOf(mt);
        note(ins.src, mt);
        break;
      }

      case "getglobal": {
        var gt = globalType(globals, ins.name);
        rt[ins.dst] = gt;
        break;
      }

      case "builtinval":
        rt[ins.dst] = globalType(globals, ins.name);
        break;

      case "setglobal": {
        if (isBoundBuiltin(ins.name) || isUnsupportedName(ins.name)) {
          errs.push({ code: "il-surface-shadow", line: line,
                      message: "the toy reassigns `" + ins.name +
                               "`, which the IL lowering has already bound" });
          break;
        }
        var svt = get(ins.src, line);
        note(ins.src, svt);
        if (ins.name === "raster" && resolve(svt).k === "fn") {
          /* the toy replaces the host's raster(line, spec) with its own
           * per-line callback, which is how it chooses the callback form
           * (the Lua runtime detects the same thing after init) */
          globals.raster = svt;
        } else {
          U(globalType(globals, ins.name), svt, line);
        }
        break;
      }

      case "table":
        rt[ins.dst] = T.TABLE;
        break;

      case "setlist": {
        var slb = resolve(get(ins.base, line));
        if (slb.k === "var") U(get(ins.base, line), T.TABLE, line);
        else if (slb.k !== "table") {
          errs.push({ code: "il-type", line: line, message: "(setlist) a table is required, got a " + typeName(slb) });
        }
        break;
      }

      case "arith": {
        var aT = get(ins.a, line), bT = get(ins.b, line);
        note(ins.a, aT); note(ins.b, bT);
        var resT;
        if (ins.op === "div") {
          var rd = resolve(aT), rd2 = resolve(bT);
          if (rd.k === "var") U(aT, T.INT, line);
          if (rd2.k === "var") U(bT, T.INT, line);
          if (rd.k !== "int" && rd.k !== "fixed" && rd.k !== "var") {
            errs.push({ code: "il-type", line: line, message: "'/' on a " + typeName(aT) });
          }
          if (rd2.k !== "int" && rd2.k !== "fixed" && rd2.k !== "var") {
            errs.push({ code: "il-type", line: line, message: "'/' on a " + typeName(bT) });
          }
          resT = T.FIXED;
        } else if (ins.op === "band" || ins.op === "bor" || ins.op === "bxor" ||
                   ins.op === "shl" || ins.op === "shr") {
          wantInt(ins.a, line); wantInt(ins.b, line);
          resT = T.INT;
        } else {
          resT = numJoin(aT, bT, line);
        }
        rt[ins.dst] = resT;
        ins.dstType = kindOf(resT);
        break;
      }

      case "unm": {
        var ut = numJoin(get(ins.a, line), get(ins.a, line), line);
        note(ins.a, get(ins.a, line));
        rt[ins.dst] = ut;
        ins.dstType = kindOf(ut);
        break;
      }

      case "bnot":
        wantInt(ins.a, line); rt[ins.dst] = T.INT; ins.dstType = "int";
        break;

      case "not": {
        /* Lua's `not` is truthiness: only nil and false are falsey, so a
         * numeric/table/function operand is always truthy and `not` is
         * constant false for it. The IL keeps the test for a bool. */
        var nt0 = resolve(get(ins.a, line));
        note(ins.a, get(ins.a, line));
        if (nt0.k === "var") { U(get(ins.a, line), T.BOOL, line); }
        else if (nt0.k === "str" || nt0.k === "env") {
          errs.push({ code: "il-type", line: line,
                      message: "`not` on a " + typeName(nt0) });
        }
        rt[ins.dst] = T.BOOL;
        ins.dstType = "bool";
        break;
      }

      case "cmp": {
        var ca = get(ins.a, line), cb = get(ins.b, line);
        note(ins.a, ca); note(ins.b, cb);
        var rca = resolve(ca), rcb = resolve(cb);
        if (rca.k === "str" || rcb.k === "str") {
          errs.push({ code: "il-string", line: line, message: "comparing strings is not in the IL" });
          rt[ins.dst] = T.BOOL;
          ins.cmpType = "int";
          break;
        }
        if (rca.k === "table" || rca.k === "fn" || rca.k === "vram" ||
            rca.k === "pad" || rca.k === "padset" ||
            rcb.k === "table" || rcb.k === "fn") {
          errs.push({ code: "il-type", line: line,
                      message: "comparing a " + typeName(ca) });
          rt[ins.dst] = T.BOOL;
          ins.cmpType = "int";
          break;
        }
        if (rca.k === "bool" && rcb.k === "bool") {
          if (ins.op !== "eq") {
            errs.push({ code: "il-type", line: line,
                        message: "an order comparison on booleans" });
          }
          rt[ins.dst] = T.BOOL;
          ins.cmpType = "bool";
          break;
        }
        if (rca.k === "bool" || rcb.k === "bool") {
          errs.push({ code: "il-type", line: line,
                      message: "comparing a bool with a " + typeName(rca.k === "bool" ? cb : ca) });
          rt[ins.dst] = T.BOOL;
          ins.cmpType = "int";
          break;
        }
        var cJoin = numJoin(ca, cb, line);
        rt[ins.dst] = T.BOOL;
        ins.cmpType = kindOf(cJoin) === "fixed" ? "fixed" : "int";
        break;
      }

      case "br": {
        /* Lua truthiness, exactly: only nil and false are falsey. A bool is
         * a real test; an int, fixed-point, table or function value is
         * always truthy (the branch becomes unconditional); a string or
         * _ENV has no run-time value here, and an untyped value is bound to
         * bool (the common case for a parameter used as a condition). */
        var bc = resolve(get(ins.cond, line));
        if (bc.k === "var") U(get(ins.cond, line), T.BOOL, line);
        else if (bc.k === "str" || bc.k === "env") {
          errs.push({ code: "il-cond", line: line,
                      message: "a condition of type " + typeName(bc) +
                               "; a bool, number, table or function is what Lua tests" });
        }
        note(ins.cond, get(ins.cond, line));
        break;
      }

      case "call": {
        var calleeT = get(ins.callee, line);
        note(ins.callee, calleeT);
        var rc = resolve(calleeT);
        var argTypes = ins.args.map(function (x) { return get(x, line); });
        for (var ari = 0; ari < ins.args.length; ari++) note(ins.args[ari], argTypes[ari]);
        if (rc.k === "builtin") {
          ins.calleeName = rc.name;
          var bspec = builtinSpec(rc.name);
          if (bspec && bspec.surface) {
            if (rc.name === "reg") {
              if (ins.args.length !== 2) {
                errs.push({ code: "il-arity", line: line, message: "reg(name, value) takes 2 arguments" });
              } else {
                var rnt = resolve(argTypes[0]);
                if (rnt.k !== "str") {
                  errs.push({ code: "il-reg-name", line: line,
                              message: "reg()'s name must be a constant string" });
                }
                if (resolve(argTypes[1]).k !== "int" && resolve(argTypes[1]).k !== "var") {
                  errs.push({ code: "il-type", line: line, message: "reg()'s value must be an int" });
                }
              }
            } else if (rc.name === "pal") {
              if (ins.args.length !== 2) errs.push({ code: "il-arity", line: line, message: "pal(addr, word) takes 2 arguments" });
              else { wantInt(ins.args[0], line); wantInt(ins.args[1], line); }
            } else if (rc.name === "sat") {
              if (ins.args.length !== 3) errs.push({ code: "il-arity", line: line, message: "sat(i, k, v) takes 3 arguments" });
              else { wantInt(ins.args[0], line); wantInt(ins.args[1], line); wantInt(ins.args[2], line); }
            } else if (rc.name === "sprite") {
              if (ins.args.length !== 2) errs.push({ code: "il-arity", line: line, message: "sprite(i, spec) takes 2 arguments" });
              else {
                wantInt(ins.args[0], line);
                var sst = resolve(argTypes[1]);
                if (sst.k === "var") U(argTypes[1], T.TABLE, line);
                else if (sst.k !== "table") {
                  errs.push({ code: "il-type", line: line, message: "sprite's spec must be a table" });
                }
              }
            } else if (rc.name === "raster") {
              if (ins.args.length !== 2) errs.push({ code: "il-arity", line: line, message: "raster(line, spec) takes 2 arguments" });
              else {
                wantInt(ins.args[0], line);
                var rst = resolve(argTypes[1]);
                if (rst.k === "var") U(argTypes[1], T.TABLE, line);
                else if (rst.k !== "table") {
                  errs.push({ code: "il-type", line: line, message: "raster's spec must be a table" });
                }
              }
            } else if (rc.name === "print") {
              for (var pr = 0; pr < argTypes.length; pr++) {
                var prk = resolve(argTypes[pr]).k;
                if (prk === "str") {
                  errs.push({ code: "il-string", line: line,
                              message: "print() takes numbers and booleans; the IL has no string values" });
                } else if (prk === "table" || prk === "fn") {
                  errs.push({ code: "il-type", line: line,
                              message: "print() cannot print a " + typeName(argTypes[pr]) });
                }
              }
            }
          } else if (HELPERS[rc.name]) {
            var hs = HELPERS[rc.name];
            if (ins.args.length !== hs.sig.length) {
              errs.push({ code: "il-arity", line: line,
                          message: rc.name + " takes " + hs.sig.length + " arguments" });
            }
            for (var hi = 0; hi < ins.args.length && hi < hs.sig.length; hi++) {
              var want = resolve(hs.sig[hi]).k;
              var got = resolve(argTypes[hi]).k;
              if (hs.numeric) {
                if (got === "var") U(argTypes[hi], T.INT, line);
                else if (got !== "int" && got !== "fixed") {
                  errs.push({ code: "il-type", line: line,
                              message: rc.name + " takes numbers, got a " + typeName(argTypes[hi]) });
                }
              } else if (want === "table") {
                if (got === "var") U(argTypes[hi], T.TABLE, line);
                else if (got !== "table") {
                  errs.push({ code: "il-type", line: line,
                              message: rc.name + " takes a table, got a " + typeName(argTypes[hi]) });
                }
              } else if (want === "fixed") {
                /* a literal int converts; an int variable widens at run time */
                if (got !== "int" && got !== "fixed" && got !== "var") {
                  errs.push({ code: "il-type", line: line,
                              message: rc.name + " takes a number, got a " + typeName(argTypes[hi]) });
                }
              } else if (want === "int") {
                if (got === "var") U(argTypes[hi], T.INT, line);
                else if (got !== "int") {
                  errs.push({ code: "il-type", line: line,
                              message: rc.name + " takes an int, got a " + typeName(argTypes[hi]) });
                }
              }
            }
            if (ins.dst != null) {
              rt[ins.dst] = hs.ret;
              ins.dstType = kindOf(hs.ret);
            }
            ins.paramKinds = hs.sig.map(function (t) { return kindOf(t); });
          } else if (bspec && bspec.unsupported) {
            errs.push({ code: "il-unsupported", line: line,
                        message: rc.name + ": " + bspec.unsupported });
          }
        } else if (rc.k === "fn") {
          ins.calleeName = null;
          if (ins.args.length !== rc.params.length) {
            errs.push({ code: "il-arity", line: line,
                        message: "a call with " + ins.args.length +
                                 " arguments to a function of " + rc.params.length });
          }
          for (var fi = 0; fi < ins.args.length && fi < rc.params.length; fi++) {
            U(argTypes[fi], rc.params[fi], line);
          }
          ins.paramKinds = rc.params.map(function (t) { return kindOf(t); });
          if (ins.dst != null && rc.ret) {
            rt[ins.dst] = rc.ret;
            ins.dstType = kindOf(rc.ret);
          }
        } else if (rc.k === "unsupported") {
          errs.push({ code: "il-unsupported", line: line,
                      message: rc.name + ": " + rc.reason });
        } else if (rc.k === "var" || rc.k === "nil") {
          /* not known yet: a fresh signature binds this call site and the
           * later passes learn the real function */
          var sig = fnType(ins.args.map(function () { return varType(); }), varType());
          U(calleeT, sig, line);
          ins.calleeName = null;
          for (var vi = 0; vi < ins.args.length; vi++) U(argTypes[vi], sig.params[vi], line);
          ins.paramKinds = sig.params.map(function (t) { return kindOf(t); });
          if (ins.dst != null) {
            rt[ins.dst] = sig.ret;
            ins.dstType = kindOf(sig.ret);
          }
        } else {
          errs.push({ code: "il-type", line: line,
                      message: "calling a " + typeName(calleeT) });
        }
        break;
      }

      case "ret": {
        if (ins.src != null) {
          var rv = get(ins.src, line);
          note(ins.src, rv);
          U(fn.ret, rv, line);
        }
        break;
      }

      case "closure": {
        var child = ctx.functions[ins.fid];
        if (!child) {
          errs.push({ code: "il-type", line: line, message: "closure of an unknown function" });
          break;
        }
        rt[ins.dst] = fnType(child.params, child.ret);
        for (var cu = 0; cu < child.captures.length; cu++) {
          var cap = child.captures[cu];
          var srcT = cap.instack
            ? (rt[cap.idx] || T.NIL)
            : (cap.idx < fn.upTypes.length ? fn.upTypes[cap.idx] : T.NIL);
          U(child.upTypes[cu], srcT, line);
        }
        break;
      }

      case "getupval": {
        if (ins.idx >= fn.upTypes.length) {
          errs.push({ code: "il-type", line: line, message: "upvalue " + ins.idx + " does not exist" });
          break;
        }
        if (kindOf(fn.upTypes[ins.idx]) === "env") {
          errs.push({ code: "il-env", line: line, message: "_ENV used as a value" });
          break;
        }
        rt[ins.dst] = fn.upTypes[ins.idx];
        break;
      }

      case "setupval": {
        if (ins.idx >= fn.upTypes.length) {
          errs.push({ code: "il-type", line: line, message: "upvalue " + ins.idx + " does not exist" });
          break;
        }
        if (kindOf(fn.upTypes[ins.idx]) === "env") {
          errs.push({ code: "il-env", line: line, message: "writing _ENV" });
          break;
        }
        U(fn.upTypes[ins.idx], get(ins.src, line), line);
        break;
      }

      case "gettable": {
        var gb = ins.base && ins.base.upval != null
          ? (ins.base.upval < fn.upTypes.length ? fn.upTypes[ins.base.upval] : T.NIL)
          : get(ins.base, line);
        var gbk = resolve(gb);
        ins.baseType = gbk.k;
        if (ins.base && ins.base.upval == null) note(ins.base, gb);
        if (gbk.k === "env") {
          errs.push({ code: "il-env", line: line, message: "_ENV used as a value" });
        } else if (gbk.k === "vram") {
          wantInt(ins.key, line);
          rt[ins.dst] = T.INT;
        } else if (gbk.k === "padset") {
          wantInt(ins.key, line);
          rt[ins.dst] = T.PAD;
        } else if (gbk.k === "pad") {
          if (!isStrConst(ins.key)) {
            errs.push({ code: "il-key", line: line,
                        message: "a pad field must be a constant name (pad[1].right)" });
          }
          rt[ins.dst] = T.BOOL;
        } else if (gbk.k === "table") {
          errs.push({ code: "il-table-read", line: line,
                      message: "a table the toy built is write-only in the IL for now (docs/IL.md §5)" });
          rt[ins.dst] = varType();
        } else if (gbk.k === "var" || gbk.k === "nil") {
          if (strict) {
            errs.push({ code: "il-type", line: line,
                        message: "indexing a value whose type is not known" });
          }
          rt[ins.dst] = varType();
        } else {
          errs.push({ code: "il-type", line: line, message: "indexing a " + typeName(gb) });
          rt[ins.dst] = varType();
        }
        break;
      }

      case "settable": {
        var sb = ins.base && ins.base.upval != null
          ? (ins.base.upval < fn.upTypes.length ? fn.upTypes[ins.base.upval] : T.NIL)
          : get(ins.base, line);
        var sbk = resolve(sb);
        ins.baseType = sbk.k;
        if (ins.base && ins.base.upval == null) note(ins.base, sb);
        if (sbk.k === "env") {
          errs.push({ code: "il-env", line: line, message: "writing _ENV" });
        } else if (sbk.k === "vram") {
          wantInt(ins.key, line);
          wantInt(ins.value, line);
        } else if (sbk.k === "table") {
          var ktk = resolve(get(ins.key, line)).k;
          if (ktk !== "str" && ktk !== "int" && ktk !== "var") {
            errs.push({ code: "il-key", line: line,
                        message: "a table key must be a string or an integer" });
          }
        } else if (sbk.k === "pad" || sbk.k === "padset") {
          errs.push({ code: "il-pad-write", line: line, message: "the pads are read-only" });
        } else if (sbk.k === "var" || sbk.k === "nil") {
          if (strict) {
            errs.push({ code: "il-type", line: line,
                        message: "writing into a value whose type is not known" });
          }
        } else {
          errs.push({ code: "il-type", line: line, message: "writing into a " + typeName(sb) });
        }
        break;
      }

      case "forprep":
        for (var fp = 0; fp < 3; fp++) wantInt({ r: ins.base + fp }, line);
        /* the control variable is defined by the loop, and the body (which
         * comes before FORLOOP in the linear order) reads it */
        rt[ins.base + 3] = T.INT;
        break;
      case "fornext":
        for (var fq = 0; fq < 3; fq++) wantInt({ r: ins.base + fq }, line);
        rt[ins.base + 3] = T.INT;
        break;

      case "jmp":
        break;

      default:
        errs.push({ code: "il-type", line: line,
                    message: "internal: unknown pre-op " + ins.t });
      }
    }
    return changed;
  }

  function infer(ctx, globals) {
    var seedErrs = [];
    applyHookSignatures(ctx, seedErrs);
    if (seedErrs.length) report(seedErrs);
    ctx.functions.forEach(function (fn) { fn._ctx = ctx; });
    for (var pass = 0; pass < 24; pass++) {
      var changed = false;
      for (var f = 0; f < ctx.functions.length; f++) {
        if (typeFn(ctx.functions[f], ctx, globals, [], false)) changed = true;
      }
      if (!changed) break;
    }
    var errs = [];
    for (var g = 0; g < ctx.functions.length; g++) {
      typeFn(ctx.functions[g], ctx, globals, errs, true);
    }
    for (var h in ctx.hookFids) {
      if (!Object.prototype.hasOwnProperty.call(ctx.hookFids, h)) continue;
      if (ctx.hookFids[h] == null) continue;
      var hg = resolve(globals[h]);
      if (!hg || hg.k !== "fn") {
        errs.push({ code: "il-type", line: 0,
                    message: h + " is not an IL function, so its parameters cannot be typed" });
      }
    }
    if (errs.length) report(errs);
  }

  function report(errs) {
    var seen = {};
    var kept = [];
    for (var i = 0; i < errs.length; i++) {
      var k = errs[i].code + "|" + errs[i].line + "|" + errs[i].message;
      if (seen[k]) continue;
      seen[k] = true;
      kept.push(errs[i]);
    }
    kept.sort(function (a, b) { return (a.line || 0) - (b.line || 0); });
    refuse(kept[0].code, "line " + kept[0].line + ": " + kept[0].message);
  }

  /* ---- specialization: pre-ops -> the IL's final instructions ---------- */

  function finalOperand(op, wantFixed) {
    if (!op) return null;
    if (op.r != null) return { r: op.r, tt: op.tt || "any" };
    if (wantFixed && op.k && op.k.t === "int") {
      return { k: { t: "fixed", v: op.k.v } };
    }
    return { k: op.k };
  }

  function specialize(fn, ctx) {
    var out = [];
    var preToFinal = [];
    function push(ins) { out.push(ins); return out; }

    /* A `builtinval` that is only the callee of a call is dead: the call
     * became a surface or builtin instruction and never reads the value.
     * Mark those before the walk so the IL carries no dead global read
     * that #32 would have to count. */
    var dead = {};
    for (var d = 0; d < fn.pre.length; d++) {
      var di = fn.pre[d];
      if (di.t !== "call" || !di.callee || di.callee.r == null) continue;
      var def = lastDefinition(fn.pre, d, di.callee.r);
      if (def != null && fn.pre[def].t === "builtinval") dead[def] = true;
    }

    for (var p = 0; p < fn.pre.length; p++) {
      var ins = fn.pre[p];
      var line = ins.line;
      preToFinal[p] = out.length;
      if (dead[p]) continue;
      switch (ins.t) {

      case "const": {
        var k = ins.k;
        if (k.t === "str") {
          /* A string register exists only so a surface call can name
           * something; the name is inline in the final `reg`, and every
           * other use was refused by the typer. The definition emits
           * nothing. */
        } else if (k.t === "fixed") {
          push({ t: "const", dst: ins.dst, k: { t: "fixed", v: quantizeFixed(k.v) }, line: line });
        } else {
          push({ t: "const", dst: ins.dst, k: k, line: line });
        }
        break;
      }

      case "move": {
        var st = ins.src && ins.src.r != null ? ins.src.tt : (ins.src && ins.src.k ? ins.src.k.t : "any");
        var dt = ins.dstType || "any";
        if (st === "fixed" && dt === "int") {
          refuse("il-mixed", "line " + line + ": a fixed-point value copied into an int register");
        }
        if (st === "int" && dt === "fixed") {
          push({ t: "inttofixed", dst: ins.dst, src: finalOperand(ins.src, false), line: line });
        } else {
          push({ t: "move", dst: ins.dst, src: finalOperand(ins.src, false), line: line });
        }
        break;
      }

      case "getglobal":
        push({ t: "getglobal", dst: ins.dst, name: ins.name, line: line });
        break;

      case "builtinval":
        push({ t: "getbuiltin", dst: ins.dst, name: ins.name, line: line });
        break;

      case "setglobal":
        push({ t: "setglobal", name: ins.name, src: finalOperand(ins.src, false), line: line });
        break;

      case "table":
        push({ t: "table", dst: ins.dst, line: line });
        break;

      case "setlist":
        push({ t: "setlist", base: finalOperand(ins.base, false), index: ins.index,
               values: ins.values.map(function (v) { return finalOperand(v, false); }),
               line: line });
        break;

      case "arith": {
        var aty = ins.dstType === "fixed" ? "fixed" : "int";
        push({ t: "arith", op: ins.op, dst: ins.dst,
               a: finalOperand(ins.a, aty === "fixed"),
               b: finalOperand(ins.b, aty === "fixed"),
               type: aty, line: line });
        break;
      }

      case "unm":
        push({ t: "unm", dst: ins.dst, a: finalOperand(ins.a, ins.dstType === "fixed"),
               type: ins.dstType === "fixed" ? "fixed" : "int", line: line });
        break;

      case "bnot":
        push({ t: "bnot", dst: ins.dst, a: finalOperand(ins.a, false), line: line });
        break;

      case "not":
        push({ t: "not", dst: ins.dst, a: finalOperand(ins.a, false), line: line });
        break;

      case "cmp": {
        var cty = ins.cmpType || "int";
        push({ t: "cmp", op: ins.op, dst: ins.dst,
               a: finalOperand(ins.a, cty === "fixed"),
               b: finalOperand(ins.b, cty === "fixed"),
               type: cty, line: line });
        break;
      }

      case "br":
        push({ t: "br", cond: finalOperand(ins.cond, false), when: ins.when,
               preTarget: ins.target, target: null, line: line });
        break;

      case "jmp":
        push({ t: "jmp", preTarget: ins.target, target: null, line: line });
        break;

      case "call": {
        var calleeName = ins.calleeName;
        if (calleeName && SURFACE.indexOf(calleeName) >= 0) {
          if (calleeName === "reg") {
            var nameOp = ins.args[0];
            var regName = isStrConst(nameOp) ? nameOp.k.v : null;
            if (regName == null && isRegOperand(nameOp)) {
              regName = findStrDefinition(fn.pre, p, nameOp.r);
            }
            if (regName == null) {
              refuse("il-reg-name", "line " + line + ": reg()'s name must be a constant string");
            }
            push({ t: "reg", name: regName, value: finalOperand(ins.args[1], false), line: line });
          } else if (calleeName === "pal") {
            push({ t: "pal", addr: finalOperand(ins.args[0], false),
                   word: finalOperand(ins.args[1], false), line: line });
          } else if (calleeName === "sat") {
            push({ t: "sat", i: finalOperand(ins.args[0], false),
                   k: finalOperand(ins.args[1], false),
                   v: finalOperand(ins.args[2], false), line: line });
          } else if (calleeName === "sprite") {
            push({ t: "sprite", i: finalOperand(ins.args[0], false),
                   spec: finalOperand(ins.args[1], false), line: line });
          } else if (calleeName === "raster") {
            push({ t: "raster", lineArg: finalOperand(ins.args[0], false),
                   spec: finalOperand(ins.args[1], false), line: line });
          } else if (calleeName === "print") {
            push({ t: "print", args: ins.args.map(function (a) { return finalOperand(a, false); }),
                   line: line });
          }
        } else if (calleeName && HELPERS[calleeName]) {
          var pk = ins.paramKinds || [];
          var hargs = [];
          for (var hi = 0; hi < ins.args.length; hi++) {
            hargs.push(finalOperand(ins.args[hi], pk[hi] === "fixed"));
          }
          push({ t: "builtin", name: calleeName,
                 dst: ins.dst != null ? ins.dst : null, args: hargs, line: line });
        } else {
          var pk2 = ins.paramKinds || [];
          var cargs = [];
          for (var ca = 0; ca < ins.args.length; ca++) {
            cargs.push(finalOperand(ins.args[ca], pk2[ca] === "fixed"));
          }
          push({ t: "call", dst: ins.dst != null ? ins.dst : null,
                 callee: finalOperand(ins.callee, false), args: cargs, line: line });
        }
        break;
      }

      case "ret":
        push({ t: "ret", src: ins.src != null ? finalOperand(ins.src, false) : null, line: line });
        break;

      case "closure":
        push({ t: "closure", dst: ins.dst, fid: ins.fid, line: line });
        break;

      case "getupval":
        push({ t: "getupval", dst: ins.dst, idx: ins.idx, line: line });
        break;
      case "setupval":
        push({ t: "setupval", idx: ins.idx, src: finalOperand(ins.src, false), line: line });
        break;

      case "gettable": {
        var baseT = ins.baseType;
        if (baseT === "vram") {
          push({ t: "vget", dst: ins.dst, addr: finalOperand(ins.key, false), line: line });
        } else if (baseT === "padset") {
          push({ t: "padref", dst: ins.dst, n: finalOperand(ins.key, false), line: line });
        } else if (baseT === "pad") {
          var field = isStrConst(ins.key) ? ins.key.k.v : null;
          if (field == null || toyhost.PAD_FIELDS.indexOf(field) < 0) {
            refuse("il-key", "line " + line + ": a pad field must be one of " +
                   toyhost.PAD_FIELDS.join("/"));
          }
          push({ t: "padget", dst: ins.dst, pad: finalOperand(ins.base, false),
                 field: field, line: line });
        } else if (baseT === "table") {
          refuse("il-table-read", "line " + line +
                 ": a table the toy built is write-only in the IL for now (docs/IL.md §5)");
        } else if (baseT === "env") {
          refuse("il-env", "line " + line + ": _ENV used as a value");
        } else {
          refuse("il-type", "line " + line + ": indexing a " + baseT);
        }
        break;
      }

      case "settable": {
        var sbT = ins.baseType;
        if (ins.base && ins.base.upval != null) {
          refuse("il-type", "line " + line +
                 ": writing a table captured as an upvalue is not in the IL subset");
        }
        if (sbT === "vram") {
          push({ t: "vset", addr: finalOperand(ins.key, false),
                 word: finalOperand(ins.value, false), line: line });
        } else if (sbT === "table") {
          push({ t: "tset", base: finalOperand(ins.base, false),
                 key: finalOperand(ins.key, false),
                 value: finalOperand(ins.value, false), line: line });
        } else if (sbT === "pad" || sbT === "padset") {
          refuse("il-pad-write", "line " + line + ": the pads are read-only");
        } else if (sbT === "env") {
          refuse("il-env", "line " + line + ": writing _ENV");
        } else {
          refuse("il-type", "line " + line + ": writing into a " + sbT);
        }
        break;
      }

      case "forprep":
        push({ t: "forprep", base: ins.base, line: line });
        break;
      case "fornext":
        push({ t: "fornext", base: ins.base, preTarget: ins.target, target: null, line: line });
        break;

      default:
        refuse("il-type", "line " + line + ": internal: unknown pre-op " + ins.t);
      }
    }

    /* Branch targets were recorded against the pre list; map them to final
     * instruction indices. A pre op that emitted nothing (a name definition)
     * maps to the next final instruction. */
    for (var oi = 0; oi < out.length; oi++) {
      var o = out[oi];
      if (o.preTarget == null) continue;
      var at = preToFinal[o.preTarget];
      o.target = (at == null) ? out.length : at;
      delete o.preTarget;
    }
    for (var chk = 0; chk < out.length; chk++) {
      var co = out[chk];
      if ((co.t === "br" || co.t === "jmp" || co.t === "fornext") && co.target == null) {
        refuse("il-jump", "line " + co.line + ": a branch lost its target");
      }
    }
    return out;
  }

  /* The pre index of the last instruction before `at` that writes `reg`
   * (-1 when none). A linear scan is enough: the lowering is one basic-order
   * walk and both users (reg()'s name, the dead builtin read) only look at
   * the straight-line code in front of the instruction. */
  function lastDefinition(pre, at, regIdx) {
    for (var i = at - 1; i >= 0; i--) {
      var ins = pre[i];
      if (ins.dst === regIdx) return i;
    }
    return -1;
  }

  /* Find the string constant that a register was last loaded with, looking
   * back from the call at pre index `at`. Used only for reg()'s name. */
  function findStrDefinition(pre, at, regIdx) {
    var i = lastDefinition(pre, at, regIdx);
    if (i < 0) return null;
    var ins = pre[i];
    if (ins.t === "const" && ins.k && ins.k.t === "str") return ins.k.v;
    if (ins.t === "move" && ins.src && ins.src.r != null) {
      return findStrDefinition(pre, i, ins.src.r);
    }
    return null;
  }

  function quantizeFixed(v) { return Math.round(v * FIX) / FIX; }

  /* ---- compile: source -> an IL program -------------------------------- */

  function compile(source, opts) {
    opts = opts || {};
    var proto = parse(source, opts.chunkName);
    var ctx = makeCtx();
    var globals = {};
    var root = lowerProto(proto, ctx);
    ctx.functions.forEach(function (f) { f._ctx = ctx; });

    /* The root's top-level `function init()` compiles to CLOSURE + SETTABUP;
     * the hook ids were recorded during lowering. Type the hooks, then run
     * inference, then specialize every function. */
    infer(ctx, globals);

    var functions = ctx.functions.map(function (fn) {
      var code = specialize(fn, ctx);
      return {
        id: fn.id,
        name: fn.name,
        params: fn.params.map(function (t) { return resolve(t).k; }),
        returns: fn.ret ? resolve(fn.ret).k : null,
        upvalues: fn.captures.map(function (c, i) {
          return { from: c.instack ? "reg" : "upval", index: c.idx,
                   name: c.name, type: resolve(fn.upTypes[i]).k };
        }),
        registers: fn.nextReg,
        hooks: fn.hooks,
        code: code
      };
    });

    var hooks = {};
    for (var h in ctx.hookFids) {
      if (Object.prototype.hasOwnProperty.call(ctx.hookFids, h)) {
        hooks[h] = ctx.hookFids[h];
      }
    }

    return {
      version: 1,
      lang: "pce-il",
      source: opts.chunkName || "@toy.lua",
      hooks: hooks,
      functions: functions,
      globals: Object.keys(globals).map(function (name) {
        return { name: name, type: resolve(globals[name]).k };
      })
    };
  }

  /* ---- the interpreter -------------------------------------------------- */

  var PADSET = { __padset: true };
  var VRAM = { __vram: true };

  function truthy(v) { return !(v === undefined || v === false); }
  function luaMod(a, b) { return ((a % b) + b) % b; }
  function luaFloorDiv(a, b) { return Math.floor(a / b) | 0; }

  function luaNumToString(v, type) {
    if (typeof v === "boolean") return v ? "true" : "false";
    if (type === "fixed") {
      var q = v;
      return Number.isInteger(q) ? q.toFixed(1) : String(q);
    }
    return String(v);
  }

  function cell(v) { return { v: v }; }

  function runProgram(program, host, options) {
    options = options || {};
    var maxInstructions = options.maxInstructions || MAX_INSTRUCTIONS;
    var globals = Object.create(null);
    var functions = program.functions;
    var steps = 0;
    var broken = null;

    function argValue(frame, a) {
      if (a.r != null) return frame.regs[a.r].v;
      if (a.k) return a.k.t === "fixed" ? a.k.v : a.k.v;
      return undefined;
    }
    function toFixed(v) { return quantizeFixed(v); }
    function fixed(v) { return quantizeFixed(v); }

    function install() {
      for (var i = 0; i < SURFACE.length; i++) {
        globals[SURFACE[i]] = { __builtin: SURFACE[i] };
      }
      for (var h in HELPERS) {
        if (Object.prototype.hasOwnProperty.call(HELPERS, h)) {
          globals[h] = { __builtin: h };
        }
      }
      globals.min = { __builtin: "min" };
      globals.max = { __builtin: "max" };
      globals.floor = { __builtin: "floor" };
      globals.abs = { __builtin: "abs" };
      globals.clamp = { __builtin: "clamp" };
      globals.pi = Math.PI;
      globals.vram = VRAM;
      globals.pad = PADSET;
    }
    install();

    function fail(line, msg, code) {
      throw new ToyError(code || "toy-error", "toy.lua:" + (line || 0) + ": " + msg);
    }

    function checkBudget(line) {
      steps++;
      if (steps > maxInstructions) {
        throw new ToyError("toy-timeout",
          "the toy's IL ran longer than " + maxInstructions +
          " instructions in one hook (the console's frame cannot run it)");
      }
    }

    function callFunction(fid, args, line, closureUpvals) {
      var fn = functions[fid];
      var frame = {
        fid: fid,
        regs: [],
        upvals: null
      };
      for (var r = 0; r < fn.registers; r++) frame.regs.push(cell(undefined));
      for (var p = 0; p < fn.params.length; p++) {
        frame.regs[p].v = args[p];
      }
      /* non-parameter arguments beyond the declared count are ignored (the
       * typer refuses the arity mismatch before this can happen) */
      return exec(fid, frame, closureUpvals || null);
    }

    function makeClosure(fid, frame, parentUpvals) {
      var fn = functions[fid];
      var ups = [];
      for (var i = 0; i < fn.upvalues.length; i++) {
        var u = fn.upvalues[i];
        if (u.type === "env") { ups.push({ v: globals }); continue; }
        if (u.from === "reg") ups.push(frame.regs[u.index]);
        else ups.push(parentUpvals[u.index]);
      }
      return { __fn: fid, upvals: ups };
    }

    function exec(fid, frame, upvals) {
      var fn = functions[fid];
      var code = fn.code;
      var pc = 0;
      var onOp = typeof options.onOp === "function" ? options.onOp : null;
      frame.upvals = upvals;
      function cnt(operand) {
        if (!operand) return undefined;
        if (operand.r != null) return frame.regs[operand.r].v;
        if (operand.k) return operand.k.v;
        return undefined;
      }
      while (pc < code.length) {
        var ins = code[pc];
        checkBudget(ins.line);
        /* #32's observation point: one call per executed instruction.  It
         * sees the function id (the hooks are program.hooks.frame/raster), the
         * IL instruction and its frame, and cannot change what the IL does. */
        if (onOp) onOp(fid, ins, frame);
        switch (ins.t) {
        case "const":
          frame.regs[ins.dst].v = ins.k.t === "nil" ? undefined
            : (ins.k.t === "fixed" ? quantizeFixed(ins.k.v) : ins.k.v);
          pc++;
          break;
        case "move":
          frame.regs[ins.dst].v = cnt(ins.src);
          pc++;
          break;
        case "inttofixed":
          frame.regs[ins.dst].v = quantizeFixed(cnt(ins.src));
          pc++;
          break;
        case "getglobal": {
          var gv = globals[ins.name];
          if (gv === undefined) {
            fail(ins.line, "global `" + ins.name + "` is not defined (il-undefined)", "il-undefined");
          }
          frame.regs[ins.dst].v = gv;
          pc++;
          break;
        }
        case "setglobal":
          globals[ins.name] = cnt(ins.src);
          pc++;
          break;
        case "getbuiltin":
          frame.regs[ins.dst].v = globals[ins.name];
          pc++;
          break;
        case "table":
          frame.regs[ins.dst].v = [];
          pc++;
          break;
        case "tset": {
          var tbl = cnt(ins.base);
          if (tbl === undefined || tbl === null) fail(ins.line, "attempt to index a nil value");
          var keyv = cnt(ins.key);
          if (typeof keyv === "number") tbl[keyv - 1] = cnt(ins.value);
          else tbl[keyv] = cnt(ins.value);
          pc++;
          break;
        }
        case "setlist": {
          var st = cnt(ins.base);
          if (st === undefined) fail(ins.line, "attempt to index a nil value");
          for (var sv = 0; sv < ins.values.length; sv++) {
            st[ins.index - 1 + sv] = cnt(ins.values[sv]);
          }
          pc++;
          break;
        }
        case "arith": {
          var a = cnt(ins.a), b = cnt(ins.b);
          var res;
          if (ins.type === "fixed") {
            a = quantizeFixed(a); b = quantizeFixed(b);
            switch (ins.op) {
            case "add": res = fixed(a + b); break;
            case "sub": res = fixed(a - b); break;
            case "mul": res = fixed(a * b); break;
            case "div": res = fixed(a / b); break;
            case "mod": res = fixed(a - Math.floor(a / b) * b); break;
            case "idiv": res = fixed(Math.floor(a / b)); break;
            default: fail(ins.line, "a bit operation on a fixed-point value", "il-mixed");
            }
          } else {
            a = a | 0; b = b | 0;
            switch (ins.op) {
            case "add": res = (a + b) | 0; break;
            case "sub": res = (a - b) | 0; break;
            case "mul": res = Math.imul(a, b); break;
            case "div": res = fixed(a / b); break;
            case "mod":
              if (b === 0) fail(ins.line, "attempt to perform 'n%%0'");
              res = luaMod(a, b);
              break;
            case "idiv":
              if (b === 0) fail(ins.line, "attempt to perform 'n//0'");
              res = luaFloorDiv(a, b);
              break;
            case "band": res = a & b; break;
            case "bor": res = a | b; break;
            case "bxor": res = a ^ b; break;
            case "shl": res = (b >= 32 || b < 0) ? 0 : (a << b) | 0; break;
            case "shr": res = (b >= 32 || b < 0) ? 0 : (a >>> b) | 0; break;
            default: fail(ins.line, "unknown arithmetic " + ins.op);
            }
          }
          frame.regs[ins.dst].v = res;
          pc++;
          break;
        }
        case "unm": {
          var uv = cnt(ins.a);
          frame.regs[ins.dst].v = ins.type === "fixed" ? fixed(-uv) : (-uv) | 0;
          pc++;
          break;
        }
        case "bnot":
          frame.regs[ins.dst].v = ~cnt(ins.a) | 0;
          pc++;
          break;
        case "not":
          frame.regs[ins.dst].v = !truthy(cnt(ins.a));
          pc++;
          break;
        case "cmp": {
          var ca = cnt(ins.a), cb = cnt(ins.b), cr;
          if (ins.type === "fixed") { ca = quantizeFixed(ca); cb = quantizeFixed(cb); }
          if (ins.type === "bool") {
            if (ins.op !== "eq") fail(ins.line, "an order comparison on booleans");
            cr = ca === cb;
          } else if (ins.op === "eq") cr = ca === cb;
          else if (ins.op === "lt") cr = ca < cb;
          else cr = ca <= cb;
          frame.regs[ins.dst].v = cr;
          pc++;
          break;
        }
        case "br":
          if (truthy(cnt(ins.cond)) === ins.when) pc = ins.target;
          else pc++;
          break;
        case "jmp":
          pc = ins.target;
          break;
        case "call": {
          var callee = cnt(ins.callee);
          var callArgs = ins.args.map(function (x) { return cnt(x); });
          var result = callValue(callee, callArgs, ins.line);
          if (ins.dst != null) frame.regs[ins.dst].v = result;
          pc++;
          break;
        }
        case "ret":
          return ins.src == null ? undefined : cnt(ins.src);
        case "closure":
          frame.regs[ins.dst].v = makeClosure(ins.fid, frame, upvals);
          pc++;
          break;
        case "getupval": {
          var upv = upvals[ins.idx];
          frame.regs[ins.dst].v = upv ? upv.v : undefined;
          pc++;
          break;
        }
        case "setupval": {
          var upw = upvals[ins.idx];
          if (upw) upw.v = cnt(ins.src);
          pc++;
          break;
        }
        case "vget":
          frame.regs[ins.dst].v = host.vramGet(cnt(ins.addr));
          pc++;
          break;
        case "vset":
          host.vramSet(cnt(ins.addr), cnt(ins.word));
          pc++;
          break;
        case "padref":
          frame.regs[ins.dst].v = cnt(ins.n);
          pc++;
          break;
        case "padget": {
          var pn = cnt(ins.pad);
          var pv = (typeof pn === "number") ? host.padValue(pn, ins.field) : undefined;
          if (pv === undefined) {
            fail(ins.line, "attempt to index a nil value (pad[1..5] only)");
          }
          frame.regs[ins.dst].v = pv;
          pc++;
          break;
        }
        case "forprep": {
          var bse = ins.base;
          var step = frame.regs[bse + 2].v | 0;
          if (step === 0) fail(ins.line, "'for' step is zero");
          frame.regs[bse].v = (frame.regs[bse].v - step) | 0;
          pc++;
          break;
        }
        case "fornext": {
          var fb = ins.base;
          var fstep = frame.regs[fb + 2].v | 0;
          var idx = (frame.regs[fb].v + fstep) | 0;
          var limit = frame.regs[fb + 1].v | 0;
          if (fstep > 0 ? idx <= limit : limit <= idx) {
            frame.regs[fb].v = idx;
            frame.regs[fb + 3].v = idx;
            pc = ins.target;
          } else {
            pc++;
          }
          break;
        }
        case "reg":
          host.reg(ins.name, cnt(ins.value));
          pc++;
          break;
        case "pal":
          host.pal(cnt(ins.addr), cnt(ins.word));
          pc++;
          break;
        case "sat":
          host.sat(cnt(ins.i), cnt(ins.k), cnt(ins.v));
          pc++;
          break;
        case "sprite":
          host.sprite(cnt(ins.i), cnt(ins.spec));
          pc++;
          break;
        case "raster":
          host.raster(cnt(ins.lineArg), cnt(ins.spec));
          pc++;
          break;
        case "print": {
          var parts = [];
          for (var pi = 0; pi < ins.args.length; pi++) {
            var av = cnt(ins.args[pi]);
            var argT = ins.args[pi].r != null ? (ins.args[pi].tt || "int") : ins.args[pi].k.t;
            parts.push(luaNumToString(av, argT));
          }
          host.logLine(parts);
          pc++;
          break;
        }
        case "builtin": {
          var bres = callBuiltin(ins.name, ins.args.map(function (x) { return cnt(x); }), ins.line);
          if (ins.dst != null) frame.regs[ins.dst].v = bres;
          pc++;
          break;
        }
        default:
          fail(ins.line, "internal: unknown IL instruction " + ins.t);
        }
      }
      return undefined;
    }

    function callValue(callee, args, line) {
      if (callee === undefined) fail(line, "attempt to call a nil value");
      if (callee && callee.__builtin) return callBuiltin(callee.__builtin, args, line);
      if (callee && callee.__fn != null) {
        return callFunction(callee.__fn, args, line, callee.upvals);
      }
      fail(line, "attempt to call a " + typeof callee);
      return undefined;
    }

    function callBuiltin(name, args, line) {
      switch (name) {
      case "rgb": return (((luaMod(args[1], 8)) * 64) + ((luaMod(args[0], 8)) * 8) + luaMod(args[2], 8)) | 0;
      case "min": return Math.min(args[0], args[1]);
      case "max": return Math.max(args[0], args[1]);
      case "floor": return Math.floor(args[0]) | 0;
      case "abs": return Math.abs(args[0]);
      case "clamp":
        if (args[1] > args[2]) fail(line, "clamp: minimum must not exceed maximum");
        return Math.max(args[1], Math.min(args[2], args[0]));
      case "lerp": return fixed(args[0] + (args[1] - args[0]) * args[2]);
      case "sin": return fixed(Math.sin(args[0]));
      case "cos": return fixed(Math.cos(args[0]));
      case "sqrt": return fixed(Math.sqrt(args[0]));
      case "ramp": return fixed(rampAt(args[0], args[1]));
      case "ramp_int": return Math.floor(rampAt(args[0], args[1]) + 0.5) | 0;
      default:
        fail(line, "the IL has no builtin `" + name + "`");
      }
      return undefined;
    }

    /* The prelude's ramp (docs/TOYS.md §2): keyframes are {y, value[, easing]}
     * with numeric easing only (an easing name is a string, il-string). */
    function rampAt(kf, y) {
      if (!kf || typeof kf.length !== "number" || kf.length < 1) {
        throw new ToyError("toy-error", "ramp: at least one keyframe is required");
      }
      var n = kf.length;
      if (y <= kf[0][0]) return kf[0][1];
      for (var i = 1; i < n; i++) {
        var a = kf[i - 1], b = kf[i];
        if (y <= b[0]) {
          var d = b[0] - a[0];
          if (d <= 0) return b[1];
          return a[1] + (b[1] - a[1]) * ((y - a[0]) / d);
        }
      }
      return kf[n - 1][1];
    }

    /* ---- the runtime: the same shape as renderer/pce-toys.js ----------- */

    var initialized = false;
    var lastFrame = null;
    var lastRaster = null;
    var callbackMode = false;
    var mainCell = null;

    function callGlobal(name, args, line) {
      var v = globals[name];
      if (v === undefined) return false;
      if (v.__builtin) return callBuiltin(v.__builtin, args || [], line || 0);
      if (v.__fn != null) return callFunction(v.__fn, args || [], line || 0, v.upvals);
      fail(line || 0, name + " is not a function");
      return false;
    }

    function load() {
      callFunction(0, [], 0);
      var initV = globals["init"];
      if (initV !== undefined) {
        if (initV.__fn == null && !initV.__builtin) {
          fail(0, "init is not a function");
        }
        callGlobal("init", [], 0);
      }
      var rv = globals["raster"];
      callbackMode = !!(rv && rv.__fn != null);
      initialized = true;
      return runtime;
    }

    function frame(f) {
      if (broken) throw new ToyError(broken.code, broken.message);
      try {
        steps = 0;
        host.beginFrame(f);
        callGlobal("frame", [quantizeFixed(f / 60), f], 0);
        host.markBase();
        if (callbackMode) {
          for (var line = 0; line < VDW_LINES; line++) {
            host.beginLine();
            try {
              callGlobal("raster", [line], 0);
            } finally {
              host.endLine(line);
            }
          }
        }
        lastRaster = host.endFrame();
        lastFrame = host.render(f, lastRaster);
        return lastFrame;
      } catch (e) {
        if (e instanceof ToyError) {
          broken = { code: e.code, message: e.message };
          throw e;
        }
        broken = { code: "toy-error", message: String(e && e.message || e) };
        throw new ToyError(broken.code, broken.message);
      }
    }

    var runtime = {
      state: host.state,
      options: host.options,
      snapshot: host.snapshot,
      load: function () {
        try {
          return load();
        } catch (e) {
          if (e instanceof ToyError) {
            broken = { code: e.code, message: e.message };
            throw e;
          }
          throw e;
        }
      },
      frame: frame,
      setPad: function (n, buttons) {
        host.setPad(n, buttons);
        runtime.pad = host.padState;
        return runtime;
      },
      dispose: function () {},
      log: host.log,
      pad: host.padState,
      get initialized() { return initialized; },
      get broken() { return broken; },
      get error() { return broken ? new ToyError(broken.code, broken.message) : null; },
      get last() { return lastFrame; },
      get lastRaster() { return lastRaster; },
      get frameCount() { return host.frameCount(); },
      get callbackRaster() { return callbackMode; },
      WIDTH: WIDTH,
      HEIGHT: HEIGHT,
      PAD_FIELDS: toyhost.PAD_FIELDS.slice(),
      ToyError: ToyError
    };
    return runtime;
  }

  function create(source, options) {
    options = options || {};
    var program = compile(source, options);
    var host = toyhost.createHost(options);
    var rt = runProgram(program, host, options);
    rt.program = program;
    return rt;
  }

  return {
    compile: compile,
    create: create,
    runProgram: runProgram,
    ToyError: ToyError,
    WIDTH: WIDTH,
    HEIGHT: HEIGHT,
    VDW_LINES: VDW_LINES,
    OPCODES: OP,
    TYPES: T,
    MAX_INSTRUCTIONS: MAX_INSTRUCTIONS,
    HELPERS: Object.keys(HELPERS),
    REFUSALS: {
      "il-syntax": "Lua's own compile error, with file:line",
      "il-op": "a Lua construct the IL has no instruction for",
      "il-method": "a `:` method call",
      "il-for-in": "a generic for (pairs/ipairs)",
      "il-vararg": "`...`",
      "il-multret": "more than one value returned or requested",
      "il-string": "a string used as a value",
      "il-mixed": "int and fixed in one place",
      "il-int-range": "an integer constant outside the IL's 32-bit int",
      "il-fixed-range": "a fixed-point constant outside Q16.16",
      "il-type": "an unresolvable or conflicting type",
      "il-cond": "a condition that is not a bool",
      "il-table-read": "reading a field of a toy-built table",
      "il-pad-write": "writing a pad table",
      "il-key": "a table key the IL cannot use",
      "il-reg-name": "reg() without a constant name",
      "il-surface-shadow": "a toy reassigns a surface builtin",
      "il-unsupported": "a helper the IL half does not provide",
      "il-undefined": "a global that is never defined",
      "il-env": "_ENV used as a value",
      "il-arity": "a call with the wrong argument count",
      "il-jump": "a jump without an instruction boundary"
    }
  };
});
