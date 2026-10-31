# PCEStudio vs ppu.toys — what they have, what we have, what to do next (#168)

**Read-only audit, 2026-10-31.** Written from the public site and from our own files. Nothing from
ppu.toys was copied; their code and words are cited only as labels, route names and symbols. ppu.toys is
MIT, Copyright (c) 2026 Liora Labs (credit already recorded in [`PPU-TOYS.md`](PPU-TOYS.md) and
[`STUDIO.md`](STUDIO.md) §0). No login, no account, no synthetic input, no screenshot of their art or
prose. Scratch downloads stayed in `$TMPDIR` (`$TMPDIR/ppucompare.KHmr7U/`), never in the repo.

**What was fetched (14 public requests, no account).** The pages `/`, `/browse` and `/docs` (all three
return the same 2,271-byte client-rendered shell); the router `Router` =
`https://ppu.toys/assets/index-DgDEK6jw.js` (145,997 B); the Studio chunk `App` =
`https://ppu.toys/assets/App-DUnSytDh.js` (1,567,497 B); `CSS` =
`https://ppu.toys/assets/App-6Y57MjOu.css` (232,801 B); `/manifest.webmanifest`; `/favicon.svg`; the
public JSON `GET /api/toys`, `/api/toys/21r85bod`, `/api/highlights`, `/api/featured`, `/api/starter`;
and `GET /api/me` (401, unauthenticated). The HTML shell makes every route client-side, so labels and
routes below come from the served bundles, not from page HTML. Hash of `App`: `d91d6d04…b045c0`.

**Freshness.** The latest entry in their "What's new" page (the `zS` constant in `App`) is dated
**2026-10-26** and is the agent sign-in change already known to `docs/STUDIO.md`. The content-hashed
Studio files `App-DUnSytDh.js` and `App-6Y57MjOu.css` are the **same names** our 2026-10-28 study cites
(`docs/STUDIO.md` §0), so no change is detectable since that study. The GitHub repository behind the
site (`docs/PPU-TOYS.md` read commit `0b07767`, 2026-10-18) was **not** re-read; that part is not verified.

**Our side.** Read only: `renderer/studio.html`, `renderer/studio-panel-*.js`, `renderer/browse.html`,
`renderer/toy.html`, `renderer/docs.html`, `renderer/testers.html`, `renderer/claude-code.html`,
`renderer/pce-*.js`, `docs/STUDIO.md`, `docs/PPU-TOYS.md`. The studio was not opened in a browser (the
card says read its files), so runtime behaviour below is the behaviour the files and their existing tests
describe, not a fresh browser run.

---

## 1. Verdict

ppu.toys is the **finished product**: an account, a publish-and-fork loop, a living gallery with video
clips and hearts, a cartridge compiler behind an "Export to ROM" button, touch play, a light/dark theme
and a hosted agent link. PCEStudio is the **deeper instrument**: generated documentation tied to the
code's own tables, a visible Check that runs the same toy in Lua and IL, an honest validator/CONSOLE
panel, a local-first studio that needs no account, and a written path for chat AIs and Claude Code. The
distance between them is mostly **product surface, not engine**: the PCE-specific panels, importer,
validator, sequencer and renderer are already here. Four absences dominate a first visit — no landing
page, no publishing/sharing, toys that model sound but play none in the player, and no phone
layout — and a handful of parity details (loop markers, light theme, multi-file toy pages, readable
URLs, reduced-motion) are small, checked gaps that can be closed without touching the hardware model.

---

## 2. Feature table

Citation legend: **`ppu`** = the live site; **`App`** and **`Router`** = the two served JavaScript
bundles named above; **`CSS`** = the served stylesheet; **`API`** = a public `GET` under
`https://ppu.toys`; **`ours`** = this repository. Sizes are measured bytes. "Not verified" means the
public page does not settle it.

