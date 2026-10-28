# ares — the second emulator check (card #41)

**2026-10-28. ares v148, installed at
`/Volumes/External II/Applications/ares.app` (Homebrew cask). ares is a
cross-check, not the oracle** — the Hudson manuals and a real PC Engine
decide (`DECISIONS.md`, 2026-10-27 "our own hardware model" and 2026-10-28
"hardware checks wait for Dennis").

## What was measured

`tools/capture-ares.sh all` loads `tools/gen/viewer1/2/3.pce` and the
exported painted ROM (`tools/gen/painted.pce`) in ares as a PC Engine, gets
each frame as a PNG, crops the 256-wide active area and writes:

- `docs/ares-viewer1.png`, `docs/ares-viewer2.png`,
  `docs/ares-viewer3.png`, `docs/ares-painted.png` — 256x224 each;
- `tests/dumps/<viewerN|painted>/ares-block.png` — the full 294x263 picture
  ares presents, so the 232-line window can also be compared with the
  renderer's own frame and with Mednafen.

`node tests/check-ares.js` renders the reference frame from each ROM's dump
(`sceneN` for `viewerN`; `painted` for `painted`) and diffs it against the
ares capture. Exit 0 only if every check passes.

The ROMs were built in this working tree on 2026-10-28 (`make -C tools
gen/viewerN.pce`, `node tests/check-editor.js --write`). `viewer.asm` /
`renderer/viewer-bank0.bin` were being changed for #14 in the same tree, so
**if the viewer ROM changes, re-run `tools/capture-ares.sh all`**: the
frames in `docs/` are evidence for the build that was captured, and the
check compares them with the scene dumps, not with the ROM bytes.

| ROM | ares 256x224 vs renderer | ares 256x232 vs renderer | ares 256x232 vs Mednafen | raw 8-bit ares-vs-Mednafen |
|---|---|---|---|---|
| viewer1 | 0 / 57344 px | 0 / 59392 px | 0 / 59392 px | 155723 / 178176 bytes differ, max Δ 3 |
| viewer2 | 0 / 57344 px | 0 / 59392 px | 0 / 59392 px | 150464 / 178176 bytes differ, max Δ 3 |
| viewer3 | 0 / 57344 px | 0 / 59392 px | 0 / 59392 px | 130080 / 178176 bytes differ, max Δ 3 |
| painted | 0 / 57344 px | 0 / 59392 px | 0 / 59392 px | 101391 / 178176 bytes differ, max Δ 3 |

The 256x224 frame is the card's active-area crop (ares lines 21..244,
VCE lines 18..241). The 256x232 window is the project's Mednafen crop
(VCE 18..249); it is the renderer's own frame height. "0 pixels differ"
is at the 3-bit colour index; the raw 8-bit difference is the DAC scale
below and carries no picture information.

## How the frame is obtained without synthetic input

No keystrokes, no `osascript`, no System Events, no CGEvent. The only
window-server call is a read-only `CGWindowListCopyWindowInfo`
(`tools/ares-window.swift`) to find the window id; the picture is
`screencapture -l <id>`. The script:

