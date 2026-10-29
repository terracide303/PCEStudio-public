/*
 * studio-panel-screen.js — the SCREEN panel (card #84, part A), a module of
 * the studio since #102.
 *
 * ppu.toys' BACKGROUNDS is the working example; this is its PCE counterpart.
 * renderer/pce-screen.js is the model (tools, session, the asset files), and
 * renderer/pce-editor.js is the picture it edits; this file is the panel: the
 * map, tile sheet, tile editor and palette strip canvases, the pointer and
 * keys, and the chrome.  It has no second picture — every edit goes through
 * the model, and every pixel is the renderer's.
 *
 * The panel talks to the page only through the studio API passed to
 * register(studio): the toy's files (studio.toy), the frame's state and line
 * (studio.render), toast/$, and panel-dirty.  docs/STUDIO.md §3.1 lists the
 * API.
 *
 * #102 also closes #84's visual gaps: a curve button beside BXR and BYR (the
 * register-poke keyframes are #79's, so the button names that card), and the
 * map size (MWR) and screen width (VCE dot clock) as dropdowns.
 */
(function (root) {
  "use strict";
  var P = root.PCEStudio = root.PCEStudio || {};
  P.studioPanelModules = P.studioPanelModules || [];

  P.studioPanelModules.push({
    id: "screen",
    register: function (studio) {
      var sc = P.screen, ed = P.editor;
      var pic = null;              /* the picture the assets make */
      var sess = null;             /* the editing session over it */
      var error = "";
      var dirty = true;

      var SCR_MAP_PX = 256;        /* 32 cells x 8 pixels */
      var SCR_TILES_PER_ROW = 32;

      /* ---- the model's state -------------------------------------------- */
      function ready() { return !!(sc && ed); }

      function state() {
        if (pic && sess) return { pic: pic, sess: sess };
        if (!ready()) return null;
        try {
          pic = sc.pictureFromFiles(studio.toy.files());
          error = "";
        } catch (e) {
          error = (e.code ? e.code + ": " : "") + e.message;
          pic = ed.newPicture();
        }
        sess = sc.session(pic);
        dirty = true;
        return { pic: pic, sess: sess };
      }

      /* The next draw rebuilds the picture from the asset files (a different
       * toy, or an asset edited in the code editor). */
      function invalidate() {
        pic = null;
        sess = null;
        dirty = true;
      }

      function fail(e) {
        error = (e && e.code ? e.code + ": " : "") +
                (e && e.message ? e.message : e);
        var el = studio.$("scr-pick");
        if (el) el.textContent = error;
        studio.toast(error);
      }

      function entryColour(p, palette, index) {
        return index === 0 ? p.backdrop : p.palettes[palette][index];
      }

      function css(colour) {
        var c = ed.colourChannels(colour);
        return "rgb(" + (c.r * 36) + "," + (c.g * 36) + "," + (c.b * 36) + ")";
      }

      /* Every edit lands in the asset files the toy saves (the #77
       * envelope); the code editor shows the file if it is the one open. */
      function commit() {
        if (!pic || !sc) return [];
        var changed = [];
        try { changed = studio.toy.writeAssets(pic); }
        catch (e) { fail(e); return []; }
        dirty = true;
        if (!changed.length) { drawEditor(); return []; }
        drawEditor();
        return changed;
      }

      /* The zoom's scale: 1x is one screen pixel per map pixel (a 256-px
       * map), Fit fills the panel's map column. */
      function scaleOf() {
        var zoom = sess ? sess.zoom : "fit";
        if (zoom === "fit") {
          var body = studio.$("dock-body");
          var availW = (body && body.clientWidth ? body.clientWidth : 780) - 300;
          var availH = (body && body.clientHeight ? body.clientHeight : 400) - 70;
          return Math.max(1, Math.min(3,
            Math.min(Math.floor(availW / 256) || 1,
                     Math.floor(availH / 256) || 1)));
        }
        return Number(String(zoom).replace("x", "")) || 1;
      }

      /* ---- the map canvas ----------------------------------------------- */
      function drawMap() {
        var st = state();
        var canvas = studio.$("scr-map");
        if (!st || !canvas) return;
        var p = st.pic;
        var scale = scaleOf();
        canvas.width = SCR_MAP_PX * scale;
        canvas.height = SCR_MAP_PX * scale;
        canvas.style.width = canvas.width + "px";
        canvas.style.height = canvas.height + "px";
        var ctx = canvas.getContext("2d");
        if (!ctx) return;

        /* The map at 1x, then scaled: 65536 fillRects would be slow, one
         * putImageData then drawImage is not. */
        var off = null, octx = null;
        try {
          off = studio.document.createElement("canvas");
          off.width = SCR_MAP_PX; off.height = SCR_MAP_PX;
          octx = off.getContext("2d");
        } catch (e) { off = null; }
        if (octx) {
          var img = octx.createImageData(SCR_MAP_PX, SCR_MAP_PX);
          for (var my = 0; my < sc.ROWS; my++) {
            for (var mx = 0; mx < sc.COLS; mx++) {
              var ch = ed.mapCell(p, mx, my);
              var tile = p.tiles[ch];
              var palette = tile ? tile.palette : 0;
              for (var y = 0; y < 8; y++) {
                for (var x = 0; x < 8; x++) {
                  var v = tile ? tile.pixels[y * 8 + x] : 0;
                  var c = ed.colourChannels(entryColour(p, palette, v));
                  var o = ((my * 8 + y) * SCR_MAP_PX + mx * 8 + x) * 4;
                  img.data[o] = c.r * 36; img.data[o + 1] = c.g * 36;
                  img.data[o + 2] = c.b * 36; img.data[o + 3] = 255;
                }
              }
            }
          }
          octx.putImageData(img, 0, 0);
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
        } else {
          ctx.fillStyle = "#08090c";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }

        /* The cell grid, ppu.toys' "#". */
        if (st.sess.grid) {
          ctx.strokeStyle = "rgba(255,255,255,0.12)";
          ctx.lineWidth = 1;
          for (var i = 0; i <= sc.COLS; i++) {
            var at = Math.round(i * 8 * scale) + 0.5;
            ctx.beginPath();
            ctx.moveTo(at, 0); ctx.lineTo(at, canvas.height);
            ctx.stroke();
          }
          for (var j = 0; j <= sc.ROWS; j++) {
            var aty = Math.round(j * 8 * scale) + 0.5;
            ctx.beginPath();
            ctx.moveTo(0, aty); ctx.lineTo(canvas.width, aty);
            ctx.stroke();
          }
        }

        /* The visible screen: the display window over the map, from BXR/BYR.
         * The window is 256 dots wide (the map's full width, so only its
         * vertical offset shows) and the picture's own height. */
        var lines = windowLines();
        var win = winLines(p);
        var y0 = ((p.scroll.BYR % SCR_MAP_PX) + SCR_MAP_PX) % SCR_MAP_PX;
        var height = Math.min(lines, SCR_MAP_PX - y0);
        ctx.strokeStyle = "rgba(255,255,255,0.55)";
        ctx.beginPath();
        ctx.rect(0.5, y0 * scale + 0.5, canvas.width - 1, height * scale - 1);
        ctx.stroke();
        if (y0 + lines > SCR_MAP_PX) {
          ctx.beginPath();
          ctx.rect(0.5, 0.5, canvas.width - 1,
                   (y0 + lines - SCR_MAP_PX) * scale - 1);
          ctx.stroke();
        }
        if (win && win.width !== 256)
          ctx.strokeStyle = "rgba(255,255,255,0.25)";

        /* The selection and any drag in progress. */
        var r = st.sess.dragRect || st.sess.selection;
        if (r) {
          ctx.strokeStyle = st.sess.dragRect ? "rgba(95,201,232,0.9)" :
                                             "rgba(95,201,232,0.55)";
          ctx.setLineDash(st.sess.dragRect ? [4, 3] : []);
          ctx.strokeRect(r.x0 * 8 * scale + 0.5, r.y0 * 8 * scale + 0.5,
                         (r.x1 - r.x0 + 1) * 8 * scale - 1,
                         (r.y1 - r.y0 + 1) * 8 * scale - 1);
          ctx.setLineDash([]);
        }
      }

      function windowLines() {
        try {
          var win = ed.windowOf ? ed.windowOf(pic || {}) : null;
          return win && win.lines ? win.lines : 224;
        } catch (e) { return 224; }
      }

      function winLines(p) {
        try { return ed.windowOf(p); } catch (e) { return null; }
      }

      /* ---- the tile sheet, the tile and the palette strip ---------------- */
      function drawTiles() {
        var st = state();
        var canvas = studio.$("scr-tiles");
        if (!st || !canvas) return;
        var sheet = sc.tileSheet(st.pic);
        var rows = Math.max(1, Math.ceil(sheet.length / SCR_TILES_PER_ROW));
        canvas.width = 256;
        canvas.height = rows * 8;
        canvas.style.width = "256px";
        canvas.style.height = Math.max(16, canvas.height) + "px";
        var ctx = canvas.getContext("2d");
        if (!ctx) return;
        try {
          var img = ctx.createImageData(256, canvas.height);
          for (var i = 0; i < sheet.length; i++) {
            var cell = sheet[i];
            var tile = st.pic.tiles[cell.char];
            var tx = (i % SCR_TILES_PER_ROW) * 8;
            var ty = Math.floor(i / SCR_TILES_PER_ROW) * 8;
            for (var y = 0; y < 8; y++) {
              for (var x = 0; x < 8; x++) {
                var v = tile.pixels[y * 8 + x];
                var c = ed.colourChannels(
                  entryColour(st.pic, cell.palette, v));
                var o = ((ty + y) * 256 + tx + x) * 4;
                img.data[o] = c.r * 36; img.data[o + 1] = c.g * 36;
                img.data[o + 2] = c.b * 36; img.data[o + 3] = 255;
              }
            }
          }
          ctx.putImageData(img, 0, 0);
          var at = -1;
          for (var k = 0; k < sheet.length; k++)
            if (sheet[k].char === st.sess.tile) { at = k; break; }
          if (at >= 0) {
            ctx.strokeStyle = "rgba(255,149,64,0.95)";
            ctx.strokeRect((at % SCR_TILES_PER_ROW) * 8 + 0.5,
                           Math.floor(at / SCR_TILES_PER_ROW) * 8 + 0.5, 7, 7);
          }
        } catch (e) { /* a canvas that cannot draw still leaves it clickable */ }
      }

      function drawTileEdit() {
        var st = state();
        var canvas = studio.$("scr-tileedit");
        if (!st || !canvas) return;
        var tile = st.pic.tiles[st.sess.tile];
        var ctx = canvas.getContext("2d");
        if (!ctx) return;
        var SCALE = 8;
        for (var y = 0; y < 8; y++) {
          for (var x = 0; x < 8; x++) {
            var v = tile ? tile.pixels[y * 8 + x] : 0;
            ctx.fillStyle = css(entryColour(st.pic,
              tile ? tile.palette : 0, v));
            ctx.fillRect(x * SCALE, y * SCALE, SCALE, SCALE);
          }
        }
        ctx.strokeStyle = "rgba(255,255,255,0.18)";
        for (var i = 1; i < 8; i++) {
          ctx.beginPath();
          ctx.moveTo(i * SCALE + 0.5, 0); ctx.lineTo(i * SCALE + 0.5, 64);
          ctx.moveTo(0, i * SCALE + 0.5); ctx.lineTo(64, i * SCALE + 0.5);
          ctx.stroke();
        }
      }

      function drawPalette() {
        var st = state();
        var host = studio.$("scr-palette");
        if (!st || !host) return;
        while (host.firstChild) host.removeChild(host.firstChild);
        var palette = sc.tilePalette(st.sess, st.sess.tile);
        for (var e = 0; e < ed.ENTRIES; e++) {
          (function (entry) {
            var sw = studio.document.createElement("span");
            sw.className = "sw" + (entry === 0 ? " entry0" : "") +
              (entry === st.sess.colour ? " is-on" : "");
            sw.style.background = css(entryColour(st.pic, palette, entry));
            sw.title = "colour " + entry +
              (entry === 0 ? " (the shared backdrop)" : "");
            sw.addEventListener("click", function () {
              try {
                sc.selectColour(st.sess, entry);
                dirty = true;
                drawEditor();
              } catch (err) { fail(err); }
            });
            host.appendChild(sw);
          })(e);
        }
        if (studio.$("scr-palno"))
          studio.$("scr-palno").textContent = String(palette);
      }

      /* ---- the tool row, the zoom and the footers ----------------------- */
      function toolButtons() {
        var host = studio.$("scr-tools");
        if (!host || host.children.length || !sc) return;
        for (var i = 0; i < sc.TOOLS.length; i++) {
          (function (tool) {
            var b = studio.document.createElement("button");
            b.type = "button";
            b.id = "scr-tool-" + tool.id;
            b.className = "scr-tool";
            b.title = tool.title;
            var label = studio.document.createElement("span");
            label.textContent = tool.label;
            b.appendChild(label);
            var k = studio.document.createElement("kbd");
            k.textContent = tool.key;
            b.appendChild(k);
            b.addEventListener("click", function () { setTool(tool.id); });
            host.appendChild(b);
          })(sc.TOOLS[i]);
        }
      }

      function zoomButtons() {
        var host = studio.$("scr-zooms");
        if (!host || host.children.length || !sc) return;
        for (var i = 0; i < sc.ZOOMS.length; i++) {
          (function (zoom) {
            var b = studio.document.createElement("button");
            b.type = "button";
            b.id = "scr-zoom-" + zoom;
            b.className = "scr-zoom";
            b.textContent = zoom === "fit" ? "FIT" :
              zoom.toUpperCase().replace("X", "×");
            b.title = "Zoom " + (zoom === "fit" ? "to the panel" : zoom);
            b.addEventListener("click", function () { setZoom(zoom); });
            host.appendChild(b);
          })(sc.ZOOMS[i]);
        }
      }

      /* The map-size dropdown lists the VDC's six MWR sizes; anything but
       * $00 refuses with the model's own `map-size` (part B). */
      function mapSizeOptions() {
        var sel = studio.$("scr-mapsize");
        if (!sel || String(sel.tagName).toUpperCase() !== "SELECT" ||
            sel.children.length || !sc) return;
        for (var i = 0; i < sc.MAP_SIZES.length; i++) {
          var size = sc.MAP_SIZES[i];
          var o = studio.document.createElement("option");
          o.value = String(size.mwr);
          o.textContent = size.width + " × " + size.height;
          sel.appendChild(o);
        }
      }

      function videoOptions() {
        var sel = studio.$("scr-video");
        if (!sel || String(sel.tagName).toUpperCase() !== "SELECT" ||
            sel.children.length || !sc) return;
        for (var i = 0; i < sc.VIDEO_WIDTHS.length; i++) {
          var w = sc.VIDEO_WIDTHS[i];
          var o = studio.document.createElement("option");
          o.value = String(w);
          o.textContent = w + " dots";
          sel.appendChild(o);
        }
      }

      function setMapSize(mwr) {
        var st = state();
        if (!st) return;
        try {
          sc.setMapSize(st.pic, mwr);
          error = "";
        } catch (e) { fail(e); }
        dirty = true;
        drawEditor();
      }

      function setVideo(width) {
        var st = state();
        if (!st) return;
        try {
          sc.setVideoWidth(st.pic, width);
          if (!commit().length) { dirty = true; drawEditor(); }
        } catch (e) { fail(e); dirty = true; drawEditor(); }
      }

      function setTool(id) {
        var st = state();
        if (!st) return;
        try {
          sc.setTool(st.sess, id);
          dirty = true;
          drawEditor();
        } catch (e) { fail(e); }
      }

      function setZoom(id) {
        var st = state();
        if (!st) return;
        try {
          sc.setZoom(st.sess, id);
          dirty = true;
          drawEditor();
        } catch (e) { fail(e); }
      }

      function toggleGrid(on) {
        var st = state();
        if (!st) return;
        sc.toggleGrid(st.sess, on);
        dirty = true;
        drawEditor();
      }

      function selectChar(ch) {
        var st = state();
        if (!st) return;
        try {
          sc.selectTile(st.sess, ch);
          dirty = true;
          drawEditor();
        } catch (e) { fail(e); }
      }

      function newTile() {
        var st = state();
        if (!st) return;
        try {
          var ch = ed.newTile(st.pic, sc.tilePalette(st.sess, st.sess.tile));
          sc.selectTile(st.sess, ch);
          commit();
        } catch (e) { fail(e); }
      }

      function scroll(dx, dy) {
        var st = state();
        if (!st) return;
        try {
          ed.setScroll(st.pic, {
            BXR: st.pic.scroll.BXR + dx, BYR: st.pic.scroll.BYR + dy
          });
          commit();
        } catch (e) { fail(e); }
      }

      /* One place that draws all of it, gated so the play loop's per-frame
       * panel refresh does not repaint 65,536 pixels. */
      function drawEditor(force) {
        if (!ready()) return;
        if (!force && !dirty) { drawFoot(); return; }
        var st = state();
        if (!st) return;
        dirty = false;
        toolButtons();
        zoomButtons();
        mapSizeOptions();
        videoOptions();
        if (studio.$("scr-grid"))
          studio.$("scr-grid").checked = st.sess.grid;
        for (var i = 0; i < sc.TOOLS.length; i++) {
          var b = studio.$("scr-tool-" + sc.TOOLS[i].id);
          if (b) b.classList.toggle("is-on", st.sess.tool === sc.TOOLS[i].id);
        }
        for (var z = 0; z < sc.ZOOMS.length; z++) {
          var zb = studio.$("scr-zoom-" + sc.ZOOMS[z]);
          if (zb) zb.classList.toggle("is-on", st.sess.zoom === sc.ZOOMS[z]);
        }
        drawMap();
        drawTiles();
        drawTileEdit();
        drawPalette();
        var sheet = sc.tileSheet(st.pic);
        if (studio.$("scr-tile")) {
          studio.$("scr-tile").textContent =
            "$" + st.sess.tile.toString(16).toUpperCase();
        }
        if (studio.$("scr-tilerange")) {
          studio.$("scr-tilerange").textContent = sheet.length +
            (sheet.length === 1 ? " tile" : " tiles");
        }
        if (studio.$("scr-charbase")) {
          studio.$("scr-charbase").textContent =
            "$" + (st.sess.tile * 16).toString(16).toUpperCase();
        }
        if (studio.$("scr-bxr"))
          studio.$("scr-bxr").textContent = String(st.pic.scroll.BXR);
        if (studio.$("scr-byr"))
          studio.$("scr-byr").textContent = String(st.pic.scroll.BYR);
        var size = sc.readMapSize(st.pic);
        if (studio.$("scr-mapsize"))
          studio.$("scr-mapsize").value = String(size.mwr);
        if (studio.$("scr-mwr")) {
          studio.$("scr-mwr").textContent = "$" + size.mwr.toString(16)
            .toUpperCase().padStart(2, "0");
        }
        var video = sc.readVideoWidth(st.pic);
        if (studio.$("scr-video"))
          studio.$("scr-video").value = String(video);
        if (studio.$("scr-video-note")) {
          var res = studio.render.resolutionFor(
            video === 336 ? 1 : video === 512 ? 2 : 0);
          studio.$("scr-video-note").textContent = res.label + " · " +
            ["5.37", "7.16", "10.74"][res.dotClock] + " MHz";
        }
        drawFoot();
      }

      function drawFoot() {
        var st = pic && sess ? { pic: pic, sess: sess } : null;
        var foot = studio.$("scr-foot"), pick = studio.$("scr-pick");
        if (foot) {
          foot.textContent =
            "32 × 32 cells · faint white = visible screen";
        }
        if (!pick) return;
        if (error) { pick.textContent = error; return; }
        if (!st) {
          pick.textContent = "Click or drag to select · Select first cell";
          return;
        }
        var r = st.sess.dragRect || st.sess.selection;
        if (r) {
          var n = sc.cellCount(r);
          pick.textContent = (st.sess.dragRect ? "dragging · " : "selected · ") +
            (r.x1 - r.x0 + 1) + " × " + (r.y1 - r.y0 + 1) + " = " + n +
            " cell" + (n === 1 ? "" : "s") + " · (" + r.x0 + "," + r.y0 + ")";
        } else {
          pick.textContent = "Click or drag to select · Select first cell";
        }
      }

      /* ---- the pointer and the keys ------------------------------------- */
      function cellAt(ev, elem) {
        var r = elem.getBoundingClientRect();
        var w = r.width || elem.width || 256;
        var h = r.height || elem.height || 256;
        var x = Math.floor((ev.clientX - r.left) * sc.COLS / w);
        var y = Math.floor((ev.clientY - r.top) * sc.ROWS / h);
        return sc.clampCell(x, y);
      }

      /* press/drag/release from a DOM event, or from the evidence with a
       * plain {clientX, clientY} over the element's rect. */
      function pointer(kind, ev, elem) {
        var st = state();
        if (!st || !elem) return 0;
        var n = 0;
        try {
          var cell = cellAt(ev, elem);
          if (kind === "press") n = sc.press(st.sess, cell.x, cell.y);
          else if (kind === "drag") n = sc.drag(st.sess, cell.x, cell.y);
          else n = sc.release(st.sess, cell.x, cell.y);
          if (n) commit();
          else { dirty = true; drawEditor(); }
        } catch (e) { fail(e); }
        return n;
      }

      function tileAt(ev, elem) {
        var st = state();
        if (!st) return 0;
        var r = elem.getBoundingClientRect();
        var w = r.width || elem.width || 256;
        var h = r.height || elem.height || 8;
        var col = Math.floor((ev.clientX - r.left) * SCR_TILES_PER_ROW / w);
        var row = Math.floor((ev.clientY - r.top) *
                             (elem.height || 8) / (h * 8));
        var sheet = sc.tileSheet(st.pic);
        var at = row * SCR_TILES_PER_ROW + col;
        if (at < 0 || at >= sheet.length) return 0;
        selectChar(sheet[at].char);
        return sheet[at].char;
      }

      function tilePixelAt(ev, elem) {
        var st = state();
        if (!st) return 0;
        var r = elem.getBoundingClientRect();
        var w = r.width || 64, h = r.height || 64;
        var x = Math.floor((ev.clientX - r.left) * 8 / w);
        var y = Math.floor((ev.clientY - r.top) * 8 / h);
        try {
          sc.paintTilePixel(st.sess, Math.max(0, Math.min(7, x)),
                            Math.max(0, Math.min(7, y)));
          commit();
          return 1;
        } catch (e) { fail(e); return 0; }
      }

      /* press/drag/release at cell coordinates — the same calls the DOM
       * handlers make, for the evidence. */
      function pressRelease(kind, x, y) {
        var st = state();
        if (!st) return 0;
        var n = 0;
        try {
          var cell = sc.clampCell(x, y);
          if (kind === "press") n = sc.press(st.sess, cell.x, cell.y);
          else if (kind === "drag") n = sc.drag(st.sess, cell.x, cell.y);
          else n = sc.release(st.sess, cell.x, cell.y);
          if (n) commit();
          else { dirty = true; drawEditor(); }
        } catch (e) { fail(e); }
        return n;
      }

      function key(ev) {
        var st = state();
        if (!st) return false;
        var k = ev.key ? ev.key.toLowerCase() : "";
        for (var i = 0; i < sc.TOOLS.length; i++) {
          if (sc.TOOLS[i].key.toLowerCase() === k) {
            setTool(sc.TOOLS[i].id);
            return true;
          }
        }
        if (k === "#") { toggleGrid(); return true; }
        return false;
      }

      /* The curve buttons: ppu.toys' keyframed curve beside each offset.  The
       * keyframes are #79's register pokes, so the button says so instead of
       * pretending to edit one. */
      function curve(reg) {
        studio.toast(reg + " curve: keyframed register pokes are card #79.");
      }

      function bind() {
        if (!ready()) return;
        var map = studio.$("scr-map");
        if (map) {
          map.addEventListener("mousedown", function (ev) {
            pointer("press", ev, map); ev.preventDefault();
          });
          map.addEventListener("mousemove", function (ev) {
            if (sess && sess.dragging) pointer("drag", ev, map);
          });
          map.addEventListener("mouseup", function (ev) {
            pointer("release", ev, map); ev.preventDefault();
          });
          map.addEventListener("mouseleave", function (ev) {
            if (sess && sess.dragging) pointer("release", ev, map);
          });
          map.addEventListener("keydown", function (ev) {
            /* The map's own keys stop here: R would otherwise also restart
             * the toy through the page-wide shortcut. */
            if (key(ev)) { ev.preventDefault(); ev.stopPropagation(); }
          });
        }
        var tiles = studio.$("scr-tiles");
        if (tiles) tiles.addEventListener("click", function (ev) {
          tileAt(ev, tiles);
        });
        var tileedit = studio.$("scr-tileedit");
        if (tileedit) tileedit.addEventListener("mousedown", function (ev) {
          tilePixelAt(ev, tileedit); ev.preventDefault();
        });
        if (studio.$("scr-grid"))
          studio.$("scr-grid").addEventListener("change", function () {
            toggleGrid(studio.$("scr-grid").checked);
          });
        if (studio.$("scr-newtile"))
          studio.$("scr-newtile").addEventListener("click", newTile);
        if (studio.$("scr-bxr-down"))
          studio.$("scr-bxr-down").addEventListener("click", function () {
            scroll(-1, 0);
          });
        if (studio.$("scr-bxr-up"))
          studio.$("scr-bxr-up").addEventListener("click", function () {
            scroll(1, 0);
          });
        if (studio.$("scr-byr-down"))
          studio.$("scr-byr-down").addEventListener("click", function () {
            scroll(0, -1);
          });
        if (studio.$("scr-byr-up"))
          studio.$("scr-byr-up").addEventListener("click", function () {
            scroll(0, 1);
          });
        if (studio.$("scr-bxr-curve"))
          studio.$("scr-bxr-curve").addEventListener("click", function () {
            curve("BXR");
          });
        if (studio.$("scr-byr-curve"))
          studio.$("scr-byr-curve").addEventListener("click", function () {
            curve("BYR");
          });
        if (studio.$("scr-mapsize"))
          studio.$("scr-mapsize").addEventListener("change", function () {
            setMapSize(Number(studio.$("scr-mapsize").value));
          });
        if (studio.$("scr-video"))
          studio.$("scr-video").addEventListener("change", function () {
            setVideo(Number(studio.$("scr-video").value));
          });
      }

      /* ---- the frame summary and the follow readout (from the toy) ------- */
      function draw(st) {
        drawEditor();
        if (!st) {
          if (studio.$("screen-summary")) {
            studio.$("screen-summary").textContent = error || "no frame yet";
          }
          return;
        }
        if (!P.panels) return;
        var line = studio.render.panelLine(st);
        var v = P.panels.lineValues(st, line);
        studio.$("screen-summary").textContent =
          "VDW line " + v.line + " · BXR " + v.BXR + " · BYR " + v.BYR +
          " · CR " + studio.hex(v.CR, 2) + " · BG_YOffset " + v.BG_YOffset +
          "\nBAT " + st.geom.width + "×" + st.geom.height + " (MWR " +
          studio.hex((st.regs.MWR || 0) & 0xFF, 2) + ") · " + st.width + "×" +
          st.height + " · frame " + Math.max(0, studio.render.currentFrame());
        var follow = studio.follow();
        if (!follow) {
          studio.$("follow-info").textContent =
            "Click the output to follow a pixel: the layer that won, its BAT " +
            "entry or sprite, and the register values on that line.";
          return;
        }
        var t;
        try { t = P.panels.followPixel(st, follow.x, follow.y); }
        catch (e) {
          studio.$("follow-info").textContent = e.message;
          return;
        }
        var out = "pixel (" + t.x + "," + t.y + ") · VDW line " + t.line +
                  " · winner: " + t.layer + "\n";
        out += "colour index " + studio.hex(t.index, 2) + " · CRAM word " +
          studio.hex(t.colour.word, 4) + " · rgb(" + t.colour.r + "," +
          t.colour.g + "," + t.colour.b + ")\n";
        var b = t.background || {};
        if (b.blanking) out += "background: blanking fill (BB clear)\n";
        else {
          out += "BAT word " + b.batIndex + " = " + studio.hex(b.batWord, 4) +
            " · char " + studio.hex(b.char, 3) + " · palette " + b.palette +
            " · tile row " + b.tileRow + " col " + b.tileColumn +
            " · colour " + b.colourNumber + "\n";
        }
        if (t.sprite) {
          out += "sprite " + t.sprite.number + " · pattern " +
            studio.hex(t.sprite.pattern, 3) + " · palette " +
            t.sprite.palette + " · colour " + t.sprite.colourNumber +
            " · cell " + t.sprite.cell + "\n";
        }
        var r = t.registers;
        out += "line registers: BXR " + r.BXR + " · BYR " + r.BYR + " · CR " +
          studio.hex(r.CR, 2) + " · MWR " + studio.hex(r.MWR, 2);
        studio.$("follow-info").textContent = out;
      }

      /* ---- what the page's evidence API reads --------------------------- */
      function summary() {
        var st = state();
        if (!st) return null;
        var colour = st.sess.colour;
        return {
          tool: st.sess.tool, zoom: st.sess.zoom, grid: st.sess.grid,
          tile: st.sess.tile, colour: colour,
          palette: sc.tilePalette(st.sess, st.sess.tile),
          selection: st.sess.selection,
          scroll: { BXR: st.pic.scroll.BXR, BYR: st.pic.scroll.BYR },
          tiles: sc.tileSheet(st.pic).length,
          mapSize: sc.readMapSize(st.pic),
          video: sc.readVideoWidth(st.pic),
          error: error,
          cell: function (x, y) { return ed.mapCell(st.pic, x, y); },
          pixels: function () { return ed.tilePixels(st.pic, st.sess.tile); },
          colours: function () {
            return ed.paletteColours(st.pic,
              sc.tilePalette(st.sess, st.sess.tile));
          }
        };
      }

      var api = {
        state: summary,
        session: function () { return sess; },
        picture: function () { return pic; },
        frame: function () { return sess && pic ? sc.frame(pic) : null; },
        setTool: setTool,
        setZoom: setZoom,
        toggleGrid: toggleGrid,
        selectChar: selectChar,
        selectColour: function (n) {
          var st = state();
          if (!st) return null;
          sc.selectColour(st.sess, n);
          dirty = true; drawEditor();
          return st.sess.colour;
        },
        newTile: newTile,
        scroll: scroll,
        paintTilePixel: function (x, y) {
          var st = state();
          if (!st) return 0;
          sc.paintTilePixel(st.sess, x, y);
          return commit().length;
        },
        press: function (x, y) { return pressRelease("press", x, y); },
        drag: function (x, y) { return pressRelease("drag", x, y); },
        release: function (x, y) { return pressRelease("release", x, y); },
        click: function (x, y) {
          var n = pressRelease("press", x, y);
          n += pressRelease("release", x, y);
          return n;
        },
        cellAt: function (x, y) { return state() && sc.clampCell(x, y); },
        pointer: function (kind, ev, elem) {
          return pointer(kind, ev, elem || studio.$("scr-map"));
        },
        canvas: function () {
          return { map: studio.$("scr-map").width,
                   tiles: studio.$("scr-tiles").height };
        },
        drawn: function () {
          return !!studio.$("scr-foot") &&
                 !!studio.$("scr-foot").textContent;
        },
        invalidate: invalidate
      };

      /* An asset file edited by hand or through the evidence is what this
       * panel draws next. */
      studio.toy.onAssetEdit(invalidate);
      bind();

      studio.panels.register({
        id: "screen",
        label: "SCREEN",
        group: "chip",
        chapter: "registers",
        gloss: "The tile layer: BAT size, scroll, and which layer won a pixel.",
        draw: draw,
        api: api
      });
    }
  });
})(typeof self !== "undefined" ? self : this);
