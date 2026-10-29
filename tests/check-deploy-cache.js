#!/usr/bin/env node
/*
 * tests/check-deploy-cache.js — card #155: the site lands on Browse, and a
 * visitor always gets the files of the deploy that is live.
 *
 * WHAT HAPPENED (Dennis, 2026-10-29): 'the toys on the website is not up to date
 * and has the wrong toys'.  @workshop measured it: the host answered
 * renderer/gallery-toys.js with `cache-control: max-age=2592000, public` — 30
 * days — so a browser that had loaded the site once kept the old gallery and the
 * old scripts.  And the root index.html redirected to renderer/studio.html.
 *
 * WHAT IS CHECKED — against the STAGED copy the deploy would upload, not
 * against the repository, because the ?v= stamps exist only on that copy:
 *   1. `sh tools/deploy.sh --dry --stage DIR` exits 0 and prints the file list.
 *   2. Its list carries `.htaccess` on a line of its own — the file the old
 *      deploy.sh could not upload, because the field list skips dotfiles.
 *   3. DIR/index.html redirects to renderer/browse.html, keeps the guide link,
 *      and has a plain 'Open the studio' link to renderer/studio.html.
 *   4. DIR/.htaccess sets `Cache-Control "no-cache"` for .html .js .json .md
 *      .css (the five the card names) and matches nothing else.
 *   5. Every local <script src>/<link href> under DIR/renderer carries
 *      ?v=<git short hash> (or &v=, for a URL that already has a query).
 *   6. The repository's own HTML was NOT touched by that run, and carries no
 *      ?v= — the card's 'on the staged copy, never in the repo'.
 *   7. An active line in tools/deploy.sh uploads the staged .htaccess to the
 *      site root; listing it in --dry would not be enough.
 *
 * CONTROLS, run every time, so a matcher that says yes to anything cannot pass:
 *   A. the versioned-refs matcher is fed the repository's renderer/browse.html
 *      (never staged) and must say NO;
 *   B. the same staged page with one ?v= stripped must make it say NO.
 *
 * The card's other evidence — 'a test that fails on the old deploy.sh' — was
 * run when this card was built: the pre-#155 tools/deploy.sh has no --stage and
 * no .htaccess, so checks 1-3 fail on it.  That run is recorded on the board,
 * not here, because this checkout carries the fixed script.
 *
 *   node tests/check-deploy-cache.js
 *
 * Written by @design because the card names this test.  RULE 2 IS OWED: the
 * author's own mutants prove only what the author thought of, so a different
 * seat must break this feature in its own ways before #155 closes.
 */
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const DEPLOY = path.join(ROOT, "tools", "deploy.sh");
const RENDERER = path.join(ROOT, "renderer");

let checks = 0;
const failures = [];

function check(ok, name) {
  checks++;
  if (!ok) { failures.push(name); console.log("FAIL  " + name); }
  return ok;
}

/* ---- reading refs out of HTML ----------------------------------------- */

/* A URL the page itself will request: no scheme (http:, https:, data:,
 * mailto:), not protocol-relative, not an in-page fragment.  Absolute-site
 * paths count — the deploy serves the site root. */
function isLocal(url) {
  if (!url) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return false;
  if (url.startsWith("//")) return false;
  if (url.startsWith("#")) return false;
  return true;
}

/* Every <script src> and <link href> in a page, as { tag, url }.  The quote
 * may be either; the tag may span lines (browse.html's <link> tags do). */
function refs(html) {
  const out = [];
  const tagRe = /<(script|link)\b[^>]*>/gi;
  let m;
  while ((m = tagRe.exec(html))) {
    const tag = m[1].toLowerCase();
    const attr = tag === "script" ? "src" : "href";
    const a = new RegExp("\\b" + attr + "\\s*=\\s*([\"'])([^\"']*)\\1", "i").exec(m[0]);
    if (a) out.push({ tag: tag, url: a[2] });
  }
  return out;
}

/* Does this page version every local script and stylesheet with `version`?
 * Returns the unversioned local refs (empty means yes). */
function unversionedRefs(html, version) {
  return refs(html).filter((r) => isLocal(r.url))
    .filter((r) => !new RegExp("[?&]v=" + version + "(?:&|$)").test(r.url));
}

