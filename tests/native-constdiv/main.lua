-- variable floor division and modulo: the C backend's il_lua_idiv / il_lua_mod (tests/check-cgen-constdiv.js)
a, b = 100, 7
function frame(t, f)
  a = a + 3
  b = b + 1
  local q = a // b
  local r = a % b
  sat(0, 0, (q + r) % 256)
end
