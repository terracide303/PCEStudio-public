#!/usr/bin/env node
/*
 * tests/check-browser.js — card #114: every browser check and capture launches
 * chrome-headless-shell (Chrome for Testing) on External II, through ONE
 * setting, and never launches the user's /Applications/Google Chrome.app.
 *
 * Why this exists (measured 2026-10-29): 48 `com.google.Chrome.code_sign_clone`
 * folders sat in /private/var/folders/…/X (the internal disk was at 1.5 GB
 * free). Headless Google Chrome makes one when a run is killed, and the
 * project's runs are killed routinely (timeouts, Ctrl-C, a failed driver). The
 * Chrome for Testing build does not do this; the app bundle does.
 *
 * What this checks, as five propositions the card's evidence line implies:
 *
 *   A. The scanner itself works. A fixture that launches
 *      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" must be
 *      reported, a fixture that launches chrome-headless-shell must not, and a
 *      fixture that mentions the app only in a comment must not (documents may
 *      name what the code must not do). A check that has never failed has not
 *      been tested; this one is fed a known break every run.
 *   B. No executable source in tests/, tools/, renderer/ or the repo root
 *      launches the app bundle.
 *   C. ONE setting decides the browser: exactly one tests/*.js file whose
 *      default binary is a chrome-headless-shell path and which reads an env
 *      override; every file that carries a `--headless` launch must require
 *      that module; the module must export the resolved absolute path.
 *   D. Profile and temp: every launch file's profile comes from
 *      process.env.TMPDIR, no /tmp literal in a launch file, and $TMPDIR here
 *      is on External II (SKIP, not a pass, when it is not).
 *   E. `tests/all.sh --browser` actually forwards the flag to the suites —
 *      the card's evidence names that command, and a flag nobody passes is a
 *      green run that never opened a browser.
 *
 * With --browser (and only when A–E pass and the default binary exists) it
 * also runs the real proof: the binary identifies as a headless shell, and
 * `node tests/check-studio.js --browser` goes green WITHOUT adding a
 * com.google.Chrome.code_sign_clone folder under /private/var/folders.
 *
 *   node tests/check-browser.js            # static checks only
 *   node tests/check-browser.js --browser  # + the real run and the clone count
 *
 * Exit 0 only if no check failed. SKIP lines are not passes (tests/all.sh
 * reports a suite that prints one as SKIP).
 *
 * NOT proven, even when everything above is green:
 *   - The env override is not pinned: a shell that sets it to Google Chrome
 *     makes every check here pass and every launch wrong. Nothing in this file
 *     reads the value a human's shell would supply.
 *   - Comment text is stripped before scanning; a launch assembled at runtime
 *     from pieces (`"/Applications/" + "Google Chrome.app"`) is invisible.
 *   - Only tests/, tools/, renderer/ and root scripts are read; vendor/ is
 *     third-party, and a launch in docs prose or on another machine is out of
 *     reach.
 *   - The runtime proof covers check-studio.js --browser only. Any future
 *     browser check obeys this file's static rules (B, C, D) but its actual
 *     launch is not observed here.
 *   - A code_sign_clone count that stays flat proves Chrome's clone mechanism
 *     did not run; it does not prove nothing else was written to the internal
 *     disk.
 *   - Chrome for Testing being the *right* product choice (as opposed to a
 *     different headless shell) is a design question, not one this can answer.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const HERE = __dirname;
const ROOT = path.join(HERE, "..");
const SELF = path.basename(__filename);
const EXTERNAL = "/Volumes/External II";
const CLONE_PREFIX = "com.google.Chrome.code_sign_clone";

const CHROME_APP = /\/Applications\/Google Chrome\.app/;
const HEADLESS_SHELL = "chrome-headless-shell";

const WANT_BROWSER = process.argv.slice(2).includes("--browser");

let checks = 0;
const failures = [];
const skips = [];

function check(ok, name) {
  checks++;
  if (!ok) {
    failures.push(name);
    console.log("FAIL  " + name);
  }
}

function skip(name) {
  skips.push(name);
  console.log("SKIP: " + name);
}

/* ---- source gathering --------------------------------------------------- */

const SKIP_DIRS = new Set(["vendor", "node_modules", "__pycache__", ".git",
                           "dumps", ".DS_Store"]);

