

;###########################################################################
  .page 2
.pattern.table
  .dw .pattern.table.chan0
  .db bank(.pattern.table.chan0)
  .dw .pattern.table.chan1
  .db bank(.pattern.table.chan1)
  .dw .pattern.table.chan2
  .db bank(.pattern.table.chan2)
  .dw .pattern.table.chan3
  .db bank(.pattern.table.chan3)
  .dw .pattern.table.chan4
  .db bank(.pattern.table.chan4)
  .dw .pattern.table.chan5
  .db bank(.pattern.table.chan5)


  .db bank(.pattern.table.chan0)
  .db bank(.pattern.table.chan1)
  .db bank(.pattern.table.chan2)
  .db bank(.pattern.table.chan3)
  .db bank(.pattern.table.chan4)
  .db bank(.pattern.table.chan5)


;.....................................................
  .page 2
.pattern.table.chan0
  .dw .pattern.table.chan0.pattern0
  .db bank(.pattern.table.chan0.pattern0)
  .dw .pattern.table.chan0.pattern1
  .db bank(.pattern.table.chan0.pattern1)


;###########################################################################


;.....................................................
  .page 2
.pattern.table.chan1
  .dw .pattern.table.chan1.pattern0
  .db bank(.pattern.table.chan1.pattern0)


;###########################################################################


;.....................................................
  .page 2
.pattern.table.chan2
  .dw .pattern.table.chan2.pattern0
  .db bank(.pattern.table.chan2.pattern0)


;###########################################################################


;.....................................................
  .page 2
.pattern.table.chan3
  .dw .pattern.table.chan3.pattern0
  .db bank(.pattern.table.chan3.pattern0)


;###########################################################################


;.....................................................
  .page 2
.pattern.table.chan4
  .dw .pattern.table.chan4.pattern0
  .db bank(.pattern.table.chan4.pattern0)


;###########################################################################


;.....................................................
  .page 2
.pattern.table.chan5
  .dw .pattern.table.chan5.pattern0
  .db bank(.pattern.table.chan5.pattern0)


;###########################################################################


;........................................................................
;........................................................................

;......................................
  .page 2
.pattern.table.chan0.pattern0

  .db $35, $24, $0, $f, $4
  .db $e1
  .db $8, $14
  .db $e1
  .db $5, $28, $1
  .db $e3
  .db $5, $2b, $0
  .db $e3
  .db $5, $30, $1
  .db $e3
  .db $5, $2f, $0
  .db $e3
  .db $5, $2b, $1
  .db $e3
  .db $5, $28, $0
  .db $e3
  .db $5, $24, $1
  .db $e3


;......................................
  .page 2
.pattern.table.chan0.pattern1

  .db $5, $21, $0
  .db $e1
  .db $8, $14
  .db $e1
  .db $35, $24, $1, $10, $1
  .db $70, $f, $4, $3, $10, $1
  .db $e2
  .db $5, $28, $0
  .db $e3
  .db $5, $2d, $1
  .db $e3
  .db $5, $2b, $0
  .db $e3
  .db $5, $28, $1
  .db $e3
  .db $5, $24, $0
  .db $e3
  .db $5, $21, $1
  .db $e3


;........................................................................
;........................................................................

;......................................
  .page 2
.pattern.table.chan1.pattern0

  .db $5, $18, $1
  .db $e7
  .db $5, $1f, $1
  .db $e7
  .db $5, $18, $1
  .db $e7
  .db $5, $18, $1
  .db $e7


;........................................................................
;........................................................................

;......................................
  .page 2
.pattern.table.chan2.pattern0

  .db $5, $30, $0
  .db $e7
  .db $b4
  .db $e7
  .db $e0
  .db $ef


;........................................................................
;........................................................................

;......................................
  .page 2
.pattern.table.chan3.pattern0

  .db $fe
  .db $e2


;........................................................................
;........................................................................

;......................................
  .page 2
.pattern.table.chan4.pattern0

  .db $fe
  .db $e2


;........................................................................
;........................................................................

;......................................
  .page 2
.pattern.table.chan5.pattern0

  .db $fe
  .db $e2




