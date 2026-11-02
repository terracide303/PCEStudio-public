/* tools/ilvm/ilvm_sound.h — the interpreter's sound ops (card #215, #220;
 * design: docs/ROM-SOUND.md §7).
 *
 * tools/ilvm/ilvm_sound.c implements these for both builds: the console
 * jsr's the sound-op glue in the engine's tables bank (assembled by
 * tools/ilvm/build-engine.sh, called by fixed address from the generated
 * tools/gen/hutrack-symbols.h); the host build (ILVM_HOST) runs the same
 * op-level logic and records the same PSG write streams through hostvm.c's
 * ilvm_host_psg_write so tests/check-rom-sound.js can compare them to the
 * browser's rt.sound.events without an emulator.
 */
#ifndef ILVM_SOUND_H
#define ILVM_SOUND_H

#include <stdint.h>

/* Called by toy_boot for every boot: all sound state back to idle. */
void ilvm_sound_reset(void);

#ifdef ILVM_HOST
/* note(midi): the PSG's 12-bit F from the committed array; the table is the
 * browser's own formula. */
int32_t ilvm_note(int32_t midi);

/* music(index): queue and play a song from the data bank's trailer (the
 * first call also initializes the engine).  Out of range is a no-op — the
 * browser refuses music-range, but the console cannot, and a toy that
 * shipped with n songs must not hang or fault on a bad index. */
void ilvm_music(uint8_t index);

/* sfx(ch, freq, volume, frames): reserve the channel, load a square wave
 * and auto-release after frames frames.  Out-of-range operands clamp
 * (browser: sfx-range refusal); a channel out of 0..5 is a no-op. */
void ilvm_sfx(uint8_t ch, int32_t freq, int32_t volume, int32_t frames);

/* release(ch): give the channel back; a channel no SFX owns is a no-op
 * (the browser returns too, and the engine's chanReleaseSFX would no-op
 * on its inProgress bit). */
void ilvm_release(uint8_t ch);
#else
/* The console build takes the dispatch's pargs array directly: exec passes
 * one zero-page pointer instead of materializing four 32-bit arguments
 * across the ABI boundary (#220).  The glue owns the operand clamps. */
int32_t ilvm_note(const int32_t *pargs);
void ilvm_music(const int32_t *pargs);
void ilvm_sfx(const int32_t *pargs);
void ilvm_release(const int32_t *pargs);
#endif

/* Once per toy frame, before frame(): run down the SFX timers and, if a
 * song is playing, tick the engine (docs/ROM-SOUND.md §4). */
void ilvm_sound_tick(void);

#endif /* ILVM_SOUND_H */