function walk(dir, exts, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (e) { return out; }
  for (const ent of entries) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name) || ent.name.startsWith(".")) continue;
      walk(p, exts, out);
    } else if (ent.isFile() && exts.has(path.extname(ent.name)) &&
               ent.name !== SELF) {
      out.push(p);
    }
  }
  return out;
}

function sources() {
  const files = [];
  walk(HERE, new Set([".js"]), files);
  walk(path.join(ROOT, "tools"), new Set([".js", ".sh", ".py"]), files);
  walk(path.join(ROOT, "renderer"), new Set([".js"]), files);
  for (const name of fs.readdirSync(ROOT)) {
    if (/\.(sh|js|py)$/.test(name) && fs.statSync(path.join(ROOT, name)).isFile())
      files.push(path.join(ROOT, name));
  }
  return files.sort();
}

/* Blank out comments while keeping the line count, so a launch in a comment is
 * not reported (documents may name the banned path) and a real one is. */
function stripComments(text, file) {
  let s = text.replace(/\/\*[\s\S]*?\*\//g,
    (m) => m.replace(/[^\n]/g, " "));
  const hashComments = /\.(sh|py)$/.test(file);
  return s.split("\n").map((line) => {
    if (hashComments) {
      const hash = line.indexOf("#");
      if (hash >= 0) line = line.slice(0, hash) + " ".repeat(line.length - hash);
      return line;
    }
    const slashes = line.indexOf("//");
    if (slashes >= 0) line = line.slice(0, slashes) + " ".repeat(line.length - slashes);
    return line;
  });
}

/* The scanner, as a pure function, so section A can feed it fixtures. */
function findChromeAppLaunches(text, file) {
  const lines = stripComments(text, file || "x.js");
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    if (CHROME_APP.test(lines[i])) hits.push({ line: i + 1, text: lines[i].trim() });
  }
  return hits;
}

/* ---- A. the scanner is fed a break it must catch ------------------------ */

function sectionA() {
  const live = 'const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";\n';
  const commentJs = '/* never launch "/Applications/Google Chrome.app" */\n' +
                    '// "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"\n';
  const commentSh = '# "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"\n';
  const clean = 'const CHROME = "/Volumes/External II/pce-tools/chrome/chrome-headless-shell";\n';
  check(findChromeAppLaunches(live, "a.js").length === 1,
        "the scanner reports a live launch of the app bundle");
  check(findChromeAppLaunches(live, "a.js")[0].line === 1,
        "the scanner reports the launch's line number");
  check(findChromeAppLaunches(commentJs, "a.js").length === 0 &&
        findChromeAppLaunches(commentSh, "a.sh").length === 0,
        "the scanner does not report the app bundle named in a comment");
  check(findChromeAppLaunches(clean, "a.js").length === 0,
        "the scanner does not report a chrome-headless-shell path");
}

/* ---- B. nothing launches the app bundle -------------------------------- */

function sectionB() {
  const files = sources();
  const offenders = [];
  for (const f of files) {
    const text = fs.readFileSync(f, "utf8");
    for (const hit of findChromeAppLaunches(text, f))
      offenders.push(path.relative(ROOT, f) + ":" + hit.line + "  " + hit.text);
  }
  check(files.length > 10, "the source scan found the project's files (" +
        files.length + " scanned)");
  check(offenders.length === 0,
        "no executable source launches /Applications/Google Chrome.app" +
        (offenders.length ? " (" + offenders.length + " launch site(s))" : "") +
        (offenders.length ? "\n        " + offenders.join("\n        ") : ""));
}

/* ---- C. one setting ---------------------------------------------------- */

function settingsModule() {
  const candidates = [];
  for (const f of walk(HERE, new Set([".js"]), [])) {
    const text = fs.readFileSync(f, "utf8");
    if (text.indexOf(HEADLESS_SHELL) >= 0 && /process\.env\./.test(text))
      candidates.push({ file: f, text });
  }
  return candidates;
}

