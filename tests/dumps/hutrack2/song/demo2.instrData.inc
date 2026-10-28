

;###########################################################################
  .page 2
.instrument.0
; name lead 
; mode 0

.instrument.0.table
  .dw .instrument.0.volEnv
  .db bank(.instrument.0.volEnv)
  .dw .instrument.0.arpEnv
  .db bank(.instrument.0.arpEnv)
  .dw .instrument.0.waveFormEnv
  .db bank(.instrument.0.waveFormEnv)

;........................
  .page 2
.instrument.0.volEnv

.instrument.0.volEnv.size
  .db 4
.instrument.0.volEnv.loop
  .db 2
.instrument.0.volEnv.data
  .db 31, 28, 20, 12



;........................
  .page 2
.instrument.0.arpEnv

.instrument.0.arpEnv.mode
  .db 0
.instrument.0.arpEnv.size
  .db 3
.instrument.0.arpEnv.loop
  .db 1
.instrument.0.arpEnv.data
  .db 0, 0, 244

;........................
  .page 2
.instrument.0.waveFormEnv

.instrument.0.waveFormEnv.size
  .db 2
.instrument.0.waveFormEnv.loop
  .db 0
.instrument.0.waveFormEnv.data
  .db 0, 1



;###########################################################################
  .page 2
.instrument.1
; name bass
; mode 0

.instrument.1.table
  .dw .instrument.1.volEnv
  .db bank(.instrument.1.volEnv)
  .dw .instrument.1.arpEnv
  .db bank(.instrument.1.arpEnv)
  .dw .instrument.1.waveFormEnv
  .db bank(.instrument.1.waveFormEnv)

;........................
  .page 2
.instrument.1.volEnv

.instrument.1.volEnv.size
  .db 1
.instrument.1.volEnv.loop
  .db 255
.instrument.1.volEnv.data
  .db 31


;........................
  .page 2
.instrument.1.arpEnv

.instrument.1.arpEnv.mode
  .db 0
.instrument.1.arpEnv.size
  .db 0
.instrument.1.arpEnv.loop
  .db 255
.instrument.1.arpEnv.data



;........................
  .page 2
.instrument.1.waveFormEnv

.instrument.1.waveFormEnv.size
  .db 1
.instrument.1.waveFormEnv.loop
  .db 255
.instrument.1.waveFormEnv.data
  .db 1



