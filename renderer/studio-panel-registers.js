/*
 * studio-panel-registers.js — the REGISTERS panel (cards #26 and #79), a
 * module of the studio since #102.
 *
 * ppu.toys' REGISTERS panel is the working example (Dennis showed it on
 * 2026-10-29, recorded on #79 in docs/PLAN.md): one searchable table of every
 * register the console has, a row each — address, name, HEX and DECIMAL
 * (editable), the bits high to low (clickable), the DECODED FIELDS with their
 * Lua names, a curve button per field and a POKED column — with a search box,
 * a group filter, a Poked-only toggle and an "N / total" count.  Enter or Tab
 * pokes, Escape cancels, the arrow keys move rows.
 *
 * This is that panel for the PC Engine.  The rows are the console's own
 * address space (docs/MANUALS.md §3 and H8-24): the VDC's R00-R13, the VCE's
 * CR/CTA/CTW at $0400-$0404, the ten PSG registers at $0800-$0809, the timer
 * at $0C00/$0C01 and the IRQ registers at $1402/$1403.  Register numbers,
 * names and titles are renderer/pce-panels.js's own VDC_REGISTERS table; the
 * PSG's names are renderer/pce-psg.js's REGISTERS; the bit layouts and their
 * manual pages are docs/MANUALS.md §3.2-§3.5 and §15's HuC6280 rows, which
 * pce-vram.js's decodeDcr already implements for DCR.  tests/check-pokes.js
 * holds this file to those tables, so the panel and the model cannot drift.
 *
 * A poke is keyframed (renderer/pce-pokes.js): editing a value sets a
 * keyframe at the current frame and the view follows at once; the curve
 * button opens that register's keyframes; undo/redo are the studio's; and
 * "Write to toy" puts the curves into the toy's own main.lua, refusing by the
 * toy host's rule (reg-forbidden) the registers a toy may not set.
 *
 * The panel talks to the page only through the studio API (#102, docs/STUDIO.md
 * §3.2): render.frame()/state()/length() for the values, poke()/keyframes()/
 * pokedRegs()/removePoke()/undo()/redo()/writePokes() for the editor, $ and
 * toast for the DOM.  It has no model of its own beyond the last draw.
 */