function launchFiles() {
  const out = [];
  for (const f of walk(HERE, new Set([".js"]), [])) {
    const text = fs.readFileSync(f, "utf8");
    if (/"--headless/.test(text)) out.push({ file: f, text });
  }
  return out;
}

function sectionC() {
  const candidates = settingsModule();
  check(candidates.length === 1,
        "exactly one tests/*.js file is the browser setting (a default " +
        "chrome-headless-shell path + an env override); found " +
        candidates.length +
        (candidates.length ? ": " +
          candidates.map((c) => path.basename(c.file)).join(", ") : ""));
  const launches = launchFiles();
  check(launches.length > 0, "the scan found the browser launch sites (" +
        launches.length + " file(s) with --headless)");
  if (candidates.length !== 1) {
    /* Without the one setting, the per-launch and runtime checks cannot be
     * stated; say so rather than passing them vacuously. */
    for (const l of launches)
      check(false, path.basename(l.file) + " would have to require the one " +
            "browser setting (no setting exists to require)");
    return null;
  }
  const mod = candidates[0];
  const base = path.basename(mod.file, ".js");

  const vars = [...mod.text.matchAll(/process\.env\.([A-Z0-9_]+)/g)]
    .map((m) => m[1]);
  check(vars.length > 0,
        "the browser setting reads an env override (" +
        (vars.length ? vars.join(", ") : "none") + ")");

  const defaults = [...mod.text.matchAll(/["']([^"'\n]*chrome-headless-shell[^"'\n]*)["']/g)]
    .map((m) => m[1]);
  check(defaults.length > 0,
        "the browser setting carries a chrome-headless-shell default path");
  const absolute = defaults.filter((d) => d.startsWith("/"));
  check(absolute.length > 0,
        "the default is an absolute path, not a PATH lookup (" +
        (absolute[0] || (defaults[0] || "none")) + ")");

  for (const l of launches) {
    const rel = path.basename(l.file);
    check(l.text.indexOf(base) >= 0,
          rel + " takes its browser from the one setting (" + base + ")");
  }
  return { mod, base, launches };
}

/* The setting must be readable from outside without knowing its internals:
 * a CommonJS module whose export is, or contains, the resolved absolute path. */
function resolvedFromSetting(mod) {
  const probe = `
    const m = require(${JSON.stringify(mod.file)});
    const out = [];
    const seen = new Set();
    (function scan(v, depth) {
      if (depth > 3 || v == null) return;
      if (typeof v === "string") { if (v.startsWith("/") && !seen.has(v)) { seen.add(v); out.push(v); } return; }
      if (typeof v !== "object" || seen.has(v)) return;
      seen.add(v);
      for (const k of Object.keys(v)) { try { scan(v[k], depth + 1); } catch (e) {} }
    })(m, 0);
    process.stdout.write(JSON.stringify(out));
  `;
  const res = spawnSync(process.execPath, ["-e", probe],
                        { encoding: "utf8", timeout: 30000 });
  if (res.status !== 0) return { error: (res.stderr || "").trim().slice(0, 200) };
  let paths = [];
  try { paths = JSON.parse(res.stdout); } catch (e) { return { error: "no JSON" }; }
  const shell = paths.filter((p) => p.indexOf(HEADLESS_SHELL) >= 0);
  return { paths, shell };
}

/* ---- D. profile and temp ----------------------------------------------- */

function sectionD(settings) {
  const files = (settings ? settings.launches : launchFiles());
  check(files.length > 0, "the scan found the browser launch sites to inspect");
  for (const l of files) {
    const rel = path.basename(l.file);
    const udd = (l.text.match(/--user-data-dir=/g) || []).length;
    check(udd > 0, rel + " passes --user-data-dir for every launch (" + udd + ")");
    check(/process\.env\.TMPDIR/.test(l.text),
          rel + " builds its profile under $TMPDIR");
    check(!/--user-data-dir=(?:\/tmp|\/private\/var)/.test(l.text),
          rel + " has no hard-coded profile directory");
  }
  const tmp = process.env.TMPDIR || "";
  if (!tmp) skip("$TMPDIR is unset — a profile would land in the system temp");
  else if (!tmp.startsWith(EXTERNAL))
    skip("$TMPDIR is " + tmp + ", not on External II — the card's profile " +
         "placement is not demonstrated on this machine");
  else check(true, "$TMPDIR is on External II (" + tmp + ")");
  if (settings) {
    const r = resolvedFromSetting(settings.mod);
    check(!r.error, "the browser setting loads and exposes its resolved " +
          "path" + (r.error ? " (" + r.error + ")" : ""));
    if (r.shell && r.shell.length) {
      check(r.shell.filter((p) => p.indexOf("/Volumes/External II") >= 0).length > 0,
            "the resolved browser is on External II (" + r.shell[0] + ")");
    }
  }
}

/* ---- E. all.sh forwards --browser -------------------------------------- */

function sectionE() {
  const file = path.join(HERE, "all.sh");
  let text;
  try { text = fs.readFileSync(file, "utf8"); }
  catch (e) {
    check(false, "tests/all.sh is readable (" + e.message + ")");
    return;
  }
  const lines = text.split("\n");
  const invocations = lines.filter((l) =>
    /(^|[^#\w])node\s+["']?[\w./$]*\$?\{?t\}?/.test(l) && !/^\s*#/.test(l));
  check(invocations.length > 0, "tests/all.sh invokes the suites");
  const forwards = invocations.filter((l) =>
    /"\$@"|\$@\b|"\$\{@\}"|BROWSER|SUITE_ARGS|--browser/.test(l));
  check(forwards.length > 0,
        "tests/all.sh forwards its arguments to the suites (the card's " +
        "evidence is `tests/all.sh --browser`; a suite run with no argument " +
        "never opens a browser)" +
        (forwards.length ? "" : " — invocation: " +
          (invocations[0] || "").trim()));
}

/* ---- the real run (--browser only) ------------------------------------- */

function cloneDirs() {
  const roots = [];
  const folders = "/private/var/folders";
  let users;
  try { users = fs.readdirSync(folders); } catch (e) { return null; }
  for (const u of users) {
    const uDir = path.join(folders, u);
    let hashes;
    try { hashes = fs.readdirSync(uDir); } catch (e) { continue; }
    for (const h of hashes) {
      const x = path.join(uDir, h, "X");
      let entries;
      try { entries = fs.readdirSync(x); } catch (e) { continue; }
      for (const e of entries)
        if (e.startsWith(CLONE_PREFIX)) roots.push(path.join(x, e));
    }
  }
  return roots;
}

function sectionRun(settings) {
  if (!WANT_BROWSER) {
    skip("the real browser run and the code_sign_clone count need --browser");
    return;
  }
  if (failures.length) {
    skip("the real run is refused: a static check above failed, so the launch " +
         "site is not yet known to avoid /Applications/Google Chrome.app");
    return;
  }
  const r = resolvedFromSetting(settings.mod);
  if (r.error || !r.shell || !r.shell.length) {
    skip("the real run is refused: the setting exposed no chrome-headless-shell path");
    return;
  }
  const exe = r.shell[0];
  if (!fs.existsSync(exe)) {
    skip("the real run is refused: " + exe + " does not exist (install it " +
         "with npx @puppeteer/browsers install chrome-headless-shell@stable)");
    return;
  }
  const v = spawnSync(exe, ["--version"], { encoding: "utf8", timeout: 30000 });
  const ver = ((v.stdout || "") + (v.stderr || "")).trim();
  check(/headless-?shell/i.test(ver) || /HeadlessShell/.test(ver),
        "the binary identifies as a headless shell (" + (ver || "no output") + ")");

  const before = cloneDirs();
  if (before === null) {
    skip("the real run is refused: /private/var/folders is unreadable, so no " +
         "clone count can be taken");
    return;
  }
  let run;
  try {
    run = execFileSync(process.execPath,
                       [path.join(HERE, "check-studio.js"), "--browser"],
                       { encoding: "utf8", timeout: 900000,
                         stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    run = (e.stdout || "") + (e.stderr || "");
    check(false, "check-studio.js --browser exited 0 with the headless shell (" +
          e.message + ")");
  }
  check(run !== undefined && !/^FAIL /m.test(run) &&
        !/NOT RUN  browser/.test(run),
        "check-studio.js --browser reports no FAIL and does not skip the browser");
  const after = cloneDirs();
  const added = after.filter((p) => before.indexOf(p) < 0);
  check(added.length === 0,
        "no com.google.Chrome.code_sign_clone folder appeared during the run " +
        "(before " + before.length + ", after " + after.length + ")" +
        (added.length ? "\n        " + added.join("\n        ") : ""));
}

/* ---- run ---------------------------------------------------------------- */

console.log("check-browser: the one browser setting (#114)");
sectionA();
sectionB();
const settings = sectionC();
sectionD(settings);
sectionE();
if (settings) sectionRun(settings);

console.log("");
if (skips.length)
  console.log(skips.length + " SKIPPED — a skip is not a pass.");
console.log(checks + " checks, " + failures.length + " failed");
console.log("NOT proven: the env override's value (a shell could point it at " +
            "Google Chrome and everything here would still pass); launches " +
            "assembled at runtime; vendor/ and docs; any browser check other " +
            "than check-studio.js --browser; and that a flat clone count " +
            "means nothing else touched the internal disk.");
process.exit(failures.length ? 1 : 0);
