-- sound-jump-shoot.lua — a jump-and-shoot sound demo: no art to speak of, the
-- sound is the point.
-- Pad 1: button I jumps (a little square hops on the floor), button II
-- shoots, left / right pick the shot's voice: saw, organ or bass.
--
-- Every call below is carried by the exported console image: sfx_preset,
-- sfx_fx with the wave instruments and note().  A shot is one sfx_fx on its
-- own channel: it takes the channel from any music, plays, and gives it back
-- by itself after `frames`.  Cost: a tone effect uploads its 32-step wave
-- when it starts (about 7,000 cycles, one frame) and then about 400 cycles a
-- frame while it plays.
--
-- BUDGETS (measured by validate and rom_check)
--   sprites used: 1 of 64
--   interpreter functions: 2 of 41

y = 168        -- the hero's height, screen lines
vy = 0         -- vertical speed, lines a frame (x4 for a little arc)
voice = 0      -- 0 saw, 1 organ, 2 bass
was_i = false
was_ii = false
was_l = false
was_r = false

function init()
  reg("CR", 0xC0)
  pal(0, rgb(0, 0, 2))
  pal(0x101, rgb(7, 7, 2))
  for row = 0, 15 do
    vram[0x100 * 64 + row] = 0xFFFF       -- a solid 16x16 square
    vram[0x100 * 64 + 16 + row] = 0
  end
  sat(0, 2, 0x100 << 1)
  sat(0, 3, 0x80)
  sat(0, 1, 120 + 32)
  sat(0, 0, y + 64)
end

function frame(t, f)
  -- jump: the preset on channel 0, a hop of about 24 frames
  if pad[1].i and not was_i and y >= 168 then
    vy = 0 - 9
    sfx_preset("jump", 0)
  end
  was_i = pad[1].i
  if y < 168 or vy < 0 then
    y = y + vy
    vy = vy + 1
    if y >= 168 then
      y = 168
      vy = 0
    end
  end
  sat(0, 0, y + 64)

  -- pick the voice: a wave number of sfx_fx (3 saw, 4 organ, 5 bass)
  if pad[1].right and not was_r then voice = (voice + 1) % 3 end
  if pad[1].left and not was_l then voice = (voice + 2) % 3 end
  was_r = pad[1].right
  was_l = pad[1].left

  -- shoot: a falling zap, F slides from a high note to a low one on channel 1
  if pad[1].ii and not was_ii then
    sfx_fx(1, 3 + voice, note(84), note(60), 28, 0, 8, 14)
  end
  was_ii = pad[1].ii
end
