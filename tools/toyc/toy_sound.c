/* tools/toyc/toy_sound.c — see toy_sound.h.  Mirrors the console half of
 * tools/ilvm/ilvm_sound.c; the glue owns every clamp and every PSG write. */
#include <pce.h>
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

#ifdef TOY_SAMPLE_BUILD
static void toy_smp_boot(void);
#endif

void toy_sound_boot(void) {
  /* Engine banks into pages 4 and 5 and the song bank into page 2, before the
   * glue's reset and the first tick can run (the interpreter does the same at
   * boot; the glue's SndGlueMap re-maps 4 and 5 on its first op, harmlessly). */
  __asm__ volatile ("tam #$10" : : "a" ((uint8_t)HUTRACK_TABLES_BANK));
  __asm__ volatile ("tam #$20" : : "a" ((uint8_t)HUTRACK_CODE_BANK));
  __asm__ volatile ("tam #$04" : : "a" ((uint8_t)TOY_SONG_BANK));
  GLUE_CALL(SND_RESET);
#ifdef TOY_SAMPLE_BUILD
  toy_smp_boot();
#endif
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

#ifdef TOY_SAMPLE_BUILD
/* ---- sample(name, channel): DDA playback from the timer interrupt (docs/NATIVE-SOUND.md) -------
 *
 * renderer/pce-sample.js is the model.  The toy's samples are one 8 KiB ROM bank (tools/native-
 * samples.js): a count, then per sample its offset, length and the timer divisor.  The timer ticks
 * every 1,024 CPU cycles; a reload of div-1 makes an interrupt every div ticks, and each interrupt
 * writes ONE step to the sample's channel: it maps the sample bank into page 3 ($6000) for the
 * read and puts the page back, selects the channel, writes R6 (the channel is in DDA mode), and
 * puts the PSG's channel select back where the interrupted code had it (the engine records it in
 * psg_sel: the engine is built with SAMPLE_SHADOW, tools/ilvm/build-engine.sh).  When the last step
 * is written it stops the timer itself.  The channel is taken and given back by the same glue
 * calls sfx() uses (toy_sfx for the reserve, the release after the held frames), so the music
 * on the other channels is the engine's, untouched.
 *
 * Handler cost: see docs/NATIVE-SOUND.md "Samples" (measured, not modelled).
 * DDA_LOG: a test-only ring of the steps written (the engine's own PSG log does not see them). */
#define S2(x) #x
#define S(x) S2(x)
extern const uint8_t toy_smp_bank;          /* the generated tools/native-samples.js output */
volatile uint8_t toy_smp_on, toy_smp_ch, toy_smp_bankn, toy_smp_endlo, toy_smp_endhi;
volatile uint8_t toy_smp_cur;               /* the channel last given a sample (to release it) */
#ifdef TOY_DDA_LOG
#define DDA_LOG_MAX 1600
uint8_t toy_dda_log[DDA_LOG_MAX];
#define LOG_ASM \
  "  sta (toy_dda_ptr)\n" \
  "  inc toy_dda_ptr\n" \
  "  bne 3f\n" \
  "  inc toy_dda_ptr+1\n" \
  "3:\n"
#define LOG_ZP ".global toy_dda_ptr\ntoy_dda_ptr: .zero 2\n"
#else
#define LOG_ASM ""
#define LOG_ZP ""
#endif
__asm__(
".section .zp.bss,\"aw\",@nobits\n"
".global toy_smp_ptr\n"
"toy_smp_ptr: .zero 2\n"
LOG_ZP
".text\n"
".global irq_timer\n"
".type irq_timer,@function\n"
"irq_timer:\n"
"  pha\n"
"  sta 0x1403\n"                       /* acknowledge TIQ */
"  lda toy_smp_on\n"
"  beq 9f\n"
"  tma #8\n"
"  pha\n"
"  lda toy_smp_bankn\n"
"  tam #8\n"
"  lda " S(HUTRACK_PSG_SEL) "\n"
"  pha\n"
"  lda toy_smp_ch\n"
"  sta 0x800\n"
"  lda (toy_smp_ptr)\n"
"  sta 0x806\n"
LOG_ASM
"  inc toy_smp_ptr\n"
"  bne 1f\n"
"  inc toy_smp_ptr+1\n"
"1:\n"
"  lda toy_smp_ptr+1\n"
"  cmp toy_smp_endhi\n"
"  bne 2f\n"
"  lda toy_smp_ptr\n"
"  cmp toy_smp_endlo\n"
"  bne 2f\n"
"  stz 0x0c01\n"                       /* the last step is out: stop the timer */
"  stz toy_smp_on\n"
"2:\n"
"  pla\n"
"  sta 0x800\n"
"  pla\n"
"  tam #8\n"
"9:\n"
"  pla\n"
"  rti\n"
".size irq_timer, . - irq_timer\n"
);
extern volatile uint8_t toy_smp_ptr_c[2] __asm__("toy_smp_ptr");
#ifdef TOY_DDA_LOG
extern volatile uint8_t toy_dda_ptr_c[2] __asm__("toy_dda_ptr");
#endif

/* The bank's own bytes through page 3, with the interrupt's own save and restore of the page
 * making it safe against the handler. */
static uint8_t smp_byte(uint16_t off) {
  return *(volatile const uint8_t *)(0x6000u + off);
}

static void toy_smp_boot(void) {
  toy_smp_cur = 0xFF;
  toy_smp_on = 0;
#ifdef TOY_DDA_LOG
  toy_dda_ptr_c[0] = (uint8_t)(uintptr_t)toy_dda_log;
  toy_dda_ptr_c[1] = (uint8_t)((uintptr_t)toy_dda_log >> 8);
#endif
}

void toy_sample(int32_t ref, int32_t ch) {
  uint8_t prev;
  uint16_t off, len;
  uint8_t div, count;
  uint32_t hold;
  /* stop the one sample that may be playing, and give its channel back (the model's release) */
  *IO_TIMER_CONTROL = 0;
  if (toy_smp_cur != 0xFF) { toy_release(toy_smp_cur); }
  toy_smp_on = 0;
  __asm__ volatile ("tma #8" : "=a" (prev));
  __asm__ volatile ("tam #8" : : "a" (toy_smp_bank));
  count = smp_byte(0);
  if ((uint32_t)ref >= count) ref = 0;
  off = (uint16_t)(smp_byte(8 + 8 * (uint8_t)ref) | ((uint16_t)smp_byte(9 + 8 * (uint8_t)ref) << 8));
  len = (uint16_t)(smp_byte(10 + 8 * (uint8_t)ref) | ((uint16_t)smp_byte(11 + 8 * (uint8_t)ref) << 8));
  div = smp_byte(12 + 8 * (uint8_t)ref);
  __asm__ volatile ("tam #8" : : "a" (prev));
  /* the frames the channel is held: renderer/pce-sample.js holdFrames */
  hold = ((uint32_t)len * div * 1024u - 1u) / 119210u + 2u;
  toy_sfx(ch, 0, 0, (int32_t)hold);
  /* the DDA setup: select (and record it for the interrupt), then R4 = channel on, DDA, level 31 */
  *(volatile uint8_t *)HUTRACK_PSG_SEL = (uint8_t)ch;
  *(volatile uint8_t *)0x0800 = (uint8_t)ch;
  *(volatile uint8_t *)0x0804 = 0xC0 | 31;
  toy_smp_cur = (uint8_t)ch;
  toy_smp_ch = (uint8_t)ch;
  toy_smp_bankn = toy_smp_bank;
  toy_smp_ptr_c[0] = (uint8_t)off; toy_smp_ptr_c[1] = (uint8_t)((0x6000u + off) >> 8);
  toy_smp_endlo = (uint8_t)(off + len); toy_smp_endhi = (uint8_t)((0x6000u + off + len) >> 8);
#ifdef TOY_DDA_LOG
#endif
  toy_smp_on = 1;
  *IO_TIMER_COUNTER = (uint8_t)(div - 1);
  *IO_TIMER_CONTROL = TIMER_ON;
  pce_irq_enable(IRQ_TIMER);
  pce_cpu_irq_enable();
}
#endif /* TOY_SAMPLE_BUILD */
