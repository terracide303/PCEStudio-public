; tools/ilvm/hutrack_engine.asm — the HuTrack engine as an engine-only image
; (card #212, first slice of #198; design: docs/ROM-SOUND.md §1, §9).
;
; Build it with tools/ilvm/build-engine.sh, which stages a COPY of
; vendor/hutrack/lib, applies the three-site window patch to that copy, and
; assembles this file with PCEAS 4.x.  vendor/hutrack is never edited.
;
; The raw image is 32 KiB and only banks 2 and 3 are real:
;
;   physical bank 0, 1   $FF  (llvm-mos's 16 KiB interpreter image will here)
;   physical bank 2      $A000-$BFFF, page 5: engine code
;   physical bank 3      $8000-$9FFF, page 4: pitch tables
;
; The bank numbers are already the physical numbers the engine will have in
; the final ROM, so the C side can be handed fixed addresses (the generated
; tools/gen/hutrack-symbols.h) and the two banks are appended verbatim after
; the interpreter (#213).  No C source includes engine code and no PCEAS
; source includes C code: the two build systems share no linker.
;
; Why page 5 / page 4: the parser temporarily owns the song window at
; $4000-$BFFF.  The staged copy narrows that window from four banks to one
; (MAP_BANK.4 -> MAP_BANK at the three call sites named in docs/ROM-SOUND.md
; §3), which frees pages 3-5 — but the pitch routines still map the tables
; bank at page 4 around every table read, and HuTrack's own ROM runs its code
; at page 6 for the same reason.  The interpreter owns pages 6 and 7, so the
; engine code moves to page 5.
;
; RAM (zero page and BaseRAM) is placed by tools/ilvm/build-engine.sh (#214):
; @@ENGINE_ZP_BASE@@ is the interpreter's zero-page end and
; @@ENGINE_BSS_BASE@@ the llvm image's __heap_start, both measured from the
; built interpreter ELF before this file is assembled.  Only the code/tables
; bank layout and the entry-point addresses are fixed here.
;
; EngineZp.start/end and EngineBss.end exist so the build reports the engine's
; own extents rather than guessing them from the symbol names.
ENGINE_ZP_BASE  = @@ENGINE_ZP_BASE@@
ENGINE_BSS_BASE = @@ENGINE_BSS_BASE@@

    .zp
    .org ENGINE_ZP_BASE
EngineZp.start:
    .bss
    .org ENGINE_BSS_BASE
    .include "HuTrack/HuTrack_vars.inc"

; The sound-op glue's own state (card #220; design: docs/ROM-SOUND.md §7).
; The interpreter's sfx/music/tick ops live in the tables bank at $9000 and
; keep their state here, inside the engine's .bss, so the C side carries
; none and the llvm image pays nothing but the wrapper calls.
SndGlueBss.start:
snd_mapped:      .ds 1
snd_n_songs:     .ds 1
snd_song_lo:     .ds 8
snd_song_hi:     .ds 8
snd_song_bank:   .ds 8
snd_owned:       .ds 6
snd_frames_lo:   .ds 6
snd_frames_hi:   .ds 6
snd_tick:        .ds 1
snd_active:      .ds 1
snd_tmp:         .ds 1
snd_args_frames: .ds 2
SndGlueBss.end:
EngineBss.end:
    .zp
EngineZp.end:

;---------------------------------------------------------------- bank 2: code, page 5
    .code
    .bank $02, "Engine"
    .org $A000
    .include "HuTrack/hutrack.inc"

HuTrackCode.start:
    .include "HuTrack/HuTrack_lib.asm"
    .include "HuTrack/engine/HuTrack_parser.asm"
    .include "HuTrack/engine/HuTrack_engine.asm"

; The interpreter's per-toy-frame path calls this, not the VBlank IRQ
; (docs/ROM-SOUND.md §4).  EngineCall ends with `jmp [HuTrack.returnVec]`, so
; a caller from C gives it an rts to land on.
HuTrackTick:
    lda #low(.done)
    sta HuTrack.returnVec
    lda #high(.done)
    sta HuTrack.returnVec+1
    jmp HuTrackEngine.EngineCall
.done:
    rts
HuTrackCode.end:

    .if (HuTrackCode.end > $C000)
      .fail HuTrack code overflows page 5 ($A000-$BFFF).
    .endif

;---------------------------------------------------------------- bank 3: pitch tables, page 4
    .bank $03, "Tables"
    .org $8000
    .include "HuTrack/engine/HuTrack_pitch_tables.inc"

; note(midi) for the interpreter's builtin (card #215, docs/ROM-SOUND.md §7):
; 512 words at $8C00, generated from renderer/pce-il.js's noteFrequency() by
; tools/ilvm/gen-note-table.js — build-engine.sh stages the committed copy and
; fails the build if regeneration drifts.  The pitch tables end well below
; $8C00 and the bank is padded to 8 KiB anyway, so the table costs nothing.
    .org $8C00
HuTrack.NoteTable:
    .include "note-table.inc"
HuTrack.NoteTable.end:

    .if (HuTrack.NoteTable.end > $9000)
      .fail note table overflows $8C00-$8FFF (512 words).
    .endif

;---------------------------------------------------------------- the sound-op glue, page 4
; The interpreter's sound ops, whole (card #220; design: docs/ROM-SOUND.md
; §7).  Each op's body lives here in the tables bank's free tail and
; ilvm_sound.c's console wrappers only clamp the operands, pack the
; arguments into _hk.EAX0 plus snd_args_frames, and jsr these fixed
; addresses — the same interface as the engine's own entry points.  The
; bodies cost the interpreter's 16 KiB image nothing and share the engine's
; bank mapping, tables and .bss.
;
; Every PSG write is the browser's, in the browser's order
; (renderer/pce-toyhost.js's sfx()/release()/tickSound() — the host half of
; ilvm_sound.c records the same streams through the host model, so
; tests/check-rom-sound.js compares them without an emulator).
;
; The square wave the browser's sfx() uploads: 16 steps at volume 31 then
; 16 at 0 (SFX_WAVE, pce-toyhost.js).
    .org $9000
SndGlueStart:

; ---- SndGlueMap: once per boot, map the engine banks and read the data
; bank's song trailer (n, then up to 8 (lo, hi, bank) entries at $5FE0).
; n is clamped to 8 here (a corrupt trailer must not hang the op loop).
SndGlueMap:
    lda snd_mapped
    bne .done
    lda #2
    tam #5
    lda #3
    tam #4
    lda #1
    sta snd_mapped
    lda $5FE0
    cmp #9
    bcc .nok
    lda #8
.nok:
    sta snd_n_songs
    beq .done
    cly
.loop:
    tya
    sta snd_tmp
    asl a
    clc
    adc snd_tmp
    tax
    lda $5FE1,x
    sta snd_song_lo,y
    lda $5FE2,x
    sta snd_song_hi,y
    lda $5FE3,x
    sta snd_song_bank,y
    iny
    cpy snd_n_songs
    bne .loop
.done:
    rts

; ---- SndGlueReset: ilvm_sound_reset for every boot: all glue state idle.
SndGlueReset:
    stz snd_mapped
    stz snd_tick
    stz snd_active
    ldx #5
.loop:
    stz snd_owned,x
    stz snd_frames_lo,x
    stz snd_frames_hi,x
    dex
    bpl .loop
    rts

; ---- SndGlueNote: midi (0..65535, the low 16 bits; a negative i32 is
; clamped to 0 by the caller) in _hk.EAX0.l/m.  Clamps >= 512 to 511 (the
; browser's formula is 0 there) and returns the PSG 12-bit F in
; _hk.EAX0.l/m, read from the 512-word table at $8C00 (HuTrack.NoteTable,
; generated from the browser's own formula).
SndGlueNote:
    jsr SndGlueMap
    lda <_hk.EAX0.m
    cmp #2
    bcc .midiok
    lda #1
    sta <_hk.EAX0.m
    lda #$FF
    sta <_hk.EAX0.l
.midiok:
    lda <_hk.EAX0.l
    asl a
    sta <_hk.EAX0.l
    lda <_hk.EAX0.m
    rol a
    clc
    adc #$8C
    sta <_hk.EAX0.m
    ldy #1
    lda [<_hk.EAX0],y
    sta <_hk.EAX0.h
    lda [<_hk.EAX0]
    sta <_hk.EAX0.u
    lda <_hk.EAX0.h
    sta <_hk.EAX0.m
    lda <_hk.EAX0.u
    sta <_hk.EAX0.l
    rts

; ---- SndGlueSfx: ch in _hk.EAX0.l, the 12-bit freq in EAX0.m/h, volume in
; EAX0.u, frames in snd_args_frames — the caller passed the raw operands;
; the clamps below are the console's substitute for the browser's sfx-range
; refusal.  A channel out of 0..5 is a no-op.  The browser's sfx() in its
; order: reserve (the engine's setChanForSFX, on first ownership), then the
; square-wave upload and the start writes.
SndGlueSfx:
    lda <_hk.EAX0.l
    cmp #6
    bcc .chin
    jmp .out
.chin:
    lda <_hk.EAX0.m
    and #$0F
    sta <_hk.EAX0.m
    lda <_hk.EAX0.u
    and #$1F
    sta <_hk.EAX0.u
    lda snd_args_frames
    ora snd_args_frames+1
    bne .framespos
    lda #1
    sta snd_args_frames
    stz snd_args_frames+1
.framespos:
    lda snd_args_frames+1
    cmp #2
    bcc .framesok
    lda snd_args_frames
    cmp #$58
    lda snd_args_frames+1
    sbc #$02
    bcc .framesok
    lda #$58
    sta snd_args_frames
    lda #$02
    sta snd_args_frames+1
.framesok:
    jsr SndGlueMap
    lda #1
    sta snd_active
    ldx <_hk.EAX0.l
    lda snd_owned,x
    bne .reserved
    lda #1
    sta snd_owned,x
    jsr HuTrackEngine.setChanForSFX
    ldx <_hk.EAX0.l
.reserved:
    ; the 32-step square: reset the waveform pointer, fill R6, start WAVEFORM
    stx $800
    lda #$40
    sta $804
    stz $804
    cly
.wave:
    lda SndGlueWave,y
    sta $806
    iny
    cpy #32
    bne .wave
    stx $800
    lda <_hk.EAX0.m
    sta $802
    lda <_hk.EAX0.h
    sta $803
    lda <_hk.EAX0.u
    ora #$80
    sta $804
    lda snd_args_frames
    sta snd_frames_lo,x
    lda snd_args_frames+1
    sta snd_frames_hi,x
.out:
    rts

; ---- SndGlueRelease: ch in _hk.EAX0.l; a channel no SFX owns is a silent
; return, exactly the browser's release().  The engine's chanReleaseSFX
; refuses to touch a channel music owns (its inProgress bit), so the writes
; match the browser's player.release there too.
SndGlueRelease:
    lda <_hk.EAX0.l
    cmp #6
    bcs .out
    ldx <_hk.EAX0.l
    lda snd_owned,x
    beq .out
    stz snd_owned,x
    stz snd_frames_lo,x
    stz snd_frames_hi,x
    lda <_hk.EAX0.l
    sta <_hk.EAX0.u
    jsr HuTrackEngine.chanReleaseSFX
.out:
    rts

; ---- SndGlueMusic: index in _hk.EAX0.l.  Out of range (or an empty table)
; is a no-op — the browser refuses music-range, the console cannot.  The
; first call inits the engine and queues every song (slot i is song i),
; then playSong(index) and re-reserve the channels SFX owns (playSong's
; Reset cleared the engine's reservations; the browser's music() reserves
; them too).
SndGlueMusic:
    jsr SndGlueMap
    lda <_hk.EAX0.l
    sta snd_tmp
    cmp snd_n_songs
    bcs .out
    lda #1
    sta snd_active
    lda snd_tick
    bne .queued
    jsr HuTrackEngine.Init
    cly
.queue:
    cpy snd_n_songs
    beq .firstdone
    lda snd_song_lo,y
    sta <_hk.EAX0.l
    lda snd_song_hi,y
    sta <_hk.EAX0.m
    lda snd_song_bank,y
    sta <_hk.EAX0.h
    jsr HuTrackEngine.QueueSong
    iny
    bra .queue
.firstdone:
    lda #1
    sta snd_tick
.queued:
    lda snd_tmp
    sta <_hk.EAX0.l
    stz <_hk.EAX0.m
    jsr HuTrackEngine.playSong
    cly
.rr:
    cpy #6
    beq .out
    lda snd_owned,y
    beq .rrnext
    tya
    sta <_hk.EAX0.l
    jsr HuTrackEngine.setChanForSFX
.rrnext:
    iny
    bra .rr
.out:
    rts

; ---- SndGlueTick: one toy frame, before frame(): the SFX timers (a channel
; whose frames reach 0 is released), then the engine tick when a song is
; queued — the browser's tickSound order, releases first, then the player.
SndGlueTick:
    lda snd_active
    beq .out
    cly
.loop:
    cpy #6
    beq .tick
    tya
    tax
    lda snd_owned,x
    beq .next
    lda snd_frames_lo,x
    ora snd_frames_hi,x
    beq .next
    lda snd_frames_lo,x
    bne .dec
    dec snd_frames_hi,x
.dec:
    dec snd_frames_lo,x
    lda snd_frames_lo,x
    ora snd_frames_hi,x
    bne .next
    txa
    sta <_hk.EAX0.l
    jsr SndGlueRelease
.next:
    iny
    bra .loop
.tick:
    lda snd_tick
    beq .out
    jsr HuTrackTick
.out:
    rts

SndGlueWave:
    .db 31,31,31,31,31,31,31,31,31,31,31,31,31,31,31,31
    .db 0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0
SndGlueEnd:

    .if (SndGlueEnd > $A000)
      .fail sound-op glue overflows $9000-$9FFF.
    .endif
