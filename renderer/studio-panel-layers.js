/*
 * studio-panel-layers.js — the LAYERS panel (card #93, part E), a module of
 * the studio since #102.
 *
 * ppu.toys' COMPOSE panel is the working example: previews of the main and
 * sub screens, "out = (main + sub)", a layer table BG1-3/OBJ/Backdrop x
 * MAIN/SUB/MATH, BRIGHTNESS 0-15 with a curve, OPERATION add/sub/half,
 * ADDEND, FIXED COLOR and a Registers fold.  The PC Engine has no sub
 * screen, no colour math and no brightness register (HuC6260 VCE), so this
 * panel is the PCE's answer rather than a port:
 *
 *   - previews of the backdrop (CRAM $000), the background, the sprites and
 *     the composed frame — every one of them renderer/pce-sprites.js drawing
 *     the running frame with one CR value (or one CRAM table) changed, never
 *     a second compositor;
 *   - the stacking order spelled out (backdrop → SPBG=0 sprites → background
 *     → SPBG=1 sprites; lower SAT index wins; colour 0 transparent);
 *   - a layer table whose on/off are the VDC's own bits — BB (CR bit 7) and
 *     SB (CR bit 6) — through the studio's one layer state (the same bits the
 *     output column's Layers controls write, #78), and one row per sprite
 *     with its SPBG bit (SAT word 3 bit 7), which this panel can flip in the
 *     view (the toy's SAT is untouched, like the pokes);
 *   - a FADE helper.  The PCE fades by rewriting palettes: pick palettes, a
 *     target (black, white or any of the VCE's 512 colours), a step count and
 *     a curve; the panel computes the stepped palettes, previews them, and
 *     writes them out as toy code (a generated main.lua block, like
 *     pce-pokes.js's) or as a fade.json record beside the toy;
 *   - a Registers fold with CR and the SAT priority bits;
 *   - one line saying what the chip cannot do: no colour blending —
 *     transparency is faked with flicker (#28) or a dither.
 *
 * The model is renderer/pce-layers.js.  This module draws it and owns only
 * the panel's own state: which sprite priorities are overridden in the view,
 * and the fade spec.
 */
