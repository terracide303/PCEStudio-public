-- tools/toys/tables.lua — #175's table-toy capture.
--
-- The #174 fixture in tests/check-ilvm.js (TABLES_TOY) writes BOX[9] on its
-- ninth frame on purpose, to prove the interpreter faults and touches no
-- cell.  A fault stops the toy for the rest of the run, so that fixture
-- cannot be captured in Mednafen and compared after N frames.  This toy is
-- the same five shapes with the writes bounded to the array's capacity, so
-- it runs forever:
--
--   INT  a constant int array          (setlist)
--   BOOL a boolean array               (setlist, read in a branch)
--   REC  a record read by field id     (field ids x, y)
--   PAIR a nested pair                 (PAIR[i][2])
--   BOX  a 16-cell array written and read through a register key
--
-- Every picture value comes out of a table read, so a wrong 1-based index,
-- field id or cell shows as a VRAM/CRAM diff against the browser.
INT = {3, 1, 4, 1, 5}
BOOL = {true, false, true}
REC = {x = 2, y = 3}
PAIR = {{0, 7}, {4, 1}}
BOX = {0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0}

function frame(t, f)
  pal(1, INT[f % 5 + 1])
  if BOOL[f % 3 + 1] then
    pal(2, 200)
  else
    pal(2, 100)
  end
  pal(3, REC.x + REC.y * 10)
  pal(4, PAIR[(f % 2) + 1][2])
  pal(5, f % 16 + 16)
  BOX[f % 16 + 1] = f % 16
  pal(6, BOX[f % 16 + 1] + 40)
  pal(7, f % 64 + 64)
end
