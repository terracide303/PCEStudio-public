-- 07 - a song in a game: music(0) plays the toy's own song file.
--
-- A song is not code in main.lua.  It is a file beside it: song.json, the
-- SEQUENCER's own document (or a .mid through source_add, which becomes the
-- same file).  song_write below composes this one: the -- SONG line carries
-- the same {name, tempo, steps, notes} call an agent makes, and
-- tests/check-skill.js parses that line and sends it, exactly as you would:
--
--   song_write {name, tempo, steps, notes:[{channel, step, note, length,
--                                         instrument}]}
--
-- Then music(0) in init() starts it and the runtime loops it while the game
-- runs -- one call, no per-frame stepping.  sfx() is still how a game makes
-- an EFFECT: it takes a channel from the song for a few frames and hands it
-- back, the way HuTrack reserves one (the jump sound below).
--
-- The picture is the stage the tune runs on: a scrolling ground, a light
-- that pulses on the beat, and the player's mark.  What the channels are
-- doing is in toy_run's sound report, not in a screenshot.

local GROUND = 0x40               -- the ground's top tile
local BODY = 0x41                 -- the ground's fill, and the mark
local LIGHT = 0x42                -- the beat light
local MARK_PAL = 5                -- the mark's palette row (CRAM 80..95)

-- One 8x8 character: fn(col, row) returns colour 0..15.
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
  pal(0, rgb(0, 0, 1))            -- the sky
  pal(1, rgb(1, 2, 0))            -- the ground
  pal(2, rgb(3, 2, 1))            -- its grout
  pal(3, rgb(7, 6, 2))            -- the beat light, in its on colour

  -- the mark's own row: BAT cell palette 5 puts colour 1 at CRAM 81
  pal(MARK_PAL * 16 + 1, rgb(7, 2, 2))
  pal(MARK_PAL * 16 + 2, rgb(4, 0, 0))

  puttile(GROUND, function(col, row)
    if row == 0 then return 2 end
    if (col + row) % 4 == 0 then return 2 end
    return 1
  end)
  puttile(BODY, function(col, row)
    if (col * 2 + row) % 8 == 0 then return 2 end
    return 1
  end)
  puttile(LIGHT, function(col, row) return 3 end)

  -- the ground: rows 24..27, the top tile on row 24
  for col = 0, 31 do
    vram[24 * 32 + col] = GROUND
    for row = 25, 27 do
      vram[row * 32 + col] = BODY
    end
  end

  -- the song the toy's files carry.  It is already loaded when init() runs:
  -- music(index) starts song index 0, the first song a toy's files hold.
  music(0)
end

function frame(t, f)
  -- the stage scrolls; the ground repeats every 8 px, so BXR 0..1023 wraps
  reg("BXR", f * 2)

  -- one light on the top row, pulsing every 12 frames (the song's beat)
  if f % 12 < 6 then
    pal(3, rgb(7, 6, 2))
  else
    pal(3, rgb(2, 1, 0))
  end
  vram[1 * 32 + 15] = LIGHT

  -- the player's mark, walking with the beat
  local x = 8 + (f * 2) % 200
  vram[23 * 32 + (x // 8)] = BODY | (MARK_PAL << 12)

  -- II (keyboard M) is a jump: a short blip on channel 4, taken from the
  -- song for 6 frames and given back by the sfx timer
  if pad[1].ii and f % 18 == 0 then
    sfx(4, note(72), 20, 6)
  end
end
-- SONG {"name": "game tune", "tempo": 140, "steps": 16, "notes": [{"channel": 0, "step": 0, "note": "C4", "length": 2, "instrument": "lead"}, {"channel": 0, "step": 4, "note": "E4", "length": 2, "instrument": "lead"}, {"channel": 0, "step": 8, "note": "G4", "length": 4, "instrument": "lead"}, {"channel": 1, "step": 0, "note": "C3", "length": 8, "instrument": "bass"}, {"channel": 2, "step": 0, "note": "C5", "length": 2, "instrument": "bell"}, {"channel": 2, "step": 8, "note": "G5", "length": 2, "instrument": "bell"}]}
