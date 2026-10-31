/*
 * pce-zip.js — the project file's container (#162).
 *
 * A .pcestudio project is a ZIP whose layout is the same as an unpacked
 * project folder (docs/PROJECT-FORMAT.md).  The repo has no package.json and
 * no dependencies, so this is a small ZIP reader/writer in plain JS: the
 * writer uses STORED entries (a project is already deflated JSON/Lua, and a
 * stored entry keeps `unzip -t` and macOS Archive Utility trivially happy),
 * and the reader accepts STORED and DEFLATE, because a ZIP a person unpacked
 * and re-packed with Finder/Archive Utility comes back deflated.
 *
 * The DEflate decoder is a raw-inflate implementation of RFC 1951 (stored,
 * fixed-Huffman and dynamic-Huffman blocks).  It is the only reason the file
 * is not forty lines; the page has no synchronous zlib and an archive written
 * by another tool must open without a dependency.
 *
 * API (UMD: Node's require and the browser global PCEStudio.zip):
 *
 *   write(entries)        [{name, bytes}] -> Uint8Array (a STORED zip)
 *   read(bytes)           Uint8Array -> [{name, bytes, method, crc}]
 *   crc32(bytes)          the ZIP CRC-32, for callers that compare
 *   utf8Encode(text)      Uint8Array, the writer's own (no TextEncoder)
 *   utf8Decode(bytes)     text (no TextDecoder in the stub DOM)
 *
 * Refusals carry a `code`, the convention pce-editor.js and pce-source.js
 * use:
 *   zip-eocd       no end-of-central-directory record
 *   zip-64         a ZIP64 archive (not needed by a project, not supported)
 *   zip-entry      a central-directory entry that runs past the data
 *   zip-method     a compression method other than store/deflate
 *   zip-inflate    a DEFLATE stream that does not decode
 *   zip-crc        the data's CRC-32 disagrees with the directory's
 *
 * Written for #162; tests/check-project.js is the evidence.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.PCEStudio = root.PCEStudio || {};
    root.PCEStudio.zip = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function refuse(code, message) {
    var e = new Error(message);
    e.code = code;
    return e;
  }

  function bytesOf(value) {
    if (value instanceof Uint8Array) return value;
    if (typeof ArrayBuffer !== "undefined" && value instanceof ArrayBuffer)
      return new Uint8Array(value);
    if (Array.isArray(value)) return new Uint8Array(value);
    if (typeof value === "string") return utf8Encode(value);
    throw new Error("a zip entry needs bytes");
  }

  /* ---- UTF-8, because the stub DOM has no TextEncoder ---------------- */
  function utf8Encode(text) {
    var s = String(text == null ? "" : text), out = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) {
        var d = s.charCodeAt(++i);
        c = 0x10000 + ((c - 0xD800) << 10) + (d - 0xDC00);
      }
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000)
        out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else
        out.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 63),
                 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return new Uint8Array(out);
  }

  function utf8Decode(bytes) {
    var b = bytesOf(bytes), out = "", i = 0;
    while (i < b.length) {
      var c = b[i++];
      if (c < 0x80) { out += String.fromCharCode(c); continue; }
      if (c < 0xC0) throw refuse("zip-inflate", "a name is not UTF-8");
      if (c < 0xE0) {
        out += String.fromCharCode(((c & 31) << 6) | (b[i++] & 63));
      } else if (c < 0xF0) {
        out += String.fromCharCode(((c & 15) << 12) |
                                   ((b[i++] & 63) << 6) | (b[i++] & 63));
      } else {
        var cp = ((c & 7) << 18) | ((b[i++] & 63) << 12) |
                 ((b[i++] & 63) << 6) | (b[i++] & 63);
        cp -= 0x10000;
        out += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 1023));
      }
    }
    return out;
  }

  /* ---- CRC-32 --------------------------------------------------------- */
  var CRC = null;
  function crcTable() {
    if (CRC) return CRC;
    CRC = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++)
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      CRC[n] = c >>> 0;
    }
    return CRC;
  }

  function crc32(bytes) {
    var b = bytesOf(bytes), t = crcTable(), c = 0xFFFFFFFF;
    for (var i = 0; i < b.length; i++)
      c = t[(c ^ b[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /* ---- the writer -----------------------------------------------------
   * Every entry is STORED: no compressor is needed, and the format stays
   * readable by every unzip.  Timestamps are a fixed 1980-01-01 (ZIP's epoch)
   * so two builds of the same project are the same bytes — the round-trip
   * check can compare archives, not only their members. */
  var DOS_DATE = 0x0021;      /* 1980-01-01 */
  var DOS_TIME = 0;

  function localHeader(name, data, crc) {
    var n = utf8Encode(name), out = new Uint8Array(30 + n.length);
    var v = new DataView(out.buffer);
    v.setUint32(0, 0x04034b50, true);   /* local file header */
    v.setUint16(4, 20, true);           /* version needed */
    v.setUint16(6, 0x0800, true);       /* UTF-8 names */
    v.setUint16(8, 0, true);            /* STORED */
    v.setUint16(10, DOS_TIME, true);
    v.setUint16(12, DOS_DATE, true);
    v.setUint32(14, crc, true);
    v.setUint32(18, data.length, true);
    v.setUint32(22, data.length, true);
    v.setUint16(26, n.length, true);
    v.setUint16(28, 0, true);
    out.set(n, 30);
    return out;
  }

  function centralHeader(name, data, crc, offset) {
    var n = utf8Encode(name), out = new Uint8Array(46 + n.length);
    var v = new DataView(out.buffer);
    v.setUint32(0, 0x02014b50, true);   /* central directory header */
    v.setUint16(4, 20, true);           /* version made by */
    v.setUint16(6, 20, true);           /* version needed */
    v.setUint16(8, 0x0800, true);
    v.setUint16(10, 0, true);
    v.setUint16(12, DOS_TIME, true);
    v.setUint16(14, DOS_DATE, true);
    v.setUint32(16, crc, true);
    v.setUint32(20, data.length, true);
    v.setUint32(24, data.length, true);
    v.setUint16(28, n.length, true);
    v.setUint16(30, 0, true);           /* extra length */
    v.setUint16(32, 0, true);           /* comment length */
    v.setUint16(34, 0, true);           /* disk */
    v.setUint16(36, 0, true);           /* internal attributes */
    v.setUint32(38, 0, true);           /* external attributes */
    v.setUint32(42, offset, true);
    out.set(n, 46);
    return out;
  }

  function write(entries) {
    var list = entries || [], parts = [], central = [], offset = 0;
    for (var i = 0; i < list.length; i++) {
      var name = String(list[i].name || "");
      if (!name) throw refuse("zip-entry", "an entry needs a name");
      var data = bytesOf(list[i].bytes);
      var crc = crc32(data);
      var local = localHeader(name, data, crc);
      parts.push(local, data);
      central.push(centralHeader(name, data, crc, offset));
      offset += local.length + data.length;
    }
    var cdSize = 0;
    for (i = 0; i < central.length; i++) cdSize += central[i].length;
    var end = new Uint8Array(22);
    var ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, central.length, true);
    ev.setUint16(10, central.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);
    ev.setUint16(20, 0, true);
    parts.push.apply(parts, central);
    parts.push(end);
    var total = offset + cdSize + end.length;
    var out = new Uint8Array(total), at = 0;
    for (i = 0; i < parts.length; i++) { out.set(parts[i], at); at += parts[i].length; }
    return out;
  }

  /* ---- the reader -----------------------------------------------------
   * The central directory is the truth (a streamed archive's local headers
   * may carry zero sizes and a data descriptor); each entry's data offset is
   * its local header's own name/extra lengths. */
  function u16(b, at) { return b[at] | (b[at + 1] << 8); }
  function u32(b, at) {
    return (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
  }

  function findEnd(b) {
    var stop = Math.max(0, b.length - 65557), at = b.length - 22;
    for (; at >= stop; at--)
      if (b[at] === 0x50 && b[at + 1] === 0x4b && b[at + 2] === 0x05 &&
          b[at + 3] === 0x06) {
        var comment = u16(b, at + 20);
        if (at + 22 + comment <= b.length) return at;
      }
    return -1;
  }

  function read(bytes) {
    var b = bytesOf(bytes);
    var eocd = findEnd(b);
    if (eocd < 0)
      throw refuse("zip-eocd", "not a ZIP: no end-of-central-directory record");
    var count = u16(b, eocd + 10);
    var cdOffset = u32(b, eocd + 16);
    if (count === 0xFFFF || cdOffset === 0xFFFFFFFF)
      throw refuse("zip-64", "a ZIP64 archive: not needed for a project");
    var at = cdOffset, out = [];
    for (var i = 0; i < count; i++) {
      if (u32(b, at) !== 0x02014b50)
        throw refuse("zip-entry", "central directory entry " + i +
                     " is not a header");
      var method = u16(b, at + 10);
      var crc = u32(b, at + 16);
      var compSize = u32(b, at + 20);
      var size = u32(b, at + 24);
      var nameLen = u16(b, at + 28);
      var extraLen = u16(b, at + 30);
      var commentLen = u16(b, at + 32);
      var localAt = u32(b, at + 42);
      var name = utf8Decode(b.subarray(at + 46, at + 46 + nameLen));
      at += 46 + nameLen + extraLen + commentLen;

      if (u32(b, localAt) !== 0x04034b50)
        throw refuse("zip-entry", name + ": no local header");
      var dataAt = localAt + 30 + u16(b, localAt + 26) + u16(b, localAt + 28);
      if (dataAt + compSize > b.length)
        throw refuse("zip-entry", name + ": its data runs past the archive");
      var raw = b.subarray(dataAt, dataAt + compSize), data;
      if (method === 0) data = raw;
      else if (method === 8) data = inflateRaw(raw);
      else throw refuse("zip-method", name + ": compression method " +
                        method + " is not store or deflate");
      if (data.length !== size)
        throw refuse("zip-entry", name + ": " + data.length +
                     " bytes inflate to a directory entry that says " + size);
      if (crc32(data) !== crc)
        throw refuse("zip-crc", name + ": its CRC-32 does not match");
      out.push({ name: name, bytes: data, method: method, crc: crc });
    }
    return out;
  }

  /* ---- raw DEFLATE (RFC 1951), the reader's decoder -------------------
   * A puff-style decoder: canonical Huffman trees from code lengths, then
   * stored/fixed/dynamic blocks.  It decodes what Archive Utility and
   * `zip -9` produce; it does not need to encode (the writer stores). */
  var LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31,
                  35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  var LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2,
                   3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  var DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193,
                   257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145,
                   8193, 12289, 16385, 24577];
  var DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7,
                    8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  var CLEN_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2,
                    14, 1, 15];

  function buildTree(lengths, n) {
    var counts = new Uint16Array(16), offs = new Uint16Array(16);
    var symbols = new Uint16Array(n), i;
    for (i = 0; i < n; i++) counts[lengths[i]]++;
    counts[0] = 0;
    for (i = 1; i < 16; i++) offs[i] = offs[i - 1] + counts[i - 1];
    for (i = 0; i < n; i++)
      if (lengths[i]) symbols[offs[lengths[i]]++] = i;
    return { counts: counts, symbols: symbols };
  }

  function inflateRaw(src) {
    var pos = 0, bitbuf = 0, bitcnt = 0, out = [], outLen = 0;
    var MAXOUT = 64 * 1024 * 1024;

    function bits(n) {
      while (bitcnt < n) {
        if (pos >= src.length)
          throw refuse("zip-inflate", "the DEFLATE stream ends mid-code");
        bitbuf |= src[pos++] << bitcnt;
        bitcnt += 8;
      }
      var v = bitbuf & ((1 << n) - 1);
      bitbuf >>>= n;
      bitcnt -= n;
      return v;
    }

    function decode(tree) {
      var code = 0, first = 0, index = 0;
      for (var len = 1; len <= 15; len++) {
        code |= bits(1);
        var count = tree.counts[len];
        if (code - first < count)
          return tree.symbols[index + (code - first)];
        index += count;
        first = (first + count) << 1;
        code <<= 1;
      }
      throw refuse("zip-inflate", "a Huffman code runs past 15 bits");
    }

    function put(byte) {
      if (outLen >= MAXOUT)
        throw refuse("zip-inflate", "the stream inflates past 64 MB");
      out.push(byte);
      outLen++;
    }

    var FIXED_LIT = null, FIXED_DIST = null;
    function fixedTrees() {
      if (FIXED_LIT) return;
      var l = new Uint8Array(288), d = new Uint8Array(30), i;
      for (i = 0; i < 144; i++) l[i] = 8;
      for (; i < 256; i++) l[i] = 9;
      for (; i < 280; i++) l[i] = 7;
      for (; i < 288; i++) l[i] = 8;
      for (i = 0; i < 30; i++) d[i] = 5;
      FIXED_LIT = buildTree(l, 288);
      FIXED_DIST = buildTree(d, 30);
    }

    function codes(lit, dist) {
      for (;;) {
        var sym = decode(lit);
        if (sym < 256) { put(sym); continue; }
        if (sym === 256) return;
        sym -= 257;
        if (sym >= 29)
          throw refuse("zip-inflate", "a length code past 285");
        var length = LEN_BASE[sym] + bits(LEN_EXTRA[sym]);
        var dsym = decode(dist);
        if (dsym >= 30)
          throw refuse("zip-inflate", "a distance code past 29");
        var back = DIST_BASE[dsym] + bits(DIST_EXTRA[dsym]);
        if (back > outLen)
          throw refuse("zip-inflate", "a distance runs before the output");
        for (var k = 0; k < length; k++) put(out[outLen - back]);
      }
    }

    var last = 0;
    while (!last) {
      last = bits(1);
      var type = bits(2);
      if (type === 0) {
        /* stored: skip to the byte boundary, then LEN/NLEN */
        bitbuf = 0; bitcnt = 0;
        if (pos + 4 > src.length)
          throw refuse("zip-inflate", "a stored block has no length");
        var len = src[pos] | (src[pos + 1] << 8);
        var nlen = src[pos + 2] | (src[pos + 3] << 8);
        pos += 4;
        if ((len ^ 0xFFFF) !== nlen)
          throw refuse("zip-inflate", "a stored block's NLEN disagrees");
        if (pos + len > src.length)
          throw refuse("zip-inflate", "a stored block runs past the stream");
        for (var s = 0; s < len; s++) put(src[pos++]);
      } else if (type === 1) {
        fixedTrees();
        codes(FIXED_LIT, FIXED_DIST);
      } else if (type === 2) {
        var hlit = bits(5) + 257, hdist = bits(5) + 1, hclen = bits(4) + 4;
        var clen = new Uint8Array(19), i;
        for (i = 0; i < hclen; i++) clen[CLEN_ORDER[i]] = bits(3);
        var ct = buildTree(clen, 19);
        var lens = new Uint16Array(hlit + hdist), n = 0;
        while (n < hlit + hdist) {
          var sym = decode(ct);
          if (sym < 16) { lens[n++] = sym; continue; }
          var rep, val = 0;
          if (sym === 16) {
            if (!n) throw refuse("zip-inflate", "a repeat with no previous length");
            val = lens[n - 1];
            rep = 3 + bits(2);
          } else if (sym === 17) rep = 3 + bits(3);
          else rep = 11 + bits(7);
          if (n + rep > hlit + hdist)
            throw refuse("zip-inflate", "a code-length repeat runs past the table");
          while (rep--) lens[n++] = val;
        }
        codes(buildTree(lens.subarray(0, hlit), hlit),
              buildTree(lens.subarray(hlit), hdist));
      } else {
        throw refuse("zip-inflate", "block type 3 is reserved");
      }
    }
    return new Uint8Array(out);
  }

  return {
    write: write,
    read: read,
    crc32: crc32,
    utf8Encode: utf8Encode,
    utf8Decode: utf8Decode,
    inflateRaw: inflateRaw
  };
});
