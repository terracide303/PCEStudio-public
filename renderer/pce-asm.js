/*
 * pce-asm.js — assemble PC Engine source in the browser (card #224).
 *
 *   const asm = require("../renderer/pce-asm.js");
 *   const { bytes, errors, listing, sym, out, status } = asm.assemble(
 *     sourceText, {
 *       includes: { "lib/foo.inc": "..." },
 *       filename: "main.asm"          // optional; diagnostics name it
 *     });
 *
 * The work is done by vendor/pceas/: PCEAS 3.23 (the MagicKit assembler,
 * uli/huc@52a556a) compiled to WebAssembly with Emscripten.  See
 * vendor/pceas/VENDORED.md for the source, licence and build.  This module is
 * a thin wrapper, not a second assembler:
 *
 *   - one fresh WebAssembly instance per assemble(), because PCEAS keeps its
 *     symbol tables and error count in globals and calls exit() on an error;
 *   - the source and every include are written into the instance's in-memory
 *     filesystem, then main() runs exactly as `pceas -raw main.asm` would;
 *   - stdout is parsed back into {line, message} diagnostics, and the .pce /
 *     .lst / .sym files PCEAS wrote are read from the filesystem.
 *
 * assemble() is synchronous in Node.  In a browser, fetch the wasm first with
 * `await asm.ready()`, then call assemble() (also synchronous).  The browser
 * route is written but not yet run by a page; the proof in #224 is the Node
 * path, and nothing in the studio UI calls this module yet.
 *
 * OUTPUT is a raw HuCard image by default: no PCEAS ROM header, the same
 * bytes `pceas -raw` writes (and `make -C tools` builds).  Pass
 * { raw: false } for PCEAS's own header.
 *
 * Dual use: CommonJS module in Node (tests/check-asm.js) and a browser global
 * (root.PCEStudio.asm) via the same UMD-style wrapper as pce-rom.js.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.PCEStudio = root.PCEStudio || {};
    root.PCEStudio.asm = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* The browser global to read createPceas from.  `root` belongs to the UMD
   * wrapper above, not to this factory: a function expression passed as an
   * argument is created in the wrapper's CALLER scope, so it cannot see the
   * wrapper's parameters.  #230 found this when the first page tried to
   * assemble; the Node path never reads it. */
  var GLOBAL = typeof self !== "undefined" ? self
    : (typeof globalThis !== "undefined" ? globalThis : {});

  var IS_NODE = typeof process === "object" &&
                process !== null &&
                !!process.versions && !!process.versions.node;

  var nodeRequire = null;
  var nodePath = null;
  var nodeFs = null;
  var createPceas = null;      /* the Emscripten module factory */
  var wasmBytes = null;        /* Uint8Array of pceas.wasm */
  var loadError = null;

  if (IS_NODE) {
    nodeRequire = require;
    nodePath = require("path");
    nodeFs = require("fs");
  }

  function wasmPath() {
    return nodePath.join(__dirname, "..", "vendor", "pceas", "pceas.wasm");
  }

  function loadFactory() {
    if (createPceas) return createPceas;
    if (IS_NODE) {
      createPceas = nodeRequire("../vendor/pceas/pceas.js");
    } else if (typeof GLOBAL.createPceas === "function") {
      createPceas = GLOBAL.createPceas;
    } else {
      throw new Error("pce-asm: load vendor/pceas/pceas.js before assembling " +
                      "in a browser, or call ready() with wasmUrl");
    }
    return createPceas;
  }

  // Load the wasm once.  Node reads it synchronously; a browser must call
  // ready() (async) because fetch is async.  The bytes are handed to each
  // instance as Module.wasmBinary, so no second compile or fetch happens.
  function ensureWasm() {
    if (wasmBytes) return;
    if (!IS_NODE) {
      throw new Error("pce-asm: call await ready() before assemble() in a " +
                      "browser");
    }
    wasmBytes = new Uint8Array(nodeFs.readFileSync(wasmPath()));
  }

  function ready(opts) {
    opts = opts || {};
    if (wasmBytes) return Promise.resolve(api);
    if (IS_NODE) {
      try {
        ensureWasm();
        loadFactory();
      } catch (e) {
        loadError = e;
        return Promise.reject(e);
      }
      return Promise.resolve(api);
    }
    var url = opts.wasmUrl || "vendor/pceas/pceas.wasm";
    return Promise.resolve()
      .then(function () {
        return fetch(url);
      })
      .then(function (res) {
        if (!res.ok) {
          throw new Error("pce-asm: cannot fetch " + url + " (" + res.status +
                          ")");
        }
        return res.arrayBuffer();
      })
      .then(function (buf) {
        wasmBytes = new Uint8Array(buf);
        loadFactory();
        return api;
      })
      .catch(function (e) {
        loadError = e;
        throw e;
      });
  }

  function dirname(p) {
    var i = p.lastIndexOf("/");
    return i < 0 ? "" : p.slice(0, i);
  }

  function fileValue(value) {
    if (typeof value === "string") return value;
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) {
      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }
    return String(value);
  }

  /*
   * PCEAS 3.23's warning() prints a diagnostic as two stdout lines:
   *
   *     #[2]   lib/foo.inc          <- current file, when it changes
   *        12  00:E000   lda #$GG    <- source line: 5-char right-justified
   *                                     line number ending at column 4
   *           Syntax error!         <- 7 spaces, then the message
   *
   * Errors and warnings share the shape; the "# N error(s)" summary counts
   * only errors.  This module returns both kinds in `errors`, because the
   * API has no separate warning channel and a warning is still something the
   * editor should show.
   */
  function parseDiagnostics(text) {
    var lines = text.split(/\r?\n/);
    var out = [];
    var file = null;
    var pending = null;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var header = /^#\[\d+\]\s+(.*)$/.exec(line);
      if (header) {
        file = header[1];
        pending = null;
        continue;
      }
      if (/^\s*$/.test(line)) continue;
      if (pending === null) {
        var field = line.slice(0, 5);
        if (/^\s*\d+\s*$/.test(field)) {
          pending = parseInt(field, 10);
          continue;
        }
      }
      if (pending !== null && /^ {7}\S/.test(line)) {
        out.push({ line: pending, message: line.slice(7).trim(), file: file });
        pending = null;
        continue;
      }
      pending = null;
    }
    return out;
  }

  function fallbackError(text) {
    var lines = text.split(/\r?\n/);
    for (var i = lines.length - 1; i >= 0; i--) {
      var line = lines[i].trim();
      if (!line) continue;
      if (/^PC Engine Assembler/.test(line)) continue;
      if (/^pass \d+$/.test(line)) continue;
      if (/^# \d+ error\(s\)$/.test(line)) continue;
      if (/^#\[/.test(line)) continue;
      return { line: 0, message: line, file: null };
    }
    return { line: 0, message: "pceas failed", file: null };
  }

  /*
   * Undo the prepended .list in a listing: drop that line and subtract one
   * from the line-number field of every main-file line.  Included files have
   * their own numbering and are left alone; the listing marks file changes
   * with "#[n]   name", the same headers the diagnostics use.
   */
  function unshiftListing(listing, filename) {
    var lines = listing.split("\n");
    var out = [];
    var inMain = false;
    var dropped = false;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var header = /^#\[\d+\]\s+(.*)$/.exec(line);
      if (header) {
        inMain = header[1] === filename;
        out.push(line);
        continue;
      }
      if (!inMain) {
        out.push(line);
        continue;
      }
      var field = line.slice(0, 5);
      if (!/^\s*\d+\s*$/.test(field)) {
        out.push(line);
        continue;
      }
      var n = parseInt(field, 10);
      if (n === 1 && !dropped && /\.list\b/.test(line)) {
        dropped = true;
        continue;
      }
      out.push(String(n - 1).padStart(5) + line.slice(5));
    }
    return out.join("\n");
  }

  /*
   * Assemble one source.  A new module instance is created per call, so the
   * same wrapper can be called repeatedly and an error cannot poison the
   * next assembly.
   */
  function assemble(sourceText, options) {
    options = options || {};
    if (typeof sourceText !== "string") {
      throw new TypeError("pce-asm: assemble(sourceText) wants a string");
    }
    ensureWasm();
    var factory = loadFactory();

    var filename = options.filename || "main.asm";
    var includes = options.includes || {};
    var wantListing = options.listing !== false;
    var source = sourceText;
    // PCEAS writes a .lst only while its .list switch is on, and the switch
    // must be on at the top (it is reset at the start of pass 2).  Prepend
    // one when the caller wants a listing; it emits nothing, so the ROM is
    // unchanged.  The +1 it adds to every main-file line number is undone
    // below in both the listing and the diagnostics.
    var prepended = false;
    if (wantListing && !/^[ \t]*\.list\b/im.test(source)) {
      source = ".list\n" + source;
      prepended = true;
    }

    var stdout = "";
    var stderr = "";
    var mod = {
      noInitialRun: true,
      thisProgram: "pceas",
      wasmBinary: wasmBytes,
      print: function (s) { stdout += s + "\n"; },
      printErr: function (s) { stderr += s + "\n"; }
    };
    var pending = factory(mod);
    if (pending && typeof pending.catch === "function") {
      // The work is synchronous (WASM_ASYNC_COMPILATION=0 with wasmBinary
      // supplied), so `mod` is already populated; this only keeps a failed
      // module init from becoming an unhandled rejection.
      pending.catch(function () {});
    }
    if (!mod.FS || typeof mod.callMain !== "function") {
      throw new Error("pce-asm: the PCEAS WebAssembly module did not start" +
                      (stderr ? ": " + stderr.trim() : ""));
    }

    Object.keys(includes).forEach(function (name) {
      var dir = dirname(name);
      if (dir) mod.FS.mkdirTree(dir);
      mod.FS.writeFile(name, fileValue(includes[name]));
    });
    // Last, so an includes map that happens to carry the entry file (a
    // convenience some callers use) cannot overwrite the text being
    // assembled, including the .list line added above.
    var sourceDir = dirname(filename);
    if (sourceDir) mod.FS.mkdirTree(sourceDir);
    mod.FS.writeFile(filename, source);

    var args = [];
    if (options.raw !== false) args.push("-raw");
    if (Array.isArray(options.args)) args = args.concat(options.args);
    args.push(filename);

    var previousExitCode = IS_NODE ? process.exitCode : undefined;
    var status;
    try {
      status = mod.callMain(args);
    } finally {
      // Emscripten's Node quit hook sets process.exitCode when PCEAS exits
      // non-zero; that is this call's result, not the test's.
      if (IS_NODE) process.exitCode = previousExitCode;
    }

    var base = filename.replace(/\.[^.\/]*$/, "");
    if (!base) base = filename;
    var bytes = new Uint8Array(0);
    try {
      bytes = new Uint8Array(mod.FS.readFile(base + ".pce"));
    } catch (e) {
      bytes = new Uint8Array(0);
    }
    var listing = "";
    if (wantListing) {
      try {
        listing = new TextDecoder().decode(mod.FS.readFile(base + ".lst"));
        if (prepended) listing = unshiftListing(listing, filename);
      } catch (e) {
        listing = "";
      }
    }
    var sym = "";
    try {
      sym = new TextDecoder().decode(mod.FS.readFile(base + ".sym"));
    } catch (e) {
      sym = "";
    }

    var errors = parseDiagnostics(stdout + stderr);
    if (prepended) {
      errors.forEach(function (e) {
        if (e.file === filename && e.line > 0) e.line -= 1;
      });
    }
    if (status !== 0 && errors.length === 0) {
      errors = [fallbackError(stdout + stderr)];
    }
    return {
      bytes: bytes,
      errors: errors,
      listing: listing,
      sym: sym,
      out: stdout + stderr,
      status: status
    };
  }

  /*
   * Which file is the entry: main.asm or main.s by convention, else the
   * first .asm/.s in project order.  An assembly project saves every file
   * flat, so the name is also what PCEAS' diagnostics and .sym carry.
   * Includes are every OTHER file (a .inc, or a .s pulled in by .include);
   * the callers build that map, because a project also holds NOTES.md.
   */
  function entryName(files) {
    var names = [];
    for (var i = 0; i < (files || []).length; i++) {
      var f = files[i];
      names.push(typeof f === "string" ? f : String(f && f.name || ""));
    }
    var sources = names.filter(function (n) { return /\.(s|asm)$/i.test(n); });
    if (sources.indexOf("main.asm") >= 0) return "main.asm";
    if (sources.indexOf("main.s") >= 0) return "main.s";
    return sources[0] || "main.asm";
  }

  /*
   * Bytes per bank, read from PCEAS' listing (#230's size readout).  A line
   * that emitted bytes carries them in the one place the listing states them:
   *
   *       10  01:E000  01 02 03  	.db $01, $02, $03, $04
   *           01:E003  04
   *
   * The first field is bank:address; continuation lines (no source line
   * number) carry it too.  `bytes` counts emitted bytes, `from`/`to` are the
   * address span they cover (to exclusive), so a gap inside a bank shows as
   * bytes < to - from rather than disappearing.  Bank numbers follow .bank /
   * physical bank order as PCEAS prints them.
   */
  function bankSizes(listing) {
    var byBank = {}, order = [];
    var lines = String(listing || "").split(/\r?\n/);
    /* The listing's byte field starts at column 16: five characters of line
     * number, two spaces, the seven-character bank:address, two spaces.  A
     * continuation line has seven spaces where the line number goes, so the
     * address lands in the same place.  Bytes are `XX ` pairs; the field ends
     * at the first place the next pair is not exactly one space away (the
     * padding before the source is two or more spaces, or a tab).  Reading
     * bytes by column, not by splitting the tail, keeps a source word like
     * `adc` (two hex letters) out of the count. */
    var at = /^\s*(?:\d+\s+)?([0-9A-Fa-f]{2}):([0-9A-Fa-f]{4})/;
    function pair(text, i) {
      return i + 1 < text.length &&
             /^[0-9A-Fa-f]{2}$/.test(text.slice(i, i + 2));
    }
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var m = at.exec(line);
      if (!m) continue;
      var bank = parseInt(m[1], 16);
      var addr = parseInt(m[2], 16);
      var pos = 16, count = 0;
      while (pair(line, pos)) {
        count++;
        if (line.charAt(pos + 2) !== " " || !pair(line, pos + 3)) break;
        pos += 3;
      }
      if (!count) continue;
      var b = byBank[bank];
      if (!b) {
        b = byBank[bank] = { bank: bank, bytes: 0, from: addr, to: addr };
        order.push(bank);
      }
      b.bytes += count;
      if (addr < b.from) b.from = addr;
      if (addr + count > b.to) b.to = addr + count;
    }
    order.sort(function (a, b) { return a - b; });
    return order.map(function (n) {
      var b = byBank[n];
      return { bank: b.bank, bytes: b.bytes, from: b.from, to: b.to };
    });
  }

  var api = {
    assemble: assemble,
    ready: ready,
    wasmPath: wasmPath,
    entryName: entryName,
    bankSizes: bankSizes
  };
  return api;
});
