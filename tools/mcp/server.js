#!/usr/bin/env node
/*
 * tools/mcp/server.js — the PCEStudio MCP server, part 1 (card #36).
 *
 *   node tools/mcp/server.js
 *
 * A MODEL CONTEXT PROTOCOL SERVER over stdio.  A client (Claude Code, or any
 * MCP client) starts it, then calls the tools that write, run, look at,
 * check and export a toy.  The server is a THIN WRAPPER: every pixel comes
 * from renderer/pce-sprites.js, every frame from renderer/pce-il.js, every
 * refusal from the module that owns it, every document from
 * renderer/pce-docs.js.  There is no second model here.
 *
 * WHY A MINIMAL JSON-RPC STDIO IMPLEMENTATION, NOT THE OFFICIAL SDK:
 *   - the repository has no package.json and no node_modules, and `tests/
 *     all.sh` runs from a fresh checkout with nothing installed.  The
 *     official @modelcontextprotocol/sdk would add an npm install step (and a
 *     network fetch) to a project whose only other dependency is vendored
 *     Fengari;
 *   - this server uses four requests — initialize, tools/list, tools/call,
 *     ping — and three notifications.  The stdio transport is one JSON-RPC
 *     2.0 message per line (the MCP stdio transport, spec 2024-11-05 and
 *     later); implementing that is ~120 lines and is testable in the same
 *     style as the rest of tests/;
 *   - no dependency means no version skew between a client's protocol
 *     revision and a third-party library's.
 * The wire format is the standard one, so an official-SDK client is a
 * normal client to this server; tests/check-mcp.js is one.
 *
 * THE SESSION: one toy at a time.  toy_write replaces it, toy_run starts a
 * fresh, deterministic run (frame 0 up), frame_png can seek forward by
 * running the missing frames, and register_set records a VIEW OVERRIDE (the
 * studio's poked column) that frame_png applies and that value:null clears.
 * The override never touches the toy's source or its simulation, so an
 * agent's poke is reversible and cannot compound (docs/PPU-TOYS.md §4).
 *
 * ART (#153): a toy's asset files (tiles.json, palettes.json, sprites.json)
 * are imported into VRAM/CRAM/SAT before init() exactly as the studio does —
 * toy_run passes them to renderer/pce-il.js, whose host runs the #117
 * importer (renderer/pce-toyhost.js over pce-sat.js's pictureFromFiles and
 * pce-editor.js's toPicture), so the files the panels edit are the art a toy
 * boots inside.  source_add makes new art from a picture: a base64 PNG or a
 * pixel grid with its palette, run through the Add Source importer
 * (renderer/pce-source.js importImage, #123) and merged into the toy's asset
 * files, with the budget report back.  There is no second art model in this
 * file.
 *
 * MUSIC (#161): a toy's song files are its music(index) slots.  song.json is
 * the SEQUENCER's own document; renderer/pce-seq.js songsFromFiles compiles
 * it (and any playable songs.json entry) to the module pce-song.js's
 * createPlayer() takes, and toy_run hands that list to the runtime as
 * options.songs — the same list the studio gives a gallery toy.  source_add
 * kind song imports a .mid (renderer/pce-source.js importMidi, #123) as
 * song.json, song_write composes one from a step list, and toy_run's sound
 * report says which channels started notes and with which instrument.
 * There is no second song model in this file.
 *
 * stdout carries JSON-RPC only; logs go to stderr.  Nothing in this file
 * calls a compiler or an emulator: export_pce is #100's browser route
 * (renderer/pce-il.js -> renderer/pce-ilbc.js -> renderer/pce-rom.js's
 * buildToyRom over the committed renderer/ilvm.bin).
 *
 * docs/MCP.md is the tool reference with an example call for every tool.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const zlib = require("zlib");
const readline = require("readline");

const ROOT = path.join(__dirname, "..", "..");
const il = require(path.join(ROOT, "renderer", "pce-il.js"));
const ilbc = require(path.join(ROOT, "renderer", "pce-ilbc.js"));
const romLib = require(path.join(ROOT, "renderer", "pce-rom.js"));
const docs = require(path.join(ROOT, "renderer", "pce-docs.js"));
const validateLib = require(path.join(ROOT, "renderer", "pce-validate.js"));
const sprites = require(path.join(ROOT, "renderer", "pce-sprites.js"));
const toyhost = require(path.join(ROOT, "renderer", "pce-toyhost.js"));
const panels = require(path.join(ROOT, "renderer", "pce-panels.js"));
const psg = require(path.join(ROOT, "renderer", "pce-psg.js"));
const sourceLib = require(path.join(ROOT, "renderer", "pce-source.js"));
const satLib = require(path.join(ROOT, "renderer", "pce-sat.js"));
const editorLib = require(path.join(ROOT, "renderer", "pce-editor.js"));
const seqLib = require(path.join(ROOT, "renderer", "pce-seq.js"));

const SERVER_INFO = { name: "pcestudio", version: "0.1.0" };
const DEFAULT_PROTOCOL = "2025-06-18";
const SUPPORTED_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const MAX_FRAMES = 600;                 /* 10 s at 60 Hz, the frame_png cap */
const DEFAULT_FRAMES = 60;
const MAIN = "main.lua";

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

