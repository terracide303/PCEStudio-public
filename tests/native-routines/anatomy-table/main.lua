-- the cost of reading one cell of a table field through a function (an object-table read)
-- ROUTINE-BEGIN
function rd(i)
  return oy[i]
end
-- ROUTINE-END
CALLS = 64
oy = { 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0 }
gy = 0
function init() vram[0x7FFE] = 0xBEEF  for i = 1, 32 do oy[i] = i * 3 end end
function frame(t, f)
  local acc = 0
  for k = 1, CALLS do
    local i = (k & 31) + 1
    acc = acc + rd(i)  -- @base acc = acc + i
  end
  gy = acc
end
