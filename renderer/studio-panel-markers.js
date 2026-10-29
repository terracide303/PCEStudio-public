/*
 * studio-panel-markers.js — the MARKERS drawer (#78), a module of the studio
 * since #102.
 *
 * `Add marker at frame N` records the current frame; each marker is a button
 * that pauses and seeks to it.  The list and its state live here, and the
 * studio's API reaches them through the registry (studio.markers() /
 * studio.addMarker()), so there is one copy of the markers.  The drawer
 * itself is opened by the page's layout helper.  docs/STUDIO.md §2.3.
 */
(function (root) {
  "use strict";
  var P = root.PCEStudio = root.PCEStudio || {};
  P.studioPanelModules = P.studioPanelModules || [];

  P.studioPanelModules.push({
    id: "markers",
    register: function (studio) {
      var markers = [];

      /* #87 — ppu.toys' "Go to marker" control: a select above the scrubber
       * that pauses and seeks to the chosen marker, then falls back to the
       * placeholder so the same marker can be chosen again. It is disabled
       * with no markers, exactly as theirs is. */
      function drawGoTo() {
        var sel = studio.$("go-marker");
        if (!sel) return;
        while (sel.firstChild) sel.removeChild(sel.firstChild);
        var ph = studio.document.createElement("option");
        ph.value = "";
        ph.textContent = "Choose marker…";
        sel.appendChild(ph);
        for (var i = 0; i < markers.length; i++) {
          var f = markers[i];
          var opt = studio.document.createElement("option");
          opt.value = String(f);
          opt.textContent = "frame " + f + " · " + (f / 60).toFixed(2) + "s";
          sel.appendChild(opt);
        }
        sel.disabled = markers.length === 0;
        sel.value = "";
      }

      function goToMarker(value) {
        var f = Number(value);
        if (!String(value) || !isFinite(f)) return;
        for (var i = 0; i < markers.length; i++) {
          if (markers[i] === f) {
            studio.render.pause();
            studio.render.seek(f);
            return;
          }
        }
      }

      function draw() {
        var host = studio.$("marker-list");
        while (host.firstChild) host.removeChild(host.firstChild);
        for (var i = 0; i < markers.length; i++) {
          var m = markers[i];
          (function (frame) {
            var b = studio.document.createElement("button");
            b.type = "button";
            b.className = "marker";
            b.textContent = "frame " + frame;
            b.title = "Seek to frame " + frame;
            b.addEventListener("click", function () {
              studio.render.pause();
              studio.render.seek(frame);
            });
            host.appendChild(b);
          })(m);
        }
        drawGoTo();
      }

      function addMarker() {
        var f = Math.max(0, Math.min(studio.render.length() - 1,
                                      studio.render.currentFrame()));
        if (markers.indexOf(f) < 0) markers.push(f);
        markers.sort(function (a, b) { return a - b; });
        draw();
        studio.toast("Marker at frame " + f + ".");
        return f;
      }

      if (studio.$("btn-addmarker"))
        studio.$("btn-addmarker").addEventListener("click", addMarker);
      if (studio.$("go-marker"))
        studio.$("go-marker").addEventListener("change", function (e) {
          var sel = (e && e.target) || studio.$("go-marker");
          goToMarker(sel.value);
          sel.value = "";
        });
      draw();

      studio.panels.register({
        id: "markers",
        label: "Markers",
        group: "workspace",
        open: function () { studio.layout.drawer("markers"); },
        draw: draw,
        markers: function () { return markers.slice(); },
        addMarker: addMarker
      });
    }
  });
})(typeof self !== "undefined" ? self : this);
