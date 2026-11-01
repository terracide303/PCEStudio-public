-- tools/toys/not.lua — #187's evidence: the logical not carried as its own
-- opcode.  Everything frame() paints is the answer of a `not` instruction:
-- pal 0 and pal 1 flip together on `not even`, pal 2 and pal 3 follow a
-- second `not`, and the BXR scroll carries the first not's answer as a
-- value (the tile's left/right asymmetry makes a 4-px and an 8-px scroll
-- different pictures).  An interpreter that aliased `not` to bnot (~) would
-- turn false into 0xFFFFFFFF, a truthy branch: the wrong branch paints, its
-- BXR stays at one value, and the constant picture could only coincide with
-- one of the cycle's frames by luck — the host parity (tests/check-ilvm.js)
-- pins the semantics value for value, which a picture comparison cannot.
--
-- The picture repeats every 6 frames (f enters as f % 2 and f % 3), so a
-- Mednafen capture taken hundreds of frames in still matches one of the
-- browser's first frames (tests/check-export-games.js's comparison).

function init()
  for y = 0, 27 do
    for x = 0, 31 do vram[y * 32 + x] = 0x0040 end
  end
  for row = 0, 7 do
    local w0, w1 = 0, 0
    for col = 0, 7 do
      local c = row % 5
      if col >= 4 then c = c + 10 end
      if c % 2 >= 1 then w0 = w0 | (1 << (7 - col)) end
      if c >= 2 and (c % 4) >= 2 then w0 = w0 | (1 << (15 - col)) end
      if c >= 4 and (c % 8) >= 4 then w1 = w1 | (1 << (7 - col)) end
      if c >= 8 then w1 = w1 | (1 << (15 - col)) end
    end
    vram[0x40 * 16 + row] = w0
    vram[0x40 * 16 + 8 + row] = w1
  end
end

function frame(t, f)
  local even = (f % 2 == 0)
  local odd = not even
  local third = (f % 3 == 0)
  local notthird = not third

  if odd then
    pal(0, 300)
  else
    pal(0, 100)
  end
  pal(1, odd and 400 or 200)
  if notthird then
    pal(2, 450)
  else
    pal(2, 150)
  end
  pal(3, notthird and 350 or 250)
  vram[0x7E00 + f % 6] = odd and 0x222 or 0x111
  reg("BXR", odd and 8 or 4)
end
