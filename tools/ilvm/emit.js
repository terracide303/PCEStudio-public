#!/usr/bin/env node
/*
 * tools/ilvm/emit.js — a Lua toy to a .pce with no compiler (card #100).
 *
 *   node tools/ilvm/emit.js TOY.lua OUT.pce [NAME]
 *
 * This is the export route the browser will run in the studio's second half:
 *
 *   toy.lua --(renderer/pce-il.js, Fengari)--> IL
 *           --(renderer/pce-ilbc.js)---------> bytecode
 *           --(renderer/pce-rom.js)----------> .pce
 *
 * The only input besides the toy is the committed interpreter image
 * renderer/ilvm.bin.  Nothing here calls llvm-mos, PCEAS or HuC; if the IL
 * or the encoder refuses a construct, the build fails with its code.
 *
 * Writes OUT.pce and OUT.json (sha256, sizes, the encoder's hook slots).
 */
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const il = require("../../renderer/pce-il.js");
const ilbc = require("../../renderer/pce-ilbc.js");
const romLib = require("../../renderer/pce-rom.js");

const ROOT = path.join(__dirname, "..", "..");

function main() {
  const srcPath = process.argv[2];
  const outPath = process.argv[3];
  const name = process.argv[4] || path.basename(srcPath || "toy", ".lua");
  if (!srcPath || !outPath) {
    console.error("usage: node tools/ilvm/emit.js TOY.lua OUT.pce [NAME]");
    process.exit(2);
  }

  const bank0 = fs.readFileSync(path.join(ROOT, "renderer", "ilvm.bin"));
  const source = fs.readFileSync(srcPath, "utf8");

  let program, encoded, bytes;
  try {
    program = il.compile(source, { chunkName: path.basename(srcPath) });
    encoded = ilbc.encode(program);
    bytes = romLib.buildToyRom({ bank0: bank0, bytecode: encoded.bytes });
  } catch (e) {
    const code = e && (e.code || e.name) || "error";
    console.error("emit failed: " + code + ": " + (e && e.message));
    process.exit(1);
  }

  fs.writeFileSync(outPath, Buffer.from(bytes));
  const report = {
    name: name,
    source: srcPath,
    source_sha256: crypto.createHash("sha256").update(source).digest("hex"),
    rom: outPath,
    rom_bytes: bytes.length,
    rom_sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    ilvm: {
      bytes: bank0.length,
      sha256: crypto.createHash("sha256").update(bank0).digest("hex")
    },
    bytecode: {
      bytes: encoded.bytes.length,
      sha256: crypto.createHash("sha256").update(encoded.bytes).digest("hex"),
      functions: encoded.functions,
      globals: encoded.globals,
      constants: encoded.constants,
      code_bytes: encoded.codeBytes,
      hooks: encoded.hooks,
      data_bank: romLib.TOY_DATA_BANK
    }
  };
  fs.writeFileSync(outPath.replace(/\.pce$/, "") + ".json",
                   JSON.stringify(report, null, 1) + "\n");
  console.log("built " + outPath + ": " + bytes.length + " bytes, sha256 " +
              report.rom_sha256.slice(0, 16) + ", bytecode " +
              encoded.bytes.length + " B");
}

main();
