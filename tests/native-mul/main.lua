-- the multiply the C backend lowers to il_lua_mul: variables on both sides
a, b = 3, 5
function frame(t, f)
  a = a + 7
  b = b - 3
  local p = a * b
  sat(0, 0, p % 256)
end
