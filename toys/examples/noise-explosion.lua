-- noise-explosion.lua — a noise-explosion demo: the PSG's noise generator.
-- Pad 1: button I sets off a big explosion, button II a short hit, left /
-- right a hiss that holds while the button is down.  The screen flashes with
-- the sound so you can see the frames it lasts.
--
-- Noise exists on two channels only, 4 and 5 (counting from 0), so every
-- noise call takes one of those; anything else is refused with sfx-range.
-- sfx_noise(channel, rate, volume, frames) holds one rate, sfx_fx with wave 1
-- slides the rate (31 is the highest hiss, 0 the lowest rumble) and shapes
-- the level with an attack and a decay.  A noise effect writes three
-- registers when it starts, which is cheaper than a tone's 32-step upload.
--
-- BUDGETS (measured by validate and rom_check)
--   interpreter functions: 2 of 41

flash = 0
was_i = false
was_ii = false
hiss = 0

function init()
  reg("CR", 0xC0)
  pal(0, rgb(0, 0, 0))
end

function frame(t, f)
  if pad[1].i and not was_i then
    -- the big one: the rate falls from a hiss to a rumble over 40 frames
    -- while the level fades to nothing
    sfx_preset("explosion", 5)
    flash = 8
  end
  was_i = pad[1].i

  if pad[1].ii and not was_ii then
    sfx_preset("hit", 4)
    flash = 3
  end
  was_ii = pad[1].ii

  -- a held hiss: sfx_noise re-armed every 8 frames, so it never clicks off
  if pad[1].left or pad[1].right then
    if hiss == 0 then
      sfx_noise(4, 31, 14, 10)
      hiss = 8
    end
    hiss = hiss - 1
  else
    hiss = 0
  end

  if flash > 0 then
    pal(0, rgb(flash, flash >> 1, 0))
    flash = flash - 1
  else
    pal(0, rgb(0, 0, 0))
  end
end
