-- sfx-once.lua — one sfx(), at frame 0, and nothing else (#216's third
-- finding; docs/ROM-SOUND.md §11).
--
-- The two shipped sound toys (note.lua, sfx.lua) reserve a channel again
-- every 12 or 60 frames, so they play even when the sound glue's .bss holds
-- garbage at the first op.  This toy does not: a single reserve at frame 0.
-- On the scratch image that fixes the F mask and the main amplitude it is
-- still silent — the save state reads snd_owned[0] = $CF and snd_tick = 4,
-- so the reserve is skipped and a non-zero snd_tick runs the engine with
-- uninitialised state, which mutes the chip.  It is the reproducer for the
-- card that fixes the dirty state.
--
--   node tools/ilvm/emit.js tools/toys/sfx-once.lua "$TMPDIR/sfx-once.pce" sfx-once

function frame(t, f)
  if f == 0 then sfx(0, note(60), 15, 600) end
end
