-- game C routine 1: one sprite's four list words from three object arrays (Y, X, and an attribute byte whose high
-- nibble is the pattern and whose low nibble is the palette/flags)
-- ROUTINE-BEGIN
function put_sprite(i)
  sat(i, 0, oy[i] + 64)
  sat(i, 1, ox[i] + 32)
  local a = oa[i]
  sat(i, 2, ((a & 240) >> 3) + 96)
  sat(i, 3, a & 15)
end
-- ROUTINE-END
CALLS = 32
oy = { 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0 }
ox = { 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0 }
oa = { 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0 }
gy = 0
function init()
  vram[0x7FFE] = 0xBEEF
  for i = 1, 32 do
    oy[i] = (i * 37 + 5) % 200
    ox[i] = (i * 29 + 3) % 200
    oa[i] = (i * 17) & 255
  end
end
function frame(t, f)
  for k = 1, CALLS do
    local i = (k & 31) + 1
    put_sprite(i)  -- @base gy = gy + i
  end
end
