-- sfx.lua — sfx() and release() on the console (#216).
--
-- Every 60 frames, two channels are reserved and made to sound, one after
-- the other so a recording's spectrum says which one sounded:
--   channel 1, frames 0..9:   a raw F 200 (559 Hz) blip, which the
--                             per-frame tick gives back on its own;
--   channel 2, frames 30..49: note(48)'s F 855 (131 Hz) with a 600-frame
--                             budget, cut by an explicit release(2) at
--                             frame 50 — the release path, not a timer.
-- (F is the PSG's 12-bit divider: the frequency is 7,159,090 / (64 * F) —
-- F 200 is 559 Hz, not 200 Hz.)
--
--   node tools/ilvm/emit.js tools/toys/sfx.lua "$TMPDIR/sfx.pce" sfx

function frame(t, f)
  local i = f % 60
  if i == 0 then sfx(1, 200, 15, 10) end
  if i == 30 then sfx(2, note(48), 15, 600) end
  if i == 50 then release(2) end
end
