/*
 * studio-panel-sequencer.js — the SEQUENCER panel (card #94, part 1), a
 * module of the studio since #102.
 *
 * ppu.toys' SEQUENCER is the working example of the layout: a transport, a
 * song row (pattern picker, order, Tempo, Steps, Swing, Key), an instrument
 * palette, a note row ("piano · C4"), note values, Grid | Staff, and a
 * "voices" bar per step.  This is that shape for the HuC6280 PSG:
 *
 *   - six channel rows, not eight, because that is how many voices the chip
 *     has.  The voices bar under the grid counts them per step and the
 *     header says so; the model refuses a seventh channel (seq-channel) and
 *     refuses a noise drum on a channel without the noise generator
 *     (seq-voice: only channels 5 and 6).
 *   - the instrument palette is PSG voices: four waves (32 steps of 5 bits,
 *     #62's shapes) plus a driver envelope, and two noise drums (R7 on
 *     channels 5-6).  The AUDIO panel (#97) edits a toy's waves.json; these
 *     are the song's own instruments, and song.json carries them.
 *   - playback is renderer/pce-song.js + renderer/pce-psg.js over
 *     renderer/pce-seq.js's compiled song, the same model the console's
 *     HuTrack engine writes, so what is heard is what the console plays
 *     (docs/SEQ.md says which half the engine owns and which this file does).
 *   - "Staff" is disabled and titled with #95: the grid is part 1, the staff
 *     is the next card on the same song.
 *
 * The model is renderer/pce-seq.js; the panel draws and binds only.  The
 * song is saved with the toy as song.json (created on the first save, so an
 * untouched toy is still the five-file toy #77 defined).
 */
