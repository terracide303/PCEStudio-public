# Testing PCEStudio

`tests/all.sh` is the one command: it builds the ROMs the suites read
(`make -C tools`), runs every `tests/check*.js` and `tests/*-mutation.js`, and
prints one verdict per suite. Exit 0 means nothing failed — **not** that
everything ran: a suite that could not run part of its work prints `SKIP`, and
a skip is not a pass.

```sh
tests/all.sh                 # the whole suite
KEEP=1 tests/all.sh          # keep the per-suite logs and print their path
tests/all.sh --browser       # forwards the flag to every suite (check-browser,
                             # check-studio); args are passed through unchanged
MAKE=/path/to/make tests/all.sh
node tests/check-asm.js      # one suite on its own
```

There are three outcomes, and they must not look alike:

| verdict | meaning |
|---|---|
| `PASS` | exit 0 and no `SKIP` line: every check in the suite ran and passed |
| `SKIP` | exit 0 but the suite printed a `SKIP` line: some checks were not run. The skipped checks are printed and the suite counts as **not verified** |
| `FAIL` | non-zero exit: the last lines of the log are printed |

Logs live in a `mktemp -d` under `$TMPDIR` and are removed at exit unless
`KEEP=1`. Nothing is written to a hard-coded `/tmp` (on some machines the
system disk is nearly full).

## Where the external tools live

The repository does not vendor its toolchains (licences and size —
`docs/BUILD.md`). On this machine they are on **External II**:

