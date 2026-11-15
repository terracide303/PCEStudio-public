-- sample-cost.lua: what a playing sample costs the native route per frame (docs/NATIVE-SOUND.md "Samples").
-- The thump (3,496 Hz) starts again every 18 frames, so a sample plays all the time; the song plays on
-- the other channels.  Measured with Geargrafx's profiler, see the docs.
function init()
  music(0)
end

function frame(t, f)
  if f % 18 == 0 then sample("thump", 5) end
end
