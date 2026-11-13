-- 128 SAT word writes a frame, each through a small function
x = 0
local function put(i, k, v) sat(i, k, v) end
function init() vram[0x7FFE] = 0xBEEF end
function frame(t, f)
  for i = 0, 127 do put(i // 4, i % 4, i) end
end
