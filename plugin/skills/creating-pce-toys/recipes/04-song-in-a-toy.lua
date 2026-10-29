-- 04-song-in-a-toy.lua — a tune on the PSG, and a bar you can watch.
--
-- THE TRICK: the HuC6280 PSG has 6 voices but no hardware envelope, so a
-- note is a write: sfx(channel, freq, volume, frames) takes a channel, loads
-- a 32-step square wave, sets the 12-bit divider F and the 4-bit level AL,
-- and gives the channel back after `frames` frames. note(midi) turns a MIDI
-- number into that divider.
--
-- A toy has no song slots of its own here, so the tune is a table of MIDI
-- notes stepped by the frame counter — one note every 15 frames, eight
-- notes, then it repeats a fifth higher. The picture is the beat: the bar
-- grows while the note is held and snaps back when the next one starts.
--
-- Two channels are used: the melody on channel 0 and a fifth below on
-- channel 1, which is what makes it sound like a tune and not a beep.

local STEP = 15                   -- frames per note

-- One 8x8 character. fn(col, row) returns colour 0..15.
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

local function note_at(i)
  -- Eight MIDI notes (C E G C G E C G), then the same tune a fifth higher,
  -- then round again. Written as if-chains, not a table: the IL does not
  -- read back a table the toy built itself (il-table-read, docs/IL.md §5).
  local k = i % 8
  local n = 60
  if k == 1 then n = 64 end
  if k == 2 then n = 67 end
  if k == 3 then n = 72 end
  if k == 4 then n = 67 end
  if k == 5 then n = 64 end
  if k == 6 then n = 60 end
  if k == 7 then n = 55 end
  if (i // 8) % 2 == 1 then n = n + 7 end
  return n
end

function init()
  pal(0, rgb(0, 0, 1))            -- backdrop
  pal(1, rgb(1, 1, 4))            -- stage floor
  pal(2, rgb(6, 4, 0))            -- the bar
  pal(3, rgb(7, 7, 7))            -- the bar's crest

  -- A plain tile for the floor, a flat dark one for the stage.
  puttile(0x40, function(col, row)
    if (col + row) % 8 == 0 then return 1 end
    return 0
  end)
  puttile(0x41, function(col, row) return 1 end)
  puttile(0x42, function(col, row)
    if row < 2 then return 3 end
    return 2
  end)

  -- BAT: stage on the bottom four rows, floor above it.
  for row = 0, 27 do
    for col = 0, 31 do
      if row >= 24 then
        vram[row * 32 + col] = 0x41
      else
        vram[row * 32 + col] = 0x40
      end
    end
  end
end

function frame(t, f)
  local i = f // STEP
  local n = note_at(i)

  -- One note per STEP frames: the frame counter, not a timer, so a run is
  -- deterministic and the picture and the sound stay together.
  if f % STEP == 0 then
    sfx(0, note(n), 28, STEP)
    sfx(1, note(n - 12), 18, STEP)
  end

  -- The bar: its height follows how much of the note is still held.
  local held = f % STEP
  local height = 1 + (held * 22) // (STEP - 1)

  -- Paint the bar with BAT cells: a 0x42 cell for its body, then the stage
  -- row under it. Rows 1..24 are on the stage; row 27 is the floor.
  for row = 0, 27 do
    local col = 4
    if row >= 28 - height and row < 27 then
      vram[row * 32 + col] = 0x42
      vram[row * 32 + col + 1] = 0x42
    else
      if row >= 24 then
        vram[row * 32 + col] = 0x41
        vram[row * 32 + col + 1] = 0x41
      else
        vram[row * 32 + col] = 0x40
        vram[row * 32 + col + 1] = 0x40
      end
    end
  end
end
