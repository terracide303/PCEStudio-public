# Plan — PCEStudio

**Phase → Feature → Story. A story closes on evidence, never on opinion.**

```
### A feature, in plain words {refined} !5
- [ ] The story ~M — what closes it @role #model
```

`@role` assigns it (see `../workshop/roles.json`), `#model` is the AI it runs
on (`../workshop/agents.py models`; without it, the role's default), `~M` its
size (XS S M L XL), `!5` on a feature ranks it against the others, and
everything after the dash is the evidence required to tick the box.
`../workshop/agents.py cost PCEStudio` prices what is left. **Unticked and unevidenced are the same thing.** Full reference:
`../workshop/docs/BOARD.md`.

**Every phase ends with a retrospective, and so does every two weeks of work.**
`board.py next` prints RETRO DUE when one is owed; the first comes due on its
own two weeks after this project starts. How: `../workshop/RETROSPECTIVE.md`.

---

## Phase 0 — Know what exists before writing anything

### The ground is surveyed {refined}
- [ ] #1 The working examples for a software project are found and judged — at least three candidates read (not just their READMEs), each with licence, maturity, what it is proven on and **what it does not do**; verdict recorded in `../workshop/CATALOGUE.md`; ends in use-it / adapt-it / write-our-own, with a reason @scout
  **This is rule 1 as the first card.** Something already does most of this and works. Find it before inventing a worse one.
- [ ] #3 Anything worth keeping from #1 is INSTALLED AND CONFIRMED LOADED — the skill is in `../workshop/skills/<name>/SKILL.md`, `install_skills.sh` has been run, and **a fresh session has named it out loud as one it can see.** Surveyed is not installed; installed is not loaded @scout
  **A skill that did not load fails silently** — the session works normally and quietly lacks the thing it was added for. So this card does not close on "I installed it"; it closes on a new session listing it. See `../workshop/skills/README.md`.
- [ ] #2 The one thing this project must do is written down, with how we will know it works — one paragraph, and a measurement @you
  Not a feature list. The single outcome that makes it worth doing, and the observation that would prove it.

### The rulebook grows, or none of this was worth setting up
- [?] #4 The first retrospective has been run, and `../workshop/RULES.md` has more than one rule — the five questions in `../workshop/RETROSPECTIVE.md` answered, and whatever they produced landed in RULES.md, CATALOGUE.md, check.sh or skills/ @workshop
  **Left UNREFINED on purpose — you cannot reflect on a project that has not done anything yet.** Refine it when the first phase closes, or after any day that cost more than it should have. It is on the board from day one because a ritual nobody owns is the one that gets skipped in the week it would have mattered, and the rulebook growing is the only reason this method beats just working.
