/*
 * toy_runtime.c — the console side of the IL → C backend (#31 parts A, C).
 *
 * The video setup is tools/viewer.asm's, the sequence the Mednafen captures
 * of every picture in this repo are proven against:
 *
 *   VCE CR $04            /4 dot clock, a 256-dot line (H6-3)
 *   VDC HSR $0202         HDS=2, HSW=2
 *   VDC HDR $041F         HDW=31 -> 32 characters = 256 px (H7-9)
 *   VDC VPR $0F02         VDS=15, VSW=2: VDW line 0 is VCE line 17
 *   VDC VDW $00EF         240 display lines (H7-10)
 *   VDC VCR $000C
 *   VDC MWR $0000         32x32 BAT cells
 *   VDC CR  $0080         background on (BB)
 *
 * The toy's own state starts zeroed, exactly like renderer/pce-toyhost.js's
 * (VRAM 32768 words, CRAM 512 entries, SAT zero), so a capture's VRAM/CRAM/
 * SAT are byte-equal to the browser runtime's.  At the end the runtime loads
 * the zeroed SAT into SATB through the VDC's auto-repeat DMA (viewer.asm's
 * DCR bit 4 + DVSSR = $7F00) so the sprite state is the same too.
 *
 * Frame flow without raster() (part A): run the chunk, run init(), turn the
 * display on, then for each VBlank run one frame(t=0, f).
 *
 * Frame flow with raster() (part C): the browser calls frame(f) once per
 * frame and then raster(line) for lines 0..223, in that order.  A callback
 * written during a display line would be late: the write must land in the
 * horizontal blank (~100 CPU cycles, viewer.asm / docs/IL.md §10).  The
 * compiled handler measured ~200 cycles before its first write (§10), so
 * this runtime does what #16's viewer does: the toy's raster() calls run a
 * frame EARLY, in the idle time of the previous display, and their writes
 * are recorded into a per-line table that a small hand-written IRQ handler
 * replays at each line.  Concretely, during display f the main loop runs
 * frame(f+1) (its register/colour/VRAM writes captured, not applied) and
 * then raster(0..223) for f+1, overwriting table entry L only after line L
 * has been served; the VBlank after display f applies frame(f+1)'s base and
 * arms the chain.  The picture sequence is the browser's.
 *
 * The TMA timer (huc6280.cpp TimerRead: timer_value, one decrement per 1024
 * CPU clocks) brackets frame() and each raster() call.  The sums (u32), the
 * counts (u16), the maxima and the overflow flags live at BaseRAM $2100,
 * above the linker's RAM (the SDK's RAM section starts at $2200 and the
 * stack at $4000), so mcs-extract's ram.bin carries them at offset $100.
 */
#include <pce.h>

#include "toy_runtime.h"

extern void toy_boot(void);
extern void toy_frame(int32_t f);
#ifdef TOY_RASTER_BUILD
/* Defined by the generated C only when the toy has a raster() callback. */
extern void toy_raster(int32_t line) __attribute__((weak));
#endif

#define VDW_LINES 224          /* the toy's frame (pce-toyhost.js HEIGHT) */
#define RCR_BASE 0x40          /* RCR R06 = 0x40 + VDW line (#15) */
#define RASTER_COLOURS 2       /* colour writes one line may carry */
#define BASE_COLOURS 32        /* colour writes one frame() may carry */
#define BASE_VRAM 32           /* VRAM writes one frame() may carry */

#define MEAS ((volatile uint8_t *)0x2100)
#define MEAS_SUM 0             /* u32 sum of per-frame tick deltas */
#define MEAS_COUNT 4           /* u16 frames measured */
#define MEAS_MAX 6             /* u8 largest frame delta */
#define MEAS_MIN 7             /* u8 smallest frame delta */
#define MEAS_RSUM 8            /* u32 sum of per-raster-call deltas */
#define MEAS_RCOUNT 12         /* u16 raster calls measured */
#define MEAS_RMAX 14           /* u8 largest per-call delta */
#define MEAS_FLAGS 15          /* bit0/1: base colour/VRAM list overflow;
                                * bit2: a vset from a raster callback */
