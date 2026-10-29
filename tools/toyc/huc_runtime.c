/*
 * huc_runtime.c — the console side of the IL -> C backend, HuC dialect
 * (#31 part B).
 *
 * The same contract as tools/toyc/toy_runtime.c: set the VDC/VCE to
 * viewer.asm's values, start from zeroed VRAM/CRAM/SAT, run the chunk, then
 * init(), then one frame(f) per VBlank, and bracket frame() and every
 * raster() call with the HuC6280 TMA timer so the capture reports measured
 * cycles, not estimates.
 *
 * What differs is the compiler, and therefore what the C can say:
 *
 *   - HuC's int is 16 bits (defs.h INTSIZE 2); the IL's values that fit are
 *     exact, and renderer/pce-cgen.js refuses nothing about width yet.  The
 *     two toys this part builds keep all values in 0..65535 (docs/IL.md §11).
 *   - HuC's C has no 32-bit type, so the timer sums are carried as two
 *     16-bit halves here and stored bytewise at $2100, where the capture
 *     reads the llvm-mos build's sums as well.
 *   - The IRQ1 handler cannot be C: it must run inside the ~123-cycle
 *     horizontal blank, so it is the hand-written 6502 of huc_raster.asm,
 *     placed in bank 0 (always mapped) and hooked through HuC's own user
 *     IRQ1 vector (irq_m bit 1, $20F5; irq1_jmp, $2202).
 *
 * Build: tools/build-huc.sh turns this file and the generated C into one
 * translation unit (HuC compiles one C file), then assembles it with
 * huc_raster.asm.
 */
/* huc_runtime.h includes huc.h; HuC's huc.h has no include guard, so it is
 * included exactly once from the concatenated translation unit. */
#include "huc_runtime.h"

/* peek()/poke()/pokew() are HuC library functions.  peek takes its address
 * in AX, which is what the compiler emits for an ordinary one-argument call
 * (measured); poke/pokew are the compiler's built-in fastcalls. */

/* ---- I/O ------------------------------------------------------------- */
#define VDC_REG 0x0000
#define VDC_DL  0x0002
#define VDC_DH  0x0003
#define VCE_CTRL 0x0400
#define VCE_ADDR 0x0402        /* colour-table address, low byte ($0403 high) */
#define VCE_DATA 0x0404        /* colour data, low byte ($0405 high) */
#define TIMER_CNT 0x0C00
#define TIMER_CTL 0x0C01

/* The measurement block, the same BaseRAM address the llvm-mos runtime's
 * compiler placed it at; tools/capture-toy.sh reads it from ram.bin. */
#define MEAS 0x2100

#define VDW_LINES 224
#define RCR_BASE 0x40
#define RASTER_COLOURS 2
#define BASE_COLOURS 32
#define BASE_VRAM 32

#define MODE_DIRECT 0
#define MODE_BASE 1
#define MODE_RASTER 2

void huc_irq_install(void);    /* huc_raster.asm: hook IRQ1 to our handler */

/* The tables and flags the IRQ handler reads.  Not static: huc_raster.asm
 * addresses them by symbol (_toy_r_op, ...).  They are ordinary BaseRAM
 * arrays; the handler's absolute,X access may cross a page, which costs one
 * cycle and is not allowed for in the ~123-cycle budget below. */
volatile char toy_r_op[256];
volatile char toy_r_bxr_lo[256];
volatile char toy_r_bxr_hi[256];
volatile char toy_r_byr_lo[256];
volatile char toy_r_byr_hi[256];
volatile char toy_r_cr[256];
volatile char toy_r_a1_lo[256];
volatile char toy_r_a1_hi[256];
volatile char toy_r_v1_lo[256];
volatile char toy_r_v1_hi[256];
volatile char toy_r_a2_lo[256];
volatile char toy_r_a2_hi[256];
volatile char toy_r_v2_lo[256];
volatile char toy_r_v2_hi[256];

