-- game B routine 1: an 8 x 8 -> 16 bit multiply (shift and add in the original; zero multiplier takes another path)
-- ROUTINE-BEGIN
function mul8(a, b)
  return a * b
end
-- ROUTINE-END
CALLS = 64
gy = 0
function init() vram[0x7FFE] = 0xBEEF end
function frame(t, f)
  local acc = 0
  local a = 0
  local b = 1
  for k = 1, CALLS do
    a = (a + 37) & 255
    b = ((b + 91) & 254) + 1
    acc = acc + mul8(a, b)  -- @base acc = acc + a + b
  end
  gy = acc
end
