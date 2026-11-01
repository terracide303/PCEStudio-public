-- sprite.lua: sprite() on route 1 (#133).  Every field and attribute the
-- op carries is a constant here, so the encoder pins the six operand bytes
-- and the runtime writes the same SAT words the browser's host.sprite
-- writes (renderer/pce-toyhost.js).  tests/check-ilvm.js's
-- checkSpriteEncoding pins this toy's container; the host-parity run of the
-- same toy is the #133 evidence that the words match the browser's.
--
-- Three specs, all constant:
--   sprite 0  the full spec: slot, x, y, pattern, palette
--   sprite 1  a partial spec: y is absent (defaults to 0), hflip and cgx
--              carry the attribute bits
--   sprite 2  spbg, cgy and vflip pack the rest of the attr byte
--
-- The three sprites are visible, so a captured frame is evidence and not a
-- black screen (#190/#191): CR turns the sprite layer on (SB, bit 6), and
-- the pattern code 0x100 names the cell the tile is written to — pattern p
-- is the 64-word VRAM cell at word p*64 (renderer/pce-sprites.js), so
-- 0x100 is word 0x4000.  The filled cell is all colour 15, which sprite
-- palette 1 reads from CRAM $11F ($100 + palette 1 * 16 + colour 15).

init = function ()
  pal(0, rgb(0, 0, 0))
  pal(1, rgb(7, 7, 7))
  pal(0x11F, rgb(7, 7, 7))   -- sprite palette 1, colour 15
  reg("CR", 0xC0)            -- BB + SB: without SB no sprite is drawn
  -- one filled 16x16 tile at sprite pattern 0x100 (VRAM word 0x4000)
  local i = 0
  while i < 64 do
    vram[0x4000 + i] = 0xFFFF
    i = i + 1
  end
end

frame = function (t, f)
  sprite(0, { x = 32, y = 64, pattern = 0x100, palette = 1 })
  sprite(1, { x = 64, pattern = 0x100, palette = 1, hflip = true, cgx = true })
  sprite(2, { x = 96, y = 96, pattern = 0x100, palette = 1,
              spbg = true, cgy = 3, vflip = true })
end
