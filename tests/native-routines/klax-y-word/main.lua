-- game A routine 1 (a sprite-list word: the Y position word): the console's sprite list wants Y + 64, and a
-- hidden sprite (Y = 248) gets a word that puts it off screen.  The routine reads one field of an object table.
-- ROUTINE-BEGIN
function put_y(i)
  local y = oy[i]
  if y == 248 then
    sat(i, 0, 384)
  else
    sat(i, 0, y + 64)
  end
end
-- ROUTINE-END
CALLS = 64
oy = { 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0 }
gy = 0
function init()
  vram[0x7FFE] = 0xBEEF
  for i = 1, 32 do oy[i] = (i * 37 + 5) % 247 end
end
function frame(t, f)
  for k = 1, CALLS do
    local i = (k & 31) + 1
    put_y(i)  -- @base gy = gy + i
  end
end
