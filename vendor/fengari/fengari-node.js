// Node loader for the vendored fengari-web build (vendor/fengari/VENDORED.md).
//
// The published dist/fengari-web.js is a UMD bundle that reads `window` while
// it is being evaluated, so requiring it in Node throws "window is not
// defined". In Node there is no window, so alias it to globalThis; the UMD's
// CommonJS branch then returns the API object exactly as it does in a page.
// In the browser the file is loaded by a plain <script> tag and this shim is
// not used (renderer/pce-toys.js reads the global `fengari`).
"use strict";
if (typeof globalThis.window === "undefined") globalThis.window = globalThis;
module.exports = require("./fengari-web.js");
