-- floor division and remainder by constants, negative and positive dividends: the powers of two are
-- lowered to shifts and masks, the others stay divisions (tests/check-cgen-pow2.js). The results are
-- shown through the Y and X words of the sprite list so the host comparison can read them.
function frame(t, f)
  local a = f * 37 - 900
  sat(0, 0, a // 2 + 1000)
  sat(0, 1, a % 2 + 1000)
  sat(1, 0, a // 8 + 1000)
  sat(1, 1, a % 8 + 1000)
  sat(2, 0, a // 64 + 1000)
  sat(2, 1, a % 64 + 1000)
  sat(3, 0, a // 1 + 2000)
  sat(3, 1, a % 1 + 1000)
  sat(4, 0, a // 3 + 1000)
  sat(4, 1, a % 3 + 1000)
  sat(5, 0, (0 - a) // 16 + 1000)
  sat(5, 1, (0 - a) % 16 + 1000)
  sat(6, 0, a // 1024 + 1000)
  sat(6, 1, a % 1024 + 1000)
end
