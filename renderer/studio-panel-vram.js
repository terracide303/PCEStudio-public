/*
 * studio-panel-vram.js — the VRAM panel as a drawn map (card #85, part B), a
 * module of the studio since #102.
 *
 * ppu.toys' VRAM panel is the working example: VRAM is an image of
 * characters, paged with a `‹ page ›` picker, a preview palette and a "Jump
 * to …" row, and the pointer reports the address and character under it —
 * not a table of ranges.  Ours draws the VDC's 32768 words the same way: a
 * page is 256 characters of 16 words (16 x 16 cells of 8 x 8), eight pages
 * cover the chip, and the regions renderer/pce-panels.js vramMap() finds (the
 * BAT, the tiles, the sprite patterns, the SAT, free) are tinted and labelled
 * on the sheet, with a legend and a jump button each.
 *
 * The sheet is the RUNNING TOY's VRAM — the same words pce-bg.js draws — so
 * it shows what the toy wrote.  The decode is renderer/pce-vram-map.js's, the
 * one 4bpp decode; this module only paints and binds.  Characters are drawn
 * in one chosen background palette (the preview palette, as ppu.toys lets you
 * choose), because a character's colour numbers are palette-independent.
 *
 * Clicking a character selects its first word and the readout says what the
 * word is: a BAT cell (character and palette field), a tile or sprite-pattern
 * row, a SAT sprite's Y/X/pattern/palette, or free space.
 */
