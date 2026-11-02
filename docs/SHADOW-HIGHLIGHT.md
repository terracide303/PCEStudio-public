# SHADOW-HIGHLIGHT — does the studio's VDC and sprite model implement shadow and highlight?

Card #241, answered 2026-11-03. Short answer: **neither mode is modelled, and
neither exists on the PC Engine.** The note in
[`REFERENCES.md`](REFERENCES.md) §7 describes the Sega Mega Drive/Genesis VDP's
shadow/highlight (S/H) feature, not a HuC6270/HuC6260 feature. There is no PCE
register bit to model, so this card adds no implementation card; it adds a guard
test card (#252) and corrects the note below.

What the studio *does* model is the look the note is reaching for: a boss drawn
as background tiles plus sprite layers gets the background's 16 colours and the
sprites' 16-colour palettes on top, which is the "extended palette". That is
ordinary palette art and ordinary composition, not a hardware effect; the
composition is modelled (`renderer/pce-sprites.js`, `renderer/pce-layers.js`).

---

## 1. The PCE's register bits: no S/H field exists

The two Hudson chips hand pixels to each other as **9 bits parallel** — the VDC
feature list says so on **H7-1** — and those 9 bits are the whole interface. The
VCE turns them into one of 512 absolute colours. There is no third state and no
brightness signal for a "shadow" or "highlight" pixel to use.

| Register / word | Bits, in full | Page | S/H field? |
|---|---|---|---|
| VDC **CR R05** | IE 0–3, EX 4–5, **SB 6**, **BB 7**, TE 8–9, DR 10, IW 11–12 | H7-6 (IE/EX/SB/BB/TE), H7-7 (DR/IW) | none |
| VDC **MWR R09** | VM 0–1, SM 2–3, SCREEN 4–6, CM 7 | H7-8 (VM/SM), H7-9 (SCREEN/CM) | none |
| VDC **BAT word** | CG COLOR 15–12, character code 11–0 | H7-14 | none — all 16 bits are named, so there is no per-8×8-tile flag |
| VDC **SAT word 3** | Y flip, CGY, X flip, CGX, SPBG, SPRITE COLOR | H7-20 (layout), H7-21 (Y/X/pattern/colour/SPBG), H7-22 (flips/CGX), H7-23 (CGY) | none named |
| VDC **video output** | SPBG = VD8, SP COLOR = VD7–4, SG3–0 = VD3–0 (sprite); SPBG = 0, CG COLOR = VD7–4, CH3–CH0 = VD3–0 (background) | H7-24 (sprite), H7-18 (background) | none |
| VCE **CR** (`$0400`) | DCC 0–1 only; the figure shades bits 2–15 | H6-3; the shaded-area note is H6-2 | none |
| VCE **colour table** | 512 addresses × 9 bits, VD8 = background/sprite, VD7–4 = block, VD3–0 = pattern colour | H6-4, H6-5 | none |

Two details that close the obvious loopholes:

- **The unnamed VCE bits are not S/H.** The manual shades CR bits 2–15 as "not
  available" (H6-2/H6-3), and the measured note adds only two: D2 = edge blur
  and D7 = mono (pcetech §6, recorded in `MANUALS.md` §15.3). Neither darkens or
  brightens a selected pixel and neither is S/H. The studio models neither bit;
  the model reads DCC 0–1 only (`renderer/pce-bg.js:163–171`, `:198–199`).
- **The SAT's unnamed bits are not S/H.** The manual's field list (H7-20/21/22/23)
  names no shadow/highlight field. The model reads palette 0–3, SPBG 7, CGX 8,
  HFLIP 11, CGY 12–13 and VFLIP 15 and ignores the rest
  (`renderer/pce-sprites.js:151–159`; the same map is documented at `:24–26`).

## 2. What the studio does — file and line

| Thing | Code | What it does |
|---|---|---|
| Background pixel | `renderer/pce-bg.js:406–407, :429` | `bat & 0xFFF` = character, `(bat >> 12) & 0xF` = palette, `index = pix === 0 ? 0x000 : (pal << 4) \| pix` — a plain palette lookup |
| VCE decode | `renderer/pce-bg.js:58–64` | 9-bit word → 3 channels × 3 bits, each scaled ×36 (0…252). No modifier |
| VCE control | `renderer/pce-bg.js:163–171, :198–199` | reads **DCC bits 1–0 only**, for the dot clock |
| Sprite attributes | `renderer/pce-sprites.js:151–159` | VFLIP (bit 15), CGY (12–13), HFLIP (11), CGX (8), SPBG (7), palette (0–3) |
| Sprite pixel | `renderer/pce-sprites.js:224–225` | `index = 0x100 \| (pal << 4) \| pix`; pixel 0 is transparent |
| Composition | `renderer/pce-sprites.js:471–476` | a sprite pixel wins when SPBG = 1, or when the background pixel's colour number is 0 |
| Final RGB | `renderer/pce-sprites.js:481–497` (`:491–493`) | colour index → CRAM RGB, directly; no post-processing pass exists |
| "No colour math" | `renderer/pce-layers.js:8–10` | "the HuC6260 VCE has no sub screen, no colour math and no brightness register (the only dimming it can do is rewriting palettes)"; the layer model at `:13–21, :45–46` is backdrop + background + two sprite bands |
| Palette model | `renderer/pce-palettes.js:43–45, :94–97` | 32 palettes × 16 entries of 9-bit colour; RGB = 3-bit channel × 36 |

A targeted search finds no shadow/highlight path:
`grep -n -i "shadow\|highlight\|bright\|darken\|colour math\|color math" renderer/pce-bg.js renderer/pce-sprites.js renderer/pce-palettes.js`
returns nothing.

**So: shadow — not modelled. Highlight — not modelled. Correctly**, because the
hardware has no such mode.

## 3. What turboxray's note actually describes: the Mega Drive VDP

The shape of the note —

> "shadow and highlight only work on sprites (or on a whole 8x8 background tile
> block, and then only shadow, not highlight) … a boss made of a background
> layer plus shadow and highlight sprites … gains an extended palette"

