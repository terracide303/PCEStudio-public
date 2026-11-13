-- 256 consecutive VRAM word writes a frame
x = 0
function init() vram[0x7FFE] = 0xBEEF end
function frame(t, f)
  for i = 0, 255 do vram[0x1000 + i] = i end
end
