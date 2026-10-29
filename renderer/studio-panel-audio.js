/*
 * studio-panel-audio.js — the AUDIO panel (card #97), a module of the studio
 * since #102.
 *
 * ppu.toys' AUDIO panel is the working example of the layout: the sound
 * chip's name, a song and a play button, a LIVE MIX row of Release all /
 * Load saved / Save mix, one row per voice (play, a mode picker, an envelope
 * meter, a volume trim per side with dB, a pitch stepper, M and S), a VOICE
 * detail with Trigger / Release / Reset and tabs, master and echo, a "Master
 * registers & echo" fold, and "Sound RAM · N B free · mix saves with the
 * toy".  This is that shape for the HuC6280 PSG, with the differences the
 * chip forces — and the panel prints them rather than hiding them:
 *
 *   - SIX voices, not eight, and no sample playback with echo: the card's
 *     own line ("The PC Engine PSG has no echo; fake it with a second,
 *     later, quieter voice") is on the panel instead of an echo send.
 *   - a voice is wave (32 steps of 5 bits, R6), noise (channels 5-6 only,
 *     R7) or DDA (R4 bit 6).
 *   - the wave is a mini picture per voice, and the selected voice's wave is
 *     #62's editor inline — the same 32 steps, painted by clicking.
 *   - the level meter is the PSG's own attenuation (pce-psg.js's getVL and
 *     its dB table), so the meter and the rendered PCM cannot disagree;
 *     tests/check-studio.js asserts they agree to 0.01 dB.
 *   - pitch is the 12-bit frequency word AND the note it makes (the PSG's
 *     fMASTER/(64*F), R2 low byte and R3 high nibble).
 *   - the ADSR is the DRIVER's, not the chip's: the envelope tab is the
 *     sequence of R4 values a driver writes, and Trigger / Release are the
 *     writes that start and end it.
 *   - there is no Sound RAM.  ppu.toys' "N B free" becomes the DDA bytes the
 *     ROM would carry, and the mix saves with the toy as waves.json.
 *
 * The model is renderer/pce-mix.js (this card's), which folds into
 * renderer/pce-wave.js's document so the register writes come from one
 * generator; the refusals are the model's and pce-wave.js's.  The panel only
 * draws and binds.  docs/STUDIO.md §3.8.
 */
