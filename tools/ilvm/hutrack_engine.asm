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
