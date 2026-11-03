/*
 * studio-panel-controls.js — the CONTROLS drawer (card #262), a module of the
 * studio since #102.
 *
 * The studio's Run view takes a real controller through renderer/pce-gamepad.js
 * (the browser's Gamepad API, USB or Bluetooth, Chrome and Safari).  This
 * panel is where a person sees that it is working and fixes a pad whose
 * buttons are in a different order:
 *
 *   - one row per connected pad, with the browser's own id and whether it is
 *     a Standard Gamepad;
 *   - a live picture of which pad buttons are down right now — the D-pad, I,
 *     II, Select, Run and the 6-button III/IV;
 *   - the mapping table: each PCE action and the controller button it is on;
 *     "Change" waits for the next button pressed on any pad and saves it;
 *   - "Reset" puts the standard-layout defaults back.
 *
 * The table is saved in the browser (localStorage, renderer/pce-gamepad.js's
 * STORE_KEY), so the toy page on the same origin reads it too.  The keyboard
 * keeps working beside it: the page merges the keyboard's pad 1 with the
 * first controller's, and the second controller is pad 2.
 *
 * The panel does not own the reading.  It polls the page's one shared poller
 * (PCEStudio.gamepad.shared()) from a redraw timer, and the page polls the
 * same object before every frame; that is why a remap begun here is completed
 * by whichever poll runs first.  Nothing here touches navigator directly.
 *
 * A browser with no Gamepad API, or none connected, gets a plain sentence —
 * never a hidden failure.  docs/STUDIO.md §3.12.
 */
