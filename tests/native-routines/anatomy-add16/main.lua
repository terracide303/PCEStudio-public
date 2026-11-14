-- the cost of a 16-bit add of two byte pairs (the original's ADC pair), through a function
-- ROUTINE-BEGIN
function add16(a, b, c, d)
  return ((a | (b << 8)) + (c | (d << 8))) & 65535
end
-- ROUTINE-END
CALLS = 64
gy = 0
function init() vram[0x7FFE] = 0xBEEF end
function frame(t, f)
  local acc = 0
  for k = 1, CALLS do
    local i = (k & 31) + 1
    acc = acc + add16(i, 3, 7, 1)  -- @base acc = acc + i + 3 + 7 + 1
  end
  gy = acc
end
