

;###########################################################################
  .page 2
.instrument.0
; name  
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
  .db 1
.instrument.0.volEnv.loop
  .db 255
.instrument.0.volEnv.data
  .db 31


;........................
  .page 2
.instrument.0.arpEnv

.instrument.0.arpEnv.mode
  .db 0
.instrument.0.arpEnv.size
  .db 0
.instrument.0.arpEnv.loop
  .db 255
.instrument.0.arpEnv.data



;........................
  .page 2
.instrument.0.waveFormEnv

.instrument.0.waveFormEnv.size
  .db 1
.instrument.0.waveFormEnv.loop
  .db 255
.instrument.0.waveFormEnv.data
  .db 0



