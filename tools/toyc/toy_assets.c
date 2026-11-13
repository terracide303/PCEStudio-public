/* tools/toyc/toy_assets.c — see toy_assets.h.  Runs at boot, with the display
 * off and no interrupt armed, so it owns the VDC (docs/NATIVE.md, VDC access
 * rules).  The blob sits in consecutive ROM banks seen through page 6 ($C000);
 * page 6 is put back on bank 0 when it is done, which is where the banked
 * code's bookkeeping starts. */
#include <pce.h>
#include <stdint.h>
#include "toy_runtime.h"
#include "toy_assets.h"

static uint16_t pos;           /* byte position in the blob */
static uint8_t mapped = 0xFF;  /* the bank page 6 holds, 0xFF: none yet */

static uint8_t next_byte(void) {
  uint8_t bank = (uint8_t)(toy_art_first_bank + (pos >> 13));
  if (bank != mapped) {
    mapped = bank;
    __asm__ volatile ("tam #$40" : : "a" (bank) : "memory");
  }
  return *(volatile const uint8_t *)(0xC000u + (pos++ & 0x1FFFu));
}

static void vdc_set(uint8_t reg, uint16_t v) {
  *IO_VDC_INDEX = reg;
  *IO_VDC_DATA_LO = (uint8_t)v;
  *IO_VDC_DATA_HI = (uint8_t)(v >> 8);
}

void toy_assets_boot(void) {
  uint16_t i, k;
  /* the 512 colour words */
  pos = 0;
  *IO_VCE_COLOR_INDEX = 0;
  for (i = 0; i < 512; i++) {
    uint8_t lo = next_byte();
    uint8_t hi = next_byte();
    *IO_VCE_COLOR_DATA = (uint16_t)(lo | ((uint16_t)hi << 8));
  }
  /* each run of VRAM words: MAWR, then the data port */
  for (i = 0; i < toy_art_nruns; i++) {
    pos = (uint16_t)(1024u + toy_art_runs[i].off - 1024u);
    vdc_set(0x00, toy_art_runs[i].vram);
    *IO_VDC_INDEX = 0x02;
    for (k = 0; k < toy_art_runs[i].count; k++) {
      uint8_t lo = next_byte();
      uint8_t hi = next_byte();
      *IO_VDC_DATA_LO = lo;
      *IO_VDC_DATA_HI = hi;
    }
  }
  /* page 6 back on bank 0 */
  __asm__ volatile ("tam #$40" : : "a" ((uint8_t)0) : "memory");
  mapped = 0xFF;
  /* the registers the picture came with; CR through toy_reg so the runtime
   * remembers it (sprites on survives toy_display_on) */
  vdc_set(0x09, toy_art_mwr);
  vdc_set(0x07, toy_art_bxr);
  vdc_set(0x08, toy_art_byr);
  toy_reg(TOY_REG_CR, (int32_t)toy_art_cr);
}
