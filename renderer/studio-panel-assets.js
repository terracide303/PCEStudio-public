/*
 * studio-panel-assets.js — the ASSETS tab extended to ppu.toys' (§3.6), a
 * module of the studio since #99.
 *
 * ppu.toys' ASSETS tab is one pane with three parts: the toy's memory as
 * bars, its songs, and the built-in sounds you Place into the toy.  The
 * page's ASSETS tab already lists the toy's files (#77); this module adds the
 * other three beneath that list, and keeps the file list where it is:
 *
 *   memory     VRAM / CRAM / ROM as three gauges, from
 *              renderer/pce-assets.js bars(): the VRAM words the frame's own
 *              regions claim (#26), the CRAM entries that hold a colour, and
 *              the HuCard's 1 MB against the validator's estimate plus the
 *              toy's files.
 *   songs      songs.json, each "N notes · M patterns" with a menu.
 *   sounds     the fifteen built-in PC Engine instruments, each Add to toy,
 *              which copies the patch into the toy's instruments.json — the
 *              ppu.toys Place, with the toy's own file as the destination.
 *              Every row (a built-in and one the toy holds) also has a play
 *              button: #122's audition, a phrase of C4, E4, G4 — one hit for
 *              a drum — rendered by pce-assets.js's play() through
 *              renderer/pce-psg.js and played in the page's AudioContext.
 *
 * + Add makes a song, a wave, or opens the panel that edits tiles, palettes,
 * sprites and the map (those are files, and their editors are SCREEN /
 * PALETTES / SPRITES — this module does not grow a second one).
 *
 * The drawing is this module's alone: studio.html loads the file and nothing
 * else, so a panel card runs in parallel with the others.  The numbers are
 * the model's (renderer/pce-assets.js), and the sounds are played by
 * renderer/pce-psg.js — there is no second PSG here.
 */
