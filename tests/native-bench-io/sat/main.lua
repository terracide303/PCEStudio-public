-- 256 SAT word writes a frame (64 sprites x 4 words, in order)
x = 0
function init() vram[0x7FFE] = 0xBEEF end
function frame(t, f)
  for i = 0, 255 do sat(i // 4, i % 4, i) end
end
