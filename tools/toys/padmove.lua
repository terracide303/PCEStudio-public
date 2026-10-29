-- padmove.lua — card #45's pad witness.
--
-- pad[1] moves one sprite.  The same source runs in the browser
-- (renderer/pce-toys.js) and on the console through tools/build-toyc.sh, so
-- the two runs differ only in where the pad state comes from: the browser's
-- setPad() and Mednafen's own recorded input, played back from a movie.
--
-- vram[1] carries the toy's frame number, so a capture's state says which
-- frame it is and the two runs can be lined up exactly.

px = 144                  -- SAT X 32 is display column 0
py = 128                  -- SAT Y 64 is display row 0

function init()
  -- a blank background: every BAT cell shows char 0x40, whose tile is zero
  for y = 0, 27 do
    for x = 0, 31 do vram[y * 32 + x] = 0x0040 end
  end
  -- A sprite pattern is not a BAT tile: pattern p is the 64-word cell at
  -- word p*64, plane n at p*64 + n*16 + row, bit 15 the left pixel.
  for row = 0, 15 do
    vram[0x100 * 64 + row] = 0xFFFF          -- plane 0: every pixel
    vram[0x100 * 64 + 16 + row] = 0
    vram[0x100 * 64 + 32 + row] = 0
    vram[0x100 * 64 + 48 + row] = 0
  end
  -- a sprite's colours live in the second half of the VCE's colour RAM:
  -- palette 0, colour 1 is CRAM[$101], not CRAM[1]
  pal(0x101, rgb(7, 7, 0))
  reg("CR", 192)                            -- BB background + SB sprites
end

function frame(t, f)
  if pad[1].right then px = px + 1 end
  if pad[1].left then px = px - 1 end
  if pad[1].up then py = py - 1 end
  if pad[1].down then py = py + 1 end

  sat(0, 0, py + 64)                        -- SAT word 0: Y
  sat(0, 1, px + 32)                        -- SAT word 1: X
  sat(0, 2, 0x100 * 2)                      -- SAT word 2: pattern << 1
  sat(0, 3, 0)                              -- SAT word 3: palette 0

  -- the toy's frame number, in VRAM well clear of the BAT (0..895) and
  -- of the sprite patterns at 0x4000
  vram[0x3F00] = f
end
