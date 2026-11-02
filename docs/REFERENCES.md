# References: tools, docs and people we learn from

Collected 2026-11-02 from links and notes the maintainer shared. This file records what each source is, what it is
good for in PCEStudio, and what we know about its **licence**. We link to sources and learn from them; we copy
nothing from a source whose licence is not stated. Items marked **(unverified)** came from a quick web search or a
page index and must be checked before anyone relies on them. The cards that use them are named in each entry.

## 1. turboxray (author of HuTrack)

- **HuTrack** (MIT, copyright Turboxray): the HuC6280 sound engine and DefleMask converter that the exported ROMs
  play. Vendored in `vendor/hutrack/` (see `vendor/hutrack/VENDORED.md`). Source: <https://github.com/Turboxray/HuTrack>.
- **The interpreter-in-the-ROM idea**: the browser export's design is his; credited in the README and on the
  Credits page.
- **`mesen_sprite_sheet.lua`**: a Lua script for Mesen 2 (PC Engine and SuperGrafx). It collects every distinct
  sprite that appears on screen into a sprite sheet PNG, in the colours it was displayed with, and writes a JSON
  file with one entry per line.
  - **Permission:** the author allowed its use for testing our sprites against a second emulator (Discord,
    2026-11-02). It has **no licence line**, so it is **not in the repo**. A copy is kept on the maintainer's
    drive at `/Volumes/External/agent-workshop-demo/references/mesen_sprite_sheet.lua` (original:
    `/Volumes/External/Download/mesen_sprite_sheet.lua`). Ask the author before bundling it.
  - **How it works** (from its header): reads sprites from the VDC's internal SAT RAM, patterns from live VRAM and
    colours from live palette RAM at the first active line; one entry per distinct (pixels, colours); entries are
    hardware sprites (16x16 up to 32x64) on a 16x16 grid; flips are not baked in; index 0 is transparent;
    colours are the ideal 9-bit levels; re-running resumes the sheet; settings `OUT_FOLDER`, `SHEET_W`, `MIN_SEEN`,
    `SAVE_EVERY`, `CAPTURE_VDC2`, `RESUME`, `APPEND_ROM`. Run it in Mesen: Debug > Script Window, with file access
    allowed.
  - **JSON format** (one entry per line): x/y/w/h on the sheet, vdc, pattern code, palette slot, first frame seen,
    the 16 palette values (9-bit VCE GRB, 3 hex digits each) and the pixel indices (1 hex digit per pixel,
    row-major).
  - **Used by:** card #228 (Add Source reads a `sprites.json`) and #229 (a Mesen sprite check).
- **HuVGM**: he asked that PCEStudio support it for music once released (`docs/DECISIONS.md`, 2026-10-28).

## 2. The pce-devel organisation (<https://github.com/pce-devel>)

