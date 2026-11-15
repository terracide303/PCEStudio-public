/* tools/toyc/toy_sound.c — see toy_sound.h.  Mirrors the console half of
 * tools/ilvm/ilvm_sound.c; the glue owns every clamp and every PSG write. */
#include <stdint.h>
#include "toy_sound.h"
#include "hutrack-symbols.h"

#define TOY_SONG_BANK 4u   /* the song bank's physical number, page 2 */

/* A direct jsr to a fixed address; A/X/Y and memory are clobbered. */
#define GLUE_CALL(name) \
  __asm__ volatile ("jsr %0" : : "i" (HUTRACK_##name) : "a", "x", "y", "memory")

static void set_eax0(uint8_t i, uint8_t v) {
  *(volatile uint8_t *)(HUTRACK_HK_EAX0 + i) = v;
}

void toy_sound_boot(void) {
  /* Engine banks into pages 4 and 5 and the song bank into page 2, before the
   * glue's reset and the first tick can run (the interpreter does the same at
   * boot; the glue's SndGlueMap re-maps 4 and 5 on its first op, harmlessly). */
  __asm__ volatile ("tam #$10" : : "a" ((uint8_t)HUTRACK_TABLES_BANK));
  __asm__ volatile ("tam #$20" : : "a" ((uint8_t)HUTRACK_CODE_BANK));
  __asm__ volatile ("tam #$04" : : "a" ((uint8_t)TOY_SONG_BANK));
  GLUE_CALL(SND_RESET);
}

void toy_sound_tick(void) {
  GLUE_CALL(SND_TICK);
}

int32_t toy_note(int32_t midi) {
  /* The glue clamps >= 512 to 511; only the sign needs the i32 here. */
  if (midi < 0) midi = 0;
  set_eax0(0, (uint8_t)midi);
  set_eax0(1, (uint8_t)(midi >> 8));
  GLUE_CALL(SND_NOTE);
  return *(volatile const uint8_t *)(HUTRACK_HK_EAX0 + 0) |
         (int32_t)*(volatile const uint8_t *)(HUTRACK_HK_EAX0 + 1) << 8;
}

void toy_sfx(int32_t ch, int32_t freq, int32_t volume, int32_t frames) {
  if (frames < 0) frames = 0;
  set_eax0(0, (uint8_t)ch);
  set_eax0(1, (uint8_t)freq);
  set_eax0(2, (uint8_t)(freq >> 8));
  set_eax0(3, (uint8_t)volume);
  *(volatile uint8_t *)(HUTRACK_SND_FRAMES) = (uint8_t)frames;
  *(volatile uint8_t *)(HUTRACK_SND_FRAMES + 1) = (uint8_t)(frames >> 8);
  GLUE_CALL(SND_SFX);
}

/* sfx_fx(channel, wave, from, to, volume, attack, decay, frames): the same
 * three ops the interpreter runs (tools/ilvm/hutrack_engine.asm SndGlueFxOp):
 * the op kind in bits 8..15 of the first operand, the rest the call's own. */
static void fx_op(int32_t kind, int32_t a, int32_t b, int32_t c) {
  int32_t op[4];
  op[0] = kind << 8; op[1] = a; op[2] = b; op[3] = c;
  set_eax0(0, (uint8_t)(uintptr_t)op);
  set_eax0(1, (uint8_t)((uintptr_t)op >> 8));
  GLUE_CALL(SND_SFXOP);
}

void toy_sfx_fx(int32_t ch, int32_t wave, int32_t from, int32_t to,
                int32_t volume, int32_t attack, int32_t decay,
                int32_t frames) {
  fx_op(1, from, to, volume);
  fx_op(2, wave, attack, decay);
  fx_op(3, ch, frames, 0);
}

void toy_release(int32_t ch) {
  set_eax0(0, (uint8_t)ch);
  GLUE_CALL(SND_RELEASE);
}

void toy_music(int32_t song) {
  set_eax0(0, (uint8_t)song);
  GLUE_CALL(SND_MUSIC);
}
