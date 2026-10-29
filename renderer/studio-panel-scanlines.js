/*
 * studio-panel-scanlines.js — the SCANLINES panel (card #92, part D), a
 * module of the studio since #102.
 *
 * ppu.toys' SCANLINES panel is the working example: "Change registers
 * partway down the frame: HDMA-style effects", an "Inspect line" number and
 * slider, an "Apply edits to" band picker, a mini frame showing the bands
 * and "Full frame · lines 0-223", and a row per band with a number, a name,
 * Enabled, its from-to lines, move up/down, duplicate, Edit, "N controls" and
 * a menu, plus "Add band".  renderer/pce-raster.js is the model — the bands,
 * the #15 table they make, #32's price per line and the toy code they become
 * — and this file is the panel: the rows, the inspector, the mini frame and
 * the preview.  It draws nothing of its own: the preview is
 * pce-sprites.js's compositor over the toy's own state with the band table.
 *
 * The PCE's HDMA is the line interrupt (RCR).  A band is what a scanline's
 * interrupt writes and holds until the next band's first line — BXR, BYR, CR
 * (BG and sprites on or off) and CRAM colour words, plus one of #17's
 * ready-made effects.  What it may cost is renderer/pce-validate.js's
 * arithmetic, not this file's opinion; a band past the 123-cycle blank or
 * over two colour words on a line is refused by code and the row says so.
 *
 * "Apply to toy" writes the bands into main.lua as a fenced raster(line)
 * callback — the code the toy really runs — and "Import" reads a table the
 * toy already builds back into bands.  docs/STUDIO.md §3.6.
 */