Repository list read 2026-11-02 (GitHub shows no licence for most; each repo's own files are noted):

| Repo | What it is | Last push | Licence file | Use for us |
| --- | --- | --- | --- | --- |
| `Etripator` | A PC Engine disassembler (by BlockoS): extracts code, graphics and interrupt vectors (`--irq-detect`), label and comment files, CD images | 2026-10-24 | GPL-3 (`LICENCE.txt`) | The ROM viewer and disassembler (#235) |
| `huc` | The HuC kit: HuCC compiler, PCEAS assembler, libraries, examples | 2026-09-10 | an aggregate `LICENSE` that says much of it has no stated terms | Assembler (#224); never bundle HuC itself |
| `mednafenPceDev` | A community Mednafen with PC Engine accuracy fixes (scanline rendering, overscan, display resolution); release 1.29.0.pceDev-1.3 (2024-09-14) | 2025-07-03 | Mednafen's own | A better reference emulator for our trace and frame diffs (#232, #234) |
| `PCE_Soundtest` | A quick test of HuC6280 vs HuC6280A differences (David Shadoff) | 2021-07-31 | MIT | Decide which chip variant our CPU and PSG model follow |
| `TG16_Palette`, `icc_palettes` | Composite palette generation and ICC profiles approximating a real display | 2025-03 / 2022-07 | none stated | An optional "real display" colour view |
| `PCE_Games_with_Bugs` | Documents about games with bugs | 2022-07 | none stated | Test ideas for the ROM report (#202, #235) |
| `PCE_Controller_Info` | How the controllers signal | 2022-09 | none stated | Pad model |
| `PCE_TurboEverdrive_USB` | A program to send ROMs to a Turbo Everdrive | 2022-04 | none stated | Real-hardware testing path |
| `PCE_FRAM_adapter`, `PCE_Keyboard`, `PCECD_seek` | Hardware and CD notes | 2021-2026 | none stated | Reference only |

## 3. HuCC documentation (community-written; author and licence NOT stated anywhere we found)

- Site: <https://aeriform.gitbook.io/hucc> (index at `/llms.txt`), also <https://newsdee.com/hucc/> and the wiki
  <https://github.com/Newsdee/huc/wiki>.
- The markdown source of the function reference:
  <https://github.com/Ryusennin/huc/blob/doc-changes/doc/hucc/hucc-function-reference.md>
  (says "unsupported as of 2025/09/04").
- **Toolchain parts named by the docs:** `hucc` (the C compiler, whose docs focus on CD-ROM work), `pceas` (the
  assembler), `isolink` (CD-ROM linker), `tgemu` (a built-in test emulator) and the deprecated legacy `huc`.
- **Wiki pages:** Getting Started, Overview (hardware, first program, build system, memory model), examples
  (Obeybrew tutorials, a shoot-'em-up demo, a scrolling demo, SuperGrafx examples), function reference, compiler
  internals, and reference pages for graphics, sound (PSG, ADPCM, **HuTrack**), input (joypad, mouse, multitap),
  memory, stdio (`printf`), the System Card (CD-ROM and battery RAM) and directives and macros. Tools: `pce2png`,
  `wav2vox`, `mod2mml`, `sym2inc`.
- **The function groups** (names only, for the comparison with our toy API; see also `docs/TOYS.md`):
  directives `#incbin #incchr #incbat #incblk #incmap #inctile #incspr #incpal #incchrpal #inctilepal #incsprpal`;
  memory `peek peekw poke pokew farpeek farpeekw set_far_base set_far_offset`; video `disp_on disp_off vsync cls
  init_240x208 init_256x224 set_xres set_screen_size vram_addr get_vram put_vram load_vram load_bat load_sprites
  vram2vram` (+ `far_` loaders, `sgx_` SuperGrafx variants, `vpc_set_ctl vpc_set_win1 vpc_set_win2`); scroll
  `scroll_split disable_split disable_all_splits scroll scroll_disable`; colour `clear_palette set_color
  set_color_rgb get_color load_palette set_bgpal set_sprpal read_palette fade_to_black fade_to_white cross_fade_to`;
  sprite `init_satb reset_satb satb_update spr_set spr_hide spr_show spr_x spr_y spr_pattern spr_ctrl spr_pal
  spr_pri spr_get_x spr_get_y`; legacy graphics `gfx_init gfx_clear gfx_plot gfx_line`; character map `set_chrmap
  draw_bat scroll_bat blit_bat`; block map `set_blocks set_blkmap set_multimap draw_map scroll_map blit_map
  get_map_block`; legacy tile and map `set_tile_address set_tile_data load_tile set_map_data load_map put_tile
  map_get_tile map_put_tile load_background`; font `load_default_font set_font_pal set_font_color load_font
  set_font_addr`; text `putchar puts printf sprintf put_digit put_char put_hex put_number put_string put_raw`;
  strings `strcpy strcat strlen strlcpy strlcat memcpy mempcpy memset strcmp strncmp memcmp`; numbers `abs srand
  rand rand8 random8 random`; ZX0 `zx0_to_ram zx0_to_vdc zx0_to_sgx`; joypad `joy joytrg joybuf get_joy_events
  clear_joy_events`; clock `clock_hh clock_mm clock_ss clock_tt clock_reset`; CD-ROM `ac_exists cd_boot cd_status
  cd_getver cd_reset cd_pause cd_unpause cd_fade cd_playtrk cd_playmsf cd_loaddata cd_loadbank cd_loadvram
  cd_fastvram cd_execoverlay`; ADPCM `ad_reset ad_trans ad_read ad_write ad_play ad_cplay ad_stop ad_stat`; backup
  RAM `bm_check bm_format bm_free bm_create bm_exist bm_delete bm_read bm_write`; debug (TGemu only) `dump_screen
  abort exit`. Unsupported there: mouse functions, `bm_size`, `bm_rawread`, `bm_rawwrite` and other low-level
  backup-RAM calls, `cd_numtrk`, `cd_trktype`, `cd_trkinfo`, `strncpy`, `set_joy_callback`.
- **Used by:** survey card #226 (a table of these against our toy API and the gaps as roadmap candidates) and the
  starter kit card #237.

## 4. The ecosystem, from a web search on 2026-11-02 **(unverified; check before relying)**

- `pce-devel/huc` is maintained: a "current" pre-release in March adds SuperGrafx VPC library functions to HuCC
  (<https://github.com/pce-devel/huc/releases>).
- **Mesen 2**: the original repository was reported archived around version 2.1.1 (mid-2025); **MesenCE** is the
  community continuation, 2.2.x in June 2026 (version numbers disagree between sources). Mesen 2's debugger
  integrates PCEAS and HuCC (<https://emulation.gametechwiki.com/index.php/Mesen>). Install MesenCE for #229 and check
  that its Lua API runs the sprite script.
- **Huzak** (in development) converts DefleMask `.dmf` songs straight to a `.pce` ROM
  (<https://battleofthebits.com/lyceum/View/hes%20(format)/>): read it for the tracker survey.
- Many current homebrew projects are written entirely in assembly with custom tools (a 2025 forum post).
- **Not confirmed by the search:** news on the llvm-mos PC Engine target, and Geargrafx.
- From general knowledge (also unverified): Aseprite and Tiled are the usual art and map tools; Furnace and
  DefleMask are the usual trackers.

## 5. Licence of the PCEAS source on the maintainer's drive (`/Volumes/External/pce-tools/pceas3-src/LICENSE`)

It says the legal status of much of the kit cannot be stated exactly; the MagicKit assembler's source says "This
program is freeware. You are free to distribute, use and modify it as you wish."; Ulrich Hecht's 2014 changes are
Simplified BSD. The maintainer decided (2026-11-02) that we may use and bundle it, with its licence text kept
beside it (card #224).

## 6. How ppu.toys handles assembly (from its tool description; its compiler source was not read)

ppu.toys compiles a restricted subset of Lua to 65816 machine code for a SNES cartridge (no interpreter in the
ROM) and shows the generated 65816 for the costliest lines. We did not see a way to write your own assembly there.
That is the model for our compiler item (#101); the assembly chain (#224 to #237) goes beyond it.

## 7. From the HuCC development chat (Discord doc thread, pasted by the maintainer 2026-11-02)

Paraphrased, not quoted. Names are the chat's public handles.

### Who made the HuCC documentation (this answers "author not stated")
- **Elmer** maintains HuC and HuCC (his own fork is merged into `pce-devel/huc`) and merges documentation changes.
  He says the project is in "desperate need" of more and more accurate documentation.
- **Flame** (aeriform) wrote the gitbook <https://aeriform.gitbook.io/hucc>, including the getting-started chapters
  (the "Working with Sprites" chapter is a moving-logo example). Its example was offered to the HuCC repo.
- **MrJ** (pceDev16) rewrote the function reference to match what the repo supports (pull request
  `pce-devel/huc#107`, Sept 2025); **Elmer** merged it into his own restructuring.
- **Kaminari** (Ryusennin) corrected and reorganised it (removed duplicates, added the directives, put the
  SuperGrafx functions next to their PC Engine counterparts; this is the `doc-changes` branch we link to) and
  rewrote the `cross_fade_to()` text. Elmer merged this too.
- **Newsdee** wrote <https://newsdee.com/hucc/> and the wiki <https://github.com/Newsdee/huc/wiki> from their own
  notes after reading most files in the repo (May 2026), and is looking at a shared wiki (a GitHub organisation
  with read-access collaborators). The wording about CD-ROM was corrected after review (see below).
- **Licence of the documents is still not stated.** The way to be sure is to ask Elmer. Until then we link and
  learn, and copy nothing.

### Facts worth keeping
- **HuC versions:** the old HuC v3.21 builds CD and Super CD games fine. Uli's HuC v4 added some limited SuperGrafx
  and Arcade Card support. **HuCC** adds full SuperGrafx support and other modern improvements. So HuCC is not "the
  CD version of HuC"; HuC stays in the kit for old projects. (Correction made to Newsdee's page by Kaminari and
  Elmer, 2026-05-02.)
- **Fades:** `fade_to_*` uses 7 steps. `cross_fade_to` can use 14 half-steps (slower, with odd colours on the way);
  fades are usually quick on purpose because they stop gameplay, and crossfades are used for effects.
- **Mixing C and assembly is normal in HuCC.** Embedded assembly exists (`#asm`, `#asmdef`) and is used to speed up
  slow compiled code. Rules from Elmer: do not jump between asm chunks and do not leave the function from inside
  one, or you break the compiler. If you are comfortable with assembly, write normal procedures and subroutines
  and call them. "Most HuCC users aren't" comfortable with it. The runtime overhead is low; the biggest cost is the
  C stack, which lives in **zero page** and can be tiny if you avoid recursion. Another developer uses embedded
  assembly for things with no library function that must run uninterrupted (for example talking to a flash chip).
  **For our design (#225):** call-by-name into assembly routines, no jumping out, and a stated zero-page budget match
  what HuCC users already do.
- **Shadow and highlight (turboxray):** the console's shadow and highlight only work on sprites (or on a whole 8x8
  background tile block, and then only shadow, not highlight); they cannot be applied to other sprites. The
  easiest general use is a boss made of a background layer plus shadow and highlight sprites: you give up a
  background layer and gain an extended main palette. Toy Story uses it for extra colours in the intro stills; Ecco
  may use it too. **#241: this is the Sega Mega Drive VDP's shadow/highlight (VDP register `$8Cxx` bit 3, colours
  14/15), not a PC Engine feature — the HuC6270/HuC6260 have no such bit. See `docs/SHADOW-HIGHLIGHT.md`; the
  Toy Story/Ecco usage stays reported, unchecked.**
- **Skweek** (game): its level transitions are brute-force palette swapping and colour cycling, not a raster bar on
  colour 0; turboxray's advice for studying any ROM: open it in Mesen to see tile and palette animation. This
  supports the purpose of card #202 (open an existing ROM to learn from it).
- The PC Engine's history interview (Japanese oral history, NEC's part) was mentioned but has little about the
  console itself.

### Open questions that this raises
- Ask Elmer (or the doc authors) for the licence of the HuCC docs, and whether a link and a comparison table is welcome.
- ~~Does the studio model shadow and highlight? If not, it is a gap that real games use.~~ Answered by #241
  (`docs/SHADOW-HIGHLIGHT.md`): the PC Engine has no such mode, so there is no gap; #252 keeps the model that way.

## 8. Geargrafx and an outside opinion on where PCEStudio can be different (2026-11-02)

- **Geargrafx** (<https://github.com/drhelius/Geargrafx>, GPL-3.0, last push 2026-11-01, 252 stars when checked; checked
  against its README): an accurate PC Engine, TurboGrafx-16, SuperGrafx, CD-ROM2 and LaserActive emulator in C++.
  It has a full debugger (just-in-time disassembler, CPU and memory-access breakpoints, debug symbols loaded
  automatically from `.sym`, `.lbl` or `.noi` next to the ROM), save states with rewind, and an **MCP server**
  (stdio or HTTP) so Claude Code and similar tools can drive debugging. From a community comment (unchecked
  detail): it also has VDC, sprite and tile viewers, a PSG inspector, and loads PCEAS, wla-dx and vasm symbols.
  It does not list trace logging, profiling or source-level debugging.
- **The comment's advice, summarised** (a community member after seeing PCEStudio): "AI plus chip viewers" alone does
  not set us apart; the opening is (1) HuCC projects built and debugged in the browser, (2) source-level debugging
  and a profiler (per-scanline and per-frame CPU cost), (3) a live bank and ROM-space map, (4) a map editor in
  HuCC's metatile format plus Tiled import, (5) a music pipeline into a real driver so the studio sounds like the
  ROM, (6) compression tools showing the size and speed trade-off, (7) one-click build and copy to a Turbo
  EverDrive or a programmable HuCard, with photos of games on real consoles, (8) write `.sym` files that Geargrafx
  and Mednafen load, and an "open this build in Geargrafx" route; and (9) talk to the pce-devel people (Elmer,
  pceDev16) and active homebrewers early, as a front end to HuCC and not a competitor.
- **Our reading of it** is in the board cards filed on 2026-11-02 (search the board for "SYM", "bank map",
  "profiler" and "HuCC project").
