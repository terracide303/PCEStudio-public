/* check-raster.js — the #15/#16 raster-table check, shared by tests/check.js
 * (the scene-ROM dumps) and tests/check-viewer.js (the viewer-ROM dumps).
 * Both must hold the same table to the same save state: the card's point is
 * that the viewer runs the scene's table.
 *
 * The table must describe what the ROM actually wrote.  Witnesses, all from
 * the save state: the registers (BXR/BYR/CR hold the last write of their
 * kind, RCR holds the chain's re-arm of the last fired step), the colour
 * table (baseCram plus every entry's writes in line order), and the table's
 * own self-consistency (lines strictly increasing, rcr = 0x40 + line).
 * Lines are VDW lines; 240 is allowed for the HBlank restore after the
 * last display line (239).  Returns a list of problem strings (empty = the
 * table checks out). */

function checkRaster(name, raster, regs, cram, vdwLine0) {
  const problems = [];
  const base = raster.base || {};
  const entries = raster.entries || [];
  if (!entries.length) {
    return ["no entries"];
  }
  for (let i = 1; i < entries.length; i++) {
    if (entries[i].line <= entries[i - 1].line) {
      problems.push(`entries[${i}].line ${entries[i].line} not after ` +
                    `entries[${i - 1}].line ${entries[i - 1].line}`);
    }
  }
  for (const e of entries) {
    if (e.line < 0 || e.line > 240) {
      problems.push(`entry line ${e.line} outside 0..240`);
    }
    if (e.rcr !== 0x40 + e.line) {
      problems.push(`entry line ${e.line}: rcr ${e.rcr} != ` +
                    `${0x40 + e.line}`);
    }
    for (const [a, v] of (e.cram || [])) {
      if (a < 0 || a >= 512 || v < 0 || v >= 512) {
        problems.push(`entry line ${e.line}: cram [${a}, ${v}] out of range`);
      }
    }
    if (e.cramPrev) {
      if (!e.cram || e.cramPrev.length !== e.cram.length) {
        problems.push(`entry line ${e.line}: cramPrev shape != cram`);
      } else {
        for (let k = 0; k < e.cram.length; k++) {
          if (e.cramPrev[k][0] !== e.cram[k][0]) {
            problems.push(`entry line ${e.line}: cramPrev[${k}] address ` +
                           `${e.cramPrev[k][0]} != cram address ` +
                           `${e.cram[k][0]}`);
          }
        }
      }
    }
  }
  /* the saved registers: the last entry of each kind with line <= the save
   * line (regs.RCRCount), else the base — the write landed in the register
   * and the chain is in steady state */
  const rcrCount = regs.RCRCount;
  const kinds = [["bxr", "BXR", 0x3FF], ["byr", "BYR", 0x1FF], ["cr", "CR", 0xFF]];
  for (const [field, reg, mask] of kinds) {
    let last = null;
    for (const e of entries) {
      if (e[field] != null && e.line <= rcrCount) last = e;
    }
    const want = last != null ? last[field] : base[field];
    if (want != null && (regs[reg] & mask) !== (want & mask)) {
      problems.push(`saved ${reg}=${regs[reg]} != table's ${want} ` +
                    `(last ${field} entry ${last ? last.line : "none"})`);
    }
  }
  /* the saved RCR holds the chain's re-arm: 0x40 + the line of the entry
   * after the last fired one (wrapping) */
  let lastIdx = -1;
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].line <= rcrCount) lastIdx = i;
  }
  const nextLine = entries[(lastIdx + 1) % entries.length].line;
  if (regs.RCR !== 0x40 + nextLine) {
    problems.push(`saved RCR=${regs.RCR} != chain's next arm ` +
                  `${0x40 + nextLine}`);
  }
  /* the saved colour table: baseCram plus every entry's writes in line
   * order (every cram entry must have fired before the save) */
  const words = new Array(512);
  for (let i = 0; i < 512; i++) {
    words[i] = raster.baseCram
      ? raster.baseCram[i]
      : (cram[i * 2] | (cram[i * 2 + 1] << 8));
  }
  for (const e of entries) {
    if (e.cram && e.line > rcrCount) {
      problems.push(`cram entry line ${e.line} > save line ${rcrCount}: ` +
                    `cannot be in the saved colour table`);
    }
    for (const [a, v] of (e.cram || [])) words[a] = v;
  }
  for (let i = 0; i < 512; i++) {
    const got = cram[i * 2] | (cram[i * 2 + 1] << 8);
    if (words[i] !== got) {
      problems.push(`cram entry ${i}: table ${words[i].toString(16)} != ` +
                    `state ${got.toString(16)}`);
      break;
    }
  }
  /* rows before the first cram entry of the frame show the previous
   * frame's colour table — only provable if the first entry fires at or
   * before the first captured row (vdwLine0); keep the invariant loud */
  const firstCram = entries.find((e) => e.cram);
  if (firstCram && firstCram.line > vdwLine0) {
    problems.push(`first cram entry line ${firstCram.line} > first ` +
                  `captured VDW line ${vdwLine0}`);
  }
  if (raster.base && raster.base.dcr != null && raster.base.dcr !== regs.DCR) {
    problems.push(`base.dcr ${raster.base.dcr} != saved DCR ${regs.DCR}`);
  }
  if (problems.length) {
    console.log(`${name}: raster.json does not match the save state:`);
    problems.forEach((p) => console.log(`  ${p}`));
  } else {
    console.log(`${name}: raster.json matches the save state`);
  }
  return problems;
}

module.exports = { checkRaster };
