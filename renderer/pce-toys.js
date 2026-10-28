/*
 * pce-toys.js — PCEStudio's live toy runtime (card #30, first half).
 *
 * A toy is one Lua file with three optional entry points, in the shape
 * ppu.toys established (docs/PPU-TOYS.md) and adapted to the PC Engine:
 *
 *   init()                 runs once, after the file's top-level statements
 *   frame(t, f)            runs once per video frame; t seconds, f frame number
 *   raster(line)           optional: runs for every VDW display line 0..223 of
 *                          the frame, after frame(), so code can change the
 *                          VDC/VCE per line (the PCE's line interrupt, RCR)
 *
 * The toy may set the registers the author's reference (#61) will list —
 * BXR, BYR, CR — the VCE's colour table, the SAT, VRAM, and the raster table
 * — read pad[1..5] (2-button pads) and pack/read a save as a password. Nothing
 * is drawn here: every frame is handed to the models that already exist and
 * are proven against Mednafen, renderer/pce-bg.js and renderer/pce-sprites.js
 * (and, when sound comes to toys in #71, renderer/pce-psg.js). This file is a
 * front end to those models, not a second model.
 *
 * Design decisions and their reasons are in docs/TOYS.md. The short version:
 * Fengari (Lua 5.3 in JavaScript, MIT) over wasmoon — half the bytes, and ~4x
 * faster on this runtime's hot path, a host call per register/palette write
 * (measured, docs/TOYS.md §1).
 *
 * Refusals carry a code (e.code, and the Lua message's TOYCODE marker):
 *   reg-forbidden     a register a toy may not touch
 *   reg-range         a register value outside its hardware width
 *   pal-range         a colour-table address or word outside 0..511
 *   vram-range        a VRAM word address/word outside 0..32767 / 0..65535
 *   sat-range         a SAT entry index/word outside 0..63 / 0..65535
 *   sprite-range      a sprite field outside the SAT's range
 *   raster-line       a raster line outside VDW 0..223
 *   raster-line-full  a second raster entry on a line, or too many colour
 *                     writes on one line (the RCR interrupt fires once a line)
 *   password-value    a save value that cannot be packed (type/size/depth)
 *   password-code     a password that is not one (alphabet/check byte/value)
 *   toy-timeout       a hook ran past the frame's Lua budget
 *   toy-error         a Lua error inside the toy, with file:line
 *
 * The Lua helpers (clamp, lerp, the ramp/ease helpers, the note-name parser, the tracked
 * per-line write journal) are adapted from ppu.toys, MIT, Copyright (c) 2026
 * Liora Labs — see vendor/ppu-toys/VENDORED.md and the MIT notice below in
 * the prelude. The note() helper returns the PCE PSG's 12-bit F register
 * value (F = 7,159,090 / (64 f), docs/PSG.md), not an SNES sample pitch.
 *
 * VM: fengari-web 0.1.4 (Lua 5.3 in JS), MIT — see vendor/fengari/. Dual use:
 * CommonJS in Node (tests/check-toys.js) and a browser global in
 * renderer/toys.html. In the browser load vendor/fengari/fengari-web.js first.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./pce-bg.js"),
                             require("./pce-sprites.js"),
                             require("./pce-toyhost.js"),
                             require("../vendor/fengari/fengari-node.js"));
  } else {
    root.PCEStudio = root.PCEStudio || {};
    root.PCEStudio.toys = factory(root.PCEStudio.bg, root.PCEStudio.sprites,
                                  root.PCEStudio.toyhost, root.fengari);
  }
})(typeof self !== "undefined" ? self : this,
   function (bg, sprites, toyhost, F) {
  "use strict";

  /* The toy's own contract — the register ranges, the SAT composition, the
   * one-entry-per-line raster table, the pads, the frame flow — lives in
   * renderer/pce-toyhost.js, once, for both front ends (this Lua runtime and
   * the IL interpreter in renderer/pce-il.js). This file is the Lua VM, the
   * sandbox and the Lua-side plumbing onto that host. */
  var WIDTH = toyhost.WIDTH;
  var HEIGHT = toyhost.HEIGHT;
  var VDW_LINES = toyhost.VDW_LINES;
  var HOOK_COUNT = 10000;        /* Lua instructions between budget checks */
  var DEFAULT_BUDGET_MS = 100;

  /* ---- refusals -------------------------------------------------------- */

  /* The host throws this class; the runtime must expose the same one, so a
   * refusal the host raises is still `instanceof toys.ToyError` here and in
   * tests/check-toys.js. */
  var ToyError = toyhost.ToyError;

  function refuse(code, message) { throw new ToyError(code, message); }

  /* Run a host call from inside a Lua C function: a host refusal gets the
   * toy's own file:line in front of it, as every refusal in this runtime
   * does. */
  function luaHost(L, fn) {
    try {
      return fn();
    } catch (e) {
      if (e instanceof ToyError) luaFail(L, e.code, e.message);
      throw e;
    }
  }

  /* A refusal raised inside a host function: read the toy's own file:line
   * from the Lua call stack before throwing, so the message names the line
   * the author wrote. */
  function luaFail(L, code, message) {
    var where = "";
    if (F.lauxlib.luaL_where(L, 1)) {
      var s = F.lua.lua_tostring(L, -1);
      if (s) where = F.to_jsstring(s);
      F.lua.lua_pop(L, 1);
    }
    throw new ToyError(code, where + message);
  }

  /* A Lua error string can carry a code as "TOYCODE:code: message"; the
   * chunk's file:line prefix (Lua's own) is kept in front of it. */
  function errorFromStack(L) {
    var v = F.lua.lua_tostring(L, -1);
    var msg = v ? F.to_jsstring(v) : "(error object)";
    var idx = msg.indexOf("TOYCODE:");
    if (idx >= 0) {
      var rest = msg.slice(idx + 8);
      var c = rest.indexOf(":");
      if (c >= 0) {
        return new ToyError(rest.slice(0, c), msg.slice(0, idx) + rest.slice(c + 1).replace(/^ /, ""));
      }
    }
    return new ToyError("toy-error", msg);
  }

  /* ---- Lua prelude ----------------------------------------------------- */

  /* Adapted from ppu.toys (MIT, Copyright (c) 2026 Liora Labs): ramps.lua's
   * interpolation helpers and kit.lua's note-name parser. The PCE changes:
   * lerp_color works on the VCE's 9-bit word (B bits 0-2, R 3-5, G 6-8) and
   * note() returns the PSG's 12-bit F, not an SNES sample pitch. The
   * password encoder is ours, but its contract (typed, capped, naming the
   * offending value) is ppu.toys' sram contract applied to Dennis's
   * passwords-instead-of-saves decision (docs/DECISIONS.md 2026-10-28). */
  var PRELUDE = [
    "-- PCEStudio toy helpers. Portions adapted from ppu.toys (MIT,",
    "-- Copyright (c) 2026 Liora Labs): ramps.lua and kit.lua's note parser.",
    "min, max, floor = math.min, math.max, math.floor",
    "sin, cos, abs, sqrt, pi = math.sin, math.cos, math.abs, math.sqrt, math.pi",
    "",
    "function clamp(value, lo, hi)",
    "  if lo > hi then error(\"clamp: minimum must not exceed maximum\") end",
    "  return max(lo, min(hi, value))",
    "end",
    "function lerp(a, b, t) return a + (b - a) * t end",
    "function lerp_color(a, b, t)",
    "  t = clamp(t, 0, 1)",
    "  local result = 0",
    "  for c = 0, 2 do",
    "    local scale = 8 ^ c",
    "    local av, bv = floor(a / scale) % 8, floor(b / scale) % 8",
    "    result = result + floor(lerp(av, bv, t) + 0.5) * scale",
    "  end",
    "  return result",
    "end",
    "function ease(t, easing)",
    "  if easing == \"smooth\" then return t * t * (3 - 2 * t) end",
    "  if easing == \"ease-in\" then return t * t end",
    "  if easing == \"ease-out\" then return t * (2 - t) end",
    "  if easing == \"step\" then return t < 1 and 0 or 1 end",
    "  return t",
    "end",
    "function ramp(kf, y)",
    "  local n = #kf",
    "  if n == 0 then error(\"ramp: at least one keyframe is required\") end",
    "  if y <= kf[1][1] then return kf[1][2] end",
    "  for i = 2, n do",
    "    local a, b = kf[i - 1], kf[i]",
    "    if y <= b[1] then",
    "      local d = b[1] - a[1]",
    "      if d <= 0 then return b[2] end",
    "      return lerp(a[2], b[2], ease((y - a[1]) / d, a[3]))",
    "    end",
    "  end",
    "  return kf[n][2]",
    "end",
    "function ramp_int(kf, y) return floor(ramp(kf, y) + 0.5) end",
    "function ramp_color(kf, y)",
    "  if #kf == 0 then error(\"ramp_color: at least one keyframe is required\") end",
    "  local a, b = kf[1], kf[1]",
    "  for i = 2, #kf do",
    "    if y <= b[1] then break end",
    "    a, b = b, kf[i]",
    "  end",
    "  local t = 0",
    "  if b[1] > a[1] then t = clamp((y - a[1]) / (b[1] - a[1]), 0, 1) end",
    "  t = ease(t, a[3])",
    "  return lerp_color(a[2], b[2], t)",
    "end",
    "",
    "-- A VCE colour word from 3-bit channels (manual: G 6-8, R 3-5, B 0-2).",
    "function rgb(r, g, b) return ((g % 8) * 64) + ((r % 8) * 8) + (b % 8) end",
    "",
    "-- Note name (C4, C#4, Db4, a MIDI number) -> the PSG's 12-bit F.",
    "-- PCE PSG output f = 7,159,090 / (64 * F) (docs/PSG.md), so",
    "-- F = 7,159,090 / (64 * 440 * 2^((midi - 69) / 12)).",
    "local NOTE_INDEX = { c = 0, d = 2, e = 4, f = 5, g = 7, a = 9, b = 11 }",
    "local DIGIT = {}",
    "for d = 0, 9 do DIGIT[tostring(d)] = d end",
    "local function parse_octave(s, i)",
    "  local len = string.len(s)",
    "  local neg = false",
    "  if string.sub(s, i, i) == \"-\" then neg = true; i = i + 1 end",
    "  local n, saw = 0, false",
    "  while i <= len do",
    "    local d = DIGIT[string.sub(s, i, i)]",
    "    if d == nil then return nil end",
    "    n = n * 10 + d; saw = true; i = i + 1",
    "  end",
    "  if not saw then return nil end",
    "  if neg then n = -n end",
    "  return n",
    "end",
    "local function parse_note_name(s)",
    "  if string.len(s) < 2 then return nil end",
    "  local step = NOTE_INDEX[string.lower(string.sub(s, 1, 1))]",
    "  if step == nil then return nil end",
    "  local i, accidental = 2, 0",
    "  local c2 = string.sub(s, 2, 2)",
    "  if c2 == \"#\" then accidental, i = 1, 3",
    "  elseif string.lower(c2) == \"b\" then accidental, i = -1, 3 end",
    "  local octave = parse_octave(s, i)",
    "  if octave == nil then return nil end",
    "  return (octave + 1) * 12 + step + accidental",
    "end",
    "function note(n)",
    "  local midi",
    "  if type(n) == \"number\" then midi = floor(n)",
    "  elseif type(n) == \"string\" then",
    "    midi = parse_note_name(n)",
    "    if midi == nil then error(\"note: bad note '\" .. tostring(n) .. \"'\") end",
    "  else error(\"note: expected a note name or a MIDI number\") end",
    "  local f = 7159090 / (64 * 440 * 2 ^ ((midi - 69) / 12))",
    "  return clamp(floor(f + 0.5), 0, 4095)",
    "end",
    "",
    "-- Passwords (Dennis, 2026-10-28: saves are passwords, not backup RAM).",
    "-- A typed, capped value becomes a short P1... code and comes back; the",
    "-- contract (only numbers/booleans/strings/nested tables, a named error",
    "-- otherwise) follows ppu.toys' sram rules, applied to a code instead of",
    "-- a save medium.",
    "password = {}",
    "local P_ALPHA = \"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567\"",
    "local P_MAX_DEPTH, P_MAX_ITEMS, P_MAX_STRING, P_MAX_BYTES = 6, 32, 64, 96",
    "-- This VM's integers are 32-bit (docs/IL.md: Fengari's lvm.js computes",
    "-- ADD as (a + b) | 0), and p_int's zig-zag doubles the magnitude, so a",
    "-- code holds -2^30..2^30-1 and nothing wider (docs/TOYS.md).",
    "local P_MIN_INT, P_MAX_INT = -1073741824, 1073741823",
    "local function p_fail(code, msg) error(\"TOYCODE:\" .. code .. \": \" .. msg) end",
    "local function p_int(out, n)",
    "  local z = n < 0 and (2 * (-n - 1) + 1) or (n * 2)",
    "  repeat",
    "    local b = z % 128",
    "    z = floor(z / 128)",
    "    if z > 0 then b = b + 128 end",
    "    out[#out + 1] = b",
    "  until z == 0",
    "end",
    "local function p_enc(v, depth, out)",
    "  local t = type(v)",
    "  if v == nil then out[#out + 1] = 0",
    "  elseif t == \"boolean\" then out[#out + 1] = v and 2 or 1",
    "  elseif t == \"number\" then",
    "    if math.type(v) ~= \"integer\" or v < P_MIN_INT or v > P_MAX_INT then",
    "      p_fail(\"password-value\", \"only integers \" .. P_MIN_INT .. \"..\" .. P_MAX_INT .. \" can be saved; got \" .. tostring(v))",
    "    end",
    "    out[#out + 1] = 3; p_int(out, v)",
    "  elseif t == \"string\" then",
    "    if #v > P_MAX_STRING then",
    "      p_fail(\"password-value\", \"a string of \" .. #v .. \" bytes; the code holds \" .. P_MAX_STRING)",
    "    end",
    "    out[#out + 1] = 4; p_int(out, #v)",
    "    for i = 1, #v do out[#out + 1] = string.byte(v, i) end",
    "  elseif t == \"table\" then",
    "    if depth >= P_MAX_DEPTH then",
    "      p_fail(\"password-value\", \"tables nested deeper than \" .. P_MAX_DEPTH)",
    "    end",
    "    local n = #v",
    "    if n > P_MAX_ITEMS then",
    "      p_fail(\"password-value\", \"a table of \" .. n .. \" items; the code holds \" .. P_MAX_ITEMS)",
    "    end",
    "    local extra = {}",
    "    for k in pairs(v) do",
    "      local keep = type(k) == \"number\" and k == floor(k) and k >= 1 and k <= n",
    "      if not keep then extra[#extra + 1] = k end",
    "    end",
    "    if n + #extra > P_MAX_ITEMS then",
    "      p_fail(\"password-value\", \"a table of \" .. (n + #extra) .. \" items; the code holds \" .. P_MAX_ITEMS)",
    "    end",
    "    local keys = {}",
    "    for _, k in ipairs(extra) do",
    "      local kt = type(k)",
    "      if kt ~= \"number\" and kt ~= \"string\" then",
    "        p_fail(\"password-value\", \"table keys must be numbers or strings; got \" .. kt)",
    "      end",
    "      local kb = {}",
    "      p_enc(k, depth + 1, kb)",
    "      keys[#keys + 1] = { k = k, key = string.char(table.unpack(kb)) }",
    "    end",
    "    table.sort(keys, function(a, b) return a.key < b.key end)",
    "    out[#out + 1] = 5; p_int(out, n); p_int(out, #keys)",
    "    for i = 1, n do p_enc(v[i], depth + 1, out) end",
    "    for i = 1, #keys do",
    "      p_enc(keys[i].k, depth + 1, out); p_enc(v[keys[i].k], depth + 1, out)",
    "    end",
    "  else",
    "    p_fail(\"password-value\", \"a \" .. t .. \" cannot be saved\")",
    "  end",
    "end",
    "local function p_rdint(bytes, pos)",
    "  local z, shift = 0, 1",
    "  while true do",
    "    local b = bytes[pos]",
    "    if b == nil then p_fail(\"password-code\", \"the code ends inside a number\") end",
    "    pos = pos + 1",
    "    local d = b % 128",
    "    if d > 0 and floor((2147483647 - z) / d) < shift then",
    "      p_fail(\"password-code\", \"a number in the code is past 2^31-1\")",
    "    end",
    "    z = z + d * shift",
    "    if b < 128 then break end",
    "    if shift >= 268435456 then p_fail(\"password-code\", \"a number in the code is too long\") end",
    "    shift = shift * 128",
    "  end",
    "  if z % 2 == 1 then return -(z // 2) - 1, pos end",
    "  return z // 2, pos",
    "end",
    "local function p_dec(bytes, pos, depth)",
    "  local tag = bytes[pos]",
    "  if tag == nil then p_fail(\"password-code\", \"the code ends early\") end",
    "  pos = pos + 1",
    "  if tag == 0 then return nil, pos",
    "  elseif tag == 1 then return false, pos",
    "  elseif tag == 2 then return true, pos",
    "  elseif tag == 3 then return p_rdint(bytes, pos)",
    "  elseif tag == 4 then",
    "    local len; len, pos = p_rdint(bytes, pos)",
    "    if len < 0 or len > P_MAX_STRING or pos + len - 1 > #bytes then",
    "      p_fail(\"password-code\", \"a bad string length in the code\")",
    "    end",
    "    local s = string.char(table.unpack(bytes, pos, pos + len - 1))",
    "    return s, pos + len",
    "  elseif tag == 5 then",
    "    if depth >= P_MAX_DEPTH then p_fail(\"password-code\", \"tables nested too deep\") end",
    "    local n, m",
    "    n, pos = p_rdint(bytes, pos)",
    "    m, pos = p_rdint(bytes, pos)",
    "    if n < 0 or m < 0 or n + m > P_MAX_ITEMS or n + m > #bytes then",
    "      p_fail(\"password-code\", \"a bad table size in the code\")",
    "    end",
    "    local t = {}",
    "    for i = 1, n do",
    "      local v; v, pos = p_dec(bytes, pos, depth + 1); t[i] = v",
    "    end",
    "    for i = 1, m do",
    "      local k, v",
    "      k, pos = p_dec(bytes, pos, depth + 1)",
    "      v, pos = p_dec(bytes, pos, depth + 1)",
    "      t[k] = v",
    "    end",
    "    return t, pos",
    "  end",
    "  p_fail(\"password-code\", \"unknown type tag \" .. tostring(tag))",
    "end",
    "local function p_b32(bytes)",
    "  local out, acc, bits = {}, 0, 0",
    "  for i = 1, #bytes do",
    "    acc = acc * 256 + bytes[i]",
    "    bits = bits + 8",
    "    while bits >= 5 do",
    "      bits = bits - 5",
    "      local idx = floor(acc / (2 ^ bits)) % 32",
    "      out[#out + 1] = string.sub(P_ALPHA, idx + 1, idx + 1)",
    "    end",
    "    acc = acc % (2 ^ bits)",
    "  end",
    "  if bits > 0 then",
    "    local idx = (acc * (2 ^ (5 - bits))) % 32",
    "    out[#out + 1] = string.sub(P_ALPHA, idx + 1, idx + 1)",
    "  end",
    "  return table.concat(out)",
    "end",
    "local function p_unb32(s)",
    "  local bytes, acc, bits = {}, 0, 0",
    "  for i = 1, #s do",
    "    local ch = string.sub(s, i, i)",
    "    local idx = string.find(P_ALPHA, ch, 1, true)",
    "    if idx == nil then p_fail(\"password-code\", \"not a password character: \" .. ch) end",
    "    acc = acc * 32 + (idx - 1)",
    "    bits = bits + 5",
    "    if bits >= 8 then",
    "      bits = bits - 8",
    "      bytes[#bytes + 1] = floor(acc / (2 ^ bits)) % 256",
    "      acc = acc % (2 ^ bits)",
    "    end",
    "  end",
    "  if acc ~= 0 then p_fail(\"password-code\", \"the code has bits past its last byte\") end",
    "  return bytes",
    "end",
    "function password.pack(v)",
    "  local out = {}",
    "  p_enc(v, 0, out)",
    "  if #out > P_MAX_BYTES then",
    "    p_fail(\"password-value\", \"the value needs \" .. #out .. \" bytes; the code holds \" .. P_MAX_BYTES)",
    "  end",
    "  local sum = 0",
    "  for i = 1, #out do sum = (sum * 31 + out[i]) % 256 end",
    "  out[#out + 1] = sum",
    "  return \"P1\" .. p_b32(out)",
    "end",
    "function password.unpack(code)",
    "  if type(code) ~= \"string\" then p_fail(\"password-code\", \"a password is a string\") end",
    "  if #code > 200 then p_fail(\"password-code\", \"the code is longer than any password\") end",
    "  if string.sub(code, 1, 2) ~= \"P1\" then",
    "    p_fail(\"password-code\", \"not a PCEStudio password (it does not start with P1)\")",
    "  end",
    "  local bytes = p_unb32(string.sub(code, 3))",
    "  if #bytes < 2 then p_fail(\"password-code\", \"the code is too short\") end",
    "  local sum = 0",
    "  for i = 1, #bytes - 1 do sum = (sum * 31 + bytes[i]) % 256 end",
    "  if sum ~= bytes[#bytes] then",
    "    p_fail(\"password-code\", \"the check byte does not match (the code is mistyped)\")",
    "  end",
    "  local v, pos = p_dec(bytes, 1, 0)",
    "  if pos ~= #bytes then p_fail(\"password-code\", \"the code has bytes past its value\") end",
    "  return v",
    "end"
  ].join("\n");

  /* ---- small helpers --------------------------------------------------- */

  /* The type check only: a Lua 5.3 integer (1 is an integer, 1.0 is not).
   * The range check belongs to the host, so the Lua run and the IL run
   * refuse with the same words (renderer/pce-toyhost.js intIn). The lo/hi
   * here only shape the "must be an integer" message. */
  function intArg(L, idx, name, lo, hi, code) {
    if (!F.lua.lua_isinteger(L, idx)) {
      luaFail(L, code, name + " must be an integer " + lo + ".." + hi);
    }
    return F.lua.lua_tointeger(L, idx);
  }

  function tableFieldInt(L, tIdx, field, def, lo, hi, code) {
    F.lua.lua_getfield(L, tIdx, F.to_luastring(field));
    if (F.lua.lua_type(L, -1) === F.lua.LUA_TNIL) {
      F.lua.lua_pop(L, 1);
      return def;
    }
    var v = intArg(L, -1, field, lo, hi, code);
    F.lua.lua_pop(L, 1);
    return v;
  }

  function tableFieldBool(L, tIdx, field, def) {
    F.lua.lua_getfield(L, tIdx, F.to_luastring(field));
    if (F.lua.lua_type(L, -1) === F.lua.LUA_TNIL) {
      F.lua.lua_pop(L, 1);
      return def;
    }
    var v = F.lua.lua_toboolean(L, -1) ? true : false;
    F.lua.lua_pop(L, 1);
    return v;
  }

  /* ---- the runtime ----------------------------------------------------- */

  function create(source, options) {
    options = options || {};
    var L = null;
    var lua = F && F.lua;
    var lauxlib = F && F.lauxlib;
    var lualib = F && F.lualib;
    if (!lua || !lauxlib || !lualib) {
      refuse("no-vm", "the Lua VM is not loaded: serve vendor/fengari/fengari-web.js " +
             "before renderer/pce-toys.js (vendor/fengari/VENDORED.md)");
    }
    L = lauxlib.luaL_newstate();
    if (!L) refuse("no-vm", "Lua would not start (out of memory)");

    var budgetMs = options.budgetMs != null ? options.budgetMs : DEFAULT_BUDGET_MS;
    /* The toy's hardware state and frame flow, shared with the IL runtime. */
    var host = toyhost.createHost();
    var state = host.state;
    var log = host.log;
    var pad = [];              /* pad[1..5] tables, registry refs */
    var callbackMode = false;
    var initialized = false;
    var broken = null;
    var lastFrame = null;
    var lastRaster = null;
    var runtime = null;

    /* -- sandbox -------------------------------------------------------- */

    /* Only the libraries a toy needs. os/io/package/debug are never opened;
     * what base still exposes that could touch the host is removed by name.
     * The capability sandbox is the fixed API plus no file/OS/network door;
     * the cost sandbox is the instruction hook below. */
    (function openSandbox() {
      var libs = [
        ["_G", lualib.luaopen_base],
        ["table", lualib.luaopen_table],
        ["string", lualib.luaopen_string],
        ["math", lualib.luaopen_math],
        ["utf8", lualib.luaopen_utf8]
      ];
      for (var i = 0; i < libs.length; i++) {
        lauxlib.luaL_requiref(L, F.to_luastring(libs[i][0]), libs[i][1], 1);
        lua.lua_pop(L, 1);
      }
      var doors = ["dofile", "loadfile", "require", "package", "io", "os",
                   "debug", "collectgarbage", "coroutine"];
      for (var d = 0; d < doors.length; d++) {
        lua.lua_pushnil(L);
        lua.lua_setglobal(L, F.to_luastring(doors[d]));
      }
    })();

    function setGlobalFn(name, fn) {
      lua.lua_pushjsfunction(L, fn);
      lua.lua_setglobal(L, F.to_luastring(name));
    }

    function pushGlobal(name) { lua.lua_getglobal(L, F.to_luastring(name)); }

    function newTableRef() {
      lua.lua_newtable(L);
      return lauxlib.luaL_ref(L, lua.LUA_REGISTRYINDEX);
    }

    function pushRef(ref) {
      lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, ref);
    }

    function setRefField(ref, name, pushValue) {
      pushRef(ref);
      pushValue();
      lua.lua_setfield(L, -2, F.to_luastring(name));
      lua.lua_pop(L, 1);
    }

    /* -- the error channel ---------------------------------------------- */

    lua.lua_atnativeerror(L, function (Lx) {
      var e = lua.lua_touserdata(Lx, 1);
      var code = e && e.code ? e.code : "toy-error";
      var msg = e && e.message ? e.message : String(e);
      lua.lua_pushstring(Lx, F.to_luastring("TOYCODE:" + code + ":" + msg));
      return 1;
    });

    /* -- VRAM: a word-addressed table over the byte array the model reads - */

    (function installVram() {
      lua.lua_newtable(L);          /* the vram table */
      lua.lua_newtable(L);          /* its metatable */
      lua.lua_pushliteral(L, "__index");
      lua.lua_pushjsfunction(L, function (Lx) {
        var addr = intArg(Lx, 2, "a VRAM word address", 0, 32767,
                          "vram-range");
        lua.lua_pushinteger(Lx, luaHost(Lx, function () {
          return host.vramGet(addr);
        }));
        return 1;
      });
      lua.lua_rawset(L, -3);
      lua.lua_pushliteral(L, "__newindex");
      lua.lua_pushjsfunction(L, function (Lx) {
        var addr = intArg(Lx, 2, "a VRAM word address", 0, 32767,
                          "vram-range");
        var word = intArg(Lx, 3, "a VRAM word", 0, 0xFFFF, "vram-range");
        luaHost(Lx, function () { host.vramSet(addr, word); });
        return 0;
      });
      lua.lua_rawset(L, -3);
      lua.lua_setmetatable(L, -2);
      lua.lua_setglobal(L, F.to_luastring("vram"));
    })();

    /* -- registers ------------------------------------------------------ */

    setGlobalFn("reg", function (Lx) {
      var nameV = lua.lua_tostring(Lx, 1);
      if (!nameV) luaFail(Lx, "reg-name", "reg(name, value): the name must be a string");
      var name = F.to_jsstring(nameV);
      var v = intArg(Lx, 2, name, 0, 0x3FF, "reg-range");
      luaHost(Lx, function () { host.reg(name, v); });
      return 0;
    });

    /* -- VCE colour table ----------------------------------------------- */

    setGlobalFn("pal", function (Lx) {
      var addr = intArg(Lx, 1, "a colour-table address", 0, 511,
                        "pal-range");
      var word = intArg(Lx, 2, "a colour word", 0, 0x1FF, "pal-range");
      luaHost(Lx, function () { host.pal(addr, word); });
      return 0;
    });

    /* -- the SAT -------------------------------------------------------- */

    setGlobalFn("sat", function (Lx) {
      var i = intArg(Lx, 1, "a SAT entry", 0, 63, "sat-range");
      var k = intArg(Lx, 2, "a SAT word (0..3)", 0, 3, "sat-range");
      var v = intArg(Lx, 3, "a SAT word", 0, 0xFFFF, "sat-range");
      luaHost(Lx, function () { host.sat(i, k, v); });
      return 0;
    });

    /* sprite(i, {x=, y=, pattern=, palette=, spbg=, cgx=, hflip=, cgy=, vflip=}).
     * The composition (the four SAT words, the ranges, the defaults) is
     * host.sprite; this wrapper only reads the Lua table and checks that a
     * present field is an integer/boolean as the field's kind demands. */
    setGlobalFn("sprite", function (Lx) {
      var i = intArg(Lx, 1, "a SAT entry", 0, 63, "sprite-range");
      if (lua.lua_type(Lx, 2) !== lua.LUA_TTABLE) {
        luaFail(Lx, "sprite-range", "sprite(i, spec): spec must be a table");
      }
      var spec = {};
      var fields = [["x", 1023], ["y", 1023], ["pattern", 0x3FF],
                    ["palette", 15], ["cgy", 3]];
      for (var f = 0; f < fields.length; f++) {
        var name = fields[f][0];
        F.lua.lua_getfield(Lx, 2, F.to_luastring(name));
        if (lua.lua_type(Lx, -1) !== lua.LUA_TNIL) {
          spec[name] = intArg(Lx, -1, name, 0, fields[f][1], "sprite-range");
        }
        lua.lua_pop(Lx, 1);
      }
      var bools = ["spbg", "cgx", "hflip", "vflip"];
      for (var b = 0; b < bools.length; b++) {
        F.lua.lua_getfield(Lx, 2, F.to_luastring(bools[b]));
        if (lua.lua_type(Lx, -1) !== lua.LUA_TNIL) {
          spec[bools[b]] = lua.lua_toboolean(Lx, -1) ? true : false;
        }
        lua.lua_pop(Lx, 1);
      }
      luaHost(Lx, function () { host.sprite(i, spec); });
      return 0;
    });

    /* -- the raster table, the table form ------------------------------- */

    /* raster(line, spec) registers one line's entry (VDW line 0..223). The
     * one-entry rule, the cram write cap and the ranges are host.raster;
     * this wrapper only reads the Lua table. */
    setGlobalFn("raster", function (Lx) {
      var line = intArg(Lx, 1, "a raster line", 0, VDW_LINES - 1,
                        "raster-line");
      if (lua.lua_type(Lx, 2) !== lua.LUA_TTABLE) {
        luaFail(Lx, "raster-line", "raster(line, spec): spec must be a table");
      }
      var spec = {};
      var fields = [["bxr", 0x3FF], ["byr", 0x1FF], ["cr", 0xFF]];
      for (var f = 0; f < fields.length; f++) {
        F.lua.lua_getfield(Lx, 2, F.to_luastring(fields[f][0]));
        if (lua.lua_type(Lx, -1) !== lua.LUA_TNIL) {
          spec[fields[f][0]] = intArg(Lx, -1, fields[f][0], 0, fields[f][1],
                                     "reg-range");
        }
        lua.lua_pop(Lx, 1);
      }
      F.lua.lua_getfield(Lx, 2, F.to_luastring("cram"));
      if (lua.lua_type(Lx, -1) === lua.LUA_TTABLE) {
        var n = lua.lua_rawlen(Lx, -1);
        var writes = [];
        for (var w = 1; w <= n; w++) {
          lua.lua_rawgeti(Lx, -1, w);
          if (lua.lua_type(Lx, -1) !== lua.LUA_TTABLE) {
            luaFail(Lx, "pal-range", "cram[" + w + "] must be {addr, word}");
          }
          lua.lua_rawgeti(Lx, -1, 1);
          var addr = intArg(Lx, -1, "cram address", 0, 511, "pal-range");
          lua.lua_pop(Lx, 1);
          lua.lua_rawgeti(Lx, -1, 2);
          var word = intArg(Lx, -1, "cram word", 0, 0x1FF, "pal-range");
          lua.lua_pop(Lx, 1);
          lua.lua_pop(Lx, 1);
          writes.push([addr, word]);
        }
        spec.cram = writes;
      }
      lua.lua_pop(Lx, 1);
      luaHost(Lx, function () { host.raster(line, spec); });
      return 0;
    });

    /* -- pad ------------------------------------------------------------ */

    (function installPads() {
      lua.lua_newtable(L);
      for (var n = 1; n <= 5; n++) {
        var ref = newTableRef();
        pad[n] = ref;
        pushRef(ref);
        lua.lua_rawseti(L, -2, n);
      }
      lua.lua_setglobal(L, F.to_luastring("pad"));
    })();

    var PAD_FIELDS = host.PAD_FIELDS;

    /* The Lua runtime exposes the pads as five tables; refresh them from the
     * host's one pad state before each frame. */
    function refreshPads() {
      for (var n = 1; n <= 5; n++) {
        for (var k = 0; k < PAD_FIELDS.length; k++) {
          var f = PAD_FIELDS[k];
          setRefField(pad[n], f, (function (v) {
            return function () { lua.lua_pushboolean(L, v); };
          })(host.padValue(n, f)));
        }
      }
    }

    /* -- print ---------------------------------------------------------- */

    setGlobalFn("print", function (Lx) {
      var n = lua.lua_gettop(Lx);
      var parts = [];
      for (var i = 1; i <= n; i++) {
        lauxlib.luaL_tolstring(Lx, i);
        var s = lua.lua_tostring(Lx, -1);
        parts.push(s ? F.to_jsstring(s) : "?");
        lua.lua_pop(Lx, 1);
      }
      host.logLine(parts);
      return 0;
    });

    /* -- loading and calling Lua ---------------------------------------- */

    function withBudget(fn) {
      var deadline = Date.now() + budgetMs;
      var hook = function (Lx) {
        if (Date.now() > deadline) {
          throw new ToyError("toy-timeout",
            "the toy's Lua ran longer than " + budgetMs + " ms in one frame");
        }
        return 0;
      };
      lua.lua_sethook(L, hook, lua.LUA_MASKCOUNT, HOOK_COUNT);
      try {
        return fn();
      } finally {
        lua.lua_sethook(L, null, 0, 0);
      }
    }

    function callGlobal(name, pushArgs) {
      pushGlobal(name);
      if (lua.lua_type(L, -1) === lua.LUA_TNIL) {
        lua.lua_pop(L, 1);
        return false;
      }
      if (lua.lua_type(L, -1) !== lua.LUA_TFUNCTION) {
        lua.lua_pop(L, 1);
        refuse("toy-error", name + " is not a function");
      }
      var n = pushArgs ? pushArgs() : 0;
      var rc = lua.lua_pcall(L, n, 0, 0);
      if (rc !== lua.LUA_OK) throw errorFromStack(L);
      return true;
    }

    function compileRun(sourceText, chunkName) {
      var bytes = F.to_luastring(sourceText);
      var rc = lauxlib.luaL_loadbuffer(L, bytes, bytes.length,
                                       F.to_luastring(chunkName || "@toy.lua"));
      if (rc !== lua.LUA_OK) throw errorFromStack(L);
      rc = lua.lua_pcall(L, 0, 0, 0);
      if (rc !== lua.LUA_OK) throw errorFromStack(L);
    }

    function detectRasterCallback() {
      pushGlobal("raster");
      if (lua.lua_type(L, -1) === lua.LUA_TFUNCTION &&
          !lua.lua_iscfunction(L, -1)) {
        callbackMode = true;
      }
      lua.lua_pop(L, 1);
    }

    function checkBroken() {
      if (broken) throw new ToyError(broken.code, broken.message);
    }

    function guard(fn) {
      checkBroken();
      try {
        return fn();
      } catch (e) {
        if (e instanceof ToyError) {
          broken = { code: e.code, message: e.message };
          throw e;
        }
        broken = { code: "toy-error", message: String(e && e.message || e) };
        throw new ToyError(broken.code, broken.message);
      }
    }

    /* -- the frame ------------------------------------------------------ */

    /* The frame itself is host.beginFrame / markBase / beginLine / endLine /
     * endFrame / render; this runtime only calls the toy's Lua hooks between
     * those steps. The IL runtime (renderer/pce-il.js) walks the same steps. */

    function renderFrame(f) {
      return guard(function () {
        refreshPads();
        lastRaster = null;
        host.beginFrame(f);
        try {
          withBudget(function () {
            callGlobal("frame", function () {
              lua.lua_pushnumber(L, f / 60);
              lua.lua_pushinteger(L, f);
              return 2;
            });
            /* the frame's own writes are the base every line starts from;
             * the line callbacks below must not move it */
            host.markBase();

            if (callbackMode) {
              for (var line = 0; line < VDW_LINES; line++) {
                host.beginLine();
                try {
                  callGlobal("raster", function () {
                    lua.lua_pushinteger(L, line);
                    return 1;
                  });
                } finally {
                  host.endLine(line);
                }
              }
            }
            lastRaster = host.endFrame();
          });
        } finally {
          if (host.inLine()) host.endLine(-1);
        }

        lastFrame = host.render(f, lastRaster);
        return lastFrame;
      });
    }

    function load() {
      return guard(function () {
        withBudget(function () {
          /* the shared helpers come first, into the same global scope, the
           * way ppu.toys runs its kit chunk before the toy's files; the toy
           * may replace any of them by defining the same name */
          compileRun(PRELUDE, "@pce-toys-kit.lua");
          compileRun(source, "@toy.lua");
        });
        withBudget(function () {
          callGlobal("init");
        });
        /* after init(), so a toy may define the callback inside init() and
         * may still call raster(line, spec) there for a static table */
        detectRasterCallback();
        initialized = true;
        return runtime;
      });
    }

    function setPad(n, buttons) {
      host.setPad(n, buttons);
      runtime.pad = host.padState;
      return runtime;
    }

    runtime = {
      /* the live hardware state the model reads; tests copy it */
      state: state,
      /* the model's exact input, shared (no copy) — #61/docs cannot drift */
      options: host.options,
      snapshot: host.snapshot,
      load: load,
      frame: renderFrame,
      setPad: setPad,
      dispose: function () { if (L) { lua.lua_close(L); L = null; } },
      log: log,
      pad: host.padState,
      get initialized() { return initialized; },
      get broken() { return broken; },
      get error() { return broken ? new ToyError(broken.code, broken.message) : null; },
      get last() { return lastFrame; },
      get lastRaster() { return lastRaster; },
      get frameCount() { return host.frameCount(); },
      get callbackRaster() { return callbackMode; },
      WIDTH: WIDTH,
      HEIGHT: HEIGHT,
      PAD_FIELDS: PAD_FIELDS.slice(),
      ToyError: ToyError
    };
    return runtime;
  }

  return {
    create: create,
    ToyError: ToyError,
    WIDTH: WIDTH,
    HEIGHT: HEIGHT,
    PAD_FIELDS: ["up", "down", "left", "right", "i", "ii", "select", "run"],
    /* the refusals this card names, for the reference (#61) to read */
    REFUSALS: {
      "reg-forbidden": "a register a toy may not touch",
      "reg-range": "a register value outside the VDC register's width",
      "pal-range": "a colour-table address or word outside 0..511",
      "vram-range": "a VRAM word address outside 0..32767 or a word past $FFFF",
      "sat-range": "a SAT entry outside 0..63 or a SAT word past $FFFF",
      "sprite-range": "a sprite field outside the SAT's range",
      "raster-line": "a raster line outside VDW 0..223",
      "raster-line-full": "a second raster entry on one line, or too many colour writes on it",
      "password-value": "a save value that cannot be packed",
      "password-code": "a password that is not one",
      "toy-timeout": "a toy hook past the frame's Lua budget",
      "toy-error": "a Lua error inside the toy, naming file:line"
    }
  };
});
