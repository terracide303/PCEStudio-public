/* tests/hostc/stub_runtime.c — a host stand-in for the console runtime
 * (tools/toyc/toy_runtime.c), so the C that pce-cgen.js emits can be run on the
 * machine that builds it and compared with the browser (tools/host-c-compare.js).
 * VRAM, the colour table and the sprite list are plain arrays; the pad is idle;
 * sound, art loading and the timer do nothing.  The initial VRAM image (the
 * importer's picture) comes from a file given as argv[2]. */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include "toy_runtime.h"

uint16_t host_vram[65536];
uint16_t host_cram[512];

void toy_pal(int32_t a, int32_t w) { host_cram[a & 511] = (uint16_t)w; }
void toy_reg(int32_t which, int32_t value) { (void)which; (void)value; }
void toy_vram_set(int32_t a, int32_t w) { host_vram[a & 0xFFFF] = (uint16_t)w; }
void toy_sat(int32_t i, int32_t k, int32_t v) {
  if (i < 0 || i > 63 || k < 0 || k > 3) return;
  host_vram[0x7F00 + i * 4 + k] = (uint16_t)v;
}
int32_t toy_pad(int32_t n, int32_t field) { (void)n; (void)field; return 0; }
void toy_timer_set(int32_t period) { (void)period; }
int32_t toy_timer_pending(void) { return 0; }
void toy_wait_vblank(void) {}
void toy_display_on(void) {}
void toy_measure_begin(void) {}
void toy_measure_end(void) {}
void toy_measure_raster_begin(void) {}
void toy_measure_raster_end(void) {}
void toy_assets_boot(void) {}
void toy_sound_boot(void) {}
void toy_sound_tick(void) {}
int32_t toy_note(int32_t m) { (void)m; return 0; }
void toy_sfx(int32_t a, int32_t b, int32_t c, int32_t d) { (void)a; (void)b; (void)c; (void)d; }
void toy_release(int32_t a) { (void)a; }
void toy_music(int32_t a) { (void)a; }

extern void toy_boot(void);
extern void toy_frame(int32_t f);

int main(int argc, char **argv) {
  int frames = argc > 1 ? atoi(argv[1]) : 60, f, k;
  if (argc > 2) {
    FILE *fp = fopen(argv[2], "rb");
    if (fp) { if (fread(host_vram, 2, 32768, fp)) {} fclose(fp); }
  }
  toy_boot();
  for (f = 0; f < frames; f++) {
    toy_frame(f);
    printf("F %d", f);
    for (k = 0; k < 256; k++) printf(" %x", host_vram[0x7F00 + k]);
    printf("\n");
  }
  return 0;
}