(function (root) {
  "use strict";
  var P = root.PCEStudio = root.PCEStudio || {};
  P.studioPanelModules = P.studioPanelModules || [];

  var TICK_MS = 100;

  P.studioPanelModules.push({
    id: "controls",
    register: function (studio) {
      var G = P.gamepad ? P.gamepad.shared() : null;
      var host = null;
      var signature = "";
      var savedNote = "";
      var timer = null;          /* the live redraw, while this drawer is open */

      function $(id) { return studio.$(id); }

      function el(tag, cls, text) {
        var e = studio.document.createElement(tag);
        if (cls) e.className = cls;
        if (text != null) e.textContent = text;
        return e;
      }

      function clear(e) {
        while (e && e.firstChild) e.removeChild(e.firstChild);
      }

      function visible() {
        host = host || $("bottom-controls");
        return !!(host && !host.hidden);
      }

      function actionLabel(a) {
        return (P.gamepad && P.gamepad.LABELS[a]) || a;
      }

      function sourceLabel(list) {
        if (P.gamepad && P.gamepad.sourceLabel)
          return (list || []).map(P.gamepad.sourceLabel).join(" or ");
        return "—";
      }

      function padPicture(bits) {
        var pic = el("div", "pad-pic");
        pic.setAttribute("role", "img");
        pic.setAttribute("aria-label", Object.keys(bits || {}).join(" ") ||
                         "no pad button down");
        var cells = [
          { key: "up", text: "↑" }, { key: "down", text: "↓" },
          { key: "left", text: "←" }, { key: "right", text: "→" },
          { key: "i", text: "I" }, { key: "ii", text: "II" },
          { key: "select", text: "SEL" }, { key: "run", text: "RUN" },
          { key: "iii", text: "III" }, { key: "iv", text: "IV" }
        ];
        for (var i = 0; i < cells.length; i++) {
          var c = el("span", "pad-cell" + (bits && bits[cells[i].key]
            ? " is-down" : ""), cells[i].text);
          c.title = actionLabel(cells[i].key);
          pic.appendChild(c);
        }
        return pic;
      }

      function draw() {
        if (!host) host = $("bottom-controls");
        if (!host) return;
        clear(host);
        if (!G) {
          host.appendChild(el("p", "ctl-note",
            "The Gamepad API is not available in this browser."));
          return;
        }
        var pads = G.pads();
        host.appendChild(el("p", "ctl-note",
          "USB or Bluetooth controllers, Chrome and Safari. Press a button " +
          "on a pad to wake it. The keyboard works beside it: IJKL is the " +
          "D-pad, N/M are I/II, O/P are Select/Run."));
        if (!pads.length) {
          host.appendChild(el("p", "ctl-none",
            "No controller connected. Plug one in and press a button."));
        } else {
          for (var i = 0; i < pads.length; i++) {
            var row = el("div", "ctl-pad");
            var head = el("div", "ctl-pad-head");
            head.appendChild(el("strong", null,
              "Pad " + (i + 1)));
            head.appendChild(el("span", "ctl-pad-id",
              " " + pads[i].id + (pads[i].mapping === "standard"
                ? " (standard)" : " (non-standard)")));
            row.appendChild(head);
            row.appendChild(padPicture(pads[i].bits));
            host.appendChild(row);
          }
        }

        var table = el("div", "ctl-map");
        var pending = G.pending();
        for (var a = 0; a < P.gamepad.ACTIONS.length; a++) {
          (function (action) {
            var line = el("div", "ctl-row" +
              (pending === action ? " is-waiting" : ""));
            line.appendChild(el("span", "ctl-action", actionLabel(action)));
            if (pending === action) {
              line.appendChild(el("span", "ctl-waiting",
                "press a button on a pad…"));
              var cancel = el("button", "btn-mini", "Cancel");
              cancel.type = "button";
              cancel.addEventListener("click", function () {
                G.cancel();
                draw();
              });
              line.appendChild(cancel);
            } else {
              line.appendChild(el("span", "ctl-source",
                sourceLabel(G.mapping()[action])));
              var change = el("button", "btn-mini", "Change");
              change.type = "button";
              change.setAttribute("data-action", action);
              change.addEventListener("click", function () {
                G.begin(action);
                savedNote = "";
                draw();
              });
              line.appendChild(change);
            }
            table.appendChild(line);
          })(P.gamepad.ACTIONS[a]);
        }
        host.appendChild(table);

        var foot = el("div", "ctl-foot");
        var reset = el("button", "btn-mini", "Reset to defaults");
        reset.type = "button";
        reset.addEventListener("click", function () {
          G.resetMapping();
          savedNote = G.lastSaveOk()
            ? "Mapping reset and saved in this browser."
            : "Mapping reset for this session; this browser refused to store it.";
          draw();
        });
        foot.appendChild(reset);
        foot.appendChild(el("span", "ctl-note",
          savedNote || (G.persistent()
            ? "The mapping is saved in this browser."
            : "The mapping is kept for this session; this browser has no " +
              "storage here.")));
        host.appendChild(foot);
      }

      /* The live redraw: only while the drawer is open, and only when what
       * the panel shows changed (a pad, a bit, a remap, a saved note). */
      function tick() {
        if (!G || !visible()) return;
        G.poll();
        var captured = G.captured();
        if (captured) {
          savedNote = actionLabel(captured.action) + " is now " +
            (P.gamepad.sourceLabel(captured.source)) +
            (captured.saved !== false
              ? ", saved in this browser."
              : " for this session; this browser refused to store it.");
          G.clearCaptured();
        }
        var sig = JSON.stringify({
          pads: G.pads().map(function (p) {
            return [p.id, p.mapping, p.bits];
          }),
          mapping: G.mapping(),
          pending: G.pending(),
          note: savedNote
        });
        if (sig === signature) return;
        signature = sig;
        draw();
      }

      function start() {
        if (timer || typeof setInterval !== "function") return;
        timer = setInterval(tick, TICK_MS);
      }

      draw();
      start();

      studio.panels.register({
        id: "controls",
        label: "Controls",
        group: "workspace",
        open: function () {
          studio.layout.drawer("controls");
          start();
          tick();
        },
        draw: draw,
        /* The panel's evidence surface, read the way the other modules' are
         * (#102's panelApi). */
        api: {
          pads: function () { return G ? G.pads() : []; },
          mapping: function () { return G ? G.mapping() : null; },
          pending: function () { return G ? G.pending() : null; },
          captured: function () { return G ? G.captured() : null; },
          begin: function (a) { return G ? G.begin(a) : null; },
          tick: tick
        }
      });
    }
  });
})(typeof self !== "undefined" ? self : this);