#define MEAS_CSUM 16           /* u32 sum of whole-collection deltas */
#define MEAS_CCOUNT 20         /* u16 collections measured */

/* Which surface the toy's writes go to.
 *   0  the hardware (init, boot frame(0), non-raster toys)
 *   1  frame() during a display: capture into the next frame's base
 *   2  raster() during a display: capture into the line's table entry */
#define MODE_DIRECT 0
#define MODE_BASE 1
#define MODE_RASTER 2

#ifdef TOY_RASTER_BUILD
volatile uint8_t toy_host_mode;

/* The line table: 14 page-aligned arrays indexed by VDW line, so the IRQ
 * handler's `lda array,x` never crosses a page (viewer.asm's reason). */
volatile uint8_t toy_r_op[256] __attribute__((aligned(256)));
volatile uint8_t toy_r_bxr_lo[256] __attribute__((aligned(256)));
volatile uint8_t toy_r_bxr_hi[256] __attribute__((aligned(256)));
volatile uint8_t toy_r_byr_lo[256] __attribute__((aligned(256)));
volatile uint8_t toy_r_byr_hi[256] __attribute__((aligned(256)));
volatile uint8_t toy_r_cr[256] __attribute__((aligned(256)));
volatile uint8_t toy_r_a1_lo[256] __attribute__((aligned(256)));
volatile uint8_t toy_r_a1_hi[256] __attribute__((aligned(256)));
volatile uint8_t toy_r_v1_lo[256] __attribute__((aligned(256)));
volatile uint8_t toy_r_v1_hi[256] __attribute__((aligned(256)));
volatile uint8_t toy_r_a2_lo[256] __attribute__((aligned(256)));
volatile uint8_t toy_r_a2_hi[256] __attribute__((aligned(256)));
volatile uint8_t toy_r_v2_lo[256] __attribute__((aligned(256)));
volatile uint8_t toy_r_v2_hi[256] __attribute__((aligned(256)));

volatile uint8_t toy_collect_line;

/* The IRQ handler's state (read and written by the asm below). */
volatile uint8_t toy_isr_line;    /* next VDW line to serve, 0..224 */
/* VBlanks seen: an 8-bit count so the main loop's read cannot tear
 * against the interrupt's increment (a 16-bit counter did, measured: a
 * skipped wait armed the chain mid-frame and mixed two collections). */
volatile uint8_t toy_vblank_count;

/* The next frame's base: what frame() wrote while the display was running. */
volatile uint8_t toy_pend_op;     /* bit0 BXR, bit1 BYR, bit2 CR */
volatile uint8_t toy_pend_bxr_lo, toy_pend_bxr_hi;
volatile uint8_t toy_pend_byr_lo, toy_pend_byr_hi;
volatile uint8_t toy_pend_cr;
volatile uint8_t toy_pend_npal;
volatile uint8_t toy_pend_pal_a_lo[BASE_COLOURS];
volatile uint8_t toy_pend_pal_a_hi[BASE_COLOURS];
volatile uint8_t toy_pend_pal_w_lo[BASE_COLOURS];
volatile uint8_t toy_pend_pal_w_hi[BASE_COLOURS];
volatile uint8_t toy_pend_nvram;
volatile uint8_t toy_pend_vram_a_lo[BASE_VRAM];
volatile uint8_t toy_pend_vram_a_hi[BASE_VRAM];
volatile uint8_t toy_pend_vram_w_lo[BASE_VRAM];
volatile uint8_t toy_pend_vram_w_hi[BASE_VRAM];
#endif /* TOY_RASTER_BUILD */

static void vdc_write(uint8_t reg, uint16_t value) {
  *IO_VDC_INDEX = reg;
  *IO_VDC_DATA_LO = (uint8_t)value;
  *IO_VDC_DATA_HI = (uint8_t)(value >> 8);
}

#ifdef TOY_RASTER_BUILD
static void measure_flag(uint8_t bit) {
  MEAS[MEAS_FLAGS] = (uint8_t)(MEAS[MEAS_FLAGS] | bit);
}
#endif

