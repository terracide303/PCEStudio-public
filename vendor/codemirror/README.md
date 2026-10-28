# CodeMirror 5 — vendored for the studio editor (#77)

**CodeMirror 5.65.16** (the last 5.x release). MIT, Copyright (C) 2017 by
Marijn Haverbeke and others — the full notice is in `LICENSE` beside this
file, and every upstream file keeps its own copyright header.

Why 5 and not 6: 5 is a single dependency-free script plus a stylesheet and
drop-in modes/keymaps, which is what a page with no build step needs. 6 is an
ES-module bundle that would add a bundler to this repository.

What is vendored, from the npm package `codemirror@5.65.16`:

| file | use |
|---|---|
| `lib/codemirror.js` | the editor core |
| `lib/codemirror.css` | the editor's base styles |
| `mode/lua/lua.js` | Lua syntax highlighting (`mode/lua`) |
| `addon/selection/active-line.js` | the cursor line's highlight, as ppu.toys' editor has |
| `keymap/vim.js` | the opt-in Vim keymap (Settings → Editor keys → Vim) |

Nothing is modified. Upgrade by replacing the five files from
`https://www.npmjs.com/package/codemirror` at the same version and adding
the new version here and in the header of `renderer/studio.html`.

The studio loads these files only when the page has a real DOM
(`document.createRange` exists); `tests/check-studio.js`'s stub DOM has
none, so it exercises the textarea fallback and the headless-browser run
exercises CodeMirror itself.