| AREA | ppu.toys (what it does, where seen) | PCEStudio (what we have, file) | STATUS | Proposed card |
|---|---|---|---|---|
| **Editor and code intelligence** | CodeMirror 6 in `App` (`cm-tooltip-autocomplete`, `cm-completionIcon`, `cm-tooltip-hover` classes; Vim is a Settings option: `ppu.editor.vim`). Whether a Lua completion/hover source is actually wired is not verified. | CodeMirror 5.65.16 vendored with the Lua mode, line numbers and opt-in Vim — `vendor/codemirror/`, `renderer/studio.html` §2.2/§5.2. No completion or hover source. | **EQUAL** on editing; their completion UI is present but its Lua source is unverified, ours has none. | No card until their completion source is confirmed. |
| **Layout and panels** | 11 SNES panels (Backgrounds, VRAM, CGRAM, Sprites, Audio, Sequencer, Compose, Windows, Scanlines, Registers, SNES) on **dockview**: drag, float, pop-out, maximise, saved layout — `App` strings (`dockview-theme-ppu`, `api.addPopoutGroup`, `float`, `maximize`). | 10 PCE panels (SCREEN, VRAM, PALETTES, SPRITES, AUDIO, SEQUENCER, LAYERS, SCANLINES, REGISTERS, CONSOLE) plus workspace drawers; three accessible drag dividers, show/hide from Panels ▾, no float or pop-out — `renderer/studio.html`, `docs/STUDIO.md` §2.4/§3. | **GAP** on flexibility; count and purpose are equal. | Pop out a panel or the live output into its own window ~M. |
| **Assets and Add Source** | `Add Source` dialog drops PNG, audio, `.mid` or `.ppusrc.json`; kinds BG, OBJ, Tilesheet, Sample, Mode 7; 2/4/8 bpp; dither none/Bayer/Floyd–Steinberg; EXTBG priority mask; sample trim; asset rows offer preview, export, remove; `dma(name)` places a source — `App` strings. | `Add Source` (#123) drops PNG, WAV, `.mid` or `.pce.studio`; kinds BG, Sprites, Tilesheet, Palette, Sample, Song; fixed 4 bpp/16 colours; the same three dithers; alpha threshold; no Mode 7 (PCE has none); `sources.json` gives each named source a `…` grid/palette preview (#156) — `renderer/studio-panel-assets.js`, `renderer/pce-source.js`, `renderer/pce-assets.js`. | **EQUAL** on the importer and preview; per-source export and remove are a small gap. | Per-source Remove and export as PNG or WAV ~S. |
| **Audio and sequencer** | AUDIO panel, SEQUENCER and COMPOSE; `App` panel strings; audio chapter (`voice[]`, `dsp`, samples, timers, music kit); sound is part of a published toy and the gallery clips play audio. | AUDIO mixer (wave/noise/DDA, envelope, LFO, 6 voices), SEQUENCER grid + staff, LAYERS, DMF export — `renderer/studio-panel-audio.js`, `studio-panel-sequencer.js`, `pce-seq.js`, `pce-staff.js`, `pce-dmf.js`. Both runtimes expose `music(index)`, `sfx(channel, freq, volume, frames)` and `release(channel)` (#71/#161); songs load from `song.json` or a gallery module and the PSG model records the PCM — `renderer/pce-toys.js` lines 799–823, `renderer/pce-docs.js` sound chapter, `tests/check-toys.js`. **The studio has no AudioContext sink for the running toy**, so Run is silent, and its SND button still says "no toy sound surface", which is now stale — `renderer/studio.html` lines 1625, 4909–4913. | **GAP** on audible playback and the remaining effects/DDA; the toy API itself exists. | Existing card #71, plus a ~S card to retire the stale SND text and the `docs/STUDIO.md` §12 line. |
| **Run, pause, scrub, markers** | Free-running clock; `Length` in seconds; named markers; timeline loop in/out markers (`App` timeline settings comment names `in=`/`out=`); Space/R, Ctrl+Enter, Ctrl+., Ctrl+,. | Play/pause/stop, −1/+1, frame scrubber, `Length` in frames (1–3600), numeric markers and Go to marker, plays past Length (#144) — `renderer/studio.html`, `renderer/studio-panel-markers.js`, `docs/STUDIO.md` §2.3. **No named markers, no loop in/out, no looping playback.** | **GAP** on loop and named markers; transport is equal. | Loop in/out and named markers on the timeline ~S. |
| **Checks and budgets** | SNES tab: live cost per update, peak lines, findings with file:line, 65816 assembly, fixes with Apply, export; the agent tools are `check` and `snes_check`; no visible Check button in the top bar (`App` strings, top-bar JSX). | Visible `Check` button runs the toy in Lua and IL and compares; CONSOLE panel (#98) runs `pce-il.js` → `pce-validate.js` → `pce-cgen.js`: cycles, sprites per line, VRAM fit, findings, C output, ROM estimate; refusal codes are documented — `renderer/studio.html` (`btn-check`), `studio-panel-console.js`, `pce-validate.js`, `pce-docs.js`. | **EQUAL** — both expose findings. Live measured cost and emitted 65816 code are theirs; a visible dual-runtime Check is ours. | No new card; the missing half is #101 (native route). |
| **Export** | `Export to ROM`: compiles and downloads a `.sfc`; dialog and compiler worker in `App`; "Download again"; `.sfc` filename. | `Export…` builds a `.pce` in the page from IL bytecode on the interpreter (route 1, #115); no compiler; static 60 Hz estimate; asset tail; route 2 (native code generator) is open card #101 — `renderer/studio.html` (`btn-export` title), `docs/STUDIO.md` §9/§12. | **GAP** on native code; equal in that a ROM file comes out and runs in an emulator. | Existing card #101. |
| **Sharing, publishing, accounts, forking** | Discord sign-in (`/api/auth/discord`); publish dialog with title, description (128 chars), up to 5 tags (1–24 chars), 5-second clip, "one update per minute", conflict message for a toy changed elsewhere; hearts; `/u/:handle` profiles; `/t/:id`; Fork without an account until publish; `/tos`, `/privacy`, `/admin`; `GET /api/me` is 401 when signed out — `App` strings, `API`. | No backend: top bar says "not signed in"; Save file downloads the `.pce.json`; "Fork" is **Open in Studio**; the gallery is the 8 example toys; no hearts, profiles, comments or publication — `renderer/studio.html`, `renderer/browse.html`, `docs/STUDIO.md` §10.1. | **GAP** — the largest. | Existing card #37; this audit adds the publish-dialog fields, clip, hearts and profile pages to its scope. |
| **Browse and toy pages** | `/browse`: search by title or author, tag filter, Newest/Popular, Play feed, Load more, cards with a looping muted clip + poster + unmute button + title + author + heart count + tag links; `/t/:id`: description, author link, tags, heart, Play full screen, Raw output, Fork/Edit, source with file tabs; `/t/:id/play`: a feed with Previous/Next toy, swipe up/down, on-screen touch pad, Pause and CRT — `App` strings, `GET /api/toys` (24 toys) and `GET /api/highlights` (5). | `/browse.html`: search, tag filter, Play a random toy, As written / A–Z, 8 example cards drawn at frame 60 with title, author, Open in Studio and tags; `/toy.html?id=`: Play full screen, Raw source, Open in Studio, blurb and effect, **one** source file (`main.lua`); full-screen player is keyboard-only — `renderer/browse.html`, `renderer/toy.html`, `renderer/gallery-toys.js` (8 toys), `docs/STUDIO.md` §10.1. | **GAP** on content and card richness; no video, hearts, authors, feed or touch pad. | Toy page: every file tab and the description ~M; Play feed + on-screen pad ~M (after #37). |
| **Docs and tutorials** | `/docs`: 15 chapters — registers, display, backgrounds, sprites, mode7, color-math, windows, scanlines, sources, pixel-art, dma, pad, sram, audio, snes — with search, chapter map and sticky nav (`App` `$s` array); `/docs#topic` deep link. What's new page (`App` `zS`). | Docs panel and `renderer/docs.html`: 12 chapters generated from the code's tables — the-toy, registers, palettes, sprites, status, raster, pads, timer, passwords, sound, budgets, refusals; search, map, sticky nav; plus the chat-AI guide (`pcestudio-for-claude.md`), Claude Code manual (`claude-code.html`) and testers' guide (`testers.html`) — `renderer/pce-docs.js`, `docs/STUDIO.md` §4. | **EQUAL** — they have more hardware topics (pixel-art, audio, dma); we generate ours and add refusals and three guides. | Docs: a pixel-art chapter and a first-toy tutorial ~S. |
| **Onboarding and empty states** | Landing page: hero, Open the Studio / Explore toys, community highlights, Featured PPU Toys, Latest contributions, Join Discord; starter toy from `GET /api/starter` ("untitled toy", 120-char `main.lua`); empty states "No matching toys.", "No toys yet.", "Toys couldn't load. Retry." — `App` strings, `API`. | Deployed root is a meta-refresh redirect to Browse (`tools/deploy.sh` line ~115); Browse has a beta banner to the testers' guide and a "Play a random toy" button; the studio opens on `palette-cycle.lua`; Open menu lists examples; no product home page — `renderer/browse.html`, `renderer/testers.html`, `renderer/studio.html`, `docs/STUDIO.md` §10. | **GAP** on a landing page; the testers' guide is ahead of anything they serve. | A home page that shows one toy running, the studio and the beta guide ~M. |
| **Keyboard shortcuts** | Space, R, Ctrl/Cmd+Enter, Ctrl/Cmd+. and Ctrl/Cmd+,, Ctrl/Cmd+Z/Shift+Z for panel pokes, Ctrl/Cmd+S, Tab, Escape, controller keys, opt-in Vim — `App` strings and `docs/STUDIO.md` §5.1 (observed 2026-10-28; bundle unchanged). | The same set where the PCE has the action, plus divider arrows/Home/Enter, REGISTERS table Enter/Tab/arrows/Escape, line numbers and Vim in Settings — `renderer/studio.html` §5.2. | **EQUAL** — ours adds divider and table keyboard support. | No card. |
| **Settings and themes** | Settings: Theme (dark/light) and Vim mode; `ppu.theme`, `ppu.editor.vim` — `App` strings. | Settings: Vim, line numbers, CRT by default; **dark theme only** — `renderer/studio.html` `#settings-pop`, `SETTINGS_KEY`; no light tokens. | **GAP** on theme; we add line numbers and a CRT default. | A light theme, like their Settings ~S. |
| **Mobile and touch** | Viewport, `/manifest.webmanifest`, apple-touch icon, theme-color; on-screen `touch-dpad`/`touch-face`/SELECT/START in the full-screen player — `root.html`, `manifest.webmanifest`, `App` strings. | Viewport and a `max-width: 900px` stack; dividers use pointer events; the testers' page says "Use a desktop browser. Phones and tablets have not been tested"; no manifest, no icons, no on-screen pad — `renderer/studio.html` line ~972, `renderer/testers.html` §1. | **GAP**. | Phones and tablets: a touch layout, on-screen pad and manifest ~M. |
| **Performance and loading** | Router 145,997 B; Studio chunk lazy-loaded at 1,567,497 B; CSS 232,801 B; a WebAssembly PPU core (size not measured). `Router` error text: "ppu.toys runs entirely on a WebAssembly build of the SNES PPU". | Studio first load: `studio.html` 255,675 B + 2,002,294 B of scripts and panel CSS, including `gallery-toys.js` 460,097 B (loaded eagerly even though the studio needs it only for `?toy=`/Open) and Fengari 219,632 B; a further 640,223 B of CodeMirror files when the editor loads; no minification or compression in the repo — measured with `wc -c` from the page's script/link tags. | **GAP** on eager weight; no run-time benchmark exists. | Load less at once: defer `gallery-toys.js` and CodeMirror, then minify ~S. |
| **Accessibility** | `CSS` honours `prefers-reduced-motion`; the agent feed is `aria-live="polite"`; sort tabs use `aria-pressed`; dialogs and statuses have roles; dockview has keyboard docking — `CSS`, `App` strings. | Many `aria-label`s and roles, keyboard-operable dividers (`role="separator"`, aria values), focus ring, toast `role="status"`; **no `prefers-reduced-motion`**, and the agent panel has no live feed yet — `renderer/studio.html`, `renderer/browse.html`. | **GAP** on reduced motion and a live agent region; the rest is comparable. | Accessibility pass: reduced motion, live regions, focus audit ~S. |
| **URLs and deep links** | `/`, `/studio`, `/studio/raw`, `/t/:id`, `/t/:id/play`, `/t/:id/raw`, `/u/:handle`, `/browse` with `tag`, `q`, `sort`, `author`, `/docs`, `/changes`, `/console`, `/oauth/authorize`, `/tos`, `/privacy`, `/admin` — `App` route table (`path:"…"`). | `renderer/studio.html?demo=`, `?toy=`, `?docs=`; `browse.html?q=`, `?tag=`; `toy.html?id=`, `?play=1`; `docs.html`, `testers.html`, `claude-code.html` — query strings only, no author, changes, raw or console routes — `docs/STUDIO.md` §10.1. | **GAP**. | Readable URLs: `/t/<id>`, `/play`, `/raw`, `/studio/raw` ~M (static aliases first; author pages wait for #37). |
| **Agent link** | Hosted MCP endpoint with Discord OAuth; the Studio tab is the agent's hands over a WebSocket; the panel has LIVE/CONNECTING/NOT CONNECTED, a copyable `claude mcp add` command, a feed per call (label, seconds, status, detail), Disconnect, "Sign agents out" (revokes tokens), and a "taken over by another tab" state; the consent page asks Allow or Deny for a named client to drive the Studio as the signed-in handle — `App` strings; the known endpoints are `/api/mcp` and `/api/agent/ws` (per the #168 brief and `docs/STUDIO.md` §2.3; not called here). | `renderer/studio-panel-agent.js` is an honest placeholder (local stdio MCP server, no accounts); `tools/mcp/server.js` exposes 11 tools over stdio; the hosted link is cards #165–#167 — `docs/MCP.md`, `docs/STUDIO.md` §2.3. | **GAP** — already carded (#165–#167). | No new card; see the note after this table. |
| **SNES-only hardware** | Mode 7, colour math and a sub screen, windows/masks, HDMA, BRR samples, SRAM saves, 8bpp/EXTbg, mosaic — `App` panel and docs strings (mode7, color-math, windows, sram, audio). | No PCE counterpart: one background, no colour maths or windows, no Mode 7, no BRR; per-line changes use the VCR/RCR raster (`pce-raster.js`), saves are passwords (`pce-docs.js` passwords chapter), tiles are 16-colour — `docs/STUDIO.md` §3. | **N-A** (hardware). | No card. |

### Agent-link details the page reveals (for #165–#167, not re-carded)

- **The tool list is 17 tools**, defined in `App` with name, description and input schema:
  `docs`, `new_toy`, `list_files`, `read_file`, `write_file`, `delete_file`, `add_image_source`,
  `remove_source`, `screenshot`, `playback`, `set_mode`, `check`, `press`, `snes_check`, `export_rom`,
  `write_song`, `read_song`. Three are not in our `tools/mcp/server.js` today: `playback`
  (play/pause/restart), `set_mode` (lua/cart) and `press` (hold buttons for N frames, then screenshot);
  `read_song`, `list_files`, `read_file` and `delete_file` are also absent from ours. Our names are
  `toy_run`, `frame_png`, `validate`, `export_pce` and `source_add`, which #166 protects by name.
- **The feed** shows one row per call: a human label (`writing main.lua`, `taking a look at t=2s`), the
  elapsed seconds, a running/ok/error status, and a detail line when finished; it is an `aria-live`
  region.
- **Disconnect** closes that tab's session. **Sign agents out** calls `DELETE /api/oauth/tokens` and
  revokes every agent token. A second Studio tab with the same token shows a "took over" state and the
  older tab loses the agent.
- **The consent page** (`/oauth/authorize`) names the client and the signed-in handle and offers
  **Allow** and **Deny**; signed out, it offers "Sign in with Discord" instead.
- **Their revoke and consent are account-shaped; #165's design is not.** `connect` makes a 32-hex
  token, "New link" rotates it and Disconnect closes the tab's socket; there is no identity, so there
  is no Allow/Deny page and no "sign every agent out" across clients. If we want per-client consent or
  a global revoke, it is a new decision, not a port of this panel.
- **`press` and `playback` are the parity question for #167**: the person watching expects Claude to
  play the game, not only render frames. If #166's "do not change tool names" stays, adding `press` and
  `playback` is a new card, not a rename.

---

## 3. WE DO BETTER

Only claims checked against our files or the public bundles. "They lack it" means it is not in the live
site's served UI, not that it is absent from their GitHub project.

1. **A complete chat-AI loop, in the product.** The top bar has **Download for Claude**
   (`pcestudio-for-claude.md`), and **Paste & Run** reads the clipboard and runs the pasted Lua
   (`renderer/studio.html` lines ~994–1005, §5.2). No "Paste" string was found in `App`'s string
   literals; their Studio shell has no paste-and-run control we could see. The testers' guide walks the
   same loop (`renderer/testers.html` §3).
2. **Documentation generated from the code's own tables.** `renderer/pce-docs.js` reads the register,
   refusal-code, budget and palette tables from the modules that enforce them; `tests/check-docs.js`
   proves the committed HTML is the generator's output. Their 15 chapters ship as prose strings in `App`.
   Ours also has a **refusal-code chapter** they do not have.
3. **A visible Check over two runtimes (Lua and IL).** The `Lua` / `IL` switch runs the same toy on
   Fengari Lua 5.3 or on the IL interpreter; `Check` runs 40 frames twice in Lua and once in IL and
   compares pixels, VRAM, CRAM, SAT and the scroll registers (`renderer/studio.html` `framesEqual`,
   `checkToy`, `docs/STUDIO.md` §5.2, §12). The public Studio has no Check button; `check` is an agent
   tool there, and its second mode is a compiler (`set_mode` lua/cart), not a second interpreter.
4. **Three written guides on the site.** `renderer/testers.html` (start in two minutes, keys, make a
   game with an AI, what to test, what does not work, how to report), `renderer/claude-code.html`
   (install, check, tools, worked examples, art, sound, troubleshooting) and the chat-AI guide. The live
   ppu.toys pages we fetched have Studio, Console, Browse, Docs, What's new, Terms and Privacy; no
   equivalent tester or Claude Code manual is served there (their GitHub repository does carry a plugin,
   per `docs/PPU-TOYS.md` §agent link — that is not a site page).
5. **Docs in the studio, not a new tab.** Our `Docs` button opens the reference in a panel inside the
   studio, and every chip panel's `Guide` opens its own chapter there (`renderer/studio.html` §4). Their
   top-bar `Docs` is an `<a href="/docs" target="_blank">` in `App`. The reference is the same content
   either way; ours does not lose the toy being edited to read it.
6. **Local-first and account-free.** Autosave, Open, Save, Export, Check, Add Source and the whole
   sequencer work with no account (`renderer/studio.html` `SETTINGS_KEY`, `docs/STUDIO.md` §7). Their
   editor and fork also need no account, but publishing, hearts and the agent require Discord
   (`App` strings) — ours simply has no account to need. This is an advantage only until #37 lands, and
   then it must stay optional.

---

## 4. TOP 10 IMPROVEMENTS

Ranked by **what a first-time tester notices**, not by engine value. Existing cards are named rather
than duplicated. Sizes follow the board's ~S/~M/~L.

### 1. Publish a toy and give it a link — existing card #37, ~L
- **Why:** the first thing a tester does with a toy they like is try to send it to someone. Today the
  only copy is their browser, and the top bar says "not signed in".
- **How:** a backend with Discord (or another) sign-in, a toy record with revision, a publish dialog
  (title, description ≤128 chars, ≤5 tags of 1–24 chars, 5-second clip), hearts, a public `/t/<id>`, a
  profile page, and Fork into the studio without an account until publish. That is the whole
  **Sharing, publishing, accounts, forking** row above.
- **Evidence:** `App` publish strings (`Publish new toy`, `Update t/<id>`, "one update per minute",
  conflict message), `GET /api/toys` (24 toys), `GET /api/me` 401; ours has no backend
  (`renderer/studio.html`, `docs/STUDIO.md` §10.1).
- **Size:** ~L. Do not split off the clip before the toy record exists.

### 2. Make the toy's sound audible — existing card #71, ~M (plus a ~S label fix)
- **Why:** the toy API already has `music()`, `sfx()` and `release()`, and the generated docs teach
  them, but pressing Run in the studio makes no sound, and the SND button says toys have no sound
  surface at all. A tester hears the sequencer, then hears nothing from the game.
- **How:** feed the running toy's recorded PSG writes/PCM to an AudioContext on the live clock (silent
  while paused or scrubbing), finish the remaining DDA/effect work, and replace the SND title/toast and
  the stale `docs/STUDIO.md` §12 sentence with what is actually missing.
- **Evidence row:** **Audio and sequencer**. `renderer/pce-toys.js` lines 799–823 (the three calls),
  `renderer/pce-docs.js` sound chapter, `tests/check-toys.js` sound cases; `renderer/studio.html`
  lines 1625 and 4909–4913 (the stale SND text); no AudioContext in `studio.html` or `toy.html`.
- **Size:** ~M for the audible player and effects; a separate ~S for the stale text if #71 waits.

### 3. A home page that shows the thing — new, ~M
- **Why:** `https://pcestudio.terracides.com` is a meta-refresh redirect to Browse (`tools/deploy.sh`).
  A first-time tester never sees a hero or a purpose-built first-run page; the gallery is the front
  door, with the beta banner as its first row.
- **How:** a static `renderer/home.html` (generated into the deploy root) with a short hero, one toy
  running at frame 60 as the card art, Open the Studio, Browse, Read the testers' guide, and the three
  things that are finished/not finished. No backend.
- **Evidence row:** **Onboarding and empty states**; `App` landing strings (their hero and featured
  sections) are the shape; `tools/deploy.sh` line ~115 is our redirect.
- **Size:** ~M (the page model and the pictures already exist in Browse).

### 4. Phones and tablets — new, ~M (player) and ~L (full studio)
- **Why:** the testers' page tells people not to use a phone. A first-time tester on a phone sees a
  desktop layout and a keyboard hint.
- **How:** a real touch layout for the studio (stacked, panels as a full-width drawer, larger hit
  targets), an on-screen pad in `toy.html?play=1` (the same IJKL/N/M/O/P map), a manifest, maskable
  icons and a theme-color. Do not promise the full editor on a phone; the player and Browse first.
- **Evidence row:** **Mobile and touch**; theirs has `manifest.webmanifest`, apple meta and
  `touch-dpad`/`touch-face` in `App`.
- **Size:** ~M for player + manifest; a separate ~L card if the full studio must be comfortable.

### 5. Browse as a living gallery — new, after #37, ~M
- **Why:** ours is 8 examples with still cards; theirs is 24 toys with a muted looping clip, an author,
  a heart count, a tag filter, Newest/Popular and a Play feed. The gap reads as "nobody uses this".
- **How:** when #37 gives us records, add the card fields (clip or poster, author, heart), the Play feed
  (one toy after another in `/t/:id/play`) and Load more. Keep our frame-60 still as the fallback when
  there is no clip.
- **Evidence row:** **Browse and toy pages**; `GET /api/toys` card fields (`clipUrl`, `thumbUrl`,
  `heartCount`, `author`, `tags`) and `App` "Play feed"/"Load more"/sort strings.
- **Size:** ~M after the backend; no new engine work.

### 6. A toy page that shows every file — new, ~M
- **Why:** the Star Patrol 7 record returns 7 file tabs, including the generated `ppuglobals.lua` and
  the art/song sources; ours shows only `main.lua`. A tester cannot see how the art or music is made.
- **How:** `renderer/toy.html` gets file tabs from `gallery-toys.js`'s file set, a description, the
  tags as links and an author block; assets get a read-only tab with a short label, not the studio's
  editor.
- **Evidence row:** **Browse and toy pages**; `GET /api/toys/21r85bod` returns 7 files and 4 sources;
  ours is one `main.lua` (`renderer/toy.html` lines ~91–95).
- **Size:** ~M.

### 7. Full-screen play for one thumb — new, ~M
- **Why:** their `/t/:id/play` is a feed: swipe up/down or Previous/Next, an on-screen D-pad and
  buttons, Pause and CRT. Ours is one toy with a keyboard hint.
- **How:** add the touch pad and the next/previous toy navigation to `toy.html?play=1`, with the pad
  drawn only on coarse pointers or always as an option; reuse the gallery order for next/previous.
- **Evidence row:** **Browse and toy pages**; `App` `touch-dpad`/`touch-face`/`Previous toy` strings;
  `renderer/toy.html` §10.1.
- **Size:** ~M; the pad host already exists in `pce-toys.js`.

### 8. A light theme — new, ~S
- **Why:** theirs has Theme: dark/light in Settings; ours is dark only. A tester on a bright screen
  notices in the first minute.
- **How:** a second set of the existing tokens under `[data-theme="light"]`, the Settings segmented
  control (Plain/Vim style), stored beside `pcestudio.settings.v1`; check the panels' canvases and the
  canvas overlay still read.
- **Evidence row:** **Settings and themes**; `App` `ppu.theme`, "Color theme", dark/light;
  `renderer/studio.html` `#settings-pop`.
- **Size:** ~S, but every panel's colours must be checked.

### 9. Loop in/out and named markers — new, ~S
- **Why:** our markers are frame numbers; theirs are named, and the timeline has an in/out loop that
  wraps playback. Anyone animating a cycle hits the difference immediately.
- **How:** extend `studio-panel-markers.js` to name a marker and add two loop handles on the scrubber;
  `render` seeks back to in when playback passes out (their clock does exactly this); persist both in a
  new timeline block in the toy envelope (not in `pceglobals.lua`, which is names-only by design).
- **Evidence row:** **Run, pause, scrub, markers**; `App` timeline comment uses `in=<name> out=<name>`
  and the play subscription wraps at `t>=loopOut`.
- **Size:** ~S.

### 10. Docs: a pixel-art chapter and a first-toy tutorial — new, ~S
- **Why:** theirs has a `pixel-art` chapter (palettes, ramps, sprites, tiles at 16 bits); ours has the
  tables but not the teaching. The testers' guide covers the very first steps, but the in-studio Docs
  does not.
- **How:** add two generated chapters to `pce-docs.js`: a pixel-art chapter built from the editor's own
  palette/tile rules (the numbers must stay generated), and a "first toy" walkthrough whose Lua is a
  committed example run by the docs test. Add them to the chapter map and search.
- **Evidence row:** **Docs and tutorials**; `App` `$s` has `pixel-art`; `renderer/pce-docs.js` has 12
  chapters and no pixel-art or walkthrough.
- **Size:** ~S.

**Not in the top 10, but carded in the table:** readable URLs (~M), the reduced-motion/live-region
accessibility pass (~S), deferring `gallery-toys.js` + CodeMirror (~S), per-source export (~S), and the
native-code export (#101, ~L). #101 is left out of the ten because the visible Export button works and
a first-time tester does not see the interpreter until a heavy toy; it is still the largest engine gap.

---

## 5. NOT VERIFIED

Everything below was **not** confirmed from the public page or would require an account, a run, or a
second source. It is written down so a later seat does not mistake a guess for a finding.

- **ppu.toys server behaviour.** `/api/mcp`, `/api/agent/ws`, the relay's timeouts, rate limits, token
  lifetime, the WebSocket's takeover semantics and whether the relay stores files were **not** called
  or tested. The agent row describes the UI the bundle shows, not the server.
- **Accounts and publishing.** Discord OAuth scopes beyond the privacy page's "identify", revision
  storage, moderation, heart counts over time, whether a fork keeps a link to the original, and what
  `/admin` can do. No account was created and nothing was published.
- **Limits.** The publish dialog's 128-character description, 5-tag limit, 1–24 character tag rule,
  one-update-per-minute message and 5-second clip are **UI strings**; the server may enforce different
  numbers. Toy file counts and sizes are not documented publicly.
- **Editor intelligence.** `App` contains CodeMirror 6's completion and hover **UI**; whether a Lua
  completion source, diagnostics or hover provider is registered is not verified. Ours has none.
- **Their docs rendering.** Only the 15 chapter ids/titles/descriptions were read from `App`; the
  rendered chapters, code blocks and examples were not fetched one by one (the route is client-side and
  would have cost one request per topic for prose we do not copy).
- **What's new completeness.** `App`'s `zS` constant holds one entry (2026-10-26). Whether an older
  entry was removed from the bundle is not verified.
- **Performance.** No load-time measurement was made on either site, and the wasm PPU core's size was
  not fetched. The byte counts above are file sizes, not transfer sizes (the live host may compress;
  our repo serves uncompressed files).
- **Mobile.** The manifest, icons and touch components were read; neither site was opened on a phone or
  tablet, and no touch gesture was tested.
- **Our own runtime.** The studio was read, not opened; claims about the current UIs are from the files
  and the existing tests in `tests/`, not a fresh browser run. No synthetic input was sent anywhere.
- **The ppu.toys GitHub repository.** `docs/PPU-TOYS.md`'s commit `0b07767` (2026-10-18) was not
  re-read. If their public repo has moved since, anything in that document's agent/CLI sections may be
  stale even though the served site is unchanged.
- **SNES hardware claims.** Words like Mode 7, HDMA, BRR and SRAM describe the SNES side only; this
  audit did not re-verify their behaviour on hardware. They are marked N-A for PCEStudio, not "missing".