void toy_pal(int32_t addr, int32_t word) {
#ifdef TOY_RASTER_BUILD
  uint16_t a = (uint16_t)addr & 0x1FF;
  uint16_t w = (uint16_t)word & 0x1FF;
  if (toy_host_mode == MODE_RASTER) {
    /* The line's entry: two colour words, then the op bit.  Writing op last
     * means a (hypothetical) re-read never sees half an entry. */
    uint8_t l = toy_collect_line;
    if (!(toy_r_op[l] & 0x08)) {
      toy_r_a1_lo[l] = (uint8_t)a;
      toy_r_a1_hi[l] = (uint8_t)(a >> 8);
      toy_r_v1_lo[l] = (uint8_t)w;
      toy_r_v1_hi[l] = (uint8_t)(w >> 8);
      toy_r_op[l] = (uint8_t)(toy_r_op[l] | 0x08);
    } else if (!(toy_r_op[l] & 0x10)) {
      toy_r_a2_lo[l] = (uint8_t)a;
      toy_r_a2_hi[l] = (uint8_t)(a >> 8);
      toy_r_v2_lo[l] = (uint8_t)w;
      toy_r_v2_hi[l] = (uint8_t)(w >> 8);
      toy_r_op[l] = (uint8_t)(toy_r_op[l] | 0x10);
    } else {
      measure_flag(0x02);          /* more colour writes than a line carries */
    }
    return;
  }
  if (toy_host_mode == MODE_BASE) {
    uint8_t n = toy_pend_npal;
    if (n < BASE_COLOURS) {
      toy_pend_pal_a_lo[n] = (uint8_t)a;
      toy_pend_pal_a_hi[n] = (uint8_t)(a >> 8);
      toy_pend_pal_w_lo[n] = (uint8_t)w;
      toy_pend_pal_w_hi[n] = (uint8_t)(w >> 8);
      toy_pend_npal = (uint8_t)(n + 1);
    } else {
      measure_flag(0x01);
    }
    return;
  }
  /* The VCE's CTA is 9 bits and auto-increments after each data write. */
  *IO_VCE_COLOR_INDEX = a;
  *IO_VCE_COLOR_DATA = w;
#else
  /* Part A's body, unchanged: its palette ROM is a committed image. */
  *IO_VCE_COLOR_INDEX = (uint16_t)addr;
  *IO_VCE_COLOR_DATA = (uint16_t)word;
#endif
}

void toy_reg(int32_t which, int32_t value) {
  uint16_t v = (uint16_t)value;
#ifdef TOY_RASTER_BUILD
  if (toy_host_mode == MODE_RASTER) {
    uint8_t l = toy_collect_line;
    if (which == TOY_REG_BXR) {
      toy_r_bxr_lo[l] = (uint8_t)v;
      toy_r_bxr_hi[l] = (uint8_t)((v >> 8) & 0x03);
      toy_r_op[l] = (uint8_t)(toy_r_op[l] | 0x01);
    } else if (which == TOY_REG_BYR) {
      toy_r_byr_lo[l] = (uint8_t)v;
      toy_r_byr_hi[l] = (uint8_t)((v >> 8) & 0x01);
      toy_r_op[l] = (uint8_t)(toy_r_op[l] | 0x02);
    } else {
      toy_r_cr[l] = (uint8_t)v;
      toy_r_op[l] = (uint8_t)(toy_r_op[l] | 0x04);
    }
    return;
  }
  if (toy_host_mode == MODE_BASE) {
    if (which == TOY_REG_BXR) {
      toy_pend_bxr_lo = (uint8_t)v;
      toy_pend_bxr_hi = (uint8_t)((v >> 8) & 0x03);
      toy_pend_op = (uint8_t)(toy_pend_op | 0x01);
    } else if (which == TOY_REG_BYR) {
      toy_pend_byr_lo = (uint8_t)v;
      toy_pend_byr_hi = (uint8_t)((v >> 8) & 0x01);
      toy_pend_op = (uint8_t)(toy_pend_op | 0x02);
    } else {
      toy_pend_cr = (uint8_t)v;
      toy_pend_op = (uint8_t)(toy_pend_op | 0x04);
    }
    return;
  }
#endif
  if (which == TOY_REG_BXR) {
    vdc_write(0x07, (uint16_t)(v & 0x3FF));
  } else if (which == TOY_REG_BYR) {
    vdc_write(0x08, (uint16_t)(v & 0x1FF));
  } else {
    /* The console needs two CR bits the browser model does not carry: VC
     * (bit 3) for the VBlank status flag the frame flow waits on, and RC
     * (bit 2) for the RCR line interrupt the raster chain runs on.  Neither
     * changes the picture; the state comparison masks them (§10). */
    vdc_write(0x05, (uint16_t)(((v & 0xFF) | 0x0C)));
  }
}

