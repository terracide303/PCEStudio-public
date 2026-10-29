/*
 * tests/browser.js — the ONE browser setting (#114): every browser check
 * launches chrome-headless-shell (Chrome for Testing) from here, through
 * PCE_CHROME, and never the user's /Applications/Google Chrome.app.
 *
 * Why this exists (measured 2026-10-29): 48 `com.google.Chrome.code_sign_clone`
 * folders sat in /private/var/folders/…/X (the internal disk was at 1.5 GB
 * free). Headless Google Chrome makes one when a run is killed, and the
 * project's runs are killed routinely. The Chrome for Testing build does not;
 * the app bundle does.
 *
 * The default is the newest installed build under
 *   <PCE_CHROME_BASE>, as
 *   <PCE_CHROME_BASE>/chrome-headless-shell/<build>/chrome-headless-shell-mac-arm64/chrome-headless-shell
 * scanning every directory one level down.  PCE_CHROME_BASE defaults to
 * /Volumes/External II/pce-tools/chrome (the card's install path), and
 * PCE_CHROME overrides the binary outright.
 *
 * #124 uses this setting for its pad-key evidence.  #114 still owns pointing
 * check-studio.js's launches and tests/all.sh --browser at it.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const NAME = "chrome-headless-shell";
const BASE = process.env.PCE_CHROME_BASE ||
  path.join("/Volumes/External II", "pce-tools", "chrome");

function installed() {
  const out = [];
  let dirs = [];
  try { dirs = fs.readdirSync(BASE); } catch (e) { return out; }
  for (const dir of dirs) {
    const root = path.join(BASE, dir);
    try { if (!fs.statSync(root).isDirectory()) continue; } catch (e) { continue; }
    let builds = [];
    try { builds = fs.readdirSync(root); } catch (e) { continue; }
    for (const build of builds) {
      const buildDir = path.join(root, build);
      let inner = [];
      try { inner = fs.readdirSync(buildDir); } catch (e) { continue; }
      for (const part of inner) {
        const exe = path.join(buildDir, part, NAME);
        try {
          if (fs.statSync(exe).isFile()) out.push(exe);
        } catch (e) { /* not this one */ }
      }
    }
  }
  /* newest build last: the install path sorts by version */
  return out.sort();
}

const found = installed();
const CHROME = process.env.PCE_CHROME || found[found.length - 1] ||
  path.join(BASE, NAME);

let usable = false;
try { usable = fs.statSync(CHROME).isFile(); } catch (e) { usable = false; }

module.exports = {
  CHROME: CHROME,
  base: BASE,
  installed: found,
  exists: usable
};