| what | path | override |
|---|---|---|
| PCEAS 3.23 (native, for the wasm parity check) | `/Volumes/External II/pce-tools/bin/pceas` | `PCEAS` |
| PCEAS 4.x (`pceas4`, the interpreter engine's assembler) | `/Volumes/External II/pce-tools/huc4-src/src/mkit/as/pceas`, as `pceas4` on `PATH` | `PCEAS4` |
| llvm-mos SDK | `/Volumes/External II/pce-tools/llvm-mos/llvm-mos` | `LLVM_MOS` |
| HuC (`bin/huc` **and** `bin/pceas`) | no usable copy on External II today (the clone there is `uli/huc` and has no `bin/huc`); set `HUC_DIR` | `HUC_DIR` |
| Mednafen | on `PATH` (the ROM suites use `/opt/homebrew/bin/mednafen`) | `MEDNAFEN` |
| Chrome for Testing headless shell | `/Volumes/External II/pce-tools/chrome/` | `PCE_CHROME`, `PCE_CHROME_BASE` |
| demo art (CITY, OAK WOODS; never committed) | `/Volumes/External II/agent-workshop-demo/support/deploy-art` | `DEMO_ART`, `PCE_DEMO_ART` |
| the pre-#272 TOWER source | `/Volumes/External II/backup-External/pcestudio-toys/originals/tower/main.lua` | `PCESTUDIO_ORIGINAL_TOWER` |
| the Oak Woods pack (only to rebuild the art) | not on External II today | `OAK_WOODS_PACK` |
| PCEAS source (only to rebuild the wasm) | not on External II today | `PCEAS_SRC` |

**Do not export `PCEAS` to a `/Volumes/External II/...` path.** `tools/Makefile`
runs `$(PCEAS)` unquoted (`tools/Makefile:69`), so make word-splits the space
and tries to execute `/Volumes/External`. `tests/all.sh` runs `make -C tools`
first, so that one export fails the whole suite before any check runs. Use the
`~/.local/bin/pceas` symlink (which has no space) when a build needs PCEAS on
`PATH`, and leave `PCEAS` unset unless a suite asks for it; `check-asm.js`
resolves its own path and passes it to `spawnSync` as one argument.

The JS suites and tools resolve these through **`tools/tool-paths.js`**, in one
order:

1. **the environment override**, used verbatim — the escape hatch for a
   machine that keeps a tool somewhere else (or still on the old drive);
2. **the External II path**;
3. **no path** — the caller prints its own `SKIP` naming what it looked for
   (a test) or a clear error (a build tool).

The old `/Volumes/External` drive is **not searched**. With the HuC only that
drive carries, `check-il-huc` ran and went red on two rebuilt-ROM hashes
(measured 2026-11-14), so finding it would turn a skip into a `FAIL`. If a
tool really is only on the old drive, set the override.

Some checks need **two** things and skip rather than half-run:
`check-il-huc` needs a complete HuC (`bin/huc` and `bin/pceas`); the SDK roots
are accepted only when `bin/mos-pce-clang` is there; a demo-art folder counts
only if the toy's files are in it.

### What needs which tool

| tool | the suites that need it |
|---|---|
| `make`, Node | everything (`tests/all.sh`) |
| native PCEAS 3.23 | `check-asm` (wasm vs native, byte for byte) |
| PCEAS 4.x (`pceas4`) | `check-hutrack`, `check-hutrack-image`, `check-ilvm` (interpreter rebuild), `check-rom-sound`, `check-sfx-fx`, `check-export-song` |
| llvm-mos | `check-il-console`, `check-ilvm`, `check-rom-sound`, `check-sfx-fx`, `check-native-*`, `check-cgen-*`, `check-bank-affinity`, `check-resources` |
| HuC | `check-il-huc` |
| Mednafen | the suites that run a ROM in it — `check-export-games`, `check-measure-rom`, `check-rom-sound`, `check-breaker-78`, `check-resources` (`MEDNAFEN`); suites such as `check.js`, `check-viewer` and `check-dma` compare its committed captures and need only the dumps |
| Chrome headless shell | `check-browser`, `check-studio --browser`, `check-gamepad`, `check-pad-keys` |
| ares captures (a person's run) | `check-ares`; absent captures are a SKIP |
| demo art | `check-city`, `check-oak-woods`, `check-studio`'s demo block |
| the old TOWER source | `check-banked-data` |
| macOS `sips` | `tools/compare-view.py` |

`check-ares` reads a person's ares screenshots; on a machine without a screen
it is a SKIP by design (`tools/capture-ares.sh`).

A **passing** suite whose tool is missing is the bug this page exists to
prevent. If you add a tool, add its path to `tools/tool-paths.js` and its row
here.

## Re-pinning a ROM hash (or any `got`/`want` pin)

A pin is a committed expected value — a ROM's sha256 in `tests/dumps/*/meta.json`
or an array in a `tests/*.js`. When a *deliberate* change to the compiler,
interpreter, encoder or generator moves the bytes, the pin must move with it.
When you did not mean to change the bytes, the pin is right and your change is
the bug: **do not re-pin to get green.**

1. Run the suite and read the failure. The harness prints both values:

   ```
   FAIL  the rebuilt palette HuC ROM is byte-equal to the committed one
         (got "63cbcf…19a05", want "34768a…30ae0c")
   ```

2. Confirm the movement is the change you made, and be able to say what moved
   (a rebuilt `ilvm.bin`, a new IL op, a different code path). If it is not
   explained, stop and treat it as a regression.

3. Replace **want** with **got** at every site. One value is usually in more
   than one place:

   ```sh
   grep -rn "34768af238f5a9adf913283e914e887b6d8513cd68f8fad6d28927ec4530ae0c" \
        tests/ docs/ renderer/ tools/
   ```

   The usual sites are `tests/dumps/*/meta.json` (`rom_sha256`, `sha256`,
   `toolchain`) and the `GAME_PINS` / `ROM_PIN` arrays in `tests/*.js`.
   Generated docs can carry the same numbers.

4. **Re-run the whole suite**, not just the suite that failed. One compiler
   change routinely moves several pins, and a re-pin that misses one has
   already had to be redone (commit `a16f14b`: `check-pad-buttons` kept an old
   `ilvm.bin` sha after the art-copy fix). Re-check at the merged HEAD before
   you push.

5. Commit the pins with what moved and why. The commit message is the only
   place a reader can tell an intended re-pin from a covered-up regression.

`tests/dumps/` is evidence, not scratch: only the pinned values move, and
never push a dump that a test regenerated as a side effect unless the card is
about regenerating it.

## Mednafen captures: let the machine finish, and signal only your own run

The capture scripts (`tools/capture.sh`, `tools/capture-review16.sh`,
`tools/capture-*.sh`) drive Mednafen from the command line — never synthetic
keyboard or mouse events, because the human uses this Mac and injected keys
land in their terminal. A run is: launch Mednafen with `-qtrecord … -autosave
1`, let the picture settle, then `kill -INT` the PID the script started so
Mednafen's `CloseGame` writes the state.

**The timeout lesson.** A fixed `sleep` is not proof the run reached the state
you want to measure. Measured in this project (`docs/REVIEW-16.md`,
`tools/capture-review16.sh`): Mednafen occasionally answers the SIGINT early
and leaves a **1-frame movie with `RCRCount` 195** instead of the steady
state. A capture that trusted the clock recorded a picture that was not the
one under test. So an automated capture must **wait for the condition** (e.g.
`RCRCount >= 233`, or the autosave file appearing) and **retry** when the
state is not there. `SLEEP=<seconds>` only widens the window; it is not the
check.

Two more rules, both measured:

- **Signal only the Mednafen you started.** `pkill -x mednafen` killed another
  seat's capture mid-run on 2026-10-28 (a sprite13 emulator was SIGKILLed
  before it saved). Keep the PID.
- **Give each run its own `MEDNAFEN_HOME`**, under `$TMPDIR`. The account is
  shared, and the default `~/.mednafen` is where settings, save states and
  movies collide. The tests already do this (`check-rom-sound.js`,
  `check-export-games.js`).

Scratch — Mednafen's home, movies, save states, traces — goes under `$TMPDIR`,
never `/tmp` and never inside the repo.

## When a picture is wrong, look at it before theorising

Data checks can be exact while the picture is wrong, and the wrongness is often
one obvious thing to an eye and invisible in a diff count.

```sh
node tools/browser-frame.js toys/NAME/main.lua N OUT.rgb
python3 -I tools/compare-view.py CAPTURE.png OUT.rgb DIFF.png 2
```

`tools/native-compare.js` leaves Mednafen's movie frames in
`OUTDIR/frames/frameNN.png`; `compare-view.py` puts the console capture, the
browser frame and their difference side by side. On 2026-11-13 it showed at
once that NOVA TIDE's "65 differing rows" were **every sprite missing** — the
sprite layer was off — which no count in the test had said
(`tools/compare-view.py:1`).

## The old drive

If a suite skipped because its data is still only on `/Volumes/External`, do
not add the old path back to the code: set the override for the run (e.g.
`DEMO_ART=/Volumes/External/agent-workshop-demo/demo-art node
tests/check-city.js`) and, if the data is needed permanently, copy it to the
External II location named in the table above. A skip with the path in its
message is accurate; a `FAIL` from a stale default is not.
