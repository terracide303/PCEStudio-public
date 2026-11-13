-- 128 VRAM word writes a frame, each through a small function (the realistic shape: not inlined into a loop)
x = 0
local function put(a, w) vram[a] = w end
function init() vram[0x7FFE] = 0xBEEF end
function frame(t, f)
  for i = 0, 127 do put(0x1000 + i * 2, i) end
end
