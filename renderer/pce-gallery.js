/*
 * pce-gallery.js — the Browse gallery's model (#80): the example toys (#29)
 * as renderer/gallery-toys.js carries them, the URLs one toy is reached by,
 * and the one player the Browse and toy pages run a toy with.
 *
 * There is no backend and no second runtime.  A toy runs through
 * renderer/pce-toys.js over renderer/pce-toyhost.js, drawn by
 * renderer/pce-sprites.js over renderer/pce-bg.js — the same stack the
 * studio, the toys page and the Mednafen checks use.  The data is generated
 * from toys/*.lua by tools/gallery.js, so a gallery card, a toy's own page
 * and `node tests/check-examples.js` are all looking at the same bytes.
 *
 * Credit: the pages' shape follows ppu.toys' /browse and /t/<id> (MIT,
 * Copyright (c) 2026 Liora Labs; docs/STUDIO.md §0), with no ppu.toys code.
 */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./gallery-toys.js"),
                             require("./pce-toys.js"));
  } else {
    root.PCEStudio = root.PCEStudio || {};
    root.PCEStudio.gallery = factory(root.PCEStudio.galleryData,
                                     root.PCEStudio.toys);
  }
})(typeof globalThis !== "undefined" ? globalThis : this,
   function (data, toyRuntime) {
  "use strict";

  /* The card picture: frame 60, the same frame tests/check-examples.js
   * writes to tests/dumps/examples/. */
  var THUMB_FRAME = 60;

  var toys = (data && data.toys) || [];

  function list() { return toys.slice(); }

  function find(id) {
    for (var i = 0; i < toys.length; i++) {
      if (toys[i].id === String(id)) return toys[i];
    }
    return null;
  }

  /* A toy's own page, the studio with the toy open, and its raw source.
   * Relative to renderer/, where every page lives. */
  function toyHref(id) { return "toy.html?id=" + encodeURIComponent(String(id)); }
  function studioHref(id) {
    return "studio.html?toy=" + encodeURIComponent(String(id));
  }
  function rawHref(toy) { return "../toys/" + toy.file; }

  /* Draw one frame onto a canvas.  The model's pixels are RGB, three bytes
   * per pixel (the shape pce-bg.js and pce-sprites.js return); a canvas
   * wants RGBA, so the alpha is added here — the same loop the studio's
   * output column and every panel use. */
  function draw(canvas, frame) {
    if (!canvas || !frame) return;
    if (canvas.width !== frame.width) canvas.width = frame.width;
    if (canvas.height !== frame.height) canvas.height = frame.height;
    var ctx = canvas.getContext("2d");
    if (!ctx || !ctx.createImageData) return;
    var image = ctx.createImageData(frame.width, frame.height);
    var rgb = frame.pixels, d = image.data;
    for (var i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
      d[j] = rgb[i];
      d[j + 1] = rgb[i + 1];
      d[j + 2] = rgb[i + 2];
      d[j + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  }

  /* Pixels that are not the frame's own top-left colour — the picture, as
   * opposed to a frame that failed to draw.  #90's lesson: a toy that runs
   * without error can still be a flat rectangle. */
  function countInk(frame) {
    if (!frame || !frame.pixels) return 0;
    var px = frame.pixels;
    var r = px[0], g = px[1], b = px[2];
    var n = 0;
    for (var i = 0; i < px.length; i += 3) {
      if (px[i] !== r || px[i + 1] !== g || px[i + 2] !== b) n++;
    }
    return n;
  }

  /* A demo toy's art, fetched from beside the site.
   *
   * #125's CITY (and the demos after it) is a toy whose picture is NOT in the
   * repository: Dennis's 2026-10-29 decision keeps the converted pack art in
   * demo-art/<toy>/ and tools/deploy.sh uploads it with the toy.  The gallery
   * entry carries `art: {base, files}` instead of the files themselves, so
   * the page fetches them from `art/<toy>/` on the site.  A clone served
   * locally, or a site whose upload skipped the art, gets null and the toy
   * still runs — with no picture, which the page says out loud.
   *
   * Returns a Promise of the file list ({name, source} — the toy host's own
   * shape), or of null.  No fetch (a stub DOM in a test) is not an error. */
  function loadArt(toy) {
    if (!toy || !toy.art || !toy.art.files) return Promise.resolve(null);
    if (typeof fetch !== "function") return Promise.resolve(null);
    var base = toy.art.base || ("art/" + toy.id + "/");
    return Promise.all(toy.art.files.map(function (f) {
      return fetch("../" + base + f.name).then(function (r) {
        if (!r.ok) throw new Error(f.name + ": HTTP " + r.status);
        return r.text();
      });
    })).then(function (texts) {
      return toy.art.files.map(function (f, i) {
        return { name: f.name, kind: f.kind, source: texts[i] };
      });
    }).catch(function () { return null; });
  }

  /* Run a toy from frame 0 to `frameNo` and leave that frame on the canvas.
   * A fresh runtime, disposed afterwards: a card does not keep five Lua VMs. */
  function still(canvas, source, frameNo, files) {
    var last = frameNo === undefined ? THUMB_FRAME : frameNo;
    var rt = toyRuntime.create(source, { budgetMs: 200, files: files });
    try {
      rt.load();
      var frame = null;
      for (var f = 0; f <= last; f++) {
        rt.setPad(1, {});
        frame = rt.frame(f);
      }
      draw(canvas, frame);
      return frame;
    } finally {
      try { rt.dispose(); } catch (e) { /* nothing left to free */ }
    }
  }

  /* The live player behind both pages: a fixed 1/60 s step from frame 0, a
   * slow tab dropping steps rather than stretching time (the studio's rule),
   * and pad 1 from `setPad`: the page fills it from the IJKL / N M / O P keys
   * on the focused output (card #124), so a game page and the studio drive a
   * toy the same way.  `pause` keeps
   * the runtime, so `play` resumes where it stopped; `reset` puts it back at
   * frame 0. */
  function player(canvas, source, opts) {
    opts = opts || {};
    var step = 1000 / 60;
    var rt = null, index = 0, raf = null, last = 0, running = false;
    var error = null, lastFrame = null, torn = false;
    /* the live pad: the page mutates this object, so the frame after a key
     * sees it without the page and the runtime holding two copies */
    var pad = {};

    function now() {
      return (typeof performance !== "undefined" && performance.now)
        ? performance.now() : 0;
    }

    function start() {
      disposeRuntime();
      rt = toyRuntime.create(source, { budgetMs: opts.budgetMs || 120,
                                       files: opts.files });
      rt.load();
      index = 0;
      error = null;
      lastFrame = null;
    }

    function disposeRuntime() {
      if (rt) { try { rt.dispose(); } catch (e) { /* freed */ } rt = null; }
    }

    function runOne() {
      rt.setPad(1, pad);
      lastFrame = rt.frame(index);
      index++;
      draw(canvas, lastFrame);
      return lastFrame;
    }

    function tick(t) {
      if (!running || torn) return;
      if (t - last < step) { raf = requestAnimationFrame(tick); return; }
      last = t - ((t - last) % step);
      try {
        var frame = runOne();
        if (opts.onFrame) opts.onFrame(frame, index);
      } catch (e) {
        running = false;
        raf = null;
        error = e;
        if (opts.onError) opts.onError(e);
        return;
      }
      raf = requestAnimationFrame(tick);
    }

    function play() {
      if (torn) return;
      if (!rt) {
        try { start(); } catch (e) { error = e; if (opts.onError) opts.onError(e); return; }
      }
      if (running) return;
      running = true;
      last = now();
      raf = requestAnimationFrame(tick);
    }

    function pause() {
      running = false;
      if (raf && typeof cancelAnimationFrame === "function")
        cancelAnimationFrame(raf);
      raf = null;
    }

    function reset() {
      pause();
      start();
    }

    function restart() { reset(); play(); }

    /* The synchronous route: the selftests and the evidence runner use it so
     * a frame count is a number, not a deadline. */
    function frames(count) {
      if (torn) return [];
      if (!rt) start();
      var out = [];
      for (var i = 0; i < count; i++) out.push(runOne());
      return out;
    }

    return {
      play: play,
      pause: pause,
      reset: reset,
      restart: restart,
      frames: frames,
      frame: function () { return lastFrame; },
      index: function () { return index; },
      isPlaying: function () { return running; },
      error: function () { return error; },
      /* The pad the page fills from the keys: the object is shared with the
       * runtime, so a key held between frames is seen.  `pad()` is what the
       * evidence reads back, and `state()` is the live SAT the test uses to
       * find the ship. */
      setPad: function (buttons) { pad = buttons || {}; return pad; },
      pad: function () { return pad; },
      state: function () { return rt ? rt.state : null; },
      dispose: function () { torn = true; pause(); disposeRuntime(); }
    };
  }

  return {
    version: (data && data.version) || 0,
    THUMB_FRAME: THUMB_FRAME,
    list: list,
    find: find,
    toyHref: toyHref,
    studioHref: studioHref,
    rawHref: rawHref,
    draw: draw,
    countInk: countInk,
    loadArt: loadArt,
    still: still,
    player: player
  };
});
