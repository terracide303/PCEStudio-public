# PUBLIC-CHECK — the repo before it goes public (card #146)

Dennis, 2026-10-29: *"we'll open the repo tomorrow."* This is the audit the
board asked for: **findings only**. Nothing in history was rewritten, no
setting was changed, no file outside this document was touched.

- **Audited commit:** `09d56b0` (`origin/main`, 2026-10-29). `main` was moving
  while this ran — several seats were pushing — so the counts below are as of
  that commit. Every finding is a property of the whole history, not of one
  tip, and Appendix B has the commands to re-read the current tip.
- **Method:** read-only `git` (`rev-list`, `log`, `ls-tree`, `grep`), `curl`
  against the public upstreams named in the findings, and the files on disk.
  Nothing was written but this file.

## The short answer

| # | finding | who it hurts | verdict |
|---|---|---|---|
| [F1](#f1) | `vendor/huc` has no settled licence **and** carries commercial firmware and game art | the whole project — the one blocker | **must be decided before the flip** |
| [F2](#f2) | 106 commits are authored by `99736355+terracide303@users.noreply.github.com`; every commit made on this machine will be | Dennis's privacy | decide: accept, or rewrite |
| [F3](#f3) | no secrets anywhere in the history — no password, token, key or Nextcloud/cPanel login | — | clean (one hostname + username to look at) |
| [F4](#f4) | personal paths and names throughout: `/Users/dennisschauw`, `/Volumes/External II`, other projects' names | Dennis's privacy | decide: accept or scrub the tip |
| [F5](#f5) | **ART RULE holds**: no raw or converted art from any demo pack is in any commit | — | clean |
| [F6](#f6) | copied code and the README's licence list disagree in two places | licensing clarity | one-line fix + F1 |
| [F7](#f7) | the card text itself publishes the address, and the board is in the repo | Dennis's privacy | follows from F2 |

---

## F1 — `vendor/huc`: no licence can be stated, and it contains commercial material

This is the finding the 2026-10-28 decision in `docs/DECISIONS.md` was
written about ("a settled licence **or must be removed with its history**").
It is worse than "unsettled": two files in it are commercial material whose
own notices forbid redistribution.

### F1.1 What was audited

- `vendor/huc` — 1,372 files, added in **one commit**, `8bacb8c` (2026-10-28),
  and never touched again (`git log -- vendor/huc` returns that commit only).
- Copied from `pce-devel/huc` at `54f5c73606c1e7142e8095c727cab2767e2b3cb3`
  (2026-09-10), as `vendor/huc/VENDORED.md` says.
- **Verified identical to upstream, except the stated omissions.** Comparing
  the GitHub tree API at that commit with `git ls-tree -r HEAD vendor/huc`:
  1,375 upstream blobs, 1,372 local; the only differences are `pic/.keep`,
  `pic/demonblazon.png`, `pic/magicianlord.gif`, `pic/multiblk.webp` (left
  out, as documented) and the added `VENDORED.md`. **0 files differ in
  content.** So PCEStudio made no changes to it.

### F1.2 The licence texts, and where they sit in the chain

| repo | what its licence says | GitHub's label |
|---|---|---|
| `pce-devel/huc` | the aggregate `LICENSE` quoted below — byte-identical to the vendored copy (fetched from `raw.githubusercontent.com` and `diff`ed) | `NOASSERTION` |
| `uli/huc` (Ulrich Hecht's original improved HuC) | the **same** `LICENSE` file, byte-identical (`diff`ed against the vendored copy) | `NOASSERTION` |
| `ArtemioUrbina/huc` (the fork `pce-devel/huc` forked from; GitHub API `parent`) | no separate licence file found; also `NOASSERTION` | `NOASSERTION` |
| the original HuC (David Michel, ~1999–2005) | **no licence text anywhere.** The vendored tree's own docs (`doc/huc/clibref.txt`: "HuC v3.21 C library reference, 2005.04.09") and the upstream README ("initially developed by David Michel around 1999", "an upgraded version of Ron Cain's Small-C") name the lineage but state no terms | n/a |

The aggregate `vendor/huc/LICENSE` says, in its own words:

> The HuC software development kit is based on material from several sources,
> with the most important ones predating a general awareness of software
> licensing issues: both the C compiler and assembler are derived from code
> from the early 1980s. […] It is therefore next to impossible to make an
> exact statement on the legal status of much of this collection of software,
> with the following exceptions: [PCEAS freeware; TGEmu GPL; GCC-derived
> tests GPL]. The following license text ("Simplified BSD License") applies to
> any changes and additions made by Ulrich Hecht.

### F1.3 What IS granted, with the file that grants it

| component | grant | evidence in the tree |
|---|---|---|
| **PCEAS** (the MagicKit assembler — the part PCEStudio actually uses) | *"This program is freeware. You are free to distribute, use and modifiy it as you wish."* | `vendor/huc/src/mkit/as/main.c:8` |
| Ulrich Hecht's changes and additions | BSD-3-Clause, © 2014 Ulrich Hecht | `vendor/huc/LICENSE` (tail) |
| HuC/HuCC library and startup headers — 48 files | Boost Software License 1.0 (© John Brandwood) | `vendor/huc/include/huc/`, `vendor/huc/include/hucc/` — "Distributed under the Boost Software License, Version 1.0" in 48 files |
| John Brandwood's assembler examples, `sym2inc`, `wav2vox`, `pce2png` | Boost 1.0 | `LICENSE_1_0.txt` in each folder |
| zlib (Mark Adler, Jean-loup Gailly) | zlib licence (notice required) | `src/mkit/as/pngreadwrite/`, `src/tools/pce2png/pngwrite/` |
| libpng (Cosmin Truta et al.) | libpng licence (notice required) | same folders |
| salvador (Emmanuel Marty), `matchfinder.c` (CC0), divsufsort (MIT, © 2003 Yuta Mori) | zlib / CC0 / MIT | `src/mkit/as/salvador/LICENSE*.md` |
| TGEmu (test-suite emulator) | GPL-2.0 (full text) | `tgemu/src/license` |
| GCC-derived tests | GPL | `vendor/huc/LICENSE` ¶3 |

### F1.4 What is NOT granted

1. **The HuC compiler itself** — `src/huc/` and `src/hucc/` — and the HuC C
   library proper. They descend from Small-C (Ron Cain, James E. Hendrix) and
   from David Michel's 1999–2005 versions; **no licence text exists for
   either**. This is the part the HuC `LICENSE` refuses to state terms for.
2. **The rest of MagicKit beyond PCEAS.** The freeware sentence is in the
   assembler's `main.c`; it does not obviously cover every file under
   `src/mkit/`.
3. **A single SPDX licence for the tree.** There is none. GitHub agrees for
   all three repos.
4. **GPL compatibility.** TGEmu is **GPL-2.0**, not "or later". GPL-2-only is
   incompatible with this project's GPL-3.0-or-later (`LICENSE`); the two
   would have to stay separate works, which the unlicensed compiler core
   makes impossible to argue cleanly.

### F1.5 Commercial material inside `vendor/huc` (separate from the licence question)

These are in the same commit and go public with it, whoever resolves F1.

| file(s) | what it is | what its own notice says |
|---|---|---|
| `examples/asm/elmer/include/ipl-scd.dat` (4,096 B) | a fragment of NEC/Hudson's **CD-ROM System Card IPL ROM** | Its first bytes are the Hudson copyright notice in Shift-JIS: *"このプログラムの著作権は株式会社ハドソンが所有しております。… 複写・複製・転用することは著作権法により禁じられております。"* — "The copyright of this program is owned by Hudson Soft. Copying, reproducing or repurposing part or all of it without Hudson's written permission is prohibited by copyright law." |
| `examples/hucc/seran/` (42 files, incl. `seran-map.png` 1024×1024) | artwork from **Nihon Falcom's "Legend of Xanadu 2"** | the folder's own `README.md`: *"Their artwork is used under the 'fair use exemption' to copyright… The artwork itself may not be used in commercial games without Nihon Falcom's express written permission."* |
| `examples/hucc/obeybrew-tutorial4..7/` — `bonk.png`, `bonksprites.png`, `bonkwalk.png`, `scene.png`, `tut6/7*.png` | **Bonk** sprites — Hudson Soft's trademarked character | no licence text; the tutorials' C files say `#incspr(bonk,"bonk.png",…)` |
| `examples/asm/elmer/ted2-test-sherlock/SHERLOCK.DAT` (196,608 B) | data derived by running **"Sherlock Holmes Consulting Detective"** (a commercial CD game) | `readme.txt` says you must supply the game's own boot code yourself; the derived table is shipped |
| `examples/asm/elmer/font/font8x*-syscard*.dat/.fon/.zx0` | fonts lifted from the System Card ROM | no licence text |
| `examples/asm/elmer/doc/syscard-cd-ipl.txt`, `syscard-irq1.txt` | disassembly of Hudson's CD boot loader and IRQ code | "For reference, here is a disassembly of Hudson's boot-loader code" |

`vendor/huc/VENDORED.md` says *"Left out: `pic/` (screenshots of commercial
games; PCEStudio keeps no commercial game data)."* The four `pic/` files were
indeed left out — but the table above is commercial game data that was **not**
left out, so that sentence in `VENDORED.md` is not true as written.

### F1.6 Options

**A. Remove `vendor/huc` before opening, from the published history** — the
option `docs/DECISIONS.md` (2026-10-28) already names.
- It was introduced by a single commit (`8bacb8c`), which makes a filtered
  history straightforward: `git filter-repo --path vendor/huc --invert-paths`
  (or `git filter-branch --index-filter 'git rm -r --cached --ignore-unmatch
  vendor/huc'`), then force-push, or start the public repo from the filtered
  export. Every commit after `8bacb8c` is rewritten (new hashes).
- **The website does not change**: `tools/deploy.sh` never uploads
  `vendor/huc` ("NOT … vendor/huc (its licence is not settled)"), so the
  studio at pcestudio.terracides.com neither ships nor needs it.
- `tools/build-huc.sh` uses the copy; it can point at an external checkout
  instead (the 2026-10-27 decision had PCEAS as an external tool before
  2026-10-28 replaced it).

**B. Remove it from the tip only** — does **not** work. The history is public;
a deletion commit leaves every blob fetchable by hash.

**C. Open with it as-is and add a NOTICE** — fastest, and the honest reading
of the texts is that it redistributes code with no licence (F1.4.1) plus
Hudson and Falcom material whose notices forbid it (F1.5). This contradicts
`docs/DECISIONS.md` 2026-10-28 and the README.

**D. Trim instead of remove** — keep only what is licensed (PCEAS + the 48
Boost headers) and drop the compiler, TGEmu, tests and examples. Still needs
the history rewrite of A, because the rest is already in history.

**E. Ask upstream for terms** (`pce-devel/huc`, `ArtemioUrbina`,
`uli`, John Brandwood, the David Michel estate / Small-C lineage) — the only
option that could keep the compiler, and not achievable before tomorrow.

**Recommendation (reasoning, not something I read): A, then a later,
separate commit re-adding only PCEAS and the Boost-licensed headers with
their notices, if the build still wants them in-tree.**

---

## F2 — the author email: 106 commits carry `99736355+terracide303@users.noreply.github.com`

Card text said 72; the history has grown. At `09d56b0`:

- **106** commits are authored `Dennis Shaw <99736355+terracide303@users.noreply.github.com>`.
- **394** are the GitHub no-reply address `99736355+terracide303@users.noreply.github.com`
  (and 1 plain `terracide303@users.noreply.github.com`).
- **Every commit made on this machine uses the hotmail address**, including
  every other seat's and the commit that adds this file: the repo's
  `git config user.email` and the global config both return it. So the number
  grows with every commit until the config changes.

The address is not a secret — it is the account's own commit identity — but it
is personal data that becomes permanently public and is hard to un-publish.
The full list is **Appendix A**.

### Options

1. **Accept it.** It is already the identity on 394+ commits' sibling account,
   and GitHub profiles expose the account anyway.
2. **Stop the growth now:** set a no-reply identity before the next commit
   (`git config user.email "99736355+terracide303@users.noreply.github.com"`
   and the same globally). This does **not** change existing commits.
3. **Rewrite the identity** (`git filter-repo --email-callback`, or a
   `.mailmap` plus a rewrite) — changes every commit hash, so it has to be
   decided together with F1's rewrite, before the push.
4. **Fresh repo** built from a filtered export — merges 1(A) and 2/3 into one
   operation.

Note for 2/3: the address also appears in **file contents**, not only commit
metadata — `docs/PLAN.md` at the tip, in the text of this very card, repeated
across 21 commits (see F7). A history rewrite that only touches commit
metadata would still publish it.

---

## F3 — secrets: none found

Searched every blob reachable from `refs/heads`, `refs/remotes` and
`refs/tags` (`git grep` across all commits, plus a sweep of file names):

| what was looked for | result |
|---|---|
| passwords, API keys, tokens (`ghp_`, `xox*-`, `AKIA…`, `sk-…`, private-key blocks) | **none** |
| `.env`, `.pem`, `.key`, `.netrc`, `.htpasswd`, keystores, SSH keys — ever committed | **none** |
| Nextcloud | **not mentioned anywhere** in the tree or history |
| cPanel / hosting login | **host and username only**, no password: `tools/deploy.sh:13` `CP="${PCE_CP_HOST:-https://sv97.ifastnet.com:2083}"`, `:14` `USER="${PCE_CP_USER:-terracid}"`. The password is read from the environment and the script refuses to run without it (`:23`) — the comment says *"never put it in a file"*. |
| emails in file contents (outside `vendor/`) | exactly two: `99736355+terracide303@users.noreply.github.com` (F2/F7) and `brullov.ad@gmail.com` (the Oak Woods pack author's own support address, quoted from the pack's `readme.TXT` in `toys/oak-woods/README.md`) |

**Options for the cPanel host/user:** (a) leave them — a hostname and a shared
hosting username are not credentials; (b) make both required environment
variables with no defaults (a two-line change) if Dennis would rather not
advertise the host; (c) rotate the cPanel password if the combination worries
him. No action is needed for the repo to open.

---

## F4 — personal paths and names

Not secrets, but they publish the machine, the drives and other projects.

| pattern | occurrences at `09d56b0` | where |
|---|---|---|
| `/Users/dennisschauw` | **1,182** in **119 files** | every `tests/dumps/*/mednafen.log` (Mednafen echoes its base directory and settings paths) |
| `/Volumes/External…` (incl. `External II`) | **290** in **156 files** | `docs/` (BUILD, MANUALS, ARES, DECISIONS, PLAN, REVIEW-*), `RESUME_HERE.md`, `tests/*.js`, `tools/*.sh`, `tools/*-assets.js`, `tools/deploy.sh`, the demo toys' READMEs and `toys/oak-woods/main.lua` |
| drive/folder names that reveal other work | — | `/Volumes/External II/scratch` (100), `agent-tmp` (64), `pce-tools` (37), `/Volumes/External/MiniST_Project` (11), `PCEHeroTN`, `DHS-Agent`, `/Volumes/External/Download` (8, naming the demo `.zip`s), `/Volumes/External/pcestudio-toys` |
| the name **Dennis Shaw** | 102 commit authors + throughout docs | — |
| the domain `terracides.com` / site `pcestudio.terracides.com` | in docs, README, deploy | already public (the site is live) |

### Options

1. **Accept.** These are personal-but-not-secret; many OSS repos carry their
   author's home paths. The dumps' paths are harmless logs.
2. **Scrub the tip only** (docs, scripts, `tests/dumps/*/mednafen.log`,
   `meta.json`): replaces the username and drive names with `<home>` /
   `<drive>`. History keeps them. Caveat: `tests/check-psg.js`,
   `tests/check-wave.js` and `tests/check-breaker-78.js` read
   `mednafen.log`, and `tests/check-il-console.js` reads `meta.json` — they
   look for "Using module: pce_fast" and measurements, not paths, so a
   careful scrub is testable, but it is a change to test fixtures and would
   need its own card.
3. **Rewrite the strings out of history** — same cost class as F1(A), and
   only worth doing if a rewrite is already happening for F1/F2.

**Recommendation (reasoning):** 1, unless a rewrite is happening anyway, in
which case add 3 to it.

---

## F5 — the ART RULE holds: no demo-pack art in any commit

Dennis, 2026-10-29 (`docs/DECISIONS.md`): *"About the artwork don't put it on
the repo but it's fine as demo on the website."* The rule was checked against
the **whole published history**, not just the tip.

Commands and results (Appendix B has them verbatim):

1. Every path ever committed: 6,121 distinct paths.
2. **Images under `toys/`, `tools/` or `renderer/`: none.**
   The only images in the history are `docs/ares-*.png`, `docs/hello-mednafen.png`
   (our own captured test pictures), the 3,844 dump files of our own generated
   ROMs, and `vendor/huc`'s third-party art (F1.5).
3. **No path named after any demo pack** (`oak`, `cave`, `city`, `trapmoor`,
   `mine`) except the toys' own source: `toys/oak-woods/{main.lua,README.md,
   song.json}`, `toys/cave/{main.lua,README.md}`, `toys/city/{main.lua,
   README.md}`. No `demo-art/` path was ever committed.
4. **No `tests/dumps/{oak-woods,cave,city,…}`**: `ls tests/dumps | grep -iE
   'cave|city|oak|platform|tower'` has no demo-pack directory; the platformer
   and tower dumps are of toys whose pictures are drawn in their own Lua
   (`puttile`/`putsprite`, READMEs say "no pack art").
5. **No base64 or long hex blobs in any toy's Lua** (`grep -E
   '[A-Za-z0-9+/]{120,}|[0-9A-Fa-f]{64,}'` on every `toys/**/*.lua`: 0 hits);
   the longest committed demo file is `toys/oak-woods/main.lua`, 8,372 B,
   and its art block is a drawn placeholder.
6. `toys/oak-woods/song.json` (28,732 B) is **our own original module**, not
   the pack's: `tools/oak-woods-song.js` writes it note by note ("nothing
   borrowed"), and its header says `"author": "PCEStudio"`.
7. **Only the toys' Lua and READMEs are committed**, exactly as the rule says;
   the converted art lives in `demo-art/` beside the repo, uploaded by
   `tools/deploy.sh`, and the tests SKIP when it is absent.

**No action.** One caveat for the flip: this holds for the refs that will be
published (`refs/heads`, `refs/remotes`, `refs/tags`). While this ran, other
seats' local-only worktrees carried commits that were not on any ref; they
added no art, but a seat could push such a commit later. The rule is being
kept; it is not enforced by a gate — `tests/` has no check that fails on a
committed image. A cheap future guard would be a test that fails if
`git ls-files` shows an image under `toys/` or a `demo-art/` path.

---

## F6 — copied code, and the README's licence list against the tree

`README.md` says: Fengari, CodeMirror, HuTrack and the parts from ppu.toys are
MIT; `renderer/pce-psg.js` is Mednafen/Blip_Buffer (GPL-2+/LGPL-2.1+); "HuC's
licence is mixed and unsettled".

Checked against the tree:

| in the tree | stated in README? | actual licence (verified) |
|---|---|---|
| `vendor/fengari` | yes, MIT | MIT (`vendor/fengari/LICENSE`) ✓ |
| `vendor/codemirror` | yes, MIT | MIT © 2017 Marijn Haverbeke ✓ |
| `vendor/hutrack` | yes, MIT | MIT © 2023 Turboxray ✓ |
| `vendor/ppu-toys` | yes, MIT | MIT © 2026 Liora Labs ✓ |
| `renderer/pce-psg.js` | yes (Mednafen + Blip_Buffer) | notice in the file, ✓ |
| `vendor/huc` | "mixed and unsettled" | accurate — see F1 |
| **HuDK** (`BlockoS/HuDK`, MIT © 2016–2020 MooZ) — adapted in `tools/viewer.asm` (notice in the file, line ~950), cited in `tools/hello.asm`, `tools/toyc/toy_runtime.c`, `docs/PADS.md` | **no** | MIT — needs a line in the README list |
| third-party licences embedded **inside** `vendor/huc` (zlib, libpng, Boost 1.0, CC0, MIT divsufsort, GPL-2 TGEmu, Mednafen-GPL `adpcm.txt`) | not named | F1 — they travel with `vendor/huc` |
| `renderer/{viewer-bank0,ilvm,hutrack-engine}.bin`, `tools/hello.pce` | n/a | built here from `tools/*.asm` + `vendor/hutrack`; source is in the tree ✓ |

**Options:** add HuDK to the README's licence bullet (one line, no history
issue). Nothing else is unaccounted for once F1 is decided. This is a
read of the texts, not legal advice — for F1 especially, a lawyer's read is
worth having before a rewrite, not after.

---

## F7 — the card text and the board are public too

`docs/PLAN.md` is committed, and card #146's own text contains the hotmail
address (it is how the audit was briefed). At `09d56b0` it appears in
`docs/PLAN.md` and in 21 historical versions of it. So:

- a rewrite that fixes commit metadata (F2) **without** editing that line
  still publishes the address;
- this document adds one more copy of it, in Appendix A and here.

**Option:** if F2 is answered with a rewrite, replace the address in
`docs/PLAN.md` with "the author's hotmail address" in the same operation;
otherwise accept it.

---

## What has to be decided before the flip

1. **F1** — remove `vendor/huc` from the history (rewrite or fresh repo), or
   open with it (accepting F1.4 and F1.5). Everything else can ship either
   way.
2. **F2** — accept the hotmail authorship, or fold a rewrite into F1's; and
   change the machine's `git config user.email` before the next commit
   either way.
3. **F3/F4** — no action needed; optional cleanups if a rewrite is happening.
4. **F5** — nothing to do; it is clean.
5. **F6** — add HuDK to the README's licence list (independent of the rest).
6. **F7** — follows from F2.

Not done here, and not this card's to do: `git filter-repo`, the push, the
repository visibility, and any decision about the live site (which already
publishes the studio, not `vendor/huc`).

---

## Appendix A — the 106 commits authored `99736355+terracide303@users.noreply.github.com`

As of `09d56b0`. The commit that adds this file will make it 107, and every
commit made on this machine from now on joins the list until `user.email`
changes (F2). Re-run the command in Appendix B for the current list.

| commit | date | subject |
|---|---|---|
| `09d56b0` | 2026-10-29 | PCEStudio: #148 also fixes CITY's run animation (Dennis: the gun goes up at the end of the cycle) |
| `09d56b0` | 2026-10-29 | PCEStudio: card #150 — OAK WOODS depth: composited background, slow sky strip, front trunks as sprites (Dennis: the trees are cut) |
| `458b2d2` | 2026-10-29 | PCEStudio: merge origin/main — regenerate the gallery over another seat's change |
| `c9456df` | 2026-10-29 | PCEStudio: #148 — CITY's bands loop on their own counters, and the water is the near band |
| `f8ddb6e` | 2026-10-29 | Merge origin/main into card #147: #148 and #149 cards beside the closed #147 row |
| `a794009` | 2026-10-29 | Merge origin/main into card #147: CITY (#125) beside PLATFORMER and TOWER |
| `8272936` | 2026-10-29 | PCEStudio: card #149 — CAVE's converted picture is wrong (grid of dots, short repeats) |
| `be9308d` | 2026-10-29 | Merge branch 'main' of https://github.com/terracide303/PCEStudio into HEAD |
| `7972804` | 2026-10-29 | PCEStudio: board — #125 CITY in progress with its evidence; the duplicate line parked |
| `b2a518e` | 2026-10-29 | PCEStudio: card #148 — CITY's parallax bands must loop and keep back objects out of the front band (Dennis, playing it) |
| `0075ed4` | 2026-10-29 | PCEStudio: #125 — take the dead demo-art fetch out of the studio |
| `beeb617` | 2026-10-29 | PCEStudio: card #147 — PLATFORMER and TOWER in toys/ and Browse |
| `e44184f` | 2026-10-29 | Merge branch 'main' of https://github.com/terracide303/PCEStudio into HEAD |
| `8a542ff` | 2026-10-29 | PCEStudio: #141 — the card note records the merged check count and word count |
| `012872b` | 2026-10-29 | PCEStudio: #141 — move the parallax bytecode calibration with the wrap |
| `ac480fb` | 2026-10-29 | PCEStudio: #144 closed on the board |
| `5db35f2` | 2026-10-29 | Merge branch 'main' of https://github.com/terracide303/PCEStudio |
| `2ae9d4e` | 2026-10-29 | PCEStudio: board — #127 CAVE to check with its evidence; #148 routed (route 1's 127-constant pool blocks every art demo's Export) |
| `113fc77` | 2026-10-29 | Merge branch 'main' of https://github.com/terracide303/PCEStudio into HEAD |
| `6bfc3f9` | 2026-10-29 | PCEStudio: #125 — regenerate the gallery after the toy's header rewrite |
| `4b3c1a4` | 2026-10-29 | PCEStudio: merge origin/main — #125 CITY joins #127/#128's demo-art route |
| `f8026f1` | 2026-10-29 | Merge branch 'main' of https://github.com/terracide303/PCEStudio into HEAD |
| `caca6f8` | 2026-10-29 | Merge branch 'main' of https://github.com/terracide303/PCEStudio into HEAD |
| `33f3587` | 2026-10-29 | Merge branch 'main' of https://github.com/terracide303/PCEStudio into HEAD |
| `d0dc917` | 2026-10-29 | Merge origin/main: #144 beside #139's citation renumber |
| `69344df` | 2026-10-29 | PCEStudio: card #147 — PLATFORMER and TOWER as demos in toys/ (Dennis) |
| `84a79ab` | 2026-10-29 | Merge origin/main: #144's free-running play loop beside #127/#128/#146 |
| `3759f72` | 2026-10-29 | Merge branch 'main' of https://github.com/terracide303/PCEStudio into HEAD |
| `bb881e3` | 2026-10-29 | PCEStudio: follow #139 — the moved studio.html citation and the card number |
| `cd0fee0` | 2026-10-29 | PCEStudio: #144 — ▶ plays past Length until Stop, like ppu.toys' Studio |
| `032d753` | 2026-10-29 | PCEStudio: #141 — the chat-AI guide's seven real bugs, fixed and each held by a test |
| `f1a2543` | 2026-10-29 | Merge branch 'main' of https://github.com/terracide303/PCEStudio into HEAD |
| `3e05cfa` | 2026-10-29 | PCEStudio: #128 — the test's Export note names the tool that prints it |
| `dff6b36` | 2026-10-29 | PCEStudio: the repo opens tomorrow (Dennis); #146 the pre-public audit |
| `09e85ea` | 2026-10-29 | PCEStudio: #125 — the pages carry the demo's art from the site, not the repo |
| `cf0f8a6` | 2026-10-29 | PCEStudio: #125 — CITY plays in the studio and on the site; the pack's art stays out of the repo |
| `481a96d` | 2026-10-29 | PCEStudio: #127 CAVE — a demo over the Retro Pixel Cave pack, art beside the repo, card in Browse |
| `f3ff9bc` | 2026-10-29 | PCEStudio: #127 CAVE appears in Browse, and the site gets the art the repo cannot hold |
| `c13e32b` | 2026-10-29 | Merge branch 'main' of https://github.com/terracide303/PCEStudio into HEAD |
| `9467f55` | 2026-10-29 | PCEStudio: #127 CAVE — the demo, its converter and its test; the art stays beside the repo |
| `f070874` | 2026-10-29 | Merge branch 'main' of https://github.com/terracide303/PCEStudio into HEAD |
| `0012669` | 2026-10-29 | PCEStudio: merge origin/main into #128 — song-aware console tool, cards #141 and #143 kept |
| `6798336` | 2026-10-29 | Merge origin/main: keep #144/#145 beside #142's close |
| `facc345` | 2026-10-29 | PCEStudio: #128 OAK WOODS — a forest runner through the #123 importer, art in demo-art, Export blocked and reported |
| `4db875b` | 2026-10-29 | PCEStudio: cards #144 (a game stops at the timeline Length) and #145 (a dropped .lua keeps the old toy's assets), from Dennis's first Claude-written game |
| `b505126` | 2026-10-29 | Merge branch 'main' of https://github.com/terracide303/PCEStudio into HEAD |
| `7bbe060` | 2026-10-29 | PCEStudio: #140 closed on the board — the picker's evidence, and the card text back |
| `62ea23a` | 2026-10-29 | Merge branch 'main' of https://github.com/terracide303/PCEStudio into HEAD |
| `a8079d7` | 2026-10-29 | PCEStudio: #139 resizable studio regions — three draggable dividers |
| `e6edac9` | 2026-10-29 | Merge branch 'main' of https://github.com/terracide303/PCEStudio into HEAD |
| `4f8483f` | 2026-10-29 | PCEStudio: #142 — the MCP server as a download, and the guide's way in |
| `89ea055` | 2026-10-29 | Merge branch 'main' of https://github.com/terracide303/PCEStudio into HEAD |
| `b631d58` | 2026-10-29 | PCEStudio: #143 is backlog, like the other filed fixes (#132-#138) |
| `7bda742` | 2026-10-29 | Merge branch 'main' of https://github.com/terracide303/PCEStudio into HEAD |
| `5880cf5` | 2026-10-29 | PCEStudio: #140 — the AUDIO voice picker lists the song's patches and all 15 built-ins |
| `ccd02cc` | 2026-10-29 | Merge branch 'main' of https://github.com/terracide303/PCEStudio into HEAD |
| `462fa0a` | 2026-10-29 | PCEStudio: #131 — the second pass: a check, and the gate after #132 (#143) |
| `e1ce7af` | 2026-10-29 | PCEStudio: cards #141 (the guide's bugs, from a cold Claude's review) and #142 (the MCP server as a download in the guide, Dennis) |
| `fdf677b` | 2026-10-29 | PCEStudio: board — mark the duplicate #125 line as a merge leftover (kept), so the CITY card can be started |
| `cea7029` | 2026-10-29 | PCEStudio: demo art goes on the website, never in the repo (Dennis); #126 and #130 unblocked |
| `a53ccef` | 2026-10-29 | Merge branch 'main' of https://github.com/terracide303/PCEStudio |
| `2613026` | 2026-10-29 | PCEStudio: PROGRESS-RUN — fresh clone 42 PASS/1 SKIP/1 FAIL (check-browser now 2 of 25) on 4336b98; #124's pad keys and #123/#95/#119 closed; every card to #139 in a row |
| `4336b98` | 2026-10-29 | Merge branch 'main' of https://github.com/terracide303/PCEStudio |
| `5931467` | 2026-10-29 | Merge origin/main into PROGRESS-RUN: the run's page against #95/#119/#123 and route 1's findings |
| `2f144c7` | 2026-10-29 | PCEStudio: PROGRESS-RUN — fresh clone 40 PASS/1 SKIP/1 FAIL (check-browser, #114) on b49d595; #117/#118/#119 closed, #123's Add Source on main, all 131 cards covered |
| `5ab9cfc` | 2026-10-29 | PCEStudio: board — #117 done (the importer) |
| `fab96b1` | 2026-10-29 | PCEStudio: #117 — regenerate the reference for the host's asset codes |
| `2f33f88` | 2026-10-29 | Merge origin/main into PROGRESS-RUN: keep #115/#120/#121 closures and #118's tget with the fresh-clone run on c014940 |
| `412fc08` | 2026-10-29 | PCEStudio: PROGRESS-RUN — fresh clone 38 PASS/1 SKIP/1 FAIL (check-browser, #114) on c014940; #115 and #120 closed, #121's STARFALL in Browse, check-studio 1,396 |
| `2f69037` | 2026-10-29 | PCEStudio: board — #115 done again (561b9b0 reverted the mark from a stale tree) |
| `d17387f` | 2026-10-29 | PCEStudio: board — repair the #121 board move |
| `6e4c64f` | 2026-10-29 | PCEStudio: board — #121 done |
| `390eb9f` | 2026-10-29 | Merge branch 'main' of https://github.com/terracide303/PCEStudio |
| `c8f9a88` | 2026-10-29 | Merge branch 'main' of https://github.com/terracide303/PCEStudio |
| `f2948f2` | 2026-10-29 | PCEStudio: PROGRESS-RUN — fresh clone 38 PASS/1 SKIP/1 FAIL (check-browser, #114) on 3bd9378; #120's documented route and #121 recorded, check-studio 1,337 |
| `e7b0327` | 2026-10-29 | PCEStudio: board — #115 done |
| `3666c43` | 2026-10-29 | PCEStudio: #115 — the studio's Export builds the toy's .pce in the page |
| `4464d2a` | 2026-10-29 | PCEStudio: PROGRESS-RUN — fresh clone 38 PASS/1 SKIP/1 FAIL (check-browser, #114) on 52a61bf; check-viewer 41 captures and check-export 32 scenes current |
| `52a61bf` | 2026-10-29 | PCEStudio: PROGRESS-RUN — fresh clone 38 PASS/1 SKIP/1 FAIL (check-browser, #114) on 43efb86; #116's nine checks and #88's STARFALL on the page, demo row PARTIAL with #117-#120, check-studio 1,335 and check-pokes 151 |
| `75a55cb` | 2026-10-29 | PCEStudio: PROGRESS-RUN — fresh clone 37 PASS/1 SKIP/1 FAIL (check-browser) on 97a494a; #114/#115/#116 on the page, #80 Browse proven, REVIEW-PANELS' 9 misses recorded |
| `58af6c2` | 2026-10-29 | PCEStudio: board — #80 Browse is done (gallery of the five #29 toys + a toy's own page) |
| `12ea099` | 2026-10-29 | PCEStudio: REVIEW-PANELS — gate on the tip too (37 PASS / 1 SKIP / 0 FAIL) |
| `2109232` | 2026-10-29 | PCEStudio: REVIEW-PANELS — record the post-commit gate (36 PASS / 1 SKIP / 0 FAIL) |
| `7653e62` | 2026-10-29 | PCEStudio: #85/#86/#92/#79/#93/#97/#98/#99/#107 — panel breaker run, 21 breaks: 12 caught, 9 missed |
| `ff7f0c1` | 2026-10-29 | PCEStudio: PROGRESS-RUN — fresh clone 36 PASS/1 SKIP/0 FAIL on 4a96740; #111 closed and #112 PROVEN on the IL row, #113 filed on the sound row |
| `ac81d3d` | 2026-10-29 | PCEStudio: PROGRESS-RUN — fresh clone 36 PASS/1 SKIP on 21e6d5e; #103 PROVEN, #105 PARTIAL, IL PARTIAL for #112, studio suite 1,227 |
| `21e6d5e` | 2026-10-29 | Merge remote-tracking branch 'gh/main' |
| `9556fba` | 2026-10-29 | Merge branch 'main' of https://github.com/terracide303/PCEStudio |
| `1a7a1d2` | 2026-10-29 | PCEStudio: PROGRESS-RUN — #103's skill suite in, #111 and #112 recorded; fresh clone 36 PASS on 78b2c73 |
| `78b2c73` | 2026-10-29 | Merge branch 'main' of https://github.com/terracide303/PCEStudio |
| `a6c9878` | 2026-10-29 | PCEStudio: PROGRESS-RUN — #97 and #99 PROVEN, #87 NOT PROVEN, #111 on the sound row; fresh clone 35 PASS on 49e9dfa |
| `d3b0ed9` | 2026-10-29 | PCEStudio: #103 — the IL boolean card is #112, not #111 |
| `49e9dfa` | 2026-10-29 | Merge branch 'main' of https://github.com/terracide303/PCEStudio |
| `f4f1559` | 2026-10-29 | PCEStudio: PROGRESS-RUN — #99 ASSETS PROVEN by check-assets (246 checks); fresh clone 35 PASS on 582c2dd |
| `0669cf9` | 2026-10-29 | PCEStudio: board — #87 done (pceglobals.lua, AGENT text and Sign-in, Go to marker, the frame scaled like theirs) |
| `582c2dd` | 2026-10-29 | Merge branch 'main' of https://github.com/terracide303/PCEStudio |
| `660d2f7` | 2026-10-29 | PCEStudio: PROGRESS-RUN — #98 and #92 PROVEN, #100 PARTIAL; fresh clone 34 PASS / 1 SKIP / 0 FAIL on 0d31701 |
| `6311acf` | 2026-10-29 | Merge branch 'main' of https://github.com/terracide303/PCEStudio |
| `ea81081` | 2026-10-29 | PCEStudio: PROGRESS-RUN — CAPABILITY from the board: #87/#93/#97/#98/#99/#100/#103 running; fresh clone 34 PASS / 0 FAIL / 1 SKIP on 890466f (#108 done) |
| `b53df67` | 2026-10-29 | PCEStudio: PROGRESS-RUN — merge #110 CAPABILITY; fresh clone 28 PASS / 6 FAIL / 1 SKIP on 4656c76 (#108) |
| `3441145` | 2026-10-29 | PCEStudio: PROGRESS-RUN — CAPABILITY from the board: #79/#85/#86/#102/#45/#36/#107 proven, #92 running; fresh clone 28 PASS / 6 FAIL / 1 SKIP (#108) |
| `38bbedd` | 2026-10-29 | PCEStudio: CAPABILITY — #110 on the board as LATER (port to the agent-workshop) |
| `2b1527d` | 2026-10-29 | Merge branch 'main' of https://github.com/terracide303/PCEStudio |
| `b348926` | 2026-10-29 | Merge origin/main into the CAPABILITY update (CAPABILITY.md resolved to this run's version) |
| `f278812` | 2026-10-29 | PCEStudio: CAPABILITY up to date — panels (#85, #86, #102, #79), pads (#45), MCP (#36), Paste & Run (#107) proven; SCANLINES running (#92); fresh clone 28 PASS, 1 SKIP, 6 FAIL (#108) |
| `582fe76` | 2026-10-27 | Start PCEStudio: the board, the live-state page, and the first two cards |

## Appendix B — re-running this audit

```sh
cd PCEStudio

# the published history only (not other seats' local worktree HEADs)
git rev-list --branches --remotes --tags --count

# F2 — the author email
git log --branches --remotes --tags --format='%h %ad %s' --date=short \
  --author='99736355+terracide303@users.noreply.github.com'
git log --branches --remotes --tags --format='%ae' | sort | uniq -c

# F2/F7 — the address in file contents
git grep -I -l 'terracide303 (GitHub no-reply)' $(git rev-list --branches --remotes --tags)

# F3 — secrets
git grep -I -n -i -E '(nextcloud|cpanel|ifastnet|BEGIN (RSA|OPENSSH|PRIVATE) KEY|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[bap]-)' \
  $(git rev-list --branches --remotes --tags) -- . ':!vendor'

# F4 — personal paths
grep -rhoE '/Users/[A-Za-z0-9._-]+|/Volumes/External[^/ ]*' --exclude-dir=.git . \
  | sort | uniq -c | sort -rn

# F5 — every path ever, and every image in it
git log --branches --remotes --tags --pretty=format: --name-only | sed '/^$/d' \
  | sort -u > /tmp/paths.txt
grep -iE '^(toys|tools|renderer)/.*\.(png|jpe?g|gif|webp|bmp|pcx)$' /tmp/paths.txt   # expect none
grep -iE 'oak|cave|city|trapmoor|mine' /tmp/paths.txt                                # expect only the toys' .lua/.md/.json

# F1 — is vendor/huc byte-identical to upstream, and what did we leave out?
git ls-tree -r HEAD vendor/huc | wc -l                       # 1372
curl -sL 'https://api.github.com/repos/pce-devel/huc/git/trees/54f5c73606c1e7142e8095c727cab2767e2b3cb3?recursive=1'
```

## Appendix C — how the HuC/licence research was done

- `vendor/huc/LICENSE`, `LICENSE` at `pce-devel/huc@master` and at
  `uli/huc@master`: fetched and `diff`ed — **identical** to the vendored copy.
- `api.github.com/repos/{pce-devel/huc,uli/huc}`: `license` is
  `Other / NOASSERTION` for both; `pce-devel/huc` is a fork of
  `ArtemioUrbina/huc`, which is a fork of `uli/huc`.
- `pce-devel/huc` commit `54f5c736…` exists and its date (2026-09-10) matches
  `VENDORED.md`; its tree was diffed blob-by-blob against `vendor/huc` (0
  content differences; the 4 `pic/` files absent; `VENDORED.md` added).
- The licence files **inside** the tree were read one by one: `tgemu/src/license`
  (GPL-2 full text), `src/mkit/as/salvador/LICENSE.{salvador,zlib,cc0,divsufsort}.md`,
  the four `LICENSE_1_0.txt` (Boost), the zlib/libpng notices in
  `src/mkit/as/pngreadwrite/` and `src/tools/pce2png/pngwrite/`.
- `src/mkit/as/main.c` (freeware statement) and the 48
  `include/huc|hucc` files ("Boost Software License, Version 1.0") were read
  where the statements are, not inferred.
- `examples/hucc/seran/README.md` and the first bytes of
  `examples/asm/elmer/include/ipl-scd.dat` were read and decoded
  (Shift-JIS → the Hudson prohibition above).
