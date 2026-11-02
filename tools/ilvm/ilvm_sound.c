/* tools/ilvm/ilvm_sound.c — the sound ops shared by both interpreter
 * builds (card #215, shrunk by #220; design: docs/ROM-SOUND.md §7).
 *
 * One source, two halves:
 *
 *   Console (the committed renderer/ilvm.bin): every op's body lives in the
 *   engine's tables bank — the SndGlue routines tools/ilvm/hutrack_engine.asm
 *   assembles at $9000, called by fixed address exactly like the engine's
 *   own entry points.  The wrappers below only clamp the operands, pack the
 *   arguments into the engine's _hk.EAX0 scratch (plus the glue's
 *   snd_args_frames cell) and jsr.  The glue maps MPR5 = 2 / MPR4 = 3 on
 *   its first run (nothing else in the interpreter uses those pages, and
 *   the engine's own bank mapping is push/pop, so the mapping is safe to
 *   leave), reads the data bank's song trailer, and owns every PSG write
 *   and every byte of sound state — its .bss sits inside the engine's — so
 *   the interpreter's 16 KiB image carries none of the sound-op bodies.
 *
 *   Host (tools/ilvm/hostvm.c's build): no ROM, no engine.  The same logic
 *   records the same PSG write streams through ilvm_host_psg_write, using
 *   the committed note table array (tools/ilvm/note-table.h), so the host
 *   harness's psg.txt must equal the browser's rt.sound.events.
 *
 * The op-level semantics are the browser's, with the console's two
 * documented substitutes for the browser's runtime refusals: an out-of-range
 * operand clamps instead of throwing (a ROM has no error channel), and
 * music() with no songs is a no-op.  Both are pinned in tests/check-rom-
 * sound.js's console-only toy.
 *
 * Laziness: the first sound op only maps the engine banks and reads the
 * data bank's song trailer (buildToyRom writes n = 0 today, #199 fills it);
 * the engine's Init (which clears the song list and every SFX reservation)
 * runs only on the first music() call, so a note/sfx-only toy causes no
 * init writes at all — the browser's note() and sfx() write nothing extra
 * either.
 */
#include <stdint.h>
#include "ilvm_sound.h"

/* ---- the browser's constants (renderer/pce-toyhost.js) ----------------- */
#define SOUND_CHANNELS 6
#define SFX_FRAMES_MAX 600

#ifdef ILVM_HOST
/* The host build: the container array stands in for the mapped data bank,
 * and the statics below stand in for the glue's .bss cells. */
extern const uint8_t *ilvm_program;
#include "note-table.h"
extern void ilvm_host_psg_write(uint8_t reg, uint8_t value);
#define DATA_BYTE(off) (ilvm_program[(off)])
#define PSG_WRITE(reg, value) \
  ilvm_host_psg_write((uint8_t)(reg), (uint8_t)(value))

/* The square wave the browser's sfx() uploads: 16 steps at volume 31 then
 * 16 at 0 (SFX_WAVE, pce-toyhost.js).  The console's copy lives in the
 * engine's tables bank next to the SndGlue routines. */
static const uint8_t SFX_WAVE[32] = {
  31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31,
   0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0
};

/* The song table trailer buildToyRom writes at the data bank's end (n songs
 * then up to 8 (addr lo, addr hi, bank) entries; renderer/pce-rom.js). */
#define SONG_TABLE_OFF 0x1FE0
#define MAX_SONGS 8

/* ---- per-boot sound state (the console's copy is the glue's .bss) ------ */
static uint8_t sfx_owned[SOUND_CHANNELS];
static uint16_t sfx_frames[SOUND_CHANNELS];
static uint8_t tick_flag;       /* a song is queued: tick the engine */
static uint8_t mapped;          /* engine banks mapped, trailer read */
static uint8_t n_songs;
static uint8_t song_lo[MAX_SONGS], song_hi[MAX_SONGS], song_bank[MAX_SONGS];

void ilvm_sound_reset(void) {
  uint8_t i;
  for (i = 0; i < SOUND_CHANNELS; i++) {
    sfx_owned[i] = 0;
    sfx_frames[i] = 0;
  }
  tick_flag = 0;
  mapped = 0;
  n_songs = 0;
}

/* The first sound op of the boot: map the engine banks (console) and read
 * the song trailer (both).  Engine Init deliberately does NOT run here —
 * a note/sfx-only toy must cause no engine writes at all. */
