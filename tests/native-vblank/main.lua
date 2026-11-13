-- music plus a scroll write every frame: the write must land inside the VBlank
-- (tests/check-native-vblank.js). The sound tick makes some frames slow.
function frame(t, f)
  if f == 0 then music(0) end
  reg("BYR", (f // 90) % 2)
  pal(1, rgb(f % 8, 0, 0))
end