volatile char toy_collect_line;
/* Next VDW line the handler serves; an 8-bit VBlank count so the main
 * loop's compare cannot tear against the interrupt's increment. */
volatile char toy_isr_line;
volatile char toy_vblank_count;
volatile int toy_host_mode;

/* The next frame's base, captured while the display runs (part C's rule). */
volatile char toy_pend_op;
volatile char toy_pend_bxr_lo, toy_pend_bxr_hi;
volatile char toy_pend_byr_lo, toy_pend_byr_hi;
volatile char toy_pend_cr;
volatile char toy_pend_npal;
volatile char toy_pend_pal_a_lo[BASE_COLOURS];
volatile char toy_pend_pal_a_hi[BASE_COLOURS];
volatile char toy_pend_pal_w_lo[BASE_COLOURS];
volatile char toy_pend_pal_w_hi[BASE_COLOURS];
volatile char toy_pend_nvram;
volatile char toy_pend_vram_a_lo[BASE_VRAM];
volatile char toy_pend_vram_a_hi[BASE_VRAM];
volatile char toy_pend_vram_w_lo[BASE_VRAM];
volatile char toy_pend_vram_w_hi[BASE_VRAM];

/* ---- measurement ----------------------------------------------------- */
/* Sums are 32-bit, carried as two 16-bit halves (HuC has no 32-bit int). */
static int meas_lo, meas_hi, meas_count, meas_max, meas_min;
static int rmeas_lo, rmeas_hi, rmeas_count, rmeas_max;
static int cmeas_lo, cmeas_hi, cmeas_count;
static int t0;

static void meas_store(int off, int v) {
  poke(MEAS + off, v & 0xFF);
  poke(MEAS + off + 1, (v >> 8) & 0xFF);
}

static void meas_sum_add(int *lo, int *hi, int d) {
  unsigned int u;
  u = (unsigned int)*lo + (unsigned int)d;
  if (u < (unsigned int)d) *hi = *hi + 1;
  *lo = (int)u;
}

static void meas_flush(void) {
  meas_store(0, meas_lo);
  meas_store(2, meas_hi);
  meas_store(4, meas_count);
  poke(MEAS + 6, meas_max);
  poke(MEAS + 7, meas_min);
  meas_store(8, rmeas_lo);
  meas_store(10, rmeas_hi);
  meas_store(12, rmeas_count);
  poke(MEAS + 14, rmeas_max);
  poke(MEAS + 15, 0);              /* flags: not used by part B yet */
  meas_store(16, cmeas_lo);
  meas_store(18, cmeas_hi);
  meas_store(20, cmeas_count);
}

static int timer_read(void) {
  int v;
  v = peek(TIMER_CNT);
  return v & 0x7F;
}

void toy_measure_begin(void) {
  t0 = timer_read();
}

void toy_measure_end(void) {
  int d;
  d = (t0 - timer_read()) & 0x7F;
  meas_sum_add(&meas_lo, &meas_hi, d);
  meas_count = meas_count + 1;
  if (d > meas_max) meas_max = d;
  if (meas_count == 1 || d < meas_min) meas_min = d;
  /* Flushed once a frame by the main loop: ~20 pokes here, once per
   * raster() call, would cost more than the thing being measured. */
}

void toy_measure_raster_begin(void) {
  t0 = timer_read();
}

void toy_measure_raster_end(void) {
  int d;
  d = (t0 - timer_read()) & 0x7F;
  meas_sum_add(&rmeas_lo, &rmeas_hi, d);
  rmeas_count = rmeas_count + 1;
  if (d > rmeas_max) rmeas_max = d;
}

/* ---- the VDC/VCE surface --------------------------------------------- */

static void vdc_w(int reg, int value) {
  poke(VDC_REG, reg);
  pokew(VDC_DL, value);
}

int toy_rgb(int r, int g, int b) {
  return ((g & 7) << 6) | ((r & 7) << 3) | (b & 7);
}