void toy_vram_set(int32_t addr, int32_t word) {
#ifdef TOY_RASTER_BUILD
  uint16_t a = (uint16_t)addr & 0x7FFF;
  uint16_t w = (uint16_t)word;
  if (toy_host_mode == MODE_RASTER) {
    /* VRAM is fetched as the line draws; a write from a raster callback
     * cannot be replayed at a line boundary by this backend.  Flag it and
     * drop it rather than corrupt the frame being displayed: the capture's
     * flags say the run is not comparable. */
    measure_flag(0x04);
    return;
  }
  if (toy_host_mode == MODE_BASE) {
    uint8_t n = toy_pend_nvram;
    if (n < BASE_VRAM) {
      toy_pend_vram_a_lo[n] = (uint8_t)a;
      toy_pend_vram_a_hi[n] = (uint8_t)(a >> 8);
      toy_pend_vram_w_lo[n] = (uint8_t)w;
      toy_pend_vram_w_hi[n] = (uint8_t)(w >> 8);
      toy_pend_nvram = (uint8_t)(n + 1);
    } else {
      measure_flag(0x01);
    }
    return;
  }
  /* Set MAWR, then select the VRAM data register (R02, VWR) before the word:
   * after a register write the VDC's select latch still holds that register,
   * so a data-port write without selecting R02 would land back in MAWR.
   * viewer.asm's copy_words does exactly this (st0 #$00/st1/st2, st0 #$02). */
  vdc_write(0x00, a);
  vdc_write(0x02, w);
#else
  /* Part A's body, unchanged: its palette ROM is a committed image. */
  vdc_write(0x00, (uint16_t)addr);
  vdc_write(0x02, (uint16_t)word);
#endif
}

void toy_wait_vblank(void) {
  /* Reading the status register acknowledges the flags.  The VDC only sets
   * the VBlank status bit when CR bit 3 (the VBlank IRQ enable) is set —
   * Mednafen's DoVBIRQTest tests CR & 0x08 — so toy_display_on sets it.  It
   * does not change the picture (pce-bg.js does not model it); the state
   * comparison masks it off and says why. */
  while (!(*IO_VDC_STATUS & VDC_FLAG_VBLANK)) {
  }
}

void toy_display_on(void) {
  /* CR = BB (background on) + the VBlank status bit. */
  vdc_write(0x05, 0x0088);
}

static uint8_t measure_t0;

void toy_measure_begin(void) {
  measure_t0 = (uint8_t)(*IO_TIMER_COUNTER & 0x7F);
}

void toy_measure_end(void) {
  uint8_t t1 = (uint8_t)(*IO_TIMER_COUNTER & 0x7F);
  uint8_t d = (uint8_t)((measure_t0 - t1) & 0x7F);
  uint16_t count = (uint16_t)(MEAS[MEAS_COUNT] | (MEAS[MEAS_COUNT + 1] << 8));
  uint32_t sum = (uint32_t)MEAS[MEAS_SUM] |
                 ((uint32_t)MEAS[MEAS_SUM + 1] << 8) |
                 ((uint32_t)MEAS[MEAS_SUM + 2] << 16) |
                 ((uint32_t)MEAS[MEAS_SUM + 3] << 24);
  sum += d;
  count++;
  MEAS[MEAS_SUM] = (uint8_t)sum;
  MEAS[MEAS_SUM + 1] = (uint8_t)(sum >> 8);
  MEAS[MEAS_SUM + 2] = (uint8_t)(sum >> 16);
  MEAS[MEAS_SUM + 3] = (uint8_t)(sum >> 24);
  MEAS[MEAS_COUNT] = (uint8_t)count;
  MEAS[MEAS_COUNT + 1] = (uint8_t)(count >> 8);
  if (d > MEAS[MEAS_MAX]) MEAS[MEAS_MAX] = d;
  if (count == 1 || d < MEAS[MEAS_MIN]) MEAS[MEAS_MIN] = d;
}

