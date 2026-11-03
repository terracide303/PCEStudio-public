#!/usr/bin/env node
/*
 * tests/check-resources.js — card #242 evidence: renderer/resources.html is
 * the curated page the site ribbon and the studio's tool bar link to, every
 * external link in it answers 200, its licence lines are the statuses
 * docs/REFERENCES.md states, and the studio link opens the page.
 *
 * What it proves, in order:
 *   1. The page has the six groups the card names, in that order, and every
 *      tool it names has one entry: HuC/HuCC, PCEAS, llvm-mos, Mednafen,
 *      mednafenPceDev, Mesen/MesenCE, Etripator, HuTrack, Furnace, DefleMask,
 *      Huzak, the HuCC docs, Aseprite and Tiled.
 *   2. Each entry carries a licence line, and the visible line is exactly the
 *      entry's data-licence value (so the page and the test cannot drift).
 *   3. The licence lines match docs/REFERENCES.md in both directions: the
 *      page's line must equal the status transcribed from REFERENCES.md
 *      (EXPECTED_LICENCE), so an entry cannot downgrade a stated licence to
 *      "not stated"; and every clause of a stated licence must appear in
 *      REFERENCES.md. The documented HuCC docs licence and mednafenPceDev's
 *      "Mednafen's own" are checked the same way.
 *   4. The entries REFERENCES §4 marks as coming from an unverified search
 *      (llvm-mos's PC Engine target, Mesen/MesenCE, Furnace, DefleMask,
 *      Huzak, Aseprite, Tiled) carry the page's "unchecked" tag, and no other
 *      entry does.
 *   5. Every entry explains its connection to PCEStudio as Today or Planned,
 *      in our own sentence.
 *   6. The page is on the site ribbon: it has the site header and a Resources
 *      nav item marked current, and the other seven pages' ribbons link to it.
 *   7. The studio's tool bar has one Resources link, inside .top-actions,
 *      pointing at resources.html; a local HTTP server serves studio.html,
 *      the href resolves against it, and the target answers 200.
 *   8. Every external link in the page returns 200. Offline, the check prints
 *      a SKIP line naming the reason and exits 0; the rest still runs.
 *
 * Written by @design because card #242 names this file. Per workshop rule 2
 * this is the author's own test and proves only what its author thought of:
 * a cold break by another seat is owed before the card closes.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const { URL } = require("url");

const ROOT = path.resolve(__dirname, "..");
const RENDERER = path.join(ROOT, "renderer");
const PAGE = path.join(RENDERER, "resources.html");
const REFS = path.join(ROOT, "docs", "REFERENCES.md");

const SITE_PAGES = ["browse.html", "claude-code.html", "credits.html",
                    "release-notes.html", "roadmap.html", "testers.html",
                    "toy.html"];
const GROUPS = ["Code", "Emulators and debuggers", "Disassembly", "Sound",
                "Documentation", "Art and maps"];
const TOOLS = ["HuC / HuCC", "PCEAS", "llvm-mos", "Mednafen",
               "mednafenPceDev", "Mesen", "Etripator", "HuTrack", "Furnace",
               "DefleMask", "Huzak", "HuCC documentation", "Aseprite", "Tiled"];
/* REFERENCES §4, "unverified; check before relying": the PC Engine target
 * news for llvm-mos (explicitly not confirmed), Mesen/MesenCE, Huzak, and the
 * general-knowledge entries Furnace, DefleMask, Aseprite and Tiled. */
const UNCHECKED = ["llvm-mos", "mesen", "furnace", "deflemask", "huzak",
                   "aseprite", "tiled"];
/* The licence status each entry must show, transcribed from
 * docs/REFERENCES.md. Writing it down (rather than only proving that a stated
 * clause appears there) is what catches the other direction: an entry that
 * says "not stated" where REFERENCES states a licence. The references below
 * are §1 (HuTrack), §2 (the table row), §3 (the HuCC docs), §4 (no licence
 * stated for the unverified items) and §5 (PCEAS). */
