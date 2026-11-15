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

; #281: the two zero-page cells the COPYV op uses (docs/ASM.md §2.3).
; COPYV_PC is the container pc the fixed image hands the shim below and reads
; back; it is the first free pair after the engine's zero page.  The raster
; IRQ preload owns $20E0-$20F0 (ilvm_runtime.c's IRQ_*), so the shim's
; source pointer is the pair after it.  ilvm.c defines the same addresses;
; build.sh asserts the engine's zero page end stays at or below COPYV_PC.
COPYV_PC  = $20DE
COPYV_PTR = $20F1

; #200's trace build: build-engine.sh replaces this line with
; `PSG_TRACE = 1` when PSG_TRACE=1, and with nothing otherwise.  The shipped
; image is assembled with the token commented out, so none of the trace code
; or RAM below exists in it (docs/ROM-SOUND.md §8).
@@PSG_TRACE_DEFINE@@
PSG_TRACE_FRAMES = 24          ; the window the trace covers: frames 0..23
PSG_TRACE_CAP    = 100         ; entries held by the three arrays below

    .zp
    .org ENGINE_ZP_BASE
EngineZp.start:
    .bss
    .org ENGINE_BSS_BASE
EngineBss.start:

; #200's PSG write trace (docs/ROM-SOUND.md §8).  Only a PSG_TRACE build
; carries it, and it sits at the BOTTOM of the engine's .bss: the llvm-mos
; soft stack sweeps down through this BaseRAM after SndGlueReset (#239), so a
; log at the top of the partition would be overwritten between frames.  At
; the bottom it is below every address the stack has been measured at, and
; the interpreter's own globals below it are the proof that the stack cannot
; go further without breaking the interpreter first.  PsgTraceReset fills
; the arrays with $EE; the test checks the fill beyond the count survived,
; which is this card's witness that the stack did not reach the log.  The
; log is three parallel arrays so every access is one Y-indexed load/store
; (a 300-byte flat entry array would cross a page).
    .ifdef PSG_TRACE
psg_trace_ok:    .ds 1         ; $A5 once SndGlueReset ran; corruption check
psg_trace_count: .ds 1         ; 0..PSG_TRACE_CAP
psg_trace_frame: .ds 2         ; the toy frame, set by SndGlueTick
psg_trace_seen:  .ds 1         ; the first tick is frame 0, not an increment
psg_trace_limit: .ds 1         ; the window's end; a streaming test raises it
psg_trace_reg:   .ds 1         ; the write's register (A at the call)
psg_trace_val:   .ds 1         ; the write's value
psg_trace_f:     .ds PSG_TRACE_CAP
psg_trace_r:     .ds PSG_TRACE_CAP
psg_trace_v:     .ds PSG_TRACE_CAP
    .endif

; The sound-op glue's own state (card #220; design: docs/ROM-SOUND.md §7).
; The interpreter's sfx/music/tick ops live in the tables bank at $9000 and
; keep their state here, inside the engine's .bss, so the C side carries
; none and the llvm image pays nothing but the wrapper calls.
;
; #239: this block is at the BOTTOM of the engine's .bss, not after HuTrack's
; own variables.  The llvm-mos soft stack sweeps down through the partition
; after SndGlueReset (the #200 trace build measured the evidence: bytes at
; $3B64 were stack spill while a fill at $373E survived a 345-frame run), so
; state kept at the top held power-on stack bytes at the first sound op and
; the reserve was skipped.  HuTrack's vars stay above and are the engine's
; own, initialised by Init/playSong before music reads them; the glue's
; reservation state must survive every frame instead.  tests/check-rom-sound
; .js and tools/toys/sfx-once.lua read it back from a save state.
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
; Effects (sfx_fx, renderer/pce-sfx.js is the model; this is it in 65C02).
; Per channel: the flags, the frequency and level kept x16 / x256 with their
; per-frame steps, the attack threshold and the decay length.  An effect
; lasts at most 255 frames, so the thresholds are one byte.
snd_fx:          .ds 6         ; FX_SLOPE | FX_ENV | FX_NOISE
snd_f16_lo:      .ds 6
snd_f16_hi:      .ds 6
snd_fst_lo:      .ds 6
snd_fst_hi:      .ds 6
snd_v16_lo:      .ds 6
snd_v16_hi:      .ds 6
snd_su_lo:       .ds 6
snd_su_hi:       .ds 6
snd_sd_lo:       .ds 6
snd_sd_hi:       .ds 6
snd_thr:         .ds 6         ; frames - attack: attack while left > thr
snd_dec:         .ds 6         ; decay while left <= dec
snd_st_from:     .ds 2         ; staged by the first op of an sfx_fx call
snd_st_to:       .ds 2
snd_st_vol:      .ds 1
snd_fx_ch:       .ds 1
snd_fx_wave:     .ds 1
snd_fx_att:      .ds 1
snd_fx_dcy:      .ds 1
snd_fx_frm:      .ds 1
snd_fx_fl:       .ds 1         ; SndFxStep: bit 0 slide, bit 1 level
snd_dn:          .ds 2         ; SndDiv16: dividend in, quotient out
snd_dd:          .ds 2
snd_dr:          .ds 2
; #281: COPYV's copy state (CopyvShim below).  The source pointer is in zero
; page at COPYV_PTR because the byte reads are [zp],y.
copyv_cnt:       .ds 2
copyv_bank:      .ds 1
copyv_saved:     .ds 1
SndGlueBss.end:

FX_SLOPE = 1
FX_ENV   = 2
FX_NOISE = 4

    .include "HuTrack/HuTrack_vars.inc"

EngineBss.end:
    .zp
EngineZp.end:

;---------------------------------------------------------------- bank 2: code, page 5
    .code
    .bank $02, "Engine"
    .org $A000

; #200's trace hooks: assembled only under PSG_TRACE.  Each macro follows a
; PSG write that has just happened, with `sta psg_trace_val` recording the
; value and A carrying the register number to PsgTraceLog (the tables bank,
; mapped whenever the engine runs; docs/ROM-SOUND.md §8).  PsgTraceLog
; preserves X, Y and P; A may be clobbered, and every call site leaves A
; dead (the vendor patches too — the line after each write reloads it or
; branches on a flag the routine preserved).
PSGT_A .macro                  ; the value is in A
    .ifdef PSG_TRACE
    sta psg_trace_val
    lda #\1
    jsr PsgTraceLog
    .endif
    .endm
PSGT_X .macro                  ; the value is in X
    .ifdef PSG_TRACE
    stx psg_trace_val
    lda #\1
    jsr PsgTraceLog
    .endif
    .endm
PSGT_Z .macro                  ; stz: the value is 0
    .ifdef PSG_TRACE
    stz psg_trace_val
    lda #\1
    jsr PsgTraceLog
    .endif
    .endm

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
    ; #239: `sta` sets no flags, so the old `beq .done` tested the CMP's Z
    ; (n_songs == 9, never true after the clamp) and never skipped the loop.
    ; With buildToyRom's n = 0 trailer that ran Y 0..255, writing song_lo/hi/
    ; bank up to $3964 and over snd_owned ($386D): the first SFX saw $CF at
    ; snd_owned[0], skipped its reserve, and the toy stayed silent.  Test the
    ; stored count itself, and only loop for a real song list.
    cmp #1
    bcc .done
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
    .ifdef PSG_TRACE
    jsr PsgTraceReset
    .endif
    stz snd_mapped
    stz snd_n_songs
    stz snd_tick
    stz snd_active
    stz snd_args_frames
    stz snd_args_frames+1
    ldx #5
.loop:
    stz snd_owned,x
    stz snd_fx,x
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
    ; #238: F is 12 bits, so the clamp belongs on the HIGH byte's low nibble
    ; (EAX0.h); masking the low byte (EAX0.m) chopped bits 4-7 of F, e.g.
    ; note(60)'s 428 arrived as 268.  The browser writes freq & 0xFF to R2
    ; and (freq >> 8) & 0x0F to R3.
    lda <_hk.EAX0.h
    and #$0F
    sta <_hk.EAX0.h
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
    lda #$FF
    sta $801            ; R1: the main amplitude HuTrack's Init sets (#113)
    PSGT_A 1
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
    PSGT_X 0
    lda snd_fx,x           ; a channel an effect left in noise mode: R7 off
    and #FX_NOISE
    beq .nonoise
    stz $807
    PSGT_Z 7
.nonoise:
    stz snd_fx,x           ; a plain sfx() cancels an effect's slide/envelope
    lda #$40
    sta $804
    PSGT_A 4
    stz $804
    PSGT_Z 4
    cly
.wave:
    lda SndGlueWave,y
    sta $806
    PSGT_A 6
    iny
    cpy #32
    bne .wave
    stx $800
    PSGT_X 0
    lda <_hk.EAX0.m
    sta $802
    PSGT_A 2
    lda <_hk.EAX0.h
    sta $803
    PSGT_A 3
    lda <_hk.EAX0.u
    ora #$80
    sta $804
    PSGT_A 4
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
    stz snd_fx,x
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
    .ifdef PSG_TRACE
    jsr PsgTraceTick           ; frame 0 is the first tick, not an increment
    .endif
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
    bne .stillgoing
    txa
    sta <_hk.EAX0.l
    jsr SndGlueRelease
    bra .next
.stillgoing:
    lda snd_fx,x
    and #(FX_SLOPE | FX_ENV)
    beq .next
    phy
    jsr SndFxStep
    ply
.next:
    iny
    bra .loop
.tick:
    lda snd_tick
    beq .out
    jsr HuTrackTick
.out:
    rts

; ---- the PSG write trace (card #200; design: docs/ROM-SOUND.md §8) ------
; Test builds only.  Every PSG write in the glue and in the two SFX
; reservation routines (patched into the staged vendor copy by
; build-engine.sh) calls PsgTraceLog with the register in A and the value in
; psg_trace_val.  The window is frames 0..PSG_TRACE_FRAMES-1 and at most
; PSG_TRACE_CAP writes; the arrays are read from a Mednafen save state's
; BaseRAM.  PsgTraceLog preserves X, Y and P and may clobber A.
.ifdef PSG_TRACE
PsgTraceReset:
    lda #$EE                   ; the test's "the stack did not reach here"
    ldx #PSG_TRACE_CAP-1
.fill:
    sta psg_trace_f,x
    sta psg_trace_r,x
    sta psg_trace_v,x
    dex
    bpl .fill
    lda #$A5                   ; the test's "reset ran" and corruption check
    sta psg_trace_ok
    stz psg_trace_count
    lda #PSG_TRACE_FRAMES
    sta psg_trace_limit
    stz psg_trace_frame
    stz psg_trace_frame+1
    stz psg_trace_seen
    rts

; One call per toy frame, at the top of SndGlueTick (before frame()).  The
; tick before frame(0) is frame 0; every later tick increments.
PsgTraceTick:
    pha
    php
    lda psg_trace_seen
    beq .first
    inc psg_trace_frame
    bne .done
    inc psg_trace_frame+1
    bra .done
.first:
    lda #1
    sta psg_trace_seen
.done:
    plp
    pla
    rts

; A = register, psg_trace_val = value.  No-op past the window or the cap.
PsgTraceLog:
    sta psg_trace_reg
    php
    pha
    phx
    phy
    lda psg_trace_frame+1
    bne .out
    lda psg_trace_frame
    cmp psg_trace_limit
    bcs .out
    ldy psg_trace_count
    cpy #PSG_TRACE_CAP
    bcs .out
    sta psg_trace_f,y
    lda psg_trace_reg
    sta psg_trace_r,y
    lda psg_trace_val
    sta psg_trace_v,y
    iny
    sty psg_trace_count
.out:
    ply
    plx
    pla
    plp
    rts
.endif

; ---- CopyvShim: the COPYV op's body (#281, docs/IL.md §14.1,
; docs/BANKED-DATA.md §3.3/§5.8).
;
; The fixed image's case 0x23 writes the container pc to COPYV_PC and jsr's
; here.  This reads the seven operand bytes through MPR2 (the code bank),
; maps the source bank (physical 4 + bank) into MPR2, streams the words into
; the VDC data port, and maps the caller's code bank back before the fixed
; image reads its next opcode.  The shape is the viewer's copy_words
; (tools/viewer.asm's copy_words: the same MPR2 window, the same
; remap-at-$6000 rule), which is the proven working example for this.
;
; Operands, from COPYV_PC: vramLo, vramHi, bank, offLo, offHi, cntLo, cntHi.
; `off` is bank-relative and 13 bits; the stream continues into bank+1,
; bank+2, ... at each $2000 boundary, so a blob can span whole banks.
;
; Interrupts are held off for the copy: the raster chain's IRQ handler
; (ilvm_runtime.c) writes VDC registers through this same $0000/$0002 port
; pair and would move MAWR mid-copy.  A COPYV is an asset load (init/boot,
; display off); a copy from a game's frame() would hold the chain off for
; its length, so the encoder must not emit one there (#218).  The caller's
; I flag is restored with plp, so a copy from an IRQ-off context stays off.
CopyvShim:
    php                          ; save the caller's I flag
    sei
    tma #2                       ; the code bank MPR2 ($4000-$5FFF) holds now
    sta copyv_saved

    st0 #$00                     ; VDC register 0 (MAWR): the VRAM address
    ldy #0
    lda [<COPYV_PC],y
    sta $0002
    iny
    lda [<COPYV_PC],y
    sta $0003
    iny
    lda [<COPYV_PC],y            ; data bank (container-relative)
    sta copyv_bank
    iny
    lda [<COPYV_PC],y            ; source offset low
    sta <COPYV_PTR
    iny
    lda [<COPYV_PC],y            ; source offset high: 13 bits, bank-relative
    and #$1F
    ora #$40
    sta <COPYV_PTR+1
    iny
    lda [<COPYV_PC],y            ; word count low
    sta copyv_cnt
    iny
    lda [<COPYV_PC],y            ; word count high
    sta copyv_cnt+1

    lda <COPYV_PC                ; advance the container pc past the operands
    clc
    adc #7
    sta <COPYV_PC
    bcc .pcok
    inc <COPYV_PC+1
.pcok:
    lda copyv_bank               ; map the source bank: physical 4 + bank.
    clc                          ; PCEAS's `tam #n` selects MPRn, so #2 is
    adc #4                       ; MPR2 ($04), the window the pointer reads;
    tam #2                       ; `tam #4` would be MPR4 (the tables page).
    st0 #$02                     ; VDC register 2 (VWR): streamed words

.loop:
    lda copyv_cnt
    ora copyv_cnt+1
    beq .done
    lda <COPYV_PTR+1             ; crossing $5FFF: map the next bank
    cmp #$60
    bne .readlo
    jsr .nextbank
.readlo:
    ldy #0
    lda [<COPYV_PTR],y
    sta $0002
    inc <COPYV_PTR
    bne .hi
    inc <COPYV_PTR+1
.hi:
    lda <COPYV_PTR+1
    cmp #$60
    bne .readhi
    jsr .nextbank
.readhi:
    ldy #0
    lda [<COPYV_PTR],y
    sta $0003
    inc <COPYV_PTR
    bne .count
    inc <COPYV_PTR+1
.count:
    lda copyv_cnt
    bne .declo
    dec copyv_cnt+1
.declo:
    dec copyv_cnt
    jmp .loop
.done:
    lda copyv_saved              ; restore the code bank MPR2 held
    tam #2
    plp
    rts
.nextbank:
    inc copyv_bank
    lda copyv_bank
    clc
    adc #4
    tam #2
    lda #$40
    sta <COPYV_PTR+1
    rts


; ---- SndGlueSfxOp: the interpreter's `sfx` op.  _hk.EAX0 holds the address
; of the op's four int32 operands; bits 8..15 of the first are the op kind:
; 0 is sfx(channel, freq, volume, frames) — decoded here (the C wrapper is
; just the pointer) and run by SndGlueSfx — and 1..3 are sfx_fx's ops below.
SndGlueSfxOp:
    ldy #1
    lda [<_hk.EAX0],y
    beq .plain
    jmp SndGlueFxOp
.plain:
    ldy #4
    lda [<_hk.EAX0],y
    sta snd_dn                 ; freq low
    iny
    lda [<_hk.EAX0],y
    sta snd_dn+1               ; freq bits 8..15
    ldy #8
    lda [<_hk.EAX0],y
    sta snd_dd                 ; volume
    ldy #12
    lda [<_hk.EAX0],y
    sta snd_args_frames
    iny
    lda [<_hk.EAX0],y
    sta snd_args_frames+1
    ldy #15
    lda [<_hk.EAX0],y          ; a negative frames count clamps to 1
    bpl .fpos
    stz snd_args_frames
    stz snd_args_frames+1
.fpos:
    cly
    lda [<_hk.EAX0],y
    sta <_hk.EAX0.l
    lda snd_dn
    sta <_hk.EAX0.m
    lda snd_dn+1
    sta <_hk.EAX0.h
    lda snd_dd
    sta <_hk.EAX0.u
    jmp SndGlueSfx

; ======================================================================
; Effects: sfx_fx(channel, wave, from, to, volume, attack, decay, frames)
; (renderer/pce-sfx.js is the model and the proof's reference).
;
; The interpreter's `sfx` op carries four operands, so an effect is three
; ops whose first operand is a constant with the op kind in bits 8..15:
;   kind 1 (stage): a1 = from, a2 = to, a3 = volume
;   kind 2 (stage): a1 = wave, a2 = attack, a3 = decay
;   kind 3 (fire):  a1 = channel, a2 = frames — the effect starts
; _hk.EAX0 holds the address of the four int32 operands (little-endian).
; Out-of-range operands clamp (the console's substitute for the browser's
; sfx-range refusal): a channel past 5, or noise off channels 4/5, is a
; no-op; frames, attack and decay clamp to 255 (an effect's limit), frames
; to at least 1, and attack and decay are cut to fit the frames.
; ======================================================================
SndGlueFxOp:
    cmp #2
    beq .kind2
    bcs .fire
    ; kind 1: from, to (low 12 bits), volume (low 5 bits)
    ldy #4
    lda [<_hk.EAX0],y
    sta snd_st_from
    iny
    lda [<_hk.EAX0],y
    and #$0F
    sta snd_st_from+1
    ldy #8
    lda [<_hk.EAX0],y
    sta snd_st_to
    iny
    lda [<_hk.EAX0],y
    and #$0F
    sta snd_st_to+1
    ldy #12
    lda [<_hk.EAX0],y
    and #$1F
    sta snd_st_vol
    rts
.kind2:
    ldy #4
    lda [<_hk.EAX0],y
    and #3
    sta snd_fx_wave
    ldy #8
    jsr SndFxByte
    sta snd_fx_att
    ldy #12
    jsr SndFxByte
    sta snd_fx_dcy
    rts
.fire:
    ldy #4
    lda [<_hk.EAX0],y
    cmp #6
    bcc .chok
    rts
.chok:
    sta snd_fx_ch
    lda snd_fx_wave
    cmp #1
    bne .wok
    lda snd_fx_ch              ; noise: channels 4 and 5 only
    cmp #4
    bcs .wok
    rts
.wok:
    ldy #8
    jsr SndFxByte              ; frames
    bne .fset
    lda #1
.fset:
    sta snd_fx_frm
    lda snd_fx_att             ; attack <= frames
    cmp snd_fx_frm
    bcc .aok
    lda snd_fx_frm
    sta snd_fx_att
.aok:
    lda snd_fx_frm             ; decay <= frames - attack
    sec
    sbc snd_fx_att
    cmp snd_fx_dcy
    bcs .dok
    sta snd_fx_dcy
.dok:
    ; from, to: the low 12 bits (noise: the low 5 bits)
    lda snd_fx_wave
    cmp #1
    bne SndFxStart
    lda snd_st_from
    and #$1F
    sta snd_st_from
    stz snd_st_from+1
    lda snd_st_to
    and #$1F
    sta snd_st_to
    stz snd_st_to+1
    ; fall into SndFxStart

; ---- SndFxStart: the effect's first frame (the model's start()).
SndFxStart:
    jsr SndGlueMap
    lda #$FF
    sta $801                   ; R1, as sfx() does
    PSGT_A 1
    lda #1
    sta snd_active
    ldx snd_fx_ch
    lda snd_owned,x
    bne .reserved
    lda #1
    sta snd_owned,x
    stx <_hk.EAX0.l            ; the engine's reserve takes the channel here
    jsr HuTrackEngine.setChanForSFX
    ldx snd_fx_ch
.reserved:
    ; ---- the integer state
    lda snd_fx_frm
    sta snd_frames_lo,x
    stz snd_frames_hi,x
    lda snd_fx,x
    pha                        ; the old flags (noise?)
    stz snd_fx,x
    ; frequency: f16 = from << 4
    lda snd_st_from
    sta snd_f16_lo,x
    lda snd_st_from+1
    sta snd_f16_hi,x
    asl snd_f16_lo,x
    rol snd_f16_hi,x
    asl snd_f16_lo,x
    rol snd_f16_hi,x
    asl snd_f16_lo,x
    rol snd_f16_hi,x
    asl snd_f16_lo,x
    rol snd_f16_hi,x
    stz snd_fst_lo,x
    stz snd_fst_hi,x
    ; slide: from != to and frames > 1
    lda snd_fx_frm
    cmp #2
    bcs .chk
    jmp .noslide
.chk:
    lda snd_st_from
    cmp snd_st_to
    bne .slide
    lda snd_st_from+1
    cmp snd_st_to+1
    bne .slide
    jmp .noslide
.slide:
    lda snd_fx,x
    ora #FX_SLOPE
    sta snd_fx,x
    ; |to - from|; the flag (1 when to >= from) rides the stack
    sec
    lda snd_st_to
    sbc snd_st_from
    sta snd_dn
    lda snd_st_to+1
    sbc snd_st_from+1
    sta snd_dn+1
    lda #0
    rol a
    pha
    bne .up
    sec                        ; negate
    lda #0
    sbc snd_dn
    sta snd_dn
    lda #0
    sbc snd_dn+1
    sta snd_dn+1
.up:
    asl snd_dn
    rol snd_dn+1
    asl snd_dn
    rol snd_dn+1
    asl snd_dn
    rol snd_dn+1
    asl snd_dn
    rol snd_dn+1
    lda snd_fx_frm
    dec a
    sta snd_dd
    stz snd_dd+1
    phx
    jsr SndDiv16
    plx
    lda snd_dn
    sta snd_fst_lo,x
    lda snd_dn+1
    sta snd_fst_hi,x
    pla
    bne .noslide               ; to >= from: the step is positive
    sec                        ; else two's complement
    lda #0
    sbc snd_fst_lo,x
    sta snd_fst_lo,x
    lda #0
    sbc snd_fst_hi,x
    sta snd_fst_hi,x
.noslide:
    ; level: v16 = volume << 8 with the attack/decay shape
    stz snd_v16_lo,x
    lda snd_st_vol
    sta snd_v16_hi,x
    stz snd_su_lo,x
    stz snd_su_hi,x
    stz snd_sd_lo,x
    stz snd_sd_hi,x
    lda snd_fx_frm
    sec
    sbc snd_fx_att
    sta snd_thr,x
    lda snd_fx_dcy
    sta snd_dec,x
    lda snd_fx_att
    ora snd_fx_dcy
    beq .noenv
    lda snd_fx,x
    ora #FX_ENV
    sta snd_fx,x
    lda snd_fx_att
    beq .noatt
    stz snd_dn
    lda snd_st_vol
    sta snd_dn+1
    lda snd_fx_att
    sta snd_dd
    stz snd_dd+1
    phx
    jsr SndDiv16
    plx
    lda snd_dn
    sta snd_su_lo,x
    sta snd_v16_lo,x
    lda snd_dn+1
    sta snd_su_hi,x
    sta snd_v16_hi,x
.noatt:
    lda snd_fx_dcy
    beq .noenv
    stz snd_dn
    lda snd_st_vol
    sta snd_dn+1
    lda snd_fx_dcy
    sta snd_dd
    stz snd_dd+1
    phx
    jsr SndDiv16
    plx
    lda snd_dn
    sta snd_sd_lo,x
    lda snd_dn+1
    sta snd_sd_hi,x
    lda snd_fx_att
    bne .noenv                 ; an attack starts the level at su
    lda snd_fx_dcy
    cmp snd_fx_frm
    bcc .noenv                 ; decay shorter than the effect: starts at peak
    sec                        ; decay == frames: the first frame is one step down
    lda snd_v16_lo,x
    sbc snd_sd_lo,x
    sta snd_v16_lo,x
    lda snd_v16_hi,x
    sbc snd_sd_hi,x
    sta snd_v16_hi,x
.noenv:
    ; ---- the writes
    pla
    sta snd_tmp                ; the old flags
    lda snd_fx_wave
    cmp #1
    bne .istone
    jmp .noise
.istone:
    ; tone: R0, [R7 off], the wave upload, R0, F, level
    stx $800
    PSGT_X 0
    lda snd_tmp
    and #FX_NOISE
    beq .tone
    stz $807
    PSGT_Z 7
.tone:
    lda #$40
    sta $804
    PSGT_A 4
    stz $804
    PSGT_Z 4
    ldy snd_fx_wave
    lda SndWaveOff,y
    tay
    sta snd_tmp
    ldx #32
.wave:
    lda SndGlueWave,y
    sta $806
    PSGT_A 6
    iny
    dex
    bne .wave
    ldx snd_fx_ch
    stx $800
    PSGT_X 0
    lda snd_f16_lo,x           ; F = f16 >> 4
    lsr a
    lsr a
    lsr a
    lsr a
    sta snd_tmp
    lda snd_f16_hi,x
    asl a
    asl a
    asl a
    asl a
    ora snd_tmp
    sta $802
    PSGT_A 2
    lda snd_f16_hi,x
    lsr a
    lsr a
    lsr a
    lsr a
    sta $803
    PSGT_A 3
    jmp .level
.noise:
    stx $800
    PSGT_X 0
    lda snd_fx,x
    ora #FX_NOISE
    sta snd_fx,x
    lda snd_f16_lo,x           ; rate = (f16 >> 4) & 31, from <= 31 so f16 < 512
    lsr a
    lsr a
    lsr a
    lsr a
    sta snd_tmp
    lda snd_f16_hi,x
    asl a
    asl a
    asl a
    asl a
    ora snd_tmp
    and #$1F
    ora #$80
    sta $807
    PSGT_A 7
.level:
    lda snd_v16_hi,x
    ora #$80
    sta $804
    PSGT_A 4
    rts

; ---- SndFxByte: the byte at EAX0[y] as a clamped count: nonzero high bytes
; (or a negative) give 255.
SndFxByte:
    phy
    iny
    lda [<_hk.EAX0],y          ; byte 1
    bne .big
    iny
    lda [<_hk.EAX0],y          ; byte 2
    bne .big
    iny
    lda [<_hk.EAX0],y          ; byte 3
    bne .big
    ply
    lda [<_hk.EAX0],y
    rts
.big:
    ply
    lda #255
    rts

; ---- SndDiv16: snd_dn / snd_dd (nonzero) -> snd_dn, restoring division.
SndDiv16:
    stz snd_dr
    stz snd_dr+1
    ldy #16
.l:
    asl snd_dn
    rol snd_dn+1
    rol snd_dr
    rol snd_dr+1
    sec
    lda snd_dr
    sbc snd_dd
    tax
    lda snd_dr+1
    sbc snd_dd+1
    bcc .no
    sta snd_dr+1
    stx snd_dr
    inc snd_dn
.no:
    dey
    bne .l
    rts

; ---- SndFxStep: one tick of an effect on channel X (the model's tick()).
; Writes R0, then the frequency (R2/R3, or R7 for noise) while sliding, then
; R4 while the level moves; a frame that changes neither writes nothing.
SndFxStep:
    stz snd_fx_fl
    lda snd_fx,x
    and #FX_SLOPE
    beq .noslide
    lda #1
    sta snd_fx_fl
    clc
    lda snd_f16_lo,x
    adc snd_fst_lo,x
    sta snd_f16_lo,x
    lda snd_f16_hi,x
    adc snd_fst_hi,x
    sta snd_f16_hi,x
.noslide:
    lda snd_fx,x
    and #FX_ENV
    beq .noenv
    lda snd_frames_lo,x        ; left
    cmp snd_thr,x
    beq .notatt
    bcc .notatt
    clc                        ; left > thr: attack, level += su
    lda snd_v16_lo,x
    adc snd_su_lo,x
    sta snd_v16_lo,x
    lda snd_v16_hi,x
    adc snd_su_hi,x
    sta snd_v16_hi,x
    bra .level
.notatt:
    lda snd_dec,x
    cmp snd_frames_lo,x
    bcc .noenv                 ; dec < left: holding
    sec                        ; left <= dec: decay, level -= sd
    lda snd_v16_lo,x
    sbc snd_sd_lo,x
    sta snd_v16_lo,x
    lda snd_v16_hi,x
    sbc snd_sd_hi,x
    sta snd_v16_hi,x
.level:
    lda snd_fx_fl
    ora #2
    sta snd_fx_fl
.noenv:
    lda snd_fx_fl
    bne .write
    rts
.write:
    stx $800
    PSGT_X 0
    lda snd_fx_fl
    and #1
    beq .nofreq
    lda snd_f16_lo,x
    lsr a
    lsr a
    lsr a
    lsr a
    sta snd_tmp
    lda snd_f16_hi,x
    asl a
    asl a
    asl a
    asl a
    ora snd_tmp
    sta snd_dr                 ; F low byte (scratch)
    lda snd_fx,x
    and #FX_NOISE
    beq .tone
    lda snd_dr
    and #$1F
    ora #$80
    sta $807
    PSGT_A 7
    bra .nofreq
.tone:
    lda snd_dr
    sta $802
    PSGT_A 2
    lda snd_f16_hi,x
    lsr a
    lsr a
    lsr a
    lsr a
    sta $803
    PSGT_A 3
.nofreq:
    lda snd_fx_fl
    and #2
    beq .done
    lda snd_v16_hi,x
    ora #$80
    sta $804
    PSGT_A 4
.done:
    rts

SndGlueWave:
    .db 31,31,31,31,31,31,31,31,31,31,31,31,31,31,31,31
    .db 0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0
    ; triangle (SndGlueWave + 32): up 0..30 by two, down 31..1 by two
    .db 0,2,4,6,8,10,12,14,16,18,20,22,24,26,28,30
    .db 31,29,27,25,23,21,19,17,15,13,11,9,7,5,3,1
    ; sawtooth (SndGlueWave + 64)
    .db 0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15
    .db 16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31
SndWaveOff:
    .db 0,0,32,64
SndGlueEnd:

    .if (SndGlueEnd > $A000)
      .fail sound-op glue overflows $9000-$9FFF.
    .endif
