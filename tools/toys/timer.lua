-- timer.lua — card #45's timer witness.
--
-- timer(17, fn) starts the TMA timer with reload value 17, so an interrupt
-- every 18 ticks of 6,991.3 Hz (H8-20..H8-22): ~388 Hz, about 6.5 per
-- 60 Hz frame.  fn counts them; vram[0] carries the count and vram[1] the
-- frame number, so a capture's state gives interrupts per frame directly.
--
-- The browser host accumulates whole ticks across frames; the console runs
-- the real interrupt on vector $FFFA and pumps fn once per interrupt from
-- the frame loop, so both report the same figure.

n = 0

timer(17, function () n = n + 1 end)

function init()
  -- a blank background: every BAT cell shows char 0x40, whose tile is zero
  for y = 0, 27 do
    for x = 0, 31 do vram[y * 32 + x] = 0x0040 end
  end
end

function frame(t, f)
  -- both figures in VRAM well clear of the BAT (0..895)
  vram[0x3F00] = n
  vram[0x3F01] = f
  pal(1, rgb((n // 8) % 8, 0, 0))
end
