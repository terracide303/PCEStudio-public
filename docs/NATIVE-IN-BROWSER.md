# Native builds for users: the options (research, 2026-11-14)

**Question.** The native route (Lua → IL → C → llvm-mos → HuC6280 ROM, [`NATIVE.md`](NATIVE.md)) runs
games far faster than the interpreter the studio's Export button builds today, but the compiler (llvm-mos:
clang + lld) cannot run in a browser tab. How do native builds reach users?

**Short answer.** Ship a **downloadable native build kit** first (option E, 1–2 days). It needs no
infrastructure, no account and no cloud, it is useful on its own, and its one new piece — a relocatable
build script with no bash, Python or assembler — is exactly what the better long-term shape (option B, a
local helper that serves the studio) needs. Treat a WebAssembly toolchain (option A) as a timeboxed spike
only if there is demand for zero-install builds; do not build a hosted service (option C) unless the
maintainer decides code may leave the browser; keep only the cheap interpreter work (option D), which
cannot close the gap.

**How much faster.** Our own measurements, not the "2–5×" the question assumed. PLATFORMER costs
**73,445 cycles per update** on the interpreter and **2,685** natively — 27× fewer ([`NATIVE.md`](NATIVE.md),
"Native against interpreter"). TOWER, which the interpreter runs at about five updates a second, holds a
60 Hz frame natively (82,969 cycles mean, 108,544 worst). STARFALL went from 71 to 125 game frames per 300
video frames through the speed work of 2026-11-13/14 (`renderer/release-notes.html`; TOWER 180 → 236,
NOVA TIDE 49 → 64 in the same note). The interpreter's per-operation cost is the limit — about 2.8
scanlines per instruction ([`ROM_SPEED.md`](ROM_SPEED.md)) — so a faster interpreter (option D) cannot
close a gap of this size.

**What this document is not.** It is a decision aid, not a commitment. Every effort figure is an estimate
in working days unless a source is cited; every figure I measured is labelled with how. Where I could not
verify something, it says so, and there is a list at the end.

## What a native build needs today

Measured 2026-11-14 on this machine (Apple silicon) against the llvm-mos SDK release v23.4.0, whose clang
reports `24.0.0git (llvm-mos a40207a)`. Sizes are from `ls -l` / `du`; build times are `/usr/bin/time -p`
around `tools/build-toyc-banked.sh`.

| piece | what | size | runs in a browser tab today? |
|---|---|---|---|
| IL → C | `renderer/pce-cgen.js` (+ `pce-il.js`, `pce-validate.js`) | JS, in the page | **yes** — `renderer/studio-panel-console.js:145` calls `emitC` for the Export dialog's code-byte count |
| art → C | `tools/native-assets.js` (81 lines) over `renderer/pce-toyhost.js` | 8.2 KB of scripts with `native-songs.js` | the importer is a page module; the file plumbing is Node |
| songs → bank | `tools/native-songs.js` (78 lines) over `pce-seq.js` and `pce-hutrack.js`'s own JS assembler | 8.2 KB of scripts with `native-assets.js` | **yes** — `pce-hutrack.js`'s `assemble()` emits the bank in JavaScript; the file plumbing is Node |
| the runtime and glue | `tools/toyc/toy_*.c`, `toy_*.h` | 46,115 B | n/a (it is compiled) |
| bank packer | `tools/bank-toyc.py` | 147 lines | no (Python) |
| build script | `tools/build-toyc-banked.sh` | 170 lines | no (bash; its default toolchain path is a hard-coded `/Volumes/External II/...`) |
| sound engine | HuTrack, assembled with **PCEAS 4**, built **twice per game** because the engine's RAM base follows the program's measured heap | two 8 KiB banks | no — the repo ships PCEAS **3.23** as WebAssembly, and `tools/ilvm/build-engine.sh` says 3.23 cannot assemble HuTrack |
| compiler | `mos-pce-clang`, `lld`, `llvm-nm`, `llvm-objdump`, `lib/clang` headers, `mos-platform/pce` + `common` | **~130 MB for one CPU architecture**; 715 MB as shipped (universal binaries plus clangd/clang-tidy); release tarballs: macOS 192,247,920 B, Linux 115,572,452 B, Windows 208,500,952 B | no |
| time | native, Apple silicon, today | PLATFORMER **1.07 s**, TOWER **2.28 s**, STARFALL **6.29 s** (art + sound + a packing retry) | n/a |