static void sound_map(void) {
  uint8_t i;
  if (mapped) return;
  mapped = 1;
  n_songs = DATA_BYTE(SONG_TABLE_OFF);
  if (n_songs > MAX_SONGS) n_songs = MAX_SONGS;   /* corrupt trailer guard */
  for (i = 0; i < n_songs; i++) {
    song_lo[i] = DATA_BYTE((uint16_t)(SONG_TABLE_OFF + 1 + i * 3));
    song_hi[i] = DATA_BYTE((uint16_t)(SONG_TABLE_OFF + 2 + i * 3));
    song_bank[i] = DATA_BYTE((uint16_t)(SONG_TABLE_OFF + 3 + i * 3));
  }
}

int32_t ilvm_note(int32_t midi) {
  sound_map();
  /* The table's ends reproduce the browser for every other midi: below 0
   * the formula clamps to 4095 (entry 0) and from 512 on it is 0. */
  if (midi < 0) midi = 0;
  if (midi > 511) midi = 511;
  return NOTE_TABLE[midi];
}

void ilvm_sfx(uint8_t ch, int32_t freq, int32_t volume, int32_t frames) {
  uint8_t i;
  if (ch > SOUND_CHANNELS - 1) return;      /* browser: sfx-range refusal */
  sound_map();
  freq &= 0x0FFF;                           /* browser: sfx-range refusal */
  volume &= 0x1F;
  if (frames < 1) frames = 1;
  if (frames > SFX_FRAMES_MAX) frames = SFX_FRAMES_MAX;

  if (!sfx_owned[ch]) {
    sfx_owned[ch] = 1;
    /* The browser's reserveWrites, byte for byte: inProgress and waitNote
     * bits plus the reserve writes. */
    PSG_WRITE(0, ch);
    PSG_WRITE(4, 0);
    PSG_WRITE(7, 0);
    if (ch < 2) PSG_WRITE(9, 0);
    PSG_WRITE(5, 0xFF);
  }

  /* The square-wave upload (the browser's sfx(), identical order): the
   * $40 -> $00 on control resets the PSG's 32-step pointer, the 32 R6
   * writes fill it, then F and control start it in WAVEFORM mode. */
  PSG_WRITE(0, ch);
  PSG_WRITE(4, 0x40);
  PSG_WRITE(4, 0x00);
  for (i = 0; i < 32; i++) PSG_WRITE(6, SFX_WAVE[i]);
  PSG_WRITE(0, ch);
  PSG_WRITE(2, (uint8_t)freq);
  PSG_WRITE(3, (uint8_t)(freq >> 8));
  PSG_WRITE(4, (uint8_t)(0x80 | volume));

  sfx_frames[ch] = (uint16_t)frames;
}

void ilvm_release(uint8_t ch) {
  if (ch > SOUND_CHANNELS - 1) return;      /* browser: sfx-range refusal */
  if (!sfx_owned[ch]) return;               /* browser: silent return */
  sfx_owned[ch] = 0;
  sfx_frames[ch] = 0;
  PSG_WRITE(0, ch);                         /* browser releaseWrites */
  PSG_WRITE(4, 0);
  PSG_WRITE(7, 0);
  if (ch < 2) PSG_WRITE(9, 0);
}

/* music(index): queue and play.  The browser refuses music-range; the
 * console no-ops on a bad index or an empty table instead. */
void ilvm_music(uint8_t index) {
  uint8_t i;
  sound_map();
  if (index >= n_songs) return;
  /* The browser's createPlayer — one init stream (R1 then every channel's
   * power-on state), then the reserves.  The browser writes two streams
   * per music(); the engine's own Init runs once per boot and playSong's
   * Reset carries the later calls, so the console's repeated-music stream
   * is one — the known model divergence docs/ROM-SOUND.md §7 records,
   * unexercised while n = 0 (#199). */
  PSG_WRITE(1, 0xFF);
  for (i = 0; i < SOUND_CHANNELS; i++) {
    PSG_WRITE(0, i);
    PSG_WRITE(5, 0xFF);
    PSG_WRITE(4, 0x40);
    PSG_WRITE(4, 0x00);
    PSG_WRITE(7, 0x00);
    for (uint8_t s = 0; s < 32; s++) PSG_WRITE(6, 0x00);
  }
  tick_flag = 1;
}

