


  .page 2
.song
  .dw 0 ; banked-format marker
  .db 1 ; format revision
  .dw .song.tables
  .db bank(.song.tables)
.songname
  .db 80,67,69,83,116,117,100,105,111,32,72,117,84,114,97,99,107,32,116,101,115,116,0
.author
  .db 80,67,69,83,116,117,100,105,111,0


  .page 2
.song.tables
  .dw .attributes
  .db bank(.attributes)
  .dw .patternList.table
  .db bank(.patternList.table)
  .dw .instrument.table
  .db bank(.instrument.table)
  .dw .waveform.table
  .db bank(.waveform.table)
  .dw .pattern.table
  .db bank(.pattern.table)
  .dw .samples.table
  .db bank(.samples.table)



  .page 2
.attributes
  ; Extended attributes: marker, initial arp ticks, legacy volume slides
  .db 0,1,1
 ;NOTE: time base =  1
 ;NOTE: frame mode =  1
 ;NOTE: custom mode =  0

.attributes.tick1
  .db 6
.attributes.tick2
  .db 6
.attributes.rowLength
  .db 64
.attributes.patternListLen
  .db 4
.attributes.instrumentLen
  .db 1
.attributes.waveformsLen
  .db 1
.attributes.samplesLen
  .db 0


