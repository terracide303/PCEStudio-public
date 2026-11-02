/* tools/ilvm/ilvm_sound.c — the sound ops shared by both interpreter
 * builds (card #215; design: docs/ROM-SOUND.md §7).
 *
 * One source, two halves:
 *
 *   Console (the committed renderer/ilvm.bin): the HuTrack engine banks are
 *   physical banks 2 (code, page 5) and 3 (tables, page 4).  The first
 *   sound op maps MPR5 = 2 and MPR4 = 3 (nothing else in the interpreter
 *   uses those pages, and the engine's own bank mapping is push/pop, so the
 *   mapping is safe to leave); note() then reads the ROM table at $8C00 and
 *   the music/sfx/release ops call the engine's fixed entry points from
 *   tools/gen/hutrack-symbols.h.  The engine does its own PSG writes; the
 *   sfx square-wave upload is written by C, exactly the byte sequence the
 *   browser's sfx() writes (renderer/pce-toyhost.js).
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

#ifdef ILVM_HOST
/* The host build: the container array stands in for the mapped data bank. */
extern const uint8_t *ilvm_program;
#include "note-table.h"
extern void ilvm_host_psg_write(uint8_t reg, uint8_t value);
#define DATA_BYTE(off) (ilvm_program[(off)])
#define PSG_WRITE(reg, value) \
  ilvm_host_psg_write((uint8_t)(reg), (uint8_t)(value))
#else
/* The console build: the data bank is mapped at $4000 by the interpreter's
 * boot (ilvm.c), and the engine entry points are fixed addresses. */
#include "hutrack-symbols.h"
#define DATA_BYTE(off) (*(volatile const uint8_t *)(0x4000 + (uint16_t)(off)))
#define PSG_WRITE(reg, value) \
  (*(volatile uint8_t *)(0x800 + (uint8_t)(reg)) = (uint8_t)(value))
static void map_engine_banks(void) {
  /* MPR5 (page 5, $A000-$BFFF) = bank 2: engine code.
   * MPR4 (page 4, $8000-$9FFF) = bank 3: pitch + note tables. */
  __asm__ volatile ("tam #$20" : : "a" ((uint8_t)HUTRACK_CODE_BANK));
  __asm__ volatile ("tam #$10" : : "a" ((uint8_t)HUTRACK_TABLES_BANK));
}
/* The engine's 6502 entry points take their arguments in _hk.EAX0 (a
 * zero-page scratch the engine reads) and return with rts. */
#define ENGINE_CALL(name) ((void (*)(void))HUTRACK_##name)()
static void set_eax0(uint8_t i, uint8_t v) {
  *(volatile uint8_t *)(HUTRACK_HK_EAX0 + i) = v;
}
#endif

/* ---- the browser's constants (renderer/pce-toyhost.js) ---------------- */
#define SOUND_CHANNELS 6
#define SFX_FRAMES_MAX 600

/* The square wave the browser's sfx() uploads: 16 steps at volume 31 then
 * 16 at 0 (SFX_WAVE, pce-toyhost.js). */
static const uint8_t SFX_WAVE[32] = {
  31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31,
   0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0
};

/* The song table trailer buildToyRom writes at the data bank's end (n songs
 * then up to 8 (addr lo, addr hi, bank) entries; renderer/pce-rom.js). */
#define SONG_TABLE_OFF 0x1FE0
#define MAX_SONGS 8

/* ---- per-boot sound state --------------------------------------------- */
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
#ifndef ILVM_HOST
  map_engine_banks();
#endif
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
#ifdef ILVM_HOST
  return NOTE_TABLE[midi];
#else
  return *(volatile const uint16_t *)(HUTRACK_NOTE_TABLE +
                                      (uint16_t)(midi * 2));
#endif
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
#ifndef ILVM_HOST
    /* The engine's reservation: inProgress and waitNote bits plus the
     * reserve writes, byte for byte the browser's reserveWrites. */
    set_eax0(0, ch);
    ENGINE_CALL(SET_CHAN_SFX);
#else
    PSG_WRITE(0, ch);                       /* browser reserveWrites */
    PSG_WRITE(4, 0);
    PSG_WRITE(7, 0);
    if (ch < 2) PSG_WRITE(9, 0);
    PSG_WRITE(5, 0xFF);
#endif
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
#ifndef ILVM_HOST
  /* The engine refuses to silence a channel music owns (inProgress bit),
   * and C only calls this while the flag is set, so the write sequence
   * matches the browser's releaseWrites exactly. */
  set_eax0(1, ch);
  ENGINE_CALL(CHAN_RELEASE_SFX);
#else
  PSG_WRITE(0, ch);                         /* browser releaseWrites */
  PSG_WRITE(4, 0);
  PSG_WRITE(7, 0);
  if (ch < 2) PSG_WRITE(9, 0);
#endif
}

/* music(index): queue and play.  The browser refuses music-range; the
 * console no-ops on a bad index or an empty table instead. */
void ilvm_music(uint8_t index) {
  uint8_t i;
  sound_map();
  if (index >= n_songs) return;
#ifdef ILVM_HOST
  /* The host model: the browser's createPlayer — one init stream (R1 then
   * every channel's power-on state), then the reserves.  The browser
   * writes two streams per music(); the engine's own Init runs once per
   * boot and playSong's Reset carries the later calls, so the console's
   * repeated-music stream is one — the known model divergence
   * docs/ROM-SOUND.md §7 records, unexercised while n = 0 (#199). */
  PSG_WRITE(1, 0xFF);
  for (i = 0; i < SOUND_CHANNELS; i++) {
    PSG_WRITE(0, i);
    PSG_WRITE(5, 0xFF);
    PSG_WRITE(4, 0x40);
    PSG_WRITE(4, 0x00);
    PSG_WRITE(7, 0x00);
    for (uint8_t s = 0; s < 32; s++) PSG_WRITE(6, 0x00);
  }
#else
  if (!tick_flag) {
    /* First music: the engine's Init (clears the song list and every
     * reservation, writes R1 = $FF) then queue every song so slot i is
     * always song i, whatever order music() calls come in. */
    ENGINE_CALL(INIT);
    for (i = 0; i < n_songs; i++) {
      set_eax0(0, song_lo[i]);
      set_eax0(1, song_hi[i]);
      set_eax0(2, song_bank[i]);
      ENGINE_CALL(QUEUE_SONG);
    }
    tick_flag = 1;
  }
  set_eax0(0, index);
  set_eax0(1, 0);               /* force_no_repeat: 0 */
  ENGINE_CALL(PLAY_SONG);
  /* playSong's Reset cleared the engine's SFX reservations; re-reserve the
   * channels C still owns (the browser's music() reserves them too). */
  for (i = 0; i < SOUND_CHANNELS; i++) {
    if (sfx_owned[i]) {
      set_eax0(0, i);
      ENGINE_CALL(SET_CHAN_SFX);
    }
  }
#endif
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
  if (!tick_flag) return;
#ifndef ILVM_HOST
  ENGINE_CALL(TICK);
#endif
}
