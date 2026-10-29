/*
 * pce-screen.js — the SCREEN panel as a visual editor (card #84, part A).
 *
 * ppu.toys' BACKGROUNDS panel is the working example: the background layer is
 * drawn as a map of cells with a tool row (select, pencil, rect, fill, erase,
 * move), a grid and a zoom, and a tile sheet and palette strip beside it.  The
 * PCE counterpart is the VDC's one background layer — the BAT at VRAM word 0,
 * 32x32 cells of 8x8 characters, each with a 4-bit palette field (docs/
 * RENDERER.md).  This file is that panel's model: the tools, the asset files
 * the panel edits, and nothing drawn — renderer/studio.html paints the canvas
 * from the renderer's own picture.
 *
 * There is no second picture here.  A session wraps one of renderer/
 * pce-editor.js's pictures (`ed.newPicture()`), and every edit goes through
 * that module's own calls — paintMapCell, paintTileIndex, newTile,
 * setPaletteColour, setScroll — so the refusals are the editor's refusals
 * (17th-colour, not-in-palette, tile-space, map-range, …), not a copy.
 *
 * What the panel edits is the toy's assets, not the running frame.  The map
 * lives in tiles.json beside the tiles it names (a `map` object with the BAT's
 * words), palettes in palettes.json; the shape is pce-editor.js's picture, the
 * same one the ASSETS tab saves (#77) and the importer will read (#24/#71).
 * Until that importer exists a toy still writes its own VRAM/CRAM, so the
 * panel's own canvas is the picture these assets make — rendered by pce-bg.js,
 * the same model as the output column.
 *
 * Part A is the 32x32 BAT (MWR $00), the size the toy host's 256x224 frame
 * uses and the size pce-editor.js's picture model holds.  The VDC's other
 * MWR sizes (64x32, 128x32, 32x64, 64x64, 128x64) and the 224-dot window are
 * part B's, not silently pretended here: readMapSize() reports the mode the
 * asset names, and a file asking for another refuses with `map-size`.
 *
 * Dual use: CommonJS module in Node (tests/check-studio.js) and a browser
 * global (renderer/studio.html), like pce-bg.js and pce-editor.js.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./pce-editor.js"));
  } else {
    root.PCEStudio = root.PCEStudio || {};
    root.PCEStudio.screen = factory(root.PCEStudio.editor);
  }
})(typeof self !== "undefined" ? self : this, function (ed) {
  "use strict";

  var CELL = 8;                 /* a tile is 8x8; the BAT's one cell */
  var COLS = 32;                /* MWR bits 4-5 = 00: 32x32 */
  var ROWS = 32;
  var FIRST_CHAR = ed.FIRST_CHAR;
  var PALETTES = ed.PALETTES;
  var ENTRIES = ed.ENTRIES;

  /* ppu.toys' tool row, in its order, with the PCE meaning and a key hint.
   * `move` drags the selection (or the pressed cell) to another place. */
  var TOOLS = [
    { id: "select", label: "Select", key: "S",
      title: "Select (S): drag a rectangle of cells; the footer says its size" },
    { id: "pencil", label: "Pencil", key: "P",
      title: "Pencil (P): paint cells with the selected tile" },
    { id: "rect", label: "Rect", key: "R",
      title: "Rect (R): drag a rectangle, filled with the selected tile" },
    { id: "fill", label: "Fill", key: "F",
      title: "Fill (F): flood the connected cells of the same tile" },
    { id: "erase", label: "Erase", key: "E",
      title: "Erase (E): paint the blank tile of the cell's palette" },
    { id: "move", label: "Move", key: "M",
      title: "Move (M): drag the selection (or one cell) somewhere else" }
  ];

  var ZOOMS = ["fit", "1x", "2x", "4x"];

  function fail(code, message) {
    var e = new Error(message);
    e.code = code;
    return e;
  }

  function isInt(v) { return typeof v === "number" && v === Math.floor(v); }

  /* ---- the session ------------------------------------------------------ */

  /* One editing session over one picture: the tool, the zoom, the drawing
   * colour, the pressed cell and any drag in progress.  A fresh picture gets
   * a fresh session (`session(ed.newPicture())`). */
  function session(pic) {
    if (!pic) throw fail("no-picture", "a screen session needs a picture");
    return {
      pic: pic,
      tool: "pencil",
      zoom: "fit",
      grid: true,
      tile: FIRST_CHAR,      /* the character the pencil paints */
      colour: 1,             /* the colour number the tile pencil paints */
      anchor: null,          /* where this press started */
      last: null,            /* the last cell a drag touched */
      dragging: false,
      dragRect: null,        /* the live selection/rect rectangle */
      selection: null,       /* the committed rectangle */
      moveFrom: null         /* the rectangle a Move drag carries */
    };
  }

  function clampCell(x, y) {
    if (!isInt(x) || !isInt(y))
      throw fail("map-range", "a cell is two integers, got " + x + "," + y);
    return { x: Math.max(0, Math.min(COLS - 1, x)),
             y: Math.max(0, Math.min(ROWS - 1, y)) };
  }

  function rectOf(a, b) {
    return { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y),
             x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) };
  }

  function rectCells(r) {
    var out = [];
    for (var y = r.y0; y <= r.y1; y++)
      for (var x = r.x0; x <= r.x1; x++) out.push({ x: x, y: y });
    return out;
  }

  function cellCount(r) { return (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1); }

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

  /* ---- the tiles and their colours -------------------------------------- */

  function tileExists(pic, char) {
    return isInt(char) && char >= FIRST_CHAR && char <= ed.LAST_CHAR &&
           !!pic.tiles[char];
  }

  /* The blank character for a palette: the one already blank in that palette
   * if there is one, otherwise a new tile (which is born blank).  This is
   * what "erase" paints — the VDC has no empty cell, only a tile of colour 0. */
  function blankChar(pic, palette) {
    for (var char = FIRST_CHAR; char < pic.nextChar; char++) {
      var tile = pic.tiles[char];
      if (!tile || tile.palette !== palette) continue;
      var zero = true;
      for (var i = 0; i < tile.pixels.length; i++)
        if (tile.pixels[i] !== 0) { zero = false; break; }
      if (zero) return char;
    }
    return ed.newTile(pic, palette);
  }

  function selectTile(sess, char) {
    if (!tileExists(sess.pic, char))
      throw fail("no-tile", "character $" + (isInt(char) ? char.toString(16) :
                 String(char)) + " has no tile; make one with + TILE");
    sess.tile = char;
    return char;
  }

  function selectColour(sess, index) {
    if (!isInt(index) || index < 0 || index >= ENTRIES)
      throw fail("colour-index", "a tile colour number is 0-15, got " + index);
    sess.colour = index;
    return index;
  }

  function tilePalette(sess, char) {
    var t = sess.pic.tiles[tileExists(sess.pic, char) ? char : sess.tile];
    return t ? t.palette : 0;
  }

  /* The tile sheet: every character the picture holds, in order. */
  function tileSheet(pic) {
    var out = [];
    for (var char = FIRST_CHAR; char < pic.nextChar; char++)
      if (pic.tiles[char])
        out.push({ char: char, palette: pic.tiles[char].palette });
    return out;
  }

  /* Paint one pixel of the selected tile with the selected colour number. */
  function paintTilePixel(sess, px, py) {
    ed.paintTileIndex(sess.pic, sess.tile, px, py, sess.colour);
    return 1;
  }

  /* ---- the tools -------------------------------------------------------- */

  function paintCell(sess, cell, char) {
    var before = ed.mapCell(sess.pic, cell.x, cell.y);
    if (before === char) return 0;
    ed.paintMapCell(sess.pic, cell.x, cell.y, char);
    return 1;
  }

  function eraseCell(sess, cell) {
    var char = ed.mapCell(sess.pic, cell.x, cell.y);
    var palette = tileExists(sess.pic, char) ? sess.pic.tiles[char].palette : 0;
    return paintCell(sess, cell, blankChar(sess.pic, palette));
  }

  /* Every cell on the straight line between two cells, so a fast drag does
   * not leave gaps (Bresenham over cells). */
  function lineCells(a, b) {
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

  /* The bucket: the connected cells that hold the pressed cell's character. */
  function floodCells(pic, start) {
    var source = ed.mapCell(pic, start.x, start.y);
    var seen = {}, out = [], stack = [start];
    var key = function (c) { return c.y * COLS + c.x; };
    seen[key(start)] = true;
    while (stack.length) {
      var c = stack.pop();
      out.push(c);
      var around = [{ x: c.x - 1, y: c.y }, { x: c.x + 1, y: c.y },
                    { x: c.x, y: c.y - 1 }, { x: c.x, y: c.y + 1 }];
      for (var i = 0; i < around.length; i++) {
        var n = around[i];
        if (n.x < 0 || n.x >= COLS || n.y < 0 || n.y >= ROWS) continue;
        if (seen[key(n)]) continue;
        seen[key(n)] = true;
        if (ed.mapCell(pic, n.x, n.y) === source) stack.push(n);
      }
    }
    return out;
  }

  /* Move a rectangle's cells by a cell offset.  Sources are blanked before
   * the writes, so an overlapping move copies rather than smears. */
  function moveRect(sess, rect, dx, dy) {
    if (!dx && !dy) return 0;
    var pic = sess.pic, buf = [], i, c;
    var cells = rectCells(rect);
    for (i = 0; i < cells.length; i++) {
      c = cells[i];
      buf.push({ x: c.x + dx, y: c.y + dy,
                 char: ed.mapCell(pic, c.x, c.y) });
    }
    for (i = 0; i < cells.length; i++) {
      c = cells[i];
      var was = ed.mapCell(pic, c.x, c.y);
      var palette = tileExists(pic, was) ? pic.tiles[was].palette : 0;
      var blank = blankChar(pic, palette);
      if (was !== blank) ed.paintMapCell(pic, c.x, c.y, blank);
    }
    var changed = 0;
    for (i = 0; i < buf.length; i++) {
      var at = buf[i];
      if (at.x < 0 || at.x >= COLS || at.y < 0 || at.y >= ROWS) continue;
      if (ed.mapCell(pic, at.x, at.y) !== at.char) {
        ed.paintMapCell(pic, at.x, at.y, at.char);
        changed++;
      }
    }
    return changed;
  }

  function applyRect(sess, rect, char) {
    var changed = 0, cells = rectCells(rect);
    for (var i = 0; i < cells.length; i++)
      changed += paintCell(sess, cells[i], char);
    return changed;
  }

  /* press -> (drag)* -> release.  Each returns the number of cells (or tile
   * pixels) the call changed, so the page knows when to write the assets. */
  function press(sess, x, y) {
    var cell = clampCell(x, y);
    sess.dragging = true;
    sess.anchor = cell;
    sess.last = cell;
    sess.dragRect = null;
    sess.moveFrom = null;
    switch (sess.tool) {
      case "select":
        sess.dragRect = rectOf(cell, cell);
        return 0;
      case "pencil":
        return paintCell(sess, cell, sess.tile);
      case "erase":
        return eraseCell(sess, cell);
      case "rect":
        sess.dragRect = rectOf(cell, cell);
        return 0;
      case "fill":
        return applyOnly(sess, floodCells(sess.pic, cell), sess.tile);
      case "move":
        /* A press inside the selection moves the whole selection; anywhere
         * else moves just the pressed cell. */
        if (sess.selection && cell.x >= sess.selection.x0 &&
            cell.x <= sess.selection.x1 && cell.y >= sess.selection.y0 &&
            cell.y <= sess.selection.y1) {
          sess.moveFrom = {
            x0: sess.selection.x0, y0: sess.selection.y0,
            x1: sess.selection.x1, y1: sess.selection.y1
          };
        } else {
          sess.moveFrom = rectOf(cell, cell);
        }
        sess.dragRect = sess.moveFrom;
        return 0;
    }
    return 0;
  }

  function applyOnly(sess, cells, char) {
    var changed = 0;
    for (var i = 0; i < cells.length; i++)
      changed += paintCell(sess, cells[i], char);
    return changed;
  }

  function drag(sess, x, y) {
    if (!sess.dragging) return 0;
    var cell = clampCell(x, y);
    switch (sess.tool) {
      case "select":
      case "rect":
        sess.dragRect = rectOf(sess.anchor, cell);
        return 0;
      case "move": {
        var dx = cell.x - sess.anchor.x, dy = cell.y - sess.anchor.y;
        sess.dragRect = {
          x0: sess.moveFrom.x0 + dx, y0: sess.moveFrom.y0 + dy,
          x1: sess.moveFrom.x1 + dx, y1: sess.moveFrom.y1 + dy
        };
        return 0;
      }
      case "pencil": {
        var changed = 0, cells = lineCells(sess.last, cell);
        for (var i = 0; i < cells.length; i++)
          changed += paintCell(sess, cells[i], sess.tile);
        sess.last = cell;
        return changed;
      }
      case "erase": {
        var n = 0, line = lineCells(sess.last, cell);
        for (var j = 0; j < line.length; j++)
          n += eraseCell(sess, line[j]);
        sess.last = cell;
        return n;
      }
    }
    return 0;
  }

  function release(sess, x, y) {
    if (!sess.dragging) return 0;
    var cell = clampCell(x, y);
    var changed = 0;
    sess.dragging = false;
    switch (sess.tool) {
      case "select":
        sess.selection = rectOf(sess.anchor, cell);
        sess.dragRect = null;
        return 0;
      case "rect":
        changed = applyRect(sess, rectOf(sess.anchor, cell), sess.tile);
        sess.dragRect = null;
        return changed;
      case "move": {
        var dx = cell.x - sess.anchor.x, dy = cell.y - sess.anchor.y;
        var dest = {
          x0: sess.moveFrom.x0 + dx, y0: sess.moveFrom.y0 + dy,
          x1: sess.moveFrom.x1 + dx, y1: sess.moveFrom.y1 + dy
        };
        changed = moveRect(sess, sess.moveFrom, dx, dy);
        /* The selection follows what it moved. */
        if (sess.selection) sess.selection = dest;
        sess.moveFrom = null;
        sess.dragRect = null;
        return changed;
      }
    }
    sess.dragRect = null;
    return 0;
  }

  /* A click is a press and release in one cell. */
  function click(sess, x, y) {
    var n = press(sess, x, y);
    return n + release(sess, x, y);
  }

  /* ---- the asset files --------------------------------------------------
   *
   * tiles.json holds the tiles and the map that names them; palettes.json
   * holds the VCE's 32 palettes of 16 words (docs/STUDIO.md §7).  The map is
   * the BAT's own data — 1024 character words for the 32x32 mode — and it
   * travels in tiles.json so the toy stays a five-file set: a map of
   * characters without its tiles would be half a picture.
   * ------------------------------------------------------------------- */

  var TILES_VERSION = 1;
  var PALETTES_VERSION = 1;
  var MWR_32x32 = 0;

  function parseJson(text, what) {
    try { return JSON.parse(text); }
    catch (e) {
      throw fail("asset-json", what + " is not JSON: " + e.message);
    }
  }

  function checkTile(tile, where) {
    if (!tile || !isInt(tile.char))
      throw fail("asset-shape", where + ": every tile needs an integer char");
    if (tile.char < FIRST_CHAR || tile.char > ed.LAST_CHAR)
      throw fail("vram-range", where + ": character $" +
                 tile.char.toString(16) + " is outside $" +
                 FIRST_CHAR.toString(16) + "..$" + ed.LAST_CHAR.toString(16));
    if (!isInt(tile.palette) || tile.palette < 0 || tile.palette >= PALETTES)
      throw fail("palette-range", where + ": palette must be 0.." +
                 (PALETTES - 1) + ", got " + tile.palette);
    if (!Array.isArray(tile.pixels) || tile.pixels.length !== 64)
      throw fail("asset-shape", where + ": a tile is 64 pixel values");
    for (var i = 0; i < 64; i++) {
      var v = tile.pixels[i];
      if (!isInt(v) || v < 0 || v >= ENTRIES)
        throw fail("17th-colour", where + ": pixel " + i + " is " + v +
                   "; a pixel is 4 bits (0-15)");
    }
  }

  function checkPaletteRow(row, where) {
    if (!Array.isArray(row) || row.length !== ENTRIES)
      throw fail("asset-shape", where + ": a palette is " + ENTRIES +
                 " colours");
    for (var e = 0; e < ENTRIES; e++) {
      var v = row[e];
      if (!isInt(v) || v < 0 || v >= 512)
        throw fail("colour-range", where + ": entry " + e + " is " + v +
                   "; a VCE colour is 0-511");
    }
  }

  /* The picture an asset file set holds.  A missing or empty file is the
   * editor's own new picture (one blank tile, the map filled with it). */
  function pictureFromFiles(files) {
    var byName = {};
    for (var i = 0; i < (files || []).length; i++)
      byName[files[i].name] = files[i].source;
    var pic = ed.newPicture();

    if (byName["palettes.json"]) {
      var pal = parseJson(byName["palettes.json"], "palettes.json");
      if (!isInt(pal.backdrop) || pal.backdrop < 0 || pal.backdrop >= 512)
        throw fail("colour-range", "palettes.json: backdrop must be a VCE " +
                   "colour 0-511");
      pic.backdrop = pal.backdrop;
      for (var p = 0; p < PALETTES; p++) {
        var row = pal.background && pal.background[p];
        if (!row) continue;
        checkPaletteRow(row, "palettes.json background " + p);
        for (var e = 0; e < ENTRIES; e++)
          pic.palettes[p][e] = e === 0 ? pal.backdrop : row[e];
      }
      for (var sp = 0; sp < PALETTES; sp++) {
        var srow = pal.sprites && pal.sprites[sp];
        if (!srow) continue;
        checkPaletteRow(srow, "palettes.json sprites " + sp);
        for (var se = 0; se < ENTRIES; se++)
          pic.spritePalettes[sp][se] = srow[se];
      }
    }

    if (byName["tiles.json"]) {
      var tiles = parseJson(byName["tiles.json"], "tiles.json");
      if (Array.isArray(tiles.tiles) && tiles.tiles.length) {
        var next = FIRST_CHAR;
        for (var t = 0; t < tiles.tiles.length; t++) {
          var def = tiles.tiles[t];
          checkTile(def, "tiles.json tile " + t);
          pic.tiles[def.char] = {
            palette: def.palette,
            pixels: new Uint8Array(def.pixels)
          };
          next = Math.max(next, def.char + 1);
        }
        pic.nextChar = next;
      }
      if (tiles.map) {
        var map = tiles.map;
        if (map.mwr !== undefined && map.mwr !== MWR_32x32)
          throw fail("map-size", "tiles.json names MWR $" +
                     map.mwr.toString(16) + "; this panel draws the 32x32 " +
                     "BAT (MWR $00), and the wider maps are part B");
        var cells = map.cells;
        if (!Array.isArray(cells) || cells.length !== COLS * ROWS)
          throw fail("map-size", "tiles.json's map needs " + COLS * ROWS +
                     " cells for the 32x32 BAT, got " +
                     (Array.isArray(cells) ? cells.length : "none"));
        for (var m = 0; m < cells.length; m++) {
          var char = cells[m];
          if (!isInt(char) || char < 0 || char > 0xFFFF)
            throw fail("map-range", "tiles.json map cell " + m + " is " +
                       char + "; a BAT word is a 16-bit character");
          if (!tileExists(pic, char))
            throw fail("no-tile", "tiles.json map cell " + m + " names " +
                       "character $" + char.toString(16) + ", which has no " +
                       "tile");
          pic.map[m] = char;
        }
        if (map.bxr !== undefined || map.byr !== undefined)
          ed.setScroll(pic, { BXR: map.bxr, BYR: map.byr });
      } else if (Array.isArray(tiles.tiles) && tiles.tiles.length) {
        /* Tiles but no map (a hand-written file): every cell shows $40, and
         * the panel writes the map back on the first edit. */
        pic.map.fill(FIRST_CHAR);
      }
    }
    return pic;
  }

  function tilesText(pic) {
    var tiles = [];
    for (var char = FIRST_CHAR; char < pic.nextChar; char++) {
      var tile = pic.tiles[char];
      if (!tile) continue;
      tiles.push({ char: char, palette: tile.palette,
                   pixels: Array.prototype.slice.call(tile.pixels) });
    }
    var doc = {
      version: TILES_VERSION,
      tiles: tiles,
      map: { mwr: MWR_32x32,
             bxr: pic.scroll.BXR, byr: pic.scroll.BYR,
             cells: Array.prototype.slice.call(pic.map) }
    };
    return JSON.stringify(doc, null, 2) + "\n";
  }

  function palettesText(pic) {
    function rows(source) {
      var out = [];
      for (var p = 0; p < PALETTES; p++)
        out.push(Array.prototype.slice.call(source[p]));
      return out;
    }
    var doc = {
      version: PALETTES_VERSION,
      backdrop: pic.backdrop,
      background: rows(pic.palettes),
      sprites: rows(pic.spritePalettes)
    };
    return JSON.stringify(doc, null, 2) + "\n";
  }

  /* Write the picture back into the file set.  Returns the file names whose
   * source changed, so the page repaints only when something did. */
  function syncFiles(pic, files) {
    var changed = [];
    var text = { "tiles.json": tilesText(pic),
                 "palettes.json": palettesText(pic) };
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      if (!text[f.name]) continue;
      if (f.source !== text[f.name]) { f.source = text[f.name]; changed.push(f.name); }
    }
    return changed;
  }

  /* What the asset file says the map size is (part B widens this). */
  function readMapSize(pic) {
    return { mwr: MWR_32x32, width: COLS, height: ROWS };
  }

  /* The picture as the VDC would show it: the renderer's own frame of
   * toPicture(), at the picture's window (pce-editor.js).  This is the
   * canvas the panel paints, and the frame the evidence compares. */
  function frame(pic, at) {
    return ed.renderPreview(pic, at || 0);
  }

  return {
    CELL: CELL, COLS: COLS, ROWS: ROWS,
    TOOLS: TOOLS, ZOOMS: ZOOMS,
    session: session,
    setTool: setTool,
    setZoom: setZoom,
    toggleGrid: toggleGrid,
    selectTile: selectTile,
    selectColour: selectColour,
    tilePalette: tilePalette,
    tileSheet: tileSheet,
    blankChar: blankChar,
    paintTilePixel: paintTilePixel,
    press: press, drag: drag, release: release, click: click,
    clampCell: clampCell,
    rectOf: rectOf, rectCells: rectCells, cellCount: cellCount,
    lineCells: lineCells,
    floodCells: floodCells,
    pictureFromFiles: pictureFromFiles,
    tilesText: tilesText,
    palettesText: palettesText,
    syncFiles: syncFiles,
    readMapSize: readMapSize,
    frame: frame
  };
});