function sha(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/* ---- the version the deploy stamps ------------------------------------ */

const git = spawnSync("git", ["rev-parse", "--short", "HEAD"],
                      { cwd: ROOT, encoding: "utf8" });
const VERSION = git.status === 0 && git.stdout.trim() ? git.stdout.trim() : "dev";

/* ---- run the deploy's dry + stage mode -------------------------------- */

const repoHtml = fs.readdirSync(RENDERER).filter((f) => /\.html$/.test(f));
const before = {};
for (const f of repoHtml) before[f] = sha(path.join(RENDERER, f));

const scratch = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "pce-deploy-cache-"));
const stage = path.join(scratch, "stage");
try {
  const dry = spawnSync("sh", [DEPLOY, "--dry", "--stage", stage], {
    cwd: ROOT, encoding: "utf8", timeout: 180000,
    env: Object.assign({}, process.env, { TMPDIR: scratch }),
  });
  const out = (dry.stdout || "") + (dry.stderr || "");
  check(dry.status === 0, "sh tools/deploy.sh --dry --stage DIR exits 0 (got " +
        dry.status + (dry.error ? ": " + dry.error.message : "") + ")");
  if (dry.status !== 0) {
    console.log("---- deploy output (tail) ----");
    console.log(out.split(/\r?\n/).slice(-20).join("\n"));
    console.log("------------------------------");
  }

  /* 2. the listing */
  const lines = (dry.stdout || "").split(/\r?\n/).map((l) => l.trim());
  check(lines.includes(".htaccess"),
        "--dry lists .htaccess on a line of its own (deploy.sh skips dotfiles)");

  /* 3. the site root lands on Browse */
  const indexFile = path.join(stage, "index.html");
  const indexHtml = fs.existsSync(indexFile) ? fs.readFileSync(indexFile, "utf8") : "";
  check(/<meta\s+http-equiv="refresh"[^>]*url=renderer\/browse\.html/.test(indexHtml),
        "staged index.html refreshes to renderer/browse.html");
  check(/href="renderer\/browse\.html"/.test(indexHtml),
        "staged index.html links renderer/browse.html (a visitor without refresh)");
  check(/href="renderer\/studio\.html"[^>]*>\s*Open the studio/.test(indexHtml),
        "staged index.html has a plain 'Open the studio' link");
  check(/href="pcestudio-for-claude\.md"/.test(indexHtml),
        "staged index.html keeps the guide link (#105)");

  /* 4. the cache headers */
  const htFile = path.join(stage, ".htaccess");
  const ht = fs.existsSync(htFile) ? fs.readFileSync(htFile, "utf8") : "";
  check(/mod_headers\.c/.test(ht), ".htaccess is guarded by <IfModule mod_headers.c>");
  check(/Header\s+set\s+Cache-Control\s+"no-cache"/.test(ht),
        ".htaccess sets Cache-Control \"no-cache\"");
  check(/\\\.\(html\|js\|json\|md\|css\)/.test(ht),
        ".htaccess matches exactly .html .js .json .md .css (images and fonts stay cached)");
  check(!/\b(png|jpg|jpeg|gif|svg|woff2?|ttf)\b/.test(ht.replace(/#.*/g, "")),
        "control: .htaccess matches no image or font extension");

  /* 5. every local script/link on every staged page is versioned */
  const stagedHtml = fs.existsSync(path.join(stage, "renderer"))
    ? fs.readdirSync(path.join(stage, "renderer")).filter((f) => /\.html$/.test(f)) : [];
  check(stagedHtml.length === repoHtml.length && stagedHtml.length > 0,
        "every renderer/*.html was staged (" + stagedHtml.length + " pages)");
  let totalLocal = 0;
  for (const f of stagedHtml) {
    const html = fs.readFileSync(path.join(stage, "renderer", f), "utf8");
    const local = refs(html).filter((r) => isLocal(r.url));
    totalLocal += local.length;
    const bad = unversionedRefs(html, VERSION);
    check(bad.length === 0,
          "staged renderer/" + f + ": every local script/link carries ?v=" + VERSION +
          (bad.length ? " (unversioned: " + bad.map((r) => r.url).join(", ") + ")" : ""));
  }
  check(totalLocal > 0, "the staged pages do load local scripts (" + totalLocal + " refs)");

  /* 6. the repository was not rewritten */
  let untouched = true;
  for (const f of repoHtml) {
    if (!fs.existsSync(path.join(RENDERER, f)) || sha(path.join(RENDERER, f)) !== before[f]) {
      untouched = false;
      console.log("       changed in the repo: renderer/" + f);
    }
  }
  check(untouched, "the run left every repository renderer/*.html byte for byte as it was");
  const bookBrowse = path.join(RENDERER, "browse.html");
  check(fs.existsSync(bookBrowse) && !/\?v=/.test(fs.readFileSync(bookBrowse, "utf8")),
        "the repository's renderer/browse.html carries no ?v= (staged copy only)");

  /* controls: the matcher must say NO to a page that is not stamped */
  const repoPage = fs.readFileSync(bookBrowse, "utf8");
  check(unversionedRefs(repoPage, VERSION).length > 0,
        "control: the versioned-refs matcher REJECTS the unstaged renderer/browse.html");
  // A deploy that staged nothing (the pre-#155 script) must still reach the
  // end and report every check, not die on a missing file.
  const stagedBrowse = path.join(stage, "renderer", "browse.html");
  const stagedPage = fs.existsSync(stagedBrowse) ? fs.readFileSync(stagedBrowse, "utf8") : "";
  const broken = stagedPage.replace(/\?v=[A-Za-z0-9._-]+/, "");
  check(stagedPage !== "" && broken !== stagedPage &&
        unversionedRefs(broken, VERSION).length > 0,
        "control: stripping one ?v= from the staged page makes the matcher reject it");

  /* 7. the upload, not just the listing */
  const src = fs.readFileSync(DEPLOY, "utf8");
  const uploadsHtaccess = src.split(/\r?\n/).some((l) =>
    /^\s*upload\s+"\$DEST"\s+"\$web_stage\/\.htaccess"(?:\s|$)/.test(l));
  check(uploadsHtaccess,
        "tools/deploy.sh uploads \"$web_stage/.htaccess\" to \"$DEST\" (a dotfile, so explicitly)");
  check(/index\.html"\) > "\$web_stage\/index\.html"|>\s*"\$web_stage\/index\.html"/.test(src),
        "the root index.html is generated in the staged copy, which is what is uploaded");
  check(spawnSync("sh", ["-n", DEPLOY], { encoding: "utf8" }).status === 0,
        "sh -n tools/deploy.sh parses");
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}

console.log("");
if (failures.length) {
  for (const f of failures) console.log("FAIL  " + f);
  console.log("FAIL  " + failures.length + " of " + checks +
              " checks: the deploy does not land on Browse or does not revalidate (#155)");
  process.exit(1);
}
console.log("PASS  " + checks + " checks: the site lands on Browse, .htaccess says " +
            "no-cache and every staged script/link carries ?v=" + VERSION + " (#155)");
