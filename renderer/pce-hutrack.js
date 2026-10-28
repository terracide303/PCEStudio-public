/*
 * pce-hutrack.js — a DMF song into HuTrack's assembler includes, in the
 * browser (#35, the export step).
 *
 * HuTrack's console driver is fed by HuTrack's own Python converter: a DMF
 * module becomes ten `.inc` files that PCEAS assembles into the song bank
 * (vendor/hutrack/utils/support/hutrackLib.py's HuTrackExportPCE).  A browser
 * export cannot run Python, so this module reproduces that writer's rules and
 * its bytes: `convert()` returns the same ten files, byte for byte, and
 * `assemble()` turns them into the song bank the exported .pce needs.
 *
 * This is a transcription of the FORMAT, not a copy of HuTrack's code.  Each
 * output rule cites what it reproduces:
 *
 *   - the pattern compression (note+octave into one byte, the field mask,
 *     `0xe1+n` empty-row runs, deduplicated patterns) is the parser's input
 *     format (vendor/hutrack/lib/HuTrack/engine/HuTrack_parser.asm) written
 *     by dmfReader.getPatternData;
 *   - the include text is hutrackLib.HuTrackExportPCE's writers.
 *
 * The song itself is read by renderer/pce-dmf.js; this file never opens the
 * DMF byte stream.  What the reader deliberately flattens is kept there for
 * this module: the per-row `fxSlots` (empty slots included — the compression
 * mask asks whether a slot is present) and `legacyArpSpeed` (written into the
 * attributes).
 *
 * Refusals carry a machine-readable `code` (the convention pce-wave.js and
 * pce-rom.js use):
 *   song-pcm       PCM samples present; their conversion needs a resampler
 *                  (numpy/resampy) and is not ported
 *   song-volume    a volume outside 0..31 (the PSG's AL field is 5 bits)
 *   song-note      a note outside HuTrack's compressed C0..B6 range
 *   song-effect    an effect code above one byte, or a waveform index the
 *                  song does not have
 *   song-arp       an arpeggio mode or value HuTrack's signed byte cannot take
 *   song-instrument an instrument index the song does not have
 *   song-wave      more waveforms than HuTrack's pointer table holds
 *   song-pattern   a channel whose pattern rows disagree with the header
 *   song-name      a song name that cannot be an assembler include path
 *   song-bank      the assembled song does not fit its 8 KiB bank
 *   song-syntax    an include the small assembler does not understand
 *   song-label     a duplicate or undefined label in the includes
 *   song-value     a value that does not fit its .db/.dw
 *
 * Dual use: CommonJS module in Node (tests/check-export-song.js) and a
 * browser global (renderer/index.html's page) via the same UMD wrapper as
 * pce-rom.js.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.PCEStudio = root.PCEStudio || {};
    root.PCEStudio.hutrack = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var CHANNELS = 6;
  var SONG_BANK = 0x10;      /* tools/hutrack.asm: .bank $10, "Song" */
  var SONG_ORG = 0x4000;     /* and .org $4000 */
  var BANK = 8 * 1024;

  function refuse(code, message) {
    var e = new Error("pce-hutrack: " + code + ": " + message);
    e.code = code;
    throw e;
  }

  /* ---- 1. the compression (dmfReader.getPatternData) ---------------------

     A row is [note, octave, volume, fx0code, fx0arg, ..., instrument].
     `note` is the compressed note index 1..12, 100 for a note cut, or 0 for
     an empty row.  A non-empty row becomes:
       - mask=1: one byte, the note (+128 when there is nothing else in the
         row, which is how the engine tells a bare note from a field mask);
       - otherwise: the mask byte, then only the fields its bits name.
     A run of empty rows becomes 0xe1+count (count 1..30), emitted when the
     run reaches 30 or the pattern ends. */

  var EMPTY_RUN = 0xe1;      /* 0xe1 + n skips n rows */

  function convertRows(patterns, numFX, rowsPerPattern) {
    var out = [];
    for (var p = 0; p < patterns.length; p++) {
      var rows = patterns[p];
      if (rows.length !== rowsPerPattern) {
        refuse("song-pattern",
               "channel pattern " + p + " has " + rows.length + " rows, " +
               "the header says " + rowsPerPattern);
      }
      var compressed = [];
      var emptyRun = 0;

      for (var row = 0; row < rows.length; row++) {
        var entry = rowEntry(rows[row], numFX);
        var isEmpty = entry[0] === 0 && entry[1] === 0;
        if (isEmpty) {
          for (var f = 2; f < entry.length; f++)
            if (entry[f] !== 0xffff) { isEmpty = false; break; }
        }

        if (isEmpty) {
          emptyRun++;
          if (emptyRun === 30 || row + 1 === rows.length) {
            compressed.push([EMPTY_RUN + emptyRun - 1]);
            emptyRun = 0;
          }
          continue;
        }
        if (emptyRun > 0) {
          compressed.push([EMPTY_RUN + emptyRun - 1]);
          emptyRun = 0;
        }

        var mask = 0;
        if (entry[0] > 0 || entry[1] > 0) mask |= 0x01;
        if (entry[entry.length - 1] !== 0xffff) mask |= 0x04;  /* instrument */
        if (entry[2] !== 0xffff) mask |= 0x08;                 /* volume */
        if (entry[3] !== 0xffff) mask |= 0x10;                 /* FX1 code */
        if (entry[4] !== 0xffff) mask |= 0x20;                 /* FX1 arg */
        for (var m = 5; m < entry.length - 1; m++)
          if (entry[m] !== 0xffff) { mask |= 0x40; break; }

        var note = (entry[0] - 1) + entry[1] * 12;
        if (entry[0] !== 100 && (mask & 1) &&
            (note < 0 || note > 83)) {
          refuse("song-note",
                 "note " + note + " is outside HuTrack's compressed " +
                 "C0..B6 range");
        }
        if (mask <= 1 && entry[0] !== 0) note += 128;
        if (entry[0] === 100) note = 224;          /* note cut */

        var packed = [];
        if (mask === 1) {
          packed.push(note);
        } else {
          packed.push(mask);
          if (mask & 0x01) packed.push(note);
          if (mask & 0x04) packed.push(entry[entry.length - 1] & 0xff);
          if (mask & 0x08) packed.push(entry[2] & 0xff);
          if (mask & 0x10) packed.push(entry[3]);
          if (mask & 0x20) packed.push(entry[4]);
          if (mask & 0x40) {
            var extMask = 0, ext = [];
            var slot = 0;
            for (var k = 5; k < entry.length - 1; k++) {
              if (entry[k] !== 0xffff) {
                extMask |= 1 << slot;
                ext.push(entry[k]);
              }
              slot++;
            }
            packed.push(extMask);
            for (var e = 0; e < ext.length; e++) packed.push(ext[e]);
          }
        }
        compressed.push(packed);
      }
      out.push(compressed);
    }
    return out;
  }

  /* One DMF row into [note, octave, volume, fx0code, fx0arg, ...,
   * instrument], with the reader's decoded note mapped back to the DMF's
   * pre-adjustment note and octave (dmfReader.getPatternData's note rules). */
  function rowEntry(row, numFX) {
    var note = 0, octave = 0;
    var n = row.note;
    if (n && n.cut) {
      note = 100;
    } else if (n) {
      /* decodeNote() resolved C-of-the-next-octave and C-with-a-nonzero-
       * octave to semitone 0; the compressed form is semitone+1. */
      note = n.semitone + 1;
      octave = n.octave;
    }
    if (note === 0 && octave !== 0) note = 1;      /* DMF's note 0 + octave */

    var volume = row.volume === null || row.volume === undefined
      ? 0xffff : row.volume;
    if (volume !== 0xffff && (volume < 0 || volume > 31)) {
      refuse("song-volume", "volume " + volume + " is outside 0..31");
    }

    var entry = [note, octave, volume];
    var slots = row.fxSlots || [];
    if (slots.length !== numFX) {
      refuse("song-effect",
             "a row has " + slots.length + " effect slots, the channel " +
             "declares " + numFX);
    }
    for (var f = 0; f < slots.length; f++) {
      entry.push(slots[f].code);
      entry.push(slots[f].arg);
    }
    entry.push(row.instrument === null || row.instrument === undefined
               ? 0xffff : row.instrument);
    return entry;
  }

  /* Patterns with identical compressed rows share one entry, and the order
   * list records which entry each order plays (Pattern.compare). */
  function dedupe(compressed) {
    var unique = [], matrix = [];
    for (var p = 0; p < compressed.length; p++) {
      var at = -1;
      for (var u = 0; u < unique.length; u++) {
        if (sameRows(unique[u], compressed[p])) { at = u; break; }
      }
      if (at < 0) { at = unique.length; unique.push(compressed[p]); }
      matrix.push(at);
    }
    return { unique: unique, matrix: matrix };
  }

  function sameRows(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i].length !== b[i].length) return false;
      for (var j = 0; j < a[i].length; j++)
        if (a[i][j] !== b[i][j]) return false;
    }
    return true;
  }

  /* ---- 2. the include files (hutrackLib.HuTrackExportPCE) ---------------- */

  function Out() { this.text = ""; }
  Out.prototype.write = function (s) { this.text += s; };
  /* A labelled block in a banked song: `.page 2` starts a new 8 KiB page
   * only when the current one is full, which for a one-bank song is never;
   * assemble() refuses a song that outgrows the bank. */
  Out.prototype.location = function (label) {
    this.write("  .page 2\n" + label + "\n");
  };
  Out.prototype.pointer = function (label) {
    this.write("  .dw " + label + "\n  .db bank(" + label + ")\n");
  };
  /* Four values a row, then one newline — except an array whose length is
   * 3 mod 4, which already ended on its own newline (the writer's
   * writeArrayAs_DB_fourInRow). */
  Out.prototype.array = function (values, hex) {
    var row = 0;
    for (var i = 0; i < values.length; i++) {
      this.write(row ? ", " : "  .db ");
      this.write(hex ? "$" + values[i].toString(16) : String(values[i]));
      row = (row + 1) % 4;
      if (row === 0) this.write("\n");
    }
    if (row !== 3) this.write("\n");
  };

  function textBytes(s) {
    /* The writer takes each character's low byte, stops at a NUL, and keeps
     * 47 bytes plus a terminator (the runtime's buffer). */
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var v = s.charCodeAt(i) & 0xff;
      if (v === 0) break;
      out.push(v);
    }
    if (out.length > 47) out = out.slice(0, 47);
    out.push(0);
    return out;
  }

  function checkName(name, what) {
    if (!name || name === "." || name === ".." || /[\/\\\r\n"]/.test(name)) {
      refuse("song-name",
             what + " " + JSON.stringify(name) + " cannot be an assembler " +
             "include path");
    }
  }

  function convert(mod, options) {
    var opts = options || {};
    var songName = opts.songName || mod.songName || "song";
    var subFolder = opts.subFolder || songName;
    var includePath = opts.includePath || "";
    var prefix = (includePath ? includePath + "/" : "");

    checkName(songName, "song name");
    if (/[\r\n"]/.test(subFolder))
      refuse("song-name", "subfolder " + JSON.stringify(subFolder) +
                          " cannot be an assembler include path");
    if (/[\r\n"]/.test(includePath))
      refuse("song-name", "include path " + JSON.stringify(includePath) +
                          " cannot be an assembler include path");

    /* PCM samples need a resampler (convertPCMData uses numpy/resampy).
     * Refusing is honest; silently exporting an empty sample table would
     * build a ROM that plays something the DMF does not. */
    if (mod.samples && mod.samples.length) {
      refuse("song-pcm",
             mod.samples.length + " PCM sample(s) present; HuTrack's " +
             "converter resamples them with numpy/resampy and that step is " +
             "not ported");
    }

    if (mod.instruments.length > 128)
      refuse("song-instrument",
             mod.instruments.length + " instruments; the pointer table " +
             "holds 128");
    if (mod.wavetables.length > 128)
      refuse("song-wave", mod.wavetables.length + " waveforms; at most 128");

    /* The instruments, with the transformations the writer applies. */
    var instruments = [];
    for (var i = 0; i < mod.instruments.length; i++) {
      var ins = mod.instruments[i];
      if (ins.mode !== 0)
        refuse("song-instrument", "instrument " + i + " is FM mode " +
                                  ins.mode + "; the PCE converter needs " +
                                  "standard mode");
      var vol = cloneEnv(ins.volumeEnv);
      for (var v = 0; v < vol.size; v++) {
        if (vol.data[v] < 0 || vol.data[v] > 31)
          refuse("song-volume",
                 "instrument " + i + " volume envelope value " + vol.data[v] +
                 " is outside 0..31");
      }
      var arp = cloneEnv(ins.arpeggioEnv);
      arp.mode = ins.arpeggioEnv.mode || 0;
      var mode = arp.mode;
      if (mode !== 0 && mode !== 1)
        refuse("song-arp", "instrument " + i + " arpeggio mode " + mode);
      /* The macro is a signed dword; relative mode is offset by -12 and
       * both modes must fit one byte (dmfReader.getInstrumentData). */
      arp.data = arp.data.map(function (value) {
        if (value >= 0x80000000) value -= 0x100000000;
        return value;
      });
      if (mode === 0) arp.data = arp.data.map(function (value) {
        return value - 12;
      });
      for (var a = 0; a < arp.data.length; a++) {
        var value = arp.data[a];
        if (mode === 0 && (value < -128 || value > 127))
          refuse("song-arp",
                 "instrument " + i + " relative arpeggio " + value +
                 " does not fit a signed byte");
        if (mode === 1 && (value < 0 || value > 195))
          refuse("song-arp",
                 "instrument " + i + " fixed arpeggio " + value +
                 " is outside 0..195");
      }
      arp.data = arp.data.map(function (value) { return value & 255; });

      var wave = cloneEnv(ins.wavetableEnv);
      for (var w = 0; w < wave.data.length; w++) {
        if (wave.data[w] < 0 || wave.data[w] >= mod.wavetables.length)
          refuse("song-effect",
                 "instrument " + i + " waveform envelope names waveform " +
                 wave.data[w] + ", the song has " + mod.wavetables.length);
      }
      instruments.push({ name: ins.name, mode: ins.mode,
                         vol: vol, arp: arp, wave: wave });
    }

    /* The patterns: each channel's order slots, compressed and deduplicated. */
    var channels = [];
    for (var ch = 0; ch < CHANNELS; ch++) {
      var slots = mod.patterns[ch];
      var numFX = slots[0] && slots[0][0] && slots[0][0].fxSlots
        ? slots[0][0].fxSlots.length : 1;
      for (var s = 0; s < slots.length; s++) {
        var want = slots[s][0] && slots[s][0].fxSlots
          ? slots[s][0].fxSlots.length : numFX;
        if (want !== numFX)
          refuse("song-effect",
                 "channel " + ch + " does not use one effect-column count " +
                 "in every pattern");
      }
      /* Every effect slot's adjustments (dmfReader.getPatternData). */
      for (var sp = 0; sp < slots.length; sp++) {
        for (var r = 0; r < slots[sp].length; r++) {
          var row = slots[sp][r];
          for (var fx = 0; fx < row.fxSlots.length; fx++) {
            var slot = row.fxSlots[fx];
            if (slot.code !== 0xffff && slot.code > 255)
              refuse("song-effect",
                     "channel " + ch + " pattern " + sp + " row " + r +
                     ": effect code " + slot.code + " does not fit a byte");
            if (slot.arg !== 0xffff) {
              var arg = slot.arg;
              if (slot.code === 0xe5 && mod.version < 20)
                arg = 128 + Math.trunc((arg - 128) / 4);
              if (slot.code === 0x09 || slot.code === 0x0f)
                arg *= mod.timeBase;
              if (arg < 0 || arg > 255)
                refuse("song-effect",
                       "channel " + ch + " pattern " + sp + " row " + r +
                       ": effect argument " + arg + " does not fit a " +
                       "byte");
              /* Copy, never mutate the caller's module: convert() may be
               * called twice on the same parse (the player reads it too). */
              row.fxSlots[fx] = { code: slot.code, arg: arg };
              if (slot.code === 0x10 && arg >= mod.wavetables.length)
                refuse("song-effect",
                       "channel " + ch + " pattern " + sp + " row " + r +
                       ": waveform " + arg + " does not exist");
            }
            if (row.instrument !== null && row.instrument !== undefined &&
                (row.instrument < 0 || row.instrument >= instruments.length))
              refuse("song-instrument",
                     "channel " + ch + " pattern " + sp + " row " + r +
                     ": instrument " + row.instrument + " does not exist");
          }
        }
      }
      var compressed = convertRows(slots, numFX, mod.rowsPerPattern);
      channels.push(dedupe(compressed));
    }

    var rowsPerPattern = mod.rowsPerPattern;
    var orderCount = mod.orderCount;
    var files = {};

    /* ---- header ---- */
    var header = new Out();
    header.write("\n\n\n");
    header.location(".song");
    header.write("  .dw 0 ; banked-format marker\n  .db 1 ; format revision\n");
    header.pointer(".song.tables");
    var names = [["songname", mod.songName], ["author", mod.author]];
    for (var nn = 0; nn < names.length; nn++) {
      header.write("." + names[nn][0] + "\n");
      var data = textBytes(names[nn][1] || "");
      for (var st = 0; st < data.length; st += 32) {
        header.write("  .db " + data.slice(st, st + 32).join(",") + "\n");
      }
    }
    header.write("\n\n");
    header.location(".song.tables");
    var tables = [".attributes", ".patternList.table", ".instrument.table",
                  ".waveform.table", ".pattern.table", ".samples.table"];
    for (var t = 0; t < tables.length; t++) header.pointer(tables[t]);
    header.write("\n");
    header.write("\n\n");
    header.location(".attributes");
    header.write("  ; Extended attributes: marker, initial arp ticks, " +
                 "legacy volume slides\n");
    header.write("  .db 0," + mod.legacyArpSpeed + "," +
                 (mod.version <= 24 ? 1 : 0) + "\n");
    header.write(" ;NOTE: time base =  " + mod.timeBase + "\n");
    header.write(" ;NOTE: frame mode =  " + mod.frameMode + "\n");
    header.write(" ;NOTE: custom mode =  " + mod.customHz + "\n");
    header.write("\n");
    header.write(".attributes.tick1\n  .db " + mod.tick1 + "\n");
    header.write(".attributes.tick2\n  .db " + mod.tick2 + "\n");
    header.write(".attributes.rowLength\n  .db " + (rowsPerPattern & 255) +
                 "\n");
    header.write(".attributes.patternListLen\n  .db " + orderCount + "\n");
    header.write(".attributes.instrumentLen\n  .db " + instruments.length +
                 "\n");
    header.write(".attributes.waveformsLen\n  .db " + mod.wavetables.length +
                 "\n");
    header.write(".attributes.samplesLen\n  .db 0\n");
    header.write("\n\n");
    files[subFolder + "/" + songName + ".header.inc"] = header.text;

    /* ---- instruments ---- */
    var instrMatrix = new Out();
    instrMatrix.write("\n\n");
    instrMatrix.write(rule96() + "\n");
    instrMatrix.location(".instrument.table");
    for (var im = 0; im < instruments.length; im++)
      instrMatrix.pointer(".instrument." + im);
    instrMatrix.write("\n");
    files[subFolder + "/" + songName + ".instrMatrix.inc"] =
      instrMatrix.text;

    var instrData = new Out();
    for (var id = 0; id < instruments.length; id++) {
      var I = instruments[id];
      var name = I.name.replace(/[^\x20-\x7e]/g, " ");
      instrData.write("\n\n");
      instrData.write(rule96() + "\n");
      instrData.location(".instrument." + id);
      instrData.write("; name " + name + "\n");
      instrData.write("; mode " + I.mode + "\n");
      instrData.write("\n");
      instrData.write(".instrument." + id + ".table\n");
      var kinds = ["volEnv", "arpEnv", "waveFormEnv"];
      for (var kd = 0; kd < kinds.length; kd++)
        instrData.pointer(".instrument." + id + "." + kinds[kd]);
      /* envBlock writes the one newline between the pointers and its
       * comment (the writer's single '\n' there). */
      envBlock(instrData, id, "volEnv", I.vol, null);
      envBlock(instrData, id, "arpEnv", I.arp, I.arp.mode);
      envBlock(instrData, id, "waveFormEnv", I.wave, null);
    }
    instrData.write("\n\n");
    files[subFolder + "/" + songName + ".instrData.inc"] = instrData.text;

    /* ---- patterns ---- */
    var patternMatrix = new Out();
    patternMatrix.write("\n\n");
    patternMatrix.write(rule96() + "\n");
    patternMatrix.location(".patternList.table");
    for (var pm = 0; pm < CHANNELS; pm++)
      patternMatrix.pointer(".patternList.chan" + pm);
    patternMatrix.write("\n");
    for (var pl = 0; pl < CHANNELS; pl++) {
      patternMatrix.location(".patternList.chan" + pl);
      for (var pn = 0; pn < channels[pl].matrix.length; pn++)
        patternMatrix.write("  .db " + channels[pl].matrix[pn] + "\n");
    }
    patternMatrix.write("\n\n");
    files[subFolder + "/" + songName + ".patternMatrix.inc"] =
      patternMatrix.text;

    var patternData = new Out();
    patternData.write("\n\n");
    patternData.write(rule96() + "\n");
    patternData.location(".pattern.table");
    for (var pt = 0; pt < CHANNELS; pt++)
      patternData.pointer(".pattern.table.chan" + pt);
    patternData.write("\n\n");
    for (var pb = 0; pb < CHANNELS; pb++)
      patternData.write("  .db bank(.pattern.table.chan" + pb + ")\n");
    patternData.write("\n\n");
    for (var pc = 0; pc < CHANNELS; pc++) {
      patternData.write(";" + dots(53) + "\n");
      patternData.location(".pattern.table.chan" + pc);
      for (var pd = 0; pd < channels[pc].unique.length; pd++)
        patternData.pointer(".pattern.table.chan" + pc + ".pattern" + pd);
      patternData.write("\n\n");
      patternData.write(rule96() + "\n");
      patternData.write("\n\n");
    }
    for (var pe = 0; pe < CHANNELS; pe++) {
      patternData.write(";" + dots(72) + "\n");
      patternData.write(";" + dots(72) + "\n");
      patternData.write("\n");
      for (var pf = 0; pf < channels[pe].unique.length; pf++) {
        patternData.write(";" + dots(38) + "\n");
        patternData.location(".pattern.table.chan" + pe + ".pattern" + pf);
        patternData.write("\n");
        var rows = channels[pe].unique[pf];
        for (var pr = 0; pr < rows.length; pr++) {
          var bytes = [];
          for (var px = 0; px < rows[pr].length; px++)
            bytes.push("$" + rows[pr][px].toString(16));
          patternData.write("  .db " + bytes.join(", ") + "\n");
        }
        patternData.write("\n\n");
      }
    }
    patternData.write("\n\n");
    files[subFolder + "/" + songName + ".patternData.inc"] = patternData.text;

    /* ---- waveforms ---- */
    var wfMatrix = new Out();
    wfMatrix.write("\n\n");
    wfMatrix.write(rule96() + "\n");
    wfMatrix.location(".waveform.table");
    wfMatrix.write("\n");
    for (var wm = 0; wm < mod.wavetables.length; wm++)
      wfMatrix.pointer(".waveform." + wm);
    wfMatrix.write("\n\n");
    files[subFolder + "/" + songName + ".wfMatrix.inc"] = wfMatrix.text;

    var wfData = new Out();
    wfData.write("\n\n");
    wfData.write(rule96() + "\n");
    for (var wd = 0; wd < mod.wavetables.length; wd++) {
      wfData.write(";" + dots(53) + "\n");
      wfData.location(".waveform." + wd);
      wfData.array(mod.wavetables[wd], false);
      wfData.write("\n");
    }
    wfData.write("\n\n");
    files[subFolder + "/" + songName + ".wfData.inc"] = wfData.text;

    /* ---- samples: empty, because convert() refuses a song that has any --- */
    var pcmMatrix = new Out();
    pcmMatrix.write("\n\n");
    pcmMatrix.write(rule96() + "\n");
    pcmMatrix.write("\n");
    pcmMatrix.location(".samples.table");
    pcmMatrix.write("  ; offset to sample bank table.\n");
    pcmMatrix.write("  .dw $" + (0).toString(16) + "\n");
    pcmMatrix.write("\n");
    pcmMatrix.write(";" + dots(25) + "\n\n");
    pcmMatrix.write("\n");
    pcmMatrix.write(";" + dots(25) + "\n\n");
    pcmMatrix.write("\n\n");
    files[subFolder + "/" + songName + ".pcmMatrix.inc"] = pcmMatrix.text;

    var pcmData = new Out();
    pcmData.write("\n\n");
    pcmData.write(rule96() + "\n");
    pcmData.write("\n");
    pcmData.write("\n\n");
    files[subFolder + "/" + songName + ".pcmData.inc"] = pcmData.text;

    /* ---- the include list ---- */
    var order = ["header", "instrMatrix", "instrData", "patternMatrix",
                 "patternData", "wfMatrix", "wfData", "pcmMatrix", "pcmData"];
    var song = new Out();
    for (var o = 0; o < order.length; o++) {
      song.write("  .include \"" + prefix + subFolder + "/" + songName + "." +
                 order[o] + ".inc\"\n");
    }
    files[subFolder + "/" + songName + ".song.inc"] = song.text;

    return {
      files: files,
      entry: subFolder + "/" + songName + ".song.inc",
      song: {
        name: mod.songName,
        author: mod.author,
        channels: channels,
        instruments: instruments.length,
        waveforms: mod.wavetables.length,
        samples: 0,
        attributes: { timeBase: mod.timeBase, tick1: mod.tick1,
                      tick2: mod.tick2, frameMode: mod.frameMode,
                      customHz: mod.customHz, rows: rowsPerPattern,
                      orders: orderCount }
      }
    };
  }

  function cloneEnv(env) {
    return {
      size: env.size,
      data: env.data.slice(),
      loop: env.size && env.loop >= env.size && env.loop !== 0xff
        ? env.size - 1 : env.loop
    };
  }

  function envBlock(out, id, kind, env, mode) {
    out.write("\n");
    out.write(";" + dots(24) + "\n");
    out.location(".instrument." + id + "." + kind);
    out.write("\n");
    if (mode !== null)
      out.write(".instrument." + id + "." + kind + ".mode\n  .db " + mode +
                "\n");
    out.write(".instrument." + id + "." + kind + ".size\n  .db " +
              env.size + "\n");
    out.write(".instrument." + id + "." + kind + ".loop\n  .db " +
              env.loop + "\n");
    out.write(".instrument." + id + "." + kind + ".data\n");
    out.array(env.data, false);
    out.write("\n");
  }

  function rule96() {
    return ";" + "#".repeat(75);
  }

  function dots(n) {
    return ".".repeat(n);
  }

  /* ---- 3. the song bank --------------------------------------------------
     The includes use one directive family: labels at column 0, `.page 2`
     (ignored inside one bank), `.include "file"`, `.db` and `.dw` with
     `bank(label)` values.  A song that fits one 8 KiB bank never moves its
     labels, which is what makes ignoring `.page 2` exact. */

  function assemble(files, entry, opts) {
    var options = opts || {};
    var bank = options.bank === undefined ? SONG_BANK : options.bank;
    var org = options.org === undefined ? SONG_ORG : options.org;

    /* Pass 1 measures every label (a byte offset from org — sizes never
     * depend on a value); pass 2 emits, resolving against pass 1's table and
     * checking every label lands where pass 1 measured it. */
    if (!(entry in files))
      refuse("song-syntax", "no entry include " + entry + " in the file set");
    var measured = {};
    walk(true, null);
    var out = walk(false, measured);
    if (out.length > BANK)
      refuse("song-bank",
             "the song assembles to " + out.length + " bytes; its 8 KiB " +
             "bank is full, and a second bank needs a new ROM layout");
    return out;

    function walk(measure, table) {
      var pos = 0;
      var bytes = [];

      function emit(v, max, what) {
        if (typeof v !== "number" || v !== (v | 0) || v < 0 || v > max)
          refuse("song-value", what + " " + v + " does not fit 0.." + max);
        if (!measure) bytes.push(v);
        pos++;
      }

      function evaluate(expr) {
        var text = expr.trim();
        var m = text.match(/^bank\((.+)\)$/);
        if (m) {
          if (table && !(m[1].trim() in table))
            refuse("song-label", "bank() of undefined label " + m[1].trim());
          return bank;
        }
        var h = text.match(/^\$([0-9a-fA-F]+)$/);
        if (h) return parseInt(h[1], 16);
        if (/^-?\d+$/.test(text)) return parseInt(text, 10);
        if (!table)
          return 0;               /* pass 1: a forward label, size only */
        if (!(text in table))
          refuse("song-label", "undefined label " + text);
        return table[text];
      }

      function directives(lines, file) {
        for (var li = 0; li < lines.length; li++) {
          var raw = lines[li];
          var line = stripComment(raw);
          if (!line.trim()) continue;
          if (!/^\s/.test(line)) {
            /* A label at column 0; the writer never indents one. */
            var label = line.trim();
            if (/\s/.test(label))
              refuse("song-syntax", file + ":" + (li + 1) + ": " + raw);
            if (label === ".page") continue;
            if (label[0] !== ".")
              refuse("song-syntax",
                     file + ":" + (li + 1) + ": label " + label +
                     " (a song label starts with a dot)");
            if (measure) {
              if (label in measured)
                refuse("song-label", "label " + label + " is defined twice");
              measured[label] = org + pos;   /* the CPU address PCEAS gives */
            } else if (measured[label] - org !== pos) {
              refuse("song-label", "label " + label + " moved between passes");
            }
            continue;
          }
          var inc = line.match(/^\s*\.include\s+"([^"]+)"\s*$/);
          if (inc) {
            if (!(inc[1] in files))
              refuse("song-syntax", file + ": includes missing " + inc[1] +
                                    " (the converter writes one name per file)");
            directives(files[inc[1]].split(/\r?\n/), inc[1]);
            continue;
          }
          if (/^\s*\.page\s+2\s*$/.test(line)) continue;
          var m = line.match(/^\s*\.db\s+(.*)$/);
          var size = 1;
          if (!m) {
            m = line.match(/^\s*\.dw\s+(.*)$/);
            size = 2;
          }
          if (!m && !/^\s*\.page\b/.test(line))
            refuse("song-syntax", file + ":" + (li + 1) + ": " + raw.trim());
          if (!m) continue;
          var values = m[1].split(",");
          for (var vi = 0; vi < values.length; vi++) {
            var v = evaluate(values[vi]);
            if (size === 2) {
              emit(v & 0xff, 0xff, "a .dw low byte");
              emit((v >> 8) & 0xff, 0xff, "a .dw high byte");
            } else {
              emit(v, 0xff, "a .db value");
            }
          }
        }
      }

      directives(files[entry].split(/\r?\n/), entry);
      var result = new Uint8Array(bytes.length);
      for (var i = 0; i < bytes.length; i++) result[i] = bytes[i];
      return result;
    }
  }

  function stripComment(line) {
    var inQuote = false;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (c === '"') inQuote = !inQuote;
      else if (c === ";" && !inQuote) return line.slice(0, i);
    }
    return line;
  }

  return {
    convert: convert,
    assemble: assemble,
    SONG_BANK: SONG_BANK,
    SONG_ORG: SONG_ORG,
    BANK: BANK
  };
});