void toy_pal(int addr, int word) {
  if (toy_host_mode == MODE_RASTER) {
    int l, a, w;
    l = toy_collect_line;
    if (!(toy_r_op[l] & 0x08)) {
      a = addr & 0x1FF;
      w = word & 0x1FF;
      toy_r_a1_lo[l] = a & 0xFF;
      toy_r_a1_hi[l] = (a >> 8) & 0xFF;
      toy_r_v1_lo[l] = w & 0xFF;
      toy_r_v1_hi[l] = (w >> 8) & 0xFF;
      toy_r_op[l] = toy_r_op[l] | 0x08;
    } else if (!(toy_r_op[l] & 0x10)) {
      a = addr & 0x1FF;
      w = word & 0x1FF;
      toy_r_a2_lo[l] = a & 0xFF;
      toy_r_a2_hi[l] = (a >> 8) & 0xFF;
      toy_r_v2_lo[l] = w & 0xFF;
      toy_r_v2_hi[l] = (w >> 8) & 0xFF;
      toy_r_op[l] = toy_r_op[l] | 0x10;
    }
    return;
  }
  if (toy_host_mode == MODE_BASE) {
    int n;
    n = toy_pend_npal;
    if (n < BASE_COLOURS) {
      toy_pend_pal_a_lo[n] = addr & 0xFF;
      toy_pend_pal_a_hi[n] = (addr >> 8) & 0xFF;
      toy_pend_pal_w_lo[n] = word & 0xFF;
      toy_pend_pal_w_hi[n] = (word >> 8) & 0xFF;
      toy_pend_npal = n + 1;
    }
    return;
  }
  poke(VCE_ADDR, addr & 0xFF);
  poke(VCE_ADDR + 1, (addr >> 8) & 0x01);
  poke(VCE_DATA, word & 0xFF);
  poke(VCE_DATA + 1, (word >> 8) & 0x01);
}

void toy_reg(int which, int value) {
  int v;
  v = value;
  if (toy_host_mode == MODE_RASTER) {
    int l;
    l = toy_collect_line;
    if (which == TOY_REG_BXR) {
      toy_r_bxr_lo[l] = v & 0xFF;
      toy_r_bxr_hi[l] = (v >> 8) & 0x03;
      toy_r_op[l] = toy_r_op[l] | 0x01;
    } else if (which == TOY_REG_BYR) {
      toy_r_byr_lo[l] = v & 0xFF;
      toy_r_byr_hi[l] = (v >> 8) & 0x01;
      toy_r_op[l] = toy_r_op[l] | 0x02;
    } else {
      toy_r_cr[l] = v & 0xFF;
      toy_r_op[l] = toy_r_op[l] | 0x04;
    }
    return;
  }
  if (toy_host_mode == MODE_BASE) {
    if (which == TOY_REG_BXR) {
      toy_pend_bxr_lo = v & 0xFF;
      toy_pend_bxr_hi = (v >> 8) & 0x03;
      toy_pend_op = toy_pend_op | 0x01;
    } else if (which == TOY_REG_BYR) {
      toy_pend_byr_lo = v & 0xFF;
      toy_pend_byr_hi = (v >> 8) & 0x01;
      toy_pend_op = toy_pend_op | 0x02;
    } else {
      toy_pend_cr = v & 0xFF;
      toy_pend_op = toy_pend_op | 0x04;
    }
    return;
  }
  if (which == TOY_REG_BXR) {
    vdc_w(0x07, v & 0x3FF);
  } else if (which == TOY_REG_BYR) {
    vdc_w(0x08, v & 0x1FF);
  } else {
    vdc_w(0x05, (v & 0xFF) | 0x0C);
  }
}

