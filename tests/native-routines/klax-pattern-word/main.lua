-- game A routine 3 (the pattern word): pattern * 2 + 384
-- ROUTINE-BEGIN
function put_pat(i)
  sat(i, 2, opat[i] * 2 + 384)
end
-- ROUTINE-END
CALLS = 64
opat = { 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0 }
gy = 0
function init()
  vram[0x7FFE] = 0xBEEF
  for i = 1, 32 do opat[i] = (i * 13 + 100) % 200 end
end
function frame(t, f)
  for k = 1, CALLS do
    local i = (k & 31) + 1
    put_pat(i)  -- @base gy = gy + i
  end
end
