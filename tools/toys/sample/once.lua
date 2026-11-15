-- sample() test toy: a whole thump, then a thump cut by a click, with music on the other channels.
-- (tests/check-sample.js compares the DDA steps the browser model and the native ROM write.)
function init()
  music(0)
end

function frame(t, f)
  if f == 3 then sample("thump", 5) end
  if f == 40 then sample("thump", 5) end
  if f == 41 then sample("click", 4) end
end
