/*
 * ilvm.c — the HuC6280 interpreter for PCEStudio's IL bytecode (#100).
 *
 * This is the console half of route 1: the toy's IL is encoded by
 * renderer/pce-ilbc.js into a compact bytecode container, the browser glues
 * that container to this interpreter's fixed 8 KiB bank (renderer/ilvm.bin,
 * built once by tools/ilvm/build.sh and committed), and the console runs the
 * toy by interpreting it.  No compiler is needed to export a ROM.
 *
 * The interpreter reads its program from ROM bank 1, mapped into the CPU's
 * MPR2 window at $4000-$5FFF (HuC6280 manual H8-7/H8-10; the viewer uses
 * the same window, docs/ROM_LAYOUT.md).  Bank 0 is this code; the data bank
 * is bytes 8192..16383 of the .pce.  ilvm_runtime.c owns the VDC/VCE, the
 * frame flow and the RCR table replay; this file owns only the toy's
 * meaning: the bytecode loop.
 *
 * The encoding is docs/IL.md §14.  The opcodes and their exact Lua
 * semantics mirror renderer/pce-cgen.js's C lowering (32-bit wrapping,
 * Lua's floor `%` and `//`, shifts out of range 0, Lua truthiness for a
 * branch), because the two backends must produce the same picture.
 *
 * Container version 2 adds the table section (#172, docs/TABLES-PLAN.md
 * §2): every `table` instruction site owns one static slot in the fixed
 * pool, zeroed and reused each time the site runs.  A register holds a
 * table as its slot id; a slot's cells are its array part (cap cells,
 * 1-based index i at cell base+i-1) then its field part (nfields cells,
 * field id f at cell base+cap+f).  Writing past a slot or holding an id
 * past nslots sets `fault` and touches nothing; reading out of range is 0.
 *
 * Calls are C recursion over a bytecode function: the toys' call trees are
 * shallow (the deepest here is chunk -> init -> puttile -> callback).  A
 * deeper tree is bounded by the mos soft stack; a general backend must
 * bound it (#100's second half can refuse recursion in the encoder).
 *
 * Build: tools/ilvm/build.sh (llvm-mos, once).  The output is committed as
 * renderer/ilvm.bin; tests/check-ilvm.js proves it against the browser.
 */
#include <stdint.h>

#ifdef ILVM_HOST
/* The host build runs the same interpreter over the same bytecode without a
 * console, so a bytecode or VM bug is found before Mednafen.  tools/ilvm/
 * hostvm.c provides ilvm_program and the toy_* writers; the on-console
 * path below is what the committed ilvm.bin is built from. */
extern const uint8_t *ilvm_program;
#define PROG (ilvm_program)
void toy_pal(int32_t addr, int32_t word);
void toy_reg(int32_t which, int32_t value);
void toy_vram_set(int32_t addr, int32_t word);
void toy_display_on(void);
int32_t toy_rgb(int32_t r, int32_t g, int32_t b);
#else
#include <pce.h>
#include "toy_runtime.h"
/* The MPR2 window: HuC6280 TAM mask $04 selects MPR2 ($4000-$5FFF).  The
 * crt0 leaves MPR2=$00 (ROM bank 0); the data bank is physical bank 2 (the
 * 16 KiB interpreter image occupies banks 0-1). */
#define PROG ((const uint8_t *)0x4000)
#endif

#define MAX_REGS 32            /* the two toys need 21; the encoder's limit
                                * is 128, the interpreter's is this */
#define MAX_UPS 6              /* the parallax chunk captures 5 */
#define MAX_CLOS 32
#define MAX_GLOBALS 32
#define MAX_FUNCS 32
/* #183: a call carries up to eight arguments.  Four ride in exec()'s C
 * parameters (a0..a3); a fifth to eighth ride in `xargs`, a fixed
 * extra-argument block exec() copies into r[4..7] at entry.  The block is
 * written by the call instruction and read by the callee before it executes
 * anything, so a nested call cannot overwrite a callee's arguments.  A call
 * with four or fewer arguments writes zeroes and keeps its old bytecode. */
#define MAX_ARGS 8
#define CALL_ARGS 4            /* the four exec() takes directly */
#define MAX_SLOTS 32           /* first cut: the table toys need 7; the
                                * encoder's limit is 255 */