(function (root) {
  "use strict";
  var P = root.PCEStudio = root.PCEStudio || {};
  P.studioPanelModules = P.studioPanelModules || [];

  var CSS_ID = "assets-panel-css";
  var BOX_ID = "assets-more";
  var CSS = [
    ".asx-head{display:flex;align-items:baseline;gap:10px;margin:18px 0 6px}",
    ".asx-head h3{font:600 11px var(--mono);letter-spacing:.12em;color:var(--muted);margin:0;text-transform:uppercase}",
    ".asx-head .asx-spacer{flex:1}",
    ".asx-sub{color:var(--muted);font:12px var(--mono)}",
    ".asx-bars{display:flex;flex-direction:column;gap:8px;max-width:46rem}",
    ".asx-bar{display:grid;grid-template-columns:58px 1fr 168px;gap:10px;align-items:center}",
    ".asx-bar .asx-lab{font:600 11px var(--mono);color:var(--muted);letter-spacing:.08em}",
    ".asx-track{position:relative;height:10px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.10);border-radius:2px;overflow:hidden}",
    ".asx-fill{position:absolute;left:0;top:0;bottom:0;background:var(--accent,#6cf)}",
    ".asx-val{font:11px var(--mono);color:var(--muted);text-align:right}",
    ".asx-parts{grid-column:2 / span 2;font:10px var(--mono);color:var(--muted);margin-top:-4px}",
    ".asx-list{display:flex;flex-direction:column;max-width:46rem;border-top:1px solid rgba(255,255,255,.08)}",
    ".asx-row{display:grid;grid-template-columns:1fr auto auto auto;gap:10px;align-items:center;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.06);font:12px var(--mono)}",
    ".asx-actions{display:flex;gap:6px;align-items:center}",
    ".asx-play{min-width:26px}",
    ".asx-name{color:var(--fg,#ddd)}",
    ".asx-tag{font:600 9px var(--mono);letter-spacing:.08em;color:var(--muted);border:1px solid rgba(255,255,255,.18);border-radius:2px;padding:1px 4px}",
    ".asx-tag.is-in{color:var(--accent,#6cf);border-color:currentColor}",
    ".asx-what{font:10px var(--mono);color:var(--muted)}",
    ".asx-menu{position:relative}",
    ".asx-pop{position:absolute;right:0;top:100%;z-index:30;background:var(--pop,#15181d);border:1px solid rgba(255,255,255,.14);border-radius:3px;min-width:180px;padding:4px;display:none}",
    ".asx-pop.is-on{display:block}",
    ".asx-pop button{display:block;width:100%;text-align:left;background:none;border:0;color:var(--fg,#ddd);font:12px var(--mono);padding:5px 8px;cursor:pointer}",
    ".asx-pop button:hover{background:rgba(255,255,255,.06)}",
    ".asx-note{font:11px var(--mono);color:var(--muted);margin:6px 0 0}",

    /* #123 — the Add Source dialog, ppu.toys' shape with the PCE's options. */
    ".asx-modal{position:fixed;inset:0;z-index:80;background:rgba(0,0,0,.62);display:flex;align-items:center;justify-content:center}",
    ".asx-dialog{background:var(--pop,#15181d);border:1px solid rgba(255,255,255,.16);border-radius:4px;width:min(760px,92vw);max-height:88vh;overflow:auto;padding:16px 18px;font:12px var(--mono);color:var(--fg,#ddd);box-shadow:0 18px 60px rgba(0,0,0,.55)}",
    ".asx-dialog h2{font:600 13px var(--mono);letter-spacing:.1em;text-transform:uppercase;margin:0 0 12px}",
    ".asx-drop{border:1px dashed rgba(255,255,255,.28);border-radius:3px;padding:18px;text-align:center;color:var(--muted);cursor:pointer}",
    ".asx-drop.is-over{border-color:var(--accent,#6cf);color:var(--accent,#6cf)}",
    ".asx-fields{display:grid;grid-template-columns:150px 1fr;gap:8px 12px;align-items:center;margin:14px 0}",
    ".asx-fields label{color:var(--muted);font:11px var(--mono);letter-spacing:.06em}",
    ".asx-fixed{color:var(--muted);font:11px var(--mono)}",
    ".asx-preview{border:1px solid rgba(255,255,255,.12);border-radius:3px;padding:10px;min-height:96px}",
    ".asx-preview canvas{image-rendering:pixelated;display:block}",
    ".asx-preview .asx-side{display:flex;gap:14px;flex-wrap:wrap}",
    ".asx-preview .asx-cap{font:10px var(--mono);color:var(--muted);margin-top:4px}",
    ".asx-warn{color:#f6c46a;font:11px var(--mono);margin:6px 0 0}",
    ".asx-err{color:#f78a8a;font:11px var(--mono);margin:6px 0 0}",
    ".asx-foot{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}"
  ].join("\n");

  P.studioPanelModules.push({
    id: "assets",
    register: function (studio) {
      var A = P.assets;
      var doc = studio.document;
      if (!A || !studio.$("assets-pane")) return;

      var box = null;
      var els = {};              /* the elements refresh() writes to */
      var state = {
        bars: [],
        instruments: [],         /* the toy's own, from instruments.json */
        songs: [],               /* the toy's, from songs.json */
        toyName: "",
        error: "",
        report: null
      };
      var lastReportFor = null;  /* the source the validator last priced */
      var audio = null;          /* the AudioContext, once a preview needs one */
      var source = null;         /* the node a preview is playing */
      var lastPreview = null;    /* the last preview's PCM, for the evidence */

      /* ---- small DOM helpers (the stub DOM the checks use has only these) */
      function el(tag, cls, text) {
        var e = doc.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined && text !== null) e.textContent = String(text);
        return e;
      }
      function button(cls, text, fn) {
        var b = doc.createElement("button");
        b.type = "button";
        b.className = cls;
        b.textContent = text;
        if (fn) b.addEventListener("click", fn);
        return b;
      }
      function clear(host) { while (host.firstChild) host.removeChild(host.firstChild); }

      function injectCss() {
        if (doc.getElementById && doc.getElementById(CSS_ID)) return;
        var s = doc.createElement("style");
        s.id = CSS_ID;
        s.textContent = CSS;
        var head = doc.head || (doc.getElementsByTagName && doc.getElementsByTagName("head")[0]);
        if (head && head.appendChild) head.appendChild(s);
      }

      /* ---- reading the toy ------------------------------------------------ */
      function files() { return studio.toy.files() || []; }

      function toyFileName() {
        var t = studio.toy.current() || {};
        return t.title || t.name || "untitled toy";
      }

      /* The validator's ROM estimate, once per distinct source: a check runs
       * the toy, so it is not repeated when nothing changed. */
      function reportFor(source) {
        if (!P.validate || !P.validate.validate) return { report: null, why: "no validator" };
        if (lastReportFor && lastReportFor.source === source) return lastReportFor;
        var r;
        try {
          r = P.validate.validate(source, { chunkName: "@" + toyFileName() + ".lua" });
        } catch (e) {
          r = { ok: false, code: e && e.code || "validate-error",
                problems: [{ code: e && e.code || "validate-error",
                             message: String(e && e.message || e) }],
                budgets: null };
        }
        lastReportFor = { source: source, report: r };
        return lastReportFor;
      }

      function readToy() {
        var waveText = A.fileText(files(), "instruments.json");
        try {
          state.instruments = waveText ? A.parseInstruments(waveText).instruments : [];
          state.error = "";
        } catch (e) {
          state.instruments = [];
          state.error = (e.code || "asset") + ": " + e.message;
        }
        var songText = A.fileText(files(), "songs.json");
        try {
          state.songs = songText ? A.parseSongs(songText).songs : [];
        } catch (e2) {
          state.songs = [];
          state.error = state.error || (e2.code || "asset") + ": " + e2.message;
        }
        state.toyName = toyFileName();
        var st = studio.render.state();
        var map = st && P.panels && P.panels.vramMap ? P.panels.vramMap(st) : null;
        var priced = reportFor(studio.toy.source());
        state.report = priced.report;
        state.bars = A.bars({ state: st, map: map, report: priced.report,
                              files: files() });
      }

      /* ---- writing the toy ------------------------------------------------ */
      function fileOf(name) {
        var list = files();
        for (var i = 0; i < list.length; i++) if (list[i].name === name) return list[i];
        return null;
      }

      function putFile(name, text) {
        var f = fileOf(name);
        if (!f) {
          f = { name: name, kind: "json", source: text };
          files().push(f);
        } else {
          f.source = text;
        }
        studio.render.pause && studio.render.pause();
        studio.toy.persist();
        studio.toy.saved("saved in this browser");
        studio.toy.refreshAssets();
        return f;
      }

      function addToToy(inst) {
        if (!inst) throw new Error("addToToy needs an instrument");
        var text = A.fileText(files(), "instruments.json");
        var out = A.addInstrument(text, inst);
        putFile("instruments.json", out.text);
        refresh();
        studio.toast(inst.name + " added to the toy.");
        return out.instrument;
      }

      function removeFromToy(name) {
        var text = A.fileText(files(), "instruments.json");
        if (!text) return false;
        var out = A.removeInstrument(text, name);
        putFile("instruments.json", out.text);
        refresh();
        studio.toast(name + " removed from the toy.");
        return true;
      }

      function isInToy(name) {
        for (var i = 0; i < state.instruments.length; i++)
          if (state.instruments[i].name === name) return true;
        return false;
      }

      function nextSongName() {
        for (var i = 1; ; i++)
          if (!state.songs.some(function (s) { return s.name === "song" + i; }))
            return "song" + i;
      }

      function addBlankSong() {
        var text = A.fileText(files(), "songs.json");
        var out = A.addSong(text, A.blankSong(nextSongName()));
        putFile("songs.json", out.text);
        refresh();
        studio.toast("Added " + out.song.name + " — no music yet (#35 keeps the tracker).");
        return out.song;
      }

      function addBlankWave() {
        var n = 1;
        while (isInToy("wave" + n)) n++;
        var inst = { id: "wave" + n, name: "wave" + n, kind: "wave", channel: 0,
                     wave: A.harmonics([[1, 1]]),
                     envelope: { size: 8, loop: 7,
                                 data: [31, 31, 31, 31, 31, 28, 24, 20] },
                     about: "a blank sine to edit" };
        return addToToy(inst);
      }

      /* ---- playing one (#122) ---------------------------------------------
       * The card's audition: a short phrase — C4, E4, G4 for a melodic
       * instrument, one hit for a drum — played through pce-assets.js's
       * play(), which writes the PSG registers a toy would and renders them
       * with renderer/pce-psg.js.  The panel only schedules the notes and
       * hands the PCM to the page; the pitch and the timbre are the model's,
       * so an audition and the toy cannot disagree about what an instrument
       * is.  No note is invented here: `noteHz` and `play` are pce-assets'. */
      var PHRASE = ["C4", "E4", "G4"];
      var NOTE_FRAMES = 24;      /* 0.4 s at 60 frames a second */
      var DRUM_FRAMES = 30;      /* a drum rings once, a little longer */

      function instrumentByName(name) {
        var i, list = state.instruments;
        for (i = 0; i < list.length; i++)
          if (list[i].name === name) return list[i];
        list = A.INSTRUMENTS || [];
        for (i = 0; i < list.length; i++)
          if (list[i].name === name) return list[i];
        return null;
      }

      function resolve(inst) {
        var got = typeof inst === "string" ? instrumentByName(inst) : inst;
        if (!got) {
          var e = new Error("no instrument " + JSON.stringify(inst));
          e.code = "asset-name";
          throw e;
        }
        return got;
      }

      /* The notes an instrument is auditioned with: the phrase for a wave,
       * one hit for a noise drum (its pitch is the noise clock, not a note). */
      function phraseFor(inst) {
        if (inst.kind === "noise")
          return [{ note: "C4", frames: DRUM_FRAMES, hit: true }];
        return PHRASE.map(function (note) {
          return { note: note, frames: NOTE_FRAMES, hit: false };
        });
      }

      /* Each note is its own render — the model's envelope starts where the
       * driver starts it — and the pieces are joined into one Int16Array so
       * the page plays the phrase as one buffer.  The per-note RMS and
       * fundamental are measured on that note's own samples, which is what
       * the evidence reads. */
      function previewPcm(inst) {
        if (!A || typeof A.play !== "function")
          throw new Error("the PSG model is not loaded");
        var notes = phraseFor(inst);
        var pcm = new Int16Array(0);
        var at = 0;                       /* the next note's first sample */
        var out = [];
        var sampleRate = A.SAMPLE_RATE || 44100;
        for (var n = 0; n < notes.length; n++) {
          var spec = notes[n];
          var got = A.play(inst, { note: spec.note, frames: spec.frames });
          sampleRate = got.sampleRate;
          var frames = got.pcm.length / 2;
          var r = A.rms(got.pcm, 0, frames);
          var f = A.fundamental(got.pcm, got.sampleRate,
                                Math.floor(frames * 0.2), frames);
          out.push({ note: spec.note, hit: !!spec.hit,
                     hz: A.noteHz(spec.note),
                     fromSample: at, toSample: at + frames,
                     frames: frames, rms: r.rms, peak: r.peak,
                     fundamental: f });
          var join = new Int16Array(pcm.length + got.pcm.length);
          join.set(pcm, 0);
          join.set(got.pcm, pcm.length);
          pcm = join;
          at += frames;
        }
        var whole = A.rms(pcm, 0, at);
        lastPreview = {
          instrument: inst.name,
          kind: inst.kind,
          pcm: pcm,
          sampleRate: sampleRate,
          samples: at,
          seconds: at / sampleRate,
          peak: whole.peak,
          rms: whole.rms,
          notes: out
        };
        return lastPreview;
      }

      function context() {
        if (audio) return audio;
        var Ctor = root.AudioContext || root.webkitAudioContext;
        if (!Ctor) return null;
        try { audio = new Ctor(); } catch (e) { audio = null; }
        return audio;
      }

      function stopPreview() {
        if (source) {
          try { source.stop(); } catch (e) { /* already stopped */ }
          source = null;
        }
      }

      /* The phrase into the page's audio.  Headless (no AudioContext) this
       * is the render alone, which is exactly what the evidence wants. */
      function preview(inst) {
        var got = previewPcm(resolve(inst));
        var ctx = context();
        if (ctx && got.pcm.length) {
          stopPreview();
          try {
            var buf = ctx.createBuffer(1, got.pcm.length, got.sampleRate);
            var ch = buf.getChannelData(0);
            for (var i = 0; i < got.pcm.length; i++)
              ch[i] = got.pcm[i] / 32768;
            source = ctx.createBufferSource();
            source.buffer = buf;
            source.connect(ctx.destination);
            source.start();
          } catch (e) { source = null; }
        }
        return got;
      }

      /* ---- drawing --------------------------------------------------------- */
      var pop = null;
      function closePop() {
        if (pop) { pop.className = "asx-pop"; pop = null; }
      }

      function addMenu(host) {
        /* #123: Add Source sits beside + Add -- one makes an empty file, the
         * other turns a dropped picture or sound into the files the panels
         * edit. */
        var source = button("btn-mini", "Add Source", function () { openAdd(); });
        source.id = "assets-addsource";
        source.title = "Import a PNG, WAV, .mid or .pce.studio file as PCE assets";
        host.appendChild(source);
        var wrap = el("div", "asx-menu");
        /* The popover is built once and toggled: rebuilding it per click
         * would leave a stack of hidden menus in the pane. */
        var menu = el("div", "asx-pop");
        var b = button("btn-mini", "+ Add", function () {
          var on = menu.className.indexOf("is-on") < 0;
          closePop();
          if (!on) return;
          menu.className = "asx-pop is-on";
          pop = menu;
        });
        b.id = "assets-add";
        wrap.appendChild(b);
        [
          ["Tiles", function () { open("screen", "tiles.json"); }],
          ["Palettes", function () { open("palettes", "palettes.json"); }],
          ["Sprites", function () { open("sprites", "sprites.json"); }],
          ["Map", function () { open("screen", "tiles.json"); }],
          ["Song", function () { addBlankSong(); }],
          ["Wave", function () { addBlankWave(); }]
        ].forEach(function (it) {
          menu.appendChild(button("", it[0], function () { closePop(); it[1](); }));
        });
        wrap.appendChild(menu);
        host.appendChild(wrap);
      }

      function open(panel, file) {
        if (studio.layout.panel) studio.layout.panel(panel);
        var f = fileOf(file);
        if (f) studio.toy && studio.toy.selectFile && studio.toy.selectFile(file);
        studio.toast("The " + file + " editor is the " + panel.toUpperCase() + " panel.");
        return panel;
      }

      /* ---- Add Source (#123) ----------------------------------------------
       * ppu.toys' Add Source, with every option either mapped to what the PC
       * Engine can do or left out.  The kinds are the four things the VDC
       * draws and the two the PSG plays; there is no Mode 7 (the PCE has no
       * rotation or scaling) and no bit-depth list (a VDC tile is always
       * 16 colours -- the line says so instead of offering a choice that
       * would be ignored).  The palettes slider stops at 16 because that is
       * all the BAT's four palette bits name.  The picture and the sample
       * are made by renderer/pce-source.js; this module draws the dialog and
       * writes the files the panels already read. */
      var KIND_LABELS = [
        ["bg", "BG (tilemap)"],
        ["sprites", "Sprites (patterns)"],
        ["tilesheet", "Tilesheet (tiles only)"],
        ["palette", "Palette only"],
        ["sample", "Sample (DDA audio)"],
        ["song", "Song (.mid)"]
      ];
      var DITHER_LABELS = [
        ["none", "none · flat nearest colour"],
        ["ordered", "ordered · 8x8 Bayer"],
        ["diffusion", "diffusion · Floyd-Steinberg"]
      ];
      var SAMPLE_RATES = [3000, 4000, 6000, 8000, 12000];
      var add = null;      /* the open dialog: {state, els} */

      function srcModel() {
        var S = P.source;
        if (!S) throw new Error("renderer/pce-source.js is not loaded");
        return S;
      }

      /* The page has no synchronous zlib, so a PNG's IDAT goes through
       * DecompressionStream ("deflate" is the zlib wrapper, which is what a
       * PNG holds).  Node-style callers pass zlib.inflateSync to the model. */
      function inflateBytes(bytes) {
        if (typeof DecompressionStream !== "function")
          return Promise.reject(new Error("this browser has no DecompressionStream"));
        var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
        return new Response(stream).arrayBuffer().then(function (b) {
          return new Uint8Array(b);
        });
      }

      function readFile(file) {
        if (file && typeof file.arrayBuffer === "function")
          return file.arrayBuffer().then(function (b) {
            return { name: file.name || "source", bytes: new Uint8Array(b) };
          });
        return new Promise(function (resolve, reject) {
          var reader = new root.FileReader();
          reader.onload = function () {
            resolve({ name: file.name || "source",
                      bytes: new Uint8Array(reader.result) });
          };
          reader.onerror = function () { reject(reader.error || new Error("read failed")); };
          reader.readAsArrayBuffer(file);
        });
      }

      /* The image as drawable RGB: the original for the left-hand pane. */
      function rgbOfImage(img) {
        var n = img.width * img.height;
        var out = new Uint8Array(n * 4);
        for (var i = 0; i < n; i++) {
          out[i * 4] = img.rgba[i * 4];
          out[i * 4 + 1] = img.rgba[i * 4 + 1];
          out[i * 4 + 2] = img.rgba[i * 4 + 2];
          out[i * 4 + 3] = 255;
        }
        return out;
      }

      function paint(canvas, width, height, rgba) {
        if (!canvas || !canvas.getContext) return false;
        var ctx = canvas.getContext("2d");
        if (!ctx) return false;
        canvas.width = width;
        canvas.height = height;
        if (!ctx.createImageData) return false;
        var img = ctx.createImageData(width, height);
        for (var i = 0; i < rgba.length; i++) img.data[i] = rgba[i];
        ctx.putImageData(img, 0, 0);
        return true;
      }

      /* Every image kind ends up in these files; the sample and the song are
       * their own.  Kept in one place so "Add source" writes exactly what the
       * preview measured. */
      function filesFor(result) {
        if (!result) return {};
        if (result.kind === "sample") {
          return { "samples.json": JSON.stringify({
            version: 1,
            samples: [{ name: result.name, rate: result.rate, bits: 5,
                        data: result.samples,
                        seconds: result.seconds, source: "Add Source (#123)" }]
          }, null, 2) + "\n" };
        }
        if (result.kind === "song") return result.files || {};
        if (result.kind === "studio") {
          var out = {};
          for (var i = 0; i < result.files.length; i++)
            out[result.files[i].name] = result.files[i].source;
          return out;
        }
        return result.files || {};
      }

      function closeAdd() {
        if (!add) return;
        if (add.els && add.els.modal && add.els.modal.parentNode)
          add.els.modal.parentNode.removeChild(add.els.modal);
        add = null;
      }

      function addState() {
        return add ? add.state : null;
      }

      /* Read a dropped file into the dialog's state and redraw the preview.
       * Everything is async because the PNG's zlib stream is the page's. */
      function feedAdd(file) {
        if (!add) return Promise.reject(new Error("the dialog is not open"));
        var S = srcModel();
        return readFile(file).then(function (got) {
          var state = add.state;
          state.fileName = got.name;
          state.error = "";
          if (!state.name || state.name === "source")
            state.name = got.name.replace(/\.[^.]+$/, "");
          var kind = S.kindOf(got.name, got.bytes);
          if (kind) state.detected = kind;
          try {
            if (kind === "studio") {
              state.result = S.importStudio(new TextDecoder().decode(got.bytes));
              state.kind = "studio";
            } else if (kind === "sample") {
              /* the bytes are kept: moving the rate slider re-imports the
               * same sound rather than asking for the file again */
              state.sampleBytes = got.bytes;
              state.kind = "sample";
              state.result = S.importWav(got.bytes, { rate: state.rate,
                                                     name: state.name });
            } else if (kind === "song") {
              state.result = S.importMidi(got.bytes, { name: state.name });
              state.kind = "song";
            } else {
              /* an image: decode, then import with the dialog's options.  A
               * picture dropped while a WAV's kind was still selected is a
               * picture, not a sample, so the kind falls back to BG. */
              state.sampleBytes = null;
              if (["bg", "sprites", "tilesheet", "palette"]
                    .indexOf(state.kind) < 0) state.kind = "bg";
              var info = S.pngInfo(got.bytes);
              return inflateBytes(info.idat).then(function (raw) {
                state.image = S.pngPixels(info, raw);
                state.original = { width: state.image.width,
                                   height: state.image.height,
                                   pixels: rgbOfImage(state.image) };
                reimport();
                drawAdd();
                return state.result;
              });
            }
            reimport();
          } catch (e) {
            state.error = (e.code || "error") + ": " + e.message;
            state.result = null;
          }
          drawAdd();
          return state.result;
        }, function (e) {
          add.state.error = "read: " + (e && e.message || e);
          drawAdd();
          return null;
        });
      }

      /* Run the importer again with the dialog's current options (a slider
       * move, a dither change), without re-reading the file. */
      function reimport() {
        if (!add) return null;
        var S = srcModel();
        var state = add.state;
        if (state.kind === "sample" && state.fileName && state.sampleBytes) {
          try {
            state.result = S.importWav(state.sampleBytes,
              { rate: state.rate, name: state.name });
          } catch (e) {
            state.error = (e.code || "error") + ": " + e.message;
            state.result = null;
          }
          return state.result;
        }
        if (state.kind === "song" || state.kind === "studio") return state.result;
        if (!state.image) return null;
        try {
          state.result = S.importImage(state.image, {
            kind: state.kind, dither: state.dither,
            alphaThreshold: state.alpha, maxPalettes: state.palettes,
            name: state.name
          });
          state.error = "";
        } catch (e) {
          state.error = (e.code || "error") + ": " + e.message;
          state.result = null;
        }
        return state.result;
      }

      /* The preview: the original and the PCE result side by side, then what
       * it costs -- tiles, palettes, colours -- and a warning for each limit
       * it does not fit inside. */
      function drawAdd() {
        if (!add) return;
        var state = add.state, els = add.els, S = srcModel();
        /* a dropped file decides its own kind, so the dropdown follows */
        if (els.kind && els.kind.value !== state.kind) els.kind.value = state.kind;
        var host = els.preview;
        clear(host);
        if (state.error) {
          host.appendChild(el("p", "asx-err", state.error));
        }
        if (!state.result) {
          host.appendChild(el("p", "asx-sub",
            "Preview appears here after you drop an image or audio file"));
          els.commit.disabled = true;
          return;
        }
        var result = state.result;
        var sides = el("div", "asx-side");

        if (state.original) {
          var a = el("div");
          var ca = el("canvas");
          if (paint(ca, state.original.width, state.original.height,
                    state.original.pixels)) a.appendChild(ca);
          a.appendChild(el("div", "asx-cap", "original " + state.original.width +
                          "x" + state.original.height));
          sides.appendChild(a);
        }
        if (result.preview) {
          var b = el("div");
          var cb = el("canvas");
          if (paint(cb, result.preview.width, result.preview.height,
                    rgbaOf(result.preview.pixels))) b.appendChild(cb);
          b.appendChild(el("div", "asx-cap", "PC Engine " +
                          result.preview.width + "x" + result.preview.height));
          sides.appendChild(b);
        }
        if (result.kind === "sample") {
          var c = el("div");
          var cc = el("canvas");
          if (paint(cc, 256, 64, waveOf(result.samples))) c.appendChild(cc);
          c.appendChild(el("div", "asx-cap", "DDA " + result.rate + " Hz, 5 bits"));
          sides.appendChild(c);
        }
        host.appendChild(sides);

        var line = els.stats;
        clear(line);
        if (result.kind === "sample") {
          line.textContent = result.samples.length + " samples · " +
            result.seconds.toFixed(2) + " s at " + result.rate + " Hz · " +
            result.stats.bytes + " bytes of the 1 MB ROM";
        } else if (result.kind === "song") {
          line.textContent = result.stats.notes + " notes · " +
            result.stats.patterns + " patterns · " + result.stats.tempo +
            " BPM · " + result.stats.channels + " channel(s)";
        } else if (result.kind === "studio") {
          line.textContent = result.stats.files + " files";
        } else {
          line.textContent = result.stats.tiles + " tiles · " +
            result.stats.palettes + " of " + srcModel().BG_PALETTES +
            " palettes · " + result.stats.colours + " colours of 512 · at " +
            "most " + result.stats.maxTileColours + " a tile";
        }
        host.appendChild(line);

        /* the warnings: what does not fit, said rather than discovered later */
        var warnings = (result.warnings || []).slice();
        if (result.kind !== "sample" && result.kind !== "song" &&
            result.kind !== "studio" && result.stats.tiles > S.MAX_TILES)
          warnings.push(result.stats.tiles + " tiles pass the ROM layout's " +
                        S.MAX_TILES + " — the picture will not fit");
        for (var w = 0; w < warnings.length; w++)
          host.appendChild(el("p", "asx-warn", warnings[w]));

        els.commit.disabled = false;
        if (els.name && !els.name.value) els.name.value = state.name;
      }

      function rgbaOf(rgb) {
        var n = rgb.length / 3, out = new Uint8Array(n * 4);
        for (var i = 0; i < n; i++) {
          out[i * 4] = rgb[i * 3];
          out[i * 4 + 1] = rgb[i * 3 + 1];
          out[i * 4 + 2] = rgb[i * 3 + 2];
          out[i * 4 + 3] = 255;
        }
        return out;
      }

      /* The sample as a waveform picture: 256 columns, 64 rows. */
      function waveOf(samples) {
        var w = 256, h = 64, out = new Uint8Array(w * h * 4);
        for (var i = 0; i < w * h; i++) {
          out[i * 4] = 22; out[i * 4 + 1] = 26; out[i * 4 + 2] = 32;
          out[i * 4 + 3] = 255;
        }
        for (var x = 0; x < w; x++) {
          var at = Math.floor(x * samples.length / w);
          var v = samples[Math.min(samples.length - 1, at)] / 31;
          var y = Math.round((1 - v) * (h - 1));
          var o = (y * w + x) * 4;
          out[o] = 108; out[o + 1] = 204; out[o + 2] = 255;
        }
        return out;
      }

      function openAdd() {
        if (add) return add.state;
        closePop();
        var state = {
          name: "source", kind: "bg", dither: "none", palettes: 16, alpha: 128,
          rate: 6000, result: null, error: "", image: null, original: null,
          fileName: "", sampleBytes: null
        };
        var els = {};
        var modal = el("div", "asx-modal");
        modal.id = "assets-addsource";
        var dialog = el("div", "asx-dialog");
        modal.appendChild(dialog);
        dialog.appendChild(el("h2", null, "Add source"));

        /* the drop zone, theirs' wording with our kinds */
        var drop = el("div", "asx-drop",
          "drop a PNG, WAV, .mid or .pce.studio, or click to pick");
        drop.id = "addsource-drop";
        var picker = doc.createElement("input");
        picker.type = "file";
        picker.accept = ".png,.wav,.mid,.midi,.pce.studio,.json";
        picker.id = "addsource-file";
        picker.style.display = "none";
        drop.addEventListener("click", function () {
          if (picker.click) picker.click();
        });
        drop.addEventListener("dragover", function (e) {
          drop.className = "asx-drop is-over";
          if (e && e.preventDefault) e.preventDefault();
        });
        drop.addEventListener("dragleave", function () { drop.className = "asx-drop"; });
        drop.addEventListener("drop", function (e) {
          drop.className = "asx-drop";
          if (e && e.preventDefault) e.preventDefault();
          var f = e && e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
          if (f) feedAdd(f);
        });
        picker.addEventListener("change", function () {
          if (picker.files && picker.files[0]) feedAdd(picker.files[0]);
        });
        dialog.appendChild(drop);
        dialog.appendChild(picker);

        var fields = el("div", "asx-fields");
        function field(label, control, id) {
          fields.appendChild(el("label", null, label));
          if (control) control.id = id;
          fields.appendChild(control);
          return control;
        }

        var kindSel = doc.createElement("select");
        KIND_LABELS.forEach(function (k) {
          var o = doc.createElement("option");
          o.value = k[0];
          o.textContent = k[1];
          kindSel.appendChild(o);
        });
        kindSel.addEventListener("change", function () {
          state.kind = kindSel.value;
          if (state.kind !== "sample") state.sampleBytes = null;
          reimport();
          drawAdd();
        });
        field("kind", kindSel, "addsource-kind");

        /* No bit depth choice: the VDC's tile is always 16 colours, so the
         * dialog says that rather than offering a list that would be a lie. */
        field("bit depth", el("span", "asx-fixed",
              "4bpp · 16 colours (the PC Engine always uses 16 per tile)"),
              "addsource-depth");

        var palRange = doc.createElement("input");
        palRange.type = "range";
        palRange.min = "1";
        palRange.max = "16";
        palRange.value = "16";
        var palVal = el("span", "asx-fixed", "palettes · at most 16");
        palRange.addEventListener("input", function () {
          state.palettes = Number(palRange.value);
          palVal.textContent = "palettes · at most " + state.palettes;
          reimport();
          drawAdd();
        });
        var palWrap = el("span");
        palWrap.appendChild(palRange);
        palWrap.appendChild(el("span", null, " "));
        palWrap.appendChild(palVal);
        field("palettes", palWrap, "addsource-palettes");

        var ditherSel = doc.createElement("select");
        DITHER_LABELS.forEach(function (d) {
          var o = doc.createElement("option");
          o.value = d[0];
          o.textContent = d[1];
          ditherSel.appendChild(o);
        });
        ditherSel.addEventListener("change", function () {
          state.dither = ditherSel.value;
          reimport();
          drawAdd();
        });
        field("dither", ditherSel, "addsource-dither");

        var alphaRange = doc.createElement("input");
        alphaRange.type = "range";
        alphaRange.min = "0";
        alphaRange.max = "255";
        alphaRange.value = "128";
        var alphaVal = el("span", "asx-fixed", "alpha threshold 128");
        alphaRange.addEventListener("input", function () {
          state.alpha = Number(alphaRange.value);
          alphaVal.textContent = "alpha threshold " + state.alpha;
          reimport();
          drawAdd();
        });
        var alphaWrap = el("span");
        alphaWrap.appendChild(alphaRange);
        alphaWrap.appendChild(el("span", null, " "));
        alphaWrap.appendChild(alphaVal);
        field("alpha", alphaWrap, "addsource-alpha");

        var rateSel = doc.createElement("select");
        SAMPLE_RATES.forEach(function (r) {
          var o = doc.createElement("option");
          o.value = String(r);
          o.textContent = r + " Hz";
          rateSel.appendChild(o);
        });
        rateSel.value = "6000";
        rateSel.addEventListener("change", function () {
          state.rate = Number(rateSel.value);
          if (state.sampleBytes) reimport();
          drawAdd();
        });
        field("sample rate", rateSel, "addsource-rate");

        var nameInput = doc.createElement("input");
        nameInput.type = "text";
        nameInput.value = "source";
        nameInput.addEventListener("input", function () { state.name = nameInput.value; });
        field("name", nameInput, "addsource-name");
        dialog.appendChild(fields);

        var preview = el("div", "asx-preview");
        preview.id = "addsource-preview";
        dialog.appendChild(preview);
        var stats = el("p", "asx-sub");
        stats.id = "addsource-stats";
        dialog.appendChild(stats);

        var foot = el("div", "asx-foot");
        var cancel = button("btn-mini", "Cancel", function () { closeAdd(); });
        cancel.id = "addsource-cancel";
        var commit = button("btn-mini", "Add source", function () {
          try { commitAdd(); } catch (e) {
            studio.toast((e.code || "error") + ": " + e.message);
          }
        });
        commit.id = "addsource-commit";
        commit.disabled = true;
        foot.appendChild(cancel);
        foot.appendChild(commit);
        dialog.appendChild(foot);

        var body = doc.body || doc.documentElement;
        body.appendChild(modal);
        add = { state: state, els: { modal: modal, preview: preview,
                                     stats: stats, commit: commit,
                                     name: nameInput, kind: kindSel,
                                     dither: ditherSel, palettes: palRange,
                                     alpha: alphaRange, rate: rateSel,
                                     picker: picker } };
        drawAdd();
        return state;
      }

      /* "Add source": write the files the preview measured into the toy, so
       * the panels open what was imported. */
      function commitAdd() {
        if (!add) return null;
        var state = add.state;
        if (state.kind === "sample" && state.sampleBytes)
          reimport();
        var result = state.result;
        if (!result) throw new Error("nothing to add");
        var files = filesFor(result);
        var names = Object.keys(files);
        for (var i = 0; i < names.length; i++) putFile(names[i], files[i]);
        var what = result.kind === "sample"
          ? result.samples.length + " samples at " + result.rate + " Hz in samples.json"
          : result.kind === "song"
            ? "song.json (" + result.stats.notes + " notes)"
            : names.join(", ");
        closeAdd();
        refresh();
        studio.toast("Added " + (state.name || "source") + " — " + what + ".");
        return result;
      }

      function h(host, text, extra) {
        var d = el("div", "asx-head");
        d.appendChild(el("h3", null, text));
        d.appendChild(el("span", "asx-spacer"));
        if (extra) d.appendChild(el("span", "asx-sub", extra));
        host.appendChild(d);
        return d;
      }

      function build() {
        injectCss();
        var pane = studio.$("assets-pane");
        var old = studio.$(BOX_ID);
        if (old && pane.removeChild) pane.removeChild(old);

        /* ppu.toys' order: the title, the bars, then the assets themselves.
         * Our file list (#77) is that list, so the memory goes above it and
         * the songs and sounds below — the two halves are two containers
         * because the file list sits between them and belongs to the page. */
        box = el("div", "asx");
        box.id = BOX_ID;
        var list = studio.$("asset-list");
        if (list && pane.insertBefore) {
          try { pane.insertBefore(box, list); }
          catch (e) { pane.appendChild(box); }
        } else {
          pane.appendChild(box);
        }
        els.below = el("div", "asx");
        els.below.id = BOX_ID + "-list";
        pane.appendChild(els.below);
        var below = els.below;

        /* memory */
        var head = h(box, "MEMORY");
        addMenu(head);
        els.bars = el("div", "asx-bars");
        box.appendChild(els.bars);

        /* songs */
        h(below, "SONGS");
        els.songs = el("div", "asx-list");
        below.appendChild(els.songs);

        /* sounds */
        h(below, "BUILT-IN INSTRUMENTS");
        els.instruments = el("div", "asx-list");
        below.appendChild(els.instruments);

        h(below, "IN THE TOY");
        els.toy = el("div", "asx-list");
        below.appendChild(els.toy);

        els.note = el("p", "asx-note",
          "A built-in is a patch generated here (a 32-step 5-bit wave or a " +
          "noise preset); Add to toy copies it into the toy's " +
          "instruments.json, so it travels with the toy and counts against " +
          "its 1 MB. Songs are listed from songs.json; the tracker (#35) " +
          "makes and exports them.");
        below.appendChild(els.note);
        els.error = el("p", "asx-note");
        below.appendChild(els.error);
      }

      function drawBars() {
        var host = els.bars;
        clear(host);
        for (var i = 0; i < state.bars.length; i++) {
          var b = state.bars[i];
          var row = el("div", "asx-bar");
          row.appendChild(el("span", "asx-lab", b.label));
          var track = el("div", "asx-track");
          var fill = el("div", "asx-fill");
          var pct = b.cap ? Math.max(0, Math.min(100, 100 * b.used / b.cap)) : 0;
          fill.style.width = pct.toFixed(2) + "%";
          track.appendChild(fill);
          row.appendChild(track);
          row.appendChild(el("span", "asx-val",
            b.used + " / " + b.cap + " " + b.unit + " (" +
            (b.measured ? Math.round(pct) + "%" : "?") + ")"));
          var parts = el("div", "asx-parts");
          var text = b.parts.map(function (p) { return p.label + " " + p.used; }).join(" · ");
          parts.textContent = text + (b.note ? "  — " + b.note : "");
          row.appendChild(parts);
          host.appendChild(row);
        }
      }

      function drawSongs() {
        var host = els.songs;
        clear(host);
        /* A song with no music in it says so, rather than showing a "0 notes"
         * that reads like a count of something that is there. */
        function empty(song) { return !song.notes && !song.patterns; }
        if (!state.songs.length) {
          var none = el("div", "asx-row");
          none.appendChild(el("span", "asx-what", "no songs — + Add makes one"));
          host.appendChild(none);
          return;
        }
        for (var i = 0; i < state.songs.length; i++) {
          (function (song) {
            var row = el("div", "asx-row");
            row.appendChild(el("span", "asx-name", song.name));
            var tag = el("span", "asx-tag", "SONG");
            row.appendChild(tag);
            var what = el("span", "asx-what",
              empty(song) ? "no music yet" : A.songLabel(song));
            row.appendChild(what);
            var menu = el("div", "asx-menu");
            var p = el("div", "asx-pop");
            [["rows", song.rows], ["speed", song.speed],
             ["orders", song.orders], ["patterns", song.patterns],
             ["notes", song.notes], ["from a .dmf", song.dmf ? "yes" : "no"]]
              .forEach(function (l) {
                var b = button("", l[0] + ": " + (l[1] === undefined ? "-" : l[1]),
                  function () { });
                b.disabled = true;
                p.appendChild(b);
              });
            menu.appendChild(button("btn-mini", "⋯", function () {
              closePop();
              if (p.className.indexOf("is-on") < 0) {
                p.className = "asx-pop is-on";
                pop = p;
              }
            }));
            menu.appendChild(p);
            row.appendChild(menu);
            host.appendChild(row);
          })(state.songs[i]);
        }
      }

      /* #122's play button: every instrument row gets one, built-in and the
       * toy's own, because the card's question was "how can I listen to
       * them" and the answer has to be on the row, not behind a menu. */
      function auditionButton(inst, id) {
        var b = button("btn-mini asx-play", "▶", function () {
          try {
            preview(inst);
            studio.toast("Playing " + inst.name + " — " +
              (inst.kind === "noise" ? "one hit" : "C4, E4, G4") +
              " through the PSG.");
          } catch (e) {
            studio.toast((e.code || "error") + ": " + e.message);
          }
        });
        b.id = id;
        b.title = inst.kind === "noise"
          ? "Play one hit of " + inst.name + " (noise, pce-psg.js)"
          : "Play C4, E4, G4 on " + inst.name + " (pce-psg.js)";
        b.setAttribute("aria-label", b.title);
        return b;
      }

      function drawInstruments() {
        var host = els.instruments;
        clear(host);
        var list = A.INSTRUMENTS;
        for (var i = 0; i < list.length; i++) {
          (function (inst) {
            var inToy = isInToy(inst.name);
            var row = el("div", "asx-row");
            row.appendChild(el("span", "asx-name", inst.name));
            var tag = el("span", "asx-tag" + (inToy ? " is-in" : ""),
                         inToy ? "IN TOY" : "BUILT-IN");
            row.appendChild(tag);
            var what = el("span", "asx-what",
              A.descriptor(inst) + " · " + inst.about);
            row.appendChild(what);
            var actions = el("span", "asx-actions");
            actions.appendChild(auditionButton(inst, "assets-play-" + inst.id));
            var b = button("btn-mini", inToy ? "In toy" : "Add to toy",
              function () {
                if (isInToy(inst.name)) return;
                try { addToToy(inst); }
                catch (e) { studio.toast((e.code || "error") + ": " + e.message); }
              });
            b.disabled = inToy;
            b.id = "assets-add-" + inst.id;
            actions.appendChild(b);
            row.appendChild(actions);
            host.appendChild(row);
          })(list[i]);
        }
      }

      function drawToyList() {
        var host = els.toy;
        clear(host);
        if (!state.instruments.length) {
          var none = el("div", "asx-row");
          none.appendChild(el("span", "asx-what",
            "none — Add to toy puts a built-in here"));
          host.appendChild(none);
          return;
        }
        for (var i = 0; i < state.instruments.length; i++) {
          (function (inst) {
            var row = el("div", "asx-row");
            row.appendChild(el("span", "asx-name", inst.name));
            row.appendChild(el("span", "asx-tag is-in", "IN TOY"));
            row.appendChild(el("span", "asx-what",
              inst.kind === "noise"
                ? "NOISE · channel " + (inst.channel + 1) + " · NF " + inst.nf
                : "WAVE · 32 steps · envelope " +
                  (inst.envelope ? inst.envelope.size : "?")));
            var actions = el("span", "asx-actions");
            actions.appendChild(auditionButton(inst, "assets-play-toy-" + inst.name));
            var b = button("btn-mini", "Remove", function () { removeFromToy(inst.name); });
            b.className = "btn-mini asx-remove";
            actions.appendChild(b);
            row.appendChild(actions);
            host.appendChild(row);
          })(state.instruments[i]);
        }
      }

      function refresh() {
        if (!box) build();
        closePop();
        readToy();
        drawBars();
        drawSongs();
        drawInstruments();
        drawToyList();
        els.error.textContent = state.error;
        els.error.hidden = !state.error;
        return state;
      }

      /* The title the pane shows: "ASSETS · untitled toy", theirs' shape. */
      function title() {
        var pane = studio.$("assets-pane");
        var h2 = pane && pane.querySelector ? pane.querySelector("h2") : null;
        if (h2) h2.textContent = "ASSETS · " + state.toyName;
        return state.toyName;
      }

      /* ---- wiring ---------------------------------------------------------- */
      var tab = studio.$("tab-assets");
      if (tab) tab.addEventListener("click", function () { refresh(); title(); });
      studio.toy.onAssetEdit(function (name) {
        if (name === "instruments.json" || name === "songs.json" ||
            name === "tiles.json" || name === "palettes.json" ||
            name === "sprites.json") refresh();
      });

      refresh();
      title();

      /* The page's ASSETS tab is opened by a click (which refreshes), but
       * the ?tab=assets route — the #77 screenshot, check-studio's driver —
       * selects it without one, and the toy's first frame lands after this
       * module registers.  One deferred pass fills the bars for those
       * routes; a refresh is idempotent, and it cannot throw into the page. */
      if (typeof setTimeout === "function") {
        setTimeout(function () {
          try { refresh(); title(); } catch (e) { /* the page is gone */ }
        }, 150);
      }

      var def = studio.panels.register({
        id: "assets",
        label: "Assets",
        group: "workspace",
        chapter: "the-toy",
        gloss: "The toy's memory, songs and built-in instruments",
        open: function () { studio.layout.codeTab("assets"); refresh(); title(); }
      });

      def.api = {
        refresh: refresh,
        bars: function () { return state.bars; },
        instruments: function () { return state.instruments.slice(); },
        songs: function () { return state.songs.map(function (s) { return s; }); },
        addToToy: addToToy,
        removeFromToy: removeFromToy,
        addBlankSong: addBlankSong,
        addBlankWave: addBlankWave,
        /* #122: the audition the play buttons run.  `preview(nameOrPatch)`
         * renders the phrase (C4, E4, G4; one hit for a drum) through
         * pce-psg.js and returns the PCM and the per-note pitch, whether or
         * not the page has an AudioContext to play it in. */
        preview: preview,
        audition: preview,
        phrase: function (nameOrPatch) {
          return phraseFor(typeof nameOrPatch === "string"
            ? resolve(nameOrPatch) : (nameOrPatch || { kind: "wave" }));
        },
        lastPreview: function () { return lastPreview; },
        stop: stopPreview,
        /* #123: Add Source.  `open`/`close` are the dialog; `feed` takes a
         * File (or anything with arrayBuffer()) and returns a promise of the
         * import; `state` is the dialog's live state, `commit` writes what
         * the preview measured into the toy.  The checks drive these without
         * a DOM, and the dialog's buttons call the same functions. */
        addSource: {
          open: openAdd,
          close: closeAdd,
          feed: feedAdd,
          state: addState,
          commit: commitAdd,
          files: function () {
            var s = addState();
            return s && s.result ? filesFor(s.result) : {};
          }
        },
        copy: function () { return { name: state.toyName, title: title() }; }
      };
      return def.api;
    }
  });
})(typeof self !== "undefined" ? self : this);