void toy_vram_set(int addr, int word) {
  if (toy_host_mode == MODE_RASTER) {
    return;                         /* dropped: VRAM is fetched as it draws */
  }
  if (toy_host_mode == MODE_BASE) {
    int n;
    n = toy_pend_nvram;
    if (n < BASE_VRAM) {
      toy_pend_vram_a_lo[n] = addr & 0xFF;
      toy_pend_vram_a_hi[n] = (addr >> 8) & 0xFF;
      toy_pend_vram_w_lo[n] = word & 0xFF;
      toy_pend_vram_w_hi[n] = (word >> 8) & 0xFF;
      toy_pend_nvram = n + 1;
    }
    return;
  }
  vdc_w(0x00, addr & 0x7FFF);
  vdc_w(0x02, word);
}

void toy_display_on(void) {
  vdc_w(0x05, 0x0088);
}

/* ---- the frame flow --------------------------------------------------- */

static void setup(void) {
  int i;
  poke(VCE_CTRL, 0x04);            /* /4 dot clock, 256-dot line */
  /* The browser host starts with zeroed colour and VRAM. */
  pokew(VCE_ADDR, 0);
  for (i = 0; i < 512; i++) {
    pokew(VCE_DATA, 0);
  }
  vdc_w(0x05, 0x0000);
  vdc_w(0x06, 0x0000);
  vdc_w(0x07, 0x0000);
  vdc_w(0x08, 0x0000);
  vdc_w(0x09, 0x0000);             /* MWR 32x32 */
  vdc_w(0x0A, 0x0202);             /* HSR */
  vdc_w(0x0B, 0x041F);             /* HDR */
  vdc_w(0x0C, 0x0F02);             /* VPR */
  vdc_w(0x0D, 0x00EF);             /* VDW: 240 lines */
  vdc_w(0x0E, 0x000C);             /* VCR */
  vdc_w(0x00, 0x0000);             /* MAWR = 0 */
  poke(VDC_REG, 0x02);             /* select VWR for the data port */
  for (i = 0; i < 16384; i++) {    /* 32768 words (signed int is 16-bit) */
    pokew(VDC_DL, 0);
    pokew(VDC_DL, 0);
  }
  vdc_w(0x0F, 0x0010);             /* DCR: bit 4, SATB DMA every VBlank */
  vdc_w(0x13, 0x7F00);             /* DVSSR: the zeroed SAT */
  poke(TIMER_CNT, 0x7F);
  poke(TIMER_CTL, 0x01);           /* free-running, one tick per 1024 clocks */
}

static void wait_vblank(void) {
  int v;
  v = toy_vblank_count;
  while (toy_vblank_count == v) {
  }
}

/* Apply the next frame's base: the register, colour and VRAM writes that
 * frame() made while the previous frame was on screen.  Called in VBlank.
 * Part C needed this for the raster chain; part B needs it for the palette
 * toy as well, because HuC's frame() measures ~94,000 cycles (~0.8 of a
 * video frame) and writes made during the display would be visible as a
 * palette split down the picture (measured: docs/IL.md §11).  The writes
 * themselves are ~15 colour words, well inside the blank. */
static void apply_base(void) {
  int i;
  if (toy_pend_op & 0x01) {
    vdc_w(0x07, ((toy_pend_bxr_hi & 0x03) << 8) | toy_pend_bxr_lo);
  }
  if (toy_pend_op & 0x02) {
    vdc_w(0x08, ((toy_pend_byr_hi & 0x01) << 8) | toy_pend_byr_lo);
  }
  if (toy_pend_op & 0x04) {
    vdc_w(0x05, toy_pend_cr | 0x0C);
  }
  for (i = 0; i < toy_pend_npal; i++) {
    poke(VCE_ADDR, toy_pend_pal_a_lo[i]);
    poke(VCE_ADDR + 1, toy_pend_pal_a_hi[i]);
    poke(VCE_DATA, toy_pend_pal_w_lo[i]);
    poke(VCE_DATA + 1, toy_pend_pal_w_hi[i]);
  }
  for (i = 0; i < toy_pend_nvram; i++) {
    vdc_w(0x00, (toy_pend_vram_a_hi[i] << 8) | toy_pend_vram_a_lo[i]);
    vdc_w(0x02, (toy_pend_vram_w_hi[i] << 8) | toy_pend_vram_w_lo[i]);
  }
  toy_pend_op = 0;
  toy_pend_npal = 0;
  toy_pend_nvram = 0;
}

