#!/usr/bin/env node
/*
 * tools/docs.js — print or write the toy author's reference (card #61) from
 * renderer/pce-docs.js, which reads every range and refusal code out of the
 * runtime's own tables.
 *
 *   node tools/docs.js                  the reference as Markdown on stdout
 *   node tools/docs.js --markdown       the same, named
 *   node tools/docs.js --html [path]    write the page (default
 *                                       renderer/docs.html)
 *   node tools/docs.js --check          exit 1 if renderer/docs.html is not
 *                                       exactly what --html would write
 *
 * tests/check-docs.js uses --check and, beyond it, mutates the code's tables
 * in a scratch copy to show the output follows them.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const docs = require("../renderer/pce-docs.js");

const ROOT = path.resolve(__dirname, "..");
const HTML_PATH = path.join(ROOT, "renderer", "docs.html");

function main(argv) {
  const args = argv.slice(2);
  let mode = "markdown";
  let target = HTML_PATH;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--check") mode = "check";
    else if (a === "--html") {
      mode = "html";
      if (args[i + 1] && !args[i + 1].startsWith("--")) target = args[++i];
    } else if (a === "--markdown") mode = "markdown";
    else if (a === "--help" || a === "-h") {
      process.stdout.write("usage: node tools/docs.js [--markdown | " +
                           "--html [path] | --check]\n");
      return 0;
    } else {
      process.stderr.write("unknown argument: " + a + "\n");
      return 2;
    }
  }

  if (mode === "check") {
    const want = docs.html(docs.reference());
    const have = fs.existsSync(HTML_PATH) ? fs.readFileSync(HTML_PATH, "utf8") : "";
    if (have !== want) {
      process.stderr.write(
        "check-docs: renderer/docs.html is not the generator's output.\n" +
        "Regenerate it with: node tools/docs.js --html\n" +
        (have ? "(" + have.length + " bytes on disk, " + want.length +
                " generated)\n" : "(the file is missing)\n"));
      return 1;
    }
    process.stdout.write("renderer/docs.html matches the generator: " +
                         want.length + " bytes\n");
    return 0;
  }

  if (mode === "html") {
    const ref = docs.reference();
    const page = docs.html(ref);
    fs.writeFileSync(target, page);
    process.stdout.write("wrote " + path.relative(ROOT, target) + " (" +
                         page.length + " bytes, " +
                         ref.sections.length + " chapters)\n");
    return 0;
  }

  process.stdout.write(docs.markdown(docs.reference()));
  return 0;
}

process.exitCode = main(process.argv);
