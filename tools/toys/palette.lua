
local function puttile(char, fn)
  for row = 0, 7 do
    local w0, w1 = 0, 0
    for col = 0, 7 do
      local c = fn(col, row)
      if c % 2 >= 1 then w0 = w0 | (1 << (7 - col)) end
      if c >= 2 and (c % 4) >= 2 then w0 = w0 | (1 << (15 - col)) end
      if c >= 4 and (c % 8) >= 4 then w1 = w1 | (1 << (7 - col)) end
      if c >= 8 then w1 = w1 | (1 << (15 - col)) end
    end
    vram[char * 16 + row] = w0
    vram[char * 16 + 8 + row] = w1
  end
end

function init()
  for y = 0, 27 do
    for x = 0, 31 do vram[y * 32 + x] = 0x0040 end
  end
  puttile(0x40, function(col, row)
    if col == row then return 15 else return 1 end
  end)
end
function frame(t, f)
  for e = 1, 15 do
    pal(e, rgb((e + f) % 8, f % 8, (e * 3 + f) % 8))
  end
end