- launches its own ares process and records the ares PIDs that existed
  before, so it **refuses to capture or kill a window owned by a PID that
  was already there** (a human's ares session is never touched);
- writes a scratch copy of `settings.bml` and passes `--settings-file`, so
  ares cannot rewrite the human's settings;
- prints the picture's geometry and fails loudly if the window is not the
  expected shape (see below).

## ares settings the crop depends on

```
--system "PC Engine" --no-file-prompt
--setting Input/Defocus=Allow            (run while unfocused)
--setting General/ShowStatusBar=false    (no status bar over the picture)
--setting Video/Overscan=true            (263-line screen node)
--setting Video/ColorEmulation=false     (linear RGB, not the HuC620 LUT)
--setting Video/InterframeBlending=false
--setting Video/AdaptiveSizing=false
--setting Video/AspectCorrectionMode=None (no 4:3 stretch: 1:1 pixels)
--setting Video/Output=IntegerFixed
--setting Video/FixedScale=1
--setting Video/PixelAccuracy=true
--setting Video/DisableVideoInterfaceProcessing=true
--setting Video/WindowWidth=640 --setting Video/WindowHeight=263
```

`Video/Output=IntegerFixed` + `FixedScale=1` + aspect correction none is the
part that makes a pixel diff possible: with the default `Scale`/`Standard`
ares scales the picture to a 4:3 window and every pixel is resampled.

## The geometry ares actually presents

Measured on all four ROMs (the same VDC/VCE setup):

- ares's PC Engine core renders 1365 native pixels per line and, with the
  viewer's VCE clock select (`CR` low bits = 0), emits each VDC dot four
  times (`ares/pce/vdp/vdp.cpp`, `vce.clock() = 4`).  `Overscan=true` sets
  the screen node to 1176x263; the video interface presents that at
  **294x263 VDC dots**, and `IntegerFixed`/`FixedScale=1` draws it 1:1.
- in the 294-dot grid the VDC's 256-dot active window is **columns 24..279**
  (24 dots of left blanking, 14 of right blanking);
- **ares line 21 is the first line of the renderer's Mednafen window**
  (VCE line 18, `firstScanline = 18`), so the 232-line comparison is
  lines 21..252; the 224-line card crop is lines 21..244.

`tools/ares-frame.py` checks the blanking is uniform and the active area is
not flat before it writes a frame. A wrong window scale, aspect correction,
overscan, or a blank/black capture therefore fails instead of producing a
shifted picture that every later diff would silently compare against the
wrong reference.

## ares vs Mednafen — the differences written down

### 1. The 8-bit DAC level scale (the only raw difference)

- **ares** (linear RGB, `ares/pce/vdp/color.cpp`,
  `image::normalize(n, 3, 16)`) presents channel levels
  `0, 36, 73, 109, 146, 182, 219, 255` — `round(255·n/7)`.
- **Mednafen 1.32.1 and `renderer/pce-bg.js`** use `36·n`:
  `0, 36, 72, 108, 144, 180, 216, 252`.

Both are the **same 3-bit colour**: after mapping `round(v·7/255)` back to
the 3-bit index, all four frames are identical to Mednafen (0/59392 pixels).
This is why a byte-for-byte PNG diff against Mednafen would be the wrong
test.

**Which the Hudson manual settles.** The HuC6260 VCE manual fixes the
colour word: 2.1.2 (3) *Color Table Data Write Register (CTW)*, **p. H6-3**,
gives **G = bits 8-6, R = bits 5-3, B = bits 2-0**; Fig. 2-2-1, **p. H6-4**,
shows the 9-bit colour and the VD8/VD7-4/VD3-0 split; 2.2.2, **p. H6-5**,
says "each 3 bits of the contents are shared for G, R and B information".
That is exactly the 3-bit colour both emulators agree on. The manual does
**not** settle the 8-bit raster values: the section that would is 2.4
*RGB Outputs (R, G, B, SYNC)*, **p. H6-6**, and the scanned manual available
here has only 7 pages, ending at H6-5 (both copies:
`/Volumes/External II/DHS-Agent/PceCDTN/docs/datasheets/PCEDev/` and
`/Volumes/External/MiniST_Project/PCEHeroTN/docs/datasheets/`). So: the
picture is right in both; which DAC scale is right is **not proven here**
and belongs to real hardware (#8) or a scan of p. H6-6.

### 2. viewer2's colours — ares agrees with Mednafen

The web emulator Dennis tried showed mint green/purple where Mednafen shows
cyan `(0,216,216)` and blue `(0,0,216)` (`docs/PLAN.md`, #8 note). ares
gives, for exactly the same pixels:

- cyan: **`(0,219,219)`**, 1664 pixels (Mednafen `(0,216,216)`, 1664 px);
- blue: **`(0,0,219)`**, 1664 pixels (Mednafen `(0,0,216)`, 1664 px);
- no mint/purple pixels, and the whole frame is 0/59392 at 3-bit against
  Mednafen.

3-bit, cyan is (R=0, G=6, B=6) and blue is (R=0, G=0, B=6). The Hudson
CTW layout above (**p. H6-3**: G 8-6, R 5-3, B 2-0) says those channel
assignments are the manual's. So the web emulator's mint green/purple is a
channel-order error; **Mednafen and ares are right** (the colour word page
H6-4/H6-5 settles it, as #41's note asked). The only remaining check on
this is the real PC Engine photo (#8).

### 3. No other picture difference

Across the four ROMs the 4-bit pixels, palettes, BAT, scroll registers and
the 232-line window all agree with Mednafen at 3-bit. There is no layout,
offset, or sprite/background difference to report.

## What this does NOT prove

- That ares's 8-bit DAC levels are the right ones (Hudson HuC6260 2.4,
  p. H6-6, is absent from the scanned manual). The 3-bit colour is settled;
  the analogue/raster scale is not.
- That ares and the renderer are both right rather than wrong together:
  ares is a cross-check, not the oracle. The scenes are 256-wide
  backgrounds; the sprite scenes are not part of this check (#14 has its
  own).
- Real hardware. The PC Engine photo is #8, still Dennis's.
- That `screencapture` caught ares's raw framebuffer: this is a compositor
  capture of the window at 1:1 presentation settings. The geometry checks
  pin the scaling and offsets down, but they are not ares writing the frame
  itself.
- The failure side of the check has been exercised only by our own
  one-pixel break (below), not by a cold break chosen by another seat
  (workshop rule 2). A different seat should break the block geometry, the
  crop offset, and the colour map and confirm each is caught.

## The check has been seen to fail

```
# one pixel in viewer2's ares block (and the matching docs frame) changed
ARES_ROMS=viewer2 ARES_DIR=/tmp/mut-docs ARES_DUMPS=/tmp/mut-dumps \
  node tests/check-ares.js
viewer2: FAIL
  ares 256x224 vs renderer: 1 pixels
    px(10,10) ares=(216,108,252) ref=(72,252,108)
  ares 256x232 vs renderer: 1 pixels
  ares 256x232 vs Mednafen: 1 pixels differ at 3-bit colour
```

The docs frame was changed consistently with the block, so the
frame/block consistency check passed and the **picture** diff caught it:
one changed pixel is one reported pixel, at the right coordinate. The
`ARES_ROMS` / `ARES_DIR` / `ARES_DUMPS` overrides exist only for this
self-test; the normal run uses none of them.

A second break — the block shifted up one line — is caught by the geometry
check before any picture diff, with its own message:

```
viewer2: FAIL
  line 19: blanking line not uniform
```

So the two failure kinds are distinguishable: a wrong-geometry capture
says which line/blanking invariant broke; a wrong picture reports the pixel
count and coordinates. Both breaks were chosen by this seat, not by a cold
reviewer; see "What this does NOT prove".
