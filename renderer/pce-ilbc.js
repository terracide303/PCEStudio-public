/*
 * pce-ilbc.js — the IL's compact bytecode encoding (card #100, first half).
 *
 *   toy.lua --(pce-il.js, Fengari)--> IL program --(this file)--> bytecode
 *                                                       --(ilvm.bin)--> .pce
 *
 * The console's interpreter (tools/ilvm/, built once by us and committed as
 * renderer/ilvm.bin) reads exactly this encoding out of ROM bank 1.  The
 * browser encodes a toy and glues it to ilvm.bin with renderer/pce-rom.js's
 * buildToyRom(); no compiler is involved at that point.
 *
 * The format is defined in docs/IL.md §14.  A short version:
 *
 *   header 24 bytes:
 *     0  "ILBC"               magic
 *     4  u8 version (= 1)
 *     5  u8 flags             bit 0: the toy has a raster() callback
 *     6  u8 initSlot          0xFF when the toy has no init()
 *     7  u8 frameSlot         0xFF when the toy has no frame()
 *     8  u8 rasterSlot        0xFF when the toy has no raster()
 *     9  u8 nfunc
 *    10  u8 nglobal
 *    11  u8 nconst
 *    12  u16 funcTabOff      function table
 *    14  u16 upTabOff        upvalue descriptors
 *    16  u16 constTabOff     constants
 *    18  u16 globalTabOff    global names
 *    20  u16 codeOff         first instruction
 *    22  u16 codeEnd         one past the last instruction
 *
 *   function entry (10 bytes), one per function id in order:
 *     u16 codeOff, u16 codeEnd, u16 upOff, u8 nregs, u8 nparams,
 *     u8 nups, u8 reserved
 *
 *   upvalue descriptor (2 bytes): u8 kind (0 = parent register, 1 = parent
 *     upvalue, 2 = _ENV), u8 index
 *
 *   constant: u8 type (0 int, 1 bool, 2 string, 3 nil), then
 *     int: 4-byte little-endian two's complement
 *     bool: 1 byte (0/1)
 *     string: u8 length + bytes (a name, never a value)
 *     nil: nothing
 *
 *   global: u8 length + bytes
 *
 *   instruction: u8 opcode, then its operands.  An operand byte is
 *     0x00..0x7F  register r
 *     0x80..0xFE  constant k (index = byte & 0x7F, at most 127 constants)
 *     0xFF        none
 *     Jump targets are absolute byte offsets in the container.
 *
 * Opcodes (one per IL instruction where possible):
 *   01 const  dst:reg k:u8
 *   02 move   dst:reg src:op
 *   03 getglobal dst:reg g:u8
 *   04 setglobal g:u8 src:op
 *   05 getupval  dst:reg idx:u8
 *   06 setupval  idx:u8 src:op
 *   07 closure   dst:reg fid:u8
 *   08 call   dst:op(none=0xFF) callee:op n:u8 args:n*op
 *   09 ret    src:op(none=0xFF)
 *   0A jmp    target:u16
 *   0B br     cond:op when:u8 target:u16
 *   0C forprep base:u8
 *   0D fornext base:u8 target:u16
 *   0E arith  op:u8 dst:reg a:op b:op
 *   0F unm    dst:reg a:op
 *   10 bnot   dst:reg a:op
 *   12 cmp    op:u8 dst:reg a:op b:op
 *   13 builtin id:u8 dst:reg n:u8 args:n*op
 *   14 pal    addr:op word:op
 *   15 reg    regid:u8 value:op
 *   16 vset   addr:op word:op
 *   17 vget   dst:reg addr:op
 *
 * arith opcodes: 0 add, 1 sub, 2 mul, 3 mod, 4 idiv, 5 band, 6 bor,
 *                7 bxor, 8 shl, 9 shr
 * cmp opcodes:   0 eq, 1 lt, 2 le
 * reg ids:       0 BXR, 1 BYR, 2 CR
 * builtin ids:   0 rgb
 *
 * What this half refuses, by code rather than guessing:
 *   ilbc-program  not a pce-il version 1 program
 *   ilbc-op       an IL instruction the interpreter does not have
 *                 (tables, sprites, pads, print, music, raster tables,
 *                 setupval is encoded but the toys do not use it, ...)
 *   ilbc-fixed    fixed-point arithmetic or a fixed constant
 *   ilbc-key      a constant that is not int/bool/nil
 *   ilbc-arity    more than four parameters or arguments
 *   ilbc-range    more registers/constants/functions than a byte can index
 *   ilbc-jump     a branch target that is not an instruction
 *   ilbc-builtin  a builtin other than rgb
 *
 * tableLayout() reads the table sites a program has (shape, escape, repeat)
 * for the console's static table pool (#171).  It encodes nothing and
 * changes no byte.
 *
 * UMD like pce-rom.js: CommonJS in Node, PCEStudio.ilbc in the page.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.PCEStudio = root.PCEStudio || {};
    root.PCEStudio.ilbc = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var VERSION = 1;
  var MAGIC = "ILBC";
  var HEADER = 24;
  var FUNC_ENTRY = 10;
  var OP_NONE = 0xFF;
  var OP_CONST = 0x80;
  var MAX_REGS = 128;          /* operand encoding: 0x00..0x7F */
  var MAX_CONST = 127;         /* 0x80..0xFE */
  var MAX_ARGS = 4;            /* the interpreter's signature */
  var TABLE_ARRAY_CAP = 16;    /* a register-key array's first-cut capacity */

  var OPS = {
    const: 0x01, move: 0x02, getglobal: 0x03, setglobal: 0x04,
    getupval: 0x05, setupval: 0x06, closure: 0x07, call: 0x08,
    ret: 0x09, jmp: 0x0A, br: 0x0B, forprep: 0x0C, fornext: 0x0D,
    arith: 0x0E, unm: 0x0F, bnot: 0x10, cmp: 0x12, builtin: 0x13,
    pal: 0x14, reg: 0x15, vset: 0x16, vget: 0x17
  };
  var ARITH = { add: 0, sub: 1, mul: 2, mod: 3, idiv: 4, band: 5,
                bor: 6, bxor: 7, shl: 8, shr: 9 };
  var CMP = { eq: 0, lt: 1, le: 2 };
  var REG = { BXR: 0, BYR: 1, CR: 2 };
  var BUILTIN = { rgb: 0 };    /* only the one the interpreter implements */

  function ILBCError(code, message) {
    this.name = "ILBCError";
    this.code = code;
    this.message = message;
  }
  ILBCError.prototype = Object.create(Error.prototype);
  ILBCError.prototype.constructor = ILBCError;

  function refuse(code, message) { throw new ILBCError(code, message); }

  /* ---- a byte buffer -------------------------------------------------- */

  function Buf() { this.a = []; }
  Buf.prototype.u8 = function (v) { this.a.push(v & 0xFF); };
  Buf.prototype.u16 = function (v) {
    this.a.push(v & 0xFF, (v >> 8) & 0xFF);
  };
  Buf.prototype.bytes = function (b) {
    for (var i = 0; i < b.length; i++) this.a.push(b[i] & 0xFF);
  };
  Buf.prototype.patchU8 = function (at, v) { this.a[at] = v & 0xFF; };
  Buf.prototype.patchU16 = function (at, v) {
    this.a[at] = v & 0xFF; this.a[at + 1] = (v >> 8) & 0xFF;
  };

  /* ---- operand encoding ------------------------------------------------ */

  /* The constant pool is built while the instructions are scanned, so a
   * constant operand needs a second pass through the instruction to know
   * its index.  `scanOperand` gives the encoder the key; `opByte` writes
   * the byte. */
  function kKey(k) {
    if (!k) refuse("ilbc-key", "a missing constant operand");
    if (k.t === "int") return "i:" + (k.v | 0);
    if (k.t === "bool") return "b:" + (k.v ? 1 : 0);
    if (k.t === "nil") return "n:";
    if (k.t === "fixed") {
      refuse("ilbc-fixed", "a fixed-point constant is not in the bytecode");
    }
    refuse("ilbc-key", "a `" + k.t + "` constant has no bytecode form");
    return null;
  }

  function operandKey(op) {
    if (!op) return null;
    if (op.r != null) return null;
    if (op.k) return kKey(op.k);
    refuse("ilbc-key", "an operand with neither a register nor a constant");
    return null;
  }

  /* Walk every operand of an IL instruction (the ones the encoding uses). */
  function eachOperand(ins, fn) {
    if (ins.a) fn(ins.a);
    if (ins.b) fn(ins.b);
    if (ins.cond) fn(ins.cond);
    if (ins.src) fn(ins.src);
    if (ins.addr) fn(ins.addr);
    if (ins.word) fn(ins.word);
    if (ins.value) fn(ins.value);
    if (ins.args) for (var i = 0; i < ins.args.length; i++) fn(ins.args[i]);
  }

  /* ---- instruction sizes and validation ------------------------------- */

  function sizeOf(ins) {
    var t = ins.t;
    if (t === "const" || t === "move" || t === "getglobal" ||
        t === "setglobal" || t === "getupval" || t === "setupval" ||
        t === "closure" || t === "unm" || t === "bnot" || t === "pal" ||
        t === "reg" || t === "vset" || t === "vget") return 3;
    if (t === "ret") return 2;
    if (t === "jmp") return 3;
    if (t === "br") return 5;
    if (t === "forprep") return 2;
    if (t === "fornext") return 4;
    if (t === "arith" || t === "cmp") return 5;
    if (t === "call" || t === "builtin") {
      var n = (ins.args || []).length;
      if (n > MAX_ARGS) {
        refuse("ilbc-arity", (t === "call" ? "a call" : "a builtin") +
               " with " + n + " arguments; the interpreter takes at most " +
               MAX_ARGS);
      }
      return 4 + n;
    }
    return -1;
  }

  function validateInstruction(ins, fnid, pc) {
    if (!ins || !OPS[ins.t]) {
      refuse("ilbc-op", "instruction " + (ins && ins.t) +
             " (function " + fnid + ", pc " + pc + ") has no bytecode form");
    }
    if (ins.t === "arith") {
      if (ins.type === "fixed") {
        refuse("ilbc-fixed", "fixed-point arithmetic (function " + fnid +
               ", pc " + pc + ")");
      }
      if (ARITH[ins.op] == null) {
        refuse("ilbc-op", "arithmetic `" + ins.op + "`");
      }
    }
    if (ins.t === "cmp" && ins.type === "fixed") {
      refuse("ilbc-fixed", "a fixed-point comparison");
    }
    if (ins.t === "reg" && REG[ins.name] == null) {
      refuse("ilbc-op", "register write `" + ins.name + "`");
    }
    /* `vget` has an opcode reserved in the format, but the interpreter does
     * not read VRAM back yet: refuse it rather than fault on the console. */
    if (ins.t === "vget") {
      refuse("ilbc-op", "vget (a VRAM read) is not in the first half");
    }
    if (ins.t === "builtin") {
      if (BUILTIN[ins.name] == null) {
        refuse("ilbc-builtin", "builtin `" + ins.name +
               "` has no bytecode form");
      }
    }
  }

  /* ---- encode ---------------------------------------------------------- */

  function encode(program) {
    if (!program || program.lang !== "pce-il" || program.version !== 1) {
      refuse("ilbc-program", "not a pce-il version 1 program");
    }
    var functions = program.functions || [];
    if (!functions.length) refuse("ilbc-program", "the IL has no functions");
    if (functions.length > 255) {
      refuse("ilbc-range", functions.length + " functions; a function id is " +
             "one byte");
    }

    /* Globals: the IL records every global the program binds.  The names are
     * kept in the container for a reader; the instructions use the index. */
    var globals = program.globals || [];
    if (globals.length > 255) {
      refuse("ilbc-range", globals.length + " globals; a global slot is one " +
             "byte");
    }
    var globalIds = {};
    for (var g = 0; g < globals.length; g++) globalIds[globals[g].name] = g;

    /* Hooks are global slots: the chunk stores a closure in `init`, `frame`
     * or `raster`, and the runtime calls whatever is there (the C backend
     * does the same, docs/IL.md §9.1). */
    function hookSlot(name, fid) {
      if (fid == null) return OP_NONE;
      if (globalIds[name] == null) {
        refuse("ilbc-program", "the `" + name + "` hook has no global slot");
      }
      return globalIds[name];
    }
    var initSlot = hookSlot("init", program.hooks && program.hooks.init);
    var frameSlot = hookSlot("frame", program.hooks && program.hooks.frame);
    var rasterSlot = hookSlot("raster", program.hooks && program.hooks.raster);

    /* Pass 1: constants and per-function instruction offsets. */
    var constKeys = [];
    var constIndex = {};
    function seeOperand(op) {
      var key = operandKey(op);
      if (key == null) return;
      if (constIndex[key] == null) {
        if (constKeys.length >= MAX_CONST) {
          refuse("ilbc-range", "more than " + MAX_CONST + " constants");
        }
        constIndex[key] = constKeys.length;
        constKeys.push(op.k);
      }
    }

    var fnOffsets = [], fnSizes = [], f, pc;
    for (f = 0; f < functions.length; f++) {
      var fn = functions[f];
      var code = fn.code || [];
      if (fn.params.length > MAX_ARGS) {
        refuse("ilbc-arity", fn.name + " takes " + fn.params.length +
               " parameters; the interpreter takes at most " + MAX_ARGS);
      }
      if (fn.registers > MAX_REGS) {
        refuse("ilbc-range", fn.name + " has " + fn.registers +
               " registers; an operand is one byte");
      }
      var offsets = new Array(code.length);
      var at = 0;
      for (pc = 0; pc < code.length; pc++) {
        var ins = code[pc];
        validateInstruction(ins, f, pc);
        var size = sizeOf(ins);
        if (size < 0) refuse("ilbc-op", "instruction " + ins.t);
        offsets[pc] = at;
        at += size;
        if (ins.k) seeOperand({ k: ins.k });
        eachOperand(ins, seeOperand);
      }
      fnOffsets.push(offsets);
      fnSizes.push(at);
    }

    /* Pass 2: lay the container out. */
    var upCount = 0;
    for (f = 0; f < functions.length; f++) upCount += functions[f].upvalues.length;
    var constTableSize = 0;
    for (var c = 0; c < constKeys.length; c++) {
      var k = constKeys[c];
      if (k.t === "int") constTableSize += 5;
      else if (k.t === "bool") constTableSize += 2;
      else if (k.t === "nil") constTableSize += 1;
      else if (k.t === "string") constTableSize += 2 + k.v.length;
      else refuse("ilbc-key", "constant `" + k.t + "`");
    }
    var globalTableSize = 0;
    for (g = 0; g < globals.length; g++) {
      globalTableSize += 1 + globals[g].name.length;
    }

    var funcTabOff = HEADER;
    var upTabOff = funcTabOff + functions.length * FUNC_ENTRY;
    var constTabOff = upTabOff + upCount * 2;
    var globalTabOff = constTabOff + constTableSize;
    var codeOff = globalTabOff + globalTableSize;

    /* Absolute code offsets, then instruction targets. */
    var fnCodeOff = [];
    var at2 = codeOff;
    for (f = 0; f < functions.length; f++) {
      fnCodeOff.push(at2);
      at2 += fnSizes[f];
    }
    var codeEnd = at2;

    var buf = new Buf();
    buf.bytes([MAGIC.charCodeAt(0), MAGIC.charCodeAt(1),
               MAGIC.charCodeAt(2), MAGIC.charCodeAt(3)]);
    buf.u8(VERSION);
    buf.u8(program.hooks && program.hooks.raster != null ? 1 : 0);
    buf.u8(initSlot); buf.u8(frameSlot); buf.u8(rasterSlot);
    buf.u8(functions.length); buf.u8(globals.length); buf.u8(constKeys.length);
    buf.u16(funcTabOff); buf.u16(upTabOff); buf.u16(constTabOff);
    buf.u16(globalTabOff); buf.u16(codeOff); buf.u16(codeEnd);

    /* Function table + upvalue descriptors. */
    var upAt = upTabOff;
    for (f = 0; f < functions.length; f++) {
      var fnu = functions[f];
      buf.u16(fnCodeOff[f]);
      buf.u16(fnCodeOff[f] + fnSizes[f]);
      buf.u16(upAt);
      buf.u8(fnu.registers);
      buf.u8(fnu.params.length);
      buf.u8(fnu.upvalues.length);
      buf.u8(0);
      upAt += fnu.upvalues.length * 2;
    }
    for (f = 0; f < functions.length; f++) {
      var ups = functions[f].upvalues;
      for (var u = 0; u < ups.length; u++) {
        var kind = ups[u].type === "env" ? 2
                 : (ups[u].from === "reg" ? 0 : 1);
        buf.u8(kind);
        buf.u8(ups[u].index);
      }
    }

    /* Constant table. */
    for (c = 0; c < constKeys.length; c++) {
      k = constKeys[c];
      if (k.t === "int") {
        buf.u8(0);
        var v = k.v | 0;
        buf.u8(v & 0xFF); buf.u8((v >> 8) & 0xFF);
        buf.u8((v >> 16) & 0xFF); buf.u8((v >>> 24) & 0xFF);
      } else if (k.t === "bool") {
        buf.u8(1); buf.u8(k.v ? 1 : 0);
      } else if (k.t === "string") {
        buf.u8(2); buf.u8(k.v.length);
        for (var sc = 0; sc < k.v.length; sc++) {
          buf.u8(k.v.charCodeAt(sc) & 0xFF);
        }
      } else {
        buf.u8(3);
      }
    }

    /* Global names. */
    for (g = 0; g < globals.length; g++) {
      var name = globals[g].name;
      buf.u8(name.length);
      for (var nc = 0; nc < name.length; nc++) buf.u8(name.charCodeAt(nc) & 0xFF);
    }

    /* Code. */
    if (buf.a.length !== codeOff) {
      refuse("ilbc-program", "internal: codeOff " + codeOff + " but the " +
             "tables end at " + buf.a.length);
    }
    for (f = 0; f < functions.length; f++) {
      encodeFunction(buf, functions[f], f, fnOffsets[f], fnCodeOff[f],
                     constIndex, globalIds);
    }
    if (buf.a.length !== codeEnd) {
      refuse("ilbc-program", "internal: codeEnd " + codeEnd + " but the " +
             "code ends at " + buf.a.length);
    }

    return {
      bytes: Uint8Array.from(buf.a),
      magic: MAGIC,
      version: VERSION,
      functions: functions.length,
      globals: globals.length,
      constants: constKeys.length,
      codeBytes: codeEnd - codeOff,
      hooks: { init: initSlot, frame: frameSlot, raster: rasterSlot },
      size: buf.a.length
    };
  }

  function encodeFunction(buf, fn, fid, offsets, codeOff, constIndex,
                          globalIds) {
    function reg(r) {
      if (r == null || r < 0 || r >= MAX_REGS) {
        refuse("ilbc-range", "register " + r + " in function " + fid);
      }
      return r;
    }
    function op(opnd) {
      if (!opnd) return OP_NONE;
      if (opnd.r != null) return reg(opnd.r);
      var key = operandKey(opnd);
      return OP_CONST | constIndex[key];
    }
    function target(pc) {
      if (pc == null || pc < 0 || pc >= offsets.length) {
        refuse("ilbc-jump", "function " + fid + " jumps to pc " + pc +
               " (only " + offsets.length + " instructions)");
      }
      return codeOff + offsets[pc];
    }

    var code = fn.code;
    for (var pc = 0; pc < code.length; pc++) {
      var ins = code[pc];
      if (buf.a.length !== codeOff + offsets[pc]) {
        refuse("ilbc-program", "internal: function " + fid + " pc " + pc +
               " at " + (codeOff + offsets[pc]) + ", buffer " + buf.a.length);
      }
      buf.u8(OPS[ins.t]);
      switch (ins.t) {
      case "const":
        buf.u8(reg(ins.dst));
        buf.u8(constIndex[kKey(ins.k)]);
        break;
      case "move":
        buf.u8(reg(ins.dst)); buf.u8(op(ins.src));
        break;
      case "getglobal":
        buf.u8(reg(ins.dst));
        buf.u8(globalIds[ins.name]);
        break;
      case "setglobal":
        buf.u8(globalIds[ins.name]); buf.u8(op(ins.src));
        break;
      case "getupval":
        buf.u8(reg(ins.dst)); buf.u8(ins.idx & 0xFF);
        break;
      case "setupval":
        buf.u8(ins.idx & 0xFF); buf.u8(op(ins.src));
        break;
      case "closure":
        buf.u8(reg(ins.dst)); buf.u8(ins.fid & 0xFF);
        break;
      case "call":
        buf.u8(ins.dst != null ? reg(ins.dst) : OP_NONE);
        buf.u8(op(ins.callee));
        buf.u8(ins.args.length);
        for (var ai = 0; ai < ins.args.length; ai++) buf.u8(op(ins.args[ai]));
        break;
      case "ret":
        buf.u8(op(ins.src));
        break;
      case "jmp":
        buf.u16(target(ins.target));
        break;
      case "br":
        buf.u8(op(ins.cond)); buf.u8(ins.when ? 1 : 0);
        buf.u16(target(ins.target));
        break;
      case "forprep":
        buf.u8(ins.base & 0xFF);
        break;
      case "fornext":
        buf.u8(ins.base & 0xFF); buf.u16(target(ins.target));
        break;
      case "arith":
        buf.u8(ARITH[ins.op]); buf.u8(reg(ins.dst));
        buf.u8(op(ins.a)); buf.u8(op(ins.b));
        break;
      case "unm":
      case "bnot":
        buf.u8(reg(ins.dst)); buf.u8(op(ins.a));
        break;
      case "cmp":
        buf.u8(CMP[ins.op]); buf.u8(reg(ins.dst));
        buf.u8(op(ins.a)); buf.u8(op(ins.b));
        break;
      case "builtin":
        buf.u8(BUILTIN[ins.name]); buf.u8(reg(ins.dst));
        buf.u8(ins.args.length);
        for (var bi = 0; bi < ins.args.length; bi++) buf.u8(op(ins.args[bi]));
        break;
      case "pal":
        buf.u8(op(ins.addr)); buf.u8(op(ins.word));
        break;
      case "reg":
        buf.u8(REG[ins.name]); buf.u8(op(ins.value));
        break;
      case "vset":
        buf.u8(op(ins.addr)); buf.u8(op(ins.word));
        break;
      case "vget":
        buf.u8(reg(ins.dst)); buf.u8(op(ins.addr));
        break;
      default:
        refuse("ilbc-op", "instruction " + ins.t);
      }
    }
  }

  /* ---- table layout: what each table site needs (#171) ------------------ *
   * The console gives every `table` instruction one static slot, reused every
   * time that site runs (docs/TABLES-PLAN.md §2.1).  This reads the IL and
   * reports, per site, the shape and lifetime that slot must serve:
   *
   *   cap       array cells: the site's setlist end, else the largest
   *             constant int key written through it, else TABLE_ARRAY_CAP
   *             when a write uses a register key, else 0
   *   fields    the field ids written through it, ascending
   *   nfields   the field cells reserved: the largest id written + 1
   *   cells     cap + nfields
   *   base      the site's first cell in the pool (sites are packed in order,
   *             which is the table section's `base` in docs/TABLES-PLAN.md
   *             §2.3; #172 is the card that writes it)
   *   escapes   setglobal/setupval/ret, an argument to a call, or stored in
   *             a table that escapes (the taint follows containment)
   *   repeats   the site is not in the chunk or init(), or it sits inside a
   *             back-edge loop
   *
   * Field ids are program-wide and assigned by first appearance of the
   * string key, so a name means the same field at every site.  A value is
   * followed through its register until that register is written again,
   * through a `move`, and through a table-typed global a site stores into
   * (every `getglobal` of that global is followed the same way).  A table
   * passed to a sprite()/raster() instruction does NOT escape: the runtime
   * copies the fields it needs.  Reading only; the encoder's bytes and the
   * encoder's refusals are unchanged.
   */
  function tableLayout(program) {
    if (!program || program.lang !== "pce-il" || program.version !== 1) {
      refuse("ilbc-program", "not a pce-il version 1 program");
    }
    var functions = program.functions || [];
    var globals = program.globals || [];
    var globalTypes = {};
    var g;
    for (g = 0; g < globals.length; g++) {
      globalTypes[globals[g].name] = globals[g].type;
    }

    /* Loops are back edges: a branch whose target is at or before it. */
    var loops = [], f, pc;
    for (f = 0; f < functions.length; f++) {
      var fnCode = functions[f].code || [];
      var ranges = [];
      for (pc = 0; pc < fnCode.length; pc++) {
        var lins = fnCode[pc];
        if ((lins.t === "jmp" || lins.t === "br" || lins.t === "fornext") &&
            lins.target != null && lins.target <= pc) {
          ranges.push([lins.target, pc]);
        }
      }
      loops.push(ranges);
    }
    function insideLoop(fid, at) {
      for (var r = 0; r < loops[fid].length; r++) {
        if (at >= loops[fid][r][0] && at <= loops[fid][r][1]) return true;
      }
      return false;
    }
    var initFid = program.hooks && program.hooks.init;

    /* One site per `table` instruction, in program order. */
    var sites = [], siteAt = [];
    for (f = 0; f < functions.length; f++) {
      var code = functions[f].code || [];
      siteAt.push(new Array(code.length));
      for (pc = 0; pc < code.length; pc++) {
        if (code[pc].t !== "table") continue;
        siteAt[f][pc] = sites.length;
        sites.push({
          id: sites.length, fid: f, pc: pc, line: code[pc].line,
          setlistEnd: null, constKeyMax: null, registerKey: false,
          fields: [], globals: [], escapes: false,
          repeats: (f !== 0 && f !== initFid) || insideLoop(f, pc)
        });
      }
    }

    var fieldIds = [], fieldIdOf = {};
    function fieldId(name) {
      if (fieldIdOf[name] == null) {
        fieldIdOf[name] = fieldIds.length;
        fieldIds.push(name);
      }
      return fieldIdOf[name];
    }

    /* A table-typed global's uses, gathered from the getglobal windows, and
     * the sites that stored into it.  The two are joined after the walk. */
    var globalUses = {}, globalStores = {};
    function globalUse(name) {
      if (!globalUses[name]) {
        globalUses[name] = { setlistEnd: null, constKeyMax: null,
                             registerKey: false, fields: [] };
      }
      return globalUses[name];
    }

    var edges = [];   /* containment: [child site, container site] */

    function opReg(op) { return op != null && op.r != null; }
    function opStr(op) { return op != null && op.k != null && op.k.t === "str"; }
    function opInt(op) { return op != null && op.k != null && op.k.t === "int"; }
    function descOf(regs, op) {
      if (!opReg(op)) return null;
      return regs[op.r] || null;
    }
    function targetOf(desc) {
      if (!desc) return null;
      if (desc.site != null) return sites[desc.site];
      if (desc.global != null) return globalUse(desc.global);
      return null;
    }
    /* Record one use of `desc`: a key written into it and/or a table value
     * stored in it.  A table typed as a global's table is itself escaping. */
    function readTarget(regs, desc, key, value) {
      var tgt = targetOf(desc);
      if (!tgt) return;
      if (key != null) {
        if (opStr(key)) {
          var id = fieldId(key.k.v);
          if (tgt.fields.indexOf(id) < 0) tgt.fields.push(id);
        } else if (opInt(key)) {
          var k = key.k.v | 0;
          if (tgt.constKeyMax == null || k > tgt.constKeyMax) {
            tgt.constKeyMax = k;
          }
        } else if (opReg(key)) {
          tgt.registerKey = true;
        }
      }
      if (value != null && opReg(value)) {
        var child = regs[value.r];
        if (child && child.site != null) {
          if (desc.site != null) edges.push([child.site, desc.site]);
          /* A table-typed global's table is stored in a global, so it
           * escapes; a table inside it therefore escapes too. */
          else if (desc.global != null) sites[child.site].escapes = true;
        }
      }
    }
    function markEscapes(desc) {
      if (desc && desc.site != null) sites[desc.site].escapes = true;
    }

    for (f = 0; f < functions.length; f++) {
      var fcode = functions[f].code || [];
      var regs = {};    /* reg -> { site: id } | { global: name } | absent */

      for (pc = 0; pc < fcode.length; pc++) {
        var ins = fcode[pc];

        /* Uses, before this instruction's own write. */
        if (ins.t === "setlist") {
          var sd = descOf(regs, ins.base);
          var st = targetOf(sd);
          if (st) {
            var end = ins.index + (ins.values ? ins.values.length : 0) - 1;
            if (st.setlistEnd == null || end > st.setlistEnd) st.setlistEnd = end;
          }
          for (var vi = 0; ins.values && vi < ins.values.length; vi++) {
            readTarget(regs, sd, null, ins.values[vi]);
          }
        } else if (ins.t === "tset") {
          readTarget(regs, descOf(regs, ins.base), ins.key, ins.value);
        } else if (ins.t === "setglobal") {
          var gd = descOf(regs, ins.src);
          if (gd && gd.site != null) {
            var gsite = sites[gd.site];
            gsite.escapes = true;
            if (gsite.globals.indexOf(ins.name) < 0) gsite.globals.push(ins.name);
            var stores = globalStores[ins.name] ||
                         (globalStores[ins.name] = []);
            if (stores.indexOf(gd.site) < 0) stores.push(gd.site);
          }
        } else if (ins.t === "setupval" || ins.t === "ret") {
          markEscapes(descOf(regs, ins.src));
        } else if (ins.t === "call" || ins.t === "builtin") {
          var args = ins.args || [];
          for (var ai = 0; ai < args.length; ai++) {
            markEscapes(descOf(regs, args[ai]));
          }
        }

        /* The write: a later read of this register is a different value. */
        if (ins.t === "table") {
          regs[ins.dst] = { site: siteAt[f][pc] };
        } else if (ins.t === "move") {
          regs[ins.dst] = descOf(regs, ins.src) || null;
        } else if (ins.t === "getglobal") {
          regs[ins.dst] = globalTypes[ins.name] === "table"
            ? { global: ins.name } : null;
        } else if (ins.t === "forprep") {
          regs[ins.base] = null;
        } else if (ins.t === "fornext") {
          regs[ins.base] = null;
          regs[ins.base + 3] = null;
        } else if (ins.dst != null) {
          regs[ins.dst] = null;
        }
      }
    }

    /* Join a table-typed global to the sites that stored into it. */
    for (var name in globalStores) {
      if (!Object.prototype.hasOwnProperty.call(globalStores, name)) continue;
      var use = globalUses[name];
      if (!use) continue;
      var ids = globalStores[name];
      for (var si = 0; si < ids.length; si++) {
        var s = sites[ids[si]];
        if (use.setlistEnd != null &&
            (s.setlistEnd == null || use.setlistEnd > s.setlistEnd)) {
          s.setlistEnd = use.setlistEnd;
        }
        if (use.constKeyMax != null &&
            (s.constKeyMax == null || use.constKeyMax > s.constKeyMax)) {
          s.constKeyMax = use.constKeyMax;
        }
        if (use.registerKey) s.registerKey = true;
        for (var fi = 0; fi < use.fields.length; fi++) {
          if (s.fields.indexOf(use.fields[fi]) < 0) s.fields.push(use.fields[fi]);
        }
      }
    }

    /* Escape follows containment: a table in a table that escapes escapes. */
    var changed = true;
    while (changed) {
      changed = false;
      for (var e = 0; e < edges.length; e++) {
        var childSite = sites[edges[e][0]], parentSite = sites[edges[e][1]];
        if (parentSite.escapes && !childSite.escapes) {
          childSite.escapes = true;
          changed = true;
        }
      }
    }

    var out = [], arrayCells = 0, fieldCells = 0;
    var escaping = 0, reexecuting = 0, at = 0;
    for (var oi = 0; oi < sites.length; oi++) {
      var site = sites[oi];
      var cap = site.setlistEnd != null ? site.setlistEnd
              : site.constKeyMax != null ? site.constKeyMax
              : site.registerKey ? TABLE_ARRAY_CAP : 0;
      var nfields = 0;
      for (var fj = 0; fj < site.fields.length; fj++) {
        if (site.fields[fj] + 1 > nfields) nfields = site.fields[fj] + 1;
      }
      var rec = {
        id: site.id, fid: site.fid, pc: site.pc, line: site.line,
        base: at,
        cap: cap,
        fields: site.fields.slice().sort(function (a, b) { return a - b; }),
        nfields: nfields, cells: cap + nfields,
        escapes: site.escapes, repeats: site.repeats,
        globals: site.globals.slice()
      };
      out.push(rec);
      at += rec.cells;
      arrayCells += cap;
      fieldCells += nfields;
      if (rec.escapes) escaping++;
      if (rec.repeats) reexecuting++;
    }

    return {
      sites: out,
      fieldIds: fieldIds.slice(),
      arrayCap: TABLE_ARRAY_CAP,
      nslots: out.length,
      arrayCells: arrayCells,
      fieldCells: fieldCells,
      cells: arrayCells + fieldCells,
      escaping: escaping,
      reexecuting: reexecuting
    };
  }

  return {
    VERSION: VERSION,
    MAGIC: MAGIC,
    HEADER: HEADER,
    FUNC_ENTRY: FUNC_ENTRY,
    OPS: OPS,
    TABLE_ARRAY_CAP: TABLE_ARRAY_CAP,
    ILBCError: ILBCError,
    encode: encode,
    tableLayout: tableLayout,
    /* exported for tests: the refusal codes the encoder can raise */
    CODES: ["ilbc-program", "ilbc-op", "ilbc-fixed", "ilbc-key",
            "ilbc-arity", "ilbc-range", "ilbc-jump", "ilbc-builtin"]
  };
});
