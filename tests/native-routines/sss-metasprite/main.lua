-- game B routine 2: expand a meta-sprite (a small table of sprites, 8 bytes each: Y word, X word, pattern word,
-- attribute word) into consecutive sprite-list entries, adding an offset to Y and X and flipping attribute bits
-- ROUTINE-BEGIN
function expand(slot, n)
  local p = 1
  for k = 1, n do
    sat(slot, 0, ((ms[p] | (ms[p + 1] << 8)) + yo) & 65535)
    sat(slot, 1, ((ms[p + 2] | (ms[p + 3] << 8)) + xo) & 65535)
    sat(slot, 2, ms[p + 4] | (ms[p + 5] << 8))
    sat(slot, 3, (ms[p + 6] | (ms[p + 7] << 8)) ~ fl)
    p = p + 8
    slot = slot + 1
  end
end
-- ROUTINE-END
CALLS = 8
ms = { 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0 }
yo = 40
xo = 24
fl = 0
gy = 0
function init()
  vram[0x7FFE] = 0xBEEF
  for i = 1, 32 do ms[i] = (i * 23 + 7) & 255 end
  for e = 0, 3 do
    ms[e * 8 + 2] = 0
    ms[e * 8 + 4] = 0
    ms[e * 8 + 6] = 1
    ms[e * 8 + 8] = 0
  end
end
function frame(t, f)
  for k = 1, CALLS do
    local s = (k & 7) * 4
    expand(s, 4)  -- @base gy = gy + s
  end
end