(function (root) {
  "use strict";
  var P = root.PCEStudio = root.PCEStudio || {};
  P.studioPanelModules = P.studioPanelModules || [];

  P.studioPanelModules.push({
    id: "vram",
    register: function (studio) {
      var V = P.vramMap;
      var page = 0;
      var palette = 0;
      var selected = null;         /* a VRAM word, or null */
      var hovered = null;          /* a VRAM word, or null */
      var st = null;               /* the frame the map was drawn from */
      var map = null;              /* pce-panels.vramMap(st) */
      var lastImage = null;        /* the 128 x 128 sheet, for the evidence */
      var sheet = null;            /* the offscreen canvas the sheet is on */
      var lastCanvas = { width: 0, height: 0 };
      var overlay = { tints: 0, labels: [], grid: 0, selection: false };
      var error = "";
      var built = false;
      var jumpsKey = "";
      var SCALE = 3;               /* canvas pixels per sheet pixel */

      var KIND_COLOUR = {
        "BAT": "#3f8f6f", "tiles": "#4f6fd0", "sprite patterns": "#c08040",
        "SAT": "#b05090", "free": "#3a3f49"
      };
      /* Only the regions that are not character data get a tint; the tiles
       * and sprite patterns are the pixels themselves. */
      var TINT = {
        "BAT": "rgba(63,143,111,0.20)",
        "SAT": "rgba(176,80,144,0.20)",
        "free": "rgba(58,63,73,0.35)"
      };

      function ready() { return !!(V && P.panels && P.editor); }

      function rgbOf(colour) {
        var c = P.editor.colourChannels(colour);
        return { r: c.r * 36, g: c.g * 36, b: c.b * 36 };
      }

      /* The 16 CRAM words one background palette holds in the frame the map
       * is drawn from — the toy's own colours, entry 0 included (the shared
       * backdrop the renderer applies). */
      function paletteWords() {
        var out = [];
        if (!st) return out;
        for (var e = 0; e < 16; e++) {
          var i = palette * 16 + e;
          out.push((st.cram[i * 2] | (st.cram[i * 2 + 1] << 8)) & 0x1FF);
        }
        return out;
      }

      /* ---- the bar ------------------------------------------------------ */
      function buildBar() {
        if (built || !V) return;
        var pageSel = studio.$("vram-page");
        if (pageSel && !pageSel.children.length) {
          for (var p = 0; p < V.PAGES; p++) {
            var range = V.pageRange(p);
            var o = studio.document.createElement("option");
            o.value = String(p);
            o.textContent = V.wordName(range.startWord) + "–" +
                            V.wordName(range.endWord);
            pageSel.appendChild(o);
          }
        }
        var palSel = studio.$("vram-pal");
        if (palSel && !palSel.children.length) {
          for (var k = 0; k < 16; k++) {
            var o2 = studio.document.createElement("option");
            o2.value = String(k);
            o2.textContent = "pal " + k + " · CRAM $" + hex2(k * 16);
            palSel.appendChild(o2);
          }
        }
        built = true;
      }

      function buildJumps() {
        var host = studio.$("vram-jumps");
        if (!host || !map || !V) return;
        var jumps = V.jumps(map);
        var key = jumps.map(function (j) { return j.kind + ":" + j.page; })
                       .join(",");
        if (key === jumpsKey) return;
        jumpsKey = key;
        while (host.firstChild) host.removeChild(host.firstChild);
        for (var i = 0; i < jumps.length; i++) {
          (function (jump) {
            var b = studio.document.createElement("button");
            b.type = "button";
            b.id = "vram-jump-" + jump.kind.replace(/\s+/g, "-");
            b.className = "btn-mini";
            b.textContent = jump.label;
            b.title = "Jump to the " + jump.label + " at " +
                      V.wordName(jump.start);
            b.addEventListener("click", function () { setPage(jump.page); });
            host.appendChild(b);
          })(jumps[i]);
        }
      }

      function hex2(v) { return v.toString(16).toUpperCase().padStart(2, "0"); }

      /* ---- the map ------------------------------------------------------ */
      /* The page as pixels: 256 characters of 8 x 8, in the preview palette.
       * The sheet is built once per draw at 1x (one ImageData, not 16,384
       * fillRects) and scaled when it is put on the visible canvas. */
      function drawMap() {
        var canvas = studio.$("vrammap");
        if (!canvas || !V) return null;
        var W = V.PAGE_COLS * V.CELL, H = V.PAGE_ROWS * V.CELL;  /* 128 x 128 */
        var range = V.pageRange(page);
        var words = paletteWords();
        lastImage = null;
        sheet = null;
        try {
          var off = studio.document.createElement("canvas");
          off.width = W; off.height = H;
          var octx = off.getContext("2d");
          if (!octx) return null;
          var img = octx.createImageData(W, H);
          for (var cell = 0; cell < V.PAGE_CHARS; cell++) {
            var ch = range.firstChar + cell;
            var px = V.charPixels(st.vram, ch);
            var cx = (cell % V.PAGE_COLS) * V.CELL;
            var cy = Math.floor(cell / V.PAGE_COLS) * V.CELL;
            for (var y = 0; y < V.CELL; y++) {
              for (var x = 0; x < V.CELL; x++) {
                var c = rgbOf(words[px[y * V.CELL + x]]);
                var o = ((cy + y) * W + cx + x) * 4;
                img.data[o] = c.r;
                img.data[o + 1] = c.g;
                img.data[o + 2] = c.b;
                img.data[o + 3] = 255;
              }
            }
          }
          octx.putImageData(img, 0, 0);
          sheet = off;
          lastImage = img;
        } catch (e) {
          lastImage = null;
          sheet = null;
        }
        canvas.width = W * SCALE;
        canvas.height = H * SCALE;
        canvas.style.width = canvas.width + "px";
        canvas.style.height = canvas.height + "px";
        lastCanvas = { width: canvas.width, height: canvas.height };
        return lastImage;
      }

      /* The sheet, then what is drawn over it: the region tints, the grid,
       * a region's name where it starts on this page, and the selection. */
      function drawSheet() {
        var canvas = studio.$("vrammap");
        if (!canvas || !V) return;
        var range = V.pageRange(page);
        var ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.imageSmoothingEnabled = false;
        if (sheet) {
          try { ctx.drawImage(sheet, 0, 0, canvas.width, canvas.height); }
          catch (e) { /* a canvas that cannot draw leaves the map blank */ }
        }
        overlay = { tints: 0, labels: [], grid: 0, selection: false };

        /* The regions: a tint over the BAT, the SAT and free space. */
        for (var cell = 0; cell < V.PAGE_CHARS; cell++) {
          var ch = range.firstChar + cell;
          var tint = TINT[V.kindOf(map, ch * V.CHAR_WORDS)];
          if (!tint) continue;
          ctx.fillStyle = tint;
          ctx.fillRect((cell % V.PAGE_COLS) * V.CELL * SCALE,
                       Math.floor(cell / V.PAGE_COLS) * V.CELL * SCALE,
                       V.CELL * SCALE, V.CELL * SCALE);
          overlay.tints++;
        }

        /* The cell grid, faint. */
        ctx.strokeStyle = "rgba(255,255,255,0.10)";
        ctx.lineWidth = 1;
        for (var i = 0; i <= V.PAGE_COLS; i++) {
          var at = Math.round(i * V.CELL * SCALE) + 0.5;
          ctx.beginPath();
          ctx.moveTo(at, 0); ctx.lineTo(at, canvas.height);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(0, at); ctx.lineTo(canvas.width, at);
          ctx.stroke();
          overlay.grid += 2;
        }

        /* A region's name where it starts on this page — but only when the
         * run has room for it (a one-cell tiles region is named by its tint
         * and by the legend), and never over the previous label. */
        var runs = V.regions(map);
        var lastLabel = null;
        for (var r = 0; r < runs.length; r++) {
          var run = runs[r];
          if (run.firstPage > page || run.lastPage < page) continue;
          var from = Math.max(run.start, range.startWord);
          var to = Math.min(run.end, range.endWord);
          var cellsOnPage = V.charOfWord(to) - V.charOfWord(from) + 1;
          if (cellsOnPage < 2) continue;
          var atChar = V.charOfWord(from) - range.firstChar;
          if (atChar < 0 || atChar >= V.PAGE_CHARS) continue;
          var lx = (atChar % V.PAGE_COLS) * V.CELL * SCALE + 2;
          var ly = Math.floor(atChar / V.PAGE_COLS) * V.CELL * SCALE + 12;
          if (lastLabel && lastLabel.ly === ly &&
              Math.abs(lastLabel.lx - lx) < lastLabel.width + 8) continue;
          var width = run.label.length * 6 + 6;
          ctx.fillStyle = "rgba(8,9,12,0.72)";
          ctx.fillRect(lx - 2, ly - 10, width, 13);
          ctx.fillStyle = KIND_COLOUR[run.kind] || "#c8ccd6";
          ctx.font = "10px monospace";
          ctx.fillText(run.label, lx, ly);
          overlay.labels.push(run.label);
          lastLabel = { lx: lx, ly: ly, width: width };
        }

        /* The selected word's character, outlined. */
        if (selected != null && selected >= range.startWord &&
            selected <= range.endWord) {
          var selChar = V.charOfWord(selected) - range.firstChar;
          var sx = (selChar % V.PAGE_COLS) * V.CELL * SCALE;
          var sy = Math.floor(selChar / V.PAGE_COLS) * V.CELL * SCALE;
          ctx.strokeStyle = "rgba(95,201,232,0.95)";
          ctx.lineWidth = 2;
          ctx.strokeRect(sx + 1, sy + 1, V.CELL * SCALE - 2,
                         V.CELL * SCALE - 2);
          overlay.selection = true;
        }
      }

      /* ---- the legend, the readouts and the bar values ------------------ */
      function drawLegend() {
        var host = studio.$("vram-legend");
        if (!host || !map) return;
        while (host.firstChild) host.removeChild(host.firstChild);
        var runs = V.regions(map);
        var rows = [];
        for (var k = 0; k < V.KIND_ORDER.length; k++) {
          var kind = V.KIND_ORDER[k], row = null;
          for (var i = 0; i < runs.length; i++) {
            if (runs[i].kind !== kind) continue;
            if (!row) row = { kind: kind, label: runs[i].label,
                              start: runs[i].start, end: runs[i].end,
                              words: 0 };
            row.end = runs[i].end;
            row.words += runs[i].words;
          }
          if (row) rows.push(row);
        }
        for (var r = 0; r < rows.length; r++) {
          var chip = studio.document.createElement("span");
          chip.className = "vleg";
          var dot = studio.document.createElement("i");
          dot.style.background = KIND_COLOUR[rows[r].kind] || "#3a3f49";
          chip.appendChild(dot);
          var text = studio.document.createElement("span");
          text.textContent = rows[r].label + " " + V.wordName(rows[r].start) +
            "–" + V.wordName(rows[r].end) + " · " + rows[r].words + " words";
          chip.appendChild(text);
          host.appendChild(chip);
        }
      }

      function paintBar() {
        var pageSel = studio.$("vram-page");
        if (pageSel) pageSel.value = String(page);
        var palSel = studio.$("vram-pal");
        if (palSel) palSel.value = String(palette);
        var next = studio.$("vram-next");
        if (next) next.disabled = page >= V.PAGES - 1;
        var prev = studio.$("vram-prev");
        if (prev) prev.disabled = page <= 0;
        buildJumps();
      }

      function describeOf(word) {
        if (!st || !map || word == null) return null;
        try {
          return V.describe(st.vram, map, st.geom, st.satAddr, word);
        } catch (e) {
          error = (e && e.code ? e.code + ": " : "") +
                  (e && e.message ? e.message : e);
          return null;
        }
      }

      function paintHover() {
        var el = studio.$("vram-hover");
        if (!el) return;
        if (!st) { el.textContent = ""; return; }
        var d = describeOf(hovered);
        el.textContent = d ? d.text : (hovered == null ? "" : "word " +
          V.wordName(hovered));
      }

      function paintPick() {
        var el = studio.$("vram-pick");
        if (!el) return;
        if (!st) {
          el.textContent = "Run the toy — the map is the running frame's VRAM.";
          return;
        }
        var d = describeOf(selected);
        if (!d) {
          el.textContent = "Click a character to inspect its words.";
          return;
        }
        el.textContent = d.detail;
      }

      function paint() {
        if (!ready()) return;
        buildBar();
        if (!st) {
          map = null;
          lastImage = null;
          sheet = null;
          var legend = studio.$("vram-legend");
          if (legend) while (legend.firstChild)
            legend.removeChild(legend.firstChild);
          paintHover(); paintPick();
          return;
        }
        map = P.panels.vramMap(st);
        drawMap();
        drawSheet();
        drawLegend();
        paintBar();
        paintHover();
        paintPick();
        error = "";
      }

      /* ---- the controls -------------------------------------------------- */
      function setPage(n) {
        if (!V) return page;
        if (typeof n !== "number" || n !== Math.floor(n) ||
            n < 0 || n >= V.PAGES)
          throw Object.assign(new Error("the map has " + V.PAGES +
                            " pages; page " + n + " is not one"),
                            { code: "page-range" });
        page = n;
        paint();
        return page;
      }

      function setPalette(n) {
        if (typeof n !== "number" || n !== Math.floor(n) || n < 0 || n > 15)
          throw Object.assign(new Error("the VCE has 32 palettes; the " +
                            "preview draws background palettes 0-15"),
                            { code: "palette-range" });
        palette = n;
        paint();
        return palette;
      }

      function hoverWord(word) {
        if (word != null) V.charOfWord(word);   /* vram-range on a bad word */
        hovered = word;
        paintHover();
        return describeOf(word);
      }

      function pickWord(word) {
        if (word != null) V.charOfWord(word);   /* vram-range on a bad word */
        selected = word;
        paint();
        return describeOf(word);
      }

      function wordAt(ev, canvas) {
        if (!V) return null;
        var r = canvas.getBoundingClientRect();
        var w = r.width || canvas.width || 1;
        var h = r.height || canvas.height || 1;
        var fx = (ev.clientX - r.left) / w;
        var fy = (ev.clientY - r.top) / h;
        var col = Math.max(0, Math.min(V.PAGE_COLS - 1,
                          Math.floor(fx * V.PAGE_COLS)));
        var row = Math.max(0, Math.min(V.PAGE_ROWS - 1,
                          Math.floor(fy * V.PAGE_ROWS)));
        var y = Math.max(0, Math.min(V.CELL - 1,
                        Math.floor((fy * V.PAGE_ROWS - row) * V.CELL)));
        var ch = page * V.PAGE_CHARS + row * V.PAGE_COLS + col;
        return ch * V.CHAR_WORDS + y;
      }

      /* ---- what the page's evidence API reads --------------------------- */
      var api = {
        state: function () {
          var runs = map ? V.regions(map) : [];
          return {
            page: page, pages: V.PAGES, palette: palette,
            selected: selected, hovered: hovered,
            firstChar: V.pageRange(page).firstChar,
            lastChar: V.pageRange(page).lastChar,
            kind: selected != null && map ? V.kindOf(map, selected) : null,
            word: describeOf(selected),
            regions: runs,
            jumps: map ? V.jumps(map) : [],
            canvas: lastCanvas,
            drawn: !!lastImage,
            overlays: { tints: overlay.tints, labels: overlay.labels.slice(),
                        grid: overlay.grid, selection: overlay.selection },
            error: error
          };
        },
        setPage: setPage,
        setPalette: setPalette,
        hoverWord: hoverWord,
        pickWord: pickWord,
        wordAt: function (x, y) {
          return wordAt({ clientX: x, clientY: y }, studio.$("vrammap"));
        },
        describe: function (word) { return describeOf(word); },
        text: function (word) {
          var d = describeOf(word);
          return d ? d.text : "";
        },
        image: function () { return lastImage; },
        paletteWords: paletteWords,
        charPixels: function (ch) { return st ? V.charPixels(st.vram, ch) : null; },
        invalidate: function () { map = null; }
      };

      studio.panels.register({
        id: "vram",
        label: "VRAM",
        group: "chip",
        chapter: "the-toy",
        gloss: "All 32768 words drawn as characters, with the BAT, tiles, sprite patterns and SAT tinted.",
        draw: function (frame) { st = frame || null; paint(); },
        api: api
      });

      /* ---- the pointer and the selects ---------------------------------- */
      var canvas = studio.$("vrammap");
      if (canvas) {
        canvas.addEventListener("mousemove", function (ev) {
          try { hoverWord(wordAt(ev, canvas)); } catch (e) { /* no map yet */ }
        });
        canvas.addEventListener("mouseleave", function () {
          hoverWord(null);
        });
        canvas.addEventListener("click", function (ev) {
          try { pickWord(wordAt(ev, canvas)); } catch (e) { /* no map yet */ }
        });
      }
      var pageSel = studio.$("vram-page");
      if (pageSel) pageSel.addEventListener("change", function () {
        setPage(Number(pageSel.value));
      });
      var palSel = studio.$("vram-pal");
      if (palSel) palSel.addEventListener("change", function () {
        setPalette(Number(palSel.value));
      });
      var prev = studio.$("vram-prev");
      if (prev) prev.addEventListener("click", function () {
        if (page > 0) setPage(page - 1);
      });
      var next = studio.$("vram-next");
      if (next) next.addEventListener("click", function () {
        if (page < V.PAGES - 1) setPage(page + 1);
      });
    }
  });
})(typeof self !== "undefined" ? self : this);
