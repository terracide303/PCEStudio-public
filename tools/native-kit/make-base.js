#!/usr/bin/env node
/*
 * tools/native-kit/make-base.js — renderer/native-kit-base.json, the native
 * build kit's static files as base64 (docs/NATIVE-KIT.md).
 *
 *   node tools/native-kit/make-base.js          write it
 *   node tools/native-kit/make-base.js --check  exit 1 if it is stale
 *
 * The Export dialog builds the kit's zip in the page; the page can fetch only
 * what the site serves (renderer/, vendor/), so the kit's files that live under
 * tools/ travel as one JSON file beside the page.  The compiler's own
 * JavaScript is not in it: the page fetches those files live (pce-native-kit.js).
 */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const kit = require("../../renderer/pce-native-kit.js");

function listFiles(dir) {
  const out = [];
  for (const n of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) out.push.apply(out, listFiles(p)); else out.push(p);
  }
  return out;
}

function sources() {
  /* kit path -> repo file */
  const map = {
    "build.js": "tools/native-kit/build.js",
    "toolchain.json": "tools/native-kit/toolchain.json",
    "README.md": "tools/native-kit/README.md",
    "LICENSES/PCEStudio-GPL-3.0.txt": "LICENSE",
    "LICENSES/HuTrack-MIT.txt": "vendor/hutrack/LICENSE",
    "LICENSES/Fengari-MIT.txt": "vendor/fengari/LICENSE",
    "LICENSES/llvm-mos.txt": "tools/native-kit/LICENSE-llvm-mos.txt",
    "tools/toyc/emit.js": "tools/toyc/emit.js",
    "tools/native-assets.js": "tools/native-assets.js",
    "tools/native-songs.js": "tools/native-songs.js"
  };
  for (const f of fs.readdirSync(path.join(ROOT, "tools", "toyc"))) {
    if (/^toy_.*\.(c|h)$/.test(f)) map["tools/toyc/" + f] = "tools/toyc/" + f;
  }
  const eng = path.join(ROOT, "tools", "native-kit", "engines");
  for (const f of listFiles(eng)) {
    map["engines/" + path.relative(eng, f).split(path.sep).join("/")] = path.relative(ROOT, f).split(path.sep).join("/");
  }
  return map;
}

function make() {
  const files = {};
  const map = sources();
  for (const k of Object.keys(map).sort()) {
    /* text files go in with LF endings whatever the checkout did to them */
    let bytes = fs.readFileSync(path.join(ROOT, map[k]));
    if (/\.(js|c|h|json|md|txt)$/.test(k) || k === "LICENSES/PCEStudio-GPL-3.0.txt") {
      bytes = Buffer.from(bytes.toString("utf8").replace(/\r\n/g, "\n"), "utf8");
    }
    files[k] = bytes.toString("base64");
  }
  return JSON.stringify({ version: kit.VERSION, files: files }) + "\n";
}

module.exports = { make: make };
if (require.main === module) {
  const out = path.join(ROOT, "renderer", "native-kit-base.json");
  const text = make();
  if (process.argv[2] === "--check") {
    const have = fs.existsSync(out) ? fs.readFileSync(out, "utf8") : "";
    if (have !== text) { console.error("renderer/native-kit-base.json is stale: run node tools/native-kit/make-base.js"); process.exit(1); }
    console.log("native-kit-base.json is current");
  } else {
    fs.writeFileSync(out, text);
    console.log("wrote renderer/native-kit-base.json (" + text.length + " bytes, " + Object.keys(JSON.parse(text).files).length + " files)");
  }
}
