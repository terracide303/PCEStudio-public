#!/usr/bin/env node
/*
 * tools/cache-bust.js — stamp a version on every LOCAL script and stylesheet a
 * page loads, so a browser or proxy that ignores the server's headers still
 * cannot pair a new page with an old file.
 *
 *   node tools/cache-bust.js <staged-dir> <version>
 *
 * tools/deploy.sh calls this on the STAGED copy of the site, never on the
 * repository: the repo's HTML is the thing the tests and the editor read, and
 * a ?v= in it would go stale the moment the commit after it landed.
 *
 * WHY (#155): the host answered renderer/gallery-toys.js with
 * `cache-control: max-age=2592000, public` — 30 days — so a visitor who had
 * loaded the site once kept the old gallery and the old scripts, and Browse
 * showed toys the site no longer had. deploy.sh now also uploads an .htaccess
 * that turns that cache off (the first fix); this is the second, and it holds
 * even where .htaccess is ignored (AllowOverride off) or a proxy cached the
 * file on its own.
 *
 * WHAT IT TOUCHES: <script src="..."> and <link href="..."> tags in every
 * *.html under the staged dir, where the URL is local — no scheme (http:,
 * https:, data:, mailto:), not protocol-relative (//host), not a fragment
 * (#id). Absolute-site paths (/renderer/x.js) count as local. Images, fonts
 * and other <link href> targets get the same treatment: they are cheap and
 * the card leaves the caching of the FILES alone, not the markup that names
 * them.
 *
 * A URL that already carries v= is left alone, so running this twice is safe.
 * A URL with another query (?tag=x) gets &v=…, not a second ?.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const [root, version] = process.argv.slice(2);
if (!root || !version) {
  console.error("usage: node tools/cache-bust.js <staged-dir> <version>");
  process.exit(2);
}
if (!/^[A-Za-z0-9._-]+$/.test(version)) {
  console.error("cache-bust: version must be a plain token (got " + JSON.stringify(version) + ")");
  process.exit(2);
}
if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
  console.error("cache-bust: " + root + " is not a directory");
  process.exit(2);
}

/* A URL the page itself will request (as opposed to another host's). */
function isLocal(url) {
  if (!url) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return false; // http:, https:, data:, mailto:
  if (url.startsWith("//")) return false;             // protocol-relative
  if (url.startsWith("#")) return false;              // in-page anchor
  return true;
}

function stamp(url) {
  if (/([?&])v=/.test(url)) return url;
  return url + (url.indexOf("?") >= 0 ? "&" : "?") + "v=" + version;
}

/* The tag's own attribute, quoted either way; the value is left unescaped
 * because the pages do not escape these paths. */
function stampTag(tag, name) {
  const attr = name === "script" ? "src" : "href";
  const re = new RegExp("(\\b" + attr + "\\s*=\\s*)([\"'])([^\"']*)\\2", "i");
  return tag.replace(re, (whole, lead, quote, url) =>
    isLocal(url) ? lead + quote + stamp(url) + quote : whole);
}

function rewrite(html) {
  let changed = 0;
  const out = html.replace(/<(script|link)\b[^>]*>/gi, (tag, name) => {
    const next = stampTag(tag, name.toLowerCase());
    if (next !== tag) changed++;
    return next;
  });
  return { out, changed };
}

function walk(dir, found) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, found);
    else if (ent.isFile() && /\.html$/i.test(ent.name)) found.push(p);
  }
  return found;
}

let files = 0, tags = 0;
for (const file of walk(root, [])) {
  const before = fs.readFileSync(file, "utf8");
  const { out, changed } = rewrite(before);
  if (changed) {
    fs.writeFileSync(file, out);
    files++;
    tags += changed;
  }
}
/* Silent on success: `sh tools/deploy.sh --dry` prints a file list, and a
 * deployment log that grows chatter per file is harder to read, not easier. */
