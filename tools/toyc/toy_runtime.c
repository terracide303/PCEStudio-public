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
 * frame(f+1) (its register/colour writes captured, not applied) and
 * then raster(0..223) for f+1, overwriting table entry L only after line L
 * has been served; the VBlank after display f applies frame(f+1)'s base and
 * arms the chain.  frame()'s VRAM writes apply directly as they run: the
 * display is idle (nothing armed) while frame() executes, and one build
 * frame writes more VRAM words (DUSK RUN's step 7: 208) than any capture
 * list that fits in RAM, so there is no VRAM capture.  The picture
 * sequence is the browser's.
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
/* Defined by the generated C only when the toy has a raster() callback.  A toy
 * that registers its lines with raster(line, spec) from frame() (TOY_RASTER_TABLE)
 * has no callback: the entries are in the table when frame() returns. */
#ifndef TOY_RASTER_TABLE
extern void toy_raster(int32_t line) __attribute__((weak));
#endif
#endif

#define VDW_LINES 224          /* the toy's frame (pce-toyhost.js HEIGHT) */
#define RCR_BASE 0x40          /* RCR R06 = 0x40 + VDW line (#15) */
#define XSTR_(x) #x
#define STR(x) XSTR_(x)
#define RASTER_COLOURS 2       /* colour writes one line may carry */
#define BASE_COLOURS 32        /* colour writes one frame() may carry */

#define MEAS ((volatile uint8_t *)0x2100)
#define MEAS_SUM 0             /* u32 sum of per-frame tick deltas */
#define MEAS_COUNT 4           /* u16 frames measured */
#define MEAS_MAX 6             /* u8 largest frame delta */
#define MEAS_MIN 7             /* u8 smallest frame delta */
#define MEAS_RSUM 8            /* u32 sum of per-raster-call deltas */
#define MEAS_RCOUNT 12         /* u16 raster calls measured */
#define MEAS_RMAX 14           /* u8 largest per-call delta */
#define MEAS_FLAGS 15          /* bit0: base colour list overflow;
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

/* ---- raster runtime v2 (docs/NATIVE.md) ------------------------------------------------------
 * Two buffers of effect data.  The game computes into the PENDING one while the line-interrupt
 * chain replays the ACTIVE one, on EVERY video frame; a finished game frame is published at a
 * VBlank, where the handler swaps them.  Before this the chain was disarmed while the game
 * computed, and those video frames showed the last line's scroll and backdrop for the whole screen
 * (STARFALL: two frames in three were wrong).
 *
 * A buffer is a header (the base values frame() wrote outside raster(): BXR/BYR/CR and up to
 * RBASE_COLOURS colour words) followed by a stream of effect records sorted by line:
 *     line (0..223) | op | payload...        ends with line = $FF
 * op: bit0 BXR (2 bytes), bit1 BYR (2), bit2 CR (1), bit3 colour word (index 2, value 2),
 * bit4 a second colour word.  Only lines that change something have a record, so a toy with two or
 * five effect lines costs two or five interrupts a frame (the old chain took 224), and a dense
 * toy (DUSK RUN's colour per line) costs about 6 bytes a line.  The VBlank handler re-applies the
 * header and the line-0 record, then programs the RCR for the next record; each scan interrupt
 * serves one record and programs the next. */
#define RBASE_COLOURS 32
#define RHDR (1 + 4 * RBASE_COLOURS)       /* header: the base colour count, then the words (index 2, value 2) */
#ifdef TOY_RASTER_TABLE
#define RSTREAM 192                        /* raster(line, spec) from frame(): a handful of lines */
#else
#define RSTREAM 1100                       /* raster(line): up to ~180 colour lines */
#endif
#define RBUFSZ (RHDR + RSTREAM + 2)
volatile uint8_t toy_rbuf[2][RBUFSZ];
volatile uint8_t toy_rbase_lo[2], toy_rbase_hi[2];   /* the buffers' addresses, for the handler */
volatile uint8_t toy_active;       /* the buffer the chain reads */
volatile uint8_t toy_widx;         /* the buffer the game writes (the other one) */
volatile uint8_t toy_publish;      /* 1: the game's buffer is finished, swap at the next VBlank */
/* the handler's read pointer: zero page, for (zp),y */
__attribute__((section(".zp.bss"))) volatile uint16_t toy_rptr;
/* VBlanks seen (8 bits, so a read cannot tear against the interrupt's increment) */
volatile uint8_t toy_vblank_count;

/* The sprite attribute table (VRAM $7F00..$7FFF, 256 words) is double-buffered too: frame() writes a
 * RAM shadow and the VBlank handler copies it to VRAM when it swaps the effect buffers.  Written to
 * VRAM directly while the game computes, a VBlank in the middle of the writes showed half of one
 * game frame's sprites and half of the previous one's (found by the flicker test). */
#define SAT_BASE 0x7F00u
volatile uint16_t toy_sat_sh[256];
volatile uint8_t toy_sat_dirty;
volatile uint8_t toy_sat_req;      /* 1: a published frame's SAT shadow still has to be copied (by the tail stop) */
/* The same for the other VRAM words frame() writes (a scrolling tile map, a score): a queue of
 * (address, word) pairs, applied at the VBlank in order.  When it is full the main loop drains it
 * itself, so order is kept and a frame with a great many writes (a build frame) still works, only
 * without the all-at-once guarantee. */
#ifndef TOY_RASTER_TABLE                   /* the table form (NOVA TIDE) has no room in the fixed bank: its VRAM writes go straight to the VDC, atomically */
#define TOY_RASTER_VQ 1
#define VQ_N 48
volatile uint8_t toy_vq[VQ_N * 4];       /* address low, high, word low, high */
volatile uint8_t toy_vq_n;
volatile uint8_t toy_vq_cnt;
#endif

static uint8_t *wb;                /* the game's (pending) buffer */
static uint16_t wlen;
static uint8_t wlast;              /* the last record's line */              /* stream bytes written into it */
/* raster(line) callback form: what the current line's callback has written so far */
static uint8_t cur_op, cur_cr, base_op, base_cr;
static uint16_t cur_bxr, cur_byr, base_bxr, base_byr;
#ifndef TOY_RASTER_TABLE
static uint16_t cur_c1a, cur_c1v, cur_c2a, cur_c2v;
#endif
static uint8_t *__attribute__((noinline)) put16(uint8_t *q, uint16_t v) {
  q[0] = (uint8_t)v;
  q[1] = (uint8_t)(v >> 8);
  return q + 2;
}
#endif /* TOY_RASTER_BUILD */

#ifdef TOY_RASTER_BUILD
/* The line interrupt chain now runs while the game computes, and its handler writes the VDC's index
 * register, the 16-bit data pair of R05-R08 and the VCE's colour index and data.  The VDC's index is
 * write-only and its low byte is held in ONE latch shared by every register, and the VCE's index
 * auto-increments: an interrupt between a main-thread select and its data stores corrupts both.  So
 * every main-thread access sequence runs with interrupts masked (PHP/SEI ... PLP: the caller's I flag
 * comes back, so boot, which runs masked, stays masked). */
#define IRQ_MASK() __asm__ volatile ("php\n\tsei" ::: "memory")
#define IRQ_UNMASK() __asm__ volatile ("plp" ::: "memory")
#else
#define IRQ_MASK() ((void)0)
#define IRQ_UNMASK() ((void)0)
#endif

static void vdc_write(uint8_t reg, uint16_t value) {
  IRQ_MASK();
  *IO_VDC_INDEX = reg;
  *IO_VDC_DATA_LO = (uint8_t)value;
  *IO_VDC_DATA_HI = (uint8_t)(value >> 8);
  IRQ_UNMASK();
}

#ifdef TOY_INPUT_BUILD
/* ---- pads and the timer (#45) ----------------------------------------
 *
 * The pads: a Turbo Tap's five 2-button controllers on the I/O port at
 * $1000 (H8-19, "Port K").  The sequence is HuDK include/joypad.s's
 * (MIT, (c) 2016-2020 MooZ), which follows pcetech §4 "I/O port":
 *
 *   - reset the tap's counter by holding SEL high while CLR goes 0 -> 1
 *     (write $01, then $03);
 *   - for each of the five controllers, set SEL=1 and read the D-pad, then
 *     SEL=0 and read the four buttons; each 0 -> 1 edge of SEL with CLR low
 *     advances the tap's counter to the next controller;
 *   - wait ~9 cycles after each SEL change ("PHA PLA NOP NOP", pcetech §4);
 *   - the inputs are inverted: a 0 bit means the switch is closed.
 *
 * The timer: $0C00 is the 7-bit reload register, $0C01 bit 0 the Start/Stop
 * flag (H8-20).  The prescaler divides OSC1 by 3 then by 1024 — 6,991.3 Hz
 * at 21.48 MHz (H8-21).  A borrow sets TIQ, reloads the downcounter and
 * runs the timer interrupt (vector $FFFA); TIQ is acknowledged by any write
 * to $1403 (H8-15/H8-22).  The handler only counts: the toy's callback runs
 * from toy_frame(), through the generated il_timer_pump(), so the compiled
 * code never re-enters itself from an interrupt.
 */
static uint8_t joy_pads[5];
static volatile uint8_t joy_ready;
volatile uint16_t timer_irqs;
static uint8_t toy_cr;           /* the CR the toy last asked for */

static void joy_delay(void) {
  /* HuDK's joypad_delay, include/joypad.inc, is PHA/PLA/NOP/NOP (~11 cycles;
   * pcetech §4: "a common sequence is PHA PLA NOP NOP").  2 cycles measured
   * as a stale read on every other frame; five NOPs give the same ~10. */
  __asm__ volatile("nop\n\tnop\n\tnop\n\tnop\n\tnop" ::: "memory");
}

static void joy_scan(void) {
  uint8_t i, dirs, btns;
  /* reset the Turbo Tap to controller 1: SEL high, then CLR 0 -> 1 */
  *IO_JOYPAD = 0x01;
  joy_delay();
  *IO_JOYPAD = 0x03;
  joy_delay();
  for (i = 0; i < 5; i++) {
    *IO_JOYPAD = 0x01;              /* SEL=1: the D-pad on D3..D0 */
    joy_delay();
    dirs = *IO_JOYPAD;
    *IO_JOYPAD = 0x00;              /* SEL=0: the four buttons */
    joy_delay();
    btns = *IO_JOYPAD;
    /* D-pad to bits 4..7 (Up, Right, Down, Left), buttons to 0..3
     * (II, I, Select, Run); inverted, so 1 means held. */
    joy_pads[i] = (uint8_t)(~(((uint8_t)(dirs << 4) & 0xF0) |
                              (uint8_t)(btns & 0x0F)));
  }
  joy_ready = 1;
}

int32_t toy_pad(int32_t n, int32_t field) {
  if (!joy_ready || n < 1 || n > 5) return 0;
  if (field < 0 || field > 7) return 0;
  return (joy_pads[n - 1] >> field) & 1;
}

/* The SAT is VRAM $7F00..$7FFF (docs/ROM_LAYOUT.md); the startup set DSR so
 * the VDC reloads SATB from there every VBlank. */
void toy_sat(int32_t i, int32_t k, int32_t v) {
  if ((uint32_t)i > 63u || (uint32_t)k > 3u) return;
  toy_vram_set(0x7F00 + i * 4 + k, v);
}

void toy_timer_set(int32_t period) {
  *IO_TIMER_COUNTER = (uint8_t)(period & 0x7F);
  *IO_TIMER_CONTROL = TIMER_ON;
  pce_irq_enable(IRQ_TIMER);
  pce_cpu_irq_enable();
}

int32_t toy_timer_pending(void) {
  int32_t n;
  pce_cpu_irq_disable();
  n = (int32_t)timer_irqs;
  timer_irqs = 0;
  pce_cpu_irq_enable();
  return n;
}

/* Vector $FFFA.  A write to $1403 acknowledges TIQ (H8-15). */
#ifdef TOY_RASTER_BUILD
/* A hand-written handler (A only, ~25 cycles): the compiled interrupt function saves the whole
 * soft-register file, several hundred cycles and 60 bytes of the fixed bank, and a line interrupt
 * queued behind it ran late. */
__asm__(
".text\n"
".global irq_timer\n"
".type irq_timer,@function\n"
"irq_timer:\n"
"  pha\n"
"  sta $1403\n"
"  inc timer_irqs\n"
"  bne irq_timer_done\n"
"  inc timer_irqs+1\n"
"irq_timer_done:\n"
"  pla\n"
"  rti\n"
);
#else
__attribute__((interrupt)) void irq_timer(void) {
  *IO_IRQ_ACK = 0;
  timer_irqs++;
}
#endif
#endif /* TOY_INPUT_BUILD */

#ifdef TOY_RASTER_BUILD
static void measure_flag(uint8_t bit) {
  MEAS[MEAS_FLAGS] = (uint8_t)(MEAS[MEAS_FLAGS] | bit);
}
#endif

#ifdef TOY_HOLD_BUILD
/* A toy with no raster() callback runs frame() right after the VBlank starts, and a slow
 * frame (the sound tick, a busy game) can still be running when the visible picture
 * begins.  A scroll, control or colour write made then lands in the middle of the picture
 * and the picture jumps (measured on real hardware: PCEHero's BYR write landed 24 to 40
 * lines after the VBlank started in about one frame in 50, where the blanking period is
 * 22 lines).  So frame()'s writes to BXR, BYR, CR and the colour table are held and
 * applied at the start of the next VBlank, which costs a frame of latency and never tears.
 * Sprites are not held: their list is read by the VDC at the VBlank. */
#define HOLD_COLOURS 32
static uint8_t hold_on;                 /* 1 while frame() runs */
static uint8_t hold_has;                /* bit0 BXR, bit1 BYR, bit2 CR */
static uint16_t hold_bxr, hold_byr;
static uint8_t hold_cr;
static uint8_t hold_npal;
static uint16_t hold_pal_a[HOLD_COLOURS], hold_pal_w[HOLD_COLOURS];
#endif

void toy_pal(int32_t addr, int32_t word) {
#ifdef TOY_RASTER_BUILD
  uint16_t a = (uint16_t)addr & 0x1FF;
  uint16_t w = (uint16_t)word & 0x1FF;
#ifndef TOY_RASTER_TABLE
  if (toy_host_mode == MODE_RASTER) {
    /* the current line's record carries two colour words */
    if (!(cur_op & 0x08)) { cur_c1a = a; cur_c1v = w; cur_op |= 0x08; }
    else if (!(cur_op & 0x10)) { cur_c2a = a; cur_c2v = w; cur_op |= 0x10; }
    else measure_flag(0x02);         /* more colour writes than a line carries */
    return;
  }
#endif
  if (toy_host_mode == MODE_BASE) {
    uint8_t n = wb[0];
    if (n < RBASE_COLOURS) {
      uint8_t *q = wb + 1 + (n << 2);
      q[0] = (uint8_t)a; q[1] = (uint8_t)(a >> 8); q[2] = (uint8_t)w; q[3] = (uint8_t)(w >> 8);
      wb[0] = (uint8_t)(n + 1);
    } else {
      measure_flag(0x01);
    }
    return;
  }
#ifdef TOY_HOLD_BUILD
  if (hold_on && hold_npal < HOLD_COLOURS) {
    hold_pal_a[hold_npal] = a; hold_pal_w[hold_npal] = w; hold_npal++;
    return;
  }
#endif
  /* The VCE's CTA is 9 bits and auto-increments after each data write. */
  IRQ_MASK();
  *IO_VCE_COLOR_INDEX = a;
  *IO_VCE_COLOR_DATA = w;
  IRQ_UNMASK();
#else
  /* Part A's body, unchanged: its palette ROM is a committed image. */
#ifdef TOY_HOLD_BUILD
  if (hold_on && hold_npal < HOLD_COLOURS) {
    hold_pal_a[hold_npal] = (uint16_t)addr & 0x1FF; hold_pal_w[hold_npal] = (uint16_t)word & 0x1FF; hold_npal++;
    return;
  }
#endif
  *IO_VCE_COLOR_INDEX = (uint16_t)addr;
  *IO_VCE_COLOR_DATA = (uint16_t)word;
#endif
}

void toy_reg(int32_t which, int32_t value) {
  uint16_t v = (uint16_t)value;
#ifdef TOY_RASTER_BUILD
#ifndef TOY_RASTER_TABLE
  if (toy_host_mode == MODE_RASTER) {
    if (which == TOY_REG_BXR) { cur_bxr = v & 0x3FF; cur_op |= 0x01; }
    else if (which == TOY_REG_BYR) { cur_byr = v & 0x1FF; cur_op |= 0x02; }
    else { cur_cr = (uint8_t)v; cur_op |= 0x04; }
    return;
  }
#endif
  if (toy_host_mode == MODE_BASE) {
    if (which == TOY_REG_BXR) { base_bxr = v & 0x3FF; base_op |= 0x01; }
    else if (which == TOY_REG_BYR) { base_byr = v & 0x1FF; base_op |= 0x02; }
    else { base_cr = (uint8_t)v; base_op |= 0x04; }
    return;
  }
#endif
#ifdef TOY_HOLD_BUILD
  if (hold_on) {
    if (which == TOY_REG_BXR) { hold_bxr = v; hold_has |= 1; }
    else if (which == TOY_REG_BYR) { hold_byr = v; hold_has |= 2; }
    else { hold_cr = (uint8_t)v; hold_has |= 4; }
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
#ifdef TOY_INPUT_BUILD
    /* Remember the toy's CR so toy_display_on does not drop SB (sprites) or
     * any other bit the toy asked for (#45: a sprite toy sets $C0). */
    toy_cr = (uint8_t)(v & 0xFF);
#endif
  }
}

#ifdef TOY_HOLD_BUILD
/* Apply what frame() held, at the start of a VBlank (see the hold block above). */
static void hold_flush(void) {
  uint8_t i;
  for (i = 0; i < hold_npal; i++) {
    *IO_VCE_COLOR_INDEX = hold_pal_a[i];
    *IO_VCE_COLOR_DATA = hold_pal_w[i];
  }
  hold_npal = 0;
  if (hold_has & 1) vdc_write(0x07, (uint16_t)(hold_bxr & 0x3FF));
  if (hold_has & 2) vdc_write(0x08, (uint16_t)(hold_byr & 0x1FF));
  if (hold_has & 4) {
    vdc_write(0x05, (uint16_t)(hold_cr | 0x0C));
#ifdef TOY_INPUT_BUILD
    toy_cr = hold_cr;
#endif
  }
  hold_has = 0;
}
#endif

/* the zero source of the boot clear's block moves: 64 bytes of ROM, or in a raster build the shadow SAT,
 * which is still all zero then (the last 64 bytes of the fixed bank are worth more than the ROM block) */
#ifdef TOY_RASTER_BUILD
#define toy_zeros toy_sat_sh
#else
static const uint8_t toy_zeros[64];
#endif

#ifdef TOY_RASTER_BUILD
static void __attribute__((noinline)) vdc_put(uint16_t a, uint16_t w) {
  IRQ_MASK();
  *IO_VDC_INDEX = 0x00; *IO_VDC_DATA_LO = (uint8_t)a; *IO_VDC_DATA_HI = (uint8_t)(a >> 8);
  *IO_VDC_INDEX = 0x02; *IO_VDC_DATA_LO = (uint8_t)w; *IO_VDC_DATA_HI = (uint8_t)(w >> 8);
  IRQ_UNMASK();
}

#ifdef TOY_RASTER_VQ
/* one VRAM word from frame(): queued for the next VBlank, in order (direct in the boot, where nothing
 * is on screen; and the queue is applied from here, in order, when it is full).  The push is a few
 * lines of assembly (the fixed bank is nearly full in a -Oz build of the largest game): a at A:X, w at
 * the first soft-register pair, as the mos ABI passes them. */
void toy_vq_push(uint16_t a, uint16_t w);
void toy_vq_drain(void);
__asm__(
".text\n"
".global toy_vq_push\n"
".type toy_vq_push,@function\n"
"toy_vq_push:\n"
"  pha\n"
"  lda toy_vq_n\n"
"  asl\n"
"  asl\n"
"  tay\n"
"  pla\n"
"  sta toy_vq,y\n"
"  txa\n"
"  sta toy_vq+1,y\n"
"  lda __rc2\n"
"  sta toy_vq+2,y\n"
"  lda __rc3\n"
"  sta toy_vq+3,y\n"
"  inc toy_vq_n\n"
"  rts\n"
".global toy_vq_drain\n"
".type toy_vq_drain,@function\n"
"toy_vq_drain:\n"                /* apply the queue, one word at a time with interrupts masked */
"  ldx toy_vq_n\n"
"  beq vqd_done\n"
"  stz toy_vq_n\n"
"  txa\n"
"  asl\n"
"  asl\n"
"  sta toy_vq_cnt\n"
"  ldx #0\n"
"vqd_loop:\n"
"  php\n"
"  sei\n"
"  st0 #0\n"
"  lda toy_vq,x\n"
"  sta $0002\n"
"  lda toy_vq+1,x\n"
"  sta $0003\n"
"  st0 #2\n"
"  lda toy_vq+2,x\n"
"  sta $0002\n"
"  lda toy_vq+3,x\n"
"  sta $0003\n"
"  plp\n"
"  inx\n"
"  inx\n"
"  inx\n"
"  inx\n"
"  cpx toy_vq_cnt\n"
"  bne vqd_loop\n"
"vqd_done:\n"
"  rts\n"
);

static void __attribute__((noinline)) vq_write(uint16_t a, uint16_t w) {
  if (toy_host_mode == MODE_DIRECT) { vdc_put(a, w); return; }
  if (toy_vq_n >= VQ_N) toy_vq_drain();
  toy_vq_push(a, w);
}
#endif
#endif

void toy_vram_set16(uint16_t addr, uint16_t word) {
#ifdef TOY_RASTER_BUILD
  uint16_t a = addr & 0x7FFF;
  uint16_t w = word;
  if (toy_host_mode == MODE_RASTER) {
    /* VRAM is fetched as the line draws; a write from a raster callback
     * cannot be replayed at a line boundary by this backend.  Flag it and
     * drop it rather than corrupt the frame being displayed: the capture's
     * flags say the run is not comparable. */
    measure_flag(0x04);
    return;
  }
  if (a >= SAT_BASE) {
    /* the sprite attribute table: into the shadow, copied at the VBlank (see the data block above);
     * the boot's direct writes also reach the VRAM, which no interrupt serves yet */
    toy_sat_sh[a - SAT_BASE] = w;
    toy_sat_dirty = 1;
    if (toy_host_mode != MODE_DIRECT) return;
  }
  /* Everything else goes straight to the VDC, MAWR and data as ONE atomic sequence (the VBlank
   * handler's SAT copy sets MAWR, and the index is write-only).  A capture list would cap the write
   * volume, and a build frame's writes (DUSK RUN step 7: 208 words) would overflow any list that
   * fits in RAM (#289); the cost is that a tile written now can show in the lower part of the frame
   * being displayed (docs/NATIVE.md, raster runtime v2).  Select VWR (R02) before the word: after a
   * register write the select latch still holds that register (viewer.asm's copy_words). */
#ifdef TOY_RASTER_VQ
  vq_write(a, w);
#else
  vdc_put(a, w);
#endif
#else
  /* Part A's body, unchanged: its palette ROM is a committed image. */
  vdc_write(0x00, addr);
  vdc_write(0x02, word);
#endif
}

void toy_vram_set(int32_t addr, int32_t word) {
  toy_vram_set16((uint16_t)addr, (uint16_t)word);
}

void toy_vram_set4(uint16_t addr, uint16_t w0, uint16_t w1, uint16_t w2, uint16_t w3) {
#ifdef TOY_RASTER_BUILD
  /* four single-word writes: set16 holds the shadow-SAT, queue and raster-callback rules in one place */
  toy_vram_set16(addr, w0); toy_vram_set16((uint16_t)(addr + 1), w1);
  toy_vram_set16((uint16_t)(addr + 2), w2); toy_vram_set16((uint16_t)(addr + 3), w3);
#else
  vdc_write(0x00, addr);
  *IO_VDC_INDEX = 0x02;
  *IO_VDC_DATA_LO = (uint8_t)w0; *IO_VDC_DATA_HI = (uint8_t)(w0 >> 8);
  *IO_VDC_DATA_LO = (uint8_t)w1; *IO_VDC_DATA_HI = (uint8_t)(w1 >> 8);
  *IO_VDC_DATA_LO = (uint8_t)w2; *IO_VDC_DATA_HI = (uint8_t)(w2 >> 8);
  *IO_VDC_DATA_LO = (uint8_t)w3; *IO_VDC_DATA_HI = (uint8_t)(w3 >> 8);
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
  /* CR = BB (background on) + the VBlank status bit.  A toy that set its own
   * CR keeps it: with sprites (#45) CR bit 6 (SB) must survive the turn-on. */
#ifdef TOY_INPUT_BUILD
  vdc_write(0x05, (uint16_t)(0x0088 | toy_cr));
#else
  vdc_write(0x05, 0x0088);
#endif
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
/* ---- the RCR chain (raster runtime v2) -----------------------------------------------------
 *
 * The compiled raster() handler cannot run in the interrupt: measured from the linked code, its
 * entry to first write is far past the ~100-cycle horizontal blank (docs/IL.md §10).  These
 * handlers are the #16 viewer's answer: a handful of loads and stores per effect line, from the
 * ACTIVE buffer the game published (see the data block above).  They use A/X/Y only and call no C,
 * so the C main loop's soft registers (the mos ABI's zero-page file) survive untouched; A/X/Y are
 * saved because that loop is live between lines.
 *
 * VBlank (irq_vbl_near): count it; if the game has published a finished buffer, swap; point the read
 * pointer at the active buffer; re-apply its header (the base BXR/BYR/CR and colour words frame()
 * wrote outside raster(): idempotent, so a frame shown twice looks the same twice); serve a line-0
 * record now (the VDC latches BYR for the first display line at the VDW entry, before the RCR=0x40
 * match, so the RCR interrupt would be one line late: pce-bg.js's model comment, measured on
 * status-bar.lua); program the RCR for the next record, or park it where it never matches ($3FF).
 * Scan interrupt (irq_scan): serve the record at the pointer and program the RCR for the next one.
 *
 * A record's writes are ordered BXR, BYR, CR, colour words: BXR is the write whose latch line is
 * closest.  The RCR is nine bits: line + 0x40 carries into bit 8 from line 192.
 */
__asm__(
".text\n"
"irq_vbl_j:\n"                /* before irq_vdc, so its `bne` reaches back to it */
"  phx\n"
"  phy\n"
"  jmp irq_vbl_near\n"
".global irq_vdc\n"
".type irq_vdc,@function\n"
"irq_vdc:\n"
"  pha\n"
"  lda $0000\n"                 /* VDC status: also acknowledges */
"  and #$20\n"                 /* VD, the VBlank flag */
"  bne irq_vbl_j\n"
"  phx\n"                       /* a scan interrupt: the latency-critical path, no call, no guard */
"  phy\n"
"irq_serve:\n"
"  ldy #1\n"
"  lda (toy_rptr),y\n"
"  tax\n"                       /* X = op */
"  iny\n"                       /* Y = the payload offset */
"  and #$01\n"
"  beq irq_s_nbxr\n"
"  st0 #7\n"
"  lda (toy_rptr),y\n"
"  iny\n"
"  sta $0002\n"
"  lda (toy_rptr),y\n"
"  iny\n"
"  sta $0003\n"
"irq_s_nbxr:\n"
#ifndef TOY_RASTER_TABLE        /* the table form carries no colour writes */
"  txa\n"
"  and #$08\n"
"  beq irq_s_nc1\n"
"  lda (toy_rptr),y\n"
"  iny\n"
"  sta $0402\n"
"  lda (toy_rptr),y\n"
"  iny\n"
"  sta $0403\n"
"  lda (toy_rptr),y\n"
"  iny\n"
"  sta $0404\n"
"  lda (toy_rptr),y\n"
"  iny\n"
"  sta $0405\n"
"irq_s_nc1:\n"
"  txa\n"
"  and #$10\n"
"  beq irq_s_nc2\n"
"  lda (toy_rptr),y\n"
"  iny\n"
"  sta $0402\n"
"  lda (toy_rptr),y\n"
"  iny\n"
"  sta $0403\n"
"  lda (toy_rptr),y\n"
"  iny\n"
"  sta $0404\n"
"  lda (toy_rptr),y\n"
"  iny\n"
"  sta $0405\n"
"irq_s_nc2:\n"
#endif
"  txa\n"
"  and #$02\n"
"  beq irq_s_nbyr\n"
"  st0 #8\n"
"  lda (toy_rptr),y\n"
"  iny\n"
"  sta $0002\n"
"  lda (toy_rptr),y\n"
"  iny\n"
"  sta $0003\n"
"irq_s_nbyr:\n"
"  txa\n"
"  and #$04\n"
"  beq irq_s_ncr\n"
"  st0 #5\n"
"  lda (toy_rptr),y\n"
"  iny\n"
"  ora #$0C\n"                 /* VC + RC, as the direct path */
"  sta $0002\n"
"  stz $0003\n"
"irq_s_ncr:\n"
"  tya\n"                       /* the pointer steps past the record */
"  clc\n"
"  adc toy_rptr\n"
"  sta toy_rptr\n"
"  bcc irq_s_nc\n"
"  inc toy_rptr+1\n"
"irq_s_nc:\n"
"  ldy #0\n"
"  lda (toy_rptr),y\n"         /* the next record's line */
"  cmp #$FF\n"
"  beq irq_s_off\n"
"  clc\n"
"  adc #$40\n"
"  st0 #6\n"
"  sta $0002\n"
"  lda #$00\n"
"  adc #$00\n"                 /* the carry from line + 0x40: RCR bit 8 */
"  sta $0003\n"
"  bra irq_done\n"
"irq_s_off:\n"
"  st0 #6\n"                    /* no record left: park the RCR where no line matches */
"  lda #$FF\n"
"  sta $0002\n"
"  lda #$03\n"
"  sta $0003\n"
"  txa\n"                       /* the stream's last record is the tail stop (op bit 7) */
"  bpl irq_done\n"
"  lda toy_sat_req\n"          /* the finished frame's sprites: shadow to VRAM, in this interrupt */
"  beq irq_done\n"
"  st0 #0\n"
"  lda #$00\n"
"  sta $0002\n"
"  lda #$7F\n"
"  sta $0003\n"
"  st0 #2\n"
"  tia toy_sat_sh, $0002, #512\n"
"  stz toy_sat_req\n"
"irq_done:\n"
"  ply\n"
"  plx\n"
"  pla\n"
"  rti\n"

"irq_vbl_near:\n"
"  inc toy_vblank_count\n"
"  lda toy_publish\n"
"  beq irq_v_np\n"
"  lda toy_sat_req\n"          /* the sprites of that frame are not in VRAM yet: wait one more frame */
"  bne irq_v_np\n"
"  lda toy_active\n"            /* the game's buffer is finished: it becomes the active one */
"  eor #$01\n"
"  sta toy_active\n"
"  lda toy_widx\n"
"  eor #$01\n"
"  sta toy_widx\n"
"  stz toy_publish\n"
#ifdef TOY_RASTER_VQ
"  jsr toy_vq_drain\n"        /* queued VRAM words, in order */
#endif
"irq_v_np:\n"
"  ldx toy_active\n"
"  lda toy_rbase_lo,x\n"
"  sta toy_rptr\n"
"  lda toy_rbase_hi,x\n"
"  sta toy_rptr+1\n"
"  ldy #0\n"
"  lda (toy_rptr),y\n"         /* the number of base colour words frame() wrote */
"  beq irq_v_npal\n"
"  tax\n"
"  ldy #1\n"
"irq_v_pal:\n"
"  lda (toy_rptr),y\n"
"  iny\n"
"  sta $0402\n"
"  lda (toy_rptr),y\n"
"  iny\n"
"  sta $0403\n"
"  lda (toy_rptr),y\n"
"  iny\n"
"  sta $0404\n"
"  lda (toy_rptr),y\n"
"  iny\n"
"  sta $0405\n"
"  dex\n"
"  bne irq_v_pal\n"
"irq_v_npal:\n"
"  lda toy_rptr\n"              /* the pointer moves from the header to the stream, whose first record is */
"  clc\n"                       /* always line 0 (the base registers merged with raster(0)): served now, */
"  adc #" STR(RHDR) "\n"         /* in the VBlank; it programs the RCR for the next record */
"  sta toy_rptr\n"
"  bcc irq_v_nc\n"
"  inc toy_rptr+1\n"
"irq_v_nc:\n"
"  jmp irq_serve\n"
);


/* ---- the game's side: building a buffer ----------------------------------------------------- */

/* The record being built (the callback form fills it from raster(line)'s writes; the table form from
 * its entry); rec_put() appends it to the pending stream. */
static uint8_t cur_line;

/* the stream's first record is always line 0: the base registers frame() wrote, with raster(0)'s writes over
 * them.  The VBlank handler serves it, so there is no separate header to apply. */
static void rec0_begin(void) {
  cur_op = base_op;
  cur_bxr = base_bxr;
  cur_byr = base_byr;
  cur_cr = base_cr;
}

/* append the current record (callers go in ascending line order) */
static void rec_put(void) {
  uint8_t op = cur_op, *q, *q0;
  if (wlen > RSTREAM - ((op & 0x80) ? 3 : 20)) {      /* worst record: 2 + 2 + 4 + 4 + 2 + 1 = 15 bytes */
    measure_flag(0x08);              /* the stream is full: this line's effect is dropped */
    return;
  }
  q = q0 = wb + RHDR + wlen;
  *q++ = cur_line;
  *q++ = op;
  if (op & 0x01) q = put16(q, cur_bxr);
#ifndef TOY_RASTER_TABLE
  if (op & 0x08) q = put16(put16(q, cur_c1a), cur_c1v);
  if (op & 0x10) q = put16(put16(q, cur_c2a), cur_c2v);
#endif
  if (op & 0x02) q = put16(q, cur_line ? (uint16_t)((cur_byr + 1) & 0x1FF) : cur_byr);
  if (op & 0x04) *q++ = cur_cr;
  *q = 0xFF;
  wlen += (uint8_t)(q - q0);
  wlast = cur_line;
}

/* Publish the finished game frame.  The VDC copies the SAT from VRAM into its own SATB at the START of
 * every VBlank and shows that copy for the whole next picture, so the SAT in VRAM has to be complete
 * BEFORE the VBlank that swaps in the new effects, and nothing may touch the VDC's registers from the
 * main thread in the middle of the picture without delaying the line interrupts.  So the copy is done
 * by the line-interrupt handler: every stream ends with a TAIL stop (op bit 7) one line after its last
 * effect line, and that stop copies the shadow SAT (a 512-byte block move, ~7 lines) when `sat_req`
 * is set.  The VBlank handler swaps only when the copy is done; if the frame was published after the
 * tail stop had passed, the swap waits one more video frame (the old picture stays whole).  Copying
 * the shadow in the VBlank handler instead put the sprites one video frame behind the scroll. */
static void publish_frame(void) {
  cur_line = (uint8_t)(wlast + 1);
  if (cur_line > 224) cur_line = 224;
  cur_op = 0x80;
  rec_put();
  toy_sat_req = toy_sat_dirty;
  toy_sat_dirty = 0;
  toy_publish = 1;
}

/* start a new pending buffer: empty header, empty stream */
static void rb_begin(void) {
  uint8_t w = toy_widx;
  wb = (uint8_t *)((uint16_t)toy_rbase_lo[w] | ((uint16_t)toy_rbase_hi[w] << 8));
  wb[0] = 0;                         /* no base colour words */
  base_op = 0;
  wlen = 0;
  wlast = 0;
  wb[RHDR] = 0xFF;                   /* the stream's end mark */
}

#ifdef TOY_RASTER_TABLE
/* The table form, raster(line, spec) from frame(): entries come in any order and a line may be
 * named twice (the fields are merged).  t_slot[line] names the entry (1-based) of a line; the
 * entries are written to the stream in line order when frame() returns. */
#define NTBL 24
static uint8_t t_n, t_slot[VDW_LINES], t_op[NTBL], t_cr[NTBL];
static uint16_t t_bxr[NTBL], t_byr[NTBL];

void toy_raster_entry(int32_t line, int32_t mask, int32_t bxr, int32_t byr, int32_t cr) {
  uint8_t i;
  if ((uint32_t)line >= VDW_LINES) return;
  i = t_slot[line];
  if (!i) {
    if (t_n >= NTBL) { measure_flag(0x10); return; }
    i = ++t_n;
    t_slot[line] = i;
    t_op[i - 1] = 0;
  }
  i--;
  if (mask & 1) { t_bxr[i] = (uint16_t)bxr & 0x3FF; t_op[i] |= 0x01; }
  if (mask & 2) { t_byr[i] = (uint16_t)byr & 0x1FF; t_op[i] |= 0x02; }
  if (mask & 4) { t_cr[i] = (uint8_t)cr; t_op[i] |= 0x04; }
}

static void finish_table(void) {
  uint8_t l, i;
  for (l = 0; l < VDW_LINES; l++) {
    if (l && !t_n) break;
    i = t_slot[l];
    if (l) cur_op = 0; else rec0_begin();
    if (i) {
      t_slot[l] = 0;
      t_n--;
      i--;
      if (t_op[i] & 1) cur_bxr = t_bxr[i];
      if (t_op[i] & 2) cur_byr = t_byr[i];
      if (t_op[i] & 4) cur_cr = t_cr[i];
      cur_op |= t_op[i];
    } else if (l) continue;
    cur_line = l;
    rec_put();
  }
  t_n = 0;
}
#else
/* The callback form: raster(0..223) back to back into the pending stream.  The collection is the
 * toy's own cost and the timer sum is the measurement. */
static void collect_all(void) {
  uint8_t l;
  for (l = 0; l < VDW_LINES; l++) {
    if (l) cur_op = 0; else rec0_begin();
    cur_line = l;
    toy_measure_raster_begin();
    toy_raster(l);
    toy_measure_raster_end();
    if (cur_op || !l) rec_put();
  }
}
#endif
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
  /* 64 KiB of zero bytes by block move: TIA copies from an incrementing source and alternates its
   * destination between $0002 and $0003, which is the VDC's data low/high pair; 6 cycles a byte,
   * about 3.5 video frames, where a store loop took about 8. */
  for (i = 0; i < 1024; i++) {
    __asm__ volatile ("tia %0, $0002, #64" : : "i"(toy_zeros) : "memory");
  }

  /* Load the zeroed SAT ($7F00) into SATB every VBlank. */
  vdc_write(0x0F, 0x0010);            /* DCR: bit 4, DSR */
  vdc_write(0x13, 0x7F00);            /* DVSSR: 256 words from $7F00 */

  /* The TMA timer: free-running, one tick per 1024 CPU clocks. */
  *IO_TIMER_COUNTER = 0x7F;
  *IO_TIMER_CONTROL = TIMER_ON;

  toy_boot();

#ifdef TOY_RASTER_BUILD
#ifdef TOY_RASTER_TABLE
  if (0) {
#else
  if (toy_raster == 0) {
#endif
#endif
    /* Part A: no raster() callback.  One frame() per VBlank, direct. */
    {
    int32_t f;
    for (f = 0;; f++) {
      toy_wait_vblank();
#ifdef TOY_HOLD_BUILD
      hold_flush();             /* last frame's scroll/control/colour writes, inside the blanking */
      hold_on = 1;
#endif
#ifdef TOY_INPUT_BUILD
      joy_scan();               /* the pads, once per toy frame (#45) */
#endif
      toy_measure_begin();
      toy_frame(f);
      toy_measure_end();
#ifdef TOY_HOLD_BUILD
      hold_on = 0;
#endif
    }
    }
#ifdef TOY_RASTER_BUILD
  } else {
    /* Part C, raster runtime v2: the line-interrupt chain runs on EVERY video frame from the last
     * PUBLISHED buffer (see the data block above), and the game computes the next frame into the
     * other buffer meanwhile: frame(f), then its raster calls (the callback form) or its raster
     * entries (the table form), then `publish` and wait for the next VBlank, whose handler swaps
     * the buffers and starts replaying the new one.  A game frame that computes in under one video
     * frame therefore takes one video frame (60 Hz); a longer one takes the next whole number.
     * Every video frame shows a complete game frame with its per-line effects, never a half-built
     * one.  Before this the chain was disarmed while the game computed, and those video frames showed
     * the last line's scroll and backdrop for the whole screen (docs/NATIVE.md). */
    int32_t f;
    toy_host_mode = MODE_DIRECT;
    /* both buffers start empty; the active one is replayed (as nothing) until the first publish */
    for (i = 0; i < 2; i++) {
      toy_rbuf[i][0] = 0;
      toy_rbuf[i][RHDR] = 0;           /* the line-0 record, empty */
      toy_rbuf[i][RHDR + 1] = 0;
      toy_rbuf[i][RHDR + 2] = 1;       /* the tail stop at line 1: the first frame's sprites get copied */
      toy_rbuf[i][RHDR + 3] = 0x80;
      toy_rbuf[i][RHDR + 4] = 0xFF;
      toy_rbase_lo[i] = (uint8_t)(uint16_t)toy_rbuf[i];
      toy_rbase_hi[i] = (uint8_t)((uint16_t)toy_rbuf[i] >> 8);
    }
    toy_active = 0;
    toy_widx = 1;
    toy_publish = 0;
    toy_rptr = (uint16_t)toy_rbuf[0] + RHDR;
#ifdef TOY_INPUT_BUILD
    /* keep what the toy asked for: with sprites (SB, bit 6) CR is $C0.  Writing a plain
     * $8C here switched every sprite off in the raster builds (found by looking at the
     * picture: NOVA TIDE's sprite list was exact but no sprite was drawn). */
    vdc_write(0x05, (uint16_t)(0x008C | toy_cr));   /* BB + VC + RC + the toy's bits */
#else
    vdc_write(0x05, 0x008C);          /* BB + VC + RC */
#endif
    pce_irq_enable(IRQ_VDC);
    pce_cpu_irq_enable();

    for (f = 0;; f++) {
      uint8_t c0, c1, cd;
      uint32_t csum;
      uint16_t ccount;

      /* ---- compute the next game frame into the pending buffer, while the active one is on screen ---- */
#ifdef TOY_INPUT_BUILD
      joy_scan();               /* the pads, once per toy frame (#45) */
#endif
      rb_begin();
#ifdef TOY_RASTER_TABLE
      t_n = 0;
#endif
      toy_host_mode = MODE_BASE;
      toy_measure_begin();
      toy_frame(f);
      toy_measure_end();

      toy_host_mode = MODE_RASTER;
      c0 = (uint8_t)(*IO_TIMER_COUNTER & 0x7F);
#ifdef TOY_RASTER_TABLE
      finish_table();
#else
      collect_all();
#endif
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

      /* ---- publish: the next VBlank swaps the buffers; do not touch the pending one before it has ---- */
      publish_frame();
      while (toy_publish) {
      }
    }
  }
#endif
}