/* One toy frame, before frame(): run down the SFX timers (a channel whose
 * frames reach 0 is released), then tick the engine if a song is queued.
 * The browser's tickSound order: releases first, then the player. */
void ilvm_sound_tick(void) {
  uint8_t i;
  for (i = 0; i < SOUND_CHANNELS; i++) {
    if (!sfx_owned[i] || sfx_frames[i] == 0) continue;
    sfx_frames[i]--;
    if (sfx_frames[i] == 0) ilvm_release(i);
  }
  /* The host model has no engine; the player's ticks are the console's. */
  if (!tick_flag) return;
}

#else
/* The console build: thin wrappers around the SndGlue routines (see the
 * file header and docs/ROM-SOUND.md §7).  The glue owns the clamps (it is
 * 16-bit and its bank has room; the interpreter's 16 KiB image does not —
 * #220), so each wrapper only normalizes what needs the i32 sign, packs
 * the arguments, and jsr's the glue's fixed address from
 * tools/gen/hutrack-symbols.h.  The glue returns with rts and takes the
 * arguments in the engine's zero-page _hk.EAX0 (plus snd_args_frames for
 * sfx()'s frames), which the C runtime never uses for locals — the
 * wrappers write them straight through, no spills. */
#include "hutrack-symbols.h"

/* A direct jsr to a fixed address, like the engine's own entry points.
 * A/X/Y and memory are clobbered: the glue runs a whole op body. */
#define GLUE_CALL(name) \
  __asm__ volatile ("jsr %0" : : "i" (HUTRACK_##name) \
                    : "a", "x", "y", "memory")

static void set_eax0(uint8_t i, uint8_t v) {
  *(volatile uint8_t *)(HUTRACK_HK_EAX0 + i) = v;
}

/* Inlined: the whole body of each wrapper is the argument pack and one
 * jsr; outlined, the shared pargs plumbing makes the image larger (#220). */
void ilvm_sound_reset(void) {
  GLUE_CALL(SND_RESET);
}

int32_t ilvm_note(const int32_t *pargs) {
  int32_t midi = pargs[0];
  /* The glue clamps >= 512 to 511 (the formula is 0 there); only the sign
   * needs the i32 here — a negative midi clamps to entry 0 (4095). */
  if (midi < 0) midi = 0;
  set_eax0(0, (uint8_t)midi);
  set_eax0(1, (uint8_t)(midi >> 8));
  GLUE_CALL(SND_NOTE);
  /* The glue leaves the 12-bit F in EAX0.l/m. */
  return *(volatile const uint8_t *)(HUTRACK_HK_EAX0 + 0) |
         (int32_t)*(volatile const uint8_t *)(HUTRACK_HK_EAX0 + 1) << 8;
}

void ilvm_sfx(const int32_t *pargs) {
  /* The glue clamps ch/freq/volume/frames (browser: sfx-range refusal);
   * only the frames sign needs the i32 here — a negative frames count is
   * the browser's "below 1", which clamps to 1. */
  int32_t frames = pargs[3];
  if (frames < 0) frames = 0;
  set_eax0(0, (uint8_t)pargs[0]);
  set_eax0(1, (uint8_t)pargs[1]);           /* EAX0.m: F lo */
  set_eax0(2, (uint8_t)(pargs[1] >> 8));    /* EAX0.h: F hi */
  set_eax0(3, (uint8_t)pargs[2]);           /* EAX0.u: volume */
  *(volatile uint8_t *)(HUTRACK_SND_FRAMES) = (uint8_t)frames;
  *(volatile uint8_t *)(HUTRACK_SND_FRAMES + 1) = (uint8_t)(frames >> 8);
  GLUE_CALL(SND_SFX);
}

void ilvm_release(const int32_t *pargs) {
  /* The glue no-ops on a channel out of range or one SFX does not own,
   * exactly the browser's silent return. */
  set_eax0(0, (uint8_t)pargs[0]);
  GLUE_CALL(SND_RELEASE);
}

void ilvm_music(const int32_t *pargs) {
  set_eax0(0, (uint8_t)pargs[0]);
  GLUE_CALL(SND_MUSIC);
}

void ilvm_sound_tick(void) {
  GLUE_CALL(SND_TICK);
}
#endif
