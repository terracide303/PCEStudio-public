-- the cost of one sat() write (a sprite-list word) through a function; the Y values differ per slot so the
-- validator's sprites-per-line limit holds
-- ROUTINE-BEGIN
function st(i, y)
  sat(i, 0, y)
end
-- ROUTINE-END
function st0(i, y) end   -- the baseline: the same call with nothing inside
CALLS = 64
gy = 0
function init() vram[0x7FFE] = 0xBEEF end
function frame(t, f)
  for k = 1, CALLS do
    local i = (k & 31) + 1
    local y = i * 8
    st(i, y)  -- @base st0(i, y)
  end
end
