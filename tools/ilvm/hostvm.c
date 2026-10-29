/*
 * hostvm.c — run tools/ilvm/ilvm.c's interpreter on the host (development
 * instrument, card #100).
 *
 *   cc -DILVM_HOST -O2 -I tools/toyc tools/ilvm/ilvm.c tools/ilvm/hostvm.c \
 *      -o hostvm
 *   hostvm palette.ilbc OUTDIR 16
 *
 * Loads one bytecode container, runs toy_boot(), then `frames` frames the
 * way the console's main loop does (frame, then raster(0..223) when the toy
 * has a callback), and writes vram.bin (65536 B, words little-endian),
 * cram.bin (1024 B), sat.bin (512 B) and regs.txt.  Those are the same
 * layouts the Mednafen dump uses, so a host run can be compared with the
 * browser before an emulator is involved.
 *
 * The host is not the console: it does not model the VDC's timing, the RCR
 * chain or the base deferral.  It answers "does the interpreter compute the
 * toy's writes", not "does the console show them".
 */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

const uint8_t *ilvm_program;
int ilvm_has_raster(void);

void toy_boot(void);
void toy_frame(int32_t f);
void toy_raster(int32_t line);

static uint16_t vram[32768];
static uint16_t cram[512];
static uint16_t sat[256];
static int32_t regs[3];

void toy_vram_set(int32_t addr, int32_t word) {
  vram[addr & 0x7FFF] = (uint16_t)word;
}

void toy_pal(int32_t addr, int32_t word) {
  cram[addr & 0x1FF] = (uint16_t)(word & 0x1FF);
}

void toy_reg(int32_t which, int32_t value) {
  if (which >= 0 && which < 3) regs[which] = value;
}

void toy_display_on(void) {}

int32_t toy_rgb(int32_t r, int32_t g, int32_t b) {
  return (int32_t)(((uint32_t)(g & 7) * 64u) +
                   ((uint32_t)(r & 7) * 8u) +
                   (uint32_t)(b & 7));
}

static void put_u16(FILE *f, const uint16_t *w, int n) {
  int i;
  for (i = 0; i < n; i++) {
    fputc(w[i] & 0xFF, f);
    fputc((w[i] >> 8) & 0xFF, f);
  }
}

int main(int argc, char **argv) {
  FILE *f;
  long size;
  uint8_t *buf;
  int frames, i, l;
  char path[4096];

  if (argc < 4) {
    fprintf(stderr, "usage: hostvm PROGRAM.ilbc OUTDIR FRAMES\n");
    return 2;
  }
  frames = atoi(argv[3]);

  f = fopen(argv[1], "rb");
  if (!f) { perror(argv[1]); return 1; }
  fseek(f, 0, SEEK_END);
  size = ftell(f);
  fseek(f, 0, SEEK_SET);
  buf = (uint8_t *)malloc((size_t)size);
  if (!buf || fread(buf, 1, (size_t)size, f) != (size_t)size) {
    fprintf(stderr, "short read\n");
    return 1;
  }
  fclose(f);
  ilvm_program = buf;

  toy_boot();
  for (i = 0; i < frames; i++) {
    toy_frame(i);
    if (ilvm_has_raster()) {
      for (l = 0; l < 224; l++) toy_raster(l);
    }
  }

  snprintf(path, sizeof path, "%s/vram.bin", argv[2]);
  f = fopen(path, "wb"); put_u16(f, vram, 32768); fclose(f);
  snprintf(path, sizeof path, "%s/cram.bin", argv[2]);
  f = fopen(path, "wb"); put_u16(f, cram, 512); fclose(f);
  snprintf(path, sizeof path, "%s/sat.bin", argv[2]);
  f = fopen(path, "wb"); put_u16(f, sat, 256); fclose(f);
  snprintf(path, sizeof path, "%s/regs.txt", argv[2]);
  f = fopen(path, "w");
  fprintf(f, "BXR %d\nBYR %d\nCR %d\n", regs[0], regs[1], regs[2]);
  fclose(f);
  free(buf);
  return 0;
}