#ifdef TOY_RASTER_BUILD
static uint8_t raster_t0;

void toy_measure_raster_begin(void) {
  raster_t0 = (uint8_t)(*IO_TIMER_COUNTER & 0x7F);
}

void toy_measure_raster_end(void) {
  uint8_t t1 = (uint8_t)(*IO_TIMER_COUNTER & 0x7F);
  uint8_t d = (uint8_t)((raster_t0 - t1) & 0x7F);
  uint16_t count = (uint16_t)(MEAS[MEAS_RCOUNT] |
                              (MEAS[MEAS_RCOUNT + 1] << 8));
  uint32_t sum = (uint32_t)MEAS[MEAS_RSUM] |
                 ((uint32_t)MEAS[MEAS_RSUM + 1] << 8) |
                 ((uint32_t)MEAS[MEAS_RSUM + 2] << 16) |
                 ((uint32_t)MEAS[MEAS_RSUM + 3] << 24);
  sum += d;
  count++;
  MEAS[MEAS_RSUM] = (uint8_t)sum;
  MEAS[MEAS_RSUM + 1] = (uint8_t)(sum >> 8);
  MEAS[MEAS_RSUM + 2] = (uint8_t)(sum >> 16);
  MEAS[MEAS_RSUM + 3] = (uint8_t)(sum >> 24);
  MEAS[MEAS_RCOUNT] = (uint8_t)count;
  MEAS[MEAS_RCOUNT + 1] = (uint8_t)(count >> 8);
  if (d > MEAS[MEAS_RMAX]) MEAS[MEAS_RMAX] = d;
}
#endif /* TOY_RASTER_BUILD */

#ifdef TOY_RASTER_BUILD
/* ---- the RCR chain ---------------------------------------------------
 *
 * The compiled raster() handler cannot run in the interrupt: measured from
 * the linked code, its entry to first write is far past the ~100-cycle
 * horizontal blank (docs/IL.md §10).  This handler is the #16 viewer's
 * answer: a handful of loads and stores per line, from a table the toy's
 * callbacks filled before the frame.  It uses A/X/Y only and calls no C, so
 * the C main loop's soft registers (the mos ABI's zero-page file) survive
 * untouched; A/X/Y are saved because that loop is live between lines.
 *
 * The table's op byte: bit 0 BXR, bit 1 BYR, bit 2 CR, bit 3 first colour
 * word, bit 4 second colour word.  Colour words are written first because
 * their four-store chain is the longest one the line's first pixel can
 * catch.  RCR is re-armed last: it only has to land before the next match,
 * a full line away.  The RCR is nine bits: 0x40 + 192 carries into bit 8,
 * and zeroing the high byte (measured) ends the chain at line 191.
 *
 * VBlank needs nothing from the interrupt: it increments the counter the
 * main loop schedules on.  The base frame() captured and the table are
 * applied by the main loop in the VBlank before the display is armed.
 */
