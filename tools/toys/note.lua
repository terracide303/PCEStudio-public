-- note.lua — note() on the console (#216).
--
-- Four MIDI notes, each held 12 toy frames (about 200 ms at 60 Hz), repeating
-- every 48 frames: C4 (60), E4 (64), G4 (67), C5 (72).  note() returns the
-- PSG's 12-bit F divider from the same table the studio's host uses, and an
-- sfx() uploads the 32-step square and writes F/AL to the channel.
--
-- The repeating pattern is what a Mednafen sound recording can be measured
-- against: four tones in a fixed order, each one note long, at the pitches
-- the studio's pce-psg model says.  tests/check-rom-sound.js carries the
-- write-for-write host/harness pins; this toy is the ear's witness.
--
-- Its ROM is built with no compiler:
--   node tools/ilvm/emit.js tools/toys/note.lua "$TMPDIR/note.pce" note

function frame(t, f)
  local i = f % 48
  if i == 0 then sfx(0, note(60), 15, 12) end
  if i == 12 then sfx(0, note(64), 15, 12) end
  if i == 24 then sfx(0, note(67), 15, 12) end
  if i == 36 then sfx(0, note(72), 15, 12) end
end
