-- song-effects — a song with sound effects on the channel hand-off.
-- The song (song.json, the sequencer's own file) plays from the first frame.
-- Pad 1: button I fires a sweeping sine on channel 3, button II a bass drop
-- on channel 2, run/select rings a coin on channel 1.  The song keeps running
-- underneath; each effect takes its channel for its length and the song
-- waits for its next note on that channel to take it back (release()).
--
-- This is how a ROM gets "music effects" today: the song format's own
-- effect columns (arpeggio, vibrato, slides) are refused with song-fx, but a
-- pitch slide, a fade in or out and a cut are what sfx_fx does, per channel,
-- on top of the song.
--
-- BUDGETS (measured by validate and rom_check)
--   songs: 1 of 8
--   interpreter functions: 2 of 41

was_i = false
was_ii = false
n = 0

function init()
  reg("CR", 0xC0)
  pal(0, rgb(0, 0, 1))
end

function frame(t, f)
  if f == 0 then music(0) end

  -- a sine sweep that swells in over 4 frames and fades over the last 12
  if pad[1].i and not was_i then
    sfx_fx(3, 7, note(96), note(60), 26, 4, 12, 28)
  end
  was_i = pad[1].i

  -- a bass drop; a long decay so the note dies away like a slide-down
  if pad[1].ii and not was_ii then
    sfx_fx(2, 5, note(48), note(31), 30, 0, 20, 30)
  end
  was_ii = pad[1].ii

  -- every two seconds a coin on channel 1, and a hard cut of a long tail
  n = n + 1
  if n == 120 then
    sfx_preset("coin", 1)
  end
  if n == 150 then
    sfx_fx(1, 4, note(72), note(72), 20, 0, 0, 120)   -- an organ hold...
  end
  if n == 180 then
    release(1)                                       -- ...cut by release()
    n = 0
  end
end
