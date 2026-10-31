-- tools/toys/tablepool.lua — #176's table-pool toy.
--
-- Three table globals, one of each shape the card's close-out needs: an
-- int array, a bool array and a record, all built by the top-level chunk
-- (function 0), so each gets one static slot in the fixed pool
-- (docs/TABLES-PLAN.md §2.1).  frame() reads every shape through a
-- register key, a constant key and a field id, and writes the int array
-- through both kinds of key.  Every picture value comes out of a table
-- read, so a wrong slot, index or field shows as a colour diff.
grid = {4, 8, 12}
flags = {true, false, true}
spec = {x = 1, y = 2, z = 3}

function frame(t, f)
  pal(1, grid[f % 3 + 1] * 32)
  if flags[f % 3 + 1] then
    pal(2, 200)
  else
    pal(2, 100)
  end
  grid[f % 3 + 1] = f % 7 + 1
  grid[1] = 4
  pal(3, grid[f % 3 + 1] * 24)
  pal(4, spec.x + spec.y * 10 + spec.z * 100)
  spec.z = 3
  pal(5, grid[2] * 40)
end
