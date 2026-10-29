# toys/oak-woods — OAK WOODS (card #128)

A small forest runner made with the studio's toys, the #123 importer and the
Oak Woods art pack.  The player runs right; the forest has three speeds and no
cut tree (card #150): far and mid trees and the floor are one looping picture at
the ground's speed, a sky strip above the crowns runs at half of it (the RCR line
interrupt rewriting `BXR`, one entry at `SKY_LINE`, one at `MAIN_LINE`, a row where
the picture is one flat colour), and the front trunks are sprites at twice
the ground's speed, recycled as they leave the screen (two on a line at most:
8 of the VDC's 16 sprite strips);
rocks roll in on the ground and cost a life; the sign ends the run.  The top
24 lines are a status bar held still by the split, with TIME counting down and
SCORE rising by one for every rock passed.  IJKL dodges, N (or M) jumps,
P restarts after the sign or a lost run.

## Where the art is — and is not

Dennis, 2026-10-29 (`docs/DECISIONS.md`): *"About the artwork don't put it on
the repo but it's fine as demo on the website in PCE Studio."*  So:

| in this repository | beside it, in `demo-art/oak-woods/` (not committed) |
|---|---|
| `main.lua` with a **placeholder** picture drawn by the file itself | `main.lua` — the same game with the pack's tiles, palettes and sprite patterns |
| `song.json` — our own original module | `background.png`, `character.png`, `props.png` — the composed art the importer read |
| `README.md` (this file), `tools/oak-woods-art.js` | `art.json` (the importer's report), `dumps/` (the test's frames), `README.md` (licence + fit) |

`tools/oak-woods-art.js` extracts the pack to a new folder under `$TMPDIR`
(nothing from it is ever run), composes the one background the PCE shows,
cuts the character sheet into 32×64 sprite cells, and calls
`renderer/pce-source.js` — the #123 importer, the same code the studio's
**Add Source** runs — for each.  It writes the result as the `vram[]`/`pal()`
writes a toy makes.  Re-run it after a change to the game:

```sh
node tools/oak-woods-art.js            # rebuild demo-art/oak-woods/
node tools/oak-woods-art.js --check    # is that folder the tool's output?
```

A fresh clone has no `demo-art/` folder: the toy runs with the placeholder
picture (so Browse still has a card and the studio still opens it), and
`tests/check-oak-woods.js` prints SKIP with the command to build the art.

`tools/deploy.sh` uploads the demo-art folder with the toy and uploads the
playable `main.lua` where Browse reads the source, so the site shows the
pack's forest.

## The licence

The Oak Woods pack's `readme.TXT` is a purchase thank-you with **no licence
text** — no archive comment, and no rights metadata in any PNG's XMP.  Dennis
bought the pack (2026-10-29); the ART RULE is the decision that lets the art
be shown on the website while staying out of the repository, exactly as it
unblocked #126 and #130.

> Thank you for purchasing this asset pack! Please note that all next updates
> of this pack are free for you.
>
> If you find this asset useful, please rate it on itch! Thanks!
>
> Contact:
>
> If you have any questions regarding this asset pack you can contact me here:
>
> E-Mail: brullov.ad@gmail.com
> Twitter: https://twitter.com/brullov_art
>
> If you want to support me, get access to my private Discord server where you
> can suggest asset improvements, check my Patreon.
>
> https://www.patreon.com/brullov
>
> Price will increase with asset's updates.
>
> Check the guide.png for useful info about how to use animations properly.

Credit: **Oak Woods v1.0 by Brullov (brullov.art)**.

The player is the separate `generic_char_v0.2` pack (same author), whose
`readme.TXT` does carry terms:

> You can use it for free or commercial product.
> You can modify it.
> You MUSTN'T redistribute or resell it.
> You MUSTN'T use the assets in any printed media or physical product.

The ART RULE covers showing it in the demo on the website; it is not
redistributed as an asset pack and the raw files are not in the repo.

## The fit to the PC Engine

Measured from the pack by the importer:

| what | measured | the PCE |
|---|---|---|
| colours per 8×8 background tile | max 7 | 15 + transparent |
| background colours overall | 14 after the 3-bit VCE fit | 16 palettes × 16 |
| character colours per frame | 14–18 (21 across the sheet) | 15 + transparent per sprite palette; the importer fits each frame and maps the colours past 15 to the nearest |
| character frame | 32×40 of art in its 56×56 sheet cell | one 32×64 sprite (CGX, CGY = 3) |
| rocks | 20×11 and 27×12 | one 32×32 sprite each |
| sign | 22×31 | one 32×32 sprite |

The 256×232 background is **one** plane (the PCE has one): the pack's three
parallax layers become three bands of one 32×32 BAT, and the RCR line
interrupt rewrites `BXR` at lines 24, 72 and 128 — `toys/parallax.lua`'s
trick with the pack's art.  Line 0 re-registers `BXR` 0 so the bar never
moves.  The BAT's row 28 is off-screen and holds the ten digit tiles the HUD
swaps in.

## Evidence

```sh
node tests/check-oak-woods.js
```

760 frames with a scripted pad, and:

- the playable file is `tools/oak-woods-art.js`'s own output (`--check`);
- the validator accepts it: 7,856 cycles a frame (**0.07×** the 60 Hz video
  frame), 12,016 VRAM words of 32,768, 4 sprite strips on the busiest line;
- **Lua == IL** every frame — vram, cram, sat, regs, the raster table and the
  pixels, 0 differences;
- it plays: four rocks jumped and scored, the sign adds ten and ends the run
  at 14, and the same run with no jump never reaches it (the control);
- the split: line 0 holds `BXR` 0, the three bands move at 1/4, 1/2 and the
  full scroll, and the bar's label cells never change;
- sound: 11,962 PSG writes and **non-silent PCM** — `music()` sets the master
  amplitude, so #113's sfx-only silence does not appear here;
- the frames and `strip.png` land in `demo-art/oak-woods/dumps/` and read back
  pixel for pixel.

## What is not proven — the Export

The studio's **Export** refuses this game, and so does the console backend:
`node tools/starfall-console.js /Volumes/External/agent-workshop-demo/demo-art/oak-woods/main.lua --song toys/oak-woods/song.json`

> validator: ok (no error), 0 problems
> C emitter: cgen-op, instruction `table` — BLOCKED at renderer/studio.html:3499
> 108 of 27,083 IL instructions (0.4%) are refused: table 20, tset 29, tget 24,
> setlist 10 (#132), sprite 6 (#133), padref/padget 5 each (#134), sfx 4 (#135),
> raster 4 (#136), music 1 (new — filed as a card)
> route 1's frame is 252,178 cycles = 2.11 display frames = 28.4 Hz on the
> model; the projected bytecode is ~122 KB against the 8 KiB data bank (#138)

So there is **no .pce and no Mednafen capture**: nothing was built.  The
validator being green says the toy is within the model's budgets; it says
nothing about the console, because neither backend can carry it yet (#132–#138
and the music card).

## Rule 2

`tests/check-oak-woods.js` was written by the card's author.  A cold break by
another seat is owed before the card closes.
