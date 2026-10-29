#!/usr/bin/env node
/*
 * tests/check-pad-keys.js — card #124: the pad keys drive STARFALL on the
 * pages a person actually opens, through real page-level key events.
 *
 * The gap this closes: every other check scripts the pad through the runtime
 * (`rt.setPad(1, …)`), so a page whose keyboard path is missing — no focusable
 * output, no key listener, a player that hard-codes an empty pad — passes
 * every one of them.  Dennis, 2026-10-29, on the live site: "the buttons don't
 * work to control it".
 *
 * What it asserts, on three pages launched in the Chrome for Testing headless shell (#114,
 * tests/browser.js — never /Applications/Google Chrome.app):
 *
 *   1. A toy's own page (renderer/toy.html?id=starfall, the page Browse links
 *      to) and the studio (renderer/studio.html?toy=starfall, what "Open in
 *      Studio" loads) both give the output tabindex 0, so a click focuses it.
 *   2. With the output focused, the page dispatches its own KeyboardEvents
 *      (`element.dispatchEvent`, page-level events — NOT OS keystrokes) for
 *      IJKL and STARFALL's ship — SAT slot 6, its own sprite table — moves the
 *      way the key says: L moves it right, J moves it left.
 *   3. The key state reaches pad[1] of the running toy, not just the page: the
 *      studio's runtime reports pad 1 held, and keyup clears it.
 *   4. The control: with the output NOT focused the same key events land on
 *      the document body and the ship does not move.
 *   5. A player can see how to do it: a focus ring on the focused output and a
 *      hint containing "click the screen, then IJKL to move".
 *   6. The studio's IL runtime drives the pad the same way as the Lua one.
 *
 * The pages do the dispatching and publish the numbers in <pre id="selftest">
 * (?padtest=1); this file asserts them, so the page is not agreeing with
 * itself about the claim the card makes.
 *
 * NOT proven, and this file says so when it runs:
 *   - KeyboardEvents dispatched in the page are not OS keystrokes; a real
 *     keyboard's focus path (the browser's own tab order, a click landing on
 *     the canvas) is exercised by the outline and tabindex checks only, not by
 *     a mouse.
 *   - The other four gallery toys read no pad, and the studio's non-gallery
 *     examples read no pad; the ship moving is STARFALL-specific.
 *   - Rule 2 is OWED: this check was written by the seat that made the fix.
 *     Another seat must break the key path in its own ways (remove tabindex,
 *     remove the listener, keep the runtime pad empty, break the focus ring)
 *     and this file must catch every break before it closes the card.
 *
 *   node tests/check-pad-keys.js
 *   PCE_CHROME=/path/to/the/headless-shell node tests/check-pad-keys.js
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

/* One page, one --dump-dom.  In-page dispatch, no CDP, no OS input.
 *
 * Asynchronous spawn, on purpose: this file serves the page from the same
 * Node process, and a spawnSync/execFileSync would block the event loop so
 * the server could never answer Chrome (measured: both timed out).  The DOM
 * goes to a file rather than a pipe: the headless shell's helpers inherit
 * stdout and can hold a pipe open after the browser exits. */
function load(url, label) {
  return new Promise((resolve) => {
    const stamp = process.pid + "-" + label.replace(/[^\w]+/g, "-");
    const profile = path.join(TMP, "pcestudio-pad-" + stamp);
    const dumpFile = path.join(TMP, "pcestudio-pad-" + stamp + ".html");
    let fd = null, settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      if (fd !== null) { try { fs.closeSync(fd); } catch (e) {} }
      try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
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
      /* this machine's GPU process dies under the headless shell; the page
       * draws through canvas 2D, so the GPU is not needed */
      "--in-process-gpu",
      /* the pages link Google Fonts; with virtual time a stalled font request
       * keeps --dump-dom from finishing */
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
      catch (e) { done({ error: "selftest is not JSON: " + text.slice(0, 160) }); }
    });
  });
}

/* The shared shape of the two pages' reports. */
function verify(label, out, wantMode) {
  if (!out || out.error) {
    check(false, label + " published a result (" +
          ((out && out.error) || "none") + ")");
    return;
  }
  check(!out.error, label + " ran without error");
  check(String(out.tabindex) === "0",
        label + ": the output has tabindex 0, so a click can focus it (" +
        out.tabindex + ")");
  check(out.focused === true,
        label + ": focusing the output focuses the canvas");
  check(out.padKeyDown && out.padKeyDown.right === true,
        label + ": keydown KeyL reaches the page's pad");
  check(!(out.padKeyUp && out.padKeyUp.right),
        label + ": keyup KeyL releases it");
  check(typeof out.shipStart === "number" && out.shipStart > 0,
        label + ": STARFALL's ship starts on screen (" + out.shipStart + ")");
  check(typeof out.shipRight === "number" && typeof out.shipStart === "number" &&
        out.shipRight > out.shipStart,
        label + ": L moves the ship right (" + out.shipStart + " -> " +
        out.shipRight + ")");
  check(typeof out.shipLeft === "number" &&
        typeof out.shipStartLeft === "number" &&
        out.shipLeft < out.shipStartLeft,
        label + ": J moves the ship left (" + out.shipStartLeft + " -> " +
        out.shipLeft + ")");
  check(out.focusedForControl === false,
        label + ": the control really is unfocused");
  check(typeof out.shipControl === "number" &&
        out.shipControl === out.shipControlStart,
        label + ": keys on the unfocused output do not move the ship (" +
        out.shipControlStart + " -> " + out.shipControl + ")");
  check(out.outlineStyle && out.outlineStyle !== "none" &&
        parseFloat(out.outlineWidth) > 0,
        label + ": the focused output has a focus ring (" + out.outlineStyle +
        " " + out.outlineWidth + ")");
  check(/click the screen, then ijkl to move/i.test(out.hint || ""),
        label + ": the hint says how to give the screen the keys (" +
        JSON.stringify(out.hint) + ")");
  if (wantMode) {
    check(out.mode === wantMode,
          label + ": the test ran in the " + wantMode + " runtime (" +
          out.mode + ")");
    check(out.padRuntime && out.padRuntime["1"] && out.padRuntime["1"].right === true,
          label + ": the key state reached pad[1] of the running toy (" +
          JSON.stringify(out.padRuntime) + ")");
  }
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
  const { server, port } = await serve();
  const base = "http://127.0.0.1:" + port + "/renderer/";
  try {
    const toy = await load(base + "toy.html?id=starfall&paused=1&padtest=1",
                           "toy");
    verify("toy.html (Browse)", toy);
    const lua = await load(
      base + "studio.html?toy=starfall&paused=1&padtest=1&padmode=lua",
      "studio-lua");
    verify("studio.html (Open, Lua)", lua, "lua");
    const il = await load(
      base + "studio.html?toy=starfall&paused=1&padtest=1&padmode=il",
      "studio-il");
    verify("studio.html (Open, IL)", il, "il");
  } finally {
    server.close();
  }

  console.log("");
  console.log("NOT proven: in-page KeyboardEvents are not OS keystrokes; a " +
              "real mouse click's focus path; the four toys that read no pad; " +
              "rule 2 (another seat's breaks) is OWED.");
  console.log(checks + " checks, " + failures.length + " failed");
  process.exit(failures.length ? 1 : 0);
})();
