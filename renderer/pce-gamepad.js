/*
 * pce-gamepad.js — card #262: a real controller, through the browser's
 * Gamepad API, into the PC Engine's two-button pad.
 *
 * The keyboard path is elsewhere (renderer/studio.html and renderer/toy.html
 * hold the IJKL / N M / O P map, and #124 proved it).  This file is the second
 * source for the same pad object: it reads `navigator.getGamepads()`, turns
 * the browser's Standard Gamepad into the PCE pad's bits — the 2-button pad's
 * eight fields and the 6-button III/IV extras — and hands the page a plain
 * `{ up: true, ... }` object the page merges with the keyboard's.  The page
 * still calls the runtime's own `setPad`, so a gamepad frame and a keyboard
 * frame take the same route into the toy — that is what #262's test scripts.
 *
 * The standard layout (W3C "Standard Gamepad"):
 *   buttons 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 6 LT, 7 RT, 8 Back, 9 Start,
 *           10 L3, 11 R3, 12 Up, 13 Down, 14 Left, 15 Right, 16 Home
 *   axes    0 left stick X, 1 left stick Y (and 2/3 the right stick)
 * USB and Bluetooth pads that Chrome or Safari maps to "standard" give the
 * same indices; a pad the browser does not map to standard may order its
 * buttons differently, and then the Controls panel's remap is the fix.
 *
 * Defaults: A -> I, B -> II, Back -> Select, Start -> Run, the d-pad buttons
 * and the left stick (dead zone 0.5) -> the PCE's direction bits, and X/Y ->
 * III/IV, the 6-button pad's extra buttons.  The toy API's `pad[n]` carries
 * the eight 2-button fields (docs/TOYS.md); III/IV reach the pad object and
 * the Controls panel's picture, but no cartridge route carries them yet —
 * docs/PADS.md's GAP 10.  A toy that meets a 6-button pad on hardware is a
 * later card.
 *
 * Two pads: the first connected pad is player 1 (PCE pad 1) and the second is
 * player 2 (PCE pad 2).  The mapping is one table for both, saved in the
 * browser under STORE_KEY, so the studio and the toy page (same origin) agree.
 *
 * No DOM, no poller timer, no window listener lives here: the page calls
 * poll() from the frame it is about to run, and the Controls panel calls it
 * from its own redraw.  Both share shared()'s one poller, so a remap begun in
 * the panel is completed by either call.
 *
 * The headless MCP/test driver is untouched: it still calls the runtime's
 * setPad with a scripted pad and never loads this file's input route.
 */