(function (root) {
  "use strict";
  var P = root.PCEStudio = root.PCEStudio || {};
  P.studioPanelModules = P.studioPanelModules || [];

  var NUMERIC = [
    { key: "bxr", input: "scn-bxr", box: "scn-bxr-on" },
    { key: "byr", input: "scn-byr", box: "scn-byr-on" },
    { key: "cr", input: "scn-cr", box: "scn-cr-on" }
  ];

  P.studioPanelModules.push({
    id: "scanlines",
    register: function (studio) {
      var R = P.raster;
      var bands = [];            /* the live band list */
      var lines = R ? R.DEFAULT_LINES : 224;
      var inspect = 0;           /* the Inspect line */
      var selectedId = null;     /* "Apply edits to" */
      var error = "";
      var note = "";
      var lastFence = null;      /* the block main.lua held at the last sync */
      var bound = false;

      function ready() { return !!(R && studio && studio.panels); }
      function $(id) { return studio.$(id); }

      function el(tag, cls, text) {
        var e = studio.document.createElement(tag);
        if (cls) e.className = cls;
        if (text != null) e.textContent = text;
        return e;
      }

      function clear(e) { while (e && e.firstChild) e.removeChild(e.firstChild); }

      function fail(e) {
        error = (e && e.code ? e.code + ": " : "") +
                (e && e.message ? e.message : e);
        note = "";
        draw();
      }

      function find(id) {
        for (var i = 0; i < bands.length; i++) if (bands[i].id === id) return bands[i];
        return null;
      }

      function sorted() {
        return bands.slice().sort(function (a, b) { return a.from - b.from; });
      }

      /* A band's own values under the same id, so a split keeps them. */
      function copyBand(b) {
        var out = { id: b.id, name: b.name, enabled: b.enabled,
                    from: b.from, to: b.to };
        if (b.bxr != null) out.bxr = b.bxr;
        if (b.byr != null) out.byr = b.byr;
        if (b.cr != null) out.cr = b.cr;
        if (b.cram) out.cram = b.cram.map(function (w) { return [w[0], w[1]]; });
        if (b.fx) out.fx = JSON.parse(JSON.stringify(b.fx));
        return out;
      }

      function selected() {
        return find(selectedId) || sorted()[0] || null;
      }

      function problemsAll() { return R.checkList(bands, lines); }

      /* The first band that covers a line, else the last one starting above
       * it (whose values the hardware is still holding). */
      function bandAt(line) {
        var s = sorted(), found = null;
        for (var i = 0; i < s.length; i++) {
          if (s[i].from <= line && line <= s[i].to) return s[i];
          if (s[i].from <= line) found = s[i];
        }
        return found;
      }

      function baseRegs() {
        var st = studio.render.state();
        var regs = (st && st.regs) || {};
        return { bxr: regs.BXR || 0, byr: regs.BYR || 0,
                 cr: regs.CR == null ? 0xC0 : regs.CR };
      }

      /* ---- what the toy holds, and what the panel holds ------------------ */

      function sourceText() {
        try { return studio.toy.source ? studio.toy.source() : ""; }
        catch (e) { return ""; }
      }

      function fenceOf(src) {
        if (typeof src !== "string") return null;
        var a = src.indexOf(R.FENCE_OPEN);
        var b = src.indexOf(R.FENCE_CLOSE);
        return (a >= 0 && b > a) ? src.slice(a, b + R.FENCE_CLOSE.length) : null;
      }

      /* The toy is the source of truth: when its fenced block changes (an
       * Apply here, a hand edit, a different toy opened) the panel adopts it.
       * A toy with no block starts on one band holding the frame's CR — the
       * cheapest band that is a band (one register write, 64 of the blank's
       * 123 cycles); BXR and BYR stay where the toy's own frame() puts them
       * until the user adds a control, because three register writes on one
       * line do not fit the blank at all. */
      function sync() {
        var src = sourceText();
        var fence = fenceOf(src);
        if (fence === lastFence && bands.length) return;
        lastFence = fence;
        var keep = selectedId;
        bands = [];
        if (fence) {
          try {
            var got = R.fromLua(src, { lines: lines });
            if (got && got.bands.length) { lines = got.lines; bands = got.bands; }
          } catch (e) { /* reported when the block is applied or imported */ }
        }
        if (!bands.length) {
          bands.push(R.newBand({ name: "Full frame", from: 0, to: lines - 1,
                                 cr: baseRegs().cr }, lines));
        }
        if (find(keep)) selectedId = keep;
        else selectedId = bands[0].id;
        inspect = Math.max(0, Math.min(lines - 1, inspect));
        /* a toy that writes its own raster() has bands the panel has not
         * read yet: say so instead of showing one empty frame band */
        if (!fence && /^\s*function\s+raster\s*\(/m.test(src))
          note = "this toy writes its own raster(line); Import adopts it";
      }

      function table(opts) {
        opts = opts || {};
        return R.toRaster(bands, {
          lines: lines,
          frame: opts.frame == null ? studio.render.currentFrame() : opts.frame,
          base: baseRegs()
        });
      }

      /* ---- the mini frame and the preview ------------------------------- */

      /* The bands as a strip, one row a line, in the frame's own order. */
      function drawMini() {
        var c = $("scn-mini");
        if (!c) return;
        c.width = 48;
        c.height = lines;
        var ctx = c.getContext("2d");
        if (!ctx) return;
        ctx.fillStyle = "#08090c";
        ctx.fillRect(0, 0, 48, lines);
        var s = sorted();
        for (var i = 0; i < s.length; i++) {
          var b = s[i];
          ctx.fillStyle = b.enabled === false ? "rgba(90,90,90,0.35)"
                                              : bandShade(b, i);
          ctx.fillRect(0, b.from, 48, b.to - b.from + 1);
          if (b.from < b.to) {
            ctx.fillStyle = "rgba(0,0,0,0.55)";
            ctx.fillRect(0, b.to, 48, 1);
          }
        }
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.fillRect(0, Math.max(0, Math.min(lines - 1, inspect)), 48, 1);
      }

      /* One hue a band so the strip reads as bands rather than one wall of
       * colour; a CR that blanks the background is black and sprites off
       * dims it. */
      function bandShade(b, index) {
        if (b.cr != null && (b.cr & R.CR_BG) === 0) return "rgba(20,20,26,0.95)";
        var hue = (index * 47 + 200) % 360;
        var dim = b.cr != null && (b.cr & R.CR_SPRITES) === 0;
        return "hsl(" + hue + ",55%," + (dim ? 26 : 44) + "%)";
      }

      function drawPreview() {
        var c = $("scn-preview");
        if (!c) return;
        var st = studio.render.state();
        if (!st) {
          if ($("scn-preview-note"))
            $("scn-preview-note").textContent = "no frame yet — Run the toy";
          return;
        }
        var frame;
        try { frame = R.render(bands, st, { lines: lines }); }
        catch (e) {
          if ($("scn-preview-note"))
            $("scn-preview-note").textContent = "preview: " +
              (e.code ? e.code + ": " : "") + e.message;
          return;
        }
        c.width = frame.width;
        c.height = frame.height;
        var ctx = c.getContext("2d");
        if (!ctx) return;
        try {
          var img = ctx.createImageData(frame.width, frame.height);
          for (var i = 0; i < frame.pixels.length; i++) img.data[i] = frame.pixels[i];
          ctx.putImageData(img, 0, 0);
        } catch (e) { /* a canvas that cannot draw leaves the rows readable */ }
        if ($("scn-preview-note"))
          $("scn-preview-note").textContent = "the bands over this frame · " +
            frame.width + "×" + frame.height;
      }

      /* ---- the band rows ------------------------------------------------ */

      function bandRow(b, index) {
        var row = el("div", "scn-band");
        row.id = "scn-band-" + b.id;
        row.appendChild(el("span", "scn-num", String(index + 1)));

        var name = el("input", "scn-name");
        name.type = "text";
        name.value = b.name || "";
        name.setAttribute("aria-label", "Band " + (index + 1) + " name");
        name.addEventListener("input", function () { b.name = name.value; draw(false); });
        row.appendChild(name);

        var on = el("input", "scn-on");
        on.type = "checkbox";
        on.checked = b.enabled !== false;
        on.id = "scn-en-" + b.id;
        var label = el("label", "scn-check");
        label.appendChild(on);
        label.appendChild(el("span", null, " Enabled"));
        on.addEventListener("change", function () {
          b.enabled = !!on.checked;
          error = ""; note = "";
          draw();
        });
        row.appendChild(label);

        var from = numberInput(b.from, "Band " + (index + 1) + " first line");
        from.addEventListener("change", function () {
          setRange(b, Number(from.value), b.to);
        });
        row.appendChild(from);
        row.appendChild(el("span", "scn-dash", "–"));
        var to = numberInput(b.to, "Band " + (index + 1) + " last line");
        to.addEventListener("change", function () { setRange(b, b.from, Number(to.value)); });
        row.appendChild(to);

        row.appendChild(rowButton("↑", "Move up", function () { R.moveUp(bands, b, lines); }));
        row.appendChild(rowButton("↓", "Move down", function () { R.moveDown(bands, b, lines); }));
        row.appendChild(rowButton("⧉", "Duplicate into the next free lines",
          function () { R.duplicate(bands, b, lines); }));

        var edit = el("button", "btn-mini scn-edit", "Edit");
        edit.type = "button";
        edit.title = "Edit this band's controls in the inspector below";
        edit.addEventListener("click", function () { select(b.id); });
        row.appendChild(edit);

        var controls = R.controlsOf(b).total;
        row.appendChild(el("span", "scn-ctl",
          controls + " control" + (controls === 1 ? "" : "s")));

        var budget = R.budget(b);
        row.appendChild(el("span", "scn-cost" + (budget.over ? " is-over" : ""),
          budget.cycles + " / " + budget.budget + " (" +
          Math.round(budget.share * 100) + "%)"));

        row.appendChild(rowMenu(b));
        return row;
      }

      function numberInput(value, aria) {
        var e = el("input", null);
        e.type = "number";
        e.value = String(value);
        e.setAttribute("min", "0");
        e.setAttribute("max", String(lines - 1));
        e.setAttribute("aria-label", aria);
        return e;
      }

      function rowButton(label, title, fn) {
        var b = el("button", "btn-mini scn-move", label);
        b.type = "button";
        b.title = title;
        b.addEventListener("click", function () {
          try { fn(); error = ""; note = ""; }
          catch (e) { fail(e); return; }
          draw();
        });
        return b;
      }

      /* ppu.toys' row menu: the actions that are not worth a button. */
      function rowMenu(band) {
        var sel = el("select", "scn-menu");
        sel.setAttribute("aria-label", "Band menu");
        var add = function (value, text) {
          var o = el("option", null, text);
          o.value = value;
          sel.appendChild(o);
        };
        add("", "⋯");
        add("toggle", band.enabled === false ? "Enable" : "Disable");
        add("split", "Split at the inspected line");
        add("delete", "Delete");
        sel.value = "";
        sel.addEventListener("change", function () {
          var what = sel.value;
          sel.value = "";
          if (!what) return;
          try {
            if (what === "toggle") band.enabled = band.enabled === false;
            else if (what === "delete") {
              R.remove(bands, band);
              if (selectedId === band.id) selectedId = null;
            } else if (what === "split") {
              var made = R.splitAt(bands, inspect, lines);
              selectedId = made.id;
            }
            error = ""; note = "";
          } catch (e) { fail(e); return; }
          draw();
        });
        return sel;
      }

      function setRange(band, from, to) {
        var before = { from: band.from, to: band.to };
        band.from = from;
        band.to = to;
        try {
          R.checkBand(band, lines);
          var clash = problemsAll().filter(function (p) {
            return p.code === "raster-line-full" && p.band === band;
          });
          if (clash.length) throw { code: clash[0].code, message: clash[0].message };
          error = ""; note = "";
        } catch (e) {
          band.from = before.from;
          band.to = before.to;
          fail(e);
          return;
        }
        draw();
      }

      function select(id) {
        selectedId = id;
        var b = find(id);
        if (b) inspect = b.from;
        error = ""; note = "";
        draw();
      }

      /* ---- the inspector ("Apply edits to") ----------------------------- */

      function drawTarget() {
        var sel = $("scn-target");
        if (!sel) return;
        clear(sel);
        var s = sorted();
        for (var i = 0; i < s.length; i++) {
          var o = el("option", null, (i + 1) + " · " + (s[i].name || "band") +
                     " · " + s[i].from + "–" + s[i].to);
          o.value = s[i].id;
          sel.appendChild(o);
        }
        var cur = selected();
        sel.value = cur ? cur.id : "";
      }

      function drawInspector() {
        var b = selected();
        if ($("scn-edit-band"))
          $("scn-edit-band").textContent = b
            ? (b.name || "band") + " · " + b.from + "–" + b.to
            : "no band";
        if (!b) return;

        for (var i = 0; i < NUMERIC.length; i++) {
          (function (def) {
            var input = $(def.input), box = $(def.box);
            if (!input || !box) return;
            var value = b[def.key];
            box.checked = value != null;
            input.value = value != null ? String(value) : "0";
            input.disabled = value == null;
            input.__band = b; input.__key = def.key;
          })(NUMERIC[i]);
        }
        if ($("scn-bg-on")) {
          $("scn-bg-on").checked = b.cr == null ? true : !!(b.cr & R.CR_BG);
          $("scn-bg-on").disabled = b.cr == null;
        }
        if ($("scn-spr-on")) {
          $("scn-spr-on").checked = b.cr == null ? true : !!(b.cr & R.CR_SPRITES);
          $("scn-spr-on").disabled = b.cr == null;
        }
        if ($("scn-fx")) $("scn-fx").value = b.fx ? b.fx.kind : "";
        if ($("scn-fx-note"))
          $("scn-fx-note").textContent = b.fx ? fxText(b.fx) : "no effect";

        var cram = $("scn-cram");
        if (cram) {
          clear(cram);
          var writes = b.cram || [];
          for (var k = 0; k < writes.length; k++)
            cram.appendChild(el("code", "scn-word",
              "$" + writes[k][0].toString(16).toUpperCase() + " → $" +
              writes[k][1].toString(16).toUpperCase().padStart(3, "0")));
          if (!writes.length) cram.appendChild(el("span", "scn-dim", "none"));
        }
      }

      function fxText(fx) {
        if (fx.kind === "gradient")
          return "gradient $" + (fx.from || 0).toString(16).toUpperCase() +
                 " → $" + (fx.to || 0).toString(16).toUpperCase() +
                 " · palette " + (fx.palette || 0) + " colour " +
                 (fx.entry == null ? 1 : fx.entry);
        if (fx.kind === "wobble")
          return "wobble ±" + (fx.amplitude == null ? 4 : fx.amplitude) +
                 " px · period " + (fx.period == null ? 32 : fx.period) +
                 " lines · speed " + (fx.speed || 0);
        return "parallax " + (fx.speed || 0) + " px/frame";
      }

      /* One inspector control: the checkbox says whether the band writes it
       * at all (absent means "hold what the previous band left"). */
      function commitNumber(input, box) {
        var b = input.__band;
        var key = input.__key;
        if (!b || !key) return;
        var before = JSON.stringify(b);
        try {
          if (box.checked) b[key] = Number(input.value) | 0;
          else delete b[key];
          R.checkBand(b, lines);
          R.assertList(bands, lines);
          error = ""; note = "";
        } catch (e) {
          var back = JSON.parse(before);
          for (var k in b) if (!Object.prototype.hasOwnProperty.call(back, k)) delete b[k];
          for (var k2 in back) b[k2] = back[k2];
          fail(e);
          return;
        }
        draw();
      }

      /* ---- the head, the note and the whole panel ------------------------ */

      function drawHead() {
        if ($("scn-frame-note"))
          $("scn-frame-note").textContent = "Full frame · lines 0-" + (lines - 1);
        if ($("scn-line")) {
          $("scn-line").value = String(inspect);
          $("scn-line").setAttribute("max", String(lines - 1));
        }
        if ($("scn-line-slider")) {
          $("scn-line-slider").value = String(inspect);
          $("scn-line-slider").setAttribute("max", String(lines - 1));
        }
        if ($("scn-lines")) $("scn-lines").value = String(lines);
        if ($("scn-budget")) {
          var worst = null;
          for (var i = 0; i < bands.length; i++) {
            if (bands[i].enabled === false) continue;
            var c = R.budget(bands[i]);
            if (!worst || c.cycles > worst.cycles) worst = c;
          }
          $("scn-budget").textContent = worst
            ? "worst line " + worst.cycles + " / " + worst.budget + " cycles (" +
              Math.round(worst.share * 100) + "%)"
            : "no live band";
        }
      }

      function drawNote() {
        var host = $("scn-note");
        if (!host) return;
        if (error) { host.textContent = error; host.className = "scn-note is-error"; return; }
        var problems = problemsAll();
        if (problems.length) {
          host.textContent = problems[0].code + " · " + problems[0].message;
          host.className = "scn-note is-error";
          return;
        }
        host.className = "scn-note";
        if (note) { host.textContent = note; return; }
        var b = bandAt(inspect);
        var budget = b ? R.budget(b) : null;
        host.textContent = "line " + inspect + " · " +
          (b ? (b.name || "band") : "no band") +
          (budget ? " · " + budget.cycles + " of " + budget.budget +
                    " cycles from handler entry (" +
                    Math.round(budget.share * 100) + "% of the blank)" : "");
      }

      function draw(rebuild) {
        if (!ready()) return;
        sync();
        drawHead();
        if (rebuild !== false) {
          var host = $("scn-bands");
          if (host) {
            clear(host);
            var s = sorted();
            for (var i = 0; i < s.length; i++) host.appendChild(bandRow(s[i], i));
          }
        }
        drawTarget();
        drawInspector();
        drawMini();
        drawPreview();
        drawNote();
      }

      /* ---- the actions --------------------------------------------------- */

      /* Add a band at the inspected line: the band covering that line gives
       * up its top `at..end` (or its bottom, when `at` is inside it), and the
       * new band takes it.  The whole candidate list is checked before any of
       * it is written, so a refused add leaves the bands exactly as they
       * were. */
      function addBand(readyId, at) {
        if (!ready()) return null;
        sync();
        if (at == null) at = inspect;
        at = Math.max(0, Math.min(lines - 1, at | 0));
        var cover = bandAt(at);
        var atStart = !!(cover && at === cover.from);
        /* the new band runs to the end of the band it splits — the hardware
         * holds its values from there down — or 16 lines in a gap */
        var end = cover ? cover.to : Math.min(lines - 1, at + 15);
        var made, next = bands.slice();
        try {
          if (readyId) made = R.readyBand(readyId, at, end, lines);
          else {
            var seed = cover || { bxr: 0, byr: 0, cr: 0xC0 };
            made = R.newBand({ name: "", from: at, to: end,
                               bxr: seed.bxr == null ? 0 : seed.bxr }, lines);
          }
          if (cover) {
            var cut = copyBand(cover);
            if (atStart) cut.from = end + 1;
            else cut.to = at - 1;
            var i = next.indexOf(cover);
            if (cut.from > cut.to) next.splice(i, 1);
            else next[i] = cut;
          }
          next.push(made);
          R.assertList(next, lines);
          bands = next;
          selectedId = made.id;
          error = ""; note = "added band at line " + at;
        } catch (e) { fail(e); return null; }
        draw();
        return made;
      }

      function setLines(n) {
        if (R.LINES_CHOICES.indexOf(n) < 0) {
          fail({ code: "raster-lines", message: "the display is 224 or 240 " +
                 "lines (#67); " + n + " is not one of them" });
          return;
        }
        lines = n;
        inspect = Math.min(inspect, lines - 1);
        for (var i = 0; i < bands.length; i++)
          if (bands[i].to > lines - 1) bands[i].to = lines - 1;
        draw();
      }

      function apply() {
        sync();
        var problems = problemsAll();
        if (problems.length) {
          fail({ code: problems[0].code, message: problems[0].message });
          throw { code: problems[0].code, message: problems[0].message };
        }
        var source = sourceText();
        var text;
        try { text = R.withFence(source, bands, { lines: lines }); }
        catch (e) { fail(e); throw e; }
        if (text === source) {
          lastFence = fenceOf(source);
          note = "main.lua already holds these bands";
          draw();
          return [];
        }
        studio.selectFile("main.lua");
        studio.setEditorText(text);
        lastFence = fenceOf(sourceText());
        error = "";
        note = "wrote " + bands.length + " band" +
               (bands.length === 1 ? "" : "s") + " into main.lua";
        draw();
        return ["main.lua"];
      }

      function importToy() {
        var runtime = studio.render.runtime ? studio.render.runtime() : null;
        var live = runtime && runtime.lastRaster;
        try {
          if (!live) throw { code: "raster-import", message: "the toy has no " +
            "raster table yet: run a frame whose raster() writes a line, " +
            "then import" };
          var got = R.fromRaster(live, { lines: lines });
          if (!got.length) throw { code: "raster-import",
                                   message: "the toy's raster table is empty" };
          bands = got;
          selectedId = bands[0].id;
          error = "";
          note = "imported " + bands.length + " band" +
                 (bands.length === 1 ? "" : "s") + " from the toy's own table";
        } catch (e) { fail(e); return []; }
        draw();
        return bands;
      }

      function addColour() {
        var b = selected();
        if (!b) return;
        var addr = Number($("scn-cram-addr") && $("scn-cram-addr").value) | 0;
        var word = Number($("scn-cram-word") && $("scn-cram-word").value) | 0;
        var before = b.cram ? b.cram.map(function (w) { return [w[0], w[1]]; }) : null;
        b.cram = (b.cram || []).concat([[addr, word]]);
        try {
          R.checkBand(b, lines);
          R.assertList(bands, lines);
          error = "";
        } catch (e) {
          if (before) b.cram = before; else delete b.cram;
          fail(e);
          return;
        }
        note = "colour write $" + addr.toString(16).toUpperCase() +
               " → $" + word.toString(16).toUpperCase();
        draw();
      }

      function clearColours() {
        var b = selected();
        if (!b) return;
        delete b.cram;
        try { R.checkBand(b, lines); error = ""; }
        catch (e) { fail(e); return; }
        note = "colour writes cleared";
        draw();
      }

      /* ---- the DOM wiring ------------------------------------------------ */

      function bind() {
        if (bound) return;
        bound = true;
        on("scn-add", "click", function () { addBand(null); });
        on("scn-ready", "change", function () {
          var sel = $("scn-ready");
          var v = sel.value;
          sel.value = "";
          if (v) addBand(v);
        });
        on("scn-apply", "click", function () {
          try { apply(); } catch (e) { /* fail() has shown it */ }
        });
        on("scn-import", "click", function () { importToy(); });
        on("scn-target", "change", function () { select($("scn-target").value); });
        on("scn-lines", "change", function () { setLines(Number($("scn-lines").value)); });
        on("scn-line", "input", function () { pointAt($("scn-line").value); });
        on("scn-line-slider", "input", function () { pointAt($("scn-line-slider").value); });
        on("scn-bg-on", "change", function () {
          toggleBit(R.CR_BG, $("scn-bg-on").checked);
        });
        on("scn-spr-on", "change", function () {
          toggleBit(R.CR_SPRITES, $("scn-spr-on").checked);
        });
        on("scn-fx", "change", function () { setEffect($("scn-fx").value); });
        on("scn-cram-add", "click", function () { addColour(); });
        on("scn-cram-clear", "click", function () { clearColours(); });
        for (var i = 0; i < NUMERIC.length; i++) {
          (function (def) {
            on(def.input, "change", function () {
              commitNumber($(def.input), $(def.box));
            });
            on(def.box, "change", function () {
              $(def.input).disabled = !$(def.box).checked;
              commitNumber($(def.input), $(def.box));
            });
          })(NUMERIC[i]);
        }
      }

      function on(id, type, fn) {
        var e = $(id);
        if (e) e.addEventListener(type, fn);
      }

      function pointAt(value) {
        inspect = Math.max(0, Math.min(lines - 1, Math.round(Number(value) || 0)));
        var b = bandAt(inspect);
        if (b) selectedId = b.id;
        error = ""; note = "";
        draw();
      }

      function toggleBit(bit, isOn) {
        var b = selected();
        if (!b) return;
        var cr = b.cr == null ? baseRegs().cr : b.cr;
        b.cr = isOn ? (cr | bit) : (cr & ~bit);
        try { R.checkBand(b, lines); R.assertList(bands, lines); error = ""; }
        catch (e) { fail(e); return; }
        draw();
      }

      function setEffect(kind) {
        var b = selected();
        if (!b) return;
        try {
          if (!kind) {
            delete b.fx;
            if (b.bxr == null && b.byr == null && b.cr == null && !b.cram)
              b.bxr = 0;
          } else if (kind === "gradient") {
            b.fx = { kind: "gradient", palette: 0, entry: 1, from: 0x000, to: 0x1FF };
          } else if (kind === "wobble") {
            b.fx = { kind: "wobble", amplitude: 4, period: 32, speed: 0 };
          } else {
            b.fx = { kind: "parallax", speed: 1 };
          }
          R.checkBand(b, lines);
          R.assertList(bands, lines);
          error = "";
        } catch (e) { fail(e); return; }
        draw();
      }

      /* ---- the evidence surface ------------------------------------------ */

      var api = {
        state: function () {
          sync();
          return {
            lines: lines,
            inspect: inspect,
            selected: selected() ? selected().id : null,
            error: error,
            note: note,
            problems: problemsAll().map(function (p) {
              return { code: p.code, message: p.message };
            }),
            bands: sorted().map(function (b, i) {
              var budget = R.budget(b);
              return {
                number: i + 1, id: b.id, name: b.name,
                enabled: b.enabled !== false, from: b.from, to: b.to,
                controls: R.controlsOf(b).total,
                bxr: b.bxr, byr: b.byr, cr: b.cr,
                effect: b.fx ? b.fx.kind : null,
                cycles: budget.cycles, budget: budget.budget,
                share: budget.share, over: budget.over
              };
            })
          };
        },
        bands: function () { sync(); return bands; },
        setLines: setLines,
        addBand: function (readyId, at) { return addBand(readyId || null, at); },
        removeBand: function (id) {
          var b = find(id);
          if (!b) return null;
          try { R.remove(bands, b); if (selectedId === id) selectedId = null; }
          catch (e) { fail(e); return null; }
          error = ""; draw();
          return b.id;
        },
        move: function (id, dir) {
          var b = find(id);
          if (!b) return null;
          try { if (dir === "down") R.moveDown(bands, b, lines);
                else R.moveUp(bands, b, lines); }
          catch (e) { fail(e); return null; }
          error = ""; draw();
          return b.id;
        },
        duplicate: function (id) {
          var b = find(id);
          if (!b) return null;
          var copy;
          try { copy = R.duplicate(bands, b, lines); }
          catch (e) { fail(e); return null; }
          selectedId = copy.id;
          error = ""; draw();
          return copy.id;
        },
        setBand: function (id, spec) {
          var b = find(id);
          if (!b) throw { code: "raster-band-order", message: "no band " + id };
          var before = JSON.stringify(b);
          for (var k in spec) {
            if (!Object.prototype.hasOwnProperty.call(spec, k)) continue;
            if (spec[k] === null) delete b[k];
            else b[k] = spec[k];
          }
          try { R.checkBand(b, lines); R.assertList(bands, lines); }
          catch (e) {
            var back = JSON.parse(before);
            for (var a in b) if (!Object.prototype.hasOwnProperty.call(back, a)) delete b[a];
            for (var c in back) b[c] = back[c];
            fail(e);
            throw e;
          }
          error = ""; note = "";
          draw();
          return b;
        },
        select: select,
        inspectAt: function (line) { pointAt(line); return inspect; },
        table: function (opts) { sync(); return table(opts); },
        frame: function () {
          sync();
          var st = studio.render.state();
          if (!st) return null;
          return R.render(bands, st, { lines: lines });
        },
        apply: apply,
        importToy: importToy,
        lua: function () { sync(); return R.toLua(bands, { lines: lines }); },
        price: function () { return R.PRICE; },
        /* a toy opened or reloaded underneath the panel */
        invalidate: function () { lastFence = null; bands = []; draw(); },
        drawn: function () { return !!$("scn-bands") && $("scn-bands").children.length > 0; }
      };

      bind();
      studio.panels.register({
        id: "scanlines",
        label: "SCANLINES",
        group: "chip",
        chapter: "raster",
        gloss: "Bands down the frame: what the line interrupt writes, and what it costs.",
        draw: function () { draw(); },
        api: api
      });
    }
  });
})(typeof self !== "undefined" ? self : this);
