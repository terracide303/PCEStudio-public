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

  /* The staff's geometry (#95): five lines a clef, SP apart, the treble's
   * top line at TREBLE_TOP and the bass's at BASS_TOP.  A diatonic step is
   * SP/2, so a line every 2 steps and a space every 1.  The canvas is wider
   * than the box and scrolls, like the grid. */
  var STAFF = {
    SP: 7,
    TREBLE_TOP: 30,
    BASS_TOP: 84,
    HEIGHT: 142,
    CLEF_W: 24,          /* the clef's gutter, left of the key signature */
    SIG_W: 9,            /* one accidental glyph of the key signature */
    LEFT: 6,
    BAR_GAP: 8,
    STEP_W: { small: 8, normal: 11, large: 15 }
  };

  /* The glyphs are drawn, not typed: a font's musical symbols are not on
   * every machine and a staff with tofu in it is worse than no staff. */
  var INK = {
    staff: "#3a4557",
    bar: "#59647a",
    clef: "#c8d2e0",
    accidental: "#e6ebf5",
    mark: "#9aa4b5",
    wave: "#5fc9e8",
    noise: "#ff9540",
    head: "#0b0d13"
  };

  P.studioPanelModules.push({
    id: "sequencer",
    register: function (studio) {
      var sq = P.seq;
      var staffModel = P.staff;      /* #95: the staff view's notation model */
      var A = P.assets;               /* the toy's instrument patches (#122) */
      var INSTRUMENTS_CAP = 16;       /* pce-seq.js INSTRUMENTS_MAX */
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

      /* ---- #122: the toy's own instruments are in the palette ------------
       * The card: an instrument added to the toy through ASSETS has to be
       * paintable here and heard on playback.  The song's instrument list is
       * what the grid paints into and what pce-seq.js compiles, so the toy's
       * patches are folded into it: a name the song already has takes the
       * toy's current patch, a new one is appended, and the copy that lands
       * in song.json travels with the song.  The pce-assets shape
       * ({envelope:{size,loop,data}}) becomes the song's ({env}) —
       * pce-assets says loop === size for "hold the last value", and the
       * song's one-shot is 0xff, the same sound. */
      function toyInstruments() {
        if (!A || typeof A.parseInstruments !== "function") return [];
        var f = studio.toy.file("instruments.json");
        if (!f || !f.source) return [];
        try { return A.parseInstruments(f.source).instruments || []; }
        catch (e) { return []; }
      }

      function seqInstrument(t) {
        if (t.kind !== "wave" && t.kind !== "noise") return null;
        var env = t.envelope || {};
        var data = Array.isArray(env.data) && env.data.length
          ? env.data.slice(0, 32) : [31];
        var size = data.length;
        var loop = env.loop;
        if (loop === undefined || loop === null || loop >= size) loop = 0xff;
        var out = { name: t.name, kind: t.kind,
                    env: { size: size, loop: loop, data: data } };
        if (t.kind === "wave") {
          if (!Array.isArray(t.wave) || t.wave.length < 32) return null;
          out.wave = t.wave.slice(0, 32);
        } else {
          out.nf = t.nf;
        }
        return out;
      }

      function mergeToyInstruments(s) {
        var list = toyInstruments();
        for (var i = 0; i < list.length; i++) {
          var ins = seqInstrument(list[i]);
          if (!ins) continue;
          var at = -1;
          for (var j = 0; j < s.instruments.length; j++)
            if (s.instruments[j].name === ins.name) { at = j; break; }
          if (at >= 0) s.instruments[at] = ins;
          else if (s.instruments.length < INSTRUMENTS_CAP) s.instruments.push(ins);
        }
        return s;
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
          return mergeToyInstruments(songObj);
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
        mergeToyInstruments(songObj);
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

      /* ---- the staff (#95) ---------------------------------------------- */

      /* y of a diatonic step on a clef: step 0 is the clef's bottom line,
       * every step SP/2 up, so the five lines are steps 0, 2, 4, 6, 8. */
      function staffY(clef, step) {
        var bottom = clef === "bass" ? STAFF.BASS_TOP : STAFF.TREBLE_TOP;
        return bottom + 4 * STAFF.SP - step * (STAFF.SP / 2);
      }

      function staffLines(g, x0, x1, top) {
        g.strokeStyle = INK.staff;
        g.lineWidth = 1;
        for (var i = 0; i < 5; i++) {
          var y = Math.round(top + i * STAFF.SP) + 0.5;
          g.beginPath();
          g.moveTo(x0, y);
          g.lineTo(x1, y);
          g.stroke();
        }
      }

      /* A drawn accidental: a sharp, a flat or a natural.  Vector strokes so
       * the staff never depends on a font that has ♯ ♭ ♮. */
      function drawAccidental(g, kind, x, y) {
        g.strokeStyle = INK.accidental;
        g.fillStyle = INK.accidental;
        g.lineWidth = 1.2;
        if (kind === "#") {
          /* ♯ leans: the two uprights slant, the two bars lean further */
          g.beginPath();
          g.moveTo(x - 2.6, y); g.lineTo(x - 3.6, y - 6);
          g.moveTo(x + 1.6, y + 1); g.lineTo(x + 0.6, y - 5);
          g.moveTo(x - 4.4, y - 2); g.lineTo(x + 2.2, y - 2.6);
          g.moveTo(x - 4.4, y + 1.4); g.lineTo(x + 2.2, y + 0.8);
          g.stroke();
        } else if (kind === "b") {
          g.beginPath();
          g.moveTo(x, y - 7); g.lineTo(x, y + 1);
          g.bezierCurveTo(x + 5, y - 3, x + 5, y + 3, x, y + 4);
          g.stroke();
        } else {                     /* "n": the natural */
          g.beginPath();
          g.moveTo(x - 3, y - 6); g.lineTo(x - 3, y + 3);
          g.moveTo(x + 1, y - 3); g.lineTo(x + 1, y + 6);
          g.moveTo(x - 3, y - 1); g.lineTo(x + 1, y - 1);
          g.moveTo(x - 3, y + 2); g.lineTo(x + 1, y + 2);
          g.stroke();
        }
      }

      /* The clefs.  The musical-symbol glyphs (U+1D11E and U+1D122) are
       * what a browser draws — they are in every system font stack that
       * matters, and a canvas screenshot on this machine shows them.  A
       * context with no measureText (the tests' stub) or a font without the
       * glyph falls back to the drawn clefs below, so the staff is never
       * headless. */
      var CLEF_GLYPH = { treble: "𝄞", bass: "𝄢" };
      var CLEF_FONT = '"Apple Symbols","Segoe UI Symbol","Noto Music",serif';

      function hasClefGlyph(g) {
        try {
          var m = g.measureText && g.measureText(CLEF_GLYPH.treble);
          return !!(m && m.width > 0);
        } catch (e) { return false; }
      }

      function drawClef(g, clef, x) {
        if (hasClefGlyph(g)) {
          g.fillStyle = INK.clef;
          g.font = "34px " + CLEF_FONT;
          g.textBaseline = "middle";
          g.fillText(CLEF_GLYPH[clef], x, clef === "treble"
                     ? staffY("treble", 2) : staffY("bass", 6));
          return;
        }
        if (clef === "treble") drawTrebleClef(g, x);
        else drawBassClef(g, x);
      }

      /* The treble G clef, its curl on the G4 line (step 2). */
      function drawTrebleClef(g, x) {
        var cx = x + 9;
        var gy = staffY("treble", 2);
        g.strokeStyle = INK.clef;
        g.lineWidth = 1.6;
        g.beginPath();
        g.moveTo(cx, gy + 17);
        g.bezierCurveTo(cx + 8, gy + 17, cx + 10, gy + 6, cx + 3, gy + 2);
        g.bezierCurveTo(cx - 5, gy - 2, cx - 7, gy - 11, cx - 2, gy - 16);
        g.bezierCurveTo(cx + 3, gy - 21, cx + 10, gy - 17, cx + 8, gy - 10);
        g.bezierCurveTo(cx + 6, gy - 3, cx - 2, gy - 1, cx - 6, gy + 3);
        g.bezierCurveTo(cx - 11, gy + 8, cx - 6, gy + 14, cx + 1, gy + 13);
        g.stroke();
        g.beginPath();
        g.moveTo(cx + 3, gy + 2);
        g.bezierCurveTo(cx + 8, gy - 6, cx + 4, gy - 24, cx - 1, gy - 26);
        g.bezierCurveTo(cx - 5, gy - 28, cx - 8, gy - 24, cx - 6, gy - 20);
        g.stroke();
      }

      /* The bass F clef: the curl on the F3 line (step 6) and its two dots
       * in the spaces either side of it (steps 5 and 7). */
      function drawBassClef(g, x) {
        var cx = x + 9;
        var fy = staffY("bass", 6);
        g.strokeStyle = INK.clef;
        g.fillStyle = INK.clef;
        g.lineWidth = 1.6;
        g.beginPath();
        g.moveTo(cx + 3, fy - 5);
        g.bezierCurveTo(cx + 10, fy - 8, cx + 12, fy + 1, cx + 4, fy + 4);
        g.bezierCurveTo(cx - 4, fy + 8, cx - 11, fy + 2, cx - 8, fy - 4);
        g.quadraticCurveTo(cx - 6, fy - 8, cx - 2, fy - 7);
        g.stroke();
        g.beginPath();
        g.arc(cx + 7, staffY("bass", 5), 1.7, 0, Math.PI * 2);
        g.fill();
        g.beginPath();
        g.arc(cx + 7, staffY("bass", 7), 1.7, 0, Math.PI * 2);
        g.fill();
      }

      /* Where a letter sits in a key signature, the octave engravers use:
       * treble F5 C5 G5 D5 A4 E5 B4, bass F3 C3 G3 D3 A2 E3 B2.  It keeps
       * the first sharp on the top line and the first flat in the middle,
       * which is where a musician looks for them. */
      var SIG_OCTAVE = {
        treble: { F: 5, C: 5, G: 5, D: 5, A: 4, E: 5, B: 4 },
        bass: { F: 3, C: 3, G: 3, D: 3, A: 2, E: 3, B: 2 }
      };
      function sigStep(clef, letter) {
        var o = SIG_OCTAVE[clef === "bass" ? "bass" : "treble"][letter] || 4;
        return staffModel.diatonic(letter, o) - STAFF_CLEF_BOTTOM(clef);
      }
      function STAFF_CLEF_BOTTOM(clef) {
        return clef === "bass" ? 18 : 30;   /* pce-staff.js CLEF_BOTTOM */
      }

      function drawKeySignature(g, sig, clef, x) {
        for (var i = 0; i < sig.marks.length; i++) {
          var m = sig.marks[i];
          drawAccidental(g, m.accidental, x + i * STAFF.SIG_W + 4,
                         staffY(clef, sigStep(clef, m.letter)));
        }
      }

      function drawNote(g, note, x, colour) {
        var step = note.shifted - STAFF_CLEF_BOTTOM(note.clef);
        var clef = note.clef;
        var y = staffY(clef, step);
        var v = note.value;

        /* ledger lines, one every other step outside the five lines */
        g.strokeStyle = INK.staff;
        g.lineWidth = 1;
        var s;
        if (step < 0)
          for (s = -2; s >= step; s -= 2) {
            g.beginPath();
            g.moveTo(x - 6, Math.round(staffY(clef, s)) + 0.5);
            g.lineTo(x + 6, Math.round(staffY(clef, s)) + 0.5);
            g.stroke();
          }
        else if (step > 8)
          for (s = 10; s <= step; s += 2) {
            g.beginPath();
            g.moveTo(x - 6, Math.round(staffY(clef, s)) + 0.5);
            g.lineTo(x + 6, Math.round(staffY(clef, s)) + 0.5);
            g.stroke();
          }

        /* the accidental, left of the head */
        if (note.accidental)
          drawAccidental(g, note.accidental, x - 9, y);

        /* the head */
        g.fillStyle = colour;
        g.strokeStyle = colour;
        g.lineWidth = 1.2;
        g.beginPath();
        g.ellipse(x, y, 3.4, 2.5, -0.32, 0, Math.PI * 2);
        if (v.filled) g.fill(); else g.stroke();

        /* the stem, up below the middle line (step 4), down from it */
        var up = step < 4;
        var sx = up ? x + 2.8 : x - 2.8;
        var len = 3.1 * STAFF.SP;
        if (v.stem) {
          g.beginPath();
          g.moveTo(sx, y);
          g.lineTo(sx, up ? y - len : y + len);
          g.stroke();
          for (var f = 0; f < v.flags; f++) {
            var fy = up ? y - len + f * 5 : y + len - f * 5;
            g.beginPath();
            g.moveTo(sx, fy);
            g.quadraticCurveTo(sx + (up ? 6 : -6), fy + 2,
                               sx + (up ? 5 : -5), fy + 6);
            g.stroke();
          }
        }

        /* the dots of a dotted value */
        for (var d = 0; d < v.dots; d++) {
          g.beginPath();
          g.arc(x + 7 + d * 3, step % 2 ? y - 1 : y + 1, 1.2, 0, Math.PI * 2);
          g.fill();
        }
      }

      /* The octave mark over (or under) the note that carries it: 8va,
       * 15ma, 8vb, 15mb, and loco where the written octave returns. */
      function drawMark(g, note, x, colour) {
        var label = note.loco ? "loco" : note.mark;
        if (!label) return;
        g.fillStyle = INK.mark;
        g.font = "8px monospace";
        var y;
        if (note.clef === "treble" && !note.loco && note.markShift > 0)
          y = STAFF.TREBLE_TOP - 6 - (note.markShift - 1) * 9;
        else if (note.clef === "bass" && !note.loco && note.markShift < 0)
          y = STAFF.BASS_TOP + 4 * STAFF.SP + 12 - (note.markShift + 1) * 9;
        else if (note.loco)
          y = note.clef === "bass" ? STAFF.BASS_TOP + 4 * STAFF.SP + 12
                                   : STAFF.TREBLE_TOP - 6;
        else
          y = staffY(note.clef, note.shifted - STAFF_CLEF_BOTTOM(note.clef)) - 12;
        g.fillText(label, x - 4, y);
      }

      function drawStaff(s) {
        var cv = studio.$("seq-staff");
        if (!cv || !cv.getContext || !staffModel) return;
        var lay = staffModel.layout(s);
        var stepW = STAFF.STEP_W[zoom] || STAFF.STEP_W.normal;
        var barW = Math.max(s.steps * stepW, 40);
        var sigW = lay.keySignature.marks.length * STAFF.SIG_W;
        var musicX = STAFF.LEFT + STAFF.CLEF_W + sigW + 10;
        var w = Math.max(374, musicX + lay.bars.length * barW + 10);
        var h = STAFF.HEIGHT;
        if (cv.width !== w) cv.width = w;
        if (cv.height !== h) cv.height = h;
        var g = cv.getContext("2d");
        if (!g) return;
        g.fillStyle = "#0b0d13";
        g.fillRect(0, 0, w, h);

        /* The staves stop at the song's last bar line: a staff that ran on
         * past the music would say the bar is longer than it is. */
        var endX = musicX + lay.bars.length * barW;
        staffLines(g, STAFF.LEFT, endX, STAFF.TREBLE_TOP);
        staffLines(g, STAFF.LEFT, endX, STAFF.BASS_TOP);
        drawClef(g, "treble", STAFF.LEFT);
        drawClef(g, "bass", STAFF.LEFT);
        g.textBaseline = "alphabetic";
        drawKeySignature(g, lay.keySignature, "treble", STAFF.LEFT + STAFF.CLEF_W);
        drawKeySignature(g, lay.keySignature, "bass", STAFF.LEFT + STAFF.CLEF_W);

        /* bar lines, and the step number over each beat (four steps) */
        g.strokeStyle = INK.bar;
        g.fillStyle = "#858d9c";
        g.font = "8px monospace";
        var bar, x;
        for (bar = 0; bar < lay.bars.length; bar++) {
          x = musicX + bar * barW;
          g.beginPath();
          g.moveTo(Math.round(x) + 0.5, STAFF.TREBLE_TOP);
          g.lineTo(Math.round(x) + 0.5, STAFF.BASS_TOP + 4 * STAFF.SP);
          g.stroke();
          g.fillText(lay.bars[bar].name, x + 3, STAFF.TREBLE_TOP - 6);
        }
        x = musicX + lay.bars.length * barW;
        g.beginPath();
        g.moveTo(Math.round(x) + 0.5, STAFF.TREBLE_TOP);
        g.lineTo(Math.round(x) + 0.5, STAFF.BASS_TOP + 4 * STAFF.SP);
        g.stroke();

        /* the notes, one dot per (bar, step, staff position) */
        var used = {};
        for (var i = 0; i < lay.notes.length; i++) {
          var n = lay.notes[i];
          var nx = musicX + n.order * barW + n.step * stepW + stepW / 2;
          var key = n.order + ":" + n.step + ":" + n.shifted;
          var dup = used[key] || 0;
          used[key] = dup + 1;
          nx += dup * 4;
          var colour = n.channel >= 4 ? INK.noise : INK.wave;
          drawNote(g, n, nx, colour);
          drawMark(g, n, nx, colour);
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
        var gridBox = studio.$("seq-gridbox");
        var voicesBox = studio.$("seq-voicesbox");
        var staffBox = studio.$("seq-staffbox");
        if (gridBox) gridBox.hidden = view !== "grid";
        if (voicesBox) voicesBox.hidden = view !== "grid";
        if (staffBox) staffBox.hidden = view !== "staff";
        if (view === "staff") drawStaff(s);

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
        var staffBtn = studio.$("seq-view-staff");
        if (staffBtn) {
          staffBtn.disabled = false;
          staffBtn.setAttribute("aria-pressed", String(view === "staff"));
        }
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
        /* #122: what the toy's own instruments.json adds to the palette,
         * apart from the song's own voices. */
        toyInstruments: function () {
          return toyInstruments().map(function (i) {
            return { name: i.name, kind: i.kind, nf: i.nf || null };
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
        /* #95: the view, and the staff's own reading of the song */
        view: function (name) {
          if (name === undefined) return view;
          if (name === "grid" || name === "staff") { view = name; drawPanel(); }
          return view;
        },
        staff: function () {
          return staffModel ? staffModel.layout(state()) : null;
        },
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
      /* The two view buttons: the same song as a step grid or as a staff
       * (#95).  The staff never edits — it is a reading of what the grid
       * holds — so a click is a redraw either way. */
      bind("seq-view-grid", "click", function () {
        view = "grid";
        drawPanel();
      });
      bind("seq-view-staff", "click", function () {
        view = "staff";
        drawPanel();
      });
      studio.toy.onAssetEdit(function (name) {
        /* #122: an instrument added to (or removed from) the toy changes the
         * palette, so both files invalidate the song. */
        if (name === FILE || name === "instruments.json") api.invalidate();
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
