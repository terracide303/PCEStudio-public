-- table access with a known slot (tests/check-cgen-tables.js): the compiled C reads and writes the
-- cells directly, in byte, 16-bit and 32-bit cells, and shows what it computed through the sprite list
-- so the host comparison can read it.  Every index here is in range (the browser faults outside it).
flags = { 0, 0, 0, 0, 0, 0, 0, 0 }      -- masks: byte cells
wide = { 0, 0, 0, 0 }                    -- big values: 32-bit cells
sig = { 0, 0, 0 }                        -- small signed values: 16-bit cells
rec = { hp = 0, mp = 0 }                 -- a record of bytes
rec2 = { n = 0 }                         -- a record that stores a table read: 32-bit cells
local lcl = { 3, 1, 4, 1 }               -- a local captured by a function (read only there)
M = 4
local function peek(i) return lcl[i] end
local function pick(t, i) return t[i] end   -- a table that arrives as a parameter: the helper path
function init()
  for i = 1, 8 do flags[i] = (i * 5) & 15 end
  for i = 1, M do wide[i] = i * 70000 end
  for i = 1, 3 do sig[i] = 0 - i * 100 end
  rec.hp = 200
  rec.mp = 7
  rec2.n = 5
end
function frame(t, f)
  local k = (f & 7) + 1
  flags[k] = (flags[k] + f) & 63
  local j = (f % 4) + 1
  wide[j] = wide[j] + 1
  local s = (f % 3) + 1
  sig[s] = (f & 255) - 200
  rec.hp = f & 127
  rec.mp = rec.mp + 0 & 15
  rec2.n = rec2.n + f
  flags[1] = 9
  flags[8] = flags[2] + 1
  sat(0, 0, flags[k] + 1000)
  sat(0, 1, flags[8] + 1000)
  sat(1, 0, (wide[j] & 4095) + 1000)
  sat(1, 1, (wide[1] >> 4) & 4095)
  sat(2, 0, sig[s] + 1000)
  sat(2, 1, sig[1] + 1000)
  sat(3, 0, rec.hp + 1000)
  sat(3, 1, rec.mp + 1000)
  sat(4, 0, (rec2.n & 4095) + 1000)
  sat(4, 1, peek(j) + 1000)
  sat(5, 0, pick(flags, k) + 1000)
  sat(5, 1, (pick(wide, j) & 4095) + 1000)
  for i = 1, 4 do sat(6, i - 1, flags[i] + wide[i] % 7 + 1000) end
end
