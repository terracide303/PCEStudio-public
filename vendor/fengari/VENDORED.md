# Fengari — vendored for PCEStudio's toys (#30)

**Source:** [fengari-web](https://github.com/fengari-lua/fengari-web) 0.1.4
(the published npm package `fengari-web@0.1.4`), `dist/fengari-web.js`.
That bundle contains [fengari](https://github.com/fengari-lua/fengari) 0.1.5
(the Lua 5.3 VM in JavaScript) and fengari-interop.

**Licence:** MIT, Copyright © 2017 Benoit Giannangeli — `LICENSE` beside this
file, copied verbatim from the package.

**What is vendored:** the browser UMD build only (`fengari-web.js`, 219,632
bytes, sha256
`fbea0ee4b2e38840f96b03eb7ee162ae391127df26fccd000a2b8756535c8186`).
`fengari-node.js` is ours: a two-line shim that defines `window` so the same
file also loads under Node (the UMD reads `window` at evaluation time). No other
change was made; nothing here is patched.

**Why Fengari and not wasmoon** — the card's question, with the measurements
and the reasoning, is in `docs/TOYS.md` §1. The short version: half the size
(69 KiB gzipped vs 130), and it is ~4x faster on the hot path this design
uses (a host call per register/palette write), measured on this machine.
