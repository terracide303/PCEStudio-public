#!/usr/bin/env node
/*
 * tests/check-gamepad.js — card #262: a real controller's browser route into
 * the PC Engine pad, on the two pages a person plays on.
 *
 * What this check can and cannot do without a controller: the Gamepad API's
 * shapes are plain objects, so the pages accept an injected provider (a
 * function returning the same array navigator.getGamepads() does).  The page's
 * own selftest (?gamepadtest=1) installs one, presses each button in turn and
 * publishes what the runtime's pad object held.  This file asserts those
 * numbers, so the page is not agreeing with itself about the claim the card
 * makes.
 *
 * It runs in the Chrome for Testing headless shell (tests/browser.js — never
 * /Applications/Google Chrome.app), the way check-pad-keys.js does, serves
 * the repo from this process, and sends no OS input: the KeyboardEvent in the
 * keyboard+pad case is dispatched in the page.
 *
 * Asserted, on renderer/toy.html (a toy's own page) and
 * renderer/studio.html (the Run view):
 *
 *   1. Every PCE bit — up, down, left, right, I, II, Select, Run, and the
 *      6-button III/IV — is set by its standard-layout button and by nothing
 *      else (each pressed alone).
 *   2. The left stick's four directions reach the same bits, and a value
 *      inside the 0.5 dead zone reaches none.
 *   3. Two pads are two players: pad 1 and pad 2 carry their own bits.
 *   4. The keyboard still works beside a controller: L (right) held by a key
 *      and Up held by the pad arrive in the same pad[1] object.
 *   5. Remap by pressing: after begin("i") the next new button becomes I's
 *      source and the toy's pad[1].i follows it.
 *   6. The mapping is saved in the browser and read back after a reload (the
 *      second page load uses the same Chrome profile), and the studio's
 *      CONTROLS drawer lists the connected pad and the live picture.
 *
 * NOT proven, and this file says so when it runs:
 *   - No physical controller was read: these are synthetic states in the
 *     Gamepad API's shape.  Whether a particular USB or Bluetooth pad in
 *     Chrome or Safari reports those indices is the person's five-second
 *     check in the CONTROLS drawer; the panel exists for exactly that.
 *   - A pad the browser does not map to "standard" may order its buttons
 *     differently; the default table is the standard layout, and the remap is
 *     the fix.  No non-standard pad was tested.
 *   - III/IV are the 6-button extras.  The browser pad object carries them,
 *     but the toy API (`pad[n]`) and the cartridge routes are the 2-button
 *     pad's eight fields (docs/PADS.md GAP 10), so no toy can read III/IV yet.
 *   - Rule 2 is OWED: this check was written by the seat that made the
 *     change.  Another seat must break the input path in its own ways
 *     (a wrong button index, an axis without its sign, the two pads swapped,
 *     the keyboard's object replacing the pad's instead of merging, a
 *     mapping that is not loaded back) and this file must catch every break
 *     before it closes the card.
 *
 *   node tests/check-gamepad.js
 *   PCE_CHROME=/path/to/the/headless-shell node tests/check-gamepad.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");
const browser = require("./browser.js");

const ROOT = path.join(__dirname, "..");
const CHROME = browser.CHROME;
const TMP = process.env.TMPDIR || "";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".bin": "application/octet-stream",
  ".wasm": "application/wasm",
  ".lua": "text/plain; charset=utf-8",
  ".png": "image/png"
};

let checks = 0;
const failures = [];

function check(ok, name) {
  checks++;
  if (!ok) { failures.push(name); console.log("FAIL  " + name); }
  else console.log("PASS  " + name);
}

function serve() {
  const root = path.resolve(ROOT);
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split("?")[0]);
      const file = path.join(root, rel);
      if (file !== root && !file.startsWith(root + path.sep)) {
        res.writeHead(403); res.end("forbidden"); return;
      }
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); res.end("not found"); return; }
        res.writeHead(200, { "content-type":
          MIME[path.extname(file).toLowerCase()] || "application/octet-stream" });
        res.end(data);
      });
    });
    server.listen(0, "127.0.0.1", () =>
      resolve({ server, port: server.address().port }));
  });
}

/* One page, one --dump-dom.  Same shape as check-pad-keys.js: asynchronous
 * spawn (this file serves the page from the same Node process), the DOM to a
 * file rather than a pipe.  `profile` is shared across the page loads on
 * purpose: that is what makes "saved in the browser" a reload, not a second
 * in-memory copy. */
