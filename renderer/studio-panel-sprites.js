/*
 * studio-panel-sprites.js — the SPRITES panel (card #86, part C), a module of
 * the studio since #102.
 *
 * ppu.toys' SPRITES is the working example; this is its PCE counterpart.
 * renderer/pce-sat.js is the model (the SAT's slots, the pattern tools, the
 * asset files) and renderer/pce-editor.js is the picture it edits; this file
 * is the panel: the screen, the 64-slot grid, the pattern sheet and pattern
 * canvas, the picker's fields and the chrome.  It has no second picture —
 * every pixel it draws is pce-editor.js's renderPreview, the same renderer as
 * the output column.
 *
 * The panel talks to the page only through the studio API passed to
 * register(studio): the toy's files (studio.toy) and its sprite write-back,
 * the frame (studio.render), toast/$, and panel-dirty.  docs/STUDIO.md §3.3.
 */
(function (root) {
  "use strict";
  var P = root.PCEStudio = root.PCEStudio || {};
  P.studioPanelModules = P.studioPanelModules || [];

  P.studioPanelModules.push({
    id: "sprites",
    register: function (studio) {
      var sat = P.sat, ed = P.editor;
      var pic = null;              /* the picture the assets make */
      var sess = null;             /* the editing session over it */
      var error = "";
      var dirty = true;

      var SLOT_COLS = 8;           /* the 64 slots as an 8x8 grid */
      var SLOT_PX = 24;            /* one slot's cell, in canvas pixels */
      var SHEET_PER_ROW = 8;       /* the pattern sheet's columns */

      /* ---- the model's state -------------------------------------------- */
      function ready() { return !!(sat && ed); }

      function state() {
        if (pic && sess) return { pic: pic, sess: sess };
        if (!ready()) return null;
        try {
          pic = sat.pictureFromFiles(studio.toy.files());
          error = "";
        } catch (e) {
          error = (e.code ? e.code + ": " : "") + e.message;
          pic = ed.newPicture();
        }
        sess = sat.session(pic);
        dirty = true;
        return { pic: pic, sess: sess };
      }

      function invalidate() {
        pic = null;
        sess = null;
        dirty = true;
      }

      function fail(e) {
        error = (e && e.code ? e.code + ": " : "") +
                (e && e.message ? e.message : e);
        var el = studio.$("spr-note");
        if (el) el.textContent = error;
        studio.toast(error);
      }

      /* The sprite palettes' colours are CRAM words: 3 bits each of G, R, B. */
      function css(colour) {
        var c = ed.colourChannels(colour);
        return "rgb(" + (c.r * 36) + "," + (c.g * 36) + "," + (c.b * 36) + ")";
      }

      function spriteColour(p, palette, index) {
        /* index 0 is transparent on a sprite: the panel draws it as the
         * backdrop so the shape reads, and says so in the palette tooltip */
        if (!index) return p.backdrop;
        return p.spritePalettes[palette][index];
      }

      function commit() {
        if (!pic || !sat) return [];
        var changed = [];
        try {
          changed = studio.toy.writeSpritesAssets
            ? studio.toy.writeSpritesAssets(pic)
            : sat.syncFiles(pic, studio.toy.files());
        } catch (e) { fail(e); return []; }
        dirty = true;
        drawEditor();
        return changed;
      }

      function current() {
        var st = state();
        if (!st || st.sess.sprite < 0) return null;
        return st.pic.sprites[st.sess.sprite] || null;
      }

      function zoomOf() {
        if (!sess) return 2;
        return sess.zoom === "fit" ? 2 :
          Number(String(sess.zoom).replace("x", "")) || 1;
      }

      /* ---- the screen: the picture, the selected sprite outlined --------- */
      function drawScreen() {
        var st = state();
        var canvas = studio.$("spr-screen");
        if (!st || !canvas) return;
        var frame;
        try { frame = sat.frame(st.pic); }
        catch (e) { fail(e); return; }
        var scale = zoomOf();
        canvas.width = frame.width * scale;
        canvas.height = frame.height * scale;
        canvas.style.width = canvas.width + "px";
        canvas.style.height = canvas.height + "px";
        var ctx = canvas.getContext("2d");
        if (!ctx) return;
        try {
          var off = studio.document.createElement("canvas");
          off.width = frame.width; off.height = frame.height;
          var octx = off.getContext("2d");
          var img = octx.createImageData(frame.width, frame.height);
          img.data.set(frame.pixels);
          octx.putImageData(img, 0, 0);
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
        } catch (e) { /* a canvas that cannot draw stays selectable */ }

        /* The selected sprite's box and its SAT number, as ppu.toys labels
         * the selected object on the screen. */
        var s = current();
        if (!s) return;
        var size = sat.patternSize(st.pic, s.pattern);
        if (!size) return;
        var x = s.x * scale, y = s.y * scale;
        var w = size.width * scale, h = size.height * scale;
        if (s.y >= sat.PARK_ROW) {
          ctx.fillStyle = "rgba(255,149,64,0.95)";
          ctx.font = "10px monospace";
          ctx.fillText("#" + st.sess.sprite + " off-screen (row " +
                       sat.PARK_ROW + ")", 4, 12);
          return;
        }
        ctx.strokeStyle = "rgba(255,149,64,0.95)";
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(x + 0.5, y + 0.5, Math.max(1, w - 1), Math.max(1, h - 1));
        ctx.setLineDash([]);
        ctx.fillStyle = "rgba(255,149,64,0.95)";
        ctx.font = "10px monospace";
        ctx.fillText("#" + st.sess.sprite, x + 2, Math.max(9, y - 2));
      }

      /* ---- the 64 slots -------------------------------------------------- */
      function drawSlots() {
        var st = state();
        var canvas = studio.$("spr-slots");
        if (!st || !canvas) return;
        canvas.width = SLOT_COLS * SLOT_PX;
        canvas.height = SLOT_COLS * SLOT_PX;
        canvas.style.width = canvas.width + "px";
        canvas.style.height = canvas.height + "px";
        var ctx = canvas.getContext("2d");
        if (!ctx) return;
        var list = sat.slots(st.pic);
        for (var i = 0; i < list.length; i++) {
          var s = list[i];
          var cx = (i % SLOT_COLS) * SLOT_PX;
          var cy = Math.floor(i / SLOT_COLS) * SLOT_PX;
          var on = i === st.sess.sprite;
          ctx.fillStyle = s.empty ? "rgba(255,255,255,0.03)"
                        : s.parked ? "rgba(255,149,64,0.12)"
                        : "rgba(95,201,232,0.16)";
          ctx.fillRect(cx + 1, cy + 1, SLOT_PX - 2, SLOT_PX - 2);
          if (s.dropped) {
            ctx.fillStyle = "rgba(224,80,80,0.22)";
            ctx.fillRect(cx + 1, cy + 1, SLOT_PX - 2, SLOT_PX - 2);
          }
          ctx.strokeStyle = on ? "rgba(255,149,64,0.95)"
                            : "rgba(255,255,255,0.14)";
          ctx.strokeRect(cx + 1.5, cy + 1.5, SLOT_PX - 3, SLOT_PX - 3);
          ctx.fillStyle = s.empty ? "rgba(255,255,255,0.30)"
                                  : "rgba(255,255,255,0.85)";
          ctx.font = "9px monospace";
          ctx.fillText(String(i), cx + 3, cy + 12);
          if (!s.empty) {
            ctx.fillStyle = "rgba(255,255,255,0.55)";
            ctx.fillText(s.width + "x" + s.height, cx + 3, cy + 21);
          }
        }
      }

      /* ---- the pattern sheet and the pattern canvas ---------------------- */
      function drawSheet() {
        var st = state();
        var canvas = studio.$("spr-sheet");
        if (!st || !canvas) return;
        /* Every pattern in the sheet, drawn at its own size, in rows of
         * eight with a 2-px gap; the selected one is ringed. */
        var sheet = sat.patternSheet(st.pic);
        canvas.width = 256;
        canvas.height = 32;
        canvas.style.width = "256px";
        canvas.style.height = "32px";
        var ctx = canvas.getContext("2d");
        if (!ctx) return;
        var x = 0, y = 0, rowH = 0, at = null;
        var placed = [];
        for (var i = 0; i < sheet.length; i++) {
          var pat = sheet[i];
          if (x + pat.width > 256) { x = 0; y += rowH + 2; rowH = 0; }
          if (y + pat.height > canvas.height) break;
          placed.push({ at: i, x: x, y: y, w: pat.width, h: pat.height });
          var size = sat.patternSize(st.pic, i);
          var px = ed.spritePatternPixels(st.pic, i);
          var pal = current() ? current().palette : 0;
          for (var py = 0; py < size.height && py < 32; py++) {
            for (var pxx = 0; pxx < size.width; pxx++) {
              var v = px[py * size.width + pxx];
              ctx.fillStyle = v ? css(spriteColour(st.pic, pal, v))
                                : "rgba(0,0,0,0.55)";
              ctx.fillRect(x + pxx, y + py, 1, 1);
            }
          }
          ctx.strokeStyle = i === st.sess.pattern ? "rgba(255,149,64,0.95)"
                                                  : "rgba(255,255,255,0.18)";
          ctx.strokeRect(x + 0.5, y + 0.5, pat.width - 1, pat.height - 1);
          if (i === st.sess.pattern) at = i;
          x += pat.width + 2;
          rowH = Math.max(rowH, pat.height);
        }
        canvas.__sheetPlaced = placed;
        canvas.__sheetAt = at;
      }

      function drawPattern() {
        var st = state();
        var canvas = studio.$("spr-pattern");
        if (!st || !canvas) return;
        var size = sat.patternSize(st.pic, st.sess.pattern);
        var ctx = canvas.getContext("2d");
        if (!ctx) return;
        if (!size) {
          canvas.width = 16; canvas.height = 16;
          canvas.style.width = canvas.style.height = "16px";
          ctx.fillStyle = "#000";
          ctx.fillRect(0, 0, 16, 16);
          return;
        }
        /* Whatever the size, the canvas fits a 256-px column. */
        var scale = Math.max(1, Math.min(8, Math.floor(256 / size.width),
                                        Math.floor(256 / size.height)));
        canvas.width = size.width * scale;
        canvas.height = size.height * scale;
        canvas.style.width = canvas.width + "px";
        canvas.style.height = canvas.height + "px";
        var px = ed.spritePatternPixels(st.pic, st.sess.pattern);
        var pal = current() ? current().palette : 0;
        for (var y = 0; y < size.height; y++) {
          for (var x = 0; x < size.width; x++) {
            var v = px[y * size.width + x];
            ctx.fillStyle = v ? css(spriteColour(st.pic, pal, v))
                              : "rgba(8,9,12,0.9)";
            ctx.fillRect(x * scale, y * scale, scale, scale);
          }
        }
        if (st.sess.grid) {
          ctx.strokeStyle = "rgba(255,255,255,0.13)";
          ctx.lineWidth = 1;
          for (var i = 1; i < size.width; i++) {
            var at = Math.round(i * scale) + 0.5;
            ctx.beginPath();
            ctx.moveTo(at, 0); ctx.lineTo(at, canvas.height);
            ctx.stroke();
          }
          for (var j = 1; j < size.height; j++) {
            var aty = Math.round(j * scale) + 0.5;
            ctx.beginPath();
            ctx.moveTo(0, aty); ctx.lineTo(canvas.width, aty);
            ctx.stroke();
          }
        }
        var r = st.sess.dragRect || st.sess.selection;
        if (r) {
          ctx.strokeStyle = st.sess.dragRect ? "rgba(95,201,232,0.9)"
                                             : "rgba(95,201,232,0.55)";
          ctx.setLineDash(st.sess.dragRect ? [4, 3] : []);
          ctx.strokeRect(r.x0 * scale + 0.5, r.y0 * scale + 0.5,
                         (r.x1 - r.x0 + 1) * scale - 1,
                         (r.y1 - r.y0 + 1) * scale - 1);
          ctx.setLineDash([]);
        }
        canvas.__scale = scale;
      }

      /* ---- the sprite palette strip -------------------------------------- */
      function drawPalette() {
        var st = state();
        var host = studio.$("spr-palette");
        if (!st || !host) return;
        while (host.firstChild) host.removeChild(host.firstChild);
        var s = current();
        var palette = s ? s.palette : 0;
        for (var e = 0; e < sat.ENTRIES; e++) {
          (function (entry) {
            var sw = studio.document.createElement("span");
            sw.className = "spr-sw" + (entry === 0 ? " entry0" : "") +
              (entry === st.sess.colour ? " is-on" : "");
            sw.style.background = entry === 0 ? "transparent"
              : css(st.pic.spritePalettes[palette][entry]);
            sw.title = "colour " + entry +
              (entry === 0 ? " (transparent on a sprite)" :
               " (sprite palette " + palette + ", CRAM $" +
               (0x100 + palette * 16 + entry).toString(16).toUpperCase() + ")");
            sw.addEventListener("click", function () {
              try {
                sat.selectColour(st.sess, entry);
                dirty = true; drawEditor();
              } catch (err) { fail(err); }
            });
            host.appendChild(sw);
          })(e);
        }
      }

      /* ---- the chrome ----------------------------------------------------- */
      function toolButtons() {
        var host = studio.$("spr-tools");
        if (!host || host.children.length || !sat) return;
        for (var i = 0; i < sat.TOOLS.length; i++) {
          (function (tool) {
            var b = studio.document.createElement("button");
            b.type = "button";
            b.id = "spr-tool-" + tool.id;
            b.className = "scr-tool spr-tool";
            b.title = tool.title;
            var label = studio.document.createElement("span");
            label.textContent = tool.label;
            b.appendChild(label);
            var k = studio.document.createElement("kbd");
            k.textContent = tool.key;
            b.appendChild(k);
            b.addEventListener("click", function () { setTool(tool.id); });
            host.appendChild(b);
          })(sat.TOOLS[i]);
        }
      }

      function zoomButtons() {
        var host = studio.$("spr-zooms");
        if (!host || host.children.length || !sat) return;
        for (var i = 0; i < sat.ZOOMS.length; i++) {
          (function (zoom) {
            var b = studio.document.createElement("button");
            b.type = "button";
            b.id = "spr-zoom-" + zoom;
            b.className = "scr-zoom spr-zoom";
            b.textContent = zoom === "fit" ? "FIT" :
              zoom.toUpperCase().replace("X", "×");
            b.title = "Zoom " + (zoom === "fit" ? "2× (the panel's fit)" : zoom);
            b.addEventListener("click", function () { setZoom(zoom); });
            host.appendChild(b);
          })(sat.ZOOMS[i]);
        }
      }

      /* The six sizes the VDC draws, for + PATTERN. */
      function sizeOptions() {
        var sel = studio.$("spr-newsize");
        if (!sel || String(sel.tagName).toUpperCase() !== "SELECT" ||
            sel.children.length || !sat) return;
        for (var i = 0; i < sat.SIZES.length; i++) {
          var o = studio.document.createElement("option");
          o.value = sat.SIZES[i].width + "x" + sat.SIZES[i].height;
          o.textContent = sat.SIZES[i].width + " × " + sat.SIZES[i].height;
          sel.appendChild(o);
        }
      }

      function paletteOptions() {
        var sel = studio.$("spr-palpick");
        if (!sel || String(sel.tagName).toUpperCase() !== "SELECT" ||
            sel.children.length || !sat) return;
        for (var i = 0; i < sat.SPRITE_PALETTES; i++) (function (n) {
          var o = studio.document.createElement("option");
          o.value = String(n);
          o.textContent = String(n);
          sel.appendChild(o);
        })(i);
      }

      function patternOptions() {
        var sel = studio.$("spr-patpick");
        var st = state();
        if (!sel || String(sel.tagName).toUpperCase() !== "SELECT" || !st)
          return;
        while (sel.firstChild) sel.removeChild(sel.firstChild);
        var sheet = sat.patternSheet(st.pic);
        for (var i = 0; i < sheet.length; i++) {
          var o = studio.document.createElement("option");
          o.value = String(i);
          o.textContent = i + ": " + sheet[i].width + "×" + sheet[i].height;
          sel.appendChild(o);
        }
      }

      function setTool(id) {
        var st = state();
        if (!st) return;
        try { sat.setTool(st.sess, id); }
        catch (e) { fail(e); }
        dirty = true; drawEditor();
      }

      function setZoom(id) {
        var st = state();
        if (!st) return;
        try { sat.setZoom(st.sess, id); }
        catch (e) { fail(e); }
        dirty = true; drawEditor();
      }

      function toggleGrid(on) {
        var st = state();
        if (!st) return;
        sat.toggleGrid(st.sess, on);
        dirty = true; drawEditor();
      }

      function selectSlot(i) {
        var st = state();
        if (!st) return -1;
        try {
          sat.selectSlot(st.sess, i);
          commit();
        } catch (e) { fail(e); }
        dirty = true; drawEditor();
        return st.sess.sprite;
      }

      function step(delta) {
        var st = state();
        if (!st) return -1;
        try {
          sat.step(st.sess, delta);
          commit();
        } catch (e) { fail(e); }
        dirty = true; drawEditor();
        return st.sess.sprite;
      }

      function setField(field, value) {
        var st = state();
        if (!st) return null;
        try { sat.setField(st.sess, field, value); commit(); }
        catch (e) { fail(e); dirty = true; drawEditor(); }
        return current();
      }

      function nudge(field, delta) {
        var st = state();
        if (!st) return null;
        try { sat.nudge(st.sess, field, delta); commit(); }
        catch (e) { fail(e); dirty = true; drawEditor(); }
        return current();
      }

      function releasePosition() {
        var st = state();
        if (!st) return null;
        var out = null;
        try { out = sat.releasePosition(st.sess); commit(); }
        catch (e) { fail(e); dirty = true; drawEditor(); }
        return out;
      }

      function park() {
        var st = state();
        if (!st) return null;
        try {
          sat.park(st.sess);
          commit();
          studio.toast("sprite " + st.sess.sprite + " is off-screen (the VDC " +
                       "has no per-sprite off switch)");
        } catch (e) { fail(e); dirty = true; drawEditor(); }
        return current();
      }

      function clearSlot() {
        var st = state();
        if (!st) return -1;
        try { sat.clearSlot(st.sess); commit(); }
        catch (e) { fail(e); dirty = true; drawEditor(); }
        return st.sess.sprite;
      }

      function newPattern() {
        var st = state();
        if (!st) return -1;
        var sel = studio.$("spr-newsize");
        var wh = (sel && sel.value ? String(sel.value) : "16x16")
          .split("x").map(Number);
        try {
          var i = sat.setPatternSize(st.sess, wh[0], wh[1]);
          commit();
          return i;
        } catch (e) { fail(e); dirty = true; drawEditor(); return -1; }
      }

      function selectPattern(i) {
        var st = state();
        if (!st) return -1;
        try { sat.selectPattern(st.sess, i); }
        catch (e) { fail(e); }
        dirty = true; drawEditor();
        return st.sess.pattern;
      }

      /* ---- the pointer and the keys -------------------------------------- */
      function patternPixelAt(ev, elem) {
        var st = state();
        if (!st) return null;
        var size = sat.patternSize(st.pic, st.sess.pattern);
        if (!size) return null;
        var r = elem.getBoundingClientRect();
        var w = r.width || elem.width || 16;
        var h = r.height || elem.height || 16;
        var x = Math.floor((ev.clientX - r.left) * size.width / w);
        var y = Math.floor((ev.clientY - r.top) * size.height / h);
        return sat.clampPixel(st.sess, x, y);
      }

      function displayAt(ev, elem) {
        var st = state();
        if (!st) return null;
        var frame = sat.frame(st.pic);
        var scale = zoomOf();
        var r = elem.getBoundingClientRect();
        var w = r.width || frame.width * scale;
        var h = r.height || frame.height * scale;
        return { x: Math.floor((ev.clientX - r.left) * frame.width / w),
                 y: Math.floor((ev.clientY - r.top) * frame.height / h) };
      }

      function pointer(kind, ev, elem) {
        var st = state();
        if (!st || !elem) return 0;
        var n = 0;
        try {
          if (elem.id === "spr-screen") {
            var d = displayAt(ev, elem);
            if (!d) return 0;
            if (kind === "press") n = sat.screenPress(st.sess, d.x, d.y);
            else if (kind === "drag") n = sat.screenDrag(st.sess, d.x, d.y);
            else { sat.screenRelease(st.sess); n = 0; }
          } else {
            var p = patternPixelAt(ev, elem);
            if (!p) return 0;
            if (kind === "press") n = sat.press(st.sess, p.x, p.y);
            else if (kind === "drag") n = sat.drag(st.sess, p.x, p.y);
            else n = sat.release(st.sess, p.x, p.y);
          }
          if (n) commit();
          else { dirty = true; drawEditor(); }
        } catch (e) { fail(e); }
        return n;
      }

      function key(ev) {
        var st = state();
        if (!st) return false;
        var k = ev.key ? ev.key.toLowerCase() : "";
        for (var i = 0; i < sat.TOOLS.length; i++) {
          if (sat.TOOLS[i].key.toLowerCase() === k) {
            setTool(sat.TOOLS[i].id);
            return true;
          }
        }
        if (k === "#") { toggleGrid(); return true; }
        return false;
      }

      /* ---- one place that draws it all ----------------------------------- */
      function drawEditor(force) {
        if (!ready()) return;
        if (!force && !dirty) { drawText(); return; }
        var st = state();
        if (!st) return;
        dirty = false;
        toolButtons();
        zoomButtons();
        sizeOptions();
        paletteOptions();
        patternOptions();
        if (studio.$("spr-grid"))
          studio.$("spr-grid").checked = st.sess.grid;
        for (var i = 0; i < sat.TOOLS.length; i++) {
          var b = studio.$("spr-tool-" + sat.TOOLS[i].id);
          if (b) b.classList.toggle("is-on", st.sess.tool === sat.TOOLS[i].id);
        }
        for (var z = 0; z < sat.ZOOMS.length; z++) {
          var zb = studio.$("spr-zoom-" + sat.ZOOMS[z]);
          if (zb) zb.classList.toggle("is-on", st.sess.zoom === sat.ZOOMS[z]);
        }
        drawScreen();
        drawSlots();
        drawSheet();
        drawPattern();
        drawPalette();
        drawText();
      }

      function drawText() {
        var st = pic && sess ? { pic: pic, sess: sess } : null;
        if (!st) {
          if (studio.$("spr-note")) {
            studio.$("spr-note").textContent = error || "no assets yet";
          }
          return;
        }
        var s = sess.sprite >= 0 ? st.pic.sprites[sess.sprite] : null;
        var size = s ? sat.patternSize(st.pic, s.pattern) : null;
        if (studio.$("spr-count")) {
          studio.$("spr-count").textContent =
            "SAT " + st.pic.sprites.length + "/" + sat.MAX_SPRITES;
        }
        /* The per-line figures: #50's model over the picture (no captures,
         * so these are the conditions a real VDC would raise). */
        if (studio.$("spr-line")) {
          var budget = sat.budget(st.pic);
          var worst = budget.worst;
          var line = worst ? worst.line : 0;
          studio.$("spr-line").textContent =
            "line " + line + " · " + (worst ? worst.strips : 0) + "/" +
            ed.LINE_STRIPS + " sprites · " + (worst ? worst.pixels : 0) + "/" +
            (ed.LINE_STRIPS * ed.STRIP_PX) + " px" +
            (budget.droppedLines
              ? " · " + budget.droppedLines + " line(s) over"
              : " · nothing dropped");
        }
        if (studio.$("spr-sprsize")) {
          studio.$("spr-sprsize").textContent =
            size ? size.width + " × " + size.height : "—";
        }
        if (studio.$("spr-x")) studio.$("spr-x").textContent = s ? String(s.x) : "—";
        if (studio.$("spr-y")) studio.$("spr-y").textContent = s ? String(s.y) : "—";
        if (studio.$("spr-slot")) {
          studio.$("spr-slot").textContent =
            sess.sprite >= 0 ? String(sess.sprite) : "—";
        }
        if (studio.$("spr-pattern")) {
          studio.$("spr-pattern").textContent =
            sess.pattern >= 0 ? "$" + sess.pattern.toString(16).toUpperCase() : "—";
        }
        if (studio.$("spr-cell")) {
          /* The VDC reads a 64-word cell per pattern; the sprite's first is
           * this one (the #26 VRAM map names the same address). */
          studio.$("spr-cell").textContent = sess.pattern >= 0
            ? "$" + (sess.pattern * 64).toString(16).toUpperCase() : "—";
        }
        if (studio.$("spr-patpick") && sess.pattern >= 0)
          studio.$("spr-patpick").value = String(sess.pattern);
        if (studio.$("spr-palpick") && s)
          studio.$("spr-palpick").value = String(s.palette);
        if (studio.$("spr-priority"))
          studio.$("spr-priority").value = s && s.priority ? "1" : "0";
        if (studio.$("spr-hflip")) studio.$("spr-hflip").checked = !!(s && s.hflip);
        if (studio.$("spr-vflip")) studio.$("spr-vflip").checked = !!(s && s.vflip);
        if (studio.$("spr-note")) {
          studio.$("spr-note").textContent = error ||
            (st.pic.sprites.length ? "Click a slot or the screen to select; " +
             "the screen drags the selected sprite." :
             "No sprites yet: click slot 0 to place one.");
        }
      }

      function bind() {
        if (!ready()) return;
        var screen = studio.$("spr-screen");
        if (screen) {
          screen.addEventListener("mousedown", function (ev) {
            pointer("press", ev, screen); ev.preventDefault();
          });
          screen.addEventListener("mousemove", function (ev) {
            if (sess && sess.screenFrom) pointer("drag", ev, screen);
          });
          screen.addEventListener("mouseup", function (ev) {
            pointer("release", ev, screen); ev.preventDefault();
          });
          screen.addEventListener("mouseleave", function (ev) {
            if (sess && sess.screenFrom) pointer("release", ev, screen);
          });
        }
        var pattern = studio.$("spr-pattern");
        if (pattern) {
          pattern.addEventListener("mousedown", function (ev) {
            pointer("press", ev, pattern); ev.preventDefault();
          });
          pattern.addEventListener("mousemove", function (ev) {
            if (sess && sess.dragging) pointer("drag", ev, pattern);
          });
          pattern.addEventListener("mouseup", function (ev) {
            pointer("release", ev, pattern); ev.preventDefault();
          });
          pattern.addEventListener("keydown", function (ev) {
            if (key(ev)) { ev.preventDefault(); ev.stopPropagation(); }
          });
        }
        var slots = studio.$("spr-slots");
        if (slots) slots.addEventListener("click", function (ev) {
          var r = slots.getBoundingClientRect();
          var w = r.width || slots.width || SLOT_COLS * SLOT_PX;
          var col = Math.floor((ev.clientX - r.left) * SLOT_COLS / w);
          var row = Math.floor((ev.clientY - r.top) * SLOT_COLS /
                               (r.height || slots.height || SLOT_COLS * SLOT_PX));
          if (col >= 0 && col < SLOT_COLS && row >= 0 && row < SLOT_COLS)
            selectSlot(row * SLOT_COLS + col);
        });
        var sheet = studio.$("spr-sheet");
        if (sheet) sheet.addEventListener("click", function (ev) {
          var r = sheet.getBoundingClientRect();
          var w = r.width || sheet.width || 256;
          var x = (ev.clientX - r.left) * 256 / w;
          var y = (ev.clientY - r.top) * 32 / (r.height || sheet.height || 32);
          var list = sheet.__sheetPlaced || [];
          for (var i = 0; i < list.length; i++) {
            var p = list[i];
            if (x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h) {
              selectPattern(p.at);
              return;
            }
          }
        });
        var wire = function (id, fn) {
          var el = studio.$("spr-" + id);
          if (el) el.addEventListener("click", fn);
        };
        wire("prev", function () { step(-1); });
        wire("next", function () { step(1); });
        wire("release", releasePosition);
        wire("park", park);
        wire("clear", clearSlot);
        wire("newpattern", newPattern);
        wire("x-down", function () { nudge("x", -1); });
        wire("x-up", function () { nudge("x", 1); });
        wire("y-down", function () { nudge("y", -1); });
        wire("y-up", function () { nudge("y", 1); });
        var check = function (id, fn) {
          var el = studio.$("spr-" + id);
          if (el) el.addEventListener("change", function () { fn(el); });
        };
        check("grid", function (el) { toggleGrid(el.checked); });
        check("hflip", function (el) { setField("hflip", el.checked ? 1 : 0); });
        check("vflip", function (el) { setField("vflip", el.checked ? 1 : 0); });
        var choose = function (id, fn) {
          var el = studio.$("spr-" + id);
          if (el) el.addEventListener("change", function () { fn(el.value); });
        };
        choose("patpick", function (v) { setField("pattern", Number(v)); });
        choose("palpick", function (v) { setField("palette", Number(v)); });
        choose("priority", function (v) { setField("priority", Number(v)); });
      }

      /* ---- the draw the registry calls ------------------------------------ */
      function draw(st) {
        drawEditor();
        if (!st || !P.panels) return;
        /* The live frame's own SAT at the followed line (#50's status), which
         * the asset picture above cannot know: a toy that writes its own SAT
         * is what the console shows.  The asset panel is the target. */
        var el = studio.$("spr-live");
        if (!el) return;
        try {
          var line = studio.render.panelLine(st);
          var c = P.sprites.lineStatus(st.vram, st.sat, line, st.width);
          el.textContent = "frame: line " + line + " · " + c.sprites +
            "/" + 64 + " sprites in range · " + c.strips + "/" +
            ed.LINE_STRIPS + " strips · " + c.requested + " asked" +
            (c.overflow ? " · OVERFLOW (" + c.dropped + " dropped)" : "");
        } catch (e) { el.textContent = "frame: " + (e.message || e); }
      }

      /* ---- what the page's evidence API reads ----------------------------- */
      function summary() {
        var st = state();
        if (!st) return null;
        var s = st.sess.sprite >= 0 ? st.pic.sprites[st.sess.sprite] : null;
        return {
          tool: st.sess.tool, zoom: st.sess.zoom, grid: st.sess.grid,
          colour: st.sess.colour, sprite: st.sess.sprite,
          pattern: st.sess.pattern,
          count: sat.countSprites(st.pic),
          patterns: sat.patternCount(st.pic),
          slots: sat.slots(st.pic),
          spriteAt: function (i) { return st.pic.sprites[i] || null; },
          size: s ? sat.patternSize(st.pic, s.pattern) : null,
          parked: s ? s.y >= sat.PARK_ROW : false,
          pixels: function () {
            return st.sess.pattern >= 0
              ? Array.prototype.slice.call(ed.spritePatternPixels(st.pic,
                  st.sess.pattern)) : [];
          },
          pixel: function (x, y) {
            return sat.patternPixel(st.pic, st.sess.pattern, x, y);
          },
          budget: sat.budget(st.pic),
          error: error
        };
      }

      function pressAt(x, y) {
        var st = state();
        if (!st) return 0;
        var n = 0;
        try {
          n = sat.press(st.sess, x, y);
          if (n) commit(); else { dirty = true; drawEditor(); }
        } catch (e) { fail(e); }
        return n;
      }

      function dragAt(x, y) {
        var st = state();
        if (!st) return 0;
        var n = 0;
        try {
          n = sat.drag(st.sess, x, y);
          if (n) commit(); else { dirty = true; drawEditor(); }
        } catch (e) { fail(e); }
        return n;
      }

      function releaseAt(x, y) {
        var st = state();
        if (!st) return 0;
        var n = 0;
        try {
          n = sat.release(st.sess, x, y);
          if (n) commit(); else { dirty = true; drawEditor(); }
        } catch (e) { fail(e); }
        return n;
      }

      var api = {
        state: summary,
        session: function () { return sess; },
        picture: function () { return pic; },
        frame: function () { return sess && pic ? sat.frame(pic) : null; },
        setTool: setTool,
        setZoom: setZoom,
        toggleGrid: toggleGrid,
        selectColour: function (n) {
          var st = state();
          if (!st) return null;
          sat.selectColour(st.sess, n);
          dirty = true; drawEditor();
          return st.sess.colour;
        },
        selectSlot: selectSlot,
        step: step,
        setField: setField,
        nudge: nudge,
        releasePosition: releasePosition,
        park: park,
        clearSlot: clearSlot,
        newPattern: newPattern,
        selectPattern: selectPattern,
        press: pressAt,
        drag: dragAt,
        release: releaseAt,
        click: function (x, y) { return pressAt(x, y) + releaseAt(x, y); },
        screenPress: function (x, y) {
          var st = state();
          if (!st) return -1;
          var i = sat.screenPress(st.sess, x, y);
          dirty = true; drawEditor();
          return i;
        },
        screenDrag: function (x, y) {
          var st = state();
          if (!st) return 0;
          var n = 0;
          try { n = sat.screenDrag(st.sess, x, y); if (n) commit(); }
          catch (e) { fail(e); }
          return n;
        },
        screenRelease: function () {
          var st = state();
          if (!st) return false;
          var had = sat.screenRelease(st.sess);
          dirty = true; drawEditor();
          return had;
        },
        pointer: function (kind, ev, elem) {
          return pointer(kind, ev, elem || studio.$("spr-pattern"));
        },
        canvas: function () {
          return { screen: studio.$("spr-screen").width,
                   slots: studio.$("spr-slots").width,
                   pattern: studio.$("spr-pattern").width,
                   sheet: studio.$("spr-sheet").width };
        },
        drawn: function () {
          return !!studio.$("spr-count") &&
                 !!studio.$("spr-count").textContent;
        },
        invalidate: invalidate
      };

      studio.toy.onAssetEdit(invalidate);
      bind();

      studio.panels.register({
        id: "sprites",
        label: "SPRITES",
        group: "chip",
        chapter: "sprites",
        gloss: "The SAT's 64 sprites: position, pattern, size, palette and " +
               "priority; the pattern is drawn with SCREEN's tools.",
        draw: draw,
        api: api
      });
    }
  });
})(typeof self !== "undefined" ? self : this);
