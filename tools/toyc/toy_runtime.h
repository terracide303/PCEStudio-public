/*
 * toy_runtime.h — the toy surface the IL → C backend (renderer/pce-cgen.js)
 * calls (#31 parts A and C).
 *
 * The emitter knows the toy's *meaning* (IL instructions); this header and
 * toy_runtime.c know the console: VDC/VCE ports, the frame flow, the
 * raster(line) path, and the timer measurement.  The names mirror the
 * IL/JS host (pal, reg, vram set) so the generated C reads like the IL it
 * came from.
 */
#ifndef PCE_TOY_RUNTIME_H
#define PCE_TOY_RUNTIME_H

#include <stdint.h>

/* The IL's reg(name, value): the three VDC registers a toy may write. */
#define TOY_REG_BXR 0          /* VDC R07, horizontal scroll, 10 bits */
#define TOY_REG_BYR 1          /* VDC R08, vertical scroll, 9 bits */
#define TOY_REG_CR  2          /* VDC R05, control, 8 bits */

/* The IL's pal(addr, word): one VCE colour-table entry. */
void toy_pal(int32_t addr, int32_t word);

/* The IL's reg(name, value).  `which` is TOY_REG_*. */
void toy_reg(int32_t which, int32_t value);

/* The IL's vset(addr, word): one VDC VRAM word. */
void toy_vram_set(int32_t addr, int32_t word);

/* The frame flow: wait for the VDC's VBlank flag, turn the display on. */
void toy_wait_vblank(void);
void toy_display_on(void);

/* The HuC6280's TMA timer brackets one frame() call and one raster() call;
 * the save state carries the sums so the capture reports measured cycles. */
void toy_measure_begin(void);
void toy_measure_end(void);
void toy_measure_raster_begin(void);
void toy_measure_raster_end(void);

/* The prelude's rgb(r, g, b) exactly as renderer/pce-il.js computes it:
 * 9-bit colour, 3 bits per channel, indices taken mod 8. */
static inline int32_t toy_rgb(int32_t r, int32_t g, int32_t b) {
  return (int32_t)(((uint32_t)(g & 7) * 64u) +
                   ((uint32_t)(r & 7) * 8u) +
                   (uint32_t)(b & 7));
}

#endif /* PCE_TOY_RUNTIME_H */
