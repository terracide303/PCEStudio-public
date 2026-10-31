-- tools/toys/arity.lua — a 5-8 parameter toy (#183's evidence).
--
-- Four functions take five, six, seven and eight parameters, and each one
-- calls the one below it, so a call's extra-argument block is written by the
-- caller, copied by the callee, and overwritten again by the next call down
-- the chain.  Every parameter reaches a CRAM word and every one of those
-- words is on screen, so a mis-passed argument changes the picture.
--
-- The frame index enters as f % 16, so the picture repeats every 16 frames:
-- a Mednafen capture taken hundreds of frames in still matches one of the
-- browser's first frames (tests/check-export-games.js's comparison).

local function f5(a, b, c, d, e)
  return (a * 31 + b * 17 + c * 11 + d * 7 + e * 3) % 512
end

local function f6(a, b, c, d, e, g)
  return (f5(a, b, c, d, e) + g * 29) % 512
end

local function f7(a, b, c, d, e, g, h)
  return (f6(a, b, c, d, e, g) + h * 23) % 512
end

local function f8(a, b, c, d, e, g, h, i)
  return (f7(a, b, c, d, e, g, h) + i * 19) % 512
end

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
  -- Row r of the tile is colour r % 5, so colours 0..4 are on screen.
  puttile(0x40, function(col, row) return row % 5 end)
end

function frame(t, f)
  local k = f % 16
  pal(0, f5(k, 1, 2, 3, 4))
  pal(1, f6(k, 1, 2, 3, 4, 5))
  pal(2, f7(k, 1, 2, 3, 4, 5, 6))
  pal(3, f8(k, 1, 2, 3, 4, 5, 6, 7))
  pal(4, f8(k, 7, 6, 5, 4, 3, 2, 1))
end
