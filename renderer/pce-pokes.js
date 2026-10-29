/*
 * pce-pokes.js — the studio's keyframed register overrides (card #79).
 *
 * ppu.toys lets every panel write the hardware while the toy runs: a panel
 * edit is an override on a register, kept as a document beside the program,
 * and replayed every frame so a released override never bakes into the toy
 * (docs/PPU-TOYS.md §"How a frame is made").  This is the PCE counterpart's
 * model: a *poke* is a register override with a frame — `reg` holds `value`
 * from `frame` on, until a later poke of the same register — the list of
 * pokes is a *curve* per register, and undo/redo move whole actions between
 * two stacks.
 *
 * Three things this file is, and is not:
 *
 *  - It is a pure model.  It owns no DOM and no runtime.  The studio
 *    (renderer/studio.html) folds the list into the renderer's options
 *    (applyPokes) and the REGISTERS panel (studio-panel-registers.js) draws
 *    and edits it through the studio API; both call the same objects, so the
 *    panel, the undo stack and the written-back toy cannot disagree.
 *  - It is a view model, not the toy's state: applying a poke never touches
 *    the running toy.  That is what makes undo a pure move between two lists
 *    and what makes a poke safe to try.
 *  - writeBack() is the bridge to the toy: it turns the curves of the
 *    registers a toy may set into one Lua block that the studio appends to
 *    main.lua.  A register the toy may not write is refused by the toy host's
 *    own code (reg-forbidden) and named in the report, never silently
 *    dropped.
 *
 * The written block is a *closure over the toy's own frame()* — it runs the
 * toy first, then writes each keyframe in force, every frame — which is
 * ppu.toys' rule (the generated document is spliced after the program's own
 * hooks) in the one-file shape this studio has.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.PCEStudio = root.PCEStudio || {};
    root.PCEStudio.pokes = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* A register name: the VDC's own (BXR, CR, MWR…), and the names this model
   * uses for the registers the renderer does not carry (VCE_CTA, PSG00,
   * TIMER_RELOAD, IRQ_DISABLE…), which need the underscore.  The toy's own
   * reg() names are a subset — the hyphen and slash never appear. */
  var NAME_RE = /^[A-Za-z0-9_]+$/;
  var OPEN = "-- >>> PCEStudio pokes";
  var CLOSE = "-- <<< PCEStudio pokes";
  /* The whole generated block, from its opening marker to its closing line.
   * A toy's source is edited before writing again so a second write replaces
   * the first rather than stacking two blocks. */
  var BLOCK_RE = /\n?-- >>> PCEStudio pokes[\s\S]*?-- <<< PCEStudio pokes[^\n]*\n?/;

  /* The registers a toy may write, from the toy host's own table when it is
   * loaded (renderer/pce-toyhost.js REGISTERS).  The fallback is the same
   * three names and widths, so this file still means something on its own in
   * node — but a width changed in the host is not repeated here: the host
   * wins whenever it is present. */
  var FALLBACK_ALLOWED = { BXR: 0x3FF, BYR: 0x1FF, CR: 0xFF };

  function hostAllowed() {
    var P = (typeof self !== "undefined" ? self : this || {}).PCEStudio;
    var regs = P && P.toyhost && P.toyhost.REGISTERS;
    if (!regs) return FALLBACK_ALLOWED;
    var out = {};
    for (var i = 0; i < regs.length; i++) out[regs[i].name] = regs[i].max;
    return out;
  }

  function fail(code, message) {
    var e = new Error(message);
    e.code = code;
    return e;
  }

  function normalReg(reg) {
    if (typeof reg !== "string" || !NAME_RE.test(reg))
      throw fail("poke-reg", "poke: the first argument is a VDC register name");
    return reg.toUpperCase();
  }

  function normalFrame(at) {
    at = at == null ? 0 : Math.round(Number(at));
    if (!isFinite(at)) at = 0;
    return Math.max(0, at);
  }

  /* ---- the model ------------------------------------------------------- */

  function Model(opts) {
    opts = opts || {};
    this.list = [];
    this.undoStack = [];
    this.redoStack = [];
    this.onChange = typeof opts.onChange === "function" ? opts.onChange : null;
  }

  /* Every state change goes through here: callers get the panel redraw and
   * the renderer's re-present without knowing about it. */
  Model.prototype.changed = function () {
    if (this.onChange) {
      try { this.onChange(); } catch (e) { /* a listener must not break the model */ }
    }
  };

  /* Set a keyframe: `reg` holds `value` from `frame` on.  A second set at the
   * same register and frame replaces the first (that is what editing a
   * keyframe is), and undo puts the old value back — it does not leave two
   * entries on one frame. */
  Model.prototype.poke = function (reg, value, at) {
    var name = normalReg(reg);
    var frame = normalFrame(at);
    var v = Number(value);
    if (!isFinite(v)) v = 0;
    v = Math.round(v) | 0;
    var entry = { reg: name, value: v, frame: frame };
    var prev = this.find(name, frame);
    if (prev) {
      var old = { reg: prev.reg, value: prev.value, frame: prev.frame };
      prev.value = v;
      this.redoStack.length = 0;
      this.undoStack.push({ type: "set", entry: prev, prev: old, next: v });
    } else {
      this.list.push(entry);
      this.redoStack.length = 0;
      this.undoStack.push({ type: "add", entry: entry });
    }
    this.changed();
    return entry;
  };

  Model.prototype.find = function (reg, frame) {
    for (var i = this.list.length - 1; i >= 0; i--) {
      if (this.list[i].reg === reg && this.list[i].frame === frame)
        return this.list[i];
    }
    return null;
  };

  /* Remove one keyframe (the curve editor's ×).  Undoable like any other
   * action: the entry goes back with its exact place in the list. */
  Model.prototype.remove = function (reg, at) {
    var name = normalReg(reg);
    var frame = normalFrame(at);
    for (var i = 0; i < this.list.length; i++) {
      if (this.list[i].reg === name && this.list[i].frame === frame) {
        var entry = this.list.splice(i, 1)[0];
        this.redoStack.length = 0;
        this.undoStack.push({ type: "remove", entry: entry, index: i });
        this.changed();
        return entry;
      }
    }
    return null;
  };

  Model.prototype.clear = function () {
    if (!this.list.length) return false;
    this.undoStack.push({ type: "clear", list: this.list.slice() });
    this.redoStack.length = 0;
    this.list = [];
    this.changed();
    return true;
  };

  /* The write-back's other half: the curves are now in the toy's source, so
   * the view's copies go — with the stacks, because an undo after a bake
   * would put a poke back on top of the code that already has it.  The source
   * edit is CodeMirror's undo, which is where that belongs. */
  Model.prototype.bake = function () {
    var n = this.list.length;
    this.list = [];
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.changed();
    return n;
  };

  Model.prototype.undo = function () {
    var action = this.undoStack.pop();
    if (!action) return false;
    if (action.type === "add") {
      var i = this.list.indexOf(action.entry);
      if (i >= 0) this.list.splice(i, 1);
    } else if (action.type === "set") {
      action.entry.value = action.prev.value;
    } else if (action.type === "remove") {
      this.list.splice(Math.min(action.index, this.list.length), 0, action.entry);
    } else if (action.type === "clear") {
      this.list = action.list.slice();
    }
    this.redoStack.push(action);
    this.changed();
    return true;
  };

  Model.prototype.redo = function () {
    var action = this.redoStack.pop();
    if (!action) return false;
    if (action.type === "add") {
      this.list.push(action.entry);
    } else if (action.type === "set") {
      action.entry.value = action.next;
    } else if (action.type === "remove") {
      var i = this.list.indexOf(action.entry);
      if (i >= 0) this.list.splice(i, 1);
    } else if (action.type === "clear") {
      this.list = [];
    }
    this.undoStack.push(action);
    this.changed();
    return true;
  };

  Model.prototype.all = function () { return this.list.slice(); };
  Model.prototype.canUndo = function () { return this.undoStack.length > 0; };
  Model.prototype.canRedo = function () { return this.redoStack.length > 0; };

  /* The registers with at least one keyframe, in name order — the POKED
   * column's list and the write-back's input. */
  Model.prototype.regs = function () {
    var seen = {}, out = [];
    for (var i = 0; i < this.list.length; i++) {
      var r = this.list[i].reg;
      if (!seen[r]) { seen[r] = true; out.push(r); }
    }
    out.sort();
    return out;
  };

  /* One register's keyframes, in frame order (a copy — the caller draws it). */
  Model.prototype.curve = function (reg) {
    var name = normalReg(reg);
    var out = [];
    for (var i = 0; i < this.list.length; i++) {
      if (this.list[i].reg === name)
        out.push({ reg: name, value: this.list[i].value,
                   frame: this.list[i].frame });
    }
    out.sort(function (a, b) { return a.frame - b.frame; });
    return out;
  };

  /* The value in force at a frame, in list order (a later poke of the same
   * register at the same frame wins), or null when no keyframe is in force. */
  Model.prototype.valueAt = function (reg, frame) {
    var name = normalReg(reg), value = null;
    frame = normalFrame(frame);
    for (var i = 0; i < this.list.length; i++) {
      if (this.list[i].reg === name && this.list[i].frame <= frame)
        value = this.list[i].value;
    }
    return value;
  };

  /* Fold every override in force into a renderer options object's registers.
   * Untouched when there is nothing to apply, so a frame with no poke is the
   * toy's own frame byte for byte. */
  Model.prototype.apply = function (opts, frame) {
    if (!opts || !this.list.length) return opts;
    if (!opts.regs) opts.regs = {};
    for (var i = 0; i < this.list.length; i++) {
      if (this.list[i].frame <= frame) opts.regs[this.list[i].reg] = this.list[i].value;
    }
    return opts;
  };

  /* ---- the write-back -------------------------------------------------- */

  /* The Lua that puts the curves into the toy.  Written as a closure over the
   * toy's own frame() so the program runs first and the keyframes win, every
   * frame (not only when a value changes: the toy may write the register
   * itself on each frame).
   *
   *   local __pceKeys = { {f=…, reg="BXR", v=…}, … }   -- in frame order
   *   local __pceBase = frame
   *   local function __pceFrame(t, f) … end
   *   frame = __pceFrame
   *   local __pceInit = init
   *   init = function() … end   -- re-captures a frame the toy defines in init()
   *
   * The init wrapper is there because a toy may define frame() inside its
   * init(); without it the block would capture nil and the toy's frame would
   * never run.  When the toy has no init, this defines one that does only
   * that capture.
   */
  Model.prototype.lua = function (entries, allowed) {
    entries = entries || this.list;
    allowed = allowed || hostAllowed();
    var names = [], seen = {}, i;
    for (i = 0; i < entries.length; i++) {
      if (!seen[entries[i].reg]) { seen[entries[i].reg] = true; names.push(entries[i].reg); }
    }
    names.sort();
    var written = [], refused = [];
    for (i = 0; i < names.length; i++) {
      if (Object.prototype.hasOwnProperty.call(allowed, names[i]))
        written.push(names[i]);
      else
        refused.push({ reg: names[i], code: "reg-forbidden" });
    }
    if (!written.length) {
      return { lua: "", written: [], refused: refused, block: "" };
    }
    var keys = [];
    for (i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (written.indexOf(e.reg) < 0) continue;
      var max = allowed[e.reg];
      keys.push({ f: e.frame, reg: e.reg, v: ((e.value | 0) & max) >>> 0 });
    }
    keys.sort(function (a, b) { return a.f - b.f; });
    var lines = [];
    lines.push(OPEN + " (written by the REGISTERS panel, card #79)");
    lines.push("-- A keyframe holds its register from frame f on, inside the toy");
    lines.push("-- itself.  Edit the list, then Write to toy again: the studio");
    lines.push("-- replaces this whole block (markers and all).");
    lines.push("local __pceKeys = {");
    for (i = 0; i < keys.length; i++) {
      lines.push("  { f = " + keys[i].f + ", reg = \"" + keys[i].reg +
                 "\", v = " + keys[i].v + " },");
    }
    lines.push("}");
    lines.push("local __pceBase = frame");
    lines.push("local function __pceFrame(t, f)");
    lines.push("  if __pceBase then __pceBase(t, f) end");
    lines.push("  for __i = 1, #__pceKeys do");
    lines.push("    local __k = __pceKeys[__i]");
    lines.push("    if __k.f <= f then reg(__k.reg, __k.v) end");
    lines.push("  end");
    lines.push("end");
    lines.push("frame = __pceFrame");
    lines.push("local __pceInit = init");
    lines.push("init = function()");
    lines.push("  if __pceInit then __pceInit() end");
    lines.push("  if frame ~= __pceFrame then __pceBase = frame end");
    lines.push("  frame = __pceFrame");
    lines.push("end");
    lines.push(CLOSE + " — edits inside this block are overwritten");
    return { lua: lines.join("\n") + "\n", block: lines.join("\n") + "\n",
             written: written, refused: refused };
  };

  /* main.lua with its old generated block taken out and (when there are
   * writable keys) the new one appended.  Returns the new text and the
   * report; when nothing is writable the text comes back unchanged and the
   * block is "". */
  Model.prototype.writeBack = function (source, entries, allowed) {
    var report = this.lua(entries, allowed);
    var text = String(source == null ? "" : source).replace(BLOCK_RE, "\n");
    text = text.replace(/\s+$/, "");
    if (!report.block) return { source: text, report: report };
    return { source: text + (text ? "\n\n" : "") + report.block,
             report: report };
  };

  /* A fresh model.  The studio makes one for the page; a check makes its own
   * so the two never share a stack. */
  function create(opts) { return new Model(opts); }

  return {
    create: create,
    Model: Model,
    OPEN: OPEN,
    CLOSE: CLOSE,
    BLOCK_RE: BLOCK_RE,
    FALLBACK_ALLOWED: FALLBACK_ALLOWED,
    hostAllowed: hostAllowed
  };
});
