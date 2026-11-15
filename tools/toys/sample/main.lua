-- sample(): DDA sample playback (docs/TOYS.md "Samples").  A thump on channel 5 every second,
-- a click on channel 4 when the pad's button I goes down.  The sources are thump.wav and click.wav,
-- made by tools/gen-sample-wav.js and converted into samples.json by tools/wav2sample.js.
function init()
  music(0)
end

function frame(t, f)
  if f % 60 == 0 then sample("thump", 5) end
  if f % 60 == 30 then sample("click", 4) end
end