function load(url, label, profile) {
  return new Promise((resolve) => {
    const stamp = process.pid + "-" + label.replace(/[^\w]+/g, "-");
    const dumpFile = path.join(TMP, "pcestudio-pad-" + stamp + ".html");
    let fd = null, settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      if (fd !== null) { try { fs.closeSync(fd); } catch (e) {} }
      try { fs.rmSync(dumpFile, { force: true }); } catch (e) {}
      resolve(result);
    };
    try {
      fd = fs.openSync(dumpFile, "w");
    } catch (e) {
      done({ error: "cannot open the dump file: " + e.message });
      return;
    }
    const child = spawn(CHROME, [
      "--headless",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--in-process-gpu",
      "--host-resolver-rules=MAP fonts.googleapis.com 127.0.0.1, " +
        "MAP fonts.gstatic.com 127.0.0.1",
      "--user-data-dir=" + profile,
      "--virtual-time-budget=20000",
      "--dump-dom", url
    ], { stdio: ["ignore", fd, "ignore"] });
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch (e) {}
      done({ error: "chrome did not finish within 120 s" });
    }, 120000);
    child.on("error", (e) => {
      clearTimeout(timer);
      done({ error: "chrome failed: " + e.message });
    });
    child.on("close", () => {
      clearTimeout(timer);
      let dom = "";
      try { dom = fs.readFileSync(dumpFile, "utf8"); } catch (e) {}
      const m = dom.match(/id="selftest"[^>]*>([\s\S]*?)<\/pre>/);
      if (!m) { done({ error: "no <pre id=\"selftest\"> in the dump" }); return; }
      const text = m[1].replace(/&quot;/g, "\"").replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<").replace(/&gt;/g, ">");
      try { done(JSON.parse(text)); }
      catch (e) { done({ error: "selftest is not JSON: " + text.slice(0, 200) }); }
    });
  });
}

const BUTTON = { up: 12, down: 13, left: 14, right: 15,
                 i: 0, ii: 1, select: 8, run: 9, iii: 2, iv: 3 };
const NAMES = Object.keys(BUTTON);

/* The shared shape of the two pages' reports.  `opts.keepMapping` is the
 * save run, which leaves the remap in the store on purpose: it proves the
 * store half, and the reload run proves the read half. */
function verify(label, out, opts) {
  opts = opts || {};
  if (!out || out.error) {
    check(false, label + " published a result (" +
          ((out && out.error) || "none") + ")");
    return;
  }
  for (const a of NAMES) {
    check(out.bits && out.bits[a] === true,
          label + ": " + a + " is set by button " + BUTTON[a]);
    check(out["alone_" + a] === true,
          label + ": " + a + " pressed alone leaves every other bit up");
  }
  check(out.stickUp === true, label + ": the left stick up reaches the up bit");
  check(out.stickDown === true, label + ": stick down reaches the down bit");
  check(out.stickLeft === true, label + ": stick left reaches the left bit");
  check(out.stickRight === true, label + ": stick right reaches the right bit");
  check(out.stickDead === true,
        label + ": a stick inside the 0.5 dead zone presses nothing");
  check(out.twoPads === true,
        label + ": two pads are pad 1 and pad 2, each with its own bits");
  check(out.keyboardAndPad === true,
        label + ": a held key and a pad button meet in pad 1");
  check(out.remapped === true,
        label + ": begin(\"i\") + a new press remaps I to that button");
  check(out.mappingSaved === true,
        label + ": the mapping is written to the browser's store");
  check(out.remapReachesToy === true,
        label + ": the remapped source reaches the toy's pad");
  check(out.mappingReloaded === true,
        label + ": the saved mapping loads back");
  check(opts.keepMapping ? out.savedI === '[{"button":2}]'
                         : out.mappingReset === true,
        opts.keepMapping
          ? label + ": the remap was left in the store for the reload (" +
            JSON.stringify(out.savedI) + ")"
          : label + ": reset puts the standard layout back");
}