#ifdef TOY_RASTER_BUILD
/* Line 0 is applied in the VBlank by the main loop: the VDC latches BYR
 * for the first display line at the VDW entry, before the RCR match
 * (part C, docs/IL.md §10.2). */
static void apply_entry0(void) {
  int op;
  op = toy_r_op[0];
  if (op & 0x01) {
    vdc_w(0x07, ((toy_r_bxr_hi[0] & 0x03) << 8) | toy_r_bxr_lo[0]);
  }
  if (op & 0x02) {
    vdc_w(0x08, ((toy_r_byr_hi[0] & 0x01) << 8) | toy_r_byr_lo[0]);
  }
  if (op & 0x04) {
    vdc_w(0x05, toy_r_cr[0] | 0x0C);
  }
  if (op & 0x08) {
    poke(VCE_ADDR, toy_r_a1_lo[0]);
    poke(VCE_ADDR + 1, toy_r_a1_hi[0]);
    poke(VCE_DATA, toy_r_v1_lo[0]);
    poke(VCE_DATA + 1, toy_r_v1_hi[0]);
  }
  if (op & 0x10) {
    poke(VCE_ADDR, toy_r_a2_lo[0]);
    poke(VCE_ADDR + 1, toy_r_a2_hi[0]);
    poke(VCE_DATA, toy_r_v2_lo[0]);
    poke(VCE_DATA + 1, toy_r_v2_hi[0]);
  }
}

static void collect_all(void) {
  int l;
  for (l = 0; l < VDW_LINES; l++) {
    toy_r_op[l] = 0;
    toy_collect_line = l;
    toy_measure_raster_begin();
    toy_raster(l);
    toy_measure_raster_end();
  }
}
#endif /* TOY_RASTER_BUILD */

main(void) {
  int f, v;
  setup();
  huc_irq_install();
  toy_boot();

#ifdef TOY_RASTER_BUILD
  toy_host_mode = MODE_DIRECT;
  vdc_w(0x05, 0x008C);                   /* BB + VC + RC */
  v = toy_vblank_count;
  for (f = 0;; f++) {
    int c0, c1, cd;
    /* ---- compute, with nothing armed: the screen holds the last frame */
    toy_pend_op = 0;
    toy_pend_npal = 0;
    toy_pend_nvram = 0;
    toy_host_mode = MODE_BASE;
    toy_measure_begin();
    toy_frame(f);
    toy_measure_end();
    toy_host_mode = MODE_RASTER;
    c0 = timer_read();
    collect_all();
    c1 = timer_read();
    toy_host_mode = MODE_DIRECT;
    cd = (c0 - c1) & 0x7F;
    meas_sum_add(&cmeas_lo, &cmeas_hi, cd);
    cmeas_count = cmeas_count + 1;
    meas_flush();
    /* ---- apply the base and line 0 while nothing is armed */
    apply_base();
    apply_entry0();
    /* ---- the next VBlank arms the chain */
    wait_vblank();
    toy_isr_line = 1;
    vdc_w(0x06, RCR_BASE + 1);
    /* ---- wait out the display frame before touching the table */
    wait_vblank();
  }
#else
  /* Part A's flow, with part C's capture: frame() runs while the display
   * shows the last frame, its writes are held, and the VBlank applies them.
   * A direct frame() is too slow under HuC (94,000 cycles, ~0.8 frame), so
   * its palette writes would split the picture it is drawn into. */
  f = 0;
  for (;;) {
    toy_pend_op = 0;
    toy_pend_npal = 0;
    toy_pend_nvram = 0;
    toy_host_mode = MODE_BASE;
    toy_measure_begin();
    toy_frame(f);
    toy_measure_end();
    meas_flush();
    toy_host_mode = MODE_DIRECT;
    wait_vblank();
    apply_base();
    f = f + 1;
  }
#endif
}