__asm__(
".text\n"
".global irq_vdc\n"
".type irq_vdc,@function\n"
"irq_vdc:\n"
"  pha\n"
"  phx\n"
"  phy\n"
"  lda $0000\n"                 /* VDC status: also acknowledges */
"  and #$20\n"                 /* VD, the VBlank flag */
"  beq irq_scan\n"
"  jmp irq_vbl_near\n"
"irq_scan:\n"
"  ldx toy_isr_line\n"
"  cpx #224\n"
"  bcc irq_scan_go\n"
"  jmp irq_scan_done\n"
"irq_scan_go:\n"
"  lda toy_r_op,x\n"           /* BXR first: it is the write whose */
"  and #$01\n"                 /* latch line is closest, and the scroll */
"  beq irq_no_bxr\n"           /* registers are the common raster write */
"  st0 #7\n"
"  lda toy_r_bxr_lo,x\n"
"  sta $0002\n"
"  lda toy_r_bxr_hi,x\n"
"  sta $0003\n"
"irq_no_bxr:\n"
"  lda toy_r_op,x\n"           /* BYR */
"  and #$02\n"
"  beq irq_no_byr\n"
"  st0 #8\n"
"  lda toy_r_byr_lo,x\n"
"  sta $0002\n"
"  lda toy_r_byr_hi,x\n"
"  sta $0003\n"
"irq_no_byr:\n"
"  lda toy_r_op,x\n"           /* CR */
"  and #$04\n"
"  beq irq_no_cr\n"
"  st0 #5\n"
"  lda toy_r_cr,x\n"
"  ora #$0C\n"                 /* VC + RC, as the direct path */
"  sta $0002\n"
"  stz $0003\n"
"irq_no_cr:\n"
"  lda toy_r_op,x\n"           /* first colour word */
"  and #$08\n"
"  beq irq_no_c1\n"
"  lda toy_r_a1_lo,x\n"
"  sta $0402\n"
"  lda toy_r_a1_hi,x\n"
"  sta $0403\n"
"  lda toy_r_v1_lo,x\n"
"  sta $0404\n"
"  lda toy_r_v1_hi,x\n"
"  sta $0405\n"
"irq_no_c1:\n"
"  lda toy_r_op,x\n"           /* second colour word */
"  and #$10\n"
"  beq irq_no_c2\n"
"  lda toy_r_a2_lo,x\n"
"  sta $0402\n"
"  lda toy_r_a2_hi,x\n"
"  sta $0403\n"
"  lda toy_r_v2_lo,x\n"
"  sta $0404\n"
"  lda toy_r_v2_hi,x\n"
"  sta $0405\n"
"irq_no_c2:\n"
"  inx\n"
"  stx toy_isr_line\n"
"  cpx #224\n"
"  bcs irq_scan_done\n"
"  st0 #6\n"
"  txa\n"
"  clc\n"
"  adc #$40\n"                 /* 0x40 + 192 carries into bit 8 */
"  sta $0002\n"
"  lda #$00\n"
"  adc #$00\n"
"  sta $0003\n"
"irq_scan_done:\n"
"  ply\n"
"  plx\n"
"  pla\n"
"  rti\n"
"irq_vbl_near:\n"
"  inc toy_vblank_count\n"
"irq_vbl_done:\n"
"  ply\n"
"  plx\n"
"  pla\n"
"  rti\n"
);

/* Apply the next frame's base: the register, colour and VRAM writes that
 * frame() made while the previous frame was on screen.  Called in VBlank,
 * before the chain is armed. */
static void apply_base(void) {
  uint8_t i;
  if (toy_pend_op & 0x01) {
    vdc_write(0x07, (uint16_t)(((uint16_t)toy_pend_bxr_hi << 8) |
                               toy_pend_bxr_lo));
  }
  if (toy_pend_op & 0x02) {
    vdc_write(0x08, (uint16_t)(((uint16_t)toy_pend_byr_hi << 8) |
                               toy_pend_byr_lo));
  }
  if (toy_pend_op & 0x04) {
    vdc_write(0x05, (uint16_t)(toy_pend_cr | 0x0C));
  }
  for (i = 0; i < toy_pend_npal; i++) {
    *IO_VCE_COLOR_INDEX = (uint16_t)(((uint16_t)toy_pend_pal_a_hi[i] << 8) |
                                     toy_pend_pal_a_lo[i]);
    *IO_VCE_COLOR_DATA = (uint16_t)(((uint16_t)toy_pend_pal_w_hi[i] << 8) |
                                    toy_pend_pal_w_lo[i]);
  }
  for (i = 0; i < toy_pend_nvram; i++) {
    vdc_write(0x00, (uint16_t)(((uint16_t)toy_pend_vram_a_hi[i] << 8) |
                               toy_pend_vram_a_lo[i]));
    vdc_write(0x02, (uint16_t)(((uint16_t)toy_pend_vram_w_hi[i] << 8) |
                               toy_pend_vram_w_lo[i]));
  }
  toy_pend_op = 0;
  toy_pend_npal = 0;
  toy_pend_nvram = 0;
}