/* ---- the session ------------------------------------------------------- */

const session = {
  files: null,         /* [{name, source}] as written */
  source: null,        /* main.lua's text */
  songs: [],           /* the compiled songs the toy's files carry (#161) */
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

/* ---- small helpers ----------------------------------------------------- */

function isInt(v) { return typeof v === "number" && isFinite(v) && v === Math.floor(v); }

function intIn(v, what, lo, hi, code) {
  if (!isInt(v) || v < lo || v > hi) {
    refuse(code, what + " must be an integer " + lo + ".." + hi + ", got " +
           JSON.stringify(v));
  }
  return v;
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

function u8Hash(a) { return sha256(a); }

function cramWord(bytes, addr) {
  return bytes[addr * 2] | (bytes[addr * 2 + 1] << 8);
}

/* ---- PNG: the writer tests/check-examples.js and check.js use ---------- */

const CRC_TABLE = (function () {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (const b of buf) crc = CRC_TABLE[(crc ^ b) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function encodePng(rgb, width, height) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;                       /* colour type: RGB */
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgb.buffer, rgb.byteOffset + y * stride, stride)
      .copy(raw, y * (stride + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from("\x89PNG\r\n\x1a\n", "latin1"),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))
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

/* ---- the run and the renderer ----------------------------------------- */

function compileToy(source) {
  return il.compile(source, { chunkName: MAIN });
}

function runFresh(frames, pad) {
  resetRun();
  session.pad = pad;
  let rt;
  try {
    /* The asset files ride along (#117, #153): the IL host's createHost
     * imports them into VRAM/CRAM/SAT before load() runs top-level + init(),
     * exactly as the studio's host does (renderer/pce-toyhost.js).  The
     * songs ride with them (#161): the toy's song.json is what music(0)
     * plays, the same options.songs the studio's gallery toys receive. */
    rt = il.create(session.source, { chunkName: MAIN, files: session.files,
                                     songs: session.songs });
    rt.load();
  } catch (e) {
    throw e;
  }
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
      vram_sha256: u8Hash(st.vram),
      cram_sha256: u8Hash(st.cram),
      sat_sha256: u8Hash(st.sat)
    },
    assets: rt.assets || null,
    log: (rt.log || []).slice(),
    sound: soundReport(rt),
    sound_writes: rt.sound && rt.sound.events ? rt.sound.events.length : 0,
    overrides: Object.assign({}, session.overrides)
  };
}

/* ---- registers: the catalogue is the modules' own tables --------------- */

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

/* ---- the tools --------------------------------------------------------- */

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
    main_lua_bytes: Buffer.byteLength(session.source),
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

/* ---- source_add (#153): a picture merged into the toy's asset files ----- *
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

function pngImage(args) {
  let bytes;
  try {
    bytes = Buffer.from(String(args.png), "base64");
  } catch (e) {
    refuse("png-base64", "png is not base64");
  }
  return sourceLib.decodePng(bytes, function (data) {
    return zlib.inflateSync(data);
  });
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

/* A .mid through importMidi (#123) is the toy's song.json, and the toy's one
 * song: music(0) plays it.  The merge and the compile happen before the
 * session changes, so a .mid the importer or the player refuses leaves the
 * toy as it was. */
function songSourceAdd(args) {
  if (args.mid == null) {
    refuse("source-song", "kind song needs mid: the .mid file's bytes in " +
           "base64 (a Standard MIDI File)");
  }
  const bytes = Buffer.from(String(args.mid), "base64");
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

function toolSourceAdd(args) {
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
    const img = args.png != null ? pngImage(args) : gridImage(args);
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

/* ---- song_write (#161): compose the toy's song -------------------------
 * Two forms, one model:
 *   - notes: a step list the agent writes directly — {channel, step, note,
 *     length, instrument} — put into the SEQUENCER's grid
 *     (renderer/pce-seq.js newSong/setCell) with its default instruments
 *     (lead, bass, bell, strings, kick, snare; noise drums only on channels
 *     4 and 5, which pce-seq.js enforces with seq-voice);
 *   - song: the SEQUENCER's own document (what song.json is), validated by
 *     fromJSON and the model's check().
 * Either way it is compiled by pce-seq.js's compile() — the same module
 * pce-song.js's createPlayer() takes — and written as song.json, the file
 * the studio's SEQUENCER edits and saves, so the two see one song. */

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

function toolFramePng(args) {
  requireRun();
  const frame = intIn(args.frame, "frame", 0, MAX_FRAMES - 1, "frame-range");
  let r;
  try {
    r = renderFrame(frame);
  } catch (e) {
    if (e instanceof Refusal) throw e;
    throw new Refusal(errorCode(e), errorMessage(e));
  }
  const png = encodePng(r.img.pixels, r.img.width, r.img.height);
  const meta = {
    ok: true,
    frame: frame,
    width: r.img.width,
    height: r.img.height,
    bytes: png.length,
    sha256: crypto.createHash("sha256").update(png).digest("hex"),
    regs: Object.assign({}, r.rec.state.regs, session.overrides),
    overrides: Object.assign({}, session.overrides),
    raster_entries: r.rec.raster ? r.rec.raster.entries.length : 0
  };
  return {
    content: [
      { type: "text", text: JSON.stringify(meta) },
      { type: "image", data: png.toString("base64"), mimeType: "image/png" }
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

function toolExportPce(args) {
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
  let bytes;
  try {
    const program = compileToy(session.source);
    const encoded = ilbc.encode(program);
    const bank0 = fs.readFileSync(path.join(ROOT, "renderer", "ilvm.bin"));
    bytes = romLib.buildToyRom({ bank0: bank0, bytecode: encoded.bytes });
    const name = (args.name || "toy").toString().replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "") || "toy";
    const outPath = args.out
      ? path.resolve(String(args.out))
      : path.join(os.tmpdir(), "pce-mcp", name + ".pce");
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, Buffer.from(bytes));
    return {
      ok: true,
      bytes: bytes.length,
      sha256: crypto.createHash("sha256").update(Buffer.from(bytes)).digest("hex"),
      path: outPath,
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

const TOOL_BY_NAME = {};
for (const t of TOOLS) TOOL_BY_NAME[t.name] = t;

const HANDLERS = {
  toy_write: toolToyWrite,
  toy_run: toolToyRun,
  source_add: toolSourceAdd,
  song_write: toolSongWrite,
  frame_png: toolFramePng,
  registers_get: toolRegistersGet,
  register_set: toolRegisterSet,
  validate: toolValidate,
  export_pce: toolExportPce,
  docs: toolDocs
};

/* ---- MCP: JSON-RPC 2.0 over stdio, one message per line --------------- */

const INSTRUCTIONS =
  "PCEStudio's toy engine. Write a toy with toy_write, add art with " +
  "source_add (a PNG or pixel grid becomes tiles, sprites, a tilesheet or " +
  "a palette, merged into the toy's asset files; a .mid becomes song.json), " +
  "compose music with song_write or add a .mid with source_add kind song, " +
  "run it with toy_run (its sound report says what each PSG channel played), " +
  "look with frame_png, read or poke registers with registers_get/" +
  "register_set, check it with validate, export a .pce with export_pce, and " +
  "read the toy language with docs. Every tool wraps the same modules the " +
  "studio and the tests use; there is no second model.";

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function resultMessage(id, result) {
  return { jsonrpc: "2.0", id: id, result: result };
}

function errorMessage_(id, code, message, data) {
  const err = { code: code, message: message };
  if (data !== undefined) err.data = data;
  return { jsonrpc: "2.0", id: id, error: err };
}

/* rpcError writes one error immediately (the parse-error path, outside a
 * request); handleMessage returns its reply so a batch can be answered as
 * one JSON array. */
function rpcError(id, code, message, data) {
  send(errorMessage_(id, code, message, data));
}

function initialise(params) {
  const asked = params && params.protocolVersion;
  const version = SUPPORTED_PROTOCOLS.indexOf(asked) >= 0 ? asked
                                                        : DEFAULT_PROTOCOL;
  return {
    protocolVersion: version,
    capabilities: { tools: { listChanged: false } },
    serverInfo: SERVER_INFO,
    instructions: INSTRUCTIONS
  };
}

function toolResult(value) {
  /* A handler may return an MCP tool result already (frame_png) or a plain
   * JSON value, which becomes one text block. */
  if (value && Array.isArray(value.content)) return value;
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

function toolFailure(e, name) {
  const code = e instanceof Refusal ? e.code : errorCode(e);
  const message = errorMessage(e);
  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        ok: false, tool: name, code: code, message: message,
        file: session.source ? MAIN : null
      })
    }],
    isError: true
  };
}

function handleMessage(msg) {
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) {
    return errorMessage_(null, -32600, "invalid request: expected one JSON-RPC object");
  }
  const hasId = Object.prototype.hasOwnProperty.call(msg, "id");
  const id = hasId ? msg.id : null;
  if (msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return hasId ? errorMessage_(id, -32600, "invalid request") : null;
  }
  const params = msg.params || {};

  /* notifications have no id and must not be answered */
  if (!hasId) return null;

  switch (msg.method) {
  case "initialize":
    return resultMessage(id, initialise(params));
  case "ping":
    return resultMessage(id, {});
  case "tools/list":
    return resultMessage(id, { tools: TOOLS });
  case "tools/call": {
    if (typeof params.name !== "string") {
      return errorMessage_(id, -32602, "tools/call needs a tool name");
    }
    const handler = HANDLERS[params.name];
    if (!handler) {
      return errorMessage_(id, -32602,
                           "unknown tool " + JSON.stringify(params.name));
    }
    let result;
    try {
      const value = handler(params.arguments || {});
      result = toolResult(value);
      if (value && value.ok === false) result.isError = true;
    } catch (e) {
      result = toolFailure(e, params.name);
    }
    return resultMessage(id, result);
  }
  default:
    return errorMessage_(id, -32601, "method not found: " + msg.method);
  }
}

function answer(msg) {
  if (Array.isArray(msg)) {
    if (!msg.length) return errorMessage_(null, -32600, "empty batch");
    const replies = [];
    for (const one of msg) {
      const reply = handleMessage(one);
      if (reply) replies.push(reply);
    }
    return replies.length ? replies : null;
  }
  return handleMessage(msg);
}

function main() {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on("line", function (line) {
    const text = line.trim();
    if (!text) return;
    let msg;
    try {
      msg = JSON.parse(text);
    } catch (e) {
      rpcError(null, -32700, "parse error: " + errorMessage(e));
      return;
    }
    const reply = answer(msg);
    if (reply) send(reply);
  });
}

/* Only listen when run as the server, so a test can require this file for
 * its tool table without stealing stdin. */
if (require.main === module) {
  main();
  process.stdin.on("end", function () { process.exit(0); });
}

module.exports = {
  TOOLS: TOOLS,
  TOOL_BY_NAME: TOOL_BY_NAME,
  HANDLERS: HANDLERS,
  session: session,
  resetToy: resetToy,
  encodePng: encodePng,
  normaliseFinding: normaliseFinding,
  SERVER_INFO: SERVER_INFO,
  PROTOCOL_VERSION: DEFAULT_PROTOCOL
};
