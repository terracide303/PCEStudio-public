/*
 * pce-project.js — a whole PCEStudio project in one file (#162).
 *
 * `<name>.pcestudio` is a ZIP (renderer/pce-zip.js) whose layout is the SAME
 * as an unpacked project folder:
 *
 *   project.json          format "pcestudio/1", title, author, created and
 *                         modified, and the file list with each file's kind
 *   main.lua              the toy, and any other .lua
 *   tiles.json, palettes.json, sprites.json, waves.json,
 *   sources.json (#156), samples.json, instruments.json, songs.json
 *   NOTES.md              the resume note — goal, what works, what does not,
 *                         decisions with who/why, next steps.  A new project
 *                         is given this template (notesTemplate).
 *   art/<name>            the ORIGINAL PNG/WAV/MID as it went into Add Source,
 *                         so it can be re-imported with other settings;
 *                         sources.json's `original` names which one
 *   versions/<n>-<label>/ named snapshots of the code and asset files (never
 *                         of art/), at most a handful; the oldest is kept
 *                         unless the user deletes it
 *
 * The old .pce.json toy envelope is still read and written by the studio's
 * Save file; a .pce.json opens as a project without notes (no NOTES.md, no
 * art/, no versions).
 *
 * This module is pure: no DOM, no storage, no clock of its own (callers pass
 * `created`/`modified`).  UMD: Node's require for tests/check-project.js and
 * the browser global PCEStudio.project for renderer/studio.html.
 *
 * Refusals carry a `code`:
 *   project-format   no project.json, or its format is not pcestudio/1
 *   project-json     project.json is not JSON / not an object
 *   project-main     the archive has no main.lua
 *   project-name     a file name that is a path or unsafe
 *   project-code     a save that would leave out main.lua
 *
 * Docs: docs/PROJECT-FORMAT.md.  Evidence: tests/check-project.js.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./pce-zip.js"));
  } else {
    root.PCEStudio = root.PCEStudio || {};
    root.PCEStudio.project = factory(root.PCEStudio.zip);
  }
})(typeof self !== "undefined" ? self : this, function (zip) {
  "use strict";

  var FORMAT = "pcestudio/1";
  var NOTES_NAME = "NOTES.md";
  var ART_DIR = "art/";
  var VERSIONS_DIR = "versions/";
  var MAX_VERSIONS = 8;       /* "a handful"; the oldest is never dropped */

  function refuse(code, message) {
    var e = new Error(message);
    e.code = code;
    return e;
  }

  /* ---- names and kinds -------------------------------------------------
   * The same names renderer/studio.html's fileKind() answers, plus the ones a
   * project adds (NOTES.md, art/, a version).  A file's kind is derived from
   * its name so a project.json's list and an opened archive cannot disagree. */
  var KINDS = {
    "tiles.json": "tiles", "palettes.json": "palettes",
    "sprites.json": "sprites", "waves.json": "waves",
    "sources.json": "sources", "samples.json": "samples",
    "instruments.json": "instruments", "songs.json": "song",
    "song.json": "song"
  };

  function fileKind(name) {
    var n = String(name || "");
    if (n === NOTES_NAME) return "notes";
    if (/\.lua$/.test(n)) return "lua";
    if (KINDS[n]) return KINDS[n];
    if (/\.md$/i.test(n)) return "notes";
    return "json";
  }

  function isSongKind(kind) { return kind === "song"; }
  function isAssetKind(kind) {
    return kind === "tiles" || kind === "palettes" || kind === "sprites" ||
           kind === "waves" || kind === "sources" || kind === "samples" ||
           kind === "instruments";
  }

  /* project.json's list: name, kind and size.  A size makes the dialog's
   * checklist honest without re-reading a file. */
  function fileEntry(name, source) {
    var text = source == null ? "" : String(source);
    return { name: name, kind: fileKind(name), bytes: zip.utf8Encode(text).length };
  }

  function titleFromName(name) {
    return String(name || "project").replace(/\.pcestudio$/i, "")
      .replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "") || "project";
  }

  function zipName(title) {
    return titleFromName(title) + ".pcestudio";
  }

  /* ---- NOTES.md --------------------------------------------------------
   * The resume note is the reason the file exists: Dennis, 2026-10-29, "it's
   * for Claude to resume the game and have everything it made and has done so
   * you can work on it in multiple sessions".  The template asks for exactly
   * the four things a resuming session cannot infer from the code. */
  function notesTemplate(opts) {
    var o = opts || {};
    var title = o.title || "this project";
    var date = o.date || "";
    return [
      "# " + title + " — resume note",
      "",
      "Written for whoever picks this project up next (a person or Claude in",
      "a new session). Keep it current; the code says what, this says why.",
      "",
      "## Goal",
      "",
      "What the game is meant to be, in a sentence or two.",
      "",
      "## What works",
      "",
      "- (the parts that run, and how you saw them run)",
      "",
      "## What does not work",
      "",
      "- (known breakage, and the evidence that shows it)",
      "",
      "## Decisions",
      "",
      "- (decision — who made it and why; date)",
      "",
      "## Next steps",
      "",
      "1. (the next thing to do)",
      "",
      "## Notes",
      "",
      "- original art in `art/`, named by `sources.json`'s `original` field",
      "- versions in `versions/`, named snapshots of the code and assets",
      "- saved " + date,
      ""
    ].join("\n");
  }

  function firstLines(text, count) {
    var lines = String(text == null ? "" : text).split("\n"), out = [];
    for (var i = 0; i < lines.length && out.length < (count || 3); i++) {
      if (!lines[i].trim()) continue;
      out.push(lines[i]);
    }
    return out;
  }

  /* ---- the checklist's sizes ------------------------------------------
   * The Project dialog shows one line per group, each with its size.  A
   * group's size is the bytes it would add (text as UTF-8, art as its
   * original bytes), so unticking art visibly removes its weight. */
  function groupOf(file) {
    var kind = fileKind(file.name);
    if (kind === "lua") return "code";
    if (kind === "notes") return "notes";
    if (isSongKind(kind)) return "songs";
    return "assets";
  }

  function sizes(project) {
    var p = project || {}, out = { code: 0, assets: 0, songs: 0, notes: 0,
                                   art: 0, versions: 0 };
    for (var i = 0; i < (p.files || []).length; i++) {
      var f = p.files[i];
      out[groupOf(f)] += zip.utf8Encode(f.source == null ? "" : f.source).length;
    }
    for (i = 0; i < (p.art || []).length; i++)
      out.art += (p.art[i].bytes && p.art[i].bytes.length) || 0;
    for (i = 0; i < (p.versions || []).length; i++) {
      var v = p.versions[i];
      for (var k = 0; k < (v.files || []).length; k++)
        out.versions += zip.utf8Encode(v.files[k].source == null ? "" :
                                       v.files[k].source).length;
    }
    return out;
  }

  function defaultInclude(include) {
    var i = include || {};
    return {
      code: i.code !== false, assets: i.assets !== false,
      songs: i.songs !== false, notes: i.notes !== false,
      art: i.art !== false, versions: i.versions !== false
    };
  }

  /* ---- writing ---------------------------------------------------------
   * entries() is the unpacked folder: the zip is literally those files.  A
   * caller that wants to write a folder instead of a zip gets the same list. */
  function safeName(name) {
    var n = String(name || "");
    if (!n || n.indexOf("/") >= 0 || n.indexOf("\\") >= 0 || n === "." ||
        n === ".." || /^[.-]/.test(n))
      throw refuse("project-name", "unsafe project file name " +
                   JSON.stringify(name));
    return n;
  }

  /* Reading is more permissive than writing about a leading dot: a folder
   * zipped by Finder can carry .DS_Store or ._main.lua, and those are skipped
   * above anyway.  What reading refuses is a PATH, because the format is a
   * flat folder and a traversal must never become a page's file name. */
  function checkFlat(name) {
    var n = String(name || "");
    if (!n || n === "." || n === ".." || n.indexOf("/") >= 0 ||
        n.indexOf("\\") >= 0)
      throw refuse("project-name", "unsafe project file name " +
                   JSON.stringify(name));
    return n;
  }

  function versionDir(index, label) {
    var slug = String(label || "snapshot").toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
    return VERSIONS_DIR + (index + 1) + "-" + (slug || "snapshot");
  }

  function projectDoc(project, include) {
    var p = project || {}, inc = defaultInclude(include);
    var doc = {
      format: FORMAT,
      title: String(p.title || ""),
      author: String(p.author || ""),
      created: p.created || "",
      modified: p.modified || "",
      files: [],
      art: [],
      versions: []
    };
    for (var i = 0; i < (p.files || []).length; i++) {
      var f = p.files[i], group = groupOf(f);
      if (!inc[group]) continue;
      doc.files.push(fileEntry(f.name, f.source));
    }
    if (inc.art) {
      for (i = 0; i < (p.art || []).length; i++) {
        var a = p.art[i];
        doc.art.push({ name: a.name, path: ART_DIR + a.name,
                       bytes: (a.bytes && a.bytes.length) || 0,
                       source: a.source || "" });
      }
    }
    if (inc.versions) {
      for (i = 0; i < (p.versions || []).length; i++) {
        var v = p.versions[i], list = [];
        for (var k = 0; k < (v.files || []).length; k++)
          list.push(fileEntry(v.files[k].name, v.files[k].source));
        doc.versions.push({ dir: versionDir(i, v.label), label: v.label || "",
                            created: v.created || "", files: list });
      }
    }
    return doc;
  }

  function entries(project, include) {
    var p = project || {}, inc = defaultInclude(include);
    var doc = projectDoc(p, inc), out = [];
    out.push({ name: "project.json",
               bytes: zip.utf8Encode(JSON.stringify(doc, null, 2) + "\n") });
    var hasMain = false;
    for (var i = 0; i < (p.files || []).length; i++) {
      var f = p.files[i];
      if (!inc[groupOf(f)]) continue;
      if (f.name === "main.lua") hasMain = true;
      out.push({ name: safeName(f.name),
                 bytes: zip.utf8Encode(f.source == null ? "" : f.source) });
    }
    if (!hasMain)
      throw refuse("project-code", "a project needs main.lua: tick code");
    if (inc.art) {
      for (i = 0; i < (p.art || []).length; i++) {
        var a = p.art[i];
        out.push({ name: ART_DIR + safeName(a.name),
                   bytes: a.bytes || new Uint8Array(0) });
      }
    }
    if (inc.versions) {
      for (i = 0; i < (p.versions || []).length; i++) {
        var dir = versionDir(i, p.versions[i].label) + "/";
        for (var k = 0; k < (p.versions[i].files || []).length; k++) {
          var vf = p.versions[i].files[k];
          out.push({ name: dir + safeName(vf.name),
                     bytes: zip.utf8Encode(vf.source == null ? "" : vf.source) });
        }
      }
    }
    return out;
  }

  function build(project, include) {
    return zip.write(entries(project, include));
  }

  /* ---- reading ---------------------------------------------------------
   * parseEntries() takes what zip.read() returned (or a folder reader's
   * files); parseBytes() is the one-file entry point. */
  function parseEntries(list) {
    var files = [], art = [], versions = [], doc = null, byDir = {};
    var dirs = [];
    for (var i = 0; i < (list || []).length; i++) {
      var e = list[i], name = String(e.name || "");
      if (name === "project.json") {
        try { doc = JSON.parse(zip.utf8Decode(e.bytes)); }
        catch (err) { throw refuse("project-json", "project.json is not JSON: " +
                                   err.message); }
        if (!doc || typeof doc !== "object" || Array.isArray(doc))
          throw refuse("project-json", "project.json is not one JSON object");
        if (doc.format !== FORMAT)
          throw refuse("project-format", "a project.json is format " + FORMAT +
                       " (got " + JSON.stringify(doc.format) + ")");
        continue;
      }
      if (/\/$/.test(name)) continue;                  /* a directory record */
      /* Finder/Archive Utility adds these; they are not project files */
      if (name.indexOf("__MACOSX/") === 0 || /(^|\/)\._/.test(name) ||
          /(^|\/)\.DS_Store$/.test(name)) continue;
      if (name.indexOf(ART_DIR) === 0) {
        var leaf = name.slice(ART_DIR.length);
        checkFlat(leaf);
        if (leaf.indexOf("/") >= 0) continue;           /* not a flat original */
        art.push({ name: leaf, path: name, bytes: e.bytes,
                   source: originalSource(doc, name, leaf) });
        continue;
      }
      if (name.indexOf(VERSIONS_DIR) === 0) {
        var rest = name.slice(VERSIONS_DIR.length);
        var cut = rest.indexOf("/");
        if (cut < 0) continue;
        var dir = rest.slice(0, cut), inner = rest.slice(cut + 1);
        checkFlat(inner);
        if (inner.indexOf("/") >= 0) continue;
        if (!byDir[dir]) {
          var listed = versionIn(doc, VERSIONS_DIR + dir);
          byDir[dir] = { dir: VERSIONS_DIR + dir,
                         label: (listed && listed.label) || labelOf(dir),
                         created: (listed && listed.created) || "",
                         files: [] };
          dirs.push(dir);
        }
        byDir[dir].files.push({ name: inner, kind: fileKind(inner),
                                source: zip.utf8Decode(e.bytes) });
        continue;
      }
      /* a root file: the toy's code, its asset files and NOTES.md.  A name
       * that is a path is refused: the format is a flat folder, and a
       * traversal must not reach the page as a file name. */
      checkFlat(name);
      files.push({ name: name, kind: fileKind(name),
                   source: zip.utf8Decode(e.bytes) });
    }
    if (!doc)
      throw refuse("project-format", "no project.json: a .pcestudio is a " +
                   "project folder zipped (docs/PROJECT-FORMAT.md)");
    /* sources.json's `original` is the other half of art/'s naming: a
     * project.json written by another tool may leave `source` empty, and the
     * source entry still says which original it came from. */
    var sourcesText = null;
    for (i = 0; i < files.length; i++)
      if (files[i].name === "sources.json") sourcesText = files[i].source;
    if (sourcesText) {
      try {
        var sd = JSON.parse(sourcesText);
        var sl = (sd && Array.isArray(sd.sources)) ? sd.sources : [];
        for (i = 0; i < art.length; i++) {
          if (art[i].source) continue;
          for (var k = 0; k < sl.length; k++) {
            var o = sl[k] && sl[k].original;
            if (o === ART_DIR + art[i].name || o === art[i].name) {
              art[i].source = sl[k].name || "";
              break;
            }
          }
        }
      } catch (e) { /* a bad sources.json is the importer's refusal, not ours */ }
    }
    for (i = 0; i < dirs.length; i++) {
      var v = byDir[dirs[i]];
      if (!v.files.length) continue;
      versions.push(v);
    }
    versions.sort(function (a, b) { return a.dir < b.dir ? -1 : 1; });
    var hasMain = false;
    for (i = 0; i < files.length; i++) if (files[i].name === "main.lua") hasMain = true;
    if (!hasMain) throw refuse("project-main", "the project has no main.lua");
    var notes = null;
    for (i = 0; i < files.length; i++)
      if (files[i].name === NOTES_NAME) notes = files[i].source;
    return {
      format: FORMAT,
      title: typeof doc.title === "string" ? doc.title : "",
      author: typeof doc.author === "string" ? doc.author : "",
      created: typeof doc.created === "string" ? doc.created : "",
      modified: typeof doc.modified === "string" ? doc.modified : "",
      files: files,
      notes: notes,
      art: art,
      versions: versions
    };
  }

  /* sources.json's `original` is `art/<name>`; project.json's art list names
   * the source too.  The art entry keeps the flat name, so a re-import can
   * find the bytes it came from. */
  function originalSource(doc, path, leaf) {
    var artList = (doc && Array.isArray(doc.art)) ? doc.art : [];
    for (var i = 0; i < artList.length; i++) {
      var a = artList[i] || {};
      if (a.path === path || a.name === leaf) return a.source || "";
    }
    var list = (doc && Array.isArray(doc.sources)) ? doc.sources : [];
    for (i = 0; i < list.length; i++) {
      var o = list[i] && list[i].original;
      if (o === ART_DIR + leaf || o === leaf) return list[i].name || "";
    }
    return "";
  }

  /* `1-first-look` -> "first look": the folder keeps the label, the number
   * keeps the order.  The label is also read from project.json's version
   * list when there is one (a label with punctuation survives the folder). */
  function labelOf(dir) {
    var m = /^(\d+)-(.+)$/.exec(String(dir || ""));
    return m ? m[2].replace(/-+/g, " ").trim() : String(dir || "snapshot");
  }

  function versionIn(doc, dir) {
    var want = String(dir || "").replace(/\/+$/, "");
    var list = (doc && Array.isArray(doc.versions)) ? doc.versions : [];
    for (var i = 0; i < list.length; i++)
      if (list[i] && String(list[i].dir || "").replace(/\/+$/, "") === want)
        return list[i];
    return null;
  }

  function parseBytes(bytes) {
    return parseEntries(zip.read(bytes));
  }

  /* ---- the dialog's summary -------------------------------------------
   * What OPEN lists before anything is loaded: the file list with kinds and
   * sizes, the notes' first lines, the versions and the originals.  It reads
   * the parsed project, never the page's live state. */
  function describe(project) {
    var p = project || {}, out = { title: p.title || "", files: [],
                                   notes: firstLines(p.notes || "", 4),
                                   versions: [], art: [] };
    for (var i = 0; i < (p.files || []).length; i++) {
      var f = p.files[i];
      out.files.push({ name: f.name, kind: fileKind(f.name), group: groupOf(f),
                       bytes: zip.utf8Encode(f.source || "").length });
    }
    for (i = 0; i < (p.versions || []).length; i++)
      out.versions.push({ label: p.versions[i].label || p.versions[i].dir,
                          files: (p.versions[i].files || []).length });
    for (i = 0; i < (p.art || []).length; i++)
      out.art.push({ name: p.art[i].name,
                     bytes: (p.art[i].bytes && p.art[i].bytes.length) || 0 });
    return out;
  }

  return {
    FORMAT: FORMAT,
    NOTES_NAME: NOTES_NAME,
    ART_DIR: ART_DIR,
    VERSIONS_DIR: VERSIONS_DIR,
    MAX_VERSIONS: MAX_VERSIONS,
    fileKind: fileKind,
    groupOf: groupOf,
    titleFromName: titleFromName,
    zipName: zipName,
    notesTemplate: notesTemplate,
    firstLines: firstLines,
    sizes: sizes,
    defaultInclude: defaultInclude,
    projectDoc: projectDoc,
    entries: entries,
    build: build,
    parseEntries: parseEntries,
    parseBytes: parseBytes,
    describe: describe,
    versionDir: versionDir
  };
});
