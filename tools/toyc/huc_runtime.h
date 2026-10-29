/*
 * huc_runtime.h — the toy surface for the HuC backend (#31 part B).
 *
 * Mirrors tools/toyc/toy_runtime.h's names, so renderer/pce-cgen.js emits
 * the same calls for both C dialects.  The difference is the compiler: HuC's
 * int is 16 bits and its ABI is its own, so this runtime is written in HuC C
 * and assembled by HuC/PCEAS, not by llvm-mos.  docs/IL.md §11.
 */
#ifndef PCE_HUC_RUNTIME_H
#define PCE_HUC_RUNTIME_H

#include "huc.h"

/* The IL's reg(name, value): the three VDC registers a toy may write. */
#define TOY_REG_BXR 0          /* VDC R07, horizontal scroll, 10 bits */
#define TOY_REG_BYR 1          /* VDC R08, vertical scroll, 9 bits */
#define TOY_REG_CR  2          /* VDC R05, control, 8 bits */

/* The generated C defines these; the runtime calls them. */
extern void toy_boot(void);
extern void toy_frame(int f);
extern void toy_raster(int line);

/* The IL's pal(addr, word): one VCE colour-table entry. */
void toy_pal(int addr, int word);

/* The IL's reg(name, value).  `which` is TOY_REG_*. */
void toy_reg(int which, int value);

/* The IL's vset(addr, word): one VDC VRAM word. */
void toy_vram_set(int addr, int word);

/* The frame flow: turn the display on, and the VDC interrupt hook. */
void toy_display_on(void);

/* HuC has no 32-bit integer; rgb() is nine bits, so 16 is exact. */
int toy_rgb(int r, int g, int b);

#endif /* PCE_HUC_RUNTIME_H */
