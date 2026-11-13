# The game engine: a proposal

Written 2026-11-13. A proposal for the maintainer to approve; nothing here is built except where it says so.
The numbers come from docs/ENGINE-STUDY.md (three real HuCards measured frame by frame) and docs/NATIVE.md
(the native route's own measurements).

## What a game needs that the toy language lacks

A toy today draws one screen. A real game has scenes: a title, a level, a boss, a menu. Real games change
scene by blanking the screen, streaming the next scene's pictures into video memory over a few frames, and
bringing the screen back. R-Type does this with about 32,000 words in 21 frames (a third of a second), at 700 to
1,400 words a frame, a third of each frame's time, the rest being the work of reading the data from its banks.
No game in the gallery can do this: all art is loaded once, at start.

## 1. A scene call

One new line in the toy language: `scene("name")`. It means: blank the display, load the named scene's data,
bring the display back. While it runs, the game's own `frame()` is not called, as in the commercial games.
The scene is declared next to the art, in the project (for example a `scenes.json` listing which tiles, palettes,
sprites and song belong to which scene); a game with no scenes file behaves exactly as today (one scene, loaded
at start).

## 2. An asset slot table

In the ROM's fixed page, one table: per scene, a list of records. A record is one of:

- copy to VRAM: bank, offset, VRAM address, word count (the interpreter's existing `copyv` operation, and the
  native route's art loader, already do exactly this);
- copy to the colour table: bank, offset, first colour, count;
- start a song: song number.

The loader walks the list a bounded number of words per frame (about 1,400, from the measurement above) and the
scene call returns when it is done. The studio's importer already produces the words; the work is the table, the
scene file, and the two loaders (interpreter and native).

## 3. Rules the engine keeps

- Interrupt handlers stay in the fixed page and touch no banked code (docs/NATIVE.md, VDC access rules).
- The scroll, control and colour writes of `frame()` are applied in the blanking period (done, 2026-11-13).
- The VDC is written only while no scan interrupt is armed, or in chunks of at most 64 words.

## 4. What stays separate

- **Sound** is its own budget: music costs about 13% of a frame on average and 32% on a busy row; a sample player
  would cost about 30%. Samples are a later, optional addition.
- **Compression** (decompressing pictures on a schedule, as one Konami title does) is not needed until art no
  longer fits uncompressed; the importer's output is already small (NOVA TIDE: 174 KB of text is 7 KB of data).
- **Pre-baked fades** (each fade step as its own palette block, which the commercial games use) are a cheap export
  step to add after the scene call works; not designed here.

## 5. A frame-budget readout

The studio would show a game's idle share per frame the way ENGINE-STUDY measures real games (a game is
typically idle a third to three quarters of the time). The source is the emulator's profiler, through the
scripting link (docs/GEARGRAFX-MCP.md). Not designed in detail.

## Order of work, if approved

1. The scene file format and the importer step that produces the slot table (JavaScript, testable on its own).
2. The native loader: replace the art loader's single boot copy by the table walk, and the `scene()` lowering in
   the C emitter. Test: the console's VRAM after `scene()` equals the importer's image for that scene, as
   `tests/check-native-art.js` does for the boot picture.
3. The interpreter ROM: the same table, with `scene` as a new operation next to `copyv`.
4. A two-scene demo game in the gallery, with a blanked load between them, run on the real console.

## What I need from the maintainer

A yes or no on 1 and 2 (the scene call and the slot table), and whether `scenes.json` is the right place to
declare scenes or the scene should be named in the Lua only.