(function (root) {
  "use strict";
  var P = root.PCEStudio = root.PCEStudio || {};

  /* The toy's fields, in the order the pads are drawn.  III/IV are the
   * 6-button extras (see the header). */
  var ACTIONS = ["up", "down", "left", "right", "i", "ii", "select", "run",
                 "iii", "iv"];
  var LABELS = { up: "D-pad up", down: "D-pad down", left: "D-pad left",
                 right: "D-pad right", i: "I", ii: "II", select: "Select",
                 run: "Run", iii: "III (6-button)", iv: "IV (6-button)" };
  var BUTTON_NAMES = ["A", "B", "X", "Y", "LB", "RB", "LT", "RT", "Back",
                      "Start", "L3", "R3", "Up", "Down", "Left", "Right",
                      "Home"];

  /* A direction can be a button or an axis half; every other action is a
   * button.  The sources are ORed, so the d-pad and the stick both work. */
  var DEFAULTS = {
    up:    [{ button: 12 }, { axis: 1, dir: -1 }],
    down:  [{ button: 13 }, { axis: 1, dir: 1 }],
    left:  [{ button: 14 }, { axis: 0, dir: -1 }],
    right: [{ button: 15 }, { axis: 0, dir: 1 }],
    i:     [{ button: 0 }],
    ii:    [{ button: 1 }],
    select: [{ button: 8 }],
    run:   [{ button: 9 }],
    iii:   [{ button: 2 }],
    iv:    [{ button: 3 }]
  };

  var DEADZONE = 0.5;
  var STORE_KEY = "pcestudio.gamepad.v1";
  var VERSION = 1;

  function copyMapping(m) {
    var out = {};
    for (var i = 0; i < ACTIONS.length; i++) {
      var a = ACTIONS[i];
      var list = (m && m[a]) || DEFAULTS[a];
      out[a] = list.map(function (s) { return copySource(s); });
    }
    return out;
  }

  function copySource(s) {
    if (s && typeof s.button === "number") return { button: s.button | 0 };
    if (s && typeof s.axis === "number")
      return { axis: s.axis | 0, dir: s.dir < 0 ? -1 : 1 };
    return null;
  }

  function validSource(s) {
    if (!s || typeof s !== "object") return false;
    if (typeof s.button === "number")
      return s.button >= 0 && s.button <= 31 && (s.button | 0) === s.button;
    if (typeof s.axis === "number")
      return (s.axis === 0 || s.axis === 1) && (s.dir === 1 || s.dir === -1);
    return false;
  }

  function validateMapping(m) {
    var out = {};
    for (var i = 0; i < ACTIONS.length; i++) {
      var a = ACTIONS[i];
      var list = m && m[a];
      if (!Array.isArray(list) || !list.length) return null;
      var clean = [];
      for (var k = 0; k < list.length; k++) {
        if (!validSource(list[k])) return null;
        clean.push(copySource(list[k]));
      }
      out[a] = clean;
    }
    return out;
  }

  /* Where a saved mapping lives.  A page can be opened from file:// with no
   * storage, and a browser can refuse it; both fall back to memory, which is
   * still a working session, only not a saved one. */
  function memoryStorage() {
    var m = {};
    return {
      fallback: true,
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
      setItem: function (k, v) { m[k] = String(v); },
      removeItem: function (k) { delete m[k]; }
    };
  }

  function defaultStorage() {
    try {
      if (typeof localStorage !== "undefined" && localStorage) return localStorage;
    } catch (e) { /* blocked by the browser's privacy setting */ }
    return memoryStorage();
  }

  function loadMapping(storage) {
    storage = storage || defaultStorage();
    var raw = null;
    try { raw = storage.getItem(STORE_KEY); } catch (e) { raw = null; }
    if (raw) {
      try {
        var saved = JSON.parse(raw);
        var m = validateMapping(saved && saved.mapping ? saved.mapping : saved);
        if (m) return m;
      } catch (e) { /* a corrupt value is the defaults' problem, not a crash */ }
    }
    return copyMapping(DEFAULTS);
  }

  function saveMapping(mapping, storage) {
    storage = storage || defaultStorage();
    var clean = validateMapping(mapping) || copyMapping(DEFAULTS);
    try {
      storage.setItem(STORE_KEY, JSON.stringify({ version: VERSION,
                                                  mapping: clean }));
      return true;
    } catch (e) { return false; }
  }

  /* Is the browser showing this pad as a Standard Gamepad?  Chrome and
   * Safari report `mapping: "standard"` for pads they understand; anything
   * else is read by index all the same and can be fixed in the panel. */
  function isStandard(pad) { return !!pad && pad.mapping === "standard"; }

  function defaultProvider() {
    try {
      if (typeof navigator !== "undefined" && navigator &&
          typeof navigator.getGamepads === "function")
        return navigator.getGamepads() || [];
    } catch (e) { /* a browser that refuses the API has no pads */ }
    return [];
  }

  function buttonDown(state, index) {
    var b = state && state.buttons && state.buttons[index];
    if (!b) return false;
    if (typeof b === "object") return !!b.pressed || (b.value || 0) > 0.5;
    return !!b;
  }

  function sourceDown(state, src) {
    if (src.button != null) return buttonDown(state, src.button);
    var v = state && state.axes ? state.axes[src.axis] : 0;
    v = Number(v) || 0;
    return src.dir < 0 ? v <= -DEADZONE : v >= DEADZONE;
  }

  /* One pad state -> the PCE bits that are DOWN (a pressed bit is present
   * and true; a released one is absent, the way the keyboard path builds
   * it). */
  function bits(state, mapping) {
    var out = {};
    mapping = mapping || DEFAULTS;
    for (var i = 0; i < ACTIONS.length; i++) {
      var a = ACTIONS[i];
      var list = mapping[a] || DEFAULTS[a];
      for (var k = 0; k < list.length; k++) {
        if (sourceDown(state, list[k])) { out[a] = true; break; }
      }
    }
    return out;
  }

  /* The connected pads, first-to-second.  getGamepads() leaves a null in
   * each empty slot; a pad whose `connected` is false is ignored.  Only two
   * players exist on this machine's pads. */
  function readPads(provider, mapping) {
    var raw = provider ? provider() : defaultProvider();
    var out = [];
    if (!raw) return out;
    for (var i = 0; i < raw.length && out.length < 2; i++) {
      var p = raw[i];
      if (!p || p.connected === false) continue;
      out.push({ index: i, id: p.id || ("pad " + i),
                 mapping: p.mapping || "", bits: bits(p, mapping) });
    }
    return out;
  }

  function sourceLabel(src) {
    if (!src) return "—";
    if (src.button != null) return BUTTON_NAMES[src.button] ||
      ("button " + src.button);
    if (src.axis === 1) return "Left stick " + (src.dir < 0 ? "up" : "down");
    return "Left stick " + (src.dir < 0 ? "left" : "right");
  }

  /* A poller: one read per call, the two players' bits, and the remap
   * capture.  `provider` is a function returning the same array
   * navigator.getGamepads() does; the tests inject theirs, and nothing else
   * changes. */
  function createPoller(opts) {
    opts = opts || {};
    var storage = opts.storage || defaultStorage();
    var mapping = opts.mapping ? validateMapping(opts.mapping) || copyMapping(DEFAULTS)
                               : loadMapping(storage);
    var provider = opts.provider || defaultProvider;
    var last = { pads: [], players: [{}, {}] };
    var capture = null;           /* { action, held: {padIndex: {button: true}} } */
    var captured = null;          /* the source the last capture wrote */
    var lastSaveOk = true;        /* did the browser store the last write? */

    function heldButtons(states) {
      var held = [];
      for (var i = 0; i < states.length; i++) {
        var set = {};
        var s = states[i];
        if (s && s.buttons) {
          for (var b = 0; b < s.buttons.length; b++)
            if (buttonDown(s, b)) set[b] = true;
        }
        held.push(set);
      }
      return held;
    }

    function poll() {
      var raw = provider() || [];
      var states = [];
      for (var i = 0; i < raw.length && states.length < 2; i++) {
        var p = raw[i];
        if (!p || p.connected === false) continue;
        states.push(p);
      }
      last.pads = readPads(function () { return raw; }, mapping);
      last.players = [
        bits(states[0], mapping),
        bits(states[1], mapping)
      ];
      /* The remap-by-pressing handshake: from the buttons held when the
       * capture began, a newly pressed one becomes the action's source.  The
       * first pad that shows one wins. */
      if (capture) {
        var now = heldButtons(states);
        for (var pi = 0; pi < now.length && !captured; pi++) {
          for (var b = 0; b < 32; b++) {
            if (!now[pi][b]) continue;
            if (capture.held[pi] && capture.held[pi][b]) continue;
            mapping[capture.action] = [{ button: b }];
            lastSaveOk = saveMapping(mapping, storage);
            captured = { action: capture.action, source: { button: b },
                         saved: lastSaveOk };
            capture = null;
            break;
          }
        }
      }
      return last;
    }

    return {
      poll: poll,
      pads: function () { return last.pads; },
      /* [player 1 bits, player 2 bits] */
      players: function () { return last.players; },
      bits: bits,
      mapping: function () { return copyMapping(mapping); },
      setMapping: function (m) {
        var clean = validateMapping(m);
        if (!clean) return null;
        mapping = clean;
        lastSaveOk = saveMapping(mapping, storage);
        return copyMapping(mapping);
      },
      loadMapping: function () {
        mapping = loadMapping(storage);
        return copyMapping(mapping);
      },
      saveMapping: function () {
        lastSaveOk = saveMapping(mapping, storage);
        return lastSaveOk;
      },
      resetMapping: function () {
        mapping = copyMapping(DEFAULTS);
        lastSaveOk = saveMapping(mapping, storage);
        return copyMapping(mapping);
      },
      lastSaveOk: function () { return lastSaveOk; },
      /* false when the browser gave this page no storage and the table lives
       * only in memory for the session */
      persistent: function () { return !(storage && storage.fallback); },
      /* Remap: the next button pressed (not one held now) becomes `action`'s
       * single source.  The caller reads capture() after a poll(). */
      begin: function (action) {
        if (ACTIONS.indexOf(action) < 0) return null;
        var raw = provider() || [];
        var states = [];
        for (var i = 0; i < raw.length && states.length < 2; i++) {
          if (raw[i] && raw[i].connected !== false) states.push(raw[i]);
        }
        capture = { action: action, held: heldButtons(states) };
        captured = null;
        return action;
      },
      cancel: function () { capture = null; return null; },
      pending: function () { return capture ? capture.action : null; },
      captured: function () { return captured; },
      clearCaptured: function () { captured = null; },
      setProvider: function (fn) {
        provider = fn || defaultProvider;
        return provider;
      },
      provider: function () { return provider; },
      storage: function () { return storage; }
    };
  }

  var singleton = null;
  function shared(opts) {
    if (!singleton) singleton = createPoller(opts);
    return singleton;
  }
  /* Tests reason about one page; this makes shared() fresh again. */
  function reset() { singleton = null; }

  var api = {
    ACTIONS: ACTIONS.slice(),
    LABELS: LABELS,
    BUTTON_NAMES: BUTTON_NAMES.slice(),
    DEFAULTS: copyMapping(DEFAULTS),
    DEADZONE: DEADZONE,
    STORE_KEY: STORE_KEY,
    bits: bits,
    readPads: readPads,
    sourceLabel: sourceLabel,
    buttonDown: buttonDown,
    isStandard: isStandard,
    validateMapping: validateMapping,
    loadMapping: loadMapping,
    saveMapping: saveMapping,
    createPoller: createPoller,
    shared: shared,
    reset: reset,
    defaultProvider: defaultProvider
  };
  P.gamepad = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : this);
