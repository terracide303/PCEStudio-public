#!/usr/bin/env python3
"""mednafen-loadmovie.py — give Mednafen 1.32.1 a `-loadmovie FILE` flag.

Mednafen starts an input movie only from the SHIFT+F7 hotkey.  This adds one
command-line option that calls Mednafen's own MDFNI_LoadMovie right after the
game is loaded — the same call the hotkey makes — so a scripted pad can be
played with no synthetic keyboard or mouse events (card #45).

    python3 -I tools/mednafen-loadmovie.py /path/to/mednafen-source

Three insertions into src/drivers/main.cpp, each asserted, so a source tree
that is not 1.32.1 stops here instead of building something else.  Nothing
else in the emulator changes: the input still goes through Mednafen's movie
reader, its gamepad device and its Turbo Tap.
"""
import os
import sys

GLOBAL_ANCHOR = "static char *qtrecfn = NULL;\n"
GLOBAL_ADD = """
/* PCEStudio (card #45): play an input movie named on the command line.
 * The movie is Mednafen's own save-state + recorded input stream, loaded by
 * Mednafen's own MDFNI_LoadMovie; this only replaces the SHIFT+F7 hotkey as
 * the way to start it, so a scripted pad can be played with no synthetic
 * keyboard events.  Local to this instrument build. */
static char *loadmoviefn = NULL;
"""

ARG_ANCHOR = (
    '\t { "qtrecord", _("Record video and audio output to the specified '
    'filename in the QuickTime format."), 0, &qtrecfn, '
    "SUBSTYPE_STRING_ALLOC }, // TODOC: Video recording done without "
    "filtering applied.\n"
)
ARG_ADD = (
    '\t { "loadmovie", _("Play back the specified input movie file after '
    'loading the game."), 0, &loadmoviefn, SUBSTYPE_STRING_ALLOC },\n'
)

LOAD_ANCHOR = "\tif(netconnect)\n\t MDFNI_NetplayConnect();\n"
LOAD_ADD = (
    "\n\t/* PCEStudio (card #45): start the named input movie now that the"
    " game is loaded. */\n"
    "\tif(loadmoviefn)\n\t{\n"
    '\t fprintf(stderr, "PCEStudio: playing input movie \\"%s\\"\\n", '
    "loadmoviefn);\n"
    "\t MDFNI_LoadMovie(loadmoviefn);\n"
    "\t free(loadmoviefn);\n"
    "\t loadmoviefn = NULL;\n"
    "\t}\n"
)


def patch(path, anchor, addition, marker, label):
    with open(path, "r", encoding="utf-8", errors="surrogateescape") as fh:
        text = fh.read()
    if marker in text:
        print("already patched: " + label)
        return
    n = text.count(anchor)
    if n != 1:
        sys.exit("patch failed: %s: the anchor occurs %d times, expected 1"
                 % (label, n))
    text = text.replace(anchor, anchor + addition, 1)
    with open(path, "w", encoding="utf-8", errors="surrogateescape") as fh:
        fh.write(text)
    print("patched: " + label)


def main(argv):
    if len(argv) != 2:
        sys.exit(__doc__)
    src = os.path.join(argv[1], "src", "drivers", "main.cpp")
    if not os.path.exists(src):
        sys.exit("no src/drivers/main.cpp under " + argv[1])
    patch(src, GLOBAL_ANCHOR, GLOBAL_ADD, "static char *loadmoviefn",
          "-loadmovie's global")
    patch(src, ARG_ANCHOR, ARG_ADD, '"loadmovie", _(',
          "the option's argument table row")
    patch(src, LOAD_ANCHOR, LOAD_ADD, 'PCEStudio: playing input movie',
          "the load after MDFNI_LoadGame")


if __name__ == "__main__":
    main(sys.argv)
