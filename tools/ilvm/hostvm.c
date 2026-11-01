/*
 * hostvm.c — run tools/ilvm/ilvm.c's interpreter on the host (development
 * instrument, card #100).
 *
 *   cc -DILVM_HOST -O2 -I tools/toyc tools/ilvm/ilvm.c tools/ilvm/hostvm.c \
 *      -o hostvm
 *   hostvm palette.ilbc OUTDIR 16 [PADFILE]
 *
 * Loads one bytecode container, runs toy_boot(), then `frames` frames the
 * way the console's main loop does (frame, then raster(0..223) when the toy
 * has a callback), and writes vram.bin (65536 B, words little-endian),
 * cram.bin (1024 B), sat.bin (512 B), regs.txt and pool.bin (the table
 * pool, one int32 per cell, #174's fault evidence).  Those are the same
 * layouts the Mednafen dump uses, so a host run can be compared with the
 * browser before an emulator is involved.
 *
 * The optional PADFILE scripts the pads (#185), one change per line:
 *
 *   <frame> <pad> <button> <button> ...
 *
 * with the button names tools/toyc/toy_runtime.h's TOY_PAD_* bits use:
 * ii i select run up right down left.  A line replaces the pad's state (the
 * browser's rt.setPad does the same, renderer/pce-il.js), so it holds until
 * the next line; pads start empty, as the browser's do.  Unknown names or
 * pads are errors, not typos to shrug off.
 *
 * The host is not the console: it does not model the VDC's timing, the RCR
 * chain or the base deferral.  It answers "does the interpreter compute the
 * toy's writes", not "does the console show them".
 *
 * The state starts where the browser IL run starts it (renderer/pce-toyhost.js
 * createHost): VRAM/CRAM/SAT zeroed and CR already on (BB, 0x80).  A toy that
 * never writes CR must report 0x80 here, not 0, or tests/check-ilvm.js's
 * checkHostParity would compare two different power-on states.
 */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* The shared toy surface (tools/toyc/toy_runtime.h): toy_rgb and the one
 * toy_sprite (#189) come from the header so the host harness and the
 * console runtimes agree on the sprite's four SAT words.  toy_sat below
 * writes this harness's SATB image, so the header's toy_sprite lands in
 * the same 256 words the console's VRAM/DSR path ends with. */
#include "toy_runtime.h"

const uint8_t *ilvm_program;
int ilvm_has_raster(void);

void toy_boot(void);
void toy_frame(int32_t f);
void toy_raster(int32_t line);

/* the interpreter's table pool (tools/ilvm/ilvm.c), dumped as pool.bin */
const int32_t *ilvm_table_cells(void);
int ilvm_table_cell_count(void);

static uint16_t vram[32768];
static uint16_t cram[512];
static uint16_t sat[256];
/* regs[0..2] is BXR, BYR, CR (encoder's ids, docs/IL.md §14); CR starts on
 * as the browser host starts it. */
static int32_t regs[3] = { 0, 0, 0x80 };

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

/* toy_rgb is the shared header's (tools/toyc/toy_runtime.h), the same
 * 9-bit formula the console runs. */

/* ---- the SAT (#186) ---- */

/* The host models SATB the way the browser host does (renderer/
 * pce-toyhost.js's host.sat): the word goes into the SATB image, not into
 * VRAM.  The console's toy_sat writes VRAM $7F00 + i*4 + k and its DSR DMA
 * mirrors it into SATB, so both sides end with the same 256 words — which
 * is what sat.bin dumps.  Out of range is ignored, like the console's. */
void toy_sat(int32_t i, int32_t k, int32_t v) {
  if (i < 0 || i > 63 || k < 0 || k > 3) return;
  sat[i * 4 + k] = (uint16_t)v;
}

/* ---- the pads (#185): TOY_PAD_* bits, tools/toyc/toy_runtime.h ---- */

/* One byte per pad, 1 meaning held: II 0, I 1, Select 2, Run 3, Up 4,
 * Right 5, Down 6, Left 7 — the layout toy_pad() reads on the console
 * (tools/ilvm/ilvm_runtime.c's joy_scan) and the host model's. */
static uint8_t pads[5];

int32_t toy_pad(int32_t n, int32_t field) {
  if (n < 1 || n > 5) return 0;
  if (field < 0 || field > 7) return 0;
  return (pads[n - 1] >> field) & 1;
}

static const char *pad_names[8] = {
  "ii", "i", "select", "run", "up", "right", "down", "left"
};

#define PAD_LINES 256
static int npad_lines;
static struct { int frame, pad; uint8_t bits; } pad_lines[PAD_LINES];

/* Load the PADFILE: each line is "<frame> <pad> <button> ..." and replaces
 * that pad's state when its frame comes up.  Unknown names or pads are hard
 * errors — a scripted-pad typo silently reading as "no pad" would make a
 * passing check meaningless. */
static int load_pads(const char *path) {
  FILE *pf = fopen(path, "r");
  char line[128];
  if (!pf) { perror(path); return 1; }
  while (fgets(line, sizeof line, pf)) {
    int fr, pn, k;
    char tok[16];
    char *p = line;
    uint8_t bits = 0;
    if (sscanf(p, "%d %d %n", &fr, &pn, &k) < 2) continue;
    p += k;
    while (sscanf(p, "%15s %n", tok, &k) == 1) {
      int b;
      p += k;
      for (b = 0; b < 8 && strcmp(tok, pad_names[b]) != 0; b++) {
      }
      if (b == 8) {
        fprintf(stderr, "padfile %s: unknown button '%s'\n", path, tok);
        return 1;
      }
      bits |= (uint8_t)(1 << b);
    }
    if (pn < 1 || pn > 5) {
      fprintf(stderr, "padfile %s: pad %d out of range\n", path, pn);
      return 1;
    }
    if (npad_lines == PAD_LINES) {
      fprintf(stderr, "padfile %s: more than %d lines\n", path, PAD_LINES);
      return 1;
    }
    pad_lines[npad_lines].frame = fr;
    pad_lines[npad_lines].pad = pn;
    pad_lines[npad_lines].bits = bits;
    npad_lines++;
  }
  fclose(pf);
  return 0;
}

static void put_u16(FILE *f, const uint16_t *w, int n) {
  int i;
  for (i = 0; i < n; i++) {
    fputc(w[i] & 0xFF, f);
    fputc((w[i] >> 8) & 0xFF, f);
  }
}

static void put_u32(FILE *f, const int32_t *w, int n) {
  int i;
  for (i = 0; i < n; i++) {
    uint32_t v = (uint32_t)w[i];
    fputc(v & 0xFF, f);
    fputc((v >> 8) & 0xFF, f);
    fputc((v >> 16) & 0xFF, f);
    fputc((v >> 24) & 0xFF, f);
  }
}

int main(int argc, char **argv) {
  FILE *f;
  long size;
  uint8_t *buf;
  int frames, i, l;
  char path[4096];

  if (argc < 4) {
    fprintf(stderr, "usage: hostvm PROGRAM.ilbc OUTDIR FRAMES [PADFILE]\n");
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

  if (argc >= 5 && load_pads(argv[4]) != 0) {
    return 1;
  }

  toy_boot();
  for (i = 0; i < frames; i++) {
    int pl;
    for (pl = 0; pl < npad_lines; pl++) {
      if (pad_lines[pl].frame == i) {
        pads[pad_lines[pl].pad - 1] = pad_lines[pl].bits;
      }
    }
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
  snprintf(path, sizeof path, "%s/pool.bin", argv[2]);
  f = fopen(path, "wb");
  put_u32(f, ilvm_table_cells(), ilvm_table_cell_count());
  fclose(f);
  free(buf);
  return 0;
}