(function (root) {
  "use strict";
  var P = root.PCEStudio = root.PCEStudio || {};
  P.studioPanelModules = P.studioPanelModules || [];

  var FILE = "song.json";
  var ZOOMS = { small: 12, normal: 20, large: 28 };
  var ROW = 18;
  var HEADER = 14;
  var LABEL = 54;

  P.studioPanelModules.push({
    id: "sequencer",
    register: function (studio) {
      var sq = P.seq;
      var songObj = null;            /* the live song object */
      var seen = null;               /* the song.json text it was read from */
      var loaded = false;
      var error = "";
      var pattern = 0;               /* the pattern the grid shows */
      var brush = { instrument: 0, note: 36, length: 1, eraser: false };
      var zoom = "normal";
      var audio = null;
      var source = null;
      var playing = false;
      var view = "grid";

      function ready() { return !!(sq && P.song && P.psg); }

      function fail(e) {
        error = (e && e.code ? e.code + ": " : "") +
                (e && e.message ? e.message : e);
        var el = studio.$("seq-status");
        if (el) el.textContent = error;
        studio.toast(error);
      }

      /* ---- the song, read back from the toy's files ---------------------- */

      function assetText() {
        var f = studio.toy.file(FILE);
        return f ? f.source : null;
      }

      function state() {
        var text = assetText();
        if (songObj && text === seen) return songObj;
        if (songObj && text === null) return songObj;   /* not saved yet */
        if (text === null) {
          songObj = sq.demoSong();
          loaded = true;
          error = "";
          seen = null;
          return songObj;
        }
        try {
          songObj = sq.fromJSON(text);
          loaded = true;
          error = "";
        } catch (e) {
          loaded = false;
          error = (e && e.code ? e.code + ": " : "") +
                  (e && e.message ? e.message : e);
          songObj = songObj || sq.demoSong();
        }
        seen = text;
        if (pattern >= songObj.patterns.length) pattern = 0;
        return songObj;
      }

      /* song.json only — the other panels' files are theirs. */
      function writeBack(s) {
        var text = sq.toJSON(s);
        var f = studio.toy.file(FILE);
        if (f) {
          if (f.source === text) return [];
          f.source = text;
        } else {
          studio.toy.addFile(FILE, "song", text);
        }
        seen = text;
        studio.toy.persist();
        studio.toy.saved("saved in this browser");
        studio.toy.refreshAssets();
        return [FILE];
      }

      /* A file set that did not parse is never written over. */
      function commit() {
        state();
        if (!loaded) {
          fail(new Error(FILE + " does not load, so nothing was written"));
          return [];
        }
        try { return writeBack(songObj); }
        catch (e) { fail(e); return []; }
      }

      /* The panel's DOM handlers catch and toast; the evidence's path
       * (apply) throws, so a test reads the refusal the way it reads
       * pce-editor.js's. */
      function edit(what) {
        state();
        try { what(); error = ""; }
        catch (e) { fail(e); }
        commit();
        drawPanel();
      }

      function apply(what) {
        state();
        var out = what();
        error = "";
        commit();
        drawPanel();
        return out;
      }

      function setPattern(i) {
        if (i < 0 || i >= songObj.patterns.length) return;
        pattern = i;
      }

      /* ---- drawing ------------------------------------------------------ */

      function cellWidth() { return ZOOMS[zoom] || ZOOMS.normal; }

      function drawGrid(s) {
        var cv = studio.$("seq-grid");
        if (!cv || !cv.getContext) return;
        var cw = cellWidth();
        var w = LABEL + s.steps * cw + 4;
        var h = HEADER + sq.CHANNELS * ROW + 4;
        if (cv.width !== w) cv.width = w;
        if (cv.height !== h) cv.height = h;
        var g = cv.getContext("2d");
        if (!g) return;
        g.fillStyle = "#0b0d13";
        g.fillRect(0, 0, w, h);

        var cells = s.patterns[pattern].channels;
        var ch, step, x, y;
        /* the step numbers, one per beat (a beat is four steps) */
        g.fillStyle = "#858d9c";
        g.font = "9px monospace";
        for (step = 0; step < s.steps; step++) {
          x = LABEL + step * cw;
          if (step % 4 === 0) g.fillText(String(step + 1), x + 2, 10);
        }
        for (ch = 0; ch < sq.CHANNELS; ch++) {
          y = HEADER + ch * ROW;
          var label = (ch + 1) + (ch >= 4 ? " nz" : " wv");
          g.fillStyle = ch >= 4 ? "#ff9540" : "#5fc9e8";
          g.fillText(label, 2, y + 13);
          /* the empty cells first, so a note's length fill is not painted
           * over by the next step's cell (a note lasts length steps) */
          for (step = 0; step < s.steps; step++) {
            x = LABEL + step * cw;
            g.fillStyle = step % 4 === 0 ? "#1a2130" : "#121722";
            g.fillRect(x + 1, y + 1, cw - 2, ROW - 2);
          }
          for (step = 0; step < s.steps; step++) {
            x = LABEL + step * cw;
            var cell = cells[ch][step];
            if (!cell) continue;
            var ins = s.instruments[cell.instrument];
            var noise = ins.kind === "noise";
            g.fillStyle = noise ? "#7a3a12" : "#1d4a5e";
            g.fillRect(x + 1, y + 1, Math.max(4, cell.length * cw - 2),
                       ROW - 2);
            g.fillStyle = "#e6ebf5";
            if (cw >= 18) {
              g.fillText(sq.noteName(cell.note, s.key), x + 2, y + 13);
            } else {
              g.fillRect(x + 3, y + 7, 4, 4);
            }
          }
        }
      }

      function drawVoices(s) {
        var cv = studio.$("seq-voices");
        if (!cv || !cv.getContext) return;
        var cw = cellWidth();
        var w = LABEL + s.steps * cw + 4;
        var h = 26;
        if (cv.width !== w) cv.width = w;
        if (cv.height !== h) cv.height = h;
        var g = cv.getContext("2d");
        if (!g) return;
        g.fillStyle = "#0b0d13";
        g.fillRect(0, 0, w, h);
        g.fillStyle = "#858d9c";
        g.font = "9px monospace";
        g.fillText("voices", 2, 16);
        var bars = sq.voiceBars(s, pattern);
        for (var step = 0; step < s.steps; step++) {
          var x = LABEL + step * cw;
          var v = bars[step];
          var bh = Math.round((v / sq.VOICE_LIMIT) * (h - 3));
          g.fillStyle = v >= sq.VOICE_LIMIT ? "#ff9540" : "#3d8fa8";
          g.fillRect(x + 1, h - 2 - bh, cw - 2, bh);
          if (v && cw >= 18) {
            g.fillStyle = "#0b0d13";
            g.fillText(String(v), x + cw / 2 - 2, h - 4);
          }
        }
      }

      function drawPanel() {
        if (!ready()) return;
        var s = state();
        if (pattern >= s.patterns.length) pattern = 0;

        var sel = studio.$("seq-pattern");
        if (sel) {
          if (sel.options !== undefined) {
            while (sel.options.length) sel.remove(0);
            for (var i = 0; i < s.patterns.length; i++)
              sel.add(new root.Option("Pattern " + s.patterns[i].name, String(i)));
          }
          sel.value = String(pattern);
        }
        var order = studio.$("seq-order");
        if (order) order.value = sq.orderText(s);
        var tempo = studio.$("seq-tempo");
        if (tempo) tempo.value = String(s.tempo);
        var swing = studio.$("seq-swing");
        if (swing) swing.value = String(s.swing);
        var steps = studio.$("seq-steps");
        if (steps) steps.value = String(s.steps);
        var key = studio.$("seq-key");
        if (key && key.options !== undefined && !key.options.length) {
          for (var k = 0; k < 12; k++)
            key.add(new root.Option(sq.KEY_NAMES[k], String(k)));
        }
        if (key) key.value = String(s.key);

        var ins = studio.$("seq-instrument");
        if (ins) {
          if (ins.options !== undefined) {
            while (ins.options.length) ins.remove(0);
            for (var m = 0; m < s.instruments.length; m++)
              ins.add(new root.Option(s.instruments[m].name, String(m)));
          }
          ins.value = String(brush.instrument);
        }
        var note = studio.$("seq-note");
        if (note) note.value = String(brush.note);
        var len = studio.$("seq-length");
        if (len) len.value = String(brush.length);
        var noteName = studio.$("seq-note-name");
        if (noteName) noteName.textContent = sq.noteName(brush.note, s.key);

        drawGrid(s);
        drawVoices(s);

        var t = sq.timing(s);
        var bars = sq.voiceBars(s, pattern);
        var maxVoices = 0;
        for (var b = 0; b < bars.length; b++)
          if (bars[b] > maxVoices) maxVoices = bars[b];
        var info = studio.$("seq-info");
        if (info) {
          info.textContent = s.order.length + " bar" +
            (s.order.length === 1 ? "" : "s") + " · " + s.steps +
            " steps · " + sq.noteCount(s, pattern) + " notes in this pattern" +
            " · " + maxVoices + " of " + sq.VOICE_LIMIT + " voices at once" +
            " · " + (t.tick1 === t.tick2 ? t.tick1 + " ticks"
                                         : t.tick1 + "/" + t.tick2 + " ticks") +
            " · " + t.seconds.toFixed(2) + " s";
        }
        var status = studio.$("seq-status");
        if (status) status.textContent = error || (playing ? "playing…" : "");
        var eraser = studio.$("seq-eraser");
        if (eraser) eraser.setAttribute("aria-pressed", String(brush.eraser));
        var staff = studio.$("seq-view-staff");
        if (staff) staff.disabled = true;
        var grid = studio.$("seq-view-grid");
        if (grid) grid.setAttribute("aria-pressed", String(view === "grid"));
      }

      /* ---- the canvas's pointer -> a cell ------------------------------- */

      function cellAt(ev, el) {
        var s = state();
        var rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
        var x = ev && ev.offsetX !== undefined ? ev.offsetX : 0;
        var y = ev && ev.offsetY !== undefined ? ev.offsetY : 0;
        if ((x === 0 && y === 0) && rect) {
          x = ev.clientX - rect.left;
          y = ev.clientY - rect.top;
        }
        var step = Math.floor((x - LABEL) / cellWidth());
        var ch = Math.floor((y - HEADER) / ROW);
        if (step < 0 || step >= s.steps || ch < 0 || ch >= sq.CHANNELS)
          return null;
        return { channel: ch, step: step };
      }

      function paint(ch, step) {
        var s = state();
        if (brush.eraser) return sq.eraseCell(s, pattern, ch, step);
        if (s.patterns[pattern].channels[ch][step])
          return sq.eraseCell(s, pattern, ch, step);
        return sq.setCell(s, pattern, ch, step, {
          note: brush.note, instrument: brush.instrument,
          length: brush.length
        });
      }

      /* ---- playback ----------------------------------------------------- */

      function context() {
        if (audio) return audio;
        var Ctor = root.AudioContext || root.webkitAudioContext;
        if (!Ctor) return null;
        audio = new Ctor();
        return audio;
      }

      function stopAudio() {
        if (source) {
          try { source.stop(); } catch (e) { /* already stopped */ }
          source = null;
        }
        playing = false;
      }

      /* The song through renderer/pce-seq.js -> pce-song.js -> pce-psg.js,
       * into the page's AudioContext. */
      function play() {
        state();
        var got = sq.render(songObj);
        var pcm = got.pcm;
        var ctx = context();
        if (ctx && pcm.length) {
          stopAudio();
          try {
            var buf = ctx.createBuffer(1, pcm.length, got.sampleRate);
            var ch = buf.getChannelData(0);
            for (var i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
            source = ctx.createBufferSource();
            source.buffer = buf;
            source.connect(ctx.destination);
            source.start();
            playing = true;
          } catch (e) { playing = false; }
        }
        var ns = 0, peak = 0;
        for (var k = 0; k < pcm.length; k++) {
          var a = Math.abs(pcm[k]);
          if (a > peak) peak = a;
        }
        ns = pcm.length;
        drawPanel();
        return { samples: ns, peak: peak, seconds: got.count / 60,
                 sampleRate: got.sampleRate };
      }

      /* ---- the evidence surface ----------------------------------------- */

      var api = {
        file: FILE,
        state: function () { return state(); },
        /* the compiled song pce-song.js plays — the DMF-shaped object */
        song: function () { return sq.compile(state()); },
        compiledText: function () { return sq.toJSON(state()); },
        timing: function () { return sq.timing(state()); },
        events: function () { return sq.events(state()); },
        render: function () { return sq.render(state()); },
        notes: function () { return sq.events(state()).notes; },
        check: function () { return sq.check(state()); },
        pattern: function () { return pattern; },
        selectPattern: function (i) { setPattern(i); drawPanel(); return pattern; },
        patterns: function () { return state().patterns.map(function (p) {
          return p.name; }); },
        addPattern: function () {
          return apply(function () { return sq.addPattern(songObj); });
        },
        order: function () { return sq.orderText(state()); },
        setOrder: function (text) {
          return apply(function () { return sq.parseOrder(songObj, text); });
        },
        tempo: function () { return state().tempo; },
        setTempo: function (bpm) {
          return apply(function () { return sq.setTempo(songObj, bpm); });
        },
        swing: function (n) {
          if (n === undefined) return state().swing;
          return apply(function () { return sq.setSwing(songObj, n); });
        },
        key: function (n) {
          if (n === undefined) return state().key;
          return apply(function () { return sq.setKey(songObj, n); });
        },
        steps: function (n) {
          if (n === undefined) return state().steps;
          return apply(function () { return sq.setSteps(songObj, n); });
        },
        instruments: function () {
          return state().instruments.map(function (i) {
            return { name: i.name, kind: i.kind, nf: i.nf || null,
                     envelope: i.env.data.slice() };
          });
        },
        brush: function () {
          return { instrument: brush.instrument, note: brush.note,
                   length: brush.length, eraser: brush.eraser,
                   noteName: sq.noteName(brush.note, state().key) };
        },
        setInstrument: function (i) {
          state();
          if (!(i >= 0 && i < songObj.instruments.length))
            throw sq.refuse("seq-instrument", "no instrument " + i);
          brush.instrument = i;
          drawPanel();
          return brush.instrument;
        },
        setNote: function (n) {
          if (typeof n === "string") n = sq.noteIndex(n);
          if (!(n >= sq.NOTE_MIN && n <= sq.NOTE_MAX))
            throw new Error("note " + n + " outside " +
                            sq.NOTE_MIN + ".." + sq.NOTE_MAX);
          brush.note = n;
          drawPanel();
          return brush.note;
        },
        setLength: function (n) {
          var s = state();
          if (!(n >= 1 && n <= s.steps))
            throw new Error("length " + n + " outside 1.." + s.steps);
          brush.length = n;
          drawPanel();
          return brush.length;
        },
        eraser: function (on) {
          brush.eraser = !!on;
          drawPanel();
          return brush.eraser;
        },
        /* the same call the canvas's click handler makes */
        paint: function (ch, step) { return apply(function () {
          return paint(ch, step);
        }); },
        click: function (ch, step) { return api.paint(ch, step); },
        erase: function (ch, step) {
          return apply(function () { return sq.eraseCell(state(), pattern, ch, step); });
        },
        clearPattern: function () {
          return apply(function () {
            var s = state();
            for (var ch = 0; ch < sq.CHANNELS; ch++)
              for (var step = 0; step < s.steps; step++)
                s.patterns[pattern].channels[ch][step] = null;
            return true;
          });
        },
        voices: function () { return sq.voiceBars(state(), pattern); },
        voicesAt: function (step) { return sq.voicesAt(state(), pattern, step); },
        voiceLimit: function () { return sq.VOICE_LIMIT; },
        voiceCapacity: function () { return sq.CHANNELS; },
        noteName: function (n) { return sq.noteName(n === undefined ? brush.note : n,
                                                    state().key); },
        info: function () { return studio.$("seq-info").textContent; },
        status: function () { return studio.$("seq-status").textContent; },
        statusError: function () { return error; },
        text: function () { return sq.toJSON(state()); },
        save: function () {
          commit();
          drawPanel();
          return { file: FILE, changed: true, text: sq.toJSON(state()) };
        },
        load: function () {
          songObj = null;
          seen = null;
          error = "";
          var s = state();
          drawPanel();
          return s;
        },
        invalidate: function () { songObj = null; seen = null; drawPanel(); },
        play: function () { return play(); },
        stop: function () { stopAudio(); drawPanel(); },
        cellAt: cellAt,
        zoom: function (name) {
          if (name === undefined) return zoom;
          if (ZOOMS[name]) { zoom = name; drawPanel(); }
          return zoom;
        }
      };

      /* ---- bind the page's own controls ---------------------------------- */

      function bind(id, type, fn) {
        var e = studio.$(id);
        if (e && e.addEventListener) e.addEventListener(type, fn);
      }

      bind("seq-grid", "click", function (ev) {
        var at = cellAt(ev, studio.$("seq-grid"));
        if (at) api.paint(at.channel, at.step);
      });
      bind("seq-play", "click", function () { play(); });
      bind("seq-stop", "click", function () { stopAudio(); drawPanel(); });
      bind("seq-pattern", "change", function () {
        setPattern(Number(studio.$("seq-pattern").value) || 0);
        drawPanel();
      });
      bind("seq-addpattern", "click", function () {
        edit(function () { setPattern(sq.addPattern(songObj)); });
      });
      bind("seq-order", "change", function () {
        edit(function () { sq.parseOrder(songObj, studio.$("seq-order").value); });
      });
      bind("seq-tempo", "input", function () {
        var v = Number(studio.$("seq-tempo").value);
        edit(function () { sq.setTempo(songObj, v); });
      });
      bind("seq-swing", "input", function () {
        var v = Number(studio.$("seq-swing").value);
        edit(function () { sq.setSwing(songObj, v); });
      });
      bind("seq-key", "change", function () {
        var v = Number(studio.$("seq-key").value);
        edit(function () { sq.setKey(songObj, v); });
      });
      bind("seq-steps", "change", function () {
        var v = Number(studio.$("seq-steps").value);
        edit(function () { sq.setSteps(songObj, v); });
      });
      bind("seq-instrument", "change", function () {
        api.setInstrument(Number(studio.$("seq-instrument").value) || 0);
      });
      bind("seq-note", "change", function () {
        api.setNote(Number(studio.$("seq-note").value));
      });
      bind("seq-note-down", "click", function () {
        api.setNote(Math.max(sq.NOTE_MIN, brush.note - 1));
      });
      bind("seq-note-up", "click", function () {
        api.setNote(Math.min(sq.NOTE_MAX, brush.note + 1));
      });
      bind("seq-length", "change", function () {
        api.setLength(Number(studio.$("seq-length").value));
      });
      bind("seq-eraser", "click", function () { api.eraser(!brush.eraser); });
      bind("seq-clear", "click", function () { api.clearPattern(); });
      bind("seq-zoom", "change", function () {
        api.zoom(studio.$("seq-zoom").value);
      });
      /* The two view buttons: the grid is this card, the staff is #95.  Both
       * answer, so the page's "every button has a handler" rule holds. */
      bind("seq-view-grid", "click", function () {
        view = "grid";
        drawPanel();
      });
      bind("seq-view-staff", "click", function () {
        studio.toast("The staff view is part 2 (#95); the grid is the same song.");
      });
      studio.toy.onAssetEdit(function (name) {
        if (name === FILE) api.invalidate();
      });

      studio.panels.register({
        id: "sequencer",
        label: "SEQUENCER",
        group: "chip",
        chapter: "sound",
        gloss: "A step grid for the PSG's six voices: patterns, tempo, swing " +
               "and key, wave instruments and noise drums, played by the " +
               "console's own engine model; saves as song.json.",
        draw: function () { drawPanel(); },
        api: api
      });
    }
  });
})(typeof self !== "undefined" ? self : this);
