-- fx-cost.lua — what an effect costs the native route per frame
-- (docs/NATIVE-SOUND.md "Effects").  N effects play all the time, each a
-- 250-frame slide with an attack and a decay (the dearest kind: every frame
-- moves the frequency AND the level) and starts again when it ends.  N = 0
-- keeps the sound glue linked and ticking with nothing playing.
--
--   for n in 0 1 3 6; do sed "s/^local N = .*/local N = $n/" tools/toys/fx-cost.lua > "$TMPDIR/fx-cost-$n.lua"
--     tools/build-toyc-banked.sh "$TMPDIR/fx-cost-$n.lua" fx-cost-$n
--     tools/native-measure.sh tools/gen/fx-cost-$n.pce fx-cost-$n; done
local N = 1

function frame(t, f)
  if f % 250 == 0 then
    for c = 0, N - 1 do
      if c < 4 then sfx_fx(c, 2, 4000, 300, 28, 80, 80, 250)
      else sfx_fx(c, 1, 3, 28, 28, 80, 80, 250) end
    end
  end
  if N == 0 and f == 0 then sfx(0, 200, 15, 1) end
end
