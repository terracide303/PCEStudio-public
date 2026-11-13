/* tools/toyc/toy_assets.h — the native ROM's art at boot (docs/NATIVE.md).
 * tools/native-assets.js writes the data as C (colours and VRAM runs in ROM
 * banks, a run table and the registers in the fixed page); toy_assets_boot()
 * replays it before the toy's first statement, as the browser's importer does. */
#ifndef TOY_ASSETS_H
#define TOY_ASSETS_H
#include <stdint.h>

struct toy_art_run {
  uint16_t vram;     /* first VRAM word */
  uint16_t off;      /* byte offset of its words in the blob (after the 1,024 colour bytes) */
  uint16_t count;    /* words */
};

extern const uint8_t toy_art_first_bank;
extern const uint16_t toy_art_nruns;
extern const struct toy_art_run toy_art_runs[];
extern const uint16_t toy_art_bxr, toy_art_byr, toy_art_mwr, toy_art_cr;

void toy_assets_boot(void);

#endif
