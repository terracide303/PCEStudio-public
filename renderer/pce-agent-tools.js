/*
 * pce-agent-tools.js — the one tool core (#166): the MCP tools in one UMD
 * module, for the Node server AND the studio tab.
 *
 * tools/mcp/server.js used to hold the tools.  That file is Node-only, and
 * the studio tab must run the SAME code (no second model), so the tool
 * logic moved here.  The file is a UMD module like its neighbours:
 * CommonJS in Node (tools/mcp/server.js requires it), a browser global in
 * the page (root.PCEStudio.agentTools; #167's AGENT panel loads it).
 *
 * createSession(host) -> { tools: [...], call(name, args) } — `host` is the
 * ONLY door to the outside world.  Every step the core cannot do with plain
 * JavaScript comes from it:
 *
 *   deflate(bytes)          the PNG writer's zlib step (sync or a Promise)
 *   inflate(bytes)          the PNG reader's zlib step (sync or a Promise)
 *   readBank0()             the committed renderer/ilvm.bin bytes (#100)
 *   savePath(path)          -> {path, name}: toy_save's path rules — resolve
 *                           the path against the working folder, add the
 *                           studio's .pce.json extension when the name has
 *                           none of the studio's, and refuse a path outside
 *                           the folder (save-path).  The Node adapter keeps
 *                           the existing rules; a browser adapter (#167)
 *                           returns the download's file name instead.
 *   saveEnvelope({path, title, description, text}) -> {path, name}
 *                           toy_save's write: the Node adapter writes the
 *                           envelope (refusing save-io when the write
 *                           fails); the browser adapter (#167) downloads.
 *   writeRom({bytes, name, out}) -> {path}
 *                           export_pce's write: the Node adapter writes
 *                           $TMPDIR/pce-mcp/<name>.pce (or `out`); the
 *                           browser adapter downloads.
 *   projectPath(path)       -> {path, name, folder}: project_save's path rules
 *                           (#163) — a trailing separator or an existing
 *                           folder is the UNPACKED route, any other name is
 *                           one .pcestudio file (the extension is added);
 *                           a path outside the working folder is refused
 *                           (save-path).
 *   writeProject({path, name, folder, entries, zip}) -> {path, files}
 *                           project_save's write: the Node adapter writes the
 *                           archive (bytes=zip) or, for a folder, each entry
 *                           as a file (bytes=e.bytes); the browser adapter
 *                           (#167) downloads the archive.
 *   readProject(path)       -> {path, folder, entries} or {path, bytes}
 *                           project_open's read (#163): a folder is its
 *                           entries, a .pcestudio is its bytes (parsed by
 *                           renderer/pce-project.js).  A host without it (a
 *                           browser tab) cannot open by path and says so
 *                           (project-host).
 *   now()                   the ISO time a project.json's created/modified
 *                           carry; a host without it writes "" (the project
 *                           format never reads the clock itself).
 *
 * The core itself needs no files, no environment and no buffers of its
 * own: hashing (sha256), base64, UTF-8 sizes and the PNG container are
 * plain JavaScript over Uint8Array, so the same bytes come out of a page,
 * Node and a node:vm context holding nothing but the renderer modules.
 * The refusals are this module's own (Refusal, refuse); every tool reply
 * is byte-for-byte the one tools/mcp/server.js sent before the split — a
 * test compares tools/list against the committed 'before' fixture, and
 * another drives recipes 02 and 06 through this file in a bare node:vm
 * context and through the server, frame hash for frame hash.
 *
 * The tool descriptions, arguments and replies are the contract with the
 * relay (#165) and the AGENT panel (#167): do not rename a tool, move an
 * argument or reword a reply without the board.
 *
 * See docs/MCP.md for the tool reference.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./pce-il.js"), require("./pce-ilbc.js"),
                             require("./pce-rom.js"), require("./pce-docs.js"),
                             require("./pce-validate.js"), require("./pce-sprites.js"),
                             require("./pce-toyhost.js"), require("./pce-panels.js"),
                             require("./pce-psg.js"), require("./pce-source.js"),
                             require("./pce-sat.js"), require("./pce-editor.js"),
                             require("./pce-seq.js"), require("./pce-project.js"),
                             require("./pce-romcheck.js"));
  } else {
    root.PCEStudio = root.PCEStudio || {};
    root.PCEStudio.agentTools = factory(root.PCEStudio.il, root.PCEStudio.ilbc,
      root.PCEStudio.rom, root.PCEStudio.docs, root.PCEStudio.validate,
      root.PCEStudio.sprites, root.PCEStudio.toyhost, root.PCEStudio.panels,
      root.PCEStudio.psg, root.PCEStudio.source, root.PCEStudio.sat,
      root.PCEStudio.editor, root.PCEStudio.seq, root.PCEStudio.project,
      root.PCEStudio.romcheck);
  }
})(typeof self !== "undefined" ? self : this, function (il, ilbc, romLib, docs,
  validateLib, sprites, toyhost, panels, psg, sourceLib, satLib, editorLib,
  seqLib, projectLib, romcheck) {
  "use strict";

  const MAIN = "main.lua";
  const NOTES = "NOTES.md";             /* a project's resume note (#162/#163) */
  const MAX_FRAMES = 600;               /* 10 s at 60 Hz, the frame_png cap */
  const DEFAULT_FRAMES = 60;

  /* The toy host's own pad contract (renderer/pce-toyhost.js). */
  const PAD_FIELDS = toyhost.PAD_FIELDS;
  const PAD_COUNT = toyhost.PAD_COUNT;

  /* The PSG register widths renderer/pce-psg.js's write() decodes: R0 masks
   * &0x07, R3 &0x0F, R6 &0x1F, every other register is an 8-bit write.  The
   * #61 sound chapter publishes the same nine names from psg.REGISTERS. */
  const PSG_RANGES = [
    [0, 0x07], [0, 0xFF], [0, 0xFF], [0, 0x0F], [0, 0xFF],
    [0, 0xFF], [0, 0x1F], [0, 0xFF], [0, 0xFF], [0, 0xFF]
  ];

  /* ---- refusals ---------------------------------------------------------- */

  function Refusal(code, message) {
    this.name = "Refusal";
    this.code = code;
    this.message = message;
  }
  Refusal.prototype = Object.create(Error.prototype);
  Refusal.prototype.constructor = Refusal;

  function refuse(code, message) { throw new Refusal(code, message); }

  function errorCode(e) {
    return (e && (e.code || e.name)) || "tool-error";
  }
  function errorMessage(e) {
    return String((e && e.message) || e);
  }

  /* ---- small helpers ----------------------------------------------------- */

  function isInt(v) { return typeof v === "number" && isFinite(v) && v === Math.floor(v); }

  function intIn(v, what, lo, hi, code) {
    if (!isInt(v) || v < lo || v > hi) {
      refuse(code, what + " must be an integer " + lo + ".." + hi + ", got " +
             JSON.stringify(v));
    }
    return v;
  }

  /* ---- sha256 over Uint8Array (FIPS 180-4; the same digest any sha256
   * gives, so the replies are byte-identical to the ones that used a
   * platform hash) -------------------------------------------------------- */

  const SHA_K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]);
  function shaRor(x, n) { return (x >>> n) | (x << (32 - n)); }
  function sha256Hex(bytes) {
    const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
                               0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const len = bytes.length;
    const padded = new Uint8Array((((len + 8) >> 6) + 1) * 64);
    padded.set(bytes);
    padded[len] = 0x80;
    const dv = new DataView(padded.buffer);
    const bits = len * 8;
    dv.setUint32(padded.length - 8, Math.floor(bits / 0x100000000));
    dv.setUint32(padded.length - 4, bits >>> 0);
    for (let off = 0; off < padded.length; off += 64) {
      const w = new Uint32Array(64);
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = shaRor(w[i - 15], 7) ^ shaRor(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = shaRor(w[i - 2], 17) ^ shaRor(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let a = h[0], b = h[1], c = h[2], d = h[3];
      let e = h[4], f = h[5], g = h[6], hh = h[7];
      for (let i = 0; i < 64; i++) {
        const s1 = shaRor(e, 6) ^ shaRor(e, 11) ^ shaRor(e, 25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (hh + s1 + ch + SHA_K[i] + w[i]) >>> 0;
        const s0 = shaRor(a, 2) ^ shaRor(a, 13) ^ shaRor(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (s0 + maj) >>> 0;
        hh = g; g = f; f = e; e = (d + t1) >>> 0;
        d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0;
      h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
      h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0;
      h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
    }
    let out = "";
    for (let i = 0; i < 8; i++) out += (h[i] >>> 0).toString(16).padStart(8, "0");
    return out;
  }

  /* ---- base64 over Uint8Array (RFC 4648; the same text the platform
   * codec gives) ---------------------------------------------------------- */

  const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const B64_LOOKUP = (function () {
    const t = new Int8Array(128);
    for (let i = 0; i < 128; i++) t[i] = -1;
    for (let i = 0; i < 64; i++) t[B64.charCodeAt(i)] = i;
    return t;
  })();

  function base64Encode(bytes) {
    let out = "";
    for (let i = 0; i + 3 <= bytes.length; i += 3) {
      const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] +
             B64[(n >> 6) & 63] + B64[n & 63];
    }
    const rem = bytes.length % 3;
    if (rem === 1) {
      const n = bytes[bytes.length - 1] << 16;
      out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + "==";
    } else if (rem === 2) {
      const n = (bytes[bytes.length - 2] << 16) | (bytes[bytes.length - 1] << 8);
      out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + "=";
    }
    return out;
  }

  /* The lenient decode: padding stops it, and anything outside the alphabet
   * is skipped, the way the platform codec reads an agent's pasted text. */
  function base64Decode(text) {
    const out = [];
    let acc = 0, bits = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c === 61) break;                 /* '=' ends the data */
      if (c >= 128) continue;
      const v = B64_LOOKUP[c];
      if (v < 0) continue;
      acc = (acc << 6) | v;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out.push((acc >> bits) & 0xFF);
      }
    }
    return Uint8Array.from(out);
  }

  /* ---- UTF-8 over plain JavaScript (the same sizes and bytes the platform
   * encoder gives, without one) ------------------------------------------- */

  function utf8Encode(text) {
    const out = [];
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c < 0x80) {
        out.push(c);
      } else if (c < 0x800) {
        out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
      } else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < text.length &&
                 text.charCodeAt(i + 1) >= 0xDC00 &&
                 text.charCodeAt(i + 1) <= 0xDFFF) {
        const cp = 0x10000 + ((c - 0xD800) << 10) + (text.charCodeAt(i + 1) - 0xDC00);
        i++;
        out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 63),
                 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      } else {
        out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      }
    }
    return Uint8Array.from(out);
  }

  function utf8Length(text) {
    let n = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < text.length &&
               text.charCodeAt(i + 1) >= 0xDC00 &&
               text.charCodeAt(i + 1) <= 0xDFFF) {
        n += 4; i++;
      } else n += 3;
    }
    return n;
  }

  /* ---- PNG: the writer frame_png's bytes come from ----------------------
   * The container is built here; the zlib step is the host's, so Node's
   * adapter passes the same deflate the old file used and the bytes stay
   * identical. ------------------------------------------------------------ */

  const CRC_TABLE = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let crc = 0xFFFFFFFF;
    for (const b of bytes) crc = CRC_TABLE[(crc ^ b) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function concatBytes(parts) {
    let n = 0;
    for (const p of parts) n += p.length;
    const out = new Uint8Array(n);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  function asciiBytes(text) {
    const out = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xFF;
    return out;
  }

  async function encodePng(rgb, width, height, host) {
    const chunk = (type, data) => {
      const len = new Uint8Array(4);
      new DataView(len.buffer).setUint32(0, data.length);
      const td = new Uint8Array(4 + data.length);
      td.set(asciiBytes(type), 0);
      td.set(data, 4);
      const crc = new Uint8Array(4);
      new DataView(crc.buffer).setUint32(0, crc32(td));
      return concatBytes([len, td, crc]);
    };
    const ihdr = new Uint8Array(13);
    const ih = new DataView(ihdr.buffer);
    ih.setUint32(0, width);
    ih.setUint32(4, height);
    ihdr[8] = 8;
    ihdr[9] = 2;                       /* colour type: RGB */
    const stride = width * 3;
    const raw = new Uint8Array((stride + 1) * height);
    for (let y = 0; y < height; y++) {
      raw[y * (stride + 1)] = 0;
      raw.set(rgb.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
    }
    const idat = await host.deflate(raw);
    return concatBytes([
      asciiBytes("\x89PNG\r\n\x1a\n"),
      chunk("IHDR", ihdr),
      chunk("IDAT", idat),
      chunk("IEND", new Uint8Array(0))
    ]);
  }

  /* ---- files: the studio's file-set rules (docs/STUDIO.md §2) ------------ */

  /* Same shape and guards as the studio's packed toy (#99): a list of
   * {name, source}, flat safe names, no duplicates, main.lua required.  The
   * asset files (tiles.json, palettes.json, sprites.json) are imported into
   * VRAM/CRAM/SAT by toy_run before init() (#117, #153), and source_add
   * merges new art into them. */
  function normaliseFiles(raw) {
    let list;
    if (Array.isArray(raw)) list = raw;
    else if (raw && typeof raw === "object") {
      list = Object.keys(raw).map(function (name) {
        return { name: name, source: raw[name] };
      });
    } else {
      refuse("toy-files", "files must be a list of {name, source} objects (or " +
             "an object mapping name -> source)");
    }
    if (!list.length) refuse("toy-files", "files is empty; the toy needs " +
                             "main.lua");
    const seen = {};
    const out = [];
    for (const f of list) {
      if (!f || typeof f.name !== "string") {
        refuse("toy-file-name", "every file needs a name");
      }
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(f.name) || f.name.indexOf("..") >= 0) {
        refuse("toy-file-name", "unsafe file name " + JSON.stringify(f.name) +
               "; use letters, digits, dot, dash and underscore");
      }
      if (seen[f.name]) refuse("toy-file-duplicate", "duplicate file " + f.name);
      if (typeof f.source !== "string") {
        refuse("toy-file-source", f.name + " has no text source");
      }
      seen[f.name] = true;
      out.push({ name: f.name, source: f.source });
    }
    if (!seen[MAIN]) {
      refuse("toy-file-main", "the toy has no " + MAIN + " (it is the file " +
             "that runs; the others are assets beside it)");
    }
    return out;
  }

  /* ---- songs (#161) ------------------------------------------------------ */

  /* A toy's song files are its music(index) slots, read by the sequencer's own
   * model: renderer/pce-seq.js songsFromFiles takes song.json (the SEQUENCER's
   * document) and any playable songs.json entry, and compiles each to the
   * module pce-song.js's createPlayer() takes — the same list the studio hands
   * a gallery toy (renderer/gallery-toys.js over tools/gallery.js).  The IL
   * runtime passes it to the same host, so music(0) plays a song the toy's
   * files carry instead of refusing music-range.  A song the model refuses is
   * refused here, before the toy that was loaded is replaced. */
  function toySongs(list) {
    try {
      return seqLib.songsFromFiles(list);
    } catch (e) {
      refuse(errorCode(e), errorMessage(e));
    }
  }

  /* What toy_write and song_write report about the slots, without the rows. */
  function songSummary(songs) {
    return songs.map(function (s) {
      return {
        name: s.songName || "song",
        instruments: (s.instruments || []).length,
        orders: s.orderCount,
        rows: s.rowsPerPattern,
        tick1: s.tick1,
        tick2: s.tick2
      };
    });
  }

  /* ---- pad script -------------------------------------------------------- */

  /* pad: [{from, to, pad, buttons: ["left", "i"]}] with from/to frame indices
   * inclusive.  Converted to the host's own {button: true} table each frame. */
  function normalisePad(raw) {
    if (raw == null) return [];
    if (!Array.isArray(raw)) {
      refuse("pad-script", "pad must be a list of {from, to, pad, buttons} " +
             "intervals");
    }
    return raw.map(function (iv, k) {
      if (!iv || typeof iv !== "object") {
        refuse("pad-script", "pad[" + k + "] is not an object");
      }
      const from = intIn(iv.from, "pad[" + k + "].from", 0, MAX_FRAMES - 1,
                         "pad-script");
      const to = intIn(iv.to == null ? from : iv.to, "pad[" + k + "].to", from,
                       MAX_FRAMES - 1, "pad-script");
      const pad = intIn(iv.pad == null ? 1 : iv.pad, "pad[" + k + "].pad", 1,
                        PAD_COUNT, "pad-range");
      const buttons = iv.buttons == null ? [] : iv.buttons;
      if (!Array.isArray(buttons)) {
        refuse("pad-script", "pad[" + k + "].buttons must be a list of button " +
               "names (" + PAD_FIELDS.join(", ") + ")");
      }
      for (const b of buttons) {
        if (PAD_FIELDS.indexOf(b) < 0) {
          refuse("pad-button", "pad[" + k + "].buttons has " +
                 JSON.stringify(b) + "; the buttons are " + PAD_FIELDS.join(", "));
        }
      }
      return { from: from, to: to, pad: pad, buttons: buttons.slice() };
    });
  }

  function compileToy(source) {
    return il.compile(source, { chunkName: MAIN });
  }

  /* ---- source_add's picture forms (#153) --------------------------------- */

  const ART_KINDS = ["bg", "sprites", "tilesheet", "palette"];

  /* #161: a .mid is the other thing source_add takes.  It becomes song.json —
   * the SEQUENCER's own document, through renderer/pce-source.js importMidi
   * (#123), the Add Source dialog's song importer — and replaces the toy's one
   * song, so music(0) plays it. */
  const SOURCE_KINDS = ART_KINDS.concat(["song"]);

  /* The hand-drawn form: a pixel grid of palette indices (-1 transparent)
   * with the palette as [r, g, b] triples, turned into the same RGBA image a
   * PNG decode gives, so the one importer runs on both. */
  function gridImage(args) {
    const grid = args.grid;
    if (!grid || typeof grid !== "object")
      refuse("source-grid", "grid needs {width, height, pixels} and a palette");
    const palette = args.palette;
    if (!Array.isArray(palette) || !palette.length)
      refuse("source-grid", "the grid needs a palette: a list of [r, g, b]");
    const width = intIn(grid.width, "grid.width", 1, 256, "source-grid");
    const height = intIn(grid.height, "grid.height", 1, 240, "source-grid");
    if (!Array.isArray(grid.pixels) || grid.pixels.length !== width * height)
      refuse("source-grid", "grid.pixels must hold width*height entries (" +
             width * height + "), got " +
             (Array.isArray(grid.pixels) ? grid.pixels.length : "none"));
    const rows = [];
    for (let i = 0; i < palette.length; i++) {
      const c = palette[i];
      if (!Array.isArray(c) || c.length !== 3)
        refuse("source-grid", "palette[" + i + "] must be [r, g, b]");
      rows.push([intIn(c[0], "palette[" + i + "].r", 0, 255, "source-grid"),
                 intIn(c[1], "palette[" + i + "].g", 0, 255, "source-grid"),
                 intIn(c[2], "palette[" + i + "].b", 0, 255, "source-grid")]);
    }
    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < grid.pixels.length; i++) {
      const idx = grid.pixels[i];
      if (!isInt(idx) || idx < -1 || idx >= rows.length)
        refuse("source-grid", "pixels[" + i + "] is " + JSON.stringify(idx) +
               " but the palette has " + rows.length + " entries (use -1 for " +
               "transparent)");
      const o = i * 4;
      if (idx === -1) continue;              /* alpha stays 0: transparent */
      rgba[o] = rows[idx][0]; rgba[o + 1] = rows[idx][1];
      rgba[o + 2] = rows[idx][2]; rgba[o + 3] = 255;
    }
    return { width: width, height: height, rgba: rgba };
  }

  /* The PNG reader's own two steps (renderer/pce-source.js pngInfo/pngPixels)
   * with the inflation between them coming from the host — the same shape
   * decodePng wraps, so the host may inflate asynchronously (a page's
   * DecompressionStream) or not (Node's sync zlib). */
  async function pngImage(args, host) {
    let bytes;
    try {
      bytes = base64Decode(String(args.png));
    } catch (e) {
      refuse("png-base64", "png is not base64");
    }
    const info = sourceLib.pngInfo(bytes);
    const raw = await host.inflate(info.idat);
    return sourceLib.pngPixels(info, raw);
  }

  function padRow16(row) {
    const out = new Array(16);
    for (let e = 0; e < 16; e++) out[e] = row && row[e] !== undefined ? row[e] : 0;
    return out;
  }
  function rowUsed(row) {
    return Array.isArray(row) && row.some(function (w) { return !!w; });
  }

  /* The picture's non-zero sprite palette rows land in the old doc's free
   * (all-zero) rows, so the sprites already placed keep their colours.
   * Returns doc-relative row index -> absolute row index. */
  function spriteRowRemap(oldPal, newPal) {
    const free = [];
    for (let i = 0; i < 16; i++) if (!rowUsed((oldPal.sprites || [])[i])) free.push(i);
    const remap = {};
    let k = 0;
    for (let i = 0; i < 16; i++) {
      if (!rowUsed((newPal.sprites || [])[i])) continue;
      if (k >= free.length)
        refuse("source-palettes", "the toy's sprite palettes hold " +
               (16 - free.length) + " rows and the picture needs another; " +
               "the 16 rows are full");
      remap[i] = free[k++];
    }
    return remap;
  }

  /* One importImage result's files, merged into the toy's file set.  Works on
   * a copy of the list; the session is only touched after pictureBudget
   * accepts the merged set. */
  function mergeFiles(result, current) {
    const byName = {};
    for (const f of current) byName[f.name] = f.source;
    const parse = function (name) {
      try { return JSON.parse(byName[name]); }
      catch (e) { refuse("asset-json", name + " is not JSON: " + e.message); }
    };
    const newPal = JSON.parse(result.files["palettes.json"]);
    const oldPal = byName["palettes.json"] == null
      ? { version: 1, backdrop: 0, background: [], sprites: [] }
      : parse("palettes.json");
    let remap = {};

    if (result.kind === "bg" || result.kind === "tilesheet") {
      byName["tiles.json"] = result.files["tiles.json"];
    }

    if (result.kind === "sprites") {
      const doc = JSON.parse(result.files["sprites.json"]);
      const oldDoc = byName["sprites.json"] == null
        ? { version: 1, patterns: [], sprites: [] }
        : parse("sprites.json");
      const base = (oldDoc.patterns || []).length;
      remap = spriteRowRemap(oldPal, newPal);
      const patterns = (oldDoc.patterns || []).concat(doc.patterns);
      const sprites = (oldDoc.sprites || []).concat(doc.sprites.map(function (s) {
        const out = Object.assign({}, s);
        out.pattern = base + s.pattern;
        if (remap[s.palette] !== undefined) out.palette = remap[s.palette];
        return out;
      }));
      if (sprites.length > toyhost.SAT_ENTRIES)
        refuse("source-sat", "the merged toy would place " + sprites.length +
               " sprites; the SAT holds " + toyhost.SAT_ENTRIES);
      byName["sprites.json"] = JSON.stringify(
        { version: 1, patterns: patterns, sprites: sprites }, null, 2) + "\n";
    }

    const spriteRows = [];
    for (let i = 0; i < 16; i++) {
      spriteRows.push(padRow16((oldPal.sprites || [])[i]));
    }
    for (const i of Object.keys(remap)) {
      spriteRows[remap[i]] = padRow16(newPal.sprites[i]);
    }
    const bgRows = [];
    if (result.kind === "sprites") {
      for (let i = 0; i < 16; i++) {
        bgRows.push(padRow16((oldPal.background || [])[i]));
      }
    } else {
      for (let i = 0; i < 16; i++) {
        const inc = (newPal.background || [])[i];
        bgRows.push(rowUsed(inc) ? padRow16(inc)
                                 : padRow16((oldPal.background || [])[i]));
      }
    }
    byName["palettes.json"] = JSON.stringify({
      version: 1,
      backdrop: (result.kind === "bg" || result.kind === "tilesheet")
        ? newPal.backdrop
        : (result.kind === "sprites"
            ? (oldPal.backdrop || 0)
            : (newPal.backdrop || oldPal.backdrop || 0)),
      background: bgRows,
      sprites: spriteRows
    }, null, 2) + "\n";

    return Object.keys(byName).map(function (name) {
      return { name: name, source: byName[name] };
    });
  }

  /* The merged set as the panels read it, and the words the picture occupies
   * in VRAM — pce-sat.js + pce-editor.js, the same path toy_run imports with,
   * so the report is the run's truth and a set the panels cannot read is
   * refused here before the toy changes. */
  function pictureBudget(files) {
    let pic, data;
    try {
      pic = satLib.pictureFromFiles(files);
      data = editorLib.toPicture(pic);
    } catch (e) {
      refuse(errorCode(e), errorMessage(e));
    }
    const layout = editorLib.patternLayout(pic);
    let usedTiles = 0;
    for (let c = editorLib.FIRST_CHAR; c < pic.nextChar; c++) {
      if (pic.tiles[c]) usedTiles++;
    }
    const bat = editorLib.BAT_W * editorLib.BAT_H;
    const tiles = usedTiles * 16;
    const patterns = layout.cellCount * 64;
    const sat = pic.sprites.length ? 256 : 0;
    return {
      tiles: usedTiles,
      patterns: pic.spritePatterns.length,
      sprites: pic.sprites.length,
      vram: { bat: bat, tiles: tiles, patterns: patterns, sat: sat,
              used: bat + tiles + patterns + sat,
              total: toyhost.VRAM_WORDS },
      regs: data.regs
    };
  }

  /* ---- song_write (#161): compose the toy's song ------------------------- */

  function findInstrument(song, want, where) {
    if (want == null) return 0;
    if (isInt(want)) {
      if (want < 0 || want >= song.instruments.length)
        refuse("seq-instrument", where + ": instrument " + want + " is not in " +
               "the song (0.." + (song.instruments.length - 1) + ")");
      return want;
    }
    if (typeof want === "string") {
      for (let i = 0; i < song.instruments.length; i++)
        if (song.instruments[i].name === want) return i;
      refuse("seq-instrument", where + ": the song has no instrument " +
             JSON.stringify(want) + "; it has " +
             song.instruments.map(function (x) { return x.name; }).join(", "));
    }
    refuse("seq-instrument", where + ": instrument must be an index or a name");
  }

  function songFromNotes(args) {
    const steps = args.steps == null ? 16
      : intIn(args.steps, "steps", seqLib.STEPS_MIN, seqLib.STEPS_MAX,
              "seq-steps");
    const song = seqLib.newSong(steps);
    song.name = args.name == null ? "song" : String(args.name);
    if (args.tempo != null)
      song.tempo = intIn(args.tempo, "tempo", seqLib.TEMPO_MIN,
                         seqLib.TEMPO_MAX, "seq-tempo");
    if (args.swing != null)
      song.swing = intIn(args.swing, "swing", 0, seqLib.SWING_MAX, "seq-swing");
    if (args.key != null)
      song.key = intIn(args.key, "key", 0, 11, "seq-key");

    if (!Array.isArray(args.notes))
      refuse("song-input", "notes must be a list of {channel, step, note, " +
             "length, instrument}");
    let last = 0;
    for (let k = 0; k < args.notes.length; k++) {
      const n = args.notes[k], where = "notes[" + k + "]";
      if (!n || typeof n !== "object") refuse("song-note", where + " is not an object");
      const ch = intIn(n.channel == null ? 0 : n.channel, where + ".channel", 0,
                       seqLib.CHANNELS - 1, "seq-channel");
      const step = intIn(n.step, where + ".step", 0, 65535, "seq-steps");
      let note = n.note;
      if (typeof note === "string") note = seqLib.noteIndex(note);
      if (!isInt(note) || note < seqLib.NOTE_MIN || note > seqLib.NOTE_MAX)
        refuse("seq-note", where + ".note must be a note name (\"C4\") or the " +
               "engine note " + seqLib.NOTE_MIN + ".." + seqLib.NOTE_MAX +
               " (C1..B7)");
      const pattern = Math.floor(step / song.steps);
      if (pattern >= seqLib.PATTERNS_MAX)
        refuse("seq-pattern", where + ".step " + step + " is past the " +
               seqLib.PATTERNS_MAX + " patterns of " + song.steps + " steps");
      while (song.patterns.length <= pattern) seqLib.addPattern(song);
      if (pattern > last) last = pattern;
      const at = step % song.steps;
      const length = n.length == null ? 1
        : intIn(n.length, where + ".length", 1,
                Math.min(seqLib.STEPS_MAX, song.steps - at), "seq-length");
      seqLib.setCell(song, pattern, ch, at,
        { note: note, length: length,
          instrument: findInstrument(song, n.instrument, where) });
    }
    song.order = [];
    for (let i = 0; i <= last; i++) song.order.push(i);
    return song;
  }

  function songFromDocument(args) {
    const raw = Object.assign({}, args.song);
    if (raw.version == null) raw.version = seqLib.VERSION;
    if (raw.name == null) raw.name = args.name == null ? "song" : String(args.name);
    if (raw.instruments == null) raw.instruments = seqLib.defaultInstruments();
    if (raw.tempo == null) raw.tempo = 150;
    if (raw.swing == null) raw.swing = 0;
    if (raw.key == null) raw.key = 0;
    if (raw.steps == null) raw.steps = 16;
    try {
      return seqLib.fromJSON(JSON.stringify(raw));
    } catch (e) {
      refuse(errorCode(e), errorMessage(e));
    }
  }

  /* A problem's source line: pce-validate.js sets `line` when it can place one,
   * and its messages sometimes open with "line N:" (its static value-range
   * findings do).  Every finding is labelled with the file either way. */
  function normaliseFinding(p) {
    let line = p.line == null ? null : p.line;
    if (line == null) {
      const m = /(?:^|\s)line (\d+):/.exec(p.message || "") ||
                /\[string "[^"]*"\]:(\d+):/.exec(p.message || "");
      if (m) line = Number(m[1]);
    }
    return {
      severity: p.severity,
      code: p.code,
      message: p.message,
      file: MAIN,
      line: line,
      location: line == null ? null : MAIN + ":" + line
    };
  }

  /* ---- tool definitions -------------------------------------------------- *
   * Each inputSchema is what tools/list publishes and what tests/check-mcp.js
   * holds the documentation to. */

  const TOOLS = [
    {
      name: "toy_write",
      description: "Write a toy: a file set with main.lua required and asset " +
        "files beside it (the studio's packed-toy shape, docs/STUDIO.md §2). " +
        "Compiles main.lua with renderer/pce-il.js immediately and returns the " +
        "IL's refusal code and file:line if it does not lower, and compiles the " +
        "song files (song.json, songs.json) the way music(index) needs them. " +
        "Replaces the current toy and clears any run.",
      inputSchema: {
        type: "object",
        properties: {
          files: {
            type: "array",
            description: "the toy's files; main.lua is the one that runs",
            items: {
              type: "object",
              properties: {
                name: { type: "string", description: "flat safe name, e.g. main.lua" },
                source: { type: "string" }
              },
              required: ["name", "source"]
            },
            minItems: 1
          }
        },
        required: ["files"],
        additionalProperties: false
      }
    },
    {
      name: "toy_save",
      description: "Save the loaded toy as the studio's own file (#160): one " +
        "pce.studio/1 JSON envelope holding main.lua, every asset file, the " +
        "named sources (sources.json) and the songs, written by the same " +
        "builder renderer/studio.html's Save uses " +
        "(renderer/pce-source.js envelopeText) — there is no second format. " +
        "The person opens it in the studio with Open… → From file, or drops it " +
        "on the page, and plays the toy WITH its art. The path is relative to " +
        "the folder the server was started in; a path outside it is refused " +
        "(save-path).",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string",
                  description: "the file to write, inside the working folder; " +
                    ".pce.json is added when the name has no .pce.json or " +
                    ".pce.studio extension" },
          title: { type: "string",
                   description: "the toy's title, shown in the studio's tab " +
                     "(default: the file's own name)" },
          description: { type: "string", description: "optional one line" }
        },
        required: ["path"],
        additionalProperties: false
      }
    },
    {
      name: "project_save",
      description: "Save the session as a whole PCEStudio project (#163), the " +
        "file a later session resumes from: the studio's .pcestudio (#162) — " +
        "project.json, main.lua, the asset files, sources.json and NOTES.md — " +
        "as ONE .pcestudio file, or as the same layout UNPACKED into a folder " +
        "when the path is a folder (a trailing / on the name, or an existing " +
        "folder), so git can hold the history. Pass the updated NOTES.md text " +
        "as notes (what you did, what works, what is next); with no notes and " +
        "none in the toy, the project gets the studio's NOTES.md template. " +
        "The person opens the file in the studio with Project… → Open (or " +
        "drops it on the page); a folder opens in a fresh session with " +
        "project_open. The path is relative to the folder the server was " +
        "started in; a path outside it is refused (save-path).",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string",
                  description: "the project to write, inside the working " +
                    "folder: a .pcestudio file name (the extension is added " +
                    "when it has none) or a folder, written unpacked" },
          title: { type: "string",
                   description: "the project's title (default: the project " +
                     "opened before, else the file or folder's own name)" },
          notes: { type: "string",
                   description: "the whole updated NOTES.md — the resume " +
                     "note: goal, what works, what does not, decisions, next " +
                     "steps" }
        },
        required: ["path"],
        additionalProperties: false
      }
    },
    {
      name: "project_open",
      description: "Resume a project saved by project_save or the studio " +
        "(#163): load its .pcestudio file, or its UNPACKED folder, into the " +
        "session — main.lua, every asset file, sources.json, the songs and " +
        "NOTES.md — and answer with NOTES.md's text FIRST, before anything " +
        "else, so the session starts from what the last one learned. Then " +
        "toy_run/frame_png play the resumed toy; toy_write edits it; " +
        "project_save writes it back. A path outside the folder the server " +
        "was started in is refused (open-path), and a file that is not a " +
        "project is refused with the project format's own code.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string",
                  description: "the .pcestudio file or the project folder, " +
                    "inside the working folder" }
        },
        required: ["path"],
        additionalProperties: false
      }
    },
    {
      name: "toy_run",
      description: "Run the loaded toy's main.lua for `frames` video frames " +
        "(0..frames-1) through the IL runtime, with an optional pad script, and " +
        "return the final state: registers, raster table shape, VRAM/CRAM/SAT " +
        "digests, log lines, PSG write count and per-channel sound activity " +
        "(notes started and the instrument each sounds with), so music() can be " +
        "seen without hearing it. The toy's asset files are imported into " +
        "VRAM/CRAM/SAT before init() (#117) and the song files are its " +
        "music(index) slots (#161). A run is fresh and deterministic; t is " +
        "f/60, not the clock.",
      inputSchema: {
        type: "object",
        properties: {
          frames: { type: "integer", minimum: 1, maximum: MAX_FRAMES,
                    default: DEFAULT_FRAMES,
                    description: "number of frames to run (0..frames-1)" },
          pad: {
            type: "array",
            description: "held-button intervals; pads are 1..5 and a button " +
              "name is " + PAD_FIELDS.join(", "),
            items: {
              type: "object",
              properties: {
                from: { type: "integer", minimum: 0, maximum: MAX_FRAMES - 1 },
                to: { type: "integer", minimum: 0, maximum: MAX_FRAMES - 1 },
                pad: { type: "integer", minimum: 1, maximum: PAD_COUNT, default: 1 },
                buttons: { type: "array", items: { type: "string", enum: PAD_FIELDS } }
              },
              required: ["from", "buttons"]
            }
          }
        },
        additionalProperties: false
      }
    },
    {
      name: "source_add",
      description: "Add art or a song to the toy (#153, #161): a picture — a " +
        "base64 PNG, or a hand-drawn pixel grid with its palette — becomes " +
        "tiles, sprites, a tilesheet or a palette through the Add Source " +
        "importer (renderer/pce-source.js importImage, #123) and is merged into " +
        "the toy's asset files: tiles.json replaced for a background picture, " +
        "sprites.json appended (new palette rows take the free ones), " +
        "palettes.json merged row by row. kind song takes a base64 .mid, which " +
        "becomes song.json (importMidi) and is what music(0) plays. Returns the " +
        "importer's stats, the toy's VRAM budget and any warnings; the panels' " +
        "own readers must accept the merged files or the toy is left alone. " +
        "Clears the run.",
      inputSchema: {
        type: "object",
        properties: {
          png: { type: "string",
                 description: "a base64 PNG (8-bit grey, RGB, RGBA or palette)" },
          mid: { type: "string",
                 description: "for kind song: a Standard MIDI File, base64" },
          grid: {
            type: "object",
            description: "the hand-drawn form: pixels are palette indices, " +
              "-1 is transparent",
            properties: {
              width: { type: "integer", minimum: 1, maximum: 256 },
              height: { type: "integer", minimum: 1, maximum: 240 },
              pixels: { type: "array", items: { type: "integer" } }
            },
            required: ["width", "height", "pixels"]
          },
          palette: {
            type: "array",
            description: "the grid's palette: a list of [r, g, b] (0..255)",
            items: { type: "array",
                     items: { type: "integer", minimum: 0, maximum: 255 } }
          },
          kind: { type: "string", enum: SOURCE_KINDS, default: "bg",
                  description: "what the source becomes; song takes mid" },
          name: { type: "string", description: "a label for the report" },
          dither: { type: "string", enum: sourceLib.DITHERS, default: "none" },
          alphaThreshold: { type: "integer", minimum: 0, maximum: 255,
                            default: 128 },
          size: { type: "array",
                  description: "the pattern size for kind sprites (16x16, " +
                    "32x16, 16x32, 32x32, 16x64 or 32x64)",
                  items: { type: "integer" } },
          maxPalettes: { type: "integer", minimum: 1, maximum: 16,
                         description: "cap the palette rows the importer may use" }
        },
        required: ["kind"],
        additionalProperties: false
      }
    },
    {
      name: "song_write",
      description: "Compose the toy's song (#161) with the SEQUENCER's built-in " +
        "instruments and write it as song.json, the file music(index) plays and " +
        "the studio's SEQUENCER edits. Two forms: notes (a step list " +
        "[{channel, step, note, length, instrument}], note a name like \"C4\" or " +
        "the engine note 0..83, instrument a built-in name or index) over a " +
        "grid of `steps` columns; or song, the SEQUENCER's own document. The " +
        "song is compiled by renderer/pce-seq.js before anything changes, so a " +
        "refused song leaves the toy alone. Clears the run.",
      inputSchema: {
        type: "object",
        properties: {
          notes: {
            type: "array",
            description: "the step list: one object per note",
            items: {
              type: "object",
              properties: {
                channel: { type: "integer", minimum: 0, maximum: 5, default: 0 },
                step: { type: "integer", minimum: 0 },
                note: { type: ["string", "integer"],
                        description: "a note name (C4) or the engine note 0..83" },
                length: { type: "integer", minimum: 1,
                          description: "in steps (default 1)" },
                instrument: { type: ["string", "integer"],
                              description: "a built-in name (lead, bass, bell, " +
                                "strings, kick, snare) or an index" }
              },
              required: ["step", "note"]
            }
          },
          song: {
            type: "object",
            description: "the SEQUENCER's document: {name, tempo, swing, key, " +
              "steps, patterns, order, instruments} (pce-seq.js VERSION)"
          },
          name: { type: "string", description: "the song's name" },
          tempo: { type: "integer", description: "BPM (pce-seq.js's range)" },
          steps: { type: "integer",
                   description: "columns in a pattern (pce-seq.js's range)" },
          swing: { type: "integer" },
          key: { type: "integer" }
        },
        additionalProperties: false
      }
    },
    {
      name: "frame_png",
      description: "Render one frame of the current run as a PNG (256x224 RGB) " +
        "through renderer/pce-sprites.js, the one model. The frame is " +
        "deterministic: asking for a frame past the run runs the missing " +
        "frames first. register_set overrides are applied to the picture " +
        "(view-only). Returns a text metadata block and an image content block.",
      inputSchema: {
        type: "object",
        properties: {
          frame: { type: "integer", minimum: 0, maximum: MAX_FRAMES - 1,
                   description: "frame index; 0 is the first frame" }
        },
        required: ["frame"],
        additionalProperties: false
      }
    },
    {
      name: "registers_get",
      description: "Read the VDC, VCE and PSG register catalogue with the " +
        "names and ranges from the modules' own tables (#61): VDC BXR/BYR/CR " +
        "are the settable toy registers and the other VDC names are " +
        "read-only; VCE CR/CTA/CTW; PSG R0..R9 (renderer/pce-psg.js). Live " +
        "values come from the current run and its overrides. Pass addr to " +
        "read one CRAM colour word (VCE CTW).",
      inputSchema: {
        type: "object",
        properties: {
          chip: { type: "string", enum: ["all", "vdc", "vce", "psg"], default: "all" },
          addr: { type: "integer", minimum: 0,
                  maximum: toyhost.CRAM_ENTRIES - 1,
                  description: "one CRAM address to read (0..511)" }
        },
        additionalProperties: false
      }
    },
    {
      name: "register_set",
      description: "Set one register as a reversible view override on the " +
        "current run. VDC BXR/BYR/CR take the host's ranges and refuse with " +
        "reg-range/reg-forbidden (renderer/pce-toyhost.js). VCE CTW writes one " +
        "9-bit colour at addr (pal-range). PSG R0..R9 records a write in the " +
        "toy's sound stream (renderer/pce-psg.js's widths). value:null clears " +
        "a VDC or VCE override and restores the toy's own value.",
      inputSchema: {
        type: "object",
        properties: {
          chip: { type: "string", enum: ["vdc", "vce", "psg"] },
          name: { type: "string", description: "BXR, BYR, CR, CTW or R0..R9" },
          value: { type: ["integer", "null"],
                   description: "the register value; null clears an override" },
          addr: { type: "integer", minimum: 0,
                  maximum: toyhost.CRAM_ENTRIES - 1,
                  description: "the CRAM address for VCE CTW" }
        },
        required: ["chip", "name"],
        additionalProperties: false
      }
    },
    {
      name: "validate",
      description: "Run #32's validator (renderer/pce-validate.js) on the " +
        "loaded toy and return its findings with file:line, the cycle budget, " +
        "sprites per line, VRAM, ROM estimate and the raster blank. ok:false " +
        "carries the first refusal's code (validate-frame-budget, " +
        "validate-sprite-line, validate-rom, validate-range, reg-range, ...).",
      inputSchema: {
        type: "object",
        properties: {
          frames: { type: "integer", minimum: 1, maximum: 60, default: 8,
                    description: "frames the validator runs the toy for" }
        },
        additionalProperties: false
      }
    },
    {
      name: "rom_check",
      description: "What the exported ROM can and cannot run (#193): run BOTH " +
        "cartridge front ends over the loaded main.lua — the C route " +
        "(renderer/pce-cgen.js, the page's Export) and the bytecode route " +
        "(renderer/pce-ilbc.js, the interpreter image every .pce carries) — " +
        "without building anything. Returns every finding at once as " +
        "{code, line, message}, plus the compilers' own carried and refused " +
        "feature lists.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false
      }
    },
    {
      name: "export_pce",
      description: "Export the loaded toy to a .pce through #100's browser " +
        "route (no compiler): IL -> pce-ilbc bytecode -> pce-rom.buildToyRom " +
        "over the committed renderer/ilvm.bin. The validator runs first and a " +
        "toy it fails is refused by code. Default output is " +
        "$TMPDIR/pce-mcp/<name>.pce; pass out for another path. The llvm-mos " +
        "route (tools/toyc) exists where llvm-mos is installed but is not " +
        "called here.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "output base name (default toy)" },
          out: { type: "string", description: "the .pce path to write" }
        },
        additionalProperties: false
      }
    },
    {
      name: "docs",
      description: "Read #61's toy author's reference, generated from the " +
        "modules' own tables. No topic lists the chapters; a topic id (the-toy, " +
        "registers, palettes, sprites, raster, pads, timer, passwords, sound, " +
        "budgets, refusals) returns that chapter as markdown. Use it before " +
        "guessing a call name or limit.",
      inputSchema: {
        type: "object",
        properties: {
          topic: { type: "string",
                   description: "a chapter id or title; omit for the chapter list" }
        },
        additionalProperties: false
      }
    }
  ];

  /* ---- the session ------------------------------------------------------- */

  function createSession(host) {
    const session = {
      files: null,         /* [{name, source}] as written */
      source: null,        /* main.lua's text */
      songs: [],           /* the compiled songs the toy's files carry (#161) */
      project: null,       /* {title, author, created, modified} once a
                            * project was opened or saved (#163); toy_write
                            * edits the toy inside it, so it survives one */
      runtime: null,       /* renderer/pce-il.js runtime after toy_run */
      frames: [],          /* per frame: {state, raster} — the run is canonical */
      pad: [],             /* intervals {from, to, pad, buttons} */
      overrides: {},       /* VDC name -> value (BXR/BYR/CR) */
      cramOverrides: new Map(),  /* CRAM address -> 9-bit word */
      run: null            /* the toy_run summary */
    };

    function resetToy() {
      session.files = null;
      session.source = null;
      session.songs = [];
      session.runtime = null;
      session.frames = [];
      session.pad = [];
      session.overrides = {};
      session.cramOverrides = new Map();
      session.run = null;
    }

    function resetRun() {
      session.runtime = null;
      session.frames = [];
      session.overrides = {};
      session.cramOverrides = new Map();
      session.run = null;
    }

    function requireToy() {
      if (!session.source) {
        refuse("no-toy", "no toy is loaded; call toy_write first (main.lua is " +
               "required)");
      }
    }
    function requireRun() {
      requireToy();
      if (!session.run || !session.frames.length) {
        refuse("no-run", "no frames have been run; call toy_run before reading " +
               "registers or rendering a frame");
      }
    }

    function applyPad(f) {
      const held = {};
      for (let n = 1; n <= PAD_COUNT; n++) held[n] = {};
      for (const iv of session.pad) {
        if (f < iv.from || f > iv.to) continue;
        const obj = Object.assign({}, held[iv.pad]);
        for (const b of iv.buttons) obj[b] = true;
        held[iv.pad] = obj;
      }
      for (let n = 1; n <= PAD_COUNT; n++) session.runtime.setPad(n, held[n]);
    }

    /* ---- the run and the renderer --------------------------------------- */

    function runFresh(frames, pad) {
      resetRun();
      session.pad = pad;
      const rt = il.create(session.source, { chunkName: MAIN, files: session.files,
                                             songs: session.songs });
      rt.load();
      session.runtime = rt;
      for (let f = 0; f < frames; f++) {
        applyPad(f);
        const img = rt.frame(f);           /* the IL runtime's one render */
        session.frames.push({ state: img.state, raster: img.raster });
      }
      const last = session.frames[session.frames.length - 1];
      session.run = {
        frames: frames,
        frame: frames - 1,
        state: last.state,
        raster: last.raster
      };
      return stateReport(rt, last);
    }

    function advanceTo(frame) {
      requireRun();
      while (session.frames.length <= frame) {
        const f = session.frames.length;
        if (f >= MAX_FRAMES) {
          refuse("frame-range", "frame must be 0.." + (MAX_FRAMES - 1));
        }
        applyPad(f);
        let img;
        try {
          img = session.runtime.frame(f);
        } catch (e) {
          refuse(errorCode(e), errorMessage(e));
        }
        session.frames.push({ state: img.state, raster: img.raster });
      }
      const last = session.frames[session.frames.length - 1];
      session.run.frames = session.frames.length;
      session.run.frame = session.frames.length - 1;
      session.run.state = last.state;
      session.run.raster = last.raster;
      return session.frames[frame];
    }

    function renderOptions(rec) {
      const st = rec.state;
      const regs = {
        BXR: st.regs.BXR, BYR: st.regs.BYR, MWR: st.regs.MWR, CR: st.regs.CR,
        RCRCount: 0, scanline: 18
      };
      for (const k of ["BXR", "BYR", "CR"]) {
        if (Object.prototype.hasOwnProperty.call(session.overrides, k)) {
          regs[k] = session.overrides[k];
        }
      }
      const cram = Uint8Array.from(st.cram);
      for (const pair of session.cramOverrides) {
        const addr = pair[0], word = pair[1];
        cram[addr * 2] = word & 0xFF;
        cram[addr * 2 + 1] = (word >> 8) & 0xFF;
      }
      const opts = {
        vram: st.vram, cram: cram, sat: st.sat, regs: regs,
        width: toyhost.WIDTH, height: toyhost.HEIGHT
      };
      if (rec.raster) opts.raster = rec.raster;
      return opts;
    }

    function renderFrame(frame) {
      const rec = advanceTo(frame);
      const img = sprites.renderFrame(renderOptions(rec));
      return { img: img, rec: rec };
    }

    /* Per-channel sound activity (#161): an agent cannot hear the PSG, so the
     * run says what each voice did — the notes pce-song.js started on it (its
     * own player.notes, one entry per note row it applied), the instrument each
     * one sounds with (the compiled song's instrument list), and whether an SFX
     * owns the channel.  This is the engine's own record, not a second model. */
    function soundReport(rt) {
      const sound = (rt && rt.sound) || {};
      const events = sound.events || [];
      const songs = sound.songs || [];
      const index = sound.index == null ? null : sound.index;
      const song = index == null ? null : songs[index];
      const played = (sound.player && sound.player.notes) || [];
      const channels = [];
      for (let ch = 0; ch < toyhost.SOUND_CHANNELS; ch++) {
        const mine = played.filter(function (n) { return n.channel === ch; });
        const last = mine.length ? mine[mine.length - 1] : null;
        const names = [];
        for (const n of mine) {
          const ins = song && song.instruments ? song.instruments[n.instrument] : null;
          if (ins && names.indexOf(ins.name) < 0) names.push(ins.name);
        }
        const ins = last && song && song.instruments
          ? song.instruments[last.instrument] : null;
        const sfx = sound.sfx && sound.sfx[ch];
        channels.push({
          channel: ch,
          notes: mine.length,
          instrument: ins ? ins.name : null,
          instruments: names,
          last_note: last ? { frame: last.frame, note: last.note } : null,
          sfx: sfx && (sfx.owned || sfx.active)
            ? { freq: sfx.freq, volume: sfx.volume, frames: sfx.frames }
            : null
        });
      }
      return {
        writes: events.length,
        songs: songs.length,
        music: index == null ? null : {
          index: index,
          name: song ? (song.songName || "song") : null,
          playing: !!sound.player,
          notes: played.length
        },
        channels: channels
      };
    }

    function stateReport(rt, last) {
      const st = last.state;
      return {
        ok: true,
        frames: session.frames.length,
        frame: session.frames.length - 1,
        state: {
          width: toyhost.WIDTH,
          height: toyhost.HEIGHT,
          regs: {
            BXR: st.regs.BXR, BYR: st.regs.BYR, MWR: st.regs.MWR,
            CR: st.regs.CR
          },
          raster: last.raster
            ? { entries: last.raster.entries.length, base: last.raster.base }
            : null,
          vram_words: toyhost.VRAM_WORDS,
          cram_entries: toyhost.CRAM_ENTRIES,
          sat_entries: toyhost.SAT_ENTRIES,
          vram_sha256: sha256Hex(st.vram),
          cram_sha256: sha256Hex(st.cram),
          sat_sha256: sha256Hex(st.sat)
        },
        assets: rt.assets || null,
        log: (rt.log || []).slice(),
        sound: soundReport(rt),
        sound_writes: rt.sound && rt.sound.events ? rt.sound.events.length : 0,
        overrides: Object.assign({}, session.overrides)
      };
    }

    /* ---- registers: the catalogue is the modules' own tables ------------ */

    function vdcRows() {
      const rows = [];
      for (const def of panels.VDC_REGISTERS) {
        if (def.name === "-") continue;
        const settable = Object.prototype.hasOwnProperty.call(toyhost.ALLOWED_REGS, def.name);
        const hostDef = toyhost.REGISTERS.filter(function (r) {
          return r.name === def.name;
        })[0];
        let value = null;
        if (settable && session.frames.length) {
          const st = session.frames[session.frames.length - 1].state;
          value = Object.prototype.hasOwnProperty.call(session.overrides, def.name)
            ? session.overrides[def.name] : st.regs[def.name];
        }
        rows.push({
          chip: "vdc",
          number: "R" + def.number.toString(16).toUpperCase().padStart(2, "0"),
          name: def.name,
          title: def.title,
          range: hostDef ? [0, hostDef.max] : null,
          bits: hostDef ? hostDef.bits : null,
          manual: hostDef ? hostDef.manual : null,
          settable: !!settable,
          value: value,
          note: settable ? undefined :
            "the ROM configures it; a toy may not write it (reg-forbidden)"
        });
      }
      return rows;
    }

    function cramWord(bytes, addr) {
      return bytes[addr * 2] | (bytes[addr * 2 + 1] << 8);
    }

    function vceRows(addr) {
      const ct = session.frames.length
        ? session.frames[session.frames.length - 1].state.cram : null;
      let word = null;
      if (addr != null && ct) {
        word = session.cramOverrides.has(addr)
          ? session.cramOverrides.get(addr) : cramWord(ct, addr);
      }
      return [
        { chip: "vce", name: "CR", address: "$0400", range: [0, 0xFF],
          bits: 8, settable: false, value: null,
          note: "the display control (dot clock); the ROM sets it, the toy " +
                "model does not carry it. Bits 2-7 have no manual page " +
                "(docs/MANUALS.md §4)" },
        { chip: "vce", name: "CTA", address: "$0402", range: [0, toyhost.CRAM_ENTRIES - 1],
          bits: 9, settable: false, value: null,
          note: "the address side of a colour write; write a colour with " +
                "register_set CTW and addr (the toy's pal(addr, word))" },
        { chip: "vce", name: "CTW", address: "$0404",
          range: [0, toyhost.CRAM_WORD_MAX], bits: 9, settable: true,
          addr_required: true, value: word,
          note: "one 9-bit colour at addr: G bits 8-6, R 5-3, B 2-0 " +
                "(docs/MANUALS.md §4); refused by pal-range" }
      ];
    }

    function psgRows() {
      const events = session.runtime && session.runtime.sound
        ? session.runtime.sound.events : [];
      const last = {};
      for (const e of events) last[e.reg] = e.value;
      return psg.REGISTERS.map(function (r) {
        const range = PSG_RANGES[r.n];
        return {
          chip: "psg",
          name: "R" + r.n,
          address: "$08" + ("0" + r.n.toString(16).toUpperCase()).slice(-2),
          title: r.name,
          range: range,
          bits: range[1] === 0xFF ? 8 : Math.ceil(Math.log2(range[1] + 1)),
          manual: r.manual,
          settable: true,
          value: Object.prototype.hasOwnProperty.call(last, r.n) ? last[r.n] : null
        };
      });
    }

    function registerSet(args) {
      const chip = args.chip;
      const name = args.name;
      if (typeof name !== "string") refuse("reg-name", "name must be a string");
      if (chip === "vdc") {
        if (!Object.prototype.hasOwnProperty.call(toyhost.ALLOWED_REGS, name)) {
          refuse("reg-forbidden", "a toy may not set " + name +
                 "; it may set BXR, BYR and CR (the toy reference, #61)");
        }
        const max = toyhost.ALLOWED_REGS[name];
        const cleared = args.value == null;
        const value = cleared ? null : intIn(args.value, name, 0, max, "reg-range");
        const st = session.frames[session.frames.length - 1].state;
        const old = Object.prototype.hasOwnProperty.call(session.overrides, name)
          ? session.overrides[name] : st.regs[name];
        if (cleared) delete session.overrides[name];
        else session.overrides[name] = value;
        return {
          chip: "vdc", name: name, old: old,
          value: cleared ? st.regs[name] : value,
          cleared: cleared, override: !cleared,
          note: cleared
            ? "the toy's own value is restored"
            : "a view override for frame_png; it does not change the run"
        };
      }
      if (chip === "vce") {
        if (name !== "CTW") {
          refuse("reg-forbidden", name + " is not a register a toy writes; write " +
                 "a colour with CTW and addr (the toy's pal(addr, word))");
        }
        const addr = intIn(args.addr, "the colour-table address", 0,
                           toyhost.CRAM_ENTRIES - 1, "pal-range");
        const st = session.frames[session.frames.length - 1].state;
        const old = session.cramOverrides.has(addr)
          ? session.cramOverrides.get(addr) : cramWord(st.cram, addr);
        const cleared = args.value == null;
        const value = cleared ? null
          : intIn(args.value, "the colour word", 0, toyhost.CRAM_WORD_MAX,
                  "pal-range");
        if (cleared) session.cramOverrides.delete(addr);
        else session.cramOverrides.set(addr, value);
        return {
          chip: "vce", name: "CTW", addr: addr, old: old,
          value: cleared ? old : value, cleared: cleared, override: !cleared,
          note: cleared
            ? "the frame's own colour is restored"
            : "a view override for frame_png (one CRAM entry); it does not " +
              "change the run"
        };
      }
      if (chip === "psg") {
        const m = /^R([0-9])$/.exec(name);
        if (!m) {
          refuse("reg-forbidden", name + " is not a PSG register; they are R0..R9 " +
                 "(renderer/pce-psg.js, the #61 sound table)");
        }
        const n = Number(m[1]);
        if (args.value == null) {
          refuse("reg-forbidden", "a PSG write is recorded in the toy's sound " +
                 "stream and cannot be cleared; write the register's old value " +
                 "to undo it");
        }
        const range = PSG_RANGES[n];
        const value = intIn(args.value, name, range[0], range[1], "reg-range");
        const events = session.runtime.sound.events;
        let old = null;
        for (let i = events.length - 1; i >= 0; i--) {
          if (events[i].reg === n) { old = events[i].value; break; }
        }
        events.push({
          f: session.runtime.sound.frame,
          t: session.runtime.sound.col * toyhost.SOUND_CYCLE_STEP,
          reg: n, value: value
        });
        session.runtime.sound.col++;
        return {
          chip: "psg", name: name, old: old, value: value, recorded: true,
          note: "recorded into the toy's PSG write stream at the current frame " +
                "(renderer/pce-psg.js renders it); frame_png is picture-only, " +
                "so the picture does not change"
        };
      }
      refuse("reg-chip", "chip must be vdc, vce or psg, got " + JSON.stringify(chip));
    }

    /* ---- the tools ------------------------------------------------------- */

    function toolToyWrite(args) {
      const files = normaliseFiles(args.files);
      const main = files.filter(function (f) { return f.name === MAIN; })[0];
      let program;
      try {
        program = compileToy(main.source);
      } catch (e) {
        /* a refused write leaves the toy that was already loaded alone */
        refuse(errorCode(e), errorMessage(e));
      }
      /* The song files are compiled now too (#161), so a song the player cannot
       * take is refused here, before the loaded toy is replaced. */
      const songs = toySongs(files);
      resetToy();
      session.files = files;
      session.source = main.source;
      session.songs = songs;
      return {
        ok: true,
        files: files.map(function (f) { return f.name; }),
        main_lua_bytes: utf8Length(session.source),
        assets: files.filter(function (f) { return f.name !== MAIN; })
                      .map(function (f) { return f.name; }),
        songs: songSummary(songs),
        language: program.lang,
        hooks: program.hooks,
        functions: program.functions.length,
        note: "main.lua is compiled now; the asset files ride along and toy_run " +
              "imports them into VRAM/CRAM/SAT before init() (#117, #153), and " +
              "the song files are the music(index) slots (#161) — so the files " +
              "the panels edit are the art and the music the toy boots with"
      };
    }

    /* ---- toy_save (#160): the toy as the studio's own file ----------------
     * The whole session — main.lua, every asset file, sources.json's named
     * sources, the songs — written as ONE pce.studio/1 envelope, built by
     * renderer/pce-source.js's envelopeText(): the same function the studio's
     * Save (renderer/studio.html saveToyFile -> toyEnvelope) uses, so the bytes
     * are the studio's bytes.  The person then opens it with Open… → From file
     * (or drops it on the page) and has the game WITH its art; without this the
     * only thing an agent's session could hand over was main.lua, which leaves
     * every tile and sprite behind.
     *
     * WHERE IT MAY WRITE is the host's rule, not this module's: the Node
     * adapter writes inside the folder the server was started in (or
     * PCE_MCP_WORKDIR when it names one) and refuses a path outside it
     * (save-path); a browser adapter (#167) downloads instead. */
    async function toolToySave(args) {
      requireToy();
      if (typeof args.path !== "string" || !args.path.trim()) {
        refuse("save-path", "path is the file to write, e.g. \"my-game.pce.json\"");
      }
      /* The host owns the path rules (working folder, extension); the
       * envelope is built with the RESOLVED name's title, the way the old
       * server built it, so the bytes are the same bytes. */
      const resolved = await host.savePath(args.path);
      const title = args.title == null
        ? resolved.name.replace(/\.(pce\.json|pce\.studio)$/i, "")
        : String(args.title);
      const description = args.description == null ? "" : String(args.description);
      const text = sourceLib.envelopeText(title, description, session.files);
      const wrote = await host.saveEnvelope({
        path: resolved.path, title: title, description: description, text: text
      });
      return {
        ok: true,
        version: "pce.studio/1",
        path: wrote.path,
        name: wrote.name,
        title: title,
        description: description,
        bytes: utf8Length(text),
        sha256: sha256Hex(utf8Encode(text)),
        files: session.files.map(function (f) { return f.name; }),
        note: "one pce.studio/1 envelope — the studio's own Save format, built " +
              "by renderer/pce-source.js envelopeText() — holding every file " +
              "and source; in the studio, Open… → From file (or drop it on the " +
              "page) plays this toy with its art"
      };
    }

    /* ---- project_save / project_open (#163): a game over many sessions ---
     * The studio's .pcestudio (#162) is the file a later session resumes
     * from; project_save writes it (or, for Claude Code, the SAME layout
     * unpacked into a folder, so git holds the history), and project_open
     * reads either back into the session and answers with NOTES.md's text
     * before anything else.  Both are the project module's bytes
     * (renderer/pce-project.js) — there is no second format.  The session
     * has no art/ originals and no named versions (source_add keeps the
     * imported files, not the picture it read), so those two lists are
     * empty here and the studio's own Save project fills them.
     *
     * WHERE THE FILES GO is the host's rule: the Node adapter stays inside
     * the folder the server was started in (save-path / open-path), and a
     * browser tab has no folder to read, so it refuses project_open
     * (project-host). */

    function hasNotes(files) {
      for (const f of files) if (f.name === NOTES) return true;
      return false;
    }

    function withNotes(files, text) {
      const out = [];
      let put = false;
      for (const f of files) {
        if (f.name === NOTES) { out.push({ name: NOTES, source: text }); put = true; }
        else out.push({ name: f.name, source: f.source });
      }
      if (!put) out.push({ name: NOTES, source: text });
      return out;
    }

    function hostNow() {
      return typeof host.now === "function" ? String(host.now() || "") : "";
    }

    /* NOTES.md's own "saved <date>" line is a date, not a timestamp. */
    function dateOf(iso) {
      const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(iso || ""));
      return m ? m[1] : "";
    }

    async function toolProjectSave(args) {
      requireToy();
      if (!projectLib) {
        refuse("project-host", "renderer/pce-project.js did not load, so the " +
               "project format is missing");
      }
      if (typeof args.path !== "string" || !args.path.trim()) {
        refuse("save-path", "path is the project to write: " +
               "\"my-game.pcestudio\" for one file, or \"my-game/\" for the " +
               "same layout unpacked into a folder");
      }
      if (typeof host.projectPath !== "function" ||
          typeof host.writeProject !== "function") {
        refuse("project-host", "this host cannot write a project; the MCP " +
               "server can, and the studio tab saves with its own Project…");
      }
      /* The host owns the path rules: a trailing / or an existing folder is
       * the unpacked route; any other name is one .pcestudio. */
      const resolved = await host.projectPath(args.path);
      const held = session.project || {};
      const title = args.title != null ? String(args.title)
        : (held.title || projectLib.titleFromName(resolved.name || resolved.path));
      const now = hostNow();

      /* The resume note is part of the save, not an afterthought: the text the
       * caller passed, else the NOTES.md the toy already carries, else the
       * studio's template (the same one its own Save project adds). */
      let files = session.files;
      if (typeof args.notes === "string") {
        files = withNotes(files, args.notes);
      } else if (!hasNotes(files)) {
        files = withNotes(files, projectLib.notesTemplate({
          title: title, date: dateOf(held.created || now)
        }));
      }

      const project = {
        title: title,
        author: held.author || "",
        created: held.created || now,
        modified: now,
        files: files,
        art: [],
        versions: []
      };
      let entries = null, zipBytes = null;
      try {
        entries = projectLib.entries(project);
        if (!resolved.folder) zipBytes = projectLib.build(project);
      } catch (e) {
        refuse(errorCode(e), errorMessage(e));
      }
      const wrote = await host.writeProject({
        path: resolved.path, name: resolved.name,
        folder: !!resolved.folder, entries: entries, zip: zipBytes
      });
      /* The save happened: the note is the session's now, so a following
       * toy_save carries it too, and the next project_save keeps the title,
       * the author and the original created date. */
      session.files = files;
      session.project = { title: title, author: project.author,
                          created: project.created, modified: now };
      return {
        ok: true,
        format: projectLib.FORMAT,
        path: wrote.path,
        folder: !!resolved.folder,
        title: title,
        files: files.map(function (f) { return f.name; }),
        notes: hasNotes(files) ? NOTES : null,
        created: project.created,
        modified: now,
        bytes: zipBytes ? zipBytes.length : null,
        entries: entries.length,
        note: resolved.folder
          ? "the unpacked project folder — project.json, main.lua, the asset " +
            "files and NOTES.md; commit it and git holds the history; " +
            "project_open {path} resumes it"
          : "one .pcestudio (the studio's project format): the person opens " +
            "it with Project… → Open (or drops it on the page), and a later " +
            "session resumes it with project_open"
      };
    }

    async function toolProjectOpen(args) {
      if (!projectLib) {
        refuse("project-host", "renderer/pce-project.js did not load, so the " +
               "project format is missing");
      }
      if (typeof args.path !== "string" || !args.path.trim()) {
        refuse("open-path", "path is the .pcestudio file or the project " +
               "folder to open");
      }
      if (typeof host.readProject !== "function") {
        refuse("project-host", "this host cannot open a project by path; the " +
               "studio tab opens one with Project… → Open, and Claude Code's " +
               "MCP server opens one with project_open");
      }
      const read = await host.readProject(args.path);
      let proj;
      try {
        proj = read.folder ? projectLib.parseEntries(read.entries || [])
                           : projectLib.parseBytes(read.bytes);
      } catch (e) {
        /* project-json / project-format / project-main / project-name — the
         * format's own refusals, before the session is touched */
        refuse(errorCode(e), errorMessage(e));
      }
      const main = proj.files.filter(function (f) { return f.name === MAIN; })[0];
      if (!main) refuse("project-main", "the project has no main.lua");
      /* same gate as toy_write: a project whose code does not compile, or
       * whose song.json the sequencer refuses, leaves the session alone */
      let program;
      try {
        program = compileToy(main.source);
      } catch (e) {
        refuse(errorCode(e), errorMessage(e));
      }
      const songs = toySongs(proj.files);
      const files = proj.files.map(function (f) {
        return { name: f.name, source: f.source };
      });
      resetToy();
      session.files = files;
      session.source = main.source;
      session.songs = songs;
      const title = proj.title || projectLib.titleFromName(read.path || args.path);
      session.project = { title: title, author: proj.author,
                          created: proj.created, modified: proj.modified };

      /* NOTES.md's text is the FIRST content block: the resuming session
       * reads what the last one learned before it reads anything else. */
      const first = proj.notes == null
        ? "This project has no NOTES.md yet. Before you change anything, " +
          "write one — goal, what works, what does not, the decisions, the " +
          "next step — and pass it to project_save as notes."
        : String(proj.notes);
      return {
        content: [
          { type: "text", text: first },
          { type: "text", text: JSON.stringify({
            ok: true,
            format: proj.format,
            path: read.path,
            folder: !!read.folder,
            title: title,
            notes: proj.notes != null,
            files: files.map(function (f) { return f.name; }),
            songs: songSummary(songs),
            language: program.lang,
            hooks: program.hooks,
            functions: program.functions.length,
            created: proj.created,
            modified: proj.modified,
            note: "the project is loaded: toy_run plays it, toy_write edits " +
                  "the toy in it, and project_save writes it back (pass the " +
                  "updated NOTES.md as notes); the first text block of this " +
                  "reply is NOTES.md"
          }) }
        ]
      };
    }

    function toolToyRun(args) {
      requireToy();
      const frames = args.frames == null ? DEFAULT_FRAMES
        : intIn(args.frames, "frames", 1, MAX_FRAMES, "frame-range");
      const pad = normalisePad(args.pad);
      try {
        return runFresh(frames, pad);
      } catch (e) {
        throw new Refusal(errorCode(e), errorMessage(e));
      }
    }

    /* ---- source_add (#153): a picture merged into the toy's asset files --- *
     * The Add Source dialog's importer (renderer/pce-source.js importImage,
     * #123) runs on the picture, and its files are MERGED into the toy's set:
     *   - tiles.json is replaced for a background picture or tilesheet (one BAT
     *     map per toy);
     *   - sprites.json appends: patterns are reindexed past the ones already
     *     there, SAT entries follow the existing sprites, and the picture's
     *     palette rows take the FREE rows so the sprites already placed keep
     *     their colours (source-palettes when the 16 rows are full,
     *     source-sat when the merge would place more than 64 sprites);
     *   - palettes.json merges row by row: a row the picture left all-zero
     *     keeps the old row, and the backdrop follows the replaced picture.
     * The merge runs on a COPY and is committed only after the panels' own
     * readers accept the whole set — pce-sat.js's pictureFromFiles and
     * pce-editor.js's toPicture, the same path toy_run imports with — so a
     * refused add leaves the toy alone.  An accepted add clears the run: the
     * files changed, the frames are stale. */

    /* A .mid through importMidi (#123) is the toy's song.json, and the toy's one
     * song: music(0) plays it.  The merge and the compile happen before the
     * session changes, so a .mid the importer or the player refuses leaves the
     * toy as it was. */
    function songSourceAdd(args) {
      if (args.mid == null) {
        refuse("source-song", "kind song needs mid: the .mid file's bytes in " +
               "base64 (a Standard MIDI File)");
      }
      const bytes = base64Decode(String(args.mid));
      if (!bytes.length) refuse("source-song", "mid decodes to no bytes");
      let result;
      try {
        result = sourceLib.importMidi(bytes,
          { name: args.name == null ? undefined : String(args.name) });
      } catch (e) {
        refuse(errorCode(e), errorMessage(e));
      }
      const byName = {};
      for (const f of session.files) byName[f.name] = f.source;
      byName["song.json"] = result.files["song.json"];
      const merged = Object.keys(byName).map(function (name) {
        return { name: name, source: byName[name] };
      });
      const songs = toySongs(merged);
      session.files = merged;
      session.songs = songs;
      resetRun();                  /* the files changed: the frames are stale */
      let index = -1;
      for (let i = 0; i < songs.length; i++)
        if (songs[i].songName === result.name) { index = i; break; }
      return {
        ok: true,
        kind: "song",
        name: result.name,
        notes: result.stats.notes,
        stats: result.stats,
        files: session.files.map(function (f) { return f.name; }),
        songs: songSummary(songs),
        music_index: index,
        song: JSON.parse(result.files["song.json"]),
        warnings: result.warnings,
        note: "the .mid became song.json through the Add Source importer " +
              "(renderer/pce-source.js importMidi, #123); music(" + index +
              ") plays it, and the SEQUENCER opens the same file. The previous " +
              "run was cleared — call toy_run to hear it in the sound report"
      };
    }

    async function toolSourceAdd(args) {
      requireToy();
      const kind = args.kind;
      if (typeof kind !== "string" || SOURCE_KINDS.indexOf(kind) < 0) {
        refuse("source-kind", "kind must be " + SOURCE_KINDS.join(", "));
      }
      if (kind === "song") return songSourceAdd(args);
      if ((args.png == null) === (args.grid == null)) {
        refuse("source-picture", "pass one picture: png (base64) or grid " +
               "{width, height, pixels} with its palette");
      }
      const name = args.name == null ? kind : String(args.name);
      try {
        const img = args.png != null ? await pngImage(args, host) : gridImage(args);
        const result = sourceLib.importImage(img, {
          kind: kind, name: name,
          dither: args.dither, alphaThreshold: args.alphaThreshold,
          size: args.size, maxPalettes: args.maxPalettes
        });
        const merged = mergeFiles(result, session.files);
        const budget = pictureBudget(merged);
        session.files = merged;
        resetRun();                /* the files changed: the frames are stale */
        const warnings = result.warnings.slice();
        if (budget.sprites >= toyhost.SAT_ENTRIES)
          warnings.push("the toy now places all " + toyhost.SAT_ENTRIES +
                        " sprites the SAT holds");
        return {
          ok: true,
          kind: result.kind,
          name: result.name,
          size: { width: result.width, height: result.height },
          stats: {
            tiles: result.stats.tiles,
            max_tiles: result.stats.maxTiles,
            palettes: result.stats.palettes,
            max_palettes: result.stats.maxPalettes,
            colours: result.stats.colours,
            max_tile_colours: result.stats.maxTileColours,
            dither: result.stats.dither
          },
          files: session.files.map(function (f) { return f.name; }),
          budget: {
            tiles: budget.tiles,
            patterns: budget.patterns,
            sprites: budget.sprites,
            vram_words: budget.vram.used,
            vram_total: budget.vram.total,
            vram: budget.vram,
            cram_entries: toyhost.CRAM_ENTRIES,
            sat_entries: toyhost.SAT_ENTRIES
          },
          warnings: warnings,
          note: "imported with the Add Source importer (renderer/pce-source.js, " +
                "#123) and merged into the toy's asset files; the panels' own " +
                "readers accepted the merged set; the previous run was cleared — " +
                "call toy_run to see the picture"
        };
      } catch (e) {
        if (e instanceof Refusal) throw e;
        refuse(errorCode(e), errorMessage(e));
      }
    }

    function toolSongWrite(args) {
      requireToy();
      const byNotes = args.notes != null;
      const bySong = args.song != null;
      if (byNotes === bySong) {
        refuse("song-input", "pass one: notes (a step list) or song (the " +
               "SEQUENCER's document)");
      }
      let song, compiled;
      try {
        song = byNotes ? songFromNotes(args) : songFromDocument(args);
        compiled = seqLib.compile(song);       /* the player's module, or its code */
      } catch (e) {
        if (e instanceof Refusal) throw e;
        refuse(errorCode(e), errorMessage(e));
      }
      const text = seqLib.toJSON(song);
      const byName = {};
      for (const f of session.files) byName[f.name] = f.source;
      byName["song.json"] = text;
      const merged = Object.keys(byName).map(function (name) {
        return { name: name, source: byName[name] };
      });
      const songs = toySongs(merged);
      session.files = merged;
      session.songs = songs;
      resetRun();
      const timing = seqLib.timing(song);
      let placed = 0;
      for (let p = 0; p < song.patterns.length; p++) placed += seqLib.noteCount(song, p);
      let index = -1;
      for (let i = 0; i < songs.length; i++)
        if (songs[i].songName === song.name) { index = i; break; }
      const warnings = placed ? [] : ["the song has no notes: music(" + index +
                                      ") plays silence"];
      return {
        ok: true,
        file: "song.json",
        name: song.name,
        tempo: song.tempo,
        swing: song.swing,
        key: song.key,
        steps: song.steps,
        patterns: song.patterns.length,
        order: song.order.slice(),
        notes_placed: placed,
        instruments: song.instruments.map(function (i) { return i.name; }),
        frames: timing.framesPerOrder,
        seconds: Number(timing.seconds.toFixed(2)),
        files: session.files.map(function (f) { return f.name; }),
        songs: songSummary(songs),
        music_index: index,
        song: JSON.parse(text),
        warnings: warnings,
        note: "written as song.json (the SEQUENCER's own document) and compiled " +
              "by renderer/pce-seq.js for pce-song.js: music(" + index + ") " +
              "plays it; toy_run's sound report says what each channel did"
      };
    }

    async function toolFramePng(args) {
      requireRun();
      const frame = intIn(args.frame, "frame", 0, MAX_FRAMES - 1, "frame-range");
      let r;
      try {
        r = renderFrame(frame);
      } catch (e) {
        if (e instanceof Refusal) throw e;
        throw new Refusal(errorCode(e), errorMessage(e));
      }
      const png = await encodePng(r.img.pixels, r.img.width, r.img.height, host);
      const meta = {
        ok: true,
        frame: frame,
        width: r.img.width,
        height: r.img.height,
        bytes: png.length,
        sha256: sha256Hex(png),
        regs: Object.assign({}, r.rec.state.regs, session.overrides),
        overrides: Object.assign({}, session.overrides),
        raster_entries: r.rec.raster ? r.rec.raster.entries.length : 0
      };
      return {
        content: [
          { type: "text", text: JSON.stringify(meta) },
          { type: "image", data: base64Encode(png), mimeType: "image/png" }
        ]
      };
    }

    function toolRegistersGet(args) {
      const chip = args.chip || "all";
      if (["all", "vdc", "vce", "psg"].indexOf(chip) < 0) {
        refuse("reg-chip", "chip must be all, vdc, vce or psg, got " +
               JSON.stringify(chip));
      }
      let addr = null;
      if (args.addr != null) {
        addr = intIn(args.addr, "addr", 0, toyhost.CRAM_ENTRIES - 1, "pal-range");
      }
      const out = {
        ok: true,
        toy: session.source ? {
          files: session.files.map(function (f) { return f.name; }),
          frames: session.frames.length,
          frame: session.frames.length ? session.frames.length - 1 : null
        } : null,
        overrides: Object.assign({}, session.overrides),
        cram_overrides: Array.from(session.cramOverrides.entries()).map(function (p) {
          return { addr: p[0], word: p[1] };
        })
      };
      if (chip === "all" || chip === "vdc") out.vdc = vdcRows();
      if (chip === "all" || chip === "vce") out.vce = vceRows(addr);
      if (chip === "all" || chip === "psg") out.psg = psgRows();
      out.note = "names and ranges come from the modules' own tables " +
                 "(renderer/pce-toyhost.js, renderer/pce-psg.js, " +
                 "renderer/pce-panels.js); a refused write carries its code";
      return out;
    }

    function toolRegisterSet(args) {
      requireRun();
      let out;
      try {
        out = registerSet(args);
      } catch (e) {
        if (e instanceof Refusal) throw e;
        throw new Refusal(errorCode(e), errorMessage(e));
      }
      out.ok = true;
      return out;
    }

    function toolValidate(args) {
      requireToy();
      let frames = 8;
      if (args.frames != null) {
        frames = intIn(args.frames, "frames", 1, 60, "frame-range");
      }
      let report;
      try {
        /* the validator runs the toy, so it needs the songs the toy was written
         * for — music(0) without them is a real music-range refusal (#161) */
        report = validateLib.validate(session.source,
                                      { chunkName: MAIN, frames: frames,
                                        songs: session.songs });
      } catch (e) {
        refuse(errorCode(e), errorMessage(e));
      }
      const problems = (report.problems || []).map(normaliseFinding);
      return {
        ok: report.ok,
        code: report.code,
        problems: problems,
        budgets: report.budgets,
        hooks: report.hooks,
        functions: report.functions,
        note: "renderer/pce-validate.js (#32); a finding whose source line the " +
              "validator cannot place has line:null and still names file:main.lua"
      };
    }

    function toolRomCheck(args) {
      requireToy();
      try {
        const report = romcheck.check(session.source, { chunkName: MAIN });
        return {
          ok: report.ok,
          findings: report.findings,
          carried: report.carried,
          refused: report.refused,
          routes: report.routes,
          note: "renderer/pce-romcheck.js (#193): the C route and the " +
                "bytecode route, every refusal at once; line is the Lua " +
                "line in main.lua, null when the finding is about the file " +
                "as a whole"
        };
      } catch (e) {
        refuse(errorCode(e), errorMessage(e));
      }
    }

    async function toolExportPce(args) {
      requireToy();
      const report = validateLib.validate(session.source,
                                          { chunkName: MAIN, frames: 8,
                                            songs: session.songs });
      if (!report.ok) {
        return {
          ok: false,
          code: report.code,
          problems: (report.problems || []).map(normaliseFinding),
          note: "the export refuses a toy the validator fails (#32); fix the " +
                "findings first"
        };
      }
      try {
        const program = compileToy(session.source);
        const encoded = ilbc.encode(program);
        const bank0 = await host.readBank0();
        const bytes = romLib.buildToyRom({ bank0: bank0, bytecode: encoded.bytes });
        const name = (args.name || "toy").toString().replace(/[^A-Za-z0-9._-]+/g, "-")
          .replace(/^[-.]+|[-.]+$/g, "") || "toy";
        const wrote = await host.writeRom({ bytes: bytes, name: name, out: args.out });
        return {
          ok: true,
          bytes: bytes.length,
          sha256: sha256Hex(bytes),
          path: wrote.path,
          route: "#100's browser route, no compiler: renderer/pce-il.js -> " +
                 "renderer/pce-ilbc.js -> renderer/pce-rom.js buildToyRom over " +
                 "the committed renderer/ilvm.bin",
          bytecode_bytes: encoded.bytes.length,
          ilvm_bytes: bank0.length,
          assets: session.files.filter(function (f) { return f.name !== MAIN; })
                              .map(function (f) { return f.name; }),
          note: "the llvm-mos route (tools/toyc) exists where llvm-mos is " +
                "installed but is not called here; this is the beta's route"
        };
      } catch (e) {
        refuse(errorCode(e), errorMessage(e));
      }
    }

    function toolDocs(args) {
      const ref = docs.reference();
      const topics = ref.sections.map(function (s) {
        return { id: s.id, title: s.title };
      });
      const topic = args.topic;
      if (topic == null || topic === "" || topic === "all") {
        if (topic === "all") {
          return { ok: true, markdown: docs.markdown(ref), topics: topics };
        }
        return {
          ok: true,
          title: ref.title,
          intro: ref.intro,
          topics: topics,
          note: "call docs with a topic id for that chapter of #61's reference"
        };
      }
      if (typeof topic !== "string") {
        refuse("docs-topic", "topic must be a chapter id or title");
      }
      const want = topic.trim().toLowerCase();
      let hits = ref.sections.filter(function (s) {
        return s.id.toLowerCase() === want || s.title.toLowerCase() === want;
      });
      if (!hits.length) {
        hits = ref.sections.filter(function (s) {
          return s.id.toLowerCase().indexOf(want) >= 0 ||
                 s.title.toLowerCase().indexOf(want) >= 0;
        });
      }
      if (!hits.length) {
        refuse("docs-topic", "no chapter matches " + JSON.stringify(topic) +
               "; the topics are " + topics.map(function (t) { return t.id; }).join(", "));
      }
      if (hits.length > 1) {
        refuse("docs-topic", JSON.stringify(topic) + " matches " +
               hits.map(function (s) { return s.id; }).join(", ") +
               "; name one of those ids");
      }
      const one = {
        title: ref.title,
        intro: ref.intro,
        sources: ref.sources,
        footer: ref.footer,
        sections: [hits[0]]
      };
      return {
        ok: true,
        topic: hits[0].id,
        markdown: docs.markdown(one)
      };
    }

    const HANDLERS = {
      toy_write: toolToyWrite,
      toy_save: toolToySave,
      project_save: toolProjectSave,
      project_open: toolProjectOpen,
      toy_run: toolToyRun,
      source_add: toolSourceAdd,
      song_write: toolSongWrite,
      frame_png: toolFramePng,
      registers_get: toolRegistersGet,
      register_set: toolRegisterSet,
      validate: toolValidate,
      rom_check: toolRomCheck,
      export_pce: toolExportPce,
      docs: toolDocs
    };

    /* The MCP-shaped call: one tool result {content, isError}.  A handler may
     * hand back an MCP result already (frame_png) or a plain value, which
     * becomes one text block, exactly as the old server shaped it. */
    async function call(name, args) {
      const handler = HANDLERS[name];
      if (!handler) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              ok: false, tool: name, code: "unknown-tool",
              message: "no tool named " + JSON.stringify(name) + "; the tools " +
                       "are " + TOOLS.map(function (t) { return t.name; }).join(", "),
              file: session.source ? MAIN : null
            })
          }],
          isError: true
        };
      }
      let result;
      try {
        const value = await handler(args || {});
        result = value && Array.isArray(value.content)
          ? value
          : { content: [{ type: "text", text: JSON.stringify(value) }] };
        if (value && value.ok === false) result.isError = true;
      } catch (e) {
        result = {
          content: [{
            type: "text",
            text: JSON.stringify({
              ok: false, tool: name,
              code: e instanceof Refusal ? e.code : errorCode(e),
              message: errorMessage(e),
              file: session.source ? MAIN : null
            })
          }],
          isError: true
        };
      }
      return result;
    }

    return {
      tools: TOOLS,
      call: call
    };
  }

  return {
    createSession: createSession,
    TOOLS: TOOLS,
    Refusal: Refusal,
    refuse: refuse,
    errorCode: errorCode,
    errorMessage: errorMessage
  };
});
