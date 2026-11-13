-- tests/cave-style/main.lua — #219's evidence toy: a small original picture
-- (a 32x28 BAT, 16 tiles and a 16-colour palette) written as constants in
-- init(), with no pad and no sprites.  Its ROM must show the same picture
-- as the renderer (renderer/pce-sprites.js over renderer/pce-bg.js).
-- Original work: no art from any pack; every value is a formula below.

function init()
  -- 16 tiles of 16 words, pseudo-random so the words are mostly distinct
  -- constants (more than 127 of them, the pool wall #148 measured).
  for t = 0, 15 do
    for k = 0, 15 do
      vram[0x1000 + t * 16 + k] = ((t * 16 + k) * 37 + 11) & 0xFFFF
    end
  end
  -- the picture: 32 columns, 28 rows, tile and palette bank per cell
  for y = 0, 27 do
    for x = 0, 31 do
      local tile = (x * 5 + y * 3) & 15
      local bank = (y // 7) & 3
      vram[y * 32 + x] = tile + (bank << 12)
    end
  end
  -- 16 palette entries, each a formula of its index
  for e = 0, 15 do
    pal(e, rgb(e & 7, (e * 3) & 7, (7 - e) & 7))
  end
end

function frame(t, f)
end