/* Line 0's entry cannot come from the RCR chain: the VDC latches BYR for the
 * first display line at the VDW entry, before the RCR=0x40 match, so a write
 * in that interrupt is one line late (pce-bg.js's model comment; measured on
 * status-bar.lua, whose bar needs BYR=0 at line 0).  The main loop applies
 * entry 0 in the VBlank, while the display is still blank, and the chain
 * starts at line 1. */
static void apply_entry0(void) {
  uint8_t op = toy_r_op[0];
  if (op & 0x01) {
    vdc_write(0x07, (uint16_t)(((uint16_t)toy_r_bxr_hi[0] << 8) |
                               toy_r_bxr_lo[0]));
  }
  if (op & 0x02) {
    vdc_write(0x08, (uint16_t)(((uint16_t)toy_r_byr_hi[0] << 8) |
                               toy_r_byr_lo[0]));
  }
  if (op & 0x04) {
    vdc_write(0x05, (uint16_t)(toy_r_cr[0] | 0x0C));
  }
  if (op & 0x08) {
    *IO_VCE_COLOR_INDEX = (uint16_t)(((uint16_t)toy_r_a1_hi[0] << 8) |
                                     toy_r_a1_lo[0]);
    *IO_VCE_COLOR_DATA = (uint16_t)(((uint16_t)toy_r_v1_hi[0] << 8) |
                                    toy_r_v1_lo[0]);
  }
  if (op & 0x10) {
    *IO_VCE_COLOR_INDEX = (uint16_t)(((uint16_t)toy_r_a2_hi[0] << 8) |
                                     toy_r_a2_lo[0]);
    *IO_VCE_COLOR_DATA = (uint16_t)(((uint16_t)toy_r_v2_hi[0] << 8) |
                                    toy_r_v2_lo[0]);
  }
}

/* One frame's raster(0..223), back to back.  The display is not armed while
 * this runs, so the video keeps the previous frame's last values; the
 * collection is the toy's own cost and the timer sum is the measurement. */
static void collect_all(void) {
  int32_t l;
  for (l = 0; l < VDW_LINES; l++) {
    toy_r_op[l] = 0;
    toy_collect_line = (uint8_t)l;
    toy_measure_raster_begin();
    toy_raster(l);
    toy_measure_raster_end();
  }
}
#endif /* TOY_RASTER_BUILD */