Size detail, so an estimate can be checked: clang is 156,939,048 B as a two-architecture binary (about
78 MB for one), lld 62,309,456 B (31 MB), llvm-nm 9,553,400 B (4.8 MB), llvm-objdump 11,487,872 B
(5.7 MB), `lib/clang/24` 8.8 MB, `mos-platform/pce` 76 KB and `common` 992 KB. The release assets are
from the SDK's `latest` release API (v23.4.0, published 2026-10-26), and the macOS tarball used here has the same
SHA-256 as the published asset (`089afeff92ad4a5321bea0118b678afa6c725206d32bd8e9691bbe65880f8b7c`,
192,247,920 B).

So the **only** steps that cannot run in a tab are the compiler, the Python packer and the PCEAS 4 engine
assembly. Everything before them already runs in the page, or is a page module behind a thin Node file
writer.

## A. clang + lld compiled to WebAssembly, run in the page

**State of the art.**
- **I could find no llvm-mos WebAssembly build.** A GitHub repository search for `llvm-mos wasm`,
  `llvm-mos webassembly` and `mos-clang wasm` returned 0 repositories, and a global issue/PR search for
  the same terms returned only unrelated hits (none in the llvm-mos tracker). That is absence of evidence,
  not a proof that nobody has one privately.
- **Upstream LLVM still has no WASI build.** The RFC to build LLVM for WebAssembly/WASI is
  [discourse.llvm.org/t/rfc-building-llvm-for-webassembly/79073](https://discourse.llvm.org/t/rfc-building-llvm-for-webassembly/79073)
  (a patchset, not landed), and the corresponding upstream PR,
  [llvm/llvm-project#91051 "Add support for WASI builds"](https://github.com/llvm/llvm-project/pull/91051),
  is **closed, not merged**. The RFC's author maintains the patchset outside upstream.
- **But a maintained WASI clang+lld exists to copy from.** YoWASP publishes
  [`@yowasp/clang`](https://codeberg.org/YoWASP/clang) on npm: version `22.0.0-git20542-10`,
  **105,501,358 B unpacked**, "LLVM/Clang/LLD toolchain targeting WebAssembly" (npm registry metadata,
  2026-11-14; [yowasp.org](https://yowasp.org/)). Its packaging repository is small (38 KiB of build and
  wrapper scripts), so the work is the patchset and the build, not a bespoke port — but it is LLVM 22 and
  **has no MOS target**.
- **Generic clang in a browser is proven.** Wasmer runs clang in Chrome, Firefox and Safari via its JS SDK;
  the package is "about 100Mb uncompressed" and they are working toward "~30Mb to download"
  ([wasmer.io/posts/clang-in-browser](https://wasmer.io/posts/clang-in-browser), verified). Compiler
  Explorer runs **llvm-mos** server-side, not in the page
  ([6502.org post](http://forum.6502.org/viewtopic.php?f=2&t=7400)).
**Effort.** 8–20 days, high variance. The pieces: port the YoWASP WASI patchset onto llvm-mos's LLVM 24-dev
fork; build clang **and** lld for WASI; give the browser a virtual filesystem holding `lib/clang/24/include`
and `mos-platform/pce` + `common`; port the 147-line Python packer and the 170-line bash script to
JavaScript (or find a WASI Python, which is a second toolchain to ship); solve the sound engine (PCEAS 4 as
WebAssembly, or the prebuilt-engine-images route from E); a service worker/cache policy for the toolchain;
and a test that builds the gallery games in a real browser. The YoWASP harness is a working reference for
the first two; the MOS target and the SDK's linker scripts are the unknown.

**Run-time cost.** A 100 MB-class download once (cacheable; the site sends `Cache-Control: no-cache` for
pages — `tools/deploy.sh:98` — so the toolchain would need its own cache policy). A WebAssembly clang is
typically several times slower than native; a 1–6 s native build would plausibly become 5–30 s, but **I
did not measure this** and the LTO link is the heavy step. Memory is a real constraint in `wasm32`.

**UX.** Best: one click, nothing to install, works offline after the first load, no account. This is the
only *zero-install* option that fully matches the studio's stance.

**Failure modes.** Browser memory limits, especially on phones/tablets; a 100 MB first load on a slow line;
cache eviction; Safari/iOS differences; toolchain drift against llvm-mos releases; and a long-term
maintenance cost — we would own a WASM build of a *fork* of LLVM, rebuilt for every llvm-mos update, with a
patchset upstream has declined to carry.

**Security/privacy.** The user's code never leaves the browser. Nothing to secure but the page itself.

**Licensing.** Verified: llvm-mos is Apache-2.0 with LLVM Exceptions
([LICENSE.TXT](https://raw.githubusercontent.com/llvm-mos/llvm-mos/main/LICENSE.TXT)) and the SDK is the same
([LICENSE](https://raw.githubusercontent.com/llvm-mos/llvm-mos-sdk/main/LICENSE)). A shipped binary needs
the licence and NOTICE files; a first-load download from the official release avoids redistributing it.

**Fit with the studio.** Fullest possible: local, offline, no account, no backend — the shape
[`STUDIO.md`](STUDIO.md) describes ("No account/publishing controls (there is no backend)"). The cost is
engineering time and an ongoing maintenance treadmill, not trust.

## B. A local helper the page talks to

Two shapes, and they behave very differently because of browser rules. The card asks about Private Network
Access; Chrome's current name for this restriction is **Local Network Access**, which grew out of the
Private Network Access work, so the rules below are LNA's plus the mixed-content and CORS rules that apply
either way.

**The closest working precedent is a local tool server.** 8bitworkshop's experimental "Tool Server" is a
Docker container that provides compiler tools "like llvm-mos", run locally on port 3009 and selected with
`&tool=llvm-mos`; its README says "Right now, you have to run locally and build your own docker container"
and "Not very many of the current examples work"
([README](https://github.com/sehugg/8bitworkshop#tool-server-experimental)). Its 2023 article had said
llvm-mos was "not yet integrated into the 8bitworkshop IDE compiler pipeline"
([article](https://8bitworkshop.com/docs/posts/2023/llvm-mos-sdk-6502-c-compiler.html)). That is shape 1,
with a Docker install on top — evidence that the shape works, and that its install cost is real.

1. **The public page (https://pcestudio.terracides.com) calls `http://127.0.0.1:PORT/build`.** This is
   the shape with the most browser friction:
   - **Chrome** gates it behind **Local Network Access**. The permission prompt launched in **Chrome 142**
     (late October 2025; opt-in testing from Chrome 138). A public site requesting a loopback destination
     needs the user's permission; the ability to *ask* is restricted to secure contexts; the first
     milestone covers `fetch()`, subresource loading and subframe navigation, and WebSockets/WebTransport/
     WebRTC are "planned" but were not gated when the page was last updated (2025-06-09)
     ([Chrome blog](https://developer.chrome.com/blog/local-network-access)). Such requests are exempted
     from mixed-content checks when Chrome knows the destination is local — a private IP literal
     (e.g. `127.0.0.1`), a `.local` name, or a `fetch(..., {targetAddressSpace: "local"})` annotation. A
     secondary summary reports that Chrome 145 split the permission into `local-network` and
     `loopback-network` ([piunikaweb, 2026-02-09](https://piunikaweb.com/2026/02/09/chrome-local-network-permission-explained/);
     **I could not confirm this in an official Chrome document**, and the claims in the earlier draft that
     WebSockets are gated from Chrome 147 and the opt-out removed in Chrome 156 were **not verifiable** —
     I removed them).
   - **Firefox**: MDN states that loopback resources (`http://127.0.0.1/`, `http://localhost/`) are
     considered secure origins for mixed content
     ([MDN Mixed content](https://developer.mozilla.org/en-US/docs/Web/Security/Mixed_content)), and a
     WebKit bug comment records that Firefox fixed this in version 55. I did not re-test a current Firefox.
   - **Safari blocks it.** WebKit does not follow the mixed-content spec for loopback: bug
     [173161](https://bugs.webkit.org/show_bug.cgi?id=173161) ("Webkit rejects requests to localhost from
     https:// pages") is RESOLVED, and bug
     [279249](https://bugs.webkit.org/show_bug.cgi?id=279249) is RESOLVED with the comment "Just accept
     that http:// localhost isn't going to work anymore" (2024-09). So shape 1 cannot work in Safari
     without a locally trusted HTTPS certificate (mkcert-style), which is a bad first-run experience.
   - On top: CORS (our origin allowed, `OPTIONS` preflight answered) and a per-session token, so another
     site cannot drive the compiler.
2. **The helper serves the studio itself** (`npx pcestudio`, or one binary: static files from the repo plus
   a `/build` endpoint; page at `http://127.0.0.1:8770/renderer/studio.html`). Same origin, so **no LNA,
   no mixed content, no CORS**, works in Safari, works offline. This is also how the studio is already run
   for tests (`python3 -m http.server`). The cost is that the user installs a helper and opens the helper's
   URL, not the public site. **This is the shape to build.**

**Effort.** 3–5 days: an HTTP server serving the static site plus `/build`; the toolchain download with a
pinned SHA-256; the build script from E (so no new build logic); the page's second Export button and its
state ("helper not running" is a normal state, not an error); tests that build all five gallery games
through the helper. Shape 1 on top: +1–2 days.

**Run-time cost.** The toolchain download once (192 MB on macOS, 116 MB Linux, 209 MB Windows); about
130 MB on disk per architecture; then native speed, 1–6 s a build, no per-build charge.

**UX.** One install, then one click. The install is the cost: Node (or a single binary) and a ~200 MB
download. For a hobbyist already building ROMs, that is normal; for a visitor who wants to try Export, it
is a wall, and the Export button must stay usable in its interpreter form.

**Failure modes.** The helper is not running or is on another port; the user denies the LNA prompt (shape 1);
Safari (shape 1); antivirus/firewall blocking a local listener; a stale helper against a newer studio
(needs a version handshake and a clear message); the 200 MB download failing behind a proxy; Windows users
without Node.

**Security.** Bind to `127.0.0.1` only; check `Origin`/`Host` and require a per-session token (DNS
rebinding and drive-by POSTs from other sites); refuse paths outside the kit; run the compiler with a time
and memory limit; the compiler only ever sees the user's own project. A local build service is a
privileged endpoint and should be treated as one, even on loopback.

**Licensing.** The same as A/E: llvm-mos Apache-2.0 (downloaded, not necessarily redistributed), our kit
GPL-3 sources, HuTrack MIT.

**Fit with the studio.** Local-first, no account, offline after the first download. The install step is
the one thing the public static site does not ask of anyone today, and it is a real cost — which is why
the public site must keep working without the helper.

## C. A hosted build service

**What we can run.**
- **Our cPanel host.** The site is static files uploaded through cPanel (`tools/deploy.sh`); cPanel's
  Application Manager *can* run Node.js or Python apps under Passenger, but only if the hosting provider
  enables it and installs the runtime package
  ([cPanel docs](https://docs.cpanel.net/cpanel/software/application-manager/)). Whether our plan allows
  it, what its process/memory limits are, and whether a child `clang` process survives are **not
  verified**. Even if it works, we would install a ~715 MB toolchain into a shared account and turn a
  static site into a build service, so this is a poor first choice.
- **Cloudflare Workers cannot.** Verified limits: Worker size 64 MiB, memory 128 MB, startup 1 s, and
  "Threading is not possible in Workers"
  ([limits](https://developers.cloudflare.com/workers/platform/limits/),
  [Wasm docs](https://developers.cloudflare.com/workers/runtime-apis/webassembly/)). A ~130 MB-per-arch
  clang + lld + SDK does not fit as it stands.
- **Containers or a container host can.** Cloudflare Containers (billed per 10 ms, included in the $5/month
  Workers Paid plan), Cloud Run, Fly.io. Prices below are from the vendors' pages fetched 2026-11-14.

**Per-build cost.** A TOWER build is 2–3 CPU-seconds and under 1 GiB on this machine; a cold container
adds start-up. At Cloudflare's $0.000020/vCPU-second and $0.0000025/GiB-second
([pricing](https://developers.cloudflare.com/containers/pricing/)) that is roughly **$0.00007 a build**;
the included 375 vCPU-minutes/month covers about **7,500 builds**. Cloud Run's active rates
($0.000024/vCPU-s, $0.0000025/GiB-s; [pricing](https://cloud.google.com/run/pricing)) give about
**$0.00008 a build**, with a free tier of 180,000 vCPU-seconds + 360,000 GiB-seconds a month (one of the
two free-tier tables on the page; newer-generation pricing lists 240,000/450,000). Fly.io is
$0.0030/hour for a shared-cpu-1x 256 MB machine and gives only a $1 trial
([pricing](https://fly.io/pricing.md)). These are arithmetic from published prices, not bills: a build that
needs 1 GiB and 3 s is an estimate from the native timings above, and cold starts are **unverified**.

**Effort.** 3–6 days: a container image with the trimmed toolchain; a small HTTP service in front of the
build script; rate limits and a bot check; build timeouts and a queue; a Worker route; the page button and
its progress UI. Plus the maintenance of a public compiler endpoint that anyone can feed C to.

**UX.** One click, nothing to install. A cold container adds seconds (unverified).

**Failure modes.** Abuse (a free compiler on our bill is a DoS magnet); queue latency; cold starts; costs
that grow with success; the service being down when a user wants to export; toolchain upgrades forced on
us; and a privacy model change that the rest of the site does not share.

**Security/privacy.** The user's Lua, art and songs **leave their machine**. They can be deleted after the
build and never logged, but they cross the network, which breaks the no-backend stance of
[`STUDIO.md`](STUDIO.md). A build is untrusted input to a compiler: run it unprivileged, with no network,
a time limit and a memory limit, and say in the UI that the project is uploaded.

**Licensing.** Hosting a tool and returning its output is straightforward; the ROM is the user's. The
container image contains Apache-2.0 llvm-mos; keep its notices.

**Fit with the studio.** Poor by default. It is the only option that asks users to trust a server with
their work, and it costs money every month whether or not anyone builds.

## D. Skip the compiler: make the bytecode route faster

Realistic, local, no infrastructure — but it cannot reach native speed, because every bytecode operation
still costs the interpreter about 2.8 scanlines ([`ROM_SPEED.md`](ROM_SPEED.md)). Current measurements,
same document: PLATFORMER 60 Hz at 73,445 cycles/update; TOWER about 5 updates a second; STARFALL too slow
(24 updates in 600 frames, 25.6 Hz projected); DUSK RUN 0.71 Hz. A video frame is about 119,000 cycles
([`NATIVE.md`](NATIVE.md)), so PLATFORMER's 73,445 already fills 62% of one.

Items from the native speed work that carry over: a direct-call operation for statically known callees
(skips the closure lookup), constant division and multiplication operations (`x // 10` 1,866 → 654 cycles,
`x % 60` 1,129 → 380 on the native side; see [`NATIVE.md`](NATIVE.md)), 8/16-bit register forms, and a
baked art loader. **Estimate 5–10 days for perhaps 1.5–2× on the interpreter** — this is reasoning from
the per-operation costs, not a measurement of a faster interpreter.

**Run-time cost.** None — no download, no server, and the existing builds stay byte-identical unless a toy
is re-exported.
**UX.** Nothing changes: the Export button keeps working for everyone, instantly and offline.
**Failure modes.** The plateau: even a 2× interpreter leaves TOWER at ~10 updates/s, STARFALL near 50 Hz
and DUSK RUN under 2 Hz.
Every change risks an interpreter that has years of pixel-evidence pinned to it.
**Security/privacy/licence.** No new surface; all our own code; fully local-first.
**Verdict.** Worth doing only for the cheap, already-designed operations, as continuous small work. It is
not the answer to "native builds reach users", because it is not native.

## E. A downloadable native build kit

The Export dialog already runs the C emitter (`renderer/pce-cgen.js`'s `emitC`); it counts the C and throws
it away. Add a button **"Download native build kit"**: a zip with `game.c`, the art C and the songs bank,
`tools/toyc/toy_*` (46 KB), the packer and one build script, a
`toolchain.json` pinning the llvm-mos release and its SHA-256, a `README`, and the licences. The user
unzips it, runs one command, and the first run downloads the official toolchain (192 MB macOS / 116 MB
Linux / 209 MB Windows) and builds `game.pce` in 1–6 s. For users who only want the gallery games, the
maintainer can publish the same zips without any studio change.

**Effort.** 1–2 days, *if* it is scoped to the pieces below:
- **One Node entry point, no bash and no Python.** Port `tools/bank-toyc.py` (147 lines) to JavaScript and
  fold `build-toyc-banked.sh`'s steps into one script: emit/accept C, compile, pack, link, splice the
  sound banks. This removes the Windows blockers (bash and Python are not there by default) and the
  hard-coded `/Volumes/External II/...` default.
- **No assembler for the user.** Ship prebuilt HuTrack engine images at a handful of fixed RAM bases and
  pick the smallest that fits the linked program's `__heap_start`; fall back to `PCEAS4` when present.
  The risk that could eat the day is whether a small set of bases covers the gallery's heaps — measure
  TOWER and STARFALL first.
- **The page writes the zip.** The art picture is already computed by the importer in the page, and the
  songs bank by `pce-hutrack.js`'s JS assembler, which the page already runs for the interpreter Export.
  No new backend.
- **Proof.** A new test unzips the kit into an empty `$TMPDIR` directory and builds PLATFORMER, TOWER and
  STARFALL with only Node and the downloaded toolchain, then compares the ROMs byte for byte (SHA-256) with
  `tools/build-toyc-banked.sh`'s output.

**Run-time cost.** One 116–209 MB download (192 MB on macOS), then 1–6 s a build; no server, no per-build
charge.

**UX.** More steps than B: download, unzip, run a command. But no install of ours, no account, and it works
offline after the first download. Windows is the weak point unless the script is Node-only.

**Failure modes.** The user has no Node (or an old one); the toolchain download is blocked by a proxy or
corporate policy; Windows path/quoting bugs (our own script defaults to a path with a space — fix it);
antivirus flags a downloaded `.tar.xz`; the kit was generated by an older studio (the `toolchain.json` and a
kit version let the README say so); sound-engine base coverage; a zip from a website is a supply-chain
surface, so the kit must come from our site, pin the checksum, and contain no binaries we did not build.

**Security/privacy.** Nothing leaves the machine. The user runs a script they can read, and the compiler
only sees their own game.

**Licensing.** Our kit is GPL-3 source (the repo's `LICENSE`) — that is fine as source, and the same
runtime is already linked into every interpreter ROM the Export button makes, so this adds no new
licensing question (whether a user's GPL-linked ROM is theirs to license is a pre-existing one for the
maintainer, not this card; that is reasoning, not legal advice). llvm-mos is Apache-2.0 with LLVM
Exceptions. If prebuilt HuTrack engine images
are shipped, include HuTrack's MIT notice (`vendor/hutrack/LICENSE`). PCEAS 4 is **not** redistributed if
the user supplies it or prebuilt images are used; if we ever ship PCEAS binaries, its HuC-derived licence
is murky (`vendor/pceas/LICENSE`: "next to impossible to make an exact statement on the legal status").

**Fit with the studio.** Local-first, no account, no backend, offline after the first download. It asks
more of the user than the public page ever has, but nothing of the maintainer's infrastructure.

## Comparison

| | effort (days) | per build | UX | leaves the machine? | works in Safari? | needs from the maintainer |
|---|---|---|---|---|---|---|
| A. WebAssembly toolchain | 8–20, uncertain | ~100 MB once; 5–30 s, unverified | best: one click, offline | no | yes | time; owns a WASM LLVM-fork build forever |
| B. local helper serving the studio | 3–5 | free, 1–6 s | install once, then one click | no | yes (shape 2) | an installer story (Node or a binary) |
| C. hosted service | 3–6 | ~$0.0001; a plan + abuse handling | one click | **yes** | yes | a paid plan, a privacy decision, abuse cover |
| D. faster interpreter | 5–10 | free | none (already there) | no | yes (already) | nothing |
| E. native build kit | 1–2 | free, 1–6 s | download, unzip, run | no | n/a (not a browser feature) | go/no-go; download pin; a Windows test |

## Recommendation

1. **Do E first (1–2 days).** It needs no infrastructure and no cloud account, it is useful immediately
   (the maintainer can publish kits for the five gallery games without touching the studio), and its
   single new artefact — a relocatable, Node-only build script with no assembler — is the engine of B.
   It is not throwaway work.
2. **Then B in the "serves the studio" shape (3–5 days).** `npx pcestudio` / one binary serves the static
   studio and a `/build` endpoint, so the Export dialog gets a second button, "Build native (needs the
   helper)". It is native-fast, needs nothing from the cloud, and works in Safari. Do **not** build shape 1
   (public page → loopback) as the primary route: Chrome's permission prompt, Firefox's behaviour and
   Safari's refusal make it a worse experience than opening the helper's own page.
3. **Timebox A to a spike (2 days), only if zero-install demand appears.** Start from the YoWASP WASI
   patches and *measure* size and build time for llvm-mos before committing. Do not start from "build LLVM
   for WASM" — that work exists and is better borrowed.
4. **C only if the maintainer decides code may leave the browser** and accepts a monthly bill; it is the
   only option that breaks the studio's no-backend stance, so it needs the maintainer's explicit
   decision, not ours.
5. **D only for the cheap, already-designed parts** (direct-call and constant-division operations), as
   continuous small work. It cannot make the bytecode route native-fast.

**Minimal first step, buildable in 1–2 days.**
Replace `tools/build-toyc-banked.sh` + `tools/bank-toyc.py` with **one Node script** that takes a kit
directory and: finds llvm-mos via `LLVM_MOS` or downloads the pinned official release with a SHA-256
check; compiles and packs (the 147-line packer ported to JS); links; and splices prebuilt sound-engine
images at a fixed base that fits the linked program. Add the Export dialog's "Download native build kit"
zip (or, for the smallest possible cut, generate the zips for the gallery games from the maintainer's
machine). Prove it with a test that unpacks into an empty `$TMPDIR` directory and builds PLATFORMER,
TOWER and STARFALL with **only Node + the downloaded toolchain**, comparing the ROMs byte for byte with
the current script's.

**What that needs from the maintainer.**
- A go/no-go on a second Export output and on publishing kits for the gallery games.
- Approval to pin and download the **official llvm-mos SDK release** (v23.4.0: 192,247,920 B macOS /
  115,572,452 B Linux / 208,500,952 B Windows) and to ship its Apache-2.0 licence/NOTICE in the kit.
- A decision on Windows scope for the first cut — the Node-only script is what makes Windows feasible.
- One clean-machine test, ideally on the maintainer's Windows machine, of the unzip-and-run README.

## What is not verified, and what would settle it

- **No llvm-mos WebAssembly build exists** — absence of evidence from GitHub repo/issue search, not a
  proof. Settle it by searching the llvm-mos Discord/mailing list (not public archives I could reach) and
  by asking upstream.
- **WebAssembly clang build times and memory for our LTO link.** The "3–10× slower" range is typical-range
  reasoning, not a measurement. Settle it with an A spike: build llvm-mos-for-WASI, compile PLATFORMER, time
  it in Chrome and Safari.
- **Chrome's later Local Network Access milestones** (WebSockets/WebTransport, the permission split, the
  removal of an opt-out) beyond the official 2025-06-09 blog and one secondary summary. The earlier draft's
  Chrome 147/156 dates could not be confirmed and were removed.
- **Firefox's current loopback behaviour** — the spec and a 2024 WebKit comment say it works; I did not run
  a current Firefox.
- **Safari's current behaviour** beyond the two WebKit bugs (RESOLVED; the 2024 regression report is about
  Safari 18 beta). Settle it with the shape-1 test page on a current Safari.
- **Whether our cPanel plan can run a Node/Python app under Passenger**, and whether a child `clang`
  process would survive its limits. Settle it by asking the host; do not build C on it regardless.
- **Container cold-start time** for our build, and the real per-build CPU/memory on a 1 vCPU instance.
- **Whether a small set of fixed engine RAM bases covers the gallery's heaps** — the one E experiment that
  could take longer than a day.
- The **8bitworkshop tool server** is documented in its README; I did not run it, so I cannot say how well
  it works or whether it is still maintained.
- I did not test any user-facing build on Windows; all timings are Apple silicon.

## Sources

- Native route, measurements, build pieces: [`NATIVE.md`](NATIVE.md), [`ROM_SPEED.md`](ROM_SPEED.md),
  `renderer/release-notes.html` (all in this repo; timings re-measured 2026-11-14).
- Studio's no-backend stance: [`STUDIO.md`](STUDIO.md) ("No account/publishing controls (there is no
  backend)").
- Chrome Local Network Access: https://developer.chrome.com/blog/local-network-access (page last updated
  2025-06-09)
- LNA enforcement summary (secondary): https://piunikaweb.com/2026/02/09/chrome-local-network-permission-explained/
- Mixed content and localhost: https://developer.mozilla.org/en-US/docs/Web/Security/Mixed_content
- WebKit: https://bugs.webkit.org/show_bug.cgi?id=173161, https://bugs.webkit.org/show_bug.cgi?id=279249
- Clang in the browser (Wasmer): https://wasmer.io/posts/clang-in-browser
- LLVM for WebAssembly RFC: https://discourse.llvm.org/t/rfc-building-llvm-for-webassembly/79073
- Upstream WASI PR (closed, not merged): https://github.com/llvm/llvm-project/pull/91051
- YoWASP Clang/LLD: https://codeberg.org/YoWASP/clang, https://yowasp.org/, npm metadata
  https://registry.npmjs.org/@yowasp/clang/latest
- Compiler Explorer runs llvm-mos server-side: http://forum.6502.org/viewtopic.php?f=2&t=7400
- 8bitworkshop tool server: https://github.com/sehugg/8bitworkshop#tool-server-experimental
- 8bitworkshop's 2023 llvm-mos article: https://8bitworkshop.com/docs/posts/2023/llvm-mos-sdk-6502-c-compiler.html
- llvm-mos run locally (the MEGA65's browser application, not a browser build):
  https://c65gs.blogspot.com/2024/01/switching-from-cc65-to-llvm-mos-for.html
- llvm-mos licences: https://raw.githubusercontent.com/llvm-mos/llvm-mos/main/LICENSE.TXT,
  https://raw.githubusercontent.com/llvm-mos/llvm-mos-sdk/main/LICENSE
- llvm-mos SDK releases and asset sizes: https://github.com/llvm-mos/llvm-mos-sdk/releases/latest
- Cloudflare Containers pricing: https://developers.cloudflare.com/containers/pricing/
- Cloudflare Workers limits: https://developers.cloudflare.com/workers/platform/limits/,
  https://developers.cloudflare.com/workers/runtime-apis/webassembly/
- Cloud Run pricing: https://cloud.google.com/run/pricing
- Fly.io pricing: https://fly.io/pricing.md
- cPanel Application Manager: https://docs.cpanel.net/cpanel/software/application-manager/