— is the Sega Mega Drive/Genesis VDP's S/H feature:

- **Enable bit:** VDP mode register #4 (`$8Cxx`), bit 3, "S/TE" — 1 enables
  shadow/highlight. Sources: Plutiedev, *VDP registers* (web, read 2026-11-03);
  corroborated by megadev's `lib/main/vdp.def.h`,
  `VDP_MASK_SHADOW_HIGHLIGHT (1 << 3)` (web, same date).
- **How it works, per pixel** (Plutiedev, *Shadow/highlight*, web, read
  2026-11-03): sprite palette 3, colour 14 → "pixel is brighter, sprite becomes
  transparent"; sprite palette 3, colour 15 → "pixel is darker, sprite becomes
  transparent". Then the layers are combined and the per-tile/per-sprite
  priority flag decides: if any layer is high priority, no change; otherwise the
  pixel is 50 % darker. Highlight therefore comes only from a sprite (palette 3,
  colour 14); tilemap layers can only darken — exactly the note's "sprites, or
  whole 8×8 background tile blocks and then only shadow".
- **Games:** Toy Story and Ecco the Dolphin are (among other platforms) Mega
  Drive titles; the claim that Toy Story's intro stills (and possibly Ecco) use
  S/H stays **reported, unchecked** here — nobody opened those ROMs for this
  card (that is #202's kind of work).

This is a source-backed correction, not a PCE measurement: the PCE side is
settled by the Hudson register pages in §1, the Mega Drive side by the
community references above.

## 4. Consequences

- **#243 (the hardware-tricks page):** its shadow/highlight item must say "not a
  PC Engine feature — the note is the Mega Drive VDP's S/H" and link here. Its
  own card text already makes the demo conditional on #241; the answer is no.
- **#252 (new):** a guard test for the finding — colour 14/15 render as ordinary
  CRAM entries, and the SAT bits the manual names no function for change
  nothing. An invented S/H path at palette 3 colours 14/15 must fail it.
- **`REFERENCES.md` §7** now points at this file instead of leaving the open
  question "does the studio model shadow and highlight?".

## 5. Evidence

- `node tests/check.js` on this tree (base commit 3285131, run 2026-11-03):
  **PASS — renderer matches Mednafen pixel for pixel on 102 scene(s) and 1
  flicker capture(s).** Every picture's pixels come from the CRAM lookup in
  §2, so this is the standing proof that the lookup matches Mednafen. It is
  *not* a proof that colour 14/15 never triggers anything: no committed scene
  is designed to exercise those indices, which is why #252 adds the targeted
  guard. The absence itself is settled by the register reading in §1 and the
  code reading in §2.
- Source reading: the Hudson VDC/VCE manuals at
  `/Volumes/External/MiniST_Project/PCEHeroTN/docs/datasheets/` (pages cited
  above), plus the two web references in §3.

## 6. Not proven / limits

- No PCE hardware measurement here: the model's colour output is Mednafen-only
  (the project's standing limit), and this card adds no capture.
- The Mega Drive references are community documentation, not the Sega manual;
  the enable bit is corroborated by two independent ones. The identification of
  the note with the Mega Drive is therefore a documented inference, not a
  quoted Hudson statement — the Hudson manuals simply have no such feature.
- Toy Story/Ecco usage is unverified (see §3).