(function (root) {
  "use strict";
  var P = root.PCEStudio = root.PCEStudio || {};
  P.studioPanelModules = P.studioPanelModules || [];

  var TABS = ["wave", "envelope", "lfo", "registers"];

  P.studioPanelModules.push({
    id: "audio",
    register: function (studio) {
      var mx = P.mix;
      var mix = null;              /* the document, read from waves.json */
      var seen = "";               /* the asset text the mix was read from */
      var loaded = false;
      var error = "";
      var sel = 0;                 /* the selected voice */
      var tab = "wave";
      var built = false;
      var rows = [];               /* one entry per voice: the row's elements */
      var audio = null;            /* the AudioContext, once a play needs one */
      var source = null;           /* the node playing the mix */
      var playing = false;
      var lastPeak = null;         /* the last render's peak, 0..1 */
      var A = P.assets;            /* the toy's instruments (#122) */
      var chosen = {};             /* voice -> the toy instrument loaded into it */

      function ready() { return !!(mx && P.wave && P.psg); }

      function fail(e) {
        error = (e && e.code ? e.code + ": " : "") +
                (e && e.message ? e.message : e);
        var el = studio.$("aud-status");
        if (el) el.textContent = error;
        studio.toast(error);
      }

      /* ---- #122: the toy's instruments as a voice picker -----------------
       * The card: an instrument added through ASSETS has to be choosable
       * here, and Trigger has to play it.  The picker is this module's own
       * select (the page needed no change): it lists the toy's
       * instruments.json, and choosing one loads that patch into the
       * selected voice — mode, the 32-step wave or the noise NF, and a driver
       * envelope derived from the patch's own R4 sequence.  A drum on a
       * voice without the generator moves to voice 5 rather than refusing,
       * because the chip's limit is a place, not a mistake the user made. */
      function toyInstruments() {
        if (!A || typeof A.parseInstruments !== "function") return [];
        var f = studio.toy.file("instruments.json");
        if (!f || !f.source) return [];
        try { return A.parseInstruments(f.source).instruments || []; }
        catch (e) { return []; }
      }

      function toyByName(name) {
        var list = toyInstruments();
        for (var i = 0; i < list.length; i++)
          if (list[i].name === name) return list[i];
        return null;
      }

      /* The patch's HuTrack-shaped envelope ({size, loop, data}) as the
       * mixer's driver envelope ({attack, decay, sustain, rate}): attack is
       * the climb to the loudest level, decay the fall to the last one, and
       * a step a frame.  The shape is the same R4 sequence, written the way
       * this panel's model takes it. */
      function mixEnvOf(inst) {
        var env = inst.envelope || {};
        var data = Array.isArray(env.data) && env.data.length ? env.data : [31];
        var peakAt = 0, i;
        for (i = 0; i < data.length; i++) if (data[i] > data[peakAt]) peakAt = i;
        var sustain = data[data.length - 1];
        return {
          attack: Math.min(mx.ENV_MAX, peakAt),
          decay: Math.min(mx.ENV_MAX, Math.max(0, data.length - peakAt - 1)),
          sustain: Math.max(0, Math.min(mx.AL_MAX, sustain)),
          rate: 1
        };
      }

      /* Put the toy's patch on `voice` (default: the selected one).  Returns
       * {voice, name}; the model's own refusals (wave-range, noise-channel)
       * are thrown, so the evidence reads the code the panel would toast. */
      function loadToyInstrument(name, voice) {
        var inst = toyByName(name);
        if (!inst) {
          var e = new Error("no instrument " + JSON.stringify(name));
          e.code = "asset-name";
          throw e;
        }
        var m = state();
        var c = voice === undefined ? sel : voice;
        if (inst.kind === "noise" && mx.NOISE_VOICES.indexOf(c) < 0)
          c = mx.NOISE_VOICES[0];            /* voice 5, the first generator */
        if (inst.kind === "noise") {
          mx.setMode(m, c, "noise");
          mx.setNoise(m, c, { nf: inst.nf });
        } else {
          mx.setMode(m, c, "wave");
          mx.setWave(m, c, inst.wave);
        }
        mx.setEnv(m, c, mixEnvOf(inst));
        mx.setLevel(m, c, mx.AL_MAX);
        mx.setChannelOn(m, c, true);
        chosen[c] = inst.name;
        sel = c;
        return { voice: c, name: inst.name, kind: inst.kind };
      }

      /* ---- the document, read back from the toy's files ------------------ */

      function assetText() {
        var f = studio.toy.file("waves.json");
        return f ? f.source : "";
      }

      function state() {
        if (mix && assetText() !== seen) mix = null;
        if (mix) return mix;
        try {
          mix = mx.fromFiles(studio.toy.files());
          loaded = true;
          error = "";
        } catch (e) {
          loaded = false;
          error = (e && e.code ? e.code + ": " : "") +
                  (e && e.message ? e.message : e);
          mix = mx.newMix();
        }
        seen = assetText();
        return mix;
      }

      /* waves.json only — the other panels' files are theirs.  The page's
       * own writer when it has one, else the model's syncFiles. */
      function writeBack(m) {
        if (typeof studio.toy.writeWavesAssets === "function")
          return studio.toy.writeWavesAssets(m);
        var changed = mx.syncFiles(m, studio.toy.files());
        if (changed.length) {
          studio.toy.persist();
          studio.toy.saved("saved in this browser");
          studio.toy.refreshAssets();
        }
        return changed;
      }

      /* A file set that did not parse is never written over. */
      function commit() {
        state();
        if (!loaded) {
          fail(new Error("waves.json does not load, so nothing was written"));
          return [];
        }
        var changed = [];
        try { changed = writeBack(mix); }
        catch (e) { fail(e); return []; }
        seen = assetText();
        return changed;
      }

      function edit(what) {
        state();                    /* a handler can run before the first draw */
        try { what(); error = ""; }
        catch (e) { fail(e); }
        commit();
        drawPanel();
      }

      /* The evidence's path: the model's refusal is thrown, not toasted, so a
       * test reads its code the way it reads pce-editor.js's.  The panel's DOM
       * handlers keep edit() above. */
      function apply(what) {
        state();
        var out = what();
        error = "";
        commit();
        drawPanel();
        return out;
      }

      /* ---- small helpers -------------------------------------------------- */

      function el(tag, id, cls) {
        var e = studio.document.createElement(tag);
        if (id) e.id = id;
        if (cls) e.className = cls;
        return e;
      }

      function text(tag, cls, s) {
        var e = el(tag, "", cls);
        e.textContent = s;
        return e;
      }

      function hex2(v) {
        return "$" + (v & 0xFF).toString(16).toUpperCase().padStart(2, "0");
      }

      function dbText(db) {
        return db === -Infinity ? "-inf dB" : db.toFixed(1) + " dB";
      }

      function noteOf(v) {
        var cents = mx.centsOff(v.freq);
        return mx.noteName(v.freq) +
          (cents ? " " + (cents > 0 ? "+" : "") + cents + "¢" : "");
      }

      function setValue(id, v) {
        var e = studio.$(id);
        if (e) e.value = String(v);
      }

      /* ---- building the rows --------------------------------------------- */

      function build() {
        if (built || !mx) return;
        var host = studio.$("aud-rows");
        if (!host) return;
        while (host.firstChild) host.removeChild(host.firstChild);

        var head = el("div", "aud-head", "aud-row aud-headrow");
        ["voice", "mode", "wave", "level", "vol", "bal L/R", "pitch",
         "M", "S", ""]
          .forEach(function (h) { head.appendChild(text("span", "aud-cell", h)); });
        host.appendChild(head);

        for (var c = 0; c < mx.CHANNELS; c++) rows.push(buildRow(c, host));

        /* #62's wave shapes, one click each, on the wave tab */
        var preset = studio.$("aud-preset");
        if (preset) {
          var none = studio.document.createElement("option");
          none.value = "";
          none.textContent = "—";
          preset.appendChild(none);
          Object.keys(P.wave.PRESETS).forEach(function (name) {
            var o = studio.document.createElement("option");
            o.value = name;
            o.textContent = name;
            preset.appendChild(o);
          });
        }

        /* #122: the toy's instruments — the voice picker.  Its options are
         * rebuilt on every draw (`paintInstrumentPicker`) because the toy's
         * instruments can change while the panel is open. */
        var waveTab = studio.$("aud-tab-wave");
        if (waveTab) {
          var line = el("div", "", "aud-line aud-instrument-line");
          line.appendChild(text("span", "aud-kicker", "instrument"));
          var pick = el("select", "aud-instrument", "aud-instrument");
          pick.setAttribute("aria-label",
            "Load one of the toy's instruments into the selected voice");
          pick.addEventListener("change", function () {
            var v = pick.value;
            if (!v || v.indexOf("toy:") !== 0) return;
            try {
              edit(function () { loadToyInstrument(v.slice(4), sel); });
            } catch (e) { fail(e); }
          });
          line.appendChild(pick);
          waveTab.appendChild(line);
        }
        built = true;
      }

      /* The picker's options: the toy's instruments, with the one the
       * selected voice holds shown as its value (and "—" when the voice is
       * still the voice's own patch). */
      function paintInstrumentPicker() {
        var pick = studio.$("aud-instrument");
        if (!pick) return;
        while (pick.firstChild) pick.removeChild(pick.firstChild);
        var list = toyInstruments();
        var none = studio.document.createElement("option");
        none.value = "";
        none.textContent = list.length ? "— (keep this voice's patch)"
                                       : "(no instruments in the toy)";
        pick.appendChild(none);
        for (var i = 0; i < list.length; i++) {
          var o = studio.document.createElement("option");
          o.value = "toy:" + list[i].name;
          o.textContent = list[i].name + " · " + list[i].kind;
          pick.appendChild(o);
        }
        pick.value = chosen[sel] ? "toy:" + chosen[sel] : "";
      }

      function buildRow(i, host) {
        var r = {};
        var row = el("div", "aud-row-" + i, "aud-row");
        r.el = row;

        r.name = el("button", "aud-voice-" + i, "aud-vname");
        r.name.type = "button";
        r.name.textContent = String(i + 1);
        r.name.title = "Select voice " + (i + 1);
        r.name.addEventListener("click", function () { onSelect(i); });
        row.appendChild(r.name);

        r.mode = el("select", "aud-mode-" + i, "aud-mode");
        r.mode.setAttribute("aria-label", "Voice " + (i + 1) + " mode");
        mx.MODES.forEach(function (m) {
          var o = studio.document.createElement("option");
          o.value = m;
          o.textContent = m;
          /* the PSG's own limit, said in the picker rather than by a refusal
           * after the click */
          if (m === "noise" && mx.NOISE_VOICES.indexOf(i) < 0) {
            o.disabled = true;
            o.textContent = "noise (5-6 only)";
          }
          r.mode.appendChild(o);
        });
        r.mode.addEventListener("change", function () {
          edit(function () { mx.setMode(mix, i, r.mode.value); });
        });
        row.appendChild(r.mode);

        r.wave = el("canvas", "aud-wave-" + i, "aud-mini");
        r.wave.width = 68;
        r.wave.height = 20;
        r.wave.setAttribute("aria-label", "Voice " + (i + 1) + "'s 32-step wave");
        row.appendChild(r.wave);

        var meter = el("span", "aud-metercell-" + i, "aud-cell aud-metercell");
        r.meterL = el("span", "aud-meterL-" + i, "aud-meter");
        r.meterR = el("span", "aud-meterR-" + i, "aud-meter");
        meter.appendChild(r.meterL);
        meter.appendChild(r.meterR);
        row.appendChild(meter);

        r.vol = el("input", "aud-vol-" + i, "aud-vol");
        r.vol.type = "range";
        r.vol.min = "0";
        r.vol.max = String(mx.AL_MAX);
        r.vol.setAttribute("aria-label", "Voice " + (i + 1) + " volume (R4)");
        r.vol.addEventListener("input", function () {
          edit(function () { mx.setLevel(mix, i, Number(r.vol.value)); });
        });
        row.appendChild(r.vol);

        var bal = el("span", "aud-balcell-" + i, "aud-cell aud-balcell");
        r.balL = el("input", "aud-balL-" + i, "aud-bal");
        r.balR = el("input", "aud-balR-" + i, "aud-bal");
        [r.balL, r.balR].forEach(function (inp, side) {
          inp.type = "range";
          inp.min = "0";
          inp.max = "15";
          inp.setAttribute("aria-label", "Voice " + (i + 1) + " balance " +
            (side ? "right" : "left") + " (R5)");
          inp.addEventListener("input", function () {
            edit(function () { setBalanceSide(i, !!side, Number(inp.value)); });
          });
        });
        bal.appendChild(r.balL);
        bal.appendChild(r.balR);
        row.appendChild(bal);

        var pitch = el("span", "aud-pitchcell-" + i, "aud-cell aud-pitchcell");
        r.pitch = text("b", "aud-pitch", "—");
        r.note = text("span", "aud-note", "—");
        var down = el("button", "aud-down-" + i, "btn-mini");
        down.type = "button";
        down.textContent = "−";
        down.title = "One semitone down";
        down.addEventListener("click", function () { onStep(i, -1); });
        var up = el("button", "aud-up-" + i, "btn-mini");
        up.type = "button";
        up.textContent = "+";
        up.title = "One semitone up";
        up.addEventListener("click", function () { onStep(i, 1); });
        pitch.appendChild(r.pitch);
        pitch.appendChild(down);
        pitch.appendChild(up);
        pitch.appendChild(r.note);
        row.appendChild(pitch);

        r.mute = el("button", "aud-mute-" + i, "btn-mini aud-ms");
        r.mute.type = "button";
        r.mute.textContent = "M";
        r.mute.title = "Mute voice " + (i + 1);
        r.mute.addEventListener("click", function () {
          edit(function () { mx.setMute(mix, i, !mx.voice(mix, i).mute); });
        });
        row.appendChild(r.mute);

        r.solo = el("button", "aud-solo-" + i, "btn-mini aud-ms");
        r.solo.type = "button";
        r.solo.textContent = "S";
        r.solo.title = "Solo voice " + (i + 1);
        r.solo.addEventListener("click", function () {
          edit(function () { mx.setSolo(mix, i, !mx.voice(mix, i).solo); });
        });
        row.appendChild(r.solo);

        r.play = el("button", "aud-play-" + i, "btn-mini aud-play");
        r.play.type = "button";
        r.play.textContent = "▶";
        r.play.title = "Play voice " + (i + 1) + " (trigger it)";
        r.play.addEventListener("click", function () { onPlayVoice(i); });
        row.appendChild(r.play);

        host.appendChild(row);
        return r;
      }

      function setBalanceSide(i, right, nibble) {
        var bal = mx.voice(mix, i).balance;
        mx.setBalance(mix, i, right ? ((bal & 0xF0) | (nibble & 0x0F))
                                    : ((nibble & 0x0F) << 4) | (bal & 0x0F));
      }

      /* ---- drawing -------------------------------------------------------- */

      function paintWave(canvas, wave, on) {
        if (!canvas || !canvas.getContext) return;
        var ctx = canvas.getContext("2d");
        if (!ctx) return;
        var w = canvas.width, h = canvas.height, i, bh;
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = on ? "#5fc9e8" : "#3f4654";
        var bw = w / mx.STEPS;
        for (i = 0; i < mx.STEPS; i++) {
          bh = Math.max(1, Math.round((wave[i] / mx.WAVE_MAX) * (h - 2)));
          ctx.fillRect(Math.floor(i * bw), h - bh,
                       Math.max(1, Math.floor(bw) - 1), bh);
        }
      }

      function paintMeters() {
        var mt = mx.meters(mix);
        for (var c = 0; c < rows.length; c++) {
          var r = rows[c], aud = mt[c].audible;
          r.meterL.style.width = (aud ? Math.round(mt[c].left.gain * 100) : 0) + "%";
          r.meterR.style.width = (aud ? Math.round(mt[c].right.gain * 100) : 0) + "%";
          r.meterL.classList.toggle("is-off", !aud);
          r.meterR.classList.toggle("is-off", !aud);
          r.meterL.title = "left " + dbText(mt[c].left.db);
          r.meterR.title = "right " + dbText(mt[c].right.db);
        }
      }

      function paintRows() {
        for (var c = 0; c < rows.length; c++) {
          var r = rows[c], v = mx.voice(mix, c);
          r.mode.value = v.mode;
          r.vol.value = String(v.al);
          r.balL.value = String((v.balance >> 4) & 0xF);
          r.balR.value = String(v.balance & 0xF);
          r.pitch.textContent = String(v.freq);
          r.note.textContent = noteOf(v);
          r.mute.classList.toggle("is-on", v.mute);
          r.solo.classList.toggle("is-on", v.solo);
          r.mute.setAttribute("aria-pressed", String(v.mute));
          r.solo.setAttribute("aria-pressed", String(v.solo));
          r.name.classList.toggle("is-on", c === sel);
          paintWave(r.wave, v.wave, v.on && !v.mute);
        }
      }

      function paintDetail() {
        var v = mx.voice(mix, sel);
        var name = studio.$("aud-vname");
        if (name) {
          name.textContent = "VOICE " + (sel + 1) + " · " + v.mode +
            (v.on ? " · on" : " · off") +
            " · R4 " + hex2(mx.controlWord(v)) + " · R5 " + hex2(v.balance);
        }
        TABS.forEach(function (t) {
          var b = studio.$("aud-tabbtn-" + t);
          if (b) b.classList.toggle("is-on", t === tab);
          var pane = studio.$("aud-tab-" + t);
          if (pane) pane.hidden = t !== tab;
        });
        paintWaveEditor(v);
        paintInstrumentPicker();
        paintEnvelope(v);
        paintLfo();
        paintRegisters(v);
        paintMaster();
      }

      function paintWaveEditor(v) {
        var canvas = studio.$("aud-waveedit");
        if (!canvas || !canvas.getContext) return;
        var ctx = canvas.getContext("2d");
        if (!ctx) return;
        var w = canvas.width, h = canvas.height, i, bh;
        ctx.clearRect(0, 0, w, h);
        var bw = w / mx.STEPS;
        for (i = 0; i < mx.STEPS; i++) {
          bh = Math.max(1, Math.round((v.wave[i] / mx.WAVE_MAX) * (h - 4)));
          ctx.fillStyle = "#5fc9e8";
          ctx.fillRect(Math.floor(i * bw), h - bh - 2,
                       Math.max(1, Math.floor(bw) - 1), bh);
        }
        var vals = studio.$("aud-wavevals");
        if (vals) vals.textContent = v.wave.join(" ");
        var preset = studio.$("aud-preset");
        if (preset) preset.value = "";
      }

      function paintEnvelope(v) {
        var levels = mx.envelope(v.env);
        var canvas = studio.$("aud-env-meter");
        if (canvas && canvas.getContext) {
          var ctx = canvas.getContext("2d");
          if (ctx) {
            var w = canvas.width, h = canvas.height;
            ctx.clearRect(0, 0, w, h);
            var bw = w / Math.max(1, levels.length);
            for (var i = 0; i < levels.length; i++) {
              var bh = Math.max(1, Math.round((levels[i] / mx.AL_MAX) * (h - 2)));
              ctx.fillStyle = i < v.env.attack ? "#5fc9e8" : "#ff9540";
              ctx.fillRect(Math.floor(i * bw), h - bh,
                           Math.max(1, Math.floor(bw) - 1), bh);
            }
          }
        }
        setValue("aud-env-a", v.env.attack);
        setValue("aud-env-d", v.env.decay);
        setValue("aud-env-s", v.env.sustain);
        setValue("aud-env-r", v.env.rate);
        var out = studio.$("aud-env-readout");
        if (out) {
          out.textContent = "driver envelope: " + levels.join(" → ") +
            " · " + (v.env.rate || 1) + " frame(s) a step · released in " +
            mx.releaseRamp(v.env, v.env.sustain).length + " steps. The PSG " +
            "has no hardware ADSR — this is R4 written by the driver.";
        }
        var rl = studio.$("aud-env-release");
        if (rl) rl.textContent = "release from AL " + v.al + ": " +
          (mx.releaseRamp(v.env, v.al).join(" → ") || "—");
      }

      function paintLfo() {
        setValue("aud-lfo-ctl", mix.lfo.ctl);
        setValue("aud-lfo-freq", mix.lfo.freq);
        var out = studio.$("aud-lfo-readout");
        if (out) {
          out.textContent = mix.lfo.ctl
            ? "LFO on: voice 2 is the carrier (its wave steps 0-31), LFCTL " +
              mix.lfo.ctl + " shifts its level into voice 1's frequency by " +
              (2 << ((mix.lfo.ctl - 1) * 2)) + " per step, R8 = " +
              mix.lfo.freq + ". Voice 2 is forced silent while it runs."
            : "LFO off (LFCTL 0). Turn it on to have voice 2 modulate voice " +
              "1's frequency — R8 is the rate, R9 the depth.";
        }
      }

      function paintRegisters(v) {
        var pre = studio.$("aud-regs");
        if (!pre) return;
        var w = mx.writes(mix);
        pre.textContent = [
          "R0 channel select   " + sel,
          "R2 frequency LSB    " + hex2(v.freq & 0xFF),
          "R3 frequency MSB    " + hex2((v.freq >> 8) & 0x0F) +
            "   (F = " + v.freq + " → " + mx.toneHz(v.freq).toFixed(1) +
            " Hz, " + mx.noteName(v.freq) + ")",
          "R4 channel control  " + hex2(mx.controlWord(v)) +
            "   (on " + (v.on ? 1 : 0) + ", DDA " + (v.mode === "dda" ? 1 : 0) +
            ", AL " + v.al + ")",
          "R5 channel balance  " + hex2(v.balance) + "   (L " +
            ((v.balance >> 4) & 0xF) + ", R " + (v.balance & 0xF) + ")",
          "R6 waveform data    " + (v.mode === "dda"
            ? "DDA holds " + v.dda[0]
            : "32 steps: " + v.wave.join(" ")),
          "R7 noise control    " + (v.mode === "noise"
            ? hex2(0x80 | v.noise.nf) : "— (voices 5-6 only)"),
          "",
          "R1 main amplitude   " + hex2(mix.master.balance) + "   (L " +
            ((mix.master.balance >> 4) & 0xF) + ", R " +
            (mix.master.balance & 0xF) + ")",
          "R8 LFO frequency    " + hex2(mix.lfo.freq),
          "R9 LFO control      " + hex2(mix.lfo.ctl ? 0x80 | mix.lfo.ctl : 0),
          "",
          "the mixer's whole write stream: " + w.length + " writes"
        ].join("\n");
      }

      function paintMaster() {
        setValue("aud-master-l", (mix.master.balance >> 4) & 0xF);
        setValue("aud-master-r", mix.master.balance & 0xF);
        var out = studio.$("aud-master-readout");
        if (out) {
          out.textContent = "R1 " + hex2(mix.master.balance) +
            " · main volume L " + ((mix.master.balance >> 4) & 0xF) +
            " R " + (mix.master.balance & 0xF);
        }
        var budget = studio.$("aud-budget");
        if (budget) {
          budget.textContent = "DDA sample bytes in the ROM · " +
            mx.ddaBytes(mix) + " B · the mix saves with the toy (waves.json)";
        }
        var status = studio.$("aud-status");
        if (status) {
          var live = liveState();
          status.textContent = error ? error :
            (live
              ? "live toy (#71): " + live.writes + " PSG writes, frame " +
                live.frame + (live.overflow ? " (recording stopped)" : "")
              : playing ? "playing through pce-psg.js" :
                lastPeak === null
                  ? "press ▶ to play the mix through pce-psg.js"
                  : "last render peak " +
                    (20 * Math.log10(lastPeak)).toFixed(1) + " dBFS (pce-psg.js)");
        }
        var echo = studio.$("aud-echo");
        if (echo) {
          echo.textContent = "The PC Engine PSG has no echo; fake it with a " +
            "second, later, quieter voice.";
        }
      }

      function drawPanel() {
        if (!ready()) return;
        build();
        state();
        paintRows();
        paintMeters();
        paintDetail();
      }

      /* ---- the actions ---------------------------------------------------- */

      function onSelect(i) {
        mx.voice(state(), i);
        sel = i;
        error = "";
        drawPanel();
      }

      function onStep(i, semitones) {
        edit(function () {
          mx.setFreq(mix, i, mx.stepNote(mx.voice(mix, i).freq, semitones));
        });
      }

      function onWaveClick(ev, canvas) {
        var rect = canvas.getBoundingClientRect
          ? canvas.getBoundingClientRect()
          : { left: 0, top: 0, width: canvas.width, height: canvas.height };
        var w = rect.width || canvas.width || 1;
        var h = rect.height || canvas.height || 1;
        var x = (ev.clientX || 0) - (rect.left || 0);
        var y = (ev.clientY || 0) - (rect.top || 0);
        var step = Math.max(0, Math.min(mx.STEPS - 1,
          Math.floor(x / (w / mx.STEPS))));
        var value = Math.max(0, Math.min(mx.WAVE_MAX,
          Math.round((1 - y / h) * mx.WAVE_MAX)));
        edit(function () { mx.paintStep(mix, sel, step, value); });
      }

      /* ppu.toys' Trigger / Release note / Reset voice */
      /* PCM into the page's audio, the shape playMix uses. */
      function playPcm(pcm, rate) {
        var ctx = context();
        if (!ctx || !pcm || !pcm.length) return false;
        stopAudio();
        try {
          var buf = ctx.createBuffer(1, pcm.length, rate || 44100);
          var ch = buf.getChannelData(0);
          for (var i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
          source = ctx.createBufferSource();
          source.buffer = buf;
          source.connect(ctx.destination);
          source.start();
          playing = true;
          return true;
        } catch (e) { playing = false; return false; }
      }

      /* #122: Trigger plays what the voice holds.  If a toy instrument was
       * chosen for it, the patch's own registers play through pce-psg.js;
       * otherwise the mix with this voice soloed, as ▶ does.  Headless there
       * is no AudioContext, so the writes (and the mix) remain the evidence. */
      function auditionVoice(i) {
        var name = chosen[i];
        if (name && A && typeof A.play === "function") {
          var inst = toyByName(name);
          if (inst) {
            try {
              var got = A.play(inst, { note: "C4", frames: 30 });
              playPcm(got.pcm, got.sampleRate);
              return got;
            } catch (e) { /* fall through to the mix */ }
          }
        }
        var m = state();
        var was = m.voices.map(function (v) { return v.solo; });
        m.voices.forEach(function (v, c) { v.solo = c === i; });
        try { playMix(0.5); }
        finally { m.voices.forEach(function (v, c) { v.solo = was[c]; }); }
        return null;
      }

      function onTrigger(i) {
        var writes = [];
        edit(function () { writes = mx.trigger(mix, i); });
        auditionVoice(i);
        return writes;
      }
      function onRelease(i) {
        var writes = [];
        edit(function () { writes = mx.release(mix, i); });
        return writes;
      }
      function onReset(i) {
        edit(function () { mx.reset(mix, i); });
      }

      /* ---- live from the running toy -------------------------------------- */

      /* The #71 host records every PSG write a toy makes; renderer/pce-psg.js
       * turns them into the PCM.  The panel reads the same stream, so "what
       * the toy is doing to the chip" and "what it sounds like" are one
       * source.  A toy that makes no sound, or a page without a runtime, is
       * the mix's own audition instead. */
      function liveState() {
        var rt = studio.render.runtime();
        if (!rt || !rt.sound || !rt.sound.events || !rt.sound.events.length)
          return null;
        var view = mx.fromEvents(rt.sound.events);
        view.overflow = !!rt.sound.overflow;
        return view;
      }

      /* ---- the audio the panel plays -------------------------------------- */

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

      /* The mix through renderer/pce-psg.js — the same model tests/check-psg.js
       * proves against a Mednafen recording — into the page's AudioContext. */
      function playMix(seconds) {
        var got = mx.render(state(), seconds === undefined ? 1 : seconds);
        var peak = 0, i, a;
        for (i = 0; i < got.pcm.length; i++) {
          a = Math.abs(got.pcm[i]);
          if (a > peak) peak = a;
        }
        lastPeak = peak / 32768;
        var ctx = context();
        if (ctx && got.pcm.length) {
          stopAudio();
          try {
            var buf = ctx.createBuffer(1, got.pcm.length, got.sampleRate);
            var ch = buf.getChannelData(0);
            for (i = 0; i < got.pcm.length; i++) ch[i] = got.pcm[i] / 32768;
            source = ctx.createBufferSource();
            source.buffer = buf;
            source.connect(ctx.destination);
            source.start();
            playing = true;
          } catch (e) { playing = false; }
        }
        drawPanel();
        return { samples: got.pcm.length, peak: lastPeak };
      }

      function onPlayVoice(i) {
        /* solo the voice so what is heard is its own R4 write, play, put the
         * mix back, then trigger it */
        var m = state();
        var was = m.voices.map(function (v) { return v.solo; });
        m.voices.forEach(function (v, c) { v.solo = c === i; });
        try { playMix(0.5); }
        finally {
          m.voices.forEach(function (v, c) { v.solo = was[c]; });
        }
        edit(function () { mx.trigger(m, i); });
      }

      /* ---- the evidence surface ------------------------------------------- */

      var api = {
        state: function () {
          var m = state();
          return {
            voices: m.voices.map(function (v) { return {
              on: v.on, mode: v.mode, freq: v.freq, note: mx.noteName(v.freq),
              wave: v.wave.slice(),
              al: v.al, balance: v.balance, mute: v.mute, solo: v.solo,
              noise: v.noise.nf, dda: v.dda.slice(),
              env: { attack: v.env.attack, decay: v.env.decay,
                     sustain: v.env.sustain, rate: v.env.rate } }; }),
            master: m.master.balance,
            lfo: { freq: m.lfo.freq, ctl: m.lfo.ctl },
            audible: mx.audible(m),
            meters: mx.meters(m),
            selected: sel,
            tab: tab,
            ddaBytes: mx.ddaBytes(m),
            writes: mx.writes(m),
            error: error,
            playing: playing,
            lastPeak: lastPeak
          };
        },
        mix: function () { return state(); },
        text: function () { return mx.toJSON(state()); },
        invalidate: function () { mix = null; },

        /* ---- #122: the toy's instruments, as the voice picker sees them */
        instruments: function () {
          return toyInstruments().map(function (i) {
            return { name: i.name, kind: i.kind, nf: i.nf || null,
                     envelope: i.envelope ? i.envelope.data.slice() : [] };
          });
        },
        choose: function (name, voice) {
          return apply(function () { return loadToyInstrument(name, voice); });
        },
        loaded: function (i) {
          return chosen[i === undefined ? sel : i] || null;
        },
        /* The patch as pce-psg.js renders it — what Trigger plays, by code. */
        preview: function (name, note, frames) {
          var inst = toyByName(name);
          if (!inst) {
            var e = new Error("no instrument " + JSON.stringify(name));
            e.code = "asset-name";
            throw e;
          }
          if (!A || typeof A.play !== "function")
            throw new Error("the PSG model is not loaded");
          var got = A.play(inst, { note: note || "C4", frames: frames || 30 });
          return { pcm: got.pcm, sampleRate: got.sampleRate,
                   frames: got.frames, instrument: inst.name };
        },

        /* ---- the panel's own actions, by code --------------------------- */
        select: function (i) {
          var m = state();
          mx.voice(m, i);                       /* channel-range */
          sel = i;
          error = "";
          drawPanel();
          return sel;
        },
        tab: function (name) {
          if (TABS.indexOf(name) < 0)
            throw Object.assign(new Error("no tab " + name), { code: "tab-range" });
          tab = name;
          drawPanel();
          return tab;
        },
        mode: function (i, mode) {
          return apply(function () { return mx.setMode(mix, i, mode).mode; });
        },
        on: function (i, on) {
          return apply(function () { return mx.setChannelOn(mix, i, on).on; });
        },
        level: function (i, al) {
          return apply(function () { return mx.setLevel(mix, i, al).al; });
        },
        balance: function (i, value) {
          return apply(function () { return mx.setBalance(mix, i, value).balance; });
        },
        mute: function (i, on) {
          return apply(function () { return mx.setMute(mix, i, on).mute; });
        },
        solo: function (i, on) {
          return apply(function () { return mx.setSolo(mix, i, on).solo; });
        },
        pitch: function (i, freq) {
          return apply(function () { return mx.setFreq(mix, i, freq).freq; });
        },
        step: function (i, semitones) {
          return apply(function () {
            var v = mx.voice(mix, i);
            return mx.setFreq(mix, i, mx.stepNote(v.freq, semitones)).freq;
          });
        },
        note: function (i, name) {
          return apply(function () {
            return mx.setFreq(mix, i, mx.noteFreq(name)).freq;
          });
        },
        waveStep: function (i, step, value) {
          return apply(function () { return mx.paintStep(mix, i, step, value).wave.slice(); });
        },
        preset: function (i, name) {
          return apply(function () { return mx.setPreset(mix, i, name).wave.slice(); });
        },
        ddaLevel: function (i, level) {
          return apply(function () { return mx.setDdaLevel(mix, i, level).dda.slice(); });
        },
        env: function (i, env) {
          return apply(function () {
            mx.setEnv(mix, i, env);
            return mx.voice(mix, i).env;
          });
        },
        trigger: function (i) {
          return apply(function () { return mx.trigger(mix, i); });
        },
        release: function (i) {
          return apply(function () { return mx.release(mix, i); });
        },
        reset: function (i) { apply(function () { return mx.reset(mix, i); }); },
        lfo: function (ctl, freq) {
          return apply(function () {
            mx.setLfo(mix, ctl
              ? { freq: freq === undefined ? mix.lfo.freq : freq, ctl: ctl }
              : { freq: mix.lfo.freq, ctl: 0 });
            if (freq !== undefined) mix.lfo.freq = freq;
            return { freq: mix.lfo.freq, ctl: mix.lfo.ctl };
          });
        },
        master: function (value) {
          return apply(function () { return mx.setMasterBalance(mix, value).master.balance; });
        },
        writes: function () { return mx.writes(state()); },
        writesOf: function (reg) { return mx.writesOf(state(), reg); },
        envelope: function (i) { return mx.envelope(mx.voice(state(), i).env); },
        /* What the running toy is doing to the PSG (#71's host records the
         * writes), read from the same events the PCM comes from. */
        live: function () { return liveState(); },
        livePcm: function () {
          var rt = studio.render.runtime();
          if (!rt || typeof rt.renderSound !== "function") return null;
          var got = rt.renderSound();
          var peak = 0;
          for (var k = 0; k < got.pcm.length; k++)
            peak = Math.max(peak, Math.abs(got.pcm[k]));
          return { samples: got.pcm.length, peak: peak,
                   sampleRate: got.sampleRate };
        },
        render: function (seconds) {
          var got = mx.render(state(), seconds === undefined ? 0.25 : seconds);
          var peak = 0, sum = 0, k, a;
          for (k = 0; k < got.pcm.length; k++) {
            a = Math.abs(got.pcm[k]);
            if (a > peak) peak = a;
            sum += a;
          }
          return { samples: got.pcm.length, peak: peak,
                   mean: got.pcm.length ? sum / got.pcm.length : 0,
                   sampleRate: got.sampleRate };
        },
        play: function (seconds) { return playMix(seconds); },
        stop: function () { stopAudio(); drawPanel(); },
        saveMix: function () { commit(); drawPanel(); return mx.toJSON(state()); },
        loadSaved: function () {
          mix = null;
          seen = "";
          error = "";
          drawPanel();
          return api.state();
        },
        releaseAll: function () {
          return apply(function () {
            var out = [];
            for (var i = 0; i < mx.CHANNELS; i++) out.push(mx.release(mix, i));
            return out;
          });
        }
      };

      /* ---- bind the page's own controls ------------------------------------ */

      function bind(id, type, fn) {
        var e = studio.$(id);
        if (e && e.addEventListener) e.addEventListener(type, fn);
      }

      TABS.forEach(function (t) {
        bind("aud-tabbtn-" + t, "click", function () { tab = t; drawPanel(); });
      });
      /* #62's wave editor inline: one column per step, click to set it */
      bind("aud-waveedit", "click", function (ev) {
        onWaveClick(ev, studio.$("aud-waveedit"));
      });
      bind("aud-trigger", "click", function () { onTrigger(sel); });
      bind("aud-relnote", "click", function () { onRelease(sel); });
      bind("aud-reset", "click", function () { onReset(sel); });
      bind("aud-preset", "change", function () {
        var e = studio.$("aud-preset");
        if (!e || !e.value) return;
        edit(function () { mx.setPreset(mix, sel, e.value); });
      });
      [["a", "attack"], ["d", "decay"], ["s", "sustain"], ["r", "rate"]]
        .forEach(function (pair) {
          bind("aud-env-" + pair[0], "input", function () {
            var e = studio.$("aud-env-" + pair[0]);
            var v = mx.voice(state(), sel);
            var env = { attack: v.env.attack, decay: v.env.decay,
                        sustain: v.env.sustain, rate: v.env.rate };
            env[pair[1]] = Number(e && e.value);
            edit(function () { mx.setEnv(mix, sel, env); });
          });
        });
      bind("aud-lfo-freq", "input", function () {
        var e = studio.$("aud-lfo-freq");
        edit(function () {
          var freq = Number(e && e.value);
          mx.setLfo(mix, mix.lfo.ctl ? { freq: freq, ctl: mix.lfo.ctl } : null);
          mix.lfo.freq = freq;
        });
      });
      bind("aud-lfo-ctl", "change", function () {
        var e = studio.$("aud-lfo-ctl");
        edit(function () {
          var ctl = Number(e && e.value);
          mx.setLfo(mix, ctl ? { freq: mix.lfo.freq, ctl: ctl } : null);
        });
      });
      [["l", false], ["r", true]].forEach(function (pair) {
        bind("aud-master-" + pair[0], "input", function () {
          var e = studio.$("aud-master-" + pair[0]);
          var other = studio.$("aud-master-" + (pair[1] ? "l" : "r"));
          var nib = Math.max(0, Math.min(15, Number(e && e.value) || 0));
          var otherNib = Math.max(0, Math.min(15, Number(other && other.value) || 0));
          edit(function () {
            mx.setMasterBalance(mix, pair[1] ? ((otherNib << 4) | nib)
                                             : ((nib << 4) | otherNib));
          });
        });
      });
      bind("aud-playall", "click", function () { playMix(1); });
      bind("aud-stop", "click", function () { stopAudio(); drawPanel(); });
      bind("aud-releaseall", "click", function () {
        edit(function () {
          for (var i = 0; i < mx.CHANNELS; i++) mx.release(mix, i);
        });
      });
      bind("aud-load", "click", function () {
        mix = null;
        seen = "";
        error = "";
        drawPanel();
        studio.toast("loaded the mix saved in waves.json");
      });
      bind("aud-save", "click", function () {
        commit();
        drawPanel();
        studio.toast("mix saved into waves.json");
      });

      studio.toy.onAssetEdit(function (name) {
        if (/^waves\.json$/.test(name)) api.invalidate();
        /* #122: the picker lists the toy's instruments, so a new one shows
         * without leaving and re-entering the panel. */
        else if (name === "instruments.json") drawPanel();
      });

      studio.panels.register({
        id: "audio",
        label: "AUDIO",
        group: "chip",
        chapter: "sound",
        gloss: "Six PSG voices — wave, noise or DDA — with a meter the PCM " +
               "agrees with; the mix saves as waves.json.",
        draw: function () { drawPanel(); },
        api: api
      });
    }
  });
})(typeof self !== "undefined" ? self : this);
