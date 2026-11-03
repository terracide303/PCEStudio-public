#!/usr/bin/env node
/*
 * tools/build-card.js — assemble an assembly project and write its HuCard
 * .pce (card #231).
 *
 *   node tools/build-card.js examples/asm-first out.pce [--pad384]
 *   node tools/build-card.js path/to/main.asm out.pce
 *
 * A directory is a project: main.asm / main.s (else the first .asm/.s) is
 * the entry, every other file in it is an include, and renderer/asm/pce.inc
 * is supplied automatically as "pce.inc" (a project file of that name wins).
 * A single file is assembled with only pce.inc beside it.
 *
 * The assembly is renderer/pce-asm.js (the same PCEAS 3.23 WebAssembly the
 * studio runs); the card is renderer/pce-card.js.  On success it prints the
 * entry, the byte counts per bank and the ROM's size and sha256.  On an
 * assembler error it prints file:line: message and exits 1; on a card
 * refusal it prints the refusal's code and message and exits 1.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const asm = require(path.join(ROOT, "renderer", "pce-asm.js"));
const card = require(path.join(ROOT, "renderer", "pce-card.js"));

const PCE_INC = path.join(ROOT, "renderer", "asm", "pce.inc");

function usage() {
  console.error("usage: node tools/build-card.js <project-dir|main.asm> " +
                "<out.pce> [--pad384]");
  process.exit(2);
}

function readText(file) {
  return fs.readFileSync(file, "utf8");
}

function main(argv) {
  const args = argv.filter((a) => a !== "--pad384");
  const pad384 = argv.indexOf("--pad384") >= 0;
  if (args.length !== 2) usage();
  const input = path.resolve(args[0]);
  const out = path.resolve(args[1]);

  let entryFile, entryName, includes = {};
  if (fs.existsSync(input) && fs.statSync(input).isDirectory()) {
    const names = fs.readdirSync(input).filter((n) =>
      !n.startsWith(".") && fs.statSync(path.join(input, n)).isFile());
    entryName = asm.entryName(names);
    entryFile = path.join(input, entryName);
    for (const name of names) {
      if (name === entryName) continue;
      includes[name] = readText(path.join(input, name));
    }
  } else {
    entryFile = input;
    entryName = path.basename(entryFile);
  }
  if (!fs.existsSync(entryFile)) {
    console.error("no such file: " + entryFile);
    process.exit(2);
  }
  if (!includes["pce.inc"] && fs.existsSync(PCE_INC)) {
    includes["pce.inc"] = readText(PCE_INC);
  }

  const result = asm.assemble(readText(entryFile), {
    filename: entryName,
    includes: includes
  });
  if (result.errors.length) {
    for (const e of result.errors) {
      console.error((e.file || entryName) + ":" + e.line + ": " + e.message);
    }
    process.exit(1);
  }
  const banks = asm.bankSizes(result.listing);

  let rom;
  try {
    rom = card.build({ bytes: result.bytes, banks: banks, pad384: pad384 });
  } catch (e) {
    console.error(e && e.message ? e.message : String(e));
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(rom.bytes));
  const sha = crypto.createHash("sha256").update(rom.bytes).digest("hex");

  console.log("entry " + entryName);
  console.log("assembly " + result.bytes.length + " B, " + rom.bankCount +
              " bank(s)");
  for (const b of rom.banks) {
    console.log("bank " + b.bank + ": " + b.bytes + " B used, " +
                b.free + " B free");
  }
  console.log("vectors bank " + rom.vector.bank + " reset $" +
              rom.vector.reset.toString(16).toUpperCase().padStart(4, "0"));
  if (rom.padding) {
    console.log("padded " + rom.padding + " B with $FF to " + rom.size + " B");
  }
  console.log("rom " + out);
  console.log("size " + rom.size + " B (" + rom.imageBanks + " banks)");
  console.log("sha256 " + sha);
}

main(process.argv.slice(2));
