; tools/hutrack.asm — the minimal HuTrack ROM for #35 step (1)
;
; Plays our own test song (tools/genhutrack.py -> tools/gen/hutrack/song/)
; through the vendored HuTrack engine, so Mednafen's PSG output is a witness
; that HuTrack's converter + engine really play a DMF.  No video, no pad, no
; PCM samples: VBlank drives the music tick, the 7 kHz timer is armed the way
; the engine's own example arms it, and the display stays off.
;
; The skeleton (startup values, IRQ handlers, bank layout) is adapted from
; vendor/hutrack/example/pceas/main/pceas_example.asm (MIT, Turboxray); none
; of that example's songs are present.  See docs/HUTRACK.md.
;
; Build: make -C tools gen/hutrack/build/main/hutrack.asm (see tools/Makefile)

    list
    mlist

;---------------------------------------------------------------- variables
    .include "../base_func/vars.inc"
    .include "../base_func/video/vdc/vars.inc"
    .include "HuTrack/HuTrack_vars.inc"
    .include "../base_func/IO/irq_controller/vars.inc"

    .code

;---------------------------------------------------------------- fixed bank
    .bank $00, "Fixed Lib/Startup"
    .org $e000

;---------------------------------------------------------------- macros
    .include "../base_func/base.inc"
    .include "../base_func/video/vdc/vdc.inc"
    .include "../base_func/video/vce/vce.inc"
    .include "../base_func/timer/timer.inc"
    .include "../base_func/IO/irq_controller/irq.inc"
    .include "HuTrack/hutrack.inc"

;---------------------------------------------------------------- startup
startup:
    InitialStartup
    jsr init_audio

    ; Standard VDC geometry, as the HuTrack example sets it.  CR stays 0 here:
    ; nothing is displayed, but the VDC still makes VBlank for the music tick.
    VCE.reg MID_RES|H_FILTER_ON
    VDC.reg HSR  , #$0404
    VDC.reg HDR  , #$0629
    VDC.reg VSR  , #$0F02
    VDC.reg VDR  , #$00EF
    VDC.reg VDE  , #$0003
    VDC.reg DCR  , #AUTO_SATB_ON
    VDC.reg CR   , #$0000
    VDC.reg SATB , #$7F00
    VDC.reg MWR  , #SCR64_64

    IRQ.control IRQ2_ON|VIRQ_ON|TIRQ_OFF

    TIMER.port  _7.00khz
    TIMER.cmd   TMR_OFF

    MAP_BANK #MAIN, MPR6
    jmp MAIN

;---------------------------------------------------------------- audio init
init_audio:
    ldx #$05
.loop
    stx $800
    stz $801
    stz $802
    stz $803
    stz $804
    stz $805
    stz $806
    stz $807
    stz $808
    stz $809
    dex
    bpl .loop
    rts

;---------------------------------------------------------------- engine
    .include "HuTrack/engine/HuTrack_engine.asm"

; The music code lives in another bank.  Call through this fixed bank so the
; caller's MPR6 mapping is restored on return (the example's convention).
MusicInit:
    php
    sei
    HuTrack.CallFar HuTrackEngine.Init
    plp
    rts

MusicQueueSong:
    php
    sei
    HuTrack.CallFar HuTrackEngine.QueueSong
    plp
    rts

MusicPlaySong:
    php
    sei
    HuTrack.CallFar HuTrackEngine.playSong
    plp
    rts

;---------------------------------------------------------------- interrupts
TIRQ.custom
    jmp [timer_vect]

TIRQ:
    BBS2 <vector_mask, TIRQ.custom
    stz $1403
    rti

BRK.custom
    jmp [brk_vect]

BRK:
    BBS1 <vector_mask, BRK.custom
    rti

VDC.custom
    jmp [vdc_vect]

VDC:
    BBS0 <vector_mask, VDC.custom
      pha
    lda IRQ.ackVDC
    sta <vdc_status
    bit #$20
    bne VDC.vsync
VDC.hsync
    BBS4 <vector_mask, VDC.custom.hsync
    BBS5 <vdc_status, VDC.vsync
      pla
    rti

VDC.custom.hsync
    jmp [vdc_hsync]

VDC.custom.vsync
    jmp [vdc_vsync]

VDC.vsync
    phx
    phy
    BBS3 <vector_mask, VDC.custom.vsync

VDC.vsync.rtn
    ply
    plx
    pla
    stz __vblank
    rti

NMI:
    rti

;---------------------------------------------------------------- vectors
    .org $fff6
    .dw BRK
    .dw VDC
    .dw TIRQ
    .dw NMI
    .dw startup

;---------------------------------------------------------------- main bank
    .bank $01, "MAIN"
    .org $c000

MAIN:
    ; VBlank IRQ only: the engine ticks once per frame.
    VDC.reg CR, #VINT_ON

    ISR.setVector TIMER_VEC , HuTrackEngine.7khz.IRQ
    ISR.setVecMask TIMER_VEC
    ISR.setVector VDC_VSYNC , HuTrackEngine.EngineCall
    ISR.setVecMask VDC_VSYNC
    HuTrack.setVDCreturnVector #VDC.vsync.rtn, HuTrack.returnVec

    jsr MusicInit

    LEA.l Song, $4000, _hk.EAX0
    jsr MusicQueueSong

    MOVE.b #$00, <_hk.EAX0.l
    MOVE.b #$00, <_hk.EAX0.m
    jsr MusicPlaySong

    ; The engine's DDA re-sync arms the timer every VBlank; enable its IRQ the
    ; same way the example does (it is idle while no sample plays).
    TIMER.port _7.00khz
    TIMER.cmd  TMR_ON
    IRQ.control IRQ2_ON|VIRQ_ON|TIRQ_ON

    Interrupts.enable

.loop
    bra .loop

;---------------------------------------------------------------- music code
    .code
    .bank $08, "HuTrack Engine"
    .org $c000

MusicCodeStart:
    .include "HuTrack/HuTrack_lib.asm"
    .include "HuTrack/engine/HuTrack_parser.asm"
MusicCodeEnd:
    .if bank(MusicCodeEnd - 1) != bank(MusicCodeStart)
        .fail Music code exceeds its reserved bank.
    .endif

    .bank $09, "HuTrack Tables"
    .org $8000
    .include "HuTrack/engine/HuTrack_pitch_tables.inc"

;---------------------------------------------------------------- song
    .code
    .bank $10, "Song"
    .org $4000

Song:
    .include "song/demo.song.inc"
Song.end
