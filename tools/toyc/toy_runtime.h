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

/* ---- pads and the timer (#45) --------------------------------------------
 *
 * The console's own hardware paths: the 5 pads behind the Turbo Tap on the
 * I/O port at $1000 (H8-19; the read sequence is HuDK include/joypad.s's,
 * MIT, which follows pcetech §4), and the TMA timer at $0C00/$0C01 with its
 * interrupt on vector $FFFA (H8-20..H8-22).  Built only into a ROM whose toy
 * uses them, so a toy without pads or a timer carries none of this.
 */

/* pad[n].field's field as a bit in the runtime's 8-bit pad word: the 2-button
 * pad's own order (I, II, Select, Run, Up, Right, Down, Left), pcetech §4. */
#define TOY_PAD_II 0
#define TOY_PAD_I 1
#define TOY_PAD_SELECT 2
#define TOY_PAD_RUN 3
#define TOY_PAD_UP 4
#define TOY_PAD_RIGHT 5
#define TOY_PAD_DOWN 6
#define TOY_PAD_LEFT 7

/* The IL's padget: 1 while pad n's field is held, 0 otherwise.  n is 1..5. */
int32_t toy_pad(int32_t n, int32_t field);

/* The IL's sat(i, k, v): SAT entry i's word k, written through VRAM $7F00. */
void toy_sat(int32_t i, int32_t k, int32_t v);

/* The IL's sprite(i, spec): one SAT entry composed exactly as the browser's
 * host.sprite composes it (renderer/pce-toyhost.js): word0 = y, word1 = x,
 * word2 = pattern << 1, word3 = palette | SPBG<<7 | CGX<<8 | HFLIP<<11 |
 * CGY<<12 | VFLIP<<15.  The encoder (#133) resolved the spec to six
 * constants and packed the attribute bits into `attr`: spbg bit 0, cgx
 * bit 1, hflip bit 2, vflip bit 3, cgy bits 4-5.  ONE function shared by
 * the interpreter's runtime (tools/ilvm/ilvm_runtime.c), the host harness
 * (tools/ilvm/hostvm.c) and the compiled route (toy_runtime.c), so all
 * three write the same four SAT words through their own toy_sat (#189). */
static inline void toy_sprite(int32_t slot, int32_t x, int32_t y,
                              int32_t pattern, int32_t palette,
                              int32_t attr) {
  toy_sat(slot, 0, y);
  toy_sat(slot, 1, x);
  toy_sat(slot, 2, (pattern << 1) & 0xFFFF);
  toy_sat(slot, 3, (palette | ((attr & 1) << 7) |        /* spbg  */
                    (((attr >> 1) & 1) << 8) |           /* cgx   */
                    (((attr >> 2) & 1) << 11) |          /* hflip */
                    (((attr >> 4) & 3) << 12) |          /* cgy   */
                    (((attr >> 3) & 1) << 15))           /* vflip */
                    & 0xFFFF);
}

/* The IL's timer(period, fn): write the reload register and start the timer
 * (7-bit period; the interrupt is raised every period+1 ticks of 6,991.3 Hz,
 * H8-20..H8-22).  toy_timer_pending() returns and clears the interrupts that
 * happened since the last call, so the generated frame flow can run fn once
 * per interrupt — the same figure the browser host reports. */
void toy_timer_set(int32_t period);
int32_t toy_timer_pending(void);

#endif /* PCE_TOY_RUNTIME_H */
