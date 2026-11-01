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
 *   node tools/docs.js --claude [path]  write the chat-AI guide (default
 *                                       renderer/pcestudio-for-claude.md)
 *   node tools/docs.js --manual [path]  write the generated "Writing for the
 *                                       ROM" section into the Claude Code
 *                                       manual (default renderer/claude-code.html)
 *   node tools/docs.js --check          exit 1 if either generated file
 *                                       (docs.html, the guide) is not
 *                                       exactly what the generator writes,
 *                                       or the manual's ROM block is stale
 *
 * The "Writing for the ROM" section is generated from the two compilers'
 * own tables (renderer/pce-cgen.js and renderer/pce-ilbc.js FEATURES /
 * REFUSALS) and appears in all three places: the reference (docs.html), the
 * chat-AI guide, and between the markers in the Claude Code manual.  One
 * generator, so a feature the compiler carries or refuses cannot go stale
 * in any of them.
 *
 * tests/check-docs.js uses --check and, beyond it, mutates the code's tables
 * in a scratch copy to show the output follows them.  tests/check-guide.js
 * holds the guide (card #105) to the same rule.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const docs = require("../renderer/pce-docs.js");
const guide = require("../renderer/pce-guide.js");

const ROOT = path.resolve(__dirname, "..");
const HTML_PATH = path.join(ROOT, "renderer", "docs.html");
const CLAUDE_PATH = path.join(ROOT, "renderer", "pcestudio-for-claude.md");
const MANUAL_PATH = path.join(ROOT, "renderer", "claude-code.html");
const MANUAL_BEGIN = "<!-- writing-for-the-rom:begin";
const MANUAL_END = "<!-- writing-for-the-rom:end -->";

/* The manual is hand-written except for one generated section between the
 * two markers.  Replace only those lines; leave every hand-written byte
 * alone. */
function manualWithRom(file) {
  const target = file || MANUAL_PATH;
  const src = fs.readFileSync(target, "utf8");
  const beginAt = src.indexOf(MANUAL_BEGIN);
  if (beginAt < 0) {
    throw new Error(MANUAL_BEGIN + " marker missing from " + target);
  }
  const beginLineEnd = src.indexOf("\n", beginAt);
  if (beginLineEnd < 0) throw new Error("the ROM marker has no line end");
  const endAt = src.indexOf(MANUAL_END, beginLineEnd + 1);
  if (endAt < 0) {
    throw new Error(MANUAL_END + " marker missing from " + target);
  }
  const section = docs.htmlSection(docs.romSection())
    .split("\n").map((line) => line ? "  " + line : line).join("\n");
  return src.slice(0, beginLineEnd + 1) + section + "\n" +
         src.slice(endAt);
}

function main(argv) {
  const args = argv.slice(2);
  let mode = "markdown";
  let target = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--check") mode = "check";
    else if (a === "--html") {
      mode = "html";
      target = HTML_PATH;
      if (args[i + 1] && !args[i + 1].startsWith("--")) target = args[++i];
    } else if (a === "--claude") {
      mode = "claude";
      target = CLAUDE_PATH;
      if (args[i + 1] && !args[i + 1].startsWith("--")) target = args[++i];
    } else if (a === "--manual") {
      mode = "manual";
      target = MANUAL_PATH;
      if (args[i + 1] && !args[i + 1].startsWith("--")) target = args[++i];
    } else if (a === "--markdown") mode = "markdown";
    else if (a === "--help" || a === "-h") {
      process.stdout.write("usage: node tools/docs.js [--markdown | " +
                           "--html [path] | --claude [path] | " +
                           "--manual [path] | --check]\n");
      return 0;
    } else {
      process.stderr.write("unknown argument: " + a + "\n");
      return 2;
    }
  }

  if (mode === "check") {
    let failed = false;
    const want = docs.html(docs.reference());
    const have = fs.existsSync(HTML_PATH) ? fs.readFileSync(HTML_PATH, "utf8") : "";
    if (have !== want) {
      failed = true;
      process.stderr.write(
        "check-docs: renderer/docs.html is not the generator's output.\n" +
        "Regenerate it with: node tools/docs.js --html\n" +
        (have ? "(" + have.length + " bytes on disk, " + want.length +
                " generated)\n" : "(the file is missing)\n"));
    }
    const wantGuide = guide.markdown();
    const haveGuide = fs.existsSync(CLAUDE_PATH)
      ? fs.readFileSync(CLAUDE_PATH, "utf8") : "";
    if (haveGuide !== wantGuide) {
      failed = true;
      process.stderr.write(
        "check-guide: renderer/pcestudio-for-claude.md is not the " +
        "generator's output.\nRegenerate it with: node tools/docs.js " +
        "--claude\n" +
        (haveGuide ? "(" + haveGuide.length + " bytes on disk, " +
                     wantGuide.length + " generated)\n"
                   : "(the file is missing)\n"));
    }
    let wantManual = null;
    try {
      wantManual = manualWithRom();
    } catch (e) {
      failed = true;
      process.stderr.write("check-manual: " + e.message + "\n");
    }
    const haveManual = fs.existsSync(MANUAL_PATH)
      ? fs.readFileSync(MANUAL_PATH, "utf8") : "";
    if (wantManual != null && haveManual !== wantManual) {
      failed = true;
      process.stderr.write(
        "check-manual: renderer/claude-code.html's Writing-for-the-ROM " +
        "section is not the generator's output.\nRegenerate it with: node " +
        "tools/docs.js --manual\n" +
        "(" + haveManual.length + " bytes on disk, " + wantManual.length +
        " generated)\n");
    }
    if (failed) return 1;
    process.stdout.write("renderer/docs.html matches the generator: " +
                         want.length + " bytes; " +
                         "renderer/pcestudio-for-claude.md matches: " +
                         wantGuide.length + " bytes; " +
                         "renderer/claude-code.html's ROM section matches: " +
                         (wantManual ? wantManual.length : 0) + " bytes\n");
    return 0;
  }

  if (mode === "manual") {
    const page = manualWithRom(target);
    fs.writeFileSync(target, page);
    process.stdout.write("wrote the Writing-for-the-ROM section into " +
                         path.relative(ROOT, target) + " (" +
                         docs.romSection().blocks.length + " blocks)\n");
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

  if (mode === "claude") {
    const md = guide.markdown();
    fs.writeFileSync(target, md);
    const words = md.split(/\s+/).filter(Boolean).length;
    process.stdout.write("wrote " + path.relative(ROOT, target) + " (" +
                         md.length + " bytes, ~" + words + " words, " +
                         guide.guide().sections.length + " sections)\n");
    return 0;
  }

  process.stdout.write(docs.markdown(docs.reference()));
  return 0;
}

process.exitCode = main(process.argv);