#define MAX_TABLE_CELLS 256    /* the fixed table pool: 1 KiB of BaseRAM
                                * (docs/TABLES-PLAN.md §2.1).  Must equal
                                * renderer/pce-ilbc.js's TABLE_POOL_CELLS;
                                * checkTablesRun asserts the two are equal. */

struct fninfo {
  uint16_t codeOff;
  uint16_t codeEnd;
  uint16_t upOff;
  uint8_t nregs;
  uint8_t nparams;
  uint8_t nups;
};

struct closure {
  uint8_t fid;
  int32_t up[MAX_UPS];
};

static struct fninfo fns[MAX_FUNCS];
static struct closure clos[MAX_CLOS];
static int32_t kvals[128];
static int32_t globals[MAX_GLOBALS];
/* #183's extra-argument block: call writes arguments 5..8 here, the callee
 * copies them into r[4..7] on entry.  Static like the rest of the VM state,
 * so it costs BaseRAM, not soft-stack depth. */
static int32_t xargs[MAX_ARGS - CALL_ARGS];

/* The table pool (docs/TABLES-PLAN.md §2.1): each `table` instruction site
 * owns one static slot, zeroed every time the site runs.  The slot's shape
 * comes from the container's table section; its cells live in the fixed
 * pool.  Static, so the linker places the pool in BaseRAM like fns/clos. */
static uint16_t slot_base[MAX_SLOTS];
static uint8_t slot_cap[MAX_SLOTS];
static uint8_t slot_nfields[MAX_SLOTS];
static uint8_t nslots;
static int32_t cells[MAX_TABLE_CELLS];

#ifdef ILVM_HOST
/* The host harness dumps the pool (checkTablesRun's fault evidence). */
const int32_t *ilvm_table_cells(void) { return cells; }
int ilvm_table_cell_count(void) { return MAX_TABLE_CELLS; }
#endif

static uint8_t nfunc, nglobal, nconst;
static uint16_t constTabOff;
static uint8_t init_slot, frame_slot, raster_slot;
static uint8_t clos_next;
static uint8_t fault;

#ifdef ILVM_HOST
static void map_bank2(uint8_t bank) { (void)bank; }
#else
static void map_bank2(uint8_t bank) {
  __asm__ volatile ("tam #$04" : : "a" (bank));
}
#endif

/* ---- byte readers (ROM bank 1) ---------------------------------------- */

__attribute__((noinline)) static uint8_t rb(uint16_t off) {
  return PROG[off];
}

__attribute__((noinline)) static uint16_t rw(uint16_t off) {
  return (uint16_t)((uint16_t)rb(off) | ((uint16_t)rb((uint16_t)(off + 1)) << 8));
}

__attribute__((noinline)) static int32_t ri32(uint16_t off) {
  return (int32_t)((uint32_t)rb(off) |
                   ((uint32_t)rb((uint16_t)(off + 1)) << 8) |
                   ((uint32_t)rb((uint16_t)(off + 2)) << 16) |
                   ((uint32_t)rb((uint16_t)(off + 3)) << 24));
}

/* Lua's `%`: the result has the divisor's sign (pce-cgen.js's il_lua_mod). */
__attribute__((noinline)) static int32_t lua_mod(int32_t x, int32_t y) {
  int32_t m;
  if (y == 0) return 0;          /* the reference interpreter raises */
  m = x % y;
  if (m != 0 && ((m < 0) != (y < 0))) m += y;
  return m;
}

/* Lua's `//`: floor division. */
__attribute__((noinline)) static int32_t lua_idiv(int32_t x, int32_t y) {
  int32_t q, r;
  if (y == 0) return 0;
  q = x / y;
  r = x % y;
  if (r != 0 && ((r < 0) != (y < 0))) q--;
  return q;
}

__attribute__((noinline)) static int32_t lua_shl(int32_t x, int32_t n) {
  if (n < 0 || n >= 32) return 0;
  return (int32_t)((uint32_t)x << n);
}

__attribute__((noinline)) static int32_t lua_shr(int32_t x, int32_t n) {
  if (n < 0 || n >= 32) return 0;
  return (int32_t)((uint32_t)x >> n);
}

/* ---- operands --------------------------------------------------------- */

