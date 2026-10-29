/*
 * studio-panel-palettes.js — the PALETTES panel as a visual editor (card #85,
 * part B), a module of the studio since #102.
 *
 * ppu.toys' CGRAM panel is the working example: a grid of palette rows, one
 * swatch button per entry, and clicking a swatch opens an editor for that one
 * entry with its address (`cgram[0xNN]`) and its value on screen.  Ours is
 * the VCE's 512 entries and the 512 colours it can actually produce: pick a
 * swatch in the 32 x 16 table, then pick one of the 8 x 8 x 8 = 512 colours
 * the picker draws, and the entry's 9-bit word is what gets written — no RGB
 * wheel offering colours the chip would have to round away.
 *
 * The model is renderer/pce-palettes.js (the colour arithmetic, the selection,
 * the edits); the edits themselves are renderer/pce-editor.js's calls
 * (setPaletteColour, setSpritePaletteColour, setBackdrop), so its refusals and
 * its one shared backdrop stand.  What is edited is the toy's palettes.json —
 * the same file SCREEN edits and the #77 envelope saves.  This module only
 * draws and binds.
 *
 * Reading the files back on every asset change (rather than keeping a picture
 * across a panel switch) is what keeps SCREEN and PALETTES from writing each
 * other's stale table back; the selection (which entry is being edited) is
 * this module's own and survives a rebuild.
 */
