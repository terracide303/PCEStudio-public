-- the cost of calling a function that does nothing but return its argument (the call, the argument, the return)
-- ROUTINE-BEGIN
function ident(i)
  return i
end
-- ROUTINE-END
CALLS = 64
gy = 0
function init() vram[0x7FFE] = 0xBEEF end
function frame(t, f)
  local acc = 0
  for k = 1, CALLS do
    local i = (k & 31) + 1
    acc = acc + ident(i)  -- @base acc = acc + i
  end
  gy = acc
end