int main(void) {
  uint16_t i;

  /* VCE: /4 dot clock; the browser toy model's default clock. */
  *IO_VCE_CONTROL = 0x04;

  /* The browser host starts with a zeroed colour table. */
  *IO_VCE_COLOR_INDEX = 0;
  for (i = 0; i < 512; i++) {
    *IO_VCE_COLOR_DATA = 0;
  }

  /* The VDC registers, display off while the data goes in. */
  vdc_write(0x05, 0x0000);            /* CR */
  vdc_write(0x06, 0x0000);            /* RCR */
  vdc_write(0x07, 0x0000);            /* BXR */
  vdc_write(0x08, 0x0000);            /* BYR */
  vdc_write(0x09, 0x0000);            /* MWR: 32x32 */
  vdc_write(0x0A, 0x0202);            /* HSR */
  vdc_write(0x0B, 0x041F);            /* HDR */
  vdc_write(0x0C, 0x0F02);            /* VPR */
  vdc_write(0x0D, 0x00EF);            /* VDW: 240 lines */
  vdc_write(0x0E, 0x000C);            /* VCR */

  /* The browser host starts with a zeroed VRAM. */
  vdc_write(0x00, 0x0000);            /* MAWR = 0 */
  *IO_VDC_INDEX = 0x02;               /* select R02 (VWR) for the data port */
  for (i = 0; i < 32768; i++) {
    *IO_VDC_DATA_LO = 0;
    *IO_VDC_DATA_HI = 0;
  }

  /* Load the zeroed SAT ($7F00) into SATB every VBlank. */
  vdc_write(0x0F, 0x0010);            /* DCR: bit 4, DSR */
  vdc_write(0x13, 0x7F00);            /* DVSSR: 256 words from $7F00 */

  /* The TMA timer: free-running, one tick per 1024 CPU clocks. */
  *IO_TIMER_COUNTER = 0x7F;
  *IO_TIMER_CONTROL = TIMER_ON;

  toy_boot();

#ifdef TOY_RASTER_BUILD
  if (toy_raster == 0) {
#endif
    /* Part A: no raster() callback.  One frame() per VBlank, direct. */
    {
    int32_t f;
    for (f = 0;; f++) {
      toy_wait_vblank();
      toy_measure_begin();
      toy_frame(f);
      toy_measure_end();
    }
    }
#ifdef TOY_RASTER_BUILD
  } else {
    /* Part C, paced by VBlanks: frame(f) and its 224 raster() calls run
     * into the table while nothing is armed (the screen holds the previous
     * picture), then the base and line 0 are written, the next VBlank arms
     * the chain, and one video frame replays the table line by line.  The
     * toy's own raster work measures ~1,500 cycles a call for parallax.lua
     * (≈340,000 a frame, 2.8 video frames), so one toy frame takes four to
     * five video frames: ~12–15 Hz.  The picture sequence is the browser's;
     * only the rate differs (docs/IL.md §10). */
    int32_t f;
    uint8_t v;
    toy_host_mode = MODE_DIRECT;
    vdc_write(0x05, 0x008C);          /* BB + VC + RC */
    pce_irq_enable(IRQ_VDC);
    pce_cpu_irq_enable();
    v = toy_vblank_count;

    for (f = 0;; f++) {
      uint8_t c0, c1, cd;
      uint32_t csum;
      uint16_t ccount;

      /* ---- compute: the display is idle (nothing armed) ---- */
      toy_pend_op = 0;
      toy_pend_npal = 0;
      toy_pend_nvram = 0;
      toy_host_mode = MODE_BASE;
      toy_measure_begin();
      toy_frame(f);
      toy_measure_end();

      toy_host_mode = MODE_RASTER;
      c0 = (uint8_t)(*IO_TIMER_COUNTER & 0x7F);
      collect_all();
      c1 = (uint8_t)(*IO_TIMER_COUNTER & 0x7F);
      toy_host_mode = MODE_DIRECT;

      cd = (uint8_t)((c0 - c1) & 0x7F);
      ccount = (uint16_t)(MEAS[MEAS_CCOUNT] | (MEAS[MEAS_CCOUNT + 1] << 8));
      csum = (uint32_t)MEAS[MEAS_CSUM] |
             ((uint32_t)MEAS[MEAS_CSUM + 1] << 8) |
             ((uint32_t)MEAS[MEAS_CSUM + 2] << 16) |
             ((uint32_t)MEAS[MEAS_CSUM + 3] << 24);
      csum += cd;
      ccount++;
      MEAS[MEAS_CSUM] = (uint8_t)csum;
      MEAS[MEAS_CSUM + 1] = (uint8_t)(csum >> 8);
      MEAS[MEAS_CSUM + 2] = (uint8_t)(csum >> 16);
      MEAS[MEAS_CSUM + 3] = (uint8_t)(csum >> 24);
      MEAS[MEAS_CCOUNT] = (uint8_t)ccount;
      MEAS[MEAS_CCOUNT + 1] = (uint8_t)(ccount >> 8);

      /* ---- apply the base and line 0 now, while nothing is armed ----
       * The VDC latches BYR for the first display line at (or before) the
       * VDW entry; a write in the VBlank interrupt measured too late for
       * status-bar.lua's bar, so the values are in the registers well
       * before VBlank.  The video frame being computed stays static (the
       * chain is disarmed); this is the frame the comparison ignores. */
      apply_base();
      apply_entry0();

      /* ---- the next VBlank arms the chain ---- */
      v = toy_vblank_count;
      while (toy_vblank_count == v) {
      }
      toy_isr_line = 1;
      vdc_write(0x06, (uint16_t)(RCR_BASE + 1));

      /* ---- wait out the display frame before touching the table ------
       * The chain reads entry L at line L, so the main loop must not start
       * the next 224 calls while it runs: a collection slower than the chain
       * would still win the race at a jittered entry, and the measured
       * symptom was one video frame in ~10 with band 0 from the next frame
       * and the other bands from the last. */
      v = toy_vblank_count;
      while (toy_vblank_count == v) {
      }
    }
  }
#endif
}