(function (root) {
  "use strict";
  var P = root.PCEStudio = root.PCEStudio || {};
  P.studioPanelModules = P.studioPanelModules || [];

  P.studioPanelModules.push({
    id: "palettes",
    register: function (studio) {
      var pa = P.palettes, ed = P.editor, sc = P.screen;
      var pic = null;              /* the picture the toy's files make */
      var loaded = false;          /* the files parsed (a write is safe) */
      var seen = "";               /* the asset text the picture was built from */
      var sel = { palette: 0, entry: 1 };
      var error = "";
      var built = false;
      var grid = null;             /* [32][16] swatch buttons */
      var picks = null;            /* [512] picker buttons, in picker() order */

      function ready() { return !!(pa && ed && sc); }

      /* Both files the picture comes from: an edit to either (this panel's or
       * SCREEN's) is what makes the cached picture stale. */
      function assetKey() {
        var t = studio.toy.file("tiles.json");
        var p = studio.toy.file("palettes.json");
        return (t ? t.source : "") + "\u0000" + (p ? p.source : "");
      }

      function picture() {
        if (pic) return pic;
        try {
          pic = sc.pictureFromFiles(studio.toy.files());
          loaded = true;
          error = "";
        } catch (e) {
          loaded = false;
          error = (e && e.code ? e.code + ": " : "") +
                  (e && e.message ? e.message : e);
          pic = ed.newPicture();
        }
        seen = assetKey();
        return pic;
      }

      function state() {
        if (pic && assetKey() !== seen) pic = null;
        return picture();
      }

      function fail(e) {
        error = (e && e.code ? e.code + ": " : "") +
                (e && e.message ? e.message : e);
        var el = studio.$("pal-readout");
        if (el) el.textContent = error;
        studio.toast(error);
      }

      /* The asset write-back: palettes.json only (the page's own writer when
       * it has one, else the model's syncFiles — both write the one file). */
      function writeBack(p) {
        if (typeof studio.toy.writePalettesAssets === "function")
          return studio.toy.writePalettesAssets(p);
        var changed = pa.syncFiles(p, studio.toy.files());
        if (changed.length) {
          studio.toy.persist();
          studio.toy.saved("saved in this browser");
          studio.toy.refreshAssets();
        }
        return changed;
      }

      /* A file set that did not parse is never written over. */
      function commit() {
        if (!loaded) {
          fail(new Error("the toy's assets do not load, so nothing was " +
                         "written"));
          return [];
        }
        var changed = [];
        try { changed = writeBack(pic); }
        catch (e) { fail(e); return []; }
        seen = assetKey();
        return changed;
      }

      /* ---- the grid and the picker -------------------------------------- */
      function build() {
        if (built || !pa) return;
        var host = studio.$("pal32");
        if (!host) return;
        grid = [];
        for (var p = 0; p < pa.PALETTES; p++) {
          if (p === 0 || p === pa.FIRST_SPRITE) {
            var head = studio.document.createElement("div");
            head.className = "pal-head";
            head.textContent = p === 0
              ? "background palettes · CRAM $000–$0FF (the BAT's palette field)"
              : "sprite palettes · CRAM $100–$1FF (one per sprite)";
            host.appendChild(head);
          }
          var row = studio.document.createElement("div");
          row.className = "prow";
          var num = studio.document.createElement("span");
          num.className = "pnum";
          num.textContent = p < pa.FIRST_SPRITE ? String(p)
                                               : "S" + (p - pa.FIRST_SPRITE);
          row.appendChild(num);
          var rowCells = [];
          for (var e = 0; e < pa.ENTRIES; e++) {
            var sw = studio.document.createElement("button");
            sw.type = "button";
            sw.id = "pal-" + p + "-" + e;
            sw.className = "psw" +
              (e === 0 && p < pa.FIRST_SPRITE ? " entry0" : "");
            (function (palette, entry) {
              sw.addEventListener("click", function () {
                onSwatch(palette, entry);
              });
            })(p, e);
            row.appendChild(sw);
            rowCells.push(sw);
          }
          host.appendChild(row);
          grid.push(rowCells);
        }

        var pickHost = studio.$("pal-picker");
        if (!pickHost) { built = true; return; }
        var list = pa.picker();
        var planes = [];
        for (var b = 0; b < pa.LEVELS; b++) {
          var wrap = studio.document.createElement("div");
          wrap.className = "pal-plane-wrap";
          var label = studio.document.createElement("b");
          label.textContent = "B" + b;
          wrap.appendChild(label);
          var plane = studio.document.createElement("div");
          plane.className = "pal-plane";
          wrap.appendChild(plane);
          pickHost.appendChild(wrap);
          planes.push(plane);
        }
        picks = [];
        for (var i = 0; i < list.length; i++) {
          (function (c) {
            var sw = studio.document.createElement("button");
            sw.type = "button";
            sw.id = "pal-c-" + c.index;
            sw.className = "pal-c";
            sw.title = c.title;
            sw.setAttribute("aria-label", c.title);
            sw.style.background = c.css;
            sw.addEventListener("click", function () { onPick(c.word); });
            planes[c.plane].appendChild(sw);
            picks.push(sw);
          })(list[i]);
        }
        built = true;
      }

      /* The panel's own calls throw the model's refusal; the DOM handlers
       * catch it and show it, the evidence API gets it by code. */
      function select(palette, entry) {
        pa.selectEntry(sel, palette, entry);
        error = "";
        drawPanel();
        return { palette: sel.palette, entry: sel.entry };
      }

      function pickColour(colour) {
        return setWord(sel.palette, sel.entry, colour);
      }

      function setWord(palette, entry, colour) {
        var p = state();
        pa.selectEntry(sel, palette, entry);
        pa.setEntry(p, palette, entry, colour);
        error = "";
        commit();
        drawPanel();
        return pa.entryWord(p, sel.palette, sel.entry);
      }

      function onSwatch(palette, entry) {
        try { select(palette, entry); }
        catch (e) { fail(e); drawPanel(); }
      }

      function onPick(colour) {
        try { pickColour(colour); }
        catch (e) { fail(e); drawPanel(); }
      }

      function paint() {
        var p = state();
        if (!pa) return;
        build();
        var t = pa.table(p);
        for (var pal = 0; pal < pa.PALETTES; pal++) {
          for (var e = 0; e < pa.ENTRIES; e++) {
            var btn = grid[pal][e];
            var colour = t[pal][e];
            btn.style.background = pa.css(colour);
            btn.title = pa.title(pal, e, colour);
            btn.setAttribute("aria-label", btn.title);
            btn.classList.toggle("is-on", pal === sel.palette && e === sel.entry);
          }
        }
        var chosen = pa.entryWord(p, sel.palette, sel.entry);
        if (picks) {
          for (var i = 0; i < picks.length; i++)
            picks[i].classList.toggle("is-on", i === chosen);
        }
        paintReadout(p, chosen);
      }

      function paintReadout(p, colour) {
        var out = studio.$("pal-readout");
        var note = studio.$("pal-note");
        if (out) {
          if (error) { out.textContent = error; }
          else {
            var c = pa.channels(colour);
            var rgb = pa.rgb(colour);
            var where = pa.kindOf(sel.palette) === "background"
              ? "background palette " + sel.palette + " · entry " + sel.entry
              : "sprite palette " + (sel.palette - pa.FIRST_SPRITE) +
                " · entry " + sel.entry;
            var text = where + "\nCRAM $" + hex3(sel.palette * pa.ENTRIES +
              sel.entry) + " · word $" + hex3(colour) + " · G" + c.g +
              " R" + c.r + " B" + c.b + " · rgb(" + rgb.r + "," + rgb.g + "," +
              rgb.b + ")";
            if (sel.palette < pa.FIRST_SPRITE && sel.entry === 0)
              text += "\nEntry 0 of every background palette is the one " +
                      "shared backdrop (CRAM $000).";
            else if (sel.palette >= pa.FIRST_SPRITE)
              text += "\nSprite pixel 0 is transparent; entry 0 never shows " +
                      "on a sprite.";
            out.textContent = text;
          }
        }
        if (note) {
          note.textContent = error ? "" :
            pa.isBlank(p)
              ? "palettes.json is still all black: this is the picture the " +
                "files make; a toy writing its own pal() does not write the " +
                "file back (the import is one way, #117)."
              : "";
        }
      }

      function hex3(v) { return v.toString(16).toUpperCase().padStart(3, "0"); }

      function drawPanel() {
        if (!ready()) return;
        paint();
      }

      /* ---- what the page's evidence API reads --------------------------- */
      var api = {
        state: function () {
          var p = state();
          return {
            palettes: pa.PALETTES, entries: pa.ENTRIES, colours: pa.COLOURS,
            selected: { palette: sel.palette, entry: sel.entry },
            kind: pa.kindOf(sel.palette),
            backdrop: sel.palette < pa.FIRST_SPRITE && sel.entry === 0,
            word: pa.entryWord(p, sel.palette, sel.entry),
            words: pa.table(p),
            blank: pa.isBlank(p),
            error: error
          };
        },
        select: select,
        setWord: setWord,
        pick: function (index) {
          if (typeof index !== "number" || index !== Math.floor(index) ||
              index < 0 || index >= pa.COLOURS)
            throw Object.assign(new Error("the picker has " + pa.COLOURS +
                              " colours; index " + index + " is not one"),
                              { code: "picker-range" });
          return pickColour(pa.picker()[index].word);
        },
        colours: function () { return pa.picker().map(function (c) { return c.word; }); },
        css: function (colour) { return pa.css(colour); },
        picture: function () { return state(); },
        invalidate: function () { pic = null; }
      };

      studio.toy.onAssetEdit(api.invalidate);

      studio.panels.register({
        id: "palettes",
        label: "PALETTES",
        group: "chip",
        chapter: "palettes",
        gloss: "The VCE's 512 colours as 32 palettes of 16 — click one to edit its 9-bit word.",
        draw: function () { drawPanel(); },
        api: api
      });
    }
  });
})(typeof self !== "undefined" ? self : this);
