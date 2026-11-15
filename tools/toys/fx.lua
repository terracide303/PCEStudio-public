-- fx.lua — the sound effects (noise, slide, envelope, presets) on every
-- runtime: the browser host, the interpreter ROM and the native ROM write the
-- same PSG registers for this toy, frame for frame (tests/check-sfx-fx.js).
--
-- Every preset once, several at the same time on different channels, the
-- short forms, a plain sfx() cutting into a noise effect, and an effect
-- that is released by its own frame count.

function frame(t, f)
  if f == 0 then sfx_preset("jump", 0) end
  if f == 4 then sfx_preset("coin", 1) end
  if f == 20 then sfx_preset("shoot", 2) end
  if f == 40 then sfx_preset("hit", 4) end
  if f == 56 then sfx_preset("explosion", 5) end
  if f == 60 then sfx_preset("powerup", 3) end
  if f == 100 then sfx_preset("select", 0) end
  if f == 110 then sfx_preset("hurt", 1) end
  if f == 130 then sfx_preset("laser", 2) end
  if f == 160 then sfx_noise(4, 20, 25, 10) end
  if f == 170 then sfx_noise(5, 10, 25, 40) end
  if f == 180 then sfx(5, 300, 15, 6) end
  if f == 190 then sfx_slide(0, 400, 200, 20, 12) end
  if f == 205 then sfx_fx(3, 2, 100, 300, 30, 3, 5, 20) end
  if f == 230 then sfx_fx(4, 0, 400, 100, 20, 0, 0, 15) end
  -- the corners: attack only on a saw, a one-frame effect that cannot slide,
  -- and the widest slide with the longest ramps
  if f == 236 then sfx_fx(1, 3, 500, 500, 31, 8, 0, 12) end
  if f == 237 then sfx_fx(2, 0, 100, 3000, 31, 0, 0, 1) end
  if f == 238 then sfx_fx(0, 2, 4095, 0, 31, 100, 100, 200) end
  -- the wave instruments: organ, bass, buzz and sine, on a slide and a ramp
  -- (the log window the ROM tests read is one byte of frames, so they fit
  -- before frame 249)
  if f == 239 then sfx_fx(3, 4, 300, 300, 24, 0, 4, 8) end
  if f == 241 then sfx_fx(4, 5, 500, 500, 28, 2, 4, 10) end
  if f == 243 then sfx_fx(5, 6, 150, 90, 20, 0, 6, 12) end
  if f == 245 then sfx_fx(1, 7, 400, 200, 26, 3, 5, 16) end
  if f == 247 then sfx_fx(2, 4, 100, 400, 30, 4, 4, 14) end
end
