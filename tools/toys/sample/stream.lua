-- once.lua without the song: the only PSG writes the engine's log sees are sample()'s reserve, the
-- square the sfx glue uploads and the release, so tests/check-sample.js can compare the whole log
-- with the studio's stream.
function frame(t, f)
  if f == 3 then sample("thump", 5) end
  if f == 40 then sample("thump", 5) end
  if f == 41 then sample("click", 4) end
end
