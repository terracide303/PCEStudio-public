-- game A routine 2 (the X position word): X + 32, plus 256 when a flag bit of the object is set
-- ROUTINE-BEGIN
function put_x(i)
  local w = ox[i] + 32
  if ofl[i] & 64 ~= 0 then w = w + 256 end
  sat(i, 1, w)
end
-- ROUTINE-END
CALLS = 64
ox = { 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0 }
ofl = { 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0 }
gy = 0
function init()
  vram[0x7FFE] = 0xBEEF
  for i = 1, 32 do
    ox[i] = (i * 29 + 3) % 224
    ofl[i] = (i * 64) & 192
  end
end
function frame(t, f)
  for k = 1, CALLS do
    local i = (k & 31) + 1
    put_x(i)  -- @base gy = gy + i
  end
end