/* The reload half: the studio saved a remap, and a fresh toy-page load on the
 * same profile reads it. */
function verifyReload(saved, loaded) {
  check(saved && saved.savedI === '[{"button":2}]',
        "studio: the remap is in the browser's store at the end of the run (" +
        JSON.stringify(saved && saved.savedI) + ")");
  check(loaded && loaded.loadedI === '[{"button":2}]',
        "toy.html: a reload reads the studio's saved mapping (" +
        JSON.stringify(loaded && loaded.loadedI) + ")");
}

(async () => {
  if (!browser.exists) {
    console.log("SKIP: no Chrome headless shell at " + CHROME +
                " (see tests/browser.js; #114)");
    process.exit(0);
  }
  if (!TMP) {
    console.log("SKIP: $TMPDIR is unset; the profile must not land in the " +
                "system temp (#114)");
    process.exit(0);
  }
  const profile = path.join(TMP, "pcestudio-gamepad-" + process.pid);
  const { server, port } = await serve();
  const base = "http://127.0.0.1:" + port + "/renderer/";
  try {
    /* the save half: the studio leaves its remap in the store */
    const save = await load(
      base + "studio.html?toy=starfall&paused=1&gamepadtest=1&gamepadsave=1",
      "studio-save", profile);
    verify("studio.html (save run)", save, { keepMapping: true });

    /* the reload half: a toy page on the same profile reads it */
    const reload = await load(
      base + "toy.html?id=starfall&paused=1&gamepadtest=1&gamepadload=1",
      "toy-reload", profile);
    verify("toy.html (reload run)", reload);
    verifyReload(save, reload);

    const toy = await load(
      base + "toy.html?id=starfall&paused=1&gamepadtest=1",
      "toy", profile);
    verify("toy.html (Browse)", toy);

    const studio = await load(
      base + "studio.html?toy=starfall&paused=1&gamepadtest=1",
      "studio", profile);
    verify("studio.html (Open in Studio)", studio);
    /* the same route through the IL runtime: same host, same setPad */
    const il = await load(
      base + "studio.html?toy=starfall&paused=1&gamepadtest=1&padmode=il",
      "studio-il", profile);
    verify("studio.html (Open in Studio, IL)", il);
    check(il.mode === "il", "studio.html (IL): the test ran in the IL runtime (" +
          il.mode + ")");
    check(studio.controlsOpen === true,
          "studio: ?bottom=controls' drawer is open after the run");
    check(/Pad 1/.test(studio.controlsText || ""),
          "studio: the CONTROLS drawer names the connected pad (" +
          JSON.stringify((studio.controlsText || "").slice(0, 120)) + ")");
    check(/D-pad up/.test(studio.controlsText || "") &&
          /I/.test(studio.controlsText || ""),
          "studio: the drawer shows the mapping table");
    check(/saved in this browser/i.test(studio.controlsText || ""),
          "studio: the drawer says where the mapping is saved");
  } finally {
    server.close();
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }

  console.log("");
  console.log("NOT proven: no physical controller was read — the states are " +
              "synthetic in the Gamepad API's shape; a non-standard pad's " +
              "button order; III/IV reach the pad object but the toy API is " +
              "2-button (docs/PADS.md GAP 10); rule 2 (another seat's breaks) " +
              "is OWED.");
  console.log(checks + " checks, " + failures.length + " failed");
  process.exit(failures.length ? 1 : 0);
})();