(function (root) {
  "use strict";
  var P = root.PCEStudio = root.PCEStudio || {};
  P.studioPanelModules = P.studioPanelModules || [];

  /* The row groups, in the console's own order (H8-24's device map). */
  var GROUPS = [
    { id: "VDC", label: "VDC", title: "the video display chip, $1FE000 (R00-R13)" },
    { id: "VCE", label: "VCE", title: "the colour encoder, $1FE400 ($0400-$0407)" },
    { id: "PSG", label: "PSG", title: "the sound chip, $1FE800 ($0800-$080F)" },
    { id: "TIMER", label: "TIMER", title: "the HuC6280's interval timer, $1FEC00" },
    { id: "IRQ", label: "IRQ", title: "the HuC6280's interrupt registers, $1FF400" }
  ];

  /* VDC bit layouts, docs/MANUALS.md §3.2-§3.5 (page refs in each row).  A
   * field's `lua` is the name a toy's reg() call takes, or "" where the toy
   * may not set that register (docs/TOYS.md's three-register table). */
  var VDC_FIELDS = {
    MAWR: [{ name: "MAWR", lo: 0, hi: 15, lua: "", note: "H7-5" }],
    MARR: [{ name: "MARR", lo: 0, hi: 15, lua: "", note: "H7-5" }],
    "VWR/VRR": [{ name: "VWR", lo: 0, hi: 15, lua: "", note: "H7-5" }],
    CR: [
      { name: "IE", lo: 0, hi: 3, lua: "", note: "H7-6 enable CC/OC/RC/VC" },
      { name: "EX", lo: 4, hi: 5, lua: "", note: "H7-6 external sync" },
      { name: "SB", lo: 6, hi: 6, lua: "CR", note: "H7-6 sprites on" },
      { name: "BB", lo: 7, hi: 7, lua: "CR", note: "H7-6 background on" },
      { name: "TE", lo: 8, hi: 9, lua: "", note: "H7-6 DISP select" },
      { name: "DR", lo: 10, hi: 10, lua: "", note: "H7-6 DRAM refresh" },
      { name: "IW", lo: 11, hi: 12, lua: "", note: "H7-6 increment width" }
    ],
    RCR: [{ name: "RCR", lo: 0, hi: 9, lua: "", note: "H7-7 line match" }],
    BXR: [{ name: "BXR", lo: 0, hi: 9, lua: "BXR", note: "H7-7" }],
    BYR: [{ name: "BYR", lo: 0, hi: 8, lua: "BYR", note: "H7-7" }],
    MWR: [
      { name: "VM", lo: 0, hi: 1, lua: "", note: "H7-8 VRAM access width" },
      { name: "SM", lo: 2, hi: 3, lua: "", note: "H7-8 sprite access width" },
      { name: "SCREEN", lo: 4, hi: 6, lua: "", note: "H7-8/9 BAT size" },
      { name: "CM", lo: 7, hi: 7, lua: "", note: "H7-9 CG select" }
    ],
    HSR: [
      { name: "HSW", lo: 0, hi: 4, lua: "", note: "H7-9 sync width-1" },
      { name: "HDS", lo: 8, hi: 14, lua: "", note: "H7-9 back porch-1" }
    ],
    HDR: [
      { name: "HDW", lo: 0, hi: 6, lua: "", note: "H7-10 chars-1" },
      { name: "HDE", lo: 8, hi: 14, lua: "", note: "H7-10 display end-1" }
    ],
    VPR: [
      { name: "VSW", lo: 0, hi: 4, lua: "", note: "H7-10 sync width-1" },
      { name: "VDS", lo: 8, hi: 15, lua: "", note: "H7-10 back porch-2" }
    ],
    VDR: [{ name: "VDW", lo: 0, hi: 8, lua: "", note: "H7-10 lines-1" }],
    VCR: [{ name: "VCR", lo: 0, hi: 7, lua: "", note: "H7-11 front porch N" }],
    DCR: [
      { name: "DSC", lo: 0, hi: 0, lua: "", note: "H7-11 SATB-done IRQ" },
      { name: "DVC", lo: 1, hi: 1, lua: "", note: "H7-11 VRAM-done IRQ" },
      { name: "SI/D", lo: 2, hi: 2, lua: "", note: "H7-11 source decrements" },
      { name: "DI/D", lo: 3, hi: 3, lua: "", note: "H7-11 dest decrements" },
      { name: "DSR", lo: 4, hi: 4, lua: "", note: "H7-11 SATB auto-repeat" }
    ],
    SOUR: [{ name: "SOUR", lo: 0, hi: 15, lua: "", note: "H7-11 transfer source" }],
    DESR: [{ name: "DESR", lo: 0, hi: 15, lua: "", note: "H7-11 transfer dest" }],
    LENR: [{ name: "LENR", lo: 0, hi: 15, lua: "", note: "H7-11 length-1" }],
    DVSSR: [{ name: "DVSSR", lo: 0, hi: 15, lua: "", note: "H7-11 SAT source" }]
  };

  /* The VCE's three write registers (docs/MANUALS.md §6/§15: $0400 control,
   * $0402 colour-table address, $0404 colour-table write).  DCC is the dot
   * clock the renderer reads (#27); D2 is the "blur" bit pcetech measures and
   * our model does not use; D7 is the monochrome bit. */
  var VCE_ROWS = [
    { addr: 0x0400, name: "CR", reg: "VCECR", bits: 8,
      title: "control: dot clock, blur, mono",
      fields: [
        { name: "DCC", lo: 0, hi: 1, lua: "", note: "the dot clock (#27)" },
        { name: "BLUR", lo: 2, hi: 2, lua: "", note: "pcetech's blur edge" },
        { name: "MONO", lo: 7, hi: 7, lua: "", note: "black and white" }
      ] },
    { addr: 0x0402, name: "CTA", reg: "VCE_CTA", bits: 9,
      title: "colour-table address",
      fields: [{ name: "CTA", lo: 0, hi: 8, lua: "", note: "CRAM entry 0-511" }] },
    { addr: 0x0404, name: "CTW", reg: "VCE_CTW", bits: 9,
      title: "colour-table write (GGRRRBBB; the address advances)",
      fields: [{ name: "GGRRRBBB", lo: 0, hi: 8, lua: "", note: "H6-3" }] }
  ];

  /* The PSG's ten registers, renderer/pce-psg.js's REGISTERS order. */
  var PSG_FIELDS = [
    [{ name: "SEL", lo: 0, hi: 2, lua: "", note: "PB-2 channel 0-5" }],
    [{ name: "L", lo: 4, hi: 7, lua: "", note: "PB-3 main volume" },
     { name: "R", lo: 0, hi: 3, lua: "", note: "PB-3 main volume" }],
    [{ name: "F (low)", lo: 0, hi: 7, lua: "", note: "PB-3" }],
    [{ name: "F (high)", lo: 0, hi: 3, lua: "", note: "PB-3" }],
    [{ name: "VOL", lo: 0, hi: 4, lua: "", note: "PB-3 channel level" },
     { name: "DDA", lo: 6, hi: 6, lua: "", note: "PB-3 DDA mode" },
     { name: "CHON", lo: 7, hi: 7, lua: "", note: "PB-3 channel on" }],
    [{ name: "L", lo: 4, hi: 7, lua: "", note: "PB-4 balance" },
     { name: "R", lo: 0, hi: 3, lua: "", note: "PB-4 balance" }],
    [{ name: "WAVE", lo: 0, hi: 4, lua: "", note: "PB-4 one 5-bit sample" }],
    [{ name: "NF", lo: 0, hi: 4, lua: "", note: "PB-6 noise frequency" },
     { name: "NOISE", lo: 7, hi: 7, lua: "", note: "PB-6 noise enable" }],
    [{ name: "LF", lo: 0, hi: 7, lua: "", note: "PB-6 LFO frequency" }],
    [{ name: "LFCTL", lo: 0, hi: 2, lua: "", note: "PB-6 LFO control" },
     { name: "TRG", lo: 7, hi: 7, lua: "", note: "PB-6 LFO trigger" }]
  ];

  /* The HuC6280's timer and interrupt registers (docs/MANUALS.md §8: H8-16,
   * H8-20..H8-24).  The timer's own doc is the toy host's TIMER_API (#45); the
   * IRQ registers are the CPU's and the view does not model them. */
  var TIMER_ROWS = [
    { addr: 0x0C00, name: "TMR", reg: "TIMER_RELOAD", bits: 7,
      title: "timer reload (H8-20: 7 bits, $00 counts as 1)",
      fields: [{ name: "RELOAD", lo: 0, hi: 6, lua: "", note: "H8-20" }] },
    { addr: 0x0C01, name: "TMCR", reg: "TIMER_CTRL", bits: 1,
      title: "timer start/stop (H8-21)",
      fields: [{ name: "START", lo: 0, hi: 0, lua: "", note: "H8-21" }] }
  ];
  var IRQ_ROWS = [
    { addr: 0x1402, name: "IRQD", reg: "IRQ_DISABLE", bits: 8,
      title: "IRQ disable: 0 = enabled (H8-16, H8-24)",
      fields: [
        { name: "IRQ2D", lo: 0, hi: 0, lua: "", note: "H8-16" },
        { name: "IRQ1D", lo: 1, hi: 1, lua: "", note: "H8-16" },
        { name: "TIQD", lo: 2, hi: 2, lua: "", note: "H8-16" }
      ] },
    { addr: 0x1403, name: "IRQR", reg: "IRQ_REQUEST", bits: 8,
      title: "IRQ request: reads IRQ2/IRQ1/TIQ; a write resets TIQ (H8-15)",
      fields: [
        { name: "IRQ2", lo: 0, hi: 0, lua: "", note: "H8-15" },
        { name: "IRQ1", lo: 1, hi: 1, lua: "", note: "H8-15" },
        { name: "TIQ", lo: 2, hi: 2, lua: "", note: "H8-15" }
      ] }
  ];

  function hexWord(v, width) {
    if (v == null) return "—";
    var s = (v >>> 0).toString(16).toUpperCase();
    while (s.length < (width || 4)) s = "0" + s;
    return "$" + s;
  }

  function maskFor(bits) {
    return bits >= 32 ? 0xFFFFFFFF : ((1 << bits) - 1) >>> 0;
  }

  /* A typed value.  `radix` is the box it came from: the HEX column reads
   * "40" as $40, the DECIMAL column reads it as 40, and a leading $ or 0x
   * says hex either way. */
  function parseNumber(text, radix) {
    var s = String(text == null ? "" : text).trim();
    if (!s) return null;
    if (s.charAt(0) === "$") {
      s = s.slice(1);
      return /^[0-9a-f]+$/i.test(s) ? parseInt(s, 16) : null;
    }
    if (/^0x/i.test(s)) {
      s = s.slice(2);
      return /^[0-9a-f]+$/i.test(s) ? parseInt(s, 16) : null;
    }
    if (radix === 16)
      return /^[0-9a-f]+$/i.test(s) ? parseInt(s, 16) : null;
    if (/^[0-9]+$/.test(s)) return parseInt(s, 10);
    if (/^[0-9a-f]+$/i.test(s)) return parseInt(s, 16);
    return null;
  }

  P.studioPanelModules.push({
    id: "registers",
    register: function (studio) {
      var built = false;
      var els = {};            /* the toolbar and containers */
      var rowEls = {};         /* key -> {row, hex, dec, bits, fields, poked, curve} */
      var rows = [];           /* the catalogue, in table order */
      var query = "";
      var filter = "all";
      var pokedOnly = false;
      var curveOpen = "";      /* the register whose curve box is open */
      var note = "";
      var lastSt = null;

      /* ---- the catalogue ------------------------------------------------ */

      function vdcRows() {
        var list = (P.panels && P.panels.VDC_REGISTERS) || [];
        var out = [];
        for (var i = 0; i < list.length; i++) {
          var def = list[i];
          if (def.name === "-") continue;
          var fields = VDC_FIELDS[def.name] || [{ name: def.name, lo: 0, hi: 15,
                                                  lua: "", note: "" }];
          var bits = 0;
          for (var k = 0; k < fields.length; k++)
            if (fields[k].hi + 1 > bits) bits = fields[k].hi + 1;
          /* R02 is the one VDC name with a slash in it; the register a poke
           * names is VWR (its write side — the read side is a different
           * port's job). */
          var reg = def.name === "VWR/VRR" ? "VWR" : def.name;
          out.push({
            key: "VDC" + (def.number < 16 ? "0" : "") + def.number.toString(16).toUpperCase(),
            group: "VDC", addr: def.number, name: def.name, reg: reg,
            title: def.title, bits: bits, fields: fields
          });
        }
        return out;
      }

      function psgRows() {
        var list = (P.psg && P.psg.REGISTERS) || [];
        var out = [];
        for (var i = 0; i < list.length; i++) {
          var def = list[i];
          var n = def.n < 10 ? "0" + def.n : String(def.n);
          out.push({
            key: "PSG" + n, group: "PSG", addr: 0x0800 + def.n,
            name: def.name, reg: "PSG" + n, title: def.what,
            bits: 8, fields: PSG_FIELDS[def.n] || []
          });
        }
        return out;
      }

      function buildCatalogue() {
        var out = vdcRows();
        var i;
        for (i = 0; i < VCE_ROWS.length; i++) {
          var v = VCE_ROWS[i];
          out.push({ key: "VCE" + v.addr.toString(16).toUpperCase(), group: "VCE",
                     addr: v.addr, name: v.name, reg: v.reg, title: v.title,
                     bits: v.bits, fields: v.fields });
        }
        var psg = psgRows();
        for (i = 0; i < psg.length; i++) out.push(psg[i]);
        var timer = TIMER_ROWS, irq = IRQ_ROWS;
        for (i = 0; i < timer.length; i++)
          out.push({ key: "TMR" + timer[i].addr, group: "TIMER", addr: timer[i].addr,
                     name: timer[i].name, reg: timer[i].reg, title: timer[i].title,
                     bits: timer[i].bits, fields: timer[i].fields });
        for (i = 0; i < irq.length; i++)
          out.push({ key: "IRQ" + irq[i].addr, group: "IRQ", addr: irq[i].addr,
                     name: irq[i].name, reg: irq[i].reg, title: irq[i].title,
                     bits: irq[i].bits, fields: irq[i].fields });
        return out;
      }

      /* ---- the row's value --------------------------------------------- */

      /* The line's VDC values come from the panels model (the same objects
       * the renderer was given); anything the model does not carry reads 0
       * and says so.  The value shown in HEX/DEC is the poke in force at the
       * frame when there is one, otherwise what the console has. */
      function naturalValue(row, st) {
        if (!st) return { value: 0, source: "no frame yet" };
        if (row.group === "VDC" && P.panels) {
          var regs = P.panels.vdcRegisters(st, studio.render.panelLine(st));
          for (var i = 0; i < regs.length; i++) {
            if (regs[i].number === row.addr)
              return { value: regs[i].value == null ? 0 : regs[i].value,
                       source: regs[i].source || "not in a picture" };
          }
        }
        if (row.reg === "VCECR" && st.regs && st.regs.VCECR != null)
          return { value: st.regs.VCECR, source: "state" };
        return { value: 0, source: "not modelled by the view" };
      }

      function shownValue(row, st) {
        var frame = studio.render.currentFrame();
        var poked = studio.pokes().length
          ? valueInForce(row.reg, frame) : null;
        var nat = naturalValue(row, st);
        return {
          value: poked == null ? nat.value : poked,
          natural: nat.value,
          source: poked == null ? nat.source : "poked",
          poked: poked != null
        };
      }

      function valueInForce(reg, frame) {
        var keys = studio.keyframes(reg);
        var v = null;
        for (var i = 0; i < keys.length; i++)
          if (keys[i].frame <= frame) v = keys[i].value;
        return v;
      }

      function keyCount(reg) { return studio.keyframes(reg).length; }

      /* ---- the DOM ----------------------------------------------------- */

      function el(tag, cls, id, text) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (id) e.id = id;
        if (text != null) e.textContent = text;
        return e;
      }

      /* The panel's own CSS travels with the module, so studio.html gains one
       * script tag and nothing else (#79's rule for this card). */
      function installStyle() {
        if (els.style || !document || !document.createElement) return;
        var css = [
          "#panel-registers .regr-bar{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:0 0 8px;padding:0 0 8px;border-bottom:1px solid var(--line2)}",
          "#panel-registers .regr-q{background:var(--pane2);color:var(--text);border:1px solid var(--line);border-radius:4px;font:11px var(--mono);padding:3px 6px;width:150px}",
          "#panel-registers .regr-filter{background:var(--pane2);color:var(--text2);border:1px solid var(--line);border-radius:4px;font:11px var(--mono);padding:3px}",
          "#panel-registers .regr-toggle{background:var(--chipbg);border:1px solid var(--line2);color:var(--text2);font:500 10px var(--mono);letter-spacing:.06em;padding:4px 7px;border-radius:4px}",
          "#panel-registers .regr-toggle.is-on{color:var(--cyan);border-color:var(--cyan)}",
          "#panel-registers .regr-count{margin-left:auto;color:var(--dim);font:10px var(--mono)}",
          "#panel-registers .regr-head,#panel-registers .regr{display:grid;grid-template-columns:4.2rem 4.4rem 4.6rem 4.6rem minmax(0,1fr) 1.7rem 3.4rem;gap:4px;align-items:center}",
          "#panel-registers .regr-head{color:var(--dim);font:9px var(--mono);letter-spacing:.1em;padding:2px 0;border-bottom:1px solid var(--line2);margin-bottom:2px}",
          "#panel-registers .regr-head span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
          "#panel-registers .regr-head span:last-child{text-align:right}",
          "#panel-registers .regr{border-bottom:1px solid var(--line2);padding:2px 0}",
          "#panel-registers .regr.is-poked{background:color-mix(in srgb,var(--cyan) 7%,transparent)}",
          "#panel-registers .regr-addr{color:var(--dim);font:10px var(--mono)}",
          "#panel-registers .regr-name{color:var(--text);font:600 10px var(--mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
          "#panel-registers .regr-hex,#panel-registers .regr-dec{background:var(--code);color:var(--text2);border:1px solid var(--line2);border-radius:3px;font:10px var(--mono);padding:1px 4px;width:100%;min-width:0}",
          "#panel-registers .regr-hex:focus,#panel-registers .regr-dec:focus{outline:1px solid var(--accent);color:var(--text)}",
          "#panel-registers .regr-bits{display:flex;gap:1px;flex-wrap:wrap}",
          "#panel-registers .regr-bit{background:var(--chipbg);border:1px solid var(--line2);color:var(--faint);font:9px var(--mono);padding:1px 2px;border-radius:2px;min-width:1.1rem}",
          "#panel-registers .regr-bit.on{color:var(--text);border-color:var(--line)}",
          "#panel-registers .regr-bit:hover{border-color:var(--accent)}",
          "#panel-registers .regr-fields{color:var(--dim);font:9px var(--mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
          "#panel-registers .regr-fields b{color:var(--text2);font-weight:600}",
          "#panel-registers .regr-curve{background:var(--chipbg);border:1px solid var(--line2);color:var(--cyan);font:10px var(--mono);border-radius:3px;padding:1px 4px}",
          "#panel-registers .regr-curve.is-on{background:var(--raised);border-color:var(--cyan)}",
          "#panel-registers .regr-poked{color:var(--cyan);font:9px var(--mono);text-align:right}",
          "#panel-registers .regr-note{color:var(--dim);font:10px/1.45 var(--mono);margin:6px 0 0;white-space:pre-wrap}",
          "#panel-registers .regr-curvebox{margin:8px 0 0;padding:8px;border:1px solid var(--line);border-radius:5px;background:var(--pane2)}",
          "#panel-registers .regr-curvebox h3{margin:0 0 4px}",
          "#panel-registers .regr-key{display:flex;gap:6px;align-items:center;font:10px var(--mono);color:var(--text2)}",
          "#panel-registers .regr-canvas{width:100%;height:54px;display:block;background:#08090c;border:1px solid var(--line2);margin:4px 0}"
        ].join("\n");
        var style = document.createElement("style");
        style.type = "text/css";
        style.textContent = css;
        var head = document.head || document.body;
        if (head && head.appendChild) head.appendChild(style);
        els.style = style;
      }

      function build() {
        if (built) return true;
        var panel = studio.$("panel-registers");
        if (!panel || !document || !document.createElement) return false;
        installStyle();
        rows = buildCatalogue();
        /* The #26 <pre> stays in the page (the card may not edit the markup);
         * this table is the panel now. */
        var old = studio.$("reg-table");
        if (old && old.style) old.style.display = "none";

        var bar = el("div", "regr-bar");
        var q = el("input", "regr-q", "reg-q");
        q.type = "search";
        q.placeholder = "Search address or name";
        q.title = "The register table: address, name, hex, decimal, bits, fields";
        q.addEventListener("input", function () {
          query = String(q.value || "").trim().toLowerCase();
          applyFilter();
        });
        q.addEventListener("keydown", function (e) {
          if (e.key === "Escape") { q.value = ""; query = ""; applyFilter(); }
        });
        var sel = el("select", "regr-filter", "reg-filter");
        var all = el("option", null, null, "All registers");
        all.value = "all";
        sel.appendChild(all);
        for (var g = 0; g < GROUPS.length; g++) {
          var op = el("option", null, null, GROUPS[g].label);
          op.value = GROUPS[g].id;
          sel.appendChild(op);
        }
        sel.addEventListener("change", function () {
          filter = String(sel.value || "all");
          applyFilter();
        });
        var only = el("button", "regr-toggle", "reg-pokedonly", "Poked only");
        only.type = "button";
        only.title = "Show only the registers with a keyframe";
        only.addEventListener("click", function () {
          pokedOnly = !pokedOnly;
          only.classList.toggle("is-on", pokedOnly);
          only.setAttribute("aria-pressed", String(pokedOnly));
          applyFilter();
        });
        var count = el("span", "regr-count", "reg-count", "0 / 0");
        var write = el("button", "btn-mini", "reg-write", "Write to toy");
        write.type = "button";
        write.title = "Put the pokes into the toy's main.lua as one generated " +
          "block, and run it";
        write.addEventListener("click", function () {
          try {
            var report = studio.writePokes();
            note = report.changed
              ? "written into main.lua: " + report.written.join(", ") +
                (report.refused.length
                  ? "\nnot writable by a toy: " + report.refused.map(function (r) {
                      return r.reg + " (" + r.code + ")";
                    }).join(", ")
                  : "")
              : (report.refused.length
                  ? "no toy may set " + report.refused.map(function (r) {
                      return r.reg;
                    }).join(", ") + " (reg-forbidden); nothing was written"
                  : "set a register first");
            if (!report.changed && !report.refused.length)
              note = "set a register first — a poke is a keyframe on a register";
            if (report.refused.length && report.changed)
              studio.toast("wrote " + report.written.length + " register(s); " +
                           report.refused.length + " cannot be written by a toy");
          } catch (e) {
            note = (e && e.code ? e.code + ": " : "") +
                   (e && e.message ? e.message : String(e));
            studio.toast(note);
          }
          draw(lastSt);
        });
        bar.appendChild(q);
        bar.appendChild(sel);
        bar.appendChild(only);
        bar.appendChild(write);
        bar.appendChild(count);
        panel.appendChild(bar);
        els.q = q; els.filter = sel; els.only = only; els.count = count;
        els.write = write; els.bar = bar;

        var head = el("div", "regr-head");
        ["address", "register", "hex", "decimal", "bits (high → low) · fields",
         "curve", "poked"].forEach(function (t) { head.appendChild(el("span", null, null, t)); });
        els.head = head;

        var body = el("div", "regr-rows", "reg-rows");
        els.body = body;

        for (var i = 0; i < rows.length; i++) buildRow(rows[i], body);

        var box = el("div", "regr-curvebox", "reg-curvebox");
        box.hidden = true;
        var boxTitle = el("h3", null, "reg-curve-title", "CURVE");
        box.appendChild(boxTitle);
        var addBtn = el("button", "btn-mini", "reg-key-add", "+ key at this frame");
        addBtn.type = "button";
        addBtn.addEventListener("click", function () { addKeyHere(); });
        var clearBtn = el("button", "btn-mini", "reg-key-clear", "Clear curve");
        clearBtn.type = "button";
        clearBtn.addEventListener("click", function () {
          if (!curveOpen) return;
          var keys = studio.keyframes(curveOpen);
          for (var k = 0; k < keys.length; k++) studio.removePoke(curveOpen, keys[k].frame);
          draw(lastSt);
        });
        var closeBtn = el("button", "btn-mini", "reg-key-close", "Close");
        closeBtn.type = "button";
        closeBtn.addEventListener("click", function () {
          curveOpen = "";
          box.hidden = true;
          draw(lastSt);
        });
        var canvas = el("canvas", "regr-canvas", "reg-curve-canvas");
        canvas.width = 320; canvas.height = 54;
        var keyList = el("div", "regr-keys", "reg-keys");
        box.appendChild(canvas);
        box.appendChild(keyList);
        var boxBar = el("div", "regr-bar");
        boxBar.appendChild(addBtn); boxBar.appendChild(clearBtn);
        boxBar.appendChild(closeBtn);
        box.appendChild(boxBar);
        /* The order is the reading order: the tools, the curve box when it is
         * open, then the table — a curve opened from a row appears at the top
         * of the dock, where it is seen, not below 35 rows of table. */
        panel.appendChild(box);
        panel.appendChild(head);
        panel.appendChild(body);
        els.box = box; els.boxTitle = boxTitle; els.canvas = canvas;
        els.keyList = keyList; els.addBtn = addBtn; els.clearBtn = clearBtn;
        els.closeBtn = closeBtn;

        var noteEl = el("div", "regr-note", "reg-note", "");
        panel.appendChild(noteEl);
        els.note = noteEl;

        built = true;
        applyFilter();
        return true;
      }

      function buildRow(row, host) {
        var r = el("div", "regr");
        r.id = "reg-row-" + row.key;
        r.dataset.reg = row.reg;
        r.title = row.name + " · " + row.title;
        var addr = el("span", "regr-addr", null, hexWord(row.addr, 4));
        var name = el("span", "regr-name", null, row.name);
        var hex = el("input", "regr-hex", "reg-hex-" + row.key);
        hex.type = "text"; hex.value = "0"; hex.spellcheck = false;
        hex.title = "HEX — type a value and press Enter or Tab to poke it";
        hex.addEventListener("keydown", function (e) { editKey(row, hex, e); });
        hex.addEventListener("change", function () { commit(row, hex, 16); });
        var dec = el("input", "regr-dec", "reg-dec-" + row.key);
        dec.type = "text"; dec.value = "0"; dec.spellcheck = false;
        dec.title = "DECIMAL — type a value and press Enter or Tab to poke it";
        dec.addEventListener("keydown", function (e) { editKey(row, dec, e); });
        dec.addEventListener("change", function () { commit(row, dec, 10); });
        var bits = el("span", "regr-bits");
        var bitEls = [];
        for (var n = row.bits - 1; n >= 0; n--) {
          var b = el("button", "regr-bit", "reg-bit-" + row.key + "-" + n,
                     String(n));
          b.type = "button";
          b.title = "bit " + n + (n >= 10 ? " · " + hexWord(1 << n, 4) : "");
          (function (bitN) {
            b.addEventListener("click", function () { toggleBit(row, bitN); });
          })(n);
          bits.appendChild(b);
          bitEls[n] = b;
        }
        var fields = el("span", "regr-fields", "reg-fields-" + row.key, "");
        var curve = el("button", "regr-curve", "reg-curve-" + row.reg, "∿");
        curve.type = "button";
        curve.title = "curve — keyframe " + row.reg + " over time";
        curve.addEventListener("click", function () { toggleCurve(row.reg); });
        var poked = el("span", "regr-poked", "reg-poked-" + row.key, "");
        /* the bits and the decoded fields share the wide column: the bit row
         * first, the fields under it */
        var wide = el("div");
        wide.appendChild(bits);
        wide.appendChild(fields);
        r.appendChild(addr); r.appendChild(name); r.appendChild(hex);
        r.appendChild(dec); r.appendChild(wide); r.appendChild(curve);
        r.appendChild(poked);
        host.appendChild(r);
        rowEls[row.key] = { row: row, root: r, hex: hex, dec: dec,
                            bits: bitEls, fields: fields, poked: poked,
                            curve: curve };
      }

      /* ---- editing ----------------------------------------------------- */

      function maskValue(row, v) { return (v & maskFor(row.bits)) >>> 0; }

      function commit(row, input, radix) {
        var v = parseNumber(input.value, radix);
        if (v == null) {
          note = row.reg + ": \"" + input.value + "\" is not a number";
          draw(lastSt);
          return false;
        }
        v = maskValue(row, v);
        studio.poke(row.reg, v, studio.render.currentFrame());
        note = row.reg + " poked at frame " + studio.render.currentFrame() +
          " with " + hexWord(v, 4);
        draw(lastSt);
        return true;
      }

      function editKey(row, input, e) {
        var key = e.key || "";
        var radix = rowEls[row.key] && input === rowEls[row.key].dec ? 10 : 16;
        if (key === "Enter") {
          e.preventDefault();
          commit(row, input, radix);
          moveRow(row, 1, input);
        } else if (key === "Tab") {
          /* Tab pokes and moves like Enter, but keeps the browser's own focus
           * order sensible: the next visible row's hex box. */
          e.preventDefault();
          commit(row, input, radix);
          moveRow(row, e.shiftKey ? -1 : 1, input);
        } else if (key === "Escape") {
          e.preventDefault();
          input.blur && input.blur();
          draw(lastSt);
        } else if (key === "ArrowDown" || key === "ArrowUp") {
          e.preventDefault();
          moveRow(row, key === "ArrowDown" ? 1 : -1, input);
        }
      }

      /* Move to the next visible row's hex box (the row's own column when the
       * user was in the decimal box). */
      function moveRow(row, step, from) {
        var dec = from === rowEls[row.key].dec;
        for (var i = 0; i < rows.length; i++) {
          if (rows[i].key !== row.key) continue;
          var j = i + step;
          while (j >= 0 && j < rows.length) {
            var target = rowEls[rows[j].key];
            if (target && !target.root.hidden) {
              var el2 = dec ? target.dec : target.hex;
              if (el2.focus) el2.focus();
              if (el2.select) el2.select();
              return true;
            }
            j += step;
          }
          return false;
        }
        return false;
      }

      function toggleBit(row, n) {
        var shown = shownValue(row, lastSt);
        var v = maskValue(row, (shown.value || 0) ^ (1 << n));
        studio.poke(row.reg, v, studio.render.currentFrame());
        note = row.reg + " bit " + n + " → " + hexWord(v, 4);
        draw(lastSt);
        return v;
      }

      function toggleCurve(reg) {
        curveOpen = curveOpen === reg ? "" : reg;
        draw(lastSt);
        return curveOpen;
      }

      function addKeyHere() {
        if (!curveOpen) return null;
        var row = null;
        for (var i = 0; i < rows.length; i++) if (rows[i].reg === curveOpen) row = rows[i];
        if (!row) return null;
        var st = lastSt;
        var shown = shownValue(row, st);
        studio.poke(row.reg, shown.value, studio.render.currentFrame());
        draw(lastSt);
        return studio.keyframes(row.reg).length;
      }

      /* ---- filtering and drawing -------------------------------------- */

      function matches(row) {
        if (filter !== "all" && row.group !== filter) return false;
        if (pokedOnly && keyCount(row.reg) === 0) return false;
        if (!query) return true;
        var addr = hexWord(row.addr, 4).toLowerCase();
        return row.name.toLowerCase().indexOf(query) >= 0 ||
               row.reg.toLowerCase().indexOf(query) >= 0 ||
               addr.indexOf(query) >= 0 ||
               row.title.toLowerCase().indexOf(query) >= 0;
      }

      function applyFilter() {
        var shown = 0;
        for (var i = 0; i < rows.length; i++) {
          var re = rowEls[rows[i].key];
          if (!re) continue;
          var ok = matches(rows[i]);
          if (re.root.style) re.root.style.display = ok ? "" : "none";
          re.root.hidden = !ok;
          if (ok) shown++;
        }
        if (els.count) els.count.textContent = shown + " / " + rows.length;
        var s = studio.render.state();
        draw(s, true);
        return shown;
      }

      function fieldText(row, value) {
        var out = [];
        for (var i = 0; i < row.fields.length; i++) {
          var f = row.fields[i];
          var w = f.hi - f.lo + 1;
          var v = w >= 32 ? value : (value >>> f.lo) & maskFor(w);
          out.push(f.name + " " + v + (f.lua ? " (lua " + f.lua + ")" : ""));
        }
        return out.join(" · ");
      }

      function drawCurve(st) {
        if (!els.box) return;
        if (!curveOpen) {
          els.box.hidden = true;
          /* the keys' buttons go with the box, so a stale one cannot act on
           * whatever register the box shows next */
          while (els.keyList && els.keyList.firstChild)
            els.keyList.removeChild(els.keyList.firstChild);
          return;
        }
        els.box.hidden = false;
        var reg = curveOpen;      /* the register this draw's buttons act on */
        var row = null, i;
        for (i = 0; i < rows.length; i++) if (rows[i].reg === reg) row = rows[i];
        var keys = studio.keyframes(reg);
        els.boxTitle.textContent = "CURVE · " + curveOpen +
          (row ? " (" + row.name + " " + hexWord(row.addr, 4) + ")" : "") +
          " · " + keys.length + " key" + (keys.length === 1 ? "" : "s");
        while (els.keyList.firstChild)
          els.keyList.removeChild(els.keyList.firstChild);
        if (!keys.length) {
          els.keyList.appendChild(el("div", "regr-key", null,
            "no keyframes yet — edit the register, or use + key at this frame"));
        }
        for (i = 0; i < keys.length; i++) {
          (function (k) {
            var line = el("div", "regr-key");
            var label = el("span", null, null,
              "frame " + k.frame + " · " + hexWord(k.value, 4) + " (" + k.value + ")");
            var del = el("button", "btn-mini", "reg-key-del-" + k.frame, "×");
            del.type = "button";
            del.title = "remove this keyframe";
            del.addEventListener("click", function () {
              studio.removePoke(reg, k.frame);
              draw(lastSt);
            });
            line.appendChild(label);
            line.appendChild(del);
            els.keyList.appendChild(line);
          })(keys[i]);
        }
        var canvas = els.canvas;
        if (!canvas || !canvas.getContext) return;
        var c = canvas.getContext("2d");
        /* draw at the size the DOM gives the canvas, so the box's text is not
         * stretched by the CSS width (the stub DOM has no layout: 320) */
        if (canvas.clientWidth) canvas.width = Math.max(160, canvas.clientWidth);
        var w = canvas.width || 320, h = canvas.height || 54;
        c.fillStyle = "#08090c"; c.fillRect(0, 0, w, h);
        var length = Math.max(1, studio.render.length() - 1);
        /* The vertical range is the keys' own, not the register's: a $000B
         * on a 10-bit BXR is otherwise a flat line on the floor of the box.
         * The scale is the curve's, so getMin/getMax are labelled instead. */
        var lo = keys.length ? keys[0].value : 0;
        var hi = lo;
        for (i = 1; i < keys.length; i++) {
          if (keys[i].value < lo) lo = keys[i].value;
          if (keys[i].value > hi) hi = keys[i].value;
        }
        if (hi === lo) { hi = lo + 1; }
        var yOf = function (v) {
          return h - 3 - ((v - lo) / (hi - lo)) * (h - 6);
        };
        c.strokeStyle = "#5fc9e8"; c.lineWidth = 1;
        c.beginPath();
        c.moveTo(0, yOf(keys.length ? keys[0].value : 0));
        for (i = 0; i < keys.length; i++) {
          c.lineTo((keys[i].frame / length) * w, yOf(keys[i].value));
        }
        c.lineTo(w, yOf(keys.length ? keys[keys.length - 1].value : 0));
        c.stroke();
        c.fillStyle = "#ff9540";
        for (i = 0; i < keys.length; i++) {
          var kx = (keys[i].frame / length) * w;
          c.fillRect(kx - 1.5, yOf(keys[i].value) - 1.5, 3, 3);
        }
        c.fillStyle = "#858d9c";
        c.fillText(String(hi), 3, 10);
        c.fillText(String(lo), 3, h - 3);
        c.fillText("0", w - 10, h - 3);
        c.fillText(String(length), w - 28, h - 3);
      }

      function draw(st, filtered) {
        lastSt = st || lastSt;
        if (!build()) return;
        var s = lastSt;
        var frame = studio.render.currentFrame();
        for (var i = 0; i < rows.length; i++) {
          var row = rows[i], re = rowEls[row.key];
          if (!re) continue;
          var shown = shownValue(row, s);
          var v = shown.value || 0;
          /* do not fight the person's cursor: an input being edited keeps
           * its text until the next poke or draw */
          if (!(document.activeElement === re.hex)) re.hex.value = (v >>> 0).toString(16).toUpperCase();
          if (!(document.activeElement === re.dec)) re.dec.value = String(v);
          for (var n = 0; n < re.bits.length; n++) {
            if (!re.bits[n]) continue;
            var on = ((v >>> n) & 1) === 1;
            re.bits[n].classList.toggle("on", on);
            re.bits[n].setAttribute("aria-pressed", String(on));
          }
          re.fields.textContent = fieldText(row, v);
          re.poked.textContent = keyCount(row.reg)
            ? (shown.poked ? "● " : "") + keyCount(row.reg) + " key" +
              (keyCount(row.reg) === 1 ? "" : "s")
            : "";
          re.root.classList.toggle("is-poked", shown.poked);
          re.root.title = row.name + " · " + row.title + " · " + shown.source +
            " · frame " + frame;
        }
        if (els.note) {
          els.note.textContent = note ||
            "A poke is a keyframe: edit HEX, DECIMAL or a bit and the register " +
            "holds that value from the current frame on, in the view only. " +
            "The ∿ button shows the curve; Write to toy puts the curves into " +
            "main.lua (BXR, BYR and CR are the registers a toy may set).";
        }
        drawCurve(s);
        if (filtered) applyFilterCount();
      }

      function applyFilterCount() {
        var shown = 0;
        for (var i = 0; i < rows.length; i++) if (matches(rows[i])) shown++;
        if (els.count) els.count.textContent = shown + " / " + rows.length;
      }

      /* ---- the evidence surface ---------------------------------------- */

      function summary(st) {
        st = st || lastSt;
        var out = [];
        for (var i = 0; i < rows.length; i++) {
          var row = rows[i];
          var shown = shownValue(row, st);
          out.push({
            key: row.key, group: row.group, addr: hexWord(row.addr, 4),
            name: row.name, reg: row.reg, bits: row.bits,
            value: shown.value, natural: shown.natural, source: shown.source,
            poked: shown.poked, keys: keyCount(row.reg),
            visible: matches(row),
            fields: row.fields.length, lua: row.fields.map(function (f) {
              return f.lua;
            }).filter(function (x) { return !!x; })
          });
        }
        return out;
      }

      var api = {
        draw: function () { draw(studio.render.state()); return api; },
        rows: summary,
        count: function () {
          var shown = 0;
          for (var i = 0; i < rows.length; i++) if (matches(rows[i])) shown++;
          return { shown: shown, total: rows.length,
                   text: els.count ? els.count.textContent : "" };
        },
        search: function (q) {
          query = String(q == null ? "" : q).trim().toLowerCase();
          if (els.q) els.q.value = String(q == null ? "" : q);
          applyFilter();
          return api.count();
        },
        filter: function (group) {
          filter = group || "all";
          if (els.filter) els.filter.value = filter;
          applyFilter();
          return api.count();
        },
        pokedOnly: function (on) {
          pokedOnly = !!on;
          if (els.only) {
            els.only.classList.toggle("is-on", pokedOnly);
            els.only.setAttribute("aria-pressed", String(pokedOnly));
          }
          applyFilter();
          return api.count();
        },
        setHex: function (key, text) {
          var re = rowEls[key];
          if (!re) return false;
          re.hex.value = String(text);
          return commit(re.row, re.hex, 16);
        },
        setDec: function (key, text) {
          var re = rowEls[key];
          if (!re) return false;
          re.dec.value = String(text);
          return commit(re.row, re.dec, 10);
        },
        bit: function (key, n) {
          var re = rowEls[key];
          if (!re) return null;
          return toggleBit(re.row, n);
        },
        curve: function (reg) {
          toggleCurve(reg);
          return { open: curveOpen, keys: studio.keyframes(reg) };
        },
        openCurve: function () { return curveOpen; },
        addKey: function () { return addKeyHere(); },
        write: function () { return studio.writePokes(); },
        note: function () { return note; },
        dom: function () { return built; }
      };

      studio.panels.register({
        id: "registers",
        label: "REGISTERS",
        group: "chip",
        chapter: "registers",
        gloss: "Every register the console has, poked as keyframes.",
        draw: draw,
        api: api
      });
    }
  });
})(typeof self !== "undefined" ? self : this);