__attribute__((noinline)) static int32_t operand(const int32_t *r, uint8_t o) {
  if (o == 0xFF) return 0;
  if (o < 0x80) return o < MAX_REGS ? r[o] : 0;
  return kvals[o & 0x7F];
}

/* ---- the interpreter -------------------------------------------------- */

static int32_t exec(uint8_t fid, uint8_t clh,
                    int32_t a0, int32_t a1, int32_t a2, int32_t a3) {
  int32_t r[MAX_REGS];
  const struct fninfo *fn;
  uint16_t pc, tgt, base;
  uint8_t op, d, g, u, k, i, n, aa, bb, s, kind;
  int32_t av, bv, v;

  if (fault || fid >= nfunc) { fault = 1; return 0; }
  fn = &fns[fid];
  if (fn->nregs > MAX_REGS) { fault = 1; return 0; }

  for (i = 0; i < fn->nregs; i++) r[i] = 0;
  if (fn->nparams > 0) r[0] = a0;
  if (fn->nparams > 1) r[1] = a1;
  if (fn->nparams > 2) r[2] = a2;
  if (fn->nparams > 3) r[3] = a3;
  /* #183: parameters 5..8 from the extra-argument block.  nregs is at least
   * nparams, so r[4..7] are inside the register file; writing all four even
   * for a five-parameter function is harmless. */
  if (fn->nparams > CALL_ARGS) {
    r[4] = xargs[0]; r[5] = xargs[1]; r[6] = xargs[2]; r[7] = xargs[3];
  }

  pc = fn->codeOff;
  for (;;) {
    if (pc < fn->codeOff || pc >= fn->codeEnd) { fault = 1; return 0; }
    op = rb(pc++);
    switch (op) {
    case 0x01:                     /* const */
      d = rb(pc++); k = rb(pc++);
      r[d] = kvals[k];
      break;
    case 0x02:                     /* move */
      d = rb(pc++); r[d] = operand(r, rb(pc++));
      break;
    case 0x03:                     /* getglobal */
      d = rb(pc++); g = rb(pc++);
      r[d] = g < nglobal ? globals[g] : 0;
      break;
    case 0x04:                     /* setglobal */
      g = rb(pc++);
      if (g < nglobal) globals[g] = operand(r, rb(pc++));
      else pc++;
      break;
    case 0x05:                     /* getupval */
      d = rb(pc++); u = rb(pc++);
      r[d] = u < MAX_UPS ? clos[clh].up[u] : 0;
      break;
    case 0x06:                     /* setupval */
      u = rb(pc++);
      if (u < MAX_UPS) clos[clh].up[u] = operand(r, rb(pc++));
      else pc++;
      break;
    case 0x07: {                   /* closure */
      const struct fninfo *tf;
      d = rb(pc++); k = rb(pc++);
      if (k >= nfunc) { fault = 1; return 0; }
      tf = &fns[k];
      if (tf->nups > MAX_UPS) { fault = 1; return 0; }
      u = clos_next;
      clos_next = (uint8_t)(clos_next + 1);
      if (clos_next >= MAX_CLOS) clos_next = 1;
      clos[u].fid = k;
      for (i = 0; i < tf->nups; i++) {
        uint8_t kind = rb((uint16_t)(tf->upOff + i * 2));
        uint8_t idx = rb((uint16_t)(tf->upOff + i * 2 + 1));
        if (kind == 0) clos[u].up[i] = idx < MAX_REGS ? r[idx] : 0;
        else if (kind == 1) clos[u].up[i] = idx < MAX_UPS ? clos[clh].up[idx] : 0;
        else clos[u].up[i] = 0;    /* _ENV: a name, never a value */
      }
      r[d] = u;
      break;
    }
    case 0x08: {                   /* call */
      int32_t args[CALL_ARGS];
      int32_t ch;
      d = rb(pc++);
      /* The callee operand names a register (or a constant); its VALUE is
       * the closure handle.  Reading the operand byte as the handle was the
       * first run's bug: a call to register 12 ran closure 12 instead. */
      ch = operand(r, rb(pc++));
      if (ch < 0 || ch >= MAX_CLOS) { fault = 1; return 0; }
      u = (uint8_t)ch;
      n = rb(pc++);
      if (n > MAX_ARGS) { fault = 1; return 0; }
      for (i = 0; i < CALL_ARGS; i++) args[i] = 0;
      for (i = 0; i < MAX_ARGS - CALL_ARGS; i++) xargs[i] = 0;
      for (i = 0; i < n; i++) {
        av = operand(r, rb(pc++));
        if (i < CALL_ARGS) args[i] = av;
        else xargs[i - CALL_ARGS] = av;
      }
      if (u >= MAX_CLOS || clos[u].fid >= nfunc) { fault = 1; return 0; }
      v = exec(clos[u].fid, u, args[0], args[1], args[2], args[3]);
      if (d != 0xFF) r[d] = v;
      break;
    }
    case 0x09:                     /* ret */
      aa = rb(pc++);
      return aa == 0xFF ? 0 : operand(r, aa);
    case 0x0A:                     /* jmp */
      pc = rw(pc);
      break;
    case 0x0B:                     /* br */
      aa = rb(pc++);
      v = operand(r, aa);
      bb = rb(pc++);
      tgt = rw(pc); pc = (uint16_t)(pc + 2);
      if ((v != 0 ? 1 : 0) == bb) pc = tgt;
      break;
    case 0x0C:                     /* forprep */
      aa = rb(pc++);
      r[aa] = (int32_t)((uint32_t)r[aa] - (uint32_t)r[aa + 2]);
      break;
    case 0x0D: {                   /* fornext */
      int32_t st, idx, lim;
      aa = rb(pc++);
      tgt = rw(pc); pc = (uint16_t)(pc + 2);
      st = r[aa + 2];
      idx = (int32_t)((uint32_t)r[aa] + (uint32_t)st);
      lim = r[aa + 1];
      if ((st > 0) ? (idx <= lim) : (lim <= idx)) {
        r[aa] = idx;
        r[aa + 3] = idx;
        pc = tgt;
      }
      break;
    }
    case 0x0E:                     /* arith */
      aa = rb(pc++);               /* op */
      d = rb(pc++);
      av = operand(r, rb(pc++));
      bv = operand(r, rb(pc++));
      switch (aa) {
      case 0: v = (int32_t)((uint32_t)av + (uint32_t)bv); break;
      case 1: v = (int32_t)((uint32_t)av - (uint32_t)bv); break;
      case 2: v = (int32_t)((uint32_t)av * (uint32_t)bv); break;
      case 3: v = lua_mod(av, bv); break;
      case 4: v = lua_idiv(av, bv); break;
      case 5: v = av & bv; break;
      case 6: v = av | bv; break;
      case 7: v = av ^ bv; break;
      case 8: v = lua_shl(av, bv); break;
      case 9: v = lua_shr(av, bv); break;
      default: fault = 1; return 0;
      }
      r[d] = v;
      break;
    case 0x0F:                     /* unm */
      d = rb(pc++); r[d] = (int32_t)(0u - (uint32_t)operand(r, rb(pc++)));
      break;
    case 0x10:                     /* bnot */
      d = rb(pc++); r[d] = ~operand(r, rb(pc++));
      break;
    case 0x12:                     /* cmp */
      aa = rb(pc++);               /* op */
      d = rb(pc++);
      av = operand(r, rb(pc++));
      bv = operand(r, rb(pc++));
      switch (aa) {
      case 0: v = (av == bv); break;
      case 1: v = (av < bv); break;
      case 2: v = (av <= bv); break;
      default: fault = 1; return 0;
      }
      r[d] = v;
      break;
    case 0x13: {                   /* builtin */
      int32_t pargs[CALL_ARGS];
      aa = rb(pc++);               /* builtin id (0 = rgb) */
      d = rb(pc++);
      n = rb(pc++);
      /* Every builtin the interpreter has takes at most four arguments,
       * so a wide builtin is a corrupt container, not a wide call. */
      if (n > CALL_ARGS) { fault = 1; return 0; }
      for (i = 0; i < CALL_ARGS; i++) pargs[i] = 0;
      for (i = 0; i < n; i++) pargs[i] = operand(r, rb(pc++));
      if (aa == 0) v = toy_rgb(pargs[0], pargs[1], pargs[2]);
      else { fault = 1; return 0; }
      r[d] = v;
      break;
    }
    case 0x14:                     /* pal */
      av = operand(r, rb(pc++));
      bv = operand(r, rb(pc++));
      toy_pal(av, bv);
      break;
    case 0x15:                     /* reg */
      aa = rb(pc++);
      toy_reg(aa, operand(r, rb(pc++)));
      break;
    case 0x16:                     /* vset */
      av = operand(r, rb(pc++));
      bv = operand(r, rb(pc++));
      toy_vram_set(av, bv);
      break;
    case 0x18: {                   /* table: zero the slot, hold its id */
      d = rb(pc++);
      s = rb(pc++);
      if (s >= nslots) { fault = 1; return 0; }
      base = slot_base[s];
      for (v = 0; v < (int32_t)slot_cap[s] + slot_nfields[s]; v++) {
        cells[base + (uint16_t)v] = 0;
      }
      r[d] = s;
      break;
    }
    case 0x19: {                   /* setlist: array part, first is 1-based */
      uint8_t first;
      v = r[rb(pc++)];             /* base register's value: a slot id */
      if (v < 0 || v >= nslots) { fault = 1; return 0; }
      s = (uint8_t)v;
      first = rb(pc++);
      n = rb(pc++);
      base = slot_base[s];
      for (i = 0; i < n; i++) {
        int32_t idx = (int32_t)first + i;
        if (idx < 1 || idx > slot_cap[s]) { fault = 1; return 0; }
        cells[base + (uint16_t)(idx - 1)] = operand(r, rb(pc++));
      }
      break;
    }
    case 0x1A: {                   /* tget: unset or out of range is 0 */
      d = rb(pc++);
      v = operand(r, rb(pc++));    /* the base's value: a slot id */
      if (v < 0 || v >= nslots) { fault = 1; return 0; }
      s = (uint8_t)v;
      k = rb(pc++);
      kind = rb(pc++);
      base = slot_base[s];
      if (kind == 0) {
        av = operand(r, k);        /* 1-based array key */
        if (av < 1 || av > slot_cap[s]) { r[d] = 0; break; }
        r[d] = cells[base + (uint16_t)(av - 1)];
      } else if (kind == 1) {      /* field id */
        if (k >= slot_nfields[s]) { r[d] = 0; break; }
        r[d] = cells[base + (uint16_t)slot_cap[s] + k];
      } else { fault = 1; return 0; }
      break;
    }
    case 0x1B: {                   /* tset: out of range faults, nothing written */
      v = operand(r, rb(pc++));    /* the base's value: a slot id */
      if (v < 0 || v >= nslots) { fault = 1; return 0; }
      s = (uint8_t)v;
      k = rb(pc++);
      kind = rb(pc++);
      bv = operand(r, rb(pc++));   /* the value */
      base = slot_base[s];
      if (kind == 0) {
        av = operand(r, k);        /* 1-based array key */
        if (av < 1 || av > slot_cap[s]) { fault = 1; return 0; }
        cells[base + (uint16_t)(av - 1)] = bv;
      } else if (kind == 1) {      /* field id */
        if (k >= slot_nfields[s]) { fault = 1; return 0; }
        cells[base + (uint16_t)slot_cap[s] + k] = bv;
      } else { fault = 1; return 0; }
      break;
    }
    default:
      /* Every other opcode is refused by the encoder, so reaching one is
       * a corrupt container: stop rather than run a wrong toy. */
      fault = 1;
      return 0;
    }
  }
}

