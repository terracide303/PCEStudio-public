-- tools/toys/loud.lua — the stack canary's loud toy (#214).
--
-- The HuTrack engine's .bss sits between the interpreter image's .bss and
-- the stack (docs/ROM-SOUND.md §5), so the interpreter's soft stack must
-- never grow down into it.  This toy carries the deepest call tree the
-- shipping toys and games express -- frame() -> level1 -> level2 -> level3
-- -> leaf, five interpreter frames, the same shape as PLATFORMER's
-- frame -> draw_step -> build_tiles -> puttile -> callback -- and each
-- level keeps its own locals.  init() also draws through a callback closure.
-- The canary rebuilds the interpreter with -DTOY_STACK_PROBE
-- (tools/ilvm/stack-canary.sh), runs this ROM in Mednafen, and reads the
-- lowest soft-stack address back out of the save state's BaseRAM.
--
-- Six levels (one more `level4`) is the measured boundary: it reaches the
-- engine block by 39 B on the #214 partition (docs/ROM-SOUND.md §5).
--
-- The picture is deliberately busy and repeats every 16 frames (the frame
-- index enters as f % 16), so a capture can prove the toy ran.

local function puttile(char, fn)
  for row = 0, 7 do
    local w0, w1 = 0, 0
    for col = 0, 7 do
      local c = fn(col, row)
      if c % 2 >= 1 then w0 = w0 | (1 << (7 - col)) end
      if c >= 2 and (c % 4) >= 2 then w0 = w0 | (1 << (15 - col)) end
      if c >= 4 and (c % 8) >= 4 then w1 = w1 | (1 << (7 - col)) end
      if c >= 8 then w1 = w1 | (1 << (15 - col)) end
    end
    vram[char * 16 + row] = w0
    vram[char * 16 + 8 + row] = w1
  end
end

-- The chain: every level keeps four locals of its own and calls the next one
-- twice, so the accumulator below the leaves is as wide as the language's
-- arithmetic allows (no arrays, no recursion -- the stack is the point).
local function leaf(a, b, c, d)
  local p = a + b
  local q = c + d
  local r = p * 3 + q * 5
  local s = p * 7 + q * 11
  return (r + s + a + b) % 512
end

local function level3(a, b, c, d)
  local x = leaf(a + 1, b + 2, c + 3, d + 4)
  local y = leaf(d + 1, c + 2, b + 3, a + 4)
  return (x * 7 + y * 9) % 512
end

local function level2(a, b, c, d)
  local x = level3(a, b, c, d)
  local y = level3(b, c, d, a)
  return (x * 11 + y * 13) % 512
end

local function level1(a, b, c, d)
  local x = level2(a, b, c, d)
  local y = level2(c, d, a, b)
  return (x * 17 + y * 19) % 512
end

function init()
  for y = 0, 27 do
    for x = 0, 31 do vram[y * 32 + x] = 0x0040 end
  end
  puttile(0x40, function(col, row)
    if col == row then return 15 end
    if (col * 3 + row) % 7 == 0 then return 2 end
    return 1
  end)
end

function frame(t, f)
  local k = f % 16
  local v = level1(k, k + 1, k + 2, k + 3)
  pal(0, v)
  pal(1, level1(k + 3, k + 4, k + 5, k + 6))
  pal(2, level1(k + 6, k + 7, k + 8, k + 9))
  pal(3, level1(k + 9, k + 10, k + 11, k + 12))
  vram[0x40 * 16 + k] = v
end