(function (root) {
  "use strict";
  var P = root.PCEStudio = root.PCEStudio || {};
  P.studioPanelModules = P.studioPanelModules || [];

  P.studioPanelModules.push({
    id: "layers",
    register: function (studio) {
      var L = P.layers;
      var built = false;
      var error = "";
      var front = {};              /* slot -> true/false: the view's SPBG */
      var fade = {
        bg: {}, spr: {},           /* chosen palettes (all by default) */
        target: "black",           /* black | white | colour */
        colour: 0x1FF,
        steps: L ? L.DEFAULT_STEPS : 16,
        curve: "linear",
        at: 0
      };
      for (var b = 0; b < 16; b++) fade.bg[b] = true;
      for (var s = 0; s < 16; s++) fade.spr[s] = true;
      var plan = null;             /* the last captured fade plan */
      var planAt = -1;             /* frame it was captured on */
      var cacheKey = "";
      var slotKey = "";

      function doc() { return studio.document; }

      function el(tag, cls, id, text) {
        var e = doc().createElement(tag);
        if (cls) e.className = cls;
        if (id) e.id = id;
        if (text != null) e.textContent = text;
        return e;
      }

      function button(id, label, title, onClick) {
        var e = el("button", "btn-mini", id, label);
        e.type = "button";
        if (title) { e.title = title; e.setAttribute("aria-label", title); }
        e.addEventListener("click", function () {
          try { onClick(); }
          catch (err) { fail(err); }
        });
        return e;
      }

      function fail(e) {
        error = (e && e.code ? e.code + ": " : "") +
                (e && e.message ? e.message : e);
        var note = studio.$("lay-note");
        if (note) note.textContent = error;
        studio.toast(error);
        return error;
      }

      function mask() {
        var m = studio.layers ? studio.layers() : { bg: true, sprites: true };
        return { bg: m.bg !== false, sprites: m.sprites !== false,
                 viewOnly: !!m.viewOnly };
      }

      function spec() {
        var palettes = [], p;
        for (p = 0; p < 16; p++)
          if (fade.bg[p]) palettes.push({ kind: "background", palette: p });
        for (p = 0; p < 16; p++)
          if (fade.spr[p]) palettes.push({ kind: "sprite", palette: p });
        var target = fade.target === "white" ? L.WHITE
                   : fade.target === "colour" ? fade.colour : L.BLACK;
        return { palettes: palettes, target: target, steps: fade.steps,
                 curve: fade.curve };
      }

      function state() { return studio.render.state(); }

      /* ---- painting a frame into a canvas ------------------------------- */
      function paint(canvas, frame) {
        if (!canvas || !frame) return;
        var w = frame.width, h = frame.height;
        if (canvas.width !== w) canvas.width = w;
        if (canvas.height !== h) canvas.height = h;
        var ctx = canvas.getContext("2d");
        if (!ctx || typeof ctx.createImageData !== "function") return;
        var img = ctx.createImageData(w, h);
        var rgb = frame.pixels, d = img.data;
        for (var i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
          d[j] = rgb[i]; d[j + 1] = rgb[i + 1]; d[j + 2] = rgb[i + 2];
          d[j + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
      }

      /* ---- the DOM ------------------------------------------------------ */
      function build() {
        if (built || !L) return;
        var host = studio.$("panel-layers");
        if (!host) return;

        /* the four previews */
        var prevs = el("div", "lay-prevs");
        var cells = [
          ["backdrop", "BACKDROP", "CRAM $000 — colour 0 of the background"],
          ["bg", "BG", "the background layer alone (BB on, sprites off)"],
          ["sprites", "SPRITES", "the sprites alone (SB on, background off)"],
          ["out", "OUT", "the composed frame — what the output shows"]
        ];
        for (var i = 0; i < cells.length; i++) {
          var cell = el("div", "lay-prev");
          var c = el("canvas", "", "lay-prev-" + cells[i][0]);
          c.width = 256; c.height = 224;
          c.setAttribute("aria-label", cells[i][1] + " preview");
          cell.appendChild(c);
          cell.appendChild(el("b", "", null, cells[i][1]));
          cell.appendChild(el("span", "", null, cells[i][2]));
          prevs.appendChild(cell);
        }
        host.appendChild(prevs);

        /* the stacking order */
        var order = el("div", "lay-order");
        order.appendChild(el("div", "scr-head", null,
                             "Stacking order, top of the list drawn last"));
        var list = el("ol", "lay-stacklist");
        var stack = L.stack();
        for (i = stack.length - 1; i >= 0; i--) {
          var li = el("li", "lay-stackrow");
          li.appendChild(el("b", "", null, stack[i].title));
          li.appendChild(el("span", "", null, stack[i].text));
          list.appendChild(li);
        }
        order.appendChild(list);
        order.appendChild(el("div", "lay-rule", null,
          "Lower SAT index wins among sprites; sprite pixel colour 0 is " +
          "transparent; a background pixel's colour 0 shows the backdrop."));
        host.appendChild(order);

        /* the layer table */
        var table = el("div", "lay-table");
        table.appendChild(el("div", "scr-head", null, "Layers"));
        var head = el("div", "lay-row lay-headrow");
        head.appendChild(el("span", "", null, "layer"));
        head.appendChild(el("span", "", null, "shown"));
        head.appendChild(el("span", "", null, "where the bit lives"));
        table.appendChild(head);
        var r1 = el("div", "lay-row");
        r1.appendChild(el("span", "", null, "Backdrop"));
        r1.appendChild(el("span", "lay-always", null, "always"));
        r1.appendChild(el("code", "", null, "CRAM $000"));
        table.appendChild(r1);
        var r2 = el("div", "lay-row");
        r2.appendChild(el("span", "", null, "Background"));
        var bgBox = el("input", "", "lay-on-bg");
        bgBox.type = "checkbox"; bgBox.checked = true;
        bgBox.setAttribute("aria-label", "Background on (CR bit 7, BB)");
        var bgWrap = el("label", "scr-check");
        bgWrap.appendChild(bgBox);
        r2.appendChild(bgWrap);
        r2.appendChild(el("code", "", null, "CR bit 7 (BB) · R05 $80"));
        table.appendChild(r2);
        var r3 = el("div", "lay-row");
        r3.appendChild(el("span", "", null, "Sprites"));
        var spBox = el("input", "", "lay-on-spr");
        spBox.type = "checkbox"; spBox.checked = true;
        spBox.setAttribute("aria-label", "Sprites on (CR bit 6, SB)");
        var spWrap = el("label", "scr-check");
        spWrap.appendChild(spBox);
        r3.appendChild(spWrap);
        r3.appendChild(el("code", "", null, "CR bit 6 (SB) · R05 $40"));
        table.appendChild(r3);
        bgBox.addEventListener("click", function () { toggle("bg", bgBox.checked); });
        spBox.addEventListener("click", function () { toggle("sprites", spBox.checked); });
        var spriteRows = el("div", "lay-sprites", "lay-sprites");
        table.appendChild(spriteRows);
        var resetRow = el("div", "scr-line");
        resetRow.appendChild(button("lay-spbg-reset", "reset priorities",
          "Drop the view's SPBG overrides: the SAT's own bits again",
          function () { front = {}; cacheKey = ""; redraw(); }));
        resetRow.appendChild(el("span", "scr-hint", null,
          "the view's copy: the toy's SAT is not touched"));
        table.appendChild(resetRow);
        host.appendChild(table);

        /* the fade helper */
        var fadeBox = el("div", "lay-fade");
        fadeBox.appendChild(el("div", "scr-head", null, "Fade — the PCE fades by rewriting palettes"));
        var chips = el("div", "lay-chips");
        chips.appendChild(el("span", "scr-zoomlabel", null, "background"));
        for (i = 0; i < 16; i++) {
          (function (n) {
            chips.appendChild(button("lay-fade-bg-" + n, String(n),
              "Fade background palette " + n, function () {
                fade.bg[n] = !fade.bg[n]; cacheKey = ""; redraw();
              }));
          })(i);
        }
        chips.appendChild(el("span", "scr-zoomlabel", null, "sprite"));
        for (i = 0; i < 16; i++) {
          (function (n) {
            chips.appendChild(button("lay-fade-spr-" + n, "S" + n,
              "Fade sprite palette " + n, function () {
                fade.spr[n] = !fade.spr[n]; cacheKey = ""; redraw();
              }));
          })(i);
        }
        chips.appendChild(button("lay-fade-all", "all",
          "Choose all 32 palettes", function () {
            for (var n = 0; n < 16; n++) { fade.bg[n] = true; fade.spr[n] = true; }
            cacheKey = ""; redraw();
          }));
        chips.appendChild(button("lay-fade-none", "none",
          "Choose no palette", function () {
            for (var n = 0; n < 16; n++) { fade.bg[n] = false; fade.spr[n] = false; }
            cacheKey = ""; redraw();
          }));
        fadeBox.appendChild(chips);

        var opts = el("div", "scr-line");
        opts.appendChild(el("span", "scr-zoomlabel", null, "target"));
        var targetSel = el("select", "", "lay-fade-target");
        targetSel.setAttribute("aria-label", "Fade target");
        [["black", "black"], ["white", "white"],
         ["colour", "a colour"]].forEach(function (pair) {
          var o = el("option", "", null, pair[1]);
          o.value = pair[0];
          targetSel.appendChild(o);
        });
        targetSel.value = "black";
        targetSel.addEventListener("change", function () {
          fade.target = String(targetSel.value);
          cacheKey = ""; redraw();
        });
        opts.appendChild(targetSel);
        var colourSel = el("select", "", "lay-fade-colour");
        colourSel.setAttribute("aria-label", "Fade target colour (the VCE's 512)");
        if (P.palettes) {
          var list = P.palettes.picker();
          for (i = 0; i < list.length; i++) {
            var o2 = el("option", "", null,
              "G" + list[i].g + " R" + list[i].r + " B" + list[i].b +
              " · $" + L.hex3(list[i].word));
            o2.value = String(list[i].word);
            colourSel.appendChild(o2);
          }
        }
        colourSel.addEventListener("change", function () {
          fade.colour = parseInt(colourSel.value, 10) || 0;
          cacheKey = ""; redraw();
        });
        opts.appendChild(colourSel);
        fadeBox.appendChild(opts);

        var opts2 = el("div", "scr-line");
        opts2.appendChild(el("span", "scr-zoomlabel", null, "steps"));
        var steps = el("input", "lay-num", "lay-fade-steps");
        steps.type = "number"; steps.value = String(fade.steps);
        steps.setAttribute("min", "2"); steps.setAttribute("max", "64");
        steps.addEventListener("change", function () {
          var n = parseInt(steps.value, 10);
          if (!(n >= 2 && n <= 64)) { fail({ code: "fade-steps",
            message: "a fade is 2..64 steps; got " + steps.value }); return; }
          fade.steps = n; fade.at = Math.min(fade.at, n);
          if (plan) plan = null;
          cacheKey = ""; redraw();
        });
        opts2.appendChild(steps);
        opts2.appendChild(el("span", "scr-zoomlabel", null, "curve"));
        var curveSel = el("select", "", "lay-fade-curve");
        curveSel.setAttribute("aria-label", "Fade curve");
        ["linear", "in", "out"].forEach(function (c) {
          var o3 = el("option", "", null, c === "in" ? "ease-in" :
                      c === "out" ? "ease-out" : "linear");
          o3.value = c;
          curveSel.appendChild(o3);
        });
        curveSel.addEventListener("change", function () {
          fade.curve = String(curveSel.value);
          if (plan) plan = null;
          cacheKey = ""; redraw();
        });
        opts2.appendChild(curveSel);
        fadeBox.appendChild(opts2);

        var acts = el("div", "scr-line");
        acts.appendChild(button("lay-fade-preview", "preview",
          "Capture the frame's palettes and draw every step",
          function () { capture(true); redraw(); }));
        acts.appendChild(button("lay-fade-write", "Write to toy",
          "Put the fade block into main.lua and run it",
          function () { writeToy(); }));
        acts.appendChild(button("lay-fade-asset", "Save as asset",
          "Record the stepped palettes as fade.json beside the toy",
          function () { saveAsset(); }));
        fadeBox.appendChild(acts);

        var atRow = el("div", "scr-line");
        atRow.appendChild(el("span", "scr-zoomlabel", null, "step"));
        var at = el("input", "lay-range", "lay-fade-at");
        at.type = "range"; at.value = "0";
        at.setAttribute("min", "0"); at.setAttribute("max", String(fade.steps));
        at.addEventListener("input", function () {
          fade.at = parseInt(at.value, 10) || 0;
          cacheKey = ""; redraw();
        });
        atRow.appendChild(at);
        atRow.appendChild(el("b", "", "lay-fade-stepno", "0"));
        fadeBox.appendChild(atRow);

        var prevRow = el("div", "lay-fade-prevrow");
        var strip = el("canvas", "lay-strip", "lay-fade-strip");
        strip.width = 16 * 18; strip.height = 160;
        strip.setAttribute("aria-label", "The stepped palettes, one column per step");
        prevRow.appendChild(strip);
        var stepCanvas = el("canvas", "lay-step", "lay-fade-step");
        stepCanvas.width = 256; stepCanvas.height = 224;
        stepCanvas.setAttribute("aria-label", "The composed frame at the chosen step");
        prevRow.appendChild(stepCanvas);
        fadeBox.appendChild(prevRow);
        fadeBox.appendChild(el("div", "lay-fade-note", "lay-fade-note",
          "preview captures the running frame's palettes; Write to toy " +
          "puts the block into main.lua."));
        host.appendChild(fadeBox);

        /* the registers fold */
        var fold = el("details", "lay-regs", "lay-regs");
        fold.appendChild(el("summary", "", null,
          "Registers — CR and the SAT priority bits"));
        var regs = el("pre", "table", "lay-regs-table");
        fold.appendChild(regs);
        host.appendChild(fold);

        /* the one line, and the status/error line above it */
        host.appendChild(el("div", "lay-fade-note", "lay-note", ""));
        host.appendChild(el("p", "lay-stat", "lay-note-line",
          "No colour blending on the PC Engine: transparency is faked with " +
          "flicker (#28) or a dither."));

        built = true;
        paintChips();
      }

      /* The palette chips' pressed state and the sprite rows (which change
       * with the frame's SAT) are painted, not rebuilt, except when the SAT
       * itself changes shape. */
      function paintChips() {
        var n;
        for (n = 0; n < 16; n++) {
          var b = studio.$("lay-fade-bg-" + n);
          if (b) b.classList.toggle("is-on", !!fade.bg[n]);
          var s = studio.$("lay-fade-spr-" + n);
          if (s) s.classList.toggle("is-on", !!fade.spr[n]);
        }
        var tsel = studio.$("lay-fade-target");
        if (tsel) tsel.value = fade.target;
        var csel = studio.$("lay-fade-colour");
        if (csel) csel.value = String(fade.target === "colour" ? fade.colour : L.WHITE);
        var csteps = studio.$("lay-fade-steps");
        if (csteps) csteps.value = String(fade.steps);
        var ccurve = studio.$("lay-fade-curve");
        if (ccurve) ccurve.value = fade.curve;
        var atEl = studio.$("lay-fade-at");
        if (atEl) { atEl.max = String(fade.steps); atEl.value = String(fade.at); }
        var no = studio.$("lay-fade-stepno");
        if (no) no.textContent = fade.at + " / " + fade.steps;
      }

      /* One row per non-empty SAT slot: its SPBG bit and the view's flip. */
      function paintSpriteRows(st) {
        var host = studio.$("lay-sprites");
        if (!host || !st) return;
        var sat = P.panels ? P.panels.satTable(st) : [];
        var key = sat.map(function (r) {
          return r.empty ? "-" : r.number + ":" + r.spbg;
        }).join(",");
        if (key !== slotKey) {
          while (host.firstChild) host.removeChild(host.firstChild);
          for (var i = 0; i < sat.length; i++) {
            if (sat[i].empty) continue;
            (function (row) {
              var line = el("div", "lay-row");
              line.appendChild(el("span", "", null, "Sprite " + row.number));
              var view = Object.prototype.hasOwnProperty.call(front, row.number)
                ? (front[row.number] ? 1 : 0) : row.spbg;
              line.appendChild(button("lay-spbg-" + row.number,
                view ? "in front of the BG" : "behind the BG",
                "SPBG (SAT word 3 bit 7): flip it in the view",
                function () {
                  front[row.number] =
                    !(Object.prototype.hasOwnProperty.call(front, row.number)
                      ? front[row.number] : !!row.spbg);
                  cacheKey = ""; slotKey = ""; redraw();
                }));
              line.appendChild(el("code", "", null,
                "slot " + row.number + " · pattern $" +
                row.pattern.toString(16).toUpperCase() + " · pal " +
                row.palette + " · SPBG " + view));
              host.appendChild(line);
            })(sat[i]);
          }
          slotKey = key;
        }
      }

      function toggle(name, on) {
        var box = studio.$(name === "bg" ? "lay-on-bg" : "lay-on-spr");
        if (box) box.checked = !!on;
        if (studio.setLayer) studio.setLayer(name, !!on);
        cacheKey = "";
        redraw();
      }

      /* ---- the fade plan ------------------------------------------------ */
      function capture(force) {
        var st = state();
        if (!st) throw Object.assign(new Error("no frame yet: run a toy first"),
                            { code: "no-frame" });
        if (!force && plan) return plan;
        plan = L.fadePlan(L.cramWords(st.cram), spec());
        planAt = studio.render.currentFrame();
        fade.at = Math.min(fade.at, plan.steps);
        cacheKey = "";        /* the fade previews are new: repaint them */
        redraw();
        return plan;
      }

      function ensurePlan() {
        if (plan) return plan;
        return capture(false);
      }

      function writeToy() {
        var p = ensurePlan();
        var f = studio.toy.file("main.lua");
        if (!f) throw Object.assign(new Error("the toy has no main.lua"),
                                    { code: "no-toy" });
        var text = L.writeBack(f.source, p);
        if (f.source === text) {
          error = "";
          return { changed: false, source: text, runs: null };
        }
        if (studio.toy.activeFile() === "main.lua") studio.setEditorText(text);
        else f.source = text;
        studio.toy.persist();
        var runs = null;
        try { runs = studio.render.runFrames(1, null, "lua"); }
        catch (e) { runs = null; }
        error = "";
        var note = studio.$("lay-fade-note");
        if (note) note.textContent = "wrote " + p.addresses.length +
          " entries · " + p.steps + " steps · " + p.curve +
          " curve into main.lua" + (runs ? " and ran it" : "");
        studio.toast("Fade written into main.lua");
        cacheKey = ""; redraw();
        return { changed: true, source: text, runs: runs };
      }

      function saveAsset() {
        var p = ensurePlan();
        var text = L.assetText(p);
        var files = studio.toy.files();
        var f = null;
        for (var i = 0; i < files.length; i++)
          if (files[i].name === "fade.json") f = files[i];
        var changed = false;
        if (!f) {
          f = { name: "fade.json", kind: "fade", source: text };
          files.push(f);
          changed = true;
        } else if (f.source !== text) {
          f.source = text;
          changed = true;
        }
        if (changed) {
          studio.toy.persist();
          studio.toy.refreshAssets();
        }
        error = "";
        var note = studio.$("lay-fade-note");
        if (note) note.textContent = changed
          ? "fade.json written beside the toy (" + p.steps +
            " steps, " + p.addresses.length + " entries)"
          : "fade.json is already this plan";
        studio.toast(changed ? "Saved fade.json" : "fade.json already saved");
        return { name: "fade.json", changed: changed, text: text };
      }

      function redraw() {
        if (studio.panels && studio.panels.refresh) studio.panels.refresh(true);
        else if (studio.panels && studio.panels.dirty) studio.panels.dirty();
      }

      /* ---- draw --------------------------------------------------------- */
      function draw(st) {
        if (!built) build();
        if (!built) return;
        paintChips();
        var note = studio.$("lay-note");
        if (!st) {
          if (note) note.textContent = "No frame yet — run a toy to see its " +
            "layers. The PC Engine has no colour blending: transparency is " +
            "faked with flicker (#28) or a dither.";
          return;
        }
        var m = mask();
        var frameNo = studio.render.currentFrame();
        var key = [frameNo, m.bg, m.sprites, JSON.stringify(front),
                   plan ? planAt + ":" + plan.steps + ":" + plan.curve + ":" +
                          plan.addresses.length : "noplan",
                   fade.at].join("|");
        if (key === cacheKey) return;
        cacheKey = key;

        var sat = L.satWith(st, front);
        var pv = L.previews(st, { mask: m, sat: sat });
        paint(studio.$("lay-prev-backdrop"), pv.backdrop);
        paint(studio.$("lay-prev-bg"), pv.bg);
        paint(studio.$("lay-prev-sprites"), pv.sprites);
        paint(studio.$("lay-prev-out"), pv.composed);

        paintSpriteRows(st);

        var box = studio.$("lay-on-bg");
        if (box) box.checked = m.bg;
        var box2 = studio.$("lay-on-spr");
        if (box2) box2.checked = m.sprites;

        var regs = studio.$("lay-regs-table");
        if (regs) regs.textContent = L.registers(st, front);

        /* the fade: the palette steps and the chosen step's frame */
        var strip = studio.$("lay-fade-strip");
        if (strip && plan) paintStrip(strip, plan);
        var stepCanvas = studio.$("lay-fade-step");
        if (stepCanvas && plan) {
          var k = Math.max(0, Math.min(plan.steps, fade.at));
          paint(stepCanvas, L.fadeFrameAt(st, plan, k,
                                          { mask: m, sat: sat }));
        }
        var no = studio.$("lay-fade-stepno");
        if (no) no.textContent = fade.at + " / " + fade.steps;

        if (note) note.textContent = error ||
          (plan ? "fade: " + plan.addresses.length + " CRAM entries · " +
                  plan.steps + " steps · " + plan.curve + " · captured at " +
                  "frame " + planAt
                : "");
      }

      /* The palette steps: one column per step, one row per entry (up to 16
       * of the plan's addresses).  A colour strip, not a frame — the frames
       * are the one beside it. */
      function paintStrip(canvas, p) {
        var ctx = canvas.getContext("2d");
        if (!ctx || typeof ctx.fillRect !== "function") return;
        var n = Math.min(16, p.addresses.length);
        var cols = p.steps + 1;
        var cw = Math.max(4, Math.floor(canvas.width / cols));
        var ch = Math.max(2, Math.floor(canvas.height / n));
        for (var k = 0; k < cols; k++) {
          for (var i = 0; i < n; i++) {
            ctx.fillStyle = L.css(p.frames[k][i]);
            ctx.fillRect(k * cw, i * ch, cw, ch);
          }
        }
      }

      /* ---- the evidence API -------------------------------------------- */
      function previewsNow() {
        var st = state();
        if (!st) throw Object.assign(new Error("no frame yet: run a toy first"),
                            { code: "no-frame" });
        return L.previews(st, { mask: mask(), sat: L.satWith(st, front) });
      }

      var api = {
        state: function () {
          var st = state();
          var sat = st && P.panels ? P.panels.satTable(st) : [];
          return {
            hasFrame: !!st,
            mask: mask(),
            cr: st ? (st.regs.CR == null ? 0 : st.regs.CR) : null,
            sprites: sat.filter(function (r) { return !r.empty; })
              .map(function (r) {
                return { slot: r.number, spbg: !!r.spbg,
                         front: Object.prototype.hasOwnProperty.call(front, r.number)
                           ? !!front[r.number] : !!r.spbg,
                         pattern: r.pattern, palette: r.palette,
                         viewOnly: Object.prototype.hasOwnProperty.call(front, r.number) };
              }),
            rows: st ? L.rows(st, front) : [],
            registers: st ? L.registers(st, front) : "",
            fade: { spec: spec(), at: fade.at, steps: fade.steps,
                    target: fade.target, colour: fade.colour,
                    curve: fade.curve, captured: planAt,
                    entries: plan ? plan.addresses.length : 0 },
            error: error
          };
        },
        previews: previewsNow,
        rows: function () {
          var st = state();
          return st ? L.rows(st, front) : [];
        },
        registers: function () {
          var st = state();
          return st ? L.registers(st, front) : "";
        },
        setSpritePriority: function (slot, isFront) {
          var st = state();
          if (!st) throw Object.assign(new Error("no frame yet: run a toy first"),
                            { code: "no-frame" });
          if (!(slot >= 0 && slot < 64 && slot === Math.floor(slot)))
            throw Object.assign(new Error("the SAT has 64 slots; got " + slot),
                            { code: "sprite-range" });
          front[slot] = !!isFront;
          cacheKey = ""; slotKey = "";
          redraw();
          return { slot: slot, front: !!isFront };
        },
        clearSpritePriorities: function () {
          front = {}; cacheKey = ""; slotKey = ""; redraw();
        },
        setFade: function (next) {
          next = next || {};
          /* Build the candidate on copies and let the model refuse it before
           * anything is assigned, so a bad spec leaves the panel as it was. */
          var cand = { bg: {}, spr: {}, target: fade.target,
                       colour: fade.colour, steps: fade.steps,
                       curve: fade.curve, at: fade.at };
          var n;
          for (n = 0; n < 16; n++) { cand.bg[n] = fade.bg[n]; cand.spr[n] = fade.spr[n]; }
          if (next.palettes != null) {
            for (n = 0; n < 16; n++) { cand.bg[n] = false; cand.spr[n] = false; }
            var list = next.palettes === "all" ? null : next.palettes;
            if (list === null) {
              for (n = 0; n < 16; n++) { cand.bg[n] = true; cand.spr[n] = true; }
            } else {
              for (var i = 0; i < list.length; i++) {
                var it = list[i] || {};
                if (it.kind === "background") cand.bg[it.palette] = true;
                else if (it.kind === "sprite") cand.spr[it.palette] = true;
                else throw Object.assign(new Error("a palette is 'background' or " +
                              "'sprite'; got " + it.kind), { code: "palette-kind" });
              }
            }
          }
          if (next.target != null) {
            if (next.target === "black" || next.target === "white" ||
                next.target === "colour") cand.target = next.target;
            else { cand.target = "colour"; cand.colour = next.target; }
          }
          if (next.steps != null) cand.steps = next.steps;
          if (next.curve != null) cand.curve = next.curve;
          if (next.at != null) cand.at = next.at;
          var target = cand.target === "white" ? L.WHITE
                     : cand.target === "colour" ? cand.colour : L.BLACK;
          var palettes = [];
          for (n = 0; n < 16; n++)
            if (cand.bg[n]) palettes.push({ kind: "background", palette: n });
          for (n = 0; n < 16; n++)
            if (cand.spr[n]) palettes.push({ kind: "sprite", palette: n });
          L.checkSpec({ palettes: palettes, target: target, steps: cand.steps,
                        curve: cand.curve });   /* refuse by code, here */
          fade = cand;
          fade.steps = Math.max(2, Math.min(64, Math.round(fade.steps)));
          fade.at = Math.max(0, Math.min(fade.steps, fade.at | 0));
          plan = null; planAt = -1;
          cacheKey = "";
          redraw();
          return spec();
        },
        fadeSpec: spec,
        fadePlan: function () { return ensurePlan(); },
        fadeStep: function (k) {
          var p = ensurePlan();
          var st = state();
          var at = Math.max(0, Math.min(p.steps, k == null ? fade.at : k));
          return {
            at: at,
            words: p.frames[at].slice(),
            addresses: p.addresses.slice(),
            source: p.source.slice(),
            target: p.target,
            frame: L.fadeFrameAt(st, p, at, { mask: mask(), sat: L.satWith(st, front) })
          };
        },
        fadeLua: function () { return L.lua(ensurePlan()); },
        writeFadeToy: writeToy,
        saveFadeAsset: saveAsset,
        invalidate: function () { cacheKey = ""; }
      };

      studio.panels.register({
        id: "layers",
        label: "LAYERS",
        group: "chip",
        chapter: "registers",
        gloss: "Backdrop, background and sprites apart and composed — the " +
               "PCE has no colour blending, so a fade rewrites palettes.",
        draw: draw,
        api: api
      });

      build();
    }
  });
})(typeof self !== "undefined" ? self : this);