const EXPECTED_LICENCE = {
  "huc": "an aggregate LICENSE that says much of it has no stated terms",
  "pceas": "The legal status of much of the kit cannot be stated exactly; " +
           "the MagicKit assembler's source says \"This program is freeware. " +
           "You are free to distribute, use and modify it as you wish.\"; " +
           "Ulrich Hecht's 2014 changes are Simplified BSD",
  "llvm-mos": "not stated",
  "mednafen": "not stated",
  "mednafenPceDev": "Mednafen's own",
  "mesen": "not stated",
  "etripator": "GPL-3 (LICENCE.txt)",
  "hutrack": "MIT, copyright Turboxray",
  "furnace": "not stated",
  "deflemask": "not stated",
  "huzak": "not stated",
  "hucc-docs": "Licence of the documents is still not stated",
  "aseprite": "not stated",
  "tiled": "not stated"
};

let checks = 0;
const failures = [];

function check(ok, name) {
  checks++;
  if (!ok) failures.push(name);
}

function norm(s) {
  return String(s)
    .replace(/&quot;/g, "\"").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/`/g, "").replace(/\*\*/g, "")
    .replace(/[“”]/g, "\"").replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ").trim().toLowerCase();
}

function stripTags(s) {
  return norm(s.replace(/<[^>]+>/g, " "));
}

function rel(file) {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

/* ---- page parsing ------------------------------------------------------- */

function parseEntries(html) {
  const out = [];
  const re = /<div class="res"([^>]*)>([\s\S]*?)<\/div>/g;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1];
    const body = m[2];
    const id = (attrs.match(/\bid="([^"]+)"/) || [])[1] || "";
    const licence = (attrs.match(/\bdata-licence="([^"]*)"/) || [])[1] || "";
    const unchecked = /\bdata-unchecked="1"/.test(attrs);
    const h3 = (body.match(/<h3[^>]*>([\s\S]*?)<\/h3>/) || [])[1] || "";
    const name = stripTags(h3.replace(/<span class="tag[\s\S]*?<\/span>/g, ""));
    const licLine = (body.match(/<p class="lic"><b>Licence:<\/b>([\s\S]*?)<\/p>/) || [])[1];
    const visibleLicence = licLine === undefined ? null : stripTags(licLine);
    const hrefs = [];
    const lre = /<a\b[^>]*\bhref="([^"]+)"/g;
    let lm;
    while ((lm = lre.exec(body))) hrefs.push(lm[1]);
    const use = /<span class="tag (today|planned)">Today<\/span>|<span class="tag (today|planned)">Planned<\/span>/.test(body);
    out.push({ id, name, licence: norm(licence), visibleLicence,
               unchecked, hrefs, use, body });
  }
  return out;
}

function checkStructure(html, entries) {
  const h2s = [];
  const re = /<h2>([\s\S]*?)<\/h2>/g;
  let m;
  while ((m = re.exec(html))) h2s.push(stripTags(m[1]));
  check(JSON.stringify(h2s) === JSON.stringify(GROUPS.map(norm)),
        "the six groups are present and in the card's order (got " +
        JSON.stringify(h2s) + ")");

  check(entries.length === TOOLS.length,
        "one entry per tool (" + entries.length + " entries, " +
        TOOLS.length + " tools)");

  const allText = norm(html);
  for (const tool of TOOLS) {
    check(allText.includes(norm(tool)),
          "the page names " + tool);
  }

  for (const e of entries) {
    check(e.id.length > 0, "entry " + JSON.stringify(e.name) + " has an id");
    check(e.hrefs.length > 0,
          e.id + " links to its source");
    for (const href of e.hrefs) {
      check(/^https:\/\//.test(href),
            e.id + " link is https (" + href + ")");
    }
    check(e.visibleLicence !== null, e.id + " has a visible licence line");
    check(e.visibleLicence === e.licence,
          e.id + "'s visible licence is its data-licence value (" +
          JSON.stringify(e.visibleLicence) + " vs " +
          JSON.stringify(e.licence) + ")");
    check(e.use, e.id + " says Today or Planned");
  }
}

/* ---- licence lines against docs/REFERENCES.md --------------------------- */

function checkLicences(entries) {
  const refs = norm(fs.readFileSync(REFS, "utf8"));
  const ids = entries.map((e) => e.id).sort();
  check(JSON.stringify(ids) === JSON.stringify(Object.keys(EXPECTED_LICENCE).sort()),
        "every entry has a licence transcribed from docs/REFERENCES.md (got " +
        JSON.stringify(ids) + ")");
  for (const e of entries) {
    if (!e.licence) { failures.push(e.id + " has no licence value"); checks++; continue; }
    const expected = EXPECTED_LICENCE[e.id];
    check(expected !== undefined,
          e.id + " has a transcribed licence to compare with");
    if (expected === undefined) continue;
    check(e.licence === norm(expected),
          e.id + "'s licence equals docs/REFERENCES.md's status (" +
          JSON.stringify(e.licence) + " vs " + JSON.stringify(norm(expected)) + ")");
    if (norm(expected) === "not stated") {
      check(e.visibleLicence === "not stated",
            e.id + " plainly says not stated");
      continue;
    }
    const clauses = expected.split(/;\s*/).filter(Boolean);
    for (const clause of clauses) {
      check(refs.includes(norm(clause)),
            e.id + "'s licence clause is stated in docs/REFERENCES.md: " +
            JSON.stringify(clause));
    }
  }

  /* REFERENCES §7 answers "author not stated" for the HuCC docs: the page
   * must credit the people it names, not a mystery author. */
  const docsEntry = entries.find((e) => e.id === "hucc-docs");
  if (docsEntry) {
    for (const who of ["Flame", "MrJ", "Kaminari", "Newsdee", "Elmer"]) {
      check(norm(docsEntry.body).includes(norm(who)),
            "the HuCC docs entry credits " + who);
    }
  }
}

function checkUnchecked(entries) {
  const marked = entries.filter((e) => e.unchecked).map((e) => e.id).sort();
  check(JSON.stringify(marked) === JSON.stringify(UNCHECKED.slice().sort()),
        "exactly the entries REFERENCES marks unverified say unchecked (got " +
        JSON.stringify(marked) + ")");
  for (const e of entries) {
    if (!e.unchecked) continue;
    check(/<span class="tag unchecked"/.test(e.body),
          e.id + " shows the visible unchecked tag");
    check(/title="Came from a quick web search and has not been confirmed"/.test(e.body),
          e.id + "'s unchecked tag says why");
  }
}

/* ---- site ribbon and the studio's tool bar ------------------------------ */

function navBlock(html) {
  const m = html.match(/<nav class="site-nav"[^>]*>([\s\S]*?)<\/nav>/);
  return m ? m[1] : "";
}

function checkRibbon(html) {
  check(/<header class="site-head">/.test(html),
        "resources.html carries the site header");
  const nav = navBlock(html);
  check(/<a href="resources\.html" class="is-on" aria-current="page">Resources<\/a>/.test(nav),
        "resources.html marks Resources as the current page");
  for (const page of SITE_PAGES) {
    const file = path.join(RENDERER, page);
    const pageHtml = fs.readFileSync(file, "utf8");
    check(/<a href="resources\.html">Resources<\/a>/.test(navBlock(pageHtml)),
          page + "'s site ribbon links Resources");
  }
}

function topActions(html) {
  const m = html.match(/<div class="top-actions">([\s\S]*?)<\/div>/);
  return m ? m[1] : "";
}

function checkStudioLink() {
  const studio = fs.readFileSync(path.join(RENDERER, "studio.html"), "utf8");
  const bar = topActions(studio);
  const m = bar.match(/<a\b[^>]*\bid="btn-resources"[^>]*>([\s\S]*?)<\/a>/);
  check(!!m, "the studio's tool bar has one Resources link");
  if (!m) return;
  check(/\bhref="resources\.html"/.test(m[0]),
        "the studio's Resources link points at resources.html");
  check(stripTags(m[1]) === "resources",
        "the studio's Resources link says Resources (got " +
        JSON.stringify(stripTags(m[1])) + ")");
}

function serveAndFetch() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, "http://127.0.0.1");
      let file = path.join(ROOT, decodeURIComponent(url.pathname));
      if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); res.end("not found"); return; }
        const ext = path.extname(file);
        const type = ext === ".html" ? "text/html; charset=utf-8" :
                     ext === ".js" ? "text/javascript" : "application/octet-stream";
        res.writeHead(200, { "content-type": type });
        res.end(data);
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const base = "http://127.0.0.1:" + server.address().port;
      const get = (p) => new Promise((done) => {
        http.get(base + p, (res) => {
          let body = "";
          res.on("data", (d) => { body += d; });
          res.on("end", () => done({ status: res.statusCode, body }));
        }).on("error", () => done({ status: 0, body: "" }));
      });
      (async () => {
        const studio = await get("/renderer/studio.html");
        check(studio.status === 200,
              "the studio page serves at /renderer/studio.html (" +
              studio.status + ")");
        const href = (studio.body.match(/<a\b[^>]*\bid="btn-resources"[^>]*\bhref="([^"]+)"/) ||
                      studio.body.match(/<a\b[^>]*\bhref="([^"]+)"[^>]*\bid="btn-resources"/) ||
                      [])[1];
        check(href === "resources.html",
              "the served studio page's Resources href is resources.html");
        const target = new URL(href || "resources.html",
                               base + "/renderer/studio.html");
        const resources = await get(target.pathname);
        check(resources.status === 200,
              "following the studio's Resources link answers 200 (" +
              resources.status + ")");
        check(/<title>PCEStudio Resources<\/title>/.test(resources.body),
              "the link opens the Resources page");
        server.close();
        resolve();
      })();
    });
  });
}

/* ---- every external link ------------------------------------------------- */

function fetchOnce(url, redirects) {
  redirects = redirects || 0;
  return new Promise((resolve) => {
    let u;
    try { u = new URL(url); } catch (e) {
      return resolve({ url, status: 0, error: "bad url: " + e.message });
    }
    const mod = u.protocol === "http:" ? http : https;
    const req = mod.get(u, {
      headers: { "user-agent": "PCEStudio-link-check/1.0",
                 "accept": "text/html,*/*" },
      timeout: 15000
    }, (res) => {
      const status = res.statusCode || 0;
      res.resume();
      if (status >= 300 && status < 400 && res.headers.location &&
          redirects < 5) {
        const next = new URL(res.headers.location, u).toString();
        return resolve(fetchOnce(next, redirects + 1));
      }
      resolve({ url, status });
    });
    req.on("timeout", () => { req.destroy(new Error("timeout")); });
    req.on("error", (e) => resolve({ url, status: 0, error: e.code || e.message }));
  });
}

async function checkLinks(entries) {
  const urls = [];
  for (const e of entries) {
    for (const href of e.hrefs) if (!urls.includes(href)) urls.push(href);
  }
  /* the ribbon's GitHub link is part of the page too */
  const html = fs.readFileSync(PAGE, "utf8");
  let m;
  const re = /<a\b[^>]*\bhref="(https:\/\/[^"]+)"/g;
  while ((m = re.exec(html))) if (!urls.includes(m[1])) urls.push(m[1]);

  const results = [];
  let i = 0;
  const worker = async () => {
    while (i < urls.length) {
      const url = urls[i++];
      results.push(await fetchOnce(url));
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);

  const offline = results.filter((r) => r.error &&
    /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|timeout|network/i
      .test(r.error)).length;
  if (offline === results.length && results.length > 0) {
    console.log("SKIP: offline — none of the " + results.length +
                " external links could be fetched (" +
                (results[0].error || "no network") +
                "); the page, licence lines and studio link were checked");
    return "skip";
  }

  const dead = results.filter((r) => r.status !== 200);
  for (const r of dead) {
    console.log("      " + (r.status || "ERR") + " " + r.url +
                (r.error ? " (" + r.error + ")" : ""));
  }
  check(dead.length === 0,
        "every external link returns 200 (" + dead.length + " did not)");
  console.log("       " + (results.length - dead.length) + "/" +
              results.length + " external links answered 200");
  return "checked";
}

/* ---- run ---------------------------------------------------------------- */

async function main() {
  const html = fs.readFileSync(PAGE, "utf8");
  const entries = parseEntries(html);

  checkStructure(html, entries);
  checkLicences(entries);
  checkUnchecked(entries);
  checkRibbon(html);
  checkStudioLink();
  await serveAndFetch();
  const linkState = await checkLinks(entries);

  if (failures.length) {
    for (const f of failures) console.log("FAIL  " + f);
    console.log("FAIL  " + failures.length + " of " + checks + " checks failed");
    process.exit(1);
  }
  console.log("PASS  " + checks + " checks: " + entries.length + " resource " +
              "entries in " + GROUPS.length + " groups, every licence line is " +
              "docs/REFERENCES.md's, the unverified entries say unchecked, " +
              "the site ribbon and the studio tool bar link the page, and " +
              (linkState === "skip" ? "the external links were skipped offline" :
               "every external link answered 200"));
}

if (require.main === module) main();
