-- the cost of testing one bit of a table field (flag & 64 ~= 0) through a function
-- ROUTINE-BEGIN
function flag(i)
  if ofl[i] & 64 ~= 0 then return 1 end
  return 0
end
-- ROUTINE-END
CALLS = 64
ofl = { 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0 }
gy = 0
function init() vram[0x7FFE] = 0xBEEF  for i = 1, 32 do ofl[i] = (i * 64) & 192 end end
function frame(t, f)
  local acc = 0
  for k = 1, CALLS do
    local i = (k & 31) + 1
    acc = acc + flag(i)  -- @base acc = acc + i
  end
  gy = acc
end
