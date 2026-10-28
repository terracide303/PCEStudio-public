/*
 * toy_runtime.c — the console side of the IL → C backend (#31 part A).
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
 * Frame flow (the browser's flow, on the console): run the chunk, run init(),
 * turn the display on, then for each VBlank run one frame(t=0, f).  t is 0
 * because part A refuses an IL that reads a fixed value; the palette toy uses
 * f only.  The palette writes happen inside VBlank, as the browser's frame
 * writes happen before it renders that frame.
 *
 * The TMA timer (huc6280.cpp TimerRead: timer_value, one decrement per 1024
 * CPU clocks) brackets frame() so the capture can measure the toy's cycles
 * per frame instead of estimating them.  The sum (u32), count (u16), min and
 * max (u8) live at BaseRAM $2100, above the linker's RAM (the SDK's RAM
 * section starts at $2200 and the stack at $4000), so mcs-extract's ram.bin
 * carries them at offset $100.
 */
#include <pce.h>

#include "toy_runtime.h"

extern void toy_boot(void);
extern void toy_frame(int32_t f);

#define MEAS ((volatile uint8_t *)0x2100)
#define MEAS_SUM 0        /* u32 sum of per-frame tick deltas */
#define MEAS_COUNT 4      /* u16 frames measured */
#define MEAS_MAX 6        /* u8 largest delta */
#define MEAS_MIN 7        /* u8 smallest delta */

static uint8_t measure_t0;

static void vdc_write(uint8_t reg, uint16_t value) {
  *IO_VDC_INDEX = reg;
  *IO_VDC_DATA_LO = (uint8_t)value;
  *IO_VDC_DATA_HI = (uint8_t)(value >> 8);
}

void toy_pal(int32_t addr, int32_t word) {
  /* The VCE's CTA is 9 bits and auto-increments after each data write. */
  *IO_VCE_COLOR_INDEX = (uint16_t)addr;
  *IO_VCE_COLOR_DATA = (uint16_t)word;
}

void toy_vram_set(int32_t addr, int32_t word) {
  /* Set MAWR, then select the VRAM data register (R02, VWR) before the word:
   * after a register write the VDC's select latch still holds that register,
   * so a data-port write without selecting R02 would land back in MAWR.
   * viewer.asm's copy_words does exactly this (st0 #$00/st1/st2, st0 #$02). */
  vdc_write(0x00, (uint16_t)addr);
  vdc_write(0x02, (uint16_t)word);
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
  {
    int32_t f;
    for (f = 0;; f++) {
      toy_wait_vblank();
      toy_measure_begin();
      toy_frame(f);
      toy_measure_end();
    }
  }
}
