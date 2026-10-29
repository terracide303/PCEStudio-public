/*
 * pce-sat.js — the SPRITES panel as a visual editor (card #86, part C).
 *
 * ppu.toys' SPRITES panel is the working example: the 64 (there: 128) objects
 * drawn as slots you select, the screen with the selected one labelled, an
 * object picker with prev/next, X/Y/tile/palette/priority with −/+, the
 * flips, and a character sheet whose patterns are edited with the same tools
 * as the background map.  The PCE counterpart is the VDC's SAT: 64 entries
 * (docs/RENDERER.md, HuC6270 manual 2.4), each with a position, a pattern
 * code, one of 16 sprite palettes, the SPBG priority bit and the two flips —
 * and its own size (CGX/CGY), where the SNES has a global size pair.
 *
 * There is no second picture here.  A session wraps one of renderer/
 * pce-editor.js's pictures (ed.newPicture(), or the picture the toy's asset
 * files make — this file reuses renderer/pce-screen.js's pictureFromFiles, so
 * palettes.json is parsed once), and every edit is that module's own call:
 * addSprite, setSprite, parkSprite, removeSprite, newSpritePattern,
 * paintSpriteIndex.  The refusals are the editor's (65th-sprite,
 * sprite-range, sprite-pattern-range, 17th-colour, sprite-pattern-vram, …),
 * not a copy.  The panel's screen is pce-editor.js's renderPreview — the same
 * renderer as the output column.
 *
 * The tools are #84's six (select, pencil, rect, fill, erase, move) at the
 * pattern's pixel granularity instead of the BAT's cells: the sprite pattern
 * IS the editable surface, as ppu.toys' character sheet is.
 *
 * What the panel edits is the toy's assets, not the running frame: the
 * patterns and the SAT live in sprites.json (a `patterns` list and a
 * `sprites` list, docs/STUDIO.md §7), the sprite palettes in palettes.json.
 * sprites.json's pattern pixels are 4-bit colour NUMBERS, mapped by the
 * sprite's palette field when the VDC draws — pixel 0 is transparent.
 *
 * Card #102's pattern: this file is the model; renderer/studio-panel-sprites.js
 * is the panel (docs/STUDIO.md §3.2).
 *
 * Dual use: CommonJS in Node (tests/check-studio.js) and a browser global
 * (renderer/studio.html).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./pce-editor.js"), require("./pce-screen.js"));
  } else {
    root.PCEStudio = root.PCEStudio || {};
    root.PCEStudio.sat = factory(root.PCEStudio.editor, root.PCEStudio.screen);
  }
})(typeof self !== "undefined" ? self : this, function (ed, screen) {
  "use strict";

  var MAX_SPRITES = ed.MAX_SPRITES;          /* 64, the SAT's entries */
  var SPRITE_PALETTES = ed.SPRITE_PALETTES;  /* 16, CRAM $100-$1FF */
  var ENTRIES = ed.SPRITE_ENTRIES;           /* 16 colour numbers a pattern shows */
  var PARK_ROW = ed.PARK_ROW;                /* 240: past every display window */

  /* The same six tools and four zooms #84's SCREEN panel uses — one array, so
   * the two panels cannot drift apart on a label or a key. */
  var TOOLS = screen.TOOLS;
  var ZOOMS = screen.ZOOMS;

  /* The six sizes the VDC draws, for the size picker (ed.spriteSize's own
   * table, named rather than re-derived). */
  var SIZES = ed.SPRITE_SIZES.map(function (s) {
    return { width: s.width, height: s.height, cells: s.cells };
  });

  function fail(code, message) {
    var e = new Error(message);
    e.code = code;
    return e;
  }

  function isInt(v) { return typeof v === "number" && v === Math.floor(v); }

  /* ---- the session ------------------------------------------------------ */

  /* One editing session over one picture: the selected sprite and pattern,
   * the tool, the colour number the pencil paints, and any drag in progress.
   * `positions` is the file's own (x,y) per slot as the session found them,
   * so "Release position" can put a dragged sprite back where it was saved. */
  function session(pic) {
    if (!pic) throw fail("no-picture", "a sprite session needs a picture");
    var s = {
      pic: pic,
      sprite: pic.sprites.length ? 0 : -1,   /* the selected SAT slot */
      pattern: pic.spritePatterns.length ? 0 : -1,
      tool: "pencil",
      zoom: "fit",
      grid: true,
      colour: 1,             /* the colour number the pencil paints */
      anchor: null,          /* where this press started */
      last: null,            /* the last pixel a drag touched */
      dragging: false,
      dragRect: null,        /* the live selection/rect, in pattern pixels */
      selection: null,       /* the committed rectangle */
      moveFrom: null,        /* the rectangle a Move drag carries */
      screenFrom: null,      /* the display position a screen drag started at */
      positions: []
    };
    snapshotPositions(s);
    return s;
  }

  /* The (x,y) each placed sprite had when the panel read the file. */
  function snapshotPositions(sess) {
    sess.positions = sess.pic.sprites.map(function (sp) {
      return { x: sp.x, y: sp.y };
    });
    return sess.positions;
  }

  function clampPixel(sess, x, y) {
    var size = patternSize(sess.pic, sess.pattern);
    if (!size)
      throw fail("no-pattern", "there is no sprite pattern to draw on; " +
                 "make one with + PATTERN");
    if (!isInt(x) || !isInt(y))
      throw fail("sprite-pixel-range", "a pattern pixel is two integers, got " +
                 x + "," + y);
    return { x: Math.max(0, Math.min(size.width - 1, x)),
             y: Math.max(0, Math.min(size.height - 1, y)) };
  }

  function rectOf(a, b) {
    return { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y),
             x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) };
  }

  function rectPixels(r) {
    var out = [];
    for (var y = r.y0; y <= r.y1; y++)
      for (var x = r.x0; x <= r.x1; x++) out.push({ x: x, y: y });
    return out;
  }

  function pixelCount(r) { return (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1); }

  function setTool(sess, id) {
    for (var i = 0; i < TOOLS.length; i++)
      if (TOOLS[i].id === id) { sess.tool = id; return id; }
    throw fail("tool-range", id + " is not a tool; the row is " +
               TOOLS.map(function (t) { return t.id; }).join(", "));
  }

  function setZoom(sess, id) {
    if (ZOOMS.indexOf(id) < 0)
      throw fail("zoom-range", id + " is not a zoom; the row is " +
                 ZOOMS.join(", "));
    sess.zoom = id;
    return id;
  }

  function toggleGrid(sess, on) {
    sess.grid = on === undefined ? !sess.grid : !!on;
    return sess.grid;
  }

  function selectColour(sess, index) {
    if (!isInt(index) || index < 0 || index >= ENTRIES)
      throw fail("colour-index", "a sprite colour number is 0-15, got " +
                 index);
    sess.colour = index;
    return index;
  }

  /* ---- the SAT's slots --------------------------------------------------- */

  /* The 64 slots as the panel draws them: the placed ones first, in SAT
   * order (lower index = higher priority), then the empty ones.  `dropped`
   * is how many of a slot's 16-px strips a full line's budget pushes out
   * (ed.spriteBudget), which the slot grid shows. */
  function slots(pic) {
    var budget = ed.spriteBudget(pic);
    var dropped = {};
    for (var l = 0; l < budget.lines.length; l++) {
      var ents = budget.lines[l].entries;
      for (var e = 0; e < ents.length; e++)
        if (ents[e].dropped)
          dropped[ents[e].sprite] = (dropped[ents[e].sprite] || 0) +
                                    ents[e].dropped;
    }
    var out = [];
    for (var i = 0; i < MAX_SPRITES; i++) {
      var s = pic.sprites[i];
      if (!s) { out.push({ number: i, empty: true }); continue; }
      var size = ed.spritePatternSize(pic, s.pattern);
      out.push({ number: i, empty: false, x: s.x, y: s.y,
                 pattern: s.pattern, palette: s.palette,
                 priority: s.priority, hflip: s.hflip, vflip: s.vflip,
                 width: size.width, height: size.height,
                 parked: s.y >= PARK_ROW,
                 dropped: dropped[i] || 0 });
    }
    return out;
  }

  function countSprites(pic) { return pic.sprites.length; }

  /* Select a slot.  The empty slot just past the placed ones places a new
   * sprite there (ppu.toys' "click an empty slot"); a deeper gap is refused
   * because the SAT is a list — slot 5 with slots 2-4 empty would need the
   * hardware to skip them, and the panel will not invent that. */
  function selectSlot(sess, i) {
    var n = sess.pic.sprites.length;
    if (!isInt(i) || i < 0 || i >= MAX_SPRITES)
      throw fail("sprite-range", "a SAT slot is 0-63, got " + i);
    if (i < n) { sess.sprite = i; return i; }
    if (i > n)
      throw fail("sprite-gap", "the SAT is filled in order: slot " + i +
                 " needs slots 0-" + (i - 1) + ", and only " + n +
                 " are placed");
    var pattern = sess.pattern >= 0 ? sess.pattern : newPattern(sess.pic, 16, 16);
    sess.pattern = pattern;
    var placed = ed.addSprite(sess.pic, {
      x: 112, y: 96, pattern: pattern, palette: 0, priority: 1,
      hflip: 0, vflip: 0
    });
    sess.sprite = placed;
    sess.positions[placed] = { x: 112, y: 96 };
    return placed;
  }

  /* The picker's prev/next: the placed slots and the one empty slot after
   * them, so a new sprite can be placed from the picker too. */
  function step(sess, delta) {
    var n = sess.pic.sprites.length;
    var last = Math.min(n, MAX_SPRITES - 1);
    var at = sess.sprite < 0 ? 0 : sess.sprite + delta;
    if (at < 0) at = last;
    if (at > last) at = 0;
    return selectSlot(sess, at);
  }

  function setField(sess, field, value) {
    if (sess.sprite < 0)
      throw fail("no-sprite", "select a sprite first");
    var changes = {};
    changes[field] = value;
    ed.setSprite(sess.pic, sess.sprite, changes);
    return sess.pic.sprites[sess.sprite];
  }

  function nudge(sess, field, delta) {
    if (sess.sprite < 0)
      throw fail("no-sprite", "select a sprite first");
    var s = sess.pic.sprites[sess.sprite];
    /* A parked sprite is past the picture's own range: any Y nudge brings it
     * back to the last visible line, where −/+ work again. */
    if (field === "y" && s.y >= PARK_ROW)
      return setField(sess, "y", ed.VIEW_H - 1);
    var lo = 0, hi = field === "x" ? ed.VIEW_W - 1 : ed.VIEW_H - 1;
    var value = s[field] + delta;
    /* At the edge the − / + does nothing rather than wrap or refuse: the
     * sprite is already as far as the picture holds. */
    if (value < lo || value > hi) return s;
    return setField(sess, field, value);
  }

  /* Move the selected sprite by a display delta, clamped to the picture. */
  function moveSprite(sess, dx, dy) {
    if (sess.sprite < 0)
      throw fail("no-sprite", "select a sprite first");
    var s = sess.pic.sprites[sess.sprite];
    var x = Math.max(0, Math.min(ed.VIEW_W - 1, s.x + dx));
    var y = Math.max(0, Math.min(ed.VIEW_H - 1, s.y + dy));
    if (x === s.x && y === s.y) return s;
    setField(sess, "x", x);
    setField(sess, "y", y);
    return sess.pic.sprites[sess.sprite];
  }

  /* ppu.toys' "Release position": the panel's spec means "the override stops
   * applying".  This panel edits the asset, so the counterpart is putting the
   * selected sprite back where it was when the panel read the file — the
   * position a drag or a −/+ produced is released, not stored. */
  function releasePosition(sess) {
    if (sess.sprite < 0)
      throw fail("no-sprite", "select a sprite first");
    var was = sess.positions[sess.sprite];
    if (!was)
      throw fail("no-position", "sprite " + sess.sprite +
                 " has no saved position to release");
    var s = sess.pic.sprites[sess.sprite];
    if (s.x === was.x && s.y === was.y)
      throw fail("no-position", "sprite " + sess.sprite + " is already at " +
                 "its saved position (" + was.x + "," + was.y + ")");
    ed.setSprite(sess.pic, sess.sprite, { x: was.x, y: was.y });
    return { x: was.x, y: was.y };
  }

  /* The VDC has no per-sprite enable: "off" is past the display window. */
  function park(sess) {
    if (sess.sprite < 0)
      throw fail("no-sprite", "select a sprite first");
    return ed.parkSprite(sess.pic, sess.sprite);
  }

  function clearSlot(sess) {
    if (sess.sprite < 0)
      throw fail("no-sprite", "select a sprite first");
    var i = sess.sprite;
    ed.removeSprite(sess.pic, i);
    sess.positions.splice(i, 1);
    sess.sprite = sess.pic.sprites.length ? Math.min(i, sess.pic.sprites.length - 1)
                                          : -1;
    return sess.sprite;
  }

  /* ---- the screen: what the VDC shows at a display point ----------------- */

  /* One sprite's opaque pixel at display (x,y), respecting the flips and the
   * line's 16-strip budget (a strip past it is not drawn — pce-sprites.js
   * collectLine).  Returns true when the sprite's pixel there is not colour
   * 0. */
  function spriteCoversAt(pic, index, x, y, stripsBefore) {
    var s = pic.sprites[index];
    if (!s) return false;
    var pat = pic.spritePatterns[s.pattern];
    if (!pat) return false;
    if (s.y >= PARK_ROW) return false;
    var row0 = s.y;
    if (y < row0 || y >= row0 + pat.height) return false;
    var strips = pat.width / ed.STRIP_PX;
    if (stripsBefore + strips > ed.LINE_STRIPS) {
      /* only the kept strips are drawn: a 32-px sprite's right half can be
       * the first one dropped, and HFLIP swaps which half comes first */
      var kept = ed.LINE_STRIPS - stripsBefore;
      if (kept < 1) return false;
      var strip = Math.floor((x - s.x) / ed.STRIP_PX);
      if (s.hflip) strip = strips - 1 - strip;
      if (strip >= kept) return false;
    }
    var px = x - s.x, py = y - row0;
    if (px < 0 || px >= pat.width || py < 0 || py >= pat.height) return false;
    var sx = s.hflip ? pat.width - 1 - px : px;
    var sy = s.vflip ? pat.height - 1 - py : py;
    return pat.pixels[sy * pat.width + sx] !== 0;
  }

  /* The sprite a point of the screen belongs to: the lowest SAT index whose
   * opaque pixel is there (lower index wins overlaps — pce-sprites.js
   * paintLine paints last-to-first for exactly this).  Returns -1 for the
   * background. */
  function spriteAt(pic, x, y) {
    var stripsBefore = 0;
    for (var i = 0; i < pic.sprites.length; i++) {
      var s = pic.sprites[i];
      var pat = pic.spritePatterns[s.pattern];
      if (!pat) continue;
      var onLine = s.y < PARK_ROW && y >= s.y && y < s.y + pat.height;
      if (onLine && spriteCoversAt(pic, i, x, y, stripsBefore)) return i;
      if (onLine) stripsBefore += pat.width / ed.STRIP_PX;
    }
    return -1;
  }

  /* ---- the pattern sheet and its tools ---------------------------------- */

  function patternCount(pic) { return pic.spritePatterns.length; }

  function patternSize(pic, index) {
    if (!isInt(index) || index < 0 || index >= pic.spritePatterns.length)
      return null;
    return ed.spritePatternSize(pic, index);
  }

  function patternSheet(pic) {
    var out = [];
    for (var i = 0; i < pic.spritePatterns.length; i++)
      out.push({ index: i, width: pic.spritePatterns[i].width,
                 height: pic.spritePatterns[i].height });
    return out;
  }

  /* + PATTERN: one of the VDC's six sizes.  The editor refuses a pattern that
   * would not fit before the SAT at VRAM $7F00. */
  function newPattern(pic, width, height) {
    var i = ed.newSpritePattern(pic, width, height);
    return i;
  }

  function selectPattern(sess, i) {
    if (!isInt(i) || i < 0 || i >= sess.pic.spritePatterns.length)
      throw fail("sprite-pattern-range", "sprite pattern " + i +
                 " does not exist");
    sess.pattern = i;
    return i;
  }

  /* The selected pattern's size, which the sprite using it gets. */
  function setPatternSize(sess, width, height) {
    var i = newPattern(sess.pic, width, height);
    sess.pattern = i;
    return i;
  }

  function paintPixel(sess, p, value) {
    var before = patternPixel(sess.pic, sess.pattern, p.x, p.y);
    if (before === value) return 0;
    ed.paintSpriteIndex(sess.pic, sess.pattern, p.x, p.y, value);
    return 1;
  }

  function patternPixel(pic, pattern, x, y) {
    var size = patternSize(pic, pattern);
    if (!size) return 0;
    return ed.spritePatternPixels(pic, pattern)[y * size.width + x];
  }

  /* The bucket: the connected pixels that hold the pressed pixel's colour
   * number (the same rule as #84's fill, at pixel granularity). */
  function floodPixels(pic, pattern, start) {
    var size = patternSize(pic, pattern);
    var px = ed.spritePatternPixels(pic, pattern);
    var source = px[start.y * size.width + start.x];
    var seen = {}, out = [], stack = [start];
    var key = function (c) { return c.y * size.width + c.x; };
    seen[key(start)] = true;
    while (stack.length) {
      var c = stack.pop();
      out.push(c);
      var around = [{ x: c.x - 1, y: c.y }, { x: c.x + 1, y: c.y },
                    { x: c.x, y: c.y - 1 }, { x: c.x, y: c.y + 1 }];
      for (var i = 0; i < around.length; i++) {
        var n = around[i];
        if (n.x < 0 || n.x >= size.width || n.y < 0 || n.y >= size.height)
          continue;
        if (seen[key(n)]) continue;
        seen[key(n)] = true;
        if (px[n.y * size.width + n.x] === source) stack.push(n);
      }
    }
    return out;
  }

  /* Move a block of pattern pixels by an offset; the source is blanked first
   * (to colour 0) so an overlapping move copies rather than smears. */
  function moveRect(sess, rect, dx, dy) {
    if (!dx && !dy) return 0;
    var size = patternSize(sess.pic, sess.pattern);
    var i, cells = rectPixels(rect), buf = [];
    for (i = 0; i < cells.length; i++) {
      var c = cells[i];
      buf.push({ x: c.x + dx, y: c.y + dy,
                 v: patternPixel(sess.pic, sess.pattern, c.x, c.y) });
    }
    var changed = 0;
    for (i = 0; i < cells.length; i++) {
      var at = cells[i];
      if (patternPixel(sess.pic, sess.pattern, at.x, at.y) !== 0) {
        ed.paintSpriteIndex(sess.pic, sess.pattern, at.x, at.y, 0);
        changed++;
      }
    }
    for (i = 0; i < buf.length; i++) {
      var d = buf[i];
      if (d.x < 0 || d.x >= size.width || d.y < 0 || d.y >= size.height)
        continue;
      if (patternPixel(sess.pic, sess.pattern, d.x, d.y) !== d.v)
        changed += paintPixel(sess, d, d.v);
    }
    return changed;
  }

  function applyRect(sess, rect, value) {
    var changed = 0, cells = rectPixels(rect);
    for (var i = 0; i < cells.length; i++)
      changed += paintPixel(sess, cells[i], value);
    return changed;
  }

  /* Every pixel on the straight line between two pixels (Bresenham), so a
   * fast drag leaves no gaps. */
  function linePixels(a, b) {
    var out = [], dx = Math.abs(b.x - a.x), dy = -Math.abs(b.y - a.y);
    var sx = a.x < b.x ? 1 : -1, sy = a.y < b.y ? 1 : -1, err = dx + dy;
    var x = a.x, y = a.y;
    for (;;) {
      out.push({ x: x, y: y });
      if (x === b.x && y === b.y) break;
      var e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
    }
    return out;
  }

  /* press -> (drag)* -> release over the pattern canvas.  Each returns the
   * number of pattern pixels it changed, so the page writes the assets only
   * when something did. */
  function press(sess, x, y) {
    var p = clampPixel(sess, x, y);
    sess.dragging = true;
    sess.anchor = p;
    sess.last = p;
    sess.dragRect = null;
    sess.moveFrom = null;
    switch (sess.tool) {
      case "select":
        sess.dragRect = rectOf(p, p);
        return 0;
      case "rect":
        sess.dragRect = rectOf(p, p);
        return 0;
      case "pencil":
        return paintPixel(sess, p, sess.colour);
      case "erase":
        return paintPixel(sess, p, 0);
      case "fill": {
        var cells = floodPixels(sess.pic, sess.pattern, p);
        var n = 0;
        for (var i = 0; i < cells.length; i++)
          n += paintPixel(sess, cells[i], sess.colour);
        return n;
      }
      case "move":
        if (sess.selection && p.x >= sess.selection.x0 &&
            p.x <= sess.selection.x1 && p.y >= sess.selection.y0 &&
            p.y <= sess.selection.y1) {
          sess.moveFrom = { x0: sess.selection.x0, y0: sess.selection.y0,
                            x1: sess.selection.x1, y1: sess.selection.y1 };
        } else {
          sess.moveFrom = rectOf(p, p);
        }
        sess.dragRect = sess.moveFrom;
        return 0;
    }
    return 0;
  }

  function drag(sess, x, y) {
    if (!sess.dragging) return 0;
    var p = clampPixel(sess, x, y);
    switch (sess.tool) {
      case "select":
      case "rect":
        sess.dragRect = rectOf(sess.anchor, p);
        return 0;
      case "move": {
        var dx = p.x - sess.anchor.x, dy = p.y - sess.anchor.y;
        sess.dragRect = { x0: sess.moveFrom.x0 + dx, y0: sess.moveFrom.y0 + dy,
                          x1: sess.moveFrom.x1 + dx, y1: sess.moveFrom.y1 + dy };
        return 0;
      }
      case "pencil": {
        var changed = 0, cells = linePixels(sess.last, p);
        for (var i = 0; i < cells.length; i++)
          changed += paintPixel(sess, cells[i], sess.colour);
        sess.last = p;
        return changed;
      }
      case "erase": {
        var n = 0, line = linePixels(sess.last, p);
        for (var j = 0; j < line.length; j++)
          n += paintPixel(sess, line[j], 0);
        sess.last = p;
        return n;
      }
    }
    return 0;
  }

  function release(sess, x, y) {
    if (!sess.dragging) return 0;
    var p = clampPixel(sess, x, y);
    var changed = 0;
    sess.dragging = false;
    switch (sess.tool) {
      case "select":
        sess.selection = rectOf(sess.anchor, p);
        sess.dragRect = null;
        return 0;
      case "rect":
        changed = applyRect(sess, rectOf(sess.anchor, p), sess.colour);
        sess.dragRect = null;
        return changed;
      case "move": {
        var dx = p.x - sess.anchor.x, dy = p.y - sess.anchor.y;
        var dest = { x0: sess.moveFrom.x0 + dx, y0: sess.moveFrom.y0 + dy,
                     x1: sess.moveFrom.x1 + dx, y1: sess.moveFrom.y1 + dy };
        changed = moveRect(sess, sess.moveFrom, dx, dy);
        if (sess.selection) sess.selection = dest;
        sess.moveFrom = null;
        sess.dragRect = null;
        return changed;
      }
    }
    sess.dragRect = null;
    return 0;
  }

  function click(sess, x, y) {
    var n = press(sess, x, y);
    return n + release(sess, x, y);
  }

  /* ---- the screen's drag: select a sprite, move it ---------------------- */

  /* A press on the screen selects the sprite under the point (the one the
   * VDC draws there) and remembers where the drag started.  A press outside
   * every sprite leaves the selection alone and returns -1. */
  function screenPress(sess, x, y) {
    var i = spriteAt(sess.pic, x, y);
    sess.screenFrom = null;
    if (i >= 0) {
      sess.sprite = i;
      var s = sess.pic.sprites[i];
      sess.screenFrom = { x: x, y: y, sx: s.x, sy: s.y };
    }
    return i;
  }

  /* A drag moves the selected sprite with the pointer.  The sprite is put
   * at where the drag started plus the pointer's delta, clamped to the
   * picture, so a grab does not jump the sprite's origin to the cursor. */
  function screenDrag(sess, x, y) {
    if (!sess.screenFrom || sess.sprite < 0) return 0;
    var f = sess.screenFrom;
    var nx = Math.max(0, Math.min(ed.VIEW_W - 1, f.sx + (x - f.x)));
    var ny = Math.max(0, Math.min(ed.VIEW_H - 1, f.sy + (y - f.y)));
    var s = sess.pic.sprites[sess.sprite];
    if (s.x === nx && s.y === ny) return 0;
    ed.setSprite(sess.pic, sess.sprite, { x: nx, y: ny });
    return 1;
  }

  function screenRelease(sess) {
    var had = !!sess.screenFrom;
    sess.screenFrom = null;
    return had;
  }

  /* ---- the per-line status (#50's model, from the picture) -------------- */

  function lineStatus(pic, line) {
    return ed.spriteLineBudget(pic, line);
  }

  /* The busiest line of the picture, plus how many lines drop strips. */
  function budget(pic) { return ed.spriteBudget(pic); }

  /* ---- the asset files -------------------------------------------------- *
   *
   * sprites.json holds the patterns and the SAT:
   *   { version, patterns: [{width, height, pixels[16/32*16/32/64]}],
   *     sprites: [{x, y, pattern, palette, priority, hflip, vflip}] }
   * The pixels are 4-bit colour numbers (0 = transparent), the way
   * pce-editor.js's picture holds them.  palettes.json carries the sprite
   * palettes, which renderer/pce-screen.js parses, so the panel's picture is
   * that file's picture plus the SAT.
   * --------------------------------------------------------------------- */

  var SPRITES_VERSION = 1;

  function parseJson(text, what) {
    try { return JSON.parse(text); }
    catch (e) {
      throw fail("asset-json", what + " is not JSON: " + e.message);
    }
  }

  function checkPattern(def, where) {
    if (!def || !isInt(def.width) || !isInt(def.height))
      throw fail("asset-shape", where + ": a pattern needs integer width " +
                 "and height");
    var size = null;
    for (var i = 0; i < SIZES.length; i++)
      if (SIZES[i].width === def.width && SIZES[i].height === def.height)
        size = SIZES[i];
    if (!size)
      throw fail("sprite-size", where + ": the VDC draws 16x16, 32x16, " +
                 "16x32, 32x32, 16x64 or 32x64; " + def.width + "x" +
                 def.height + " is not one of them");
    if (!Array.isArray(def.pixels) || def.pixels.length !== def.width * def.height)
      throw fail("asset-shape", where + ": a " + def.width + "x" + def.height +
                 " pattern is " + (def.width * def.height) + " pixels, got " +
                 (Array.isArray(def.pixels) ? def.pixels.length : "none"));
    for (var p = 0; p < def.pixels.length; p++) {
      var v = def.pixels[p];
      if (!isInt(v) || v < 0 || v >= ENTRIES)
        throw fail("17th-colour", where + ": pixel " + p + " is " + v +
                   "; a sprite pixel is 4 bits (0-15)");
    }
    return size;
  }

  /* The picture the toy's files make: pce-screen.js's (tiles, the BAT and the
   * palettes) with sprites.json's patterns and SAT on top.  A missing or
   * empty sprites.json is a picture with no sprites. */
  function pictureFromFiles(files) {
    var pic = screen.pictureFromFiles(files);
    var byName = {};
    for (var i = 0; i < (files || []).length; i++)
      byName[files[i].name] = files[i].source;
    if (!byName["sprites.json"]) return pic;
    var doc = parseJson(byName["sprites.json"], "sprites.json");
    var patterns = doc.patterns || [];
    if (!Array.isArray(patterns))
      throw fail("asset-shape", "sprites.json: patterns must be a list");
    for (var p = 0; p < patterns.length; p++) {
      var size = checkPattern(patterns[p], "sprites.json pattern " + p);
      var index = newPattern(pic, size.width, size.height);
      var px = patterns[p].pixels;
      for (var y = 0; y < size.height; y++)
        for (var x = 0; x < size.width; x++)
          if (px[y * size.width + x])
            ed.paintSpriteIndex(pic, index, x, y, px[y * size.width + x]);
    }
    var list = doc.sprites || [];
    if (!Array.isArray(list))
      throw fail("asset-shape", "sprites.json: sprites must be a list");
    if (list.length > MAX_SPRITES)
      throw fail("65th-sprite", "sprites.json names " + list.length +
                 " sprites; the SAT holds " + MAX_SPRITES);
    for (var s = 0; s < list.length; s++) {
      var sp = list[s] || {};
      var spec = { x: sp.x, y: sp.y, pattern: sp.pattern,
                   palette: sp.palette, priority: sp.priority,
                   hflip: sp.hflip, vflip: sp.vflip };
      if (sp.parked || sp.y === PARK_ROW) {
        /* a slot the panel parked: the editor's own y range is the picture's,
         * and the park row is the one position past it */
        spec.y = 0;
        ed.addSprite(pic, spec);
        ed.parkSprite(pic, pic.sprites.length - 1);
      } else {
        ed.addSprite(pic, spec);
      }
    }
    return pic;
  }

  function spritesText(pic) {
    var patterns = [];
    for (var i = 0; i < pic.spritePatterns.length; i++) {
      var pat = pic.spritePatterns[i];
      patterns.push({ width: pat.width, height: pat.height,
                      pixels: Array.prototype.slice.call(pat.pixels) });
    }
    var sprites = [];
    for (var s = 0; s < pic.sprites.length; s++) {
      var sp = pic.sprites[s];
      var out = { x: sp.x, y: sp.y, pattern: sp.pattern, palette: sp.palette,
                  priority: sp.priority, hflip: sp.hflip, vflip: sp.vflip };
      if (sp.y >= PARK_ROW) { out.parked = 1; out.y = 0; }
      sprites.push(out);
    }
    var doc = { version: SPRITES_VERSION, patterns: patterns, sprites: sprites };
    return JSON.stringify(doc, null, 2) + "\n";
  }

  /* Write the SAT and the sprite palettes back into the file set.  Returns
   * the file names whose source changed.  tiles.json is NOT written: it
   * belongs to the SCREEN panel, and rewriting it from here would turn a
   * sprite edit into a background edit. */
  function syncFiles(pic, files) {
    var changed = [];
    var text = { "sprites.json": spritesText(pic),
                 "palettes.json": screen.palettesText(pic) };
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      if (!text[f.name]) continue;
      if (f.source !== text[f.name]) { f.source = text[f.name]; changed.push(f.name); }
    }
    return changed;
  }

  /* The picture as the VDC would show it — the panel's screen and the frame
   * the evidence compares. */
  function frame(pic, at) {
    return ed.renderPreview(pic, at || 0);
  }

  return {
    MAX_SPRITES: MAX_SPRITES,
    SPRITE_PALETTES: SPRITE_PALETTES,
    ENTRIES: ENTRIES,
    PARK_ROW: PARK_ROW,
    TOOLS: TOOLS,
    ZOOMS: ZOOMS,
    SIZES: SIZES,

    session: session,
    snapshotPositions: snapshotPositions,
    setTool: setTool,
    setZoom: setZoom,
    toggleGrid: toggleGrid,
    selectColour: selectColour,

    slots: slots,
    countSprites: countSprites,
    selectSlot: selectSlot,
    step: step,
    setField: setField,
    nudge: nudge,
    moveSprite: moveSprite,
    releasePosition: releasePosition,
    park: park,
    clearSlot: clearSlot,
    spriteAt: spriteAt,

    patternCount: patternCount,
    patternSize: patternSize,
    patternSheet: patternSheet,
    newPattern: newPattern,
    selectPattern: selectPattern,
    setPatternSize: setPatternSize,
    patternPixel: patternPixel,
    paintPixel: paintPixel,
    floodPixels: floodPixels,

    clampPixel: clampPixel,
    rectOf: rectOf,
    rectPixels: rectPixels,
    pixelCount: pixelCount,
    linePixels: linePixels,
    press: press, drag: drag, release: release, click: click,

    screenPress: screenPress,
    screenDrag: screenDrag,
    screenRelease: screenRelease,

    lineStatus: lineStatus,
    budget: budget,

    pictureFromFiles: pictureFromFiles,
    spritesText: spritesText,
    syncFiles: syncFiles,
    frame: frame
  };
});
