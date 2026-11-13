# PCEStudio vs ppu.toys — what they have, what we have, what to do next (#290, refreshes #168)

**Read-only re-audit, 2026-11-13.** Written from the public site and from our own files. Nothing from
ppu.toys was copied; their code and words are cited only as labels, route names and symbols. ppu.toys is
MIT, Copyright (c) 2026 Liora Labs (credit already recorded in [`PPU-TOYS.md`](PPU-TOYS.md) and
[`STUDIO.md`](STUDIO.md) §0). No login, no account, no synthetic input, no screenshot of their art or
prose. Scratch downloads stayed in `$TMPDIR` (`$TMPDIR/ppucompare2026-11-13/`), never in the repo. The
2026-10-31 audit (#168) is kept in git history; this file replaces it.

**What was fetched (no account).** `/`, `/browse`, `/docs` (the same client-rendered shell); the router
`index-CH60cdAx.js` (145,997 B); the Studio chunk `App-BGJB53MR.js` (1,806,870 B, sha256 `f9716029…`);
`App-BQNOEtkV.css` (245,417 B); `wasm-BX5cQMyd.js` (18,175 B, the loader; the `.wasm` file itself was not
fetched); `/manifest.webmanifest`; the public `GET /api/toys`, `/api/highlights`, `/api/starter`. Last audit
named `App-DUnSytDh.js` and `index-DgDEK6jw.js`, so **the bundles changed since #168**. The router's
route table and the Studio's strings were read from those bundles; no page HTML was used.

**Freshness.** The newest entry in their "What's new" text (the `SA` constant in `App`) is **2026-11-06 —
My toys, cloud drafts and comments**. Entries since #168 that matter here: 2026-11-02 Luau as default and
cartridge builds, `@ppu/hud` and `@ppu/pools`; 2026-11-03 "your cartridges" (every ROM carries their ident,
which any button skips) and line costs with a 65816 viewer; 2026-11-04 scenes, and ROM export now needs an
account with a limit of 3 ROMs and 10 failed builds an hour; 2026-11-06 account drafts, a My toys page,
comments, view counts and ROM download counts. `GET /api/toys` now returns **15 toys** in one page with
`heartCount`, `hearted`, `clipUrl`, `thumbUrl`, `hasRom` and an `author` block (the #168 audit counted 24).

**Our side, read this session.** `renderer/studio.html`, `renderer/studio-panel-agent.js`,
`renderer/pce-agent-tools.js`, `renderer/pce-cgen.js`, `renderer/pce-songbank.js`, `renderer/pce-romcheck.js`,
`renderer/browse.html`, `renderer/toy.html`, `renderer/testers.html`, `tools/deploy.sh`, `docs/STUDIO.md`,
`docs/NATIVE.md` (written 2026-11-13), `docs/BANKED-DATA.md`, `docs/DECISIONS.md`, the roadmap commit
`ffcf49f` and the board's card states. The studio was **not** opened in a browser (the card says read the
files); runtime claims come from the files and the tests they name.

---

## 0. How far apart — the verdict

**Product surface: still far apart, and the gap grew this fortnight.** ppu.toys now has a landing page
("Open the Studio", "Explore toys", community highlights, featured toys, Join Discord), accounts (Discord
sign-in), cloud drafts that autosave to the account, a publish flow with clips, hearts, comments, view and
ROM-download counts, a My toys page, a fullscreen mobile preview and a hosted agent link. We have **none of
the account, publish or sharing surface**: the top bar still says "not signed in", Browse is 8 example cards,
`/` is a meta-refresh to Browse (`tools/deploy.sh` line 125), and the testers' page still says "Phones and
tablets have not been tested". Card #37 (publish) is still open.

**Depth: we are level or ahead where it counts for the hardware, and behind on the studio's developer
tools.** Ahead: a validator and CONSOLE panel that refuse what a PC Engine cannot carry with a stated
reason, generated docs from the code's own tables, a visible Check across the Lua and IL runtimes, and a
native route that has now been run on a **real PC Engine** and an FPGA core (maintainer's report, recorded
in `docs/NATIVE.md` 2026-11-13; picture and music judged by eye and ear, no cycle measurement). Level or
behind: the native route is **not in the studio yet** (the studio's Export still builds the interpreter
ROM), so a player who presses Export gets the slower route. Behind: they ship a per-line cost view and a
65816 viewer that follows the cursor; we have no debugger or disassembly view in the studio (external
emulators do that job for us; the roadmap lists a "Run panel and debugger" as planned).

**Net:** the engine and the console-truth side are close to parity or ahead; the distance a first visitor
sees is the product surface, which is the thing that #37 and a landing page would close. The depth gap that
matters next is the native route in the studio's Export (#101 is still open on the board).

---

## 1. Status of the four earlier gaps (since #168)

| Gap named in #168 | Now | Evidence |
|---|---|---|
| Agent link | **Built on our side**: the AGENT drawer connects the open tab over the relay; a shared tool core runs in the browser and the stdio server. Hosted link is live. Their `press` and `playback` tools are still not in our tool names. | `studio-panel-agent.js`, `pce-agent-tools.js` (its tool names include none called `press` or `playback`), #165–#167 closed |
| Songs in Export | **Built and emulator-tested**: Export carries the toy's songs in an 8 KiB song bank. The console-side test is still open, and `docs/STUDIO.md` still says song data is not in the ROM (#199, still `[?]`). The two statements conflict; the code and the roadmap say songs are in. | commit `cf82134`, `studio.html` ~2121, `pce-songbank.js`, roadmap `ffcf49f` |
| Art in banks | **Done** (#288): art goes into banked data, the export carries it, the ROM shows it in Mednafen. | commit `f267498`, board #288 `[x]`, `docs/BANKED-DATA.md` |
| Native compiler preview | **Route 2 is still not in the studio.** The C backend (`pce-cgen.js`) checks a toy in the page and the CONSOLE panel reports whether the C route can carry it; a native ROM runs by the CLI (`tools/build-toyc.sh`). The native route is proven on real hardware (`docs/NATIVE.md`). | `docs/NATIVE.md`, `docs/STUDIO.md` §0 (route 2 "planned, not built"), board #101 `[?]` |
| Real-hardware runs | **One recorded run** (2026-11-13, maintainer's report, in `docs/NATIVE.md`): PCEHero intro on a real PC Engine and an FPGA core. No hardware result for the studio's own Export is recorded. | `docs/NATIVE.md`, `docs/DECISIONS.md` (the maintainer owns a real PC Engine with a flash cart) |

---

## 2. Feature table

Citation legend: **`ppu`** = the live site; **`App`**, **`Router`** and **`CSS`** = the served bundles above;
**`API`** = a public `GET` under `https://ppu.toys`; **`ours`** = this repository. "Not verified" means the
public page does not settle it. STATUS is today's state; **changed** marks a row that moved since #168.

| AREA | ppu.toys (what it does, where seen) | PCEStudio (what we have, file) | STATUS | Proposed card |
|---|---|---|---|---|
| **Landing page** | `/` shows hero, Open the Studio / Explore toys, community highlights, Featured PPU Toys, Latest contributions, Join Discord — `App` strings. **changed** | `/` is a meta-refresh to Browse (`tools/deploy.sh` ~125); no `home.html` exists. | **GAP** | Existing idea; a home page ~M. |
| **Accounts and sign-in** | Discord sign-in; `GET /api/me` 401 when signed out; "Sign in with Discord to heart toys"; account drafts; "Sign agents out" — `App`, `API`. **changed** | None. Top bar says "not signed in" (`studio.html` ~1187). | **GAP** (the largest product gap) | Card #37 scope. |
| **Publish and share** | Publish dialog (title, description, tags, 5-second clip, "one update per minute"); "Publish new toy" / "Update t/<id>"; a publish explicitly updates the public version; a My toys page groups saved, draft and published work — `App` `SA` text. **changed** | No publish. Save file downloads the `.pce.json`; "Open in Studio" is the only share. | **GAP** | Card #37. |
| **Hearts, comments, counts** | Hearts (`heartCount`, `hearted`), comments (delete your own; admins moderate), view counts, ROM download counts — `App` `SA` text, `API` fields. **changed** | None. | **GAP** | Card #37 (after the toy record). |
| **Phone and touch** | Viewport, `/manifest.webmanifest`, apple-touch icon, theme-color; "Mobile toy previews launch fullscreen play"; on-screen pad in the fullscreen player — `root.html`, `App`. **changed** | Viewport meta and a `max-width: 900px` media query (`studio.html` 1134); no manifest, no on-screen pad; testers' page: "Phones and tablets have not been tested". | **GAP** | Phones: player first ~M (card idea from #168). |
| **Editor and code intelligence** | CodeMirror 6 with completion and hover UI; `require("@ppu/` completes library names and explains members (2026-11-02 entry). **changed** | CodeMirror 5.65.16 with the Lua mode, line numbers, opt-in Vim (`vendor/codemirror/`, `studio.html`). No completion or hover source. | **GAP**, narrower than #168 (their library completion is new) | Lua completion for our toy API ~M, optional. |
| **Layout and panels** | 11 SNES panels on dockview: drag, float, pop-out, maximise, saved layout — `App`. | 10 PCE panels and drawers; three accessible dividers; no float or pop-out — `studio.html`, `docs/STUDIO.md` §2.4. | **GAP** on flexibility | Pop out a panel ~M. |
| **Assets and Add Source** | Add Source drops PNG, audio, `.mid`, `.ppusrc.json`; kinds BG, OBJ, Tilesheet, Sample, Mode 7; 2/4/8 bpp; `dma(name)`. | `Add Source` (#123, #156) drops PNG, WAV, `.mid`, `.pce.studio`; kinds BG, Sprites, Tilesheet, Palette, Sample, Song; fixed 4 bpp; named sources with previews; no Mode 7 (PCE has none). Art is carried into banks (#288). | **EQUAL** on the importer; per-source remove and export still missing. | Per-source Remove and export ~S. |
| **Audio and sequencer** | AUDIO, SEQUENCER and COMPOSE panels; `music()`, `sfx()`, `release()`; sound is part of a published toy. | AUDIO mixer (6 PCE voices), SEQUENCER, LAYERS, DMF import; `note()`, `sfx()`, `release()`, `music()` in the toy API; notes and effects play in the exported ROM (measured in Mednafen); **the studio's Run is still silent** (#71 open); songs are in Export (`cf82134`). | **Closer** — sound reaches the ROM; the studio's live sound and DDA/effects remain (#71). | Existing #71 (~M); a ~S card to retire the stale SND text. |
| **Run, pause, scrub, markers** | Free-running clock; named markers; timeline in/out loop markers; Space/R, Ctrl+Enter, Ctrl+. | Play, pause, stop, frame scrubber, numeric markers, Go to marker, plays past Length (#144). No named markers, no loop in/out. | **GAP** on loop and named markers | Loop in/out and named markers ~S. |
| **Checks and budgets** | SNES tab: live cost per update, findings with file:line, line costs (percent of the update budget), 65816 viewer that follows the cursor, Apply fixes; agent tools `check`, `snes_check`. **changed** | Visible `Check` runs the toy in Lua and IL and compares frames; CONSOLE panel (#98) runs the validator, emitter, cycles, sprites per line, VRAM fit, ROM estimate; ROM check (`pce-romcheck.js`) says what the exported ROM can and cannot run (#193). | **EQUAL on findings; ahead on console truth** (we refuse what a PCE cannot run, with a reason). They have a live per-line cost view we lack. | Per-line cost view ~M (optional). |
| **Debugger and disassembly** | 65816 panel: generated instructions for each attributed line, complete listing, search, links back to the editor. **changed** | None in the studio. External: Mednafen and Geargrafx (listed in `renderer/resources.html`), and our viewer (`tools/viewer.asm`). Roadmap lists a "Run panel and debugger" as planned. | **GAP** | Roadmap item; no card until the maintainer asks. |
| **Export** | `Export to ROM`: compiles a cartridge; requires an account; 3 ROMs and 10 failed builds an hour; every ROM opens with their ident (skippable). **changed** | `Export…` builds a `.pce` in the page from IL bytecode on the interpreter (route 1, #115), with songs (`cf82134`) and banked art (#288); the native route (route 2, #101) is not in the studio yet; a ROM check refuses what route 2 cannot carry; no account, no limit. | **EQUAL on the route we ship; AHEAD on no-account export; BEHIND on native speed** (#101, open). | Existing #101. |
| **Native compiler** | Their compiler is hosted (worker) and rate-limited. **changed** | Route 2 proven on real hardware by the CLI (`tools/build-toyc.sh`, `docs/NATIVE.md`); DUSK RUN's native stall fixed (#289). In the studio: not yet. | **DEPTH AHEAD** on the native path's proof; **BEHIND** on availability in the studio. | #101 stays the card. |
| **Gallery and toy pages** | `/browse` with search, tags, Newest/Popular, Play feed, Load more, muted looping clips, hearts; `/t/:id` with every file tab, description, tags, author, Fork/Edit; `/t/:id/play` feed with Previous/Next and touch pad. `API` returns 15 toys. **changed** | `/browse.html`: 8 example cards drawn at frame 60, search, tag filter, Play a random toy; `/toy.html?id=`: one source file (`main.lua`), Play full screen, Raw source, Open in Studio; keyboard-only full-screen player; `toys/` holds 15 toy folders (the gallery shows 8). | **GAP** on content and card richness | Toy page with every file tab ~M; Play feed + on-screen pad ~M (after #37). |
| **Docs and tutorials** | `/docs` with 15 chapters (search, chapter map, `#topic` links); What's new; a Luau and Lua chapter; a Scenes chapter. **changed** | Docs panel and `renderer/docs.html`: generated chapters from the code's tables (registers, palettes, sprites, raster, budgets, refusals, sound, passwords …); chat-AI guide, Claude Code manual, testers' guide. Not recounted this session. | **EQUAL**; they have hardware-to-language teaching (Luau, scenes), we have refusals and generated reference. | Pixel-art chapter and first-toy walkthrough ~S. |
| **Settings and themes** | Settings: Theme (dark/light) and Vim; `ppu.theme` — `App`. Light tokens exist for CodeMirror in `App`. | Settings: Vim, line numbers, CRT default; dark theme only. | **GAP** on theme | Light theme ~S. |
| **Keyboard shortcuts** | Space, R, Ctrl/Cmd+Enter, Ctrl/Cmd+., Ctrl/Cmd+S, Tab, Escape, controller keys, opt-in Vim — `App`. | The same set where the PCE has the action, plus divider and table keyboard support — `studio.html` §5.2. | **EQUAL** | No card. |
| **Accessibility** | `CSS` honours `prefers-reduced-motion` (confirmed this session); aria-live feed; `aria-pressed`; roles; keyboard docking. | Many aria labels and roles, keyboard-operable dividers, focus ring; **no `prefers-reduced-motion`** (grep of `renderer/*.html` finds none); no live region for the agent feed beyond the drawer. | **GAP** on reduced motion and live regions | Accessibility pass ~S. |
| **URLs and deep links** | `/`, `/studio`, `/studio/raw`, `/t/:id`, `/t/:id/play`, `/t/:id/raw`, `/u/:handle`, `/my-toys`, `/browse`, `/docs`, `/changes`, `/console`, `/oauth/authorize`, `/tos`, `/privacy`, `/admin`. **changed** | Query strings only: `studio.html?toy=`, `?demo=`, `?docs=`; `browse.html?q=`, `?tag=`; `toy.html?id=`, `?play=1`. | **GAP** | Readable URLs ~M. |
| **Agent link** | Hosted MCP endpoint with Discord sign-in; the Studio tab is the agent's hands; LIVE/CONNECTING panel; a feed per call; Disconnect; "Sign agents out"; takeover state; consent page with Allow/Deny. The public tool list is 17 names. | Built: AGENT drawer, relay, tool core (#165–#167, closed). No account, so no consent page and no global revoke. Our tool names differ (`toy_run`, `frame_png`, `validate`, `export_pce`, `source_add`, `rom_check`, …). `press` and `playback` are absent. | **EQUAL on the link; GAP on accounts, consent and `press`/`playback`** | `press` and `playback` as a new card if the maintainer wants Claude to play, not only render. |
| **SNES-only hardware** | Mode 7, colour math and sub screen, windows, HDMA, BRR, SRAM, 8bpp/EXTbg, mosaic. | No PCE counterpart; the PCE's VCR/RCR raster and password saves are our equivalents (`docs/STUDIO.md` §3). | **N-A** | No card. |

---

## 3. WE DO BETTER

Only claims checked against our files or the public bundles. "They lack it" means it is not in the live
site's served UI.

1. **No account for the whole loop.** Autosave, Open, Save, Export, Check, Add Source, the sequencer and
   **Export a ROM** need no sign-in. Their ROM export now needs an account and has a per-hour limit. This
   stays true only if #37 keeps it optional.
2. **A visible Check over two runtimes and a validator that refuses with reasons.** Lua and IL are compared
   frame by frame (`checkToy`, `docs/STUDIO.md` §5.2); CONSOLE and the ROM check state what a PC Engine
   cannot carry, with file:line (`pce-romcheck.js`, #193).
3. **The native route runs on a real console.** Their compiler is hosted; ours has a CLI route that the
   maintainer ran on a PC Engine on 2026-11-13 (`docs/NATIVE.md`). Their "Export to ROM" is a cartridge for
   an SNES; ours is a HuCard for a PC Engine, a different machine.
4. **Docs generated from the code's tables**, with a refusal-code chapter they do not have, and three
   written guides (testers, Claude Code, chat AI) that the live site does not serve.
5. **Docs inside the studio**, not a new tab (`studio.html` §4).

---

## 4. TOP 10 IMPROVEMENTS (refreshed)

Ranked by what a first-time visitor notices. Existing cards are named, not duplicated. Sizes follow the
board's ~S/~M/~L.

1. **Publish, hearts, comments and a profile — existing card #37, ~L.** The biggest visible gap. Their
   publish flow now has clips, hearts, comments and counts; ours has none of it. Keep the account optional.
2. **A home page — new, ~M.** `/` is a redirect to Browse. A first visitor sees no hero and no reason to
   stay. One toy running at frame 60, Open the Studio, the testers' guide, and what is finished and not.
3. **Native route in the studio's Export — existing card #101, ~L.** The route that runs on hardware is
   not the one the Export button builds. This is the depth gap that matters most.
4. **Sound in the studio's Run — existing card #71, ~M.** The ROM plays sound; the studio's own Run is
   silent. A tester hears the sequencer, then nothing from the game.
5. **Phones: the player first — new, ~M.** Their fullscreen mobile preview is shipped; ours says phones are
   untested. A touch pad in `toy.html?play=1` and a manifest.
6. **Light theme — new, ~S.** Their Settings has dark and light; ours is dark only.
7. **Reduced motion and live regions — new, ~S.** `prefers-reduced-motion` is absent from our pages.
8. **Toy page with every file — new, ~M.** Their `/t/:id` shows the description, tags, author and every
   file; ours shows `main.lua` only.
9. **Loop in/out and named markers — new, ~S.** Unchanged from #168.
10. **Per-line cost view and a disassembly panel — new, ~M, optional.** The 65816 viewer and line costs are
    their best new depth feature. A PC Engine version would need our own cycle table; propose only if the
    maintainer wants it.

---

## 5. NOT VERIFIED

- **Server behaviour.** The relay, rate limits, token lifetime and what the publish endpoints store were
  not called. The rows describe the served UI.
- **Accounts and moderation.** Discord scopes, revision storage, what `/admin` does and how comment
  moderation works. No account was created and nothing was published.
- **Limits.** The 3-ROM and 10-failed-build hourly limit, the description and tag rules, and the 5-second
  clip are UI strings; the server may differ.
- **The 15-toy count** is one `GET /api/toys` response with no next page; it may be a page size, not the
  whole catalogue.
- **Songs in Export on the console.** `docs/NATIVE.md` and `docs/STUDIO.md` disagree (the code and roadmap
  say songs ship; `STUDIO.md` §0 still says #199 is open). The console test for songs is open per the
  roadmap. Not run here.
- **The real-hardware run** is the maintainer's report in `docs/NATIVE.md`; this audit did not see the
  console or a capture.
- **Performance.** No load time was measured on either site. Byte counts are file sizes, not transfer sizes.
- **Phones.** Neither site was opened on a phone; no touch gesture was tested.
- **Their `.wasm`.** `wasm-BX5cQMyd.js` is the loader; the `.wasm` binary was not fetched, so its size is
  unknown.
- **Our runtime.** The studio was read, not opened in a browser. No synthetic input was sent anywhere.
- **The ppu.toys GitHub repository** was not re-read; `docs/PPU-TOYS.md` (commit `0b07767`, 2026-10-18)
  may be stale.
