// The pages a visitor reads (README, release notes, roadmap, testers' guide, Claude Code manual, credits, resources)
// must not name board cards ("#224"): the maintainer's rule, 2026-11-03. Tags, <style>, <script> and CSS/hex colours are ignored.
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const files = ["README.md", "renderer/release-notes.html", "renderer/roadmap.html", "renderer/testers.html",
  "renderer/claude-code.html", "renderer/credits.html", "renderer/resources.html"].filter((f) => fs.existsSync(path.join(root, f)));
let fails = 0, checks = 0;
for (const f of files) {
  let s = fs.readFileSync(path.join(root, f), "utf8");
  if (f.endsWith(".html")) s = s.replace(/<(style|script)\b[\s\S]*?<\/\1>/g, "").replace(/<[^>]*>/g, "");
  const hits = s.match(/(?<![\w&/#"=])#\d{1,3}\b/g) || [];
  checks++;
  if (hits.length) { fails++; console.log("FAIL  " + f + " names board cards: " + hits.slice(0, 6).join(" ")); }
}
if (fails) { console.log("FAIL  " + fails + " of " + checks + " pages name board cards"); process.exit(1); }
console.log("PASS  " + checks + " public pages name no board cards");