/* ---- the runtime's three entry points --------------------------------- */

void toy_boot(void) {
  uint16_t funcTabOff, off, tabOff;
  uint8_t i, ver;

  fault = 0;
  clos_next = 1;
  nfunc = 0; nglobal = 0; nconst = 0; nslots = 0;
  init_slot = 0xFF; frame_slot = 0xFF; raster_slot = 0xFF;

  map_bank2(2);
  if (rb(0) != 'I' || rb(1) != 'L' || rb(2) != 'B' || rb(3) != 'C') {
    fault = 1;
    toy_display_on();
    return;
  }
  ver = rb(4);
  if (ver != 1 && ver != 2) {
    fault = 1;
    toy_display_on();
    return;
  }

  nfunc = rb(9);
  nglobal = rb(10);
  nconst = rb(11);
  funcTabOff = rw(12);
  constTabOff = rw(16);
  init_slot = rb(6);
  frame_slot = rb(7);
  raster_slot = rb(8);

  if (nfunc > MAX_FUNCS || nglobal > MAX_GLOBALS || nconst > 127) {
    fault = 1;
    toy_display_on();
    return;
  }

  /* The function table. */
  for (i = 0; i < nfunc; i++) {
    off = (uint16_t)(funcTabOff + i * 10);
    fns[i].codeOff = rw(off);
    fns[i].codeEnd = rw((uint16_t)(off + 2));
    fns[i].upOff = rw((uint16_t)(off + 4));
    fns[i].nregs = rb((uint16_t)(off + 6));
    fns[i].nparams = rb((uint16_t)(off + 7));
    fns[i].nups = rb((uint16_t)(off + 8));
    if (fns[i].nregs > MAX_REGS || fns[i].nups > MAX_UPS ||
        fns[i].nparams > MAX_ARGS) {
      fault = 1;
      toy_display_on();
      return;
    }
  }

  /* The constant pool as 32-bit values (names are never values). */
  off = constTabOff;
  for (i = 0; i < nconst; i++) {
    uint8_t t = rb(off);
    if (t == 0) { kvals[i] = ri32((uint16_t)(off + 1)); off = (uint16_t)(off + 5); }
    else if (t == 1) { kvals[i] = rb((uint16_t)(off + 1)); off = (uint16_t)(off + 2); }
    else if (t == 3) { kvals[i] = 0; off = (uint16_t)(off + 1); }
    else if (t == 2) { kvals[i] = 0; off = (uint16_t)(off + 2 + rb((uint16_t)(off + 1))); }
    else { fault = 1; toy_display_on(); return; }
  }

  /* The table section (version 2): every slot's place and shape in the fixed
   * pool.  A slot whose cells end past the pool is a corrupt container, not
   * a toy: stop before anything runs, the way an oversized function does. */
  if (ver == 2) {
    tabOff = rw(20);
    nslots = rb(tabOff);
    if (nslots > MAX_SLOTS) { fault = 1; toy_display_on(); return; }
    for (i = 0; i < nslots; i++) {
      off = (uint16_t)(tabOff + 1 + i * 4);
      slot_base[i] = rw(off);
      slot_cap[i] = rb((uint16_t)(off + 2));
      slot_nfields[i] = rb((uint16_t)(off + 3));
      if ((int32_t)slot_base[i] + slot_cap[i] + slot_nfields[i] >
          MAX_TABLE_CELLS) {
        fault = 1;
        toy_display_on();
        return;
      }
    }
  }

  for (i = 0; i < MAX_GLOBALS; i++) globals[i] = -1;

  /* The chunk is function 0 and is not a closure value (pce-cgen.js calls
   * it directly).  Closure 0 is its identity: upvalue 0 is _ENV. */
  clos[0].fid = 0;
  for (i = 0; i < MAX_UPS; i++) clos[0].up[i] = 0;
  (void)exec(0, 0, 0, 0, 0, 0);

  if (init_slot != 0xFF && globals[init_slot] >= 0 &&
      globals[init_slot] < MAX_CLOS) {
    uint8_t h = (uint8_t)globals[init_slot];
    (void)exec(clos[h].fid, h, 0, 0, 0, 0);
  }

  toy_display_on();
}

int ilvm_has_raster(void) {
  return raster_slot != 0xFF && globals[raster_slot] >= 0 &&
         globals[raster_slot] < MAX_CLOS;
}

void toy_frame(int32_t f) {
  uint8_t h;
  if (fault || frame_slot == 0xFF) return;
  if (globals[frame_slot] < 0) return;
  h = (uint8_t)globals[frame_slot];
  if (h >= MAX_CLOS) { fault = 1; return; }
  (void)exec(clos[h].fid, h, 0, f, 0, 0);
}

void toy_raster(int32_t line) {
  uint8_t h;
  if (fault || raster_slot == 0xFF) return;
  if (globals[raster_slot] < 0) return;
  h = (uint8_t)globals[raster_slot];
  if (h >= MAX_CLOS) { fault = 1; return; }
  (void)exec(clos[h].fid, h, line, 0, 0, 0);
}
